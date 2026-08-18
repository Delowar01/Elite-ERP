import { and, eq, or, desc, inArray, sql } from "drizzle-orm";
import { db, paymentsTable, bankAccountsTable, proformaInvoicesTable } from "@/db";
import { t, type Locale } from "@/lib/i18n/dict";
import { DocNum } from "../../sales/_shared/money";
import { DeletePaymentButton } from "./delete-payment-button";
import { RefundAdvanceButton } from "./refund-advance-button";
import { ReversePaymentButton } from "./reverse-payment-button";
import { Badge } from "@/components/ui/badge";
import { advancePaymentIdsForInvoice } from "@/lib/advance-payment-links";

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  card: "Card",
  cheque: "Cheque",
};

// Shared payment history for a document (Sales Invoice or Proforma Invoice, Issue #14). Rendered
// inside the detail page's CurrencyProvider so amounts use the document currency. Read-only unless
// `canDelete` is set (owner/admin, and not a converted/void document). A payment that originated on
// a proforma and was transferred to the invoice is tagged so its origin stays visible.
export async function PaymentHistory({
  locale,
  orgId,
  baseCurrency,
  source,
  canDelete = false,
  canRefund = false,
  canReverse = false,
}: {
  locale: Locale;
  orgId: number;
  /** The org's base currency — the refund dialog denominates its payout figure in it. */
  baseCurrency: string;
  source: { type: "invoice" | "proforma" | "purchase_order"; id: number };
  canDelete?: boolean;
  /**
   * Offer "Reverse" on ordinary payments against this document. Invoices and purchase orders only —
   * a proforma's receipts are advances, which have their own release and refund paths.
   */
  canReverse?: boolean;
  /**
   * Offer "Refund" on refundable rows: an advance receipt that was never applied and never
   * refunded. Passed separately from canDelete because refunds stay legitimate AFTER conversion —
   * a §10 excess advance lives on a converted (read-only) proforma and refunding it is the way out.
   */
  canRefund?: boolean;
}) {
  // An invoice's history is the payments recorded against it PLUS the advance receipts settling it
  // through an allocation. `salesInvoiceId` alone could only ever name a fully-applied advance, so
  // a partial draw was already missing here — and once the field is cleared for advance receipts,
  // every transferred advance would vanish from the invoice it settled.
  const allocationPaymentIds = source.type === "invoice"
    ? await advancePaymentIdsForInvoice(orgId, source.id)
    : [];
  const col = source.type === "invoice"
    ? paymentsTable.salesInvoiceId
    : source.type === "purchase_order"
      ? paymentsTable.purchaseOrderId
      : paymentsTable.proformaInvoiceId;
  const belongsHere = allocationPaymentIds.length > 0
    ? or(eq(col, source.id), inArray(paymentsTable.id, allocationPaymentIds))
    : eq(col, source.id);
  const rows = await db
    .select({
      id: paymentsTable.id,
      amount: paymentsTable.amount,
      paymentDate: paymentsTable.paymentDate,
      method: paymentsTable.method,
      reference: paymentsTable.reference,
      notes: paymentsTable.notes,
      kind: paymentsTable.kind,
      reversedAt: paymentsTable.reversedAt,
      baseAmount: paymentsTable.baseAmount,
      salesInvoiceId: paymentsTable.salesInvoiceId,
      purchaseOrderId: paymentsTable.purchaseOrderId,
      refundsPaymentId: paymentsTable.refundsPaymentId,
      bankName: bankAccountsTable.name,
      proformaInvoiceId: paymentsTable.proformaInvoiceId,
      proformaNumber: proformaInvoicesTable.proformaNumber,
      currency: paymentsTable.currency,
      // What is still refundable: the receipt less what allocations consume (net of releases) and
      // less what earlier refunds returned. Column names are written out QUALIFIED rather than
      // interpolated — drizzle renders an interpolated column as a bare name, which inside these
      // subqueries would bind to the subquery's own table and silently return zero.
      available: sql<string>`(payments.amount
        - coalesce((select sum(a.applied_amount - coalesce((
              select sum(r.released_amount) from advance_application_releases r
               where r.allocation_id = a.id and r.reversed_at is null), 0))
             from advance_applications a
            where a.advance_payment_id = payments.id and a.released_at is null), 0)
        - coalesce((select sum(f.amount) from payments f where f.refunds_payment_id = payments.id), 0))::text`,
    })
    .from(paymentsTable)
    .leftJoin(bankAccountsTable, eq(bankAccountsTable.id, paymentsTable.bankAccountId))
    .leftJoin(proformaInvoicesTable, eq(proformaInvoicesTable.id, paymentsTable.proformaInvoiceId))
    .where(and(eq(paymentsTable.orgId, orgId), belongsHere))
    .orderBy(desc(paymentsTable.paymentDate), desc(paymentsTable.id));

  // Refundable is now a QUESTION OF BALANCE, not of state. "Never applied and never refunded" was
  // the whole-payment model's rule; under partial allocation an advance can be 80% applied and 20%
  // refundable, or refunded twice in halves. The server recomputes this under the row lock — this
  // decides whether the button is worth offering, nothing more.
  const refundable = (p: (typeof rows)[number]) =>
    p.kind === "advance_receipt" && Number(p.available) > 0;

  /**
   * Reversible rows. Every clause matters:
   *  - `kind === null` — an ORDINARY payment. Advances reach an invoice's history through their
   *    allocation (see `advancePaymentIdsForInvoice` above) and must never offer Reverse: their
   *    undo is a release or a refund, and a fourth route to the same money is how the paths drift.
   *    Written as an explicit null check, never `kind !== "advance_receipt"`, which is NULL for
   *    every ordinary row and has already excluded all of them once in this project.
   *  - it belongs to THIS document rather than merely appearing in its history.
   *  - not already reversed — a reversed row shows no control at all, only its badge.
   */
  const reversible = (p: (typeof rows)[number]) =>
    canReverse && p.kind === null && p.reversedAt === null &&
    (source.type === "invoice" ? p.salesInvoiceId === source.id : p.purchaseOrderId === source.id);

  // The base-currency column appears only when the document is FOREIGN, so base-currency
  // organizations see no change. It shows `baseAmount` — the CASH that moved through the bank — and
  // not `baseAppliedAmount`, which is what cleared AR or AP. The two differ by exactly the realized
  // FX gain or loss (1,140.00 vs 1,125.00 on the reference fixture), so one unlabelled number would
  // be read as whichever the reader assumed. The header names the direction because a single label
  // cannot be right for both: money in is Received, money out is Paid.
  const showBase = rows.some((p) => p.currency !== null && p.currency.toUpperCase() !== baseCurrency.toUpperCase());
  const baseHeader = source.type === "purchase_order" ? "Paid" : "Received";

  return (
    <div className="mt-6">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">{t(locale, "Payment History")}</div>
      {rows.length === 0 ? (
        <div className="text-[12.5px] text-ink-muted">{t(locale, "No payments recorded yet.")}</div>
      ) : (
        <div className="overflow-x-auto rounded-[14px] border border-line">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-ink-faint text-[11px] uppercase tracking-wide">
                <th className="text-start font-medium px-3 py-2">{t(locale, "Date")}</th>
                <th className="text-start font-medium px-3 py-2">{t(locale, "Method")}</th>
                <th className="text-start font-medium px-3 py-2">{t(locale, "Bank Account")}</th>
                <th className="text-start font-medium px-3 py-2">{t(locale, "Reference")}</th>
                <th className="text-end font-medium px-3 py-2">{t(locale, "Amount")}</th>
                {showBase && <th className="text-end font-medium px-3 py-2">{t(locale, baseHeader)} ({baseCurrency})</th>}
                {canRefund && <th className="w-8" />}
                {/* Labelled, unlike the delete column that shipped as a bare `w-8` and read as
                    absent to everyone who looked for it. */}
                {canReverse && <th className="text-center font-medium px-3 py-2">{t(locale, "Reverse")}</th>}
                {canDelete && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={`border-t border-line${p.reversedAt ? " text-ink-faint" : ""}`} data-reversed={p.reversedAt ? "1" : undefined}>
                  <td className="px-3 py-2 font-mono text-xs">{p.paymentDate}</td>
                  <td className="px-3 py-2">{p.method ? t(locale, METHOD_LABEL[p.method] ?? p.method) : "—"}</td>
                  <td className="px-3 py-2">{p.bankName ?? "—"}</td>
                  <td className="px-3 py-2">
                    {p.reference ?? "—"}
                    {source.type === "invoice" && p.proformaInvoiceId && (
                      <span className="ms-1.5 text-[10.5px] text-ink-faint">({t(locale, "from Proforma")} {p.proformaNumber})</span>
                    )}
                    {p.kind === "advance_refund" && (
                      <span className="ms-1.5 text-[10.5px] text-ink-faint">({t(locale, "Refund")})</span>
                    )}
                    {/* A reversed row STAYS — that is the point of reversing rather than deleting —
                        but it must be obvious at a glance that it no longer counts. Badge and
                        strike-through together, because either alone reads as decoration. */}
                    {p.reversedAt && (
                      <Badge variant="neutral" className="ms-1.5" data-testid={`reversed-badge-${p.id}`}>{t(locale, "Reversed")}</Badge>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-end font-mono${p.reversedAt ? " line-through" : ""}`}>
                    <DocNum value={p.amount} kind="amount" />
                  </td>
                  {showBase && (
                    <td className={`px-3 py-2 text-end font-mono${p.reversedAt ? " line-through" : ""}`}>
                      {p.baseAmount === null ? "—" : <DocNum value={p.baseAmount} kind="amount" />}
                    </td>
                  )}
                  {canRefund && (
                    <td className="px-2 py-2 text-center">
                      {refundable(p) && <RefundAdvanceButton locale={locale} paymentId={p.id} reference={p.reference ?? undefined} available={p.available} currency={p.currency} baseCurrency={baseCurrency} />}
                    </td>
                  )}
                  {canReverse && (
                    <td className="px-2 py-2 text-center">
                      {reversible(p) && <ReversePaymentButton locale={locale} paymentId={p.id} reference={p.reference ?? undefined} amount={p.amount} />}
                    </td>
                  )}
                  {canDelete && (
                    <td className="px-2 py-2 text-center">
                      <DeletePaymentButton locale={locale} paymentId={p.id} reference={p.reference ?? undefined} amount={p.amount} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
