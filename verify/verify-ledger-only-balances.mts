/**
 * Static guard for the product invariant: **a displayed balance is a function of the ledger and
 * nothing else. No display path adds a stored scalar to a ledger-derived figure.**
 *
 * The rule is stated in full, with the story of how it hid, in the product-invariants section of
 * verify/README.md. This suite is the part that stops it coming back.
 *
 * ## Why STATIC, when there is a behavioural check too
 *
 * There is one, in verify-bank-opening.mjs: a bank account whose stored scalar is a deliberate lie
 * against a correct ledger, where the page must show the ledger figure. That is the stronger
 * assertion and it is the one that proves the behaviour.
 *
 * This one catches something the behavioural check cannot: the addition coming back **somewhere
 * else**. `bank_accounts.opening_balance` was one instance of a general shape, and the next
 * instance will be on a different table, in a different page, under a different field name. A
 * grep-shaped assertion covers files nobody has written yet; a fixture only covers the screen it
 * was written for.
 *
 * ## What is asserted, and what deliberately is NOT
 *
 * Asserted: nothing under `src/` READS the column. Concretely, the member access
 * `.openingBalance` / `.openingBalanceLegacy` — `ba.openingBalanceLegacy`,
 * `bankAccountsTable.openingBalanceLegacy` in a select — appears nowhere outside the schema that
 * declares it. That is the invariant exactly as stated: no display path ever reads it again.
 *
 * WRITES are deliberately still allowed, and the assertion is shaped to permit them: creation
 * stores the typed figure as an audit copy of what the user entered, which is a write key
 * (`openingBalanceLegacy: value`) and never a member access. Banning the identifier outright would
 * have banned the audit copy too, and the ban has to be on the thing that was wrong.
 *
 * NOT asserted: some general "no stored numeric field is ever added to an aggregate" rule. Written
 * as a grep it would be either unfalsifiable or a false-positive generator — every `sum + Number(r.x)`
 * inside a reduce over ledger rows is exactly that shape and entirely correct. The honest static
 * assertion is the narrow one; the general rule lives in the README, and the sweep for new
 * instances of it is a task for a person, recorded in docs/backlog.md with the pattern to search
 * for.
 *
 * Run: npm run verify:ledger-only-balances
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n${detail}` : ""}`); }
};

const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter(Boolean);
// A scan that found no files would pass every assertion below while checking nothing.
check("source files were found (the scan is not silently empty)", files.length > 100, `found ${files.length}`);

const SCHEMA = "src/db/schema/finance.ts";
type Hit = { file: string; line: number; text: string };
const lines = (f: string): Hit[] =>
  readFileSync(path.join(ROOT, f), "utf8").split("\n").map((text, i) => ({ file: f, line: i + 1, text: text.trim() }));
const isProse = (t: string) => t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");

// A READ is a member access. `ba.openingBalanceLegacy`, `bankAccountsTable.openingBalanceLegacy` in
// a select list — and `ba.openingBalance`, the exact text of the line that was the defect, so
// reintroducing the old field name does not slip past a check written for the new one.
const READ = /\.openingBalance(Legacy)?\b/;
// A member ASSIGNMENT is a write — `set.openingBalanceLegacy = x` builds an UPDATE payload. Writes
// are permitted; the invariant is about what is read back out.
const WRITE = /\.openingBalance(Legacy)?\s*=[^=]/;
const reads = files.filter((f) => f !== SCHEMA).flatMap(lines)
  .filter((h) => READ.test(h.text) && !WRITE.test(h.text) && !isProse(h.text));
check(
  "nothing under src/ READS the opening-balance column — no display path, no computation",
  reads.length === 0,
  reads.map((h) => `      ${h.file}:${h.line}  ${h.text}`).join("\n"),
);

// The ban must not be satisfiable by the column having quietly disappeared: a dropped field leaves
// every assertion above true while saying nothing.
const schema = lines(SCHEMA);
check("…and the column IS still declared, so the ban is not vacuous",
  schema.some((h) => h.text.includes('openingBalanceLegacy: numeric("opening_balance"')));

// The audit copy is a WRITE, and it must still be happening — if creation stopped recording what
// the user typed, this suite would go green on a product that had simply lost the field.
const creation = readFileSync(path.join(ROOT, "src/app/(app)/finance/bank-accounts/actions.ts"), "utf8");
check("creation still WRITES the audit copy (the ban is on reads, not on the column)",
  /openingBalanceLegacy: openingBalance,/.test(creation));

// The specific line that WAS the defect, asserted by shape rather than by its old text: the bank
// page's per-account total must be the balances map and nothing added to it.
const page = readFileSync(path.join(ROOT, "src/app/(app)/finance/bank-accounts/page.tsx"), "utf8");
const totalLine = page.split("\n").find((l) => /const total = /.test(l))?.trim() ?? "";
check("the bank page's account total is the ledger balance, with nothing added to it",
  /const total = balances\.get\(ba\.glAccountId\) \?\? 0;$/.test(totalLine), `      got: ${totalLine || "(no `const total =` line at all)"}`);
check("…and the page does not add anything to a balances lookup anywhere else",
  !/balances\.get\([^)]*\)[^;\n]*\+/.test(page) && !/\+[^;\n]*balances\.get\(/.test(page));

// ── The general shape, as far as a static check can honestly go ───────────────────────────────
// Every consumer of getAccountBalances — today three: chart of accounts, the ledger, bank accounts.
// The map is the ledger; anything added to a value pulled out of it is another instance of the same
// defect, on whatever table the next one happens to live. This is narrow enough to be falsifiable
// (it names one function and one access shape) and general enough to cover a page nobody has
// written yet, which is more than the bank-page assertion above can claim.
const consumers = files.filter((f) => readFileSync(path.join(ROOT, f), "utf8").includes("getAccountBalances"))
  .filter((f) => f !== "src/lib/accounting.ts");
check("the getAccountBalances consumers were found (this scan is not empty either)",
  consumers.length >= 3, consumers.join(", "));
const additions = consumers.flatMap(lines).filter((h) =>
  !isProse(h.text) && /balances\.get\(/.test(h.text) && /[+-]/.test(h.text.replace(/balances\.get\([^)]*\)/g, "")) && !/\?\?/.test(h.text.replace(/\?\? 0/, "")));
check("no consumer of getAccountBalances adds anything to a balance it reads",
  additions.length === 0, additions.map((h) => `      ${h.file}:${h.line}  ${h.text}`).join("\n"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
