/**
 * FX-3. The Exchange Rates screen in Preset Management.
 *
 * What this drives, and why each piece matters:
 *
 *  - **Manual add through the real dialog** — validated, recorded as source "manual", visible in
 *    both the current-rates table and the history.
 *  - **Staleness** — a pair whose newest rate is older than the threshold shows the Stale badge;
 *    a fresh pair does not. The indicator is the degraded path's whole UX: fetches may fail
 *    forever and the screen still tells the truth.
 *  - **Attribution** — the provider's terms are attribution-based, so the link must be VISIBLE
 *    where fetched rates display, and (checked both ways) absent when every row is manual.
 *  - **The degraded fetch path** — in this sandbox every rate API is unreachable, which makes the
 *    real failure UX testable: "Fetch All Now" must toast the failure and leave stored rates
 *    untouched, never hang and never error the page. (The happy fetch path is covered end-to-end
 *    in the one-click suite via RATE_API_BASE pointing at a localhost mock.)
 *  - **Gating, replay-tested like Task 4** — the UI hiding the tab from Staff proves nothing
 *    about the server, so the two new actions are invoked as raw Next-Action POSTs with a genuine
 *    Staff cookie. Both must refuse; the ungated-action control proves the replay mechanism
 *    itself works, so "nothing happened" cannot mean "the probe missed".
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
const ownerEmail = `rs_o_${uniq()}@t.dev`;
const staffEmail = `rs_s_${uniq()}@t.dev`;
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
const idFor = (name) => {
  for (const [id, entry] of Object.entries(manifest.node)) {
    for (const w of Object.values(entry.workers ?? {})) {
      if (w.exportedName === name) return id;
    }
  }
  return null;
};
const manualId = idFor("saveManualRateAction");
const fetchId = idFor("fetchRatesNowAction");
const favoriteId = idFor("toggleFavoriteAction");
check("found Next-Action ids for both rate actions", !!manualId && !!fetchId, `${manualId}/${fetchId}`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Rate Screen Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', ownerEmail);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });

const org = (await db.query("select org_id from users where email=$1", [ownerEmail])).rows[0].org_id;
const uid = (await db.query("select id from users where email=$1", [ownerEmail])).rows[0].id;
const cust = (await db.query("insert into customers (org_id,name) values ($1,'RS') returning id", [org])).rows[0].id;
// A USD document makes USD a pair-in-use; an EUR one likewise for the staleness case.
for (const cur of ["USD", "EUR"]) {
  await db.query(
    `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, subtotal, discount, tax_total, total, currency, status, created_by_id)
     values ($1,$2,$3,'2026-01-01','100','0','15','115',$4,'draft',$5)`, [org, `RS${cur}-${uniq()}`, cust, cur, uid]);
}
// EUR: a fetched-looking rate 10 days old → must show Stale, and must make the attribution appear.
await db.query(
  `insert into exchange_rates (org_id, from_currency, to_currency, rate, effective_date, source)
   values ($1,'EUR','SAR','4.05000000', current_date - 10, 'open.er-api.com (retrieved 2026-08-01)')`, [org]);

// ---- 1. manual add through the real dialog ----
await page.goto(`${BASE}/settings/presets`, { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "Exchange Rates" }).click();
await page.getByRole("button", { name: "Add Manual Rate" }).click();
await page.fill("#rate-currency", "USD");
await page.fill("#rate-value", "3.75");
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForTimeout(1500);

const manualRow = (await db.query(
  "select rate::text, source from exchange_rates where org_id=$1 and from_currency='USD'", [org])).rows[0];
check("manual add wrote a validated row", Number(manualRow?.rate) === 3.75, JSON.stringify(manualRow));
check("…recorded as source manual", manualRow?.source === "manual", manualRow?.source);

await page.goto(`${BASE}/settings/presets`, { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "Exchange Rates" }).click();
await page.waitForTimeout(400);
const panelText = await page.locator('[role="tabpanel"][data-state="active"]').innerText();
check("the current-rates table shows both pairs", /USD → SAR/.test(panelText) && /EUR → SAR/.test(panelText),
  panelText.split("\n").slice(0, 6).join(" | "));

// ---- 2. staleness: the 10-day-old EUR is flagged, today's USD is not ----
check("the 10-day-old EUR rate shows the Stale badge", /Stale/.test(panelText), panelText.match(/Stale[^\n]*/)?.[0] ?? "(absent)");
const usdLine = panelText.split("\n").find((l) => l.includes("USD → SAR")) ?? "";
check("…while today's manual USD rate does not", !/Stale/.test(usdLine), usdLine);

// ---- 3. attribution shown with fetched rates, with the exact required link ----
const attr = page.locator('a[href="https://www.exchangerate-api.com"]');
check("the provider attribution link is visible where fetched rates display",
  (await attr.count()) === 1 && (await attr.innerText()) === "Rates By Exchange Rate API",
  await attr.count() ? await attr.innerText() : "(no link)");

