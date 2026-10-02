/**
 * DEV-UI-01.5 — list / data-table screenshot states, captured by `run.mjs capture-lists`.
 *
 * The 256-state matrix shows five lists closed and unfiltered. These states add what the list
 * workspace actually does: search, no-results, filters (open and applied), saved views (menu and the
 * manage dialog), the row menu and its convert submenu, the master-data filter panel and record menu,
 * empty modules, the sticky action column scrolled at 390px, and representative finance / HR tables.
 * Same frozen clock, seed and TEST-ONLY database; viewport screenshots (overlays are fixed).
 * Configure Columns is a document-editor feature (DEV-UI-01.6) and is deliberately not here.
 *
 * `action` names a step in run.mjs (LIST_ACTIONS). One saved view ("Sent since May") is added to the
 * run's TEST-ONLY copy so the Views menu and the manage dialog have content.
 */
import { VIEWPORTS } from "./config.mjs";

const vp = (name) => VIEWPORTS.find((v) => v.name === name);
const ALLW = ["1440", "1024", "768", "390"];
const BOTH = ["en", "ar"];

/** [id, path, action, locales, themes, viewports] */
const GROUPS = [
  // Document workspace (Invoices)
  ["inv-normal", "/sales/invoices", null, BOTH, ["light", "dark"], ALLW],
  ["inv-search", "/sales/invoices", "search", BOTH, ["light"], ALLW],
  ["inv-no-results", "/sales/invoices", "no-results", BOTH, ["light"], ALLW],
  ["inv-filters-open", "/sales/invoices", "filters-open", BOTH, ["light"], ALLW],
  ["inv-filters-active", "/sales/invoices", "filters-active", BOTH, ["light"], ALLW],
  ["inv-views-menu", "/sales/invoices", "views-menu", BOTH, ["light"], ALLW],
  ["inv-views-manage", "/sales/invoices", "views-manage", BOTH, ["light"], ALLW],
  ["inv-row-menu", "/sales/invoices", "row-menu", BOTH, ["light", "dark"], ALLW],
  ["inv-convert", "/sales/invoices", "convert", BOTH, ["light"], ALLW],
  ["inv-sticky-scrolled", "/sales/invoices", "scroll-end", BOTH, ["light"], ["390"]],
  // Master data
  ["clients-normal", "/clients", null, BOTH, ["light"], ALLW],
  ["clients-filter-panel", "/clients", "filter-panel", BOTH, ["light"], ALLW],
  ["clients-record-menu", "/clients", "record-menu", BOTH, ["light"], ALLW],
  ["products-normal", "/inventory/products", null, BOTH, ["light"], ALLW],
  ["products-filter-panel", "/inventory/products", "filter-panel", BOTH, ["light"], ALLW],
  ["products-record-menu", "/inventory/products", "record-menu", BOTH, ["light"], ALLW],
  ["vendors-normal", "/purchasing/vendors", null, BOTH, ["light"], ALLW],
  ["vendors-filter-panel", "/purchasing/vendors", "filter-panel", BOTH, ["light"], ALLW],
  ["vendors-record-menu", "/purchasing/vendors", "record-menu", BOTH, ["light"], ALLW],
  // Representative tables
  ["payments", "/finance/payments", null, BOTH, ["light"], ALLW],
  ["projects", "/projects", null, BOTH, ["light"], ALLW],
  ["attendance", "/hr/attendance", null, BOTH, ["light"], ALLW],
  ["journal", "/finance/journal", "scroll-table", BOTH, ["light"], ALLW],
  // Empty states
  ["orders-empty", "/sales/orders", null, BOTH, ["light"], ALLW],
  ["recycle-bin-empty", "/recycle-bin", null, BOTH, ["light"], ALLW],
];

export function listMatrix() {
  const out = [];
  for (const [group, path, action, locales, themes, viewports] of GROUPS)
    for (const locale of locales)
      for (const theme of themes)
        for (const name of viewports)
          out.push({ id: `list-${group}__${locale}__${theme}__${name}`, route: { id: group, path, area: "Lists (DEV-UI-01.5)" }, locale, theme, viewport: vp(name), action });
  return out;
}

export const SAVED_VIEW_FIXTURE = {
  module: "sales_invoice",
  name: "Sent since May",
  config: { search: "", status: "sent", dateFrom: "2026-05-01", dateTo: "", party: "", archived: "all" },
};
