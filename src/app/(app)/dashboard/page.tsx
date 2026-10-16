import { Fragment } from "react";
import { STATUS_TONE_TOKENS, resolveStatus, statusLabel, statusTextClass } from "@/lib/status-registry";
import { ShoppingCart, FileText, Wallet, CreditCard, BookOpen, ChevronRight, FileSignature, Building2, UserPlus, Shield } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getProfileByCountryName, profileHasFeature } from "@/lib/geo/country-profiles";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { formatDisplayDate } from "@/lib/i18n/format-date";
import { PageHeader } from "@/components/layout/page-header";
import { getDashboardPrefs } from "@/lib/user-prefs";
import { isDashboardRange, resolveRange, RANGE_LABELS, type DashboardRange } from "@/lib/dashboard-range";
import type { DashboardWidgetKey } from "@/lib/dashboard-layout";
import { Money } from "../sales/_shared/money";
import { formatMoneyNumber } from "@/lib/currency/currencies";
import { ComboChart, Donut } from "./_shared/charts";
import { KpiCard } from "./_shared/kpi-card";
import { DashboardToolbar } from "./dashboard-toolbar";
import { BaseCurrencyNotice } from "./base-currency-notice";
import { getBaseCurrencyConfirmation } from "@/lib/base-currency";
import { getKpis, getRevenueSeries, getInvoicesOverview, getCashFlow, getRecentActivity, getProjectsOverview, getHrSnapshot, getBaseDataQuality } from "./_shared/queries";
import { fireEnsureFreshRates } from "@/lib/rates/fetch-rates";
import { after } from "next/server";

// DEV-UI-01.7 C6: a widget's desktop size is data — its column span and row span as custom properties
// the stylesheet reads (.dash-grid / .dash-widget), so the narrower layouts can override them; `wide`
// marks one that spans the whole row on a tablet.
function DashWidget({ col, row, wide, children }: { col: number; row: number; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="dash-widget" data-wide={wide ? "" : undefined} style={{ "--dash-span": col, "--dash-rows": row } as React.CSSProperties}>
      {children}
    </div>
  );
}

// Invoice-status colours come from the status registry (DEV-UI-01.2) — the dashboard makes no
// colour decision of its own for paid / partial / pending / overdue.
function settlementColor(key: "paid" | "partial" | "pending" | "overdue"): string {
  return STATUS_TONE_TOKENS[resolveStatus("invoice_settlement", key).tone].fg;
}

