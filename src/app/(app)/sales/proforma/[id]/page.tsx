import { Fragment } from "react";
import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { DocumentTermsView } from "../../_shared/terms-view";
import { SafeRichText } from "../../_shared/safe-rich-text";
import { LineItemCell, LineDescRow } from "../../_shared/line-item-cell";
import { Info } from "lucide-react";
import { db, proformaInvoicesTable, proformaInvoiceItemsTable, customersTable, salesOrdersTable, quotationsTable, orgsTable, bankAccountsTable, salesInvoicesTable } from "@/db";
import { PaymentHistory } from "../../../finance/_shared/payment-history";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PartyCardSimple } from "../../_shared/party-card";
import { BankAccountBlocks } from "../../_shared/bank-account-blocks";
import { CurrencyProvider } from "@/components/ui/currency-mark";
import { docMoneyMark } from "../../_shared/doc-currency";
import { TotalsStrip } from "../../_shared/totals-strip";
import { DocRelationships } from "../../_shared/doc-relationships";
import { DocNum } from "../../_shared/money";
import { ProformaDetailActions } from "../proforma-detail-actions";
import { DownloadPdfButton } from "../../_shared/download-pdf-button";
import { EditDocumentButton } from "../../../_shared/edit-document";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  sent: "info",
};

