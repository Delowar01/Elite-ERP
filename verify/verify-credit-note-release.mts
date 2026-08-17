// Run via `npm run verify:credit-note-release` — tsx with the react-server condition.

/**
 * Credit notes against an invoice settled by an advance.
 *
 * The defect this closes: invoice 10,000, advance 10,000 applied, AR = 0. A credit note for 2,000
 * posted `Cr 1100 2,000` and drove that customer's receivable to −2,000 while they genuinely held
 * 2,000 of value — the negative-receivable state the whole 2300 model exists to prevent, arriving
 * through a different door. The over-settled portion now goes back to 2300 as available advance:
 *
 * ```text
 *   note:    Dr 4000 2,000 / Cr 1100 2,000
 *   release: Dr 1100 2,000 / Cr 2300 2,000
 *   net:     Dr 4000 2,000 / Cr 2300 2,000 — AR untouched at 0
 * ```
 *
 * Which is the first release that is PARTIAL: a credit note releases a fraction of one allocation,
 * so the allocation cannot simply be flagged. Three claims are proven here, at the level each one
 * actually exists:
 *
 *  1. **The decision** — how much a note releases (`creditNoteReleaseAmount`), including the two
 *     cases where the answer is "less than the note" and the one where it is "nothing".
 *  2. **The split** — a run of partial releases gives back EXACTLY what the allocation took, to the
 *     minor unit, over awkward figures a hand-picked test would never choose.
 *  3. **The mechanism** — against a real database: partial release, cumulative release, LIFO,
 *     idempotency by cause, reversal, and 2300 landing exactly on its starting figure.
 *
 * The wiring of all three into `issueCreditNoteAction` is proven in the browser tier, which is the
 * only place a server action with a session can actually be reached.
 */
import { db } from "../src/db";
// Imported from their own modules rather than the barrel — under tsx's ESM resolution the barrel's
// re-export chain does not expose these names.
import { advanceApplicationsTable } from "../src/db/schema/advance-applications";
import { journalEntriesTable, journalLinesTable } from "../src/db/schema/accounting";
import {
  releaseAllocations, reverseReleasesOfCause, releaseShareOf, creditNoteReleaseAmount,
  activeAllocationTotal, planAllocations, type AdvancePot,
} from "../src/lib/advance-allocations";
import { roundMoney, moneyEpsilon } from "../src/lib/currency/currencies";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const mils = (v: string | number) => Math.round(Number(v) * 1000);

// ---------------------------------------------------------------------------------------------
// 1. THE DECISION — how much of an invoice's allocations a credit note releases.
// ---------------------------------------------------------------------------------------------

const decide = (invoiceTotal: string, paid: string, note: string, allocated: string) =>
  creditNoteReleaseAmount({ invoiceTotal, invoicePaidAmount: paid, creditNoteTotal: note, activeAllocationTotal: allocated, docCurrency: "SAR" });

check("fully advance-settled: a 2,000 note against a 10,000 invoice paid by a 10,000 advance releases 2,000",
  mils(decide("10000", "10000", "2000", "10000")) === 2000000, decide("10000", "10000", "2000", "10000"));
check("the note may not release more than it credits — a 2,000 note never returns 3,000",
  mils(decide("10000", "10000", "2000", "10000")) <= 2000000);
check("PARTIALLY PAID: 3,000 advance on a 10,000 invoice, 5,000 note — releases NOTHING, the invoice simply owes 2,000",
  mils(decide("10000", "3000", "5000", "3000")) === 0,
  `releasing here would strand the client's 3,000 as a floating advance while the invoice showed 5,000 outstanding — got ${decide("10000", "3000", "5000", "3000")}`);
check("MIXED settlement: 8,000 advance + 2,000 cash, 3,000 note — releases 3,000, all of it from the advance",
  mils(decide("10000", "10000", "3000", "8000")) === 3000000, decide("10000", "10000", "3000", "8000"));
check("MIXED settlement beyond the advance: 2,000 advance + 8,000 cash, 5,000 note — releases only the 2,000 that IS advance",
  mils(decide("10000", "10000", "5000", "2000")) === 2000000,
  `the cash-paid remainder still drives AR negative; that is the backlog item this cap deliberately does not reach — got ${decide("10000", "10000", "5000", "2000")}`);
check("CASH-PAID: no allocation behind the invoice releases nothing at all",
  mils(decide("10000", "10000", "2000", "0")) === 0);
