import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, creditNotesTable, creditNoteItemsTable, customersTable, salesInvoicesTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PartyCardStatic } from "../../_shared/party-card";
import { fmt } from "../../_shared/totals";
import { CnDetailActions } from "../cn-detail-actions";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  issued: "success",
};

export default async function CreditNoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { id } = await params;
  const cnId = Number(id);

  const [cn] = await db
    .select({
      id: creditNotesTable.id,
      creditNoteNumber: creditNotesTable.creditNoteNumber,
      title: creditNotesTable.title,
      status: creditNotesTable.status,
      issueDate: creditNotesTable.issueDate,
      reason: creditNotesTable.reason,
      subtotal: creditNotesTable.subtotal,
      taxTotal: creditNotesTable.taxTotal,
      total: creditNotesTable.total,
      customerName: customersTable.name,
      customerEmail: customersTable.email,
      customerPhone: customersTable.phone,
      customerAddress: customersTable.address,
      sourceInvoiceId: creditNotesTable.sourceInvoiceId,
      sourceInvoiceNumber: salesInvoicesTable.invoiceNumber,
    })
    .from(creditNotesTable)
    .innerJoin(customersTable, eq(customersTable.id, creditNotesTable.customerId))
    .innerJoin(salesInvoicesTable, eq(salesInvoicesTable.id, creditNotesTable.sourceInvoiceId))
    .where(and(eq(creditNotesTable.id, cnId), eq(creditNotesTable.orgId, session.orgId)));

  if (!cn) notFound();

  const [items, [org]] = await Promise.all([
    db.select().from(creditNoteItemsTable).where(eq(creditNoteItemsTable.creditNoteId, cnId)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between mb-[22px]">
        <div>
          <h3 className="text-[22px] font-bold font-mono">{cn.creditNoteNumber}</h3>
          <p className="text-[12.5px] text-ink-muted mt-1.5">
            {t(locale, "Issue Date")} {cn.issueDate}
            {" · "}
            {t(locale, "Against Invoice")} {cn.sourceInvoiceNumber}
            {cn.title ? ` · ${cn.title}` : ""}
            <Badge className="ms-2" variant={STATUS_VARIANT[cn.status] ?? "neutral"} live>
              {t(locale, cn.status)}
            </Badge>
          </p>
        </div>
        <CnDetailActions locale={locale} creditNoteId={cn.id} status={cn.status} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-[18px]">
        <PartyCardStatic label={t(locale, "From")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        <PartyCardStatic
          label={t(locale, "To Client")}
          name={cn.customerName}
          address={cn.customerAddress}
          email={cn.customerEmail}
          phone={cn.customerPhone}
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

      <div className="flex justify-end mt-4">
        <div className="rounded-2xl border border-line bg-surface shadow-elevated p-4 flex flex-col gap-1.5 w-72">
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-muted">{t(locale, "Subtotal")}</span>
            <span className="font-mono">{fmt(cn.subtotal)}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-muted">{t(locale, "VAT")}</span>
            <span className="font-mono">{fmt(cn.taxTotal)}</span>
          </div>
          <div className="flex justify-between text-[15px] font-bold border-t border-line-strong mt-1 pt-2">
            <span>{t(locale, "Credit Total")}</span>
            <span className="font-mono">{t(locale, "SAR")} {fmt(cn.total)}</span>
          </div>
        </div>
      </div>

      {cn.reason && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Reason")}</div>
          <p className="text-[13px] text-ink-muted">{cn.reason}</p>
        </div>
      )}
    </div>
  );
}
