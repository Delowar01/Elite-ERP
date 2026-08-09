/**
 * FX-1a, registration half. Needs a production build on localhost:3000 (`npm run build && npm start`).
 *
 * This lives in the browser tier rather than in `verify-registration-currency.mts` for a concrete
 * reason: `registerAction` imports `next/navigation`, which pulls React context that does not exist
 * under `--conditions=react-server` in plain Node. Importing it there would require mocking the
 * import away, leaving a test that no longer touches the path it claims to cover. Driving the real
 * form in a real browser exercises more, not less — the client-side "country picks the currency"
 * behaviour is only reachable this way at all.
 *
 * The assertion this suite exists for: **an org registered through the new flow never sees the
 * base-currency notice, not even before it posts anything.** That is the whole point of stamping
 * `baseCurrencyConfirmedAt` at registration, and it is the case most likely to break if the notice
 * condition is ever rewritten in terms of "has this org posted yet" — which is true of a brand-new
 * org too. It is paired with a control that manually clears the stamp on the same org and shows the
 * notice appearing, so "not shown" cannot be a dashboard that failed to render.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { readFileSync } from "node:fs";

process.env.DATABASE_URL ||= readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim();

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const results = [];
const check = (n, c, x = "") => results.push([c, n, x]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();

const uniq = () => Math.random().toString(36).slice(2, 8);

/** Fills the register form, picking a country and letting the currency follow, and submits. */
async function register(orgName, email, countryName, overrideCurrency) {
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.fill('input[name="orgName"]', orgName);
  await page.fill('input[name="name"]', "Owner");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', pass);

  // Country is a SearchableSelect: a trigger, an auto-focused filter input, and plain <button>
  // rows rendering "{name} · {code}" — not role="option", so match the button's accessible name.
  await page.locator("#country").click();
  await page.waitForTimeout(300);
  await page.keyboard.type(countryName.slice(0, 12));
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: new RegExp(`^${countryName} ·`) }).first().click();
  await page.waitForTimeout(400);

  const currencyAfterCountry = (await page.locator("#currency").innerText()).trim();

  if (overrideCurrency) {
    await page.locator("#currency").click();
    await page.waitForTimeout(300);
    await page.getByRole("option", { name: new RegExp(`\\b${overrideCurrency}\\b`) }).first().click();
    await page.waitForTimeout(300);
  }

  await page.getByRole("button", { name: /create account/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 45000 });
  return currencyAfterCountry;
}

// ---------------- 1. the country picks the currency, in the browser ----------------
const aeEmail = `fxreg_${uniq()}@t.dev`;
const aeShown = await register(`FXReg UAE ${uniq()}`, aeEmail, "United Arab Emirates");
check("choosing the UAE fills the currency field with AED", /AED/.test(aeShown), aeShown);

const aeOrg = (await db.query("select org_id from users where email=$1", [aeEmail])).rows[0].org_id;
const aeRow = (await db.query(
  "select currency, country, base_currency_confirmed_at from orgs where id=$1", [aeOrg])).rows[0];
check("the chosen currency is stored, not the SAR column default", aeRow.currency === "AED", aeRow.currency);
check("the country is stored as its NAME, matching what getProfileByCountryName reads",
  aeRow.country === "United Arab Emirates", String(aeRow.country));
check("registration stamps baseCurrencyConfirmedAt", aeRow.base_currency_confirmed_at !== null);

const aePreset = (await db.query(
  "select name, rate_percent from tax_presets where org_id=$1 and name like 'Standard%'", [aeOrg])).rows[0];
check("registration seeded the UAE's 5% rate, not the old hardcoded 15%",
  Number(aePreset?.rate_percent) === 5, `${aePreset?.name} ${aePreset?.rate_percent}`);

// ---------------- 2. THE CASE THIS SUITE EXISTS FOR ----------------
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const noticeCount = await page.locator("[data-base-currency-notice]").count();
check("A NEWLY REGISTERED ORG NEVER SEES THE NOTICE, even before it posts anything", noticeCount === 0, `found=${noticeCount}`);

const entries = (await db.query("select count(*)::int n from journal_entries where org_id=$1", [aeOrg])).rows[0].n;
check("CONTROL: …and it genuinely has posted nothing, so the absence is the stamp, not the posting rule",
  entries === 0, `entries=${entries}`);

