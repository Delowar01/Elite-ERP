// Run via `npm run verify:<name>`. The script supplies two flags this file cannot supply for
// itself, both for the same reason: ESM evaluates a module's dependencies before any of its own
// statements run, so nothing written here happens early enough to affect its own imports.
//
//   --conditions=react-server  makes `import "server-only"` resolve to the empty module the
//     package ships for the server condition, so the real production code is imported with
//     nothing intercepted. A createRequire cache stub used to sit here instead and never ran.
//
//   --env-file-if-exists=.env  loads DATABASE_URL before the first import. A
//     `process.env.DATABASE_URL ||= readFileSync(".env")` line used to sit here and never ran
//     either, so the suite only worked when the variable happened to be exported in the shell.

import { Pool } from "pg";
import { getStatement, listStatementParties, presetRange, readFilters, statementFilename } from "../src/lib/statements";
import { toCsv, toExcelHtml, toPdf, type ExportColumn, type ExportMeta } from "../src/lib/report-export";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

// ---------- fixtures: a real org with a real chart of accounts ----------
const org = (await pool.query("insert into orgs (name) values ($1) returning id", [`Stmt ${uniq()}`])).rows[0].id as number;
const org2 = (await pool.query("insert into orgs (name) values ($1) returning id", [`Other ${uniq()}`])).rows[0].id as number;
const user = (await pool.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'S','s_" + uniq() + "@t.dev','x','owner') returning id", [org],
)).rows[0].id as number;

async function seedAccounts(o: number) {
  for (const [code, name, type, nb] of [
    ["1000", "Cash", "asset", "debit"], ["1100", "Accounts Receivable", "asset", "debit"],
    ["2000", "Accounts Payable", "liability", "credit"], ["4000", "Sales Revenue", "revenue", "credit"],
    ["1200", "Inventory", "asset", "debit"],
  ] as const) {
    await pool.query(
      "insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,true) on conflict do nothing",
      [o, code, name, type, nb],
    );
  }
  const rows = (await pool.query("select id, code from accounts where org_id=$1", [o])).rows;
  return new Map<string, number>(rows.map((r) => [r.code as string, r.id as number]));
}
const acc = await seedAccounts(org);
const acc2 = await seedAccounts(org2);

const bank = (await pool.query(
  "insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Main Bank',$2) returning id",
  [org, acc.get("1000")])).rows[0].id as number;
const cust = (await pool.query("insert into customers (org_id,name,email,vat_number) values ($1,'ABC Trading','ab@x.test','300111') returning id", [org])).rows[0].id as number;
const cust2 = (await pool.query("insert into customers (org_id,name) values ($1,'Zeta Ltd') returning id", [org])).rows[0].id as number;
const vend = (await pool.query("insert into vendors (org_id,name,email) values ($1,'XYZ Supplies','xy@x.test') returning id", [org])).rows[0].id as number;
const foreignCust = (await pool.query("insert into customers (org_id,name) values ($1,'Foreign Co') returning id", [org2])).rows[0].id as number;

/** Post a balanced journal entry, mirroring how the app's own actions post. */
async function post(o: number, date: string, memo: string, sourceType: string, sourceId: number | null, lines: [number, number, number][]) {
  const je = (await pool.query(
    "insert into journal_entries (org_id, entry_date, memo, source_type, source_id, created_by_id) values ($1,$2,$3,$4,$5,$6) returning id",
    [o, date, memo, sourceType, sourceId, user],
  )).rows[0].id;
  for (const [accountId, debit, credit] of lines) {
    await pool.query("insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,$3,$4)",
      [je, accountId, debit.toFixed(2), credit.toFixed(2)]);
  }
  return je;
}

// --- client documents: 2 invoices (one before the period), a payment, a credit note ---
const inv1 = (await pool.query(
  "insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,paid_amount,currency,created_by_id) values ($1,'INV-100',$2,'2025-12-10','sent',1000,0,'SAR',$3) returning id",
  [org, cust, user])).rows[0].id;
