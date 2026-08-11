/**
 * FX-1b. The base currency locks the moment anything POSTS to the ledger.
 *
 * The lock signal is a journal entry — not a stored base amount, not a document. So:
 *
 *  - **Drafts alone never lock.** An org with draft documents and nothing posted can still fix a
 *    wrongly chosen base currency, through the real Business Settings form.
 *  - **One posted entry locks it for good** — and the refusal is the SERVER's, proven the Task 4
 *    way: a raw action POST with a genuine owner cookie and no page in between. The select being
 *    disabled in the UI proves nothing; this proves the boundary. The CONTROL is the SAME action
 *    with the currency unchanged: every other field saves normally, so "nothing happened" cannot
 *    mean "the probe missed".
 *  - **The UI explains, it doesn't just grey out** — the reason with the correct count.
 *  - **Country stays editable** on a locked org (it drives the tax profile, not the ledger).
 *  - **FX-1a interaction**: the never-asked banner requires "nothing posted", so it must be gone
 *    once the lock engages — asserted on a legacy-shaped org before and after its first entry.
 *    (Dismissal stamps baseCurrencyConfirmedAt, which the lock never reads — the locked-org
 *    refusals above all run on an org whose confirmedAt is already stamped, proving independence.)
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
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
const actionId = idFor("updateBusinessDetailsAction");
check("found the Next-Action id for updateBusinessDetailsAction", !!actionId, String(actionId));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();
const email = `cl_${uniq()}@t.dev`;

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Currency Lock Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });
const u = (await db.query("select id, org_id from users where email=$1", [email])).rows[0];
const org = u.org_id;
const cust = (await db.query("insert into customers (org_id,name) values ($1,'CL') returning id", [org])).rows[0].id;

// ---- 1. drafts alone never lock: fifteen drafts, currency still changeable through the real form ----
for (let i = 0; i < 15; i++) {
  await db.query(
    `insert into quotations (org_id, quotation_number, customer_id, issue_date, status, subtotal, tax_total, total, created_by_id)
     values ($1,$2,$3,current_date,'draft','100','0','100',$4)`, [org, `CLQ-${uniq()}`, cust, u.id]);
}
await page.goto(`${BASE}/settings/organization?tab=business-details`, { waitUntil: "networkidle" });
check("with only drafts, the currency select is enabled and unexplained",
  !(await page.locator("#org-currency").isDisabled()) && (await page.getByTestId("currency-locked").count()) === 0);
await page.locator("#org-currency").click();
await page.waitForTimeout(200);
await page.getByRole("option", { name: /— USD/ }).first().click();
await page.getByRole("button", { name: /^Save changes$/ }).click();
await page.getByText("Saved").first().waitFor({ timeout: 15000 });
check("an org with 15 drafts and nothing posted CHANGED its base currency (SAR → USD)",
  (await db.query("select currency from orgs where id=$1", [org])).rows[0].currency === "USD");

// ---- 2. one posted journal entry locks it ----
const [entry] = (await db.query(
  `insert into journal_entries (org_id, entry_date, memo, source_type, created_by_id)
   values ($1,current_date,'CL manual','manual',$2) returning id`, [org, u.id])).rows;
const accts = (await db.query("select id from accounts where org_id=$1 order by code limit 2", [org])).rows;
await db.query(
  `insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,'100','0'), ($1,$3,'0','100')`,
  [entry.id, accts[0].id, accts[1].id]);

await page.goto(`${BASE}/settings/organization?tab=business-details`, { waitUntil: "networkidle" });
check("the currency select is disabled once an entry has posted", await page.locator("#org-currency").isDisabled());
const note = page.getByTestId("currency-locked");
check("…and the UI EXPLAINS, naming the correct count (1)",
  (await note.count()) === 1 && /1\s+posted transactions/.test((await note.innerText()).replace(/\s+/g, " ")),
  await note.innerText().catch(() => "(absent)"));
check("the country select stays editable on a locked org", (await page.locator("#org-country").getAttribute("aria-disabled")) !== "true");

// ---- 3. the refusal is the SERVER's: raw action replay with a genuine owner cookie ----
const cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
// A FormData-taking action replays through the progressive-enhancement protocol: a multipart POST
// to the page whose body carries `$ACTION_ID_<id>` — the exact request a no-JS <form> submit makes,
// so no page script is involved at all. (The JSON `Next-Action` protocol used by the other replay
// suites is for plain-argument actions.)
const invoke = async (fields) => {
  const fd = new FormData();
  fd.set(`$ACTION_ID_${actionId}`, "");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const res = await fetch(`${BASE}/settings/organization?tab=business-details`, {
    method: "POST",
    headers: { Cookie: cookieHeader },
    body: fd,
    redirect: "manual",
  });
  return { status: res.status, body: await res.text() };
};
const base = { name: "Currency Lock Co", industry: "", address: "", phone: "", taxId: "", vatNumber: "",
  country: "Saudi Arabia", defaultLanguage: "en", customTaxName: "", customTaxNumberLabel: "", customRegistrationLabel: "" };

const r1 = await invoke({ ...base, name: "Sneaky Rename", currency: "EUR" });
const after1 = (await db.query("select currency, name from orgs where id=$1", [org])).rows[0];
check("REPLAY: a changed currency is REFUSED by the server with no page in between — currency untouched",
  after1.currency === "USD", `currency=${after1.currency}`);
check("…the refused submit saved NOTHING else either (whole-submit refusal, not a silent partial save)",
  after1.name === "Currency Lock Co", after1.name);
// The progressive-enhancement POST answers with the re-rendered page; React interleaves
// `<!-- -->` between text nodes, so strip those before matching the message.
const r1Text = r1.body.replace(/<!-- -->/g, "").replace(/\s+/g, " ");
check("…and the server's error names the count", /Base currency cannot be changed: this organization has 1 posted transactions\./.test(r1Text),
  r1Text.match(/Base currency[^<]*/)?.[0] ?? "(error text not found in response)");

