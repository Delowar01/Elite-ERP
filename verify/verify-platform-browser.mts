/**
 * Platform Owner PO-01B — browser suite: the real /platform routes and forms in Chromium, against
 * the production build (`next build` first) served by `next start` on loopback.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   PO01B_SCREENSHOT_DIR=<optional output dir> npm run verify:platform-browser
 *
 * Two servers from one build: A with PLATFORM_CONSOLE_ENABLED=true and PLATFORM_TRUSTED_PROXY_HOPS=1
 * (each browser context sends its own X-Forwarded-For, standing in for the trusted proxy), and B
 * with the flag unset. One disposable database (dropped at the end), fictional administrators,
 * TEST-ONLY secrets generated in memory, never printed. Chromium is the pre-installed build
 * (PO01B_CHROMIUM, default /opt/pw-browsers/chromium) — nothing is downloaded.
 */
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { APIResponse, Browser, BrowserContext, Locator, Page, Request } from "playwright";
import { createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";
import { startServer, testSecrets, type Server } from "./platform/browser-env";

const require = createRequire(import.meta.url);
const { chromium, request: pwRequest } = require("playwright") as typeof import("playwright");

const testDbName = disposableName("po01b_browser");
const secrets = testSecrets();
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets, { PLATFORM_CONSOLE_ENABLED: "true" });

const { db, pool, platformAdminsTable, platformSessionsTable, platformAuditEventsTable } = await import("../src/db");
const { and, eq, inArray, sql, desc, isNull } = await import("drizzle-orm");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const tenantAuth = await import("../src/lib/auth");

const SHOTS = process.env.PO01B_SCREENSHOT_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PORT_A = Number(process.env.PO01B_PORT_A || 3417);
const PORT_B = Number(process.env.PO01B_PORT_B || 3418);
const PCOOKIE = "__Host-elite_erp_platform";
const CCOOKIE = "__Host-elite_erp_session";
const PASSWORD = "Juniper-Compass-62!k";
const secretsSeen: string[] = [PASSWORD, ...Object.values(secrets)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Admin = { id: string; email: string; secret: string; codes: string[]; lastStep: number };
async function createAdmin(email: string, displayName: string): Promise<Admin> {
  const { secret } = mfa.createTotpEnrollment(email);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date();
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName, passwordHash: await auth.hashPlatformPassword(PASSWORD), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  secretsSeen.push(secret, ...codes);
  return { id: row.id, email, secret, codes, lastStep: 0 };
}
/** A TOTP code for a step the server has not accepted yet (waits for the next step when needed). */
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
const wrongCodeFor = (a: Admin) => {
  const cur = totp.totpStepAt(new Date());
  const valid = new Set([-1, 0, 1].map((d) => totp.hotpCode(a.secret, cur + d)));
  return ["000000", "111111", "222222"].find((c) => !valid.has(c))!;
};

let browser!: Browser;
let A!: Server;
let B!: Server;
const contexts: BrowserContext[] = [];
async function newContext(opts: { ip: string; locale?: "en" | "ar"; theme?: "light" | "dark"; width?: number; height?: number; scale?: number; server?: Server } = { ip: "198.51.100.10" }): Promise<BrowserContext> {
  const server = opts.server ?? A;
  const ctx = await browser.newContext({
    baseURL: server.url,
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    deviceScaleFactor: opts.scale ?? 1,
    reducedMotion: "reduce",
    extraHTTPHeaders: { "x-forwarded-for": opts.ip },
  });
  const cookies = [];
  if (opts.locale) cookies.push({ name: "locale", value: opts.locale, url: server.url });
  if (opts.theme) cookies.push({ name: "theme", value: opts.theme, url: server.url });
  if (cookies.length) await ctx.addCookies(cookies);
  contexts.push(ctx);
  return ctx;
}
async function setPrefs(ctx: BrowserContext, prefs: { locale?: "en" | "ar"; theme?: "light" | "dark" }) {
  const list = [];
  if (prefs.locale) list.push({ name: "locale", value: prefs.locale, url: A.url });
  if (prefs.theme) list.push({ name: "theme", value: prefs.theme, url: A.url });
  await ctx.addCookies(list);
}
const platformCookie = async (ctx: BrowserContext) => (await ctx.cookies()).find((c) => c.name === PCOOKIE);
const formError = (page: Page) => page.locator(".platform-form-error");
/** Waits for the element (isVisible() does not wait). */
const appears = (loc: Locator, timeout = 8_000) => loc.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
const setCookieOf = (r: APIResponse) => r.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value).join("\n");
const clears = (r: APIResponse, name: string) => setCookieOf(r).split("\n").some((c) => c.startsWith(`${name}=;`) && /Max-Age=0/i.test(c));
const locationOf = (r: APIResponse) => r.headers()["location"] ?? "";

async function signInCredentials(page: Page, email: string, password = PASSWORD, path = "/platform/login") {
  await page.goto(path);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
}
async function signIn(ctx: BrowserContext, a: Admin, how: { recovery?: string } = {}): Promise<Page> {
  const page = await ctx.newPage();
  await signInCredentials(page, a.email, PASSWORD, how.recovery ? "/platform/recover" : "/platform/login");
  if (how.recovery) {
    await page.getByLabel("Recovery code", { exact: true }).fill(how.recovery);
    await page.getByRole("button", { name: "Sign in with recovery code" }).click();
  } else {
    await page.getByLabel("Verification code", { exact: true }).fill(await freshCode(a));
    await page.getByRole("button", { name: "Verify and sign in" }).click();
  }
  await page.waitForURL("**/platform/dashboard", { timeout: 20_000 });
  const c = await platformCookie(ctx);
  if (c) secretsSeen.push(c.value);
  return page;
}
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

/**
 * In-page audits: one h1, accessible names, labelled inputs, no horizontal scroll, white text on
 * orange. Passed as a source string: tsx's `__name` helpers would not exist inside the page.
 */