check("a note that exactly cancels a fully advance-settled invoice releases the WHOLE advance",
  mils(decide("10000", "10000", "10000", "10000")) === 10000000);

// ---------------------------------------------------------------------------------------------
// 2. THE SPLIT — a run of partial releases must give back exactly what the allocation took.
//
// Hand-picked figures divide evenly; the residual rule is invisible in them. Awkward ones over a
// crossed pair of minor units are where a proportional-always release strands thousandths in 2300
// permanently, and where the two-minor-units error (rounding a base figure at the DOCUMENT
// currency's unit) produces amounts the database cannot even store.
// ---------------------------------------------------------------------------------------------

let strands = 0;
let worst = "";
let sweeps = 0;
for (const [docCurrency, baseCurrency] of [["USD", "SAR"], ["KWD", "SAR"], ["USD", "KWD"], ["SAR", "SAR"]] as const) {
  const docStep = moneyEpsilon(docCurrency) * 2;
  for (let i = 0; i < 60; i++) {
    // Each figure rounded at the unit for ITS role: the document amount at the advance/invoice
    // currency's, both base figures at the base currency's.
    const applied = roundMoney(37 + ((i * 977) % 9631) / 97, docCurrency);
    const carried = roundMoney(Number(applied) * (2.6 + ((i * 31) % 89) / 100), baseCurrency);
    const arCleared = roundMoney(Number(applied) * (2.6 + ((i * 53) % 97) / 100), baseCurrency);

    // Release it in k uneven parts, the last of which closes it out.
    const k = 2 + (i % 4);
    let effective = { id: 0, appliedAmount: applied, carriedBase: carried, arCleared };
    let sumCarried = 0;
    let sumAr = 0;
    let sumDoc = 0;
    for (let part = 0; part < k; part++) {
      const last = part === k - 1;
      const draw = last
        ? effective.appliedAmount
        : roundMoney(Math.max(docStep, Number(effective.appliedAmount) / (k - part) + ((part % 2) ? docStep : -docStep)), docCurrency);
      const share = releaseShareOf({ effective, releaseAmount: draw, baseCurrency, docCurrency });
      // Every share must be STORABLE — a figure rounded at the wrong minor unit is not a state the
      // system can hold, so a sweep that produced one would be exercising an impossible input.
      if (share.carried !== roundMoney(share.carried, baseCurrency) || share.arCleared !== roundMoney(share.arCleared, baseCurrency)) {
        strands++;
        worst = `unstorable share ${share.carried}/${share.arCleared} in ${baseCurrency}`;
      }
      sumCarried += mils(share.carried);
      sumAr += mils(share.arCleared);
      sumDoc += mils(draw);
      effective = {
        id: 0,
        appliedAmount: roundMoney(Number(effective.appliedAmount) - Number(draw), docCurrency),
        carriedBase: roundMoney(Number(effective.carriedBase) - Number(share.carried), baseCurrency),
        arCleared: roundMoney(Number(effective.arCleared) - Number(share.arCleared), baseCurrency),
      };
    }
    sweeps++;
    if (sumCarried !== mils(carried) || sumAr !== mils(arCleared) || sumDoc !== mils(applied)) {
      strands++;
      worst = `${docCurrency}/${baseCurrency} applied ${applied} carried ${carried} ar ${arCleared} in ${k} parts → ${sumCarried / 1000}/${sumAr / 1000}/${sumDoc / 1000}`;
    }
  }
}
check(`PROPERTY SWEEP (${sweeps} allocations, 2–5 uneven partial releases each, crossed minor units): every run returns the allocation EXACTLY`,
  strands === 0, worst);

// ---------------------------------------------------------------------------------------------
// 3. THE MECHANISM — against a real database.
// ---------------------------------------------------------------------------------------------

const FIXTURE = "verifycnrel_";
async function sweepDb() {
  await pool.query("delete from advance_application_releases where org_id in (select id from orgs where name like $1)", [`${FIXTURE}%`]);
  await pool.query("delete from advance_applications where org_id in (select id from orgs where name like $1)", [`${FIXTURE}%`]);
  await pool.query(
    `delete from journal_lines where journal_entry_id in
       (select e.id from journal_entries e join orgs o on o.id = e.org_id where o.name like $1)`, [`${FIXTURE}%`]);
  await pool.query("delete from journal_entries where org_id in (select id from orgs where name like $1)", [`${FIXTURE}%`]);
  await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);
}
await sweepDb();

