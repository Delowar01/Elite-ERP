// Run via `npm run verify:advance-allocations` — tsx with the react-server condition, like every
// server suite.

/**
 * The partial-allocation arithmetic, proven directly against hand-computed figures and against a
 * property that no amount of example-picking can fake: **whatever way an advance is split, the
 * carried base its consumers take sums to the original EXACTLY.**
 *
 * That property is the whole point of §6. Independently reconverting each piece — the obvious
 * implementation — passes a two-way split and strands a fils on a three-way one, which is the
 * shape of bug that sits in 2300 forever and cannot be explained from any report. So this suite
 * sweeps hundreds of splits, including deliberately awkward thirds, and asserts exactness at the
 * minor unit every time.
 *
 * Covered here (the pure layer; the posting paths that use it land in later commits):
 *  - apportionment + residual across allocations AND refunds (both are consumers of the same pot);
 *  - the four-case derivation: consumes-advance / closes-invoice / both / neither;
 *  - every generated entry balances, so the two independent residual rules can never unbalance one;
 *  - the same-customer and same-currency refusals, including their messages;
 *  - availability arithmetic, including a released allocation restoring it.
 */
import {
  availabilityOf, carriedBaseFor, arClearedFor, buildAllocationPosting, postingIsBalanced,
  sameCustomerRefusal, sameCurrencyRefusal, type AdvancePot,
} from "../src/lib/advance-allocations";
import { roundMoney, moneyEpsilon } from "../src/lib/currency/currencies";

const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const mils = (v: string | number) => Math.round(Number(v) * 1000);
const ADV = 1, AR = 2, FX = 3;

const pot = (over: Partial<AdvancePot> = {}): AdvancePot => ({
  amount: "10000.000", carriedBase: "37500.000", consumedAmount: "0", consumedCarried: "0", currency: "USD", ...over,
});

// ================= 1. §6 exactness: apportion + residual, hand-computed =================
// USD 10,000 carried at 37,500 (3.75). 80% applied → 30,000 apportioned; the remaining 20% is the
// residual 7,500, and it is DERIVED, never reconverted.
const p1 = pot();
const first = carriedBaseFor({ pot: p1, drawAmount: "8000.000", baseCurrency: "SAR" });
check("§6: 80% of a 37,500 carried base apportions to 30,000.000", mils(first) === 30000000, first);
const p1b = pot({ consumedAmount: "8000.000", consumedCarried: first });
const rest = carriedBaseFor({ pot: p1b, drawAmount: "2000.000", baseCurrency: "SAR" });
check("§6: the draw that empties the advance takes the exact residual 7,500.000", mils(rest) === 7500000, rest);
check("§6: applied + remaining sum EXACTLY to the original carried base",
  mils(first) + mils(rest) === mils(p1.carriedBase), `${first} + ${rest} vs ${p1.carriedBase}`);

// ================= 2. the property: ANY split lands exactly, including awkward thirds ==========
// Reconverting each piece independently is the natural wrong implementation; it drifts here.
// EVERY figure the sweep feeds in must be one the system could actually store, or a failure would
// send someone chasing a bug that cannot occur — which is exactly what an earlier version of this
// generator did. Two separate minor units are in play and they are NOT the same one:
//   - the DOCUMENT amount and each split are stored at the ADVANCE currency's unit
//     (recordPaymentAction rounds them), so a USD draw can never be 333.333;
//   - the CARRIED BASE is stored at the BASE currency's unit (capturePaymentBase rounds it),
//     so a SAR carried base can never be 4,709.995.
// The matrix therefore crosses a 2-decimal document currency with a 3-decimal one, against a
// 2-decimal base and a 3-decimal base, and generates every amount through roundMoney at the right
// unit for its role. (moneyDecimals is deliberately not used: its "document" context is fixed at 2
// decimals for presentation, which is not the storage precision.)
let worstDrift = 0;
let driftCase = "";
let sweeps = 0;
const minorUnit = (code: string) => Math.round(-Math.log10(moneyEpsilon(code) * 2));
const splitsOf = (total: number, parts: number, docCurrency: string) => {
  const f = 10 ** minorUnit(docCurrency);
  const each = Math.floor((total / parts) * f) / f;
  const head = Array.from({ length: parts - 1 }, () => each);
  return [...head, Number(roundMoney(total - head.reduce((a, b) => a + b, 0), docCurrency))];
};
for (const base of ["SAR", "KWD"]) {
  for (const doc of ["USD", "KWD"]) {
    if (doc === base) continue; // a base-currency advance is the identity: nothing to apportion
    for (const rawAmount of [10000, 999.999, 1, 333.333, 87654.321]) {
      for (const rate of [3.75, 4.71, 0.267, 11.0031]) {
        for (const parts of [2, 3, 5, 7]) {
          const amount = Number(roundMoney(rawAmount, doc));     // as a payment would store it
          const carried = roundMoney(amount * rate, base);        // as capturePaymentBase would store it
          let p: AdvancePot = { amount: roundMoney(amount, doc), carriedBase: carried, consumedAmount: "0", consumedCarried: "0", currency: doc };
          let sum = 0;
          for (const draw of splitsOf(amount, parts, doc)) {
            const c = carriedBaseFor({ pot: p, drawAmount: roundMoney(draw, doc), baseCurrency: base });
            sum += mils(c);
            p = { ...p, consumedAmount: String(Number(p.consumedAmount) + draw), consumedCarried: String(Number(p.consumedCarried) + Number(c)) };
          }
          sweeps++;
          const drift = Math.abs(sum - mils(carried));
          if (drift > worstDrift) { worstDrift = drift; driftCase = `base=${base} doc=${doc} ${amount} @ ${rate} in ${parts} parts: ${sum} vs ${mils(carried)}`; }
        }
      }
    }
  }
}
check(`§6 PROPERTY: across ${sweeps} splits — 2/3/5/7 ways × five amounts × four rates × three currency-pair shapes, every figure rounded as the system stores it — the drift is ZERO thousandths`,
  worstDrift === 0, driftCase || "no drift in any case");

