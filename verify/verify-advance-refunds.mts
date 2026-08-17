// Run via `npm run verify:advance-refunds` — tsx with the react-server condition.

/**
 * Partial refunds and the refund's FX shape (§10), plus the SECOND property sweep.
 *
 * A refund used to post the advance's carried value on BOTH lines. That is right for 2300 and
 * wrong for the bank: a refund is a real cash payment out, so if the rate moved since the receipt
 * the bank pays a different base figure than the liability was carried at, and the difference is
 * realized FX. It was the one cash movement in the system booked at a stale rate.
 *
 * ```text
 * Dr 2300  the advance's carried value  (apportioned; exact residual when this empties it)
 * Cr Bank  what the bank ACTUALLY paid out
 * 4900     the derived difference
 * ```
 *
 * Two things are proven here, and a third is deliberately not:
 *
 *  1. **The refund's own arithmetic** — a pot consumed by any interleaving of allocations and
 *     refunds returns exactly its carried base, and the three-line construction balances.
 *  2. **THE SECOND SWEEP** (approved after the first found a shipped residual bug): the same
 *     derived-residual construction ships in `fxLine`'s derived difference and in FX-7's closing
 *     payment (`baseTotal − basePaidAmount`). Both suites that cover them use hand-picked figures,
 *     which divide evenly. This sweeps awkward rates and non-dividing amounts and reports whether
 *     anything strands. A strand here is a defect in shipped posting math, not a test improvement.
 *  3. The ACTION's wiring — session, lock, dialog, provenance — is browser-tier, because a server
 *     action with a session cannot be reached from here.
 */
import {
  availabilityOf, carriedBaseFor, arClearedFor, type AdvancePot,
} from "../src/lib/advance-allocations";
import { fxLine, mils } from "../src/lib/payment-currency";
import { subtractMoney } from "../src/lib/posting-currency";
import { roundMoney, moneyEpsilon } from "../src/lib/currency/currencies";

const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const m = (v: string | number) => Math.round(Number(v) * 1000);

// ---------------------------------------------------------------------------------------------
// 1. The refund's three-line construction.
// ---------------------------------------------------------------------------------------------

/** The refund entry exactly as `refundAdvanceAction` builds it. */
function refundLines(args: { carried: string; paidOut: string; baseCurrency: string }) {
  const fx = fxLine({
    baseAmount: args.paidOut, baseApplied: args.carried, direction: "out",
    baseCurrency: args.baseCurrency, fxAccountId: 4900,
  });
  return [
    { account: 2300, debit: args.carried, credit: "0" },
    { account: 1000, debit: "0", credit: args.paidOut },
    ...(fx ? [{ account: fx.accountId, debit: fx.debit, credit: fx.credit }] : []),
  ];
}
const balanced = (lines: { debit: string; credit: string }[]) =>
  lines.reduce((s, l) => s + mils(l.debit), 0) === lines.reduce((s, l) => s + mils(l.credit), 0);

const lossCase = refundLines({ carried: "1504.00", paidOut: "1520.00", baseCurrency: "SAR" });
check("paying out MORE base than the liability carried is a realized LOSS — Dr 4900 16.00",
  lossCase.length === 3 && lossCase[2].account === 4900 && m(lossCase[2].debit) === 16000 && balanced(lossCase),
  JSON.stringify(lossCase));
const gainCase = refundLines({ carried: "1504.00", paidOut: "1480.00", baseCurrency: "SAR" });
check("paying out LESS is a realized GAIN — Cr 4900 24.00",
  gainCase.length === 3 && m(gainCase[2].credit) === 24000 && balanced(gainCase), JSON.stringify(gainCase));
const flatCase = refundLines({ carried: "3000.00", paidOut: "3000.00", baseCurrency: "SAR" });
check("an unmoved rate posts NO 4900 line — two lines, as before this commit",
  flatCase.length === 2 && balanced(flatCase), JSON.stringify(flatCase));
check("2300 is ALWAYS relieved at the carried value, never at what the cash cost",
  m(lossCase[0].debit) === 1504000 && m(gainCase[0].debit) === 1504000);

// ---------------------------------------------------------------------------------------------
// 2. THE SECOND SWEEP — the derived FX difference and FX-7's closing residual.
//
// The first sweep found that a residual bug survives every hand-picked figure: 80/20 of 37,500
// divides evenly, and so does almost anything a human types into a test. These two constructions
// ship in the payment paths and are covered by hand-picked figures only.
// ---------------------------------------------------------------------------------------------

