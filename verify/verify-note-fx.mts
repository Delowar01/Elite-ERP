// Run via `npm run verify:note-fx` — tsx with the react-server condition, like every server suite.

/**
 * A credit note (and its debit-note twin) must inherit the SOURCE document's stored exchange rate.
 *
 * ## The invariant
 *
 * **A credit note for 100% of a foreign invoice returns that invoice's base revenue effect to
 * exactly zero** — at the base currency's minor unit, not near zero. Same for AR, and the same for
 * a debit note against its purchase order on 2000/1200.
 *
 * Exactness comes from identical inputs, not from a tolerance: the note converts the same document
 * amount at the same rate through the same rounding, so `roundMoney(total × rate)` produces an
 * identical string. That is the property the defect violates and the one assertion that would have
 * caught it.
 *
 * ## Why the fixture makes the rates DIFFER
 *
 * The invoice is booked at 3.80 and the note is dated where the rate is 3.90. A fixture whose two
 * rates agree cannot fail — every assertion below would pass with the defect fully present, which
 * is precisely how this shipped.
 *
 * ## The bound on the invariant, asserted rather than only described
 *
 * The invariant holds when the note's DOCUMENT-currency total and taxTotal equal the invoice's. A
 * "100%" note built from retyped lines can round its tax differently at the document level, which
 * leaves AR exactly zero and revenue off by that document-level tax difference. That is
 * pre-existing note-entry behaviour and has nothing to do with FX — so it is pinned here
 * explicitly, because the next person to see revenue not net to zero will otherwise suspect this
 * fix.
 */
import { Pool } from "pg";
import { noteBaseAmounts, creditNoteLines, debitNoteLines } from "../src/lib/reversal-currency";
import { subtractMoney } from "../src/lib/posting-currency";
import { roundMoney } from "../src/lib/currency/currencies";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const mils = (v: string | number | null) => Math.round(Number(v ?? 0) * 1000);
const money = (m: number) => (m / 1000).toFixed(3);

const FIXTURE = "verifynotefx_";
async function sweepDb() {
  await pool.query(`delete from journal_lines where journal_entry_id in
    (select e.id from journal_entries e join orgs o on o.id = e.org_id where o.name like $1)`, [`${FIXTURE}%`]);
  await pool.query("delete from journal_entries where org_id in (select id from orgs where name like $1)", [`${FIXTURE}%`]);
  await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);
}
await sweepDb();

const org = (await pool.query("insert into orgs (name, currency, country) values ($1,'SAR','Saudi Arabia') returning id",
  [`${FIXTURE}${uniq()}`])).rows[0].id as number;
const user = (await pool.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'N',$2,'x','owner') returning id",
  [org, `nfx_${uniq()}@t.dev`])).rows[0].id as number;
for (const [code, name, type, nb] of [
  ["1100", "Accounts Receivable", "asset", "debit"], ["1200", "Inventory", "asset", "debit"],
  ["2000", "Accounts Payable", "liability", "credit"], ["2100", "VAT Payable", "liability", "credit"],
  ["4000", "Sales Revenue", "revenue", "credit"], ["4900", "Exchange Gain/Loss", "revenue", "credit"],
] as const) {
  await pool.query("insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,true)",
    [org, code, name, type, nb]);
}
const acc = new Map<string, number>(
  (await pool.query("select id, code from accounts where org_id=$1", [org])).rows.map((r) => [r.code, r.id]));

// The rate MOVES between the source date and the note date. This is the whole fixture.
const SRC_RATE = "3.80000000";
const NOTE_RATE = "3.90000000";
await pool.query(
  `insert into exchange_rates (org_id,from_currency,to_currency,rate,effective_date,source) values
     ($1,'USD','SAR',$2,'2026-07-01','manual'), ($1,'USD','SAR',$3,'2026-08-01','manual')`,
  [org, SRC_RATE, NOTE_RATE]);

