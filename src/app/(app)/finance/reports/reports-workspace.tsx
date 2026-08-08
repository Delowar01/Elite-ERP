"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Download, Search, Loader2, ChevronRight } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { Money } from "../../sales/_shared/money";
import { getAccountDrilldownAction } from "./actions";
import { ReportBodySkeleton } from "@/components/ui/skeleton";
import type {
  ReportKind, DateRange, ProfitAndLoss, BalanceSheet, CashFlow, TrialBalance,
  GlAccountBlock, Aging, AgingBucketKey, VatSummary,
} from "@/lib/finance-reports";

export type ReportPayload =
  | { kind: "pl"; pl: ProfitAndLoss; plPrev?: ProfitAndLoss }
  | { kind: "bs"; bs: BalanceSheet; bsPrev?: BalanceSheet }
  | { kind: "cf"; cf: CashFlow; cfPrev?: CashFlow }
  | { kind: "tb"; tb: TrialBalance }
  | { kind: "gl"; gl: GlAccountBlock[] }
  | { kind: "ar"; ar: Aging }
  | { kind: "ap"; ap: Aging }
  | { kind: "vat"; vat: VatSummary; vatPrev?: VatSummary };

const REPORTS: { kind: ReportKind; label: string }[] = [
  { kind: "pl", label: "Profit & Loss" },
  { kind: "bs", label: "Balance Sheet" },
  { kind: "cf", label: "Cash Flow" },
  { kind: "tb", label: "Trial Balance" },
  { kind: "gl", label: "General Ledger" },
  { kind: "ar", label: "AR Aging" },
  { kind: "ap", label: "AP Aging" },
  { kind: "vat", label: "VAT Summary" },
];
const BUCKET_LABELS: Record<AgingBucketKey, string> = { current: "Current", d1_30: "1–30 Days", d31_60: "31–60 Days", d61_90: "61–90 Days", d90p: "90+ Days" };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function fyRange(startMonth: number, ref = new Date()): DateRange {
  const y = ref.getUTCFullYear(), m = ref.getUTCMonth() + 1;
  const sy = m >= startMonth ? y : y - 1;
  const from = new Date(Date.UTC(sy, startMonth - 1, 1));
  const to = new Date(Date.UTC(sy + 1, startMonth - 1, 1)); to.setUTCDate(to.getUTCDate() - 1);
  return { from: ymd(from), to: ymd(to) };
}
function monthRange(ref: Date): DateRange {
  const from = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const to = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0));
  return { from: ymd(from), to: ymd(to) };
}
function quarterRange(ref: Date): DateRange {
  const q = Math.floor(ref.getUTCMonth() / 3);
  const from = new Date(Date.UTC(ref.getUTCFullYear(), q * 3, 1));
  const to = new Date(Date.UTC(ref.getUTCFullYear(), q * 3 + 3, 0));
  return { from: ymd(from), to: ymd(to) };
}

// Signed amount cell — negatives in danger red, drill affordance when an accountId is given.
function Num({ v, onDrill, strong }: { v: number; onDrill?: () => void; strong?: boolean }) {
  const cls = `mono ${v < 0 ? "text-danger" : ""} ${strong ? "font-semibold" : ""}`;
  const body = <Money amount={v} context="document" className={cls} />;
  return onDrill ? (
    <button type="button" className="hover:text-brand-orange cursor-pointer" onClick={onDrill}>{body}</button>
  ) : body;
}

