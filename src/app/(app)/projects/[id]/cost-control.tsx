import Link from "next/link";
import { statusLabel, type StatusDomain } from "@/lib/status-registry";
import { SectionHeader } from "@/components/ui/section-header";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { t, type Locale } from "@/lib/i18n/dict";
import type { CostDrillRow, ProjectCostControl } from "@/lib/project-costing";
import { Money } from "../../sales/_shared/money";
import { StatRow } from "../../sales/_shared/stat-row";

// Project Revenue & Costs for one project. Every number arrives already computed by
// src/lib/project-costing.ts — this file only lays it out, so the figures on screen and the figures
// in the engine can never drift apart.

function FigureRow({
  label,
  amount,
  strong,
  tone,
  hint,
}: {
  label: string;
  amount: number;
  strong?: boolean;
  tone?: string;
  hint?: string;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-4 py-2"
      style={{ borderTop: "1px solid var(--line)", fontWeight: strong ? 700 : 500 }}
    >
      <span className="text-[12.5px]" style={{ color: strong ? "var(--ink)" : "var(--ink-muted)" }}>
        {label}
        {hint ? <span className="block text-[11px] text-ink-faint font-normal">{hint}</span> : null}
      </span>
      <span className="num-tabular text-[13px] shrink-0" style={{ color: tone }}>
        <Money amount={amount} context="summary" />
      </span>
    </div>
  );
}

