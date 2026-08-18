/**
 * Post the missing OPENING BALANCE journal entry for every bank account that has one recorded in
 * `bank_accounts.opening_balance` and no entry in the ledger.
 *
 * Run read-only:  npx tsx --env-file-if-exists=.env scripts/migrations/2026-08-18-bank-opening-balance-journals.ts
 * Run for real:   … same command … --apply
 * One tenant:     … --org 42
 * Other contra:   … --equity-account 3100
 *
 * ## Why
 *
 * Creating a bank account used to write a number into a column and post nothing. The bank-accounts
 * page then rendered `Number(openingBalance) + <ledger balance>` and no other surface read the
 * column at all — so the money appeared on exactly one screen and in no Trial Balance, Balance
 * Sheet or Cash Flow. Both statements balanced without it, because nothing ever had to compensate
 * for money that was never posted. The rule is in verify/README.md: a displayed balance is a
 * function of the ledger and nothing else.
 *
 * The application now posts the entry at creation and refuses to edit it afterwards. This script is
 * for the accounts created before that.
 *
 * ## Detection, which is also the idempotency key
 *
 * A candidate is a bank account with a NON-ZERO `opening_balance` and NO journal entry keyed
 * `(source_type = 'bank_opening', source_id = <bank account id>)`. Those are not two separate
 * checks — the second IS the key, so a re-run after a successful apply matches nothing.
 *
 * The PAIR matters. `source_id` is drawn from a different table for every source type, each with
 * its own sequence, so the same integer is a live id in several of them at once. A check on the id
 * alone would find an unrelated `payment` or `sales_invoice` entry and conclude the opening balance
 * was already posted. That exact mistake put 70 statement lines on a stranger's account earlier in
 * this project; verify-bank-opening seeds a deliberate collision to prove this one does not repeat
 * it.
 *
 * ## Date
 *
 * `opening_date` when the column is populated (every account created since the repair), otherwise
 * the account's `created_at` date. The date is what the old scalar was missing and is why it could
 * not appear on a statement.
 *
 * ## Deploy order — the OPPOSITE of the advance backfill's, for the opposite reason
 *
 *   advance backfill:  schema → backfill → deploy code   (code first ⇒ double-spend window)
 *   THIS one:          deploy code → backfill            (backfill first ⇒ a believable wrong number)
 *
 * Run this BEFORE the code that removes the render-time addition and the page shows DOUBLE the true
 * figure — 60,000 for a 30,000 account. That is a plausible number a user could act on. Deploy the
 * code first and the window shows 0 instead: understated, and self-evidently a mid-migration state
 * rather than a balance. Understated and obviously broken beats overstated and believable. The full
 * reasoning is in the runbook in docs/backlog.md, next to the migration whose ordering is the
 * mirror image of this one.
 *
 * ## Refusals
 *
 * The script exits non-zero rather than posting anything questionable:
 *   - a candidate's GL account is missing, inactive, or not an asset account;
 *   - the contra account does not exist in that org's chart, or is not equity/liability;
 *   - a `bank_opening` entry already exists for a candidate carrying a DIFFERENT amount than the
 *     column says. That one is the important one: it means the column was changed after the entry
 *     was posted, which is a CHANGED fact rather than a missing one, and papering over it would
 *     silently pick a winner between two figures a human needs to reconcile.
 *
 * The product has no closed-period concept — nothing locks a fiscal period against posting — so
 * there is no period check here. When one lands, this is a path that must respect it.
 */
import { Pool } from "pg";

const APPLY = process.argv.includes("--apply");
const argAfter = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};
const ORG = argAfter("--org") === null ? null : Number(argAfter("--org"));
const EQUITY_CODE = argAfter("--equity-account") ?? "3000";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Row = Record<string, string | number | null>;
const mils = (v: string | number | null) => Math.round(Number(v ?? 0) * 1000);
const money = (v: string | number | null) => Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

