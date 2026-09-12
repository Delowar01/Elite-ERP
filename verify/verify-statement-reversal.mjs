/**
 * F-10 — a customer or vendor statement must RECONCILE TO ITS CONTROL ACCOUNT, and a reversed
 * payment must be visible on it.
 *
 * ## Why this suite exists alongside verify-statements
 *
 * `verify-statements` passes 70/70 with this defect live, and could never have caught it: it builds
 * journal entries with its own `post()` helper and therefore never creates a `payment_reversal`
 * entry at all. A suite that manufactures its own ledger rows can only test the shapes it already
 * knows about. So this one manufactures nothing — it drives the REAL actions:
 *
 *     recordPaymentAction  ->  reversePaymentAction  ->  the real statement EXPORT route
 *
 * over HTTP, with a genuine owner session obtained from the real registration form. The statement
 * is read through `/finance/statements/export`, which calls the same `getStatement` the screen
 * does, so the assertion covers the exported artefact and the screen in one pass — the export was
 * carrying the defect too.
 *
 * Two protocols are needed and they are not interchangeable: `recordPaymentAction` takes FormData
 * and so uses the FORM-POST protocol (a `$ACTION_ID_<id>` body field); `reversePaymentAction` takes
 * a plain number and uses the `Next-Action` header. Sending FormData with the header returns 500
 * and writes nothing.
 *
 * ## The invariant
 *
 * A statement is a view of one control account for one party. Its closing balance is therefore a
 * function of the ledger and nothing else:
 *
 *     statement.closing  ==  SUM(control-account lines for that party, up to `to`)
 *
 * Every assertion below is that identity, computed from the journal rows themselves rather than
 * from anything the statement produced. A statement that drops a line it cannot attribute breaks
 * it by exactly the dropped amount.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { readFile } from "node:fs/promises";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
const email = `stmtrev_${uniq()}@t.dev`;
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
const idFor = (name) => {
  for (const [id, entry] of Object.entries(manifest.node)) {
    for (const w of Object.values(entry.workers ?? {})) if (w.exportedName === name) return id;
  }
  return null;
};
const recordId = idFor("recordPaymentAction");
const reverseId = idFor("reversePaymentAction");
check("found the Next-Action id for recordPaymentAction", !!recordId);
check("found the Next-Action id for reversePaymentAction", !!reverseId);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
await page.fill("#orgName", `StmtRev ${uniq()}`); await page.fill("#name", "SR");
await page.fill("#email", email); await page.fill("#password", pass);
await page.locator("#country").click(); await page.waitForTimeout(300);
await page.keyboard.type("Saudi Arabi"); await page.waitForTimeout(500);
await page.getByRole("button", { name: /^Saudi Arabia ·/ }).first().click(); await page.waitForTimeout(400);
await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 40000 }), page.click('button[type="submit"]')]);
const cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
await browser.close();
check("captured a genuine OWNER session cookie", /elite_erp_session/.test(cookieHeader));

const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;
const uid = (await db.query("select id from users where email=$1", [email])).rows[0].id;
const acct = async (c) => (await db.query("select id from accounts where org_id=$1 and code=$2", [org, c])).rows[0]?.id;
const bank = (await db.query(
  "insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2) returning id", [org, await acct("1000")])).rows[0].id;

// ---- the real actions, over the wire ----
const recordPayment = async ({ direction, sourceType, sourceId, amount, date }) => {
  const fd = new FormData();
  fd.set("direction", direction); fd.set("sourceType", sourceType); fd.set("sourceId", String(sourceId));
  fd.set("bankAccountId", String(bank)); fd.set("amount", String(amount)); fd.set("paymentDate", date);
  fd.set("method", "bank_transfer"); fd.set("reference", `REF-${uniq()}`);
  fd.set(`$ACTION_ID_${recordId}`, "");
  const res = await fetch(`${BASE}/finance/payments`, { method: "POST", headers: { Cookie: cookieHeader }, body: fd, redirect: "manual" });
  return res.status;
};
const reversePayment = async (paymentId) => {
  const res = await fetch(`${BASE}/finance/payments`, {
    method: "POST",
    headers: { "Next-Action": reverseId, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookieHeader },
    body: JSON.stringify([paymentId]), redirect: "manual",
  });
  return res.status;
};
const lastPaymentId = async () => (await db.query("select id from payments where org_id=$1 order by id desc limit 1", [org])).rows[0].id;

/** Post a document's own opening journal entry, the way its issuing action does. */
const postDoc = async (sourceType, sourceId, date, lines) => {
  const je = (await db.query(
    `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
     values ($1,$2,$3,$4,$5,$6) returning id`, [org, date, sourceType, sourceType, sourceId, uid])).rows[0].id;
  for (const [accountId, debit, credit] of lines) {
    await db.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,$3,$4)",
      [je, accountId, debit, credit]);
  }
};

