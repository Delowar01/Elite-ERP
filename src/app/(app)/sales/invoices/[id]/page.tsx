import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, salesInvoicesTable, salesInvoiceItemsTable, customersTable, salesOrdersTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PartyCardStatic } from "../../_shared/party-card";
import { TotalsCard } from "../../_shared/totals-card";
import { EInvoicePreviewPanel } from "../../_shared/einvoice-preview-panel";
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
      title: salesInvoicesTable.title,
      status: salesInvoicesTable.status,
      issueDate: salesInvoicesTable.issueDate,
      dueDate: salesInvoicesTable.dueDate,
      subtotal: salesInvoicesTable.subtotal,
      discount: salesInvoicesTable.discount,
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

  const [items, [org]] = await Promise.all([
    db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, invoiceId)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
  ]);
  const balanceDue = Number(invoice.total) - Number(invoice.paidAmount);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between mb-[22px]">
        <div>
          <h3 className="text-[22px] font-bold font-mono">{invoice.invoiceNumber}</h3>
          <p className="text-[12.5px] text-ink-muted mt-1.5">
            {t(locale, "Issue Date")} {invoice.issueDate}
            {invoice.dueDate ? ` · ${t(locale, "Due Date")} ${invoice.dueDate}` : ""}
            {invoice.title ? ` · ${invoice.title}` : ""}
            {invoice.sourceSoNumber && (
              <>
                {" · "}
                {t(locale, "Converted From")} {invoice.sourceSoNumber}
              </>
            )}
            <Badge className="ms-2" variant={STATUS_VARIANT[invoice.status] ?? "neutral"} live>
              {t(locale, invoice.status)}
            </Badge>
          </p>
        </div>
        <InvoiceDetailActions locale={locale} invoiceId={invoice.id} status={invoice.status} />
      </div>

      <div className="grid grid-cols-[1.6fr_1fr] gap-5 items-start">
        <div>
          <div className="grid grid-cols-2 gap-4 mb-[18px]">
            <PartyCardStatic label={t(locale, "Bill from")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
            <PartyCardStatic
              label={t(locale, "Bill to")}
              name={invoice.customerName}
              address={invoice.customerAddress}
              email={invoice.customerEmail}
              phone={invoice.customerPhone}
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
            <TotalsCard locale={locale} subtotal={invoice.subtotal} discount={invoice.discount} taxTotal={invoice.taxTotal} total={invoice.total} totalLabel="Total" />
            {invoice.status !== "draft" && invoice.status !== "void" && (
              <div className="rounded-2xl border border-line bg-surface shadow-elevated p-5 mt-3 flex flex-col gap-1.5">
                <div className="flex justify-between text-[13px]">
                  <span className="text-ink-muted">{t(locale, "Paid")}</span>
                  <span className="font-mono text-success">{fmt(invoice.paidAmount)}</span>
                </div>
                <div className="flex justify-between text-[13px] font-semibold">
                  <span>{t(locale, "Balance Due")}</span>
                  <span className="font-mono">{fmt(balanceDue)}</span>
                </div>
              </div>
            )}
          </div>

          {invoice.notes && (
            <div className="mt-5">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Notes")}</div>
              <p className="text-[13px] text-ink-muted">{invoice.notes}</p>
            </div>
          )}
        </div>

        <EInvoicePreviewPanel locale={locale} vatNumber={org.vatNumber} taxTotal={invoice.taxTotal} />
      </div>
    </div>
  );
}