// a refund is a consumer too: an advance emptied by a REFUND must also take the residual
const p2 = pot({ consumedAmount: "3333.333", consumedCarried: carriedBaseFor({ pot: pot(), drawAmount: "3333.333", baseCurrency: "SAR" }) });
const refundCarried = carriedBaseFor({ pot: p2, drawAmount: "6666.667", baseCurrency: "SAR" });
check("a REFUND that empties the advance takes the residual, so 2300 strands nothing",
  mils(p2.consumedCarried) + mils(refundCarried) === mils(pot().carriedBase),
  `${p2.consumedCarried} + ${refundCarried} vs ${pot().carriedBase}`);

// ================= 3. the four-case derivation =================
const inv = (over: Partial<Parameters<typeof arClearedFor>[0]["invoice"]> = {}) => ({
  currency: "USD", exchangeRate: "3.80", baseTotal: "38000.000", basePaidAmount: "0", total: "10000.000", paidAmount: "0", ...over,
});
const neither = arClearedFor({ invoice: inv({ total: "20000.000" }), applyAmount: "5000.000", baseCurrency: "SAR" });
check("NEITHER: a partial draw on a partly-settled invoice clears at the BOOKED rate (5,000 × 3.80 = 19,000)",
  neither.ok && mils(neither.arCleared) === 19000000 && !neither.closesInvoice, JSON.stringify(neither));
const closes = arClearedFor({ invoice: inv({ basePaidAmount: "19000.000", paidAmount: "5000.000", total: "10000.000" }), applyAmount: "5000.000", baseCurrency: "SAR" });
check("CLOSES INVOICE: the settling draw derives 38,000 − 19,000 = 19,000.000, not a reconversion",
  closes.ok && mils(closes.arCleared) === 19000000 && closes.closesInvoice, JSON.stringify(closes));
// A rate that does NOT divide evenly: derived and reconverted visibly differ.
// Figures as the system would actually store them (SAR, 2 decimals). Reconverting the closing
// draw would say 333.333 × 3.333 = 1,111.00; deriving says 3,333.00 − 2,222.11 = 1,110.89, and
// only the derived figure lands basePaidAmount exactly on baseTotal — the 11-halala gap between
// them is precisely what would otherwise strand in AR.
const awkward = arClearedFor({
  invoice: { currency: "USD", exchangeRate: "3.333", baseTotal: "3333.00", basePaidAmount: "2222.11", total: "1000.000", paidAmount: "666.667" },
  applyAmount: "333.333", baseCurrency: "SAR",
});
check("CLOSES INVOICE (awkward rate): derives 1,110.89 where reconverting would say 1,111.00",
  awkward.ok && mils(awkward.arCleared) === 1110890
    && mils(roundMoney(333.333 * 3.333, "SAR")) === 1111000, JSON.stringify(awkward));
const baseInv = arClearedFor({ invoice: { currency: null, exchangeRate: null, baseTotal: null, basePaidAmount: null, total: "800.000", paidAmount: "0" }, applyAmount: "300.000", baseCurrency: "SAR" });
check("a base-currency invoice needs no stored conversion — identity, 300.000", baseInv.ok && mils(baseInv.arCleared) === 300000, JSON.stringify(baseInv));
const legacy = arClearedFor({ invoice: inv({ exchangeRate: null, baseTotal: null }), applyAmount: "100.000", baseCurrency: "SAR" });
check("a FOREIGN invoice with no stored conversion is REFUSED, never given a guessed rate",
  !legacy.ok && /no stored base-currency conversion/.test(legacy.ok === false ? legacy.error : ""), JSON.stringify(legacy));