const inv2 = (await pool.query(
  "insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,paid_amount,currency,created_by_id) values ($1,'INV-200',$2,'2026-01-15','partially_paid',2000,500,'SAR',$3) returning id",
  [org, cust, user])).rows[0].id;
const inv3 = (await pool.query(
  "insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,paid_amount,currency,created_by_id) values ($1,'INV-300',$2,'2026-01-20','sent',700,0,'USD',$3) returning id",
  [org, cust, user])).rows[0].id;
// a DRAFT invoice never posts, so it must not appear anywhere
await pool.query(
  "insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,created_by_id) values ($1,'INV-DRAFT',$2,'2026-01-18','draft',9999,$3)",
  [org, cust, user]);
// another client's invoice, to prove filtering by party
const invOther = (await pool.query(
  "insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,created_by_id) values ($1,'INV-ZZZ',$2,'2026-01-16','sent',4444,$3) returning id",
  [org, cust2, user])).rows[0].id;
const cn1 = (await pool.query(
  "insert into credit_notes (org_id,credit_note_number,customer_id,source_invoice_id,issue_date,status,total,reason,currency,created_by_id) values ($1,'CN-10',$2,$3,'2026-01-25','issued',300,'Returned goods','SAR',$4) returning id",
  [org, cust, inv2, user])).rows[0].id;
const pay1 = (await pool.query(
  "insert into payments (org_id,direction,bank_account_id,amount,payment_date,method,reference,sales_invoice_id,created_by_id) values ($1,'in',$4,500,'2026-01-18','bank_transfer','RCPT-9',$2,$3) returning id",
  [org, inv2, user, bank])).rows[0].id;

await post(org, "2025-12-10", "Invoice INV-100", "sales_invoice", inv1, [[acc.get("1100")!, 1000, 0], [acc.get("4000")!, 0, 1000]]);
await post(org, "2026-01-15", "Invoice INV-200", "sales_invoice", inv2, [[acc.get("1100")!, 2000, 0], [acc.get("4000")!, 0, 2000]]);
await post(org, "2026-01-20", "Invoice INV-300", "sales_invoice", inv3, [[acc.get("1100")!, 700, 0], [acc.get("4000")!, 0, 700]]);
await post(org, "2026-01-16", "Invoice INV-ZZZ", "sales_invoice", invOther, [[acc.get("1100")!, 4444, 0], [acc.get("4000")!, 0, 4444]]);
await post(org, "2026-01-18", "Payment RCPT-9", "payment", pay1, [[acc.get("1000")!, 500, 0], [acc.get("1100")!, 0, 500]]);
await post(org, "2026-01-25", "Credit note CN-10", "credit_note", cn1, [[acc.get("4000")!, 300, 0], [acc.get("1100")!, 0, 300]]);
// a manual entry that touches AR but belongs to no party — must not land on anybody's statement
await post(org, "2026-01-22", "Manual AR adjustment", "manual", null, [[acc.get("1100")!, 55, 0], [acc.get("4000")!, 0, 55]]);

// --- vendor documents: PO received before the period, PO in period, payment out, debit note ---
const po1 = (await pool.query(
  "insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,total,paid_amount,currency,created_by_id) values ($1,'PO-100',$2,'2025-12-05','received',800,0,'SAR',$3) returning id",
  [org, vend, user])).rows[0].id;
const po2 = (await pool.query(
  "insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,total,paid_amount,currency,created_by_id) values ($1,'PO-200',$2,'2026-01-12','received',1500,600,'SAR',$3) returning id",
  [org, vend, user])).rows[0].id;
const dn1 = (await pool.query(
  "insert into debit_notes (org_id,debit_note_number,vendor_id,source_purchase_order_id,issue_date,status,total,reason,currency,created_by_id) values ($1,'DN-10',$2,$3,'2026-01-28','issued',200,'Short delivery','SAR',$4) returning id",
  [org, vend, po2, user])).rows[0].id;
