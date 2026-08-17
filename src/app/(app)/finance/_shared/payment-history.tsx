import { and, eq, desc, sql } from "drizzle-orm";
import { db, paymentsTable, bankAccountsTable, proformaInvoicesTable } from "@/db";
import { t, type Locale } from "@/lib/i18n/dict";
import { DocNum } from "../../sales/_shared/money";
import { DeletePaymentButton } from "./delete-payment-button";
import { RefundAdvanceButton } from "./refund-advance-button";

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
}: {
  locale: Locale;
  orgId: number;
  /** The org's base currency — the refund dialog denominates its payout figure in it. */
  baseCurrency: string;
  source: { type: "invoice" | "proforma"; id: number };
  canDelete?: boolean;
  /**
   * Offer "Refund" on refundable rows: an advance receipt that was never applied and never
   * refunded. Passed separately from canDelete because refunds stay legitimate AFTER conversion —
   * a §10 excess advance lives on a converted (read-only) proforma and refunding it is the way out.
   */
  canRefund?: boolean;
}) {
  const col = source.type === "invoice" ? paymentsTable.salesInvoiceId : paymentsTable.proformaInvoiceId;
  const rows = await db
    .select({
      id: paymentsTable.id,
      amount: paymentsTable.amount,
      paymentDate: paymentsTable.paymentDate,
      method: paymentsTable.method,
      reference: paymentsTable.reference,
      notes: paymentsTable.notes,
      kind: paymentsTable.kind,
      salesInvoiceId: paymentsTable.salesInvoiceId,
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
    .where(and(eq(paymentsTable.orgId, orgId), eq(col, source.id)))
    .orderBy(desc(paymentsTable.paymentDate), desc(paymentsTable.id));

  // Refundable is now a QUESTION OF BALANCE, not of state. "Never applied and never refunded" was
  // the whole-payment model's rule; under partial allocation an advance can be 80% applied and 20%
  // refundable, or refunded twice in halves. The server recomputes this under the row lock — this
  // decides whether the button is worth offering, nothing more.
  const refundable = (p: (typeof rows)[number]) =>
    p.kind === "advance_receipt" && Number(p.available) > 0;

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
                {canRefund && <th className="w-8" />}
                {canDelete && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-line">
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
                  </td>
                  <td className="px-3 py-2 text-end font-mono"><DocNum value={p.amount} kind="amount" /></td>
                  {canRefund && (
                    <td className="px-2 py-2 text-center">
                      {refundable(p) && <RefundAdvanceButton locale={locale} paymentId={p.id} reference={p.reference ?? undefined} available={p.available} currency={p.currency} baseCurrency={baseCurrency} />}
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