let fxStrands = 0;
let fxWorst = "";
let fxCases = 0;
for (const baseCurrency of ["SAR", "KWD", "JPY"] as const) {
  for (let i = 0; i < 120; i++) {
    // Two independently rounded base figures — a liability booked one day, cash paid another.
    const carried = roundMoney(101 + ((i * 977) % 8887) / 89, baseCurrency);
    const paidOut = roundMoney(Number(carried) * (0.87 + ((i * 37) % 53) / 200), baseCurrency);
    const lines = refundLines({ carried, paidOut, baseCurrency });
    fxCases++;
    if (!balanced(lines)) {
      fxStrands++;
      fxWorst = `unbalanced: carried ${carried} paidOut ${paidOut} ${baseCurrency} → ${JSON.stringify(lines)}`;
      continue;
    }
    // The derived line must be exactly the difference, and storable at the base minor unit.
    const fx = lines[2];
    const expected = Math.abs(m(carried) - m(paidOut));
    const got = fx ? Math.max(m(fx.debit), m(fx.credit)) : 0;
    // Storability compared NUMERICALLY: the untouched side of the line is the literal "0", which is
    // not string-equal to roundMoney's "0.000" in a three-decimal currency — a string comparison
    // here fails on a figure that is perfectly storable, and prints two identical numbers.
    const storable = !fx || (m(fx.debit) === m(roundMoney(fx.debit, baseCurrency)) && m(fx.credit) === m(roundMoney(fx.credit, baseCurrency)));
    if (got !== expected || !storable) {
      fxStrands++;
      fxWorst = `derived ${got / 1000} vs difference ${expected / 1000} (carried ${carried}, paidOut ${paidOut} ${baseCurrency})`;
    }
  }
}
check(`SWEEP A (${fxCases} cases, three minor units): the derived 4900 line is EXACTLY the difference and every entry balances`,
  fxStrands === 0, fxWorst);

// FX-7's closing residual: a run of partial payments against a foreign document, the LAST of which
// derives `baseTotal − basePaidAmount` instead of reconverting. The claim is that basePaidAmount
// lands on baseTotal exactly, however awkwardly the payments and the rate divide.
let closeStrands = 0;
let closeWorst = "";
let closeCases = 0;
for (const [docCurrency, baseCurrency] of [["USD", "SAR"], ["USD", "KWD"], ["KWD", "SAR"], ["JPY", "SAR"]] as const) {
  for (let i = 0; i < 60; i++) {
    const rate = (2.7 + ((i * 41) % 97) / 33).toFixed(8);
    const total = roundMoney(59 + ((i * 887) % 7919) / 71, docCurrency);
    const baseTotal = roundMoney(Number(total) * Number(rate), baseCurrency);
    const k = 2 + (i % 4);
    let paid = 0;
    let basePaid = 0;
    const step = moneyEpsilon(docCurrency) * 2;
    for (let part = 0; part < k; part++) {
      const last = part === k - 1;
      const amount = last
        ? roundMoney(Number(total) - paid, docCurrency)
        : roundMoney(Math.max(step, (Number(total) - paid) / (k - part) + ((part % 2) ? step : -step)), docCurrency);
      // The shipped composition: proportional at the booked rate, the closing one DERIVED.
      const closing = paid + Number(amount) >= Number(total) - moneyEpsilon(docCurrency);
      const baseApplied = closing
        ? subtractMoney(baseTotal, roundMoney(basePaid, baseCurrency), baseCurrency)
        : roundMoney(Number(amount) * Number(rate), baseCurrency);
      if (baseApplied !== roundMoney(baseApplied, baseCurrency)) {
        closeStrands++;
        closeWorst = `unstorable ${baseApplied} in ${baseCurrency}`;
      }
      paid += Number(amount);
      basePaid += Number(baseApplied);
    }
    closeCases++;
    if (m(roundMoney(basePaid, baseCurrency)) !== m(baseTotal) || m(roundMoney(paid, docCurrency)) !== m(total)) {
      closeStrands++;
      closeWorst = `${docCurrency}/${baseCurrency} total ${total} @ ${rate} in ${k} parts → basePaid ${roundMoney(basePaid, baseCurrency)} vs baseTotal ${baseTotal}`;
    }
  }
}
check(`SWEEP B (${closeCases} documents, 2–5 uneven partial payments, crossed minor units): the CLOSING payment lands basePaidAmount on baseTotal exactly`,
  closeStrands === 0, closeWorst);

// The allocation side of the same claim, through the shipped `arClearedFor`.
let arStrands = 0;
let arWorst = "";
for (let i = 0; i < 120; i++) {
  const rate = (3.1 + ((i * 53) % 89) / 29).toFixed(8);
  const total = roundMoney(83 + ((i * 641) % 5077) / 37, "USD");
  const baseTotal = roundMoney(Number(total) * Number(rate), "SAR");
  let paid = 0;
  let basePaid = 0;
  const k = 2 + (i % 3);
  for (let part = 0; part < k; part++) {
    const last = part === k - 1;
    const applyAmount = last ? roundMoney(Number(total) - paid, "USD") : roundMoney((Number(total) - paid) / (k - part) + 0.01, "USD");
    const r = arClearedFor({
      invoice: { currency: "USD", exchangeRate: rate, baseTotal, basePaidAmount: roundMoney(basePaid, "SAR"), total, paidAmount: roundMoney(paid, "USD") },
      applyAmount,
      baseCurrency: "SAR",
    });
    if (!r.ok) { arStrands++; arWorst = r.error; break; }
    paid += Number(applyAmount);
    basePaid += Number(r.arCleared);
  }
  if (m(roundMoney(basePaid, "SAR")) !== m(baseTotal)) {
    arStrands++;
    arWorst = `total ${total} @ ${rate} in ${k} draws → ${roundMoney(basePaid, "SAR")} vs ${baseTotal}`;
  }
}
check("SWEEP B′ (120 invoices): the allocation that CLOSES an invoice lands its AR on baseTotal exactly",
  arStrands === 0, arWorst);

