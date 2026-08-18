import "server-only";
import { toBaseAmount } from "@/lib/exchange-rates";

/**
 * The conversion and the journal lines for a CREDIT NOTE and its debit-note twin.
 *
 * Extracted from the two actions verbatim, because they were the same eight lines in two files and
 * this codebase has twice now fixed one copy of a duplicated construction and found the other
 * later. Nothing here changes behaviour yet — `verify-note-fx` fails against it, deliberately, and
 * the next commit changes the rule in one place.
 *
 * ## The defect this file exists to fix
 *
 * A credit note converts at ITS OWN issue date. But a credit note moves no cash: it reverses part
 * of an invoice whose AR *and revenue* were both booked at that invoice's stored rate. Clearing
 * them at a different rate invents a difference that never happened.
 *
 * The AR tail is a control-account residual — the document-currency balance reaches zero while GL
 * 1100 keeps a base-currency remainder, and ledger and subledger agree because both are wrong
 * together, which is why no invariant caught it.
 *
 * **The revenue tail is the serious half.** The note debits 4000 at the note-date rate, so
 * crediting 100% of a foreign invoice does not return base revenue to zero. What is left is a
 * phantom FX gain or loss buried inside revenue, where no FX account can explain it and the P&L is
 * simply wrong.
 *
 * Every other reversal in this system mirrored stored lines rather than reconverting — invoice
 * void, credit-note reversal, allocation release. These two were the only ones that re-converted.
 *
 * ## The rule
 *
 * **Inherit the source document's stored `exchangeRate`.** A credit note takes the invoice's; a
 * debit note takes the purchase order's. Never a fresh lookup at the note's own date.
 *
 * Two independent lines of reasoning reach the same answer. The codebase's own principle: a
 * reversal reproduces what was booked, it does not re-price it. And the tax rule: a credit note is
 * an adjustment to the **original supply**, so its base amounts must mirror the original document's
 * conversion — which Phase 2 e-invoicing will also require, since the e-invoice references the
 * original.
 *
 * ## Why rate inheritance rather than mirroring the stored base figures proportionally
 *
 * One rule covers the partial and the full case, and the 100% case then falls out **exactly**
 * rather than through a special branch: converting the same document amount at the same rate
 * through the same rounding produces an identical string. The `full` branch of `releaseShareOf`
 * is the precedent — exactness earned by identical inputs, not by a tolerance.
 */

export type NoteBaseAmounts =
  | { ok: true; exchangeRate: string; baseTotal: string; baseTaxAmount: string }
  | { ok: false; error: string };

/**
 * There is deliberately no `missingRate` on either arm, and no async work left in here.
 *
 * `missingRate` is the structured seam behind the one-click rate-fetch affordance, and four other
 * posting paths still return it — invoice send, purchase-order receipt, payment capture, advance
 * receipt — because for them the remedy really is "enter a rate for this date". These two are the
 * asymmetry, and it is intentional rather than an oversight: after this change there is no rate for
 * a note to fetch. The answer is on the source document or the operation is refused, so offering
 * the affordance would present the user a remedy that cannot work. The function is synchronous for
 * the same underlying reason — nothing here consults the rate table at all.
 */
export function noteBaseAmounts(args: {
  baseCurrency: string;
  /** The document being reversed — the invoice behind a credit note, the PO behind a debit note. */
  source: { currency: string | null; exchangeRate: string | null };
  note: { currency: string | null; total: string; taxTotal: string };
}): NoteBaseAmounts {
  const base = args.baseCurrency.toUpperCase();
  // Null means "the base currency" on both documents, so normalise before comparing — an invoice
  // storing "SAR" explicitly and a note storing null are the same currency, not a mismatch.
  const sourceCurrency = (args.source.currency ?? base).toUpperCase();
  const noteCurrency = (args.note.currency ?? base).toUpperCase();

  if (sourceCurrency !== noteCurrency) {
    // Today both creators copy the source's currency, so this cannot happen — which is exactly why
    // it refuses rather than silently picking one of the two rates. If the premise ever breaks,
    // neither conversion is defensible and inventing one would be the whole defect again.
    return {
      ok: false,
      error: `This note is in ${noteCurrency} but the document it reverses is in ${sourceCurrency}. A note must be in the same currency as its source.`,
    };
  }

  if (noteCurrency === base) {
    // Base-currency identity: the document figures ARE base figures. No rate, no lookup, no
    // dependency on the rate table — the overwhelmingly common case, and byte-for-byte what it has
    // always done. Checked BEFORE the stored-rate refusal, because a base document has nothing to
    // inherit and never did.
    return { ok: true, exchangeRate: "1", baseTotal: args.note.total, baseTaxAmount: args.note.taxTotal };
  }

  if (args.source.exchangeRate === null) {
    // A foreign source with no stored conversion (pre-FX-6 history): its AR — or its AP and
    // inventory — was never booked in base, so there is no figure to reverse against. An honest
    // refusal, in the shape `arClearedFor` already uses, never a guessed rate.
    return {
      ok: false,
      error: "The document this note reverses has no stored base-currency conversion, so there is no rate to inherit. It was posted before exchange rates were captured, and re-converting it now at today's rate would invent a gain that never happened.",
    };
  }

  const rate = args.source.exchangeRate;
  return {
    ok: true,
    exchangeRate: rate,
    baseTotal: toBaseAmount(args.note.total, rate, args.baseCurrency),
    baseTaxAmount: toBaseAmount(args.note.taxTotal, rate, args.baseCurrency),
  };
}

/**
 * The credit note's lines: Dr Revenue / Cr AR, plus Dr VAT Payable when there is tax.
 *
 * The revenue figure is DERIVED as `baseTotal − baseTaxAmount` by the caller rather than converted
 * separately, so the entry balances by construction — converting three figures independently rounds
 * three times and can miss by a minor unit.
 *
 * **There is no FX parameter, and that is the point.** No cash moves, so there is no realized
 * exchange difference to recognise. A note whose figures come from one rate balances on its own; if
 * a posting ever fails to balance here, the conversion upstream is wrong and the answer is to fix
 * it, never to add a 4900 line that makes the books balance around a gain that did not occur.
 */
export function creditNoteLines(args: {
  baseTotal: string;
  baseRevenue: string;
  baseTaxAmount: string;
  arAccountId: number;
  revenueAccountId: number;
  vatAccountId: number;
}): { accountId: number; debit: string; credit: string }[] {
  const lines = [
    { accountId: args.revenueAccountId, debit: args.baseRevenue, credit: "0" },
    { accountId: args.arAccountId, debit: "0", credit: args.baseTotal },
  ];
  if (Number(args.baseTaxAmount) > 0) {
    lines.push({ accountId: args.vatAccountId, debit: args.baseTaxAmount, credit: "0" });
  }
  return lines;
}

/**
 * The debit note's lines: Dr Accounts Payable / Cr Inventory. Two lines of the same figure, so it
 * balances by construction. No FX parameter, for the same reason as above.
 */
export function debitNoteLines(args: {
  baseTotal: string;
  apAccountId: number;
  inventoryAccountId: number;
}): { accountId: number; debit: string; credit: string }[] {
  return [
    { accountId: args.apAccountId, debit: args.baseTotal, credit: "0" },
    { accountId: args.inventoryAccountId, debit: "0", credit: args.baseTotal },
  ];
}
