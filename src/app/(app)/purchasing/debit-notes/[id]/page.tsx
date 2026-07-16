import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, debitNotesTable, debitNoteItemsTable, vendorsTable, purchaseOrdersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Money } from "../../../sales/_shared/money";
import { fmt } from "../../../sales/_shared/totals";
import { DnDetailActions } from "../dn-detail-actions";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  issued: "danger",
};

function vatPercent(subtotal: string, taxTotal: string): string {
  const sub = Number(subtotal);
  if (!sub) return "0";
  return ((Number(taxTotal) / sub) * 100).toFixed(0);
}

export default async function DebitNoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { id } = await params;
  const dnId = Number(id);

  const [dn] = await db
    .select({
      id: debitNotesTable.id,
      debitNoteNumber: debitNotesTable.debitNoteNumber,
      title: debitNotesTable.title,
      status: debitNotesTable.status,
      issueDate: debitNotesTable.issueDate,
      reason: debitNotesTable.reason,
      subtotal: debitNotesTable.subtotal,
      taxTotal: debitNotesTable.taxTotal,
      total: debitNotesTable.total,
      vendorName: vendorsTable.name,
      sourcePurchaseOrderId: debitNotesTable.sourcePurchaseOrderId,
      sourcePoNumber: purchaseOrdersTable.poNumber,
    })
    .from(debitNotesTable)
    .innerJoin(vendorsTable, eq(vendorsTable.id, debitNotesTable.vendorId))
    .innerJoin(purchaseOrdersTable, eq(purchaseOrdersTable.id, debitNotesTable.sourcePurchaseOrderId))
    .where(and(eq(debitNotesTable.id, dnId), eq(debitNotesTable.orgId, session.orgId)));

  if (!dn) notFound();

  const items = await db.select().from(debitNoteItemsTable).where(eq(debitNoteItemsTable.debitNoteId, dnId));

  return (
    <div className="max-w-4xl mx-auto">
      <div className="inv-head">
        <div>
          <h3 className="mono">{dn.debitNoteNumber}</h3>
          <div className="inv-sub">
            {t(locale, "Against Purchase Order")} {dn.sourcePoNumber} · {dn.vendorName}
            {dn.title ? ` · ${dn.title}` : ""}
            <Badge className="ms-2" variant={STATUS_VARIANT[dn.status] ?? "neutral"} live>
              {t(locale, dn.status)}
            </Badge>
          </div>
        </div>
        <DnDetailActions locale={locale} debitNoteId={dn.id} status={dn.status} />
      </div>

      <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="field">
          <label>{t(locale, "Reason")}</label>
          <div className="input">{dn.reason || "—"}</div>
        </div>
        <div className="field">
          <label>{t(locale, "Issue Date")}</label>
          <div className="input">{dn.issueDate}</div>
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
              <TableCell className="text-right font-mono">{fmt(it.unitCost)}</TableCell>
              <TableCell className="text-right font-mono">{fmt(it.lineTotal)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="card totals-strip" style={{ maxWidth: 340, marginInlineStart: "auto" }}>
        <div className="t-row">
          <span>
            {t(locale, "VAT")} ({vatPercent(dn.subtotal, dn.taxTotal)}%)
          </span>
          <span className="v">
            <Money amount={dn.taxTotal} />
          </span>
        </div>
        <div className="t-row final">
          <span>{t(locale, "Debit Total")}</span>
          <span className="v">
            <Money amount={dn.total} />
          </span>
        </div>
      </div>
    </div>
  );
}
