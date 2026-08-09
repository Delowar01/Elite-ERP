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

/**
 * FX-1a. Country and base currency at registration, and the one-time confirmation for the orgs
 * that were never asked.
 *
 * The thing under test is a decision, not a screen: **which orgs see the confirmation**. Three
 * conditions have to hold together (never asked, nothing posted, can act on it), and the failure
 * mode that matters is a rewrite that quietly widens or narrows one of them. So every "shown" case
 * is paired with the same org after one condition changes, and vice versa — a bare "not shown"
 * assertion would pass just as happily against a query that returns null for everyone.
 *
 * **Registration itself is not exercised here, and that is deliberate rather than a gap.**
 * `registerAction` imports `next/navigation` for its redirect, which pulls React context that does
 * not exist under `--conditions=react-server` in plain Node — the suite cannot import it without
 * mocking the import away, which would leave a test that no longer touches the real path. So the
 * registration half lives in `verify-registration-currency.mjs`, which drives the real form in a
 * real browser against a production build and asserts the stored columns. That includes the case
 * that matters most — **a newly registered org never sees the notice, not even before it posts
 * anything** — which is genuinely end-to-end there rather than simulated here.
 *
 * What this file covers is everything reachable as ordinary server code: the seeding decision and
 * the notice condition.
 */
import { Pool } from "pg";
import { getBaseCurrencyConfirmation } from "../src/lib/base-currency";
import { seedOrgDefaults } from "../src/lib/seed-org";
import { getProfileByCountryName } from "../src/lib/geo/country-profiles";
import { db } from "../src/db";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

// Fixture orgs carry a prefix and leftovers are swept first, so a run that dies part-way through
// cannot leave debris for the next one to count.
//
// The sweep cannot be a single `delete from orgs`: `journal_lines.account_id` references `accounts`
// with no ON DELETE clause, so cascading an org delete can try to remove an account while its lines
// still point at it. The lines and entries go first, explicitly. `left(name, N) =` rather than
// `like`, because `_` is a single-character wildcard in LIKE and the prefix ends in one.
const FIXTURE = "verifyreg_";
async function sweep() {
  const scope = `select id from orgs where left(name, ${FIXTURE.length}) = '${FIXTURE}'`;
  await pool.query(`delete from journal_lines where journal_entry_id in (select id from journal_entries where org_id in (${scope}))`);
  await pool.query(`delete from journal_entries where org_id in (${scope})`);
  await pool.query(`delete from orgs where left(name, ${FIXTURE.length}) = '${FIXTURE}'`);
}
await sweep();

const newOrg = async (currency: string, country: string | null, confirmed: boolean) =>
  (await pool.query(
    `insert into orgs (name, currency, country, base_currency_confirmed_at)
     values ($1,$2,$3,$4) returning id`,
    [`${FIXTURE}${uniq()}`, currency, country, confirmed ? new Date() : null],
  )).rows[0].id as number;

const seedAccount = async (orgId: number) =>
  (await pool.query(
    `insert into accounts (org_id,code,name,type,normal_balance,is_system)
     values ($1,'1000','Cash','asset','debit',true) returning id`,
    [orgId],
  )).rows[0].id as number;

const newUser = async (orgId: number, role: string) =>
  (await pool.query(
    `insert into users (org_id,name,email,password_hash,role) values ($1,'U',$2,'x',$3) returning id`,
    [orgId, `${FIXTURE}${uniq()}@t.dev`, role],
  )).rows[0].id as number;

async function post(orgId: number) {
  const account = await seedAccount(orgId);
  const user = await newUser(orgId, "owner");
  const entry = (await pool.query(
    `insert into journal_entries (org_id,entry_date,memo,source_type,created_by_id)
     values ($1,'2026-01-01','Seed','manual',$2) returning id`,
    [orgId, user],
  )).rows[0].id as number;
  await pool.query(
    `insert into journal_lines (journal_entry_id,account_id,debit,credit) values ($1,$2,'100','0'),($1,$2,'0','100')`,
    [entry, account],
  );
}

