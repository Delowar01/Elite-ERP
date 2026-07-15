import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db, proformaInvoicesTable, proformaInvoiceItemsTable, customersTable, salesOrdersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { fmt } from "../../_shared/totals";
import { ProformaDetailActions } from "../proforma-detail-actions";

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
      status: proformaInvoicesTable.status,
      issueDate: proformaInvoicesTable.issueDate,
      subtotal: proformaInvoicesTable.subtotal,
      taxTotal: proformaInvoicesTable.taxTotal,
      total: proformaInvoicesTable.total,
      notes: proformaInvoicesTable.notes,
      customerName: customersTable.name,
      customerEmail: customersTable.email,
      customerPhone: customersTable.phone,
      customerAddress: customersTable.address,
      sourceSalesOrderId: proformaInvoicesTable.sourceSalesOrderId,
      sourceSoNumber: salesOrdersTable.soNumber,
    })
    .from(proformaInvoicesTable)
    .innerJoin(customersTable, eq(customersTable.id, proformaInvoicesTable.customerId))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, proformaInvoicesTable.sourceSalesOrderId))
    .where(and(eq(proformaInvoicesTable.id, proformaId), eq(proformaInvoicesTable.orgId, session.orgId)));

  if (!pf) notFound();

  const items = await db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, proformaId));

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between mb-[22px]">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-[19px] font-bold font-mono">{pf.proformaNumber}</h3>
            <Badge variant={STATUS_VARIANT[pf.status] ?? "neutral"}>{t(locale, pf.status)}</Badge>
          </div>
          <p className="text-[12.5px] text-ink-muted mt-1">
            {t(locale, "Issue Date")}: {pf.issueDate}
            {pf.sourceSoNumber && (
              <>
                {" · "}
                {t(locale, "Converted From")}:{" "}
                <Link href={`/sales/orders/${pf.sourceSalesOrderId}`} className="text-brand-orange">
                  {pf.sourceSoNumber}
                </Link>
              </>
            )}
          </p>
        </div>
        <ProformaDetailActions locale={locale} proformaId={pf.id} status={pf.status} />
      </div>

      <div className="rounded-xl bg-info-bg text-info text-[12.5px] px-3.5 py-2.5 mb-5">
        {t(locale, "Non-posting — for client reference only. Never affects revenue or stock.")}
      </div>

      <div className="rounded-2xl border border-line bg-surface shadow-elevated p-5 mb-5">
        <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Client")}</div>
        <div className="font-semibold text-[14px]">{pf.customerName}</div>
        <div className="text-[12.5px] text-ink-muted mt-0.5">
          {[pf.customerAddress, pf.customerPhone, pf.customerEmail].filter(Boolean).join(" · ") || "—"}
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
            <span className="font-mono">{fmt(pf.subtotal)}</span>
          </div>
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-muted">{t(locale, "VAT")}</span>
            <span className="font-mono">{fmt(pf.taxTotal)}</span>
          </div>
          <div className="flex justify-between text-[15px] font-bold border-t border-line-strong mt-1 pt-2">
            <span>{t(locale, "Total")}</span>
            <span className="font-mono">{t(locale, "SAR")} {fmt(pf.total)}</span>
          </div>
        </div>
      </div>

      {pf.notes && (
        <div className="mt-5">
          <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1.5">{t(locale, "Notes")}</div>
          <p className="text-[13px] text-ink-muted">{pf.notes}</p>
        </div>
      )}
    </div>
  );
}
