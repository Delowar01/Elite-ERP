import { Fragment } from "react";
import { notFound } from "next/navigation";
import { eq, and, isNull } from "drizzle-orm";
import { DocumentTermsView } from "../../_shared/terms-view";
import { SafeRichText } from "../../_shared/safe-rich-text";
import { LineItemCell, LineDescRow } from "../../_shared/line-item-cell";
import { db, salesInvoicesTable, salesInvoiceItemsTable, customersTable, salesOrdersTable, quotationsTable, orgsTable, bankAccountsTable, advanceApplicationsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { can } from "@/lib/document-lifecycle";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PartyCardSimple } from "../../_shared/party-card";
import { BankAccountBlocks } from "../../_shared/bank-account-blocks";
import { CurrencyProvider } from "@/components/ui/currency-mark";
import { docMoneyMark } from "../../_shared/doc-currency";
import { TotalsStrip } from "../../_shared/totals-strip";
import { EInvoicePreviewPanel } from "../../_shared/einvoice-preview-panel";
import { DocRelationships } from "../../_shared/doc-relationships";
import { DocNum } from "../../_shared/money";
import { InvoiceDetailActions } from "../invoice-detail-actions";
import { DownloadPdfButton } from "../../_shared/download-pdf-button";
import { EditDocumentButton } from "../../../_shared/edit-document";
import { PaymentHistory } from "../../../finance/_shared/payment-history";

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
      archivedAt: salesInvoicesTable.archivedAt,
      deletedAt: salesInvoicesTable.deletedAt,
      issueDate: salesInvoicesTable.issueDate,
      dueDate: salesInvoicesTable.dueDate,
      subtotal: salesInvoicesTable.subtotal,
      discount: salesInvoicesTable.discount,
      taxTotal: salesInvoicesTable.taxTotal,
      total: salesInvoicesTable.total,
      paidAmount: salesInvoicesTable.paidAmount,
      notes: salesInvoicesTable.notes,
      terms: salesInvoicesTable.terms,
      bankAccounts: salesInvoicesTable.bankAccounts,
      currency: salesInvoicesTable.currency,
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

  const [items, [org], [sourceQuotation], bankAccounts] = await Promise.all([
    db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, invoiceId)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    invoice.sourceSoQuotationId
      ? db.select({ quotationNumber: quotationsTable.quotationNumber }).from(quotationsTable).where(eq(quotationsTable.id, invoice.sourceSoQuotationId))
      : Promise.resolve([]),
    db
      .select({ id: bankAccountsTable.id, name: bankAccountsTable.name })
      .from(bankAccountsTable)
      .where(and(eq(bankAccountsTable.orgId, session.orgId), eq(bankAccountsTable.isActive, true))),
  ]);
  const balanceDue = Number(invoice.total) - Number(invoice.paidAmount);
  const showPayments = invoice.status !== "draft" && invoice.status !== "void";
  // §18: an invoice born from a proforma with advances breaks its receipts out — Total = Advance
  // Applied + Paid + Due, with "Paid" reduced to the DIRECT payments so the same transferred
  // advance is never counted twice. The payment rows themselves stay in the shared history below
  // (tagged "from Proforma") — one record, no second ledger.
  // From ALLOCATIONS, not from payments linked by salesInvoiceId: an advance can now settle this
  // invoice partially, and a partial draw never carries that link.
  const advanceApplied = showPayments
    ? (await db
        .select({ applied: advanceApplicationsTable.appliedAmount })
        .from(advanceApplicationsTable)
        .where(and(
          eq(advanceApplicationsTable.orgId, session.orgId),
          eq(advanceApplicationsTable.salesInvoiceId, invoice.id),
          isNull(advanceApplicationsTable.releasedAt),
        )))
        .reduce((sum, r) => sum + Number(r.applied), 0)
    : 0;
  const directPaid = Number(invoice.paidAmount) - advanceApplied;
  const canDeletePayments = (session.role === "owner" || session.role === "admin") && invoice.status !== "void";

  const relNodes: { label: string; sub?: string }[] = [];
  if (sourceQuotation) relNodes.push({ label: "Quotation", sub: sourceQuotation.quotationNumber });
  if (invoice.sourceSoNumber) relNodes.push({ label: "Sales Order", sub: invoice.sourceSoNumber });
  relNodes.push({ label: "Invoice", sub: "Current" });

  return (
    <CurrencyProvider mark={docMoneyMark(org, invoice.currency)}>
    <div className="max-w-6xl mx-auto">
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
        <div className="flex items-center gap-2.5">
          <EditDocumentButton locale={locale} docType="sales_invoice" id={invoice.id} number={invoice.invoiceNumber} status={invoice.status} recordState={invoice.deletedAt ? "deleted" : invoice.archivedAt ? "archived" : "active"} />
          <DownloadPdfButton locale={locale} type="invoice" docId={invoice.id} number={invoice.invoiceNumber} />
          <InvoiceDetailActions
            locale={locale}
            currency={invoice.currency ?? org.currency}
            baseCurrency={org.currency}
            invoiceId={invoice.id}
            invoiceNumber={invoice.invoiceNumber}
            customerName={invoice.customerName}
            balance={balanceDue}
            status={invoice.status}
            canVoid={can("sales_invoice", invoice.status, "void", { hasPayments: Number(invoice.paidAmount) > 0 })}
            bankAccounts={bankAccounts}
          />
        </div>
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
                <Fragment key={it.id}>
            <TableRow>
                  <TableCell><LineItemCell description={it.description} /></TableCell>
                  <TableCell className="text-right font-mono"><DocNum value={it.quantity} kind="quantity" /></TableCell>
                  <TableCell className="text-right font-mono"><DocNum value={it.unitPrice} kind="rate" /></TableCell>
                  <TableCell className="text-right font-mono">{it.taxRatePercent}%</TableCell>
                  <TableCell className="text-right font-mono"><DocNum value={it.lineTotal} kind="amount" /></TableCell>
                </TableRow>
              <LineDescRow customFields={it.customFields} />
            </Fragment>
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
            extraRows={showPayments ? (advanceApplied > 0 ? [
              { label: "Customer Advance Applied", value: String(advanceApplied), colorClass: "text-success" },
              { label: "Paid", value: String(directPaid), colorClass: "text-success" },
            ] : [{ label: "Paid", value: invoice.paidAmount, colorClass: "text-success" }]) : undefined}
          />

          {showPayments && <PaymentHistory locale={locale} orgId={session.orgId} source={{ type: "invoice", id: invoice.id }} canDelete={canDeletePayments} />}

          <BankAccountBlocks locale={locale} accounts={invoice.bankAccounts} className="mt-5" />

          <DocumentTermsView locale={locale} terms={invoice.terms} className="mt-5" />
      {invoice.notes && (
            <div className="mt-5">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Notes")}</div>
              <div className="text-[13px] text-ink-muted"><SafeRichText value={invoice.notes} /></div>
            </div>
          )}
        </div>

        <EInvoicePreviewPanel locale={locale} vatNumber={org.vatNumber} taxTotal={invoice.taxTotal} />
      </div>
    </div>
    </CurrencyProvider>
  );
}
