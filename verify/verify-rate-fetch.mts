// Run via `npm run verify:rate-fetch`. The script supplies the two flags this file cannot supply
// for itself — see verify/README.md.

/**
 * FX-3. The fetch engine: scoped, validated, manual-wins, backed off, tenant-isolated.
 *
 * Every provider here is a FAKE — the interface exists so no test depends on someone else's
 * uptime, and in this sandbox no rate API is reachable at all. The fakes RECORD their calls,
 * because half the assertions are about what the engine asked for, not what came back:
 *
 *  - **Scope**: a fetch for an org requests exactly that org's pairs-in-use — foreign currencies
 *    on its documents plus already-rated pairs, never the base, never another org's currencies.
 *  - **Tenant isolation**: a fetch fired by org A writes rows for org A only, and B's own fetch
 *    requests B's pairs against B's base. The trigger runs inside authenticated request context,
 *    so a leak here is a cross-tenant write, not a wasted call — same standard, same mutation
 *    proof, as the FX-5 backfill's isolation.
 *  - **Manual always wins, both directions**: a fetch never overwrites a manual row (conditional
 *    upsert), and manual entry replaces a fetched row (unconditional upsert).
 *  - **Backoff**: after ANY attempt, no re-attempt within 15 minutes — asserted by call count on
 *    a failing fake, so an outage plus a busy org cannot mean a fetch per click. `force` (the
 *    one-click) bypasses the window but shares the in-flight lock.
 *  - **Validation**: provider rows go through the same validateRateInput as manual entry; a
 *    garbage row (rate ≤ 0, wrong to-currency) is dropped, never stored.
 */

import { Pool } from "pg";
import {
  pairsInUse, ensureFreshRates, saveManualRate, MANUAL_SOURCE, FETCH_BACKOFF_MINUTES,
} from "../src/lib/rates/fetch-rates";
import type { RateProvider } from "../src/lib/rates/provider";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

const FIXTURE = "verifyrf_";
await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);

const newOrg = async (label: string, currency: string) =>
  (await pool.query("insert into orgs (name, currency, country) values ($1,$2,'Saudi Arabia') returning id",
    [`${FIXTURE}${label}_${uniq()}`, currency])).rows[0].id as number;
const newUser = async (orgId: number) =>
  (await pool.query("insert into users (org_id,name,email,password_hash,role) values ($1,'RF',$2,'x','owner') returning id",
    [orgId, `rf_${uniq()}@t.dev`])).rows[0].id as number;

// Org A (SAR): documents in USD and EUR → pairs {EUR, USD}. Org B (KWD): documents in USD only.
const orgA = await newOrg("a", "SAR");
const orgB = await newOrg("b", "KWD");
const userA = await newUser(orgA);
const userB = await newUser(orgB);
const custA = (await pool.query("insert into customers (org_id,name) values ($1,'c') returning id", [orgA])).rows[0].id;
const custB = (await pool.query("insert into customers (org_id,name) values ($1,'c') returning id", [orgB])).rows[0].id;

const mkInvoice = async (org: number, uid: number, cust: number, currency: string | null) =>
  pool.query(
    `insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, subtotal, discount, tax_total, total, currency, status, created_by_id)
     values ($1,$2,$3,'2026-01-01','100','0','15','115',$4,'draft',$5)`,
    [org, `RF-${uniq()}`, cust, currency, uid]);
await mkInvoice(orgA, userA, custA, "USD");
await mkInvoice(orgA, userA, custA, "EUR");
await mkInvoice(orgA, userA, custA, null);   // base-currency doc — must NOT appear as a pair
await mkInvoice(orgA, userA, custA, "SAR");  // explicit base — must not appear either
await mkInvoice(orgB, userB, custB, "USD");