const org = (await pool.query("insert into orgs (name, currency, country) values ($1,'SAR','Saudi Arabia') returning id", [`${FIXTURE}${uniq()}`])).rows[0].id as number;
const user = (await pool.query(
  "insert into users (org_id,name,email,password_hash,role) values ($1,'C','cnrel_" + uniq() + "@t.dev','x','owner') returning id", [org])).rows[0].id as number;
for (const [code, name, type, nb] of [
  ["1000", "Cash", "asset", "debit"], ["1100", "Accounts Receivable", "asset", "debit"],
  ["2300", "Customer Advances", "liability", "credit"], ["4000", "Sales Revenue", "revenue", "credit"],
  ["4900", "Exchange Gain/Loss", "revenue", "credit"],
] as const) {
  await pool.query("insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,true)", [org, code, name, type, nb]);
}
const acc = new Map<string, number>((await pool.query("select id, code from accounts where org_id=$1", [org])).rows.map((r) => [r.code, r.id]));
const bank = (await pool.query("insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Bank',$2) returning id", [org, acc.get("1000")])).rows[0].id as number;
const cust = (await pool.query("insert into customers (org_id,name) values ($1,'Credit Client') returning id", [org])).rows[0].id as number;

const glOf = async (code: string) => {
  const a = acc.get(code)!;
  const r = (await pool.query(
    `select coalesce(sum(l.debit),0)::text dr, coalesce(sum(l.credit),0)::text cr from journal_lines l
       join journal_entries e on e.id = l.journal_entry_id where e.org_id=$1 and l.account_id=$2`, [org, a])).rows[0];
  return { debit: Number(r.dr), credit: Number(r.cr), net: Number(r.cr) - Number(r.dr) };
};
const ledgerBalanced = async () => {
  const r = (await pool.query(
    `select coalesce(sum(l.debit),0)::numeric(15,3)::text dr, coalesce(sum(l.credit),0)::numeric(15,3)::text cr
       from journal_lines l join journal_entries e on e.id=l.journal_entry_id where e.org_id=$1`, [org])).rows[0];
  return r.dr === r.cr;
};

/** A customer advance + the invoice it settles, wired exactly as the app wires them. */
async function scenario(args: {
  currency: string; amount: string; rate: string; carried: string;
  invoiceTotal: string; invoiceBaseTotal: string; invoiceRate: string;
}) {
  const pf = (await pool.query(
    `insert into proforma_invoices (org_id,proforma_number,customer_id,status,issue_date,subtotal,tax_total,total,currency,created_by_id)
     values ($1,$2,$3,'sent','2026-08-01','0','0',$4,$5,$6) returning id`,
    [org, `PICN-${uniq()}`, cust, args.amount, args.currency, user])).rows[0].id as number;
  const advance = (await pool.query(
    `insert into payments (org_id,direction,bank_account_id,amount,payment_date,kind,currency,exchange_rate,base_amount,base_applied_amount,proforma_invoice_id,created_by_id)
     values ($1,'in',$2,$3,'2026-08-01','advance_receipt',$4,$5,$6,$6,$7,$8) returning id`,
    [org, bank, args.amount, args.currency, args.rate, args.carried, pf, user])).rows[0].id as number;
  // The receipt's OWN journal (Dr Bank / Cr 2300): without it 2300 starts at zero and every
  // "returns to where it started" assertion below would be measuring the wrong baseline.
  const receiptEntry = (await pool.query(
    `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
     values ($1,'2026-08-01','Advance received','payment',$2,$3) returning id`, [org, advance, user])).rows[0].id as number;
  await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,$4,'0'),($1,$3,'0',$4)",
    [receiptEntry, acc.get("1000"), acc.get("2300"), args.carried]);

  const invoice = (await pool.query(
    `insert into sales_invoices (org_id,invoice_number,customer_id,issue_date,status,subtotal,discount,tax_total,total,paid_amount,base_paid_amount,base_total,base_tax_amount,exchange_rate,currency,created_by_id)
     values ($1,$2,$3,'2026-08-05','sent',$4,'0','0',$4,'0','0',$5,'0',$6,$7,$8) returning id`,
    [org, `INVCN-${uniq()}`, cust, args.invoiceTotal, args.invoiceBaseTotal, args.invoiceRate, args.currency, user])).rows[0].id as number;
  const invEntry = (await pool.query(
    `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
     values ($1,'2026-08-05','Invoice posted','sales_invoice',$2,$3) returning id`, [org, invoice, user])).rows[0].id as number;
  await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,$4,'0'),($1,$3,'0',$4)",
    [invEntry, acc.get("1100"), acc.get("4000"), args.invoiceBaseTotal]);
  return { pf, advance, invoice, currency: args.currency };
}

