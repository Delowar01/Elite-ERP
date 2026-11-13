/**
 * Platform Owner PO-02B — browser suite for the read-only Companies directory, company details,
 * pending invitations and the live dashboard figures: the production build (`next build` first)
 * served by `next start` on loopback, driven in Chromium.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   PO02B_SCREENSHOT_DIR=<optional output dir> npm run verify:platform-companies-browser
 *
 * Server A runs with PLATFORM_CONSOLE_ENABLED=true and PLATFORM_TRUSTED_PROXY_HOPS=1, server B with
 * the flag unset. One disposable database (dropped at the end) with 1,000 SYNTHETIC companies and a
 * few hand-made ones (one holding every sensitive value the console must never show), fictional
 * operators and TEST-ONLY secrets generated in memory, never printed. Chromium is the pre-installed
 * build (PO01B_CHROMIUM, default /opt/pw-browsers/chromium) — nothing is downloaded.
 */
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page, Request } from "playwright";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { seedSyntheticCompanies } from "../scripts/platform/company-fixtures";
import { section, ok, summary, describeError } from "./platform/harness";
import { startServer, testSecrets, type Server } from "./platform/browser-env";

const require = createRequire(import.meta.url);
const { chromium, request: pwRequest } = require("playwright") as typeof import("playwright");

const testDbName = disposableName("po02b_browser");
const secrets = testSecrets();
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets, { PLATFORM_CONSOLE_ENABLED: "true" });

const { db, pool, platformAdminsTable } = await import("../src/db");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const tenantAuth = await import("../src/lib/auth");

const SHOTS = process.env.PO02B_SCREENSHOT_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PORT_A = Number(process.env.PO02B_PORT_A || 3427);
const PORT_B = Number(process.env.PO02B_PORT_B || 3428);
const PASSWORD = "Juniper-Compass-62!k";
const secretsSeen: string[] = [PASSWORD, ...Object.values(secrets)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const count = (n: number) => new Intl.NumberFormat("en-US").format(n);

const SENSITIVE = {
  taxId: "300999999900003",
  vat: "VAT-SECRET-7781",
  address: "17 Fixture Secret Street",
  phone: "+966-5-0000-4242",
  companyEmail: "secret-contact@sensitive-fixture.test",
  logoUrl: "/uploads/sensitive/secret-logo-7781.png",
  passwordHash: "$2a$04$SECRETHASHSECRETHASHSECRETHASHSECRETHASHSECRETHASH01",
  mfaSecret: "MFASECRETMARKER7781",
  tokenHash: "deadbeef".repeat(8),
  customerName: "Secret Customer Ledger Entry 7781",
};

type Admin = { id: string; email: string; secret: string; lastStep: number };
async function createAdmin(email: string, displayName: string): Promise<Admin> {
  const { secret } = mfa.createTotpEnrollment(email);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date();
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName, passwordHash: await auth.hashPlatformPassword(PASSWORD), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  secretsSeen.push(secret, ...codes);
  return { id: row.id, email, secret, lastStep: 0 };
}
async function freshCode(a: Admin): Promise<string> {
  for (;;) {
    const cur = totp.totpStepAt(new Date());
    const step = Math.max(cur, a.lastStep + 1);
    if (step <= cur + 1) {
      a.lastStep = step;
      return totp.hotpCode(a.secret, step);
    }
    await sleep((cur + 1) * 30_000 - Date.now() + 750);
  }
}

let browser!: Browser;
let A!: Server;
let B!: Server;
const contexts: BrowserContext[] = [];
async function newContext(ip: string, server: Server = A): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL: server.url, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce", extraHTTPHeaders: { "x-forwarded-for": ip } });
  contexts.push(ctx);
  return ctx;
}
async function setPrefs(ctx: BrowserContext, prefs: { locale?: "en" | "ar"; theme?: "light" | "dark" }) {
  const list = [];
  if (prefs.locale) list.push({ name: "locale", value: prefs.locale, url: A.url });
  if (prefs.theme) list.push({ name: "theme", value: prefs.theme, url: A.url });
  await ctx.addCookies(list);
}
async function signIn(ctx: BrowserContext, a: Admin): Promise<Page> {
  const page = await ctx.newPage();
  await go(page, "/platform/login");
  await page.getByLabel("Email", { exact: true }).fill(a.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Verification code", { exact: true }).fill(await freshCode(a));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.waitForURL("**/platform/dashboard", { timeout: 20_000 });
  const c = (await ctx.cookies()).find((x) => x.name === "__Host-elite_erp_platform");
  if (c) secretsSeen.push(c.value);
  return page;
}
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}
/**
 * The console streams each page behind its loading boundary, and React reveals streamed Suspense
 * content in short batches — possibly after the `load` event. Wait until the page's heading is shown
 * before asserting anything about its content.
 */