/** A fake provider that records every call and returns fixed rates dated `date`. */
function fakeProvider(id: string, date: string, rateOf: (c: string) => string | null) {
  const calls: { baseCurrency: string; currencies: string[] }[] = [];
  const provider: RateProvider = {
    id,
    attribution: null,
    async fetchRates({ baseCurrency, currencies }) {
      calls.push({ baseCurrency, currencies: [...currencies].sort() });
      const rates = [];
      const unavailable: string[] = [];
      for (const c of currencies) {
        const r = rateOf(c);
        if (r === null) unavailable.push(c);
        else rates.push({ currency: c, rate: r });
      }
      return { rates, rateDate: date, unavailable };
    },
  };
  return { provider, calls };
}

const today = new Date().toISOString().slice(0, 10);
const rateRows = async (org: number) =>
  (await pool.query(
    "select from_currency, to_currency, rate::text, effective_date::text as d, source from exchange_rates where org_id=$1 order by from_currency", [org])).rows;

// ---------------- 1. pairs-in-use scope ----------------
const pairsA = await pairsInUse(orgA, "SAR");
check("org A's pairs are exactly {EUR, USD}", JSON.stringify(pairsA) === '["EUR","USD"]', JSON.stringify(pairsA));
check("…the base never appears as a pair (null-currency and explicit-SAR docs excluded)", !pairsA.includes("SAR"));
const pairsB = await pairsInUse(orgB, "KWD");
check("org B's pairs are exactly {USD}", JSON.stringify(pairsB) === '["USD"]', JSON.stringify(pairsB));

// ---------------- 2. a fetch writes validated, sourced rows — for its org only ----------------
const fp1 = fakeProvider("fake-general", today, (c) => (c === "USD" ? "3.75000000" : "4.05000000"));
const r1 = await ensureFreshRates(orgA, { provider: fp1.provider });
check("fetch ran", r1.status === "fetched", JSON.stringify(r1));
check("provider was asked for org A's base and pairs, exactly",
  fp1.calls.length === 1 && fp1.calls[0].baseCurrency === "SAR" && JSON.stringify(fp1.calls[0].currencies) === '["EUR","USD"]',
  JSON.stringify(fp1.calls));
const rowsA = await rateRows(orgA);
check("two rows written for org A", rowsA.length === 2, JSON.stringify(rowsA));
check("rows carry the provider id + retrieval date as source",
  rowsA.every((r) => r.source.startsWith("fake-general (retrieved ")), rowsA[0]?.source);
check("rows convert TO the org base (validation held)", rowsA.every((r) => r.to_currency === "SAR"));
check("TENANT ISOLATION: org A's fetch wrote nothing for org B", (await rateRows(orgB)).length === 0);

// ---------------- 3. org B's own fetch uses B's base ----------------
const fp2 = fakeProvider("fake-general", today, () => "0.30720000");
const r2 = await ensureFreshRates(orgB, { provider: fp2.provider });
check("org B fetch ran", r2.status === "fetched", JSON.stringify(r2));
check("provider asked for base KWD, pairs {USD}",
  fp2.calls[0]?.baseCurrency === "KWD" && JSON.stringify(fp2.calls[0]?.currencies) === '["USD"]', JSON.stringify(fp2.calls));
check("org B row converts to KWD", (await rateRows(orgB)).every((r) => r.to_currency === "KWD"));

// ---------------- 4. freshness short-circuit ----------------
const fp3 = fakeProvider("fake-general", today, () => "9.99");
const r3 = await ensureFreshRates(orgA, { provider: fp3.provider });
check("with today's rates present, no fetch happens", r3.status === "fresh", r3.status);
check("…and the provider was never called", fp3.calls.length === 0, `calls=${fp3.calls.length}`);

// ---------------- 5. manual always wins, both directions ----------------
// Manual replaces fetched (same pair, same date):
const m1 = await saveManualRate({ orgId: orgA, baseCurrency: "SAR", fromCurrency: "USD", rate: "3.76", effectiveDate: today });
check("manual entry accepted", m1.error === null, String(m1.error));
let usdRow = (await rateRows(orgA)).find((r) => r.from_currency === "USD");
check("manual REPLACED the fetched row", usdRow?.source === MANUAL_SOURCE && Number(usdRow?.rate) === 3.76, JSON.stringify(usdRow));

