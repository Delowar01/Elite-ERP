// Batch E — dashboard layout customization. Declares the customizable widgets (stable keys +
// i18n labels + default order) and merges a user's saved layout with the canonical list so
// hidden/reordered widgets are honored and any newly-added widget still shows up by default.
// Pure module — imported by both the server page and the client Customize dialog.

export type DashboardWidgetKey =
  | "kpi_sales"
  | "kpi_invoices"
  | "kpi_receivables"
  | "kpi_payables"
  | "financial_overview"
  | "quick_actions"
  | "recent_activities"
  | "cash_flow"
  | "invoices_overview"
  | "project_overview"
  | "hr_snapshot"
  | "feature_strip";

export type DashboardLayoutItem = { key: DashboardWidgetKey; visible: boolean };

export const DASHBOARD_WIDGETS: { key: DashboardWidgetKey; label: string }[] = [
  { key: "kpi_sales", label: "Total Sales (This Month)" },
  { key: "kpi_invoices", label: "Total Invoices" },
  { key: "kpi_receivables", label: "Total Receivables" },
  { key: "kpi_payables", label: "Total Payables" },
  { key: "financial_overview", label: "Financial Overview" },
  { key: "quick_actions", label: "Quick Actions" },
  { key: "recent_activities", label: "Recent Activities" },
  { key: "cash_flow", label: "Cash Flow (This Month)" },
  { key: "invoices_overview", label: "Invoices Overview" },
  { key: "project_overview", label: "Project Overview" },
  { key: "hr_snapshot", label: "HR Snapshot" },
  { key: "feature_strip", label: "Feature Highlights" },
];

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayoutItem[] = DASHBOARD_WIDGETS.map((w) => ({ key: w.key, visible: true }));

const VALID = new Set(DASHBOARD_WIDGETS.map((w) => w.key));

// Normalize an unknown stored value into a full, ordered layout: keep the saved order/visibility
// for known keys, drop unknown ones, then append any canonical widget the saved layout is missing
// (default-visible) so the list is always complete.
export function normalizeLayout(raw: unknown): DashboardLayoutItem[] {
  const out: DashboardLayoutItem[] = [];
  const seen = new Set<DashboardWidgetKey>();
  if (Array.isArray(raw)) {
    for (const it of raw) {
      const key = (it as { key?: string })?.key as DashboardWidgetKey | undefined;
      if (key && VALID.has(key) && !seen.has(key)) {
        out.push({ key, visible: (it as { visible?: unknown }).visible !== false });
        seen.add(key);
      }
    }
  }
  for (const w of DASHBOARD_WIDGETS) if (!seen.has(w.key)) out.push({ key: w.key, visible: true });
  return out;
}

export function labelFor(key: DashboardWidgetKey): string {
  return DASHBOARD_WIDGETS.find((w) => w.key === key)?.label ?? key;
}