// ---------------- 1. the seeded tax preset follows the country ----------------
// Before this task the rate was hardcoded to 15 — Saudi Arabia's — for every org in the world.
// Nobody could see it was wrong because nobody was asked their country; now they are.
for (const [country, rate, name] of [
  ["Saudi Arabia", "15", "Standard VAT"],
  ["United Arab Emirates", "5", "Standard VAT"],
  // No dedicated profile: the Global profile's tax system is unknown, so 0% and the generic word.
  ["Germany", "0", "Standard Tax"],
] as const) {
  const orgId = await newOrg("SAR", country, true);
  await db.transaction(async (tx) => seedOrgDefaults(tx, orgId, country));
  const rows = (await pool.query(
    "select name, rate_percent from tax_presets where org_id=$1 order by name", [orgId],
  )).rows as { name: string; rate_percent: string }[];
  const standard = rows.find((r) => r.name.startsWith("Standard"));
  check(`${country}: the seeded tax preset is ${rate}%`, Number(standard?.rate_percent) === Number(rate), `got ${standard?.rate_percent}`);
  check(`${country}: the seeded tax preset is named "${name}"`, standard?.name === name, standard?.name ?? "missing");
  check(`${country}: the zero-rated preset is still seeded alongside it`, rows.some((r) => r.name === "Zero-rated"));
}
// CONTROL: the profile really does differ between these countries, so the assertions above are
// comparing something — a suite where every profile returned 15 would pass them all.
check("CONTROL: the country profiles carry genuinely different rates",
  getProfileByCountryName("Saudi Arabia").defaultTaxRate === 15 &&
  getProfileByCountryName("United Arab Emirates").defaultTaxRate === 5,
  `SA=${getProfileByCountryName("Saudi Arabia").defaultTaxRate} AE=${getProfileByCountryName("United Arab Emirates").defaultTaxRate}`);

// ---------------- 2. currency follows the country profile ----------------
check("Saudi Arabia defaults to SAR", getProfileByCountryName("Saudi Arabia").defaultCurrencyCode === "SAR");
check("the UAE defaults to AED", getProfileByCountryName("United Arab Emirates").defaultCurrencyCode === "AED");
check("a country with no dedicated profile still resolves a currency",
  getProfileByCountryName("Germany").defaultCurrencyCode.length === 3,
  getProfileByCountryName("Germany").defaultCurrencyCode);

// ---------------- 3. WHO SEES THE NOTICE ----------------
// Each case is the same org differing in exactly one condition, so a passing "not shown" cannot be
// a query that returns null for everybody.
const unasked = await newOrg("SAR", null, false);
const shown = await getBaseCurrencyConfirmation(unasked, "owner");
check("an org that was never asked, with nothing posted, sees the notice", shown !== null);
check("…and it names the currency the org actually carries", shown?.currency === "SAR", shown?.currency ?? "null");
check("…and reports the country as null rather than guessing one", shown?.country === null, String(shown?.country));

const unaskedAed = await newOrg("AED", "United Arab Emirates", false);
check("the notice reports each org's own currency, not a constant",
  (await getBaseCurrencyConfirmation(unaskedAed, "owner"))?.currency === "AED");

// same org, one condition changed: it has posted
const posted = await newOrg("SAR", null, false);
check("CONTROL: before posting, this org would see the notice", (await getBaseCurrencyConfirmation(posted, "owner")) !== null);
await post(posted);
check("once anything is posted, the notice is gone", (await getBaseCurrencyConfirmation(posted, "owner")) === null);

// same org, one condition changed: role
check("staff never see it — they cannot change the currency", (await getBaseCurrencyConfirmation(unasked, "staff")) === null);
check("admins do see it", (await getBaseCurrencyConfirmation(unasked, "admin")) !== null);
check("CONTROL: the owner still sees the same org's notice", (await getBaseCurrencyConfirmation(unasked, "owner")) !== null);

// same org, one condition changed: dismissed
const dismissed = await newOrg("SAR", null, false);
check("CONTROL: before dismissal, this org would see the notice", (await getBaseCurrencyConfirmation(dismissed, "owner")) !== null);
await pool.query("update orgs set base_currency_confirmed_at = now() where id=$1", [dismissed]);
check("after dismissal the notice never comes back", (await getBaseCurrencyConfirmation(dismissed, "owner")) === null);

// ---------------- 4. registration is covered by the browser suite ----------------
// See the header: registerAction cannot be imported here. verify-registration-currency.mjs drives
// the real form and asserts the stored currency/country/stamp, the seeded rate, and that a newly
// registered org never sees the notice.

// ---------------- 6. the settings screen no longer invents a country ----------------
// It used to render `org.country ?? "Saudi Arabia"`, showing a country that was not stored.
// Comment lines are stripped first: the fix left a comment explaining what the old code was, and
// matching against that comment would make this assertion fail on a correct file — and, worse,
// pass on a broken one that happened to lose the comment.
const panelsRaw = (await import("node:fs")).readFileSync("src/app/(app)/settings/organization/company-panels.tsx", "utf8");
const panels = panelsRaw.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
check("Business Settings no longer defaults the country display to Saudi Arabia",
  !/org\.country \?\? "Saudi Arabia"/.test(panels));
check("…and falls back to empty instead", /useState\(org\.country \?\? ""\)/.test(panels));

// ---------------- cleanup ----------------
await sweep();
await pool.end();

let allOk = true;
for (const [c, n, x] of results) { if (!c) allOk = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((x) => x[0]).length}/${results.length} checks`);
console.log(allOk ? "REGISTRATION CURRENCY PASS" : "REGISTRATION CURRENCY FAIL");
process.exit(allOk ? 0 : 1);
