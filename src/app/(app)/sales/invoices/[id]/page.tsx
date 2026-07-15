import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, salesInvoicesTable, salesInvoiceItemsTable, customersTable, salesOrdersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { fmt } from "../../_shared/totals";
import { InvoiceDetailActions } from "../invoice-detail-actions";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  sent: "info",
  partially_paid: "warning",
  paid: "success",
  void: "danger",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { id } = await params;
  const invoiceId = Number(id);

  const [invoice] = await db
    .select({
      id: salesInvoicesTable.id,
      invoiceNumber: salesInvoicesTable.invoiceNumber,
      status: salesInvoicesTable.status,
      issueDate: salesInvoicesTable.issueDate,
      dueDate: salesInvoicesTable.dueDate,
      subtotal: salesInvoicesTable.subtotal,
      taxTotal: salesInvoicesTable.taxTotal,
      total: salesInvoicesTable.total,
      paidAmount: salesInvoicesTable.paidAmount,
      notes: salesInvoicesTable.notes,
      customerName: customersTable.name,
      customerEmail: customersTable.email,
      customerPhone: customersTable.phone,
      customerAddress: customersTable.address,
      sourceSalesOrderId: salesInvoicesTable.sourceSalesOrderId,
      sourceSoNumber: salesOrdersTable.soNumber,
    })
    .from(salesInvoicesTable)
    .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, salesInvoicesTable.sourceSalesOrderId))
    .where(and(eq(salesInvoicesTable.id, invoiceId), eq(salesInvoicesTable.orgId, session.orgId)));

  if (!invoice) notFound();

  const items = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, invoiceId));
  const balanceDue = Number(invoice.total) - Number(invoice.paidAmount);

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between mb-[22px]">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-[19px] font-bold font-mono">{invoice.invoiceNumber}</h3>
            <Badge variant={STATUS_VARIANT[invoice.status] ?? "neutral"}>{t(locale, invoice.status)}</Badge>
          </div>
          <p className="text-[12.5px] text-ink-muted mt-1">
            {t(locale, "Issue Date")}: {invoice.issueDate}
            {invoice.dueDate ? ` · ${t(locale, "Due Date")}: ${invoice.dueDate}` : ""}
            {invoice.sourceSoNumber && (
              <>
                {" · "}
                {t(locale, "Converted From")}:{" "}
                <Link href={`/sales/orders/${invoice.sourceSalesOrderId}`} className="text-brand-orange">
                  {invoice.sourceSoNumber}
                </Link>
              </>
            )}
          </p>
        </div>
        <InvoiceDetailActions locale={locale} invoiceId={invoice.id} status={invoice.status} />
      </div>

      <div className="rounded-2xl border border-line bg-surface shadow-elevated p-5 mb-5">
        <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Client")}</div>
        <div className="font-semibold text-[14px]">{invoice.customerName}</div>
        <div className="text-[12.5px] text-ink-muted mt-0.5">
          {[invoice.customerAddress, invoice.customerPhone, invoice.customerEmail].filter(Boolean).join(" · ") || "—"}
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
            <span className="font-mono">{fmt(invoice.subtotal)}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-muted">{t(locale, "VAT")}</span>
            <span className="font-mono">{fmt(invoice.taxTotal)}</span>
          </div>
          <div className="flex justify-between text-[15px] font-bold border-t border-line-strong mt-1 pt-2">
            <span>{t(locale, "Total")}</span>
            <span className="font-mono">{t(locale, "SAR")} {fmt(invoice.total)}</span>
          </div>
          {invoice.status !== "draft" && invoice.status !== "void" && (
            <>
              <div className="flex justify-between text-[13px] pt-1">
                <span className="text-ink-muted">{t(locale, "Paid")}</span>
                <span className="font-mono">{fmt(invoice.paidAmount)}</span>
              </div>
              <div className="flex justify-between text-[13px] font-semibold">
                <span>{t(locale, "Balance Due")}</span>
                <span className="font-mono">{fmt(balanceDue)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {invoice.notes && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Notes")}</div>
          <p className="text-[13px] text-ink-muted">{invoice.notes}</p>
        </div>
      )}
    </div>
  );
}
