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
 * FX-2. The exchange rate table and `resolveRate`.
 *
 * Nothing imports this service yet, so there is no UI to drive — the suite exercises the real
 * exported functions and the real table directly, which is the whole point: every later posting
 * path depends on this returning the right number, and a wrong number here is a wrong ledger.
 *
 * Four things are asserted beyond the obvious "it finds a rate":
 *
 *  - **The direction.** `fromCurrency=USD, toCurrency=SAR, rate=3.75` means one dollar buys 3.75
 *    riyals, so conversion multiplies. The arithmetic is asserted in that direction AND against
 *    the inverted value, so a divide-instead-of-multiply cannot pass.
 *  - **Zero and negative rates are refused twice** — by the database check constraint (a raw
 *    INSERT that bypasses the action layer) and by `validateRateInput`. A `numeric(18,8)` stores
 *    `0` happily, and a zero rate silently zeroes every total it touches.
 *  - **Future-dated rates are inert.** A rate entered for next month must not be used for a
 *    posting today. That is the intended behaviour of "most recent on or before", not a gap.
 *  - **`toCurrency` never varies.** Phase 1 converts only to the org's base, so a row pointing
 *    anywhere else is rejected on write and ignored on read.
 *
 * Every "not found / not used" assertion is paired with a positive control, because an absence
 * check passes just as happily when the query is broken as when the guard works.
 */

import { Pool } from "pg";
import { resolveRate, toBaseAmount, validateRateInput, MissingExchangeRateError } from "../src/lib/exchange-rates";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

// ---------------- fixtures ----------------
// Every fixture org carries this prefix, and anything an earlier run left behind is swept first.
// Mutation testing deliberately makes this suite die part-way through, which skips the cleanup at
// the end — without the sweep, orphan orgs and their rates pile up in the development database,
// and the next person to count rows there is counting debris.
const FIXTURE = "verifyfx_";
await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);
const newOrg = async (label: string) =>
  (await pool.query("insert into orgs (name, currency) values ($1,'SAR') returning id", [`${FIXTURE}${label}_${uniq()}`]))
    .rows[0].id as number;

const org = await newOrg("main");
const other = await newOrg("other");
// An org that has never entered a single rate — used to prove the base short-circuit does not
// depend on the rates table having anything in it.
const bare = await newOrg("bare");

const addRate = (orgId: number, from: string, to: string, rate: string, date: string, source = "SAMA") =>
  pool.query(
    "insert into exchange_rates (org_id,from_currency,to_currency,rate,effective_date,source) values ($1,$2,$3,$4,$5,$6)",
    [orgId, from, to, rate, date, source],
  );

await addRate(org, "USD", "SAR", "3.75000000", "2026-01-01");
await addRate(org, "USD", "SAR", "3.80000000", "2026-03-01", "Bank statement");
await addRate(org, "USD", "SAR", "9.99000000", "2026-12-01", "future guess"); // future-dated
await addRate(org, "EUR", "SAR", "4.10000000", "2026-01-01");
// Same pair, same dates, different org — must never be visible to `org`.
await addRate(other, "USD", "SAR", "1.11000000", "2026-01-01");
await addRate(other, "GBP", "SAR", "5.00000000", "2026-01-01");
// A row whose toCurrency is NOT the org's base. Rejected on write by validateRateInput; inserted
// here directly to prove resolveRate ignores it too rather than quietly converting into EUR.
await addRate(org, "JPY", "EUR", "0.00700000", "2026-01-01");

const BASE = "SAR";
const r = (from: string, date: string, orgId = org, baseCurrency = BASE) =>
  resolveRate({ orgId, baseCurrency, fromCurrency: from, date });

// ---------------- 1. base-currency short-circuit ----------------
const baseHit = await r("SAR", "2026-06-15");
check("base currency resolves to exactly 1", Number(baseHit.rate) === 1, `rate=${baseHit.rate}`);
check("base currency reports the asked-for date", baseHit.effectiveDate === "2026-06-15", baseHit.effectiveDate);
check("base currency is labelled as such, not as a stored rate", baseHit.source === "base currency", baseHit.source);
const bareHit = await r("SAR", "2026-06-15", bare);
check("base currency resolves for an org with no rates on file at all", Number(bareHit.rate) === 1, `rate=${bareHit.rate}`);
// Case is normalised, so a lowercase document currency does not fall through to a lookup.
check("base-currency match is case-insensitive", Number((await r("sar", "2026-06-15")).rate) === 1);

