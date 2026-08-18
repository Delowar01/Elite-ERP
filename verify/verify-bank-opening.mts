// Run via `npm run verify:bank-opening` — tsx with the react-server condition, like every server suite.

/**
 * Bank opening balances are a JOURNAL ENTRY. This suite proves the entry, and the parts of the
 * repair that can be reached without a session; the page total, the create dialog and the edit
 * refusal are browser-tier (`verify/verify-bank-opening.mjs`), because a server action carrying a
 * session cannot be called from here.
 *
 * What is proven:
 *  1. the posting construction — sides, signs, balance, base conversion, and the zero SKIP;
 *  2. the identity `(bank_opening, bank_accounts.id)` and its re-entrancy, against a DELIBERATE
 *     id collision in another source type. That collision is the point: `sourceId` values are
 *     drawn from a different table per source type, so a check keyed on the id alone finds an
 *     unrelated row and skips a real posting. Proving the key works means proving it survives a
 *     collision, not that the fixture happened not to have one.
 */
import { Pool } from "pg";
import { buildBankOpeningPosting, openingContraRefusal, writeBankOpeningEntry, bankOpeningEntryId } from "../src/lib/bank-opening";
import { db } from "../src/db";
import { bankAccountsTable } from "../src/db/schema/finance";
import { eq } from "drizzle-orm";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const mils = (v: string | number) => Math.round(Number(v) * 1000);

const FIXTURE = "verifybankopen_";
async function sweep() {
  await pool.query(`delete from journal_lines where journal_entry_id in
    (select e.id from journal_entries e join orgs o on o.id = e.org_id where o.name like $1)`, [`${FIXTURE}%`]);
  await pool.query("delete from journal_entries where org_id in (select id from orgs where name like $1)", [`${FIXTURE}%`]);
  await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);
}
await sweep();

const org = (await pool.query("insert into orgs (name, currency, country) values ($1,'SAR','Saudi Arabia') returning id",
  [`${FIXTURE}${uniq()}`])).rows[0].id as number;
const user = (await pool.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'B',$2,'x','owner') returning id",
  [org, `bo_${uniq()}@t.dev`])).rows[0].id as number;
for (const [code, name, type, nb] of [
  ["1010", "Al Inma Bank", "asset", "debit"], ["1100", "Accounts Receivable", "asset", "debit"],
  ["2300", "Customer Advances", "liability", "credit"], ["3000", "Owner's Equity", "equity", "credit"],
  ["4000", "Sales Revenue", "revenue", "credit"],
] as const) {
  await pool.query("insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,true)",
    [org, code, name, type, nb]);
}
const acc = new Map<string, number>(
  (await pool.query("select id, code from accounts where org_id=$1", [org])).rows.map((r) => [r.code, r.id]));
await pool.query(
  "insert into exchange_rates (org_id,from_currency,to_currency,rate,effective_date,source) values ($1,'USD','SAR','3.75000000','2026-07-01','manual')",
  [org]);

const base = { orgId: org, baseCurrency: "SAR", glAccountId: acc.get("1010")!, contraAccountId: acc.get("3000")! };

// ── 1. The posting construction ───────────────────────────────────────────────────────────────
const positive = await buildBankOpeningPosting({ ...base, accountCurrency: null, openingBalance: "30000.000", openingDate: "2026-07-30" });
check("a positive opening balance DEBITS the bank and CREDITS the contra",
  positive.ok && !positive.skip && positive.debitAccountId === acc.get("1010") && positive.creditAccountId === acc.get("3000"),
  positive.ok && !positive.skip ? `Dr ${positive.debitAccountId} / Cr ${positive.creditAccountId}` : JSON.stringify(positive));
check("…for the full amount, base currency, rate 1", positive.ok && !positive.skip && mils(positive.baseAmount) === 30_000_000 && positive.exchangeRate === "1",
  positive.ok && !positive.skip ? `${positive.baseAmount} @ ${positive.exchangeRate}` : "");

// An overdraft at cutover. The sides FLIP; a negative debit is never written, because every report
// signs its own figures from the debit/credit columns and would read the negative as a positive on
// the other side.
const negative = await buildBankOpeningPosting({ ...base, accountCurrency: null, openingBalance: "-1200.000", openingDate: "2026-07-30" });
check("a NEGATIVE opening balance flips the sides rather than posting a negative debit",
  negative.ok && !negative.skip && negative.debitAccountId === acc.get("3000") && negative.creditAccountId === acc.get("1010")
    && mils(negative.baseAmount) === 1_200_000 && Number(negative.baseAmount) > 0,
  negative.ok && !negative.skip ? `Dr ${negative.debitAccountId} ${negative.baseAmount} / Cr ${negative.creditAccountId}` : "");

const zero = await buildBankOpeningPosting({ ...base, accountCurrency: null, openingBalance: "0", openingDate: "2026-07-30" });
check("a ZERO opening balance posts NOTHING — no event, not a rounded-away one", zero.ok && zero.skip === true);

