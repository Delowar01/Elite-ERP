import "server-only";
import { captureBaseAmounts } from "@/lib/posting-currency";

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
 * Every other reversal in this system mirrors stored lines rather than reconverting — invoice void,
 * credit-note reversal, allocation release. These two are the only ones that re-convert.
 */

export type NoteBaseAmounts =
  | { ok: true; exchangeRate: string; baseTotal: string; baseTaxAmount: string; missingRate?: { currency: string; date: string } }
  | { ok: false; error: string; missingRate?: { currency: string; date: string } };

export async function noteBaseAmounts(args: {
  orgId: number;
  baseCurrency: string;
  /**
   * The document being reversed — the invoice behind a credit note, the purchase order behind a
   * debit note. Carried through the signature already but NOT YET READ: the whole fix is to convert
   * at `source.exchangeRate` instead of at the note's own date, and it lands in the next commit so
   * the suite can be watched failing against the shipped rule first.
   */
  source: { currency: string | null; exchangeRate: string | null };
  note: { currency: string | null; total: string; taxTotal: string; issueDate: string };
}): Promise<NoteBaseAmounts> {
  void args.source;
  // SHIPPED BEHAVIOUR, moved not changed: the rate date is the NOTE's own issue date.
  const captured = await captureBaseAmounts({
    orgId: args.orgId,
    baseCurrency: args.baseCurrency,
    docCurrency: args.note.currency,
    total: args.note.total,
    taxTotal: args.note.taxTotal,
    date: args.note.issueDate,
  });
  if (!captured.ok) return { ok: false, error: captured.error, missingRate: captured.missingRate };
  return { ok: true, exchangeRate: captured.exchangeRate, baseTotal: captured.baseTotal, baseTaxAmount: captured.baseTaxAmount };
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
