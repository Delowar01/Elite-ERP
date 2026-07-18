import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, salesOrdersTable, salesOrderItemsTable, customersTable, quotationsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PartyCardSimple } from "../../_shared/party-card";
import { TotalsStrip } from "../../_shared/totals-strip";
import { fmt } from "../../_shared/totals";
import { OrderDetailActions } from "../order-detail-actions";
import { PrintButton } from "../../_shared/print-button";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  confirmed: "info",
  fulfilled: "success",
  cancelled: "danger",
};

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
      issueDate: salesOrdersTable.issueDate,
      subtotal: salesOrdersTable.subtotal,
      discount: salesOrdersTable.discount,
      taxTotal: salesOrdersTable.taxTotal,
      total: salesOrdersTable.total,
      notes: salesOrdersTable.notes,
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
    <div className="max-w-4xl mx-auto">
      <div className="inv-head">
        <div>
          <h3 className="mono">{order.soNumber}</h3>
          <div className="inv-sub">
            {t(locale, "Order Date")} {order.issueDate}
            {order.title ? ` · ${order.title}` : ""}
            {order.sourceQuotationNumber && (
              <>
                {" · "}
                {t(locale, "Converted From")} {order.sourceQuotationNumber}
              </>
            )}
            <Badge className="ms-2" variant={STATUS_VARIANT[order.status] ?? "neutral"} live>
              {t(locale, order.status)}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <PrintButton locale={locale} href={`/print/sales-order/${order.id}`} />
          <OrderDetailActions locale={locale} orderId={order.id} status={order.status} />
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
            <TableHead className="text-right">{t(locale, "Qty")}</TableHead>
            <TableHead className="text-right">{t(locale, "Unit Price")}</TableHead>
            <TableHead className="text-right">{t(locale, "VAT %")}</TableHead>
            <TableHead className="text-right">{t(locale, "Line Total")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <TableRow key={it.id}>
              <TableCell>{it.description}</TableCell>
              <TableCell className="text-right font-mono">{it.quantity}</TableCell>
              <TableCell className="text-right font-mono">{fmt(it.unitPrice)}</TableCell>
              <TableCell className="text-right font-mono">{it.taxRatePercent}%</TableCell>
              <TableCell className="text-right font-mono">{fmt(it.lineTotal)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="mt-4 max-w-sm ms-auto">
        <TotalsStrip locale={locale} subtotal={order.subtotal} discount={order.discount} taxTotal={order.taxTotal} finalLabel="Total" finalValue={order.total} />
      </div>

      {order.notes && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Notes")}</div>
          <p className="text-[13px] text-ink-muted">{order.notes}</p>
        </div>
      )}
    </div>
  );
}