const pay2 = (await pool.query(
  "insert into payments (org_id,direction,bank_account_id,amount,payment_date,method,reference,purchase_order_id,created_by_id) values ($1,'out',$4,600,'2026-01-20','bank_transfer','PMT-4',$2,$3) returning id",
  [org, po2, user, bank])).rows[0].id;

await post(org, "2025-12-05", "PO-100 received", "purchase_order", po1, [[acc.get("1200")!, 800, 0], [acc.get("2000")!, 0, 800]]);
await post(org, "2026-01-12", "PO-200 received", "purchase_order", po2, [[acc.get("1200")!, 1500, 0], [acc.get("2000")!, 0, 1500]]);
await post(org, "2026-01-20", "Payment PMT-4", "payment", pay2, [[acc.get("2000")!, 600, 0], [acc.get("1000")!, 0, 600]]);
await post(org, "2026-01-28", "Debit note DN-10", "debit_note", dn1, [[acc.get("2000")!, 200, 0], [acc.get("1200")!, 0, 200]]);

const JAN = { from: "2026-01-01", to: "2026-01-31" };

// ---------- 1. client statement ----------
const cs = (await getStatement(org, "client", cust, JAN))!;
check("client statement built", !!cs && cs.party.name === "ABC Trading", cs?.party.name);
check("client opening = invoices posted before the period", near(cs.opening, 1000), String(cs.opening));
check("client rows = the 4 postings dated inside January", cs.lines.length === 4, cs.lines.map((l) => l.number).join(","));
check("client rows are the right documents, in transaction-date order",
  cs.lines.map((l) => l.number).join(",") === "INV-200,RCPT-9,INV-300,CN-10", cs.lines.map((l) => l.number).join(","));
check("another client's invoice is excluded", !cs.lines.some((l) => l.number === "INV-ZZZ"));
check("DRAFT invoice never appears (it never posted)", !cs.lines.some((l) => l.number === "INV-DRAFT"));
check("unattributable manual AR entry is excluded", !cs.lines.some((l) => l.description.includes("Manual AR")));
// 1000 opening + 2000 invoice - 500 payment + 700 invoice = 3200 (CN-10 is 25 Jan -> inside Jan)
const csNoCn = (await getStatement(org, "client", cust, { from: "2026-01-01", to: "2026-01-24" }))!;
check("a credit note dated after the end date is excluded", !csNoCn.lines.some((l) => l.number === "CN-10"),
  csNoCn.lines.map((l) => l.number).join(","));

// ---------- 2. running + closing arithmetic ----------
const feb = (await getStatement(org, "client", cust, { from: "2026-01-01", to: "2026-02-28" }))!;
check("client rows include the credit note", feb.lines.some((l) => l.number === "CN-10"));
let acc2run = feb.opening;

let ok = true;
for (const l of feb.lines) { acc2run += l.debit - l.credit; if (!near(acc2run, l.running)) ok = false; }
check("running balance = opening + Σ(debit − credit) at every row", ok, feb.lines.map((l) => l.running).join(","));
check("closing balance = last running value", near(feb.closing, feb.lines[feb.lines.length - 1].running), String(feb.closing));
// 1000 + 2000 - 500 + 700 - 300 = 2900
check("client closing balance is correct", near(feb.closing, 2900), String(feb.closing));
check("opening + period movement = closing",
  near(feb.opening + feb.totalDebit - feb.totalCredit, feb.closing), `${feb.opening}+${feb.totalDebit}-${feb.totalCredit}`);

