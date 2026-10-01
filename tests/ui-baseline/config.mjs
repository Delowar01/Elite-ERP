/**
 * DEV-UI-01.0 — the visual-baseline matrix. Changing anything here invalidates the committed
 * baseline: re-capture, re-run twice, and review the diff before committing new images.
 */

/** Every server-rendered and browser-rendered "now" is this instant (a Monday, 12:00 Riyadh). */
export const FROZEN_NOW = "2026-06-15T09:00:00.000Z";

export const OWNER_EMAIL = "owner@visual-baseline.test";

/** Dedicated port so the baseline server can never be mistaken for the verify:browser one (3000). */
export const PORT = 3100;
export const BASE = `http://127.0.0.1:${PORT}`;

export const LOCALES = ["en", "ar"];
export const THEMES = ["light", "dark"];
export const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
  { name: "768", width: 768, height: 1024 },
  { name: "390", width: 390, height: 844 },
];

/**
 * 16 representative routes. Ids in paths are deterministic: the seed runs on an empty database,
 * so customer 1, invoice 1 and project 1 are always the same synthetic rows.
 *
 * `auth: false` routes are captured without a session.
 */
export const ROUTES = [
  { id: "login", path: "/login", auth: false, area: "Authentication" },
  { id: "dashboard", path: "/dashboard", area: "Dashboard" },
  { id: "sales-invoices-list", path: "/sales/invoices", area: "Document list (workspace toolbar)" },
  { id: "sales-quotations-list", path: "/sales/quotations", area: "Document list (workspace toolbar)" },
  { id: "sales-invoice-new", path: "/sales/invoices/new", area: "Financial document editor (blank)" },
  // Invoice 6 is the seeded DRAFT (INV-0006). A paid invoice (e.g. 1) is read-only and redirects to its detail page.
  { id: "sales-invoice-edit", path: "/sales/invoices/6/edit", area: "Financial document editor (populated draft)" },
  { id: "sales-invoice-detail", path: "/sales/invoices/1", area: "Document detail" },
  { id: "clients-list", path: "/clients", area: "Master data list" },
  { id: "client-detail", path: "/clients/1", area: "Entity detail" },
  { id: "inventory-products", path: "/inventory/products", area: "Master data list" },
  { id: "projects-list", path: "/projects", area: "Projects (legacy toolbar)" },
  { id: "project-detail", path: "/projects/1", area: "Project detail (kanban)" },
  { id: "finance-reports", path: "/finance/reports", area: "Financial reports" },
  { id: "finance-statements", path: "/finance/statements", area: "Statements" },
  { id: "hr-employees", path: "/hr/employees", area: "HR" },
  { id: "settings-organization", path: "/settings/organization", area: "Settings" },
];

export const stateId = (route, locale, theme, viewport) => `${route.id}__${locale}__${theme}__${viewport.name}`;

export function matrix() {
  const out = [];
  for (const route of ROUTES)
    for (const locale of LOCALES)
      for (const theme of THEMES)
        for (const viewport of VIEWPORTS) out.push({ route, locale, theme, viewport, id: stateId(route, locale, theme, viewport) });
  return out;
}