/**
 * The control-account balance for ONE party from the journal alone, in the statement's sign
 * convention (client: debit − credit; vendor: credit − debit). Nothing here reads the statement,
 * which is the point — this is the independent figure it must agree with.
 */
const ledgerBalance = async (kind, partyId, upto) => {
  const code = kind === "client" ? "1100" : "2000";
  const sign = kind === "client" ? "sum(jl.debit)-sum(jl.credit)" : "sum(jl.credit)-sum(jl.debit)";
  const q = kind === "client"
    ? `select coalesce(${sign},0)::float bal from journal_entries je
         join journal_lines jl on jl.journal_entry_id=je.id join accounts a on a.id=jl.account_id
         left join sales_invoices si on je.source_type='sales_invoice' and je.source_id=si.id
         left join payments p on je.source_type in ('payment','payment_reversal') and je.source_id=p.id
         left join sales_invoices si2 on p.sales_invoice_id=si2.id
        where je.org_id=$1 and a.code='${code}' and je.entry_date<=$3
          and coalesce(si.customer_id, si2.customer_id)=$2`
    : `select coalesce(${sign},0)::float bal from journal_entries je
         join journal_lines jl on jl.journal_entry_id=je.id join accounts a on a.id=jl.account_id
         left join purchase_orders po on je.source_type='purchase_order' and je.source_id=po.id
         left join payments p on je.source_type in ('payment','payment_reversal') and je.source_id=p.id
         left join purchase_orders po2 on p.purchase_order_id=po2.id
        where je.org_id=$1 and a.code='${code}' and je.entry_date<=$3
          and coalesce(po.vendor_id, po2.vendor_id)=$2`;
  return (await db.query(q, [org, partyId, upto])).rows[0].bal;
};

/** The statement as the product actually exports it: same getStatement, same filters, real route. */
const exportStatement = async (kind, partyId, from, to) => {
  const res = await fetch(`${BASE}/finance/statements/export?kind=${kind}&party=${partyId}&from=${from}&to=${to}&format=csv`,
    { headers: { Cookie: cookieHeader } });
  const csv = await res.text();
  const rows = csv.split("\n").map((l) => l.split(",").map((c) => c.replace(/^"|"$/g, "").trim()));
  const opening = rows.find((r) => r.includes("Opening balance"));
  const closing = rows.find((r) => r.includes("Closing balance"));
  return {
    status: res.status, csv, rows,
    opening: opening ? Number(opening[opening.length - 1]) : NaN,
    closing: closing ? Number(closing[closing.length - 1]) : NaN,
    reversalRows: rows.filter((r) => r.some((c) => /Reversal/i.test(c))).length,
  };
};

const TODAY = new Date().toISOString().slice(0, 10);
const FROM = "2026-08-01";
const TO = TODAY > "2026-09-30" ? TODAY : "2026-09-30";