// The ledger holds base currency only; a foreign account converts once, at the OPENING date.
const foreign = await buildBankOpeningPosting({ ...base, accountCurrency: "USD", openingBalance: "1000.000", openingDate: "2026-07-01" });
check("a FOREIGN opening balance converts at the opening date's rate and stores the base figure",
  foreign.ok && !foreign.skip && mils(foreign.baseAmount) === 3_750_000 && foreign.exchangeRate === "3.75000000",
  foreign.ok && !foreign.skip ? `${foreign.baseAmount} @ ${foreign.exchangeRate}` : JSON.stringify(foreign));

// No rate on or before the date: BLOCKED. Never converted at 1.0 — a blocked posting is
// recoverable and a wrong ledger is not.
const noRate = await buildBankOpeningPosting({ ...base, accountCurrency: "EUR", openingBalance: "1000.000", openingDate: "2026-07-01" });
check("a foreign opening balance with NO rate is BLOCKED, not posted at 1.0",
  !noRate.ok && /exchange rate/i.test(noRate.error), noRate.ok ? "posted anyway" : noRate.error.slice(0, 70));
// …and specifically NOT by silently landing the document figure in the ledger:
check("…and the block does not leak the unconverted figure as a base amount", !noRate.ok);

// ── 2. Contra refusal ─────────────────────────────────────────────────────────────────────────
check("an ASSET contra is refused — the money has to come from somewhere",
  openingContraRefusal({ type: "asset", code: "1100", name: "Accounts Receivable" }) !== null);
check("a REVENUE contra is refused — an opening balance is not income",
  openingContraRefusal({ type: "revenue", code: "4000", name: "Sales Revenue" }) !== null);
check("equity is accepted", openingContraRefusal({ type: "equity", code: "3000", name: "Owner's Equity" }) === null);
check("a liability is accepted — an opening balance can be a loan", openingContraRefusal({ type: "liability", code: "2300", name: "Customer Advances" }) === null);

// ── 3. The identity, and the collision that proves it ─────────────────────────────────────────
const ba = (await pool.query("insert into bank_accounts (org_id,name,gl_account_id,opening_balance) values ($1,'Al Inma',$2,'30000.000') returning id",
  [org, acc.get("1010")])).rows[0].id as number;

// A DECOY keyed `(payment, <the same integer>)`. `sourceId` is drawn from a different table for
// every source type, so this collision is ordinary rather than contrived — and a check that looked
// at the id alone would find this row and decide the opening entry was already posted.
await pool.query(
  "insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id) values ($1,'2026-08-02','Decoy payment','payment',$2,$3)",
  [org, ba, user]);

const posted = positive.ok && !positive.skip
  ? await db.transaction(async (tx) => writeBankOpeningEntry(tx, {
      orgId: org, bankAccountId: ba, entryDate: "2026-07-30", memo: "Opening balance — Al Inma",
      createdById: user, baseAmount: positive.baseAmount,
      debitAccountId: positive.debitAccountId, creditAccountId: positive.creditAccountId,
    }))
  : null;
check("the entry posts even though a `payment` entry already carries the SAME source id",
  !!posted && "entryId" in posted, JSON.stringify(posted));

const lines = (await pool.query(
  `select l.account_id, l.debit::text d, l.credit::text c, e.entry_date::text dt, e.source_type st
     from journal_lines l join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and e.source_type='bank_opening' order by l.debit desc`, [org])).rows;
check("two lines, balanced, dated at the OPENING date — not at creation time",
  lines.length === 2 && mils(lines[0].d) === mils(lines[1].c) && mils(lines[0].d) === 30_000_000 && lines[0].dt === "2026-07-30",
  JSON.stringify(lines));
check("Dr the bank's GL account, Cr equity",
  lines.length === 2 && lines[0].account_id === acc.get("1010") && lines[1].account_id === acc.get("3000"));

const again = await db.transaction(async (tx) => writeBankOpeningEntry(tx, {
  orgId: org, bankAccountId: ba, entryDate: "2026-07-30", memo: "Opening balance — Al Inma",
  createdById: user, baseAmount: "30000.000",
  debitAccountId: acc.get("1010")!, creditAccountId: acc.get("3000")!,
}));
const count = Number((await pool.query(
  "select count(*)::int n from journal_entries where org_id=$1 and source_type='bank_opening' and source_id=$2", [org, ba])).rows[0].n);
check("re-posting the same account is INERT — one entry, not two", "skipped" in again && count === 1, `entries=${count}`);
check("bankOpeningEntryId finds it, keyed on the PAIR", (await bankOpeningEntryId(db, org, ba)) !== null);
check("…and does not find it for a bank account that has none", (await bankOpeningEntryId(db, org, ba + 100000)) === null);

// The schema field is the one nothing may compute from; reading it here is the audit copy, and it
// is deliberately NOT compared to the ledger — the two are allowed to disagree (see the browser
// suite's lying-scalar fixture).
const [row] = await db.select({ legacy: bankAccountsTable.openingBalanceLegacy }).from(bankAccountsTable).where(eq(bankAccountsTable.id, ba));
check("the legacy column still holds what was typed, as an audit copy", mils(row.legacy) === 30_000_000, row.legacy);

await sweep();
await pool.end();
console.log("\nBank opening balances — the posting, the identity, the collision\n");
for (const [ok, name, extra] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  << ${extra}` : ""}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks`);
console.log(failed === 0 ? "BANK OPENING PASS" : `BANK OPENING FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