/** Apply `amount` of the advance to the invoice — the same engine the action runs. */
async function apply(s: { advance: number; invoice: number; currency: string }, amount: string) {
  const pay = (await pool.query("select amount::text, base_applied_amount::text, currency from payments where id=$1", [s.advance])).rows[0];
  const consumed = (await pool.query(
    `select coalesce(sum(a.applied_amount),0)::text a, coalesce(sum(a.carried_base),0)::text c
       from advance_applications a where a.org_id=$1 and a.advance_payment_id=$2 and a.released_at is null`, [org, s.advance])).rows[0];
  const pot: AdvancePot = { amount: pay.amount, carriedBase: pay.base_applied_amount, consumedAmount: consumed.a, consumedCarried: consumed.c, currency: pay.currency };
  const inv = (await pool.query(
    "select total::text, paid_amount::text, base_paid_amount::text, base_total::text, exchange_rate::text, currency from sales_invoices where id=$1", [s.invoice])).rows[0];
  const planned = planAllocations({
    pots: [{ paymentId: s.advance, pot }],
    limitAmount: amount,
    invoice: { total: inv.total, paidAmount: inv.paid_amount, basePaidAmount: inv.base_paid_amount, baseTotal: inv.base_total, exchangeRate: inv.exchange_rate, currency: inv.currency },
    baseCurrency: "SAR",
    advancesAccountId: acc.get("2300")!,
    arAccountId: acc.get("1100")!,
    fxAccountId: acc.get("4900")!,
  });
  if (!planned.ok) throw new Error(planned.error);
  const step = planned.plan[0];
  await db.transaction(async (tx) => {
    const [alloc] = await tx.insert(advanceApplicationsTable).values({
      orgId: org, advancePaymentId: s.advance, salesInvoiceId: s.invoice,
      appliedAmount: step.appliedAmount, carriedBase: step.carriedBase, arCleared: step.arCleared,
      appliedDate: "2026-08-06", createdById: user,
    }).returning({ id: advanceApplicationsTable.id });
    const [entry] = await tx.insert(journalEntriesTable).values({
      orgId: org, entryDate: "2026-08-06", memo: "Advance applied", sourceType: "advance_application",
      sourceId: alloc.id, createdById: user,
    }).returning({ id: journalEntriesTable.id });
    await tx.insert(journalLinesTable).values(step.lines.map((l) => ({ journalEntryId: entry.id, ...l })));
  });
  await pool.query(
    "update sales_invoices set paid_amount = (paid_amount::numeric + $2), base_paid_amount = (base_paid_amount::numeric + $3) where id=$1",
    [s.invoice, step.appliedAmount, step.arCleared]);
  return step;
}

/** Release on behalf of a credit note — the call `issueCreditNoteAction` makes. */
const releaseFor = (s: { invoice: number; currency: string }, noteId: number, limitAmount: string) =>
  db.transaction((tx) => releaseAllocations(tx, {
    orgId: org, userId: user, salesInvoiceId: s.invoice,
    reason: "credit_note", causeType: "credit_note", causeId: noteId,
    date: "2026-08-10", memoSubject: `credit note CN-${noteId}`,
    baseCurrency: "SAR", docCurrency: s.currency, limitAmount,
  }));

/**
 * Issue a credit note the way the action does: post ITS entry (Dr 4000 / Cr 1100), decide the
 * release, release it, and move the invoice's paid figures by the net.
 *
 * The note's own entry has to be here. Releasing without it would assert half the claim — the whole
 * point is that the release's `Dr 1100` answers the note's `Cr 1100`, and a suite that never posts
 * the credit cannot tell a receivable held at zero from one nobody touched. The note converts at
 * ITS OWN date's rate, exactly as `captureBaseAmounts` does, which is why one note below uses a
 * different rate from the invoice.
 */