// Dashboard KPI figures are a summary context → 0 decimals (rounded), matching <Money context="summary">.
function fmt(n: number) {
  return formatMoneyNumber(n, "summary");
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const session = await requireSession();
  // The other daily-fetch surface: the first dashboard load of the day refreshes the org's
  // exchange rates. after() runs it once the response has streamed — off the request path entirely.
  after(() => fireEnsureFreshRates(session.orgId));
  const locale = await getLocale();
  const prefs = await getDashboardPrefs(session.orgId, session.userId);
  const showZatca = profileHasFeature(getProfileByCountryName(session.orgCountry), "zatca_phase1");

  const sp = await searchParams;
  const rangeKey: DashboardRange = isDashboardRange(sp.range) ? sp.range : prefs.range;
  const range = resolveRange(rangeKey);
  const rangeLabel = t(locale, RANGE_LABELS[rangeKey]);

  const [kpis, revenue, invoicesOverview, cashFlow, recentActivity, projectsOverview, hrSnapshot, baseDataQuality] = await Promise.all([
    getKpis(session.orgId, range),
    getRevenueSeries(session.orgId, range),
    getInvoicesOverview(session.orgId, range),
    getCashFlow(session.orgId, range),
    getRecentActivity(session.orgId, range),
    getProjectsOverview(session.orgId),
    getHrSnapshot(session.orgId),
    getBaseDataQuality(session.orgId),
  ]);

  const baseCurrency = await getBaseCurrencyConfirmation(session.orgId, session.role);

  const revenueSeries = revenue.map((p) => p.total);
  const revenueLabels = revenue.map((p) => p.label);
  const invPct = (n: number) => (invoicesOverview.total > 0 ? Math.round((n / invoicesOverview.total) * 100) : 0);
  // The selected range's revenue buckets, when there are enough to draw (every range has at least three).
  const revenueSpark = revenueSeries.length > 1 ? revenueSeries : undefined;

  const quickActions: { icon: React.ReactNode; label: string; href?: string }[] = [
    { icon: <FileSignature className="size-4" />, label: "Create Invoice", href: "/sales/invoices/new" },
    { icon: <FileText className="size-4" />, label: "Create Quotation", href: "/sales/quotations/new" },
    { icon: <BookOpen className="size-4" />, label: "Add Journal", href: "/finance/journal" },
    { icon: <Building2 className="size-4" />, label: "Bank Transaction", href: "/finance/journal" },
    { icon: <ShoppingCart className="size-4" />, label: "New Purchase Order", href: "/purchasing/orders/new" },
    { icon: <UserPlus className="size-4" />, label: "Add Employee", href: "/hr/employees/new" },
  ];

  // Each customizable widget rendered once, keyed. The grid renders them in the user's saved
  // order (feature_strip is a full-width footer, rendered below the grid when visible).
  const widgets: Record<Exclude<DashboardWidgetKey, "feature_strip">, React.ReactNode> = {
    kpi_sales: (
      <DashWidget col={3} row={2}>
        <KpiCard locale={locale} label="Total Sales" value={fmt(kpis.totalSalesThisMonth)} isCurrency trendPct={kpis.totalSalesTrend.pct} trendUp={kpis.totalSalesTrend.up} icon={ShoppingCart} accent="var(--brand-orange)" sparkValues={revenueSpark} />
      </DashWidget>
    ),
    kpi_invoices: (
      <DashWidget col={3} row={2}>
        <KpiCard locale={locale} label="Total Invoices" value={String(kpis.totalInvoices)} trendPct={kpis.totalInvoicesTrend.pct} trendUp={kpis.totalInvoicesTrend.up} icon={FileText} accent="var(--accent-purple)" />
      </DashWidget>
    ),
    kpi_receivables: (
      <DashWidget col={3} row={2}>
        <KpiCard locale={locale} label="Total Receivables" value={fmt(kpis.totalReceivables)} isCurrency icon={Wallet} accent="var(--accent-green)" />
      </DashWidget>
    ),
    kpi_payables: (
      <DashWidget col={3} row={2}>
        <KpiCard locale={locale} label="Total Payables" value={fmt(kpis.totalPayables)} isCurrency icon={CreditCard} accent="var(--accent-red)" />
      </DashWidget>
    ),
    financial_overview: (
      <DashWidget col={8} row={5} wide>
        {/* DEV-UI-01.7 C6 (D-1): revenue only — the selected range's real total and its buckets. No profit,
            margin or expenses: the dashboard has no expense data to compute them from. */}
        <div className="card fin-card">
          <div className="fin-head">
            <h2 style={{ fontSize: 14, fontWeight: 700 }}>{t(locale, "Financial Overview")}</h2>
            <div className="select-pill" style={{ pointerEvents: "none" }}>{rangeLabel}</div>
          </div>
          <div className="fin-total-label">{t(locale, "Total Revenue")} · {rangeLabel}</div>
          <div className="fin-total-value"><Money amount={kpis.totalSalesThisMonth} context="summary" /></div>
          {revenueSpark && (
            <div style={{ marginTop: 14 }}>
              <ComboChart revenue={revenueSpark} labels={revenueLabels} />
            </div>
          )}
        </div>
      </DashWidget>
    ),
    quick_actions: (
      <DashWidget col={4} row={4}>
        <div className="card">
          <div className="side-panel-head"><h2>{t(locale, "Quick Actions")}</h2></div>
          <div style={{ padding: "14px 20px 20px" }}>
            <div className="quick-actions-grid">
              {quickActions.map((qa) =>
                qa.href ? (
                  <Link href={qa.href} key={qa.label} className="quick-action">
                    <div className="qa-icon">{qa.icon}</div>
                    <div className="qa-label">{t(locale, qa.label)}</div>
                  </Link>
                ) : (
                  <div key={qa.label} className="quick-action" style={{ opacity: 0.55, pointerEvents: "none" }}>
                    <div className="qa-icon">{qa.icon}</div>
                    <div className="qa-label">{t(locale, qa.label)}</div>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      </DashWidget>
    ),
    recent_activities: (
      <DashWidget col={4} row={5}>
        <div className="card">
          <div className="side-panel-head"><h2>{t(locale, "Recent Activities")}</h2></div>
          <div style={{ padding: "6px 20px 8px" }}>
            {recentActivity.length === 0 && <p className="text-[12px] text-ink-faint py-4">{t(locale, "No activity yet.")}</p>}
            {recentActivity.map((a, i) => (
              <div className="activity-row" key={i}>
                <div className="activity-icon" style={{ background: a.kind === "invoice" ? "var(--accent-orange-bg)" : "var(--accent-purple-bg)", color: a.kind === "invoice" ? "var(--brand-orange)" : "var(--accent-purple)" }}>
                  {a.kind === "invoice" ? <FileText className="size-3.5" /> : <FileSignature className="size-3.5" />}
                </div>
                <div>
                  <div className="activity-text">{a.kind === "invoice" ? t(locale, "Invoice created") : t(locale, "Quotation created")}: {a.label}</div>
                  <div className="activity-time">{formatDisplayDate(a.time, locale, "dateTime")}</div>
                </div>
                <div className="activity-chev"><ChevronRight className="size-3.5 rtl:rotate-180" /></div>
              </div>
            ))}
          </div>
        </div>
      </DashWidget>
    ),
    cash_flow: (
      <DashWidget col={3} row={3}>
        <div className="card bottom-card">
          <h2>{t(locale, "Cash Flow")} · {rangeLabel}</h2>
          <div className="bc-stat-row">
            <span className="lbl">{t(locale, "Cash Inflow")}</span>
            <span className="val" style={{ color: "var(--accent-green)" }}><Money amount={cashFlow.inflow} context="summary" /></span>
          </div>
          <div className="bc-stat-row">
            <span className="lbl">{t(locale, "Cash Outflow")}</span>
            <span className="val" style={{ color: "var(--accent-red)" }}><Money amount={cashFlow.outflow} context="summary" /></span>
          </div>
          <div className="bc-stat-row">
            <span className="lbl">{t(locale, "Net Cash Flow")}</span>
            <span className="val"><Money amount={cashFlow.net} context="summary" /></span>
          </div>
        </div>
      </DashWidget>
    ),
    invoices_overview: (
      <DashWidget col={3} row={4}>
        <div className="card bottom-card" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <h2 style={{ alignSelf: "flex-start" }}>{t(locale, "Invoices Overview")}</h2>
          <Donut
            segments={invoicesOverview.total > 0 ? [
              { value: invoicesOverview.paid, color: settlementColor("paid") },
              { value: invoicesOverview.partial, color: settlementColor("partial") },
              { value: invoicesOverview.pending, color: settlementColor("pending") },
              { value: invoicesOverview.overdue, color: settlementColor("overdue") },
            ] : [{ value: 1, color: "var(--line)" }]}
            size={110} thickness={13} centerLabel={t(locale, "Total")} centerValue={String(invoicesOverview.total)}
          />
          <div style={{ width: "100%", marginTop: 10 }}>
            <div className="bc-stat-row"><span className="lbl"><span className="dot" style={{ background: settlementColor("paid") }} />{statusLabel(locale, "invoice_settlement", "paid")}</span><span className="val">{invoicesOverview.paid} ({invPct(invoicesOverview.paid)}%)</span></div>
            <div className="bc-stat-row"><span className="lbl"><span className="dot" style={{ background: settlementColor("partial") }} />{statusLabel(locale, "invoice_settlement", "partial")}</span><span className="val">{invoicesOverview.partial} ({invPct(invoicesOverview.partial)}%)</span></div>
            <div className="bc-stat-row"><span className="lbl"><span className="dot" style={{ background: settlementColor("pending") }} />{statusLabel(locale, "invoice_settlement", "pending")}</span><span className="val">{invoicesOverview.pending} ({invPct(invoicesOverview.pending)}%)</span></div>
            <div className="bc-stat-row"><span className="lbl"><span className="dot" style={{ background: settlementColor("overdue") }} />{statusLabel(locale, "invoice_settlement", "overdue")}</span><span className="val">{invoicesOverview.overdue} ({invPct(invoicesOverview.overdue)}%)</span></div>
          </div>
          <Link href="/sales/invoices" className="bc-link">{t(locale, "View All Invoices")} <ChevronRight className="size-3 rtl:rotate-180" style={{ color: "var(--brand-orange)" }} /></Link>
        </div>
      </DashWidget>
    ),
    project_overview: (
      <DashWidget col={3} row={4}>
        <div className="card bottom-card">
          <h2>{t(locale, "Project Overview")}</h2>
          <div className="bc-bignum">{projectsOverview.active}</div>
          <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 10 }}>{t(locale, "Active Projects")}</div>
          {([
            ["completed", projectsOverview.completed],
            ["active", projectsOverview.active],
            ["on_hold", projectsOverview.onHold],
            ["planned", projectsOverview.planned],
          ] as const).map(([status, count]) => (
            <div key={status} className="bc-stat-row" data-status-domain="project" data-status={status} data-tone={resolveStatus("project", status).tone}>
              <span className="lbl"><span className={statusTextClass("project", status)}>{statusLabel(locale, "project", status)}</span></span>
              <span className="val">{count}</span>
            </div>
          ))}
          <Link href="/projects" className="bc-link">{t(locale, "Go to Projects")} <ChevronRight className="size-3 rtl:rotate-180" style={{ color: "var(--brand-orange)" }} /></Link>
        </div>
      </DashWidget>
    ),
    hr_snapshot: (
      <DashWidget col={3} row={3}>
        <div className="card bottom-card">
          <h2>{t(locale, "HR Snapshot")}</h2>
          <div className="bc-bignum">{hrSnapshot.total}</div>
          <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 10 }}>{t(locale, "Total Employees")}</div>
          {([
            ["present", hrSnapshot.present],
            ["on_leave", hrSnapshot.onLeave],
            ["absent", hrSnapshot.absent],
          ] as const).map(([status, count]) => (
            <div key={status} className="bc-stat-row" data-status-domain="attendance" data-status={status} data-tone={resolveStatus("attendance", status).tone}>
              <span className="lbl"><span className={statusTextClass("attendance", status)}>{statusLabel(locale, "attendance", status)}</span></span>
              <span className="val">{count}</span>
            </div>
          ))}
          <Link href="/hr/employees" className="bc-link">{t(locale, "Go to HRM")} <ChevronRight className="size-3 rtl:rotate-180" style={{ color: "var(--brand-orange)" }} /></Link>
        </div>
      </DashWidget>
    ),
  };

  const featureStripVisible = prefs.layout.find((l) => l.key === "feature_strip")?.visible ?? true;

  return (
    <div>
      {/* Shown only to orgs that predate the base-currency question and have posted nothing.
          Renders above the dashboard and blocks none of it. */}
      {baseCurrency && (
        <BaseCurrencyNotice locale={locale} currency={baseCurrency.currency} country={baseCurrency.country} />
      )}
      {/* FX-8 data quality: every money widget below has EXCLUDED these documents (no stored base
          conversion), so the shortfall is named and linked instead of silently absorbed. Zero rows
          in healthy data — FX-6 blocks unconverted postings. */}
      {baseDataQuality.total > 0 && (
        <div
          role="status"
          data-testid="base-data-quality"
          className="mb-4 flex flex-wrap items-center gap-2 rounded-[10px] border border-warning/40 bg-warning-bg px-3 py-2 text-[12.5px]"
        >
          <span className="font-semibold">
            {baseDataQuality.total} {t(locale, "documents excluded from the totals below — missing exchange rate.")}
          </span>
          {baseDataQuality.invoices > 0 && (
            <Link href="/sales/invoices" className="underline">
              {baseDataQuality.invoices} {t(locale, "invoices")}
            </Link>
          )}
          {baseDataQuality.purchaseOrders > 0 && (
            <Link href="/purchasing/orders" className="underline">
              {baseDataQuality.purchaseOrders} {t(locale, "purchase orders")}
            </Link>
          )}
          <span className="text-ink-muted">{t(locale, "Add the missing rates in Preset Management → Exchange Rates.")}</span>
        </div>
      )}
      <PageHeader title={t(locale, "Dashboard")} actions={<DashboardToolbar locale={locale} range={rangeKey} layout={prefs.layout} />} />

      <div className="dash-grid">
        {prefs.layout
          .filter((l) => l.visible && l.key !== "feature_strip")
          .map((l) => (
            <Fragment key={l.key}>{widgets[l.key as Exclude<DashboardWidgetKey, "feature_strip">]}</Fragment>
          ))}
      </div>

      {/* DEV-UI-01.7 C6 (D-4): the strip holds one factual card — ZATCA Phase 1's printed QR, where the
          country profile enables it — so it renders only then (and while the widget is shown): no
          marketing cards, and no empty strip for an org it does not apply to. Phase 1 is a printed QR,
          not a compliance certification and not a ZATCA connection. */}
      {featureStripVisible && showZatca && (
        <div className="feature-strip">
          <div className="feature-card">
            <div className="f-icon"><Shield className="size-4.5" /></div>
            <div><div className="f-title">{t(locale, "ZATCA Phase 1 QR")}</div><div className="f-sub">{t(locale, "On printed tax invoices")}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}