// Fetch never overwrites manual: force a fetch (bypasses freshness + backoff) with a different rate.
const fp4 = fakeProvider("fake-general", today, (c) => (c === "USD" ? "3.99000000" : "4.10000000"));
const r4 = await ensureFreshRates(orgA, { provider: fp4.provider, force: true });
check("forced fetch ran", r4.status === "fetched", JSON.stringify(r4));
usdRow = (await rateRows(orgA)).find((r) => r.from_currency === "USD");
check("MANUAL WINS: the manual USD row survived the fetch untouched",
  usdRow?.source === MANUAL_SOURCE && Number(usdRow?.rate) === 3.76, JSON.stringify(usdRow));
const eurRow = (await rateRows(orgA)).find((r) => r.from_currency === "EUR");
check("…while the non-manual EUR row WAS updated (the guard is per-row, not per-fetch)",
  Number(eurRow?.rate) === 4.1, JSON.stringify(eurRow));
check("the engine reported the manual skip", r4.status === "fetched" && r4.skippedManual === 1, JSON.stringify(r4));

// ---------------- 6. failure backoff ----------------
// Make org B's rates stale so freshness does not short-circuit, then fail the provider.
await pool.query("update exchange_rates set effective_date = current_date - 3 where org_id=$1", [orgB]);
await pool.query("delete from rate_fetch_attempts where org_id=$1", [orgB]);
const failing = {
  calls: 0,
  provider: {
    id: "fake-down", attribution: null,
    fetchRates: async () => { failing.calls += 1; throw new Error("provider unreachable"); },
  } satisfies RateProvider,
};
const f1 = await ensureFreshRates(orgB, { provider: failing.provider });
check("first attempt against a dead provider fails and says so", f1.status === "failed", JSON.stringify(f1));
check("…and the error is recorded for the screen to show",
  (await pool.query("select last_error from rate_fetch_attempts where org_id=$1", [orgB])).rows[0]?.last_error === "provider unreachable");
const f2 = await ensureFreshRates(orgB, { provider: failing.provider });
check(`BACKOFF: a second attempt inside ${FETCH_BACKOFF_MINUTES} minutes is refused`, f2.status === "backoff", f2.status);
check("…and the provider was called exactly once", failing.calls === 1, `calls=${failing.calls}`);
// Age the attempt past the window — the next call may try again.
await pool.query("update rate_fetch_attempts set last_attempted_at = now() - interval '16 minutes' where org_id=$1", [orgB]);
const f3 = await ensureFreshRates(orgB, { provider: failing.provider });
check("past the window, the attempt is allowed again", f3.status === "failed" && failing.calls === 2, `${f3.status}/calls=${failing.calls}`);

// ---------------- 7. provider garbage is dropped by validation, never stored ----------------
await pool.query("update rate_fetch_attempts set last_attempted_at = now() - interval '16 minutes' where org_id=$1", [orgB]);
const fp5 = fakeProvider("fake-garbage", today, (c) => (c === "USD" ? "-1" : null));
const g1 = await ensureFreshRates(orgB, { provider: fp5.provider, force: true });
check("a batch of invalid rows writes nothing", g1.status === "fetched" && g1.written === 0, JSON.stringify(g1));
check("…and no negative rate reached the table",
  (await pool.query("select count(*)::int n from exchange_rates where org_id=$1 and rate <= 0", [orgB])).rows[0].n === 0);

// ---------------- cleanup ----------------
await pool.query("delete from orgs where name like $1", [`${FIXTURE}%`]);
await pool.end();

let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((x) => x[0]).length}/${results.length} checks`);
console.log(ok ? "RATE FETCH PASS" : "RATE FETCH FAIL");
process.exit(ok ? 0 : 1);
