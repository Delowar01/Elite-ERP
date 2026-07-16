import { Calendar, ShoppingCart, FileText, Wallet, CreditCard, ChevronRight, FileSignature, Building2, UserPlus, Shield, Lock, TrendingUp, RefreshCw, Link2 } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Money } from "../sales/_shared/money";
import { ComboChart, Donut, Sparkline } from "./_shared/charts";
import { KpiCard } from "./_shared/kpi-card";
import { getKpis, getRevenueTrend, getInvoicesOverview, getCashFlowThisMonth, getRecentActivity, getProjectsOverview } from "./_shared/queries";

function DashWidget({ col, row, children }: { col: number; row: number; children: React.ReactNode }) {
  return (
    <div className="dash-widget" style={{ gridColumn: `span ${col}`, gridRow: `span ${row}` }}>
      {children}
    </div>
  );
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function DashboardPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const [kpis, revenueTrend, invoicesOverview, cashFlow, recentActivity, projectsOverview] = await Promise.all([
    getKpis(session.orgId),
    getRevenueTrend(session.orgId),
    getInvoicesOverview(session.orgId),
    getCashFlowThisMonth(session.orgId),
    getRecentActivity(session.orgId),
    getProjectsOverview(session.orgId),
  ]);

  const revenueSeries = revenueTrend.map((p) => p.total);
  const revenueLabels = revenueTrend.map((p) => p.label);
  const expenseSeries = revenueTrend.map(() => 0);
  const totalProfit = kpis.totalSalesThisMonth;
  const profitMarginPct = kpis.totalSalesThisMonth > 0 ? 100 : 0;
  const invPct = (n: number) => (invoicesOverview.total > 0 ? Math.round((n / invoicesOverview.total) * 100) : 0);

  const quickActions: { icon: React.ReactNode; label: string; href?: string }[] = [
    { icon: <FileSignature className="size-4" />, label: "Create Invoice", href: "/sales/invoices/new" },
    { icon: <FileText className="size-4" />, label: "Create Quotation", href: "/sales/quotations/new" },
    { icon: <CreditCard className="size-4" />, label: "Add Expense" },
    { icon: <Building2 className="size-4" />, label: "Bank Transaction", href: "/finance/journal" },
    { icon: <ShoppingCart className="size-4" />, label: "New Purchase Order", href: "/purchasing/orders/new" },
    { icon: <UserPlus className="size-4" />, label: "Add Employee" },
  ];

  return (
    <div>
      <div className="dash-toolbar">
        <div className="doc-pill-btn" style={{ pointerEvents: "none" }}>
          <Calendar className="size-3.5" /> <span>{t(locale, "This Month")}</span>
        </div>
        <div className="toolbar-actions-right">
          <button type="button" className="btn btn-glass" disabled>
            {t(locale, "Customize Layout")}
          </button>
        </div>
      </div>

      <div className="dash-grid">
        <DashWidget col={3} row={2}>
          <KpiCard
            locale={locale}
            label="Total Sales (This Month)"
            value={fmt(kpis.totalSalesThisMonth)}
            isCurrency
            trendPct={kpis.totalSalesTrend.pct}
            trendUp={kpis.totalSalesTrend.up}
            icon={ShoppingCart}
            accent="var(--brand-orange)"
            sparkValues={revenueSeries.length > 1 ? revenueSeries : [0, 0]}
          />
        </DashWidget>
        <DashWidget col={3} row={2}>
          <KpiCard
            locale={locale}
            label="Total Invoices"
            value={String(kpis.totalInvoices)}
            trendPct={kpis.totalInvoicesTrend.pct}
            trendUp={kpis.totalInvoicesTrend.up}
            icon={FileText}
            accent="var(--accent-purple)"
            sparkValues={revenueSeries.length > 1 ? revenueSeries : [0, 0]}
          />
        </DashWidget>
        <DashWidget col={3} row={2}>
          <KpiCard
            locale={locale}
            label="Total Receivables"
            value={fmt(kpis.totalReceivables)}
            isCurrency
            trendPct="0%"
            trendUp
            icon={Wallet}
            accent="var(--accent-green)"
            sparkValues={revenueSeries.length > 1 ? revenueSeries : [0, 0]}
          />
        </DashWidget>
        <DashWidget col={3} row={2}>
          <KpiCard
            locale={locale}
            label="Total Payables"
            value={fmt(kpis.totalPayables)}
            isCurrency
            trendPct="0%"
            trendUp={false}
            icon={CreditCard}
            accent="var(--accent-red)"
            sparkValues={[0, 0]}
          />
        </DashWidget>

        <DashWidget col={8} row={5}>
          <div className="card fin-card" style={{ display: "grid", gridTemplateColumns: "1.9fr 1.1fr", gap: 24 }}>
            <div>
              <div className="fin-head">
                <h4 style={{ fontSize: 14, fontWeight: 700 }}>{t(locale, "Financial Overview")}</h4>
                <div className="select-pill" style={{ pointerEvents: "none" }}>
                  {t(locale, "This Month")}
                </div>
              </div>
              <div className="fin-profit-label">{t(locale, "Total Profit (This Month)")}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                <div className="fin-profit-value">
                  <Money amount={totalProfit} />
                </div>
              </div>
              <div className="fin-legend" style={{ marginTop: 14 }}>
                <span>
                  <span className="dot" style={{ background: "var(--brand-orange)" }} />
                  {t(locale, "Revenue")}
                </span>
                <span>
                  <span className="dot" style={{ background: "var(--chart-navy)" }} />
                  {t(locale, "Expenses")}
                </span>
              </div>
              <div style={{ marginTop: 8 }}>
                <ComboChart revenue={revenueSeries.length > 1 ? revenueSeries : [0, 0]} expenses={expenseSeries.length > 1 ? expenseSeries : [0, 0]} labels={revenueLabels.length > 1 ? revenueLabels : ["", ""]} />
              </div>
            </div>
            <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 24, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, color: "var(--ink-muted)", marginBottom: 10 }}>{t(locale, "Profit Margin")}</div>
              <Donut
                segments={[
                  { value: profitMarginPct, color: "var(--brand-orange)" },
                  { value: 100 - profitMarginPct, color: "var(--chart-navy)" },
                ]}
                size={150}
                thickness={17}
                centerLabel={t(locale, "Profit Margin")}
                centerValue={`${profitMarginPct.toFixed(0)}%`}
              />
              <div style={{ width: "100%", marginTop: 16 }}>
                <div className="donut-legend-row">
                  <span className="lbl">
                    <span className="dot" style={{ background: "var(--brand-orange)" }} />
                    {t(locale, "Total Revenue")}
                  </span>
                  <span className="val">
                    <Money amount={kpis.totalSalesThisMonth} />
                  </span>
                </div>
                <div className="donut-legend-row">
                  <span className="lbl">
                    <span className="dot" style={{ background: "var(--chart-navy)" }} />
                    {t(locale, "Total Expenses")}
                  </span>
                  <span className="val">
                    <Money amount={0} />
                  </span>
                </div>
                <div className="donut-legend-row" style={{ borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 10 }}>
                  <span className="lbl" style={{ fontWeight: 600, color: "var(--ink)" }}>
                    {t(locale, "Total Profit")}
                  </span>
                  <span className="val" style={{ color: "var(--accent-green)" }}>
                    <Money amount={totalProfit} />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </DashWidget>

        <DashWidget col={4} row={4}>
          <div className="card">
            <div className="side-panel-head">
              <h4>{t(locale, "Quick Actions")}</h4>
            </div>
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

        <DashWidget col={4} row={5}>
          <div className="card">
            <div className="side-panel-head">
              <h4>{t(locale, "Recent Activities")}</h4>
            </div>
            <div style={{ padding: "6px 20px 8px" }}>
              {recentActivity.length === 0 && <p className="text-[12px] text-ink-faint py-4">{t(locale, "No activity yet.")}</p>}
              {recentActivity.map((a, i) => (
                <div className="activity-row" key={i}>
                  <div
                    className="activity-icon"
                    style={{
                      background: a.kind === "invoice" ? "var(--accent-orange-bg)" : "var(--accent-purple-bg)",
                      color: a.kind === "invoice" ? "var(--brand-orange)" : "var(--accent-purple)",
                    }}
                  >
                    {a.kind === "invoice" ? <FileText className="size-3.5" /> : <FileSignature className="size-3.5" />}
                  </div>
                  <div>
                    <div className="activity-text">
                      {a.kind === "invoice" ? t(locale, "Invoice created") : t(locale, "Quotation created")}: {a.label}
                    </div>
                    <div className="activity-time">{a.time.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")}</div>
                  </div>
                  <div className="activity-chev">
                    <ChevronRight className="size-3.5" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DashWidget>

        <DashWidget col={3} row={3}>
          <div className="card bottom-card">
            <h4>{t(locale, "Cash Flow (This Month)")}</h4>
            <div className="bc-stat-row">
              <span className="lbl">{t(locale, "Cash Inflow")}</span>
              <span className="val" style={{ color: "var(--accent-green)" }}>
                <Money amount={cashFlow.inflow} />
              </span>
            </div>
            <div className="bc-stat-row">
              <span className="lbl">{t(locale, "Cash Outflow")}</span>
              <span className="val" style={{ color: "var(--accent-red)" }}>
                <Money amount={cashFlow.outflow} />
              </span>
            </div>
            <div className="bc-stat-row">
              <span className="lbl">{t(locale, "Net Cash Flow")}</span>
              <span className="val">
                <Money amount={cashFlow.net} />
              </span>
            </div>
            <div style={{ marginTop: 12 }}>
              <Sparkline values={[cashFlow.inflow || 1, cashFlow.outflow || 1, Math.abs(cashFlow.net) || 1]} color="var(--accent-green)" w={180} h={46} />
            </div>
          </div>
        </DashWidget>

        <DashWidget col={3} row={4}>
          <div className="card bottom-card" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <h4 style={{ alignSelf: "flex-start" }}>{t(locale, "Invoices Overview")}</h4>
            <Donut
              segments={
                invoicesOverview.total > 0
                  ? [
                      { value: invoicesOverview.paid, color: "var(--accent-green)" },
                      { value: invoicesOverview.partial, color: "var(--accent-purple)" },
                      { value: invoicesOverview.pending, color: "var(--brand-orange)" },
                      { value: invoicesOverview.overdue, color: "var(--accent-red)" },
                    ]
                  : [{ value: 1, color: "var(--line)" }]
              }
              size={110}
              thickness={13}
              centerLabel={t(locale, "Total")}
              centerValue={String(invoicesOverview.total)}
            />
            <div style={{ width: "100%", marginTop: 10 }}>
              <div className="bc-stat-row">
                <span className="lbl">
                  <span className="dot" style={{ background: "var(--accent-green)" }} />
                  {t(locale, "Paid")}
                </span>
                <span className="val">
                  {invoicesOverview.paid} ({invPct(invoicesOverview.paid)}%)
                </span>
              </div>
              <div className="bc-stat-row">
                <span className="lbl">
                  <span className="dot" style={{ background: "var(--accent-purple)" }} />
                  {t(locale, "Partial")}
                </span>
                <span className="val">
                  {invoicesOverview.partial} ({invPct(invoicesOverview.partial)}%)
                </span>
              </div>
              <div className="bc-stat-row">
                <span className="lbl">
                  <span className="dot" style={{ background: "var(--brand-orange)" }} />
                  {t(locale, "Pending")}
                </span>
                <span className="val">
                  {invoicesOverview.pending} ({invPct(invoicesOverview.pending)}%)
                </span>
              </div>
              <div className="bc-stat-row">
                <span className="lbl">
                  <span className="dot" style={{ background: "var(--accent-red)" }} />
                  {t(locale, "Overdue")}
                </span>
                <span className="val">
                  {invoicesOverview.overdue} ({invPct(invoicesOverview.overdue)}%)
                </span>
              </div>
            </div>
            <Link href="/sales/invoices" className="bc-link">
              {t(locale, "View All Invoices")} <ChevronRight className="size-3" style={{ color: "var(--brand-orange)" }} />
            </Link>
          </div>
        </DashWidget>

        <DashWidget col={3} row={4}>
          <div className="card bottom-card">
            <h4>{t(locale, "Project Overview")}</h4>
            <div className="bc-bignum">{projectsOverview.active}</div>
            <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 10 }}>{t(locale, "Active Projects")}</div>
            <div className="bc-stat-row">
              <span className="lbl">{t(locale, "Completed")}</span>
              <span className="val">{projectsOverview.completed}</span>
            </div>
            <div className="bc-stat-row">
              <span className="lbl">{t(locale, "In Progress")}</span>
              <span className="val">{projectsOverview.active}</span>
            </div>
            <div className="bc-stat-row">
              <span className="lbl">{t(locale, "On Hold")}</span>
              <span className="val">{projectsOverview.onHold}</span>
            </div>
            <div className="bc-stat-row">
              <span className="lbl">{t(locale, "Not Started")}</span>
              <span className="val">{projectsOverview.planned}</span>
            </div>
            <Link href="/projects" className="bc-link">
              {t(locale, "Go to Projects")} <ChevronRight className="size-3" style={{ color: "var(--brand-orange)" }} />
            </Link>
          </div>
        </DashWidget>

        <DashWidget col={3} row={3}>
          <div className="card bottom-card" style={{ opacity: 0.7 }}>
            <h4>{t(locale, "HR Snapshot")}</h4>
            <div className="bc-bignum">0</div>
            <div style={{ fontSize: 11, color: "var(--ink-faint)", marginBottom: 10 }}>{t(locale, "Total Employees")}</div>
            <p className="text-[11px] text-ink-faint">{t(locale, "HR module not yet available.")}</p>
            <div className="bc-link" style={{ pointerEvents: "none" }}>
              {t(locale, "Go to HRM")} <ChevronRight className="size-3" style={{ color: "var(--brand-orange)" }} />
            </div>
          </div>
        </DashWidget>
      </div>

      <div className="feature-strip">
        <div className="feature-card">
          <div className="f-icon">
            <Shield className="size-4.5" />
          </div>
          <div>
            <div className="f-title">{t(locale, "ZATCA Compliant")}</div>
            <div className="f-sub">{t(locale, "E-invoicing ready")}</div>
          </div>
        </div>
        <div className="feature-card">
          <div className="f-icon">
            <Lock className="size-4.5" />
          </div>
          <div>
            <div className="f-title">{t(locale, "Secure & Reliable")}</div>
            <div className="f-sub">{t(locale, "Your data is encrypted")}</div>
          </div>
        </div>
        <div className="feature-card">
          <div className="f-icon">
            <TrendingUp className="size-4.5" />
          </div>
          <div>
            <div className="f-title">{t(locale, "Real-time Insights")}</div>
            <div className="f-sub">{t(locale, "Data driven decisions")}</div>
          </div>
        </div>
        <div className="feature-card">
          <div className="f-icon">
            <RefreshCw className="size-4.5" />
          </div>
          <div>
            <div className="f-title">{t(locale, "Automated Processes")}</div>
            <div className="f-sub">{t(locale, "Save time, work smarter")}</div>
          </div>
        </div>
        <div className="feature-card highlight">
          <div className="f-icon">
            <Link2 className="size-4.5" />
          </div>
          <div>
            <div className="f-title">
              {t(locale, "CRM Integration")} <span className="coming-soon-pill">{t(locale, "Coming Soon")}</span>
            </div>
            <div className="f-sub">{t(locale, "We will connect our existing CRM")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