// ---------- 3. vendor statement ----------
const vs = (await getStatement(org, "vendor", vend, { from: "2026-01-01", to: "2026-02-28" }))!;
check("vendor statement built", vs.party.name === "XYZ Supplies");
check("vendor opening = PO received before the period", near(vs.opening, 800), String(vs.opening));
check("vendor rows in date order", vs.lines.map((l) => l.number).join(",") === "PO-200,PMT-4,DN-10", vs.lines.map((l) => l.number).join(","));
// vendor balance is credit-normal: 800 + 1500 - 600 - 200 = 1500
check("vendor closing balance is correct", near(vs.closing, 1500), String(vs.closing));
let vrun = vs.opening, vok = true;
for (const l of vs.lines) { vrun += l.credit - l.debit; if (!near(vrun, l.running)) vok = false; }
check("vendor running balance follows the credit-normal direction", vok, vs.lines.map((l) => l.running).join(","));

// ---------- 4. filters ----------
const onlyInv = (await getStatement(org, "client", cust, { ...JAN, docTypes: ["sales_invoice"] }))!;
check("document-type filter keeps only invoices", onlyInv.lines.every((l) => l.docType === "sales_invoice") && onlyInv.lines.length === 2);
check("filters never change the opening balance", near(onlyInv.opening, 1000), String(onlyInv.opening));
const onlyPay = (await getStatement(org, "client", cust, { ...JAN, docTypes: ["payment_in"] }))!;
check("payment filter keeps only payments", onlyPay.lines.length === 1 && onlyPay.lines[0].number === "RCPT-9");
const usd = (await getStatement(org, "client", cust, { ...JAN, currency: "USD" }))!;
check("currency filter works", usd.lines.length === 1 && usd.lines[0].number === "INV-300", usd.lines.map((l) => l.number).join(","));
check("currency list offered from real documents", cs.currencies.join(",") === "SAR,USD", cs.currencies.join(","));
// Searching a document number also surfaces the payment recorded against it, via its reference.
const search = (await getStatement(org, "client", cust, { ...JAN, search: "inv-2" }))!;
check("search matches document number and reference, case-insensitively",
  search.lines.map((l) => l.number).join(",") === "INV-200,RCPT-9", search.lines.map((l) => l.number).join(","));
const searchOnly = (await getStatement(org, "client", cust, { ...JAN, search: "INV-300" }))!;
check("search is case-insensitive and narrows to one row",
  searchOnly.lines.length === 1 && searchOnly.lines[0].number === "INV-300", searchOnly.lines.map((l) => l.number).join(","));
const partial = (await getStatement(org, "client", cust, { ...JAN, paymentStatus: "partial" }))!;
check("payment-status filter uses real paid amounts", partial.lines.length === 1 && partial.lines[0].number === "INV-200",
  partial.lines.map((l) => `${l.number}:${l.paymentStatus}`).join(","));
const dec = (await getStatement(org, "client", cust, { from: "2025-12-01", to: "2025-12-31" }))!;
check("date range selects the right period", dec.lines.length === 1 && dec.lines[0].number === "INV-100" && near(dec.opening, 0),
  `open=${dec.opening} rows=${dec.lines.length}`);

// ---------- 5. document links ----------
check("invoice row links to its detail page", cs.lines.find((l) => l.number === "INV-200")?.href === `/sales/invoices/${inv2}`);
check("vendor PO row links to its detail page", vs.lines.find((l) => l.number === "PO-200")?.href === `/purchasing/orders/${po2}`);
check("debit note row links to its detail page", vs.lines.find((l) => l.number === "DN-10")?.href === `/purchasing/debit-notes/${dn1}`);
check("no internal id is shown in any visible column",
  [...cs.lines, ...vs.lines].every((l) => !/^\d+$/.test(l.number) && !l.number.includes("PAY-")),
  [...cs.lines, ...vs.lines].map((l) => l.number).join(","));

// ---------- 6. tenant isolation ----------
const cross = await getStatement(org, "client", foreignCust, JAN);
check("another org's client id resolves to nothing", cross === null);
await post(org2, "2026-01-10", "Other org invoice", "sales_invoice", 999999, [[acc2.get("1100")!, 5000, 0], [acc2.get("4000")!, 0, 5000]]);
const mine = (await getStatement(org, "client", cust, JAN))!;
check("another org's ledger never leaks in", !mine.lines.some((l) => l.debit === 5000));
const parties = await listStatementParties(org, "client");
check("party selector is org-scoped", parties.every((p) => p.id !== foreignCust) && parties.some((p) => p.id === cust));