type AuditResult = { h1: number; lang: string; dir: string; theme: string | null; overflow: number; unnamed: string[]; unlabelled: string[]; orangeOffenders: string[]; storage: number };
const AUDIT_SCRIPT = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const name = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim();
  const unnamed = [...document.querySelectorAll("button, a[href]")].filter((el) => visible(el) && !name(el)).map((el) => el.outerHTML.slice(0, 80));
  const unlabelled = [...document.querySelectorAll("input:not([type=hidden])")].filter((el) => visible(el) && !(el.labels && el.labels.length) && !el.getAttribute("aria-label")).map((el) => el.outerHTML.slice(0, 80));
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
async function audit(page: Page): Promise<AuditResult> {
  return (await page.evaluate(AUDIT_SCRIPT)) as AuditResult;
}

async function main() {
  const owner = await createAdmin("owner@platform-console.test", "Test Operator");
  const locked = await createAdmin("locked@platform-console.test", "Throttle Test Operator");
  const chromiumPath = process.env.PO01B_CHROMIUM || "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox"] });
  A = await startServer(PORT_A, { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1" });
  B = await startServer(PORT_B, { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_CONSOLE_ENABLED: undefined, PLATFORM_TRUSTED_PROXY_HOPS: "1" });

  section("1. Audit protection missing → the sign-in form reports a generic outage (cold server)");
  {
    await db.execute(sql`alter table platform_audit_events disable trigger platform_audit_events_immutable`);
    const ctx = await newContext({ ip: "198.51.100.9" });
    const page = await ctx.newPage();
    await signInCredentials(page, owner.email);
    await formError(page).waitFor();
    ok("valid credentials with the audit trigger disabled → 'The platform console is temporarily unavailable.'", (await formError(page).innerText()).trim() === "The platform console is temporarily unavailable.");
    ok("…no session cookie was set and the form stays usable", !(await platformCookie(ctx)) && (await page.getByRole("button", { name: "Continue" }).isEnabled()));
    await db.execute(sql`alter table platform_audit_events enable trigger platform_audit_events_immutable`);
    await ctx.close();
  }

  section("2. Sign-in page: public, bilingual, no client storage, generic errors");
  {
    const anon = await newContext({ ip: "198.51.100.20", scale: 2 });
    const page = await anon.newPage();
    const res = await page.goto("/platform/login");
    ok("GET /platform/login → 200 with X-Robots-Tag noindex", res?.status() === 200 && /noindex/.test(res?.headers()["x-robots-tag"] ?? ""));
    const a = await audit(page);
    ok("English sign-in: lang=en dir=ltr, one h1, every control named, inputs labelled, no storage", a.lang === "en" && a.dir === "ltr" && a.h1 === 1 && a.unnamed.length === 0 && a.unlabelled.length === 0 && a.storage === 0, JSON.stringify(a).slice(0, 300));
    ok("white text on every orange fill (light)", a.orangeOffenders.length === 0, a.orangeOffenders.join("; "));
    for (const theme of ["light", "dark"] as const) {
      for (const locale of ["en", "ar"] as const) {
        await setPrefs(anon, { locale, theme });
        for (const width of [1440, 1024, 390]) {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await page.goto("/platform/login");
          const s = await audit(page);
          if (width === 1440) ok(`sign-in ${locale}/${theme}: dir=${locale === "ar" ? "rtl" : "ltr"}, data-theme=${theme}, white on orange, no overflow`, s.dir === (locale === "ar" ? "rtl" : "ltr") && s.theme === theme && s.orangeOffenders.length === 0 && s.overflow <= 1, JSON.stringify(s).slice(0, 200));
          if (width === 390) ok(`sign-in ${locale}/${theme} at 390 px: no horizontal scroll`, s.overflow <= 1);
          await shot(page, `01-login-${locale}-${theme}-${width}`);
        }
      }
    }
    await setPrefs(anon, { locale: "ar", theme: "light" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/platform/login");
    ok("Arabic sign-in heading is native Arabic", (await page.locator("h1").innerText()).trim() === "تسجيل دخول مالك المنصة");
    await page.getByLabel("البريد الإلكتروني", { exact: true }).fill(owner.email);
    await page.getByLabel("كلمة المرور", { exact: true }).fill("Wrong-Password-00!");
    await page.getByRole("button", { name: "متابعة" }).click();
    await formError(page).waitFor();
    ok("Arabic: a wrong password shows the generic Arabic error", (await formError(page).innerText()).trim() === "البريد الإلكتروني أو كلمة المرور غير صحيحة.");
    await setPrefs(anon, { locale: "en", theme: "light" });
    await page.goto("/platform/login");
    await page.getByLabel("Email", { exact: true }).fill("ghost@platform-console.test");
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();
    await formError(page).waitFor();
    ok("an unknown account gets the same generic error as a wrong password", (await formError(page).innerText()).trim() === "The email or password is incorrect.");
    ok("…and the password field is cleared, the email kept", (await page.getByLabel("Password", { exact: true }).inputValue()) === "" && (await page.getByLabel("Email", { exact: true }).inputValue()) === "ghost@platform-console.test");
    ok("the URL never carries the email or password", !/ghost|Juniper|password/i.test(page.url()));
    await anon.close();
  }

  // The operator's main browser (A): screenshots at DSF 2.
  const ctxA = await newContext({ ip: "198.51.100.10", scale: 2 });
  let pageA: Page;
  section("3. Sign-in → wrong code → correct code → dashboard; cookie attributes");
  {
    pageA = await ctxA.newPage();
    await signInCredentials(pageA, owner.email);
    await pageA.getByLabel("Verification code", { exact: true }).waitFor();
    ok("correct password → the second-factor step (no cookie yet, URL unchanged)", !(await platformCookie(ctxA)) && pageA.url().endsWith("/platform/login"));
    await shot(pageA, "02-mfa-step-en-light-1440");
    await pageA.getByLabel("Verification code", { exact: true }).fill(wrongCodeFor(owner));
    await pageA.getByRole("button", { name: "Verify and sign in" }).click();
    await formError(pageA).waitFor();
    ok("a wrong code → generic 'incorrect or already used'; still on the code step, field cleared", (await formError(pageA).innerText()).includes("incorrect or has already been used") && (await pageA.getByLabel("Verification code", { exact: true }).inputValue()) === "");
    const storage = await pageA.evaluate(() => localStorage.length + sessionStorage.length);
    ok("nothing in localStorage / sessionStorage between the steps", storage === 0);
    const usedCode = await freshCode(owner);
    await pageA.getByLabel("Verification code", { exact: true }).fill(usedCode);
    await pageA.getByRole("button", { name: "Verify and sign in" }).click();
    await pageA.waitForURL("**/platform/dashboard");
    ok("the correct code → /platform/dashboard", (await pageA.locator("h1").innerText()).trim() === "Platform Overview");
    const c = await platformCookie(ctxA);
    if (c) secretsSeen.push(c.value);
    const hours = c ? (c.expires * 1000 - Date.now()) / 3_600_000 : 0;
    ok("cookie __Host-elite_erp_platform: HttpOnly, Secure, SameSite=Lax, Path=/, host-only, expires ≤ 12 h", !!c && c.httpOnly && c.secure && c.sameSite === "Lax" && c.path === "/" && c.domain === "localhost" && hours > 11.9 && hours <= 12.01);
    ok("no customer session cookie was created", !(await ctxA.cookies()).some((x) => x.name === CCOOKIE));
    ok("the token is not readable from JavaScript", !(await pageA.evaluate(() => document.cookie)).includes(PCOOKIE));

    const replayCtx = await newContext({ ip: "198.51.100.21" });
    const rp = await replayCtx.newPage();
    await signInCredentials(rp, owner.email);
    await rp.getByLabel("Verification code", { exact: true }).fill(usedCode);
    await rp.getByRole("button", { name: "Verify and sign in" }).click();
    await formError(rp).waitFor();
    ok("replaying the code just used (another browser) → rejected, no session", (await formError(rp).innerText()).includes("incorrect or has already been used") && !(await platformCookie(replayCtx)));
    await rp.getByRole("button", { name: "Use a recovery code instead" }).click();
    ok("the code step can switch to the recovery-code method", await appears(rp.getByLabel("Recovery code", { exact: true })));
    await rp.getByRole("button", { name: "Back" }).click();
    ok("'Back' returns to the credentials step with the password cleared", (await rp.getByLabel("Password", { exact: true }).inputValue()) === "");
    await replayCtx.close();
  }

  section("4. Recovery-code sign-in (/platform/recover)");
  const ctxB = await newContext({ ip: "198.51.100.11" });
  {
    const page = await ctxB.newPage();
    await signInCredentials(page, owner.email, PASSWORD, "/platform/recover");
    await page.getByLabel("Recovery code", { exact: true }).fill(owner.codes[0]);
    await page.getByRole("button", { name: "Sign in with recovery code" }).click();
    await page.waitForURL("**/platform/dashboard");
    ok("a recovery code signs in and lands on the dashboard", (await page.locator("h1").innerText()).trim() === "Platform Overview");
    ok("…with a notice of the codes left", await appears(page.getByText("Recovery codes left: 9")));
    const again = await newContext({ ip: "198.51.100.22" });
    const p2 = await again.newPage();
    await signInCredentials(p2, owner.email, PASSWORD, "/platform/recover");
    await p2.getByLabel("Recovery code", { exact: true }).fill(owner.codes[0]);
    await p2.getByRole("button", { name: "Sign in with recovery code" }).click();
    await formError(p2).waitFor();
    ok("the same recovery code again → rejected", !(await platformCookie(again)));
    await again.close();
  }

  section("5. The seven sections: layout, previews, accessibility, EN/AR, light/dark, 1440/1024/390");
  {
    const pages = [
      ["dashboard", "Platform Overview", "نظرة عامة على المنصة"],
      ["companies", "Companies", "الشركات"],
      ["users", "Users", "المستخدمون"],
      ["subscribers", "Subscribers", "المشتركون"],
      ["packages", "Subscription Packages", "باقات الاشتراك"],
      ["activity", "Activity Log", "سجل النشاط"],
      ["settings", "Settings", "الإعدادات"],
    ] as const;
    for (const [slug, en, ar] of pages) {
      for (const locale of ["en", "ar"] as const) {
        await setPrefs(ctxA, { locale, theme: "light" });
        await pageA.setViewportSize({ width: 1440, height: 900 });
        const res = await pageA.goto(`/platform/${slug}`);
        const a = await audit(pageA);
        const h1 = (await pageA.locator("h1").innerText()).trim();
        ok(`${slug} (${locale}): 200, heading "${locale === "en" ? en : ar}", dir ${locale === "ar" ? "rtl" : "ltr"}, one h1, named controls, white on orange`, res?.status() === 200 && h1 === (locale === "en" ? en : ar) && a.dir === (locale === "ar" ? "rtl" : "ltr") && a.h1 === 1 && a.unnamed.length === 0 && a.unlabelled.length === 0 && a.orangeOffenders.length === 0, JSON.stringify({ heading: h1, ...a }).slice(0, 300));
      }
    }
    // Screenshot matrix: the dashboard in every combination; the other sections in a representative set.
    for (const theme of ["light", "dark"] as const) {
      for (const locale of ["en", "ar"] as const) {
        await setPrefs(ctxA, { locale, theme });
        for (const width of [1440, 1024, 390]) {
          await pageA.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await pageA.goto("/platform/dashboard");
          const a = await audit(pageA);
          ok(`dashboard ${locale}/${theme}/${width}: no horizontal scroll, white on orange`, a.overflow <= 1 && a.orangeOffenders.length === 0 && a.theme === theme, JSON.stringify(a).slice(0, 200));
          await shot(pageA, `10-dashboard-${locale}-${theme}-${width}`);
        }
      }
    }
    const sample: [string, "en" | "ar", "light" | "dark", number][] = [
      ["companies", "en", "light", 1440], ["companies", "ar", "dark", 1024], ["users", "en", "dark", 1440], ["users", "ar", "light", 390],
      ["subscribers", "ar", "light", 1440], ["subscribers", "en", "light", 390], ["packages", "en", "light", 1440], ["packages", "ar", "dark", 1440],
      ["activity", "en", "dark", 1024], ["activity", "ar", "light", 1440], ["settings", "en", "light", 1440], ["settings", "ar", "dark", 1440], ["settings", "en", "dark", 390], ["settings", "ar", "light", 1024],
    ];
    for (const [slug, locale, theme, width] of sample) {
      await setPrefs(ctxA, { locale, theme });
      await pageA.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await pageA.goto(`/platform/${slug}`);
      ok(`${slug} ${locale}/${theme}/${width}: no horizontal scroll`, (await audit(pageA)).overflow <= 1);
      await shot(pageA, `2${["companies", "users", "subscribers", "packages", "activity", "settings"].indexOf(slug)}-${slug}-${locale}-${theme}-${width}`);
    }
    // RTL geometry and the mobile drawer.
    await setPrefs(ctxA, { locale: "ar", theme: "light" });
    await pageA.setViewportSize({ width: 1440, height: 900 });
    await pageA.goto("/platform/dashboard");
    const side = await pageA.locator("aside.sidebar").boundingBox();
    ok("Arabic: the sidebar sits on the right (inline start in RTL)", !!side && side.x > 1000);
    for (const locale of ["en", "ar"] as const) {
      await setPrefs(ctxA, { locale, theme: "light" });
      await pageA.setViewportSize({ width: 390, height: 844 });
      await pageA.goto("/platform/dashboard");
      ok(`390 px (${locale}): no persistent sidebar; the menu button opens the drawer`, !(await pageA.locator("aside.sidebar").isVisible()));
      await pageA.getByRole("button", { name: locale === "en" ? "Open navigation" : "فتح قائمة التنقل" }).click();
      const drawer = pageA.locator(".mobile-nav");
      await drawer.waitFor();
      ok(`drawer (${locale}) lists the seven sections and the account utilities`, (await drawer.locator("a.nav-item").count()) === 7 && (await drawer.locator(".topbar-profile").count()) === 1);
      await shot(pageA, `30-drawer-${locale}-light-390`);
      await pageA.keyboard.press("Escape");
      await drawer.waitFor({ state: "detached" }).catch(() => undefined);
      ok(`Escape closes the drawer (${locale})`, (await pageA.locator(".mobile-nav").count()) === 0);
    }
    await setPrefs(ctxA, { locale: "en", theme: "light" });
    await pageA.setViewportSize({ width: 1440, height: 900 });
    await pageA.goto("/platform/dashboard");
    await pageA.keyboard.press("Tab");
    ok("keyboard: the first Tab reaches the skip link", await pageA.evaluate(() => document.activeElement?.classList.contains("skip-link") ?? false));
    await pageA.keyboard.press("Enter");
    ok("…and Enter moves focus to the main content", await pageA.evaluate(() => document.activeElement?.id === "main-content" || location.hash === "#main-content"));
  }

  section("6. Later-phase controls are visibly marked and never operate");
  {
    await pageA.goto("/platform/companies");
    const posts: Request[] = [];
    const onReq = (r: Request) => {
      if (r.method() === "POST") posts.push(r);
    };
    pageA.on("request", onReq);
    // PO-02B made the directory's search and filters operational (read-only, a GET form); the later-phase
    // controls must still be disabled, name their phase and never send anything.
    const disabled = pageA.locator("button[aria-disabled='true'], select[aria-disabled='true']");
    ok(
      "companies: the later-phase controls — Invite company (PO-02D), Export CSV and the Package filter (PO-04) — are disabled and name their phase",
      (await disabled.count()) === 3 &&
        (await pageA.getByRole("button", { name: /Invite company — Planned for PO-02D/ }).isDisabled()) &&
        (await pageA.getByRole("button", { name: /Export CSV — Available in a later phase/ }).isDisabled()) &&
        (await pageA.locator("select[aria-disabled='true']").isDisabled()),
    );
    await pageA.getByRole("button", { name: /Invite company/ }).click({ force: true }).catch(() => undefined);
    await pageA.getByRole("button", { name: /Export CSV/ }).click({ force: true }).catch(() => undefined);
    await sleep(500);
    ok("clicking them sends no request and changes nothing", posts.length === 0 && pageA.url().endsWith("/platform/companies"));
    await pageA.locator(".platform-search-preview").click();
    ok("the header search is a labelled preview: it shows a notice and queries nothing", (await appears(pageA.getByText("Search becomes available with company management."))) && posts.length === 0);
    pageA.off("request", onReq);
    await pageA.goto("/platform/packages");
    ok("packages: no price is shown; the pending-approval notice is", (await pageA.getByText("No package prices have been approved.", { exact: false }).isVisible()) && !(await pageA.locator("text=/\\d+\\s?SAR|SAR\\s?\\d/").count()));
    await pageA.goto("/platform/dashboard");
    // PO-02B: the four company tiles show the read model's figures (this database has no companies or
    // customer users, so 0); the four commercial tiles still read "—" — no figure is invented.
    ok(
      "dashboard: company tiles show real figures (0 here), commercial tiles “—” — no invented figure",
      JSON.stringify((await pageA.locator(".platform-stat-value").allInnerTexts()).map((t) => t.trim())) === JSON.stringify(["0", "0", "—", "—", "0", "0", "—", "—"]),
    );
  }

  section("7. Security settings: revoke one, forged requests, sign out others, expiry");
  const ctxC = await newContext({ ip: "198.51.100.12" });
  const ctxE = await newContext({ ip: "198.51.100.15" });
  {
    const pc = await signIn(ctxC, owner, { recovery: owner.codes[1] });
    const pe = await signIn(ctxE, owner, { recovery: owner.codes[2] });
    await pageA.goto("/platform/settings");
    const row = pageA.locator(".platform-session", { hasText: "198.51.100.12" });
    ok("the session list shows the operator's other browsers (by trusted IP, device)", (await row.count()) === 1 && (await row.innerText()).includes("Chrome on Linux"));
    let action: { url: string; headers: Record<string, string>; body: string } | null = null;
    const capture = (r: Request) => {
      if (r.method() === "POST" && r.headers()["next-action"]) action = { url: r.url(), headers: r.headers(), body: r.postData() ?? "" };
    };
    pageA.on("request", capture);
    await row.getByRole("button", { name: /End session/ }).click();
    await pageA.getByText("Session ended.").waitFor({ timeout: 10_000 });
    pageA.off("request", capture);
    ok("'End session' → confirmation toast; the row disappears", (await pageA.locator(".platform-session", { hasText: "198.51.100.12" }).count()) === 0);
    await pc.goto("/platform/settings");
    await pc.waitForURL("**/platform/login?ended=1");
    ok("the revoked browser is sent to sign-in with the 'session ended' notice and its cookie removed", (await appears(pc.getByText("Your session has ended. Please sign in again."))) && !(await platformCookie(ctxC)));
    await shot(pc, "40-session-ended-en-light-1440");

    // Forged revocation of browser E: replay the captured action with E's session id.
    const [eRow] = await db.select({ id: platformSessionsTable.id }).from(platformSessionsTable).where(eq(platformSessionsTable.ipAddress, "198.51.100.15"));
    const captured = action as { url: string; headers: Record<string, string>; body: string } | null;
    ok("a real 'End session' request was captured (positive control material)", !!captured && !!eRow && /[0-9a-f-]{36}/.test(captured.body));
    if (captured && eRow) {
      const body = captured.body.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, eRow.id);
      const base = { "next-action": captured.headers["next-action"], "content-type": captured.headers["content-type"] ?? "text/plain;charset=UTF-8", accept: "text/x-component" };
      const forged = await ctxA.request.post(captured.url, { headers: { ...base, origin: "https://evil.example", "sec-fetch-site": "cross-site" }, data: body, maxRedirects: 0 });
      const stillE1 = await pe.goto("/platform/dashboard").then(() => pe.url().endsWith("/platform/dashboard"));
      ok(`cross-origin replay of the action WITH the operator's cookie → refused (HTTP ${forged.status()}), session untouched`, stillE1);
      const anon = await pwRequest.newContext({ baseURL: A.url, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.66" } });
      const unauth = await anon.post(captured.url, { headers: { ...base, origin: A.url, "sec-fetch-site": "same-origin" }, data: body, maxRedirects: 0 });
      const stillE2 = await pe.goto("/platform/dashboard").then(() => pe.url().endsWith("/platform/dashboard"));
      ok(`same-origin replay WITHOUT a platform cookie → refused (HTTP ${unauth.status()}), session untouched — authorization does not rely on the UI`, stillE2);
      await anon.dispose();
      const control = await ctxA.request.post(captured.url, { headers: { ...base, origin: A.url, "sec-fetch-site": "same-origin" }, data: body, maxRedirects: 0 });
      await pe.goto("/platform/dashboard");
      await pe.waitForURL("**/platform/login**").catch(() => undefined);
      ok(`positive control: the same request, same-origin with the cookie, does revoke E (HTTP ${control.status()})`, pe.url().includes("/platform/login"));
    }

    // Sign out of other sessions (B is still signed in).
    await pageA.goto("/platform/settings");
    await pageA.getByRole("button", { name: "Sign out of other sessions" }).click();
    const dialog = pageA.getByRole("dialog");
    await dialog.waitFor();
    ok("sign-out-others asks for confirmation in a labelled dialog", await appears(dialog.getByText("Sign out of all other sessions?")));
    await shot(pageA, "41-signout-others-dialog-en-light-1440");
    await dialog.getByRole("button", { name: "Sign out of other sessions" }).click();
    await pageA.getByText(/Other sessions signed out: \d/).waitFor({ timeout: 10_000 });
    const pb = await ctxB.newPage();
    await pb.goto("/platform/dashboard");
    await pb.waitForURL("**/platform/login?ended=1");
    ok("browser B is signed out on its next request ('session ended')", !(await platformCookie(ctxB)));
    ok("the operator's own session continues", (await pageA.goto("/platform/dashboard"))?.status() === 200 && pageA.url().endsWith("/platform/dashboard"));

    // Expiry: an idle session and one past its absolute lifetime (timestamps shifted in the disposable DB).
    for (const [label, ip, shift, code] of [["idle 40 min", "198.51.100.13", "40 minutes", owner.codes[3]], ["past 12 h", "198.51.100.14", "12 hours 5 minutes", owner.codes[4]]] as const) {
      const ctx = await newContext({ ip });
      const p = await signIn(ctx, owner, { recovery: code });
      await db.execute(sql`update platform_sessions set created_at = created_at - ${shift}::interval, mfa_verified_at = mfa_verified_at - ${shift}::interval, last_seen_at = last_seen_at - ${shift}::interval, expires_at = expires_at - ${shift}::interval where ip_address = ${ip} and revoked_at is null`);
      await p.goto("/platform/settings");
      await p.waitForURL("**/platform/login?ended=1");
      ok(`${label}: the next page load ends the session, clears the cookie and explains why`, !(await platformCookie(ctx)) && (await appears(p.getByText("Your session has ended. Please sign in again."))));
      await ctx.close();
    }
  }

  section("7b. Audit outage (PO-01B.1): nothing applied silently, explicit emergency containment, honest sign-out");
  {
    // A real audit-write outage: a test-only trigger makes every INSERT into platform_audit_events fail.
    const outage = async (on: boolean) => {
      if (on) {
        await db.execute(sql.raw(`create or replace function po01b1_test_only_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit outage (test only)'; end $$`));
        await db.execute(sql.raw(`create trigger po01b1_test_only_fail_audit before insert on platform_audit_events for each row execute function po01b1_test_only_fail_audit()`));
      } else {
        await db.execute(sql.raw(`drop trigger if exists po01b1_test_only_fail_audit on platform_audit_events`));
        await db.execute(sql.raw(`drop function if exists po01b1_test_only_fail_audit()`));
      }
    };
    // Browsers signed in before the outage (sign-in itself is refused during one). Authenticator
    // codes, not recovery codes, so section 8 still sees the PO-01B state ("5 of 10 remaining").
    const ctxZ = await newContext({ ip: "198.51.100.16" });
    const pz = await signIn(ctxZ, owner);
    const ctxZ2 = await newContext({ ip: "198.51.100.17" });
    const pz2 = await signIn(ctxZ2, owner);
    const ctxO = await newContext({ ip: "198.51.100.18", scale: 2 });
    const po = await signIn(ctxO, owner);
    const ctxO2 = await newContext({ ip: "198.51.100.19", scale: 2 });
    const po2 = await signIn(ctxO2, owner);
    await setPrefs(ctxO2, { locale: "ar" });
    const out0 = A.output().length;
    await outage(true);

    await pageA.goto("/platform/settings");
    await pageA.locator(".platform-session", { hasText: "198.51.100.16" }).getByRole("button", { name: /End session/ }).click();
    const dlg = pageA.getByRole("dialog");
    await dlg.getByText("The audit trail is unavailable").waitFor({ timeout: 10_000 });
    ok("End session during an outage → a dialog says it was NOT applied and offers emergency containment", await appears(dlg.getByText("This change was not applied because it could not be recorded in the audit trail.", { exact: false })));
    ok("…and the session is still live (nothing was applied silently)", (await pz.goto("/platform/dashboard"))?.status() === 200 && pz.url().endsWith("/platform/dashboard"));
    await shot(pageA, "43-audit-outage-dialog-en-light-1440");
    await dlg.getByRole("button", { name: "End without audit record" }).click();
    ok("explicit emergency containment → a warning that the session ended WITHOUT an audit record", await appears(pageA.getByText("Sessions ended without an audit record: 1. A security incident was logged.")));
    await pz.goto("/platform/dashboard");
    await pz.waitForURL("**/platform/login?ended=1");
    ok("…the contained browser is refused on its next request and its cookie cleared", !(await platformCookie(ctxZ)));

    await setPrefs(ctxA, { locale: "ar", theme: "dark" });
    await pageA.goto("/platform/settings");
    await pageA.locator(".platform-session", { hasText: "198.51.100.17" }).getByRole("button", { name: /إنهاء الجلسة/ }).click();
    const dlgAr = pageA.getByRole("dialog");
    await dlgAr.getByText("سجل التدقيق غير متاح").waitFor({ timeout: 10_000 });
    ok("Arabic: the same dialog in native Arabic", await appears(dlgAr.getByText("لم يُطبَّق هذا التغيير", { exact: false })));
    await shot(pageA, "43-audit-outage-dialog-ar-dark-1440");
    await dlgAr.getByRole("button", { name: "إلغاء" }).click();
    ok("Cancel leaves that session live", (await pz2.goto("/platform/dashboard"))?.status() === 200 && pz2.url().endsWith("/platform/dashboard"));
    await setPrefs(ctxA, { locale: "en", theme: "light" });

    await po.goto("/platform/dashboard");
    await po.locator(".topbar-utilities .topbar-profile").click();
    await po.getByRole("menuitem", { name: "Sign out" }).click();
    await po.waitForURL("**/platform/login?ended=unaudited");
    ok("sign-out during an outage → signed out (cookie removed) and the sign-in page says it could not be recorded", !(await platformCookie(ctxO)) && (await appears(po.getByText("You have been signed out, but the sign-out could not be recorded in the audit trail.", { exact: false }))));
    await shot(po, "44-unaudited-signout-en-light-1440");
    await po2.goto("/platform/dashboard");
    await po2.locator(".topbar-utilities .topbar-profile").click();
    await po2.getByRole("menuitem", { name: "تسجيل الخروج" }).click();
    await po2.waitForURL("**/platform/login?ended=unaudited");
    ok("Arabic: the same notice in native Arabic", await appears(po2.getByText("تعذّر تدوين ذلك في سجل التدقيق", { exact: false })));
    await shot(po2, "44-unaudited-signout-ar-light-1440");
    const signedOut = await db.select({ id: platformSessionsTable.id }).from(platformSessionsTable).where(and(inArray(platformSessionsTable.ipAddress, ["198.51.100.18", "198.51.100.19"]), isNull(platformSessionsTable.revokedAt)));
    ok("…both sessions are revoked server-side (a sign-out never leaves a session usable)", signedOut.length === 0);
    const lines = A.output().slice(out0).split("\n").filter((l) => l.startsWith("[platform-security-incident]"));
    ok(`the server logged an incident line for each containment (${lines.filter((l) => l.includes('"type":"unaudited_session_revocation"')).length}) and each refused change`, lines.filter((l) => l.includes('"type":"unaudited_session_revocation"')).length === 3 && lines.some((l) => l.includes('"type":"audit_write_failed"')));

    await outage(false);
    await pageA.goto("/platform/settings");
    await pageA.locator(".platform-session", { hasText: "198.51.100.17" }).getByRole("button", { name: /End session/ }).click();
    await pageA.getByText("Session ended.").waitFor({ timeout: 10_000 });
    const late = await db.select({ id: platformAuditEventsTable.entityId }).from(platformAuditEventsTable).where(eq(platformAuditEventsTable.action, "session.revocation_recorded_late"));
    ok("after recovery, the next audited change records the 3 unaudited revocations late — once each, labelled as such", late.length === 3 && new Set(late.map((r) => r.id)).size === 3);
    for (const c of [ctxZ, ctxZ2, ctxO, ctxO2]) await c.close();
  }

  section("8. Recovery-code regeneration: step-up, failure rotates nothing, codes shown once");
  {
    await pageA.goto("/platform/settings");
    const remaining = async () => (await db.select({ n: sql<number>`jsonb_array_length(mfa_recovery_hashes)::int` }).from(platformAdminsTable).where(eq(platformAdminsTable.id, owner.id)))[0].n;
    const hashes = async () => JSON.stringify((await db.select({ h: platformAdminsTable.mfaRecoveryHashes }).from(platformAdminsTable).where(eq(platformAdminsTable.id, owner.id)))[0].h);
    ok("the card shows the codes left (5 of 10 after five recovery sign-ins)", (await appears(pageA.getByText("5 of 10 remaining"))) && (await remaining()) === 5);
    const before = await hashes();
    await pageA.getByRole("button", { name: "Generate new codes" }).click();
    const dialog = pageA.getByRole("dialog");
    await dialog.waitFor();
    await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await dialog.getByLabel("Verification code", { exact: true }).fill(wrongCodeFor(owner));
    await shot(pageA, "42-regenerate-stepup-en-light-1440");
    await dialog.getByRole("button", { name: "Generate codes" }).click();
    await dialog.locator(".platform-form-error").waitFor();
    ok("wrong authenticator code → error in the dialog; the stored codes are NOT rotated", (await hashes()) === before && (await remaining()) === 5);
    await dialog.getByLabel("Password", { exact: true }).fill("Wrong-Password-00!");
    await dialog.getByLabel("Verification code", { exact: true }).fill(await freshCode(owner));
    await dialog.getByRole("button", { name: "Generate codes" }).click();
    await dialog.locator(".platform-form-error").waitFor();
    ok("wrong password → error; codes NOT rotated", (await hashes()) === before);
    await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await dialog.getByLabel("Verification code", { exact: true }).fill(await freshCode(owner));
    await dialog.getByRole("button", { name: "Generate codes" }).click();
    await dialog.getByText("Save your new recovery codes").waitFor({ timeout: 15_000 });
    const shown = (await dialog.locator(".platform-codes li").allInnerTexts()).map((t) => t.trim());
    secretsSeen.push(...shown);
    ok("password + a fresh code → ten new codes shown once (XXXXX-XXXXX), stored as new hashes", shown.length === 10 && shown.every((c) => /^[0-9A-F]{5}-[0-9A-F]{5}$/.test(c)) && (await hashes()) !== before && (await remaining()) === 10);
    await pageA.keyboard.press("Escape");
    await sleep(600);
    ok("the codes dialog cannot be dismissed by accident (Escape keeps it open)", (await dialog.isVisible()) && (await dialog.locator(".platform-codes li").count()) === 10);
    await dialog.getByRole("button", { name: "I have saved my codes" }).click();
    await dialog.waitFor({ state: "detached" });
    ok("after closing, the codes are gone from the page and the card shows 10 of 10", !(await pageA.locator(".platform-codes").count()) && (await appears(pageA.getByText("10 of 10 remaining"))));
    ok("no code or password was written to browser storage", (await pageA.evaluate(() => localStorage.length + sessionStorage.length)) === 0);
  }

  section("9. Cross-principal cookies in the browser; the cookie-clearing handler");
  {
    const tokenA = (await platformCookie(ctxA))!.value;
    const page = await ctxA.newPage();
    await page.goto("/dashboard");
    ok("platform cookie on a customer route → the customer sign-in (/login), platform cookie untouched", page.url().endsWith("/login") && (await platformCookie(ctxA))?.value === tokenA);
    // The DevTools protocol will not inject Secure __Host- cookies for an http:// origin, so the
    // foreign-cookie cases go to the same real server routes as raw Cookie headers.
    const raw = await pwRequest.newContext({ baseURL: A.url, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.31" } });
    const r1 = await raw.get("/sales/invoices", { maxRedirects: 0, headers: { cookie: `${CCOOKIE}=${tokenA}` } });
    ok("the platform token presented as the CUSTOMER cookie → 307 /login and that cookie cleared", r1.status() === 307 && locationOf(r1).endsWith("/login") && clears(r1, CCOOKIE));
    const customer = await tenantAuth.signSessionToken({ userId: 1, orgId: 1, jti: "fictional-browser" });
    secretsSeen.push(customer);
    const r2 = await raw.get("/platform/dashboard", { maxRedirects: 0, headers: { cookie: `${CCOOKIE}=${customer}` } });
    ok("a valid-signature customer session cookie on /platform → 307 /platform/login, customer cookie untouched", r2.status() === 307 && locationOf(r2).endsWith("/platform/login") && !setCookieOf(r2).includes(CCOOKIE));
    const r3 = await raw.get("/platform/settings", { maxRedirects: 0, headers: { cookie: `${PCOOKIE}=${customer}` } });
    ok("a customer token in the PLATFORM cookie → 307 /platform/login and cleared", r3.status() === 307 && locationOf(r3).endsWith("/platform/login") && clears(r3, PCOOKIE));
    const r4 = await raw.get("/platform/dashboard", { maxRedirects: 0, headers: { cookie: `${PCOOKIE}=${tokenA}; ${CCOOKIE}=${customer}` } });
    ok("both cookies on /platform → decided by the platform cookie alone (200, nothing cleared)", r4.status() === 200 && !setCookieOf(r4).includes(CCOOKIE));
    await raw.dispose();

    const live = await ctxA.request.get("/platform/session-expired", { maxRedirects: 0 });
    ok("session-expired with a LIVE session → back to the dashboard, cookie kept (no loop, no forced logout)", live.status() === 307 && (live.headers()["location"] ?? "").endsWith("/platform/dashboard") && !(live.headers()["set-cookie"] ?? "").includes(PCOOKIE));
    const anon = await pwRequest.newContext({ baseURL: A.url });
    const none = await anon.get("/platform/session-expired", { maxRedirects: 0 });
    ok("session-expired without a cookie → /platform/login?ended=1, nothing to clear", none.status() === 307 && (none.headers()["location"] ?? "").endsWith("/platform/login?ended=1") && !(none.headers()["set-cookie"] ?? ""));
    const bad = await anon.get("/platform/session-expired", { maxRedirects: 0, headers: { cookie: `${PCOOKIE}=garbage` } });
    ok("session-expired with a dead cookie → /platform/login?ended=1 and the cookie cleared (Max-Age=0, Secure, HttpOnly)", bad.status() === 307 && /__Host-elite_erp_platform=;/.test(bad.headers()["set-cookie"] ?? "") && /Max-Age=0/i.test(bad.headers()["set-cookie"] ?? "") && /Secure/i.test(bad.headers()["set-cookie"] ?? "") && /HttpOnly/i.test(bad.headers()["set-cookie"] ?? ""));
    const loop = await anon.get("/platform/login?ended=1", { maxRedirects: 0, headers: { cookie: `${PCOOKIE}=garbage` } });
    ok("the sign-in page renders even with a dead cookie present (no redirect loop)", loop.status() === 200);
    await anon.dispose();
  }

  section("10. Sign-out");
  {
    await pageA.goto("/platform/dashboard");
    await pageA.locator(".topbar-utilities .topbar-profile").click();
    await pageA.getByRole("menuitem", { name: "Sign out" }).click();
    await pageA.waitForURL("**/platform/login");
    ok("account menu → Sign out → the sign-in page; the platform cookie is removed", !(await platformCookie(ctxA)));
    await pageA.goto("/platform/settings");
    ok("…and console pages now redirect to sign-in", pageA.url().endsWith("/platform/login"));
    const [revoked] = await db.select({ reason: platformSessionsTable.revokedReason }).from(platformSessionsTable).where(eq(platformSessionsTable.ipAddress, "198.51.100.10")).orderBy(desc(platformSessionsTable.createdAt)).limit(1);
    ok("the server-side session row is revoked (reason logout)", revoked?.reason === "logout");
  }

  section("11. Throttling in the browser");
  {
    const ctx = await newContext({ ip: "198.51.100.66" });
    const page = await ctx.newPage();
    const messages: string[] = [];
    for (let i = 0; i < 5; i++) {
      await signInCredentials(page, locked.email, "Wrong-Password-00!");
      await formError(page).waitFor();
      messages.push((await formError(page).innerText()).trim());
    }
    ok("five wrong passwords → the same generic message each time", messages.every((m) => m === "The email or password is incorrect."));
    await signInCredentials(page, locked.email, PASSWORD);
    await formError(page).waitFor();
    ok("the sixth attempt, even with the right password → 'Too many attempts'", (await formError(page).innerText()).trim() === "Too many attempts. Please wait and try again later.");
    const other = await newContext({ ip: "198.51.100.67" });
    const p2 = await other.newPage();
    await signInCredentials(p2, owner.email);
    ok("another account from another address is unaffected (reaches the code step)", await appears(p2.getByLabel("Verification code", { exact: true }), 10_000));
  }

  section("12. Feature flag off (server B, same build): every /platform path is a bare 404");
  {
    const anon = await pwRequest.newContext({ baseURL: B.url });
    const paths = ["/platform", "/platform/login", "/platform/recover", "/platform/session-expired", "/platform/dashboard", "/platform/settings"];
    const statuses = await Promise.all(paths.map(async (p) => (await anon.get(p, { maxRedirects: 0 })).status()));
    ok("flag unset → 404 for login, recover, session-expired and every section", statuses.every((s) => s === 404), statuses.join(","));
    const page = await (await newContext({ ip: "198.51.100.70", server: B })).newPage();
    // An empty-body 404 is reported by Chromium as ERR_HTTP_RESPONSE_CODE_FAILURE (its own error page).
    let status = 0;
    let navError = "";
    try {
      status = (await page.goto("/platform/login"))?.status() ?? 0;
    } catch (e) {
      navError = String(e);
    }
    ok("…in the browser too: an empty 404, nothing of the console rendered", (status === 404 || /ERR_HTTP_RESPONSE_CODE_FAILURE/.test(navError)) && !(await page.getByText("Platform Owner").count()));
    ok("the customer sign-in still renders on server B", (await anon.get("/login")).status() === 200);
    await anon.dispose();
  }

  section("13. Nothing secret in server output; audit trail written");
  {
    const out = A.output() + B.output();
    const leaked = secretsSeen.filter((s) => s && s.length >= 6 && out.includes(s));
    ok(`server output contains no password, TOTP secret, recovery code, token or app secret (${secretsSeen.length} values checked)`, leaked.length === 0);
    ok("server output contains no connection string", !/postgres(ql)?:\/\//.test(out));
    const actions = new Set((await db.select({ a: platformAuditEventsTable.action }).from(platformAuditEventsTable)).map((r) => r.a));
    ok("the flows were audited (login, MFA failure and replay, recovery code, revoke, logout-all, logout, idle and absolute expiry, regeneration, throttle)", ["auth.login.succeeded", "auth.mfa.failed", "auth.mfa.replay_rejected", "auth.recovery_code.used", "session.revoked", "session.logout_all", "session.logout", "session.idle_timeout", "session.expired", "session.revocation_recorded_late", "mfa.recovery_codes.regenerated", "auth.login.blocked"].every((a) => actions.has(a)), [...actions].join(" "));
    const rows = await db.select({ reason: platformSessionsTable.revokedReason, n: sql<number>`count(*)::int` }).from(platformSessionsTable).groupBy(platformSessionsTable.revokedReason);
    const by: Record<string, number> = Object.fromEntries(rows.map((r) => [r.reason ?? "live", r.n]));
    ok("every session the suite opened ended for its expected reason — logout 3, logout-all 1, revoked 4, idle 1, absolute 1 — and none is left live", by.live === undefined && by.logout === 3 && by.logout_all === 1 && by.revoked === 4 && by.idle_timeout === 1 && by.expired === 1, JSON.stringify(by));
    const live = await db.select({ n: sql<number>`count(*)::int` }).from(platformSessionsTable).where(isNull(platformSessionsTable.revokedAt));
    ok("no live platform session remains after the suite", live[0].n === 0);
  }
}

let exitCode = 1;
let created = false;
try {
  await createPlatformTestDatabase("po01b_browser", testDbName);
  created = true;
  await main();
  exitCode = summary("verify:platform-browser");
} catch (e) {
  console.error(`verify:platform-browser aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  for (const c of contexts) await c.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  await A?.stop().catch(() => undefined);
  await B?.stop().catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (created && process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") await dropDisposableDatabase(testDbName).catch(() => undefined);
}
void randomBytes;
process.exit(exitCode);