async function main() {
  console.log(`\nBANK OPENING BALANCES → JOURNAL ENTRIES — ${APPLY ? "APPLY" : "DRY RUN (read-only)"}${ORG === null ? "" : ` — org ${ORG} only`}\n`);

  const orgFilter = ORG === null ? "" : ` and b.org_id = ${ORG}`;

  // The CHANGED-fact refusal, checked before anything else: an entry exists and disagrees with the
  // column. Deliberately NOT scoped to candidates — a candidate by definition has no entry, so
  // scoping it there would make it unfirable.
  //
  // Compared as the SIGNED movement on the bank's own GL account, not as a sum of debits. An
  // overdraft posts its amount as a CREDIT to the bank account, so a debit-sum comparison reads
  // -1,200 against +1,200 and refuses every overdraft in the database on the second run. The suite
  // caught exactly that.
  const disagreeing = (await pool.query<Row>(`
    select b.id, b.org_id, o.name as org, b.name, b.opening_balance::text as col,
           (select coalesce(sum(l.debit) - sum(l.credit), 0)::text from journal_lines l
             where l.journal_entry_id = e.id and l.account_id = b.gl_account_id) as posted
      from bank_accounts b
      join orgs o on o.id = b.org_id
      join journal_entries e on e.org_id = b.org_id and e.source_type = 'bank_opening' and e.source_id = b.id
     where true${orgFilter}
     order by b.org_id, b.id`)).rows;
  const changed = disagreeing.filter((r) => mils(r.col) !== mils(r.posted));

  const candidates = (await pool.query<Row>(`
    select b.id, b.org_id, o.name as org, b.name, b.currency,
           b.opening_balance::text as amount,
           coalesce(b.opening_date::text, b.created_at::date::text) as entry_date,
           b.opening_date is null as date_inferred,
           b.gl_account_id, g.code as gl_code, g.name as gl_name, g.type as gl_type, g.is_active as gl_active,
           b.opening_contra_account_id,
           o.currency as base_currency
      from bank_accounts b
      join orgs o on o.id = b.org_id
      left join accounts g on g.id = b.gl_account_id
     where b.opening_balance <> 0${orgFilter}
       and not exists (
         select 1 from journal_entries e
          where e.org_id = b.org_id and e.source_type = 'bank_opening' and e.source_id = b.id)
     order by b.org_id, b.id`)).rows;

  console.log(`  bank accounts with a non-zero opening balance and NO opening entry : ${candidates.length}`);
  console.log(`  bank accounts whose posted entry DISAGREES with the column         : ${changed.length}\n`);

  if (changed.length > 0) {
    console.log("REFUSING. These accounts already have an opening entry that does not match the column,");
    console.log("which means the column was changed after the entry was posted. That is a changed fact,");
    console.log("not a missing one — reconcile them by hand before running this.\n");
    for (const r of changed) {
      console.log(`   org ${r.org_id} (${r.org})  bank ${r.id} ${r.name}  column ${money(r.col)} vs posted ${money(r.posted)}`);
    }
    console.log("");
    await pool.end();
    process.exit(2);
  }

  if (candidates.length === 0) {
    // No pool.end() here — the caller closes it. Ending twice throws, and an inert re-run that
    // exits 1 is indistinguishable from a failed one.
    console.log("Nothing to do.\n");
    return;
  }

  // Per-org contra account, resolved once and refused loudly rather than defaulted into.
  const orgIds = [...new Set(candidates.map((c) => Number(c.org_id)))];
  const contras = new Map<number, Row>();
  const problems: string[] = [];
  for (const orgId of orgIds) {
    const [contra] = (await pool.query<Row>(
      "select id, code, name, type, is_active from accounts where org_id=$1 and code=$2", [orgId, EQUITY_CODE])).rows;
    if (!contra) { problems.push(`org ${orgId}: no account with code ${EQUITY_CODE} — pass --equity-account with a code that exists`); continue; }
    if (!contra.is_active) { problems.push(`org ${orgId}: account ${EQUITY_CODE} is inactive`); continue; }
    if (contra.type !== "equity" && contra.type !== "liability") {
      problems.push(`org ${orgId}: account ${EQUITY_CODE} is a ${contra.type} account — an opening balance is funded from equity or a liability`);
      continue;
    }
    contras.set(orgId, contra);
  }
  for (const c of candidates) {
    if (!c.gl_account_id || !c.gl_code) problems.push(`bank ${c.id} (${c.name}): no GL account`);
    else if (!c.gl_active) problems.push(`bank ${c.id} (${c.name}): GL account ${c.gl_code} is inactive`);
    else if (c.gl_type !== "asset") problems.push(`bank ${c.id} (${c.name}): GL account ${c.gl_code} is a ${c.gl_type} account, not an asset`);
    // The ledger holds base currency only. A foreign-currency bank account needs a rate at the
    // opening date, and this script does not guess one — the app's posting path blocks on the same
    // condition rather than falling back to 1.0.
    if (c.currency && String(c.currency).toUpperCase() !== String(c.base_currency).toUpperCase()) {
      problems.push(`bank ${c.id} (${c.name}): account currency ${c.currency} is not the org base ${c.base_currency} — post this one by hand at the rate you intend`);
    }
  }
  if (problems.length > 0) {
    console.log("REFUSING. These candidates do not match the expected shape:\n");
    for (const p of problems) console.log(`   ${p}`);
    console.log("\nNothing was written.\n");
    await pool.end();
    process.exit(3);
  }

  for (const c of candidates) {
    const contra = contras.get(Number(c.org_id))!;
    const sign = Number(c.amount) > 0;
    const amount = Math.abs(Number(c.amount)).toFixed(3);
    console.log(`   org ${c.org_id} (${c.org})  bank ${c.id} ${c.name}`);
    console.log(`      ${c.entry_date}${c.date_inferred ? "  (inferred from created_at — no opening_date on this row)" : ""}`);
    console.log(`      Dr ${sign ? `${c.gl_code} ${c.gl_name}` : `${contra.code} ${contra.name}`} ${money(amount)}`);
    console.log(`      Cr ${sign ? `${contra.code} ${contra.name}` : `${c.gl_code} ${c.gl_name}`} ${money(amount)}`);
  }
  console.log("");

  if (!APPLY) {
    console.log(`Dry run: ${candidates.length} entr${candidates.length === 1 ? "y" : "ies"} would be posted. Re-run with --apply.`);
    console.log("Deploy the application code FIRST — see the runbook. Running this before the code deploy");
    console.log("makes the bank page show double the true figure, which is a believable wrong number.\n");
    return;
  }

  let posted = 0;
  for (const c of candidates) {
    const contra = contras.get(Number(c.org_id))!;
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Ledger-balance bracket, inside the transaction: this account's balance and the org's whole
      // debit/credit totals, before and after.
      const before = (await client.query<Row>(`
        select
          (select coalesce(sum(l.debit) - sum(l.credit), 0)::text from journal_lines l
             join journal_entries e on e.id = l.journal_entry_id
            where e.org_id = $1 and l.account_id = $2) as gl,
          (select coalesce(sum(l.debit), 0)::text from journal_lines l
             join journal_entries e on e.id = l.journal_entry_id where e.org_id = $1) as dr,
          (select coalesce(sum(l.credit), 0)::text from journal_lines l
             join journal_entries e on e.id = l.journal_entry_id where e.org_id = $1) as cr`,
        [c.org_id, c.gl_account_id])).rows[0];

      // The key, re-checked inside the transaction so two concurrent runs cannot both post.
      const exists = (await client.query(
        "select 1 from journal_entries where org_id=$1 and source_type='bank_opening' and source_id=$2 for update",
        [c.org_id, c.id])).rowCount;
      if (exists) { await client.query("rollback"); continue; }

      const creator = (await client.query<Row>(
        "select id from users where org_id=$1 order by id limit 1", [c.org_id])).rows[0];
      if (!creator) throw new Error(`org ${c.org_id} has no user to attribute the entry to`);

      const je = (await client.query<Row>(
        `insert into journal_entries (org_id, entry_date, memo, source_type, source_id, created_by_id)
         values ($1,$2,$3,'bank_opening',$4,$5) returning id`,
        [c.org_id, c.entry_date, `Opening balance — ${c.name}`, c.id, creator.id])).rows[0].id;

      const amount = Math.abs(Number(c.amount)).toFixed(3);
      const drAccount = Number(c.amount) > 0 ? c.gl_account_id : contra.id;
      const crAccount = Number(c.amount) > 0 ? contra.id : c.gl_account_id;
      await client.query(
        `insert into journal_lines (journal_entry_id, account_id, debit, credit) values ($1,$2,$3,'0'), ($1,$4,'0',$3)`,
        [je, drAccount, amount, crAccount]);

      const after = (await client.query<Row>(`
        select
          (select coalesce(sum(l.debit) - sum(l.credit), 0)::text from journal_lines l
             join journal_entries e on e.id = l.journal_entry_id
            where e.org_id = $1 and l.account_id = $2) as gl,
          (select coalesce(sum(l.debit), 0)::text from journal_lines l
             join journal_entries e on e.id = l.journal_entry_id where e.org_id = $1) as dr,
          (select coalesce(sum(l.credit), 0)::text from journal_lines l
             join journal_entries e on e.id = l.journal_entry_id where e.org_id = $1) as cr`,
        [c.org_id, c.gl_account_id])).rows[0];

      // The entry must balance and must move the account by exactly the opening balance. Checked
      // here, in the transaction, so a wrong posting is rolled back rather than reported.
      if (mils(after.dr) - mils(before.dr) !== mils(after.cr) - mils(before.cr)) {
        throw new Error(`entry ${je} unbalanced: Dr +${money(mils(after.dr) - mils(before.dr))} vs Cr +${money(mils(after.cr) - mils(before.cr))}`);
      }
      if (mils(after.gl) - mils(before.gl) !== mils(c.amount)) {
        throw new Error(`entry ${je} moved ${c.gl_code} by ${money((mils(after.gl) - mils(before.gl)) / 1000)}, expected ${money(c.amount)}`);
      }

      await client.query("commit");
      posted++;
      console.log(`   posted entry ${je} for bank ${c.id} — ${c.gl_code} ${money(before.gl)} → ${money(after.gl)}   org totals Dr ${money(before.dr)} → ${money(after.dr)} / Cr ${money(before.cr)} → ${money(after.cr)}`);
    } catch (e) {
      await client.query("rollback");
      console.error(`   FAILED for bank ${c.id}: ${(e as Error).message}`);
      client.release();
      await pool.end();
      process.exit(4);
    } finally {
      client.release();
    }
  }

  const left = Number((await pool.query<Row>(`
    select count(*)::int as n from bank_accounts b
     where b.opening_balance <> 0${orgFilter}
       and not exists (select 1 from journal_entries e
                        where e.org_id = b.org_id and e.source_type = 'bank_opening' and e.source_id = b.id)`)).rows[0].n);
  console.log(`\nPosted ${posted} entr${posted === 1 ? "y" : "ies"}. Remaining candidates: ${left} (expected 0).\n`);
  if (left !== 0) process.exit(5);
}

main()
  .then(() => pool.end())
  .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
