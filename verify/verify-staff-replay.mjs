/**
 * The real replay. The UI hides the Delete Payment control from Staff, which proves the UI gate but
 * says nothing about the server. This invokes the server ACTION directly — a raw POST carrying the
 * Next-Action id, a genuine Staff session cookie, and no page in between — so whatever refuses is
 * the action's own guard.
 *
 * Action ids come from .next/server/server-reference-manifest.json, which maps each id to the
 * exported function it dispatches to.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const ownerEmail = `rp_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const staffEmail = `rs_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

// --- map exported action name -> Next-Action id ---
const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
const idFor = (name) => {
  for (const [id, entry] of Object.entries(manifest.node)) {
    for (const w of Object.values(entry.workers ?? {})) {
      if (w.exportedName === name) return id;
    }
  }
  return null;
};
const delPaymentId = idFor("deletePaymentAction");
const favoriteId = idFor("toggleFavoriteAction");
check("found the Next-Action id for deletePaymentAction", !!delPaymentId, String(delPaymentId));
check("found the Next-Action id for toggleFavoriteAction (the ungated control)", !!favoriteId, String(favoriteId));

// Refuse to run against a build other than the one on disk — see assert-fresh-build.mjs.
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Replay Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', ownerEmail);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
// Registration requires a country as of FX-1a; the currency follows it.
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });

const org = (await db.query("select org_id from users where email=$1", [ownerEmail])).rows[0].org_id;
const ownerId = (await db.query("select id from users where email=$1", [ownerEmail])).rows[0].id;
const hash = (await db.query("select password_hash from users where email=$1", [ownerEmail])).rows[0].password_hash;
await db.query(`insert into users (org_id,name,email,password_hash,role) values ($1,'Staff',$2,$3,'staff')`, [org, staffEmail, hash]);

const cust = (await db.query("insert into customers (org_id,name) values ($1,'ABC') returning id", [org])).rows[0].id;
const gl = (await db.query(`select id from accounts where org_id=$1 and code='1000'`, [org])).rows[0].id;
const bank = (await db.query(`insert into bank_accounts (org_id,name,gl_account_id,opening_balance) values ($1,'Cash',$2,'0') returning id`, [org, gl])).rows[0].id;
const inv = (await db.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,status,issue_date,subtotal,tax_total,total,paid_amount,created_by_id)
   values ($1,'INV-RP',$2,'partially_paid','2026-01-01','1000','150','1150','400',$3) returning id`, [org, cust, ownerId])).rows[0].id;
const pay = (await db.query(
  `insert into payments (org_id,direction,bank_account_id,amount,payment_date,sales_invoice_id,created_by_id)
   values ($1,'in',$2,'400','2026-01-05',$3,$4) returning id`, [org, bank, inv, ownerId])).rows[0].id;

// --- sign in as STAFF and take the real session cookie ---
await ctx.clearCookies();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.fill('input[name="email"]', staffEmail);
await page.fill('input[name="password"]', pass);
await page.getByRole("button", { name: /sign in|log in|login/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });
const cookies = await ctx.cookies();
const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
check("captured a genuine staff session cookie", /elite_erp_session/.test(cookieHeader));

async function invoke(actionId, args, referer = "/finance/payments") {
  const res = await fetch(`${BASE}${referer}`, {
    method: "POST",
    headers: {
      "Next-Action": actionId,
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: cookieHeader,
    },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  return { status: res.status, body: await res.text() };
}

// --- REPLAY 1: the role-gated action, invoked with no page in between ---
const before = (await db.query(`select count(*)::int n from payments where id=$1`, [pay])).rows[0].n;
const r1 = await invoke(delPaymentId, [pay]);
const after = (await db.query(`select count(*)::int n from payments where id=$1`, [pay])).rows[0].n;
const paidAfter = (await db.query(`select paid_amount from sales_invoices where id=$1`, [inv])).rows[0].paid_amount;

check("the action was reachable (a real invocation, not a 404)", r1.status !== 404, `HTTP ${r1.status}`);
check("staff replaying deletePaymentAction did NOT delete the payment", before === 1 && after === 1, `${before} -> ${after}`);
check("the invoice's paid amount is untouched by the replay", Number(paidAfter) === 400, String(paidAfter));
check("no reversing journal entry was posted",
  (await db.query(`select count(*)::int n from journal_entries where org_id=$1 and source_type='payment' and source_id=$2`, [org, pay])).rows[0].n === 0);
// requireRole redirects, so a refusal shows up as a redirect rather than an error payload.
check("the refusal is a redirect away from the action, not a success",
  /"?\/dashboard"?/.test(r1.body) || r1.status === 303 || r1.status === 307, `HTTP ${r1.status} ${r1.body.slice(0, 80)}`);

// --- CONTROL: an UNGATED action, invoked through the EXACT same protocol ---
// Same JSON-args shape, same headers, same cookie — the only difference is the guard. Without this,
// "nothing happened" could mean the replay mechanism simply does not work.
const favsBefore = (await db.query(`select count(*)::int n from favorites where org_id=$1`, [org])).rows[0].n;
const r2 = await invoke(favoriteId, ["Replay probe", "/sales/invoices"]);
const favsAfter = (await db.query(`select count(*)::int n from favorites where org_id=$1`, [org])).rows[0].n;
check("CONTROL: staff replaying an UNGATED action through the same protocol DOES take effect",
  favsAfter > favsBefore, `${favsBefore} -> ${favsAfter} (HTTP ${r2.status})`);
console.log(`DIAG  the control proves the replay mechanism reaches real server actions; the gated one was refused by its own guard, not by a missing route.`);

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "STAFF REPLAY VERIFICATION PASS" : "STAFF REPLAY VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
