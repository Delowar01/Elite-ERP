import { Fragment } from "react";
import { notFound } from "next/navigation";
import { eq, and, sql } from "drizzle-orm";
import { DocumentTermsView } from "../../../sales/_shared/terms-view";
import { BankAccountBlocks } from "../../../sales/_shared/bank-account-blocks";
import { CurrencyProvider } from "@/components/ui/currency-mark";
import { docMoneyMark } from "../../../sales/_shared/doc-currency";
import { SafeRichText } from "../../../sales/_shared/safe-rich-text";
import { LineItemCell, LineDescRow } from "../../../sales/_shared/line-item-cell";
import { db, purchaseOrdersTable, purchaseOrderItemsTable, vendorsTable, bankAccountsTable, orgsTable, paymentsTable } from "@/db";
import { PaymentHistory } from "../../../finance/_shared/payment-history";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TotalsStrip } from "../../../sales/_shared/totals-strip";
import { DocNum } from "../../../sales/_shared/money";
import { PoDetailActions } from "../po-detail-actions";
import { DownloadPdfButton } from "../../../sales/_shared/download-pdf-button";
import { EditDocumentButton } from "../../../_shared/edit-document";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  ordered: "info",
  received: "success",
  cancelled: "danger",
};

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { id } = await params;
  const poId = Number(id);

  const [po] = await db
    .select({
      id: purchaseOrdersTable.id,
      poNumber: purchaseOrdersTable.poNumber,
      title: purchaseOrdersTable.title,
      status: purchaseOrdersTable.status,
      archivedAt: purchaseOrdersTable.archivedAt,
      deletedAt: purchaseOrdersTable.deletedAt,
      orderDate: purchaseOrdersTable.orderDate,
      subtotal: purchaseOrdersTable.subtotal,
      discount: purchaseOrdersTable.discount,
      taxTotal: purchaseOrdersTable.taxTotal,
      total: purchaseOrdersTable.total,
      paidAmount: purchaseOrdersTable.paidAmount,
      notes: purchaseOrdersTable.notes,
      terms: purchaseOrdersTable.terms,
      bankAccounts: purchaseOrdersTable.bankAccounts,
      currency: purchaseOrdersTable.currency,
      vendorName: vendorsTable.name,
    })
    .from(purchaseOrdersTable)
    .innerJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
    .where(and(eq(purchaseOrdersTable.id, poId), eq(purchaseOrdersTable.orgId, session.orgId)));

  if (!po) notFound();

  const [items, bankAccounts, [org]] = await Promise.all([
    db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, poId)),
    db
      .select({ id: bankAccountsTable.id, name: bankAccountsTable.name })
      .from(bankAccountsTable)
      .where(and(eq(bankAccountsTable.orgId, session.orgId), eq(bankAccountsTable.isActive, true))),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
  ]);
  const balanceDue = Number(po.total) - Number(po.paidAmount);
  const showPayments = po.status === "received";

  /**
   * The payment HISTORY is gated on payments existing, not on status.
   *
   * `showPayments` (status === "received") is safe for the totals strip, and it happens to be safe
   * for history too — a PO must be `received` to be paid, and the lifecycle does not allow `cancel`
   * from `received`, so no cancelled PO can hold payments. But that is a coincidence of two rules
   * in other files, not a property of this gate: permit cancel-from-received, or give POs paid
   * statuses (docs/backlog.md), and this screen silently hides a document's entire payment history
   * along with every Reverse control on it — the same class of problem as the history being missing
   * in the first place.
   *
   * So it asks the question it actually means: are there payments to show?
   */
  const [paymentCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(paymentsTable)
    .where(and(eq(paymentsTable.orgId, session.orgId), eq(paymentsTable.purchaseOrderId, po.id)));
  const showHistory = showPayments || Number(paymentCount?.n ?? 0) > 0;
  const canReversePayments =
    (session.role === "owner" || session.role === "admin") && po.status !== "cancelled";

  return (
    <CurrencyProvider mark={docMoneyMark(org, po.currency)}>
    <div className="max-w-4xl mx-auto">
      <div className="inv-head">
        <div>
          <h3 className="mono">{po.poNumber}</h3>
          <div className="inv-sub">
            {t(locale, "Vendor:")} {po.vendorName} · {t(locale, "Order Date")} {po.orderDate}
            {po.title ? ` · ${po.title}` : ""}
            <Badge className="ms-2" variant={STATUS_VARIANT[po.status] ?? "neutral"} live>
              {t(locale, po.status)}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <EditDocumentButton locale={locale} docType="purchase_order" id={po.id} number={po.poNumber} status={po.status} recordState={po.deletedAt ? "deleted" : po.archivedAt ? "archived" : "active"} />
          <DownloadPdfButton locale={locale} type="purchase-order" docId={po.id} number={po.poNumber} />
          <PoDetailActions
            locale={locale}
            currency={po.currency ?? org.currency}
            baseCurrency={org.currency}
            poId={po.id}
            poNumber={po.poNumber}
            vendorName={po.vendorName}
            balance={balanceDue}
            status={po.status}
            bankAccounts={bankAccounts}
          />
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Item")}</TableHead>
            <TableHead className="text-right">{t(locale, "Qty")}</TableHead>
            <TableHead className="text-right">{t(locale, "Unit cost")}</TableHead>
            <TableHead className="text-right">{t(locale, "VAT")}</TableHead>
            <TableHead className="text-right">{t(locale, "Line Total")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <Fragment key={it.id}>
            <TableRow>
              <TableCell><LineItemCell description={it.description} /></TableCell>
              <TableCell className="text-right font-mono"><DocNum value={it.quantity} kind="quantity" /></TableCell>
              <TableCell className="text-right font-mono"><DocNum value={it.unitCost} kind="rate" /></TableCell>
              <TableCell className="text-right font-mono">{it.taxRatePercent}%</TableCell>
              <TableCell className="text-right font-mono"><DocNum value={it.lineTotal} kind="amount" /></TableCell>
            </TableRow>
              <LineDescRow customFields={it.customFields} />
            </Fragment>
          ))}
        </TableBody>
      </Table>

      <div className="mt-4 max-w-sm ms-auto">
        <TotalsStrip
          locale={locale}
          subtotal={po.subtotal}
          discount={po.discount}
          taxTotal={po.taxTotal}
          finalLabel={showPayments ? "Balance due" : "Total"}
          finalValue={showPayments ? String(balanceDue) : po.total}
          extraRows={showPayments ? [{ label: "Paid", value: po.paidAmount, colorClass: "text-success" }] : undefined}
        />
      </div>

      {po.status === "ordered" && (
        <div className="note" style={{ marginTop: 20 }}>
          {t(locale, "Receiving posts Dr Inventory, Cr Accounts Payable in a transaction alongside the stock increment.")}
        </div>
      )}

      {showHistory && (
        <PaymentHistory
          locale={locale}
          orgId={session.orgId}
          baseCurrency={session.orgCurrency}
          source={{ type: "purchase_order", id: po.id }}
          canReverse={canReversePayments}
        />
      )}

      <BankAccountBlocks locale={locale} accounts={po.bankAccounts} className="mt-5" />

      <DocumentTermsView locale={locale} terms={po.terms} className="mt-5" />
      {po.notes && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Notes")}</div>
          <div className="text-[13px] text-ink-muted"><SafeRichText value={po.notes} /></div>
        </div>
      )}
    </div>
    </CurrencyProvider>
  );
}