export function ReportsWorkspace({
  locale, report, range, compare, accountId, fiscalStartMonth, accounts, payload,
}: {
  locale: Locale;
  report: ReportKind;
  range: DateRange;
  compare: boolean;
  accountId?: number;
  fiscalStartMonth: number;
  accounts: { id: number; code: string; name: string }[];
  payload: ReportPayload;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState("");
  const [drill, setDrill] = useState<{ id: number; name: string } | null>(null);
  const [drillBlock, setDrillBlock] = useState<GlAccountBlock | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // Fetch the transactions behind a report line when it's clicked (event handler, not an effect).
  function openDrill(x: { id: number; name: string }) {
    setDrill(x); setDrillBlock(null); setDrillLoading(true);
    getAccountDrilldownAction(x.id, range.from, range.to).then(setDrillBlock).finally(() => setDrillLoading(false));
  }

  function setParams(patch: Record<string, string | undefined>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") p.delete(k); else p.set(k, v); }
    start(() => router.push(`${pathname}?${p.toString()}`));
  }
  const setRange = (r: DateRange) => setParams({ from: r.from, to: r.to });

  const today = new Date();
  const presets: { label: string; range: DateRange }[] = [
    { label: "This Month", range: monthRange(today) },
    { label: "This Quarter", range: quarterRange(today) },
    { label: "This Financial Year", range: fyRange(fiscalStartMonth, today) },
    { label: "Last Month", range: monthRange(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))) },
    { label: "Last Financial Year", range: fyRange(fiscalStartMonth, new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), 1))) },
    { label: "All Time", range: { from: "1900-01-01", to: ymd(today) } },
  ];

  const exportUrl = (format: string) => {
    const p = new URLSearchParams({ report, from: range.from, to: range.to, format });
    if (accountId) p.set("account", String(accountId));
    return `/finance/reports/export?${p.toString()}`;
  };

  const title = t(locale, REPORTS.find((r) => r.kind === report)!.label);
  const showAccountFilter = report === "gl";

  return (
    <div className="reports-print-area max-w-6xl mx-auto">
      <PrintStyles />
      <div className="main-head no-print">
        <h3>{t(locale, "Financial Reports")}</h3>
        <div className="flex items-center gap-2">
          <div className="doc-pill-btn-group flex items-center gap-1">
            <a href={exportUrl("csv")} className="doc-pill-btn" style={{ height: 32, fontSize: 12 }}><Download className="size-3.5" /> CSV</a>
            <a href={exportUrl("xlsx")} className="doc-pill-btn" style={{ height: 32, fontSize: 12 }}>Excel</a>
            <a href={exportUrl("pdf")} className="doc-pill-btn" style={{ height: 32, fontSize: 12 }}><Download className="size-3.5" /> PDF</a>
          </div>
        </div>
      </div>

      {/* Report selector */}
      <div className="tab-row no-print" style={{ marginBottom: 14 }}>
        {REPORTS.map((r) => (
          <button key={r.kind} type="button" className={r.kind === report ? "tab active" : "tab"} onClick={() => setParams({ report: r.kind, account: undefined })}>
            {t(locale, r.label)}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="card no-print" style={{ padding: "12px 14px", marginBottom: 16 }}>
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {presets.map((p) => {
            const active = p.range.from === range.from && p.range.to === range.to;
            return (
              <button key={p.label} type="button" className={active ? "doc-pill-btn active" : "doc-pill-btn"} style={{ height: 28, fontSize: 11.5 }} onClick={() => setRange(p.range)}>
                {t(locale, p.label)}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            {t(locale, "From")}
            <input type="date" value={range.from} onChange={(e) => setParams({ from: e.target.value })} className="input plain h-8 text-xs" />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            {t(locale, "To")}
            <input type="date" value={range.to} onChange={(e) => setParams({ to: e.target.value })} className="input plain h-8 text-xs" />
          </label>
          {report !== "ar" && report !== "ap" && (
            <label className="flex items-center gap-1.5 text-[12px] text-ink-muted cursor-pointer">
              <input type="checkbox" checked={compare} onChange={(e) => setParams({ compare: e.target.checked ? "1" : undefined })} />
              {t(locale, "Compare with previous period")}
            </label>
          )}
          {showAccountFilter && (
            <Select value={accountId ? String(accountId) : "all"} onValueChange={(v) => setParams({ account: v === "all" ? undefined : v })}>
              <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t(locale, "All accounts")}</SelectItem>
                {accounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.code} · {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="flex items-center gap-1.5 ms-auto">
            <Search className="size-3.5 text-ink-faint" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t(locale, "Search…")} className="input plain h-8 w-40 text-xs" />
          </div>
          {pending && <Loader2 className="size-4 animate-spin text-brand-orange" />}
        </div>
      </div>

      {/* Report title (shown in print) */}
      <div className="mb-3">
        <h3 className="text-[16px] font-bold">{title}</h3>
        <div className="text-[12px] text-ink-faint">{range.from} → {range.to}</div>
      </div>

      {/* Only the report BODY is replaced during a transition. The report picker, date range,
          compare toggle and search above stay live and interactive — the most common move is to
          switch report, notice the range is wrong and fix it, and blanking the controls with the
          body would cost a whole extra round trip. The skeleton uses the same delay rule as the
          list placeholders, so a fast switch shows no placeholder at all. */}
      <div className="card" style={{ padding: "18px 20px" }}>
        {pending ? (
          <ReportBodySkeleton />
        ) : (
          <>
            {payload.kind === "pl" && <PnlView locale={locale} d={payload.pl} prev={payload.plPrev} search={search} onDrill={openDrill} />}
            {payload.kind === "bs" && <BsView locale={locale} d={payload.bs} prev={payload.bsPrev} search={search} onDrill={openDrill} />}
            {payload.kind === "cf" && <CfView locale={locale} d={payload.cf} prev={payload.cfPrev} />}
            {payload.kind === "tb" && <TbView locale={locale} d={payload.tb} search={search} onDrill={openDrill} />}
            {payload.kind === "gl" && <GlView locale={locale} blocks={payload.gl} search={search} />}
            {payload.kind === "ar" && <AgingView locale={locale} d={payload.ar} search={search} kind="ar" />}
            {payload.kind === "ap" && <AgingView locale={locale} d={payload.ap} search={search} kind="ap" />}
            {payload.kind === "vat" && <VatView locale={locale} d={payload.vat} prev={payload.vatPrev} />}
          </>
        )}
      </div>

      <DrillDrawer locale={locale} drill={drill} block={drillBlock} loading={drillLoading} onClose={() => setDrill(null)} />
    </div>
  );
}

// ── Summary cards ────────────────────────────────────────────────────────────
function Cards({ items }: { items: { label: string; value: number; badge?: string; ok?: boolean; delta?: number }[] }) {
  return (
    <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
      {items.map((it) => (
        <div key={it.label} className="card" style={{ padding: "12px 14px" }}>
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">{it.label}</div>
          <div className="text-[19px] font-bold mono mt-0.5"><Money amount={it.value} context="summary" /></div>
          {it.badge && <div className={`text-[11px] mt-1 ${it.ok ? "text-success" : "text-danger"}`}>{it.badge}</div>}
          {it.delta != null && <div className={`text-[11px] mt-1 ${it.delta >= 0 ? "text-success" : "text-danger"}`}>{it.delta >= 0 ? "▲" : "▼"} <Money amount={Math.abs(it.delta)} context="summary" /></div>}
        </div>
      ))}
    </div>
  );
}
function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wide text-ink-faint mt-4 mb-1.5 first:mt-0">{children}</div>;
}
function Row({ label, value, onDrill, final }: { label: React.ReactNode; value: number; onDrill?: () => void; final?: boolean }) {
  return (
    <div className={final ? "payslip-line final" : "payslip-line"}>
      <span className={final ? "font-semibold" : ""}>{label}</span>
      <Num v={value} onDrill={onDrill} strong={final} />
    </div>
  );
}
const inSearch = (s: string, ...fields: string[]) => !s.trim() || fields.some((f) => f.toLowerCase().includes(s.trim().toLowerCase()));

// ── P&L ──────────────────────────────────────────────────────────────────────
function PnlView({ locale, d, prev, search, onDrill }: { locale: Locale; d: ProfitAndLoss; prev?: ProfitAndLoss; search: string; onDrill: (x: { id: number; name: string }) => void }) {
  const line = (l: { id: number; code: string; name: string; amount: number }) =>
    inSearch(search, l.code, l.name) ? <Row key={l.id} label={`${l.code} ${l.name}`} value={l.amount} onDrill={() => onDrill({ id: l.id, name: l.name })} /> : null;
  return (
    <>
      <Cards items={[
        { label: t(locale, "Revenue"), value: d.revenueTotal, delta: prev ? d.revenueTotal - prev.revenueTotal : undefined },
        { label: t(locale, "Gross Profit"), value: d.grossProfit, delta: prev ? d.grossProfit - prev.grossProfit : undefined },
        { label: t(locale, "Net Profit"), value: d.netProfit, delta: prev ? d.netProfit - prev.netProfit : undefined },
      ]} />
      <GroupLabel>{t(locale, "Revenue")}</GroupLabel>
      {d.revenue.map(line)}
      <Row label={t(locale, "Total Revenue")} value={d.revenueTotal} final />
      <GroupLabel>{t(locale, "Cost of Sales")}</GroupLabel>
      {d.costOfSales.map(line)}
      <Row label={t(locale, "Gross Profit")} value={d.grossProfit} final />
      <GroupLabel>{t(locale, "Operating Expenses")}</GroupLabel>
      {d.operatingExpenses.map(line)}
      <Row label={t(locale, "Operating Profit")} value={d.operatingProfit} final />
      {(d.otherIncome.length > 0 || d.otherExpenses.length > 0) && <GroupLabel>{t(locale, "Other Income & Expenses")}</GroupLabel>}
      {d.otherIncome.map(line)}
      {d.otherExpenses.map(line)}
      <Row label={t(locale, "Net Profit / (Loss)")} value={d.netProfit} final />
    </>
  );
}

// ── Balance Sheet ─────────────────────────────────────────────────────────────
function BsView({ locale, d, prev, search, onDrill }: { locale: Locale; d: BalanceSheet; prev?: BalanceSheet; search: string; onDrill: (x: { id: number; name: string }) => void }) {
  const line = (l: { id: number; code: string; name: string; amount: number }) =>
    inSearch(search, l.code, l.name) ? <Row key={l.id} label={`${l.code} ${l.name}`} value={l.amount} onDrill={() => onDrill({ id: l.id, name: l.name })} /> : null;
  return (
    <>
      <Cards items={[
        { label: t(locale, "Total Assets"), value: d.totalAssets, delta: prev ? d.totalAssets - prev.totalAssets : undefined },
        { label: t(locale, "Total Liabilities"), value: d.totalLiabilities, delta: prev ? d.totalLiabilities - prev.totalLiabilities : undefined },
        { label: t(locale, "Total Equity"), value: d.totalEquity, delta: prev ? d.totalEquity - prev.totalEquity : undefined },
        { label: t(locale, "Balance check"), value: d.totalAssets, badge: d.balanced ? `✓ ${t(locale, "Balanced")}` : t(locale, "Not balanced"), ok: d.balanced },
      ]} />
      {d.currentAssets.length > 0 && <><GroupLabel>{t(locale, "Current Assets")}</GroupLabel>{d.currentAssets.map(line)}</>}
      {d.nonCurrentAssets.length > 0 && <><GroupLabel>{t(locale, "Non-current Assets")}</GroupLabel>{d.nonCurrentAssets.map(line)}</>}
      <Row label={t(locale, "Total Assets")} value={d.totalAssets} final />
      {d.currentLiabilities.length > 0 && <><GroupLabel>{t(locale, "Current Liabilities")}</GroupLabel>{d.currentLiabilities.map(line)}</>}
      {d.nonCurrentLiabilities.length > 0 && <><GroupLabel>{t(locale, "Non-current Liabilities")}</GroupLabel>{d.nonCurrentLiabilities.map(line)}</>}
      <Row label={t(locale, "Total Liabilities")} value={d.totalLiabilities} final />
      <GroupLabel>{t(locale, "Equity")}</GroupLabel>
      {d.equity.map(line)}
      <Row label={t(locale, "Retained Earnings")} value={d.retainedEarnings} />
      <Row label={t(locale, "Current-period Profit / (Loss)")} value={d.currentPeriodProfit} />
      <Row label={t(locale, "Total Equity")} value={d.totalEquity} final />
      <Row label={t(locale, "Total Liabilities + Equity")} value={d.totalLiabilitiesAndEquity} final />
    </>
  );
}

// ── Cash Flow ─────────────────────────────────────────────────────────────────
function CfView({ locale, d, prev }: { locale: Locale; d: CashFlow; prev?: CashFlow }) {
  return (
    <>
      <Cards items={[
        { label: t(locale, "Opening Cash Balance"), value: d.openingCash },
        { label: t(locale, "Net Cash Movement"), value: d.netMovement, delta: prev ? d.netMovement - prev.netMovement : undefined },
        { label: t(locale, "Closing Cash Balance"), value: d.closingCash },
      ]} />
      <Row label={t(locale, "Opening Cash Balance")} value={d.openingCash} final />
      <GroupLabel>{t(locale, "Operating Activities")}</GroupLabel>
      {d.operatingRows.map((r) => <Row key={r.label} label={t(locale, sourceLabel(r.label))} value={r.amount} />)}
      <Row label={t(locale, "Net Operating Activities")} value={d.operating} final />
      <GroupLabel>{t(locale, "Investing Activities")}</GroupLabel>
      <Row label={t(locale, "Net Investing Activities")} value={d.investing} final />
      <GroupLabel>{t(locale, "Financing Activities")}</GroupLabel>
      <Row label={t(locale, "Net Financing Activities")} value={d.financing} final />
      <Row label={t(locale, "Net Cash Movement")} value={d.netMovement} final />
      <Row label={t(locale, "Closing Cash Balance")} value={d.closingCash} final />
    </>
  );
}
function sourceLabel(s: string): string {
  const map: Record<string, string> = { sales_invoice: "Sales invoices", payment: "Payments", purchase_order: "Purchases", credit_note: "Credit notes", debit_note: "Debit notes", payroll: "Payroll", payroll_run: "Payroll", expense: "Expenses", manual: "Manual entries" };
  return map[s] ?? s;
}

// ── Trial Balance ─────────────────────────────────────────────────────────────
function TbView({ locale, d, search, onDrill }: { locale: Locale; d: TrialBalance; search: string; onDrill: (x: { id: number; name: string }) => void }) {
  const rows = d.rows.filter((r) => inSearch(search, r.code, r.name));
  return (
    <>
      <Cards items={[
        { label: t(locale, "Total debits"), value: d.totals.closingDr },
        { label: t(locale, "Total credits"), value: d.totals.closingCr },
        { label: t(locale, "Balance check"), value: d.totals.closingDr, badge: d.balanced ? `✓ ${t(locale, "Balanced")}` : t(locale, "Not balanced"), ok: d.balanced },
      ]} />
      <div className="table-scroll">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Code")}</TableHead><TableHead>{t(locale, "Account")}</TableHead>
              <TableHead className="num">{t(locale, "Opening Dr")}</TableHead><TableHead className="num">{t(locale, "Opening Cr")}</TableHead>
              <TableHead className="num">{t(locale, "Period Dr")}</TableHead><TableHead className="num">{t(locale, "Period Cr")}</TableHead>
              <TableHead className="num">{t(locale, "Closing Dr")}</TableHead><TableHead className="num">{t(locale, "Closing Cr")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => onDrill({ id: r.id, name: r.name })}>
                <TableCell className="mono">{r.code}</TableCell><TableCell>{r.name}</TableCell>
                <TableCell className="num mono">{cell(r.openingDr)}</TableCell><TableCell className="num mono">{cell(r.openingCr)}</TableCell>
                <TableCell className="num mono">{cell(r.periodDebit)}</TableCell><TableCell className="num mono">{cell(r.periodCredit)}</TableCell>
                <TableCell className="num mono">{cell(r.closingDr)}</TableCell><TableCell className="num mono">{cell(r.closingCr)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell /><TableCell>{t(locale, "TOTAL")}</TableCell>
              <TableCell className="num mono">{cell(d.totals.openingDr)}</TableCell><TableCell className="num mono">{cell(d.totals.openingCr)}</TableCell>
              <TableCell className="num mono">{cell(d.totals.periodDr)}</TableCell><TableCell className="num mono">{cell(d.totals.periodCr)}</TableCell>
              <TableCell className="num mono">{cell(d.totals.closingDr)}</TableCell><TableCell className="num mono">{cell(d.totals.closingCr)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </>
  );
}
const cell = (v: number) => (v ? <Money amount={v} context="document" /> : "—");

// ── General Ledger ────────────────────────────────────────────────────────────
function GlView({ locale, blocks, search }: { locale: Locale; blocks: GlAccountBlock[]; search: string }) {
  const shown = blocks.filter((b) => inSearch(search, b.code, b.name));
  if (shown.length === 0) return <div className="text-center text-ink-faint py-8 text-sm">{t(locale, "No transactions in this period.")}</div>;
  return (
    <div className="flex flex-col gap-6">
      {shown.map((b) => (
        <div key={b.accountId}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="font-semibold text-[13px]"><span className="mono text-ink-faint">{b.code}</span> {b.name}</div>
            <div className="text-[12px] text-ink-muted">{t(locale, "Opening")}: <span className="mono"><Money amount={b.opening} context="document" /></span></div>
          </div>
          <div className="table-scroll">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t(locale, "Date")}</TableHead><TableHead>{t(locale, "Memo")}</TableHead><TableHead>{t(locale, "Source")}</TableHead>
                  <TableHead className="num">{t(locale, "Debit")}</TableHead><TableHead className="num">{t(locale, "Credit")}</TableHead><TableHead className="num">{t(locale, "Balance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="mono text-xs">{r.date}</TableCell>
                    <TableCell>{r.memo}</TableCell>
                    <TableCell className="text-ink-faint text-xs">{t(locale, sourceLabel(r.sourceType))}</TableCell>
                    <TableCell className="num mono">{cell(r.debit)}</TableCell><TableCell className="num mono">{cell(r.credit)}</TableCell>
                    <TableCell className="num mono"><Money amount={r.running} context="document" /></TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell colSpan={3}>{t(locale, "Closing")}</TableCell>
                  <TableCell className="num mono">{cell(b.totalDebit)}</TableCell><TableCell className="num mono">{cell(b.totalCredit)}</TableCell>
                  <TableCell className="num mono"><Money amount={b.closing} context="document" /></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Aging (AR / AP) ───────────────────────────────────────────────────────────
function AgingView({ locale, d, search, kind }: { locale: Locale; d: Aging; search: string; kind: "ar" | "ap" }) {
  const rows = d.rows.filter((r) => inSearch(search, r.number, r.party));
  const buckets: AgingBucketKey[] = ["current", "d1_30", "d31_60", "d61_90", "d90p"];
  const hrefFor = (id: number) => (kind === "ar" ? `/sales/invoices/${id}` : `/purchasing/orders/${id}`);
  return (
    <>
      <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
        {buckets.map((b) => (
          <div key={b} className="card" style={{ padding: "10px 12px" }}>
            <div className="text-[11px] uppercase tracking-wide text-ink-faint">{t(locale, BUCKET_LABELS[b])}</div>
            <div className="text-[16px] font-bold mono mt-0.5"><Money amount={d.buckets[b]} context="summary" /></div>
          </div>
        ))}
        <div className="card" style={{ padding: "10px 12px", borderColor: "var(--brand-orange)" }}>
          <div className="text-[11px] uppercase tracking-wide text-ink-faint">{t(locale, "Total Outstanding")}</div>
          <div className="text-[16px] font-bold mono mt-0.5"><Money amount={d.totalOutstanding} context="summary" /></div>
        </div>
      </div>
      <div className="table-scroll">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Number")}</TableHead><TableHead>{t(locale, kind === "ar" ? "Customer" : "Vendor")}</TableHead>
              <TableHead>{t(locale, "Date")}</TableHead><TableHead>{t(locale, "Due Date")}</TableHead>
              <TableHead className="num">{t(locale, "Overdue Days")}</TableHead>
              <TableHead className="num">{t(locale, "Total")}</TableHead><TableHead className="num">{t(locale, "Paid")}</TableHead>
              <TableHead className="num">{t(locale, "Outstanding")}</TableHead><TableHead>{t(locale, "Bucket")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center text-ink-faint py-6">{t(locale, "Nothing outstanding.")}</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><Link href={hrefFor(r.id)} className="hover:text-brand-orange font-medium">{r.number}</Link></TableCell>
                <TableCell>{r.party}</TableCell>
                <TableCell className="mono text-xs">{r.date}</TableCell><TableCell className="mono text-xs">{r.dueDate}</TableCell>
                <TableCell className="num mono">{r.overdueDays}</TableCell>
                <TableCell className="num mono"><Money amount={r.total} context="document" /></TableCell>
                <TableCell className="num mono"><Money amount={r.paid} context="document" /></TableCell>
                <TableCell className="num mono font-semibold"><Money amount={r.outstanding} context="document" /></TableCell>
                <TableCell className="text-xs">{t(locale, BUCKET_LABELS[r.bucket])}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

// ── VAT Summary ───────────────────────────────────────────────────────────────
function VatView({ locale, d, prev }: { locale: Locale; d: VatSummary; prev?: VatSummary }) {
  return (
    <>
      <Cards items={[
        { label: t(locale, "Output VAT"), value: d.outputVat, delta: prev ? d.outputVat - prev.outputVat : undefined },
        { label: t(locale, "Input VAT"), value: d.inputVat, delta: prev ? d.inputVat - prev.inputVat : undefined },
        { label: t(locale, "Net VAT Payable"), value: d.netVat, delta: prev ? d.netVat - prev.netVat : undefined },
      ]} />
      <Row label={t(locale, "Output VAT")} value={d.outputVat} />
      <Row label={t(locale, "Input VAT")} value={d.inputVat} />
      <Row label={t(locale, "Net VAT Payable / (Recoverable)")} value={d.netVat} final />
      <GroupLabel>{t(locale, "VAT Adjustments")}</GroupLabel>
      <Row label={t(locale, "Credit-note VAT adjustment")} value={d.creditNoteVat} />
      <Row label={t(locale, "Debit-note VAT adjustment")} value={d.debitNoteVat} />
      <GroupLabel>{t(locale, "Transaction Totals")}</GroupLabel>
      <Row label={t(locale, "Taxable Sales")} value={d.taxableSales} />
      <Row label={t(locale, "Zero-rated Sales")} value={d.zeroRatedSales} />
      <Row label={t(locale, "Taxable Purchases")} value={d.taxablePurchases} />
    </>
  );
}

// ── Drill-down drawer (presentational; data fetched by the parent on click) ────
function DrillDrawer({ locale, drill, block, loading, onClose }: { locale: Locale; drill: { id: number; name: string } | null; block: GlAccountBlock | null; loading: boolean; onClose: () => void }) {
  const rows = block?.rows ?? [];
  return (
    <Dialog open={!!drill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5"><ChevronRight className="size-4" /> {drill?.name} — {t(locale, "Transactions")}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="py-10 text-center"><Loader2 className="size-5 animate-spin text-brand-orange mx-auto" /></div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-ink-faint text-sm">{t(locale, "No transactions in this period.")}</div>
        ) : (
          <div className="table-scroll max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t(locale, "Date")}</TableHead><TableHead>{t(locale, "Memo")}</TableHead>
                  <TableHead className="num">{t(locale, "Debit")}</TableHead><TableHead className="num">{t(locale, "Credit")}</TableHead><TableHead className="num">{t(locale, "Balance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="mono text-xs">{r.date}</TableCell>
                    <TableCell className="text-xs">{r.memo}</TableCell>
                    <TableCell className="num mono">{cell(r.debit)}</TableCell><TableCell className="num mono">{cell(r.credit)}</TableCell>
                    <TableCell className="num mono"><Money amount={r.running} context="document" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Print: hide app chrome + workspace controls, show only the report area full-width.
function PrintStyles() {
  return (
    <style>{`@media print {
      .sidebar, .topbar, .no-print { display: none !important; }
      .reports-print-area { max-width: none !important; margin: 0 !important; }
      main, .app-main, body { background: #fff !important; }
      .card { box-shadow: none !important; border: 1px solid #ddd !important; }
      a { color: inherit !important; text-decoration: none !important; }
    }`}</style>
  );
}