export default async function ProformaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { id } = await params;
  const proformaId = Number(id);

  const [pf] = await db
    .select({
      id: proformaInvoicesTable.id,
      proformaNumber: proformaInvoicesTable.proformaNumber,
      title: proformaInvoicesTable.title,
      status: proformaInvoicesTable.status,
      archivedAt: proformaInvoicesTable.archivedAt,
      deletedAt: proformaInvoicesTable.deletedAt,
      issueDate: proformaInvoicesTable.issueDate,
      subtotal: proformaInvoicesTable.subtotal,
      discount: proformaInvoicesTable.discount,
      taxTotal: proformaInvoicesTable.taxTotal,
      total: proformaInvoicesTable.total,
      paidAmount: proformaInvoicesTable.paidAmount,
      convertedInvoiceId: proformaInvoicesTable.convertedInvoiceId,
      notes: proformaInvoicesTable.notes,
      terms: proformaInvoicesTable.terms,
      bankAccounts: proformaInvoicesTable.bankAccounts,
      currency: proformaInvoicesTable.currency,
      customerName: customersTable.name,
      customerVatNumber: customersTable.vatNumber,
      customerAddress: customersTable.address,
      sourceSalesOrderId: proformaInvoicesTable.sourceSalesOrderId,
      sourceSoNumber: salesOrdersTable.soNumber,
      sourceSoQuotationId: salesOrdersTable.sourceQuotationId,
    })
    .from(proformaInvoicesTable)
    .innerJoin(customersTable, eq(customersTable.id, proformaInvoicesTable.customerId))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, proformaInvoicesTable.sourceSalesOrderId))
    .where(and(eq(proformaInvoicesTable.id, proformaId), eq(proformaInvoicesTable.orgId, session.orgId)));

  if (!pf) notFound();

  const [items, [org], [sourceQuotation], bankAccounts, [convertedInvoice]] = await Promise.all([
    db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, proformaId)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    pf.sourceSoQuotationId
      ? db.select({ quotationNumber: quotationsTable.quotationNumber }).from(quotationsTable).where(eq(quotationsTable.id, pf.sourceSoQuotationId))
      : Promise.resolve([]),
    db
      .select({ id: bankAccountsTable.id, name: bankAccountsTable.name })
      .from(bankAccountsTable)
      .where(and(eq(bankAccountsTable.orgId, session.orgId), eq(bankAccountsTable.isActive, true))),
    pf.convertedInvoiceId
      ? db.select({ invoiceNumber: salesInvoicesTable.invoiceNumber }).from(salesInvoicesTable).where(eq(salesInvoicesTable.id, pf.convertedInvoiceId))
      : Promise.resolve([]),
  ]);
  const paidAmount = Number(pf.paidAmount);
  const balanceDue = Number(pf.total) - paidAmount;
  const showPayments = paidAmount > 0 || pf.status === "sent";
  const canDeletePayments = (session.role === "owner" || session.role === "admin") && pf.convertedInvoiceId == null;

  const relNodes: { label: string; sub?: string }[] = [];
  if (sourceQuotation) relNodes.push({ label: "Quotation", sub: sourceQuotation.quotationNumber });
  if (pf.sourceSoNumber) relNodes.push({ label: "Sales Order", sub: pf.sourceSoNumber });
  relNodes.push({ label: "Proforma Invoice", sub: "Current" });

  return (
    <CurrencyProvider mark={docMoneyMark(org, pf.currency)}>
    <div className="max-w-4xl mx-auto">
      {relNodes.length > 1 && <DocRelationships locale={locale} nodes={relNodes} currentLabel="Proforma Invoice" />}
      <div className="inv-head">
        <div>
          <h3 className="mono">{pf.proformaNumber}</h3>
          <div className="inv-sub">
            {t(locale, "Issue Date")} {pf.issueDate}
            {pf.title ? ` · ${pf.title}` : ""}
            {pf.sourceSoNumber && (
              <>
                {" · "}
                {t(locale, "Converted From")} {pf.sourceSoNumber}
              </>
            )}
            <Badge className="ms-2" variant={STATUS_VARIANT[pf.status] ?? "neutral"} live>
              {t(locale, pf.status)}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <EditDocumentButton locale={locale} docType="proforma_invoice" id={pf.id} number={pf.proformaNumber} status={pf.status} recordState={pf.deletedAt ? "deleted" : pf.archivedAt ? "archived" : "active"} />
          <DownloadPdfButton locale={locale} type="proforma" docId={pf.id} number={pf.proformaNumber} />
          <ProformaDetailActions
            locale={locale}
            currency={pf.currency ?? org.currency}
            proformaId={pf.id}
            proformaNumber={pf.proformaNumber}
            customerName={pf.customerName}
            status={pf.status}
            balance={balanceDue}
            convertedInvoiceId={pf.convertedInvoiceId}
            bankAccounts={bankAccounts}
          />
        </div>
      </div>

      {pf.convertedInvoiceId && convertedInvoice && (
        <div className="mt-2 text-[12.5px] text-ink-muted">
          {t(locale, "Converted to Sales Invoice")}{" "}
          <a href={`/sales/invoices/${pf.convertedInvoiceId}`} className="text-brand-orange font-semibold hover:underline">
            {convertedInvoice.invoiceNumber}
          </a>
          {" · "}
          {t(locale, "Payment history below is read-only.")}
        </div>
      )}

      <div className="doc-badge-noninvoicing">
        <Info className="size-3.5" />
        {t(locale, "Non-posting — for client reference only. Never affects revenue or stock.")}
      </div>

      <div className="party-row">
        <PartyCardSimple label={t(locale, "Bill from")} name={org.name} metaLines={[org.vatNumber ? `VAT ${org.vatNumber}` : null, org.address]} />
        <PartyCardSimple
          label={t(locale, "Bill to")}
          name={pf.customerName}
          metaLines={[pf.customerVatNumber ? `VAT ${pf.customerVatNumber}` : null, pf.customerAddress]}
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

      <div className="mt-4 max-w-sm ms-auto">
        <TotalsStrip
          locale={locale}
          subtotal={pf.subtotal}
          discount={pf.discount}
          taxTotal={pf.taxTotal}
          finalLabel={paidAmount > 0 ? "Balance Due" : "Total"}
          finalValue={paidAmount > 0 ? String(balanceDue) : pf.total}
          extraRows={paidAmount > 0 ? [{ label: "Paid Amount", value: pf.paidAmount, colorClass: "text-success" }] : undefined}
        />
      </div>

      {showPayments && <PaymentHistory locale={locale} orgId={session.orgId} source={{ type: "proforma", id: pf.id }} canDelete={canDeletePayments} />}

      <BankAccountBlocks locale={locale} accounts={pf.bankAccounts} className="mt-5" />

      <DocumentTermsView locale={locale} terms={pf.terms} className="mt-5" />
      {pf.notes && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Notes")}</div>
          <div className="text-[13px] text-ink-muted"><SafeRichText value={pf.notes} /></div>
        </div>
      )}
    </div>
    </CurrencyProvider>
  );
}