// CONTROL: the SAME action, same cookie, same protocol — currency unchanged, another field edited.
const r2 = await invoke({ ...base, name: "Renamed After Lock", currency: "USD", phone: "0501111111" });
const after2 = (await db.query("select currency, name, phone from orgs where id=$1", [org])).rows[0];
check("CONTROL: the same action with the currency UNCHANGED saves other fields normally",
  after2.name === "Renamed After Lock" && after2.phone === "0501111111" && after2.currency === "USD",
  JSON.stringify(after2));
check("(the control also proves the replay protocol itself works)", r2.status < 500, String(r2.status));

// ---- 4. FX-1a interaction: the never-asked banner dies when the lock engages ----
const hash = (await db.query("select password_hash from users where email=$1", [email])).rows[0].password_hash;
const legacy = (await db.query(
  "insert into orgs (name, currency) values ($1,'SAR') returning id", [`cl_legacy_${uniq()}`])).rows[0].id;
const legacyEmail = `cl_l_${uniq()}@t.dev`;
await db.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'Legacy Owner',$2,$3,'owner')",
  [legacy, legacyEmail, hash]);
// Legacy orgs miss per-org seeds; the notice needs none, but the dashboard render must not 500.
await ctx.clearCookies();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', legacyEmail);
await page.fill('input[name="password"]', pass);
await page.getByRole("button", { name: /sign in|log in|login/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });
await page.waitForLoadState("networkidle");
await page.waitForTimeout(800);
check("a never-asked org with NOTHING posted sees the FX-1a confirmation banner",
  (await page.getByText("Check your base currency").count()) === 1,
  (await page.locator("body").innerText().catch(() => "(no body)")).replace(/\s+/g, " ").slice(0, 160));

const legacyUid = (await db.query("select id from users where email=$1", [legacyEmail])).rows[0].id;
const [lEntry] = (await db.query(
  `insert into journal_entries (org_id, entry_date, memo, source_type, created_by_id)
   values ($1,current_date,'legacy first posting','manual',$2) returning id`, [legacy, legacyUid])).rows;
const lAcct = (await db.query("insert into accounts (org_id, code, name, type, normal_balance) values ($1,'1000','Cash','asset','debit'),($1,'3000','Equity','equity','credit') returning id", [legacy])).rows;
await db.query(
  `insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,'50','0'), ($1,$3,'0','50')`,
  [lEntry.id, lAcct[0].id, lAcct[1].id]);
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
check("…and the banner is GONE once the lock condition exists, even though the org was never asked",
  (await page.getByText("Check your base currency").count()) === 0);

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "CURRENCY LOCK PASS" : "CURRENCY LOCK FAIL");
process.exit(ok ? 0 : 1);