// ---------- 7. presets, filter parsing, filename ----------
const tm = presetRange("this_month", new Date(Date.UTC(2026, 0, 15)))!;
check("This month preset", tm.from === "2026-01-01" && tm.to === "2026-01-31", `${tm.from}..${tm.to}`);
const lm = presetRange("last_month", new Date(Date.UTC(2026, 0, 15)))!;
check("Last month preset", lm.from === "2025-12-01" && lm.to === "2025-12-31", `${lm.from}..${lm.to}`);
const tq = presetRange("this_quarter", new Date(Date.UTC(2026, 1, 10)))!;
check("This quarter preset", tq.from === "2026-01-01" && tq.to === "2026-03-31", `${tq.from}..${tq.to}`);
const ty = presetRange("this_year", new Date(Date.UTC(2026, 5, 1)))!;
check("This year preset", ty.from === "2026-01-01" && ty.to === "2026-12-31", `${ty.from}..${ty.to}`);
check("Custom range keeps the caller's dates", presetRange("custom") === null);

const parsed = readFilters(new URLSearchParams("from=2026-01-31&to=2026-01-01&types=sales_invoice,debit_note,bogus&pay=weird&currency=sarx&q=  abc  "), "client");
check("readFilters swaps a reversed range", parsed.from === "2026-01-01" && parsed.to === "2026-01-31");
check("readFilters drops types that do not belong to the party kind", parsed.docTypes?.join(",") === "sales_invoice", parsed.docTypes?.join(","));
check("readFilters rejects an unknown payment status", parsed.paymentStatus === "all");
check("readFilters clamps the currency code", parsed.currency === "SAR", parsed.currency);
check("readFilters trims the search term", parsed.search === "abc", `"${parsed.search}"`);

check("filename matches the required shape",
  statementFilename("client", "ABC Trading", "2026-01-01", "2026-01-31") === "Client-Statement-ABC-Trading-2026-01-01-to-2026-01-31",
  statementFilename("client", "ABC Trading", "2026-01-01", "2026-01-31"));
check("vendor filename matches the required shape",
  statementFilename("vendor", "XYZ Supplies", "2026-01-01", "2026-01-31") === "Vendor-Statement-XYZ-Supplies-2026-01-01-to-2026-01-31");

// ---------- 8. export payload carries the required header block in every format ----------
const cols: ExportColumn[] = [
  { key: "date", header: "Date" }, { key: "type", header: "Document Type" },
  { key: "number", header: "Document Number" }, { key: "description", header: "Description / Reference" },
  { key: "debit", header: "Debit" }, { key: "credit", header: "Credit" }, { key: "balance", header: "Running Balance" },
];
const exMeta: ExportMeta = [
  { label: "Organization", value: "Statement Co" },
  { label: "Client", value: feb.party.name },
  { label: "Period", value: `${feb.from} to ${feb.to}` },
  { label: "Opening Balance", value: feb.opening.toFixed(2) },
  { label: "Closing Balance", value: feb.closing.toFixed(2) },
];
const exRows = [
  { date: "", type: "", number: "", description: "Opening balance", debit: "", credit: "", balance: feb.opening.toFixed(2) },
  ...feb.lines.map((l) => ({ date: l.date, type: l.docTypeLabel, number: l.number, description: l.reference || l.description, debit: l.debit ? l.debit.toFixed(2) : "", credit: l.credit ? l.credit.toFixed(2) : "", balance: l.running.toFixed(2) })),
  { date: "", type: "", number: "", description: "Closing balance", debit: "", credit: "", balance: feb.closing.toFixed(2) },
];
const csv = toCsv(cols, exRows, exMeta);
check("CSV carries organization, party, period and balances", ["Statement Co", "ABC Trading", "2026-01-01 to 2026-02-28", "Opening Balance", "Closing Balance"].every((x) => csv.includes(x)));
check("CSV carries the transaction table", csv.includes("Document Number") && csv.includes("INV-200") && csv.includes("CN-10"));
check("CSV closing figure matches the statement", csv.includes(feb.closing.toFixed(2)));
const xls = toExcelHtml("Client Statement", cols, exRows, exMeta);
check("Excel carries the same header block and rows", xls.includes("Statement Co") && xls.includes("ABC Trading") && xls.includes("INV-200") && xls.includes("Closing Balance"));
const pdfBytes = await toPdf("Client Statement", cols, exRows, exMeta);
check("PDF renders (non-trivial byte length, %PDF header)",
  pdfBytes.length > 1200 && String.fromCharCode(...pdfBytes.slice(0, 4)) === "%PDF", `${pdfBytes.length} bytes`);
