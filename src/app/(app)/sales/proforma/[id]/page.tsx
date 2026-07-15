import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { Info } from "lucide-react";
import { db, proformaInvoicesTable, proformaInvoiceItemsTable, customersTable, salesOrdersTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { PartyCardStatic } from "../../_shared/party-card";
import { TotalsCard } from "../../_shared/totals-card";
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
      title: proformaInvoicesTable.title,
      status: proformaInvoicesTable.status,
      issueDate: proformaInvoicesTable.issueDate,
      subtotal: proformaInvoicesTable.subtotal,
      discount: proformaInvoicesTable.discount,
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

  const [items, [org]] = await Promise.all([
    db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, proformaId)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between mb-[22px]">
        <div>
          <h3 className="text-[22px] font-bold font-mono">{pf.proformaNumber}</h3>
          <p className="text-[12.5px] text-ink-muted mt-1.5">
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
          </p>
        </div>
        <ProformaDetailActions locale={locale} proformaId={pf.id} status={pf.status} />
      </div>

      <div className="inline-flex items-center gap-2 rounded-full bg-info-bg text-info text-[11px] font-semibold px-3 py-1.5 mb-5">
        <Info className="size-3.5" />
        {t(locale, "Non-posting — for client reference only. Never affects revenue or stock.")}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-[18px]">
        <PartyCardStatic label={t(locale, "Bill from")} name={org.name} address={org.address} email={org.email} phone={org.phone} />
        <PartyCardStatic
          label={t(locale, "Bill to")}
          name={pf.customerName}
          address={pf.customerAddress}
          email={pf.customerEmail}
          phone={pf.customerPhone}
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
        <TotalsCard locale={locale} subtotal={pf.subtotal} discount={pf.discount} taxTotal={pf.taxTotal} total={pf.total} totalLabel="Total" />
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
