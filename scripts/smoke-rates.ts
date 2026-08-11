/**
 * `npm run smoke:rates` — the production-side proof that the live rate service works.
 *
 * The general provider (open.er-api.com) was built ON PAPER: the development sandbox's egress
 * proxy blocks every rate API, so nothing in any verify tier has ever spoken to the real service —
 * every suite uses fakes or a localhost mock, deliberately. This script is the one thing that
 * does, which is why it is EXCLUDED FROM EVERY TIER: it depends on someone else's uptime and on
 * outbound network, and belongs on the deployment box (or any unblocked machine), run by hand.
 *
 * It needs no database and writes nothing. It calls the real endpoint through the REAL provider
 * code — the same parsing, timeout and date handling production uses — and checks:
 *
 *   - the service answers and returns usable rates for a GCC-representative pair set;
 *   - the multiply convention holds: `rates[BASE]` from `/latest/{FOREIGN}` is units of base per
 *     one unit of foreign — sanity-anchored on the USD/SAR peg (3.75 since 1986), which a
 *     DIVIDE-convention mix-up would print as ~0.2667;
 *   - the provider's bulletin date parses to a real, recent date (rates are stored under it).
 *
 * If this fails on the deployment box, the app still works: fetches degrade to "stale, warned",
 * the screen shows the failure, and manual entry (which always wins) carries the org.
 */
import { openErApiProvider } from "../src/lib/rates/open-er-api";

const failures: string[] = [];
const check = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`);
  if (!cond) failures.push(name);
};

async function main() {
  const base = process.env.RATE_API_BASE;
  if (base) {
    console.log(`NOTE: RATE_API_BASE is set (${base}) — this run smokes THAT endpoint, not the live service.\n`);
  }

  console.log("Fetching SAR rates for USD, EUR, AED from the real provider…\n");
  const started = Date.now();
  try {
    const result = await openErApiProvider.fetchRates({ baseCurrency: "SAR", currencies: ["USD", "EUR", "AED"] });
    console.log(`Answered in ${Date.now() - started}ms\n`);

    check("all three currencies came back", result.rates.length === 3,
      `got ${result.rates.map((r) => r.currency).join(", ") || "(none)"}; unavailable: ${result.unavailable.join(", ") || "(none)"}`);

    const usd = Number(result.rates.find((r) => r.currency === "USD")?.rate);
    check("USD → SAR sits on the peg (multiply convention holds)", usd > 3.7 && usd < 3.8,
      `${usd} — ~0.2667 here would mean the convention is inverted`);

    const aed = Number(result.rates.find((r) => r.currency === "AED")?.rate);
    check("AED → SAR is plausible (both dollar-pegged, ≈1.02)", aed > 0.95 && aed < 1.1, String(aed));

    const d = new Date(`${result.rateDate}T00:00:00Z`);
    const ageDays = (Date.now() - d.getTime()) / 86_400_000;
    check("the bulletin date parses and is recent", !Number.isNaN(d.getTime()) && ageDays >= -1 && ageDays < 7,
      `${result.rateDate} (${ageDays.toFixed(1)} days old) — the endpoint updates daily`);

    for (const r of result.rates) console.log(`  ${r.currency} → SAR  ${r.rate}  (as of ${result.rateDate})`);
  } catch (e) {
    check("the live service is reachable", false, e instanceof Error ? e.message : String(e));
  }

  console.log(failures.length === 0 ? "\nRATE SMOKE PASS" : `\nRATE SMOKE FAIL (${failures.length})`);
  process.exit(failures.length === 0 ? 0 : 1);
}

void main();
