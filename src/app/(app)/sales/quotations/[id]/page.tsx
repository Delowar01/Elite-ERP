import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, quotationsTable, quotationItemsTable, customersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { fmt } from "../../_shared/totals";
import { QuotationDetailActions } from "../quotation-detail-actions";

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
      status: quotationsTable.status,
      issueDate: quotationsTable.issueDate,
      validUntil: quotationsTable.validUntil,
      subtotal: quotationsTable.subtotal,
      taxTotal: quotationsTable.taxTotal,
      total: quotationsTable.total,
      notes: quotationsTable.notes,
      customerName: customersTable.name,
      customerEmail: customersTable.email,
      customerPhone: customersTable.phone,
      customerAddress: customersTable.address,
    })
    .from(quotationsTable)
    .innerJoin(customersTable, eq(customersTable.id, quotationsTable.customerId))
    .where(and(eq(quotationsTable.id, quotationId), eq(quotationsTable.orgId, session.orgId)));

  if (!quotation) notFound();

  const items = await db.select().from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, quotationId));

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between mb-[22px]">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-[19px] font-bold font-mono">{quotation.quotationNumber}</h3>
            <Badge variant={STATUS_VARIANT[quotation.status] ?? "neutral"}>{t(locale, quotation.status)}</Badge>
          </div>
          <p className="text-[12.5px] text-ink-muted mt-1">
            {t(locale, "Issue Date")}: {quotation.issueDate}
            {quotation.validUntil ? ` · ${t(locale, "Valid Till")}: ${quotation.validUntil}` : ""}
          </p>
        </div>
        <QuotationDetailActions locale={locale} quotationId={quotation.id} status={quotation.status} />
      </div>

      <div className="rounded-2xl border border-line bg-surface shadow-elevated p-5 mb-5">
        <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Client")}</div>
        <div className="font-semibold text-[14px]">{quotation.customerName}</div>
        <div className="text-[12.5px] text-ink-muted mt-0.5">
          {[quotation.customerAddress, quotation.customerPhone, quotation.customerEmail].filter(Boolean).join(" · ") || "—"}
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
            <span className="font-mono">{fmt(quotation.subtotal)}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-muted">{t(locale, "VAT")}</span>
            <span className="font-mono">{fmt(quotation.taxTotal)}</span>
          </div>
          <div className="flex justify-between text-[15px] font-bold border-t border-line-strong mt-1 pt-2">
            <span>{t(locale, "Total")}</span>
            <span className="font-mono">{t(locale, "SAR")} {fmt(quotation.total)}</span>
          </div>
        </div>
      </div>

      {quotation.notes && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Notes")}</div>
          <p className="text-[13px] text-ink-muted">{quotation.notes}</p>
        </div>
      )}
    </div>
  );
}