const BASE = "SAR";
/** No sibling notes yet — the ordinary case for every single-note assertion below. */
const NO_PRIOR = { total: "0", baseTotal: "0", baseTaxAmount: "0" };
const post = async (date: string, memo: string, sourceType: string, sourceId: number,
                    lines: { accountId: number; debit: string; credit: string }[]) => {
  const je = (await pool.query(
    `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
     values ($1,$2,$3,$4,$5,$6) returning id`, [org, date, memo, sourceType, sourceId, user])).rows[0].id as number;
  for (const l of lines) {
    await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,$3,$4)",
      [je, l.accountId, l.debit, l.credit]);
  }
  return je;
};
const balanceOf = async (code: string) => (await pool.query(
  `select coalesce(sum(l.debit) - sum(l.credit),0)::text v from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and l.account_id=$2`, [org, acc.get(code)])).rows[0].v as string;
const bracket = async () => ({
  ar: await balanceOf("1100"), rev: await balanceOf("4000"), vat: await balanceOf("2100"),
  ap: await balanceOf("2000"), inv: await balanceOf("1200"), fx: await balanceOf("4900"),
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CREDIT NOTE against a foreign invoice
// ─────────────────────────────────────────────────────────────────────────────────────────────
// A USD invoice: 1,000.00 net + 150.00 VAT = 1,150.00, booked at 3.80.
const INV_TOTAL = "1150.00", INV_TAX = "150.00";
const invBaseTotal = roundMoney(Number(INV_TOTAL) * Number(SRC_RATE), BASE);
const invBaseTax = roundMoney(Number(INV_TAX) * Number(SRC_RATE), BASE);
const invBaseRevenue = subtractMoney(invBaseTotal, invBaseTax, BASE);
const cust = (await pool.query("insert into customers (org_id,name) values ($1,'FX Client') returning id", [org])).rows[0].id;
const invoice = (await pool.query(
  `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,currency,
                               exchange_rate,base_total,base_tax_amount,created_by_id)
   values ($1,'INV-FX-1',$2,'2026-07-01','sent',$3,$4,'0','USD',$5,$6,$7,$8) returning id`,
  [org, cust, INV_TOTAL, INV_TAX, SRC_RATE, invBaseTotal, invBaseTax, user])).rows[0].id as number;
await post("2026-07-01", "Invoice INV-FX-1 sent", "sales_invoice", invoice, [
  { accountId: acc.get("1100")!, debit: invBaseTotal, credit: "0" },
  { accountId: acc.get("4000")!, debit: "0", credit: invBaseRevenue },
  { accountId: acc.get("2100")!, debit: "0", credit: invBaseTax },
]);

const beforeCn = await bracket();
check("BRACKET before the credit note — the invoice's own posting at 3.80",
  mils(beforeCn.ar) === mils(invBaseTotal) && mils(beforeCn.rev) === -mils(invBaseRevenue),
  `AR ${beforeCn.ar} / 4000 ${beforeCn.rev} / 2100 ${beforeCn.vat}`);

// A FULL credit note — same document figures as the invoice, dated where the rate is 3.90.
const srcInvoice = { currency: "USD", exchangeRate: SRC_RATE, total: INV_TOTAL, baseTotal: invBaseTotal, baseTaxAmount: invBaseTax };
const full = noteBaseAmounts({
  baseCurrency: BASE, source: srcInvoice,
  note: { currency: "USD", total: INV_TOTAL, taxTotal: INV_TAX },
  priorNotes: NO_PRIOR,
});
check("the full credit note converts", full.ok, full.ok ? "" : full.error);
if (full.ok) {
  check("[4] the note's rate IS the invoice's stored rate, not the note date's",
    full.exchangeRate === SRC_RATE, `${full.exchangeRate} (invoice ${SRC_RATE}, note date ${NOTE_RATE})`);

  const cnLines = creditNoteLines({
    baseTotal: full.baseTotal, baseRevenue: subtractMoney(full.baseTotal, full.baseTaxAmount, BASE),
    baseTaxAmount: full.baseTaxAmount,
    arAccountId: acc.get("1100")!, revenueAccountId: acc.get("4000")!, vatAccountId: acc.get("2100")!,
  });
  // Asserted as "these three accounts and NOTHING else", not as "not 4900". Keying on the FX
  // account's own id only catches an FX line posted to that id — a compensating line pushed
  // anywhere else walks straight past it, which is how the first version of this check let a
  // mutation through. An exhaustive account set cannot be evaded by choosing a different account.
  const allowed = new Set([acc.get("1100"), acc.get("4000"), acc.get("2100")]);
  check("[2] the credit note posts ONLY AR, revenue and VAT — no fourth line of any kind",
    cnLines.length === 3 && cnLines.every((l) => allowed.has(l.accountId)), JSON.stringify(cnLines));
  check("the entry balances", cnLines.reduce((s, l) => s + mils(l.debit), 0) === cnLines.reduce((s, l) => s + mils(l.credit), 0));

  await post("2026-08-15", "Credit note CN-FX-1 issued", "credit_note", 1, cnLines);
  const afterCn = await bracket();
  check("BRACKET after the credit note",
    true, `AR ${beforeCn.ar}→${afterCn.ar} / 4000 ${beforeCn.rev}→${afterCn.rev} / 2100 ${beforeCn.vat}→${afterCn.vat} / 4900 ${afterCn.fx}`);

  // THE INVARIANT.
  check("[1] a 100% credit note returns base REVENUE to exactly zero",
    mils(afterCn.rev) === 0, `4000 is ${afterCn.rev} — residual ${money(mils(afterCn.rev))} at the note-date rate`);
  check("[1] …and base AR to exactly zero",
    mils(afterCn.ar) === 0, `1100 is ${afterCn.ar} — residual ${money(mils(afterCn.ar))}`);
  check("[1] …and VAT payable to exactly zero",
    mils(afterCn.vat) === 0, `2100 is ${afterCn.vat}`);
  check("[2] no 4900 line was posted by anything in this fixture",
    mils(afterCn.fx) === 0, `4900 is ${afterCn.fx}`);
}

// [3] PARTIAL — half the invoice. Both sides move at the SOURCE rate.
const half = noteBaseAmounts({
  baseCurrency: BASE, source: srcInvoice,
  note: { currency: "USD", total: "575.00", taxTotal: "75.00" },
  priorNotes: NO_PRIOR,
});
check("[3] a PARTIAL credit note converts at the source rate too",
  half.ok && mils(half.baseTotal) === mils(roundMoney(575 * Number(SRC_RATE), BASE)),
  half.ok ? `${half.baseTotal} (source-rate ${roundMoney(575 * Number(SRC_RATE), BASE)}, note-rate ${roundMoney(575 * Number(NOTE_RATE), BASE)})` : "blocked");

// [5] LEGACY — a foreign invoice with no stored conversion must REFUSE.
const legacy = noteBaseAmounts({
  baseCurrency: BASE, source: { currency: "USD", exchangeRate: null, total: "999999.00", baseTotal: null, baseTaxAmount: null },
  note: { currency: "USD", total: INV_TOTAL, taxTotal: INV_TAX },
  priorNotes: NO_PRIOR,
});
check("[5] a source with NO stored conversion is REFUSED, not re-converted",
  !legacy.ok, legacy.ok ? `converted anyway at ${legacy.exchangeRate}` : legacy.error.slice(0, 90));
check("[5] …and the refusal names the reason", !legacy.ok && /stored base-currency conversion|no stored/i.test(legacy.error));
// Structural rather than typed, because the field no longer exists on the type at all — which is
// the stronger guarantee, but a compile error is not an assertion someone reads in the output.
check("[5] …and offers no missingRate seam — there is no rate to fetch, the answer is on the source",
  !legacy.ok && !("missingRate" in legacy), JSON.stringify(legacy).slice(0, 60));

// Currency mismatch — the inheritance premise is broken and neither rate is defensible.
// The EUR rate is seeded FIRST, deliberately: without it this assertion passes because no EUR rate
// exists, which is the right outcome for the wrong cause and would survive the mismatch rule being
// deleted.
await pool.query(
  "insert into exchange_rates (org_id,from_currency,to_currency,rate,effective_date,source) values ($1,'EUR','SAR','4.10000000','2026-07-01','manual')",
  [org]);
const mismatch = noteBaseAmounts({
  baseCurrency: BASE, source: { currency: "USD", exchangeRate: SRC_RATE, total: "999999.00", baseTotal: null, baseTaxAmount: null },
  note: { currency: "EUR", total: "100.00", taxTotal: "0" },
  priorNotes: NO_PRIOR,
});
check("a note in a DIFFERENT currency from its source is refused — and NOT because the rate is missing",
  !mismatch.ok && !/exchange rate exists/i.test(mismatch.error),
  mismatch.ok ? `converted at ${mismatch.exchangeRate}` : mismatch.error.slice(0, 90));

// [6] BASE CURRENCY — the no-regression case. Identity, no rate lookup, unchanged in every respect.
const baseCase = noteBaseAmounts({
  baseCurrency: BASE, source: { currency: null, exchangeRate: null, total: "1150.00", baseTotal: null, baseTaxAmount: null },
  note: { currency: null, total: "1150.00", taxTotal: "150.00" },
  priorNotes: NO_PRIOR,
});
check("[6] a BASE-currency note converts by identity — rate 1, amounts unchanged",
  baseCase.ok && baseCase.exchangeRate === "1" && baseCase.baseTotal === "1150.00" && baseCase.baseTaxAmount === "150.00",
  baseCase.ok ? `${baseCase.baseTotal} @ ${baseCase.exchangeRate}` : baseCase.error);
check("[6] …and a base note whose source has no stored rate is NOT refused — there is nothing to inherit",
  baseCase.ok);

// THE BOUND on the invariant — and the closing rule REMOVED it, which is worth pinning too.
//
// Before the closing rule, a "100%" note built from retyped lines whose document-level tax differed
// by a fil returned AR to exactly zero and left revenue off by that difference times the source
// rate. That bound no longer exists: a note that closes its source takes the source's stored base
// figures as the exact remainder, so the note's own document tax never reaches the ledger.
//
// Kept as an assertion rather than deleted, because it is the case someone will hit and wonder
// about — and because if the closing rule is ever stood down, this is where it shows up first.
const retyped = noteBaseAmounts({
  baseCurrency: BASE, source: srcInvoice,
  note: { currency: "USD", total: INV_TOTAL, taxTotal: "150.01" },
  priorNotes: NO_PRIOR,
});
check("BOUND (removed): a 100% note with a DIFFERENT document-level tax returns AR to exactly zero",
  retyped.ok && mils(retyped.baseTotal) === mils(invBaseTotal),
  retyped.ok ? `${retyped.baseTotal} vs invoice ${invBaseTotal}` : "blocked");
check("BOUND (removed): …and REVENUE to exactly zero too — the closing note takes the stored remainder, not its own tax",
  retyped.ok && mils(subtractMoney(retyped.baseTotal, retyped.baseTaxAmount, BASE)) === mils(invBaseRevenue),
  retyped.ok ? `revenue side ${subtractMoney(retyped.baseTotal, retyped.baseTaxAmount, BASE)} vs invoice ${invBaseRevenue}` : "");

// ── The CLOSING rule itself, stated rather than only swept ────────────────────────────────────
// Three sequential partial notes against the 1,150.00 invoice booked at 3.80 (base 4,370.00).
// Proportionally the three would sum to 4,370.01 and strand a fil on 1100 forever.
{
  const parts = ["383.33", "383.33", "383.34"];
  const taxes = ["50.00", "50.00", "50.00"];
  let priorDoc = 0, priorBase = 0, priorTax = 0;
  const posted: string[] = [];
  let proportionalSum = 0;
  for (let i = 0; i < 3; i++) {
    const part = noteBaseAmounts({
      baseCurrency: BASE, source: srcInvoice,
      note: { currency: "USD", total: parts[i], taxTotal: taxes[i] },
      priorNotes: { total: priorDoc.toFixed(2), baseTotal: (priorBase / 1000).toFixed(3), baseTaxAmount: (priorTax / 1000).toFixed(3) },
    });
    if (!part.ok) { posted.push("BLOCKED"); break; }
    posted.push(part.baseTotal);
    proportionalSum += mils(roundMoney(Number(parts[i]) * Number(SRC_RATE), BASE));
    priorDoc += Number(parts[i]);
    priorBase += mils(part.baseTotal);
    priorTax += mils(part.baseTaxAmount);
  }
  check("CLOSING: three sequential partial notes sum to the invoice's base total EXACTLY",
    priorBase === mils(invBaseTotal), `${money(priorBase)} vs ${invBaseTotal} — proportional would give ${money(proportionalSum)}`);
  check("CLOSING: …and the third note is the one that differs — it takes the remainder",
    posted[2] !== roundMoney(Number(parts[2]) * Number(SRC_RATE), BASE),
    `third ${posted[2]}, proportional would be ${roundMoney(Number(parts[2]) * Number(SRC_RATE), BASE)}`);
  check("CLOSING: …while the first two are ordinary proportional conversions",
    posted[0] === roundMoney(Number(parts[0]) * Number(SRC_RATE), BASE), `${posted[0]}`);
  check("CLOSING: the VAT side lands exactly too", priorTax === mils(invBaseTax), `${money(priorTax)} vs ${invBaseTax}`);
}

// A note that does NOT close the source stays proportional — the rule is for the closing note only.
const notClosing = noteBaseAmounts({
  baseCurrency: BASE, source: srcInvoice,
  note: { currency: "USD", total: "100.00", taxTotal: "13.04" },
  priorNotes: NO_PRIOR,
});
check("CLOSING: a note that does NOT close the invoice is proportional, untouched",
  notClosing.ok && notClosing.baseTotal === roundMoney(100 * Number(SRC_RATE), BASE),
  notClosing.ok ? notClosing.baseTotal : "blocked");

// STANDS DOWN when a prior note predates conversion: the sum already consumed is unknown, and
// subtracting an incomplete total would produce a confident WRONG remainder — worse than a fil.
const unknownPrior = noteBaseAmounts({
  baseCurrency: BASE, source: srcInvoice,
  note: { currency: "USD", total: "575.00", taxTotal: "75.00" },
  priorNotes: { total: "575.00", baseTotal: null, baseTaxAmount: null },
});
check("CLOSING: stands down to proportional when a PRIOR note has no stored conversion",
  unknownPrior.ok && unknownPrior.baseTotal === roundMoney(575 * Number(SRC_RATE), BASE),
  unknownPrior.ok ? unknownPrior.baseTotal : "blocked");
// …and when the SOURCE itself carries no stored base figures, for the same reason.
const unknownSource = noteBaseAmounts({
  baseCurrency: BASE,
  source: { currency: "USD", exchangeRate: SRC_RATE, total: INV_TOTAL, baseTotal: null, baseTaxAmount: null },
  note: { currency: "USD", total: INV_TOTAL, taxTotal: INV_TAX },
  priorNotes: NO_PRIOR,
});
check("CLOSING: stands down when the SOURCE has no stored base figures — nothing to take a remainder of",
  unknownSource.ok && unknownSource.baseTotal === roundMoney(Number(INV_TOTAL) * Number(SRC_RATE), BASE),
  unknownSource.ok ? unknownSource.baseTotal : "blocked");

// ── The ACTION's aggregate, against real rows ────────────────────────────────────────────────
// The lib's stand-down is only as good as the flag the action feeds it, and that flag comes from a
// `count(*) filter (...)` written in a raw SQL template. `sum()` skips nulls SILENTLY, so a legacy
// note with no stored conversion would shrink the prior total and hand the closing rule a remainder
// that is too large — a confident wrong number, not a fil. This asserts the SQL itself, because a
// drizzle template that renders a bare column name has produced a confident 0 in this repo before.
{
  const legacyInv = (await pool.query(
    `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,total,tax_total,paid_amount,currency,
                                 exchange_rate,base_total,base_tax_amount,created_by_id)
     values ($1,'INV-FX-LEG',$2,'2026-07-01','sent','1000.00','0','0','USD',$3,$4,'0',$5) returning id`,
    [org, cust, SRC_RATE, roundMoney(1000 * Number(SRC_RATE), BASE), user])).rows[0].id;
  const mkNote = async (num: string, total: string, base: string | null) => pool.query(
    `insert into credit_notes (org_id,credit_note_number,customer_id,source_invoice_id,issue_date,status,
                               subtotal,tax_total,total,currency,exchange_rate,base_total,base_tax_amount,created_by_id)
     values ($1,$2,$3,$4,'2026-08-15','issued',$5,'0',$5,'USD',$6,$7,$8,$9)`,
    [org, num, cust, legacyInv, total, base === null ? null : SRC_RATE, base, base === null ? null : "0", user]);
  await mkNote("CN-LEG-A", "300.00", roundMoney(300 * Number(SRC_RATE), BASE));
  await mkNote("CN-LEG-B", "200.00", null); // pre-FX-6: issued, but never converted

  const agg = (await pool.query(
    `select coalesce(sum(total),0)::text total, coalesce(sum(base_total),0)::text base_total,
            count(*) filter (where base_total is null or base_tax_amount is null)::int unconverted
       from credit_notes where org_id=$1 and source_invoice_id=$2 and status='issued' and deleted_at is null`,
    [org, legacyInv])).rows[0];
  check("ACTION AGG: the document total counts BOTH prior notes", mils(agg.total) === 500_000, agg.total);
  check("ACTION AGG: sum(base_total) silently skips the unconverted one — 1140.00, not the true consumption",
    mils(agg.base_total) === mils(roundMoney(300 * Number(SRC_RATE), BASE)), agg.base_total);
  check("ACTION AGG: …and the unconverted COUNT is what makes that visible", Number(agg.unconverted) === 1, String(agg.unconverted));
  // The two together: a short base sum plus a flag that says "do not trust it".
  const wouldStandDown = Number(agg.unconverted) !== 0;
  check("ACTION AGG: so the closing rule stands down for this invoice", wouldStandDown);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DEBIT NOTE against a foreign purchase order — the twin
// ─────────────────────────────────────────────────────────────────────────────────────────────
const PO_TOTAL = "800.00", PO_TAX = "0";
const poBaseTotal = roundMoney(Number(PO_TOTAL) * Number(SRC_RATE), BASE);
const vendor = (await pool.query("insert into vendors (org_id,name) values ($1,'FX Vendor') returning id", [org])).rows[0].id;
const po = (await pool.query(
  `insert into purchase_orders (org_id,po_number,vendor_id,order_date,status,subtotal,tax_total,total,paid_amount,currency,
                                exchange_rate,base_total,base_tax_amount,created_by_id)
   values ($1,'PO-FX-1',$2,'2026-07-01','received',$3,$4,$3,'0','USD',$5,$6,'0',$7) returning id`,
  [org, vendor, PO_TOTAL, PO_TAX, SRC_RATE, poBaseTotal, user])).rows[0].id as number;
await post("2026-07-01", "Purchase order PO-FX-1 received", "purchase_order", po, [
  { accountId: acc.get("1200")!, debit: poBaseTotal, credit: "0" },
  { accountId: acc.get("2000")!, debit: "0", credit: poBaseTotal },
]);

const beforeDn = await bracket();
const dnFull = noteBaseAmounts({
  baseCurrency: BASE, source: { currency: "USD", exchangeRate: SRC_RATE, total: "999999.00", baseTotal: null, baseTaxAmount: null },
  note: { currency: "USD", total: PO_TOTAL, taxTotal: PO_TAX },
  priorNotes: NO_PRIOR,
});
check("the full debit note converts", dnFull.ok, dnFull.ok ? "" : dnFull.error);
if (dnFull.ok) {
  check("[4/DN] the note's rate IS the purchase order's stored rate", dnFull.exchangeRate === SRC_RATE,
    `${dnFull.exchangeRate} (PO ${SRC_RATE}, note date ${NOTE_RATE})`);
  const dnLines = debitNoteLines({ baseTotal: dnFull.baseTotal, apAccountId: acc.get("2000")!, inventoryAccountId: acc.get("1200")! });
  const allowedDn = new Set([acc.get("2000"), acc.get("1200")]);
  check("[2/DN] the debit note posts ONLY AP and inventory — no third line of any kind",
    dnLines.length === 2 && dnLines.every((l) => allowedDn.has(l.accountId)), JSON.stringify(dnLines));
  await post("2026-08-15", "Debit note DN-FX-1 issued", "debit_note", 1, dnLines);
  const afterDn = await bracket();
  check("BRACKET across the debit note", true,
    `2000 ${beforeDn.ap}→${afterDn.ap} / 1200 ${beforeDn.inv}→${afterDn.inv} / 4900 ${afterDn.fx}`);
  check("[1/DN] a 100% debit note returns base INVENTORY to exactly zero",
    mils(afterDn.inv) === 0, `1200 is ${afterDn.inv} — residual ${money(mils(afterDn.inv))}`);
  check("[1/DN] …and base ACCOUNTS PAYABLE to exactly zero",
    mils(afterDn.ap) === 0, `2000 is ${afterDn.ap} — residual ${money(mils(afterDn.ap))}`);
}
const dnHalf = noteBaseAmounts({
  baseCurrency: BASE, source: { currency: "USD", exchangeRate: SRC_RATE, total: "999999.00", baseTotal: null, baseTaxAmount: null },
  note: { currency: "USD", total: "400.00", taxTotal: "0" },
  priorNotes: NO_PRIOR,
});
check("[3/DN] a PARTIAL debit note converts at the PO's rate",
  dnHalf.ok && mils(dnHalf.baseTotal) === mils(roundMoney(400 * Number(SRC_RATE), BASE)),
  dnHalf.ok ? `${dnHalf.baseTotal} (source-rate ${roundMoney(400 * Number(SRC_RATE), BASE)})` : "blocked");
const dnLegacy = noteBaseAmounts({
  baseCurrency: BASE, source: { currency: "USD", exchangeRate: null, total: "999999.00", baseTotal: null, baseTaxAmount: null },
  note: { currency: "USD", total: PO_TOTAL, taxTotal: PO_TAX },
  priorNotes: NO_PRIOR,
});
check("[5/DN] a purchase order with NO stored conversion is REFUSED", !dnLegacy.ok,
  dnLegacy.ok ? `converted at ${dnLegacy.exchangeRate}` : dnLegacy.error.slice(0, 80));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE SWEEP — awkward rates, non-dividing amounts. A strand here is a defect in posting math.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const strands: string[] = [];
const RATES = ["3.75130000", "0.26700000", "0.33333333", "1.00000001", "17.94910000"];
const AMOUNTS = [["1000.00", "130.43"], ["333.33", "43.48"], ["0.03", "0.01"], ["99999.99", "13043.48"], ["7.77", "1.01"]] as const;

// (a) The identity: a FULL note at the source rate reproduces the invoice's own base figures.
// Tautological once the rule inherits — deliberately kept anyway, because it is the property a
// future refactor of the rounding would break, and it costs nothing.
for (const rate of RATES) {
  for (const [total, tax] of AMOUNTS) {
    const whole = noteBaseAmounts({ baseCurrency: BASE, source: { currency: "USD", exchangeRate: rate, total: "999999.00", baseTotal: null, baseTaxAmount: null },
      note: { currency: "USD", total, taxTotal: tax } , priorNotes: NO_PRIOR });
    if (!whole.ok) { strands.push(`rate ${rate} total ${total}: blocked — ${whole.error.slice(0, 40)}`); continue; }
    const srcBaseTotal = roundMoney(Number(total) * Number(rate), BASE);
    const srcBaseTax = roundMoney(Number(tax) * Number(rate), BASE);
    if (mils(whole.baseTotal) !== mils(srcBaseTotal)) strands.push(`rate ${rate} total ${total}: AR ${whole.baseTotal} vs invoice ${srcBaseTotal}`);
    const noteRevenue = subtractMoney(whole.baseTotal, whole.baseTaxAmount, BASE);
    const srcRevenue = subtractMoney(srcBaseTotal, srcBaseTax, BASE);
    if (mils(noteRevenue) !== mils(srcRevenue)) strands.push(`rate ${rate} total ${total}: revenue ${noteRevenue} vs invoice ${srcRevenue}`);
  }
}

// (b) The substantive half: SEVERAL PARTIAL notes that together credit the whole invoice. Each is
// rounded on its own, so their base amounts can sum to something other than the invoice's base
// total even at one shared rate — the same shape that stranded in the advance-refund sweep. This is
// the case that can genuinely fail, and a strand here is a defect in posting math, not a test to
// relax.
const partialStrands: string[] = [];
for (const rate of RATES) {
  for (const [total, tax] of AMOUNTS) {
    const cents = Math.round(Number(total) * 100);
    const taxCents = Math.round(Number(tax) * 100);
    if (cents < 3) continue; // cannot be split three ways in the document currency
    const splits = [Math.floor(cents / 3), Math.floor(cents / 3), cents - 2 * Math.floor(cents / 3)];
    const taxSplits = [Math.floor(taxCents / 3), Math.floor(taxCents / 3), taxCents - 2 * Math.floor(taxCents / 3)];
    const wholeBase = roundMoney(Number(total) * Number(rate), BASE);
    const wholeTax = roundMoney(Number(tax) * Number(rate), BASE);
    // The notes are issued IN SEQUENCE, each seeing what the ones before it consumed — which is
    // what the action does. Passing NO_PRIOR to all three would hide the closing rule entirely and
    // measure a situation the product cannot produce.
    let priorDoc = 0, sumBase = 0, sumTax = 0;
    let blocked = false;
    for (let i = 0; i < 3; i++) {
      const part = noteBaseAmounts({
        baseCurrency: BASE,
        source: { currency: "USD", exchangeRate: rate, total, baseTotal: wholeBase, baseTaxAmount: wholeTax },
        note: { currency: "USD", total: (splits[i] / 100).toFixed(2), taxTotal: (taxSplits[i] / 100).toFixed(2) },
        priorNotes: { total: (priorDoc / 100).toFixed(2), baseTotal: (sumBase / 1000).toFixed(3), baseTaxAmount: (sumTax / 1000).toFixed(3) },
      });
      if (!part.ok) { blocked = true; break; }
      priorDoc += splits[i];
      sumBase += mils(part.baseTotal);
      sumTax += mils(part.baseTaxAmount);
    }
    if (blocked) { partialStrands.push(`rate ${rate} total ${total}: a split was blocked`); continue; }
    if (sumBase !== mils(wholeBase)) partialStrands.push(`rate ${rate} total ${total}: 3 partials sum to ${money(sumBase)}, whole is ${wholeBase} (${money(sumBase - mils(wholeBase))})`);
    if (sumTax !== mils(wholeTax)) partialStrands.push(`rate ${rate} tax ${tax}: 3 partial taxes sum to ${money(sumTax)}, whole is ${wholeTax} (${money(sumTax - mils(wholeTax))})`);
  }
}

check("SWEEP (a): 25 awkward rate/amount pairs — a FULL note reproduces the invoice's base figures",
  strands.length === 0, strands.slice(0, 6).join(" | "));
check("SWEEP (b): 25 pairs split into THREE SEQUENTIAL partial notes — their base amounts sum to the whole",
  partialStrands.length === 0, `${partialStrands.length} strand(s):\n      ${partialStrands.join("\n      ")}`);

await sweepDb();
await pool.end();
console.log("\nCredit- and debit-note FX inheritance — the invariant, the refusals, the sweep\n");
for (const [ok, name, extra] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  << ${extra}` : ""}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks`);
console.log(failed === 0 ? "NOTE FX PASS" : `NOTE FX FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
