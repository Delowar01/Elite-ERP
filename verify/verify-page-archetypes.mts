/**
 * DEV-UI-01.7 C0 — page-archetype foundations and guardrails. Run via `npm run verify:page-archetypes`
 * (part of verify:static).
 *
 * C0 adds three small primitives (SectionHeader, EmptyState, formatDisplayDate) and two additive
 * props (CardTitle `as`, StatRow `columns` / ReactNode values), migrates nothing, and records the
 * baseline that every later 01.7 stage is held to. What it pins comes from main 1bfdbbf and lives
 * in verify/page-archetype-pins.json:
 *
 *   1. routes        — every page and route handler, the layouts, and the 36 DEV-UI-01.7 pages
 *   2. guards        — each 01.7 page's requireSession / requireRole / redirect / notFound calls and
 *                      the role expressions it hands on (isOwner, canDecide, …); the layouts' guards
 *   3. data          — each 01.7 page's server data section: its statements other than the markup
 *                      (the JSX it returns or builds) and other than display-date formatting, which
 *                      later stages move onto formatDisplayDate — so composition work can change the
 *                      markup freely, and a query, a guard or a computation cannot drift with it
 *   4. business      — business, query, permission, export, DB, currency / PDF / print files and the
 *                      01.7 areas' server actions, byte-identical
 *   5. prerequisites — the P0 / P0.1 / P0.2 contracts, pinned as sections (not whole files, since
 *                      their files change later in 01.7), and their verifiers still wired
 *   6. primitives    — the locked APIs and markup of the five C0 changes, rendered; formatDisplayDate
 *                      in 18 host time-zone / locale combinations; the consumer inventory (no
 *                      consumer migrated in C0)
 *   7. creep         — none of the rejected page-level abstractions exist; the shared primitives
 *                      know nothing of routes or domains and use no physical left / right
 *   8. actions       — the static half of the action inventory: each 01.7 page's link targets and
 *                      server actions, through its page-local imports
 *
 * Legacy defects that later stages fix — h3 page titles, overflow, old empty states, inline grids,
 * the kanban, Settings direction — are deliberately NOT failures here. The runtime half
 * (verify/verify-page-archetypes-runtime.mjs) records them as a baseline that may only improve.
 *
 * C1 (master data + entity detail) adds group 9 and turns the C0 "no consumer yet" checks into what
 * C1 migrated: PageHeader evolved in place (one <h1>, meta before actions, a row that wraps; D-9
 * narrows the layout pin to byte pins of every other layout file), and the 12 master-data / entity-
 * detail pages on it — responsive detail grids, h2 section headings (CardTitle as="h2",
 * SectionHeader), their copy through t(), EmptyState in the three master-data recycle bins. Its
 * pins re-baseline: two data statements (New Vendor / New Product read the UI locale) and the
 * consumer inventory; nothing else.
 *
 * C3 (Projects + kanban) adds group 11: the list, New Project and the project detail on PageHeader; the
 * detail's h2 / h3 outline (Cost & Profitability › Revenue / Costs, Tasks › the four status columns,
 * Time logged this week, Linked Documents); its two KPI rows on StatRow (columns 2 and 3) and the cost
 * breakdown on its own CSS rule; task cards as real buttons with a full accessible name, the focus
 * ring and focus returned to the opener; EmptyState for its three empty sections; logical numeric
 * columns; D-2 held as it is (every figure, the health badge); and the proof that nothing else moved —
 * each Projects file is C2's plus C3's own hunks. Its pins re-baseline the consumer inventory only.
 *
 * C4 (finance + reports) adds group 12: the seven finance routes on PageHeader (Financial Reports with
 * its three exports as the actions, still out of print; Statements with its description; Ledger, Chart
 * of Accounts, Payment Records, New Journal Entry, Bank Accounts); the report picker as pressed toggle
 * buttons, the report search named, the selected report and the selected ledger account as h2s, the
 * journal and bank secondary sections as h2s; Client / Vendor links marking the current page; EmptyState
 * for the finance empty messages; .acct-grid on a minmax(0, 1fr) ledger track; D-2 (Gross Profit) held;
 * every report body, date preset, export link and figure C3's — each finance file is C3's plus C4's own
 * hunks — and the frozen P0 hydration verifiers byte-identical. Its pins re-baseline the consumer
 * inventory only.
 *
 * C6 (the Dashboard) adds group 14: a PageHeader "Dashboard" with the range selector and Customize Layout
 * as its actions; the seven widget titles as h2s (their CSS twins carry the h4 rules' declarations); D-1 —
 * no profit, margin or expenses, Financial Overview the real revenue total and the revenue chart alone
 * (ComboChart's expenses optional); D-4 — the four marketing cards gone, the strip the ZATCA Phase 1 card
 * alone and only where the profile enables it; D-5 — a trend or sparkline only where a real one exists
 * (KpiCard's optional props), Cash Flow without its pseudo-series; the activity time on formatDisplayDate;
 * DashWidget's size as custom properties the grid reads (12 tracks → 2 at ≤1100px → 1 at ≤640px, natural
 * rows below 1100px); the range labels' Arabic in Western digits — and the proof that nothing else moved:
 * each Dashboard file is C5's plus C6's own hunks, the stylesheet and the dictionary C5's once C6's hunks
 * are undone (groups 11 – 13 undo them first), the queries, layout registry, ranges, preferences and
 * Customize dialog byte-identical — and the one verifier maintenance its review approved: the compliance-claims
 * suite's Dashboard check now requires the D-4-removed Secure & Reliable copy gone (otherwise C5's to the byte).
 * Its pins re-baseline the consumer inventory and the Dashboard's data section (the four D-1 / D-5 statements
 * removed, revenueSpark in spark's place) only.
 *
 * C7 (document and app-state heading semantics, D-3) adds group 15: tags only, pixel for pixel — each of the eight
 * document families' list title, detail document number (className mono) and editor title from h3 to the page's one
 * h1, the shared e-invoice panel's title from h4 to h2, and the error, not-found and document Recycle Bin titles from
 * h3 to h1; four exact CSS twins (.main-head h1, .inv-head h1, .einvoice-panel h2, .doc-titlebar h1) carry the h3 /
 * h4 rules' declarations, which stay. Every C7 file is C6's plus those hunks (group 10 undoes the eight lists' first),
 * the stylesheet C6's once the twins are undone (groups 11, 12 and 14 undo them first), no PageHeader on any C7
 * surface, the typography and document-form verifiers' deliberate C7 updates, and everything C6 froze still C6's.
 * Its pins change nothing.
 *
 * C8 (the remediation) adds group 16. D-2 — the P0 decision "hide Profit / Margin until COGS is trustworthy", held
 * unimplemented through C3 – C7 — applied as presentation only: the project's Cost & Profitability shows four factual
 * figures (StatRow columns={4}: Sales Value, Invoiced, Collected, Total Cost) with no Actual Profit, Profit Margin,
 * project_health badge or health colour; the P&L screen shows no Gross Profit card or row. Every other application file
 * is C7's to the byte; the engines, the status registry, the dictionary and the P&L export route (which still lists Gross
 * Profit — an open decision) untouched. Groups 6, 11 and 12 undo the seven D-2 hunks (D2_EDITS) before holding these two
 * files to C7's / C3's / C4's code, so every older pin keeps its strength; their "D-2 held" checks are replaced by checks
 * that require the suppression. And the DataTable runtime suite's test-only synchronization (the Filters popover's Escape
 * contract — closed and focus back on its trigger — waited for and asserted before Views is used) with its failure
 * diagnostics: group 15 undoes those hunks (DT_EDITS) before holding the suite at C6's bytes. Its pins change nothing.
 *
 * C8 final (the product owner's financial display policy, on the approved remediation c47c65a) adds group 17. The P&L
 * shows Revenue as its one summary card and no Gross Profit, Operating Profit or Net Profit card or row, with a localized
 * notice; its CSV / Excel / PDF export the same, the notice in the exporter's header block; the Balance Sheet keeps its
 * Current-period Profit / (Loss) line and amount, marked Preliminary, with a disclosure on screen, in print and in its
 * exports; the project section is Project Revenue & Costs; four dictionary entries; and the reports' print styles show the
 * report area again (the shell's preview-print rule hid it — a printed report was blank). Every other group reads these
 * four files through `read` with their 16 FIN_EDITS hunks undone — the remediation's bytes — so every older pin, the P&L
 * export route's business pin and the dictionary's included, keeps its strength; group 17 proves those hunks are the
 * files' only change and holds the files as they are to the policy. Its pins change nothing.
 *
 * Integration with main (after C8 final) adds group 18. Main moved on beneath the branch, and one approved main change
 * lands in a file this verifier freezes: PR #7 (32702c3) has the PDF route render its print page from a trusted internal
 * origin, PDF_RENDER_ORIGIN (http://127.0.0.1:3200 on the VPS), instead of the https://localhost:3200 that NextRequest
 * reports behind a TLS-terminating proxy. Every byte-identity hash — the business pins, the pinned directories, groups 16
 * and 17's src trees — reads that file through `frozen`, its MAIN_EDITS hunk undone (1bfdbbf's bytes), so every pin keeps
 * its strength; content checks read it as it is. Group 18 proves the hunk is the route's only change and that the fix is
 * in place. Its pins change nothing.
 *
 * ACC-01 (weighted-average inventory costing and COGS, after the integration) adds group 19. ACC-01 changes business logic
 * by design — the invoice, receipt and return postings, the product actions, the schema, the dictionary, two source-type
 * labels — in files this verifier freezes. Its hunks are recorded byte for byte in verify/acc01-approved-delta.mts:
 * `rawRead` (and so `read`, `parse` and `frozen`) gives every older group those files with the hunks undone — main's
 * bytes — and `walk` leaves out the four files ACC-01 added under src/, so every pin keeps its strength. Group 19 proves
 * the hunks are each file's only change and the added files are as recorded. Its pins change nothing.
 *
 * `--write-pins` recomputes verify/page-archetype-pins.json from the working tree. Only a stage that
 * deliberately re-baselines may run it, and the diff of that file is what its review reads.
 * docs/ui/dev-ui-01-7/c0-foundations-and-guardrails.md, docs/ui/dev-ui-01-7/c1-master-data-and-detail.md,
 * docs/ui/dev-ui-01-7/c3-projects-and-kanban.md, docs/ui/dev-ui-01-7/c4-finance-and-reports.md,
 * docs/ui/dev-ui-01-7/c6-dashboard-archetype.md, docs/ui/dev-ui-01-7/c7-heading-semantics.md,
 * docs/ui/dev-ui-01-7/c8-remediation.md, docs/ui/dev-ui-01-7/c8-final-release-gate.md
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";
import { createElement as h } from "react";
import { ACC01_BASE, ACC01_EDITS, ACC01_NEW, acc01Drift, undoAcc01 } from "./acc01-approved-delta.mjs";
import { renderToStaticMarkup } from "react-dom/server";

const ROOT = path.resolve(import.meta.dirname, "..");
const PINS_FILE = "verify/page-archetype-pins.json";
const WRITE = process.argv.includes("--write-pins");
// ACC-01: every group reads the files ACC-01 changed as main left them — its recorded hunks undone (group 19 proves
// they are each file's only change); `actualRead` is the file as it is on disk.
const actualRead = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const rawRead = (p: string) => undoAcc01(p, actualRead(p));
// DEV-UI-01.7 C8 final: every group but 17 reads the four files the final batch changed as the approved remediation
// (c47c65a) left them — their FIN_EDITS hunks undone — so each older pin keeps its strength; group 17 proves those hunks
// are each file's only change and holds the files as they are to the product owner's financial display policy.
const read = (p: string) => undoFin(p, rawRead(p));
const h16 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const A = "src/app/(app)/";
// DEV-UI-01.7 C1: the 12 master-data and entity-detail pages, and the shared header they sit on.
const C1_PAGES = [
  "clients", "clients/[id]", "clients/new", "clients/recycle-bin", "purchasing/vendors", "purchasing/vendors/[id]", "purchasing/vendors/new", "purchasing/vendors/recycle-bin",
  "inventory/products", "inventory/products/[id]", "inventory/products/new", "inventory/products/recycle-bin",
].map((p) => `${A}${p}/page.tsx`);
const C1_DETAIL = C1_PAGES.filter((f) => f.includes("/[id]/"));
const C1_BINS = C1_PAGES.filter((f) => f.includes("/recycle-bin/"));
const PHF = "src/components/layout/page-header.tsx";
// DEV-UI-01.7 C2: the seven HR routes, by the files that render them (a route's client component holds
// its markup where it has one).
const HR = `${A}hr/`;
const C2_ROUTES: Record<string, string[]> = {
  employees: [`${HR}employees/page.tsx`, `${HR}employees/employees-client.tsx`],
  "employees/new": [`${HR}employees/new/page.tsx`],
  "employees/[id]": [`${HR}employees/[id]/page.tsx`],
  departments: [`${HR}departments/page.tsx`],
  attendance: [`${HR}attendance/page.tsx`],
  leave: [`${HR}leave/page.tsx`, `${HR}leave/leave-client.tsx`],
  payroll: [`${HR}payroll/page.tsx`, `${HR}payroll/payroll-client.tsx`],
};
const C2_FILES = Object.values(C2_ROUTES).flat();
/** The file holding each HR route's PageHeader. */
const C2_HEADERS = [
  `${HR}employees/employees-client.tsx`, `${HR}employees/new/page.tsx`, `${HR}employees/[id]/page.tsx`, `${HR}departments/page.tsx`,
  `${HR}attendance/page.tsx`, `${HR}leave/leave-client.tsx`, `${HR}payroll/page.tsx`,
];
const C2_EMPTY = [`${HR}employees/employees-client.tsx`, `${HR}departments/page.tsx`, `${HR}attendance/page.tsx`, `${HR}leave/leave-client.tsx`, `${HR}payroll/page.tsx`];
const C2_STATROWS = [`${HR}employees/employees-client.tsx`, `${HR}payroll/page.tsx`];
// DEV-UI-01.7 C3: the Projects family — the list, New Project, and the project detail with its cost
// control and kanban board.
const PR = `${A}projects/`;
const C3_LIST = `${PR}projects-list-client.tsx`;
const C3_NEW = `${PR}new/page.tsx`;
const C3_DETAIL = `${PR}[id]/page.tsx`;
const C3_COST = `${PR}[id]/cost-control.tsx`;
const C3_KANBAN = `${PR}[id]/kanban-board.tsx`;
const C3_FILES = [C3_LIST, C3_NEW, C3_DETAIL, C3_COST, C3_KANBAN];
/** The file holding each Projects route's PageHeader. */
const C3_HEADERS = [C3_LIST, C3_NEW, C3_DETAIL];
/** The project detail's two KPI rows: the summary (columns 2) and Cost & Profitability (columns 3). */
const C3_STATROWS = [C3_COST, C3_DETAIL];
// DEV-UI-01.7 C4: the seven finance routes, by the files that render their markup — the reports
// workspace, the pages, the ledger view Ledger and Chart of Accounts share, the payments list.
const FN = `${A}finance/`;
const C4_REPORTS = `${FN}reports/reports-workspace.tsx`;
const C4_STATEMENTS = `${FN}statements/page.tsx`;
const C4_LEDGER = `${FN}ledger/page.tsx`;
const C4_COA = `${FN}chart-of-accounts/page.tsx`;
const C4_ACCOUNT_VIEW = `${FN}_shared/account-ledger-view.tsx`;
const C4_PAYMENTS = `${FN}payments/payments-list-client.tsx`;
const C4_JOURNAL = `${FN}journal/page.tsx`;
const C4_BANK = `${FN}bank-accounts/page.tsx`;
const C4_FILES = [C4_REPORTS, C4_STATEMENTS, C4_LEDGER, C4_COA, C4_ACCOUNT_VIEW, C4_PAYMENTS, C4_JOURNAL, C4_BANK];
/** The file holding each finance route's PageHeader. */
const C4_HEADERS = [C4_REPORTS, C4_STATEMENTS, C4_LEDGER, C4_COA, C4_PAYMENTS, C4_JOURNAL, C4_BANK];
/** C4's two stylesheet edits, [C3 rule, C4 rule]: the ledger track and its ≤1100px form on minmax(0, 1fr). */
const C4_CSS_HUNKS: [string, string][] = [
  [".acct-grid { display: grid; grid-template-columns: 280px 1fr; gap: 16px; }", ".acct-grid { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; }"],
  ["@media (max-width: 1100px) { .two-col { grid-template-columns: minmax(0, 1fr); } .acct-grid { grid-template-columns: 1fr; } }",
    "@media (max-width: 1100px) { .two-col { grid-template-columns: minmax(0, 1fr); } .acct-grid { grid-template-columns: minmax(0, 1fr); } }"],
];
// DEV-UI-01.7 C5: the Settings family — the SettingsNav primitive, Business Settings and its panels (Team's
// among them), Presets and its three titled panels, the Security Center, Compliance — by the files that
// render their markup.
const ST = `${A}settings/`;
const C5_NAV = "src/components/ui/settings-nav.tsx";
const C5_ORG = `${ST}organization/page.tsx`;
const C5_COMPANY = `${ST}organization/company-panels.tsx`;
const C5_FINANCE = `${ST}organization/finance-panel.tsx`;
const C5_VAT = `${ST}organization/vat-settings-form.tsx`;
const C5_NUMBERS = `${ST}organization/number-format-form.tsx`;
const C5_ROLES = `${ST}organization/reference-panels.tsx`;
const C5_ZATCA = `${ST}organization/zatca-panel.tsx`;
const C5_TEAM = `${ST}team/team-panel.tsx`;
const C5_PRESETS = `${ST}presets/page.tsx`;
const C5_PRESET_BANK = `${ST}presets/default-bank-accounts-panel.tsx`;
const C5_PRINT = `${ST}presets/print-layout-panel.tsx`;
const C5_SEAL = `${ST}presets/seal-signature-panel.tsx`;
const C5_SECURITY = `${ST}security/security-client.tsx`;
const C5_COMPLIANCE = `${ST}compliance/compliance-client.tsx`;
const C5_FILES = [C5_NAV, C5_ORG, C5_COMPANY, C5_FINANCE, C5_VAT, C5_NUMBERS, C5_ROLES, C5_ZATCA, C5_TEAM, C5_PRESETS, C5_PRESET_BANK, C5_PRINT, C5_SEAL, C5_SECURITY, C5_COMPLIANCE];
/** The file holding each Settings page's PageHeader (/settings/team only redirects). */
const C5_HEADERS = [C5_ORG, C5_PRESETS, C5_SECURITY, C5_COMPLIANCE];
/** The 13 top-level panel titles C5 made h2s: [file, the title's dictionary key]. */
const C5_PANELS: [string, string][] = [
  [C5_COMPANY, "Business Details"], [C5_COMPANY, "Logo"], [C5_COMPANY, "Color Theme"], [C5_FINANCE, "Default Bank Account"], [C5_FINANCE, "Fiscal Year"],
  [C5_VAT, "VAT Configuration"], [C5_NUMBERS, "Number Format"], [C5_TEAM, "Team"], [C5_ROLES, "Roles & Permissions"], [C5_ZATCA, "ZATCA Phase 1"],
  [C5_PRESET_BANK, "Default Bank Accounts"], [C5_PRINT, "Print Layout"], [C5_SEAL, "Seal & Signature"],
];
/**
 * C5's two dictionary additions, byte for byte: the four Settings navigation labels the audit found without
 * Arabic, and the one structural heading Compliance's readiness groups needed. Group 12 undoes them to hold
 * dict.ts at C4's bytes; group 13 proves they are C5's only dictionary change.
 */
const C5_DICT_BLOCKS = [
  '  // DEV-UI-01.7 C5: the four Settings navigation labels that had no Arabic.\n  "Fiscal Year": "السنة المالية",\n  "VAT Configuration": "إعدادات ضريبة القيمة المضافة",\n  Users: "المستخدمون",\n  Integrations: "التكاملات",\n',
  "  // DEV-UI-01.7 C5: the readiness groups' h2 — a structural label, no certification claim.\n  \"Readiness checklist\": \"قائمة التحقق من الجاهزية\",\n",
];
const undoC5Dict = (s: string) => C5_DICT_BLOCKS.reduce((t, b) => t.replace(b, ""), s);
// DEV-UI-01.7 C6: the Dashboard — its page, its toolbar (now the PageHeader's actions), the KPI card and the charts.
const DASH = `${A}dashboard/`;
const C6_PAGE = `${DASH}page.tsx`;
const C6_TOOLBAR = `${DASH}dashboard-toolbar.tsx`;
const C6_KPI = `${DASH}_shared/kpi-card.tsx`;
const C6_CHARTS = `${DASH}_shared/charts.tsx`;
const C6_FILES = [C6_PAGE, C6_TOOLBAR, C6_KPI, C6_CHARTS];
const C6_HEADERS = [C6_PAGE];
/**
 * C6's one dictionary edit, [C5, C6] byte for byte: the Dashboard's two range labels with their number in Western
 * digits — the Arabic wrote "Last 7 Days" / "Last 30 Days" in Arabic-Indic ones, and C6's runtime target is Western
 * digits on every Dashboard state. Groups 12 and 13 undo it to hold dict.ts at C5's bytes; group 14 proves it is
 * C6's only dictionary change.
 */
const C6_DICT_EDIT: [string, string] = [
  '  "Last 7 Days": "آخر ٧ أيام",\n  "Last 30 Days": "آخر ٣٠ يوماً",\n',
  '  "Last 7 Days": "آخر 7 أيام",\n  "Last 30 Days": "آخر 30 يوماً",\n',
];
const undoC6Dict = (s: string) => s.replace(C6_DICT_EDIT[1], () => C6_DICT_EDIT[0]);
/**
 * C6's mockup-parity.css hunks, [C5, C6] — Dashboard selectors only, compared without comments or whitespace. Groups
 * 11 and 12 undo them before holding the stylesheet at C3's / C4's; group 14 proves they are C6's only CSS change.
 */
const C6_CSS_HUNKS: [string, string][] = [
  [".dash-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }", ".dash-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }"],
  [".dash-grid { display: grid; grid-template-columns: repeat(12, 1fr); grid-auto-rows: 86px; gap: 16px; grid-auto-flow: row dense; margin-bottom: 16px; }",
    ".dash-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-rows: 86px; gap: 16px; grid-auto-flow: row dense; margin-bottom: 16px; }"],
  [".dash-widget { position: relative; display: flex; flex-direction: column; min-width: 0; }",
    ".dash-widget { position: relative; display: flex; flex-direction: column; min-width: 0; grid-column: span var(--dash-span); grid-row: span var(--dash-rows); }"],
  [".kpi-spark { margin-top: 10px; margin-left: -4px; }", ".kpi-spark { margin-top: 10px; margin-inline-start: -4px; }"],
  [".fin-legend .dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; margin-right: 5px; }", ".fin-legend .dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; margin-inline-end: 5px; }"],
  [".fin-profit-label { font-size: 12.5px; color: var(--ink-muted); margin-top: 14px; }", ".fin-total-label { font-size: 12.5px; color: var(--ink-muted); margin-top: 14px; }"],
  [".fin-profit-value { font-family: var(--font-display); font-weight: 800; font-size: 25px; margin-top: 4px; }", ".fin-total-value { font-family: var(--font-display); font-weight: 800; font-size: 25px; margin-top: 4px; }"],
  [".donut-legend-row .dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; margin-right: 7px; }",
    ".donut-legend-row .dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; margin-inline-end: 7px; }"],
  [".side-panel-head h4 { font-size: 14px; font-weight: 700; }", ".side-panel-head h2 { font-size: 14px; font-weight: 700; }"],
  [".bottom-card h4 { font-size: 12.5px; font-weight: 700; margin-bottom: 14px; }", ".bottom-card h2 { font-size: 12.5px; font-weight: 700; margin-bottom: 14px; }"],
  [".feature-strip { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }", ".feature-strip { display: flex; flex-wrap: wrap; gap: 12px; }"],
  [".feature-card.highlight { background: var(--accent-orange-bg); border-color: transparent; } .feature-card .f-icon { width: 38px; height: 38px; border-radius: 11px; background: var(--accent-orange-bg); color: var(--brand-orange); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }",
    ".feature-card .f-icon { width: 38px; height: 38px; border-radius: 11px; background: var(--accent-orange-bg); color: var(--brand-orange); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }"],
  [".feature-card.highlight .f-icon { background: var(--surface); } .feature-card .f-title { font-size: 12px; font-weight: 700; display: flex; align-items: center; gap: 6px; }",
    ".feature-card .f-title { font-size: 12px; font-weight: 700; display: flex; align-items: center; gap: 6px; }"],
  [".coming-soon-pill { font-size: 8.5px; font-weight: 700; background: var(--brand-orange); color: var(--brand-primary-foreground); padding: 2px 6px; border-radius: 999px; } @media (max-width: 1100px) { .kpi-grid-v4, .fin-overview-grid, .feature-strip { grid-template-columns: repeat(2, 1fr); } }",
    "@media (max-width: 1100px) { .kpi-grid-v4, .fin-overview-grid { grid-template-columns: repeat(2, 1fr); } } " +
    "@media (max-width: 1100px) { .dash-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: auto; } .dash-widget { grid-column: auto; grid-row: auto; } .dash-widget[data-wide] { grid-column: 1 / -1; } .dash-widget > *:not(.dash-widget-chrome):not(.dash-resize-handle) { overflow: visible; } } " +
    "@media (max-width: 640px) { .dash-grid { grid-template-columns: minmax(0, 1fr); } }"],
];

/**
 * DEV-UI-01.7 C7 (D-3): every C7 source hunk, [C6, C7] byte for byte — tags only. The eight document families' list
 * titles, detail document numbers and editor titles h3 → h1; the shared e-invoice panel's title h4 → h2; the error,
 * not-found and document Recycle Bin titles h3 → h1. Group 10 undoes the eight lists' hunk before holding them at C1's
 * bytes; group 15 proves each file is C6's plus exactly its hunks.
 */
const C7_LISTS: [string, string][] = [
  ["sales/quotations/quotations-list-client.tsx", "Quotations"], ["sales/orders/orders-list-client.tsx", "Sales Orders"],
  ["sales/proforma/proforma-list-client.tsx", "Proforma Invoices"], ["sales/invoices/invoices-list-client.tsx", "Invoices"],
  ["sales/delivery-challans/dc-list-client.tsx", "Delivery Challans"], ["sales/credit-notes/cn-list-client.tsx", "Credit Notes"],
  ["purchasing/orders/po-list-client.tsx", "Purchase Orders"], ["purchasing/debit-notes/dn-list-client.tsx", "Debit Notes"],
];
const C7_DETAILS: [string, string][] = [
  ["sales/quotations/[id]/page.tsx", "quotation.quotationNumber"], ["sales/orders/[id]/page.tsx", "order.soNumber"],
  ["sales/proforma/[id]/page.tsx", "pf.proformaNumber"], ["sales/invoices/[id]/page.tsx", "invoice.invoiceNumber"],
  ["sales/delivery-challans/[id]/page.tsx", "dc.dcNumber"], ["sales/credit-notes/[id]/page.tsx", "cn.creditNoteNumber"],
  ["purchasing/orders/[id]/page.tsx", "po.poNumber"], ["purchasing/debit-notes/[id]/page.tsx", "dn.debitNoteNumber"],
];
// [form, its titlebar icon, the type in its Create / Edit dictionary keys]
const C7_FORMS: [string, string, string][] = [
  ["sales/quotations/quotation-form.tsx", "FileText", "Quotation"], ["sales/orders/order-form.tsx", "ClipboardList", "Sales Order"],
  ["sales/proforma/proforma-form.tsx", "FileCheck2", "Proforma Invoice"], ["sales/invoices/invoice-form.tsx", "Receipt", "Invoice"],
  ["sales/delivery-challans/dc-form.tsx", "Truck", "Delivery Challan"], ["sales/credit-notes/cn-form.tsx", "FileMinus2", "Credit Note"],
  ["purchasing/orders/po-form.tsx", "ShoppingCart", "Purchase Order"], ["purchasing/debit-notes/dn-form.tsx", "FileMinus2", "Debit Note"],
];
const C7_EINVOICE = `${A}sales/_shared/einvoice-preview-panel.tsx`;
const C7_ERROR = `${A}error.tsx`;
const C7_NOT_FOUND = `${A}not-found.tsx`;
const C7_BIN = `${A}recycle-bin/recycle-bin-client.tsx`;
const C7_EDITS: Record<string, [string, string][]> = {
  ...Object.fromEntries(C7_LISTS.map(([f, title]) => [`${A}${f}`, [[`<h3 className="text-[19px] font-bold">{t(locale, "${title}")}</h3>`, `<h1 className="text-[19px] font-bold">{t(locale, "${title}")}</h1>`]]])),
  ...Object.fromEntries(C7_DETAILS.map(([f, num]) => [`${A}${f}`, [[`<h3 className="mono">{${num}}</h3>`, `<h1 className="mono">{${num}}</h1>`]]])),
  ...Object.fromEntries(C7_FORMS.map(([f]) => [`${A}${f}`, [
    ['      <div className="doc-titlebar">\n        <div>\n          <h3>\n', '      <div className="doc-titlebar">\n        <div>\n          <h1>\n'],
    ['\n          </h3>\n          <div className="sub">', '\n          </h1>\n          <div className="sub">'],
  ]])),
  [C7_EINVOICE]: [['<h4>{variant === "create" ? t(locale, "Tax Invoice QR preview") : t(locale, "Tax Invoice QR")}</h4>', '<h2>{variant === "create" ? t(locale, "Tax Invoice QR preview") : t(locale, "Tax Invoice QR")}</h2>']],
  [C7_ERROR]: [['<h3 className="text-[19px] font-bold mb-2">Something went wrong</h3>', '<h1 className="text-[19px] font-bold mb-2">Something went wrong</h1>']],
  [C7_NOT_FOUND]: [['<h3 className="text-[19px] font-bold mb-2">{t(locale, "Page not found")}</h3>', '<h1 className="text-[19px] font-bold mb-2">{t(locale, "Page not found")}</h1>']],
  [C7_BIN]: [
    ['        <h3 className="text-[19px] font-bold flex items-center gap-2">\n', '        <h1 className="text-[19px] font-bold flex items-center gap-2">\n'],
    ['{t(locale, "Recycle Bin")}\n        </h3>\n', '{t(locale, "Recycle Bin")}\n        </h1>\n'],
  ],
};
/** A C7 file with its C7 hunks undone — C6's bytes, when they are its only change (group 15). */
const undoC7 = (f: string, s: string) => (C7_EDITS[f] ?? []).reduce((acc, [was, is]) => acc.replace(is, () => was), s);
/**
 * C7's four CSS twins, [the rule each twins, the twin]: each added straight after its rule, with exactly its
 * declarations. .main-head h1 is needed because the global h1–h6 rule (unlayered, weight 600) outranks the
 * title's font-bold utility — without it the Quotations and Recycle Bin titles would lose their 700. Groups 11,
 * 12 and 14 undo the twins before holding the stylesheet; group 15 proves they are C7's only CSS change.
 */
const C7_CSS_TWINS: [string, string][] = [
  [".main-head h3 { font-size: 19px; font-weight: 700; }", ".main-head h1 { font-size: 19px; font-weight: 700; }"],
  [".inv-head h3 { font-size: 22px; font-weight: 700; }", ".inv-head h1 { font-size: 22px; font-weight: 700; }"],
  [".einvoice-panel h4 { font-size: 13.5px; font-weight: 700; }", ".einvoice-panel h2 { font-size: 13.5px; font-weight: 700; }"],
  [".doc-titlebar h3 { font-size: 22px; font-weight: 700; display: flex; align-items: center; gap: 10px; }",
    ".doc-titlebar h1 { font-size: 22px; font-weight: 700; display: flex; align-items: center; gap: 10px; }"],
];

/**
 * DEV-UI-01.7 C8 (D-2, the recorded P0 decision): no profit, margin or profitability badge on a project's Cost &
 * Profitability, and no Gross Profit card or row on the P&L screen, until COGS is trustworthy — presentation only.
 * Every C8 source hunk, [C7, C8] byte for byte. Groups 6, 11 and 12 undo them before holding these two files to C7's
 * (and so C3's / C4's) code; group 16 proves each file is C7's plus exactly these hunks and asserts the suppression.
 */
const D2_EDITS: Record<string, [string, string][]> = {
  [C3_COST]: [
    ['import { statusLabel, statusTextClass, type StatusDomain } from "@/lib/status-registry";\nimport { StatusBadge } from "@/components/ui/status-badge";\n',
      'import { statusLabel, type StatusDomain } from "@/lib/status-registry";\n'],
    ["  const { revenue, cost, profit, marginPercent, health, rows, labourEstimate, excludedUnconverted } = data;\n" +
      "  // Actual Profit and Profit Margin keep the project's health colour — the status registry's\n" +
      "  // (project_health), the same tone as the badge beside the heading. No other figure is coloured.\n" +
      '  const healthText = statusTextClass("project_health", health);\n',
    "  // D-2 (DEV-UI-01.7 C8): no profit, margin or profitability badge until COGS is trustworthy — the engine\n" +
      "  // still computes them (project-costing.ts unchanged); this section shows the factual figures only.\n" +
      "  const { revenue, cost, rows, labourEstimate, excludedUnconverted } = data;\n"],
    ['        title={t(locale, "Cost & Profitability")}\n        meta={<StatusBadge domain="project_health" status={health} locale={locale} />}\n        className="mb-[22px]"\n',
      '        title={t(locale, "Cost & Profitability")}\n        className="mb-[22px]"\n'],
    ["      {/* Six figures, three across (two at ≤640px, D-6): plain values, Collected and Total Cost included. */}\n      <StatRow\n        columns={3}\n",
      "      {/* Four factual figures, four across (two at ≤640px, D-6): plain values. */}\n      <StatRow\n        columns={4}\n"],
    ['          { label: t(locale, "Total Cost"), value: <Money amount={cost.total} context="summary" /> },\n' +
      '          { label: t(locale, "Actual Profit"), value: <span className={healthText}><Money amount={profit} context="summary" /></span> },\n' +
      '          { label: t(locale, "Profit Margin"), value: <span className={healthText}>{marginPercent === null ? "—" : `${marginPercent.toFixed(1)}%`}</span> },\n        ]}\n',
    '          { label: t(locale, "Total Cost"), value: <Money amount={cost.total} context="summary" /> },\n        ]}\n'],
  ],
  [C4_REPORTS]: [
    ["  return (\n    <>\n      <Cards items={[\n" +
      '        { label: t(locale, "Revenue"), value: d.revenueTotal, delta: prev ? d.revenueTotal - prev.revenueTotal : undefined },\n' +
      '        { label: t(locale, "Gross Profit"), value: d.grossProfit, delta: prev ? d.grossProfit - prev.grossProfit : undefined },\n',
    "  // D-2 (DEV-UI-01.7 C8): no Gross Profit card or row on screen until COGS is trustworthy. finance-reports.ts still\n" +
      "  // computes grossProfit, and the export route still lists it (an open decision, not part of this change).\n" +
      "  return (\n    <>\n      <Cards items={[\n" +
      '        { label: t(locale, "Revenue"), value: d.revenueTotal, delta: prev ? d.revenueTotal - prev.revenueTotal : undefined },\n'],
    ['      {d.costOfSales.map(line)}\n      <Row label={t(locale, "Gross Profit")} value={d.grossProfit} final />\n      <GroupLabel>{t(locale, "Operating Expenses")}</GroupLabel>\n',
      '      {d.costOfSales.map(line)}\n      <GroupLabel>{t(locale, "Operating Expenses")}</GroupLabel>\n'],
  ],
};
/** A D-2 file with its C8 hunks undone — C7's bytes, when they are its only change (group 16). */
const undoD2 = (f: string, s: string) => (D2_EDITS[f] ?? []).reduce((acc, [was, is]) => acc.replace(is, () => was), s);
/**
 * DEV-UI-01.7 C8 (DataTable verification, test-only): every hunk of verify/verify-datatable-runtime.mjs, [C7, C8] byte for byte —
 * the Filters popover's Escape contract (popover closed AND focus back on its trigger) waited for and asserted at the two
 * Filters → Views transitions, and failure diagnostics (the Filters trigger named apart from the Views trigger, the active
 * element and focus() stacks in a failing check's detail). Group 15 undoes them before holding the suite at C6's / C7's
 * bytes; group 16 proves they are its only change. Generated from the diff, so each is exact and unique in both files.
 */
const DT_EDITS: [string, string][] = [
  [" *      current / manage → rename (no limit: 69 chars, persisted, reloaded, applied) / delete\n",
    " *      current / manage → rename (no limit: 69 chars, persisted, reloaded, applied) / delete; before Views is used\n *      after the Filters popover, its Escape must have returned focus to the Filters trigger (DEV-UI-01.7 C8)\n"],
  ["// Focus recorder for the menu → Dialog handoff. focusin is logged as trigger / menu / dialog:<kind> / tag, and\n// focusout as \"out:<from>><to>\" with its relatedTarget. The regression (measured): ~100 ms after the Dialog\n// focuses its control, the closing menu moves focus to the Views trigger — the control blurs with\n// relatedTarget = trigger and the Dialog's focus trap pulls focus straight back, so the trigger never even\n// logs a focusin. Keystrokes in that gap are lost. Hence focusout is what must be watched.\nconst startFocusLog = () => page.evaluate(() => {\n  window.__focusLog = [];\n",
    "// Focus recorder for the menu → Dialog handoff. focusin is logged as trigger / filters / menu / dialog:<kind> / tag, and\n// focusout as \"out:<from>><to>\" with its relatedTarget. The regression (measured): ~100 ms after the Dialog\n// focuses its control, the closing menu moves focus to the Views trigger — the control blurs with\n// relatedTarget = trigger and the Dialog's focus trap pulls focus straight back, so the trigger never even\n// logs a focusin. Keystrokes in that gap are lost. Hence focusout is what must be watched.\n// DEV-UI-01.7 C8 (diagnostics only): the Filters trigger is named apart from the Views trigger (\"filters\"), and every\n// programmatic focus() while the recorder is installed is kept with its call stack — printed only when a check fails.\nconst startFocusLog = () => page.evaluate(() => {\n  window.__focusLog = [];\n  window.__focusCalls = [];\n"],
  ["      return t.closest?.(\"[data-list-views]\") ? \"trigger\" : d ? `dialog:${d.dataset.savedViewDialog}` : t.closest?.('[role=\"menu\"]') ? \"menu\" : String(t.tagName).toLowerCase();\n    };\n    document.addEventListener(\"focusin\", (e) => window.__focusLog.push(name(e.target)), true);\n    document.addEventListener(\"focusout\", (e) => window.__focusLog.push(`out:${name(e.target)}>${name(e.relatedTarget)}`), true);\n  }\n});\nconst focusLog = () => page.evaluate(() => window.__focusLog ?? []);\n",
    "      return t.closest?.(\"[data-list-views]\") ? \"trigger\" : t.closest?.(\"[data-list-filters]\") ? \"filters\" : d ? `dialog:${d.dataset.savedViewDialog}` : t.closest?.('[role=\"menu\"]') ? \"menu\" : String(t.tagName).toLowerCase();\n    };\n    window.__focusName = name;\n    document.addEventListener(\"focusin\", (e) => window.__focusLog.push(name(e.target)), true);\n    document.addEventListener(\"focusout\", (e) => window.__focusLog.push(`out:${name(e.target)}>${name(e.relatedTarget)}`), true);\n    const focus = HTMLElement.prototype.focus;\n    HTMLElement.prototype.focus = function (...args) {\n      window.__focusCalls.push(`${name(this)} ← ${(new Error().stack ?? \"\").split(\"\\n\").slice(2, 6).map((s) => s.trim()).join(\" ← \")}`);\n      return focus.apply(this, args);\n    };\n  }\n});\nconst focusLog = () => page.evaluate(() => window.__focusLog ?? []);\n/** For a failure's detail only: where keyboard focus is now, and the last focus() calls the recorder saw (with stacks). */\nconst focusState = () => page.evaluate(() => ({ active: window.__focusName ? window.__focusName(document.activeElement) : String(document.activeElement?.tagName), calls: (window.__focusCalls ?? []).slice(-8) }));\n"],
  ["const triggerFocused = () => page.waitForFunction(() => document.activeElement?.matches?.(\"[data-list-views]\"), null, { timeout: 3000 }).then(() => true).catch(() => false);\n// Ordinary close: open by keyboard, Escape → focus back on the Views trigger (Radix default, not suppressed).\n",
    "const triggerFocused = () => page.waitForFunction(() => document.activeElement?.matches?.(\"[data-list-views]\"), null, { timeout: 3000 }).then(() => true).catch(() => false);\n// DEV-UI-01.7 C8 — the Filters popover's Escape contract, waited for and asserted at both Filters → Views transitions.\n// Escape closes it in two steps: Radix removes the popover from the DOM, then — in FocusScope's unmount timer, measured\n// 6–16 ms later — Popover's onCloseAutoFocus returns keyboard focus to its trigger. layersClosed() sees only the first,\n// so the suite used to move on to Views in between, and a late return could take focus from the Views trigger (Enter\n// then opened the Filters popover, not the menu) or from the Save dialog's input. Wait for both: a condition with a\n// bound, never a sleep. A return that never comes is a FAIL (and stops the saved-view block), not a skipped step.\nasync function closeFiltersByEscape(step) {\n  await startFocusLog();\n  await page.keyboard.press(\"Escape\");\n  await layersClosed();\n  const returned = await page.waitForFunction(() => !document.querySelector(\"[data-radix-popper-content-wrapper]\") && !!document.activeElement?.matches?.(\"main [data-list-filters]\"), null, { timeout: 5000 })\n    .then(() => true, () => false);\n  check(`Filters popover (${step}): Escape closes it and keyboard focus is back on the Filters trigger before the suite moves on to Views`,\n    returned, returned ? \"\" : JSON.stringify({ ...(await focusState()), log: await focusLog() }));\n  if (!returned) throw new Error(`the Filters popover never returned focus to its trigger (${step})`);\n}\n// Ordinary close: open by keyboard, Escape → focus back on the Views trigger (Radix default, not suppressed).\n"],
  ["await page.locator('[role=\"option\"]').filter({ hasText: /^Sent$/ }).click();\nawait page.keyboard.press(\"Escape\");\nawait layersClosed();\n",
    "await page.locator('[role=\"option\"]').filter({ hasText: /^Sent$/ }).click();\nawait closeFiltersByEscape(\"status Sent chosen, before Save current view\");\n"],
  ["check(\"save handoff: the Dialog input takes focus, the Views trigger never regains it, and immediate typing keeps the full name\",\n  saveState.value === viewName && saveState.focused && !triggerStoleFocus(saveLog), JSON.stringify({ value: saveState.value, focused: saveState.focused, log: saveLog }));\n",
    "const saveOk = saveState.value === viewName && saveState.focused && !triggerStoleFocus(saveLog);\ncheck(\"save handoff: the Dialog input takes focus, the Views trigger never regains it, and immediate typing keeps the full name\",\n  saveOk, JSON.stringify({ value: saveState.value, focused: saveState.focused, log: saveLog, ...(saveOk ? {} : await focusState()) }));\n"],
  ["await page.locator(\"[data-radix-popper-content-wrapper] button\", { hasText: /Clear filters/ }).click();\nawait page.keyboard.press(\"Escape\");\nawait layersClosed();\n",
    "await page.locator(\"[data-radix-popper-content-wrapper] button\", { hasText: /Clear filters/ }).click();\nawait closeFiltersByEscape(\"filters cleared, before applying the saved view\");\n"],
  ["check(\"manage handoff: focus moves into the Manage dialog and the Views trigger does not take it back\", manageInside && !triggerStoleFocus(manageLog), JSON.stringify({ manageInside, log: manageLog }));\n",
    "const manageOk = manageInside && !triggerStoleFocus(manageLog);\ncheck(\"manage handoff: focus moves into the Manage dialog and the Views trigger does not take it back\", manageOk, JSON.stringify({ manageInside, log: manageLog, ...(manageOk ? {} : await focusState()) }));\n"],
  ["  check(\"saved-view flow ran to completion (no step stuck)\", false, String(e?.message ?? e).split(\"\\n\").filter((l) => /Timeout|waiting for/.test(l)).join(\" \").slice(0, 300));\n",
    "  const stuck = String(e?.message ?? e).split(\"\\n\").filter((l) => /Timeout|waiting for|returned focus/.test(l)).join(\" \").slice(0, 300);\n  check(\"saved-view flow ran to completion (no step stuck)\", false, `${stuck} ${JSON.stringify(await focusState().catch(() => null))}`);\n"],
];
const DT_SUITE = "verify/verify-datatable-runtime.mjs";
/** The DataTable runtime suite with its C8 hunks undone — C7's bytes, when they are its only change (group 16). */
const undoDT = (s: string) => DT_EDITS.reduce((acc, [was, is]) => acc.replace(is, () => was), s);

/**
 * DEV-UI-01.7 C8 final (the product owner's financial display policy): every hunk of the four files the final batch
 * changed, [c47c65a, final] byte for byte — generated from the diff, so each is exact and unique in both texts. `read`
 * undoes them for every group but 17 (the approved remediation's view); group 17 proves they are each file's only change.
 *   reports-workspace.tsx (8): the Info icon; ReportNote and PreliminaryMark; PnlView's comment, its Revenue-only cards
 *     and notice, its rows without Operating Profit and Net Profit / (Loss); the Balance Sheet's Preliminary line and
 *     disclosure; the print styles' comment and the report area shown again in print.
 *   cost-control.tsx (2): the header comment; the section's title, Project Revenue & Costs.
 *   finance/reports/export/route.ts (5): ExportMeta; `meta`; the P&L rows without the three profit rows, and its note;
 *     the Balance Sheet's Preliminary line, and its note; `meta` handed to exportResponse.
 *   dict.ts (1): the four entries.
 */
const C8F_EXPORT = `${A}finance/reports/export/route.ts`;
const C8F_DICT = "src/lib/i18n/dict.ts";
const FIN_EDITS: Record<string, [string, string][]> = {
  [C4_REPORTS]: [
    ["import { Download, Search, Loader2, ChevronRight } from \"lucide-react\";\n",
      "import { Download, Search, Loader2, ChevronRight, Info } from \"lucide-react\";\n"],
    ["const inSearch = (s: string, ...fields: string[]) => !s.trim() || fields.some((f) => f.toLowerCase().includes(s.trim().toLowerCase()));\n\n",
      "const inSearch = (s: string, ...fields: string[]) => !s.trim() || fields.some((f) => f.toLowerCase().includes(s.trim().toLowerCase()));\n// DEV-UI-01.7 C8 (product owner): a disclosure that belongs to the report — inside the report card, so it prints with\n// it; read in place (a note, not a live region); no figure of its own.\nfunction ReportNote({ children }: { children: React.ReactNode }) {\n  return (\n    <p role=\"note\" className=\"my-3 flex items-start gap-2 rounded-[10px] border border-line bg-surface-subtle px-3 py-2 text-[13px] text-ink\">\n      <Info className=\"mt-0.5 size-3.5 shrink-0 text-ink-muted\" aria-hidden=\"true\" />\n      <span>{children}</span>\n    </p>\n  );\n}\n// DEV-UI-01.7 C8: the Balance Sheet's current-period result is preliminary while COGS is incomplete — a word read with\n// the line it qualifies, not a colour alone.\nfunction PreliminaryMark({ locale }: { locale: Locale }) {\n  return <span className=\"ms-1.5 inline-flex items-center rounded-full border border-warning/40 bg-warning-bg px-1.5 align-middle text-[11px] font-semibold text-warning\">{t(locale, \"Preliminary\")}</span>;\n}\n\n"],
    ["  // D-2 (DEV-UI-01.7 C8): no Gross Profit card or row on screen until COGS is trustworthy. finance-reports.ts still\n  // computes grossProfit, and the export route still lists it (an open decision, not part of this change).\n",
      "  // DEV-UI-01.7 C8 (product owner): no profit figure on screen until Cost of Sales and inventory valuation are complete —\n  // no Gross Profit, Operating Profit or Net Profit card or row, Revenue the one summary card. finance-reports.ts still\n  // computes all three; the export route leaves them out the same way.\n"],
    ["        { label: t(locale, \"Net Profit\"), value: d.netProfit, delta: prev ? d.netProfit - prev.netProfit : undefined },\n      ]} />\n",
      "      ]} />\n      <ReportNote>{t(locale, \"Profit figures are temporarily hidden because Cost of Sales and inventory valuation are not yet complete.\")}</ReportNote>\n"],
    ["      {d.operatingExpenses.map(line)}\n      <Row label={t(locale, \"Operating Profit\")} value={d.operatingProfit} final />\n      {(d.otherIncome.length > 0 || d.otherExpenses.length > 0) && <GroupLabel>{t(locale, \"Other Income & Expenses\")}</GroupLabel>}\n      {d.otherIncome.map(line)}\n      {d.otherExpenses.map(line)}\n      <Row label={t(locale, \"Net Profit / (Loss)\")} value={d.netProfit} final />\n",
      "      {d.operatingExpenses.map(line)}\n      {(d.otherIncome.length > 0 || d.otherExpenses.length > 0) && <GroupLabel>{t(locale, \"Other Income & Expenses\")}</GroupLabel>}\n      {d.otherIncome.map(line)}\n      {d.otherExpenses.map(line)}\n"],
    ["      <Row label={t(locale, \"Current-period Profit / (Loss)\")} value={d.currentPeriodProfit} />\n      <Row label={t(locale, \"Total Equity\")} value={d.totalEquity} final />\n      <Row label={t(locale, \"Total Liabilities + Equity\")} value={d.totalLiabilitiesAndEquity} final />\n",
      "      {/* DEV-UI-01.7 C8: the line and its amount stay (Equity, the balance identity); it is marked Preliminary. */}\n      <Row label={<>{t(locale, \"Current-period Profit / (Loss)\")} <PreliminaryMark locale={locale} /></>} value={d.currentPeriodProfit} />\n      <Row label={t(locale, \"Total Equity\")} value={d.totalEquity} final />\n      <Row label={t(locale, \"Total Liabilities + Equity\")} value={d.totalLiabilitiesAndEquity} final />\n      <ReportNote>{t(locale, \"Preliminary — Cost of Sales and inventory valuation are incomplete. The current-period result may change.\")}</ReportNote>\n"],
    ["// Print: hide app chrome + workspace controls, show only the report area full-width.\nfunction PrintStyles() {\n",
      "// Print: hide app chrome + workspace controls, show only the report area full-width.\n// DEV-UI-01.7 C8: the shell's print rule for the document preview (mockup-parity.css hides `body *`) hid the report\n// too — a printed report came out blank, its disclosures with it — so the report area shows itself again.\nfunction PrintStyles() {\n"],
    ["      a { color: inherit !important; text-decoration: none !important; }\n    }`}</style>\n",
      "      a { color: inherit !important; text-decoration: none !important; }\n      .reports-print-area, .reports-print-area * { visibility: visible !important; }\n    }`}</style>\n"],
  ],
  [C3_COST]: [
    ["// Cost & Profitability for one project. Every number arrives already computed by\n",
      "// Project Revenue & Costs for one project. Every number arrives already computed by\n"],
    ["      <SectionHeader\n        level={2}\n        title={t(locale, \"Cost & Profitability\")}\n",
      "      {/* DEV-UI-01.7 C8 (product owner): the section is named for what it shows — it was \"Cost & Profitability\". */}\n      <SectionHeader\n        level={2}\n        title={t(locale, \"Project Revenue & Costs\")}\n"],
  ],
  [C8F_EXPORT]: [
    ["import { exportResponse, type ExportColumn } from \"@/lib/report-export\";\n",
      "import { exportResponse, type ExportColumn, type ExportMeta } from \"@/lib/report-export\";\n"],
    ["  let title = \"\", columns: ExportColumn[] = [], rows: Record<string, string>[] = [];\n\n",
      "  let title = \"\", columns: ExportColumn[] = [], rows: Record<string, string>[] = [];\n  // DEV-UI-01.7 C8 (product owner): the P&L's and the Balance Sheet's disclosure, printed above the table in all three\n  // formats (the exporter's header block); every other report has none, so its output is unchanged.\n  let meta: ExportMeta | undefined;\n\n"],
    ["    rows = [\n      ...grp(\"Revenue\", d.revenue), { section: \"Revenue\", account: \"Total Revenue\", amount: money(d.revenueTotal) },\n      ...grp(\"Cost of Sales\", d.costOfSales), { section: \"\", account: \"Gross Profit\", amount: money(d.grossProfit) },\n      ...grp(\"Operating Expenses\", d.operatingExpenses), { section: \"\", account: \"Operating Profit\", amount: money(d.operatingProfit) },\n      ...grp(\"Other Income\", d.otherIncome), ...grp(\"Other Expenses\", d.otherExpenses),\n      { section: \"\", account: \"Net Profit / (Loss)\", amount: money(d.netProfit) },\n    ];\n",
      "    // No Gross Profit, Operating Profit or Net Profit / (Loss) row until Cost of Sales and inventory valuation are\n    // complete — as on screen; every account line and Total Revenue stay, and finance-reports.ts still computes all three.\n    rows = [\n      ...grp(\"Revenue\", d.revenue), { section: \"Revenue\", account: \"Total Revenue\", amount: money(d.revenueTotal) },\n      ...grp(\"Cost of Sales\", d.costOfSales),\n      ...grp(\"Operating Expenses\", d.operatingExpenses),\n      ...grp(\"Other Income\", d.otherIncome), ...grp(\"Other Expenses\", d.otherExpenses),\n    ];\n    meta = [{ label: \"Note\", value: \"Profit figures are temporarily hidden because Cost of Sales and inventory valuation are not yet complete.\" }];\n"],
    ["      { section: \"Equity\", account: \"Current-period Profit / (Loss)\", amount: money(d.currentPeriodProfit) },\n      { section: \"\", account: \"Total Equity\", amount: money(d.totalEquity) },\n      { section: \"\", account: \"Total Liabilities + Equity\", amount: money(d.totalLiabilitiesAndEquity) },\n    ];\n",
      "      // The line and its amount stay (Equity, the balance identity), marked Preliminary — short enough for the PDF's column.\n      { section: \"Equity\", account: \"Current-period Profit / (Loss) (Preliminary)\", amount: money(d.currentPeriodProfit) },\n      { section: \"\", account: \"Total Equity\", amount: money(d.totalEquity) },\n      { section: \"\", account: \"Total Liabilities + Equity\", amount: money(d.totalLiabilitiesAndEquity) },\n    ];\n    meta = [{ label: \"Note\", value: \"Preliminary — Cost of Sales and inventory valuation are incomplete. The current-period result may change.\" }];\n"],
    ["  return exportResponse(format, `${title} (${range.from} → ${range.to})`, `${report}-${stamp}`, columns, rows);\n",
      "  return exportResponse(format, `${title} (${range.from} → ${range.to})`, `${report}-${stamp}`, columns, rows, meta);\n"],
  ],
  [C8F_DICT]: [
    ["  \"The Actions column must stay at the end.\": \"يجب أن يبقى عمود الإجراءات في النهاية.\",\n};\n",
      "  \"The Actions column must stay at the end.\": \"يجب أن يبقى عمود الإجراءات في النهاية.\",\n  // DEV-UI-01.7 C8 (product owner): the financial display policy while Cost of Sales and inventory valuation are\n  // incomplete — the project section's name, the P&L notice, the Balance Sheet's preliminary current-period result.\n  \"Project Revenue & Costs\": \"إيرادات وتكاليف المشروع\",\n  \"Profit figures are temporarily hidden because Cost of Sales and inventory valuation are not yet complete.\": \"تم إخفاء مؤشرات الربح مؤقتًا لأن احتساب تكلفة المبيعات وتقييم المخزون لم يكتمل بعد.\",\n  Preliminary: \"مبدئي\",\n  \"Preliminary — Cost of Sales and inventory valuation are incomplete. The current-period result may change.\": \"مبدئي — احتساب تكلفة المبيعات وتقييم المخزون غير مكتمل، وقد تتغير نتيجة الفترة الحالية.\",\n};\n"],
  ],
};
/** A C8-final file with its hunks undone — the approved remediation's (c47c65a's) bytes, when they are its only change. */
function undoFin(f: string, s: string): string {
  return (FIN_EDITS[f] ?? []).reduce((acc, [was, is]) => acc.replace(is, () => was), s);
}

/**
 * Integration with main: the approved main changes to files this verifier freezes, [1bfdbbf, main] byte for byte.
 *   document-pdf route (1, PR #7 32702c3): the print page rendered from PDF_RENDER_ORIGIN — trimmed, without a trailing
 *     slash — when it is set, else from the request's origin as before.
 * `frozen` undoes them for every byte-identity hash; group 18 proves they are each file's only change.
 */
const PDF_ROUTE = "src/app/api/document-pdf/[type]/[id]/route.ts";
const MAIN_EDITS: Record<string, [string, string][]> = {
  [PDF_ROUTE]: [
    ["  const origin = request.nextUrl.origin;\n",
      "  // Behind a TLS-terminating reverse proxy, NextRequest may report https://localhost:3200\n  // even though the Next.js server listens on plain HTTP. Allow a trusted internal\n  // loopback origin for server-side PDF rendering without changing public request URLs.\n  const origin = process.env.PDF_RENDER_ORIGIN?.trim().replace(/\\/+$/, \"\") || request.nextUrl.origin;\n"],
  ],
};
/** A file's bytes for a byte-identity hash: main's approved change undone (MAIN_EDITS), every other file as it is. */
const frozen = (f: string): string | Buffer =>
  f in MAIN_EDITS ? MAIN_EDITS[f].reduce((acc, [was, is]) => acc.replace(is, () => was), rawRead(f))
    : f in ACC01_EDITS ? rawRead(f) : readFileSync(path.join(ROOT, f));

let pass = 0;
let fail = 0;
let group = "";
const counts: Record<string, [number, number]> = {};
function section(name: string) {
  group = name;
  counts[group] = [0, 0];
  console.log(`\n${name}`);
}
function check(name: string, ok: boolean, detail?: string) {
  counts[group][ok ? 0 : 1]++;
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n          ${detail}` : ""}`);
}

// ---------- source helpers ----------

const parsed = new Map<string, ts.SourceFile>();
function parse(f: string): ts.SourceFile {
  let sf = parsed.get(f);
  if (!sf) {
    sf = ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, true, /x$/.test(f) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    parsed.set(f, sf);
  }
  return sf;
}
/** Files under `dir`, repository-relative, sorted — without the files ACC-01 added (group 19 holds those). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, dir)).sort()) {
    const p = path.posix.join(dir, name);
    if (statSync(path.join(ROOT, p)).isDirectory()) out.push(...walk(p));
    else if (!(p in ACC01_NEW)) out.push(p);
  }
  return out;
}
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
/** A node's code with comments, layout and trailing commas normalised away: what it does, not how it is typed out. */
const canon = (n: ts.Node) =>
  printer.printNode(ts.EmitHint.Unspecified, n, n.getSourceFile()).replace(/\s+/g, " ").replace(/,\s*\}/g, " }").replace(/,\s*([\])])/g, "$1").trim();
/** Source without comments, so a check never matches its own explanation. */
const codeOnly = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const hasJsx = (n: ts.Node): boolean => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n) || !!ts.forEachChild(n, (c) => (hasJsx(c) ? true : undefined));
const directives = (sf: ts.SourceFile) => {
  const out: string[] = [];
  for (const s of sf.statements) {
    if (ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)) out.push(s.expression.text);
    else break;
  }
  return out;
};
const hasModifier = (n: ts.Node, k: ts.SyntaxKind) => !!(ts.canHaveModifiers(n) && ts.getModifiers(n)?.some((m) => m.kind === k));
function defaultFunction(sf: ts.SourceFile): ts.FunctionLikeDeclaration | null {
  for (const s of sf.statements) if (ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.DefaultKeyword)) return s;
  const assigned = sf.statements.find(ts.isExportAssignment);
  if (assigned && ts.isIdentifier(assigned.expression)) {
    const name = assigned.expression.text;
    for (const s of sf.statements) {
      if (ts.isFunctionDeclaration(s) && s.name?.text === name) return s;
      if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) return d.initializer;
    }
  }
  return null;
}
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
/** A page-local import: relative, or `@/app/…`. Anything else (components, lib, packages) is not followed. */
function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/app/")) base = path.posix.join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(from), spec);
  else return null;
  for (const ext of EXTENSIONS) if (existsSync(path.join(ROOT, base + ext)) && statSync(path.join(ROOT, base + ext)).isFile()) return base + ext;
  return null;
}
const moduleSpecs = (sf: ts.SourceFile) =>
  sf.statements.flatMap((s) =>
    (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? [{ node: s, spec: s.moduleSpecifier.text }] : [],
  );

// ---------- the snapshot: what the pins hold, computed from the tree ----------

const appFiles = walk("src/app").map((f) => f.slice("src/app/".length));
const routes = {
  pages: appFiles.filter((f) => /(^|\/)page\.(tsx?|jsx?)$/.test(f)),
  handlers: appFiles.filter((f) => /(^|\/)route\.(tsx?|jsx?)$/.test(f)),
  layouts: appFiles.filter((f) => /(^|\/)layout\.(tsx?|jsx?)$/.test(f)),
};

const GUARD_CALLS = new Set(["requireSession", "requireRole", "getSession", "redirect", "permanentRedirect", "notFound", "forbidden", "unauthorized"]);
/** Guard calls with their arguments, and every expression that reads `<x>.role`, in the context it is used. */
const MISSING = "(page missing)";
const exists = (f: string) => existsSync(path.join(ROOT, f));
function guards(file: string): string[] {
  if (!exists(`src/app/${file}`)) return [MISSING];
  const sf = parse(`src/app/${file}`);
  const out: string[] = [];
  const seen = new Set<ts.Node>(); // `a.role === x || a.role === y` is one expression, recorded once
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && GUARD_CALLS.has(n.expression.text)) out.push(canon(n));
    if (ts.isPropertyAccessExpression(n) && n.name.text === "role" && !ts.isPropertyAccessExpression(n.parent)) {
      let e: ts.Node = n;
      while (ts.isBinaryExpression(e.parent) || ts.isParenthesizedExpression(e.parent) || ts.isPrefixUnaryExpression(e.parent) || ts.isConditionalExpression(e.parent)) e = e.parent;
      if (!seen.has(e)) {
        seen.add(e);
        const p = e.parent;
        if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) out.push(`${p.parent.name.getText()}={${canon(e)}}`);
        else if (ts.isVariableDeclaration(p)) out.push(`${p.name.getText()} = ${canon(e)}`);
        else if (ts.isPropertyAssignment(p)) out.push(`${p.name.getText()}: ${canon(e)}`);
        else if (ts.isCallExpression(p)) out.push(canon(p));
        else out.push(canon(e));
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out.sort();
}

const DISPLAY_DATE_CALLS = new Set(["toLocaleDateString", "toLocaleTimeString", "formatDisplayDate"]);
/** `const label = <date>.toLocaleDateString(…)` and the like: display formatting, which C2/C6 move onto formatDisplayDate. */
function isDisplayDate(st: ts.Statement): boolean {
  if (!ts.isVariableStatement(st)) return false;
  return st.declarationList.declarations.every((d) => {
    const init = d.initializer;
    if (!init || !ts.isCallExpression(init)) return false;
    const c = init.expression;
    const name = ts.isPropertyAccessExpression(c) ? c.name.text : ts.isIdentifier(c) ? c.text : "";
    return DISPLAY_DATE_CALLS.has(name);
  });
}
const entry = (s: string) => `${h16(s).slice(0, 12)} ${s.length > 72 ? s.slice(0, 72) + "…" : s}`;
/**
 * A page's server data section: the module's non-markup top-level declarations (helpers, constants,
 * segment config — not imports, types or anything containing JSX), the page function's parameters,
 * and every statement of its body except the markup (statements containing JSX, which includes the
 * returned page) and display-date formatting. One entry per statement: hash + the start of its code.
 */
function dataSection(file: string): string[] {
  if (!exists(`src/app/${file}`)) return [MISSING];
  const sf = parse(`src/app/${file}`);
  const def = defaultFunction(sf);
  const out: string[] = [];
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s) || s === def || hasJsx(s)) continue;
    if (ts.isExportAssignment(s)) continue;
    if (ts.isVariableStatement(s) && def && s.declarationList.declarations.some((d) => d.initializer === def)) continue;
    out.push(entry(canon(s)));
  }
  if (!def?.body || !ts.isBlock(def.body)) return [...out, "(no default page function)"];
  out.push(entry(`(params) (${def.parameters.map(canon).join(", ")})`));
  for (const st of def.body.statements) if (!hasJsx(st) && !isDisplayDate(st)) out.push(entry(canon(st)));
  return out;
}

/** A route literal: a string or template that starts with "/" and a letter. Template holes become ${}. */
function routeLiteral(n: ts.Node): string | null {
  let text: string | null = null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
  else if (ts.isTemplateExpression(n)) text = n.head.text + n.templateSpans.map((s) => "${}" + s.literal.text).join("");
  if (text === null || !/^\/[A-Za-z]/.test(text)) return null;
  if (ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent)) return null;
  return text;
}
/**
 * The static action inventory of a page: route literals (link targets, redirects, pushed URLs) and
 * the server actions it can call, over the page and its page-local imports. A "use server" module
 * is not entered — calling it is the action; what it does is a business pin.
 */
function actions(file: string): string[] {
  const start = `src/app/${file}`;
  if (!exists(start)) return [MISSING];
  const seen = new Set<string>();
  const queue = [start];
  const out: string[] = [];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const sf = parse(f);
    for (const { node, spec } of moduleSpecs(sf)) {
      const r = resolveLocal(f, spec);
      if (!r) continue;
      if (directives(parse(r)).includes("use server")) {
        const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
        if (clause && !clause.isTypeOnly && clause.namedBindings && ts.isNamedImports(clause.namedBindings))
          for (const el of clause.namedBindings.elements) if (!el.isTypeOnly) out.push(`action:${(el.propertyName ?? el.name).text}`);
        continue;
      }
      queue.push(r);
    }
    const visit = (n: ts.Node) => {
      const r = routeLiteral(n);
      if (r) out.push(r);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out.sort();
}

// Business, query, permission and export logic that 01.7 page-composition work must not touch.
const BUSINESS_FILES = [
  "src/lib/finance-reports.ts", "src/lib/statements.ts", "src/lib/project-costing.ts", "src/lib/accounting.ts", "src/lib/settlement.ts",
  "src/lib/invoice-posting.ts", "src/lib/payment-reversal.ts", "src/lib/advance-allocations.ts", "src/lib/bank-gl-accounts.ts", "src/lib/bank-opening.ts",
  "src/lib/base-currency.ts", "src/lib/dashboard-layout.ts", "src/lib/dashboard-range.ts", "src/lib/report-export.ts", "src/lib/role-matrix.ts",
  "src/lib/session.ts", "src/lib/tenant.ts", "src/lib/auth.ts", "src/lib/status-registry.ts", "src/lib/date-only.ts", "src/lib/documents.ts",
  "src/lib/document-registry.ts", "src/lib/document-hrefs.ts", "src/lib/exchange-rates.ts", "src/proxy.ts",
  "src/app/(app)/dashboard/_shared/queries.ts", "src/app/(app)/hr/payroll/queries.ts",
  "src/app/(app)/documents/export/route.ts", "src/app/(app)/finance/reports/export/route.ts", "src/app/(app)/finance/statements/export/route.ts",
  "src/app/api/document-pdf/[type]/[id]/route.ts", "src/app/api/import-template/[module]/route.ts", "src/app/auth/clear/route.ts", "src/app/uploads/[...path]/route.ts",
];
const BUSINESS_DIRS = ["src/db", "drizzle", "src/lib/currency", "src/lib/pdf", "src/app/print", "src/lib/security", "src/lib/compliance", "src/lib/rates"];
/** The server actions of the 01.7 areas: every "use server" module under them. */
const ACTION_AREAS = ["clients", "dashboard", "finance", "hr", "inventory/products", "projects", "purchasing/vendors", "recycle-bin", "settings"].map((d) => A + d);
const actionFiles = () => ACTION_AREAS.flatMap((d) => walk(d)).filter((f) => /\.tsx?$/.test(f) && directives(parse(f)).includes("use server"));
function dirHash(dir: string) {
  const files = walk(dir);
  const hh = createHash("sha256");
  for (const f of files) {
    hh.update(f + "\0");
    hh.update(frozen(f));
  }
  return `${hh.digest("hex").slice(0, 16)} (${files.length} files)`;
}
// C8 final: the P&L export route (and dict.ts) hashed with their FIN_EDITS hunks undone — their pins hold the
// remediation's bytes; group 17 proves the hunks are their only change. The PDF route likewise with main's (group 18).
const sha = (p: string) => (p in FIN_EDITS ? h16(read(p)) : h16(frozen(p)));
function business(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [...BUSINESS_FILES, ...actionFiles()].sort()) out[f] = existsSync(path.join(ROOT, f)) ? sha(f) : "(missing)";
  for (const d of BUSINESS_DIRS) out[`${d}/**`] = existsSync(path.join(ROOT, d)) ? dirHash(d) : "(missing)";
  return out;
}

// The prerequisite contracts, as the code that carries them (not whole files: most of these files
// are consumers that later 01.7 stages restyle).
const findAll = (sf: ts.SourceFile, pred: (n: ts.Node) => boolean): ts.Node[] => {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node) => {
    if (pred(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
};
const fnNamed = (name: string) => (n: ts.Node) => ts.isFunctionDeclaration(n) && n.name?.text === name;
const varNamed = (name: string) => (n: ts.Node) => ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => d.name.getText() === name);
const callsWith = (arg0: string) => (n: ts.Node) => ts.isCallExpression(n) && n.arguments[0]?.getText() === arg0;
const jsxAttr = (name: string) => (n: ts.Node) => ts.isJsxAttribute(n) && n.name.getText() === name;
const importOf = (spec: string) => (n: ts.Node) => ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === spec;
type Contract = { id: string; file: string; pick: (n: ts.Node) => boolean; count: number; must: RegExp[] };
const SH = A + "sales/_shared/";
const CONTRACTS: Contract[] = [
  { id: "P0 · DISPLAY_NUMBER_LOCALE is en-US", file: "src/lib/currency/currencies.ts", pick: varNamed("DISPLAY_NUMBER_LOCALE"), count: 1, must: [/export const DISPLAY_NUMBER_LOCALE = "en-US";/] },
  { id: "P0 · line-item money fmt() formats in DISPLAY_NUMBER_LOCALE", file: SH + "totals.ts", pick: fnNamed("fmt"), count: 1, must: [/toLocaleString\(DISPLAY_NUMBER_LOCALE, \{ minimumFractionDigits: dp, maximumFractionDigits: dp \}\)/] },
  { id: "P0 · journal totals format in DISPLAY_NUMBER_LOCALE", file: A + "finance/journal/journal-form.tsx", pick: callsWith("DISPLAY_NUMBER_LOCALE"), count: 2, must: [/toLocaleString\(DISPLAY_NUMBER_LOCALE, \{ minimumFractionDigits: moneyDp, maximumFractionDigits: moneyDp \}\)/] },
  { id: "P0 · ledger balances format in DISPLAY_NUMBER_LOCALE", file: A + "finance/_shared/account-ledger-view.tsx", pick: callsWith("DISPLAY_NUMBER_LOCALE"), count: 1, must: [/toLocaleString\(DISPLAY_NUMBER_LOCALE, \{ maximumFractionDigits: 0 \}\)/] },
  { id: "P0.1 · Security Center formats in UTC", file: A + "settings/security/security-client.tsx", pick: fnNamed("fmtDateTime"), count: 1, must: [/toLocaleString\("en-US", \{ month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" \}\)/] },
  { id: "P0.1 · Compliance Center formats in UTC", file: A + "settings/compliance/compliance-client.tsx", pick: fnNamed("fmtDate"), count: 1, must: [/toLocaleString\("en-US", \{ month: "short", day: "numeric", year: "numeric", timeZone: "UTC" \}\)/] },
  { id: "P0.2 · Credit Notes page hands the client the UTC month", file: A + "sales/credit-notes/page.tsx", pick: jsxAttr("currentMonthKey"), count: 1, must: [/^currentMonthKey=\{new Date\(\)\.toISOString\(\)\.slice\(0, 7\)\}$/] },
  { id: "P0.2 · Debit Notes page hands the client the UTC month", file: A + "purchasing/debit-notes/page.tsx", pick: jsxAttr("currentMonthKey"), count: 1, must: [/^currentMonthKey=\{new Date\(\)\.toISOString\(\)\.slice\(0, 7\)\}$/] },
  { id: "P0.2 · Credit Notes count This Month as date text", file: A + "sales/credit-notes/cn-list-client.tsx", pick: varNamed("thisMonthCount"), count: 1, must: [/r\.issueDate\.slice\(0, 7\) === currentMonthKey/] },
  { id: "P0.2 · Debit Notes count This Month as date text", file: A + "purchasing/debit-notes/dn-list-client.tsx", pick: varNamed("thisMonthCount"), count: 1, must: [/r\.issueDate\.slice\(0, 7\) === currentMonthKey/] },
  { id: "P0.2 · Valid Till dialog uses the calendar addDays", file: SH + "validity-days-dialog.tsx", pick: (n) => importOf("@/lib/date-only")(n) || varNamed("preview")(n), count: 2, must: [/import \{ addDays \} from "@\/lib\/date-only";/, /const preview = addDays\(base, n\);/] },
  { id: "P0.2 · Expected Delivery dialog uses the calendar addDays", file: SH + "date-settings-dialog.tsx", pick: (n) => importOf("@/lib/date-only")(n) || varNamed("preview")(n), count: 2, must: [/import \{ addDays \} from "@\/lib\/date-only";/, /const preview = addDays\(base, Number\(days\) \|\| 0\);/] },
  { id: "P0.2 · the quotation form computes Valid Till with it", file: A + "sales/quotations/quotation-form.tsx", pick: varNamed("effectiveValidUntil"), count: 1, must: [/const effectiveValidUntil = autoValidity \? addDays\(issueDate, validityDays\) : validUntil;/] },
];
function contract(c: Contract): { text: string[]; hash: string } {
  const text = findAll(parse(c.file), c.pick).map(canon);
  return { text, hash: h16(text.join("\n")) };
}

/** Every JSX use of a component across src: `file: <Name attr attr…>` (attribute names only), sorted. */
function uses(name: string, except: string): string[] {
  const out: string[] = [];
  for (const f of walk("src").filter((f) => /\.tsx$/.test(f) && f !== except)) {
    if (!read(f).includes(name)) continue;
    const visit = (n: ts.Node) => {
      if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === name)
        out.push(`${f}: <${name}${n.attributes.properties.map((a) => " " + (ts.isJsxAttribute(a) ? a.name.getText() : "{…}")).sort().join("")}>`);
      ts.forEachChild(n, visit);
    };
    visit(parse(f));
  }
  return out.sort();
}
/** Modules that import `name` from `spec` (any path ending in it). */
function importers(name: string, specEnd: string): string[] {
  return walk("src")
    .filter((f) => /\.tsx?$/.test(f) && read(f).includes(name))
    .filter((f) =>
      moduleSpecs(parse(f)).some(
        ({ node, spec }) =>
          spec.endsWith(specEnd) && ts.isImportDeclaration(node) && !!node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) &&
          node.importClause.namedBindings.elements.some((e) => (e.propertyName ?? e.name).text === name),
      ),
    );
}

/** CSS rules (with their @-rule context) whose selector names `cls`, across the app's stylesheets. */
function cssRules(cls: string): string[] {
  const out: string[] = [];
  for (const f of walk("src").filter((f) => f.endsWith(".css"))) {
    const text = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
    const stack: string[] = [];
    let buf = "";
    let leaf = true;
    for (const ch of text) {
      if (ch === "{") {
        stack.push((buf.split(";").pop() ?? "").trim().replace(/\s+/g, " "));
        buf = "";
        leaf = true;
      } else if (ch === "}") {
        const sel = stack.pop() ?? "";
        if (leaf && sel.split(",").some((s) => s.includes(cls)))
          out.push(`${f}: ${[...stack, sel].join(" > ")} { ${buf.trim().replace(/\s+/g, " ").replace(/;?\s*$/, ";")} }`);
        buf = "";
        leaf = false;
      } else buf += ch;
    }
  }
  return out;
}

function snapshot(): Pins {
  const pins = WRITE ? null : (JSON.parse(read(PINS_FILE)) as Pins);
  const scope = pins?.routes.scope ?? SCOPE_FROM_AUDIT;
  return {
    baseline: "1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50",
    routes: { ...routes, scope },
    guards: Object.fromEntries([...scope, ...routes.layouts].map((p) => [p, guards(p)])),
    data: Object.fromEntries(scope.map((p) => [p, dataSection(p)])),
    business: business(),
    contracts: Object.fromEntries(CONTRACTS.map((c) => [c.id, contract(c).hash])),
    consumers: {
      CardTitle: uses("CardTitle", "src/components/ui/card.tsx"),
      StatRow: uses("StatRow", SH + "stat-row.tsx"),
      ListEmptyState: uses("ListEmptyState", SH + "list-empty-state.tsx"),
      SectionHeader: uses("SectionHeader", "src/components/ui/section-header.tsx"),
      EmptyState: uses("EmptyState", "src/components/ui/empty-state.tsx"),
      formatDisplayDate: importers("formatDisplayDate", "i18n/format-date"),
      PageHeader: uses("PageHeader", PHF),
    },
    listEmptyState: sha(SH + "list-empty-state.tsx"),
    css: { ".stat-row-2": cssRules(".stat-row-2") },
    actions: Object.fromEntries(scope.map((p) => [p, actions(p)])),
  };
}
type Pins = {
  baseline: string;
  routes: { pages: string[]; handlers: string[]; layouts: string[]; scope: string[] };
  guards: Record<string, string[]>;
  data: Record<string, string[]>;
  business: Record<string, string>;
  contracts: Record<string, string>;
  consumers: Record<string, string[]>;
  listEmptyState: string;
  css: Record<string, string[]>;
  actions: Record<string, string[]>;
};
// The 36 DEV-UI-01.7 pages (Stage 1 audit). Used only when writing the pins; the check reads them back.
const SCOPE_FROM_AUDIT = [
  "clients/[id]", "clients/new", "clients", "clients/recycle-bin", "dashboard", "finance/bank-accounts", "finance/chart-of-accounts", "finance/journal",
  "finance/ledger", "finance/payments", "finance/reports", "finance/statements", "hr/attendance", "hr/departments", "hr/employees/[id]", "hr/employees/new",
  "hr/employees", "hr/leave", "hr/payroll", "inventory/products/[id]", "inventory/products/new", "inventory/products", "inventory/products/recycle-bin",
  "projects/[id]", "projects/new", "projects", "purchasing/vendors/[id]", "purchasing/vendors/new", "purchasing/vendors", "purchasing/vendors/recycle-bin",
  "recycle-bin", "settings/compliance", "settings/organization", "settings/presets", "settings/security", "settings/team",
].map((r) => `(app)/${r}/page.tsx`);

const now = snapshot();
if (WRITE) {
  writeFileSync(path.join(ROOT, PINS_FILE), JSON.stringify(now, null, 2) + "\n");
  console.log(`wrote ${PINS_FILE}`);
  process.exit(0);
}
const pins = JSON.parse(read(PINS_FILE)) as Pins;
const { SectionHeader } = await import("../src/components/ui/section-header");
const { EmptyState } = await import("../src/components/ui/empty-state");
const { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } = await import("../src/components/ui/card");
const { StatRow } = await import("../src/app/(app)/sales/_shared/stat-row");
const { statusStat } = await import("../src/lib/status-registry");
const { formatDisplayDate } = await import("../src/lib/i18n/format-date");
const { PageHeader } = await import("../src/components/layout/page-header");
const { t: translate } = await import("../src/lib/i18n/dict");
const same =(a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function delta(want: string[], got: string[]) {
  const w = [...want];
  const extra: string[] = [];
  for (const g of got) {
    const i = w.indexOf(g);
    if (i >= 0) w.splice(i, 1);
    else extra.push(g);
  }
  return [...w.map((x) => `- ${x}`), ...extra.map((x) => `+ ${x}`)].slice(0, 8).join("\n          ");
}

console.log("Page archetypes — C0 foundations and guardrails (baseline 1bfdbbf) + C1 master data and entity detail + C2 HR + C3 Projects + C4 finance and reports");

// ---------- 1. routes ----------
section("1. routes");
check(`page routes are the pinned ${pins.routes.pages.length} (the audit counted 72)`, same(now.routes.pages, pins.routes.pages) && pins.routes.pages.length === 72, delta(pins.routes.pages, now.routes.pages));
check(`route handlers are the pinned ${pins.routes.handlers.length}`, same(now.routes.handlers, pins.routes.handlers), delta(pins.routes.handlers, now.routes.handlers));
check(`layouts are the pinned ${pins.routes.layouts.length}`, same(now.routes.layouts, pins.routes.layouts), delta(pins.routes.layouts, now.routes.layouts));
const missingScope = pins.routes.scope.filter((p) => !now.routes.pages.includes(p));
check(`the ${pins.routes.scope.length} DEV-UI-01.7 pages all exist (the audit's 36)`, pins.routes.scope.length === 36 && new Set(pins.routes.scope).size === 36 && missingScope.length === 0, missingScope.join(" "));

// ---------- 2. guards ----------
section("2. guards");
const guardDrift = Object.keys(pins.guards).filter((p) => !same(now.guards[p], pins.guards[p]));
check(`guards of the 36 pages and ${pins.routes.layouts.length} layouts match the snapshot (session / role / redirect / notFound / role expressions)`,
  guardDrift.length === 0 && Object.keys(pins.guards).length === 36 + pins.routes.layouts.length,
  guardDrift.map((p) => `${p}\n          ${delta(pins.guards[p], now.guards[p] ?? [])}`).join("\n          "));
check("the (app) layout requires a session for every page under it", now.guards["(app)/layout.tsx"]?.includes("requireSession()") ?? false, JSON.stringify(now.guards["(app)/layout.tsx"]));
const OWNER_ADMIN = ["hr/payroll", "settings/organization", "settings/presets", "settings/compliance"].map((r) => `(app)/${r}/page.tsx`);
check("Payroll, Business Settings, Presets and Compliance require owner / admin", OWNER_ADMIN.every((p) => now.guards[p]?.includes('requireRole("owner", "admin")')));
check("/settings/team redirects to the Team tab of Business Settings", same(now.guards["(app)/settings/team/page.tsx"], ['redirect("/settings/organization?tab=team")']));
const unguarded = pins.routes.scope.filter((p) => !OWNER_ADMIN.includes(p) && p !== "(app)/settings/team/page.tsx" && !now.guards[p]?.includes("requireSession()"));
check("every other 01.7 page requires a session itself — except New Product, which the (app) layout covers", same(unguarded, ["(app)/inventory/products/new/page.tsx"]), unguarded.join(" "));
const detail = pins.routes.scope.filter((p) => p.includes("/[id]/"));
check(`the ${detail.length} entity detail pages answer an unknown id with notFound()`, detail.length === 5 && detail.every((p) => now.guards[p]?.includes("notFound()")));

// ---------- 3. server data sections ----------
section("3. server data sections");
const dataDrift = pins.routes.scope.filter((p) => !same(now.data[p], pins.data[p]));
const statements = Object.values(pins.data).reduce((n, d) => n + d.length, 0);
check(`server data sections of the 36 pages unchanged (${statements} statements pinned; markup and display-date formatting excluded)`, dataDrift.length === 0,
  dataDrift.map((p) => `${p}\n          ${delta(pins.data[p], now.data[p])}`).join("\n          "));
check("every page's section was found (a default page function in each)", pins.routes.scope.every((p) => !now.data[p].includes("(no default page function)")));

// ---------- 4. business ----------
section("4. business, query, permission and export logic");
const bizDrift = Object.keys(pins.business).filter((k) => now.business[k] !== pins.business[k]);
const bizNew = Object.keys(now.business).filter((k) => !(k in pins.business));
check(`${Object.keys(pins.business).filter((k) => !k.endsWith("/**")).length} business / query / permission / export files and the 01.7 server actions byte-identical`,
  bizDrift.filter((k) => !k.endsWith("/**")).length === 0 && bizNew.length === 0, [...bizDrift.filter((k) => !k.endsWith("/**")), ...bizNew.map((k) => `new: ${k}`)].join(" "));
check(`directories byte-identical (${BUSINESS_DIRS.join(", ")})`, bizDrift.filter((k) => k.endsWith("/**")).length === 0, bizDrift.filter((k) => k.endsWith("/**")).join(" "));

// ---------- 5. prerequisites ----------
section("5. P0 / P0.1 / P0.2 contracts");
for (const c of CONTRACTS) {
  const got = contract(c);
  const missing = c.must.filter((re) => !got.text.some((t) => re.test(t)));
  check(c.id, got.text.length === c.count && missing.length === 0 && got.hash === pins.contracts[c.id],
    `${got.text.length}/${c.count} found; ${missing.map(String).join(" ")} ${got.hash === pins.contracts[c.id] ? "" : "(section changed)"}`);
}
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
const chain = pkg.scripts["verify:static"] ?? "";
check("verify:static still runs number-locale (P0), date-timezone (P0.1), business-dates (P0.2) and page-archetypes",
  ["verify:number-locale", "verify:date-timezone", "verify:business-dates", "verify:page-archetypes"].every((s) => chain.includes(`npm run ${s}`)) &&
    pkg.scripts["verify:page-archetypes"] === "tsx verify/verify-page-archetypes.mts");
check("the prerequisites' browser suites are still in place (AR locale, settings time zone, business-date hydration)",
  ["verify/verify-ar-locale-hydration.mjs", "verify/verify-settings-timezone-hydration.mjs", "verify/verify-business-date-hydration.mjs"].every((f) => existsSync(path.join(ROOT, f))));

// ---------- 6. primitives ----------
section("6. primitives");
type Props = Record<string, { type: string; optional: boolean }>;
/** The props type of a component: the type literal of its first parameter (intersections flattened). */
function propsOf(file: string, name: string): Props {
  const fn = findAll(parse(file), fnNamed(name))[0] as ts.FunctionDeclaration | undefined;
  const out: Props = {};
  const add = (t: ts.TypeNode | undefined) => {
    if (!t) return;
    if (ts.isIntersectionTypeNode(t)) t.types.forEach(add);
    else if (ts.isTypeLiteralNode(t)) {
      for (const m of t.members) if (ts.isPropertySignature(m) && m.type) out[m.name.getText()] = { type: m.type.getText(), optional: !!m.questionToken };
    } else if (ts.isTypeReferenceNode(t)) out[`(${t.getText()})`] = { type: t.getText(), optional: false };
  };
  add(fn?.parameters[0]?.type);
  return out;
}
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const headings = (s: string) => [...s.matchAll(/<(h[1-6])\b/g)].map((m) => m[1]);
// Physical direction (DEV-UI-01.0 G1): Tailwind utilities inside strings, and inline-style keys.
const TW_PHYSICAL = /(?<=^|[\s"'`:{(])-?(ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-(?:\[[^\]]+\]|\d[\d./]*|auto|px|full)(?=$|[\s"'`}),])|(?<=^|[\s"'`:{(])(text-left|text-right|float-left|float-right|clear-left|clear-right|border-l|border-r|rounded-l|rounded-r)(?=$|[\s"'`}),])/g;
const JS_PHYSICAL = /\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft\w*|borderRight\w*|left|right)\s*:|textAlign:\s*["'](?:left|right)["']/g;
function physical(file: string): string[] {
  const sf = parse(file);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
      for (const m of n.text.matchAll(TW_PHYSICAL)) out.push(m[0]);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const code = sf.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const m of code.matchAll(JS_PHYSICAL)) out.push(m[0]);
  return out;
}
const imports = (file: string) => moduleSpecs(parse(file)).map((s) => s.spec);
/** Identifiers and strings that would mean a primitive knows where it is: routing, the URL, the session. */
function routeAware(file: string): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && /^(usePathname|useRouter|useSearchParams|useParams|useSelectedLayoutSegments?|redirect|location|pathname|router|navigator|window|document|cookies|headers|session)$/.test(n.text)) out.push(n.text);
    const r = routeLiteral(n);
    if (r) out.push(r);
    ts.forEachChild(n, visit);
  };
  visit(parse(file));
  return out;
}

// SectionHeader
const SHF = "src/components/ui/section-header.tsx";
const shProps = propsOf(SHF, "SectionHeader");
check("SectionHeader: the locked API — title, level?: 2 | 3, id?, description?, meta?, actions?, className? — and nothing else",
  same(shProps, {
    title: { type: "React.ReactNode", optional: false }, level: { type: "2 | 3", optional: true }, id: { type: "string", optional: true },
    description: { type: "React.ReactNode", optional: true }, meta: { type: "React.ReactNode", optional: true }, actions: { type: "React.ReactNode", optional: true },
    className: { type: "string", optional: true },
  }), JSON.stringify(shProps));
const shDefault = html(h(SectionHeader, { title: "Invoices" }));
check("SectionHeader: defaults to a real <h2> with text-title-sm / 600", same(headings(shDefault), ["h2"]) && shDefault.includes('<h2 class="text-title-sm font-semibold text-ink">Invoices</h2>'), shDefault);
const sh3 = html(h(SectionHeader, { title: "Lines", level: 3, id: "lines-h" }));
check("SectionHeader: level 3 is a real <h3> with text-body-lg / 600, and id lands on the heading",
  same(headings(sh3), ["h3"]) && sh3.includes('<h3 id="lines-h" class="text-body-lg font-semibold text-ink">Lines</h3>'), sh3);
const shForced = [1, 4, 5, 6].map((level) => headings(html(h(SectionHeader, { title: "X", level: level as 2 }))).join(""));
check("SectionHeader: no other level can come out — 1, 4, 5 and 6 from an untyped caller still render <h2>", shForced.every((x) => x === "h2"), shForced.join(" "));
const shFull = html(h(SectionHeader, { title: "Recent activity", id: "ra", description: "Last 30 days", meta: "12 items", actions: h("button", { type: "button" }, "View all") }));
const shHeading = shFull.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1];
check("SectionHeader: description, meta and actions render outside the heading (the heading holds only the title)",
  shHeading === "Recent activity" && /<\/h2><p class="mt-0\.5 text-body-sm text-ink-muted">Last 30 days<\/p>/.test(shFull) && />12 items</.test(shFull) && /<button type="button">View all<\/button>/.test(shFull), shFull);
const shEmpty = html(h(SectionHeader, { title: "T", description: false, meta: "", actions: null }));
check("SectionHeader: empty slots (false, \"\", null) render nothing", !/<p|text-body-sm|gap-2/.test(shEmpty), shEmpty);
check("SectionHeader: flex row with gaps that wraps — logical layout, no physical left / right", /^<div data-slot="section-header" class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2"/.test(shDefault) && physical(SHF).length === 0, physical(SHF).join(" "));
check("SectionHeader: imports only react and the cn helper; no router, pathname, session or route strings",
  same(imports(SHF).sort(), ["@/lib/utils", "react"]) && routeAware(SHF).length === 0, [...imports(SHF), ...routeAware(SHF)].join(" "));
const shTags = findAll(parse(SHF), (n) => ts.isStringLiteral(n) && /^h[1-6]$/.test(n.text)).map((n) => (n as ts.StringLiteral).text).sort();
check("SectionHeader: the only heading elements in its source are h2 and h3", same(shTags, ["h2", "h3"]), shTags.join(" "));

// EmptyState
const ESF = "src/components/ui/empty-state.tsx";
const esProps = propsOf(ESF, "EmptyState");
check("EmptyState: the locked API — message, hint?, action?, className? — and nothing else",
  same(esProps, { message: { type: "React.ReactNode", optional: false }, hint: { type: "React.ReactNode", optional: true }, action: { type: "React.ReactNode", optional: true }, className: { type: "string", optional: true } }),
  JSON.stringify(esProps));
const es = html(h(EmptyState, { message: "No clients yet.", hint: "Add your first client.", action: h("a", { href: "/x" }, "Add") }));
check("EmptyState: the DEV-UI-01.5 list-card surface (rounded-xl, border-line, bg-surface, py-12, px-6), centred",
  /^<div data-slot="empty-state" class="rounded-xl border border-line bg-surface py-12 px-6 text-center">/.test(es), es);
check("EmptyState: message, hint and action in the ListEmptyState type scale",
  es.includes('<p class="text-body text-ink-muted">No clients yet.</p><p class="mt-1.5 text-body-sm text-ink-faint">Add your first client.</p><div class="mt-5 flex flex-wrap items-center justify-center gap-2"><a href="/x">Add</a></div>'), es);
const esBare = html(h(EmptyState, { message: "Nothing", hint: false, action: null, className: "mt-4" }));
check("EmptyState: no hint / action markup when they are absent; className merges", esBare === '<div data-slot="empty-state" class="rounded-xl border border-line bg-surface py-12 px-6 text-center mt-4"><p class="text-body text-ink-muted">Nothing</p></div>', esBare);
check("EmptyState: imports only react and the cn helper; no route awareness; no physical left / right",
  same(imports(ESF).sort(), ["@/lib/utils", "react"]) && routeAware(ESF).length === 0 && physical(ESF).length === 0, [...imports(ESF), ...routeAware(ESF), ...physical(ESF)].join(" "));
check("ListEmptyState byte-identical to 1bfdbbf, and neither empty state imports the other",
  now.listEmptyState === pins.listEmptyState && !read(SH + "list-empty-state.tsx").includes("empty-state\"") && !imports(ESF).some((s) => s.includes("list-empty-state")));
check("ListEmptyState still serves its 9 lists — the 8 document lists and Projects (not replaced by EmptyState)", same(now.consumers.ListEmptyState, pins.consumers.ListEmptyState) && pins.consumers.ListEmptyState.length === 9,
  delta(pins.consumers.ListEmptyState, now.consumers.ListEmptyState));

// CardTitle (+ the rest of the Card family, unchanged)
// Markup captured from the 1bfdbbf components.
const CARD_1BFDBBF: [string, () => string, string][] = [
  ["Card", () => html(h(Card, null, "x")), '<div data-slot="card" class="card">x</div>'],
  ["Card (hoverable is ignored)", () => html(h(Card, { hoverable: true, className: "p-4", id: "c1" }, "x")), '<div data-slot="card" class="card p-4" id="c1">x</div>'],
  ["CardHeader", () => html(h(CardHeader, null, "x")), '<div data-slot="card-header" class="flex flex-col gap-1 px-5 pt-5">x</div>'],
  ["CardTitle", () => html(h(CardTitle, null, "Contact")), '<div data-slot="card-title" class="text-title-sm font-semibold text-ink">Contact</div>'],
  ["CardTitle with class / id / aria", () => html(h(CardTitle, { className: "text-body-lg mb-2", id: "t1", "aria-label": "Lbl" }, "Contact")),
    '<div data-slot="card-title" class="font-semibold text-ink text-body-lg mb-2" id="t1" aria-label="Lbl">Contact</div>'],
  ["CardDescription", () => html(h(CardDescription, null, "x")), '<div data-slot="card-description" class="text-xs text-ink-muted">x</div>'],
  ["CardContent", () => html(h(CardContent, { className: "pt-5" }, "x")), '<div data-slot="card-content" class="px-5 pb-5 pt-5">x</div>'],
  ["CardFooter", () => html(h(CardFooter, null, "x")), '<div data-slot="card-footer" class="flex items-center px-5 pb-5">x</div>'],
];
const cardDiff = CARD_1BFDBBF.filter(([, render, want]) => render() !== want);
check("Card family renders exactly the 1bfdbbf markup — CardTitle still a <div> by default, same classes", cardDiff.length === 0, cardDiff.map(([n, r]) => `${n}: ${r()}`).join(" | "));
const ctProps = propsOf("src/components/ui/card.tsx", "CardTitle");
check('CardTitle: `as` accepts only "div" | "h2" | "h3", defaulting to "div"',
  ctProps.as?.type === '"div" | "h2" | "h3"' && ctProps.as.optional && /\bas: Comp = "div"/.test(read("src/components/ui/card.tsx")), JSON.stringify(ctProps));
const ctH2 = html(h(CardTitle, { as: "h2", id: "h" }, "Contact"));
const ctH3 = html(h(CardTitle, { as: "h3" }, "Contact"));
check("CardTitle as h2 / h3: the same slot and classes on a real heading, and `as` never reaches the DOM",
  ctH2 === '<h2 data-slot="card-title" class="text-title-sm font-semibold text-ink" id="h">Contact</h2>' && ctH3 === '<h3 data-slot="card-title" class="text-title-sm font-semibold text-ink">Contact</h3>', `${ctH2} ${ctH3}`);
// C1: the four CardTitle consumers are the entity-detail side cards; each now passes as="h2"
// (group 9 checks the value). No other CardTitle passes `as`.
const ctAs = now.consumers.CardTitle.filter((u) => / as\b/.test(u));
check(`CardTitle consumers as pinned (${pins.consumers.CardTitle.length}); \`as\` only on the C1 entity-detail side cards (${ctAs.length})`,
  same(now.consumers.CardTitle, pins.consumers.CardTitle) && ctAs.length === 4 && ctAs.every((u) => C1_DETAIL.some((f) => u.startsWith(`${f}: `))), delta(pins.consumers.CardTitle, now.consumers.CardTitle));

// StatRow
const SRF = SH + "stat-row.tsx";
const srProps = propsOf(SRF, "StatRow");
const srItem = findAll(parse(SRF), (n) => ts.isTypeAliasDeclaration(n) && n.name.text === "StatItem")[0] as ts.TypeAliasDeclaration | undefined;
const srValue = srItem && ts.isTypeLiteralNode(srItem.type) ? srItem.type.members.find((m) => m.name?.getText() === "value") : undefined;
check("StatRow: `value` is a React.ReactNode (a <Money> can go in)", !!srValue && ts.isPropertySignature(srValue) && srValue.type?.getText() === "React.ReactNode" && !srValue.questionToken);
check("StatRow: `columns` accepts only 2 | 3 | 4, and is optional", same(srProps, { items: { type: "StatItem[]", optional: false }, columns: { type: "2 | 3 | 4", optional: true } }), JSON.stringify(srProps));
const srItems = [
  { label: "Total Credit Notes", value: "12" },
  statusStat("en", "credit_note", "issued", 5),
  statusStat("ar", "sales_invoice", "partially_paid", 2),
  { label: "This Month", value: "3", colorClass: "text-success" },
];
// Markup captured from the 1bfdbbf StatRow for the same items.
const KPI = (label: string, cls: string, value: string, attrs = "") =>
  `<div class="card" style="padding:16px 18px"${attrs}><div class="kpi-label" style="font-size:11.5px;color:var(--ink-muted)">${label}</div><div class="kpi-value ${cls}" style="font-family:var(--font-display);font-weight:800;font-size:20px;margin-top:4px">${value}</div></div>`;
const SR_1BFDBBF = `<div class="stat-row-2">${KPI("Total Credit Notes", "", "12")}${KPI("Issued", "text-corrective", "5", ' data-status-domain="credit_note" data-status="issued" data-tone="corrective"')}${KPI("مدفوع جزئيًا", "text-warning", "2", ' data-status-domain="sales_invoice" data-status="partially_paid" data-tone="warning"')}${KPI("This Month", "text-success", "3")}</div>`;
const srNow = html(h(StatRow, { items: srItems }));
check("StatRow without `columns` renders exactly the 1bfdbbf markup — no data-columns, no style on the row, weight 800 kept", srNow === SR_1BFDBBF && html(h(StatRow, { items: [] })) === '<div class="stat-row-2"></div>', srNow);
const srBad = [5, 1, 0, 3.5, "3", null].map((c) => html(h(StatRow, { items: srItems, columns: c as 2 })));
check("StatRow: any other `columns` from an untyped caller falls back to the default row", srBad.every((x) => x === SR_1BFDBBF));
const srCols = ([2, 3, 4] as const).map((c) => html(h(StatRow, { items: srItems.slice(0, 1), columns: c })));
// D-6 (C2): `columns` sets --stat-cols; the .stat-row-2 rule owns the grid, so its ≤640px rule reaches
// every row — an inline grid-template-columns (C0's first form) would beat that media rule.
check("StatRow columns 2 / 3 / 4: the same .stat-row-2 row with --stat-cols set (D-6) — no inline grid-template-columns to beat the phone rule",
  srCols.every((x, i) => x.startsWith(`<div class="stat-row-2" data-columns="${i + 2}" style="--stat-cols:${i + 2}">`)) &&
    !/grid-template-columns/.test(srCols.join("")) && !/gridTemplateColumns|grid-template-columns/.test(codeOnly(read(SRF))), srCols.join(" "));
const srNode = html(h(StatRow, { items: [{ label: "Balance", value: h("span", { className: "money" }, "SAR 1,250.00") }] }));
check("StatRow: a ReactNode value renders inside the kpi-value", srNode.includes('margin-top:4px"><span class="money">SAR 1,250.00</span></div>'), srNode);
// C3: the project detail's summary and Cost & Profitability rows are StatRows too — the only two that pass
// `columns` (2 and 3; group 11 checks the values).
const srWithColumns = now.consumers.StatRow.filter((u) => / columns\b/.test(u)).map((u) => u.slice(0, u.indexOf(": <")));
check(`StatRow consumers as pinned (${pins.consumers.StatRow.length}) — C0's nine, the Employees and Payroll strips (C2), the project summary and Cost & Profitability (C3); only C3's two pass \`columns\``,
  same(now.consumers.StatRow, pins.consumers.StatRow) && now.consumers.StatRow.length === 13 && same(srWithColumns, C3_STATROWS) &&
    [...C2_STATROWS, ...C3_STATROWS].every((f) => now.consumers.StatRow.some((u) => u.startsWith(`${f}: `))), delta(pins.consumers.StatRow, now.consumers.StatRow));
// D-6 (approved; C2): every KPI row is --stat-cols columns (default 4) on minmax(0, 1fr) tracks, and two
// across at ≤640px. These are the only rules naming .stat-row-2.
const D6_RULES = [
  `${A}mockup-parity.css: .stat-row-2 { display: grid; grid-template-columns: repeat(var(--stat-cols, 4), minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }`,
  `${A}mockup-parity.css: @media (max-width: 640px) > .stat-row-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }`,
];
check("D-6: .stat-row-2 is --stat-cols columns (default 4) of minmax(0, 1fr), and two across at ≤640px — the only rules for it",
  same(now.css[".stat-row-2"], D6_RULES) && same(now.css[".stat-row-2"], pins.css[".stat-row-2"]), now.css[".stat-row-2"].join(" | "));
check("StatRow / CardTitle: no physical left / right; StatRow still imports only status-registry types",
  physical(SRF).length === 0 && physical("src/components/ui/card.tsx").length === 0 && same(imports(SRF), ["@/lib/status-registry"]) && /^import type /m.test(read(SRF)));

// formatDisplayDate
const FDF = "src/lib/i18n/format-date.ts";
const fdSf = parse(FDF);
const fdFn = findAll(fdSf, fnNamed("formatDisplayDate"))[0] as ts.FunctionDeclaration | undefined;
check("formatDisplayDate(value: Date | string, locale: Locale, style: DisplayDateStyle) — three parameters, no options bag",
  !!fdFn && fdFn.parameters.map((p) => `${p.name.getText()}: ${p.type?.getText()}`).join(", ") === "value: Date | string, locale: Locale, style: DisplayDateStyle" && hasModifier(fdFn, ts.SyntaxKind.ExportKeyword));
const fdStyle = findAll(fdSf, (n) => ts.isTypeAliasDeclaration(n) && n.name.text === "DisplayDateStyle")[0] as ts.TypeAliasDeclaration | undefined;
check('formatDisplayDate: three shapes only — "date" | "dateTime" | "monthYear"', fdStyle?.type.getText() === '"date" | "dateTime" | "monthYear"', fdStyle?.type.getText());
const formatters = findAll(fdSf, (n) => (ts.isNewExpression(n) || ts.isCallExpression(n)) && n.expression.getText().replace(/^globalThis\./, "") === "Intl.DateTimeFormat") as (ts.NewExpression | ts.CallExpression)[];
const fmtProblems: string[] = [];
const locCount: Record<string, number> = {};
for (const f of formatters) {
  const [loc, opts] = f.arguments ?? [];
  const at = `line ${fdSf.getLineAndCharacterOfPosition(f.getStart()).line + 1}`;
  if (!loc || !ts.isStringLiteral(loc)) fmtProblems.push(`${at}: the locale is not written out`);
  else if (!["en-US", "ar-SA-u-ca-gregory-nu-latn"].includes(loc.text)) fmtProblems.push(`${at}: locale "${loc.text}"`);
  else locCount[loc.text] = (locCount[loc.text] ?? 0) + 1;
  if (!opts || !ts.isObjectLiteralExpression(opts)) fmtProblems.push(`${at}: options are not an object literal`);
  else {
    for (const p of opts.properties) {
      if (!ts.isPropertyAssignment(p)) fmtProblems.push(`${at}: ${p.getText()} (spread / shorthand)`);
      else if (!["year", "month", "day", "hour", "minute", "timeZone"].includes(p.name.getText())) fmtProblems.push(`${at}: option ${p.name.getText()}`);
    }
    const tz = opts.properties.find((p) => p.name?.getText() === "timeZone");
    if (!tz || !ts.isPropertyAssignment(tz) || !ts.isStringLiteral(tz.initializer) || tz.initializer.text !== "UTC") fmtProblems.push(`${at}: timeZone is not the literal "UTC"`);
  }
}
check('formatDisplayDate: six formatters, each with a written-out locale — en-US ×3, ar-SA-u-ca-gregory-nu-latn ×3 — and an explicit timeZone: "UTC"',
  formatters.length === 6 && fmtProblems.length === 0 && locCount["en-US"] === 3 && locCount["ar-SA-u-ca-gregory-nu-latn"] === 3, fmtProblems.join("; ") || JSON.stringify(locCount));
const fdCode = fdSf.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const inference = [/\bnavigator\b/, /resolvedOptions/, /\bprocess\b/, /toLocale(Date|Time)?String/, /getTimezoneOffset/, /Riyadh/, /\bcalendar\b/, /numberingSystem/, /hour12|hourCycle/, /localeMatcher/, /Intl\.Locale/, /\bundefined\b/, /"default"/]
  .filter((re) => re.test(fdCode));
check("formatDisplayDate: no runtime inference — no navigator, resolvedOptions, process / host zone, toLocale*String, Riyadh, calendar / numbering / hour-cycle overrides",
  inference.length === 0, inference.map(String).join(" "));
check("formatDisplayDate: imports nothing at runtime (the Locale type only)", same(imports(FDF), ["./dict"]) && /^import type \{ Locale \} from "\.\/dict";$/m.test(fdSf.text));

// The behaviour, in child processes whose host time zone and locale differ. Spelled out, not
// computed: the oracle owes nothing to Intl.
const EXPECTED: [string, string, string, string, string, string, string][] = [
  ["2026-06-15T09:00:00Z", "Jun 15, 2026", "Jun 15, 2026, 09:00 AM", "June 2026", "15 يونيو 2026", "15 يونيو 2026، 09:00 ص", "يونيو 2026"],
  ["2026-10-08T23:30:00Z", "Oct 8, 2026", "Oct 8, 2026, 11:30 PM", "October 2026", "8 أكتوبر 2026", "8 أكتوبر 2026، 11:30 م", "أكتوبر 2026"],
  ["2026-10-09T00:30:00Z", "Oct 9, 2026", "Oct 9, 2026, 12:30 AM", "October 2026", "9 أكتوبر 2026", "9 أكتوبر 2026، 12:30 ص", "أكتوبر 2026"],
  ["2026-12-31T23:59:59Z", "Dec 31, 2026", "Dec 31, 2026, 11:59 PM", "December 2026", "31 ديسمبر 2026", "31 ديسمبر 2026، 11:59 م", "ديسمبر 2026"],
  ["2027-01-01T00:00:00Z", "Jan 1, 2027", "Jan 1, 2027, 12:00 AM", "January 2027", "1 يناير 2027", "1 يناير 2027، 12:00 ص", "يناير 2027"],
  ["2026-03-08T06:45:00Z", "Mar 8, 2026", "Mar 8, 2026, 06:45 AM", "March 2026", "8 مارس 2026", "8 مارس 2026، 06:45 ص", "مارس 2026"],
];
const STYLES = ["date", "dateTime", "monthYear"] as const;
const ZONES = ["UTC", "Asia/Riyadh", "America/New_York", "Asia/Dhaka", "Pacific/Kiritimati", "Pacific/Pago_Pago"];
const HOST_LOCALES = ["en_US.UTF-8", "ar_SA.UTF-8", "C"];
const js = ts.transpileModule(fdSf.text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const CHILD = `
const m = { exports: {} };
new Function("module", "exports", "require", process.env.FD_JS)(m, m.exports, (s) => { throw new Error("format-date.ts must not import " + s); });
const f = m.exports.formatDisplayDate;
const out = {};
for (const i of JSON.parse(process.env.FD_INSTANTS)) for (const l of ["en", "ar"]) for (const s of ["date", "dateTime", "monthYear"]) {
  out[i + "|" + l + "|" + s] = f(new Date(i), l, s);
  out["string " + i + "|" + l + "|" + s] = f(i, l, s);
}
out.invalid = JSON.stringify([f("not a date", "en", "date"), f(new Date(NaN), "ar", "dateTime"), f("", "ar", "monthYear")]);
const r = new Intl.DateTimeFormat().resolvedOptions();
console.log(JSON.stringify({ zone: r.timeZone, locale: r.locale, digits: r.numberingSystem, out }));
`;
const runs = ZONES.flatMap((zone) =>
  HOST_LOCALES.map((loc) => {
    const r = spawnSync(process.execPath, ["-e", CHILD], {
      encoding: "utf8",
      // A clean environment: only the zone and locale under test (and PATH) reach the child.
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", TZ: zone, LC_ALL: loc, LANG: loc, FD_JS: js, FD_INSTANTS: JSON.stringify(EXPECTED.map((e) => e[0])) },
    });
    const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("{"));
    return { zone, loc, res: line ? (JSON.parse(line) as { zone: string; locale: string; digits: string; out: Record<string, string> }) : null, err: r.stderr };
  }),
);
check(`formatDisplayDate ran in ${runs.length} child processes (${ZONES.length} host time zones × ${HOST_LOCALES.length} host locales)`, runs.every((r) => r.res), runs.find((r) => !r.res)?.err.slice(0, 300));
if (runs.every((r) => r.res)) {
  const ok = runs.map((r) => ({ ...r, res: r.res! }));
  check("…and each child really had its zone and locale in effect (ar_SA defaults to Arabic-Indic digits — the trap)",
    ok.every((r) => r.res.zone === r.zone && r.res.locale === (r.loc.startsWith("ar") ? "ar-SA" : "en-US")) && ok.filter((r) => r.loc.startsWith("ar")).every((r) => r.res.digits === "arab"),
    ok.map((r) => `${r.zone}/${r.loc}: ${r.res.zone} ${r.res.locale} ${r.res.digits}`).join(", "));
  const keys = Object.keys(ok[0].res.out);
  const diverge = keys.filter((k) => ok.some((r) => r.res.out[k] !== ok[0].res.out[k]));
  check("identical output in every host zone and locale", diverge.length === 0, diverge.slice(0, 5).map((k) => `${k}: ${ok.map((r) => r.res.out[k]).join(" · ")}`).join("\n          "));
  const wrong: string[] = [];
  for (const [i, ...want] of EXPECTED)
    (["en", "ar"] as const).forEach((l, li) => STYLES.forEach((s, si) => {
      const w = want[li * 3 + si];
      for (const k of [`${i}|${l}|${s}`, `string ${i}|${l}|${s}`]) if (ok[0].res.out[k] !== w) wrong.push(`${k}: "${ok[0].res.out[k]}" ≠ "${w}"`);
    }));
  check("the exact strings: en-US and Arabic, the calendar day of the instant in UTC (23:30 UTC is still the 8th, 00:30 the 9th), Date or ISO string alike",
    wrong.length === 0, wrong.slice(0, 6).join("\n          "));
  const all = Object.values(ok[0].res.out).join(" ");
  check("Western digits only — no Arabic-Indic (٠–٩) or extended (۰–۹) digits anywhere", !/[٠-٩۰-۹]/.test(all));
  const GREGORIAN_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  const arOut = Object.entries(ok[0].res.out).filter(([k]) => k.includes("|ar|")).map(([, v]) => v);
  check("Arabic is Gregorian: every Arabic date names a Gregorian month, and no Hijri era (هـ) or Hijri month appears",
    arOut.length > 0 && arOut.every((v) => GREGORIAN_AR.some((mo) => v.includes(mo))) && !/هـ|محرم|صفر|ربيع|جمادى|رجب|شعبان|رمضان|شوال|ذو القعدة|ذو الحجة/.test(all));
  check('an invalid date formats as "" (never "Invalid Date")', ok[0].res.out.invalid === '["","",""]', ok[0].res.out.invalid);
}
const resolved = (["en", "ar"] as const).flatMap((l) => STYLES.map((s) => formatDisplayDate("2026-06-15T09:00:00Z", l, s)));
check("in this process too (the verifier's own zone and locale) the output is the expected one", same(resolved, EXPECTED[0].slice(1)), resolved.join(" | "));
check("consumers: formatDisplayDate on exactly the three planned date surfaces — Attendance's date pill and Payroll's title month (C2), the Dashboard's recent-activity times (C6)",
  same(now.consumers.formatDisplayDate, pins.consumers.formatDisplayDate) && same(now.consumers.formatDisplayDate, [C6_PAGE, `${HR}attendance/page.tsx`, `${HR}payroll/page.tsx`]),
  now.consumers.formatDisplayDate.join(" "));
const fileOf = (u: string) => u.slice(0, u.indexOf(": <"));
// C8 (D-2) took the project_health badge out of Cost & Profitability's SectionHeader (its meta): that one entry is undone
// before the pinned inventory is compared — group 16 proves it is C8's only SectionHeader change.
const D2_SECTION_HEADER: [string, string] = [`${C3_COST}: <SectionHeader className level meta title>`, `${C3_COST}: <SectionHeader className level title>`];
const sectionHeadersC7 = (() => {
  const l = [...now.consumers.SectionHeader];
  const i = l.indexOf(D2_SECTION_HEADER[1]);
  if (i >= 0) l[i] = D2_SECTION_HEADER[0];
  return l.sort();
})();
check("consumers: SectionHeader on the client / vendor Statement of Account (C1), Salary Structure / Past payroll runs (C2), the project detail's six sections (C3) and the selected report, the selected ledger account and the journal / bank secondary sections (C4), the 13 Settings panel titles, Security's Active Sessions / Security Timeline and Compliance's three sections (C5) — C8's D-2 meta removal undone (group 16); EmptyState in the three master-data bins (C1), the five HR empty states (C2), the project detail's three (C3), the six finance empty messages (C4) and the Security Timeline's (C5)",
  same(sectionHeadersC7, pins.consumers.SectionHeader) && same(now.consumers.EmptyState, pins.consumers.EmptyState) &&
    same(now.consumers.SectionHeader.map(fileOf), [`${A}clients/[id]/page.tsx`, `${HR}employees/[id]/page.tsx`, `${HR}payroll/page.tsx`, `${A}purchasing/vendors/[id]/page.tsx`,
      C3_COST, C3_COST, C3_COST, C3_KANBAN, C3_DETAIL, C3_DETAIL, C4_REPORTS, C4_ACCOUNT_VIEW, C4_JOURNAL, C4_BANK,
      ...C5_PANELS.map(([f]) => f), C5_SECURITY, C5_SECURITY, C5_COMPLIANCE, C5_COMPLIANCE, C5_COMPLIANCE].sort()) &&
    same(now.consumers.EmptyState.map(fileOf), [...C1_BINS, ...C2_EMPTY, C3_KANBAN, C3_DETAIL, C3_DETAIL, C4_ACCOUNT_VIEW, C4_ACCOUNT_VIEW, C4_PAYMENTS, C4_JOURNAL, C4_BANK, C4_BANK,
      C5_SECURITY].sort()),
  [...now.consumers.SectionHeader, ...now.consumers.EmptyState].join(" "));

// ---------- 7. no abstraction creep ----------
section("7. no abstraction creep");
const BANNED = ["PageLayout", "MasterDataShell", "ReportShell", "DashboardSection", "EntityDetailHeader", "SettingsSection"];
const BANNED_FILES = BANNED.map((b) => b.replace(/[A-Z]/g, (c, i) => (i ? "-" : "") + c.toLowerCase()));
const creep: string[] = [];
for (const f of walk("src").filter((f) => /\.(tsx?|css)$/.test(f))) {
  const base = path.posix.basename(f).replace(/\.[^.]+$/, "");
  if (BANNED_FILES.includes(base)) creep.push(`${f} (file)`);
  if (!/\.tsx?$/.test(f) || !BANNED.some((b) => read(f).includes(b))) continue;
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && BANNED.includes(n.text)) creep.push(`${f}: ${n.text}`);
    ts.forEachChild(n, visit);
  };
  visit(parse(f));
}
check(`none of the rejected abstractions exist — ${BANNED.join(", ")}`, creep.length === 0, creep.join(" "));
const PRIMS = [SHF, ESF, FDF, "src/components/ui/card.tsx", SRF, PHF];
const aware = PRIMS.flatMap((f) => routeAware(f).map((x) => `${f}: ${x}`));
const domainImports = PRIMS.flatMap((f) => imports(f).filter((s) => /^(next\/|@\/db|@\/app|@\/lib\/(session|tenant|auth|role-matrix))/.test(s)).map((s) => `${f}: ${s}`));
check("the shared primitives (and C1's PageHeader) do not branch on routes or domains: no router / pathname / session, no route strings, no app / DB / session imports",
  aware.length === 0 && domainImports.length === 0, [...aware, ...domainImports].join(" "));
const phProps = propsOf(PHF, "PageHeader");
const props = [shProps, esProps, phProps].flatMap((p) => Object.keys(p));
check("no business-domain props on the new primitives (title / level / id / description / meta / actions / message / hint / action / className only)",
  props.every((k) => ["title", "level", "id", "description", "meta", "actions", "className", "message", "hint", "action"].includes(k)), props.join(" "));

// ---------- 8. actions (static) ----------
section("8. action inventory (static half)");
const actDrift = pins.routes.scope.filter((p) => !same(now.actions[p], pins.actions[p]));
const nActs = Object.values(pins.actions).reduce((n, a) => n + a.length, 0);
check(`link targets and server actions of the 36 pages unchanged (${nActs} pinned, through page-local imports)`, actDrift.length === 0,
  actDrift.map((p) => `${p}\n          ${delta(pins.actions[p], now.actions[p])}`).join("\n          "));
const emptyInventory = pins.routes.scope.filter((p) => now.actions[p].length === 0);
check("every page has an inventory (the scan is not silently empty)", emptyInventory.length === 0, emptyInventory.join(" "));

// ---------- 9. C1 — master data and entity detail ----------
section("9. C1 — master data and entity detail");
/** Source without comments, so a check never matches its own explanation. */
const strip = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
type El = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
const jsxEls = (f: string, tag: string) => findAll(parse(f), (n) => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === tag) as El[];
const attr = (el: El, name: string) => el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
const rel = (f: string) => f.replace(A, "");

// PageHeader, evolved in place (D-9)
check("PageHeader: the C1 API — title, description?, meta?, actions? (React.ReactNode), className? — and nothing else",
  same(phProps, {
    title: { type: "React.ReactNode", optional: false },
    description: { type: "React.ReactNode", optional: true },
    meta: { type: "React.ReactNode", optional: true },
    actions: { type: "React.ReactNode", optional: true },
    className: { type: "string", optional: true },
  }), JSON.stringify(phProps));
const PH_ROW = '<div data-slot="page-header" class="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-6';
const PH_H1 = '<h1 class="text-page font-semibold break-words">';
const phFull = html(h(PageHeader, { title: "Al Noor Contracting (Fictional)", description: "Client profile", meta: h("span", null, "Active"), actions: h("button", { type: "button" }, "Actions") }));
check("PageHeader: the C1 markup — one wrapping flex row (flex-wrap, items-start, justify-between, gap-x-4 / gap-y-3), a min-w-0 title column with the h1 and the description, then one group: meta, then actions",
  phFull === `${PH_ROW}"><div class="min-w-0">${PH_H1}Al Noor Contracting (Fictional)</h1><p class="mt-1 text-body-lg text-ink-muted">Client profile</p></div>` +
    '<div class="flex min-w-0 flex-wrap items-center gap-2"><div data-slot="page-header-meta" class="flex flex-wrap items-center gap-2"><span>Active</span></div>' +
    '<div data-slot="page-header-actions" class="flex flex-wrap items-center gap-2"><button type="button">Actions</button></div></div></div>', phFull);
const phH1 = phFull.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1];
const phNode = html(h(PageHeader, { title: h("span", null, "X"), description: h("strong", null, "D"), meta: "M", actions: "A" }));
check("PageHeader: exactly one <h1>, holding only the title — description, meta and actions render outside it (string or element title alike)",
  same(headings(phFull), ["h1"]) && phH1 === "Al Noor Contracting (Fictional)" && same(headings(phNode), ["h1"]) && phNode.includes(`${PH_H1}<span>X</span></h1>`), `${phFull} ${phNode}`);
const phMeta = html(h(PageHeader, { title: "T", meta: "M" }));
const phActs = html(h(PageHeader, { title: "T", actions: "A" }));
const iMeta = phFull.indexOf('data-slot="page-header-meta"');
const iActs = phFull.indexOf('data-slot="page-header-actions"');
check("PageHeader: meta after the title and before the actions; each group only when it is given",
  phFull.indexOf("</h1>") < iMeta && iMeta < iActs && phMeta.includes("page-header-meta") && !phMeta.includes("page-header-actions") && phActs.includes("page-header-actions") && !phActs.includes("page-header-meta"),
  `${phMeta} ${phActs}`);
const phBare = html(h(PageHeader, { title: "Products", description: false, meta: "", actions: null, className: "mt-2" }));
check('PageHeader: empty slots (false, "", null) render nothing; className merges onto the row', phBare === `${PH_ROW} mt-2"><div class="min-w-0">${PH_H1}Products</h1></div></div>`, phBare);
const phCode = strip(read(PHF));
const phLayout = [/\babsolute\b/, /\bfixed\b/, /\bsticky\b/, /\binset-/, /\btranslate-/, /(?<![\w-])w-(\d|\[|full|screen)/, /(?<![\w-])max-w-/, /(?<![\w-])min-w-(?!0\b)/, /\bshrink-0\b/, /\bflex-nowrap\b/, /font-extrabold|font-bold|text-2xl/]
  .filter((re) => re.test(phCode));
check("PageHeader: a text-page / 600 title (no font-extrabold, no text-2xl) that wraps in a min-w-0 column; logical layout only — no left / right, no fixed width, nothing positioned, no shrink-0 group",
  phCode.includes(PH_H1.replace("class=", "className=")) && phLayout.length === 0 && physical(PHF).length === 0, [...phLayout.map(String), ...physical(PHF)].join(" "));
check("PageHeader: imports only react and the cn helper", same(imports(PHF), ["react", "@/lib/utils"]), imports(PHF).join(" "));
const phUses = now.consumers.PageHeader;
check(`PageHeader consumers: the 12 C1 pages, the 7 HR routes (C2), the 3 Projects routes (C3), the 7 finance routes (C4), the 4 Settings pages (C5) and the Dashboard (C6) — one header each, none patching it with a className (${phUses.length})`,
  same(phUses, pins.consumers.PageHeader) && same(phUses.map(fileOf).sort(), [...C1_PAGES, ...C2_HEADERS, ...C3_HEADERS, ...C4_HEADERS, ...C5_HEADERS, ...C6_HEADERS].sort()) && phUses.length === 34 &&
    !phUses.some((u) => / className\b/.test(u)),
  delta([...C1_PAGES, ...C2_HEADERS, ...C3_HEADERS, ...C4_HEADERS, ...C5_HEADERS, ...C6_HEADERS].sort(), phUses.map(fileOf).sort()));

// D-9: the layout pin narrowed — every other layout file byte-pinned, one by one
const dfPins = JSON.parse(read("verify/document-form-pins.json")) as Record<string, string>;
const layoutFiles = walk("src/components/layout");
const layoutPinned = Object.keys(dfPins).filter((k) => k.startsWith("src/components/layout/"));
const layoutDrift = layoutPinned.filter((f) => !exists(f) || sha(f) !== dfPins[f]);
check(`D-9: no src/components/layout/** directory pin; the ${layoutFiles.length - 1} other layout files byte-pinned one by one in verify/document-form-pins.json (a new, removed or changed layout file fails) — page-header.tsx alone is free, held by this group`,
  !layoutPinned.some((k) => k.endsWith("**")) && same([...layoutPinned].sort(), layoutFiles.filter((f) => f !== PHF)) && layoutDrift.length === 0 && layoutFiles.includes(PHF),
  `pinned ${layoutPinned.length}; changed ${layoutDrift.join(" ")}; unpinned ${layoutFiles.filter((f) => f !== PHF && !layoutPinned.includes(f)).join(" ")}`);

// Headings: h1 from PageHeader, then h2 sections — no hand-written headings, no h1 → h3 jump
const handHeadings = C1_PAGES.flatMap((f) => findAll(parse(f), (n) => (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && /^h[1-6]$/.test(n.tagName.getText())).map((n) => `${rel(f)}: <${(n as El).tagName.getText()}>`));
check('C1 pages: no hand-written heading and no .main-head — the h1 comes from PageHeader, the h2s from CardTitle as="h2" and SectionHeader',
  handHeadings.length === 0 && C1_PAGES.every((f) => !strip(read(f)).includes("main-head")), handHeadings.join(" "));
const cardTitles = C1_DETAIL.flatMap((f) => jsxEls(f, "CardTitle").map((el) => `${rel(f)}: as=${attr(el, "as")?.initializer?.getText() ?? "(div)"}`));
check(`C1 detail pages: every side-card title is a real <h2> — CardTitle as="h2" (${cardTitles.length}: client Details, Invoices; vendor Purchase Orders; product Stock)`,
  cardTitles.length === 4 && cardTitles.every((x) => x.endsWith('as="h2"')), cardTitles.join(" "));
const sectionHeads = C1_PAGES.flatMap((f) => jsxEls(f, "SectionHeader").map((el) => `${rel(f)}: level=${attr(el, "level")?.initializer?.getText() ?? "(default)"} title=${attr(el, "title")?.initializer?.getText()}`));
check("C1 detail pages: Statement of Account is a SectionHeader at level 2 on client and vendor detail (it was an h3 under the h1)",
  same(sectionHeads, ['clients/[id]/page.tsx: level={2} title={t(locale, "Statement of Account")}', 'purchasing/vendors/[id]/page.tsx: level={2} title={t(locale, "Statement of Account")}']), sectionHeads.join(" | "));

// Responsive entity-detail composition
const classTokens = (f: string) => findAll(parse(f), (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)).flatMap((n) => (n as ts.StringLiteral).text.split(/\s+/));
const fixedGrid = C1_PAGES.flatMap((f) => classTokens(f).filter((c) => /^(grid-cols-([2-9]|1[0-2])|col-span-([2-9]|1[0-2]))$/.test(c)).map((c) => `${rel(f)}: ${c}`));
const detailGrid = C1_DETAIL.filter((f) => !["grid-cols-1", "lg:grid-cols-3", "lg:col-span-2"].every((c) => classTokens(f).includes(c))).map(rel);
check("C1 pages: no multi-column grid below a breakpoint (no bare grid-cols-N / col-span-N); the three detail pages are one column, then form 2/3 + side 1/3 from lg (grid-cols-1 lg:grid-cols-3, lg:col-span-2)",
  fixedGrid.length === 0 && detailGrid.length === 0, [...fixedGrid, ...detailGrid.map((f) => `${f}: no responsive grid`)].join(" "));

// Page copy through t(), with Arabic
/** Literal text an expression renders as-is: strings and template text, through ?:, &&, ||, ?? and parentheses — not t()'s argument. */
const textLits = (e: ts.Expression | undefined): string[] => {
  if (!e) return [];
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
  if (ts.isTemplateExpression(e)) return [e.head.text, ...e.templateSpans.map((s) => s.literal.text)];
  if (ts.isParenthesizedExpression(e)) return textLits(e.expression);
  if (ts.isConditionalExpression(e)) return [...textLits(e.whenTrue), ...textLits(e.whenFalse)];
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return textLits(e.right);
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) return [...textLits(e.left), ...textLits(e.right)];
  return [];
};
const USER_FACING = new Set(["title", "description", "submitLabel", "label", "message", "hint", "placeholder", "aria-label", "moduleLabel", "alt"]);
const english: string[] = [];
const keysUsed = new Set<string>();
for (const f of C1_PAGES) {
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && /[A-Za-z]{2,}/.test(n.text)) english.push(`${rel(f)}: "${n.text.trim()}"`);
    if (ts.isJsxAttribute(n) && USER_FACING.has(n.name.getText()) && n.initializer) {
      const lits = ts.isStringLiteral(n.initializer) ? [n.initializer.text] : ts.isJsxExpression(n.initializer) ? textLits(n.initializer.expression) : [];
      for (const s of lits) if (/[A-Za-z]{2,}/.test(s)) english.push(`${rel(f)}: ${n.name.getText()}="${s}"`);
    }
    if (ts.isJsxExpression(n) && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) for (const s of textLits(n.expression)) if (/[A-Za-z]{2,}/.test(s)) english.push(`${rel(f)}: {"${s}"}`);
    if (ts.isCallExpression(n) && n.expression.getText() === "t" && n.arguments.length === 2) for (const k of textLits(n.arguments[1])) keysUsed.add(k);
    ts.forEachChild(n, visit);
  };
  visit(parse(f));
}
const ternaries = C1_PAGES.filter((f) => /\blocale\s*!?==?\s*["'](ar|en)["']|["'](ar|en)["']\s*!?==?\s*locale\b/.test(strip(read(f)))).map(rel);
check("C1 pages: no English typed outside t() — JSX text, user-facing props (title, description, submitLabel, label, message…), text in JSX expressions — and no inline locale ternaries",
  english.length === 0 && ternaries.length === 0, [...english, ...ternaries.map((f) => `${f}: locale ternary`)].join(" | "));
const C1_COPY = [
  "Client profile", "Vendor profile", "Save changes", "No invoices yet.", "Purchase Orders", "No purchase orders yet.", "SKU", "Stock", "Quantity on hand", "Reorder level",
  "New Vendor", "Add a vendor to order and receive against.", "Create Vendor", "New Product", "Add a product to your inventory catalog.", "Create Product", "Create Client",
  "Clients — Recycle Bin", "Vendors — Recycle Bin", "Products — Recycle Bin", "Deleted clients live here until restored or permanently deleted.",
  "Deleted vendors live here until restored or permanently deleted.", "Deleted products live here until restored or permanently deleted.", "Back to Clients", "Back to Vendors", "Back to Products",
];
const notMoved = C1_COPY.filter((k) => !keysUsed.has(k));
const noArabic = [...keysUsed].filter((k) => translate("ar", k) === k || !/[\u0600-\u06FF]/.test(translate("ar", k)));
check(`C1 pages: the ${C1_COPY.length} strings C1 moved go through t(), and every t() key on the 12 pages (${keysUsed.size}) has an Arabic entry`,
  notMoved.length === 0 && noArabic.length === 0, [...notMoved.map((k) => `not via t(): ${k}`), ...noArabic.map((k) => `no Arabic: ${k}`)].join(" | "));
const localeReads = C1_PAGES.filter((f) => now.data[f.replace("src/app/", "")]?.some((e) => e.endsWith(" const locale = await getLocale();"))).map(rel);
check("C1 pages: all 12 read the UI locale with getLocale() — New Vendor and New Product gained exactly that statement in C1 (their only data change; group 3)",
  localeReads.length === 12, C1_PAGES.map(rel).filter((f) => !localeReads.includes(f)).join(" "));

// Recycle bins: EmptyState
const binEmpty = C1_BINS.map((f) => jsxEls(f, "EmptyState").map((el) => el.attributes.properties.map((p) => p.getText()).join(" ")));
const binOld = C1_BINS.filter((f) => /py-12 text-center|from "@\/components\/ui\/card"/.test(strip(read(f)))).map(rel);
check("C1 recycle bins: an empty bin is one EmptyState with the same message (there was no action; none added); the Card py-12 recipe is gone",
  binEmpty.length === 3 && binEmpty.every((x) => same(x, ['message={t(locale, "Recycle Bin is empty.")}'])) && binOld.length === 0, `${JSON.stringify(binEmpty)} ${binOld.join(" ")}`);

// Direction and status
const physC1 = C1_PAGES.flatMap((f) => physical(f).map((x) => `${rel(f)}: ${x}`));
check("C1 pages: no physical left / right (none in C0 either)", physC1.length === 0, physC1.join(" "));
// The StatusBadges of the 12 pages in C0 (6ad311b), attribute for attribute.
const C0_BADGES: Record<string, string[]> = {
  "clients/page.tsx": ['domain="active_flag" status={c.isActive ? "active" : "inactive"} locale={locale}', 'domain="record_state" status="archived" locale={locale}'],
  "clients/[id]/page.tsx": ['domain="active_flag" status={client.isActive ? "active" : "inactive"} locale={locale}', 'domain="record_state" status="archived" locale={locale}'],
  "purchasing/vendors/page.tsx": ['domain="active_flag" status={v.isActive ? "active" : "inactive"} locale={locale}', 'domain="record_state" status="archived" locale={locale}'],
  "purchasing/vendors/[id]/page.tsx": ['domain="active_flag" status={vendor.isActive ? "active" : "inactive"} locale={locale}', 'domain="record_state" status="archived" locale={locale}'],
  "inventory/products/page.tsx": ['domain="stock" status="low_stock" locale={locale}', 'domain="active_flag" status={p.isActive ? "active" : "inactive"} locale={locale}', 'domain="record_state" status="archived" locale={locale}'],
  "inventory/products/[id]/page.tsx": ['domain="stock" status={low ? "low_stock" : "in_stock"} locale={locale}', 'domain="record_state" status="archived" locale={locale}'],
};
const badgesNow = Object.fromEntries(C1_PAGES.map((f) => [rel(f), jsxEls(f, "StatusBadge").map((el) => el.attributes.properties.map((p) => p.getText()).join(" "))]).filter(([, v]) => v.length));
const TONE = /\b(?:text|bg|border)-(?:success|danger|warning|info|neutral|corrective|positive|negative)\b|^(?:success|danger|warning|info|neutral|corrective)$/;
const toneMaps = [
  ...C1_PAGES.flatMap((f) => findAll(parse(f), (n) => ts.isObjectLiteralExpression(n) && n.properties.some((p) => ts.isPropertyAssignment(p) && (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer)) && TONE.test(p.initializer.text))).map(() => `${rel(f)}: object map`)),
  ...C1_PAGES.flatMap((f) => findAll(parse(f), (n) => ts.isVariableDeclaration(n) && /tone|status(map|class|color|variant|style)|badge(map|class|color)|colou?r(map|s)\b/i.test(n.name.getText())).map((n) => `${rel(f)}: ${(n as ts.VariableDeclaration).name.getText()}`)),
];
check("C1 pages: status only through StatusBadge — the same 13 badges, domains and status values as C0 — and no local tone / status / colour map",
  same(badgesNow, C0_BADGES) && toneMaps.length === 0, `${JSON.stringify(badgesNow)} ${toneMaps.join(" ")}`);

// ---------- 10. C2 — HR archetypes ----------
section("10. C2 — HR archetypes");
/** Code with all whitespace removed: a structural comparison that ignores layout. */
const squash = (s: string) => s.replace(/\s+/g, "");
const isEl = (n: ts.Node): n is El => ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n);
const inside = (root: ts.Node, pred: (n: ts.Node) => boolean): ts.Node[] => {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node) => {
    if (pred(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(root, visit);
  return out;
};
const attrText = (el: El | undefined, name: string) => (el ? squash(attr(el, name)?.initializer?.getText() ?? "") : "");

// Page h1 and section headings
const perRoute = Object.entries(C2_ROUTES).map(([r, files]) => [r, files.reduce((n, f) => n + jsxEls(f, "PageHeader").length, 0)] as const);
const hrHand = C2_FILES.flatMap((f) => findAll(parse(f), (n) => isEl(n) && /^h[1-6]$/.test(n.tagName.getText())).map((n) => `${rel(f)}: <${(n as El).tagName.getText()}>`));
check("C2: each of the 7 HR routes renders exactly one PageHeader (its page h1); no .main-head and no hand-written heading left in any HR file",
  perRoute.every(([, n]) => n === 1) && hrHand.length === 0 && C2_FILES.every((f) => !codeOnly(read(f)).includes("main-head")),
  `${perRoute.map(([r, n]) => `${r}:${n}`).join(" ")} ${hrHand.join(" ")}`);
const HEADER_SLOTS: [string, Record<"title" | "description" | "meta" | "actions", string>][] = [
  [`${HR}employees/employees-client.tsx`, { title: '{t(locale,"Employees")}', description: "", meta: "",
    actions: '{<Linkhref="/hr/employees/new"className="btnbtn-primary"style={{width:"auto",padding:"018px"}}><PlusclassName="size-3.5"/>{t(locale,"AddEmployee")}</Link>}' }],
  [`${HR}employees/new/page.tsx`, { title: '{t(locale,"NewEmployee")}', description: "", meta: "", actions: "" }],
  [`${HR}employees/[id]/page.tsx`, { title: '{<>{employee.name}<spanclassName="font-monotext-[13px]text-ink-muted">·{employee.employeeCode}</span></>}', description: "",
    meta: '{<StatusBadgedomain="employee"status={employee.status}locale={locale}/>}', actions: "" }],
  [`${HR}departments/page.tsx`, { title: '{t(locale,"Departments")}', description: "", meta: "", actions: "" }],
  [`${HR}attendance/page.tsx`, { title: '{`${t(locale,"Attendance")}—${t(locale,"Today")}`}', description: "", meta: '{<spanclassName="org-pill">{todayLabel}</span>}', actions: "" }],
  [`${HR}leave/leave-client.tsx`, { title: '{t(locale,"LeaveRequests")}', description: "", meta: "",
    actions: '{<ButtononClick={()=>setOpen(true)}disabled={employees.length===0}style={{padding:"018px"}}><PlusclassName="size-3.5"/>{t(locale,"RequestLeave")}</Button>}' }],
  [`${HR}payroll/page.tsx`, { title: '{`${t(locale,"Payroll")}—${monthLabel}`}', description: "", meta: '{<StatusBadgedomain="payroll_period"status={run?"processed":"draft"}locale={locale}/>}', actions: "" }],
];
const headerBad = HEADER_SLOTS.flatMap(([f, want]) => {
  const el = jsxEls(f, "PageHeader")[0];
  return (Object.keys(want) as (keyof typeof want)[]).filter((k) => attrText(el, k) !== want[k]).map((k) => `${rel(f)} ${k}: ${attrText(el, k)}`);
});
check("C2 headers: the title each route had (Employees, New Employee, the employee's name + monospace code, Departments, Attendance — Today, Leave Requests, Payroll — <month>); statuses and the date pill as meta, outside the h1; Add Employee and Request Leave as the actions, as they were",
  headerBad.length === 0, headerBad.slice(0, 4).join(" | "));
const sectionsIn = (f: string) => jsxEls(f, "SectionHeader").map((el) => `${attrText(el, "level")} ${attrText(el, "title")}`);
check("C2 section headings: Salary Structure (employee detail) and Past payroll runs (payroll) are SectionHeader h2s — h1 → h2, no skip",
  same(sectionsIn(`${HR}employees/[id]/page.tsx`), ['{2} {t(locale,"SalaryStructure")}']) && same(sectionsIn(`${HR}payroll/page.tsx`), ['{2} {t(locale,"Pastpayrollruns")}']),
  `${sectionsIn(`${HR}employees/[id]/page.tsx`)} | ${sectionsIn(`${HR}payroll/page.tsx`)}`);

// Department filter
const ECF = `${HR}employees/employees-client.tsx`;
const tabRow = findAll(parse(ECF), (n) => ts.isJsxElement(n) && attrText(n.openingElement, "className") === '"tab-row"')[0] as ts.JsxElement | undefined;
const filterEls = tabRow ? (inside(tabRow, (n) => isEl(n) && /^\{cn\("tab"/.test(attrText(n, "className"))) as El[]) : [];
// The keyboard path is the button's own (Tab, Enter, Space): nothing on a filter but its key, type,
// className, aria-pressed and onClick — no tabIndex, no key or pointer handler of its own.
const attrNames = (el: El) => el.attributes.properties.map((p) => (ts.isJsxAttribute(p) ? p.name.getText() : "{…}")).filter((n) => n !== "key").sort().join(" ");
const filterBad = filterEls.filter((el) => el.tagName.getText() !== "button" || attrText(el, "type") !== '"button"' || attrNames(el) !== "aria-pressed className onClick type" ||
  // aria-pressed is exactly the condition that shows the tab as active
  attrText(el, "className") !== `{cn("tab",${attrText(el, "aria-pressed").slice(1, -1)}&&"active")}`);
const clickables = C2_FILES.flatMap((f) => findAll(parse(f), (n) => isEl(n) && !!attr(n, "onClick") && /^[a-z]/.test(n.tagName.getText()) && n.tagName.getText() !== "button").map((n) => `${rel(f)}: <${(n as El).tagName.getText()} onClick>`));
check('C2 department filter: real <button type="button"> toggles on the .tab row (All departments + one per department), each aria-pressed exactly when shown active, still calling setActiveDept(null / d.id), with nothing else on them (no tabIndex, no key handler: the button\'s own keyboard behaviour); no clickable span or div left in any HR file',
  tabRow !== undefined && filterEls.length === 2 && filterBad.length === 0 && clickables.length === 0 &&
    attrText(filterEls[0], "onClick") === "{()=>setActiveDept(null)}" && attrText(filterEls[1], "onClick") === "{()=>setActiveDept(d.id)}",
  `${filterEls.length} filters; ${filterBad.map((el) => el.getText().slice(0, 80)).join(" | ")} ${clickables.join(" ")}`);

// KPI strips on StatRow
const statItems = (f: string) => jsxEls(f, "StatRow").map((el) => attrText(el, "items"));
const EMP_ITEMS =
  '{[{label:t(locale,"Headcount"),value:rows.length},{...statusStat(locale,"attendance","present",presentToday),label:t(locale,"Presenttoday")},' +
  'statusStat(locale,"attendance","on_leave",onLeaveToday),{label:t(locale,"Departments"),value:departments.length},]}';
const PAY_ITEMS =
  '{[{label:t(locale,"Employees"),value:lines.length},{label:t(locale,"Grosspay"),value:<Moneyamount={grossTotal}context="summary"/>},' +
  '{label:t(locale,"Deductions"),value:<Moneyamount={deductionsTotal}context="summary"/>},{label:t(locale,"Netpay"),value:<Moneyamount={netTotal}context="summary"/>},]}';
const empCode = codeOnly(read(ECF));
check("C2 Employees KPIs: one StatRow — Headcount and Departments plain; Present today and On Leave from statusStat (attendance present / on_leave: label, tone, colour from the registry); nothing coloured by hand",
  same(statItems(ECF), [EMP_ITEMS]) && !/statusTextClass\(|\bcolorClass\b|\btext-(success|info|warning|danger|corrective)\b|var\(--(success|info|accent-green)\)/.test(empCode),
  statItems(ECF).join(" "));
const PAYF = `${HR}payroll/page.tsx`;
check("C2 Payroll KPIs: one StatRow — Employees, Gross pay, Deductions, Net pay through <Money>; Net pay neutral (the decorative orange is gone, no invented tone)",
  same(statItems(PAYF), [PAY_ITEMS]) && !/brand-orange|\bcolorClass\b|\bcolor:/.test(codeOnly(read(PAYF))), statItems(PAYF).join(" "));
const legacyKpis = C2_FILES.filter((f) => /stat-row-2/.test(codeOnly(read(f)))).map(rel);
check("C2: no hand-built .stat-row-2 KPI cards left in any HR file", legacyKpis.length === 0, legacyKpis.join(" "));

// Empty states
const emptyOf = (f: string) => jsxEls(f, "EmptyState").map((el) => el.attributes.properties.map((p) => (ts.isJsxAttribute(p) ? p.name.getText() : "{…}")).sort().join(" ") + " " + attrText(el, "message"));
const EMPTY_WANT: Record<string, string[]> = {
  [`${HR}employees/employees-client.tsx`]: ['message {t(locale,"Noemployeesyet.Addyourfirstemployee.")}'],
  [`${HR}attendance/page.tsx`]: ['message {t(locale,"Noactiveemployeesyet—addemployeestostarttrackingattendance.")}'],
  [`${HR}leave/leave-client.tsx`]: ['message {t(locale,"Noleaverequestsyet.")}'],
  [`${HR}payroll/page.tsx`]: [`message {t(locale,"Noactiveemployeeswithasalarystructure—setoneoneachemployee'sprofilefirst.")}`],
  [`${HR}departments/page.tsx`]: ['action hint message {t(locale,"ManagedfromtheEmployeesscreen")}'],
};
const emptyBad = Object.entries(EMPTY_WANT).filter(([f, want]) => !same(emptyOf(f), want)).map(([f]) => `${rel(f)}: ${emptyOf(f)}`);
const deptEmpty = jsxEls(`${HR}departments/page.tsx`, "EmptyState")[0];
const deptAction = attrText(deptEmpty, "action");
const deptHint = attrText(deptEmpty, "hint");
const oldEmpty = C2_FILES.filter((f) => /rounded-2xl border border-line bg-surface shadow-elevated|padding: "52px 32px"/.test(codeOnly(read(f)))).map(rel);
check("C2 empty states: EmptyState in Employees, Attendance, Leave, Payroll and the Departments placeholder (message / hint / its two links as the action, targets unchanged); the custom shadowed recipe is gone",
  emptyBad.length === 0 && oldEmpty.length === 0 && /^\{<><Linkhref="\/hr\/employees"[\s\S]*<Linkhref="\/settings\/presets"[\s\S]*<\/>\}$/.test(deptAction) &&
    deptHint.includes('{t(locale,"Departmentsarethefiltertabsatthetop') && deptHint.includes('{t(locale,"DepartmentnamesaremanagedinPresetManagement'),
  [...emptyBad, ...oldEmpty, deptAction.slice(0, 60)].join(" | "));

// Dates
const ATTF = `${HR}attendance/page.tsx`;
check("C2 dates: Attendance's pill and Payroll's title month go through formatDisplayDate, from the day / period the page already selected (UTC midnight) — no second clock; no plain ar-SA or toLocaleDateString left on either",
  /const todayLabel = formatDisplayDate\(`\$\{today\}T00:00:00Z`, locale, "date"\);/.test(read(ATTF)) &&
    /const monthLabel = formatDisplayDate\(`\$\{periodYear\}-\$\{String\(periodMonth\)\.padStart\(2, "0"\)\}-01T00:00:00Z`, locale, "monthYear"\);/.test(read(PAYF)) &&
    [ATTF, PAYF].every((f) => !/toLocaleDateString|"ar-SA"/.test(codeOnly(read(f)))));

// Payroll layout and the two grid recipes
const PCF = `${HR}payroll/payroll-client.tsx`;
check("C2 payroll layout: PayrollClient no longer overrides .two-col (no inline display / gridTemplateColumns; only its 18px gap)",
  !/gridTemplateColumns|display: "grid"/.test(codeOnly(read(PCF))) && /<div className="two-col" style=\{\{ gap: 18 \}\}>/.test(read(PCF)));
const twoCol = cssRules(".two-col");
// .acct-grid was held here at C2's rules until C4 converged it; group 12 holds C4's two rules.
check(".two-col on minmax(0, 1fr) tracks — two on desktop, one at ≤1100px (C2), exactly those rules; .acct-grid is C4's from here (group 12)",
  same(twoCol, [`${A}mockup-parity.css: .two-col { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }`, `${A}mockup-parity.css: @media (max-width: 1100px) > .two-col { grid-template-columns: minmax(0, 1fr); }`]),
  twoCol.join(" | "));

// D-6 reaches other pages through CSS and the component only
const D6_SOURCES: Record<string, string> = {
  "sales/quotations/quotations-list-client.tsx": "370f5b3d84d2c8a5",
  "sales/orders/orders-list-client.tsx": "c3f158801b7afc05",
  "sales/proforma/proforma-list-client.tsx": "b183ef64e1f23f75",
  "sales/invoices/invoices-list-client.tsx": "df9124a4c3c54d3c",
  "sales/delivery-challans/dc-list-client.tsx": "c837d62b68edfe78",
  "purchasing/orders/po-list-client.tsx": "5df02b6f339170af",
  "sales/credit-notes/cn-list-client.tsx": "32532d3b1813b82f",
  "purchasing/debit-notes/dn-list-client.tsx": "ccfc2e25e738df80",
  "projects/projects-list-client.tsx": "790f9f6b644e6f02",
  "projects/[id]/page.tsx": "1df7311426f32ad0",
  "projects/[id]/cost-control.tsx": "2b8a78d963ff9394",
  "settings/security/security-client.tsx": "97d7c211bd24e412",
};
// C3 converged Projects' three files (list, detail, cost control) on purpose: group 11 holds them from
// here — C2's code plus C3's own hunks, nothing else. C5 did the same with Security's client: group 13
// holds it — C4's code (C1's bytes) plus C5's own hunks, its stat row untouched. The other eight stay
// byte-identical to C1.
const d6Held = Object.entries(D6_SOURCES).filter(([f]) => !C3_FILES.includes(A + f) && !C5_FILES.includes(A + f));
// C7 retagged each document list's title (h3 → h1, D-3): undone first — group 15 proves it is C7's only change there.
const d6Drift = d6Held.filter(([f, hsh]) => !exists(A + f) || h16(undoC7(A + f, read(A + f))) !== hsh).map(([f]) => f);
check(`D-6 reaches every other KPI row through the CSS and the StatRow component only — the eight document lists byte-identical to C1 (${d6Held.length} files; Projects' three are C3's, group 11; Security is C5's, group 13; C7's title tag undone, group 15)`,
  d6Held.length === 8 && d6Drift.length === 0, d6Drift.join(" "));

// Status and direction
const C1_HR_BADGES: Record<string, string[]> = {
  "hr/employees/employees-client.tsx": ['domain="employee" status="inactive" locale={locale}', 'domain="attendance" status={r.todayStatus} locale={locale}'],
  "hr/employees/[id]/page.tsx": ['domain="employee" status={employee.status} locale={locale}'],
  "hr/attendance/page.tsx": ['domain="attendance" status={status} locale={locale}'],
  "hr/leave/leave-client.tsx": ['domain="leave" status={r.status} locale={locale}'],
  "hr/payroll/page.tsx": ['domain="payroll_period" status={run ? "processed" : "draft"} locale={locale}', 'domain="payroll_run" status={r.status} locale={locale}'],
};
const hrBadges = Object.fromEntries(C2_FILES.map((f) => [rel(f), jsxEls(f, "StatusBadge").map((el) => el.attributes.properties.map((p) => p.getText()).join(" "))]).filter(([, v]) => v.length));
const hrPhys = C2_FILES.flatMap((f) => physical(f).map((x) => `${rel(f)}: ${x}`));
check("C2 HR files: status only through StatusBadge — the same 7 badges, domains and raw values as C1; no physical left / right",
  same(hrBadges, C1_HR_BADGES) && hrPhys.length === 0, `${JSON.stringify(hrBadges)} ${hrPhys.join(" ")}`);

// ---------- 11. C3 — Projects and the kanban ----------
section("11. C3 — Projects and the kanban");
/** Code without comments or whitespace. */
const flat = (s: string) => squash(codeOnly(s));
/** An attribute's code without comments or whitespace. */
const attrCode = (el: El | undefined, name: string) => (el ? flat(attr(el, name)?.initializer?.getText() ?? "") : "");
const strAttr = (el: El | undefined, name: string) => {
  const v = el ? attr(el, name)?.initializer : undefined;
  return v && ts.isStringLiteral(v) ? v.text : null;
};

// Nothing moved but C3's own changes: each Projects file is C2's (c060e8b) with exactly these hunks
// applied — [C2 code, C3 code], compared without comments or whitespace. Undo them all and the file
// must be C2's again, so a query, a FigureRow, a drill table, the dialog, the list's search, stats,
// table, RowMenu, ListEmptyState or live region cannot change unseen.
const C3_HUNKS: Record<string, [string, string][]> = {
  [C3_LIST]: [
    ["", `import { PageHeader } from "@/components/layout/page-header";`],
    [`<div className="flex items-center justify-between mb-[22px]"><h3 className="text-[19px] font-bold">{t(locale, "Projects")}</h3></div>`,
      `<PageHeader title={t(locale, "Projects")} />`],
  ],
  [C3_NEW]: [
    ["", `import { PageHeader } from "@/components/layout/page-header";`],
    [`<div className="main-head"><h3>{t(locale, "New Project")}</h3></div>
      <p className="text-[12.5px] text-ink-muted -mt-3 mb-5">{t(locale, "Add a project to plan tasks and track time against it.")}</p>`,
      `<PageHeader title={t(locale, "New Project")} description={t(locale, "Add a project to plan tasks and track time against it.")} />`],
  ],
  [C3_DETAIL]: [
    ["", `import { PageHeader } from "@/components/layout/page-header"; import { SectionHeader } from "@/components/ui/section-header";
      import { EmptyState } from "@/components/ui/empty-state";`],
    ["", `import { StatRow } from "../../sales/_shared/stat-row";`],
    [`<div className="main-head"><h3>{project.name}</h3><div className="flex items-center gap-3">
        <span className="org-pill">{pillParts.join(" · ")}</span>
        <ProjectStatusSelect locale={locale} projectId={project.id} status={project.status} /></div></div>`,
      `<PageHeader title={project.name} meta={<span className="org-pill">{pillParts.join(" · ")}</span>}
        actions={<ProjectStatusSelect locale={locale} projectId={project.id} status={project.status} />} />`],
    [`<div className="stat-row-2" style={{ gridTemplateColumns: "repeat(2, 1fr)", maxWidth: 520 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{t(locale, "Budget")}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4 }}>
            {project.budget ? <Money amount={project.budget} context="summary" /> : "—"}</div></div>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>
            {t(locale, "Tasks")} · {costControl.labourEstimate.hours.toFixed(1)} {t(locale, "Hours logged").toLowerCase()}</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4 }}>{tasks.length}</div></div></div>`,
      `<div className="max-w-[520px]"><StatRow columns={2} items={[
        { label: t(locale, "Budget"), value: project.budget ? <Money amount={project.budget} context="summary" /> : "—" },
        { label: \`\${t(locale, "Tasks")} · \${costControl.labourEstimate.hours.toFixed(1)} \${t(locale, "Hours logged").toLowerCase()}\`, value: tasks.length, },
      ]} /></div>`],
    [`<div className="main-head" style={{ marginTop: 22 }}><h3 style={{ fontSize: 15 }}>{t(locale, "Time logged this week")}</h3>
        {employees.length > 0 && tasks.length > 0 ? (
          <LogTimeDialog locale={locale} tasks={tasks.map((task) => ({ id: task.id, title: task.title }))} employees={employees} />
        ) : null}</div>`,
      `<SectionHeader level={2} title={t(locale, "Time logged this week")} actions={employees.length > 0 && tasks.length > 0 ? (
          <LogTimeDialog locale={locale} tasks={tasks.map((task) => ({ id: task.id, title: task.title }))} employees={employees} />
        ) : null} className="mt-[22px] mb-[22px]" />`],
    [`<div className="rounded-2xl border border-line bg-surface shadow-elevated py-8 text-center text-ink-muted text-sm">{t(locale, "No time logged yet.")}</div>`,
      `<EmptyState message={t(locale, "No time logged yet.")} />`],
    [`<TableHead className="text-right">{t(locale, "Hours")}</TableHead>`, `<TableHead numeric>{t(locale, "Hours")}</TableHead>`],
    [`<TableCell className="text-right num-tabular">{Number(log.hours).toFixed(1)}</TableCell>`, `<TableCell numeric className="num-tabular">{Number(log.hours).toFixed(1)}</TableCell>`],
    [`<div className="main-head" style={{ marginTop: 22 }}><h3 style={{ fontSize: 15 }}>{t(locale, "Linked Documents")}</h3></div>`,
      `<SectionHeader level={2} title={t(locale, "Linked Documents")} className="mt-[22px] mb-[22px]" />`],
    [`<div className="rounded-2xl border border-line bg-surface shadow-elevated py-8 text-center text-ink-muted text-sm">
        {t(locale, "No documents tagged to this project yet. Pick this project in the Project field when creating a quotation, sales order, or invoice.")}</div>`,
      `<EmptyState message={t(locale, "No documents tagged to this project yet. Pick this project in the Project field when creating a quotation, sales order, or invoice.")} />`],
    [`<TableHead className="text-right">{t(locale, "Amount")}</TableHead>`, `<TableHead numeric>{t(locale, "Amount")}</TableHead>`],
    [`<TableCell className="text-right num-tabular"><Money amount={d.total} /></TableCell>`, `<TableCell numeric className="num-tabular"><Money amount={d.total} /></TableCell>`],
  ],
  [C3_COST]: [
    [`import { statusLabel, type StatusDomain } from "@/lib/status-registry";`, `import { statusLabel, statusTextClass, type StatusDomain } from "@/lib/status-registry";`],
    ["", `import { SectionHeader } from "@/components/ui/section-header";`],
    ["", `import { StatRow } from "../../sales/_shared/stat-row";`],
    [`function StatCard({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) { return (
        <div className="card" style={{ padding: "16px 18px" }}><div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{label}</div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4, color: tone }}>{value}</div></div>); }
      function FigureRow`, `function FigureRow`],
    [`const profitTone = health === "loss" ? "var(--accent-red)" : health === "profitable" ? "var(--accent-green)" : "var(--ink-muted)";`,
      `const healthText = statusTextClass("project_health", health);`],
    [`<div className="main-head"><h3 style={{ fontSize: 15 }}>{t(locale, "Cost & Profitability")}</h3>
        <StatusBadge domain="project_health" status={health} locale={locale} /></div>`,
      `<SectionHeader level={2} title={t(locale, "Cost & Profitability")} meta={<StatusBadge domain="project_health" status={health} locale={locale} />} className="mb-[22px]" />`],
    [`<div className="stat-row-2" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <StatCard label={t(locale, "Sales Value")} value={<Money amount={revenue.confirmed} context="summary" />} />
        <StatCard label={t(locale, "Invoiced")} value={<Money amount={revenue.invoiced} context="summary" />} />
        <StatCard label={t(locale, "Collected")} value={<Money amount={revenue.received} context="summary" />} tone="var(--accent-green)" />
        <StatCard label={t(locale, "Total Cost")} value={<Money amount={cost.total} context="summary" />} tone="var(--warning)" />
        <StatCard label={t(locale, "Actual Profit")} value={<Money amount={profit} context="summary" />} tone={profitTone} />
        <StatCard label={t(locale, "Profit Margin")} value={marginPercent === null ? "—" : \`\${marginPercent.toFixed(1)}%\`} tone={profitTone} /></div>`,
      `<StatRow columns={3} items={[
        { label: t(locale, "Sales Value"), value: <Money amount={revenue.confirmed} context="summary" /> },
        { label: t(locale, "Invoiced"), value: <Money amount={revenue.invoiced} context="summary" /> },
        { label: t(locale, "Collected"), value: <Money amount={revenue.received} context="summary" /> },
        { label: t(locale, "Total Cost"), value: <Money amount={cost.total} context="summary" /> },
        { label: t(locale, "Actual Profit"), value: <span className={healthText}><Money amount={profit} context="summary" /></span> },
        { label: t(locale, "Profit Margin"), value: <span className={healthText}>{marginPercent === null ? "—" : \`\${marginPercent.toFixed(1)}%\`}</span> },
      ]} />`],
    [`<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }} className="cost-breakdown-grid">`, `<div className="cost-breakdown-grid">`],
    [`<div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{t(locale, "Revenue")}</div>`,
      `<SectionHeader level={3} title={t(locale, "Revenue")} className="mb-1.5" />`],
    [`<div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{t(locale, "Costs")}</div>`,
      `<SectionHeader level={3} title={t(locale, "Costs")} className="mb-1.5" />`],
  ],
  [C3_KANBAN]: [
    [`import { useState, useTransition } from "react";`, `import { useRef, useState, useTransition } from "react";`],
    ["", `import { SectionHeader } from "@/components/ui/section-header"; import { EmptyState } from "@/components/ui/empty-state";`],
    ["", `const LIST_SEPARATOR: Record<Locale, string> = { en: ", ", ar: "، " };`],
    [`const [pending, startTransition] = useTransition(); function openNew() {`,
      `const [pending, startTransition] = useTransition(); const opener = useRef<HTMLElement | null>(null);
       function openNew(trigger: HTMLElement) { opener.current = trigger;`],
    [`function openEdit(task: TaskRow) {`, `function openEdit(task: TaskRow, trigger: HTMLElement) { opener.current = trigger;`],
    ["", `const taskName = (task: TaskRow) => [task.title, statusLabel(locale, "task", task.status),
        \`\${t(locale, "Priority")}: \${t(locale, PRIORITY_LABEL[task.priority ?? "medium"])}\`,
        \`\${t(locale, "Assignee")}: \${task.assigneeName ?? t(locale, "Unassigned")}\`,
      ].join(LIST_SEPARATOR[locale]);`],
    [`<div className="flex items-center justify-between mb-3"><div />
        <Button variant="secondary" onClick={openNew}><Plus className="size-3.5" /> {t(locale, "Add Task")}</Button></div>`,
      `<SectionHeader level={2} title={t(locale, "Tasks")} actions={
        <Button variant="secondary" onClick={(e) => openNew(e.currentTarget)}><Plus className="size-3.5" /> {t(locale, "Add Task")}</Button>
      } className="mb-3" />`],
    [`<div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 text-center text-ink-muted text-sm">
        {t(locale, "No tasks yet. Add the first task to this project.")}</div>`,
      `<EmptyState message={t(locale, "No tasks yet. Add the first task to this project.")} />`],
    [`<span>{statusLabel(locale, "task", col.status)}</span>`, `<h3>{statusLabel(locale, "task", col.status)}</h3>`],
    [`<div key={task.id} className="kanban-card" onClick={() => openEdit(task)}><div className="t">{task.title}</div><div className="meta-row">`,
      `<button key={task.id} type="button"
        className="kanban-card block w-full text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        aria-label={taskName(task)} data-task-id={task.id} onClick={(e) => openEdit(task, e.currentTarget)}>
        <span className="t block">{task.title}</span><span className="meta-row">`],
    [`<div className="kanban-avatar" style={{ background: grad }} title={task.assigneeName}>{initials(task.assigneeName)}</div>`,
      `<span className="kanban-avatar" style={{ background: grad }} title={task.assigneeName}>{initials(task.assigneeName)}</span>`],
    [`<span />)}</div></div>);`, `<span />)}</span></button>);`],
    [`<DialogContent>`, `<DialogContent onCloseAutoFocus={(e) => { e.preventDefault(); const el = opener.current; const id = el?.dataset.taskId;
        (el?.isConnected ? el : id ? document.querySelector<HTMLElement>(\`.kanban-card[data-task-id="\${id}"]\`) : null)?.focus(); }}>`],
  ],
};
/** Each file at C2 (c060e8b), without comments or whitespace. */
const C2_FLAT: Record<string, string> = {
  [C3_LIST]: "ccc3e64668a6ce70", [C3_NEW]: "35cc34171702f1ff", [C3_DETAIL]: "967efb501c0295ab", [C3_COST]: "5c7ee04673c55a0e", [C3_KANBAN]: "b6e2f0cc15c603a8",
};
const hunkBad: string[] = [];
for (const f of C3_FILES) {
  // C8's D-2 hunks (cost-control.tsx) undone first: group 16 proves they are its only change since C7.
  let s = flat(undoD2(f, read(f)));
  for (const [was, is] of C3_HUNKS[f]) {
    const n = s.split(squash(is)).length - 1;
    if (n !== 1) hunkBad.push(`${rel(f)}: ${n}× ${squash(is).slice(0, 60)}…`);
    s = s.replace(squash(is), () => squash(was));
  }
  if (h16(s) !== C2_FLAT[f]) hunkBad.push(`${rel(f)}: not C2's once C3's hunks are undone (${h16(s)})`);
}
const nHunks = Object.values(C3_HUNKS).flat().length;
check(`C3 changed nothing in the five Projects files but its own ${nHunks} hunks: undo them (C8's D-2 hunks first, group 16) and each is C2's code to the character (comments and whitespace aside) — the queries, FigureRow, the drill tables, the warning, the dialog; the list's search, stats, table, RowMenu, ListEmptyState and live region`,
  hunkBad.length === 0 && nHunks === 39, hunkBad.join(" | "));
// Projects files C3 must not touch, byte for byte (actions.ts and project-costing.ts are group 4's business pins).
const C3_UNTOUCHED: Record<string, string> = {
  [`${PR}page.tsx`]: "7b5c54fc98d94ed6", [`${PR}project-form.tsx`]: "7202780083f91f63",
  [`${PR}[id]/project-status-select.tsx`]: "8eb0ff66d5388d04", [`${PR}[id]/log-time-dialog.tsx`]: "4cdb163691cb2c64",
};
const untouched = Object.entries(C3_UNTOUCHED).filter(([f, hsh]) => !exists(f) || sha(f) !== hsh).map(([f]) => rel(f));
const bizPinned = [`${PR}actions.ts`, "src/lib/project-costing.ts"].every((f) => pins.business[f] && now.business[f] === pins.business[f]);
check("C3: projects/page.tsx (the list query), ProjectForm, ProjectStatusSelect and LogTimeDialog byte-identical to C2; projects/actions.ts and src/lib/project-costing.ts still their business pins",
  untouched.length === 0 && bizPinned, untouched.join(" "));
const C3_PAGES = ["(app)/projects/page.tsx", "(app)/projects/new/page.tsx", "(app)/projects/[id]/page.tsx"];
check(`C3: the three Projects pages' server data sections (${C3_PAGES.map((p) => pins.data[p].length).join(" / ")} statements — the queries, weekAgoIso, the linked documents and their sort, getProjectCostControl(…), pillParts), guards and action inventories (${C3_PAGES.map((p) => pins.actions[p].length).join(" / ")}) are the pinned ones`,
  C3_PAGES.every((p) => same(now.data[p], pins.data[p]) && same(now.guards[p], pins.guards[p]) && same(now.actions[p], pins.actions[p])) &&
    same(findAll(parse(C3_DETAIL), (n) => ts.isCallExpression(n) && n.expression.getText() === "getProjectCostControl").map(canon), ["getProjectCostControl(session.orgId, projectId, session.orgCurrency)"]));

// Page headers
const c3Count = C3_FILES.map((f) => jsxEls(f, "PageHeader").length);
const c3Hand = C3_FILES.flatMap((f) => findAll(parse(f), (n) => isEl(n) && /^h[1-6]$/.test(n.tagName.getText())).map((n) => `${rel(f)}: <${(n as El).tagName.getText()}>`));
check("C3: the list, New Project and the project detail each render one PageHeader — the page's one h1 — and the board and cost control none; no .main-head left; the only hand-written heading is the kanban column's <h3>",
  same(c3Count, [1, 1, 1, 0, 0]) && same(c3Hand, ["projects/[id]/kanban-board.tsx: <h3>"]) && C3_FILES.every((f) => !codeOnly(read(f)).includes("main-head")), `${c3Count.join(" ")} ${c3Hand.join(" ")}`);
const C3_HEADER_SLOTS: [string, Record<"title" | "description" | "meta" | "actions" | "className", string>][] = [
  [C3_LIST, { title: '{t(locale,"Projects")}', description: "", meta: "", actions: "", className: "" }],
  [C3_NEW, { title: '{t(locale,"NewProject")}', description: '{t(locale,"Addaprojecttoplantasksandtracktimeagainstit.")}', meta: "", actions: "", className: "" }],
  [C3_DETAIL, { title: "{project.name}", description: "", meta: '{<spanclassName="org-pill">{pillParts.join("·")}</span>}',
    actions: "{<ProjectStatusSelectlocale={locale}projectId={project.id}status={project.status}/>}", className: "" }],
];
const c3HeaderBad = C3_HEADER_SLOTS.flatMap(([f, want]) => {
  const el = jsxEls(f, "PageHeader")[0];
  return (Object.keys(want) as (keyof typeof want)[]).filter((k) => attrCode(el, k) !== want[k]).map((k) => `${rel(f)} ${k}: ${attrCode(el, k)}`);
});
const toolbar = jsxEls(C3_LIST, "ListToolbar");
check("C3 headers: Projects; New Project with its description; the project's name as the h1 with the org-pill (pillParts: status label, budget) as meta and ProjectStatusSelect (same props) as the action, both outside it — New Project stays in the list's ListToolbar (/projects/new), not repeated in the header",
  c3HeaderBad.length === 0 && toolbar.length === 1 && attrCode(toolbar[0], "createHref") === '"/projects/new"' && attrCode(toolbar[0], "createLabel") === '{t(locale,"NewProject")}',
  c3HeaderBad.join(" | "));

// Sections: h1 → h2 → h3
const C3_SECTIONS: Record<string, string[]> = {
  [C3_DETAIL]: ['{2} {t(locale,"Timeloggedthisweek")}', '{2} {t(locale,"LinkedDocuments")}'],
  [C3_COST]: ['{2} {t(locale,"Cost&Profitability")}', '{3} {t(locale,"Revenue")}', '{3} {t(locale,"Costs")}'],
  [C3_KANBAN]: ['{2} {t(locale,"Tasks")}'],
};
const secBad = Object.entries(C3_SECTIONS).filter(([f, want]) => !same(sectionsIn(f), want)).map(([f]) => `${rel(f)}: ${sectionsIn(f).join(", ")}`);
const sec = (f: string, key: string) => jsxEls(f, "SectionHeader").find((el) => attrCode(el, "title") === `{t(locale,"${key}")}`);
const [costHead, tasksHead, timeHead, docsHead] = [sec(C3_COST, "Cost&Profitability"), sec(C3_KANBAN, "Tasks"), sec(C3_DETAIL, "Timeloggedthisweek"), sec(C3_DETAIL, "LinkedDocuments")];
check("C3 sections: Cost & Profitability, Tasks, Time logged this week and Linked Documents are SectionHeader h2s; Revenue and Costs SectionHeader h3s in the breakdown cards",
  secBad.length === 0, secBad.join(" | "));
// C8 (D-2): Cost & Profitability lost its meta — C3's project_health StatusBadge (group 16 holds the hunk).
check("C3 section slots, C8's D-2 applied: Cost & Profitability has no meta and no actions (the project_health badge C3 put there is gone, group 16); Add Task — label, variant, the create dialog — the Tasks action; LogTimeDialog the Time-logged action under the same condition (employees and tasks); Linked Documents none",
  costHead !== undefined && attr(costHead, "meta") === undefined && attrCode(costHead, "actions") === "" &&
    attrCode(tasksHead, "actions") === '{<Buttonvariant="secondary"onClick={(e)=>openNew(e.currentTarget)}><PlusclassName="size-3.5"/>{t(locale,"AddTask")}</Button>}' && attrCode(tasksHead, "meta") === "" &&
    attrCode(timeHead, "actions") === '{employees.length>0&&tasks.length>0?(<LogTimeDialoglocale={locale}tasks={tasks.map((task)=>({id:task.id,title:task.title}))}employees={employees}/>):null}' &&
    attrCode(docsHead, "actions") === "" && attrCode(docsHead, "meta") === "");
const colHead = findAll(parse(C3_KANBAN), (n) => ts.isJsxElement(n) && attrCode(n.openingElement, "className") === '"kanban-col-head"') as ts.JsxElement[];
const colKids = colHead[0] ? colHead[0].children.filter((c) => !(ts.isJsxText(c) && !c.text.trim())).map((c) => flat(c.getText())) : [];
check('C3 kanban columns: a column head is its status label as an <h3> — statusLabel(locale, "task", col.status), the registry\'s, not hard-coded — and the count in a <span> beside it, outside the heading; one head per COLUMNS entry',
  colHead.length === 1 && same(colKids, ['<h3>{statusLabel(locale,"task",col.status)}</h3>', "<span>{colTasks.length}</span>"]) && flat(read(C3_KANBAN)).includes("{COLUMNS.map((col)=>{"),
  colKids.join(" "));
check("C3 kanban: COLUMNS unchanged — todo, in_progress, blocked, done, in that order; no label map beside it",
  same(findAll(parse(C3_KANBAN), varNamed("COLUMNS")).map(canon), ['const COLUMNS: { status: string; }[] = [{ status: "todo" }, { status: "in_progress" }, { status: "blocked" }, { status: "done" }];']));

// KPI rows on StatRow (columns 2 and 3), the breakdown on its CSS rule
const SUMMARY_ITEMS =
  '{[{label:t(locale,"Budget"),value:project.budget?<Moneyamount={project.budget}context="summary"/>:"—"},' +
  '{label:`${t(locale,"Tasks")}·${costControl.labourEstimate.hours.toFixed(1)}${t(locale,"Hourslogged").toLowerCase()}`,value:tasks.length,},]}';
// C8 (D-2): the four factual figures, as C3 wrote them; Actual Profit and Profit Margin (C3's last two) are gone.
const COST_ITEMS =
  '{[{label:t(locale,"SalesValue"),value:<Moneyamount={revenue.confirmed}context="summary"/>},{label:t(locale,"Invoiced"),value:<Moneyamount={revenue.invoiced}context="summary"/>},' +
  '{label:t(locale,"Collected"),value:<Moneyamount={revenue.received}context="summary"/>},{label:t(locale,"TotalCost"),value:<Moneyamount={cost.total}context="summary"/>},]}';
const rowsOf = (f: string) => jsxEls(f, "StatRow").map((el) => [attrCode(el, "columns"), attrCode(el, "items")]);
const summaryRow = jsxEls(C3_DETAIL, "StatRow")[0];
const summaryBox = summaryRow && ts.isJsxElement(summaryRow.parent) ? summaryRow.parent.openingElement : undefined;
check("C3 project summary: one StatRow, columns={2} — Budget (its Money, or —) and Tasks · <hours> hours logged (labourEstimate.hours, tasks.length), the labels as they were — in a max-w-[520px] box (the 520px composition), no inline style",
  same(rowsOf(C3_DETAIL), [["{2}", SUMMARY_ITEMS]]) && summaryBox !== undefined && strAttr(summaryBox, "className") === "max-w-[520px]" && summaryBox.attributes.properties.length === 1,
  JSON.stringify(rowsOf(C3_DETAIL)));
check("Cost & Profitability KPIs (C3, D-2 applied in C8): one StatRow, columns={4} — exactly Sales Value, Invoiced, Collected, Total Cost, in that order, the engine's figures as handed in, all plain (no colorClass, no health class); no Actual Profit or Profit Margin item",
  same(rowsOf(C3_COST), [["{4}", COST_ITEMS]]), JSON.stringify(rowsOf(C3_COST)));
const inlineGrid = C3_FILES.filter((f) => /gridTemplateColumns|display:\s*"grid"|stat-row-2|repeat\(/.test(codeOnly(read(f)))).map(rel);
const gridTokens = C3_FILES.flatMap((f) => classTokens(f).filter((c) => /^(grid-cols-\d+|col-span-\d+)$/.test(c)).map((c) => `${rel(f)}: ${c}`));
check("C3: no inline grid in a Projects file — no gridTemplateColumns, no inline display: grid, no hand-built .stat-row-2 (StatRow and mockup-parity.css own the grids); the one grid utility is the task dialog's two-field row, as in C2",
  inlineGrid.length === 0 && same(gridTokens, ["projects/[id]/kanban-board.tsx: grid-cols-2"]), [...inlineGrid, ...gridTokens].join(" "));
const breakdown = findAll(parse(C3_COST), (n) => isEl(n) && /cost-breakdown-grid/.test(attrCode(n, "className"))) as El[];
const CSSF = `${A}mockup-parity.css`;
check(".cost-breakdown-grid owns the breakdown: two minmax(0, 1fr) tracks, 16px gap, 16px below; one track at ≤900px — exactly that rule, nowhere else; the cost control's box carries the class and nothing inline",
  same(cssRules(".cost-breakdown-grid"), [
    `${CSSF}: .cost-breakdown-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }`,
    `${CSSF}: @media (max-width: 900px) > .cost-breakdown-grid { grid-template-columns: minmax(0, 1fr); }`,
  ]) && breakdown.length === 1 && breakdown[0].attributes.properties.length === 1 && strAttr(breakdown[0], "className") === "cost-breakdown-grid",
  cssRules(".cost-breakdown-grid").join(" | "));
const KANBAN_RULES = [
  `${CSSF}: .kanban { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; align-items: start; }`,
  `${CSSF}: .kanban-col { background: var(--canvas); border: 1px solid var(--line); border-radius: 14px; padding: 12px; }`,
  `${CSSF}: .kanban-col-head { display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-faint); margin-bottom: 10px; padding: 0 2px; }`,
  `${CSSF}: .kanban-card { background: var(--surface); border: 1px solid var(--line); border-radius: 11px; padding: 11px 12px; margin-bottom: 9px; box-shadow: var(--shadow-sm); }`,
  `${CSSF}: .kanban-card .t { font-size: 12.5px; font-weight: 600; margin-bottom: 6px; }`,
  `${CSSF}: .kanban-card .meta-row { display: flex; justify-content: space-between; align-items: center; }`,
  `${CSSF}: .kanban-avatar { width: 20px; height: 20px; border-radius: 6px; font-size: 9px; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; }`,
  `${CSSF}: .kanban-card { cursor: pointer; }`,
  `${CSSF}: .kanban-card:hover { border-color: var(--brand-orange); box-shadow: var(--shadow-card-hover); transform: translateY(-1px); }`,
  `${CSSF}: @media (max-width: 1100px) > .kanban { grid-template-columns: repeat(2, 1fr); }`,
  `${CSSF}: .kanban-col-head h3 { font: inherit; text-wrap: inherit; }`,
];
check(".kanban rules: C2's, untouched — four columns, two at ≤1100px (390 included), the card and its hover — plus one: the column head's h3 takes the head's own type (font: inherit), so the label looks as it did",
  same(cssRules(".kanban"), KANBAN_RULES), cssRules(".kanban").join(" | "));
// The stylesheet is C2's plus those two additions — comments and whitespace aside.
const cssFlat = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");
const C3_CSS = `.kanban-col-head h3 { font: inherit; text-wrap: inherit; }
  .cost-breakdown-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
  @media (max-width: 900px) { .cost-breakdown-grid { grid-template-columns: minmax(0, 1fr); } }`;
/** The stylesheet as it is, and with C7's four twins undone — C6's, when they are C7's only CSS change (group 15). */
const cssWithC7 = cssFlat(read(CSSF));
const undoC7Css = (flatCss: string) => C7_CSS_TWINS.reduce((s, [rule, twin]) => s.replace(cssFlat(rule) + cssFlat(twin), () => cssFlat(rule)), flatCss);
const cssNow = undoC7Css(cssWithC7);
/** The stylesheet with C6's Dashboard hunks undone — C5's (and C4's), when they are C6's only change (group 14). */
const undoC6Css = (flatCss: string) => C6_CSS_HUNKS.reduce((s, [was, is]) => s.replace(cssFlat(is), () => cssFlat(was)), flatCss);
// C6's Dashboard hunks, then C4's two .acct-grid edits, undone first (groups 14 and 12 prove they are their only ones).
const cssC3 = C4_CSS_HUNKS.reduce((s, [was, is]) => s.replace(cssFlat(is), () => cssFlat(was)), undoC6Css(cssNow));
check("mockup-parity.css is C2's plus C3's two additions and nothing else (.stat-row-2, .two-col, .acct-grid, the dashboard, Settings, document and print rules untouched) — C4's two .acct-grid edits (group 12) and C6's Dashboard hunks (group 14) aside",
  cssC3.split(cssFlat(C3_CSS)).length === 2 && h16(cssC3.replace(cssFlat(C3_CSS), "")) === "198cad6c7e2da464", h16(cssC3.replace(cssFlat(C3_CSS), "")));

// Task cards
const cards = findAll(parse(C3_KANBAN), (n) => isEl(n) && /kanban-card/.test(attrCode(n, "className"))) as El[];
const card = cards[0];
const cardAttrs = card ? card.attributes.properties.map((p) => (ts.isJsxAttribute(p) ? p.name.getText() : "{…}")).sort().join(" ") : "";
check('C3 task card: the one .kanban-card is a <button type="button"> (no div card) — class kept, block / full width / text-start (logical) — with only key, type, className, aria-label, data-task-id and onClick: no tabIndex, role or key handler (Tab, Enter and Space are the button\'s own)',
  cards.length === 1 && card.tagName.getText() === "button" && strAttr(card, "type") === "button" && cardAttrs === "aria-label className data-task-id key onClick type" &&
    strAttr(card, "className") === "kanban-card block w-full text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" &&
    attrCode(card, "onClick") === "{(e)=>openEdit(task,e.currentTarget)}" && attrCode(card, "data-task-id") === "{task.id}", `${card?.tagName.getText()} ${cardAttrs}`);
const kCode = codeOnly(read(C3_KANBAN));
const kBanned = [/\bdraggable\b/, /\bonDrag\w*/, /\bonDrop\b/, /\bonKey(Down|Up|Press)\b/, /\btabIndex\b/, /\brole=/, /dispatchEvent|KeyboardEvent|\.click\(\)/, /\bsetTimeout\b|\bsetInterval\b|requestAnimationFrame|queueMicrotask/, /\bonMouse(Down|Up)\b|\bonPointer\w+/]
  .filter((re) => re.test(kCode));
check("C3 kanban: no drag and drop (no draggable, no drag / drop handler), no key simulation (no key handler, tabIndex, role, synthetic event or click()), no timer-based focus anywhere in the board",
  kBanned.length === 0, kBanned.map(String).join(" "));
check('C3 task card name: aria-label={taskName(task)} — the title, the task\'s status from the registry, "Priority: <label>", "Assignee: <name>" or Unassigned, through t() and joined per locale (", " / "، "); no id in it; Priority, Assignee and Unassigned have Arabic',
  same(findAll(parse(C3_KANBAN), varNamed("taskName")).map(canon), [
    'const taskName = (task: TaskRow) => [ task.title, statusLabel(locale, "task", task.status), `${t(locale, "Priority")}: ${t(locale, PRIORITY_LABEL[task.priority ?? "medium"])}`, `${t(locale, "Assignee")}: ${task.assigneeName ?? t(locale, "Unassigned")}`].join(LIST_SEPARATOR[locale]);',
  ]) && same(findAll(parse(C3_KANBAN), varNamed("LIST_SEPARATOR")).map(canon), ['const LIST_SEPARATOR: Record<Locale, string> = { en: ", ", ar: "، " };']) &&
    attrCode(card, "aria-label") === "{taskName(task)}" && ["Priority", "Assignee", "Unassigned", "Low", "Medium", "High"].every((k) => /[؀-ۿ]/.test(translate("ar", k))));
const cardClasses = (strAttr(card, "className") ?? "").split(" ");
check("C3 task card focus: the repository's focus-visible pattern (Button, Checkbox, RadioGroup: outline-2, outline-offset-2, outline-focus — the --focus token through @theme's --color-focus) on the card; its hover rule untouched (above)",
  ["focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-focus"].every((c) => cardClasses.includes(c)) &&
    read("src/components/ui/button.tsx").includes("focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus") && /--color-focus: var\(--focus\);/.test(read("src/app/globals.css")));
const dialogContent = jsxEls(C3_KANBAN, "DialogContent");
const kSrc = read(C3_KANBAN);
check("C3 focus return: the control that opened the dialog — a task card or Add Task, e.currentTarget — is kept in a ref, and DialogContent's onCloseAutoFocus stops Radix's default and focuses it again (or, if a save re-rendered the board, the same task's card by data-task-id): Escape, the close button and Save alike",
  /const opener = useRef<HTMLElement \| null>\(null\);/.test(kSrc) && /function openNew\(trigger: HTMLElement\) \{\s*opener\.current = trigger;/.test(kSrc) &&
    /function openEdit\(task: TaskRow, trigger: HTMLElement\) \{\s*opener\.current = trigger;/.test(kSrc) && dialogContent.length === 1 &&
    attrCode(dialogContent[0], "onCloseAutoFocus") === '{(e)=>{e.preventDefault();constel=opener.current;constid=el?.dataset.taskId;(el?.isConnected?el:id?document.querySelector<HTMLElement>(`.kanban-card[data-task-id="${id}"]`):null)?.focus();}}',
  attrCode(dialogContent[0], "onCloseAutoFocus"));
const statusCalls = findAll(parse(C3_KANBAN), (n) => ts.isCallExpression(n) && n.expression.getText() === "statusLabel").map((n) => squash(n.getText())).sort();
const prioUses = findAll(parse(C3_KANBAN), (n) => ts.isElementAccessExpression(n) && /^PRIORITY_(LABEL|STYLE)$/.test(n.expression.getText())).map((n) => squash(n.getText())).sort();
check("C3 status / priority boundary: task status only through the registry — statusLabel(locale, \"task\", …) for the column h3, the card name and the Status select, StatusBadge task/done on a Done card — and priority only through the page-local PRIORITY_LABEL / PRIORITY_STYLE, unchanged (deferred to DEV-UI-01.8), no priority in the registry",
  same(statusCalls, ['statusLabel(locale,"task",c.status)', 'statusLabel(locale,"task",col.status)', 'statusLabel(locale,"task",task.status)']) &&
    same(prioUses, ["PRIORITY_LABEL[p]", 'PRIORITY_LABEL[task.priority??"medium"]', 'PRIORITY_LABEL[task.priority??"medium"]', 'PRIORITY_STYLE[task.priority??"medium"]']) &&
    same(findAll(parse(C3_KANBAN), (n) => varNamed("PRIORITY_LABEL")(n) || varNamed("PRIORITY_STYLE")(n)).map(canon), [
      'const PRIORITY_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };',
      'const PRIORITY_STYLE: Record<string, React.CSSProperties> = { low: { background: "var(--surface)", color: "var(--ink-muted)", border: "1px solid var(--line)" }, medium: { background: "var(--info-bg)", color: "var(--info)" }, high: { background: "var(--danger-bg)", color: "var(--danger)" } };',
    ]) && !/priority/i.test(read("src/lib/status-registry.ts")),
  `${statusCalls.join(" ")} | ${prioUses.join(" ")}`);

// Empty states
const C3_EMPTY_WANT: Record<string, string[]> = {
  [C3_KANBAN]: ['message {t(locale,"Notasksyet.Addthefirsttasktothisproject.")}'],
  [C3_DETAIL]: ['message {t(locale,"Notimeloggedyet.")}', 'message {t(locale,"Nodocumentstaggedtothisprojectyet.PickthisprojectintheProjectfieldwhencreatingaquotation,salesorder,orinvoice.")}'],
};
const c3EmptyBad = Object.entries(C3_EMPTY_WANT).filter(([f, want]) => !same(emptyOf(f), want)).map(([f]) => `${rel(f)}: ${emptyOf(f).join(", ")}`);
check("C3 empty states: EmptyState for no tasks, no time logged and no linked documents — the same messages, no action inside (Add Task stays in the Tasks header); the shadowed custom box is gone; the no-employee note kept",
  c3EmptyBad.length === 0 && C3_FILES.every((f) => !/shadow-elevated|rounded-2xl border border-line/.test(codeOnly(read(f)))) &&
    flat(read(C3_DETAIL)).includes('{employees.length===0&&(<pclassName="text-[12px]text-ink-faint-mt-2mb-3">{t(locale,"Timeloggingneedsatleastoneemployee—thePeoplemoduleshipsinalatersection.")}</p>)}'),
  c3EmptyBad.join(" | "));

// Direction: logical numeric columns
const c3Phys = C3_FILES.flatMap((f) => physical(f).map((x) => `${rel(f)}: ${x}`));
const numHeads = jsxEls(C3_DETAIL, "TableHead").filter((el) => attr(el, "numeric")).map((el) => (ts.isJsxElement(el.parent) ? flat(el.parent.children.map((c) => c.getText()).join("")) : ""));
const numCells = jsxEls(C3_DETAIL, "TableCell").filter((el) => attr(el, "numeric")).map((el) => strAttr(el, "className"));
check("C3 RTL: no physical left / right in the five Projects files (the four text-right sites are gone); Hours and Amount — header and cell — on the table's logical numeric API (TableHead / TableCell numeric: the inline end, either direction), num-tabular kept",
  c3Phys.length === 0 && same(numHeads, ['{t(locale,"Hours")}', '{t(locale,"Amount")}']) && same(numCells, ["num-tabular", "num-tabular"]), [...c3Phys, ...numHeads, ...numCells].join(" "));

// D-2: decided at P0 and held unimplemented through C3 – C7; C8 applies it (presentation only — group 16 holds the hunks)
const costSrc = read(C3_COST);
const recompute = C3_FILES.flatMap((f) =>
  findAll(parse(f), (n) => ts.isBinaryExpression(n) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken].includes(n.operatorToken.kind))
    .map((n) => `${rel(f)}: ${squash(n.getText())}`));
/** Identifiers the cost control may no longer read: the engine's profitability fields and C3's health class. */
const profitRefs = findAll(parse(C3_COST), (n) => ts.isIdentifier(n) && ["profit", "marginPercent", "health", "healthText", "statusTextClass", "StatusBadge"].includes(n.text)).map((n) => n.getText());
const costingSrc = read("src/lib/project-costing.ts");
check("D-2 applied (C8, presentation only): the cost control shows no Actual Profit, no Profit Margin and no project_health badge — the destructure of data takes revenue, cost, rows, labourEstimate and excludedUnconverted only (no profit, marginPercent, health, healthText, statusTextClass or StatusBadge in the file); project-costing.ts still computes and returns profit, marginPercent and health, byte-pinned (group 4); no arithmetic in a Projects file but C2's own (the task-avatar colour index, the 7-day window, the list's status counts) — nothing recomputed in the page; the detail still hands getProjectCostControl's result to the section",
  costSrc.includes("const { revenue, cost, rows, labourEstimate, excludedUnconverted } = data;") && profitRefs.length === 0 &&
    !/"(Actual Profit|Profit Margin)"/.test(costSrc) && costHead !== undefined && attr(costHead, "meta") === undefined &&
    costingSrc.includes("marginPercent: invoiced > 0 ? (profit / invoiced) * 100 : null,") && costingSrc.includes('health: invoiced <= 0 ? "no_revenue" : profit >= 0 ? "profitable" : "loss",') &&
    now.business["src/lib/project-costing.ts"] === pins.business["src/lib/project-costing.ts"] &&
    same(recompute, ["projects/projects-list-client.tsx: (counts[r.status]??0)+1", "projects/[id]/page.tsx: Date.now()-7*24*60*60*1000", "projects/[id]/page.tsx: 7*24*60*60*1000",
      "projects/[id]/page.tsx: 7*24*60*60", "projects/[id]/page.tsx: 7*24*60", "projects/[id]/page.tsx: 7*24", "projects/[id]/kanban-board.tsx: task.assigneeId%AVATAR_GRADIENTS.length"]) &&
    jsxEls(C3_DETAIL, "ProjectCostControlSection").map((el) => flat(el.getText())).join() === "<ProjectCostControlSectionlocale={locale}data={costControl}/>",
  `${profitRefs.join(" ")} ${recompute.join(" | ")}`);
const accents = (codeOnly(costSrc).match(/var\(--(accent-red|accent-green|warning|success|danger)\)/g) ?? []).sort();
check("Project health colour (C3's, removed by C8's D-2): nothing in a Projects file picks a profitability colour — no statusTextClass, no healthText, no profitTone, no health → colour map or comparison of health; the only accent colours left in the cost control are the lower detail's, as in C2 (Received Payments green, Total Project Cost warning, a negative drill row red)",
  !/statusTextClass|healthText|project_health/.test(codeOnly(costSrc)) && C3_FILES.every((f) => !/profitTone|\bhealth\s*[!=]==|\b(loss|profitable|no_revenue)\s*:/.test(codeOnly(read(f)))) &&
    same(accents, ["var(--accent-green)", "var(--accent-red)", "var(--warning)"]) &&
    (costSrc.match(/tone="var\(--accent-green\)"/g) ?? []).length === 1 && (costSrc.match(/strong tone="var\(--warning\)"/g) ?? []).length === 1 && /r\.negative \? "var\(--accent-red\)"/.test(costSrc),
  accents.join(" "));

// Status and copy (C8's D-2 removed the cost control's project_health badge; the list's and the board's are C2's)
const C2_PROJECT_BADGES: Record<string, string[]> = {
  "projects/projects-list-client.tsx": ['domain="project" status={r.status} locale={locale}'],
  "projects/[id]/kanban-board.tsx": ['domain="task" status="done" locale={locale}'],
};
const c3Badges = Object.fromEntries(C3_FILES.map((f) => [rel(f), jsxEls(f, "StatusBadge").map((el) => el.attributes.properties.map((p) => p.getText()).join(" "))]).filter(([, v]) => v.length));
const c3Keys = new Set<string>();
for (const f of C3_FILES) {
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText() === "t" && n.arguments.length === 2) for (const k of textLits(n.arguments[1])) c3Keys.add(k);
    ts.forEachChild(n, visit);
  };
  visit(parse(f));
}
const c3NoArabic = [...c3Keys].filter((k) => !/[؀-ۿ]/.test(translate("ar", k)));
check(`C3: status only through StatusBadge in the Projects files — C2's badges, domains and raw values but the cost control's project_health one (C8, D-2): the list's project and the board's task — and every t() key they use (${c3Keys.size}) has an Arabic entry`,
  same(c3Badges, C2_PROJECT_BADGES) && c3NoArabic.length === 0, `${JSON.stringify(c3Badges)} ${c3NoArabic.join(" | ")}`);

// ---------- 12. C4 — Finance and reports ----------
section("12. C4 — Finance and reports");

// Nothing moved but C4's own changes: each finance file is C3's (65e12d6) with exactly these hunks
// applied — [C3 code, C4 code], compared without comments or whitespace. Undo them all and the file
// must be C3's again, so a report body or figure, a date preset, an export link, the drill-down, a
// query, the ledger table, a dialog or its trigger cannot change unseen.
const C4_HUNKS: Record<string, [string, string][]> = {
  [C4_REPORTS]: [
    ["", `import { PageHeader } from "@/components/layout/page-header"; import { SectionHeader } from "@/components/ui/section-header";`],
    [`<div className="main-head no-print"><h3>{t(locale, "Financial Reports")}</h3><div className="flex items-center gap-2">
        <div className="doc-pill-btn-group flex items-center gap-1">`,
      `<div className="no-print"><PageHeader title={t(locale, "Financial Reports")} actions={
        <div className="doc-pill-btn-group flex items-center gap-1">`],
    [`<Download className="size-3.5" /> PDF</a></div></div></div>`, `<Download className="size-3.5" /> PDF</a></div>} /></div>`],
    [`className={r.kind === report ? "tab active" : "tab"} onClick=`, `className={r.kind === report ? "tab active" : "tab"} aria-pressed={r.kind === report} onClick=`],
    [`placeholder={t(locale, "Search…")} className=`, `placeholder={t(locale, "Search…")} aria-label={t(locale, "Search…")} className=`],
    [`<div className="mb-3"><h3 className="text-[16px] font-bold">{title}</h3><div className="text-[12px] text-ink-faint">{range.from} → {range.to}</div></div>`,
      `<SectionHeader level={2} title={title} description={\`\${range.from} → \${range.to}\`} className="mb-3" />`],
  ],
  [C4_STATEMENTS]: [
    ["", `import { PageHeader } from "@/components/layout/page-header";`],
    [`<div className="main-head"><h3>{t(locale, "Client & Vendor Statements")}</h3></div>
      <p className="text-[12.5px] text-ink-muted mb-3">{t(locale, "Statement of account built from posted ledger entries — opening balance, every transaction in the period, and the closing balance.")}</p>`,
      `<PageHeader title={t(locale, "Client & Vendor Statements")}
        description={t(locale, "Statement of account built from posted ledger entries — opening balance, every transaction in the period, and the closing balance.")} />`],
    [`href="/finance/statements?kind=client">`, `href="/finance/statements?kind=client" aria-current={kind === "client" ? "page" : undefined}>`],
    [`href="/finance/statements?kind=vendor">`, `href="/finance/statements?kind=vendor" aria-current={kind === "vendor" ? "page" : undefined}>`],
  ],
  [C4_LEDGER]: [
    ["", `import { PageHeader } from "@/components/layout/page-header";`],
    [`<div className="main-head"><h3>{t(locale, "Account Ledger")}</h3></div>`, `<PageHeader title={t(locale, "Account Ledger")} />`],
  ],
  [C4_COA]: [
    ["", `import { PageHeader } from "@/components/layout/page-header";`],
    [`<div className="main-head"><h3>{t(locale, "Chart of Accounts")}</h3></div>`, `<PageHeader title={t(locale, "Chart of Accounts")} />`],
  ],
  [C4_ACCOUNT_VIEW]: [
    ["", `import { SectionHeader } from "@/components/ui/section-header"; import { EmptyState } from "@/components/ui/empty-state";`],
    [`<div className="card p-8 text-center text-ink-muted text-sm">{t(locale, "Select an account to view its ledger.")}</div>`,
      `<EmptyState message={t(locale, "Select an account to view its ledger.")} />`],
    [`<div className="flex items-center justify-between mb-4"><div>
        <div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{selectedAccount.code} · {accountName(locale, selectedAccount)}</div>
        <div className="text-[11.5px] text-ink-muted mt-0.5">{t(locale, NORMAL_BALANCE_CAPTION[selectedAccount.type as (typeof TYPE_ORDER)[number]])}</div></div>
        <span className="org-pill">{t(locale, "Balance")}: <Money amount={balances.get(selectedAccount.id) ?? 0} context="summary" /></span></div>`,
      `<SectionHeader level={2} title={<span className="mono">{selectedAccount.code} · {accountName(locale, selectedAccount)}</span>}
        description={t(locale, NORMAL_BALANCE_CAPTION[selectedAccount.type as (typeof TYPE_ORDER)[number]])}
        meta={<span className="org-pill">{t(locale, "Balance")}: <Money amount={balances.get(selectedAccount.id) ?? 0} context="summary" /></span>}
        className="mb-4" />`],
    [`<p className="text-ink-muted text-sm py-6 text-center">{t(locale, "No transactions yet.")}</p>`, `<EmptyState message={t(locale, "No transactions yet.")} />`],
  ],
  [C4_PAYMENTS]: [
    ["", `import { PageHeader } from "@/components/layout/page-header"; import { EmptyState } from "@/components/ui/empty-state";`],
    [`<div className="main-head"><h3>{t(locale, "Payment Records")}</h3><RecordPaymentDialog`, `<PageHeader title={t(locale, "Payment Records")} actions={<RecordPaymentDialog`],
    [`{t(locale, "Record Payment")}</Button>} /></div>`, `{t(locale, "Record Payment")}</Button>} />} />`],
    [`<p className="text-ink-muted text-sm">{t(locale, "No payment records yet.")}</p>`, `<EmptyState message={t(locale, "No payment records yet.")} />`],
  ],
  [C4_JOURNAL]: [
    ["", `import { PageHeader } from "@/components/layout/page-header"; import { SectionHeader } from "@/components/ui/section-header";
      import { EmptyState } from "@/components/ui/empty-state";`],
    [`<div className="main-head"><h3>{t(locale, "New Journal Entry")}</h3><span className="org-pill">{t(locale, "Manual")}</span></div>`,
      `<PageHeader title={t(locale, "New Journal Entry")} meta={<span className="org-pill">{t(locale, "Manual")}</span>} />`],
    [`<div className="main-head" style={{ marginTop: 40 }}><h3 style={{ fontSize: 15 }}>{t(locale, "Recent journal entries")}</h3></div>`,
      `<SectionHeader level={2} title={t(locale, "Recent journal entries")} className="mt-10 mb-[22px]" />`],
    [`<p className="text-ink-muted text-sm">{t(locale, "No journal entries yet.")}</p>`, `<EmptyState message={t(locale, "No journal entries yet.")} />`],
  ],
  [C4_BANK]: [
    ["", `import { PageHeader } from "@/components/layout/page-header"; import { SectionHeader } from "@/components/ui/section-header";
      import { EmptyState } from "@/components/ui/empty-state";`],
    [`<div className="main-head"><h3>{t(locale, "Bank Accounts")}</h3><BankAccountFormDialog`, `<PageHeader title={t(locale, "Bank Accounts")} actions={<BankAccountFormDialog`],
    [`{t(locale, "New Account")}</Button>} /></div>`, `{t(locale, "New Account")}</Button>} />} />`],
    [`<p className="text-ink-muted text-sm mb-6">{t(locale, "No bank accounts yet.")}</p>`, `<EmptyState message={t(locale, "No bank accounts yet.")} className="mb-6" />`],
    [`<div className="main-head" style={{ marginTop: 4 }}><h3 style={{ fontSize: 15 }}>{t(locale, "Recent payment records")}</h3></div>`,
      `<SectionHeader level={2} title={t(locale, "Recent payment records")} className="mt-1 mb-[22px]" />`],
    [`<p className="text-ink-muted text-sm">{t(locale, "No payment records yet.")}</p>`, `<EmptyState message={t(locale, "No payment records yet.")} />`],
  ],
};
/** Each file at C3 (65e12d6), without comments or whitespace. */
const C3_FLAT: Record<string, string> = {
  [C4_REPORTS]: "9946c303e75623c5", [C4_STATEMENTS]: "7ef5a6c85d73cdd8", [C4_LEDGER]: "79071e80c15da606", [C4_COA]: "6211116fd0b433c2",
  [C4_ACCOUNT_VIEW]: "1d1018174ed5a9e0", [C4_PAYMENTS]: "3c011f016799cc8e", [C4_JOURNAL]: "defe59b72f776bbb", [C4_BANK]: "ffe227e2e1e2b32f",
};
const c4HunkBad: string[] = [];
for (const f of C4_FILES) {
  // C8's D-2 hunks (reports-workspace.tsx) undone first: group 16 proves they are its only change since C7.
  let s = flat(undoD2(f, read(f)));
  for (const [was, is] of C4_HUNKS[f]) {
    const n = s.split(squash(is)).length - 1;
    if (n !== 1) c4HunkBad.push(`${rel(f)}: ${n}× ${squash(is).slice(0, 60)}…`);
    s = s.replace(squash(is), () => squash(was));
  }
  if (h16(s) !== C3_FLAT[f]) c4HunkBad.push(`${rel(f)}: not C3's once C4's hunks are undone (${h16(s)})`);
}
const nC4Hunks = Object.values(C4_HUNKS).flat().length;
check(`C4 changed nothing in the eight finance files but its own ${nC4Hunks} hunks: undo them (C8's D-2 hunks first, group 16) and each is C3's code to the character (comments and whitespace aside) — the report bodies and their figures, the date presets, the export links, the compare toggle, the drill-down, the statement and ledger queries, the ledger table, the payments table, the journal form, the bank cards, every dialog and its trigger`,
  c4HunkBad.length === 0 && nC4Hunks === 32, c4HunkBad.join(" | "));
const c4CssCount = C4_CSS_HUNKS.map(([, is]) => cssNow.split(cssFlat(is)).length - 1);
check("mockup-parity.css is C3's plus C4's two .acct-grid edits and nothing else: undo them and it is C3's to the character (comments and whitespace aside) — .two-col, .stat-row-2 (D-6), .cost-breakdown-grid, .kanban, the dashboard, Settings, document and print rules untouched (C6's Dashboard hunks aside, group 14)",
  same(c4CssCount, [1, 1]) && h16(cssC3) === "b8892a533a3a2524", `${c4CssCount.join(" ")} ${h16(cssC3)}`);

// Byte pins: the finance files C4 does not touch, the dictionary, and the frozen P0 / P0.1 / P0.2
// verifiers — verify-ar-locale-hydration.mjs is C3's approved widening plus C4's approved one-line
// Payments-trigger selector (.main-head button → [data-slot="page-header-actions"] button), frozen.
const C4_UNTOUCHED: Record<string, string> = {
  [`${FN}statements/statement-view.tsx`]: "d333b90a10042c10", [`${FN}journal/journal-form.tsx`]: "a80361a3a3d58e75",
  [`${FN}_shared/add-account-dialog.tsx`]: "bd674a1d8ded9d63", [`${FN}_shared/record-payment-dialog.tsx`]: "9337514ddd040e10",
  [`${FN}bank-accounts/bank-account-form-dialog.tsx`]: "91ced63e0f389b4d", [`${FN}reports/page.tsx`]: "58adc82f91280778",
  [`${FN}payments/page.tsx`]: "e36a5e0d1caec1d8", [`${FN}_shared/delete-payment-button.tsx`]: "c83c3dcdff242919",
  [`${FN}_shared/payment-history.tsx`]: "1d7f705ada10387e", [`${FN}_shared/refund-advance-button.tsx`]: "caf71486da9f55c6",
  [`${FN}_shared/reverse-payment-button.tsx`]: "c3e6427df5913577", [`${FN}bank-accounts/loading.tsx`]: "421b17671041acda",
  [`${FN}journal/loading.tsx`]: "421b17671041acda", [`${FN}payments/loading.tsx`]: "3ad88d818d694245",
};
const C4_FROZEN: Record<string, string> = {
  "src/lib/i18n/dict.ts": "796829703fc96bf4",
  "verify/verify-ar-locale-hydration.mjs": "a226b47188ddf478", "verify/verify-settings-timezone-hydration.mjs": "a43b9d9f7b521da6",
  "verify/verify-business-date-hydration.mjs": "02ef92b957d4d719", "verify/verify-number-locale.mts": "1e1937186eb24bb3",
  "verify/verify-date-timezone.mts": "e6be633c8a2af74d", "verify/verify-business-dates.mts": "ad9171672e94ddd6",
};
const c4Untouched = Object.entries(C4_UNTOUCHED).filter(([f, hsh]) => !exists(f) || sha(f) !== hsh).map(([f]) => rel(f));
const c4BizFiles = Object.keys(pins.business).filter((k) => k.startsWith(FN)).sort();
const c4FinanceFiles = walk(`${A}finance`);
const c4Unaccounted = c4FinanceFiles.filter((f) => !C4_FILES.includes(f) && !(f in C4_UNTOUCHED) && !c4BizFiles.includes(f));
check(`C4: the other ${Object.keys(C4_UNTOUCHED).length} finance files byte-identical to C3 — StatementView (its Search / Document type copy deferred), JournalForm (its Add line and inputs deferred to DEV-UI-01.8), the account, payment and bank-account dialogs, the payment history and its buttons, the reports and payments pages, the loading boundaries; every finance file is one of C4's eight, one of these or a business pin`,
  c4Untouched.length === 0 && c4Unaccounted.length === 0 && c4FinanceFiles.length === C4_FILES.length + Object.keys(C4_UNTOUCHED).length + c4BizFiles.length, [...c4Untouched, ...c4Unaccounted.map((f) => `unaccounted: ${f}`)].join(" "));
// dict.ts: C4's bytes once C6's range-label digits (group 14) and C5's two additions (C5_DICT_BLOCKS — group 13 proves
// they are its only edit) are undone.
const c4Frozen = Object.entries(C4_FROZEN).filter(([f, hsh]) => !exists(f) || (f === "src/lib/i18n/dict.ts" ? h16(undoC5Dict(undoC6Dict(read(f)))) : sha(f)) !== hsh).map(([f]) => f);
check("C4: the P0 / P0.1 / P0.2 verifiers byte-pinned — the Arabic-locale hydration suite as C3's approved reconstruction left it plus C4's approved Payments-trigger selector (frozen), the settings time-zone and business-date hydration suites, number-locale, date-timezone, business-dates — and dict.ts byte-identical (C4 needed no new entry; C5's two additions aside, group 13, and C6's range-label digits, group 14)",
  c4Frozen.length === 0, c4Frozen.join(" "));
const C4_BIZ = ["src/lib/finance-reports.ts", "src/lib/statements.ts", "src/lib/accounting.ts", "src/lib/settlement.ts", "src/lib/currency/**", "src/db/**", "drizzle/**"];
const c4BizWant = [`${FN}_shared/actions.ts`, `${FN}bank-accounts/actions.ts`, `${FN}journal/actions.ts`, `${FN}payments/actions.ts`, `${FN}reports/actions.ts`, `${FN}reports/export/route.ts`,
  `${FN}statements/actions.ts`, `${FN}statements/export/route.ts`];
const c4BizDrift = [...C4_BIZ, ...c4BizWant].filter((k) => !pins.business[k] || now.business[k] !== pins.business[k]);
check("C4: the finance libraries (finance-reports, statements, accounting, settlement), src/lib/currency/**, src/db/**, drizzle/**, the six finance server-action modules and both export routes still their business pins — no calculation, query, posting or export changed",
  c4BizDrift.length === 0 && same(c4BizFiles, c4BizWant), [...c4BizDrift, ...c4BizFiles].join(" "));
const C4_PAGES = ["bank-accounts", "chart-of-accounts", "journal", "ledger", "payments", "reports", "statements"].map((r) => `(app)/finance/${r}/page.tsx`);
check(`C4: the seven finance pages' server data sections (${C4_PAGES.map((p) => pins.data[p].length).join(" / ")} statements — the report loaders and payload, the statement parties and opening statement, the selected account and its ledger rows, the payments, journal entries, bank balances and opening entries), guards and action inventories (${C4_PAGES.map((p) => pins.actions[p].length).join(" / ")}) are the pinned ones`,
  C4_PAGES.every((p) => same(now.data[p], pins.data[p]) && same(now.guards[p], pins.guards[p]) && same(now.actions[p], pins.actions[p])),
  C4_PAGES.filter((p) => !same(now.data[p], pins.data[p]) || !same(now.guards[p], pins.guards[p]) || !same(now.actions[p], pins.actions[p])).join(" "));

// Page headers: one h1 per route
const c4Count = C4_FILES.map((f) => jsxEls(f, "PageHeader").length);
const c4Hand = C4_FILES.flatMap((f) => findAll(parse(f), (n) => isEl(n) && /^h[1-6]$/.test(n.tagName.getText())).map((n) => `${rel(f)}: <${(n as El).tagName.getText()}>`));
check("C4: each of the seven finance routes renders one PageHeader — its page's one h1 (Ledger and Chart of Accounts in their own pages, none in the shared ledger view); no .main-head and no hand-written heading left in any C4 file (the old h3 titles are gone)",
  same(c4Count, [1, 1, 1, 1, 0, 1, 1, 1]) && c4Hand.length === 0 && C4_FILES.every((f) => !codeOnly(read(f)).includes("main-head")), `${c4Count.join(" ")} ${c4Hand.join(" ")}`);
const C4_HEADER_SLOTS: [string, Record<"title" | "description" | "meta" | "actions" | "className", string>][] = [
  [C4_REPORTS, { title: '{t(locale,"FinancialReports")}', description: "", meta: "", className: "",
    actions: '{<divclassName="doc-pill-btn-groupflexitems-centergap-1"><ahref={exportUrl("csv")}className="doc-pill-btn"style={{height:32,fontSize:12}}><DownloadclassName="size-3.5"/>CSV</a>' +
      '<ahref={exportUrl("xlsx")}className="doc-pill-btn"style={{height:32,fontSize:12}}>Excel</a><ahref={exportUrl("pdf")}className="doc-pill-btn"style={{height:32,fontSize:12}}><DownloadclassName="size-3.5"/>PDF</a></div>}' }],
  [C4_STATEMENTS, { title: '{t(locale,"Client&VendorStatements")}', meta: "", actions: "", className: "",
    description: '{t(locale,"Statementofaccountbuiltfrompostedledgerentries—openingbalance,everytransactionintheperiod,andtheclosingbalance.")}' }],
  [C4_LEDGER, { title: '{t(locale,"AccountLedger")}', description: "", meta: "", actions: "", className: "" }],
  [C4_COA, { title: '{t(locale,"ChartofAccounts")}', description: "", meta: "", actions: "", className: "" }],
  [C4_PAYMENTS, { title: '{t(locale,"PaymentRecords")}', description: "", meta: "", className: "",
    actions: '{<RecordPaymentDialoglocale={locale}currency={currency}baseCurrency={currency}bankAccounts={bankAccounts}invoices={outstandingInvoices}purchaseOrders={outstandingPos}trigger={<Button><PlusclassName="size-4"/>{t(locale,"RecordPayment")}</Button>}/>}' }],
  [C4_JOURNAL, { title: '{t(locale,"NewJournalEntry")}', description: "", meta: '{<spanclassName="org-pill">{t(locale,"Manual")}</span>}', actions: "", className: "" }],
  [C4_BANK, { title: '{t(locale,"BankAccounts")}', description: "", meta: "", className: "",
    actions: '{<BankAccountFormDialoglocale={locale}glAccounts={glOptions}trigger={<Button><LandmarkclassName="size-4"/>{t(locale,"NewAccount")}</Button>}/>}' }],
];
const c4HeaderBad = C4_HEADER_SLOTS.flatMap(([f, want]) => {
  const el = jsxEls(f, "PageHeader")[0];
  return (Object.keys(want) as (keyof typeof want)[]).filter((k) => attrCode(el, k) !== want[k]).map((k) => `${rel(f)} ${k}: ${attrCode(el, k)}`);
});
check("C4 headers: Financial Reports, Client & Vendor Statements (its description as the PageHeader's), Account Ledger, Chart of Accounts, Payment Records, New Journal Entry (the Manual pill as meta, outside the h1) and Bank Accounts — the titles each page had, through t(); Record Payment and New Account the actions with the same dialog props; no className on any",
  c4HeaderBad.length === 0, c4HeaderBad.slice(0, 4).join(" | "));
/** The className of each JSX element enclosing `el`, innermost first. */
const enclosing = (el: El) => {
  const out: string[] = [];
  for (let p: ts.Node | undefined = ts.isJsxOpeningElement(el) ? el.parent.parent : el.parent; p; p = p.parent) if (ts.isJsxElement(p)) out.push(attrCode(p.openingElement, "className"));
  return out;
};
const repHeader = jsxEls(C4_REPORTS, "PageHeader")[0];
const repWrap = repHeader && ts.isJsxElement(repHeader.parent) ? repHeader.parent : undefined;
const repWrapKids = repWrap ? repWrap.children.filter((c) => !(ts.isJsxText(c) && !c.text.trim())) : [];
check('C4 Financial Reports header: the h1 reads "Financial Reports" (the page title, not the shell\'s "Account Reporting"); CSV, Excel and PDF are its actions — the same three exportUrl(…) links, labels and pill styling (above); it sits alone in a div.no-print, so print leaves it out exactly as the old .main-head.no-print did',
  repWrap !== undefined && repWrap.openingElement.tagName.getText() === "div" && repWrap.openingElement.attributes.properties.length === 1 &&
    strAttr(repWrap.openingElement, "className") === "no-print" && repWrapKids.length === 1 && repWrapKids[0] === repHeader, repWrap?.getText().slice(0, 80));

// Reports: data, links, date presets and bodies held to C3
const declsOf = (f: string, name: string) => findAll(parse(f), varNamed(name)).map(canon);
const C4_REPORT_DECLS: Record<string, string> = {
  REPORTS: 'const REPORTS: { kind: ReportKind; label: string; }[] = [ { kind: "pl", label: "Profit & Loss" }, { kind: "bs", label: "Balance Sheet" }, { kind: "cf", label: "Cash Flow" }, { kind: "tb", label: "Trial Balance" }, { kind: "gl", label: "General Ledger" }, { kind: "ar", label: "AR Aging" }, { kind: "ap", label: "AP Aging" }, { kind: "vat", label: "VAT Summary" }];',
  exportUrl: 'const exportUrl = (format: string) => { const p = new URLSearchParams({ report, from: range.from, to: range.to, format }); if (accountId) p.set("account", String(accountId)); return `/finance/reports/export?${p.toString()}`; };',
  title: "const title = t(locale, REPORTS.find((r) => r.kind === report)!.label);",
  BUCKET_LABELS: 'const BUCKET_LABELS: Record<AgingBucketKey, string> = { current: "Current", d1_30: "1–30 Days", d31_60: "31–60 Days", d61_90: "61–90 Days", d90p: "90+ Days" };',
};
const repDeclBad = Object.entries(C4_REPORT_DECLS).filter(([n, want]) => !same(declsOf(C4_REPORTS, n), [want])).map(([n]) => `${n}: ${declsOf(C4_REPORTS, n).join(" ")}`);
check("C4 report data and links: REPORTS — the eight kinds pl, bs, cf, tb, gl, ar, ap, vat, their labels, in that order (the picker and the h2 read it); exportUrl builds /finance/reports/export?report, from, to, format (+ account) as in C3; the h2 title is the selected report's label through t(); the aging bucket labels unchanged",
  repDeclBad.length === 0, repDeclBad.join(" | "));
/** Canonical-code hashes at C3 (65e12d6). */
const fnHash = (f: string, name: string) => findAll(parse(f), fnNamed(name)).map((n) => h16(canon(n)));
const varHash = (f: string, name: string) => findAll(parse(f), varNamed(name)).map((n) => h16(canon(n)));
const C3_DATES: Record<string, [string, "fn" | "var"]> = {
  fyRange: ["e80b6ed9f268a9b9", "fn"], monthRange: ["dad5422daaf8a262", "fn"], quarterRange: ["785976b06e8e97a3", "fn"], presets: ["3319fc8f096ab116", "var"],
};
const datesBad = Object.entries(C3_DATES).filter(([n, [hsh, kind]]) => !same(kind === "fn" ? fnHash(C4_REPORTS, n) : varHash(C4_REPORTS, n), [hsh])).map(([n]) => n);
check("C4 date presets (§9): ymd, fyRange, monthRange, quarterRange and the six presets (This Month, This Quarter, This Financial Year, Last Month, Last Financial Year, All Time) are C3's to the canonical character",
  datesBad.length === 0 && same(declsOf(C4_REPORTS, "ymd"), ["const ymd = (d: Date) => d.toISOString().slice(0, 10);"]), [...datesBad, ...declsOf(C4_REPORTS, "ymd")].join(" "));
const C3_BODIES: Record<string, [string, "fn" | "var"]> = {
  PnlView: ["6951f2e2324be073", "fn"], BsView: ["ad9b2a2214238fb5", "fn"], CfView: ["fb07d232a21ebebd", "fn"], TbView: ["7afa9b0467d119c0", "fn"], GlView: ["06a746bf02bbf1a2", "fn"],
  AgingView: ["f483c9d6b0a5ac45", "fn"], VatView: ["7f1b6af9594feb0d", "fn"], Cards: ["d5052bdb5366f508", "fn"], Row: ["f8b3eaf8c4fda4d7", "fn"], Num: ["3ed462c8197aa846", "fn"],
  GroupLabel: ["9414622ee36ca219", "fn"], ExcludedNote: ["033b876382d5f32a", "fn"], sourceLabel: ["901ee66337096f1a", "fn"], DrillDrawer: ["70bfb6f4332438a0", "fn"],
  PrintStyles: ["00382a60892f6a6a", "fn"], setParams: ["9c432ade6f0235f5", "fn"], openDrill: ["c5f85bdd5dfdee5a", "fn"], inSearch: ["e0a8fda3364e8beb", "var"], cell: ["feb5605265549717", "var"],
};
// Hashed on the workspace with C8's D-2 hunks undone (group 16 proves they are its only change since C7): PnlView is C3's
// but for exactly them, and every other body is C3's as it stands.
const repC7 = ts.createSourceFile(C4_REPORTS, undoD2(C4_REPORTS, read(C4_REPORTS)), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const bodyHashC7 = (name: string, kind: "fn" | "var") => findAll(repC7, kind === "fn" ? fnNamed(name) : varNamed(name)).map((n) => h16(canon(n)));
const bodiesBad = Object.entries(C3_BODIES).filter(([n, [hsh, kind]]) => !same(bodyHashC7(n, kind), [hsh]) || (n !== "PnlView" && !same(kind === "fn" ? fnHash(C4_REPORTS, n) : varHash(C4_REPORTS, n), [hsh]))).map(([n]) => n);
check("C4 report bodies (§13): PnlView (C8's D-2 hunks undone, group 16), BsView, CfView, TbView, GlView, AgingView, VatView, the summary Cards, Row, Num (the drill-down), GroupLabel, ExcludedNote, sourceLabel, the drill drawer, the print styles, inSearch and cell — and setParams / openDrill — each C3's to the canonical character: filters, compare-period, drill targets and number rendering unchanged",
  bodiesBad.length === 0, bodiesBad.join(" "));
const pnl = findAll(parse(C4_REPORTS), fnNamed("PnlView"))[0];
const pnlCode = pnl ? flat(pnl.getText()) : "";
const repCode = flat(read(C4_REPORTS));
check("D-2 applied (C8, presentation only): the P&L shows no Gross Profit — its summary cards are exactly Revenue and Net Profit (their values and deltas against the previous period as before), and Cost of Sales' lines are followed directly by Operating Expenses (no Gross Profit row); no grossProfit read and no \"Gross Profit\" key anywhere in the workspace; finance-reports.ts still computes grossProfit = revenueTotal - costOfSalesTotal and the export route still lists it (both business-pinned, group 4 — the export is an open decision)",
  pnlCode.includes('<Cardsitems={[{label:t(locale,"Revenue"),value:d.revenueTotal,delta:prev?d.revenueTotal-prev.revenueTotal:undefined},{label:t(locale,"NetProfit"),value:d.netProfit,delta:prev?d.netProfit-prev.netProfit:undefined},]}/>') &&
    pnlCode.includes('{d.costOfSales.map(line)}<GroupLabel>{t(locale,"OperatingExpenses")}</GroupLabel>') &&
    !repCode.includes("grossProfit") && !repCode.includes('"GrossProfit"') &&
    read("src/lib/finance-reports.ts").includes("const grossProfit = revenueTotal - costOfSalesTotal;") && now.business["src/lib/finance-reports.ts"] === pins.business["src/lib/finance-reports.ts"] &&
    read(`${FN}reports/export/route.ts`).includes('{ section: "", account: "Gross Profit", amount: money(d.grossProfit) }') && now.business[`${FN}reports/export/route.ts`] === pins.business[`${FN}reports/export/route.ts`]);

// The report picker, the search, the report h2
const pickerMaps = findAll(parse(C4_REPORTS), (n) => ts.isCallExpression(n) && flat(n.expression.getText()) === "REPORTS.map") as ts.CallExpression[];
const pickerBtns = pickerMaps.flatMap((c) => inside(c, (n) => isEl(n) && n.tagName.getText() === "button")) as El[];
const pick = pickerBtns[0];
check('C4 report picker: one REPORTS.map of real <button type="button"> toggles — key, type, className and onClick as in C3, plus aria-pressed={r.kind === report}: exactly the condition that shows the tab active, so exactly one is pressed; nothing else on them (no tabIndex, role or key handler — the button\'s own Tab / Enter / Space); onClick still setParams({ report: r.kind, account: undefined })',
  pickerMaps.length === 1 && pickerBtns.length === 1 && strAttr(pick, "type") === "button" && attrNames(pick) === "aria-pressed className onClick type" &&
    attrCode(pick, "aria-pressed") === "{r.kind===report}" && attrCode(pick, "className") === `{${attrCode(pick, "aria-pressed").slice(1, -1)}?"tabactive":"tab"}` &&
    attrCode(pick, "key") === "{r.kind}" && attrCode(pick, "onClick") === "{()=>setParams({report:r.kind,account:undefined})}", pick?.getText().slice(0, 160));
const searchBoxes = jsxEls(C4_REPORTS, "input").filter((el) => attrCode(el, "value") === "{search}");
check('C4 report search: the one search input is named — aria-label={t(locale, "Search…")}, the wording of its own placeholder (Arabic بحث…); value, onChange and the filtering as in C3',
  searchBoxes.length === 1 && attrCode(searchBoxes[0], "aria-label") === '{t(locale,"Search…")}' && attrCode(searchBoxes[0], "placeholder") === '{t(locale,"Search…")}' &&
    attrCode(searchBoxes[0], "onChange") === "{(e)=>setSearch(e.target.value)}" && translate("ar", "Search…") === "بحث…", searchBoxes.map((el) => el.getText()).join(" "));
const repSecs = jsxEls(C4_REPORTS, "SectionHeader");
check("C4 report title: the selected report is the page's h2 — one SectionHeader, level={2}, title={title}, the range as its description (`${range.from} → ${range.to}`), mb-3, no meta or actions — outside every .no-print, so it still prints as the old title block did; the report body card follows it",
  repSecs.length === 1 && attrCode(repSecs[0], "level") === "{2}" && attrCode(repSecs[0], "title") === "{title}" && attrCode(repSecs[0], "description") === "{`${range.from}→${range.to}`}" &&
    strAttr(repSecs[0], "className") === "mb-3" && !attr(repSecs[0], "meta") && !attr(repSecs[0], "actions") && !enclosing(repSecs[0]).some((c) => c.includes("no-print")) &&
    repHeader !== undefined && enclosing(repHeader).some((c) => c.includes("no-print")), repSecs.map((el) => el.getText()).join(" "));

// Statements: Client / Vendor links
const stLinks = jsxEls(C4_STATEMENTS, "a");
const stWant = (k: string) => [`{\`tab\${kind==="${k}"?"active":""}\`}`, `"/finance/statements?kind=${k}"`, `{kind==="${k}"?"page":undefined}`];
const stGot = stLinks.map((el) => [attrCode(el, "className"), attrCode(el, "href"), attrCode(el, "aria-current")]);
const stLabels = stLinks.map((el) => (ts.isJsxElement(el.parent) ? flat(el.parent.children.map((c) => c.getText()).join("")) : ""));
check('C4 statement tabs: Client and Vendor stay <a> links — href /finance/statements?kind=client / ?kind=vendor unchanged — each aria-current="page" exactly when it is the one shown active (the kind === … condition of its .active class), undefined otherwise; labels through t(); StatementView handed the same props',
  same(stGot, [stWant("client"), stWant("vendor")]) && same(stLabels, ['{t(locale,"Client")}', '{t(locale,"Vendor")}']) &&
    same(jsxEls(C4_STATEMENTS, "StatementView").map((el) => flat(el.getText())), ["<StatementViewlocale={locale}kind={kind}partyId={partyId}parties={parties}initial={initial}/>"]),
  JSON.stringify(stGot));

// Ledger / Chart of Accounts: the grid, the selected account, the empty states
const ACCT_GRID_RULES = [
  `${CSSF}: .acct-grid { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; }`,
  `${CSSF}: @media (max-width: 1100px) > .acct-grid { grid-template-columns: minmax(0, 1fr); }`,
];
const acctEls = C4_FILES.flatMap((f) => findAll(parse(f), (n) => isEl(n) && /acct-grid/.test(attrCode(n, "className"))).map((n) => [f, n as El] as const));
const c4InlineGrids = C4_FILES.flatMap((f) => (codeOnly(read(f)).match(/gridTemplateColumns\s*:\s*("[^"]*"|'[^']*'|`[^`]*`|[^,}]*)/g) ?? []).map((m) => `${rel(f)}: ${m.trim()}`));
check(".acct-grid (Ledger, Chart of Accounts): the account list keeps its 280px and the ledger track is minmax(0, 1fr) — the ledger table scrolls inside it, it cannot widen the page; one minmax(0, 1fr) track at ≤1100px — exactly those two rules; the shared view's grid carries the class and nothing inline, and the only inline grids in a C4 file are the report Cards' own auto-fit rows, as in C3",
  same(cssRules(".acct-grid"), ACCT_GRID_RULES) && acctEls.length === 1 && acctEls[0][0] === C4_ACCOUNT_VIEW && acctEls[0][1].attributes.properties.length === 1 &&
    strAttr(acctEls[0][1], "className") === "acct-grid" &&
    same(c4InlineGrids, ['finance/reports/reports-workspace.tsx: gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))"', 'finance/reports/reports-workspace.tsx: gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))"']),
  [...cssRules(".acct-grid"), ...c4InlineGrids].join(" | "));
const avSecs = jsxEls(C4_ACCOUNT_VIEW, "SectionHeader");
check("C4 selected account: the ledger card's heading is the page's h2 — one SectionHeader, level={2}: code · name as the title (monospace, as before), the normal-balance caption as the description, the Balance org-pill (<Money> of the same balance) as the meta, outside the h2; mb-4; no actions",
  avSecs.length === 1 && attrCode(avSecs[0], "level") === "{2}" && attrCode(avSecs[0], "title") === '{<spanclassName="mono">{selectedAccount.code}·{accountName(locale,selectedAccount)}</span>}' &&
    attrCode(avSecs[0], "description") === "{t(locale,NORMAL_BALANCE_CAPTION[selectedAccount.typeas(typeofTYPE_ORDER)[number]])}" &&
    attrCode(avSecs[0], "meta") === '{<spanclassName="org-pill">{t(locale,"Balance")}:<Moneyamount={balances.get(selectedAccount.id)??0}context="summary"/></span>}' &&
    strAttr(avSecs[0], "className") === "mb-4" && !attr(avSecs[0], "actions"), avSecs.map((el) => el.getText()).join(" "));
check("C4 ledger view maps unchanged: TYPE_ORDER, TYPE_LABEL, NORMAL_BALANCE_CAPTION and SOURCE_BADGE are C3's (the groups, captions and source badges), and the list rows still link to <basePath>?account=<id>",
  same(declsOf(C4_ACCOUNT_VIEW, "TYPE_ORDER"), ['const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"] as const;']) &&
    same(declsOf(C4_ACCOUNT_VIEW, "TYPE_LABEL"), ['const TYPE_LABEL: Record<(typeof TYPE_ORDER)[number], string> = { asset: "Assets", liability: "Liabilities", equity: "Equity", revenue: "Revenue", expense: "Expenses" };']) &&
    same(declsOf(C4_ACCOUNT_VIEW, "NORMAL_BALANCE_CAPTION"), ['const NORMAL_BALANCE_CAPTION: Record<(typeof TYPE_ORDER)[number], string> = { asset: "Asset · Normal balance: Debit", liability: "Liability · Normal balance: Credit", equity: "Equity · Normal balance: Credit", revenue: "Revenue · Normal balance: Credit", expense: "Expense · Normal balance: Debit" };']) &&
    same(declsOf(C4_ACCOUNT_VIEW, "SOURCE_BADGE"), ['const SOURCE_BADGE: Record<string, { label: string; variant: "info" | "success" | "neutral"; }> = { manual: { label: "Manual", variant: "neutral" }, sales_invoice: { label: "Sales", variant: "info" }, credit_note: { label: "Sales", variant: "info" }, purchase_order: { label: "Purchasing", variant: "neutral" }, debit_note: { label: "Purchasing", variant: "neutral" }, payment: { label: "Payment", variant: "success" }, payroll_run: { label: "Payroll", variant: "neutral" }, expense: { label: "Expense", variant: "neutral" } };']) &&
    same(jsxEls(C4_ACCOUNT_VIEW, "Link").map((el) => attrCode(el, "href")), ["{`${basePath}?account=${a.id}`}"]));

// Secondary sections and empty states
const C4_SECTIONS: Record<string, string[]> = {
  [C4_REPORTS]: ["{2} {title}"], [C4_STATEMENTS]: [], [C4_LEDGER]: [], [C4_COA]: [], [C4_PAYMENTS]: [],
  [C4_ACCOUNT_VIEW]: ['{2} {<spanclassName="mono">{selectedAccount.code}·{accountName(locale,selectedAccount)}</span>}'],
  [C4_JOURNAL]: ['{2} {t(locale,"Recentjournalentries")}'], [C4_BANK]: ['{2} {t(locale,"Recentpaymentrecords")}'],
};
const c4SecBad = Object.entries(C4_SECTIONS).filter(([f, want]) => !same(sectionsIn(f), want)).map(([f]) => `${rel(f)}: ${sectionsIn(f).join(", ")}`);
const jSec = jsxEls(C4_JOURNAL, "SectionHeader")[0];
const bSec = jsxEls(C4_BANK, "SectionHeader")[0];
check("C4 outline: h1 → h2 on every finance route — the selected report, the selected ledger account, Recent journal entries and Recent payment records (Bank Accounts) are SectionHeader h2s (were h3s under no h1); the journal and bank secondaries keep their spacing (mt-10 / mt-1, 22px below), no meta or actions; no h3 anywhere",
  c4SecBad.length === 0 && strAttr(jSec, "className") === "mt-10 mb-[22px]" && strAttr(bSec, "className") === "mt-1 mb-[22px]" &&
    [jSec, bSec].every((el) => el && !attr(el, "meta") && !attr(el, "actions") && !attr(el, "description")), c4SecBad.join(" | "));
const C4_EMPTY_WANT: Record<string, string[]> = {
  [C4_REPORTS]: [], [C4_STATEMENTS]: [], [C4_LEDGER]: [], [C4_COA]: [],
  [C4_ACCOUNT_VIEW]: ['message {t(locale,"Selectanaccounttoviewitsledger.")}', 'message {t(locale,"Notransactionsyet.")}'],
  [C4_PAYMENTS]: ['message {t(locale,"Nopaymentrecordsyet.")}'],
  [C4_JOURNAL]: ['message {t(locale,"Nojournalentriesyet.")}'],
  [C4_BANK]: ['className message {t(locale,"Nobankaccountsyet.")}', 'message {t(locale,"Nopaymentrecordsyet.")}'],
};
const c4EmptyBad = Object.entries(C4_EMPTY_WANT).filter(([f, want]) => !same(emptyOf(f), want)).map(([f]) => `${rel(f)}: ${emptyOf(f).join(", ")}`);
const c4OldEmpty = C4_FILES.filter((f) => /text-ink-muted text-sm|card p-8 text-center/.test(codeOnly(read(f)))).map(rel);
check("C4 empty states: EmptyState for no ledger account selected, no transactions, no payment records (Payments and Bank Accounts), no journal entries and no bank accounts (mb-6 kept) — the same messages, no hint or action; the old muted <p> / card recipes are gone; the report body's zero rows, its skeleton and the statement's own empty rows are not EmptyState (unchanged)",
  c4EmptyBad.length === 0 && c4OldEmpty.length === 0 && strAttr(jsxEls(C4_BANK, "EmptyState")[0], "className") === "mb-6" && jsxEls(C4_REPORTS, "ReportBodySkeleton").length === 1,
  [...c4EmptyBad, ...c4OldEmpty].join(" | "));

// Journal, bank cards, status, copy, direction, abstraction
check("C4 journal: <JournalForm locale accounts currency projects> as in C3 (journal-form.tsx byte-identical — its div[role=button] Add line and unnamed inputs are DEV-UI-01.8's); the recent-entries table unchanged",
  same(jsxEls(C4_JOURNAL, "JournalForm").map((el) => flat(el.getText())), ["<JournalFormlocale={locale}accounts={accounts}currency={session.orgCurrency}projects={projects}/>"]));
const bankFlat = flat(read(C4_BANK));
check("C4 bank accounts: the account cards as they were — one kpi-chip icon, the balance in the display face at weight 800 (the weight-800 sweep is deferred), the per-card edit dialog with its named icon trigger",
  (bankFlat.match(/className="kpi-chip"/g) ?? []).length === 1 && bankFlat.includes('fontFamily:"var(--font-display)",fontWeight:800,fontSize:22') &&
    bankFlat.includes('title={t(locale,"Edit")}aria-label={t(locale,"Edit")}'));
const c4Badges = Object.fromEntries(C4_FILES.map((f) => [rel(f), jsxEls(f, "StatusBadge").map((el) => el.attributes.properties.map((p) => p.getText()).join(" "))]).filter(([, v]) => v.length));
check("C4: status only through StatusBadge — the bank account's active_flag badge, as in C3; no other status badge or tone map added to a finance file",
  same(c4Badges, { "finance/bank-accounts/page.tsx": ['domain="active_flag" status={ba.isActive ? "active" : "inactive"} locale={locale}'] }), JSON.stringify(c4Badges));
const c4Keys = new Set<string>();
for (const f of C4_FILES) {
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText() === "t" && n.arguments.length === 2) for (const k of textLits(n.arguments[1])) c4Keys.add(k);
    ts.forEachChild(n, visit);
  };
  visit(parse(f));
}
/** The string values of a declaration's object literals (only `prop`'s, when given). */
const litsOf = (f: string, name: string, prop?: string) =>
  findAll(parse(f), varNamed(name)).flatMap((v) => inside(v, (n) => ts.isPropertyAssignment(n) && (!prop || n.name.getText() === prop) && ts.isStringLiteral(n.initializer)))
    .map((n) => ((n as ts.PropertyAssignment).initializer as ts.StringLiteral).text);
const c4Labels = [...litsOf(C4_REPORTS, "REPORTS", "label"), ...litsOf(C4_REPORTS, "presets", "label"), ...litsOf(C4_REPORTS, "BUCKET_LABELS"),
  ...litsOf(C4_ACCOUNT_VIEW, "TYPE_LABEL"), ...litsOf(C4_ACCOUNT_VIEW, "NORMAL_BALANCE_CAPTION"), ...litsOf(C4_PAYMENTS, "METHOD_LABELS")];
const hasArabic = (k: string) => /[؀-ۿ]/.test(translate("ar", k));
const c4NoArabic = [...c4Keys, ...c4Labels].filter((k) => !hasArabic(k));
const badgeNoArabic = litsOf(C4_ACCOUNT_VIEW, "SOURCE_BADGE", "label").filter((k) => !hasArabic(k));
const postsExpense = walk("src").filter((f) => /\.tsx?$/.test(f) && /sourceType:\s*["']expense["']/.test(read(f)));
check(`C4 copy: every t() key in the eight files (${c4Keys.size}) and every label they show through a map (${c4Labels.length}: the eight report names — picker and h2 — the six presets, the aging buckets, the account groups and normal-balance captions — the account h2 — and the payment methods) has an Arabic entry; so do the ledger source badges but "Expense", C3's untranslated label for a source nothing posts (no sourceType "expense" in src)`,
  c4NoArabic.length === 0 && c4Labels.length === 33 && same(badgeNoArabic, ["Expense"]) && postsExpense.length === 0, [...c4NoArabic, ...badgeNoArabic, ...postsExpense].join(" | "));
const c4Phys = C4_FILES.flatMap((f) => physical(f).map((x) => `${rel(f)}: ${x}`));
check("C4: no physical left / right in the eight finance files (none in C3 either; the report search sits at ms-auto, logical)", c4Phys.length === 0, c4Phys.join(" "));
const C4_BANNED = ["FinancePageLayout", "FinanceLayout", "FinanceShell", "ReportLayout", "ReportHeader", "AccountPageShell"];
const C4_BANNED_FILES = C4_BANNED.map((b) => b.replace(/[A-Z]/g, (c, i) => (i ? "-" : "") + c.toLowerCase()));
const c4Creep: string[] = [];
for (const f of walk("src").filter((f) => /\.(tsx?|css)$/.test(f))) {
  if (C4_BANNED_FILES.includes(path.posix.basename(f).replace(/\.[^.]+$/, ""))) c4Creep.push(`${f} (file)`);
  if (!/\.tsx?$/.test(f) || !C4_BANNED.some((b) => read(f).includes(b))) continue;
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && C4_BANNED.includes(n.text)) c4Creep.push(`${f}: ${n.text}`);
    ts.forEachChild(n, visit);
  };
  visit(parse(f));
}
const financeLayouts = c4FinanceFiles.filter((f) => /(^|\/)(layout|template)\.tsx?$/.test(f));
check(`C4: no finance page abstraction — none of ${C4_BANNED.join(", ")} (identifier or file), no layout or template under /finance; each route composes PageHeader, SectionHeader and EmptyState itself`,
  c4Creep.length === 0 && financeLayouts.length === 0, [...c4Creep, ...financeLayouts].join(" "));

// ---------- 13. C5 — Settings ----------
section("13. C5 — Settings");

// Nothing moved but C5's own changes: each Settings file is C4's (a1dbc6e) with exactly these hunks applied
// — [C4 code, C5 code], compared without comments or whitespace. Undo them all and the file must be C4's
// again, so a form, a field, a query, a save action, a permission, a tab value, MFA, the sessions, the
// readiness claims or a consent cannot change unseen.
const SH_IMPORT = `import { SectionHeader } from "@/components/ui/section-header";`;
const PH_IMPORT = `import { PageHeader } from "@/components/layout/page-header";`;
const panelHunk = (cls: string, key: string, extra = ""): [string, string] => [`<h3 className="${cls}">{t(locale, "${key}")}</h3>`, `<SectionHeader level={2} title={t(locale, "${key}")}${extra} />`];
const C5_HUNKS: Record<string, [string, string][]> = {
  [C5_NAV]: [
    ["", `import { useDocumentDir } from "./use-document-dir";`],
    ["const SettingsNav = TabsPrimitive.Root;",
      "function SettingsNav({ dir, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) { const docDir = useDocumentDir(); return <TabsPrimitive.Root dir={dir ?? docDir} {...props} />; }"],
    [`cn("settings-nav w-56 shrink-0", className)`, `cn("settings-nav w-full md:w-56 shrink-0", className)`],
    [`cn("settings-nav-item text-left rtl:text-right", className)`, `cn("settings-nav-item text-start", className)`],
    [`cn("flex-1 min-w-0", className)`, `cn("w-full min-w-0 md:flex-1", className)`],
  ],
  [C5_ORG]: [
    ["", PH_IMPORT],
    [`<div className="max-w-5xl mx-auto"><SettingsNav defaultValue={defaultTab} orientation="vertical" className="flex gap-8 items-start">`,
      `<div className="max-w-5xl mx-auto"><PageHeader title={t(locale, "Business Settings")} /><SettingsNav defaultValue={defaultTab} orientation="vertical" className="flex flex-col md:flex-row gap-8 items-start">`],
  ],
  [C5_COMPANY]: [["", SH_IMPORT], panelHunk("text-[17px] font-bold", "Business Details"), panelHunk("text-[17px] font-bold", "Logo"), panelHunk("text-[17px] font-bold", "Color Theme")],
  [C5_FINANCE]: [["", SH_IMPORT], panelHunk("text-[17px] font-bold", "Default Bank Account"), panelHunk("text-[17px] font-bold", "Fiscal Year")],
  [C5_VAT]: [["", SH_IMPORT], panelHunk("text-[17px] font-bold", "VAT Configuration")],
  [C5_NUMBERS]: [["", SH_IMPORT], panelHunk("text-[17px] font-bold", "Number Format")],
  [C5_ROLES]: [
    ["", SH_IMPORT], panelHunk("text-[17px] font-bold", "Roles & Permissions"),
    [`<h4 className="text-[13.5px] font-bold mb-1">{t(locale, "Actions restricted beyond their module")}</h4>`,
      `<h3 className="text-[13.5px] font-bold mb-1">{t(locale, "Actions restricted beyond their module")}</h3>`],
  ],
  [C5_ZATCA]: [["", SH_IMPORT], panelHunk("text-[17px] font-bold mb-1", "ZATCA Phase 1", ` className="mb-1"`)],
  [C5_TEAM]: [["", SH_IMPORT], panelHunk("text-[17px] font-bold", "Team")],
  [C5_PRESETS]: [["", PH_IMPORT], [`<div className="main-head"><h3>{t(locale, "Presets")}</h3></div>`, `<PageHeader title={t(locale, "Presets")} />`]],
  [C5_PRESET_BANK]: [["", SH_IMPORT], panelHunk("text-[15px] font-bold", "Default Bank Accounts")],
  [C5_PRINT]: [["", SH_IMPORT], panelHunk("text-[17px] font-bold", "Print Layout")],
  [C5_SEAL]: [["", SH_IMPORT], panelHunk("text-[17px] font-bold", "Seal & Signature")],
  [C5_SECURITY]: [
    ["", `${PH_IMPORT} ${SH_IMPORT} import { EmptyState } from "@/components/ui/empty-state";`],
    [`<div className="main-head"><h3>{t(locale, "Security Center")}</h3>{props.isAdmin && (<span className="pill"`,
      `<PageHeader title={t(locale, "Security Center")} meta={props.isAdmin && (<span className="pill"`],
    [`{t(locale, "Risk")}: {t(locale, risk.label)}</span>)}</div>`, `{t(locale, "Risk")}: {t(locale, risk.label)}</span>)} />`],
    ["style={{ borderLeft: `3px solid", "style={{ borderInlineStart: `3px solid"],
    [`<div className="text-[14px] font-bold">{t(locale, "Two-Factor Authentication")}</div>`, `<h2 className="text-[14px] font-bold">{t(locale, "Two-Factor Authentication")}</h2>`],
    [`<div className="text-[14px] font-bold">{t(locale, "Password")}</div>`, `<h2 className="text-[14px] font-bold">{t(locale, "Password")}</h2>`],
    [`<div className="main-head" style={{ marginTop: 8 }}><h3 style={{ fontSize: 15 }}>{t(locale, "Active Sessions")}</h3>{props.sessions.length > 1 && (`,
      `<SectionHeader level={2} title={t(locale, "Active Sessions")} actions={props.sessions.length > 1 && (`],
    [`{t(locale, "Log out all other devices")}</Button>)}</div>`, `{t(locale, "Log out all other devices")}</Button>)} className="mt-2 mb-[22px]" />`],
    [`<div className="main-head" style={{ marginTop: 26 }}><h3 style={{ fontSize: 15 }}>{t(locale, "Security Timeline")}</h3></div>`,
      `<SectionHeader level={2} title={t(locale, "Security Timeline")} className="mt-[26px] mb-[22px]" />`],
    [`<div className="rounded-2xl border border-line bg-surface shadow-elevated py-8 text-center text-ink-muted text-sm">{t(locale, "No security events yet.")}</div>`,
      `<EmptyState message={t(locale, "No security events yet.")} />`],
  ],
  [C5_COMPLIANCE]: [
    ["", `${PH_IMPORT} ${SH_IMPORT}`],
    [`<div className="main-head"><h3>{t(locale, "Security & Compliance Readiness")}</h3></div>`,
      `<PageHeader title={t(locale, "Security & Compliance Readiness")} description={t(locale, "An internal checklist of what this build implements. It is not a certification: no external audit has been carried out, and no framework compliance is claimed.")} />`],
    [`<p className="text-[12.5px] text-ink-muted mb-4">{t(locale, "An internal checklist of what this build implements. It is not a certification: no external audit has been carried out, and no framework compliance is claimed.")}</p>`,
      `<SectionHeader level={2} title={t(locale, "Readiness checklist")} className="mb-3" />`],
    [`<span className="text-[14px] font-bold">{t(locale, g.name)}</span>`, `<h3 className="text-[14px] font-bold">{t(locale, g.name)}</h3>`],
    [`<div className="text-[14px] font-bold mb-1">{t(locale, "Data Subject Rights")}</div>`, `<SectionHeader level={2} title={t(locale, "Data Subject Rights")} className="mb-1" />`],
    [`<div className="flex items-end gap-2"><div className="flex flex-col gap-1.5"><label htmlFor="erase-customer"`,
      `<div className="flex flex-wrap items-end gap-2"><div className="flex flex-col gap-1.5"><label htmlFor="erase-customer"`],
    [`<div className="text-[14px] font-bold mb-1">{t(locale, "Consent Management")}</div>`, `<SectionHeader level={2} title={t(locale, "Consent Management")} className="mb-1" />`],
    [`<div className="flex items-end gap-2 mb-4">`, `<div className="flex flex-wrap items-end gap-2 mb-4">`],
  ],
};
/** Each file at C4 (a1dbc6e), without comments or whitespace. */
const C4_FLAT: Record<string, string> = {
  [C5_NAV]: "d42e39989f7a332a", [C5_ORG]: "f0798b8a1486c4b4", [C5_COMPANY]: "ab8051f35529655c", [C5_FINANCE]: "2ba54fa5ad492b20", [C5_VAT]: "c911008175ccbd55",
  [C5_NUMBERS]: "f20afbc934d37b44", [C5_ROLES]: "7ae66eef76e88406", [C5_ZATCA]: "a82918c05d4ce20a", [C5_TEAM]: "01e032a9ba69d64e", [C5_PRESETS]: "c4cecd97733e5e58",
  [C5_PRESET_BANK]: "68260881f93f4cc4", [C5_PRINT]: "995f5e268b68dd44", [C5_SEAL]: "abd51251a2e6df44", [C5_SECURITY]: "0fa2f7494db3cd93", [C5_COMPLIANCE]: "ecf76892d0a7532b",
};
const c5HunkBad: string[] = [];
for (const f of C5_FILES) {
  let s = flat(read(f));
  for (const [was, is] of C5_HUNKS[f]) {
    const n = s.split(squash(is)).length - 1;
    if (n !== 1) c5HunkBad.push(`${rel(f)}: ${n}× ${squash(is).slice(0, 60)}…`);
    s = s.replace(squash(is), () => squash(was));
  }
  if (h16(s) !== C4_FLAT[f]) c5HunkBad.push(`${rel(f)}: not C4's once C5's hunks are undone (${h16(s)})`);
}
const nC5Hunks = Object.values(C5_HUNKS).flat().length;
check(`C5 changed nothing in the 15 Settings files but its own ${nC5Hunks} hunks: undo them and each is C4's code to the character (comments and whitespace aside) — every form, field, query, save action, permission, tab value, panel mapping, MFA / password / session control, readiness claim and consent control as it was`,
  c5HunkBad.length === 0 && nC5Hunks === 51 && C5_FILES.every((f) => f in C5_HUNKS && f in C4_FLAT), c5HunkBad.join(" | "));
const dictNow = read("src/lib/i18n/dict.ts");
check("C5's dictionary change is exactly its two additions — the four Settings navigation labels, and one structural heading — and nothing else (undone, dict.ts is C4's to the byte: group 12; C6's range-label digits aside, group 14)",
  C5_DICT_BLOCKS.every((b) => dictNow.split(b).length === 2) && h16(undoC5Dict(undoC6Dict(dictNow))) === "796829703fc96bf4", h16(undoC5Dict(undoC6Dict(dictNow))));
const C5_AR: Record<string, string> = {
  "Fiscal Year": "السنة المالية", "VAT Configuration": "إعدادات ضريبة القيمة المضافة", Users: "المستخدمون", Integrations: "التكاملات", "Readiness checklist": "قائمة التحقق من الجاهزية",
};
const arBad = Object.entries(C5_AR).filter(([en, ar]) => translate("ar", en) !== ar || translate("en", en) !== en).map(([en]) => `${en} → ${translate("ar", en)}`);
check("C5 Arabic: Fiscal Year → السنة المالية, VAT Configuration → إعدادات ضريبة القيمة المضافة, Users → المستخدمون, Integrations → التكاملات (the four navigation labels the audit found in English); Readiness checklist → قائمة التحقق من الجاهزية (the one structural label); English unchanged",
  arBad.length === 0, arBad.join(" | "));

// SettingsNav: the Tabs contract (DEV-UI-01.4) — Radix told the document's direction
const navCode = strip(read(C5_NAV));
const navFns = findAll(parse(C5_NAV), (n) => ts.isFunctionDeclaration(n)).map((n) => (n as ts.FunctionDeclaration).name?.text);
check("C5 SettingsNav: a function wrapping TabsPrimitive.Root — not the raw alias — that takes the document's direction from useDocumentDir (the existing hook, imported from ./use-document-dir) and passes dir={dir ?? docDir}, a caller's dir still winning; no other direction source (no document.documentElement, navigator, locale or hard-coded rtl / ltr)",
  !/const SettingsNav\s*=/.test(navCode) && same(navFns, ["SettingsNav", "SettingsNavList", "SettingsNavGroupLabel", "SettingsNavItem", "SettingsNavContent"])
    && flat(navCode).includes(squash("function SettingsNav({ dir, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) { const docDir = useDocumentDir(); return <TabsPrimitive.Root dir={dir ?? docDir} {...props} />; }"))
    && same(imports(C5_NAV), ["react", "@radix-ui/react-tabs", "@/lib/utils", "./use-document-dir"])
    && !/documentElement|navigator|locale|["'`](rtl|ltr)["'`]/.test(navCode),
  imports(C5_NAV).join(" "));
check("C5 SettingsNav: items align to the start (text-start; no text-left / text-right, no rtl: variant); the list full width below md and 14rem (w-56) from md, shrink-0; the panel full width and min-w-0, growing beside the list from md (md:flex-1); no physical left / right anywhere in the file",
  navCode.includes(`"settings-nav-item text-start"`) && !/text-(left|right)|rtl:/.test(navCode) && navCode.includes(`"settings-nav w-full md:w-56 shrink-0"`) && navCode.includes(`"w-full min-w-0 md:flex-1"`) && physical(C5_NAV).length === 0,
  physical(C5_NAV).join(" "));
check("C5: Tabs (the shared primitive Presets uses) and useDocumentDir are byte-identical — no direction code changed, no second direction hook; useDocumentDir is defined once in src",
  sha("src/components/ui/tabs.tsx") === "7c8265b2e3e96f33" && sha("src/components/ui/use-document-dir.ts") === "c6d2a8f0c5bdcc8e"
    && walk("src").filter((f) => /\.tsx?$/.test(f) && /function useDocumentDir|const useDocumentDir\s*=/.test(read(f))).length === 1);

// Business Settings
const orgCode = flat(read(C5_ORG));
const orgPh = jsxEls(C5_ORG, "PageHeader");
const navRoot = jsxEls(C5_ORG, "SettingsNav")[0];
const navItems = jsxEls(C5_ORG, "SettingsNavItem").map((el) => `${attrCode(el, "value")}`);
const navContents = jsxEls(C5_ORG, "SettingsNavContent").map((el) => attrCode(el, "value"));
check("C5 Business Settings: one PageHeader — title t(locale, \"Business Settings\") and nothing else — right before SettingsNav, outside every tab panel, so the page has its one h1 whichever tab shows; the root a column below md and a row from md (flex flex-col md:flex-row gap-8 items-start), vertical, defaultValue={defaultTab}",
  orgPh.length === 1 && orgPh[0].attributes.properties.length === 1 && attrCode(orgPh[0], "title") === `{t(locale,"BusinessSettings")}`
    && orgCode.includes(squash(`<PageHeader title={t(locale, "Business Settings")} /><SettingsNav`)) && attrCode(navRoot, "className") === `"flexflex-colmd:flex-rowgap-8items-start"`
    && attrCode(navRoot, "orientation") === `"vertical"` && attrCode(navRoot, "defaultValue") === "{defaultTab}",
  orgPh.map((el) => el.getText()).join(" "));
check("C5 Business Settings tabs: SETTINGS_TABS, the default color-theme, the ?tab= reading and its fallback, the ZATCA gating and its fallback as in C4 (canonical); the ten SettingsNavItems in order, each panel mapped to its tab as before, ZATCA only for the profiles that enable it",
  same(varHash(C5_ORG, "SETTINGS_TABS"), ["d073437943550e16"]) && orgCode.includes(squash(`const requestedTab = tab && SETTINGS_TABS.has(tab) ? tab : "color-theme";`))
    && orgCode.includes(squash(`const defaultTab = requestedTab === "zatca" && !showZatca ? "color-theme" : requestedTab;`))
    && same(navItems, ['"business-details"', '"logo"', '"color-theme"', '"default-bank"', '"fiscal-year"', '"vat-config"', '"number-format"', '"team"', '"roles-permissions"', '"zatca"'])
    && same(navContents, navItems) && orgCode.includes(squash(`{showZatca && (<><SettingsNavGroupLabel>{t(locale, "Integrations")}</SettingsNavGroupLabel><SettingsNavItem value="zatca">`)),
  navItems.join(" "));

// Panel titles: the 13 top-level ones are h2s, nested subsections one level below their panel
const panelBad = C5_PANELS.filter(([f, key]) => {
  const els = jsxEls(f, "SectionHeader").filter((el) => attrCode(el, "title") === squash(`{t(locale, "${key}")}`));
  return els.length !== 1 || attrCode(els[0], "level") !== "{2}";
}).map(([f, key]) => `${rel(f)} ${key}`);
const oldTitles = [...C5_FILES].filter((f) => /<h3 className="text-\[1[57]px\] font-bold/.test(read(f)) || /className="main-head"/.test(read(f))).map(rel);
check("C5 panel titles: the 13 top-level Settings panel titles — Business Details, Logo, Color Theme, Default Bank Account, Fiscal Year, VAT Configuration, Number Format, Team, Roles & Permissions, ZATCA Phase 1; Presets' Default Bank Accounts, Print Layout, Seal & Signature — each one SectionHeader level={2} with its own words (h3s before); no old h3 title or .main-head left in a C5 file",
  panelBad.length === 0 && oldTitles.length === 0, [...panelBad, ...oldTitles].join(" | "));
check("C5 nested headings stay nested: Roles & Permissions' \"Actions restricted beyond their module\" is now an h3 — one level below its panel's h2, as the h4 was below the h3 (left an h4 it would skip a level); VAT Configuration and Number Format keep their title behind `heading`, which the two document pill dialogs (byte-identical) turn off",
  read(C5_ROLES).includes(`<h3 className="text-[13.5px] font-bold mb-1">{t(locale, "Actions restricted beyond their module")}</h3>`) && !/<h4/.test(read(C5_ROLES))
    && read(C5_VAT).includes(`{heading && <SectionHeader level={2} title={t(locale, "VAT Configuration")} />}`) && flat(read(C5_NUMBERS)).includes(squash(`{heading && (<div><SectionHeader level={2} title={t(locale, "Number Format")} />`))
    && sha(`${A}sales/_shared/vat-settings-pill-dialog.tsx`) === "55dae906efd9f1e3" && sha(`${A}sales/_shared/number-format-pill-dialog.tsx`) === "fd428ae359fd7540");

// Presets
const prCode = flat(read(C5_PRESETS));
const prTabs = jsxEls(C5_PRESETS, "TabsTrigger").map((el) => attrCode(el, "value"));
const prContents = jsxEls(C5_PRESETS, "TabsContent").map((el) => attrCode(el, "value"));
const PRESET_TABS = ["tax-rates", "payment-terms", "units", "note-templates", "terms-groups", "bundles", "numbering", "exchange-rates", "print-layout", "seal-signature", "default-bank-accounts", "departments", "product-categories", "leave-types"];
check("C5 Presets: the PageHeader titled Presets (not Preset Management — deferred) and nothing else; the shared Tabs (direction-aware since DEV-UI-01.4), defaultValue tax-rates; the 14 tabs in their order with their labels, and their 14 panels",
  same(jsxEls(C5_PRESETS, "PageHeader").map((el) => el.getText()), [`<PageHeader title={t(locale, "Presets")} />`]) && same(prTabs, PRESET_TABS.map((v) => `"${v}"`)) && same([...prContents].sort(), PRESET_TABS.map((v) => `"${v}"`).sort())
    && prCode.includes(squash(`<Tabs defaultValue="tax-rates">`)) && imports(C5_PRESETS).includes("@/components/ui/tabs"),
  prTabs.join(" "));

// Security
const secCode = flat(read(C5_SECURITY));
const secPh = jsxEls(C5_SECURITY, "PageHeader");
check("C5 Security Center: one PageHeader — Security Center as the title, the admin-only risk pill (its colours, weight and words as before) as the meta, outside the h1",
  secPh.length === 1 && attrCode(secPh[0], "title") === `{t(locale,"SecurityCenter")}`
    && attrCode(secPh[0], "meta") === squash(`{props.isAdmin && (<span className="pill" style={{ background: risk.bg, color: risk.color, fontWeight: 700 }}>{t(locale, "Risk")}: {t(locale, risk.label)}</span>)}`),
  secPh.map((el) => el.getText()).join(" "));
const secH2 = jsxEls(C5_SECURITY, "SectionHeader").map((el) => [attrCode(el, "title"), attrCode(el, "level"), attrCode(el, "actions"), attrCode(el, "className")]);
check("C5 Security outline: Two-Factor Authentication and Password real h2s in their cards (icon, text, Enable / Disable and Change password as they were); Active Sessions an h2 (SectionHeader) with Log out all other devices as its action, only when there is another session; Security Timeline an h2 (SectionHeader), no action",
  secCode.includes(squash(`<h2 className="text-[14px] font-bold">{t(locale, "Two-Factor Authentication")}</h2>`)) && secCode.includes(squash(`<h2 className="text-[14px] font-bold">{t(locale, "Password")}</h2>`))
    && same(secH2, [
      [`{t(locale,"ActiveSessions")}`, "{2}", squash(`{props.sessions.length > 1 && (<Button variant="secondary" size="sm" disabled={pending} onClick={logoutAll}><LogOut className="size-3.5" /> {t(locale, "Log out all other devices")}</Button>)}`), `"mt-2mb-[22px]"`],
      [`{t(locale,"SecurityTimeline")}`, "{2}", "", `"mt-[26px]mb-[22px]"`],
    ]),
  JSON.stringify(secH2));
check("C5 Security Timeline: no event → the EmptyState \"No security events yet.\" (no hint, no action); events → the same table as before",
  secCode.includes(squash(`{props.events.length === 0 ? (<EmptyState message={t(locale, "No security events yet.")} />) : (<Table density="compact">`)) && jsxEls(C5_SECURITY, "EmptyState").length === 1);
check("C5 Security frozen: fmtDateTime (P0.1's explicit UTC — sessions, events, the password date), RISK_STYLE (deferred) canonical as in C4; the alerts' 3px severity stripe declared on border-inline-start with C4's severity expression, no borderLeft / borderRight in the file; the admin attack-stat row (D-6's bare .stat-row-2) untouched",
  same(fnHash(C5_SECURITY, "fmtDateTime"), ["436a504b4f04dfdb"]) && same(varHash(C5_SECURITY, "RISK_STYLE"), ["e98103a242541402"])
    && secCode.includes(squash("style={{ borderInlineStart: `3px solid ${a.severity === \"high\" || a.severity === \"critical\" ? \"var(--crit)\" : \"var(--warn)\"}` }}")) && !/border(Left|Right)/.test(secCode)
    && secCode.includes(squash(`<div className="stat-row-2 mb-6">`)) && physical(C5_SECURITY).length === 0,
  [...fnHash(C5_SECURITY, "fmtDateTime"), ...varHash(C5_SECURITY, "RISK_STYLE"), ...physical(C5_SECURITY)].join(" "));

// Compliance
const cmpCode = flat(read(C5_COMPLIANCE));
const cmpPh = jsxEls(C5_COMPLIANCE, "PageHeader");
const DISCLAIMER = "An internal checklist of what this build implements. It is not a certification: no external audit has been carried out, and no framework compliance is claimed.";
check("C5 Compliance: one PageHeader — the existing title Security & Compliance Readiness (not Compliance Center — deferred), its disclaimer, word for word, as the description",
  cmpPh.length === 1 && attrCode(cmpPh[0], "title") === `{t(locale,"Security&ComplianceReadiness")}` && attrCode(cmpPh[0], "description") === squash(`{t(locale, "${DISCLAIMER}")}`)
    && read(C5_COMPLIANCE).split(DISCLAIMER).length === 2,
  cmpPh.map((el) => el.getText()).join(" "));
const cmpSh = jsxEls(C5_COMPLIANCE, "SectionHeader").map((el) => [attrCode(el, "title"), attrCode(el, "level")]);
check("C5 Compliance outline: Readiness checklist (h2 — the one structural label C5 added) › GDPR, ISO 27001 — roadmap, Platform security (the group names, real h3s; their notes outside); Data Subject Rights and Consent Management h2s (SectionHeader), their descriptions and controls as they were",
  same(cmpSh, [[`{t(locale,"Readinesschecklist")}`, "{2}"], [`{t(locale,"DataSubjectRights")}`, "{2}"], [`{t(locale,"ConsentManagement")}`, "{2}"]])
    && cmpCode.includes(squash(`<h3 className="text-[14px] font-bold">{t(locale, g.name)}</h3></div><p className="text-[11.5px] text-ink-faint mb-3">{t(locale, g.note)}</p>`)),
  JSON.stringify(cmpSh));
check("C5 Compliance at 390: the erase row and the consent row wrap (flex-wrap) — the customer select, Erase, the consent subject, Grant and Withdraw stay in reach; the same controls, handlers and states",
  cmpCode.includes(squash(`<div className="flex flex-wrap items-end gap-2"><div className="flex flex-col gap-1.5"><label htmlFor="erase-customer"`)) && cmpCode.includes(squash(`<div className="flex flex-wrap items-end gap-2 mb-4">`))
    && physical(C5_COMPLIANCE).length === 0);
check("C5 Compliance frozen: fmtDate (P0.1's explicit UTC), groupsFor (the groups, notes, controls and their states, the live encryption / audit-trigger detection), STATE_LABEL and the consent subjects canonical as in C4",
  same(fnHash(C5_COMPLIANCE, "fmtDate"), ["fb4fd835f7357655"]) && same(fnHash(C5_COMPLIANCE, "groupsFor"), ["349c4f69b8428605"]) && same(varHash(C5_COMPLIANCE, "STATE_LABEL"), ["f5dc655ee0f5c9de"])
    && same(varHash(C5_COMPLIANCE, "CONSENT_SUBJECTS"), ["288d203f69389eee"]),
  [...fnHash(C5_COMPLIANCE, "fmtDate"), ...fnHash(C5_COMPLIANCE, "groupsFor"), ...varHash(C5_COMPLIANCE, "STATE_LABEL"), ...varHash(C5_COMPLIANCE, "CONSENT_SUBJECTS")].join(" "));

// Data, guards, actions; the rest of Settings
const C5_UNTOUCHED: Record<string, string> = {
  [`${ST}compliance/page.tsx`]: "1574d57340edbe48", [`${ST}organization/number-format-panel.tsx`]: "59e2635c8aa1a139", [`${ST}presets/bundles-panel.tsx`]: "cee5b52fd8db98db",
  [`${ST}presets/exchange-rates-panel.tsx`]: "9954aab1deb2c1f7", [`${ST}presets/note-templates-panel.tsx`]: "686f0110f2d8af35", [`${ST}presets/numbering-panel.tsx`]: "169fb5f21bd173ae",
  [`${ST}presets/simple-preset-panel.tsx`]: "4b0a75c8a9d77526", [`${ST}presets/terms-groups-panel.tsx`]: "a0265883da6a8aa8", [`${ST}security/page.tsx`]: "79c35b566dc7bf81",
  [`${ST}team/page.tsx`]: "a90a8a2e94cf42d1",
};
const stBiz = Object.keys(pins.business).filter((k) => k.startsWith(ST)).sort();
const stFiles = walk(`${A}settings`);
const stUnaccounted = stFiles.filter((f) => !C5_FILES.includes(f) && !(f in C5_UNTOUCHED) && !stBiz.includes(f));
const stDrift = Object.entries(C5_UNTOUCHED).filter(([f, hsh]) => !exists(f) || sha(f) !== hsh).map(([f]) => rel(f));
check(`C5: the other ${Object.keys(C5_UNTOUCHED).length} Settings files byte-identical to C4 — the Security and Compliance pages (their server props), /settings/team (the redirect), Presets' other panels (SimplePresetPanel and its Add controls, deferred), the Number Format wrapper; every Settings file is C5's, one of these, or one of the ${stBiz.length} action modules (business pins, group 4)`,
  stDrift.length === 0 && stUnaccounted.length === 0 && stBiz.length === 7 && stFiles.length === C5_FILES.length - 1 + Object.keys(C5_UNTOUCHED).length + stBiz.length,
  [...stDrift, ...stUnaccounted.map((f) => `unaccounted: ${f}`)].join(" "));
const C5_PAGES = ["organization", "presets", "security", "compliance", "team"].map((p) => `(app)/settings/${p}/page.tsx`);
check("C5: the Settings pages' guards (owner / admin for Business Settings, Presets and Compliance; any session for Security, its admin view as before; the /settings/team redirect), server data sections (the organization, posted-journal count, country profile, bank accounts, members, presets and rates, security and compliance props) and static action inventories are the pinned ones; the seven Settings action modules their business pins",
  C5_PAGES.every((p) => same(now.guards[p], pins.guards[p]) && same(now.data[p], pins.data[p]) && same(now.actions[p], pins.actions[p]))
    && stBiz.every((f) => now.business[f] === pins.business[f]) && same(pins.guards["(app)/settings/team/page.tsx"], ['redirect("/settings/organization?tab=team")']),
  C5_PAGES.filter((p) => !same(now.guards[p], pins.guards[p]) || !same(now.data[p], pins.data[p]) || !same(now.actions[p], pins.actions[p])).join(" "));
check("C5: the P0 / P0.1 / P0.2 verifiers as C4 left them — the Arabic-locale hydration suite with C4's approved Payments selector (a226b47188ddf478), the settings time-zone and business-date hydration suites, number-locale, date-timezone, business-dates",
  sha("verify/verify-ar-locale-hydration.mjs") === "a226b47188ddf478" && sha("verify/verify-settings-timezone-hydration.mjs") === "a43b9d9f7b521da6" && sha("verify/verify-business-date-hydration.mjs") === "02ef92b957d4d719"
    && sha("verify/verify-number-locale.mts") === "1e1937186eb24bb3" && sha("verify/verify-date-timezone.mts") === "e6be633c8a2af74d" && sha("verify/verify-business-dates.mts") === "ad9171672e94ddd6");
const C5_BANNED = ["SettingsLayout", "SettingsShell", "SettingsPageLayout", "SettingsPanel", "SettingsSection", "SettingsHeader", "SettingsContainer"];
const c5Creep = walk("src").filter((f) => /\.(tsx?|css)$/.test(f) && C5_BANNED.some((b) => new RegExp(`\\b${b}\\b`).test(strip(read(f))) || f.toLowerCase().includes(b.replace(/[A-Z]/g, (c, i) => (i ? "-" : "") + c.toLowerCase()))));
const settingsLayouts = stFiles.filter((f) => /(^|\/)(layout|template)\.tsx?$/.test(f));
check(`C5: no Settings abstraction — none of ${C5_BANNED.join(", ")} (identifier or file), no layout or template under /settings; each page composes PageHeader, SectionHeader, EmptyState and SettingsNav itself`,
  c5Creep.length === 0 && settingsLayouts.length === 0, [...c5Creep, ...settingsLayouts].join(" "));
// C5 adds no physical left / right. Two Settings panels carry C4's own (deferred; their code is C4's per the hunk
// check above): the Color Theme cards' text-left and the checkmark at right-3, the Print Layout options' text-left.
const C5_PHYS_C4: Record<string, string[]> = { [C5_COMPANY]: ["text-left", "right-3"], [C5_PRINT]: ["text-left", "text-left"] };
const c5Phys = C5_FILES.filter((f) => !same(physical(f), C5_PHYS_C4[f] ?? [])).map((f) => `${rel(f)}: ${physical(f).join(" ")}`);
check("C5: no physical left / right added — none in SettingsNav, Security or Compliance (the alert stripe now border-inline-start); the only ones left in a C5 file are C4's own, deferred: Color Theme's text-left / right-3 and Print Layout's two text-left",
  c5Phys.length === 0 && [C5_NAV, C5_SECURITY, C5_COMPLIANCE, C5_ORG, C5_PRESETS].every((f) => physical(f).length === 0), c5Phys.join(" | "));

// ---------- 14. C6 — the Dashboard ----------
section("14. C6 — the Dashboard");

// Nothing moved but C6's own changes: each Dashboard file is C5's (e8f629b) with exactly these hunks applied —
// [C5 code, C6 code], compared without comments or whitespace. Undo them all and the file must be C5's again, so
// a query call, a range, a preference, an action, a figure, a link, a status colour or a widget's size cannot
// change unseen.
const kpiAttrs = (label: string, rest: string) => `<KpiCard locale={locale} label="${label}" ${rest} />`;
const toRtl = (link: string) => [`{t(locale, "${link}")} <ChevronRight className="size-3" style={{ color: "var(--brand-orange)" }} />`, `{t(locale, "${link}")} <ChevronRight className="size-3 rtl:rotate-180" style={{ color: "var(--brand-orange)" }} />`] as [string, string];
const C6_HUNKS: Record<string, [string, string][]> = {
  [C6_PAGE]: [
    ['import { ShoppingCart, FileText, Wallet, CreditCard, BookOpen, ChevronRight, FileSignature, Building2, UserPlus, Shield, Lock, TrendingUp, RefreshCw, Link2 } from "lucide-react";',
      'import { ShoppingCart, FileText, Wallet, CreditCard, BookOpen, ChevronRight, FileSignature, Building2, UserPlus, Shield } from "lucide-react";'],
    ["", `import { formatDisplayDate } from "@/lib/i18n/format-date"; ${PH_IMPORT}`],
    ['import { ComboChart, Donut, Sparkline } from "./_shared/charts";', 'import { ComboChart, Donut } from "./_shared/charts";'],
    ['function DashWidget({ col, row, children }: { col: number; row: number; children: React.ReactNode }) { return (<div className="dash-widget" style={{ gridColumn: `span ${col}`, gridRow: `span ${row}` }}>{children}</div>); }',
      'function DashWidget({ col, row, wide, children }: { col: number; row: number; wide?: boolean; children: React.ReactNode }) { return (<div className="dash-widget" data-wide={wide ? "" : undefined} style={{ "--dash-span": col, "--dash-rows": row } as React.CSSProperties}>{children}</div>); }'],
    ["const revenueLabels = revenue.map((p) => p.label); const expenseSeries = revenue.map(() => 0); const totalProfit = kpis.totalSalesThisMonth; const profitMarginPct = kpis.totalSalesThisMonth > 0 ? 100 : 0;",
      "const revenueLabels = revenue.map((p) => p.label);"],
    ["const spark = revenueSeries.length > 1 ? revenueSeries : [0, 0];", "const revenueSpark = revenueSeries.length > 1 ? revenueSeries : undefined;"],
    [kpiAttrs("Total Sales", 'value={fmt(kpis.totalSalesThisMonth)} isCurrency trendPct={kpis.totalSalesTrend.pct} trendUp={kpis.totalSalesTrend.up} icon={ShoppingCart} accent="var(--brand-orange)" sparkValues={spark}'),
      kpiAttrs("Total Sales", 'value={fmt(kpis.totalSalesThisMonth)} isCurrency trendPct={kpis.totalSalesTrend.pct} trendUp={kpis.totalSalesTrend.up} icon={ShoppingCart} accent="var(--brand-orange)" sparkValues={revenueSpark}')],
    [kpiAttrs("Total Invoices", 'value={String(kpis.totalInvoices)} trendPct={kpis.totalInvoicesTrend.pct} trendUp={kpis.totalInvoicesTrend.up} icon={FileText} accent="var(--accent-purple)" sparkValues={spark}'),
      kpiAttrs("Total Invoices", 'value={String(kpis.totalInvoices)} trendPct={kpis.totalInvoicesTrend.pct} trendUp={kpis.totalInvoicesTrend.up} icon={FileText} accent="var(--accent-purple)"')],
    [kpiAttrs("Total Receivables", 'value={fmt(kpis.totalReceivables)} isCurrency trendPct="0%" trendUp icon={Wallet} accent="var(--accent-green)" sparkValues={spark}'),
      kpiAttrs("Total Receivables", 'value={fmt(kpis.totalReceivables)} isCurrency icon={Wallet} accent="var(--accent-green)"')],
    [kpiAttrs("Total Payables", 'value={fmt(kpis.totalPayables)} isCurrency trendPct="0%" trendUp={false} icon={CreditCard} accent="var(--accent-red)" sparkValues={[0, 0]}'),
      kpiAttrs("Total Payables", 'value={fmt(kpis.totalPayables)} isCurrency icon={CreditCard} accent="var(--accent-red)"')],
    ['<DashWidget col={8} row={5}><div className="card fin-card" style={{ display: "grid", gridTemplateColumns: "1.9fr 1.1fr", gap: 24 }}><div><div className="fin-head"><h4 style={{ fontSize: 14, fontWeight: 700 }}>{t(locale, "Financial Overview")}</h4><div className="select-pill" style={{ pointerEvents: "none" }}>{rangeLabel}</div></div>' +
      '<div className="fin-profit-label">{t(locale, "Total Profit")} · {rangeLabel}</div><div style={{ display: "flex", alignItems: "baseline", gap: 14 }}><div className="fin-profit-value"><Money amount={totalProfit} context="summary" /></div></div>' +
      '<div className="fin-legend" style={{ marginTop: 14 }}><span><span className="dot" style={{ background: "var(--brand-orange)" }} />{t(locale, "Revenue")}</span><span><span className="dot" style={{ background: "var(--chart-navy)" }} />{t(locale, "Expenses")}</span></div>' +
      '<div style={{ marginTop: 8 }}><ComboChart revenue={spark} expenses={expenseSeries.length > 1 ? expenseSeries : [0, 0]} labels={revenueLabels.length > 1 ? revenueLabels : ["", ""]} /></div></div>' +
      '<div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 24, display: "flex", flexDirection: "column", alignItems: "center" }}><div style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 600, color: "var(--ink-muted)", marginBottom: 10 }}>{t(locale, "Profit Margin")}</div>' +
      '<Donut segments={[{ value: profitMarginPct, color: "var(--brand-orange)" }, { value: 100 - profitMarginPct, color: "var(--chart-navy)" }]} size={150} thickness={17} centerLabel={t(locale, "Profit Margin")} centerValue={`${profitMarginPct.toFixed(0)}%`} />' +
      '<div style={{ width: "100%", marginTop: 16 }}><div className="donut-legend-row"><span className="lbl"><span className="dot" style={{ background: "var(--brand-orange)" }} />{t(locale, "Total Revenue")}</span><span className="val"><Money amount={kpis.totalSalesThisMonth} context="summary" /></span></div>' +
      '<div className="donut-legend-row"><span className="lbl"><span className="dot" style={{ background: "var(--chart-navy)" }} />{t(locale, "Total Expenses")}</span><span className="val"><Money amount={0} context="summary" /></span></div>' +
      '<div className="donut-legend-row" style={{ borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 10 }}><span className="lbl" style={{ fontWeight: 600, color: "var(--ink)" }}>{t(locale, "Total Profit")}</span><span className="val" style={{ color: "var(--accent-green)" }}><Money amount={totalProfit} context="summary" /></span></div></div></div></div></DashWidget>',
      '<DashWidget col={8} row={5} wide><div className="card fin-card"><div className="fin-head"><h2 style={{ fontSize: 14, fontWeight: 700 }}>{t(locale, "Financial Overview")}</h2><div className="select-pill" style={{ pointerEvents: "none" }}>{rangeLabel}</div></div>' +
      '<div className="fin-total-label">{t(locale, "Total Revenue")} · {rangeLabel}</div><div className="fin-total-value"><Money amount={kpis.totalSalesThisMonth} context="summary" /></div>' +
      '{revenueSpark && (<div style={{ marginTop: 14 }}><ComboChart revenue={revenueSpark} labels={revenueLabels} /></div>)}</div></DashWidget>'],
    ['<div className="side-panel-head"><h4>{t(locale, "Quick Actions")}</h4></div>', '<div className="side-panel-head"><h2>{t(locale, "Quick Actions")}</h2></div>'],
    ['<div className="side-panel-head"><h4>{t(locale, "Recent Activities")}</h4></div>', '<div className="side-panel-head"><h2>{t(locale, "Recent Activities")}</h2></div>'],
    ['<div className="activity-time">{a.time.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")}</div>', '<div className="activity-time">{formatDisplayDate(a.time, locale, "dateTime")}</div>'],
    ['<div className="activity-chev"><ChevronRight className="size-3.5" /></div>', '<div className="activity-chev"><ChevronRight className="size-3.5 rtl:rotate-180" /></div>'],
    ['<h4>{t(locale, "Cash Flow")} · {rangeLabel}</h4>', '<h2>{t(locale, "Cash Flow")} · {rangeLabel}</h2>'],
    ['<span className="val"><Money amount={cashFlow.net} context="summary" /></span></div><div style={{ marginTop: 12 }}><Sparkline values={[cashFlow.inflow || 1, cashFlow.outflow || 1, Math.abs(cashFlow.net) || 1]} color="var(--accent-green)" w={180} h={46} /></div>',
      '<span className="val"><Money amount={cashFlow.net} context="summary" /></span></div>'],
    ['<h4 style={{ alignSelf: "flex-start" }}>{t(locale, "Invoices Overview")}</h4>', '<h2 style={{ alignSelf: "flex-start" }}>{t(locale, "Invoices Overview")}</h2>'],
    toRtl("View All Invoices"),
    ['<h4>{t(locale, "Project Overview")}</h4>', '<h2>{t(locale, "Project Overview")}</h2>'],
    toRtl("Go to Projects"),
    ['<h4>{t(locale, "HR Snapshot")}</h4>', '<h2>{t(locale, "HR Snapshot")}</h2>'],
    toRtl("Go to HRM"),
    ["<DashboardToolbar locale={locale} range={rangeKey} layout={prefs.layout} />", '<PageHeader title={t(locale, "Dashboard")} actions={<DashboardToolbar locale={locale} range={rangeKey} layout={prefs.layout} />} />'],
    ['{featureStripVisible && (<div className="feature-strip">{showZatca && (<div className="feature-card"><div className="f-icon"><Shield className="size-4.5" /></div><div><div className="f-title">{t(locale, "ZATCA Phase 1 QR")}</div><div className="f-sub">{t(locale, "On printed tax invoices")}</div></div></div>)}' +
      '<div className="feature-card"><div className="f-icon"><Lock className="size-4.5" /></div><div><div className="f-title">{t(locale, "Secure & Reliable")}</div><div className="f-sub">{t(locale, "Encrypted connection, encrypted credentials")}</div></div></div>' +
      '<div className="feature-card"><div className="f-icon"><TrendingUp className="size-4.5" /></div><div><div className="f-title">{t(locale, "Real-time Insights")}</div><div className="f-sub">{t(locale, "Data driven decisions")}</div></div></div>' +
      '<div className="feature-card"><div className="f-icon"><RefreshCw className="size-4.5" /></div><div><div className="f-title">{t(locale, "Automated Processes")}</div><div className="f-sub">{t(locale, "Save time, work smarter")}</div></div></div>' +
      '<div className="feature-card highlight"><div className="f-icon"><Link2 className="size-4.5" /></div><div><div className="f-title">{t(locale, "CRM Integration")} <span className="coming-soon-pill">{t(locale, "Coming Soon")}</span></div><div className="f-sub">{t(locale, "We will connect our existing CRM")}</div></div></div></div>)}',
      '{featureStripVisible && showZatca && (<div className="feature-strip"><div className="feature-card"><div className="f-icon"><Shield className="size-4.5" /></div><div><div className="f-title">{t(locale, "ZATCA Phase 1 QR")}</div><div className="f-sub">{t(locale, "On printed tax invoices")}</div></div></div></div>)}'],
  ],
  [C6_TOOLBAR]: [['<div className="toolbar-actions-right"><CustomizeLayoutDialog locale={locale} layout={layout} /></div>', "<CustomizeLayoutDialog locale={locale} layout={layout} />"]],
  [C6_KPI]: [
    ["trendPct: string; trendUp: boolean; icon: LucideIcon; accent: string; sparkValues: number[];", "trendPct?: string; trendUp?: boolean; icon: LucideIcon; accent: string; sparkValues?: number[];"],
    ['<div className={`kpi-trend ${trendUp ? "up" : "down"}`}>{trendUp ? <ArrowUp className="size-2.5" style={{ color: "var(--accent-green)" }} /> : <ArrowDown className="size-2.5" style={{ color: "var(--accent-red)" }} />}{trendPct} <span className="muted">{t(locale, "vs prev. period")}</span></div><div className="kpi-spark"><Sparkline values={sparkValues} color={accent} /></div>',
      '{trendPct !== undefined && trendUp !== undefined && (<div className={`kpi-trend ${trendUp ? "up" : "down"}`}>{trendUp ? <ArrowUp className="size-2.5" style={{ color: "var(--accent-green)" }} /> : <ArrowDown className="size-2.5" style={{ color: "var(--accent-red)" }} />}{trendPct} <span className="muted">{t(locale, "vs prev. period")}</span></div>)}' +
      '{sparkValues && sparkValues.length > 1 && (<div className="kpi-spark"><Sparkline values={sparkValues} color={accent} /></div>)}'],
  ],
  [C6_CHARTS]: [
    ["expenses: number[];", "expenses?: number[];"],
    ["const hi = Math.max(...revenue, ...expenses) * 1.15 || 1;", "const hi = Math.max(...revenue, ...(expenses ?? [])) * 1.15 || 1;"],
    ["const expPts = expenses.map((v, i) => [padL + i * step, y(v)] as const);", "const expPts = expenses?.map((v, i) => [padL + i * step, y(v)] as const);"],
    ['const expLine = expPts.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(" L ");', 'const expLine = expPts?.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(" L ");'],
    ['<path d={`M ${expLine}`} fill="none" stroke="var(--chart-navy)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />',
      '{expPts && <path d={`M ${expLine}`} fill="none" stroke="var(--chart-navy)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />}'],
    ["{expPts.map(([x, yy], i) => (", "{expPts?.map(([x, yy], i) => ("],
  ],
};
/** Each file at C5 (e8f629b), without comments or whitespace. */
const C5_FLAT: Record<string, string> = { [C6_PAGE]: "4b3073f0ec0ca844", [C6_TOOLBAR]: "68302bc6550726d7", [C6_KPI]: "bc1ed47eb2b84aa7", [C6_CHARTS]: "9d034282a19415b3" };
const c6HunkBad: string[] = [];
for (const f of C6_FILES) {
  let s = flat(read(f));
  for (const [was, is] of C6_HUNKS[f]) {
    const n = s.split(squash(is)).length - 1;
    if (n !== 1) c6HunkBad.push(`${rel(f)}: ${n}× ${squash(is).slice(0, 60)}…`);
    s = s.replace(squash(is), () => squash(was));
  }
  if (h16(s) !== C5_FLAT[f]) c6HunkBad.push(`${rel(f)}: not C5's once C6's hunks are undone (${h16(s)})`);
}
const nC6Hunks = Object.values(C6_HUNKS).flat().length;
check(`C6 changed nothing in the four Dashboard files but its own ${nC6Hunks} hunks: undo them and each is C5's code to the character (comments and whitespace aside) — every query call, range, preference, action, link, figure, status colour, widget key and size, Quick Actions, Invoices Overview, Project Overview, HR Snapshot and the base-currency notice as they were`,
  c6HunkBad.length === 0 && nC6Hunks === 34 && C6_FILES.every((f) => f in C6_HUNKS && f in C5_FLAT), c6HunkBad.join(" | "));
const c6CssCount = C6_CSS_HUNKS.map(([, is]) => cssNow.split(cssFlat(is)).length - 1);
check(`C6's stylesheet change is its ${C6_CSS_HUNKS.length} Dashboard hunks and nothing else: undo them and mockup-parity.css is C5's (C4's) to the character (comments and whitespace aside) — .stat-row-2, .two-col, .acct-grid, .cost-breakdown-grid, .kanban, Settings, document and print rules untouched`,
  same(c6CssCount, C6_CSS_HUNKS.map(() => 1)) && h16(undoC6Css(cssNow)) === "87c4bda56f3dc27f", `${c6CssCount.join(" ")} ${h16(undoC6Css(cssNow))}`);
check("C6's dictionary change is its one edit — the Dashboard's Last 7 Days / Last 30 Days with their number in Western digits (آخر 7 أيام, آخر 30 يوماً; C5 آخر ٧ أيام, آخر ٣٠ يوماً) — and nothing else: undone, dict.ts is C5's to the byte; no Dashboard range label left with an Arabic-Indic digit, English unchanged",
  dictNow.split(C6_DICT_EDIT[1]).length === 2 && !dictNow.includes(C6_DICT_EDIT[0]) && h16(undoC6Dict(dictNow)) === "0728e58762d9648b"
    && ["This Month", "Last Month", "Last 7 Days", "Last 30 Days", "This Quarter", "This Year", "All Time"].every((r) => !/[٠-٩۰-۹]/.test(translate("ar", r)) && translate("en", r) === r),
  h16(undoC6Dict(dictNow)));

// The header: one PageHeader, the toolbar its actions
const c6Code = flat(read(C6_PAGE));
const c6Ph = jsxEls(C6_PAGE, "PageHeader");
check("C6 header: one PageHeader — the title t(locale, \"Dashboard\") (the existing dictionary word) and the DashboardToolbar as its actions, nothing else (no description, meta or className); the toolbar rendered nowhere else; after the base-currency notice and the data-quality banner, before the grid",
  c6Ph.length === 1 && c6Ph[0].attributes.properties.length === 2 && attrCode(c6Ph[0], "title") === `{t(locale,"Dashboard")}`
    && attrCode(c6Ph[0], "actions") === squash("{<DashboardToolbar locale={locale} range={rangeKey} layout={prefs.layout} />}") && jsxEls(C6_PAGE, "DashboardToolbar").length === 1
    && c6Code.indexOf("data-testid=\"base-data-quality\"") < c6Code.indexOf("<PageHeader") && c6Code.indexOf("<PageHeader") < c6Code.indexOf('<divclassName="dash-grid">') && translate("en", "Dashboard") === "Dashboard",
  c6Ph.map((el) => el.getText()).join(" "));
const tbCode = flat(read(C6_TOOLBAR));
check("C6 toolbar: the range DropdownMenu and Customize Layout side by side in one .dash-toolbar (flex, wrapping) — no .toolbar-actions-right; pick() as in C5 (setDashboardRangeAction, then ?range=<key>, then refresh); the seven DASHBOARD_RANGES in order, each its RANGE_LABELS word, the current one checked",
  !tbCode.includes("toolbar-actions-right") && tbCode.includes(squash('return (<div className="dash-toolbar"><DropdownMenu>')) && tbCode.includes(squash("</DropdownMenu><CustomizeLayoutDialog locale={locale} layout={layout} /></div>);"))
    && tbCode.includes(squash("function pick(next: DashboardRange) { if (next === range) return; startTransition(async () => { await setDashboardRangeAction(next); router.push(`/dashboard?range=${next}`); router.refresh(); }); }"))
    && tbCode.includes(squash('{DASHBOARD_RANGES.map((r) => (<DropdownMenuItem key={r} className="cursor-pointer justify-between" onSelect={() => pick(r)}>{t(locale, RANGE_LABELS[r])}{r === range && <Check className="size-3.5 text-brand-orange" />}</DropdownMenuItem>))}'))
    && physical(C6_TOOLBAR).length === 0);

// Headings
const C6_H2 = ["Financial Overview", "Quick Actions", "Recent Activities", "Cash Flow", "Invoices Overview", "Project Overview", "HR Snapshot"];
const h2s = jsxEls(C6_PAGE, "h2").map((el) => squash((el.parent as ts.JsxElement).children.map((c) => c.getText()).join("")));
check("C6 headings: no h1 in the page (PageHeader's), no h3–h6; the seven widget titles h2s (h4s in C5) — Financial Overview, Quick Actions, Recent Activities, Cash Flow · <range>, Invoices Overview, Project Overview, HR Snapshot — their words unchanged",
  same(h2s, C6_H2.map((w) => squash(w === "Cash Flow" ? `{t(locale, "Cash Flow")} · {rangeLabel}` : `{t(locale, "${w}")}`))) && !/<h[13456][\s>]/.test(read(C6_PAGE)),
  h2s.join(" | "));
check("C6 heading styles: .side-panel-head h2 and .bottom-card h2 carry exactly the declarations the h4 rules had (14px / 700; 12.5px / 700 / 14px below) — the titles look as they did; no .side-panel-head h4 or .bottom-card h4 rule left",
  same(cssRules(".side-panel-head h"), [`${CSSF}: .side-panel-head h2 { font-size: 14px; font-weight: 700; }`]) && same(cssRules(".bottom-card h"), [`${CSSF}: .bottom-card h2 { font-size: 12.5px; font-weight: 700; margin-bottom: 14px; }`]),
  [...cssRules(".side-panel-head h"), ...cssRules(".bottom-card h")].join(" | "));

// D-1: no profit, margin or expenses — revenue only
const pageNoComments = codeOnly(read(C6_PAGE));
const finWidget = c6Code.slice(c6Code.indexOf("financial_overview:"), c6Code.indexOf("quick_actions:"));
check("C6 D-1: no expenseSeries, totalProfit or profitMarginPct; no Total Profit, Profit Margin, Total Expenses, Expenses or the Revenue / Expenses legend; nothing named profit, margin-percentage or expense in the Dashboard's code (comments aside) — removed, not hidden",
  !/expenseSeries|totalProfit|profitMarginPct|Total Profit|Profit Margin|Total Expenses|"Expenses"|"Revenue"|fin-legend|donut-legend-row|fin-profit/.test(pageNoComments) && !/profit|expense/i.test(pageNoComments) && !/profit/i.test(codeOnly(read(C6_KPI))),
  (pageNoComments.match(/.*(profit|expense).*/gi) ?? []).join(" | "));
check("C6 D-1 Financial Overview: the key financial_overview, its h2, the range pill, \"Total Revenue · <range>\" over Money(kpis.totalSalesThisMonth) — the KPI's own figure — and the revenue chart alone (ComboChart revenue={revenueSpark} labels={revenueLabels}, no expenses); no donut, no legend, no 1.9fr / 1.1fr split; the widget wide on a tablet",
  finWidget.includes(squash('<div className="fin-total-label">{t(locale, "Total Revenue")} · {rangeLabel}</div><div className="fin-total-value"><Money amount={kpis.totalSalesThisMonth} context="summary" /></div>'))
    && same(jsxEls(C6_PAGE, "ComboChart").map((el) => el.getText()), ["<ComboChart revenue={revenueSpark} labels={revenueLabels} />"]) && !finWidget.includes("<Donut") && !c6Code.includes("1.9fr")
    && jsxEls(C6_PAGE, "Donut").length === 1 && finWidget.startsWith(squash("financial_overview: (<DashWidget col={8} row={5} wide>")),
  finWidget.slice(0, 200));
const chCode = flat(read(C6_CHARTS));
check("C6 ComboChart: expenses optional — without it no expense line, no expense points and the scale from revenue alone; with it, the line and points as before; still no chart library (charts.tsx imports nothing)",
  chCode.includes("expenses?:number[];") && chCode.includes(squash("{expPts && <path d={`M ${expLine}`}")) && chCode.includes(squash("{expPts?.map(([x, yy], i) => (<circle key={`e${i}`}"))
    && chCode.includes(squash("const hi = Math.max(...revenue, ...(expenses ?? [])) * 1.15 || 1;")) && imports(C6_CHARTS).length === 0,
  imports(C6_CHARTS).join(" "));

// D-4: the strip holds the factual card alone, and only where it applies
const stripCode = c6Code.slice(c6Code.indexOf("{featureStripVisible"));
check("C6 D-4: no Secure & Reliable, Real-time Insights, Automated Processes, CRM Integration, Coming Soon or their subtitles; no Lock / TrendingUp / RefreshCw / Link2 import; the strip rendered only when the feature_strip widget is shown and the country profile enables ZATCA Phase 1 — one card, Shield + ZATCA Phase 1 QR / On printed tax invoices — so no empty strip elsewhere",
  !/Secure & Reliable|Real-time Insights|Automated Processes|CRM Integration|Coming Soon|Encrypted connection|Data driven decisions|Save time, work smarter|existing CRM|coming-soon-pill|highlight/.test(pageNoComments)
    && !/\b(Lock|TrendingUp|RefreshCw|Link2)\b/.test(pageNoComments) && imports(C6_PAGE).includes("lucide-react") && /\bShield\b/.test(pageNoComments)
    && stripCode.startsWith(squash('{featureStripVisible && showZatca && (<div className="feature-strip"><div className="feature-card"><div className="f-icon"><Shield className="size-4.5" /></div><div><div className="f-title">{t(locale, "ZATCA Phase 1 QR")}</div><div className="f-sub">{t(locale, "On printed tax invoices")}</div></div></div></div>)}'))
    && c6Code.split('className="feature-card"').length === 2 && c6Code.includes(squash('const showZatca = profileHasFeature(getProfileByCountryName(session.orgCountry), "zatca_phase1");'))
    && c6Code.includes(squash('const featureStripVisible = prefs.layout.find((l) => l.key === "feature_strip")?.visible ?? true;')));
check("C6 D-4 CSS: .feature-card.highlight, its icon rule and .coming-soon-pill gone (no consumer left); the strip a wrapping row; .feature-card itself unchanged",
  cssRules(".feature-card.highlight").length === 0 && cssRules(".coming-soon-pill").length === 0 && same(cssRules(".feature-strip"), [`${CSSF}: .feature-strip { display: flex; flex-wrap: wrap; gap: 12px; }`])
    && same(cssRules(".feature-card").filter((r) => r.includes(": .feature-card {")), [`${CSSF}: .feature-card { display: flex; align-items: center; gap: 12px; padding: 16px 16px; border-radius: 14px; background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow-sm); }`]),
  [...cssRules(".feature-card.highlight"), ...cssRules(".coming-soon-pill"), ...cssRules(".feature-strip")].join(" | "));

// D-5: only real trends and real series
const kpis = jsxEls(C6_PAGE, "KpiCard").map((el) => [attrCode(el, "label"), attrCode(el, "trendPct"), attrCode(el, "trendUp"), attrCode(el, "sparkValues")]);
check("C6 D-5: Total Sales — its query trend (kpis.totalSalesTrend) and the selected range's revenue buckets as its sparkline; Total Invoices — its query trend, no sparkline; Total Receivables and Total Payables — no trend, no sparkline (C5: \"0%\" and a borrowed / [0, 0] line); no \"0%\" or [0, 0] anywhere in the page",
  same(kpis, [
    ['"TotalSales"', "{kpis.totalSalesTrend.pct}", "{kpis.totalSalesTrend.up}", "{revenueSpark}"],
    ['"TotalInvoices"', "{kpis.totalInvoicesTrend.pct}", "{kpis.totalInvoicesTrend.up}", ""],
    ['"TotalReceivables"', "", "", ""],
    ['"TotalPayables"', "", "", ""],
  ]) && !/"0%"|\[0,\s*0\]/.test(pageNoComments) && c6Code.includes(squash("const revenueSpark = revenueSeries.length > 1 ? revenueSeries : undefined;")),
  JSON.stringify(kpis));
const kpiCode = flat(read(C6_KPI));
check("C6 KpiCard: trendPct, trendUp and sparkValues optional; the trend rendered only when both are given, the sparkline only for two or more points — otherwise nothing, no placeholder; label, value, icon and currency mark as before",
  kpiCode.includes("trendPct?:string;trendUp?:boolean;") && kpiCode.includes("sparkValues?:number[];") && kpiCode.includes(squash("{trendPct !== undefined && trendUp !== undefined && (<div className={`kpi-trend"))
    && kpiCode.includes(squash("{sparkValues && sparkValues.length > 1 && (<div className=\"kpi-spark\">")) && same(imports(C6_KPI), ["lucide-react", "lucide-react", "@/components/ui/currency-mark", "@/lib/i18n/dict", "./charts"]),
  imports(C6_KPI).join(" "));
check("C6 D-5 Cash Flow: its three figures (Cash Inflow, Cash Outflow, Net Cash Flow) and no sparkline — the page no longer imports Sparkline at all",
  !/Sparkline/.test(pageNoComments) && ["Cash Inflow", "Cash Outflow", "Net Cash Flow"].every((w) => c6Code.includes(squash(`{t(locale, "${w}")}`))));

// Dates
check("C6 dates: the recent-activity time is formatDisplayDate(a.time, locale, \"dateTime\") — the third planned consumer; no toLocaleString / toLocaleDateString / toLocaleTimeString / Intl.DateTimeFormat in the four Dashboard files; format-date.ts as C5 left it",
  c6Code.split(squash('{formatDisplayDate(a.time, locale, "dateTime")}')).length === 2 && C6_FILES.every((f) => !/toLocale(Date|Time)?String|Intl\.DateTimeFormat/.test(codeOnly(read(f))))
    && sha("src/lib/i18n/format-date.ts") === "199aa879e7cfa055");

// The grid
check("C6 grid (source): DashWidget writes its desktop size as --dash-span / --dash-rows (and data-wide when wide) — no inline grid-column or grid-row anywhere in the page; Financial Overview the one wide widget; every widget's col / row as in C5",
  c6Code.includes(squash('<div className="dash-widget" data-wide={wide ? "" : undefined} style={{ "--dash-span": col, "--dash-rows": row } as React.CSSProperties}>')) && !/gridColumn|gridRow|grid-column|grid-row/.test(pageNoComments)
    && same(jsxEls(C6_PAGE, "DashWidget").map((el) => `${attrCode(el, "col")}/${attrCode(el, "row")}${attr(el, "wide") ? " wide" : ""}`),
      ["{3}/{2}", "{3}/{2}", "{3}/{2}", "{3}/{2}", "{8}/{5} wide", "{4}/{4}", "{4}/{5}", "{3}/{3}", "{3}/{4}", "{3}/{4}", "{3}/{3}"]),
  jsxEls(C6_PAGE, "DashWidget").map((el) => `${attrCode(el, "col")}/${attrCode(el, "row")}`).join(" "));
const C6_GRID_RULES = [
  `${CSSF}: .dash-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-rows: 86px; gap: 16px; grid-auto-flow: row dense; margin-bottom: 16px; }`,
  `${CSSF}: @media (max-width: 1100px) > .dash-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: auto; }`,
  `${CSSF}: @media (max-width: 640px) > .dash-grid { grid-template-columns: minmax(0, 1fr); }`,
];
const C6_WIDGET_RULES = [
  `${CSSF}: .dash-widget { position: relative; display: flex; flex-direction: column; min-width: 0; grid-column: span var(--dash-span); grid-row: span var(--dash-rows); }`,
  `${CSSF}: .dash-widget > *:not(.dash-widget-chrome):not(.dash-resize-handle) { flex: 1; min-height: 0; overflow: auto; }`,
  `${CSSF}: @media (max-width: 1100px) > .dash-widget { grid-column: auto; grid-row: auto; }`,
  `${CSSF}: @media (max-width: 1100px) > .dash-widget[data-wide] { grid-column: 1 / -1; }`,
  `${CSSF}: @media (max-width: 1100px) > .dash-widget > *:not(.dash-widget-chrome):not(.dash-resize-handle) { overflow: visible; }`,
  "src/app/globals.css: body, .sidebar, .topbar, .card, .dash-widget, main { transition: background-color 0.25s ease, border-color 0.25s ease, color 0.25s ease; }",
];
check("C6 grid (CSS): above 1100px twelve shrink-safe tracks (minmax(0, 1fr)) and 86px rows, each widget spanning its --dash-span / --dash-rows; at ≤1100px two shrink-safe tracks, rows as tall as their content, every widget one track and a wide one (data-wide) the whole row, nothing clipped or scrolled inside; at ≤640px one track",
  same(cssRules(".dash-grid"), C6_GRID_RULES) && same(cssRules(".dash-widget"), C6_WIDGET_RULES),
  [...cssRules(".dash-grid"), ...cssRules(".dash-widget")].join(" | "));

// Logical direction
check("C6: no physical left / right in the four Dashboard files (C5's borderLeft / paddingLeft split went with D-1); the activity row's and the three card links' chevrons turn in Arabic (rtl:rotate-180); the Dashboard CSS C6 touched logical (margin-inline-start / -end)",
  C6_FILES.every((f) => physical(f).length === 0) && c6Code.split("rtl:rotate-180").length === 5 && !/margin-(left|right)/.test(cssRules(".kpi-spark").join(" ") + cssRules(" .dot").join(" ")),
  C6_FILES.flatMap((f) => physical(f).map((p) => `${rel(f)}: ${p}`)).join(" "));

// What C6 must leave alone
const C6_UNTOUCHED: Record<string, string> = {
  [`${DASH}_shared/queries.ts`]: "354a881b07d2fc07", "src/lib/dashboard-layout.ts": "11ce662d0eaeb26e", "src/lib/dashboard-range.ts": "677a90301a001d81", "src/lib/user-prefs.ts": "e5c023eb951bb241",
  [`${DASH}dashboard-prefs-actions.ts`]: "5063caf42e3efff1", [`${DASH}customize-layout-dialog.tsx`]: "e34458835871f082", "src/lib/status-registry.ts": "d30d22a93f40d71f",
  [`${DASH}base-currency-notice.tsx`]: "585829fe0d6c2b3f", [`${DASH}actions.ts`]: "8d4891d35a19dfe8", [`${DASH}loading.tsx`]: "56c22d1d1aa51824",
  "src/components/layout/page-header.tsx": "f54789d9a9de8073", "src/lib/geo/country-profiles.ts": "6e7e0646559b4c91", "src/lib/base-currency.ts": "c6cdcf5d3f37ef2d", [`${A}sales/_shared/money.tsx`]: "874b9b2b3e282eff",
};
const c6Drift = Object.entries(C6_UNTOUCHED).filter(([f, hsh]) => !exists(f) || sha(f) !== hsh).map(([f]) => rel(f));
const dashFiles = walk(DASH);
check(`C6: the Dashboard's queries, the layout registry (its twelve keys, feature_strip among them), the ranges, the preference store and its two actions, Customize Layout, the status registry, the base-currency notice and its action, the loading boundary, PageHeader, the country profiles and Money byte-identical to C5 (${Object.keys(C6_UNTOUCHED).length} files); every Dashboard file is C6's or one of these`,
  c6Drift.length === 0 && dashFiles.every((f) => C6_FILES.includes(f) || f in C6_UNTOUCHED) && dashFiles.length === C6_FILES.length + 6,
  [...c6Drift, ...dashFiles.filter((f) => !C6_FILES.includes(f) && !(f in C6_UNTOUCHED)).map((f) => `unaccounted: ${f}`)].join(" "));
check("C6: the Dashboard's guards (requireSession, the base-currency confirmation), server data section (C5's statements but the four D-1 / D-5 ones — expenseSeries, totalProfit, profitMarginPct, the borrowed spark — and revenueSpark in spark's place: the pin's only change) and static action inventory (the routes it links, confirmBaseCurrencyAction, saveDashboardLayoutAction, setDashboardRangeAction) are the pinned ones",
  same(now.guards["(app)/dashboard/page.tsx"], pins.guards["(app)/dashboard/page.tsx"]) && same(now.data["(app)/dashboard/page.tsx"], pins.data["(app)/dashboard/page.tsx"])
    && same(now.actions["(app)/dashboard/page.tsx"], pins.actions["(app)/dashboard/page.tsx"]) && same(pins.guards["(app)/dashboard/page.tsx"], ["getBaseCurrencyConfirmation(session.orgId, session.role)", "requireSession()"])
    && !pins.data["(app)/dashboard/page.tsx"].some((d) => /expenseSeries|totalProfit|profitMarginPct|const spark =/.test(d)) && pins.data["(app)/dashboard/page.tsx"].some((d) => d.startsWith("2a84fbd7053b const revenueSpark = revenueSeries.length > 1 ? revenueSeries : ")),
  JSON.stringify(now.actions["(app)/dashboard/page.tsx"]));
// The Settings family exactly as C5 committed it.
const C5_COMMITTED: Record<string, string> = {
  [C5_NAV]: "b8c6e3364bca7a42", [C5_ORG]: "e5238b33f8f955af", [C5_COMPANY]: "08718389db2f7dfb", [C5_FINANCE]: "5209ce4d6f3b6c2e", [C5_VAT]: "41e9587805709143",
  [C5_NUMBERS]: "77ba22dfa8d2b279", [C5_ROLES]: "b80899c149dad8fe", [C5_ZATCA]: "d2774a1244fefe43", [C5_TEAM]: "54f2bc449cd89d80", [C5_PRESETS]: "47e371129cb709d7",
  [C5_PRESET_BANK]: "4599754357ae5ee1", [C5_PRINT]: "1b9e3a18be23d089", [C5_SEAL]: "e26c30632b9f210f", [C5_SECURITY]: "dca0e6cda20a46e8", [C5_COMPLIANCE]: "aa2fa11de29abfbf",
};
const c5Moved = Object.entries(C5_COMMITTED).filter(([f, hsh]) => !exists(f) || sha(f) !== hsh).map(([f]) => `${rel(f)} ${exists(f) ? sha(f) : "missing"}`);
check("C6: the 15 Settings files byte-identical to C5 (e8f629b) — C6 touches no Settings code; the P0 / P0.1 / P0.2 verifiers as group 13 holds them",
  c5Moved.length === 0 && sha("verify/verify-ar-locale-hydration.mjs") === "a226b47188ddf478", c5Moved.join(" | "));
// The one verifier maintenance C6's review approved: verify-compliance-claims.mjs required the Dashboard to show the
// Secure & Reliable card's subtitle, the card D-4 removes; that check now requires the card's copy gone. Every other
// byte of the suite is C5's — the Compliance Center claims (EN / AR), the refusal of "Your data is encrypted".
const C6_COMPLIANCE_EDIT: [string, string] = [
  'ok("dashboard says what is actually encrypted", dash.includes("Encrypted connection, encrypted credentials"));\n',
  'ok(\n  "dashboard removes the Secure & Reliable security marketing copy (DEV-UI-01.7 C6, D-4)",\n  !dash.includes("Secure & Reliable") &&\n    !dash.includes("Encrypted connection, encrypted credentials"),\n);\n',
];
const ccNow = read("verify/verify-compliance-claims.mjs");
const ccC5 = h16(ccNow.replace(C6_COMPLIANCE_EDIT[1], () => C6_COMPLIANCE_EDIT[0]));
check("C6's approved verifier maintenance: verify-compliance-claims.mjs changes only its Dashboard check that required the Secure & Reliable card's subtitle — now it requires that card's title and subtitle gone (D-4); \"Your data is encrypted\" still refused, every Compliance Center check, the fixture, the locales and the exit as they were — undone, the suite is C5's to the byte",
  ccNow.split(C6_COMPLIANCE_EDIT[1]).length === 2 && !ccNow.includes(C6_COMPLIANCE_EDIT[0]) && ccC5 === "d6a11364db596383"
    && ccNow.includes(`ok("dashboard does NOT claim 'Your data is encrypted'", !dash.includes("Your data is encrypted"));\n`),
  ccC5);
const C6_BANNED = ["DashboardSection", "DashboardCard", "DashboardHeader", "DashboardLayout", "DashboardShell", "WidgetFrame", "ChartCard"];
const c6Creep = walk("src").filter((f) => /\.(tsx?|css)$/.test(f) && C6_BANNED.some((b) => new RegExp(`\\b${b}\\b`).test(strip(read(f)))));
check(`C6: no Dashboard abstraction — none of ${C6_BANNED.join(", ")}; the page composes PageHeader, DashWidget, KpiCard and the charts itself`, c6Creep.length === 0, c6Creep.join(" "));

section("15. C7 — document and app-state heading semantics (D-3)");
// C6's bytes (20eff7d) of every file C7 touches; each is C6's plus exactly its C7_EDITS hunks.
const C7_C6_SHA: Record<string, string> = {
  [`${A}error.tsx`]: "11e5a596d3eac422", [`${A}not-found.tsx`]: "9123cd265a23833f", [C7_BIN]: "5f99842ecb5f2443", [C7_EINVOICE]: "88ce3011493ce5b1",
  [`${A}sales/quotations/quotations-list-client.tsx`]: "370f5b3d84d2c8a5", [`${A}sales/orders/orders-list-client.tsx`]: "c3f158801b7afc05",
  [`${A}sales/proforma/proforma-list-client.tsx`]: "b183ef64e1f23f75", [`${A}sales/invoices/invoices-list-client.tsx`]: "df9124a4c3c54d3c",
  [`${A}sales/delivery-challans/dc-list-client.tsx`]: "c837d62b68edfe78", [`${A}sales/credit-notes/cn-list-client.tsx`]: "32532d3b1813b82f",
  [`${A}purchasing/orders/po-list-client.tsx`]: "5df02b6f339170af", [`${A}purchasing/debit-notes/dn-list-client.tsx`]: "ccfc2e25e738df80",
  [`${A}sales/quotations/[id]/page.tsx`]: "ff6249ecc366ad55", [`${A}sales/orders/[id]/page.tsx`]: "347aac4ee6037f58",
  [`${A}sales/proforma/[id]/page.tsx`]: "644e8f58a6e13a62", [`${A}sales/invoices/[id]/page.tsx`]: "51539640065462cc",
  [`${A}sales/delivery-challans/[id]/page.tsx`]: "18a6ca58bf1156b1", [`${A}sales/credit-notes/[id]/page.tsx`]: "577d3c6f8f1fd061",
  [`${A}purchasing/orders/[id]/page.tsx`]: "0366f74e8b7ab96b", [`${A}purchasing/debit-notes/[id]/page.tsx`]: "1be75da30ec28dad",
  [`${A}sales/quotations/quotation-form.tsx`]: "416e1b6cc2163b64", [`${A}sales/orders/order-form.tsx`]: "f02b6e43fd4db8f4",
  [`${A}sales/proforma/proforma-form.tsx`]: "81715f1598056b94", [`${A}sales/invoices/invoice-form.tsx`]: "34694e8df6caa057",
  [`${A}sales/delivery-challans/dc-form.tsx`]: "b051fd7c86f10fc6", [`${A}sales/credit-notes/cn-form.tsx`]: "28cc8236eaed196f",
  [`${A}purchasing/orders/po-form.tsx`]: "212dd39e35d7241e", [`${A}purchasing/debit-notes/dn-form.tsx`]: "a325401081bbb468",
};
const C7_SRC = Object.keys(C7_EDITS);
const c7Drift = C7_SRC.filter((f) => {
  const src = read(f);
  return !C7_EDITS[f].every(([was, is]) => src.split(is).length === 2 && !src.includes(was)) || h16(undoC7(f, src)) !== C7_C6_SHA[f];
});
check(`C7 changed nothing in its ${C7_SRC.length} source files but the heading tags: each hunk once (its C6 form nowhere), and undone every file is C6's to the byte — the 8 document lists, 8 details, 8 editors, the e-invoice panel, the error / not-found boundaries and the document Recycle Bin (wrappers, classes, titles, icons, StatRow, toolbars, tables, row menus, actions, queries, submit and dirty logic all C6's)`,
  C7_SRC.length === 28 && same(Object.keys(C7_C6_SHA).sort(), [...C7_SRC].sort()) && c7Drift.length === 0, c7Drift.map(rel).join(" "));
const c7Headings = (src: string) => src.match(/<h[1-6][\s>]/g) ?? [];
const c7NoPh = (f: string) => !/\bPageHeader\b/.test(read(f));
const listBad = C7_LISTS.filter(([f, title]) => {
  const src = read(A + f);
  return src.split(`<h1 className="text-[19px] font-bold">{t(locale, "${title}")}</h1>`).length !== 2 || c7Headings(src).length !== 1 || !c7NoPh(A + f);
});
check("C7 lists: each of the 8 document lists' title is the page's one heading — an h1 with the C6 classes (text-[19px] font-bold) and its C6 dictionary key, in its C6 wrapper; no h2–h6, no PageHeader",
  listBad.length === 0, listBad.map(([f]) => f).join(" "));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const detailBad = C7_DETAILS.filter(([f, num]) => {
  const src = read(A + f);
  return !new RegExp(`<div className="inv-head">\\s*<div>\\s*<h1 className="mono">\\{${esc(num)}\\}</h1>\\s*<div className="inv-sub">`).test(src)
    || !src.includes('<div className="inv-head-actions">') || c7Headings(src).length !== 1 || !c7NoPh(A + f);
});
check("C7 details: each of the 8 document numbers is the page's one heading — an h1 className mono (its C6 expression), first in .inv-head's title column, .inv-sub after it and the .inv-head-actions group as C6; no other heading, no PageHeader",
  detailBad.length === 0, detailBad.map(([f]) => f).join(" "));
const formBad = C7_FORMS.filter(([f, icon, type]) => {
  const src = read(A + f);
  return !new RegExp(`<div className="doc-titlebar">\\s*<div>\\s*<h1>\\s*<${icon} className="size-5" style=\\{\\{ color: "var\\(--brand-orange\\)" \\}\\} /> \\{t\\(locale, isEdit \\? "Edit ${type}" : "Create ${type}"\\)\\}\\s*</h1>\\s*<div className="sub">`).test(src)
    || c7Headings(src).length !== 1 || !c7NoPh(A + f);
});
check("C7 editors: each of the 8 editor titles is the page's one heading — an h1 first in .doc-titlebar, its C6 icon and Create / Edit dictionary keys inside, the .sub after it; no other heading, no PageHeader",
  formBad.length === 0, formBad.map(([f]) => f).join(" "));
const einv = read(C7_EINVOICE);
check("C7 e-invoice: the shared panel's title is an h2 (h4 in C6) first in .eh — the same variant expression (Tax Invoice QR preview / Tax Invoice QR); no other heading",
  /<div className="eh">\s*<h2>\{variant === "create" \? t\(locale, "Tax Invoice QR preview"\) : t\(locale, "Tax Invoice QR"\)\}<\/h2>/.test(einv) && c7Headings(einv).length === 1);
const errSrc = read(C7_ERROR);
const nfSrc = read(C7_NOT_FOUND);
const binSrc = read(C7_BIN);
check("C7 app states: Error's title an h1 'Something went wrong' (English, as C6), Not Found's an h1 t('Page not found'), the document Recycle Bin's an h1 with its Trash2 icon and t('Recycle Bin') — each the page's one heading, classes as C6, no PageHeader",
  errSrc.includes('<h1 className="text-[19px] font-bold mb-2">Something went wrong</h1>') && c7Headings(errSrc).length === 1 && c7NoPh(C7_ERROR) &&
  nfSrc.includes('<h1 className="text-[19px] font-bold mb-2">{t(locale, "Page not found")}</h1>') && c7Headings(nfSrc).length === 1 && c7NoPh(C7_NOT_FOUND) &&
  /<div className="main-head flex items-center justify-between mb-\[22px\]">\s*<h1 className="text-\[19px\] font-bold flex items-center gap-2">\s*<Trash2 className="size-5" style=\{\{ color: "var\(--brand-orange\)" \}\} \/> \{t\(locale, "Recycle Bin"\)\}\s*<\/h1>/.test(binSrc) &&
  c7Headings(binSrc).length === 1 && c7NoPh(C7_BIN));
// error.tsx has no route and no existing deterministic error fixture: rendered in isolation instead (react-dom/server).
const { default: AppError } = await import("../src/app/(app)/error");
const errHtml = html(h(AppError, { error: Object.assign(new Error("C7 isolated render"), { digest: "c7" }), reset: () => {} }));
check("C7 error boundary rendered in isolation (react-dom/server — no route or fixture can raise it): exactly one heading, <h1 class=\"text-[19px] font-bold mb-2\">Something went wrong</h1>; the copy, Try again and Back to Dashboard as C6",
  (errHtml.match(/<h[1-6][\s>]/g) ?? []).length === 1 && errHtml.includes('<h1 class="text-[19px] font-bold mb-2">Something went wrong</h1>') &&
  errHtml.includes("An unexpected error occurred. You can try again, or head back to your dashboard.") && errHtml.includes('<button type="button" class="btn btn-primary"') &&
  errHtml.includes('href="/dashboard">Back to Dashboard</a>'), errHtml.slice(0, 160));
const twinBad = C7_CSS_TWINS.filter(([rule, twin]) => {
  const [rf, tf] = [cssFlat(rule), cssFlat(twin)];
  return cssWithC7.split(rf + tf).length !== 2 || cssWithC7.split(tf).length !== 2 || rf.slice(rf.indexOf("{")) !== tf.slice(tf.indexOf("{"));
});
check("C7 stylesheet: its only change is four exact twins — .main-head h1, .inv-head h1, .einvoice-panel h2, .doc-titlebar h1 — each once, straight after the rule it twins, with exactly its declarations; the h3 / h4 rules byte-identical; undone, mockup-parity.css is C6's to the character",
  twinBad.length === 0 && h16(undoC7Css(cssWithC7)) === "2d06b07ba2e73e3d", `${twinBad.map(([, t]) => t.split("{")[0].trim()).join(" ")} ${h16(undoC7Css(cssWithC7))}`);
check("C7 Mono document numbers: all 8 detail h1s are className mono, and .mono — var(--font-mono), unlayered, more specific than the global h1–h6 rule — is C6's, so each number keeps the code face",
  detailBad.length === 0 && read(CSSF).split(".mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }").length === 2);
const C7_SURFACES = [...C7_SRC, `${A}recycle-bin/page.tsx`];
const c7Ph = C7_SURFACES.filter((f) => !c7NoPh(f));
check("C7: no PageHeader on any C7 surface — the 8 lists, 8 details, 8 editors, the Recycle Bin, error and not-found keep their 01.5 / 01.6 structures (zero pixel difference is why C7 is tags only)",
  c7Ph.length === 0, c7Ph.map(rel).join(" "));
// The two deliberate verifier updates C7 owns — each undone, its verifier is C6's to the byte.
const C7_TYPO_EDITS: [string, string][] = [
  ['/<h3 className="mono">\\{invoice\\.invoiceNumber\\}<\\/h3>/', '/<h1 className="mono">\\{invoice\\.invoiceNumber\\}<\\/h1>/'],
  ['/<h3 className="mono">\\{po\\.poNumber\\}<\\/h3>/', '/<h1 className="mono">\\{po\\.poNumber\\}<\\/h1>/'],
];
const typoSrc = read("verify/verify-typography.mts");
check("C7 typography verifier: its two representative document-number CODE_SITES (invoice, PO) expect h1.mono — no h3.mono expectation left; undone, verify-typography.mts is C6's to the byte (the employee code and every other site unchanged)",
  C7_TYPO_EDITS.every(([was, is]) => typoSrc.split(is).length === 2 && !typoSrc.includes(was)) &&
  h16(C7_TYPO_EDITS.reduce((acc, [was, is]) => acc.replace(is, () => was), typoSrc)) === "02b422d53822fc4a");
const dfSrc = read("verify/verify-document-form.mts");
const dfOld = 'check("document headings left for DEV-UI-01.7 (editor titles stay h3)", FORMS.every((f) => /<h3>/.test(formSrc[f])));\n';
const dfStart = dfSrc.indexOf("// DEV-UI-01.7 C7 (D-3): the hand-off above");
const dfEnd = dfSrc.indexOf("\n", dfSrc.indexOf('[".einvoice-panel h2", ".einvoice-panel h4"]')) + 1;
const dfUndone = dfStart > 0 && dfEnd > dfStart ? dfSrc.slice(0, dfStart) + dfOld + dfSrc.slice(dfEnd) : "";
// The C7 block is held byte for byte too: undoing it alone would let a weakened C7 assertion (h1 | h3) through.
check("C7 document-form verifier: the planned DEV-UI-01.7 hand-off ('editor titles stay h3') replaced by the stronger C7 assertions — a real h1 in each editor's .doc-titlebar (exactly one, no h3 title left) and the twins' declarations equal to the h3 / h4 rules' — that block exactly as written; undone, verify-document-form.mts is C6's to the byte (SUBMIT / DIRTY pins, byte pins and every other check unchanged)",
  !dfSrc.includes(dfOld) && dfSrc.includes('check("document headings (DEV-UI-01.7 C7): every editor\'s title is a real h1 in .doc-titlebar') &&
  h16(dfSrc.slice(dfStart, dfEnd)) === "31abd69fc9ff1552" && h16(dfUndone) === "0321011771832fc1", `${h16(dfSrc.slice(dfStart, dfEnd))} ${h16(dfUndone)}`);
const C7_FROZEN: Record<string, string> = {
  "src/lib/i18n/dict.ts": "ad171858a8128535", [`${A}dashboard/page.tsx`]: "53625edf205565af", [`${A}dashboard/dashboard-toolbar.tsx`]: "a671e3cafadb0e65",
  [`${A}dashboard/_shared/kpi-card.tsx`]: "a8d4f36b81024663", [`${A}dashboard/_shared/charts.tsx`]: "f56b54ecd25ab615",
  "verify/verify-compliance-claims.mjs": "98bd1c9f967d9fa3", "verify/verify-ar-locale-hydration.mjs": "a226b47188ddf478",
  "verify/verify-settings-timezone-hydration.mjs": "a43b9d9f7b521da6", "verify/verify-business-date-hydration.mjs": "02ef92b957d4d719",
  "verify/verify-datatable-runtime.mjs": "7dd991ed407faf91", [`${A}documents/_workspace/list-workspace-toolbar.tsx`]: "2bd2a430e47a76f5",
  [`${A}documents/_workspace/use-list-filters.ts`]: "e9bc8477a32c2877", [`${A}documents/_workspace/saved-view-actions.ts`]: "4e2a260f754684b0",
  "src/components/layout/page-header.tsx": "f54789d9a9de8073",
};
// The DataTable runtime suite is held with C8's synchronization hunks undone (group 16 proves they are its only change).
const c7Frozen = Object.entries(C7_FROZEN).filter(([f, hsh]) => !exists(f) || (f === DT_SUITE ? h16(undoDT(read(f))) : sha(f)) !== hsh).map(([f]) => f);
check("C7 freezes C6: dict.ts (no dictionary change), the four Dashboard files, verify-compliance-claims.mjs, the P0 / P0.1 / P0.2 verifiers, the DataTable runtime suite (C8's synchronization hunks undone, group 16) and the list workspace (toolbar, filters, saved views), PageHeader — each byte-identical to C6 (20eff7d)",
  c7Frozen.length === 0, c7Frozen.join(" "));
const c7Census = walk("src").filter((f) => f.endsWith(".tsx") && !C7_SRC.includes(f))
  .map((f) => [f, c7Headings(read(f)).map((tg) => tg.slice(1, 3)).join(",")]).filter(([, tags]) => tags).map(([f, tags]) => `${f}:${tags}`);
check(`C7: no blanket heading replacement — outside its 28 files every .tsx holds exactly the headings it held in C6 (${c7Census.length} files, file by file)`,
  h16(c7Census.join("\n")) === "8f201e6e6c7a0ed9", h16(c7Census.join("\n")));

// ---------- 16. C8 — the remediation: D-2 applied, the DataTable suite synchronized ----------
section("16. C8 — D-2 presentation suppression and DataTable focus synchronization");
// C7's bytes (004cd35) of the two files D-2 touches; each is C7's plus exactly its D2_EDITS hunks.
const D2_C7_SHA: Record<string, string> = { [C3_COST]: "10827a6bbbada948", [C4_REPORTS]: "a3a43b8521157483" };
const d2Drift = Object.keys(D2_EDITS).filter((f) => {
  const src = read(f);
  return !D2_EDITS[f].every(([was, is]) => src.split(is).length === 2 && !src.includes(was)) || h16(undoD2(f, src)) !== D2_C7_SHA[f];
});
check("C8 D-2 changed nothing in its two source files but its own 7 hunks — cost-control.tsx: the profitability imports, the destructure (with its comment), the badge meta, the StatRow to columns={4}, Actual Profit and Profit Margin; reports-workspace.tsx: PnlView's Gross Profit card (with its comment) and row — each once, its C7 form nowhere; undone, each file is C7's to the byte",
  same(Object.keys(D2_C7_SHA).sort(), Object.keys(D2_EDITS).sort()) && Object.values(D2_EDITS).flat().length === 7 && d2Drift.length === 0, d2Drift.map(rel).join(" "));
// Every other application file, byte for byte: C7's src tree without the two D-2 files (497 files at 004cd35).
const d2Others = walk("src").filter((f) => !(f in D2_EDITS));
const srcRestHash = createHash("sha256");
for (const f of d2Others) {
  srcRestHash.update(f + "\0");
  srcRestHash.update(f in FIN_EDITS ? read(f) : frozen(f)); // C8 final's hunks undone (group 17), main's (group 18)
}
const srcRest = `${srcRestHash.digest("hex").slice(0, 16)} (${d2Others.length} files)`;
check(`C8 changed no other application file: every file under src/ but the two is C7's to the byte (${d2Others.length}) — the engines, the export route, the status registry, the dictionary, the list workspace and its saved-view toolbar among them (the DataTable correction is test-only)`,
  srcRest === "fcf68a21ad67fc8a (497 files)", srcRest);
// Nowhere else on screen: outside src/lib (the engines, the registry, the dictionary) no file names or reads what D-2 hides.
const REPORT_EXPORT = `${FN}reports/export/route.ts`;
const D2_HIDDEN = /"(Actual Profit|Profit Margin|Gross Profit)"|\b(grossProfit|marginPercent)\b|project_health/;
const d2Seen = walk("src").filter((f) => /\.tsx?$/.test(f) && !f.startsWith("src/lib/") && f !== REPORT_EXPORT && D2_HIDDEN.test(codeOnly(read(f)))).map(rel);
check('D-2 on screen: no application file outside src/lib names or reads what D-2 hides — no "Actual Profit", "Profit Margin" or "Gross Profit" label, no grossProfit / marginPercent read, no project_health status (so no profitability badge or health colour anywhere) — but the P&L export route, whose Gross Profit row is an open decision outside this on-screen correction (business-pinned, unchanged)',
  d2Seen.length === 0 && D2_HIDDEN.test(codeOnly(read(REPORT_EXPORT))), d2Seen.join(" "));
check("D-2 is presentation only: project-costing.ts (profit, marginPercent, health), finance-reports.ts (grossProfit), the status registry (project_health and its mappings) and the P&L export route (its Gross Profit row) are still their business pins (group 4); dict.ts is C7's to the byte — Actual Profit, Profit Margin and Gross Profit kept with their Arabic; project_health still a registry domain",
  [ "src/lib/project-costing.ts", "src/lib/finance-reports.ts", "src/lib/status-registry.ts", REPORT_EXPORT].every((f) => !!pins.business[f] && now.business[f] === pins.business[f]) &&
    sha("src/lib/i18n/dict.ts") === "ad171858a8128535" && ["Actual Profit", "Profit Margin", "Gross Profit"].every(hasArabic) && /\nconst project_health: Domain = \{/.test(read("src/lib/status-registry.ts")));
// The DataTable runtime suite (test-only): C7's plus exactly DT_EDITS.
const dtSrc = read(DT_SUITE);
const dtC7 = undoDT(dtSrc);
const dtDrift = DT_EDITS.filter(([was, is]) => dtSrc.split(is).length !== 2 || dtSrc.includes(was)).length;
check(`C8 DataTable suite: its only change is the ${DT_EDITS.length} synchronization and diagnostic hunks — each once, its C7 form nowhere; undone, verify-datatable-runtime.mjs is C7's to the byte (and so C6's, group 15)`,
  DT_EDITS.length === 9 && dtDrift === 0 && h16(dtC7) === "7dd991ed407faf91", `${dtDrift} ${h16(dtC7)}`);
const blockOf = (s: string, start: string, end: string) => {
  const i = s.indexOf(start);
  return i < 0 ? null : s.slice(i, s.indexOf(end, i) + end.length);
};
const closeFn = blockOf(dtSrc, "async function closeFiltersByEscape(step) {", "\n}\n") ?? "";
const dtCode = codeOnly(dtSrc);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
check("C8 DataTable synchronization: both Filters → Views transitions (status Sent chosen → Save current view; filters cleared → apply the saved view) close the popover through closeFiltersByEscape — Escape, the layers gone, then a bounded wait for the popover removed AND keyboard focus on main [data-list-filters] (Radix's documented return to the trigger); a recorded check, and a throw when the return never comes (no silent catch); no bare Escape + layersClosed() left before a Views step; no sleep added (settle / waitForTimeout as in C7)",
  count(dtCode, /await closeFiltersByEscape\("/g) === 2 && closeFn.includes('document.activeElement?.matches?.("main [data-list-filters]")') &&
    closeFn.includes('!document.querySelector("[data-radix-popper-content-wrapper]")') && closeFn.includes("check(`Filters popover (${step}): ") &&
    closeFn.includes("if (!returned) throw new Error(") && !/waitForTimeout|settle\(/.test(closeFn) &&
    !/keyboard\.press\("Escape"\);\s*await layersClosed\(\);\s*\/\/ (Save current view|apply an existing view)/.test(dtSrc) &&
    count(dtCode, /\bsettle\(/g) === count(codeOnly(dtC7), /\bsettle\(/g) && count(dtCode, /waitForTimeout/g) === count(codeOnly(dtC7), /waitForTimeout/g));
const KEEP: [string, string][] = [["async function openViews() {", "\n}\n"], ["async function escapeRestoresTrigger() {", "\n}\n"], ["const triggerStoleFocus = (log) => {", "\n};\n"],
  ["const observe = () =>", "\n"], ["const triggerFocused = () =>", "\n"], ["await page.waitForFunction(() => document.activeElement?.matches?.('[data-saved-view-dialog=\"save\"] input')", "await observe();\n"]];
const keepBad = KEEP.filter(([start, end]) => !blockOf(dtSrc, start, end) || blockOf(dtSrc, start, end) !== blockOf(dtC7, start, end)).map(([start]) => start);
check("C8 DataTable assertions intact: openViews() (its pointer-click retry is recorded test debt, not refactored), escapeRestoresTrigger(), the excursion rule triggerStoleFocus(), the 400 ms observe() window, triggerFocused() and the immediate typing (keyboard.type straight after the Save input holds focus) are C7's to the character",
  keepBad.length === 0, keepBad.join(" | "));

// ---------- 17. C8 final — the product owner's financial display policy ----------
section("17. C8 final — financial display policy (P&L, Balance Sheet, exports, project section)");
// These checks read the four files as they are (rawRead); every other group reads them with FIN_EDITS undone.
const rawParse = (f: string) => ts.createSourceFile(f, rawRead(f), ts.ScriptTarget.Latest, true, /x$/.test(f) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
// The approved remediation's bytes (c47c65a) of the four files; each is that plus exactly its FIN_EDITS hunks.
const FIN_C8R_SHA: Record<string, string> = { [C4_REPORTS]: "f3eff79b5f4a060c", [C3_COST]: "4c7a9c36d184733f", [C8F_EXPORT]: "1533168860eddde6", [C8F_DICT]: "ad171858a8128535" };
const finDrift = Object.keys(FIN_EDITS).filter((f) => {
  const src = rawRead(f);
  return !FIN_EDITS[f].every(([was, is]) => src.split(is).length === 2 && !src.includes(was)) || h16(undoFin(f, src)) !== FIN_C8R_SHA[f];
});
const finCounts = Object.entries(FIN_EDITS).map(([f, e]) => `${rel(f)} ${e.length}`).join(", ");
check(`C8 final changed nothing in its four files but its own 16 hunks (${finCounts}) — each once, its approved-remediation form nowhere; undone, each is c47c65a's to the byte (the reports workspace f3eff79b5f4a060c, the cost control 4c7a9c36d184733f, the P&L export route 1533168860eddde6 — its business pin, dict.ts ad171858a8128535)`,
  same(Object.keys(FIN_C8R_SHA).sort(), Object.keys(FIN_EDITS).sort()) && Object.values(FIN_EDITS).flat().length === 16 &&
    same(Object.values(FIN_EDITS).map((e) => e.length), [8, 2, 5, 1]) && finDrift.length === 0, finDrift.map(rel).join(" "));
// Every other application file, byte for byte: c47c65a's src tree without the four (495 files).
const finOthers = walk("src").filter((f) => !(f in FIN_EDITS));
const finRestHash = createHash("sha256");
for (const f of finOthers) {
  finRestHash.update(f + "\0");
  finRestHash.update(frozen(f)); // main's approved hunks undone (group 18)
}
const finRest = `${finRestHash.digest("hex").slice(0, 16)} (${finOthers.length} files)`;
check(`C8 final changed no other application file: every file under src/ but the four is c47c65a's to the byte (${finOthers.length}) — the engines (project-costing, finance-reports, accounting, settlement), the status registry, the shared exporter report-export.ts, every finance, posting, inventory, purchase, payroll, Dashboard and document module, the session / tenant / role code, src/db and the list workspace among them`,
  finRest === "c05dcaf4283af501 (495 files)", finRest);
check("C8 final is presentation only: project-costing.ts, finance-reports.ts (grossProfit, operatingProfit, netProfit still computed), accounting.ts, settlement.ts, the status registry and the shared exporter report-export.ts are their business pins, read as they are",
  ["src/lib/project-costing.ts", "src/lib/finance-reports.ts", "src/lib/accounting.ts", "src/lib/settlement.ts", "src/lib/status-registry.ts", "src/lib/report-export.ts"]
    .every((f) => !!pins.business[f] && h16(readFileSync(path.join(ROOT, f))) === pins.business[f]) &&
    ["const grossProfit = revenueTotal - costOfSalesTotal;", "operatingProfit", "netProfit"].every((s) => rawRead("src/lib/finance-reports.ts").includes(s)));

const P_NOTICE = "Profit figures are temporarily hidden because Cost of Sales and inventory valuation are not yet complete.";
const B_NOTICE = "Preliminary — Cost of Sales and inventory valuation are incomplete. The current-period result may change.";
const finRep = rawParse(C4_REPORTS);
const finFn = (name: string) => findAll(finRep, fnNamed(name))[0];
const elsIn = (root: ts.Node | undefined, tag: string) => (root ? (inside(root, (n) => isEl(n) && n.tagName.getText() === tag) as El[]) : []);
const kidsText = (el: El) => (ts.isJsxOpeningElement(el) && ts.isJsxElement(el.parent) ? flat(el.parent.children.map((c) => c.getText()).join("")) : "");
const pnlF = finFn("PnlView"), bsF = finFn("BsView");
const finPnlCode = codeOnly(pnlF?.getText() ?? "");
const PROFIT_READ = /\b(grossProfit|operatingProfit|netProfit)\b/;
const PROFIT_LABEL = /"(Gross Profit|Operating Profit|Net Profit|Net Profit \/ \(Loss\))"/;
// P&L: Revenue the one summary card; the notice right after it; the factual groups, lines and Total Revenue; no profit.
const pnlCards = elsIn(pnlF, "Cards");
const pnlItems = pnlCards[0] ? attr(pnlCards[0], "items")?.initializer : undefined;
const pnlItemList = pnlItems && ts.isJsxExpression(pnlItems) && pnlItems.expression && ts.isArrayLiteralExpression(pnlItems.expression) ? pnlItems.expression.elements.map((e) => flat(e.getText())) : [];
const pnlNotes = elsIn(pnlF, "ReportNote");
const pnlGroups = elsIn(pnlF, "GroupLabel").map((el) => kidsText(el));
const pnlRows = elsIn(pnlF, "Row").map((el) => `${attrCode(el, "label")}|${attrCode(el, "value")}|${attr(el, "final") ? "final" : ""}`);
const pnlOrder = [pnlCards[0], pnlNotes[0], elsIn(pnlF, "GroupLabel")[0]].map((el) => el?.getStart() ?? -1);
check("C8 final P&L screen: Revenue is the one summary card (its value and, against the previous period, its delta); no Gross Profit, Operating Profit or Net Profit card or row — PnlView reads no grossProfit / operatingProfit / netProfit and names none of them",
  pnlCards.length === 1 && same(pnlItemList, ['{label:t(locale,"Revenue"),value:d.revenueTotal,delta:prev?d.revenueTotal-prev.revenueTotal:undefined}']) &&
    !PROFIT_READ.test(finPnlCode) && !PROFIT_LABEL.test(finPnlCode), JSON.stringify({ pnlItemList, read: finPnlCode.match(PROFIT_READ)?.[0], label: finPnlCode.match(PROFIT_LABEL)?.[0] }));
check(`C8 final P&L notice: one ReportNote, right after the Revenue card and before the first group — t(locale, "${P_NOTICE}"), with its Arabic in the dictionary`,
  pnlNotes.length === 1 && kidsText(pnlNotes[0]) === flat(`{t(locale, ${JSON.stringify(P_NOTICE)})}`) && pnlOrder.every((p, i) => p >= 0 && (i === 0 || p > pnlOrder[i - 1])) &&
    translate("ar", P_NOTICE) === "تم إخفاء مؤشرات الربح مؤقتًا لأن احتساب تكلفة المبيعات وتقييم المخزون لم يكتمل بعد.", JSON.stringify({ notes: pnlNotes.length, pnlOrder }));
check("C8 final P&L keeps every factual part: the Revenue, Cost of Sales, Operating Expenses and (when there are any) Other Income & Expenses groups, their account lines with the drill-down, and Total Revenue — the only rows a line and Total Revenue",
  same(pnlGroups, ['{t(locale,"Revenue")}', '{t(locale,"CostofSales")}', '{t(locale,"OperatingExpenses")}', '{t(locale,"OtherIncome&Expenses")}']) &&
    same(pnlRows, ["{`${l.code}${accountName(locale,l)}`}|{l.amount}|", '{t(locale,"TotalRevenue")}|{d.revenueTotal}|final']) &&
    ["d.revenue.map(line)", "d.costOfSales.map(line)", "d.operatingExpenses.map(line)", "d.otherIncome.map(line)", "d.otherExpenses.map(line)", "onDrill={()=>onDrill({id:l.id,name:accountName(locale,l)})}"]
      .every((s) => flat(finPnlCode).split(s).length === 2), JSON.stringify({ pnlGroups, pnlRows }));
// Balance Sheet: the current-period line and amount stay, marked Preliminary; the disclosure closes the statement.
const bsRows = elsIn(bsF, "Row");
const cpRows = bsRows.filter((el) => attrCode(el, "label").includes("Current-periodProfit/(Loss)"));
const bsNotes = elsIn(bsF, "ReportNote");
const lastRow = bsRows[bsRows.length - 1];
check("C8 final Balance Sheet: Current-period Profit / (Loss) keeps its line, its amount (d.currentPeriodProfit) and its place in Equity, marked Preliminary (PreliminaryMark beside the label) — every other line, total and card as the remediation left them (the delta above)",
  cpRows.length === 1 && attrCode(cpRows[0], "label") === '{<>{t(locale,"Current-periodProfit/(Loss)")}<PreliminaryMarklocale={locale}/></>}' &&
    attrCode(cpRows[0], "value") === "{d.currentPeriodProfit}" && !attr(cpRows[0], "final") &&
    bsRows.indexOf(cpRows[0]) === bsRows.findIndex((el) => attrCode(el, "label") === '{t(locale,"RetainedEarnings")}') + 1 &&
    attrCode(bsRows[bsRows.indexOf(cpRows[0]) + 1], "label") === '{t(locale,"TotalEquity")}', cpRows.map((el) => attrCode(el, "label")).join(" "));
check(`C8 final Balance Sheet disclosure: one ReportNote after Total Liabilities + Equity — t(locale, "${B_NOTICE}"), with its Arabic; "Preliminary" too`,
  bsNotes.length === 1 && kidsText(bsNotes[0]) === flat(`{t(locale, ${JSON.stringify(B_NOTICE)})}`) && !!lastRow && attrCode(lastRow, "label") === '{t(locale,"TotalLiabilities+Equity")}' &&
    bsNotes[0].getStart() > lastRow.getStart() && translate("ar", B_NOTICE) === "مبدئي — احتساب تكلفة المبيعات وتقييم المخزون غير مكتمل، وقد تتغير نتيجة الفترة الحالية." &&
    translate("ar", "Preliminary") === "مبدئي", JSON.stringify({ notes: bsNotes.length }));
// The two pieces: a note (not a live region) in a contrast-verified pair; a word, not a colour alone, in a verified pair.
const noteFn = finFn("ReportNote"), markFn = finFn("PreliminaryMark");
const noteP = elsIn(noteFn, "p")[0], markSpan = elsIn(markFn, "span")[0];
const noteCls = (strAttr(noteP, "className") ?? "").split(/\s+/);
const markCls = (strAttr(markSpan, "className") ?? "").split(/\s+/);
check("C8 final ReportNote: a <p role=\"note\"> (read in place, not a live region) — ink on surface-subtle (verify:contrast's \"text on surface-subtle\" pair, light and dark), its Info icon aria-hidden; PreliminaryMark: the word t(locale, \"Preliminary\") in warning on its tint (the \"warning text on its tint\" pair), a logical margin, no handler",
  !!noteP && strAttr(noteP, "role") === "note" && ["text-ink", "bg-surface-subtle", "border-line"].every((c) => noteCls.includes(c)) && !noteCls.includes("text-ink-muted") &&
    elsIn(noteFn, "Info").length === 1 && strAttr(elsIn(noteFn, "Info")[0], "aria-hidden") === "true" &&
    !!markSpan && ["text-warning", "bg-warning-bg", "ms-1.5"].every((c) => markCls.includes(c)) && !markCls.some((c) => /^(ml|mr|pl|pr)-/.test(c)) &&
    kidsText(markSpan) === '{t(locale,"Preliminary")}' && !/onClick|onKeyDown|tabIndex|<button/.test(markFn?.getText() ?? ""), JSON.stringify({ noteCls, markCls }));
// Print: the report area shows itself again, so the notices print with the report (the shell's preview rule hid it).
const printFn = codeOnly(finFn("PrintStyles")?.getText() ?? "");
check("C8 final print: the reports' print styles keep hiding the app chrome and the workspace controls and show the report area again (.reports-print-area, .reports-print-area * { visibility: visible !important }) — mockup-parity.css's preview rule (body * hidden) is unchanged; the notices are inside the report card, so they print",
  [".sidebar, .topbar, .no-print { display: none !important; }", ".reports-print-area { max-width: none !important; margin: 0 !important; }",
    ".reports-print-area, .reports-print-area * { visibility: visible !important; }"].every((s) => printFn.includes(s)) &&
    /body \* \{ visibility: hidden !important; \}/.test(read(CSSF)) && pnlNotes.length === 1 && bsNotes.length === 1, printFn.slice(0, 200));
// The project section: renamed, an h2, the four factual cards, nothing profit-derived.
const costRaw = rawParse(C3_COST);
const costHeads = (inside(costRaw, (n) => isEl(n) && n.tagName.getText() === "SectionHeader") as El[]).map((el) => `${attrCode(el, "level")} ${attrCode(el, "title")}`);
const costRowsRaw = (inside(costRaw, (n) => isEl(n) && n.tagName.getText() === "StatRow") as El[]).map((el) => [attrCode(el, "columns"), attrCode(el, "items")]);
const oldTitleSeen = walk("src").filter((f) => /\.tsx?$/.test(f) && !f.startsWith("src/lib/") && /"Cost & Profitability"/.test(codeOnly(rawRead(f)))).map(rel);
check("C8 final project section: an h2 SectionHeader titled t(locale, \"Project Revenue & Costs\") (إيرادات وتكاليف المشروع), Revenue and Costs its h3s; \"Cost & Profitability\" in no application code; still one StatRow, columns={4} — Sales Value, Invoiced, Collected, Total Cost — and no profit, margin or health",
  same(costHeads, ['{2} {t(locale,"ProjectRevenue&Costs")}', '{3} {t(locale,"Revenue")}', '{3} {t(locale,"Costs")}']) && oldTitleSeen.length === 0 &&
    translate("ar", "Project Revenue & Costs") === "إيرادات وتكاليف المشروع" && same(costRowsRaw, [["{4}", COST_ITEMS]]) &&
    !/\b(profit|marginPercent|health|healthText|statusTextClass|StatusBadge)\b/.test(codeOnly(rawRead(C3_COST))), JSON.stringify({ costHeads, oldTitleSeen }));
// The export route: the P&L and the Balance Sheet only; the session, the tenant, the range, the eight kinds as they were.
const exRaw = rawRead(C8F_EXPORT), exFlat = flat(exRaw), exCode = codeOnly(exRaw);
const plBranch = flat(exRaw.slice(exRaw.indexOf('if (report === "pl") {'), exRaw.indexOf('} else if (report === "bs") {')));
const bsBranch = flat(exRaw.slice(exRaw.indexOf('} else if (report === "bs") {'), exRaw.indexOf('} else if (report === "cf") {')));
check("C8 final P&L export (CSV / Excel / PDF): its rows are the Revenue lines, Total Revenue, the Cost of Sales, Operating Expenses, Other Income and Other Expenses lines — no Gross Profit, Operating Profit or Net Profit / (Loss) row, no grossProfit / operatingProfit / netProfit read anywhere in the route — and its one header line the notice",
  plBranch.includes(flat('rows = [ ...grp("Revenue", d.revenue), { section: "Revenue", account: "Total Revenue", amount: money(d.revenueTotal) }, ...grp("Cost of Sales", d.costOfSales), ...grp("Operating Expenses", d.operatingExpenses), ...grp("Other Income", d.otherIncome), ...grp("Other Expenses", d.otherExpenses), ];')) &&
    plBranch.includes(flat(`meta = [{ label: "Note", value: ${JSON.stringify(P_NOTICE)} }];`)) && !PROFIT_READ.test(exCode) && !PROFIT_LABEL.test(exCode), plBranch.slice(0, 300));
check("C8 final Balance Sheet export: Current-period Profit / (Loss) (Preliminary) keeps its section (Equity) and its amount, money(d.currentPeriodProfit); its header line the disclosure — every other row as before",
  bsBranch.includes(flat('{ section: "Equity", account: "Current-period Profit / (Loss) (Preliminary)", amount: money(d.currentPeriodProfit) },')) &&
    bsBranch.includes(flat(`meta = [{ label: "Note", value: ${JSON.stringify(B_NOTICE)} }];`)) && bsBranch.split("account:").length === undoFin(C8F_EXPORT, exRaw).split('} else if (report === "bs") {')[1].split('} else if (report === "cf") {')[0].split("account:").length,
  bsBranch.slice(0, 300));
check("C8 final export route, everything else as it was: the session first (requireSession, once), the tenant on every query (session.orgId × 9), the report-kind guard, the range and account filter, the eight kinds' branches, the per-request base-currency rounding — and the header block (meta) set only by the P&L and the Balance Sheet, handed to exportResponse, so every other report's output is unchanged",
  /export async function GET\(req: Request\) \{\n {2}const session = await requireSession\(\);/.test(exRaw) && (exRaw.match(/requireSession\(\)/g) ?? []).length === 1 &&
    (exRaw.match(/session\.orgId/g) ?? []).length === 9 && exRaw.includes('if (!isReportKind(report)) return new Response("Unknown report", { status: 400 });') &&
    ['report === "pl"', 'report === "bs"', 'report === "cf"', 'report === "tb"', 'report === "gl"', 'report === "ar" || report === "ap"'].every((s) => exRaw.includes(`if (${s}) {`)) &&
    exRaw.includes("const money = moneyFor(session.orgCurrency);") && exRaw.includes("let meta: ExportMeta | undefined;") && (exCode.match(/\bmeta = \[/g) ?? []).length === 2 &&
    exFlat.includes(flat("return exportResponse(format, `${title} (${range.from} → ${range.to})`, `${report}-${stamp}`, columns, rows, meta);")), "");
// The exporter is unchanged, so its limits stand: one 9 pt line per header entry, a 3-column cell clipped at its width.
const { PDFDocument, StandardFonts } = await import("pdf-lib");
const helv = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
const pdfSafe = (s: string) => s.replace(/[–—]/g, "-");
const noteW = [P_NOTICE, B_NOTICE].map((n) => helv.widthOfTextAtSize(pdfSafe(`Note: ${n}`), 9));
const cellW = helv.widthOfTextAtSize("Current-period Profit / (Loss) (Preliminary)", 8);
check(`C8 final exports fit the exporter as it is (report-export.ts unchanged): each note one header line in the PDF (${noteW.map((w) => w.toFixed(1)).join(" / ")} pt ≤ 523.3 pt at 9 pt), the marked Balance Sheet line inside its column (${cellW.toFixed(1)} pt ≤ 168.4 pt at 8 pt) — nothing clipped`,
  noteW.every((w) => w <= 595.28 - 72) && cellW <= (595.28 - 72) / 3 - 6, "");
// The dictionary: exactly the four entries, each with its Arabic; no duplicate key; no digit in any of them.
const dictSf = rawParse(C8F_DICT);
const dictObj = findAll(dictSf, varNamed("DICT"))[0];
const dictKeys = dictObj ? inside(dictObj, (n) => ts.isPropertyAssignment(n) && ts.isObjectLiteralExpression(n.parent)).map((n) => {
  const nm = (n as ts.PropertyAssignment).name;
  return ts.isStringLiteral(nm) ? nm.text : nm.getText();
}) : [];
const entriesIn = (s: string) => s.split("\n").filter((l) => /^ {2}("[^"]+"|\w+): "/.test(l)).length;
const FIN_DICT: Record<string, string> = {
  "Project Revenue & Costs": "إيرادات وتكاليف المشروع",
  [P_NOTICE]: "تم إخفاء مؤشرات الربح مؤقتًا لأن احتساب تكلفة المبيعات وتقييم المخزون لم يكتمل بعد.",
  Preliminary: "مبدئي",
  [B_NOTICE]: "مبدئي — احتساب تكلفة المبيعات وتقييم المخزون غير مكتمل، وقد تتغير نتيجة الفترة الحالية.",
};
check(`C8 final dictionary: exactly four new entries — Project Revenue & Costs, the P&L notice, Preliminary, the Balance Sheet disclosure — each with its approved Arabic and no digit (Western or Arabic-Indic); ${dictKeys.length} keys, no duplicate; every earlier key and value unchanged (undone, dict.ts is the remediation's to the byte, above)`,
  dictKeys.length === 1755 && new Set(dictKeys).size === dictKeys.length && Object.entries(FIN_DICT).every(([k, v]) => dictKeys.includes(k) && translate("ar", k) === v && !/[0-9٠-٩۰-۹]/.test(v)) &&
    FIN_EDITS[C8F_DICT].length === 1 && entriesIn(FIN_EDITS[C8F_DICT][0][1]) - entriesIn(FIN_EDITS[C8F_DICT][0][0]) === 4, `${dictKeys.length} keys, ${new Set(dictKeys).size} distinct`);
// Nowhere on screen: outside src/lib no application file names or reads a profitability metric — no exception left.
const FIN_HIDDEN = /"(Actual Profit|Profit Margin|Gross Profit|Operating Profit|Net Profit|Net Profit \/ \(Loss\)|Cost & Profitability)"|\b(grossProfit|operatingProfit|netProfit|marginPercent)\b|project_health/;
const finSeen = walk("src").filter((f) => /\.tsx?$/.test(f) && !f.startsWith("src/lib/") && FIN_HIDDEN.test(codeOnly(rawRead(f)))).map(rel);
check('C8 final on screen and in the exports: no application file outside src/lib (the engines, the registry, the dictionary) names or reads a profitability metric — no "Gross Profit", "Operating Profit", "Net Profit", "Actual Profit" or "Profit Margin" label, no grossProfit / operatingProfit / netProfit / marginPercent read, no project_health — the P&L export route included (the remediation\'s one exception, gone); the Balance Sheet\'s Current-period Profit / (Loss) its one labelled result, marked Preliminary',
  finSeen.length === 0 && (rawRead(C4_REPORTS).match(/"Current-period Profit \/ \(Loss\)"/g) ?? []).length === 1 && (exRaw.match(/Current-period Profit \/ \(Loss\)/g) ?? []).length === 1, finSeen.join(" "));

// ---------- 18. Integration with main — the approved main changes to frozen files ----------
section("18. Integration with main — approved main changes to frozen files");
// Each file's MAIN_EDITS hunks occur once, their 1bfdbbf form nowhere; undone, the file is its business pin to the byte.
const mainDrift = Object.keys(MAIN_EDITS).filter((f) => {
  const src = rawRead(f);
  return !MAIN_EDITS[f].every(([was, is]) => src.split(is).length === 2 && !src.includes(was)) || h16(frozen(f)) !== pins.business[f];
});
check("Integration with main: the PDF route's one change since its business pin is PR #7's hunk (32702c3) — the print page rendered from PDF_RENDER_ORIGIN, trimmed and without a trailing slash, when it is set (the trusted loopback origin behind the TLS-terminating proxy, not the https://localhost:3200 NextRequest reports there), else from the request's origin — once, its earlier form nowhere; undone, the route is its business pin (6d3dc7899981d148) to the byte",
  same(Object.keys(MAIN_EDITS), [PDF_ROUTE]) && MAIN_EDITS[PDF_ROUTE].length === 1 && mainDrift.length === 0 && pins.business[PDF_ROUTE] === "6d3dc7899981d148",
  mainDrift.map(rel).join(" "));

// ---------- 19. ACC-01 — the approved change to frozen business files ----------
section("19. ACC-01 — weighted-average inventory costing (the approved change to frozen business files)");
// Read as they are on disk: each changed file is main's plus exactly its recorded hunks, each added file as recorded.
const accDrift = acc01Drift((f) => (existsSync(path.join(ROOT, f)) ? actualRead(f) : null));
const accHunks = Object.values(ACC01_EDITS).flat().length;
check(`ACC-01 changed its ${Object.keys(ACC01_EDITS).length} files (src/, and verify-document-form.mts for its own undo layer) by exactly their ${accHunks} recorded hunks — each once, its main form nowhere; undone, each file is main's (${ACC01_BASE.slice(0, 7)}) to the byte — and added exactly its ${Object.keys(ACC01_NEW).length} files under src/lib and src/db/schema, as recorded`,
  accDrift.length === 0 && Object.keys(ACC01_EDITS).length === 18 && accHunks === 78 && Object.keys(ACC01_NEW).length === 4 &&
    Object.keys(ACC01_NEW).every((f) => /^src\/(lib|db\/schema)\/[\w-]+\.ts$/.test(f)) &&
    Object.keys(ACC01_EDITS).every((f) => f.startsWith("src/") || f === "verify/verify-document-form.mts"),
  accDrift.map(rel).join(" "));
// No file under src/ outside the record differs from main: every other file is in the older groups' byte-identity hashes
// (groups 4, 16 and 17), and a new file the record does not list is caught there too — `walk` leaves out only ACC01_NEW.
check("ACC-01 added no file under src/ but the recorded four (an unrecorded new file would sit in groups 16 and 17's src trees)",
  walk("src").length + Object.keys(ACC01_NEW).length === (function all(d: string): number {
    return readdirSync(path.join(ROOT, d)).reduce((n, name) => n + (statSync(path.join(ROOT, d, name)).isDirectory() ? all(path.posix.join(d, name)) : 1), 0);
  })("src"));

console.log("\nGroups:");
for (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);
console.log(`\n${pass}/${pass + fail} checks`);
console.log(fail === 0 ? "PAGE ARCHETYPES VERIFICATION PASS" : "PAGE ARCHETYPES VERIFICATION FAIL");
process.exit(fail === 0 ? 0 : 1);
