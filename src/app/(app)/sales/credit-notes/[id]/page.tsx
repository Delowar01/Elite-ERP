import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, creditNotesTable, creditNoteItemsTable, customersTable, salesInvoicesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Money } from "../../_shared/money";
import { fmt } from "../../_shared/totals";
import { CnDetailActions } from "../cn-detail-actions";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  issued: "danger",
};

function vatPercent(subtotal: string, taxTotal: string): string {
  const sub = Number(subtotal);
  if (!sub) return "0";
  return ((Number(taxTotal) / sub) * 100).toFixed(0);
}

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
      sourceInvoiceId: creditNotesTable.sourceInvoiceId,
      sourceInvoiceNumber: salesInvoicesTable.invoiceNumber,
    })
    .from(creditNotesTable)
    .innerJoin(customersTable, eq(customersTable.id, creditNotesTable.customerId))
    .innerJoin(salesInvoicesTable, eq(salesInvoicesTable.id, creditNotesTable.sourceInvoiceId))
    .where(and(eq(creditNotesTable.id, cnId), eq(creditNotesTable.orgId, session.orgId)));

  if (!cn) notFound();

  const items = await db.select().from(creditNoteItemsTable).where(eq(creditNoteItemsTable.creditNoteId, cnId));

  return (
    <div className="max-w-4xl mx-auto">
      <div className="inv-head">
        <div>
          <h3 className="mono">{cn.creditNoteNumber}</h3>
          <div className="inv-sub">
            {t(locale, "Against Invoice")} {cn.sourceInvoiceNumber} · {cn.customerName}
            {cn.title ? ` · ${cn.title}` : ""}
            <Badge className="ms-2" variant={STATUS_VARIANT[cn.status] ?? "neutral"} live>
              {t(locale, cn.status)}
            </Badge>
          </div>
        </div>
        <CnDetailActions locale={locale} creditNoteId={cn.id} status={cn.status} />
      </div>

      <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="field">
          <label>{t(locale, "Reason")}</label>
          <div className="input">{cn.reason || "—"}</div>
        </div>
        <div className="field">
          <label>{t(locale, "Issue Date")}</label>
          <div className="input">{cn.issueDate}</div>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Item")}</TableHead>
            <TableHead className="text-right">{t(locale, "Qty")}</TableHead>
            <TableHead className="text-right">{t(locale, "Unit Price")}</TableHead>
            <TableHead className="text-right">{t(locale, "Line Total")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => (
            <TableRow key={it.id}>
              <TableCell>{it.description}</TableCell>
              <TableCell className="text-right font-mono">{it.quantity}</TableCell>
              <TableCell className="text-right font-mono">{fmt(it.unitPrice)}</TableCell>
              <TableCell className="text-right font-mono">{fmt(it.lineTotal)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="card totals-strip" style={{ maxWidth: 340, marginInlineStart: "auto" }}>
        <div className="t-row">
          <span>
            {t(locale, "VAT")} ({vatPercent(cn.subtotal, cn.taxTotal)}%)
          </span>
          <span className="v">
            <Money amount={cn.taxTotal} />
          </span>
        </div>
        <div className="t-row final">
          <span>{t(locale, "Credit Total")}</span>
          <span className="v">
            <Money amount={cn.total} />
          </span>
        </div>
      </div>
    </div>
  );
}