async function settled(page: Page) {
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 });
}
/** Polls until the named tab is the selected one (a keyboard move commits asynchronously). */
async function tabSelected(page: Page, name: string): Promise<boolean> {
  return page
    .waitForFunction((n) => [...document.querySelectorAll("[role=tab]")].some((t) => t.getAttribute("aria-selected") === "true" && (t.textContent ?? "").trim() === n), name, { timeout: 5_000 })
    .then(() => true, () => false);
}
async function go(page: Page, path: string) {
  const res = await page.goto(path);
  await settled(page);
  return res;
}
/** The status tags under a selector (PlatformStatusTag markup): text, tone, raw value and domain. */
async function tags(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((els) =>
    els.map((e) => ({ text: (e.textContent ?? "").trim(), tone: e.getAttribute("data-tone"), status: e.getAttribute("data-status"), domain: e.getAttribute("data-status-domain") })),
  );
}

/** In-page audit (same rules as the PO-01B browser suite): one h1, named controls, labelled inputs and selects, no page overflow, white on orange. */
type AuditResult = { h1: number; lang: string; dir: string; theme: string | null; overflow: number; unnamed: string[]; unlabelled: string[]; orangeOffenders: string[]; storage: number };
const AUDIT_SCRIPT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const name = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim();
  const unnamed = [...document.querySelectorAll("button, a[href]")].filter((el) => visible(el) && !name(el)).map((el) => el.outerHTML.slice(0, 80));
  const labelled = (el) => (el.labels && el.labels.length) || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
  const unlabelled = [...document.querySelectorAll("input:not([type=hidden]), select")].filter((el) => visible(el) && !labelled(el)).map((el) => el.outerHTML.slice(0, 80));
  const rgb = (c) => (c.match(/rgba?\\(([\\d.]+), ([\\d.]+), ([\\d.]+)(?:, ([\\d.]+))?\\)/) || []).slice(1).map((x) => (x === undefined ? undefined : Number(x)));
  const orange = (c) => { const [r, g, b, a] = rgb(c); return (a === undefined ? 1 : a) > 0.9 && r >= 220 && g >= 80 && g <= 135 && b <= 50; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; const a = rgb(bg)[3]; if (bg && bg !== "transparent" && (a === undefined || a > 0.05)) return bg; } return "rgb(255, 255, 255)"; };
  const offenders = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const text = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim());
    if (text && orange(bgOf(el)) && getComputedStyle(el).color !== "rgb(255, 255, 255)") offenders.push(el.tagName.toLowerCase() + "." + String(el.className).slice(0, 40) + " " + getComputedStyle(el).color);
  }
  return { h1: document.querySelectorAll("h1").length, lang: document.documentElement.lang, dir: document.documentElement.dir, theme: document.documentElement.dataset.theme || null, overflow: document.documentElement.scrollWidth - window.innerWidth, unnamed, unlabelled, orangeOffenders: offenders, storage: localStorage.length + sessionStorage.length };
})()`;
const audit = async (page: Page) => (await page.evaluate(AUDIT_SCRIPT)) as AuditResult;
const auditOk = (a: AuditResult) => a.h1 === 1 && a.overflow <= 1 && a.unnamed.length === 0 && a.unlabelled.length === 0 && a.orangeOffenders.length === 0 && a.storage === 0;
const viewEvents = async () => Number((await q<{ n: number }>("select count(*)::int n from platform_audit_events where action = 'company.viewed'"))[0].n);

async function main() {
  const owner = await createAdmin("owner@platform-companies.test", "Test Operator");
  const client = await connectDisposable(process.env.DATABASE_URL!);
  let seeded: Awaited<ReturnType<typeof seedSyntheticCompanies>>;
  try {
    seeded = await seedSyntheticCompanies(client, { companies: 1000, adminId: owner.id, now: new Date(Date.now() - 3_600_000) });
  } finally {
    await client.end();
  }
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString().replace("T", " ").replace("Z", "");
  const sensitive = (await q<{ id: number }>(`insert into orgs (name, country, currency, tax_id, vat_number, address, phone, email, logo_url, created_at) values ('Sensitive Fixture Holdings', 'Saudi Arabia', 'SAR', $1, $2, $3, $4, $5, $6, $7) returning id`, [SENSITIVE.taxId, SENSITIVE.vat, SENSITIVE.address, SENSITIVE.phone, SENSITIVE.companyEmail, SENSITIVE.logoUrl, ago(60_000)]))[0].id;
  await q(`insert into users (org_id, email, password_hash, name, role, mfa_secret, last_login_at) values ($1, 'owner@sensitive-fixture.test', $2, 'Sensitive Owner', 'owner', $3, $4)`, [sensitive, SENSITIVE.passwordHash, SENSITIVE.mfaSecret, ago(120_000)]);
  await q(`insert into customers (org_id, name) values ($1, $2)`, [sensitive, SENSITIVE.customerName]);
  const four = (await q<{ id: number }>(`insert into orgs (name, country, currency, created_at) values ('Four Owners Partnership', 'Kuwait', 'KWD', $1) returning id`, [ago(30_000)]))[0].id;
  for (let i = 1; i <= 4; i++) await q(`insert into users (org_id, email, password_hash, name, role, created_at) values ($1, $2, $3, $4, 'owner', $5)`, [four, `owner${i}@four-owners.test`, SENSITIVE.passwordHash, `Owner Number ${i}`, ago((10 - i) * 86_400_000)]);
  await q(`insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, invited_by_platform_admin_id) values ('Marker Invite Co', 'hello@marker-invite.test', 'Saudi Arabia', 'SAR', 'Marker Owner', 'owner@marker-invite.test', $1, $2)`, [SENSITIVE.tokenHash, owner.id]);
  const total = Number((await q<{ n: number }>("select count(*)::int n from orgs"))[0].n);
  const suspendedTotal = seeded.suspended.length;

  browser = await chromium.launch({ executablePath: process.env.PO01B_CHROMIUM || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  A = await startServer(PORT_A, { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1" });
  B = await startServer(PORT_B, { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_CONSOLE_ENABLED: undefined, PLATFORM_TRUSTED_PROXY_HOPS: "1" });
  const ctx = await newContext("198.51.100.40");
  await setPrefs(ctx, { locale: "en", theme: "light" });
  const page = await signIn(ctx, owner);
  const posts: Request[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r);
  });

  section("1. Directory: real figures, the first page and an accessible layout");
  {
    const res = await go(page, "/platform/companies");
    const a = await audit(page);
    ok("200, heading Companies, one h1, named controls, labelled inputs and selects, white on orange, no overflow, no browser storage", res?.status() === 200 && (await page.locator("h1").innerText()).trim() === "Companies" && auditOk(a), JSON.stringify(a).slice(0, 300));
    const values = await page.locator(".platform-stat-quad .platform-stat-value").allInnerTexts();
    const legacy = Number((await q<{ n: number }>("select count(*)::int n from orgs o left join tenant_access_controls t on t.org_id = o.id where t.org_id is null"))[0].n);
    const slots = Number((await q<{ n: number }>("select count(*)::int n from organization_invitations where accepted_at is null and revoked_at is null"))[0].n);
    ok(`metric strip = database: ${values.join(" / ")}`, JSON.stringify(values) === JSON.stringify([count(total), count(total - suspendedTotal), count(suspendedTotal), count(slots)]) && (await page.getByText(`${count(legacy)} on the default access`).count()) === 1);
    const layout = { rows: await page.locator(".platform-company-table tbody tr").count(), table: await page.locator(".platform-company-table").isVisible(), cards: await page.locator(".platform-record-cards").isVisible() };
    ok("25 rows on the first page (table visible on desktop, cards hidden)", layout.rows === 25 && layout.table && !layout.cards, JSON.stringify(layout));
    ok(`the summary reads "Showing 1–25 of ${count(total)}"`, (await page.locator(".platform-pager-summary").innerText()).replace(/\s+/g, " ").trim() === `Showing 1–25 of ${count(total)}`);
    const firstIds = await page.locator(".platform-company-table tbody tr .platform-cell-sub bdi").allInnerTexts();
    const expected = (await q<{ id: number }>("select id from orgs order by created_at desc, id desc limit 25")).map((r) => `ORG-${String(r.id).padStart(6, "0")}`);
    ok("the rows are the 25 newest companies, in order", JSON.stringify(firstIds.filter((t) => t.startsWith("ORG-"))) === JSON.stringify(expected));
    ok("Invite company and Export CSV are disabled controls naming their phase", (await page.getByRole("button", { name: /Invite company — Planned for PO-02D/ }).isDisabled()) && (await page.getByRole("button", { name: /Export CSV — Available in a later phase/ }).isDisabled()));
    await page.getByRole("button", { name: /Invite company/ }).click({ force: true }).catch(() => undefined);
    await page.getByRole("button", { name: /Export CSV/ }).click({ force: true }).catch(() => undefined);
    await sleep(300);
    ok("clicking them sends no request and changes nothing", posts.length === 0 && page.url().endsWith("/platform/companies"));
    await shot(page, "40-companies-en-light-1440");
  }

  section("2. Search and filters: a GET form (the URL keeps the query), keyboard included");
  {
    await go(page, "/platform/companies");
    await page.getByLabel("Search companies", { exact: true }).fill("Four Owners");
    await page.getByLabel("Search companies", { exact: true }).press("Enter");
    await page.waitForURL(/q=Four\+Owners/);
    await settled(page);
    ok("Enter in the search field submits the form; the URL keeps the term", (await page.locator(".platform-company-table tbody tr").count()) === 1 && (await page.getByRole("link", { name: "Four Owners Partnership" }).first().isVisible()));
    await go(page, "/platform/companies");
    await page.getByLabel("Access", { exact: true }).selectOption("suspended");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/access=suspended/);
    await settled(page);
    const pills = await tags(page, ".platform-company-table tbody .platform-access .status-tag");
    ok(`access=suspended: ${Math.min(25, suspendedTotal)} rows, every one a danger-toned Suspended status tag`, (await page.locator(".platform-company-table tbody tr").count()) === Math.min(25, suspendedTotal) && pills.length === Math.min(25, suspendedTotal) && pills.every((p) => p.text === "Suspended" && p.tone === "danger" && p.status === "suspended" && p.domain === "platform.company_access"), JSON.stringify(pills.slice(0, 2)));
    ok("the Suspended tile is marked as the current filter", (await page.locator('a.platform-stat-link[aria-current="page"]').innerText()).includes("Suspended"));
    await go(page, "/platform/companies");
    await page.getByLabel("Country", { exact: true }).selectOption("Kuwait");
    await page.getByLabel("Sort by", { exact: true }).selectOption("name");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/country=Kuwait.*sort=name|sort=name.*country=Kuwait/);
    await settled(page);
    const kuwait = (await q<{ name: string }>("select name from orgs where country = 'Kuwait' order by lower(name), id limit 1"))[0].name;
    ok("country + name sort: the first row is the alphabetically first Kuwaiti company", (await page.locator(".platform-company-table tbody tr").first().locator(".platform-company-link").innerText()).trim() === kuwait);
    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.waitForURL(/\/platform\/companies$/);
    await page.waitForFunction((t) => (document.querySelector(".platform-pager-summary")?.textContent ?? "").includes(t), count(total), { timeout: 15_000 });
    ok("Clear filters returns to the unfiltered directory, and the controls show no filter", (await page.locator(".platform-pager-summary").innerText()).includes(count(total)) && (await page.getByLabel("Country", { exact: true }).inputValue()) === "" && (await page.getByLabel("Sort by", { exact: true }).inputValue()) === "newest");
    await page.locator("a.platform-stat-link", { hasText: "Suspended" }).click();
    await page.waitForURL(/access=suspended/);
    await page.waitForFunction(() => (document.querySelector("#companies-access") as HTMLSelectElement | null)?.value === "suspended", undefined, { timeout: 15_000 }).catch(() => undefined);
    ok("a figure tile (client-side link) filters the list and the Access control shows that filter", (await page.getByLabel("Access", { exact: true }).inputValue()) === "suspended" && (await page.locator(".platform-company-table tbody tr").count()) === Math.min(25, suspendedTotal));
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await go(page, `/platform/companies?q=${encodeURIComponent("<img src=x onerror=alert(1)>")}`);
    await sleep(300);
    ok("a markup search term is rendered as text (no script runs), finds nothing", dialogs.length === 0 && (await page.getByText("No companies match this search or these filters.").isVisible()) && (await page.getByLabel("Search companies", { exact: true }).inputValue()) === "<img src=x onerror=alert(1)>");
    await go(page, `/platform/companies?q=${encodeURIComponent("x'); drop table orgs; --")}`);
    ok("an SQL-shaped search term finds nothing and changes nothing", (await page.getByText("No companies match this search or these filters.").isVisible()) && Number((await q<{ n: number }>("select count(*)::int n from orgs"))[0].n) === total);
    await go(page, `/platform/companies?q=${"a".repeat(101)}`);
    const callout = page.locator(".platform-callout[role=alert]");
    ok("an over-long search (crafted URL) shows the controlled message with Start over, no table", (await callout.innerText()).includes("Search terms can be up to 100 characters") && (await callout.getByRole("link", { name: "Start over" }).isVisible()) && (await page.locator(".platform-company-table").count()) === 0);
    await go(page, "/platform/companies?sort=id%3Bdrop");
    ok("an unknown sort (crafted URL) is refused the same way", (await page.locator(".platform-callout[role=alert]").count()) === 1);
    await go(page, "/platform/companies");
    await page.getByLabel("Rows per page", { exact: true }).selectOption("50");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/size=50/);
    await settled(page);
    ok("rows per page = 50 shows 50 rows", (await page.locator(".platform-company-table tbody tr").count()) === 50);
  }

  section("3. Keyset pagination in the browser");
  {
    await go(page, "/platform/companies");
    const refs = async () => (await page.locator(".platform-company-table tbody tr .platform-cell-sub bdi").allInnerTexts()).filter((t) => t.startsWith("ORG-"));
    // A client-side navigation keeps the old page until the new one is in: wait for the range itself.
    const toRange = (range: string) => page.waitForFunction((r) => (document.querySelector(".platform-pager-summary bdi")?.textContent ?? "") === r, range, { timeout: 15_000 });
    const p1 = await refs();
    await page.getByRole("link", { name: "Next", exact: true }).click();
    await toRange("26–50");
    const p2 = await refs();
    ok(`page 2: "Showing 26–50 of ${count(total)}", 25 new rows, a cursor in the URL`, /after=/.test(page.url()) && (await page.locator(".platform-pager-summary").innerText()).replace(/\s+/g, " ").trim() === `Showing 26–50 of ${count(total)}` && p2.length === 25 && !p2.some((r) => p1.includes(r)));
    await page.getByRole("link", { name: "Next", exact: true }).click();
    await toRange("51–75");
    const p3 = await refs();
    ok("page 3: no row repeats an earlier page", p3.length === 25 && !p3.some((r) => p1.includes(r) || p2.includes(r)));
    await page.getByRole("link", { name: "Previous" }).click();
    await toRange("26–50");
    ok("Previous returns exactly page 2 (a before-cursor in the URL)", /before=/.test(page.url()) && JSON.stringify(await refs()) === JSON.stringify(p2));
    await page.getByRole("link", { name: "First page" }).click();
    await toRange("1–25");
    ok("First page returns exactly page 1 (and Previous is inert there)", JSON.stringify(await refs()) === JSON.stringify(p1) && (await page.locator('.platform-pager-link[aria-disabled="true"]').count()) === 1);
  }

  section("4. Company details: audited per view, tabs, owners, disabled later-phase actions");
  {
    const n0 = await viewEvents();
    await go(page, "/platform/companies?q=Four+Owners");
    await page.getByRole("link", { name: "Four Owners Partnership" }).first().click();
    await page.waitForURL(new RegExp(`/platform/companies/${four}$`));
    await page.locator("h1", { hasText: "Four Owners Partnership" }).waitFor({ timeout: 15_000 });
    const a = await audit(page);
    ok("the detail page: heading = company name, breadcrumb back to Companies, one h1, audit clean", (await page.locator("h1").innerText()).trim() === "Four Owners Partnership" && (await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Companies" }).isVisible()) && auditOk(a), JSON.stringify(a).slice(0, 200));
    ok("opening it wrote exactly one company.viewed record", (await viewEvents()) === n0 + 1);
    const tabs = page.getByRole("tab");
    ok("five tabs: Overview, Access & controls, Users, Subscription, Activity", JSON.stringify((await tabs.allInnerTexts()).map((t) => t.trim())) === JSON.stringify(["Overview", "Access & controls", "Users", "Subscription", "Activity"]));
    await page.waitForLoadState("networkidle").catch(() => undefined); // the tabs are interactive once hydrated
    await page.getByRole("tab", { name: "Overview" }).focus();
    await page.keyboard.press("ArrowRight");
    ok("keyboard: ArrowRight moves to Access & controls", await tabSelected(page, "Access & controls"));
    ok("Access: Active by default (no access record), Suspend disabled with its phase", (await page.getByText("Default for existing companies (no access record)").isVisible()) && (await page.getByRole("button", { name: /Suspend company — Planned for PO-02C/ }).first().isDisabled()));
    await page.getByRole("tab", { name: "Users" }).click();
    ok("Users: 4 owners counted, the 3 oldest listed, a note says 3 of 4", (await page.locator(".platform-owner").count()) === 3 && (await page.getByText("Showing 3 of 4 owners").isVisible()) && (await page.locator(".platform-owner").first().innerText()).includes("owner1@four-owners.test"));
    await page.getByRole("tab", { name: "Subscription" }).click();
    ok("Subscription: a labelled preview for PO-05, no invented record", (await page.getByText("Subscriptions are not available yet.").isVisible()) && (await page.getByText("Planned for PO-05").first().isVisible()));
    await page.getByRole("tab", { name: "Activity" }).click();
    ok("switching tabs wrote no further audit record", (await viewEvents()) === n0 + 1);
    await page.reload(); await settled(page);
    await page.getByRole("tab", { name: "Activity" }).click();
    ok("after a reload (a second view) the Activity tab lists the first view", (await page.getByRole("cell", { name: "Viewed company details" }).count()) >= 1 && (await viewEvents()) === n0 + 2);
    const resultTone: Record<string, string> = { Success: "success", Rejected: "warning", Failed: "danger" };
    const results = await tags(page, "[role=tabpanel] table tbody .status-tag");
    ok("each event's result is a status tag toned by the platform state table (Success → success)", results.some((r) => r.text === "Success") && results.every((r) => resultTone[r.text] === r.tone && r.domain === "platform.audit_result"), JSON.stringify(results.slice(0, 2)));
    for (const name of [/Suspend company/, /Edit details/, /Manage users/]) await page.getByRole("button", { name }).first().click({ force: true }).catch(() => undefined);
    await sleep(300);
    ok("clicking the disabled actions sends no request", posts.length === 0);
    await go(page, `/platform/companies/${four}?tab=users`);
    ok("a ?tab= deep link opens that tab", (await page.getByRole("tab", { name: "Users" }).getAttribute("aria-selected")) === "true");
    await shot(page, "41-company-users-en-light-1440");
  }

  section("5. Nothing sensitive reaches the browser");
  {
    const htmlOf = async (path: string) => {
      await go(page, path);
      return (await page.content()) + (await page.evaluate(() => document.documentElement.outerHTML));
    };
    const pages = [`/platform/companies/${sensitive}`, `/platform/companies/${sensitive}?tab=users`, "/platform/companies?q=Sensitive", "/platform/companies?view=invitations&q=Marker", "/platform/dashboard"];
    let html = "";
    for (const p of pages) html += await htmlOf(p);
    const leaked = Object.entries(SENSITIVE).filter(([, v]) => html.includes(v));
    ok(`no tax id, VAT, address, phone, company e-mail, logo URL, password/MFA material, token hash or business record in ${pages.length} pages`, leaked.length === 0, leaked.map(([k]) => k).join(", "));
    ok("the sensitive company's detail shows it HAS a logo without revealing it", (await htmlOf(`/platform/companies/${sensitive}`)).includes("Uploaded"));
  }

  section("6. Not found, audit outage and the invitations view");
  {
    const n0 = await viewEvents();
    for (const path of ["/platform/companies/999999999", "/platform/companies/abc", "/platform/companies/0"]) {
      const res = await go(page, path);
      ok(`${path}: "Company not found" inside the console (HTTP ${res?.status()}), a way back, nothing revealed`, (await page.locator("h1").innerText()).trim() === "Company not found" && (await page.getByRole("link", { name: "Back to companies" }).isVisible()));
    }
    ok("…and no audit record for them", (await viewEvents()) === n0);
    await q(`create or replace function po02b_test_only_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit outage (test only)'; end $$`);
    await q(`create trigger po02b_test_only_fail_audit before insert on platform_audit_events for each row execute function po02b_test_only_fail_audit()`);
    try {
      await go(page, `/platform/companies/${four}`);
      const body = await page.content();
      ok("audit outage: the page says the details are unavailable and shows NO company data", (await page.locator("h1").innerText()).trim() === "Company details are unavailable" && !body.includes("Four Owners Partnership") && !body.includes("four-owners.test"));
      await shot(page, "42-company-audit-unavailable-en-light-1440");
    } finally {
      await q(`drop trigger if exists po02b_test_only_fail_audit on platform_audit_events`);
      await q(`drop function if exists po02b_test_only_fail_audit()`);
    }
    await go(page, `/platform/companies/${four}`);
    ok("…and works again once the audit trail is back", (await page.locator("h1").innerText()).trim() === "Four Owners Partnership");
    await go(page, "/platform/companies");
    await page.getByRole("link", { name: /Pending invitations/ }).first().click();
    await page.waitForURL(/view=invitations/);
    await page.getByLabel("Search invitations", { exact: true }).waitFor({ timeout: 15_000 });
    const states = await tags(page, ".platform-company-table tbody .status-tag");
    const stateTone: Record<string, string> = { Pending: "info", Expired: "warning" };
    ok("invitations view: INV references, Pending (info) and Expired (warning) status tags, the slot note", (await page.locator(".platform-company-table tbody tr").count()) > 0 && states.some((s) => s.text === "Pending") && states.some((s) => s.text === "Expired") && states.every((s) => stateTone[s.text] === s.tone && s.domain === "platform.invitation") && (await page.getByText("Expired invitations keep their owner email reserved until they are revoked.", { exact: false }).isVisible()), JSON.stringify(states.slice(0, 2)));
    const ref = (await page.locator(".platform-company-table tbody tr").first().locator("td").first().innerText()).trim();
    await page.getByLabel("Search invitations", { exact: true }).fill(ref);
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/q=INV-/);
    await settled(page);
    ok(`search by INV reference finds exactly ${ref}`, (await page.locator(".platform-company-table tbody tr").count()) === 1);
    await go(page, "/platform/companies?view=invitations&state=expired");
    const expiredTags = await tags(page, ".platform-company-table tbody .status-tag");
    ok("state=expired lists only expired invitations", expiredTags.length > 0 && expiredTags.length === (await page.locator(".platform-company-table tbody tr").count()) && expiredTags.every((s) => s.text === "Expired" && s.status === "expired"));
    await go(page, `/platform/companies?q=${ref}`);
    ok("an INV reference typed in the registered view points to the invitations view", await page.getByRole("link", { name: "Search pending invitations" }).isVisible());
  }

  section("7. Dashboard: company figures are real, commercial figures stay previews");
  {
    await go(page, "/platform/dashboard");
    const values = await page.locator(".platform-stat-value").allInnerTexts();
    const users = (await q<{ total: number }>("select count(*)::int total from users"))[0];
    ok(`8 tiles: total ${values[0]}, active ${values[1]}, suspended ${values[4]}, users ${values[5]} equal the database; paid plans, trials, expiring and MRR read "—"`, values.length === 8 && values[0] === count(total) && values[1] === count(total - suspendedTotal) && values[4] === count(suspendedTotal) && values[5] === count(Number(users.total)) && [2, 3, 6, 7].every((i) => values[i].trim() === "—"));
    ok("the registrations chart: 6 months, each a list item with its count as text", (await page.locator(".platform-bars > li").count()) === 6 && (await page.locator(".platform-bars .sr-only").allInnerTexts()).every((t) => /: \d+ registered$/.test(t)));
    ok("package mix, expirations and events are labelled previews", (await page.locator(".platform-panel-head .platform-preview-badge").count()) === 3);
    const newestName = (await page.locator(".platform-newest a").first().innerText()).trim();
    await page.locator(".platform-newest a").first().click();
    await page.waitForURL(/\/platform\/companies\/\d+$/);
    await page.getByRole("navigation", { name: "Breadcrumb" }).waitFor({ timeout: 15_000 });
    ok("a newest-company link opens its detail", (await page.locator("h1").innerText()).trim() === newestName);
  }

  section("8. EN / AR × light / dark × 1440 / 1024 / 390: layout audits and screenshots");
  {
    const detailPath = `/platform/companies/${seeded.suspended[0]}`;
    const targets: [string, string][] = [
      ["companies", "/platform/companies"],
      ["invitations", "/platform/companies?view=invitations"],
      ["company", `${detailPath}?tab=access`],
      ["dashboard", "/platform/dashboard"],
    ];
    let n = 0;
    for (const theme of ["light", "dark"] as const) {
      for (const locale of ["en", "ar"] as const) {
        await setPrefs(ctx, { locale, theme });
        for (const width of [1440, 1024, 390]) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          for (const [slug, path] of targets) {
            await go(page, path);
            const a = await audit(page);
            const dirOk = a.dir === (locale === "ar" ? "rtl" : "ltr") && a.lang === locale && a.theme === theme;
            const cards = slug === "companies" || slug === "invitations" ? (await page.locator(".platform-record-cards").isVisible()) === (width === 390) && (await page.locator(".platform-company-table").isVisible()) === (width !== 390) : true;
            ok(`${slug} ${locale}/${theme}/${width}: dir, theme, one h1, named + labelled controls, white on orange, no page overflow${slug === "companies" || slug === "invitations" ? ", cards on phones / table otherwise" : ""}`, dirOk && auditOk(a) && cards, JSON.stringify(a).slice(0, 200));
            await shot(page, `5${targets.findIndex((t) => t[0] === slug)}-${slug}-${locale}-${theme}-${width}`);
            n++;
          }
        }
      }
    }
    ok(`${n} screen / language / theme / width combinations audited`, n === 48);
    await setPrefs(ctx, { locale: "ar", theme: "light" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await go(page, "/platform/companies");
    const transform = await page.locator(".platform-pager-link svg").last().evaluate((el) => getComputedStyle(el).transform);
    ok("Arabic: directional chevrons are mirrored", /^matrix\(-1, 0, 0, 1, 0, 0\)$/.test(transform), transform);
    const boxes = await page.locator(".platform-pager-summary bdi").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
    ok("Arabic: the summary reads right to left (the range sits to the right of the total), numbers stay LTR", boxes.length === 2 && boxes[0] > boxes[1] && (await page.locator(".platform-pager-summary bdi").first().innerText()) === "1–25");
    ok("Arabic: dates use Arabic month names with Western digits", /^\d{1,2} [؀-ۿ]+ \d{4}$/.test((await page.locator(".platform-company-table tbody tr").first().locator("td").nth(5).innerText()).trim()));
    await go(page, `/platform/companies/${four}`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.getByRole("tab", { name: "نظرة عامة" }).focus();
    await page.keyboard.press("ArrowLeft");
    ok("Arabic: ArrowLeft moves to the next tab (mirrored keyboard order)", await tabSelected(page, "الوصول والضوابط"));
    await setPrefs(ctx, { locale: "en", theme: "light" });
  }

  section("9. Server render time at 1,000+ companies (HTTP, measured; target p95 < 2.5 s)");
  {
    const page10 = await (async () => {
      let url = "/platform/companies";
      for (let i = 1; i < 10; i++) {
        await go(page, url);
        url = (await page.getByRole("link", { name: "Next", exact: true }).getAttribute("href")) ?? url;
      }
      return url;
    })();
    const routes: [string, string][] = [
      ["directory, first page", "/platform/companies"],
      ["directory, page 10", page10],
      ["directory, search", "/platform/companies?q=Trading"],
      ["invitations", "/platform/companies?view=invitations"],
      ["company detail (audited)", `/platform/companies/${four}`],
      ["dashboard", "/platform/dashboard"],
    ];
    const rows: string[] = [];
    let worst = 0;
    for (const [name, path] of routes) {
      const times: number[] = [];
      for (let i = 0; i < 33; i++) {
        const t0 = performance.now();
        const r = await ctx.request.get(path, { maxRedirects: 0 });
        await r.body();
        if (i >= 3) times.push(performance.now() - t0);
        if (r.status() !== 200) throw new Error(`${path} → ${r.status()}`);
      }
      times.sort((x, y) => x - y);
      const p95 = times[Math.ceil(times.length * 0.95) - 1];
      worst = Math.max(worst, p95);
      rows.push(`  ${name.padEnd(28)} n=${times.length}  p50 ${times[Math.floor(times.length / 2)].toFixed(1)} ms  p95 ${p95.toFixed(1)} ms  max ${times[times.length - 1].toFixed(1)} ms`);
    }
    console.log(rows.join("\n"));
    ok(`every measured route's p95 is under 2.5 s (worst ${worst.toFixed(1)} ms)`, worst < 2500);
  }

  section("10. Refusals: flag off, no platform session, a customer cookie");
  {
    const anonB = await pwRequest.newContext({ baseURL: B.url });
    const statuses = await Promise.all(["/platform/companies", `/platform/companies/${four}`, "/platform/companies?view=invitations"].map(async (p) => (await anonB.get(p, { maxRedirects: 0 })).status()));
    ok("flag off: the company routes are a bare 404", statuses.every((s) => s === 404), statuses.join(","));
    await anonB.dispose();
    const anon = await pwRequest.newContext({ baseURL: A.url, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.61" } });
    const noSession = await anon.get(`/platform/companies/${sensitive}`, { maxRedirects: 0 });
    ok("no platform session: redirected to the platform login, no data", [302, 303, 307, 308].includes(noSession.status()) && /\/platform\/login/.test(noSession.headers()["location"] ?? "") && !(await noSession.text()).includes("Sensitive Fixture"));
    const customerToken = await tenantAuth.signSessionToken({ userId: 1, orgId: sensitive, jti: randomBytes(16).toString("hex") });
    secretsSeen.push(customerToken);
    const withCustomer = await anon.get("/platform/companies", { maxRedirects: 0, headers: { cookie: `__Host-elite_erp_session=${customerToken}` } });
    ok("a customer session cookie alone never opens the directory", [302, 303, 307, 308].includes(withCustomer.status()) && /\/platform\/login/.test(withCustomer.headers()["location"] ?? ""));
    await anon.dispose();
  }

  section("11. Nothing secret or internal in server output");
  {
    const out = A.output() + B.output();
    ok(`server output contains no password, TOTP secret, recovery code, token or app secret (${secretsSeen.length} values checked)`, !secretsSeen.some((s) => s && s.length >= 8 && out.includes(s)));
    ok("server output contains no connection string and no read-model failure", !/postgres(ql)?:\/\//.test(out) && !out.includes("[platform-companies] internal failure"));
    ok("the only incident lines are the deliberate audit outage", (out.match(/\[platform-security-incident\]/g) ?? []).length >= 1 && (out.match(/\[platform-security-incident\][^\n]*/g) ?? []).every((l) => l.includes('"action":"company.viewed"')));
  }
}

let exitCode = 1;
let created = false;
try {
  await createPlatformTestDatabase("po02b_browser", testDbName);
  created = true;
  await main();
  exitCode = summary("verify:platform-companies-browser");
} catch (e) {
  console.error(`verify:platform-companies-browser aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await A?.stop().catch(() => undefined);
  await B?.stop().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (created && process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