// ---------------------------------------------------------------------------------------------
// 3. A pot consumed by any interleaving of allocations and refunds returns exactly its carried base.
// ---------------------------------------------------------------------------------------------

let potStrands = 0;
let potWorst = "";
let potCases = 0;
for (const [docCurrency, baseCurrency] of [["USD", "SAR"], ["KWD", "SAR"], ["USD", "KWD"]] as const) {
  for (let i = 0; i < 80; i++) {
    const amount = roundMoney(211 + ((i * 733) % 9091) / 61, docCurrency);
    const carriedBase = roundMoney(Number(amount) * (2.9 + ((i * 67) % 83) / 40), baseCurrency);
    const pot: AdvancePot = { amount, carriedBase, consumedAmount: "0", consumedCarried: "0", currency: docCurrency };
    const k = 2 + (i % 4);
    let consumedAmount = 0;
    let consumedCarried = 0;
    const step = moneyEpsilon(docCurrency) * 2;
    for (let part = 0; part < k; part++) {
      const last = part === k - 1;
      const live: AdvancePot = {
        ...pot,
        consumedAmount: roundMoney(consumedAmount, docCurrency),
        consumedCarried: roundMoney(consumedCarried, baseCurrency),
      };
      const draw = last
        ? roundMoney(Number(amount) - consumedAmount, docCurrency)
        : roundMoney(Math.max(step, (Number(amount) - consumedAmount) / (k - part) + ((part % 2) ? step : -step)), docCurrency);
      // Allocations and refunds draw on the SAME pot with the same rule — alternating here is the
      // point: if refunds were excluded from the residual rule, an advance emptied by a refund
      // would leave a tail in 2300 forever.
      const carried = carriedBaseFor({ pot: live, drawAmount: draw, baseCurrency });
      if (carried !== roundMoney(carried, baseCurrency)) {
        potStrands++;
        potWorst = `unstorable draw ${carried} in ${baseCurrency}`;
      }
      const avail = availabilityOf(live, baseCurrency);
      if (Number(avail.availableAmount) < 0 || Number(avail.availableCarried) < 0) {
        potStrands++;
        potWorst = `negative availability at part ${part}: ${JSON.stringify(avail)}`;
      }
      consumedAmount += Number(draw);
      consumedCarried += Number(carried);
    }
    potCases++;
    if (m(roundMoney(consumedCarried, baseCurrency)) !== m(carriedBase) || m(roundMoney(consumedAmount, docCurrency)) !== m(amount)) {
      potStrands++;
      potWorst = `${docCurrency}/${baseCurrency} ${amount}/${carriedBase} in ${k} mixed draws → ${roundMoney(consumedCarried, baseCurrency)} vs ${carriedBase}`;
    }
  }
}
check(`SWEEP C (${potCases} advances, allocations and refunds interleaved): the pot returns its carried base EXACTLY, availability never negative`,
  potStrands === 0, potWorst);

// A refund that empties an advance takes the residual, not a proportion — the case that would
// otherwise strand a tail in 2300 permanently.
const tailPot: AdvancePot = { amount: "1000.00", carriedBase: "3760.00", consumedAmount: "600.00", consumedCarried: "2256.00", currency: "USD" };
check("a refund of the last 400.00 takes the carried RESIDUAL 1,504.00, not 400/1000 of the original",
  m(carriedBaseFor({ pot: tailPot, drawAmount: "400.00", baseCurrency: "SAR" })) === 1504000,
  carriedBaseFor({ pot: tailPot, drawAmount: "400.00", baseCurrency: "SAR" }));
check("…and a PARTIAL refund of 100.00 from the same pot is proportional (376.00)",
  m(carriedBaseFor({ pot: tailPot, drawAmount: "100.00", baseCurrency: "SAR" })) === 376000,
  carriedBaseFor({ pot: tailPot, drawAmount: "100.00", baseCurrency: "SAR" }));

let allOk = true;
for (const [c, n, x] of results) { if (!c) allOk = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "ADVANCE REFUNDS PASS" : "ADVANCE REFUNDS FAIL");
process.exit(allOk ? 0 : 1);