const csvNoMeta = toCsv(cols, exRows);
check("existing exports without a header block are unchanged", csvNoMeta.startsWith("\ufeffDate,Document Type"), csvNoMeta.slice(0, 30));

// ---------- 9. empty state ----------
const empty = (await getStatement(org, "client", cust2, { from: "2027-01-01", to: "2027-12-31" }))!;
check("a party with no activity in the period returns an empty statement, not an error",
  empty.lines.length === 0 && near(empty.closing, empty.opening), `${empty.lines.length}/${empty.opening}`);


// ---------- 10. Task 10 (Arabic account names): statements carry no account name to translate ----------
// Task 10 made the seeded chart of accounts language-aware. It changed nothing here, and this records
// WHY rather than leaving it as a claim: a statement is a PARTY ledger, not an account ledger. Its
// lines are date / type / number / description / debit / credit / balance, and controlAccountLines()
// selects only { id } from accounts, matching on CODE, purely to pick which control account to read.
// No chart-of-accounts name reaches the screen or any export.
//
// These assertions are the guard. If an account column is ever added to statements they fail, which
// is the signal that the new column needs the accountName() treatment too.
{
  const AR_RECEIVABLE = "الذمم المدينة";   // 1100 — the control account the client statement reads
  const EN_RECEIVABLE = "Accounts Receivable";
  const EN_PAYABLE = "Accounts Payable";
  const names = [EN_RECEIVABLE, EN_PAYABLE, AR_RECEIVABLE];

  const lineKeys = new Set(feb.lines.flatMap((l) => Object.keys(l)));
  check("a statement line carries no account-name field",
    !["account", "accountName", "accountCode"].some((k) => lineKeys.has(k)), [...lineKeys].join(","));

  check("CONTROL: both statements really produced lines, so the absences below mean something",
    feb.lines.length > 0 && vs.lines.length > 0, `client=${feb.lines.length} vendor=${vs.lines.length}`);
  const bothJson = JSON.stringify(feb) + JSON.stringify(vs);
  check("neither the client nor the vendor statement contains a chart-of-accounts name",
    !names.some((x) => bothJson.includes(x)), names.find((x) => bothJson.includes(x)) ?? "none");

  // All three export formats, since an export is where a stray name would surface unnoticed.
  const pdfText = Buffer.from(pdfBytes).toString("latin1");
  for (const [fmt, body] of [["CSV", csv], ["Excel", xls], ["PDF", pdfText]] as const) {
    check(`${fmt} export carries no chart-of-accounts name, in either language`,
      !names.some((x) => body.includes(x)), names.find((x) => body.includes(x)) ?? "none");
  }
}

await pool.end();
let allOk = true;
for (const [cond, name, extra] of results) { if (!cond) allOk = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "STATEMENT VERIFICATION PASS" : "STATEMENT VERIFICATION FAIL");
process.exit(allOk ? 0 : 1);
