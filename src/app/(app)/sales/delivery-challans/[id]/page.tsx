import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, deliveryChallansTable, deliveryChallanItemsTable, customersTable, salesOrdersTable, salesInvoicesTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { DocFieldBox } from "../../_shared/doc-field-box";
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
      title: deliveryChallansTable.title,
      status: deliveryChallansTable.status,
      dispatchDate: deliveryChallansTable.dispatchDate,
      deliveredDate: deliveryChallansTable.deliveredDate,
      carrier: deliveryChallansTable.carrier,
      vehicleNo: deliveryChallansTable.vehicleNo,
      customerName: customersTable.name,
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

  const [items, [org]] = await Promise.all([
    db.select().from(deliveryChallanItemsTable).where(eq(deliveryChallanItemsTable.deliveryChallanId, dcId)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between mb-[22px]">
        <div>
          <h3 className="text-[22px] font-bold font-mono">{dc.dcNumber}</h3>
          <p className="text-[12.5px] text-ink-muted mt-1.5">
            {(dc.sourceSoNumber || dc.sourceInvoiceNumber) && `${t(locale, "Converted From")} ${dc.sourceSoNumber ?? dc.sourceInvoiceNumber} · `}
            {org.name} → {dc.customerName}
            {dc.title ? ` · ${dc.title}` : ""}
            <Badge className="ms-2" variant={STATUS_VARIANT[dc.status] ?? "neutral"} live>
              {t(locale, dc.status)}
            </Badge>
          </p>
        </div>
        <DcDetailActions locale={locale} dcId={dc.id} status={dc.status} />
      </div>

      <div className="grid grid-cols-3 gap-3.5 mb-5">
        <DocFieldBox label={t(locale, "Carrier")} mono={false}>
          {dc.carrier || <span className="text-ink-faint">—</span>}
        </DocFieldBox>
        <DocFieldBox label={t(locale, "Vehicle No.")} mono={false}>
          {dc.vehicleNo || <span className="text-ink-faint">—</span>}
        </DocFieldBox>
        <DocFieldBox label={t(locale, "Dispatch Date")}>{dc.dispatchDate || "—"}</DocFieldBox>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Item")}</TableHead>
            <TableHead className="text-right">{t(locale, "Quantity")}</TableHead>
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

      <p className="text-[12px] text-ink-muted mt-5">
        {t(locale, "Logistics-only document — no stock or accounting impact of its own; stock already moved when the source Invoice was sent.")}
      </p>
    </div>
  );
}
