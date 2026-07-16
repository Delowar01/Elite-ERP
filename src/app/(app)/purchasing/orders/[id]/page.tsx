import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, purchaseOrdersTable, purchaseOrderItemsTable, vendorsTable, bankAccountsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { TotalsStrip } from "../../../sales/_shared/totals-strip";
import { fmt } from "../../../sales/_shared/totals";
import { PoDetailActions } from "../po-detail-actions";

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
      orderDate: purchaseOrdersTable.orderDate,
      subtotal: purchaseOrdersTable.subtotal,
      discount: purchaseOrdersTable.discount,
      taxTotal: purchaseOrdersTable.taxTotal,
      total: purchaseOrdersTable.total,
      paidAmount: purchaseOrdersTable.paidAmount,
      notes: purchaseOrdersTable.notes,
      vendorName: vendorsTable.name,
    })
    .from(purchaseOrdersTable)
    .innerJoin(vendorsTable, eq(vendorsTable.id, purchaseOrdersTable.vendorId))
    .where(and(eq(purchaseOrdersTable.id, poId), eq(purchaseOrdersTable.orgId, session.orgId)));

  if (!po) notFound();

  const [items, bankAccounts] = await Promise.all([
    db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, poId)),
    db
      .select({ id: bankAccountsTable.id, name: bankAccountsTable.name })
      .from(bankAccountsTable)
      .where(and(eq(bankAccountsTable.orgId, session.orgId), eq(bankAccountsTable.isActive, true))),
  ]);
  const balanceDue = Number(po.total) - Number(po.paidAmount);
  const showPayments = po.status === "received";

  return (
    <div className="max-w-4xl">
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
        <PoDetailActions
          locale={locale}
          poId={po.id}
          poNumber={po.poNumber}
          vendorName={po.vendorName}
          balance={balanceDue}
          status={po.status}
          bankAccounts={bankAccounts}
        />
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
            <TableRow key={it.id}>
              <TableCell>{it.description}</TableCell>
              <TableCell className="text-right font-mono">{it.quantity}</TableCell>
              <TableCell className="text-right font-mono">{fmt(it.unitCost)}</TableCell>
              <TableCell className="text-right font-mono">{it.taxRatePercent}%</TableCell>
              <TableCell className="text-right font-mono">{fmt(it.lineTotal)}</TableCell>
            </TableRow>
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

      {po.notes && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Notes")}</div>
          <p className="text-[13px] text-ink-muted">{po.notes}</p>
        </div>
      )}
    </div>
  );
}
