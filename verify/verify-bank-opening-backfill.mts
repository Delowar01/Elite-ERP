// Run via `npm run verify:bank-opening-backfill` — tsx with the react-server condition.

/**
 * The opening-balance backfill, run for real against fabricated pre-repair data.
 *
 * The script under test is the SAME FILE production runs — invoked through `npx tsx`, scoped with
 * `--org`, not a re-implementation of its logic here. A suite that reimplements a migration proves
 * the suite's arithmetic and nothing about the migration.
 *
 * Fixtures, all shapes a pre-repair database really contains:
 *   A  a positive opening balance with no entry              → posts
 *   B  a NEGATIVE opening balance (overdraft at cutover)      → posts, sides flipped
 *   C  a zero opening balance                                 → not a candidate at all
 *   D  an account already carrying its `bank_opening` entry   → not a candidate (the idempotency key)
 *   E  an account whose id COLLIDES with a `payment` entry's  → still posts (the key is the PAIR)
 *   F  no `opening_date`, only `created_at`                   → posts, dated from created_at
 */
import { execSync } from "node:child_process";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const mils = (v: string | number | null) => Math.round(Number(v ?? 0) * 1000);
const SCRIPT = "scripts/migrations/2026-08-18-bank-opening-balance-journals.ts";

const FIXTURE = "verifybobf_";
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
  [org, `bobf_${uniq()}@t.dev`])).rows[0].id as number;
for (const [code, name, type, nb] of [
  ["1010", "Al Inma Bank", "asset", "debit"], ["1020", "Riyad Bank", "asset", "debit"],
  ["1030", "Petty Cash", "asset", "debit"], ["1040", "SAB", "asset", "debit"],
  ["1050", "ANB", "asset", "debit"], ["1060", "Alawwal", "asset", "debit"],
  ["3000", "Owner's Equity", "equity", "credit"],
] as const) {
  await pool.query("insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,$2,$3,$4,$5,true)",
    [org, code, name, type, nb]);
}
const acc = new Map<string, number>(
  (await pool.query("select id, code from accounts where org_id=$1", [org])).rows.map((r) => [r.code, r.id]));

const mkBank = async (name: string, gl: string, amount: string, date: string | null) =>
  (await pool.query(
    `insert into bank_accounts (org_id,name,gl_account_id,opening_balance,opening_date,created_at)
     values ($1,$2,$3,$4,$5,'2026-07-15 09:00:00') returning id`,
    [org, name, acc.get(gl), amount, date])).rows[0].id as number;

const A = await mkBank("A positive", "1010", "30000.000", "2026-07-30");
const B = await mkBank("B overdraft", "1020", "-1200.000", "2026-07-30");
void B; // asserted through its GL account's signed balance, not by id
const C = await mkBank("C zero", "1030", "0", null);
const D = await mkBank("D already posted", "1040", "5000.000", "2026-07-30");
const E = await mkBank("E colliding id", "1050", "700.000", "2026-07-30");
const F = await mkBank("F no opening_date", "1060", "900.000", null);

// D already carries its entry — the idempotency key in its natural state.
const dje = (await pool.query(
  `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
   values ($1,'2026-07-30','Opening balance — D already posted','bank_opening',$2,$3) returning id`, [org, D, user])).rows[0].id;
await pool.query(
  `insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,'5000.000','0'),($1,$3,'0','5000.000')`,
  [dje, acc.get("1040"), acc.get("3000")]);

// E's DECOY: a `payment` entry whose source_id equals E's bank-account id. Ordinary, not contrived —
// every source type draws its id from a different table, so integers coincide constantly. A check
// keyed on the id alone would read this row and skip E's real posting.
await pool.query(
  `insert into journal_entries (org_id,entry_date,memo,source_type,source_id,created_by_id)
   values ($1,'2026-08-02','Decoy payment','payment',$2,$3)`, [org, E, user]);