const dashText = await page.locator("main").innerText();
check("CONTROL: the dashboard really rendered (the absence is not a blank page)",
  dashText.length > 200, `${dashText.length} chars`);

// Same org, one condition changed: clear the stamp, as a pre-existing org would have it.
await db.query("update orgs set base_currency_confirmed_at = null where id=$1", [aeOrg]);
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
check("CONTROL: clearing the stamp on the SAME org makes the notice appear",
  (await page.locator("[data-base-currency-notice]").count()) === 1);
const noticeText = await page.locator("[data-base-currency-notice]").innerText();
check("the notice names the org's actual currency", noticeText.includes("AED"), noticeText.split("\n")[1]?.slice(0, 80) ?? "");
check("the notice states that the currency locks on the first transaction",
  /cannot be changed/i.test(noticeText));

// ---------------- 3. dismissing is permanent ----------------
await page.getByRole("button", { name: /AED is correct/i }).first().click();
await page.waitForTimeout(1200);
check("dismissing hides the notice immediately", (await page.locator("[data-base-currency-notice]").count()) === 0);
const stamped = (await db.query("select base_currency_confirmed_at from orgs where id=$1", [aeOrg])).rows[0];
check("dismissing stamps the org row, so it is not just client state", stamped.base_currency_confirmed_at !== null);
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
check("the notice does not come back on reload", (await page.locator("[data-base-currency-notice]").count()) === 0);

// ---------------- 4. registration refuses incomplete input ----------------
await ctx.clearCookies();
await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
await page.fill('input[name="orgName"]', `FXReg Bad ${uniq()}`);
await page.fill('input[name="name"]', "Owner");
const badEmail = `fxreg_${uniq()}@t.dev`;
await page.fill('input[name="email"]', badEmail);
await page.fill('input[name="password"]', pass);
// No country chosen at all.
await page.getByRole("button", { name: /create account/i }).first().click();
await page.waitForTimeout(1500);
check("registering without a country does not create an org",
  ((await db.query("select count(*)::int n from users where email=$1", [badEmail])).rows[0].n) === 0);
check("…and the user is still on the register page", /\/register/.test(page.url()), page.url());

// CONTROL: the same form with a country completes, so the refusal above is the new validation
// and not a form that stopped submitting.
const okEmail = `fxreg_${uniq()}@t.dev`;
await register(`FXReg SA ${uniq()}`, okEmail, "Saudi Arabia");
check("CONTROL: the same form with a country chosen does create the org",
  ((await db.query("select count(*)::int n from users where email=$1", [okEmail])).rows[0].n) === 1);
const saOrg = (await db.query("select org_id from users where email=$1", [okEmail])).rows[0].org_id;
const saPreset = (await db.query(
  "select rate_percent from tax_presets where org_id=$1 and name like 'Standard%'", [saOrg])).rows[0];
check("a Saudi org still seeds 15%", Number(saPreset?.rate_percent) === 15, String(saPreset?.rate_percent));

// ---------------- 5. Business Settings shows an empty country for an org that has none ----------------
await db.query("update orgs set country = null where id=$1", [saOrg]);
await page.goto(`${BASE}/settings/organization`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const settingsText = await page.locator("main").innerText();
check("an org with no stored country is not shown 'Saudi Arabia'", !/Saudi Arabia/.test(settingsText),
  settingsText.match(/[^\n]*Saudi Arabia[^\n]*/)?.[0]?.slice(0, 60) ?? "");
check("CONTROL: the Business Details panel really rendered", /Business Details/i.test(settingsText));

// ---------------- cleanup ----------------
// The orgs this suite registers are deliberately NOT deleted, and cannot be. Registration writes an
// immutable audit row, and `audit_logs` carries a BEFORE DELETE OR UPDATE trigger that raises — so
// deleting the org fails when the FK tries to null out `audit_logs.org_id`. That is the audit log
// working as designed, not a defect to route around, and it is why every browser-tier suite in this
// folder leaves its orgs behind. Anyone counting orgs in a development database is counting harness
// output as well as users; the `FXReg ` prefix is here so those rows are at least identifiable.
await db.end();
await browser.close();

let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "REGISTRATION CURRENCY UI PASS" : "REGISTRATION CURRENCY UI FAIL");
process.exit(ok ? 0 : 1);