// ================= 4. the whole posting: three lines, balanced, 4900 derived =================
// Advance carried at 3.75, invoice booked at 3.80 → clearing 8,000 costs 30,000 of carried base
// and settles 30,400 of AR: a 400 realized LOSS (we hold less than the invoice was booked at).
const built = buildAllocationPosting({
  pot: pot(), invoice: inv({ total: "20000.000" }), applyAmount: "8000.000", baseCurrency: "SAR",
  advancesAccountId: ADV, arAccountId: AR, fxAccountId: FX,
});
check("posting: Dr 2300 30,000 / Cr 1100 30,400 / Dr 4900 400 — three lines, FX derived",
  built.ok && built.posting.lines.length === 3
    && mils(built.posting.lines[0].debit) === 30000000
    && mils(built.posting.lines[1].credit) === 30400000
    && built.posting.lines[2].accountId === FX && mils(built.posting.lines[2].debit) === 400000,
  JSON.stringify(built.ok ? built.posting.lines : built));
check("posting BALANCES by construction", built.ok && postingIsBalanced(built.posting.lines));
// Same rate on both sides → no FX line at all.
const noFx = buildAllocationPosting({
  pot: pot({ carriedBase: "38000.000" }), invoice: inv({ total: "20000.000" }), applyAmount: "8000.000",
  baseCurrency: "SAR", advancesAccountId: ADV, arAccountId: AR, fxAccountId: FX,
});
check("no FX line when carried and booked agree — two lines only",
  noFx.ok && noFx.posting.lines.length === 2 && postingIsBalanced(noFx.posting.lines),
  JSON.stringify(noFx.ok ? noFx.posting.lines : noFx));
// BOTH residuals in one allocation: it empties the advance AND closes the invoice.
const both = buildAllocationPosting({
  pot: pot({ consumedAmount: "8000.000", consumedCarried: "30000.000" }),
  invoice: inv({ total: "10000.000", paidAmount: "8000.000", basePaidAmount: "30400.000" }),
  applyAmount: "2000.000", baseCurrency: "SAR", advancesAccountId: ADV, arAccountId: AR, fxAccountId: FX,
});
check("BOTH residuals at once: Dr 2300 7,500 (advance residual) / Cr 1100 7,600 (invoice residual) / Dr 4900 100 — still balanced",
  both.ok && both.posting.emptiesAdvance && both.posting.closesInvoice
    && mils(both.posting.carriedBase) === 7500000 && mils(both.posting.arCleared) === 7600000
    && postingIsBalanced(both.posting.lines),
  JSON.stringify(both.ok ? both.posting : both));
const noFxAccount = buildAllocationPosting({
  pot: pot(), invoice: inv({ total: "20000.000" }), applyAmount: "8000.000", baseCurrency: "SAR",
  advancesAccountId: ADV, arAccountId: AR, fxAccountId: null,
});
check("an org missing 4900 is REFUSED when a difference exists, rather than posting a 2-line imbalance",
  !noFxAccount.ok && /4900/.test(noFxAccount.ok === false ? noFxAccount.error : ""), JSON.stringify(noFxAccount));

// ================= 5. invariants =================
check("§5: same customer passes", sameCustomerRefusal(7, 7) === null);
check("§5: a different customer is refused, naming the reason",
  /belongs to a different client/.test(sameCustomerRefusal(7, 9) ?? ""), String(sameCustomerRefusal(7, 9)));
check("same currency passes (both foreign, both null, and null-vs-base)",
  sameCurrencyRefusal("USD", "USD", "SAR") === null && sameCurrencyRefusal(null, null, "SAR") === null
    && sameCurrencyRefusal(null, "SAR", "SAR") === null && sameCurrencyRefusal("SAR", null, "SAR") === null);
check("cross-currency is refused, naming BOTH currencies so the UI can explain rather than just hide",
  /USD/.test(sameCurrencyRefusal("USD", null, "SAR") ?? "") && /SAR/.test(sameCurrencyRefusal("USD", null, "SAR") ?? ""),
  String(sameCurrencyRefusal("USD", null, "SAR")));

// ================= 6. availability =================
const av = availabilityOf(pot({ consumedAmount: "8000.000", consumedCarried: "30000.000" }), "SAR");
check("availability: 10,000 − 8,000 = 2,000 doc and 37,500 − 30,000 = 7,500 carried",
  mils(av.availableAmount) === 2000000 && mils(av.availableCarried) === 7500000, JSON.stringify(av));
const released = availabilityOf(pot(), "SAR");
check("a released allocation restores availability with no compensating write (it simply stops counting)",
  mils(released.availableAmount) === 10000000 && mils(released.availableCarried) === 37500000, JSON.stringify(released));
const exhausted = availabilityOf(pot({ consumedAmount: "10000.000", consumedCarried: "37500.000" }), "SAR");
check("a fully consumed advance reads zero on both figures", mils(exhausted.availableAmount) === 0 && mils(exhausted.availableCarried) === 0);

let allOk = true;
for (const [c, n, x] of results) { if (!c) allOk = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "ADVANCE ALLOCATIONS PASS" : "ADVANCE ALLOCATIONS FAIL");
process.exit(allOk ? 0 : 1);