// ---------------- 2. exact date, and most-recent-on-or-before ----------------
const exact = await r("USD", "2026-01-01");
check("an exact-date rate is found", Number(exact.rate) === 3.75, `rate=${exact.rate}`);
check("the rate carries its own effective date", exact.effectiveDate === "2026-01-01", exact.effectiveDate);
check("the rate carries its stored source", exact.source === "SAMA", exact.source);

const between = await r("USD", "2026-02-14");
check("a date between two rates uses the earlier one", Number(between.rate) === 3.75, `rate=${between.rate}`);
check("…and reports that rate's date, not the asked-for date", between.effectiveDate === "2026-01-01", between.effectiveDate);

const after = await r("USD", "2026-06-15");
check("a later date uses the most recent rate on or before it", Number(after.rate) === 3.8, `rate=${after.rate}`);
check("…with the newer rate's own source", after.source === "Bank statement", after.source);

// The pair above is the one that catches an ascending sort: 2026-06-15 has three candidate rows
// (Jan, Mar, Dec); only "newest first, limited to on-or-before" returns 3.80.
check("a rate is not used before its effective date", Number((await r("USD", "2026-02-28")).rate) === 3.75);

// ---------------- 3. future-dated rates are inert ----------------
const today = await r("USD", "2026-08-09");
check("a future-dated rate is NOT used for a posting today", Number(today.rate) === 3.8, `rate=${today.rate}`);
check("CONTROL: the future rate IS used once its date arrives", Number((await r("USD", "2026-12-01")).rate) === 9.99);
check("CONTROL: the future rate exists in the table (the absence above is not an empty table)",
  ((await pool.query("select count(*)::int n from exchange_rates where org_id=$1 and effective_date='2026-12-01'", [org])).rows[0].n) === 1);

// ---------------- 4. isolation: org, pair, and toCurrency ----------------
check("another org's rate for the same pair is not used", Number((await r("USD", "2026-06-15")).rate) !== 1.11);
check("CONTROL: that other org does resolve its own rate", Number((await r("USD", "2026-06-15", other)).rate) === 1.11);

const eur = await r("EUR", "2026-06-15");
check("a different currency pair resolves to its own rate", Number(eur.rate) === 4.1, `rate=${eur.rate}`);
check("the USD rate is not reused for EUR", Number(eur.rate) !== 3.8);

let jpyThrew = false;
try { await r("JPY", "2026-06-15"); } catch { jpyThrew = true; }
check("a row whose toCurrency is not the org's base is ignored", jpyThrew);
check("CONTROL: that JPY row really is in the table",
  ((await pool.query("select count(*)::int n from exchange_rates where org_id=$1 and from_currency='JPY'", [org])).rows[0].n) === 1);

// ---------------- 5. a missing rate throws, and says what is missing ----------------
let missing: unknown = null;
try { await r("GBP", "2026-06-15"); } catch (e) { missing = e; }
check("a currency with no rate throws", missing instanceof MissingExchangeRateError, String(missing));
check("the error names the currency", (missing as MissingExchangeRateError)?.currency === "GBP");
check("the error names the date", (missing as MissingExchangeRateError)?.date === "2026-06-15");

let beforeFirst: unknown = null;
try { await r("USD", "2025-12-31"); } catch (e) { beforeFirst = e; }
check("a date before the earliest rate throws rather than borrowing a later one",
  beforeFirst instanceof MissingExchangeRateError, String(beforeFirst));
check("CONTROL: one day later, the same currency resolves", Number((await r("USD", "2026-01-01")).rate) === 3.75);