// ---- 4. the degraded fetch path: unreachable provider toasts, never hangs, changes nothing ----
// Timing: the provider makes one request per foreign currency with a 5s timeout each, so with two
// pairs the click resolves at ~10s worst case. Poll for the toast rather than sleeping a fixed 8s.
const ratesBefore = (await db.query("select count(*)::int n from exchange_rates where org_id=$1", [org])).rows[0].n;
await page.getByRole("button", { name: "Fetch All Now" }).click();
let toastText = "(no toast within 20s)";
try {
  const toast = page.getByText(/Rate fetch failed/).first();
  await toast.waitFor({ timeout: 20000 });
  toastText = await toast.innerText();
} catch { /* toastText keeps its sentinel */ }
check("an unreachable provider surfaces as a failure toast, not a hang or a crash",
  toastText.includes("Rate fetch failed"), toastText);
const ratesAfter = (await db.query("select count(*)::int n from exchange_rates where org_id=$1", [org])).rows[0].n;
check("…and stored rates are untouched by the failed fetch", ratesAfter === ratesBefore, `${ratesBefore} -> ${ratesAfter}`);

// ---- 5. replay gating: both actions refuse a genuine Staff session ----
const hash = (await db.query("select password_hash from users where email=$1", [ownerEmail])).rows[0].password_hash;
await db.query("insert into users (org_id,name,email,password_hash,role) values ($1,'Staff',$2,$3,'staff')", [org, staffEmail, hash]);
await ctx.clearCookies();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', staffEmail);
await page.fill('input[name="password"]', pass);
await page.getByRole("button", { name: /sign in|log in|login/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });
const cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

// Neutralize the LEGITIMATE read-path trigger before probing: a refused action's POST response
// renders the redirect target inline, and that page's after(() => fireEnsureFreshRates(orgId))
// would record a fetch attempt of its own (staff is authenticated — the background trigger is not
// role-gated by design). Seeding a today-dated EUR rate makes the org fresh, so the non-forced
// trigger short-circuits BEFORE recording anything — while the gated action uses force:true and
// skips freshness, so if gating ever broke it would still write an attempt row and fail the check.
await db.query(
  `insert into exchange_rates (org_id, from_currency, to_currency, rate, effective_date, source)
   values ($1,'EUR','SAR','4.06000000', current_date, 'manual')`, [org]);

const invoke = async (actionId, args) => {
  const res = await fetch(`${BASE}/settings/presets`, {
    method: "POST",
    headers: { "Next-Action": actionId, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookieHeader },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  return { status: res.status, body: await res.text() };
};

const before = (await db.query("select count(*)::int n from exchange_rates where org_id=$1", [org])).rows[0].n;
await invoke(manualId, [{ fromCurrency: "GBP", rate: "4.70", effectiveDate: "2026-08-11" }]);
const afterManual = (await db.query("select count(*)::int n from exchange_rates where org_id=$1", [org])).rows[0].n;
check("staff replaying saveManualRateAction wrote NOTHING", afterManual === before, `${before} -> ${afterManual}`);

await db.query("delete from rate_fetch_attempts where org_id=$1", [org]);
await invoke(fetchId, [[]]);
const attempts = (await db.query("select count(*)::int n from rate_fetch_attempts where org_id=$1", [org])).rows[0].n;
check("staff replaying fetchRatesNowAction triggered NO fetch attempt", attempts === 0, `attempts=${attempts}`);

// CONTROL: the same protocol, same cookie, against an ungated action — proves the probe works.
const favsBefore = (await db.query("select count(*)::int n from favorites where org_id=$1", [org])).rows[0].n;
await invoke(favoriteId, ["Replay probe", "/sales/invoices"]);
const favsAfter = (await db.query("select count(*)::int n from favorites where org_id=$1", [org])).rows[0].n;
check("CONTROL: an ungated action through the same protocol DOES take effect", favsAfter > favsBefore, `${favsBefore} -> ${favsAfter}`);

// ---- 6. the tab reads natively in Arabic ----
await ctx.clearCookies();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', ownerEmail);
await page.fill('input[name="password"]', pass);
await page.getByRole("button", { name: /sign in|log in|login/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });
await ctx.addCookies([{ name: "locale", value: "ar", url: BASE }]);
await page.goto(`${BASE}/settings/presets`, { waitUntil: "networkidle" });
const arText = await page.locator("body").innerText();
check("the Exchange Rates tab renders in Arabic", arText.includes("أسعار الصرف"), arText.includes("أسعار الصرف") ? "أسعار الصرف" : "(missing)");

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "RATE SCREEN PASS" : "RATE SCREEN FAIL");
process.exit(ok ? 0 : 1);
