import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, salesInvoicesTable, salesInvoiceItemsTable, customersTable, salesOrdersTable, quotationsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PartyCardSimple } from "../../_shared/party-card";
import { TotalsStrip } from "../../_shared/totals-strip";
import { EInvoicePreviewPanel } from "../../_shared/einvoice-preview-panel";
import { DocRelationships } from "../../_shared/doc-relationships";
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
      customerVatNumber: customersTable.vatNumber,
      customerAddress: customersTable.address,
      sourceSalesOrderId: salesInvoicesTable.sourceSalesOrderId,
      sourceSoNumber: salesOrdersTable.soNumber,
      sourceSoQuotationId: salesOrdersTable.sourceQuotationId,
    })
    .from(salesInvoicesTable)
    .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, salesInvoicesTable.sourceSalesOrderId))
    .where(and(eq(salesInvoicesTable.id, invoiceId), eq(salesInvoicesTable.orgId, session.orgId)));

  if (!invoice) notFound();

  const [items, [org], [sourceQuotation]] = await Promise.all([
    db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, invoiceId)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    invoice.sourceSoQuotationId
      ? db.select({ quotationNumber: quotationsTable.quotationNumber }).from(quotationsTable).where(eq(quotationsTable.id, invoice.sourceSoQuotationId))
      : Promise.resolve([]),
  ]);
  const balanceDue = Number(invoice.total) - Number(invoice.paidAmount);
  const showPayments = invoice.status !== "draft" && invoice.status !== "void";

  const relNodes: { label: string; sub?: string }[] = [];
  if (sourceQuotation) relNodes.push({ label: "Quotation", sub: sourceQuotation.quotationNumber });
  if (invoice.sourceSoNumber) relNodes.push({ label: "Sales Order", sub: invoice.sourceSoNumber });
  relNodes.push({ label: "Invoice", sub: "Current" });

  return (
    <div className="max-w-6xl">
      {relNodes.length > 1 && <DocRelationships locale={locale} nodes={relNodes} currentLabel="Invoice" />}
      <div className="inv-head">
        <div>
          <h3 className="mono">{invoice.invoiceNumber}</h3>
          <div className="inv-sub">
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
          </div>
        </div>
        <InvoiceDetailActions locale={locale} invoiceId={invoice.id} status={invoice.status} />
      </div>

      <div className="inv-grid">
        <div>
          <div className="party-row">
            <PartyCardSimple label={t(locale, "Bill from")} name={org.name} metaLines={[org.vatNumber ? `VAT ${org.vatNumber}` : null, org.address]} />
            <PartyCardSimple
              label={t(locale, "Bill to")}
              name={invoice.customerName}
              metaLines={[invoice.customerVatNumber ? `VAT ${invoice.customerVatNumber}` : null, invoice.customerAddress]}
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

          <TotalsStrip
            locale={locale}
            subtotal={invoice.subtotal}
            discount={invoice.discount}
            taxTotal={invoice.taxTotal}
            finalLabel={showPayments ? "Balance due" : "Total"}
            finalValue={showPayments ? String(balanceDue) : invoice.total}
            extraRows={showPayments ? [{ label: "Paid", value: invoice.paidAmount, colorClass: "text-success" }] : undefined}
          />

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
