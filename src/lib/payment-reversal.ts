import "server-only";
import { moneyEpsilon, roundMoney } from "@/lib/currency/currencies";

/**
 * Reversing a recorded payment — sales invoices and purchase orders alike.
 *
 * ## The design in one sentence, because it is the reason this file is short
 *
 * **The reversal MIRRORS the payment's own stored journal lines. It does not recompute anything.**
 *
 * That is stronger than "convert at the stored rate", and three consequences follow from it:
 *
 *  1. **No FX logic here, at all.** The reversal never learns whether it is undoing
 *     `Dr Bank / Cr AR / Cr 4900` or `Dr AP / Cr Bank / Dr 4900`; it reads lines and swaps the two
 *     columns. So another payment's realized gain is untouched BY CONSTRUCTION rather than by a
 *     test, and `fxLine`, `capturePaymentBase` and every suite that covers them are not at risk.
 *  2. **Both document types are one code path.** Only the document UPDATE branches — an invoice
 *     recomputes its status, a purchase order has no paid status to recompute (see the action).
 *  3. **A third document type would need almost nothing** — the posting half already handles it.
 *
 * ## Identity
 *
 * `sourceType = "payment_reversal"`, `sourceId = payments.id`. Note what that collides with: the
 * ORIGINAL entry is `(payment, <the same id>)`. Checking the id without the type finds the original
 * and concludes the reversal is already posted — or, from the other direction, finds the reversal
 * and refuses to post the payment. Both are wrong and neither errors. The check is type-qualified
 * and runs inside the transaction.
 */

/** Payments this action will reverse. Everything else is refused by name. */
export type ReversiblePayment = {
  id: number;
  kind: string | null;
  salesInvoiceId: number | null;
  purchaseOrderId: number | null;
  proformaInvoiceId: number | null;
  reversedAt: Date | null;
};

/**
 * An ALLOWLIST, deliberately — a denylist grows a hole every time a new payment kind is added, and
 * this codebase has already shipped `kind <> 'advance_receipt'`, which is NULL for every ordinary
 * payment and therefore matched none of them.
 */
export function reversalRefusal(p: ReversiblePayment): string | null {
  if (p.reversedAt !== null) return "This payment has already been reversed.";
  if (p.kind === "advance_receipt") {
    return "This is a customer advance, not an ordinary payment. Release its allocation or refund it instead.";
  }
  if (p.kind === "advance_refund") {
    return "An advance refund cannot be reversed here. Record the money coming back in as a new advance receipt.";
  }
  if (p.kind !== null) return `Payments of kind "${p.kind}" cannot be reversed.`;
  const onInvoice = p.salesInvoiceId !== null;
  const onPo = p.purchaseOrderId !== null;
  if (onInvoice && onPo) return "This payment is linked to both a sales invoice and a purchase order and cannot be reversed automatically.";
  if (!onInvoice && !onPo) {
    return p.proformaInvoiceId !== null
      ? "This payment sits on a proforma invoice. Convert the proforma or delete the payment instead."
      : "This payment is not linked to a sales invoice or a purchase order.";
  }
  return null;
}

/** The original entry's lines with debit and credit swapped. The whole posting rule. */
export function mirrorLines(
  lines: { accountId: number; debit: string; credit: string }[],
): { accountId: number; debit: string; credit: string }[] {
  return lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit }));
}

/**
 * The document's paid figures after the reversal, subtracted from the STORED payment figures —
 * never a fresh conversion. Identical in shape to `deletePaymentAction`'s `unpaidBase`, including
 * its null-poisoning rule: un-paying a pre-FX-7 payment (no stored base) from a foreign document
 * leaves `basePaidAmount` null, because honestly unknown beats a plausible wrong number.
 */
export function paidAfterReversal(args: {
  doc: { currency: string | null; paidAmount: string; basePaidAmount: string | null };
  payment: { amount: string; baseAppliedAmount: string | null };
  baseCurrency: string;
}): { paidAmount: string; basePaidAmount: string | null } {
  const docCurrency = args.doc.currency ?? args.baseCurrency;
  const paidAmount = roundMoney(Math.max(0, Number(args.doc.paidAmount) - Number(args.payment.amount)), docCurrency);
  if (docCurrency.toUpperCase() === args.baseCurrency.toUpperCase()) {
    // Base-currency identity: basePaidAmount tracks paidAmount exactly.
    return { paidAmount, basePaidAmount: paidAmount };
  }
  if (args.payment.baseAppliedAmount === null || args.doc.basePaidAmount === null) {
    return { paidAmount, basePaidAmount: null };
  }
  return {
    paidAmount,
    basePaidAmount: roundMoney(Math.max(0, Number(args.doc.basePaidAmount) - Number(args.payment.baseAppliedAmount)), args.baseCurrency),
  };
}

/**
 * A sales invoice's status after its paid amount moves — the REAL status set, with the document's
 * own epsilon rather than a fixed half-cent.
 *
 * An invoice returned to `sent` becomes voidable again, which is correct: it is in exactly the
 * state it was in before the payment, and that state has always allowed void. The reversal's own
 * entry is keyed `payment_reversal` while a void posts under `sales_invoice`, so a later void adds
 * a third entry rather than colliding with either.
 *
 * There is no purchase-order counterpart on purpose — see the action.
 */
export function invoiceStatusAfter(newPaid: string, total: string, docCurrency: string): string {
  const eps = moneyEpsilon(docCurrency);
  if (Number(newPaid) <= eps) return "sent";
  if (Number(newPaid) >= Number(total) - eps) return "paid";
  return "partially_paid";
}