let releasesMade = 0;
async function issueNote(s: { invoice: number; currency: string }, noteId: number, total: string, rate = "1") {
  const baseTotal = roundMoney(Number(total) * Number(rate), "SAR");
  const inv = (await pool.query("select total::text, paid_amount::text, base_paid_amount::text from sales_invoices where id=$1", [s.invoice])).rows[0];
  const entry = (await pool.query(
    `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
     values ($1,'2026-08-10',$2,'credit_note',$3,$4) returning id`, [org, `Credit note CN-${noteId} issued`, noteId, user])).rows[0].id as number;
  await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,$4,'0'),($1,$3,'0',$4)",
    [entry, acc.get("4000"), acc.get("1100"), baseTotal]);

  const allocated = await db.transaction((tx) => activeAllocationTotal(tx, org, s.invoice, s.currency));
  const releaseAmount = creditNoteReleaseAmount({
    invoiceTotal: inv.total, invoicePaidAmount: inv.paid_amount, creditNoteTotal: total,
    activeAllocationTotal: allocated, docCurrency: s.currency,
  });
  const releases = Number(releaseAmount) > moneyEpsilon(s.currency) ? await releaseFor(s, noteId, releaseAmount) : [];
  releasesMade += releases.length;
  const releasedDoc = releases.reduce((sum, r) => sum + Number(r.appliedAmount), 0);
  const releasedAr = releases.reduce((sum, r) => sum + Number(r.arCleared), 0);
  await pool.query("update sales_invoices set paid_amount=$2, base_paid_amount=$3 where id=$1", [
    s.invoice,
    roundMoney(Number(inv.paid_amount) + Number(total) - releasedDoc, s.currency),
    roundMoney(Number(inv.base_paid_amount) + Number(baseTotal) - releasedAr, "SAR"),
  ]);
  return { releases, baseTotal };
}

/** Reverse that note: reverse its entry, re-apply what it released, and undo its paid movement. */
async function reverseNote(s: { invoice: number; currency: string }, noteId: number, total: string, baseTotal: string) {
  const entry = (await pool.query(
    `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
     values ($1,'2026-08-12',$2,'credit_note',$3,$4) returning id`, [org, `Credit note CN-${noteId} reversed`, noteId, user])).rows[0].id as number;
  await pool.query("insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,$4,'0'),($1,$3,'0',$4)",
    [entry, acc.get("1100"), acc.get("4000"), baseTotal]);
  const undone = await db.transaction((tx) => reverseReleasesOfCause(tx, {
    orgId: org, userId: user, causeType: "credit_note", causeId: noteId,
    date: "2026-08-12", memoSubject: `credit note CN-${noteId} reversed`,
  }));
  const inv = (await pool.query("select paid_amount::text, base_paid_amount::text from sales_invoices where id=$1", [s.invoice])).rows[0];
  await pool.query("update sales_invoices set paid_amount=$2, base_paid_amount=$3 where id=$1", [
    s.invoice,
    roundMoney(Number(inv.paid_amount) - Number(total) + undone.reduce((sum, r) => sum + Number(r.appliedAmount), 0), s.currency),
    roundMoney(Number(inv.base_paid_amount) - Number(baseTotal) + undone.reduce((sum, r) => sum + Number(r.arCleared), 0), "SAR"),
  ]);
  return undone;
}

// ---- base currency: one advance fully settling one invoice, credited three times ----

const sar = await scenario({
  currency: "SAR", amount: "10000.00", rate: "1", carried: "10000.00",
  invoiceTotal: "10000.00", invoiceBaseTotal: "10000.00", invoiceRate: "1",
});
const wholeApplication = await apply(sar, "10000.00");
check("fixture: the 10,000 advance settles the 10,000 invoice in one allocation, AR at zero",
  mils(wholeApplication.appliedAmount) === 10000000 && (await glOf("1100")).net === 0, JSON.stringify(await glOf("1100")));
check("fixture: 2300 is fully drawn down — the client holds nothing available", (await glOf("2300")).net === 0);

const { releases: first } = await issueNote(sar, 9001, "2000.00");
check("a 2,000 credit note releases 2,000 — PART of a 10,000 allocation, which no flag on the row could express",
  first.length === 1 && mils(first[0].appliedAmount) === 2000000 && !first[0].fullyReleased, JSON.stringify(first));
check("THE DEFECT: AR is back where it was — the release's Dr 1100 answers the note's Cr 1100 instead of driving the receivable negative",
  (await glOf("1100")).net === 0, JSON.stringify(await glOf("1100")));
check("2300 holds the 2,000 the client now has available again", mils((await glOf("2300")).net) === 2000000, String((await glOf("2300")).net));
check("LEDGER BALANCED after the partial release", await ledgerBalanced());