// ---------------- 6. direction: multiply, never divide ----------------
check("100 USD at 3.75 is 375.00 SAR (multiply)", toBaseAmount("100", "3.75") === "375.00", toBaseAmount("100", "3.75"));
check("the inverted (divide) result is NOT what is produced", toBaseAmount("100", "3.75") !== "26.67");
check("1 USD at 3.75 is 3.75 SAR", toBaseAmount("1", "3.75") === "3.75", toBaseAmount("1", "3.75"));
check("a base-currency amount at rate 1 is unchanged", toBaseAmount("1234.56", "1") === "1234.56", toBaseAmount("1234.56", "1"));
check("the resolved rate string feeds the arithmetic directly",
  toBaseAmount("200", (await r("USD", "2026-06-15")).rate) === "760.00", toBaseAmount("200", (await r("USD", "2026-06-15")).rate));
check("a half-cent rounds away from zero, not down", toBaseAmount("1", "0.005") === "0.01", toBaseAmount("1", "0.005"));
check("…and away from zero on the negative side too", toBaseAmount("-1", "0.005") === "-0.01", toBaseAmount("-1", "0.005"));
check("a full-precision rate rounds to cents", toBaseAmount("100", "3.14159265") === "314.16", toBaseAmount("100", "3.14159265"));

// ---------------- 7. zero / negative rejected by the DATABASE ----------------
for (const bad of ["0", "0.00000000", "-3.75"]) {
  let rejected = false;
  try { await addRate(org, "AUD", "SAR", bad, "2026-05-01"); } catch { rejected = true; }
  check(`the database refuses a rate of ${bad}`, rejected);
}
check("CONTROL: a positive rate on the same pair/date IS accepted",
  await addRate(org, "AUD", "SAR", "2.50000000", "2026-05-01").then(() => true, () => false));

// ---------------- 8. zero / negative / wrong-base rejected on WRITE ----------------
const good = { fromCurrency: "usd", toCurrency: "sar", baseCurrency: "SAR", rate: "3.75", effectiveDate: "2026-04-01", source: " SAMA " };
const okRes = validateRateInput(good);
check("CONTROL: a valid rate input passes validation", okRes.error === null, String(okRes.error));
check("validation upper-cases the currency codes", okRes.error === null && okRes.value.fromCurrency === "USD" && okRes.value.toCurrency === "SAR");
check("validation trims the source", okRes.error === null && okRes.value.source === "SAMA");

const bads: [string, Parameters<typeof validateRateInput>[0]][] = [
  ["zero", { ...good, rate: "0" }],
  ["negative", { ...good, rate: "-1" }],
  ["non-numeric", { ...good, rate: "abc" }],
  ["a toCurrency that is not the base", { ...good, toCurrency: "EUR" }],
  ["the base currency against itself", { ...good, fromCurrency: "SAR" }],
  ["a non-ISO currency code", { ...good, fromCurrency: "DOLLARS" }],
  ["a missing source", { ...good, source: "  " }],
  ["a malformed effective date", { ...good, effectiveDate: "01/04/2026" }],
];
for (const [label, input] of bads) {
  const res = validateRateInput(input);
  check(`validation refuses ${label}`, res.error !== null, res.error ?? "accepted");
}

// ---------------- 9. one rate per (org, pair, date) ----------------
let dupRejected = false;
try { await addRate(org, "USD", "SAR", "4.00000000", "2026-01-01"); } catch { dupRejected = true; }
check("a second rate for the same org/pair/date is refused", dupRejected);
check("…and the original value is untouched", Number((await r("USD", "2026-01-01")).rate) === 3.75);

// ---------------- 10. deleting an org takes its rates with it ----------------
const doomed = await newOrg("doomed");
await addRate(doomed, "USD", "SAR", "3.75000000", "2026-01-01");
await pool.query("delete from orgs where id=$1", [doomed]);
check("rates are removed with their org (cascade)",
  ((await pool.query("select count(*)::int n from exchange_rates where org_id=$1", [doomed])).rows[0].n) === 0);

// ---------------- cleanup ----------------
await pool.query("delete from orgs where id = any($1)", [[org, other, bare]]);
await pool.end();

let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((x) => x[0]).length}/${results.length} checks`);
console.log(ok ? "EXCHANGE RATES PASS" : "EXCHANGE RATES FAIL");
process.exit(ok ? 0 : 1);
