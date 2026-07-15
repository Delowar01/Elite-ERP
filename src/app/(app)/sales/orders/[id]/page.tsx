import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, salesOrdersTable, salesOrderItemsTable, customersTable, quotationsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { fmt } from "../../_shared/totals";
import { OrderDetailActions } from "../order-detail-actions";

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
      status: salesOrdersTable.status,
      issueDate: salesOrdersTable.issueDate,
      subtotal: salesOrdersTable.subtotal,
      taxTotal: salesOrdersTable.taxTotal,
      total: salesOrdersTable.total,
      notes: salesOrdersTable.notes,
      customerName: customersTable.name,
      customerEmail: customersTable.email,
      customerPhone: customersTable.phone,
      customerAddress: customersTable.address,
      sourceQuotationId: salesOrdersTable.sourceQuotationId,
      sourceQuotationNumber: quotationsTable.quotationNumber,
    })
    .from(salesOrdersTable)
    .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
    .leftJoin(quotationsTable, eq(quotationsTable.id, salesOrdersTable.sourceQuotationId))
    .where(and(eq(salesOrdersTable.id, orderId), eq(salesOrdersTable.orgId, session.orgId)));

  if (!order) notFound();

  const items = await db.select().from(salesOrderItemsTable).where(eq(salesOrderItemsTable.salesOrderId, orderId));

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between mb-[22px]">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-[19px] font-bold font-mono">{order.soNumber}</h3>
            <Badge variant={STATUS_VARIANT[order.status] ?? "neutral"}>{t(locale, order.status)}</Badge>
          </div>
          <p className="text-[12.5px] text-ink-muted mt-1">
            {t(locale, "Order Date")}: {order.issueDate}
            {order.sourceQuotationNumber && (
              <>
                {" · "}
                {t(locale, "Converted From")}:{" "}
                <Link href={`/sales/quotations/${order.sourceQuotationId}`} className="text-brand-orange">
                  {order.sourceQuotationNumber}
                </Link>
              </>
            )}
          </p>
        </div>
        <OrderDetailActions locale={locale} orderId={order.id} status={order.status} />
      </div>

      <div className="rounded-2xl border border-line bg-surface shadow-elevated p-5 mb-5">
        <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Client")}</div>
        <div className="font-semibold text-[14px]">{order.customerName}</div>
        <div className="text-[12.5px] text-ink-muted mt-0.5">
          {[order.customerAddress, order.customerPhone, order.customerEmail].filter(Boolean).join(" · ") || "—"}
        </div>
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

      <div className="flex justify-end mt-4">
        <div className="rounded-2xl border border-line bg-surface p-4 flex flex-col gap-1.5 w-72">
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-muted">{t(locale, "Subtotal")}</span>
            <span className="font-mono">{fmt(order.subtotal)}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-muted">{t(locale, "VAT")}</span>
            <span className="font-mono">{fmt(order.taxTotal)}</span>
          </div>
          <div className="flex justify-between text-[15px] font-bold border-t border-line-strong mt-1 pt-2">
            <span>{t(locale, "Total")}</span>
            <span className="font-mono">{t(locale, "SAR")} {fmt(order.total)}</span>
          </div>
        </div>
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