const allocRow = (await pool.query("select id, applied_amount::text, released_at from advance_applications where org_id=$1", [org])).rows[0];
check("the allocation row is NOT rewritten and NOT marked released — it still records what it posted",
  mils(allocRow.applied_amount) === 10000000 && allocRow.released_at === null, JSON.stringify(allocRow));
check("its EFFECTIVE figure is what is left: 8,000 still settling the invoice",
  mils(await db.transaction((tx) => activeAllocationTotal(tx, org, sar.invoice, "SAR"))) === 8000000);

const replay = await releaseFor(sar, 9001, "2000.00");
check("replaying the SAME credit note releases nothing — idempotency is keyed on the cause, not the allocation",
  replay.length === 0 && mils((await glOf("2300")).net) === 2000000);

const { releases: second, baseTotal: secondBase } = await issueNote(sar, 9002, "3000.00");
check("a SECOND credit note releases another 3,000 from the same allocation — legitimately, and not suppressed as a duplicate",
  second.length === 1 && mils(second[0].appliedAmount) === 3000000 && mils((await glOf("2300")).net) === 5000000,
  JSON.stringify(second));

const { releases: third } = await issueNote(sar, 9003, "5000.00");
check("the credit note that exhausts the allocation marks it released and returns the exact remainder",
  third.length === 1 && third[0].fullyReleased && mils(third[0].appliedAmount) === 5000000);
check("ROUND TRIP: 2300 stands exactly on the 10,000 received, after three partial releases",
  mils((await glOf("2300")).net) === 10000000, String((await glOf("2300")).net));
check("AR is still exactly zero across all three — every release answered its own note's credit",
  (await glOf("1100")).net === 0, JSON.stringify(await glOf("1100")));
check("LEDGER BALANCED after the allocation is fully released in pieces", await ledgerBalanced());
check("nothing further is released once the allocation is empty — a bare release call, past the point any note could reach",
  (await releaseFor(sar, 9004, "1000.00")).length === 0 && mils((await glOf("2300")).net) === 10000000);

// ---- reversing a credit note re-applies what it released ----

const undone = await reverseNote(sar, 9002, "3000.00", secondBase);
check("reversing the second note re-applies exactly its own 3,000 — not the whole allocation",
  undone.length === 1 && mils(undone[0].appliedAmount) === 3000000, JSON.stringify(undone));
check("2300 drops back by that 3,000 — the client no longer holds money a reversed note gave them",
  mils((await glOf("2300")).net) === 7000000, String((await glOf("2300")).net));
check("the allocation is live again — its `releasedAt` is lifted, so the advance is not available twice over",
  (await pool.query("select released_at from advance_applications where id=$1", [allocRow.id])).rows[0].released_at === null);
check("the re-applied 3,000 settles the invoice again",
  mils(await db.transaction((tx) => activeAllocationTotal(tx, org, sar.invoice, "SAR"))) === 3000000);
check("LEDGER BALANCED after the reversal", await ledgerBalanced());

// ---- foreign advance: uneven partial releases must not strand a thousandth ----

const usd = await scenario({
  currency: "USD", amount: "1000.00", rate: "3.76", carried: "3760.00",
  invoiceTotal: "1000.00", invoiceBaseTotal: "3800.00", invoiceRate: "3.80",
});
const usdApplication = await apply(usd, "1000.00");
check("FX fixture: USD 1,000 carried at 3,760.00 settles an invoice booked at 3.80 — 40.00 of realized FX",
  mils(usdApplication.carriedBase) === 3760000 && mils(usdApplication.arCleared) === 3800000, JSON.stringify(usdApplication));
const gl2300BeforeUsd = (await glOf("2300")).net;

// Three notes covering the invoice, the middle one converting at a DIFFERENT rate from the invoice
// (3.90 against 3.80) — because a credit note converts at its own issue date, and the release must
// still give back the allocation's own carried value rather than anything derived from the note.
const thirds = [] as { carried: string; ar: string }[];
for (const [i, [part, rate]] of ([["333.33", "3.80"], ["333.33", "3.90"], ["333.34", "3.80"]] as const).entries()) {
  const { releases } = await issueNote(usd, 9100 + i, part, rate);
  // Defensive: a mutation that stops a note releasing anything must be REPORTED as a failed
  // assertion, not crash the run before any result is printed.
  thirds.push({ carried: releases[0]?.carriedBase ?? "0", ar: releases[0]?.arCleared ?? "0" });
}
check("three uneven thirds of a foreign allocation sum to its carried base EXACTLY — 3,760.00, no thousandth stranded",
  thirds.reduce((s, t) => s + mils(t.carried), 0) === 3760000, thirds.map((t) => t.carried).join(" + "));