// ── A. CLIENT — invoice 1,000, payment 400 in period, reversal ────────────────────────────────
{
  const cust = (await db.query("insert into customers (org_id,name) values ($1,'Rev Client A') returning id", [org])).rows[0].id;
  const inv = (await db.query(
    `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,base_paid_amount,currency,created_by_id)
     values ($1,$2,$3,'2026-07-01','sent','1000.000','0','0','0','SAR',$4) returning id`,
    [org, `RINV-A-${uniq()}`, cust, uid])).rows[0].id;
  await postDoc("sales_invoice", inv, "2026-07-01", [[await acct("1100"), "1000.000", "0"], [await acct("4000"), "0", "1000.000"]]);
  check("A: recordPaymentAction accepted", (await recordPayment({ direction: "in", sourceType: "invoice", sourceId: inv, amount: 400, date: "2026-08-05" })) === 200);
  const pid = await lastPaymentId();
  check("A: reversePaymentAction accepted", (await reversePayment(pid)) === 200);
  check("A: the payment is marked reversed", (await db.query("select reversed_at from payments where id=$1", [pid])).rows[0].reversed_at !== null);
  check("A: a payment_reversal journal entry exists",
    (await db.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='payment_reversal' and source_id=$2", [org, pid])).rows[0].n === 1);

  const st = await exportStatement("client", cust, FROM, TO);
  const led = await ledgerBalance("client", cust, TO);
  check("A: the statement export succeeded", st.status === 200, String(st.status));
  check("A: the ledger says the invoice is fully outstanding again", near(led, 1000), `ledger=${led}`);
  check("A: statement CLOSING reconciles to the control account", near(st.closing, led), `closing=${st.closing} ledger=${led}`);
  check("A: the reversal is VISIBLE on the statement", st.reversalRows >= 1, `reversal rows=${st.reversalRows}`);
}

// ── B. VENDOR — PO 1,000, payment 400 in period, reversal ─────────────────────────────────────
{
  const vend = (await db.query("insert into vendors (org_id,name) values ($1,'Rev Vendor B') returning id", [org])).rows[0].id;
  const po = (await db.query(
    `insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,total,tax_total,paid_amount,base_paid_amount,currency,created_by_id)
     values ($1,$2,$3,'2026-07-01','received','1000.000','0','0','0','SAR',$4) returning id`,
    [org, `RPO-B-${uniq()}`, vend, uid])).rows[0].id;
  await postDoc("purchase_order", po, "2026-07-01", [[await acct("1200"), "1000.000", "0"], [await acct("2000"), "0", "1000.000"]]);
  check("B: recordPaymentAction accepted", (await recordPayment({ direction: "out", sourceType: "po", sourceId: po, amount: 400, date: "2026-08-05" })) === 200);
  const pid = await lastPaymentId();
  check("B: reversePaymentAction accepted", (await reversePayment(pid)) === 200);

  const st = await exportStatement("vendor", vend, FROM, TO);
  const led = await ledgerBalance("vendor", vend, TO);
  check("B: the statement export succeeded", st.status === 200, String(st.status));
  check("B: the ledger says the PO is fully payable again", near(led, 1000), `ledger=${led}`);
  check("B: statement CLOSING reconciles to the control account", near(st.closing, led), `closing=${st.closing} ledger=${led}`);
  check("B: the reversal is VISIBLE on the statement", st.reversalRows >= 1, `reversal rows=${st.reversalRows}`);
}

// ── C. CROSS-PERIOD — payment BEFORE the period, reversal INSIDE it ───────────────────────────
// The worst reproduced case: the payment lands in `opening` and its reversal was dropped from the
// period, so the customer received a statement with NO rows and a wrong opening balance.
{
  const cust = (await db.query("insert into customers (org_id,name) values ($1,'Rev Client C') returning id", [org])).rows[0].id;
  const inv = (await db.query(
    `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,base_paid_amount,currency,created_by_id)
     values ($1,$2,$3,'2026-06-01','sent','1000.000','0','0','0','SAR',$4) returning id`,
    [org, `RINV-C-${uniq()}`, cust, uid])).rows[0].id;
  await postDoc("sales_invoice", inv, "2026-06-01", [[await acct("1100"), "1000.000", "0"], [await acct("4000"), "0", "1000.000"]]);
  check("C: recordPaymentAction accepted (dated BEFORE the period)",
    (await recordPayment({ direction: "in", sourceType: "invoice", sourceId: inv, amount: 400, date: "2026-06-15" })) === 200);
  const pid = await lastPaymentId();
  check("C: reversePaymentAction accepted (posts INSIDE the period)", (await reversePayment(pid)) === 200);
  const revDate = (await db.query(
    "select entry_date::text d from journal_entries where org_id=$1 and source_type='payment_reversal' and source_id=$2", [org, pid])).rows[0].d;
  check("C: the reversal really does post inside the selected period", revDate >= FROM && revDate <= TO, `reversal dated ${revDate}, period ${FROM}..${TO}`);

  const st = await exportStatement("client", cust, FROM, TO);
  const ledOpen = await ledgerBalance("client", cust, "2026-07-31");
  const ledClose = await ledgerBalance("client", cust, TO);
  check("C: the statement export succeeded", st.status === 200, String(st.status));
  check("C: OPENING reconciles to the ledger before the period", near(st.opening, ledOpen), `opening=${st.opening} ledger@2026-07-31=${ledOpen}`);
  check("C: CLOSING reconciles to the control account", near(st.closing, ledClose), `closing=${st.closing} ledger=${ledClose}`);
  check("C: the reversal is VISIBLE inside the period", st.reversalRows >= 1, `reversal rows=${st.reversalRows}`);
  check("C: the statement is not empty (the reproduced symptom was zero rows)",
    st.rows.filter((r) => r[0] && /^\d{4}-\d{2}-\d{2}$/.test(r[0])).length >= 1);
}

await db.end();
const failed = results.filter(([ok]) => !ok);
for (const [ok, name, extra] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  << ${extra}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} checks`);
process.exit(failed.length ? 1 : 0);
