import { Fragment } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { DocumentTermsView } from "../../_shared/terms-view";
import { SafeRichText } from "../../_shared/safe-rich-text";
import { LineItemCell, LineDescRow } from "../../_shared/line-item-cell";
import { db, salesOrdersTable, salesOrderItemsTable, customersTable, quotationsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PartyCardSimple } from "../../_shared/party-card";
import { BankAccountBlocks } from "../../_shared/bank-account-blocks";
import { CurrencyProvider } from "@/components/ui/currency-mark";
import { docMoneyMark } from "../../_shared/doc-currency";
import { TotalsStrip } from "../../_shared/totals-strip";
import { DocNum } from "../../_shared/money";
import { OrderDetailActions } from "../order-detail-actions";
import { DownloadPdfButton } from "../../_shared/download-pdf-button";
import { EditDocumentButton } from "../../../_shared/edit-document";


export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { id } = await params;
  const orderId = Number(id);

  const [order] = await db
    .select({
      id: salesOrdersTable.id,
      soNumber: salesOrdersTable.soNumber,
      title: salesOrdersTable.title,
      status: salesOrdersTable.status,
      archivedAt: salesOrdersTable.archivedAt,
      deletedAt: salesOrdersTable.deletedAt,
      issueDate: salesOrdersTable.issueDate,
      expectedDate: salesOrdersTable.expectedDate,
      subtotal: salesOrdersTable.subtotal,
      discount: salesOrdersTable.discount,
      taxTotal: salesOrdersTable.taxTotal,
      total: salesOrdersTable.total,
      notes: salesOrdersTable.notes,
      terms: salesOrdersTable.terms,
      bankAccounts: salesOrdersTable.bankAccounts,
      currency: salesOrdersTable.currency,
      customerName: customersTable.name,
      customerVatNumber: customersTable.vatNumber,
      customerAddress: customersTable.address,
      sourceQuotationId: salesOrdersTable.sourceQuotationId,
      sourceQuotationNumber: quotationsTable.quotationNumber,
    })
    .from(salesOrdersTable)
    .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
    .leftJoin(quotationsTable, eq(quotationsTable.id, salesOrdersTable.sourceQuotationId))
    .where(and(eq(salesOrdersTable.id, orderId), eq(salesOrdersTable.orgId, session.orgId)));

  if (!order) notFound();

  const [items, [org]] = await Promise.all([
    db.select().from(salesOrderItemsTable).where(eq(salesOrderItemsTable.salesOrderId, orderId)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
  ]);

  return (
    <CurrencyProvider mark={docMoneyMark(org, order.currency)}>
    <div className="max-w-4xl mx-auto">
      <div className="inv-head">
        <div>
          <h3 className="mono">{order.soNumber}</h3>
          <div className="inv-sub">
            {t(locale, "Order Date")} {order.issueDate}
            {order.expectedDate && (
              <>
                {" · "}
                {t(locale, "Expected Delivery")} {order.expectedDate}
              </>
            )}
            {order.title ? ` · ${order.title}` : ""}
            {order.sourceQuotationNumber && (
              <>
                {" · "}
                {t(locale, "Converted From")} {order.sourceQuotationNumber}
              </>
            )}
            <StatusBadge className="ms-2" domain="sales_order" status={order.status} locale={locale} />
          </div>
        </div>
        <div className="inv-head-actions">
          <EditDocumentButton locale={locale} docType="sales_order" id={order.id} number={order.soNumber} status={order.status} recordState={order.deletedAt ? "deleted" : order.archivedAt ? "archived" : "active"} />
          <DownloadPdfButton locale={locale} type="sales-order" docId={order.id} number={order.soNumber} />
          <OrderDetailActions locale={locale} orderId={order.id} orderNumber={order.soNumber} status={order.status} />
        </div>
      </div>

      <div className="party-row">
        <PartyCardSimple label={t(locale, "Bill from")} name={org.name} metaLines={[org.vatNumber ? `VAT ${org.vatNumber}` : null, org.address]} />
        <PartyCardSimple
          label={t(locale, "Bill to")}
          name={order.customerName}
          metaLines={[order.customerVatNumber ? `VAT ${order.customerVatNumber}` : null, order.customerAddress]}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Item")}</TableHead>
            <TableHead numeric>{t(locale, "Qty")}</TableHead>
            <TableHead numeric>{t(locale, "Unit Price")}</TableHead>
            <TableHead numeric>{t(locale, "VAT %")}</TableHead>
            <TableHead numeric>{t(locale, "Line Total")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <Fragment key={it.id}>
            <TableRow>
              <TableCell><LineItemCell description={it.description} /></TableCell>
              <TableCell numeric className="num-tabular"><DocNum value={it.quantity} kind="quantity" /></TableCell>
              <TableCell numeric className="num-tabular"><DocNum value={it.unitPrice} kind="rate" /></TableCell>
              <TableCell numeric className="num-tabular">{it.taxRatePercent}%</TableCell>
              <TableCell numeric className="num-tabular"><DocNum value={it.lineTotal} kind="amount" /></TableCell>
            </TableRow>
              <LineDescRow customFields={it.customFields} />
            </Fragment>
          ))}
        </TableBody>
      </Table>

      <div className="mt-4 max-w-sm ms-auto">
        <TotalsStrip locale={locale} subtotal={order.subtotal} discount={order.discount} taxTotal={order.taxTotal} finalLabel="Total" finalValue={order.total} />
      </div>

      <BankAccountBlocks locale={locale} accounts={order.bankAccounts} className="mt-5" />

      <DocumentTermsView locale={locale} terms={order.terms} className="mt-5" />
      {order.notes && (
        <div className="mt-5">
          <div className="text-caption uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Notes")}</div>
          <div className="text-body text-ink-muted"><SafeRichText value={order.notes} /></div>
        </div>
      )}
    </div>
    </CurrencyProvider>
  );
}
