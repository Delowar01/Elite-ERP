import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, deliveryChallansTable, deliveryChallanItemsTable, customersTable, salesOrdersTable, salesInvoicesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { DcDetailActions } from "../dc-detail-actions";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  dispatched: "warning",
  delivered: "success",
};

export default async function DcDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { id } = await params;
  const dcId = Number(id);

  const [dc] = await db
    .select({
      id: deliveryChallansTable.id,
      dcNumber: deliveryChallansTable.dcNumber,
      status: deliveryChallansTable.status,
      dispatchDate: deliveryChallansTable.dispatchDate,
      deliveredDate: deliveryChallansTable.deliveredDate,
      carrier: deliveryChallansTable.carrier,
      vehicleNo: deliveryChallansTable.vehicleNo,
      customerName: customersTable.name,
      customerAddress: customersTable.address,
      sourceSalesOrderId: deliveryChallansTable.sourceSalesOrderId,
      sourceSoNumber: salesOrdersTable.soNumber,
      sourceInvoiceId: deliveryChallansTable.sourceInvoiceId,
      sourceInvoiceNumber: salesInvoicesTable.invoiceNumber,
    })
    .from(deliveryChallansTable)
    .innerJoin(customersTable, eq(customersTable.id, deliveryChallansTable.customerId))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, deliveryChallansTable.sourceSalesOrderId))
    .leftJoin(salesInvoicesTable, eq(salesInvoicesTable.id, deliveryChallansTable.sourceInvoiceId))
    .where(and(eq(deliveryChallansTable.id, dcId), eq(deliveryChallansTable.orgId, session.orgId)));

  if (!dc) notFound();

  const items = await db.select().from(deliveryChallanItemsTable).where(eq(deliveryChallanItemsTable.deliveryChallanId, dcId));

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between mb-[22px]">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-[19px] font-bold font-mono">{dc.dcNumber}</h3>
            <Badge variant={STATUS_VARIANT[dc.status] ?? "neutral"}>{t(locale, dc.status)}</Badge>
          </div>
          <p className="text-[12.5px] text-ink-muted mt-1">
            {dc.carrier && `${t(locale, "Carrier")}: ${dc.carrier}`}
            {dc.vehicleNo && ` · ${t(locale, "Vehicle No.")}: ${dc.vehicleNo}`}
            {(dc.sourceSoNumber || dc.sourceInvoiceNumber) && (
              <>
                {" · "}
                {t(locale, "Converted From")}:{" "}
                <Link href={dc.sourceSoNumber ? `/sales/orders/${dc.sourceSalesOrderId}` : `/sales/invoices/${dc.sourceInvoiceId}`} className="text-brand-orange">
                  {dc.sourceSoNumber ?? dc.sourceInvoiceNumber}
                </Link>
              </>
            )}
          </p>
        </div>
        <DcDetailActions locale={locale} dcId={dc.id} status={dc.status} />
      </div>

      <div className="rounded-2xl border border-line bg-surface shadow-elevated p-5 mb-5">
        <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Client")}</div>
        <div className="font-semibold text-[14px]">{dc.customerName}</div>
        <div className="text-[12.5px] text-ink-muted mt-0.5">{dc.customerAddress ?? "—"}</div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Item")}</TableHead>
            <TableHead className="text-right">{t(locale, "Qty")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <TableRow key={it.id}>
              <TableCell>{it.description}</TableCell>
              <TableCell className="text-right font-mono">{it.quantity}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