const run = (args: string) => {
  try {
    return { out: execSync(`npx tsx --env-file-if-exists=.env ${SCRIPT} --org ${org} ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? -1 };
  }
};
const entryCount = async () => Number((await pool.query(
  "select count(*)::int n from journal_entries where org_id=$1 and source_type='bank_opening'", [org])).rows[0].n);
const lineSum = async (glCode: string) => (await pool.query(
  `select coalesce(sum(l.debit) - sum(l.credit),0)::text v from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and l.account_id=$2`, [org, acc.get(glCode)])).rows[0].v as string;

// ── Dry run ───────────────────────────────────────────────────────────────────────────────────
const beforeCount = await entryCount();
const dry = run("");
check("DRY RUN finds the four candidates and not the other two", /and NO opening entry : 4/.test(dry.out),
  dry.out.split("\n").find((l) => /NO opening entry/.test(l))?.trim() ?? dry.out.slice(0, 200));
check("…prints the entry it would post, both sides named", /Dr 1010 Al Inma Bank/.test(dry.out) && /Cr 3000 Owner's Equity/.test(dry.out));
check("…flips the sides for the OVERDRAFT rather than showing a negative debit",
  /Dr 3000 Owner's Equity {1,}1,200\.000/.test(dry.out), dry.out.split("\n").filter((l) => /1,200/.test(l)).join(" | "));
check("…says where the date came from when it had to infer one",
  /inferred from created_at/.test(dry.out), dry.out.split("\n").find((l) => /inferred/.test(l))?.trim() ?? "");
check("DRY RUN WROTE NOTHING", (await entryCount()) === beforeCount, `${beforeCount} → ${await entryCount()}`);

// ── Apply ─────────────────────────────────────────────────────────────────────────────────────
const applied = run("--apply");
check("APPLY posts exactly four entries", /Posted 4 entries/.test(applied.out),
  applied.out.split("\n").find((l) => /^Posted/.test(l)) ?? applied.out.slice(-300));
check("…and reports zero remaining candidates", /Remaining candidates: 0/.test(applied.out));
check("…printing a ledger bracket per posting", (applied.out.match(/org totals Dr/g) ?? []).length === 4);
check("A: the positive balance lands on its own GL account", mils(await lineSum("1010")) === 30_000_000, await lineSum("1010"));
check("B: the OVERDRAFT lands NEGATIVE on its GL account, from a credit — not a negative debit",
  mils(await lineSum("1020")) === -1_200_000, await lineSum("1020"));
const negLines = (await pool.query(
  `select count(*)::int n from journal_lines l join journal_entries e on e.id=l.journal_entry_id
    where e.org_id=$1 and (l.debit < 0 or l.credit < 0)`, [org])).rows[0].n;
check("…and no line anywhere carries a negative amount", Number(negLines) === 0, `n=${negLines}`);
check("C: the ZERO-balance account got no entry — zero is no event",
  Number((await pool.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='bank_opening' and source_id=$2", [org, C])).rows[0].n) === 0);
check("D: the already-posted account was not posted twice",
  Number((await pool.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='bank_opening' and source_id=$2", [org, D])).rows[0].n) === 1);
check("E: the COLLIDING id was posted anyway — the key is (type, id), not the id",
  Number((await pool.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='bank_opening' and source_id=$2", [org, E])).rows[0].n) === 1);
check("F: the date was taken from created_at when opening_date was null",
  (await pool.query("select entry_date::text d from journal_entries where org_id=$1 and source_type='bank_opening' and source_id=$2", [org, F])).rows[0].d === "2026-07-15");
check("A: the entry is dated the OPENING date, not the created_at date",
  (await pool.query("select entry_date::text d from journal_entries where org_id=$1 and source_type='bank_opening' and source_id=$2", [org, A])).rows[0].d === "2026-07-30");

// The whole org still balances — the property every one of these entries has to preserve.
const totals = (await pool.query(
  `select coalesce(sum(l.debit),0)::text dr, coalesce(sum(l.credit),0)::text cr from journal_lines l
     join journal_entries e on e.id=l.journal_entry_id where e.org_id=$1`, [org])).rows[0];
check("the org's ledger still balances after the backfill", mils(totals.dr) === mils(totals.cr), `Dr ${totals.dr} / Cr ${totals.cr}`);
// The four new entries plus D's pre-existing 5,000 — equity is the other side of all five.
check("equity carries the net of all five entries",
  mils(await lineSum("3000")) === -(30_000_000 - 1_200_000 + 700_000 + 900_000 + 5_000_000), await lineSum("3000"));

// ── Re-run is inert ───────────────────────────────────────────────────────────────────────────
const countAfterApply = await entryCount();
const rerun = run("--apply");
check("RE-RUN is inert — nothing to do, exit clean", rerun.code === 0 && /Nothing to do/.test(rerun.out),
  `exit ${rerun.code}: ${rerun.out.split("\n").filter(Boolean).slice(-1)[0]}`);
check("…and the entry count did not move", (await entryCount()) === countAfterApply, `${countAfterApply} → ${await entryCount()}`);

// ── The CHANGED-fact refusal ──────────────────────────────────────────────────────────────────
// Someone edited the column after the entry was posted. Two figures now disagree and a human has to
// pick; the script must not pick for them.
await pool.query("update bank_accounts set opening_balance = '31000.000' where id=$1", [A]);
const refused = run("--apply");
check("REFUSES when the column disagrees with an entry already posted", refused.code === 2,
  `exit ${refused.code}`);
check("…naming the account and both figures", /column 31,000\.000 vs posted 30,000\.000/.test(refused.out),
  refused.out.split("\n").find((l) => /vs posted/.test(l))?.trim() ?? refused.out.slice(0, 200));
check("…having changed nothing", (await entryCount()) === countAfterApply);
await pool.query("update bank_accounts set opening_balance = '30000.000' where id=$1", [A]);

// ── Shape refusals ────────────────────────────────────────────────────────────────────────────
const G = await mkBank("G on a revenue account", "3000", "400.000", "2026-07-30");
const badGl = run("--apply");
check("REFUSES a bank account mapped to a non-asset GL account", badGl.code === 3, `exit ${badGl.code}`);
check("…naming which account and why", /is a equity account, not an asset|is a liability account, not an asset/.test(badGl.out),
  badGl.out.split("\n").find((l) => /not an asset/.test(l))?.trim() ?? "");
check("…having posted nothing at all, not even the valid ones", (await entryCount()) === countAfterApply);
await pool.query("delete from bank_accounts where id=$1", [G]);

const H = await mkBank("H foreign", "1010", "500.000", "2026-07-30");
await pool.query("update bank_accounts set currency='USD' where id=$1", [H]);
const foreign = run("--apply");
check("REFUSES a foreign-currency account rather than guessing a rate", foreign.code === 3, `exit ${foreign.code}`);
check("…and says to post it by hand at the intended rate", /post this one by hand at the rate you intend/.test(foreign.out));
await pool.query("delete from bank_accounts where id=$1", [H]);

// A CANDIDATE has to exist for this refusal to be reachable at all — with nothing to post the
// script exits clean before it ever resolves a contra account, and the assertion would be passing
// on "nothing to do" rather than on a refusal.
const I = await mkBank("I needs a contra", "1030", "250.000", "2026-07-30");
const missing = run("--apply --equity-account 9999");
check("REFUSES when the named contra account does not exist", missing.code === 3, `exit ${missing.code}`);
check("…naming the flag that would fix it", /pass --equity-account with a code that exists/.test(missing.out));
check("…having posted nothing for the candidate it could not fund",
  Number((await pool.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='bank_opening' and source_id=$2", [org, I])).rows[0].n) === 0);

await sweep();
await pool.end();
console.log("\nBank opening backfill — dry run, apply, idempotency, and the refusals\n");
for (const [ok, name, extra] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  << ${extra}` : ""}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks`);
console.log(failed === 0 ? "BANK OPENING BACKFILL PASS" : `BANK OPENING BACKFILL FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
