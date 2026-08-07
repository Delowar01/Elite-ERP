import { Fragment } from "react";
import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { DocumentTermsView } from "../../_shared/terms-view";
import { SafeRichText } from "../../_shared/safe-rich-text";
import { LineItemCell, LineDescRow } from "../../_shared/line-item-cell";
import { db, quotationsTable, quotationItemsTable, customersTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PartyCardSimple } from "../../_shared/party-card";
import { BankAccountBlocks } from "../../_shared/bank-account-blocks";
import { TotalsStrip } from "../../_shared/totals-strip";
import { DocNum } from "../../_shared/money";
import { CurrencyProvider } from "@/components/ui/currency-mark";
import { docMoneyMark } from "../../_shared/doc-currency";
import { QuotationDetailActions } from "../quotation-detail-actions";
import { DownloadPdfButton } from "../../_shared/download-pdf-button";
import { EditDocumentButton } from "../../../_shared/edit-document";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  sent: "info",
  accepted: "success",
  rejected: "danger",
  expired: "warning",
};

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { id } = await params;
  const quotationId = Number(id);

  const [quotation] = await db
    .select({
      id: quotationsTable.id,
      quotationNumber: quotationsTable.quotationNumber,
      title: quotationsTable.title,
      status: quotationsTable.status,
      archivedAt: quotationsTable.archivedAt,
      deletedAt: quotationsTable.deletedAt,
      issueDate: quotationsTable.issueDate,
      validUntil: quotationsTable.validUntil,
      subtotal: quotationsTable.subtotal,
      discount: quotationsTable.discount,
      taxTotal: quotationsTable.taxTotal,
      total: quotationsTable.total,
      notes: quotationsTable.notes,
      terms: quotationsTable.terms,
      bankAccounts: quotationsTable.bankAccounts,
      currency: quotationsTable.currency,
      customerName: customersTable.name,
      customerVatNumber: customersTable.vatNumber,
      customerAddress: customersTable.address,
    })
    .from(quotationsTable)
    .innerJoin(customersTable, eq(customersTable.id, quotationsTable.customerId))
    .where(and(eq(quotationsTable.id, quotationId), eq(quotationsTable.orgId, session.orgId)));

  if (!quotation) notFound();

  const [items, [org]] = await Promise.all([
    db.select().from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, quotationId)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
  ]);

  return (
    <CurrencyProvider mark={docMoneyMark(org, quotation.currency)}>
    <div className="max-w-4xl mx-auto">
      <div className="inv-head">
        <div>
          <h3 className="mono">{quotation.quotationNumber}</h3>
          <div className="inv-sub">
            {t(locale, "Issue Date")} {quotation.issueDate}
            {quotation.validUntil ? ` · ${t(locale, "Valid Till")} ${quotation.validUntil}` : ""}
            {quotation.title ? ` · ${quotation.title}` : ""}
            <Badge className="ms-2" variant={STATUS_VARIANT[quotation.status] ?? "neutral"} live>
              {t(locale, quotation.status)}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <EditDocumentButton locale={locale} docType="quotation" id={quotation.id} number={quotation.quotationNumber} status={quotation.status} recordState={quotation.deletedAt ? "deleted" : quotation.archivedAt ? "archived" : "active"} />
          <DownloadPdfButton locale={locale} type="quotation" docId={quotation.id} number={quotation.quotationNumber} />
          <QuotationDetailActions locale={locale} quotationId={quotation.id} quotationNumber={quotation.quotationNumber} status={quotation.status} />
        </div>
      </div>

      <div className="party-row">
        <PartyCardSimple label={t(locale, "Bill from")} name={org.name} metaLines={[org.vatNumber ? `VAT ${org.vatNumber}` : null, org.address]} />
        <PartyCardSimple
          label={t(locale, "Bill to")}
          name={quotation.customerName}
          metaLines={[quotation.customerVatNumber ? `VAT ${quotation.customerVatNumber}` : null, quotation.customerAddress]}
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
          subtotal={quotation.subtotal}
          discount={quotation.discount}
          taxTotal={quotation.taxTotal}
          finalLabel="Total"
          finalValue={quotation.total}
        />
      </div>

      <BankAccountBlocks locale={locale} accounts={quotation.bankAccounts} className="mt-5" />

      <DocumentTermsView locale={locale} terms={quotation.terms} className="mt-5" />
      {quotation.notes && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Notes")}</div>
          <div className="text-[13px] text-ink-muted"><SafeRichText value={quotation.notes} /></div>
        </div>
      )}
    </div>
    </CurrencyProvider>
  );
}