check("and to its cleared AR exactly — 3,800.00",
  thirds.reduce((s, t) => s + mils(t.ar), 0) === 3800000, thirds.map((t) => t.ar).join(" + "));
check("2300 returns to exactly the carried value of the foreign advance",
  mils((await glOf("2300")).net - gl2300BeforeUsd) === 3760000, String((await glOf("2300")).net - gl2300BeforeUsd));
check("the FX line reverses with it — 4900 nets to zero over the round trip, no realized gain invented by releasing",
  (await glOf("4900")).net === 0, JSON.stringify(await glOf("4900")));
check("LEDGER BALANCED after the foreign round trip", await ledgerBalanced());

// ---- invariants over the whole fixture org ----

const received = Number((await pool.query(
  "select coalesce(sum(base_applied_amount),0) net from payments where org_id=$1 and kind='advance_receipt'", [org])).rows[0].net);
const stillApplied = Number((await pool.query(
  `select coalesce(sum(a.carried_base - coalesce((
            select sum(r.released_carried) from advance_application_releases r
             where r.allocation_id = a.id and r.reversed_at is null), 0)), 0) net
     from advance_applications a where a.org_id=$1 and a.released_at is null`, [org])).rows[0].net);
const availableCarried = received - stillApplied;
check("§9 INVARIANT: GL 2300 equals the carried value of every remaining available advance",
  mils((await glOf("2300")).net) === mils(availableCarried) && mils(availableCarried) > 0,
  `GL ${(await glOf("2300")).net} vs available ${availableCarried}`);

const arSubledger = (await pool.query(
  "select coalesce(sum(base_total::numeric - base_paid_amount::numeric),0) net from sales_invoices where org_id=$1 and status <> 'void'", [org])).rows[0].net;
const arGl = (await glOf("1100")).debit - (await glOf("1100")).credit;
check("§K INVARIANT: GL 1100 equals the invoice subledger's outstanding base AR",
  mils(arGl) === mils(arSubledger), `GL ${arGl} vs subledger ${arSubledger}`);
// The residual is NOT zero, and that is pre-existing behaviour worth naming rather than hiding: a
// credit note converts at its own issue date, so crediting a foreign invoice at 3.90 that was
// booked at 3.80 leaves a base-currency tail even when the document currency nets exactly to zero.
// Nothing here introduced it; the invariant holds because both sides move by the same figures.
check("a foreign note converting at its own rate leaves a base tail — ledger and subledger carry it TOGETHER, which is what the invariant asserts",
  mils(arGl) !== 0 && mils(arGl) === mils(arSubledger), `${arGl}`);

const orphaned = (await pool.query(
  `select count(*)::int n from advance_application_releases r
     left join advance_applications a on a.id = r.allocation_id where a.id is null and r.org_id=$1`, [org])).rows[0].n;
check("no release row is orphaned from its allocation", orphaned === 0);
const overReleased = (await pool.query(
  `select count(*)::int n from advance_applications a
    where a.org_id=$1 and coalesce((select sum(r.released_amount) from advance_application_releases r
       where r.allocation_id = a.id and r.reversed_at is null), 0) > a.applied_amount + 0.0005`, [org])).rows[0].n;
check("no allocation has been released for more than it applied", overReleased === 0);

const releaseEntries = (await pool.query(
  `select count(*)::int n from journal_entries where org_id=$1 and source_type='advance_application_release'`, [org])).rows[0].n;
const releaseRows = (await pool.query("select count(*)::int n from advance_application_releases where org_id=$1", [org])).rows[0].n;
check("every release row posted exactly one journal entry, keyed by the RELEASE — not by the allocation, which several releases share",
  releaseEntries === releaseRows && releaseRows === releasesMade,
  `${releaseEntries} entries / ${releaseRows} rows / ${releasesMade} releases actually made`);

await sweepDb();
await pool.end();
let allOk = true;
for (const [c, n, x] of results) { if (!c) allOk = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "CREDIT NOTE RELEASE PASS" : "CREDIT NOTE RELEASE FAIL");
process.exit(allOk ? 0 : 1);