function DrillTable({ locale, rows, empty }: { locale: Locale; rows: CostDrillRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-[12px] text-ink-faint py-2">{empty}</p>;
  return (
    <div className="table-scroll">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Type")}</TableHead>
            <TableHead>{t(locale, "Number")}</TableHead>
            <TableHead>{t(locale, "Date")}</TableHead>
            <TableHead>{t(locale, "Party")}</TableHead>
            <TableHead>{t(locale, "Status")}</TableHead>
            <TableHead className="num">{t(locale, "Amount")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell>{t(locale, r.type)}</TableCell>
              <TableCell className="font-semibold">
                <Link href={r.href} className="mono hover:text-brand-orange">
                  {r.number}
                </Link>
              </TableCell>
              <TableCell className="num-tabular text-xs">{r.date}</TableCell>
              <TableCell className="text-[12.5px] text-ink-muted">{r.party ?? "—"}</TableCell>
              <TableCell className="text-[12.5px] text-ink-muted">{ROW_TYPE_DOMAIN[r.type] ? statusLabel(locale, ROW_TYPE_DOMAIN[r.type], r.status) : t(locale, r.status)}</TableCell>
              <TableCell className="num" style={{ whiteSpace: "nowrap", color: r.negative ? "var(--accent-red)" : undefined }}>
                <Money amount={r.amount} context="summary" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}


// Which status domain a drill row's status belongs to, keyed by the row's existing document-type
// label (lib/project-costing.ts). Payment and journal rows carry pseudo-states ("received", "paid",
// "posted") that are not registry statuses, so they keep their plain translated text.
const ROW_TYPE_DOMAIN: Record<string, StatusDomain> = {
  Quotation: "quotation",
  "Sales Order": "sales_order",
  Invoice: "sales_invoice",
  "Credit Note": "credit_note",
  "Purchase Order": "purchase_order",
  "Debit Note": "debit_note",
};
export function ProjectCostControlSection({ locale, data }: { locale: Locale; data: ProjectCostControl }) {
  // D-2 (DEV-UI-01.7 C8): no profit, margin or profitability badge until COGS is trustworthy — the engine
  // still computes them (project-costing.ts unchanged); this section shows the factual figures only.
  const { revenue, cost, rows, labourEstimate, excludedUnconverted } = data;

  return (
    <section>
      {/* DEV-UI-01.7 C8 (product owner): the section is named for what it shows — it was "Cost & Profitability". */}
      <SectionHeader
        level={2}
        title={t(locale, "Project Revenue & Costs")}
        className="mb-[22px]"
      />

      {/* Four factual figures, four across (two at ≤640px, D-6): plain values. */}
      <StatRow
        columns={4}
        items={[
          { label: t(locale, "Sales Value"), value: <Money amount={revenue.confirmed} context="summary" /> },
          { label: t(locale, "Invoiced"), value: <Money amount={revenue.invoiced} context="summary" /> },
          { label: t(locale, "Collected"), value: <Money amount={revenue.received} context="summary" /> },
          { label: t(locale, "Total Cost"), value: <Money amount={cost.total} context="summary" /> },
        ]}
      />

      {/* .cost-breakdown-grid (mockup-parity.css) owns the layout: two across, stacked at ≤900px. */}
      <div className="cost-breakdown-grid">
        <div className="card" style={{ padding: "16px 18px" }}>
          <SectionHeader level={3} title={t(locale, "Revenue")} className="mb-1.5" />
          <FigureRow label={t(locale, "Quoted Value")} amount={revenue.quoted} hint={t(locale, "Committed — sent and accepted quotations")} />
          <FigureRow label={t(locale, "Confirmed Sales Value")} amount={revenue.confirmed} hint={t(locale, "Committed — confirmed and fulfilled sales orders")} />
          <FigureRow label={t(locale, "Invoiced Amount")} amount={revenue.invoiced} hint={t(locale, "Actual — posted invoices, net of issued credit notes")} />
          <FigureRow label={t(locale, "Received Payments")} amount={revenue.received} tone="var(--accent-green)" hint={t(locale, "Actual — cash received against these invoices")} />
          <FigureRow label={t(locale, "Outstanding Receivables")} amount={revenue.outstandingReceivable} strong />
          <details className="mt-3">
            <summary className="text-[12px] text-ink-muted cursor-pointer">{t(locale, "Show source documents")}</summary>
            <div className="mt-2">
              <DrillTable locale={locale} rows={rows.revenue} empty={t(locale, "No revenue records linked to this project yet.")} />
            </div>
          </details>
        </div>

        <div className="card" style={{ padding: "16px 18px" }}>
          <SectionHeader level={3} title={t(locale, "Costs")} className="mb-1.5" />
          <FigureRow label={t(locale, "Purchase / Supplier Cost")} amount={cost.purchase} hint={t(locale, "Committed — ordered and received purchase orders, net of issued debit notes")} />
          <FigureRow label={t(locale, "Amount Paid to Suppliers")} amount={cost.paidToSuppliers} hint={t(locale, "Actual — cash paid against these purchase orders")} />
          <FigureRow label={t(locale, "Outstanding Supplier Cost")} amount={cost.outstandingSupplier} />
          <FigureRow label={t(locale, "Other Direct Project Cost")} amount={cost.other} hint={t(locale, "Manual journal entries tagged to this project and posted to expense accounts")} />
          <FigureRow label={t(locale, "Total Project Cost")} amount={cost.total} strong tone="var(--warning)" />
          <p className="text-[11px] text-ink-faint mt-2">
            {t(locale, "Labour from time logs")}: {labourEstimate.hours.toFixed(1)} {t(locale, "Hours").toLowerCase()} ·{" "}
            <Money amount={labourEstimate.cost} context="summary" />.{" "}
            {t(locale, "Estimated from salary structures, so it is shown for information only and is not included in Total Project Cost.")}
          </p>
          <details className="mt-3">
            <summary className="text-[12px] text-ink-muted cursor-pointer">{t(locale, "Show source documents")}</summary>
            <div className="mt-2">
              <DrillTable locale={locale} rows={rows.costs} empty={t(locale, "No cost records linked to this project yet.")} />
            </div>
          </details>
        </div>
      </div>

      {excludedUnconverted > 0 && (
        <p className="text-[11.5px] mb-4" role="status" style={{ color: "var(--warning-ink)" }}>
          {excludedUnconverted} {t(locale, "documents excluded — missing exchange rate.")}{" "}
          {t(locale, "Add the missing rates in Preset Management → Exchange Rates.")}
        </p>
      )}
    </section>
  );
}
