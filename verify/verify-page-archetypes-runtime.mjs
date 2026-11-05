/**
 * DEV-UI-01.7 C0 — page-archetype runtime baseline (C1: master-data and entity-detail targets; C2: HR
 * targets and the D-6 StatRow gate; C3: Projects and the kanban; C4: finance and reports; C5: Settings;
 * C6: the Dashboard).
 *
 *   node verify/verify-page-archetypes-runtime.mjs                   measure, compare with the baseline
 *   node verify/verify-page-archetypes-runtime.mjs --write-baseline  measure, write the baseline files
 *   node verify/verify-page-archetypes-runtime.mjs --rebaseline=<route id,…>
 *                                                   measure every route; re-record only those routes (a
 *                                                   named route the baseline does not have yet is added)
 *   node verify/verify-page-archetypes-runtime.mjs --write-d6        measure the D-6 pass alone; write it as
 *                                                   the baseline's `d6` record (C2 recorded it on C1's build)
 *   node verify/verify-page-archetypes-runtime.mjs --write-c3ref     measure the C3 project pass alone; write it as
 *                                                   the baseline's `c3ref` record (C3 recorded it on C2's build)
 *   node verify/verify-page-archetypes-runtime.mjs --write-c4ref     measure the C4 value pass alone; write it as
 *                                                   the baseline's `c4ref` record (C4 recorded it on C3's build)
 *   node verify/verify-page-archetypes-runtime.mjs --write-c6ref     measure the C6 Dashboard value pass alone; write
 *                                                   it as the baseline's `c6ref` record (C6 recorded it on C5's build)
 *   node verify/verify-page-archetypes-runtime.mjs --write-c7ref     measure the C7 heading pass alone; write it as the
 *                                                   baseline's `c7ref` record (C7 recorded it on C6's build)
 *   flags: --skip-build (reuse .next — only when it was built from the current tree), --only=<route id>[,<route id>…],
 *          --measure-out=<file> (also write what this run measured, for review evidence)
 *
 * C8 (the remediation — D-2 applied, presentation only) re-records nothing. The project pass now holds Cost &
 * Profitability to four factual cards (Sales Value, Invoiced, Collected, Total Cost — four across above 640 px, two at
 * 390, all in the plain value colour), no project_health badge and no Actual Profit or Profit Margin in the text or an
 * accessible name; the figures are still the c3ref record's (its first four cost figures — derived, not re-recorded).
 * The value pass holds every P&L state (the default route, ?report=pl, against the previous period, the P&L search) to
 * the c4ref record without the Gross Profit card and row — derived from it, not re-recorded — and asserts that neither is
 * shown; every other report and statement state is held to c4ref as it stands.
 *
 * C8 final (the product owner's financial display policy) adds one record, c8ref — the Financial Reports exports (the
 * eight kinds × CSV / Excel / PDF, an EN and an AR session; the PDF read back through pdf-lib's own text operators) and
 * the export URL without a session and as Staff — measured on the approved remediation's build (c47c65a,
 * --write-c8ref); it re-records nothing else. The value pass holds every P&L state to c4ref without its three profit
 * figures (the Gross Profit card and row, the Net Profit card, the Operating Profit and Net Profit / (Loss) rows) and
 * with the notice after its one card, and every Balance Sheet state to c4ref with its current-period line marked
 * Preliminary and the disclosure at its end — derived, not re-recorded; the export pass holds the P&L and the Balance
 * Sheet exports to c8ref with exactly those changes (the notice in the header block) and the six other kinds to it
 * unchanged; a print pass reads the P&L and the Balance Sheet in print media (the report's lines, its notes, no app
 * chrome). The project section is Project Revenue & Costs: the recorded outlines are read with that one h2 renamed.
 *
 * ACC-01 (weighted-average inventory costing, a business change) re-records nothing. The product form gained Item type
 * — two native radios (the shared RadioGroup, as Client Type), Stock item / Service in the page's language — on New
 * Product and on the product's own page, which edits it; and the Arabic product page's Adjust stock trigger is Arabic
 * (the record has it in English). The owner and Staff action lists are compared with the record plus exactly those
 * actions — derived, not re-recorded; every other measure of the two pages (unnamed controls included) as recorded.
 *
 * C7 (document and app-state heading semantics, D-3 — tags only, zero pixel difference) re-recorded the document
 * Recycle Bin and the not-found page (their titles h3 → h1) and adds a heading pass, run first — before any probe
 * writes to this copy: each of the eight document families' list, detail, create and edit page, the Recycle Bin and
 * the not-found page (a client, an invoice), EN / AR at 1440 and 390. The five families the seed has no document for
 * open TEST-ONLY drafts written for the pass and removed after (writeC7Drafts). Every page has exactly one h1, its
 * title in the dictionary's words (the family, the document number in the code face, Create / Edit …); the lists no
 * level skipped; and against the baseline's `c7ref` record, measured on C6's build (20eff7d, --write-c7ref), the
 * outline is C6's but for the title h3 → h1 and the Tax Invoice QR panel h4 → h2, the accessibility tree (Playwright's
 * aria snapshot) likewise level 3 → 1 and 4 → 2 with every name unchanged, each title's (and the QR heading's)
 * computed style and box identical, and each page's text and action inventory identical. The error boundary has no
 * route: its markup is rendered into <main> with the title as C6's h3 and as C7's h1 — identical style, box and pixels.
 *
 * C6 (the Dashboard) re-recorded its route and holds it to targets: one PageHeader holding the only h1
 * (Dashboard, the range selector and Customize Layout its actions); the seven widget titles as h2s; no
 * overflow, nothing past the viewport; no error; Western digits (the Recent Activities times were
 * Arabic-Indic, and so were the Arabic "Last 7 / 30 Days"). The grid is measured at every width, EN and AR:
 * twelve tracks with each widget's desktop span above 1100 px, two at ≤1100 px (Financial Overview the whole
 * row), one at ≤640 px — and no widget clips its content, across or down. What the page must no longer say
 * is asserted on every state: no Total
 * Profit, Profit Margin, Total Expenses or Expenses (D-1); none of the four marketing cards or "Coming
 * Soon" (D-4); the KPI trends and sparklines only where they are real (D-5: Total Sales both, Total
 * Invoices its trend, Receivables and Payables neither; no sparkline in Cash Flow). A value pass reads every
 * factual figure — the KPIs and their real trends, the revenue chart's bars, line and labels, the total
 * revenue, Cash Flow, the invoice statuses, projects, HR, the recent activities, the quick actions, the
 * ZATCA card — for this month, the last 30 days and this year, EN and AR at 1440 and 390, and holds it to the
 * baseline's `c6ref` record, measured on C5's build (e8f629b, --write-c6ref). Probes: the grid's two
 * breakpoints (1101 / 1100, 641 / 640 px); the range selector in the PageHeader (another range chosen: the
 * URL, the saved preference, the figures and labels follow; set back after); Customize Layout in an org
 * registered through the UI (the feature strip and Quick Actions hidden, HR Snapshot moved up, saved under the
 * same twelve keys, rendered so; reset after); an org whose country has no ZATCA Phase 1 (no feature strip at
 * all, its preference still there); the activity times — one made deterministic at a date-crossing instant —
 * under each browser's zone, Pacific/Pago_Pago and Pacific/Kiritimati: exactly formatDisplayDate's UTC
 * "dateTime" strings of what the database holds.
 *
 * C5 (Settings) re-recorded its 14 Settings routes — Business Settings on each of its ten tabs (seven of
 * them new routes, first recorded on C4's build — 54 routes), /settings/team (its redirect to the Team
 * tab), Presets, the Security Center and Security & Compliance Readiness — and holds them to targets: one
 * PageHeader holding the only h1 (Business Settings above its navigation, whichever tab; Presets; Security
 * Center, the owner's risk pill its meta; Security & Compliance Readiness, its disclaimer the
 * description); every outline exact, in the dictionary's words (each panel title an h2; Security's four
 * h2s; Compliance's readiness h2 over the three group h3s, then its two h2s); no overflow and nothing past
 * the viewport at any width (at 390 Business Settings was 92 px on Color Theme, Compliance 32 px); no
 * error; Western digits. SettingsNav is held at every width, EN and AR: Radix's root dir the document's
 * (left to itself Radix wrote ltr in Arabic), the list at the inline start beside the panel from 768 px
 * and full width above it below (D-7), the items start-aligned, the ten tabs and four groups in
 * SETTINGS_TABS order with their labels — Fiscal Year, VAT Configuration, Users and Integrations in Arabic
 * too. Probes, EN and AR: the D-7 breakpoint at 767 / 768 px; the navigation by keyboard (Tab to the active
 * tab, the only tabbable one; ArrowDown, ArrowUp, End and Home move the focus and the panel; ArrowRight and
 * ArrowLeft nothing — a vertical list — in Arabic too; the URL unchanged); Presets' 14 tabs and its three
 * titled panels; the Security Center as Staff (no Timeline, no risk pill); the Timeline's EmptyState (no
 * event in the page's 30-day window — a database count says so); an alert — five failed logins for an org
 * registered through the UI in this run's TEST-ONLY copy (security_events is append-only) — its stripe on
 * the inline-start side, the risk Elevated in the meta; Compliance at 1440 / 768 / 390, every control
 * inside the viewport, the customer select's list, and at 390 a consent granted (deleted after) listed
 * inside its card.
 *
 * C4 (finance + reports) re-recorded its 14 finance routes and holds them to targets: one PageHeader
 * holding the only h1 (Financial Reports, Client & Vendor Statements, Account Ledger, Chart of Accounts,
 * Payment Records, New Journal Entry, Bank Accounts); the selected report, the selected ledger account
 * and the journal / bank secondary sections as h2s; no overflow and no table past the viewport (Ledger
 * and Chart of Accounts were 139 / 122 px at 390); no error; Western digits; the report search named.
 * Three of those routes are new (reports-vat, statements-vendor, statement-vendor1 — 47 routes): their
 * entries were first recorded on C3's build, so C4's re-record compares them like the rest. A value
 * pass of its own reads what every report and statement says — the eight reports, four of them with
 * the previous period, an account-filtered General Ledger and a custom-range Trial Balance; the client
 * and vendor statements with and without a party; EN and AR at 1440 and 390; and a search, a drill-
 * down and a statement filter — and holds it to the baseline's `c4ref` record, measured on C3's build
 * (65e12d6, --write-c4ref): a figure, row, card, label, export link or drill target that moves fails.
 * The ledger / chart gate measures the account grid at every width: two panes at 1440, one track at
 * ≤1100 px, both panes inside the viewport, the ledger table scrolling inside its card with its last
 * column reachable, Add Account reachable. Three probes use the pages as a person would: the report
 * picker by keyboard (one toggle pressed; Enter and Space switch the report — the URL, the h2, the
 * exports and the body follow — and the search has its name); the Client / Vendor links (aria-current
 * on the one shown, the URL); and the empty states — no account selected, and, in an org registered
 * through the UI in this run's TEST-ONLY copy, no transactions, no payments, no journal entries, no
 * bank accounts.
 *
 * C2 (HR) re-recorded its seven routes with --rebaseline and holds them to targets: one PageHeader
 * holding the only h1 — C1's titles, now h1s — with Salary Structure and Past payroll runs as h2s; no
 * overflow at any width (Payroll was 57 / 40 px at 390); no Arabic-Indic digit, the Attendance date
 * and the Payroll month being exactly what formatDisplayDate writes for the frozen day and month; no
 * pointer-only clickable (the department chips were spans). Two probes use the pages as a person
 * would, EN and AR: the department filter by keyboard (Tab to each button, Enter / Space, aria-pressed
 * on the chosen one only, a visible focus ring, the cards the database says) and by pointer, as
 * before; the payroll rows by keyboard, and the table / payslip layout at every width — side by side
 * at 1440, stacked below 1100 px, nothing past the viewport, the table's last column reachable.
 *
 * D-6 (C2) puts every StatRow two across at ≤640 px. A pass of its own measures each consumer — the
 * eight document lists, Projects, Settings › Security (the bare .stat-row-2 class) and C2's two HR
 * strips — at every width, EN and AR: tracks, cards a line, clipping, the viewport; each card's label,
 * value, tone and colour; the status badges, the tables and the actions. The baseline's `d6` record
 * was measured on C1's build (8768cb2, --write-d6), so every run proves those consumers unchanged by
 * C2 but for their phone layout: above 640 px their rows are C1's to the pixel.
 *
 * C3 (Projects + kanban) re-recorded its four routes (the list, New Project, the populated project and
 * the empty one) and holds them to targets: one PageHeader holding the only h1, the detail's h1 → h2 →
 * h3 outline, no overflow, no error, Western digits, no pointer-only clickable (the task cards were
 * divs). A pass of its own measures the project detail at every width, EN and AR: the summary two
 * across in its 520px, Cost & Profitability three across above 640 px and two at 390, Revenue / Costs
 * side by side to 1024 and stacked from 900 px down, the numeric columns at the logical end in either
 * direction, the health badge and every figure. Three probes use the pages as a person would: the
 * kanban by keyboard (Tab to a card — its focus ring, its full name; Enter opens Edit Task for that
 * task, Escape closes and focus is back on that card; Space, the close button, Save, Add Task the
 * same) and by pointer, no task changing; the empty project's Tasks heading, Add Task and EmptyState;
 * the Hours column with one time log (a fixture row in this run's TEST-ONLY copy, removed after). The
 * baseline's `c3ref` record was measured on C2's build (c060e8b, --write-c3ref): every figure, the
 * badge, the kanban's columns, heads and cards — computed style and geometry, at rest and hovered —
 * so a run proves the div → button change left the cards as they were.
 *
 * C1 (master data + entity detail) re-recorded its 12 routes with --rebaseline and holds them to
 * targets, below: one PageHeader holding the page's only h1, meta before actions, the title at the
 * inline start; one h1 and no heading-level skip; no overflow at any width (client detail was 65 / 54
 * px at 390); in Arabic, none of the page copy C1 translated renders in English. A --rebaseline run
 * still compares those routes with the baseline it replaces — route behaviour, direction, Staff
 * permissions and every never-worse measure — and prints their outline and action changes for review.
 *
 * The 36 DEV-UI-01.7 pages, through 54 routes (detail, tab, report and statement variants, an empty
 * project, an unknown id), served by a production build. For every route it records what the page is TODAY:
 *
 *   - status and final path (route behaviour), lang and dir;
 *   - the heading outline inside <main>, the number of h1s and heading-level skips;
 *   - page overflow, the overflowing elements, tables reaching past the viewport;
 *   - Arabic-Indic digits, controls without a name, clickable things the keyboard cannot reach,
 *     which side the Settings navigation sits on;
 *   - console and page errors, and React #418 (hydration) in particular;
 *   - formatDisplayDate (C0's date helper, no consumer yet): the same strings in Chromium, under four
 *     browser locales and zones, as on the server — what a client component needs to hydrate;
 *   - the action inventory — every link, button, tab, menu trigger and toggle in <main>: kind,
 *     visible name, target, type, disabled — for the owner (EN and AR at 1440, EN at 390) and for a
 *     Staff member (EN and AR at 1440), and where Staff end up on each route (permissions).
 *
 * The legacy defects the later stages fix (h3 page titles, overflow at 390, the kanban, Settings
 * direction, Arabic-Indic dates…) are recorded as they are. Each is a baseline value that may only
 * IMPROVE: overflow, overflowing elements, h1 distance from one, heading skips, tables past the
 * viewport, Arabic-Indic digits, unnamed controls, pointer-only clickables and error counts may never
 * grow. Route behaviour, direction, the heading outline and the action inventory must match exactly —
 * a stage that changes one on purpose re-baselines (--write-baseline) and its review reads the diff.
 * React #418 must be zero everywhere, whatever the baseline says.
 *
 * Browsers are realistic and adversarial: English in America/New_York (en-US), Arabic in Asia/Riyadh
 * (ar-SA), and a sweep at 1440 in Pacific/Pago_Pago, where the frozen instant is still the day before.
 *
 * TEST-ONLY, and it refuses rather than guesses: it needs UI_BASELINE_ADMIN_URL (a LOCAL role with
 * CREATEDB; tests/ui-baseline/isolation.mjs refuses any other host), serves only its own
 * `devui010_test_only_archetypes` copy of the synthetic seed, refuses to run where a .env exists,
 * binds the server to 127.0.0.1, aborts every browser request that is not to that server, freezes the
 * server and browser clocks at the harness instant, and runs the pinned Chromium build. It is not a
 * verify:browser suite (it starts its own server on its own port).
 * docs/ui/dev-ui-01-7/c0-foundations-and-guardrails.md
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { chromium } from "playwright";
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from "pdf-lib";
import ts from "typescript";
import { FROZEN_NOW, OWNER_EMAIL } from "../tests/ui-baseline/config.mjs";
import { STAFF_EMAIL } from "../tests/ui-baseline/shell-states.mjs";
import { DB_PREFIX, TEMPLATE_DB, adminUrl, dbUrl, describe, serverEnv } from "../tests/ui-baseline/isolation.mjs";
import { alignDatabaseTimestamps, removeC7Drafts, writeC7Drafts } from "../tests/ui-baseline/archetype-states.mjs";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";
import { createHash, randomUUID } from "node:crypto";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
process.chdir(ROOT);
const PORT = 3170;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = `${DB_PREFIX}archetypes`;
const CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PASSWORD_FILE = join(ROOT, ".ui-baseline-work/owner-password");
const BASELINE_FILE = "verify/page-archetype-runtime-baseline.json";
const ACTIONS_FILE = "verify/page-archetype-actions.json";
const args = process.argv.slice(2);
const WRITE = args.includes("--write-baseline");
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7);
const REBASE = args.find((a) => a.startsWith("--rebaseline="))?.slice(13).split(",").filter(Boolean);
const MEASURE_OUT = args.find((a) => a.startsWith("--measure-out="))?.slice(14);
const WRITE_D6 = args.some((a) => a === "--write-d6" || a.startsWith("--write-d6="));
const WRITE_C3REF = args.some((a) => a === "--write-c3ref" || a.startsWith("--write-c3ref="));
const WRITE_C4REF = args.some((a) => a === "--write-c4ref" || a.startsWith("--write-c4ref="));
const WRITE_C6REF = args.some((a) => a === "--write-c6ref" || a.startsWith("--write-c6ref="));
const WRITE_C7REF = args.some((a) => a === "--write-c7ref" || a.startsWith("--write-c7ref="));
const WRITE_C8REF = args.some((a) => a === "--write-c8ref" || a.startsWith("--write-c8ref="));
/** A pass that records one thing alone: no owner / Staff / sweep passes, no probes. */
const RECORD_ONLY = WRITE_D6 || WRITE_C3REF || WRITE_C4REF || WRITE_C6REF || WRITE_C7REF || WRITE_C8REF;
/** --only=<id>[,<id>…]: a route (or pass) id containing any of them. */
const onlyId = (id) => !ONLY || ONLY.split(",").some((o) => o && id.includes(o));

// DEV-UI-01.7 C1: the routes of the 12 master-data and entity-detail pages. (nf-client renders the
// not-found page for clients/[id]; it is not C1's and stays at its baseline.)
const C1_ROUTES = ["clients", "client-detail", "client-new", "client-bin", "vendors", "vendor-detail", "vendor-new", "vendor-bin", "products", "product-detail", "product-new", "product-bin"];
// The page copy C1 moved onto t(): in Arabic none of it may render in English. A text node equal to
// one of `exact`, or starting with a prefix ("SKU BTH-3X3", "Reorder level: 5"), counts when it is
// outside a <form>: a form's own labels (ClientForm / VendorForm / ProductForm internals — ProductForm
// has its own "Reorder level" field) are not page copy and not C1's. The submit labels a page hands its
// form (submitLabel) are page copy rendered inside the form, so they count anywhere.
const C1_LITERALS = {
  exact: [
    "Client profile", "Vendor profile", "No invoices yet.", "Purchase Orders", "No purchase orders yet.", "Stock", "Quantity on hand",
    "New Vendor", "New Product", "Add a vendor to order and receive against.", "Add a product to your inventory catalog.",
    "Clients — Recycle Bin", "Vendors — Recycle Bin", "Products — Recycle Bin", "Deleted clients live here until restored or permanently deleted.",
    "Deleted vendors live here until restored or permanently deleted.", "Deleted products live here until restored or permanently deleted.",
    "Back to Clients", "Back to Vendors", "Back to Products",
  ],
  prefixes: ["SKU ", "Reorder level"],
  submit: ["Save changes", "Create Client", "Create Vendor", "Create Product"],
};
const isC1Literal = (s) => C1_LITERALS.submit.includes(s) || C1_LITERALS.exact.includes(s) || C1_LITERALS.prefixes.some((p) => s.startsWith(p));

// [id, path, the DEV-UI-01.7 page it renders]
const ROUTES = [
  ["dashboard", "/dashboard", "dashboard"],
  ["clients", "/clients", "clients"], ["client-detail", "/clients/1", "clients/[id]"], ["client-new", "/clients/new", "clients/new"], ["client-bin", "/clients/recycle-bin", "clients/recycle-bin"],
  ["vendors", "/purchasing/vendors", "purchasing/vendors"], ["vendor-detail", "/purchasing/vendors/1", "purchasing/vendors/[id]"], ["vendor-new", "/purchasing/vendors/new", "purchasing/vendors/new"],
  ["vendor-bin", "/purchasing/vendors/recycle-bin", "purchasing/vendors/recycle-bin"],
  ["products", "/inventory/products", "inventory/products"], ["product-detail", "/inventory/products/1", "inventory/products/[id]"], ["product-new", "/inventory/products/new", "inventory/products/new"],
  ["product-bin", "/inventory/products/recycle-bin", "inventory/products/recycle-bin"],
  ["bank-accounts", "/finance/bank-accounts", "finance/bank-accounts"], ["coa", "/finance/chart-of-accounts", "finance/chart-of-accounts"], ["journal", "/finance/journal", "finance/journal"],
  ["ledger", "/finance/ledger", "finance/ledger"], ["payments", "/finance/payments", "finance/payments"],
  ["reports-pl", "/finance/reports", "finance/reports"], ["reports-tb", "/finance/reports?report=tb", "finance/reports"], ["reports-ar", "/finance/reports?report=ar", "finance/reports"],
  ["reports-gl", "/finance/reports?report=gl", "finance/reports"], ["reports-vat", "/finance/reports?report=vat", "finance/reports"],
  ["statements", "/finance/statements", "finance/statements"], ["statement-client1", "/finance/statements?kind=client&party=1", "finance/statements"],
  ["statements-vendor", "/finance/statements?kind=vendor", "finance/statements"], ["statement-vendor1", "/finance/statements?kind=vendor&party=1", "finance/statements"],
  ["hr-attendance", "/hr/attendance", "hr/attendance"], ["hr-departments", "/hr/departments", "hr/departments"], ["hr-employees", "/hr/employees", "hr/employees"],
  ["hr-employee-detail", "/hr/employees/1", "hr/employees/[id]"], ["hr-employee-new", "/hr/employees/new", "hr/employees/new"], ["hr-leave", "/hr/leave", "hr/leave"], ["hr-payroll", "/hr/payroll", "hr/payroll"],
  ["projects", "/projects", "projects"], ["project-detail", "/projects/1", "projects/[id]"], ["project-empty", "/projects/2", "projects/[id]"], ["project-new", "/projects/new", "projects/new"],
  ["recycle-bin", "/recycle-bin", "recycle-bin"],
  ["settings-org", "/settings/organization", "settings/organization"], ["settings-org-business", "/settings/organization?tab=business-details", "settings/organization"],
  ["settings-org-team", "/settings/organization?tab=team", "settings/organization"],
  // C5: Business Settings' other tabs (ZATCA shows for the seed's Saudi profile).
  ["settings-org-logo", "/settings/organization?tab=logo", "settings/organization"], ["settings-org-bank", "/settings/organization?tab=default-bank", "settings/organization"],
  ["settings-org-fiscal", "/settings/organization?tab=fiscal-year", "settings/organization"], ["settings-org-vat", "/settings/organization?tab=vat-config", "settings/organization"],
  ["settings-org-numbers", "/settings/organization?tab=number-format", "settings/organization"],
  ["settings-org-roles", "/settings/organization?tab=roles-permissions", "settings/organization"], ["settings-org-zatca", "/settings/organization?tab=zatca", "settings/organization"],
  ["settings-presets", "/settings/presets", "settings/presets"], ["settings-security", "/settings/security", "settings/security"], ["settings-compliance", "/settings/compliance", "settings/compliance"],
  ["settings-team", "/settings/team", "settings/team"],
  ["nf-client", "/clients/999999", "clients/[id]"],
].filter(([id]) => onlyId(id));
const WIDTHS = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];
// Realistic, adversarial browsers: the client renders in the user's zone and locale, the server in UTC.
const BROWSERS = { en: { locale: "en-US", timezoneId: "America/New_York" }, ar: { locale: "ar-SA", timezoneId: "Asia/Riyadh" } };
const SWEEP_ZONE = "Pacific/Pago_Pago"; // UTC−11: 09:00Z on the 15th is 22:00 on the 14th there

// DEV-UI-01.7 C2: the seven HR routes, and the outline each must have — C1's titles (h3s then) as the
// page's one h1, its sections as h2s (Salary Structure was a styled div). Arabic dates are Gregorian
// with Western digits: C1 wrote the payroll month "يونيو ٢٠٢٦".
const C2_ROUTES = ["hr-employees", "hr-employee-new", "hr-employee-detail", "hr-departments", "hr-attendance", "hr-leave", "hr-payroll"];
const C2_OUTLINES = {
  "hr-employees": { en: ["h1 Employees"], ar: ["h1 الموظفون"] },
  "hr-employee-new": { en: ["h1 New Employee"], ar: ["h1 موظف جديد"] },
  "hr-employee-detail": { en: ["h1 Khalid Example (Fictional) · EMP-001", "h2 Salary Structure"], ar: ["h1 Khalid Example (Fictional) · EMP-001", "h2 هيكل الراتب"] },
  "hr-departments": { en: ["h1 Departments"], ar: ["h1 الأقسام"] },
  "hr-attendance": { en: ["h1 Attendance — Today"], ar: ["h1 الحضور والانصراف — اليوم"] },
  "hr-leave": { en: ["h1 Leave Requests"], ar: ["h1 طلبات الإجازة"] },
  "hr-payroll": { en: ["h1 Payroll — June 2026", "h2 Past payroll runs"], ar: ["h1 الرواتب — يونيو 2026", "h2 دورات الرواتب السابقة"] },
};
// The two dates C2 writes with formatDisplayDate, as they must read at FROZEN_NOW (2026-06-15): the
// Attendance pill (the day the records are selected for) and the Payroll title (the period's month).
const C2_DATES = { day: { en: "Jun 15, 2026", ar: "15 يونيو 2026" }, month: { en: "June 2026", ar: "يونيو 2026" } };
const ALL_DEPARTMENTS = { en: "All departments", ar: "جميع الأقسام" };
const PAYROLL_WORD = { en: "Payroll", ar: "الرواتب" };
// The two HR StatRows' labels (On leave is the status registry's attendance label).
const STRIP_LABELS = {
  "hr-employees": { en: ["Headcount", "Present today", "On leave", "Departments"], ar: ["عدد الموظفين", "الحاضرون اليوم", "في إجازة", "الأقسام"] },
  "hr-payroll": { en: ["Employees", "Gross pay", "Deductions", "Net pay"], ar: ["الموظفون", "الراتب الإجمالي", "الاستقطاعات", "صافي الراتب"] },
};
// D-6 (C2): every StatRow consumer, in a pass of its own — the eight document lists and Projects
// (StatRow), Settings › Security (the bare .stat-row-2 class) and C2's two HR strips.
const D6_ROUTES = [
  ["quotations", "/sales/quotations"], ["sales-orders", "/sales/orders"], ["proforma", "/sales/proforma"], ["sales-invoices", "/sales/invoices"],
  ["delivery-challans", "/sales/delivery-challans"], ["purchase-orders", "/purchasing/orders"], ["credit-notes", "/sales/credit-notes"], ["debit-notes", "/purchasing/debit-notes"],
  ["projects", "/projects"], ["settings-security", "/settings/security"], ["hr-employees", "/hr/employees"], ["hr-payroll", "/hr/payroll"],
].filter(([id]) => onlyId(id));
// C2's own strips are held to targets; every other consumer to the record C1's build left (`d6`).
const D6_C2 = ["hr-employees", "hr-payroll"];

// DEV-UI-01.7 C3: the four Projects routes. The project detail's outline: its name as the h1, Cost &
// Profitability (Revenue and Costs under it), Tasks (its four status columns — on the populated
// project only), Time logged this week, Linked Documents. Words from the dictionary; the task column
// labels are the task status registry's, Arabic included.
const C3_ROUTES = ["projects", "project-new", "project-detail", "project-empty"];
const C3_DETAIL = ["project-detail", "project-empty"];
const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"];
const TASK_STATUS = {
  en: { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done" },
  ar: { todo: "للتنفيذ", in_progress: "قيد التنفيذ", blocked: "معطَّل", done: "تم" },
};
const C3_WORDS = {
  en: {
    // C8 final: the section's name (cost) — and its name in the records (costC3), read as renamed.
    projects: "Projects", newProject: "New Project", cost: "Project Revenue & Costs", costC3: "Cost & Profitability", revenue: "Revenue", costs: "Costs", tasks: "Tasks", time: "Time logged this week",
    docs: "Linked Documents", priority: "Priority", assignee: "Assignee", unassigned: "Unassigned", low: "Low", medium: "Medium", high: "High", sep: ", ",
    editTask: "Edit Task", newTask: "New Task", addTask: "Add Task", save: "Save", noTasks: "No tasks yet. Add the first task to this project.",
    amount: "Amount", hours: "Hours", budget: "Budget", hoursLogged: "hours logged",
    // C8 (D-2): the four factual figures; what Cost & Profitability may no longer say (or name) is `hidden`.
    kpis: ["Sales Value", "Invoiced", "Collected", "Total Cost"],
    hidden: ["Actual Profit", "Profit Margin"],
  },
  ar: {
    projects: "المشاريع", newProject: "مشروع جديد", cost: "إيرادات وتكاليف المشروع", costC3: "التكلفة والربحية", revenue: "الإيرادات", costs: "التكاليف", tasks: "المهام", time: "الساعات المسجلة هذا الأسبوع",
    docs: "المستندات المرتبطة", priority: "الأولوية", assignee: "المكلَّف", unassigned: "غير مكلَّف", low: "منخفض", medium: "متوسط", high: "مرتفع", sep: "، ",
    editTask: "تعديل المهمة", newTask: "مهمة جديدة", addTask: "إضافة مهمة", save: "حفظ", noTasks: "لا توجد مهام بعد. أضف المهمة الأولى لهذا المشروع.",
    amount: "المبلغ", hours: "الساعات", budget: "الميزانية", hoursLogged: "الساعات المسجَّلة",
    kpis: ["قيمة المبيعات", "المفوتر", "المُحصَّل", "إجمالي التكلفة"],
    hidden: ["الربح الفعلي", "هامش الربح"],
  },
};
const C3_NUMERIC = [C3_WORDS.en.amount, C3_WORDS.en.hours, C3_WORDS.ar.amount, C3_WORDS.ar.hours];
/** The outline a Projects route must have (the project names come from this run's database copy). */
function c3Outline(id, l, names) {
  const W = C3_WORDS[l];
  if (id === "projects") return [`h1 ${W.projects}`];
  if (id === "project-new") return [`h1 ${W.newProject}`];
  const columns = id === "project-detail" ? TASK_STATUSES.map((s) => `h3 ${TASK_STATUS[l][s]}`) : [];
  return [`h1 ${names[id]}`, `h2 ${W.cost}`, `h3 ${W.revenue}`, `h3 ${W.costs}`, `h2 ${W.tasks}`, ...columns, `h2 ${W.time}`, `h2 ${W.docs}`];
}
/** A task card's accessible name, built here from the database row (an independent oracle). */
const taskName = (l, task) => {
  const W = C3_WORDS[l];
  return [task.title, TASK_STATUS[l][task.status], `${W.priority}: ${W[task.priority ?? "medium"]}`, `${W.assignee}: ${task.assignee ?? W.unassigned}`].join(W.sep);
};
// The computed style C3M compares between C2's div card and C3's button card (and their insides).
const CARD_PROPS = [
  "display", "box-sizing", "width", "height", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "border-top-left-radius", "border-top-right-radius", "border-bottom-left-radius",
  "border-bottom-right-radius", "background-color", "background-image", "box-shadow", "color", "font-family", "font-size", "font-weight", "font-style", "line-height",
  "letter-spacing", "text-align", "text-transform", "text-decoration-line", "text-indent", "white-space", "cursor", "opacity", "transform", "outline-style", "outline-width",
  "vertical-align", "overflow-x", "overflow-y",
];
const INNER_PROPS = ["display", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align", "text-transform", "color", "background-color", "margin-bottom"];
const HEAD_PROPS = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-transform", "color", "margin-top", "margin-bottom", "text-wrap-mode", "text-wrap-style"];

// DEV-UI-01.7 C4: the 14 finance routes (three of them new in C4), the words they must show — from the
// dictionary, Arabic included — and the outline each must have: its title as the page's one h1 (an h3
// before); the selected report, the selected ledger account and the journal / bank secondary sections as
// h2s (h3s, or a styled div, before).
const C4_ROUTES = ["reports-pl", "reports-tb", "reports-ar", "reports-gl", "reports-vat", "statements", "statement-client1", "statements-vendor", "statement-vendor1",
  "ledger", "coa", "payments", "journal", "bank-accounts"];
const C4_NEW = ["reports-vat", "statements-vendor", "statement-vendor1"];
const REPORT_KINDS = ["pl", "bs", "cf", "tb", "gl", "ar", "ap", "vat"];
const C4_WORDS = {
  en: {
    reports: "Financial Reports", statements: "Client & Vendor Statements", ledger: "Account Ledger", coa: "Chart of Accounts", payments: "Payment Records",
    journal: "New Journal Entry", recentJournal: "Recent journal entries", bank: "Bank Accounts", recentPayments: "Recent payment records", client: "Client", vendor: "Vendor",
    search: "Search…", addAccount: "Add Account", recordPayment: "Record Payment", newAccount: "New Account",
    kinds: { pl: "Profit & Loss", bs: "Balance Sheet", cf: "Cash Flow", tb: "Trial Balance", gl: "General Ledger", ar: "AR Aging", ap: "AP Aging", vat: "VAT Summary" },
    select: "Select an account to view its ledger.", noTx: "No transactions yet.", noPayments: "No payment records yet.", noJournal: "No journal entries yet.", noBanks: "No bank accounts yet.",
  },
  ar: {
    reports: "التقارير المالية", statements: "كشوف حساب العملاء والموردين", ledger: "دفتر الأستاذ", coa: "دليل الحسابات", payments: "سجلات الدفع",
    journal: "قيد يومية جديد", recentJournal: "أحدث قيود اليومية", bank: "الحسابات البنكية", recentPayments: "أحدث سجلات الدفع", client: "العميل", vendor: "المورّد",
    search: "بحث…", addAccount: "إضافة حساب", recordPayment: "تسجيل دفعة", newAccount: "إضافة حساب",
    kinds: { pl: "الأرباح والخسائر", bs: "الميزانية العمومية", cf: "التدفق النقدي", tb: "ميزان المراجعة", gl: "دفتر الأستاذ العام", ar: "أعمار الذمم المدينة", ap: "أعمار الذمم الدائنة", vat: "ملخص ضريبة القيمة المضافة" },
    select: "اختر حسابًا لعرض دفتر أستاذه.", noTx: "لا توجد معاملات بعد.", noPayments: "لا توجد سجلات دفع بعد.", noJournal: "لا توجد قيود يومية بعد.", noBanks: "لا توجد حسابات بنكية بعد.",
  },
};
/** The report a reports-* route shows (reports-pl is /finance/reports: P&L by default). */
const reportOf = (id) => (id === "reports-pl" ? "pl" : id.slice("reports-".length));
/** The outline a finance route must have; `selected` is the ledger's selected row as the page lists it. */
function c4Outline(id, l, selected) {
  const W = C4_WORDS[l];
  if (id.startsWith("reports-")) return [`h1 ${W.reports}`, `h2 ${W.kinds[reportOf(id)]}`];
  if (id.startsWith("statement")) return [`h1 ${W.statements}`];
  if (id === "ledger" || id === "coa") return [`h1 ${W[id]}`, ...(selected ? [`h2 ${`${selected.code} · ${selected.name}`.slice(0, 48)}`] : [])];
  if (id === "payments") return [`h1 ${W.payments}`];
  if (id === "journal") return [`h1 ${W.journal}`, `h2 ${W.recentJournal}`];
  return [`h1 ${W.bank}`, `h2 ${W.recentPayments}`];
}
// The value pass (§47 / §48): every report — the default route, the eight kinds, P&L / Balance Sheet / Cash
// Flow / VAT against the previous period, the General Ledger of one account (the seed's Cash, id 1) and a
// custom-range Trial Balance — and the client and vendor statements with and without a party; read at
// 1440 and 390, EN / AR, and held to the c4ref record C3's build left. At 1440 also: a search (by account
// code, the same in both languages), the first drill-down, a statement's from-date filter.
const C4_VALUE_CASES = [
  ["report-default", "/finance/reports"], ...REPORT_KINDS.map((k) => [`report-${k}`, `/finance/reports?report=${k}`]),
  ...["pl", "bs", "cf", "vat"].map((k) => [`report-${k}-compare`, `/finance/reports?report=${k}&compare=1`]),
  ["report-gl-cash", "/finance/reports?report=gl&account=1"], ["report-tb-q2", "/finance/reports?report=tb&from=2026-04-01&to=2026-06-30"],
  ["statement-client", "/finance/statements?kind=client"], ["statement-client1", "/finance/statements?kind=client&party=1"],
  ["statement-vendor", "/finance/statements?kind=vendor"], ["statement-vendor1", "/finance/statements?kind=vendor&party=1"],
];
const C4_SEARCH = { "report-pl": "4000", "report-tb": "1100" };
/** What opens the drill-down: a P&L figure (a button), a Trial Balance row (the row itself). */
const C4_DRILL = { "report-pl": "button", "report-tb": "tbody tr.cursor-pointer" };
const C4_FROM = { "statement-client1": "2026-04-01", "statement-vendor1": "2026-04-01" };

// DEV-UI-01.7 C5: the Settings family — Business Settings (its ten tabs; /settings/team redirects to the Team
// tab), Presets, the Security Center and Compliance. The words are the dictionary's own (dict.ts has no
// imports: transpiled and asked, as formatDisplayDate is below), so an Arabic page is held to exactly what
// the dictionary says; the static group 13 pins the five entries C5 added.
const C5_ROUTES = ["settings-org", "settings-org-business", "settings-org-team", "settings-org-logo", "settings-org-bank", "settings-org-fiscal", "settings-org-vat",
  "settings-org-numbers", "settings-org-roles", "settings-org-zatca", "settings-presets", "settings-security", "settings-compliance", "settings-team"];
const C5_NEW = ["settings-org-logo", "settings-org-bank", "settings-org-fiscal", "settings-org-vat", "settings-org-numbers", "settings-org-roles", "settings-org-zatca"];
/** Business Settings: the tab each route shows (color-theme is the page's default; /settings/team → team). */
const C5_TABS = {
  "settings-org": "color-theme", "settings-org-business": "business-details", "settings-org-team": "team", "settings-team": "team", "settings-org-logo": "logo",
  "settings-org-bank": "default-bank", "settings-org-fiscal": "fiscal-year", "settings-org-vat": "vat-config", "settings-org-numbers": "number-format",
  "settings-org-roles": "roles-permissions", "settings-org-zatca": "zatca",
};
/** SETTINGS_TABS in navigation order: each tab's value and its label — which is also its panel's title (the h2). */
const C5_NAV = [["business-details", "Business Details"], ["logo", "Logo"], ["color-theme", "Color Theme"], ["default-bank", "Default Bank Account"],
  ["fiscal-year", "Fiscal Year"], ["vat-config", "VAT Configuration"], ["number-format", "Number Format"], ["team", "Team"], ["roles-permissions", "Roles & Permissions"],
  ["zatca", "ZATCA Phase 1"]];
const C5_GROUPS = ["Company", "Finance", "Users", "Integrations"];
/** The 14 Presets tabs, in order (the page's own values). */
const C5_PRESET_TABS = ["tax-rates", "payment-terms", "units", "note-templates", "terms-groups", "bundles", "numbering", "exchange-rates", "print-layout", "seal-signature",
  "default-bank-accounts", "departments", "product-categories", "leave-types"];
/** The three Presets panels with a title of their own: its words (the h2). */
const C5_PRESET_PANELS = { "print-layout": "Print Layout", "seal-signature": "Seal & Signature", "default-bank-accounts": "Default Bank Accounts" };
const dictMod = { exports: {} };
new Function("module", "exports", "require", ts.transpileModule(readFileSync("src/lib/i18n/dict.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(
  dictMod, dictMod.exports, (spec) => { throw new Error(`dict.ts imports ${spec}`); });
/** What the page says for `en` in locale `l` — the dictionary's t(). */
const T = (l, en) => dictMod.exports.t(l, en);
/** ACC-01: the product pages' one authorized action change — what it says, in each language (held to the dictionary below). */
const ACC01_PAGES = ["product-detail", "product-new"];
const ACC01_WORDS = { en: { stock: "Stock item", service: "Service", adjust: "Adjust stock" }, ar: { stock: "صنف مخزني", service: "خدمة", adjust: "تعديل المخزون" } };
/** C6: the customizable widgets (key, dialog label, default order) — dashboard-layout.ts itself, a pure module. */
const layoutMod = { exports: {} };
new Function("module", "exports", "require", ts.transpileModule(readFileSync("src/lib/dashboard-layout.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(
  layoutMod, layoutMod.exports, (spec) => { throw new Error(`dashboard-layout.ts imports ${spec}`); });
const C6_LAYOUT_WIDGETS = layoutMod.exports.DASHBOARD_WIDGETS;
const C5_SECURITY = ["Two-Factor Authentication", "Password", "Active Sessions", "Security Timeline"];
const C5_READINESS = ["GDPR", "ISO 27001 — roadmap", "Platform security"];
/** The outline a Settings route must have (headings are measured to 48 characters). */
function c5Outline(id, l, admin = true) {
  const h = (lv, en) => `h${lv} ${T(l, en)}`.slice(0, 51);
  const tab = C5_TABS[id];
  if (tab) {
    const panel = C5_NAV.find(([v]) => v === tab)[1];
    return [h(1, "Business Settings"), h(2, panel), ...(tab === "roles-permissions" ? [h(3, "Actions restricted beyond their module")] : [])];
  }
  if (id === "settings-presets") return [h(1, "Presets")];
  if (id === "settings-security") return [h(1, "Security Center"), ...C5_SECURITY.filter((w) => admin || w !== "Security Timeline").map((w) => h(2, w))];
  return [h(1, "Security & Compliance Readiness"), h(2, "Readiness checklist"), ...C5_READINESS.map((w) => h(3, w)), h(2, "Data Subject Rights"), h(2, "Consent Management")];
}

// DEV-UI-01.7 C6: the Dashboard. Its widgets in the default order, with their desktop column and row spans (the
// DashWidget `col` / `row`) — the KPI cards by their label, the others by their h2 — and the factual-value
// cases: this month (the default), the last 30 days (day buckets) and this year (month buckets).
const C6_WIDGETS = [
  ["Total Sales", 3, 2], ["Total Invoices", 3, 2], ["Total Receivables", 3, 2], ["Total Payables", 3, 2], ["Financial Overview", 8, 5], ["Quick Actions", 4, 4],
  ["Recent Activities", 4, 5], ["Cash Flow", 3, 3], ["Invoices Overview", 3, 4], ["Project Overview", 3, 4], ["HR Snapshot", 3, 3],
];
const C6_H2 = ["Financial Overview", "Quick Actions", "Recent Activities", "Cash Flow", "Invoices Overview", "Project Overview", "HR Snapshot"];
/** D-5: [label, a real trend, a real sparkline]. */
const C6_KPIS = [["Total Sales", true, true], ["Total Invoices", true, false], ["Total Receivables", false, false], ["Total Payables", false, false]];
/** What the Dashboard no longer says (D-1, D-4), in English — and in Arabic where the dictionary has it. */
const C6_GONE_EN = ["Total Profit", "Profit Margin", "Total Expenses", "Expenses", "Secure & Reliable", "Encrypted connection, encrypted credentials", "Real-time Insights",
  "Data driven decisions", "Automated Processes", "Save time, work smarter", "CRM Integration", "Coming Soon", "We will connect our existing CRM"];
const c6Gone = (l) => [...new Set(C6_GONE_EN.flatMap((en) => [en, T(l, en)]))];
const C6_VALUE_CASES = [["dash-this_month", "/dashboard"], ["dash-last_30_days", "/dashboard?range=last_30_days"], ["dash-this_year", "/dashboard?range=this_year"]];
const C6_RANGE_OF = { "dash-this_month": "This Month", "dash-last_30_days": "Last 30 Days", "dash-this_year": "This Year" };
/** The deterministic activity instant the probe gives one quotation (UTC, as the column holds it). */
const C6_STAMP = "2026-06-14 23:30:00";
const C6_RANGE_KEYS = { this_month: "This Month", last_month: "Last Month", last_7_days: "Last 7 Days", last_30_days: "Last 30 Days", this_quarter: "This Quarter", this_year: "This Year", all_time: "All Time" };

// DEV-UI-01.7 C7 (D-3): the document families' pages and the app states. [key, path, the detail it opens and its
// number, the draft its editor opens, the list title, the type in the Create / Edit keys]. The detail and edit pages
// of the five families the seed has none of open the TEST-ONLY drafts (id 1) writeC7Drafts writes for the pass.
const C7_DOCS = [
  ["qtn", "/sales/quotations", 1, "QTN-0001", 3, "Quotations", "Quotation"], ["so", "/sales/orders", 1, "SO-0001", 1, "Sales Orders", "Sales Order"],
  ["pf", "/sales/proforma", 1, "PF-0001", 1, "Proforma Invoices", "Proforma Invoice"], ["inv", "/sales/invoices", 3, "INV-0003", 6, "Invoices", "Invoice"],
  ["dc", "/sales/delivery-challans", 1, "DC-0001", 1, "Delivery Challans", "Delivery Challan"], ["cn", "/sales/credit-notes", 1, "CN-0001", 1, "Credit Notes", "Credit Note"],
  ["po", "/purchasing/orders", 1, "PO-0001", 3, "Purchase Orders", "Purchase Order"], ["dn", "/purchasing/debit-notes", 1, "DN-0001", 1, "Debit Notes", "Debit Note"],
];
/** [route id, path, kind, the page title in a locale] */
const C7_PAGES = [
  ...C7_DOCS.flatMap(([k, path, detail, number, edit, title, type]) => [
    [`c7-${k}-list`, path, "list", (l) => T(l, title)], [`c7-${k}-detail`, `${path}/${detail}`, "detail", () => number],
    [`c7-${k}-new`, `${path}/new`, "new", (l) => T(l, `Create ${type}`)], [`c7-${k}-edit`, `${path}/${edit}/edit`, "edit", (l) => T(l, `Edit ${type}`)],
  ]),
  ["c7-bin", "/recycle-bin", "state", (l) => T(l, "Recycle Bin")], ["c7-nf", "/clients/999999", "state", (l) => T(l, "Page not found")],
  ["c7-nf-doc", "/sales/invoices/999999", "state", (l) => T(l, "Page not found")],
];
const C7_ROUTES = C7_PAGES.map(([id, path]) => [id, path]);
/** The error boundary's markup (error.tsx rendered by react-dom/server — group 15 renders it so), its title as TAG. */
const C7_ERROR_HTML = '<div class="max-w-md mx-auto text-center py-20"><div class="mx-auto mb-5 flex items-center justify-center rounded-2xl" style="width:56px;height:56px;background:var(--danger-bg);border:1px solid var(--line)"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert size-7" aria-hidden="true" style="color:var(--danger)"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg></div><TAG class="text-[19px] font-bold mb-2">Something went wrong</TAG><p class="text-ink-muted text-sm mb-6">An unexpected error occurred. You can try again, or head back to your dashboard.</p><div class="flex items-center justify-center gap-2.5"><button type="button" class="btn btn-primary" style="width:auto;padding:0 18px">Try again</button><a class="btn btn-glass" style="width:auto;padding:0 18px;display:inline-flex" href="/dashboard">Back to Dashboard</a></div></div>';
/** Playwright's aria snapshot → its headings, "<level> <name>". */
const ariaHeadings = (yaml) => [...String(yaml).matchAll(/- heading (?:"((?:[^"\\]|\\.)*)"|([^\n[]+?)) \[level=(\d)\]/g)].map((m) => `${m[3]} ${(m[1] ?? m[2]).replace(/\\"/g, '"').trim()}`);
/** The outline the Dashboard must have for a range label (headings are measured to 48 characters). */
const c6Outline = (l, range = "This Month") => [`h1 ${T(l, "Dashboard")}`, ...C6_H2.map((w) => `h2 ${w === "Cash Flow" ? `${T(l, w)} · ${T(l, range)}` : T(l, w)}`.slice(0, 51))];
/** The words the in-page C6 measures look for, in the page's language. */
const c6W = (l) => ({
  gone: c6Gone(l), cash: T(l, "Cash Flow"), invoices: T(l, "Invoices Overview"), projects: T(l, "Project Overview"), hr: T(l, "HR Snapshot"),
  totalRevenue: T(l, "Total Revenue"), zatca: T(l, "ZATCA Phase 1 QR"), customize: T(l, "Customize Layout"),
});

// ------------------------------------------------------------------------------------- isolation
function refuse(why) {
  console.error(`✗ refusing: ${why}`);
  process.exit(2);
}
if (existsSync(join(ROOT, ".env"))) refuse("a .env exists in this tree — run in an isolated worktree with no .env (the production configuration is never loaded)");
if (!existsSync(PASSWORD_FILE)) refuse("no synthetic seed password (.ui-baseline-work/owner-password) — run `node tests/ui-baseline/run.mjs prepare` first");
if (WRITE_D6 && (WRITE || REBASE || ONLY)) refuse("--write-d6 records the D-6 pass alone, every consumer: not with --write-baseline, --rebaseline or --only");
if (WRITE_C3REF && (WRITE || REBASE || ONLY || WRITE_D6)) refuse("--write-c3ref records the C3 project pass alone, both projects: not with --write-baseline, --rebaseline, --only or --write-d6");
if (WRITE_C4REF && (WRITE || REBASE || ONLY || WRITE_D6 || WRITE_C3REF)) refuse("--write-c4ref records the C4 value pass alone, every case: not with --write-baseline, --rebaseline, --only, --write-d6 or --write-c3ref");
if (WRITE_C6REF && (WRITE || REBASE || ONLY || WRITE_D6 || WRITE_C3REF || WRITE_C4REF)) refuse("--write-c6ref records the C6 Dashboard value pass alone, every case: not with --write-baseline, --rebaseline, --only, --write-d6, --write-c3ref or --write-c4ref");
if (WRITE_C7REF && (WRITE || REBASE || ONLY || WRITE_D6 || WRITE_C3REF || WRITE_C4REF || WRITE_C6REF)) refuse("--write-c7ref records the C7 heading pass alone, every page: not with --write-baseline, --rebaseline, --only or another --write-*");
if (WRITE_C8REF && (WRITE || REBASE || ONLY || WRITE_D6 || WRITE_C3REF || WRITE_C4REF || WRITE_C6REF || WRITE_C7REF)) refuse("--write-c8ref records the C8 final export pass alone, every kind and format: not with --write-baseline, --rebaseline, --only or another --write-*");
if (REBASE) {
  // A partial re-record must still see every route: the routes it keeps are compared, not copied blind.
  if (ONLY || WRITE) refuse("--rebaseline measures every route and re-records only the ones it names: not with --only or --write-baseline");
  const unknown = REBASE.filter((id) => !ROUTES.some((r) => r[0] === id));
  if (!REBASE.length || unknown.length) refuse(`--rebaseline: unknown route id(s): ${unknown.join(", ") || "(none given)"}`);
}
const env = serverEnv({ frozenNow: FROZEN_NOW, storageDir: join(ROOT, ".ui-baseline-work/storage-fake-archetypes") });
env.DATABASE_URL = dbUrl(DB); // devui010_test_only_* on a loopback host, or isolation.mjs throws
const target = new URL(env.DATABASE_URL);
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(target.hostname) || target.pathname !== `/${DB}` || !target.pathname.includes("test_only")) refuse("not the TEST-ONLY archetypes database");
if (process.env.DATABASE_URL) {
  try {
    const shell = new URL(process.env.DATABASE_URL);
    if (`${shell.hostname}:${shell.port || 5432}${shell.pathname}` === `${target.hostname}:${target.port || 5432}${target.pathname}`) refuse("the shell's DATABASE_URL is this database");
  } catch {
    /* not a URL: not this database */
  }
}

async function admin(fn) {
  const c = new pg.Client({ connectionString: adminUrl().toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

// ------------------------------------------------------------------------------------- in-page measures
const MEASURE = (literals) => {
  const vw = document.documentElement.clientWidth;
  const main = document.querySelector("main");
  if (!main) return { noMain: true, vw, dir: document.documentElement.getAttribute("dir"), lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - vw };
  const visible = (e) => {
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const inScroll = (el) => {
    for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  const off = [];
  for (const el of main.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > vw + 1 || r.left < -1) && !inScroll(el)) off.push(el);
  }
  const offenders = off.filter((e) => !off.includes(e.parentElement)).length;
  const heads = [...main.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")].filter(visible).map((h) => ({
    lv: h.getAttribute("aria-level") ? Number(h.getAttribute("aria-level")) : Number(h.tagName[1]),
    t: h.textContent.trim().replace(/\s+/g, " ").slice(0, 48),
  }));
  let skips = 0;
  for (let i = 1; i < heads.length; i++) if (heads[i].lv > heads[i - 1].lv + 1) skips++;
  const tables = [...main.querySelectorAll("table")].filter(visible);
  const tablesBeyond = tables.filter((t) => {
    let box = null;
    for (let p = t.parentElement; p && p !== main; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) { box = p; break; }
    const r = (box ?? t).getBoundingClientRect();
    return r.right > vw + 1 || r.left < -1;
  }).length;
  const tw = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let indic = 0;
  for (let n = tw.nextNode(); n; n = tw.nextNode()) if (/[٠-٩۰-۹]/.test(n.nodeValue) && n.parentElement && visible(n.parentElement)) indic++;
  const nameOf = (el) => {
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
    const lb = el.getAttribute("aria-labelledby");
    if (lb) return lb.split(" ").map((i) => document.getElementById(i)?.textContent ?? "").join(" ");
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.textContent;
    }
    const wrap = el.closest("label");
    if (wrap) return wrap.textContent;
    return el.title || "";
  };
  const ctrls = [...main.querySelectorAll("input:not([type=hidden]):not([type=file]),select,textarea,[role=textbox],[role=combobox],button,a[href]")].filter(visible);
  const unnamed = ctrls.filter((e) => (e.tagName === "BUTTON" || e.tagName === "A" ? !(nameOf(e).trim() || e.textContent.trim()) : !nameOf(e).trim())).length;
  const INTERACTIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY", "OPTION"]);
  const ROLES = new Set(["button", "link", "tab", "option", "menuitem", "checkbox", "radio", "switch", "combobox", "row", "gridcell"]);
  const OWNERS = "a,button,label,summary,[role=button],[role=link],[role=tab],[role=option],[role=menuitem]";
  let pointerOnly = 0;
  for (const el of main.querySelectorAll("*")) {
    if (INTERACTIVE.has(el.tagName) || !visible(el) || getComputedStyle(el).cursor !== "pointer") continue;
    const owner = el.closest(OWNERS);
    if (owner && owner !== el) continue;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer" && !INTERACTIVE.has(el.parentElement.tagName)) continue;
    if (el.tabIndex >= 0 && ROLES.has(el.getAttribute("role"))) continue;
    pointerOnly++;
  }
  const sn = main.querySelector(".settings-nav");
  let navAtStart = null;
  if (sn && visible(sn)) {
    const r = sn.getBoundingClientRect(), m = main.getBoundingClientRect();
    navAtStart = document.documentElement.dir === "rtl" ? m.right - r.right <= r.left - m.left : r.left - m.left <= m.right - r.right;
  }
  // C1: visible text nodes that are C1 page copy still in English (counted only in Arabic, below).
  const c1Literals = [];
  const tw2 = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  for (let n = tw2.nextNode(); n; n = tw2.nextNode()) {
    const s = n.nodeValue.replace(/\s+/g, " ").trim();
    if (!s || !n.parentElement || !visible(n.parentElement)) continue;
    const pageCopy = !n.parentElement.closest("form") && (literals.exact.includes(s) || literals.prefixes.some((p) => s.startsWith(p)));
    if (pageCopy || literals.submit.includes(s)) c1Literals.push(s);
  }
  // C1: the PageHeader — how many, whether it holds the only h1, meta before actions, the title at the
  // inline start, and where its meta / actions group sits: at the inline end of the title's line, or
  // wrapped below it at the inline start; never overlapping the title.
  const phs = [...main.querySelectorAll('[data-slot="page-header"]')].filter(visible);
  let pageHeader = null;
  if (phs.length) {
    const ph = phs[0];
    const rtl = document.documentElement.dir === "rtl";
    const box = ph.getBoundingClientRect();
    const title = ph.firstElementChild;
    const trail = ph.children[1] ?? null;
    const h1s = [...main.querySelectorAll("h1")].filter(visible);
    const meta = ph.querySelector('[data-slot="page-header-meta"]');
    const act = ph.querySelector('[data-slot="page-header-actions"]');
    const tr = title.getBoundingClientRect();
    const atStart = (r) => (rtl ? box.right - r.right : r.left - box.left) <= 1;
    const atEnd = (r) => (rtl ? r.left - box.left : box.right - r.right) <= 1;
    let trailing = "none";
    let overlap = false;
    if (trail) {
      const r = trail.getBoundingClientRect();
      const sameLine = r.top < tr.bottom - 1;
      trailing = sameLine ? (atEnd(r) ? "end" : "misplaced") : atStart(r) ? "below" : "misplaced";
      overlap = sameLine && (rtl ? r.right > tr.left + 1 : r.left < tr.right - 1);
    }
    pageHeader = {
      n: phs.length,
      h1Inside: h1s.length === 1 && title.contains(h1s[0]),
      metaFirst: !(meta && act) || Boolean(meta.compareDocumentPosition(act) & Node.DOCUMENT_POSITION_FOLLOWING),
      titleAtStart: atStart(tr),
      trailing,
      overlap,
      // C2: what the h1 and the meta slot say (the Attendance date, the Payroll month).
      title: (h1s[0]?.textContent ?? "").replace(/\s+/g, " ").trim(),
      meta: meta ? meta.textContent.replace(/\s+/g, " ").trim() : null,
    };
  }
  return {
    vw, dir: document.documentElement.getAttribute("dir"), lang: document.documentElement.lang, overflow: Math.max(0, document.documentElement.scrollWidth - vw), offenders,
    outline: heads.map((h) => `h${h.lv} ${h.t}`), h1: heads.filter((h) => h.lv === 1).length, skips, tables: tables.length, tablesBeyond, indic, unnamed, pointerOnly, navAtStart,
    c1Literals, pageHeader,
  };
};

/** Every action in <main>, outermost interactive element only: kind | name | target | type | state. */
const ACTIONS = () => {
  const main = document.querySelector("main");
  if (!main) return [];
  const visible = (e) => {
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const nameOf = (el) => {
    if (el.getAttribute("aria-label")) return norm(el.getAttribute("aria-label"));
    const lb = el.getAttribute("aria-labelledby");
    if (lb) return norm(lb.split(" ").map((i) => document.getElementById(i)?.textContent ?? "").join(" "));
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return norm(l.textContent);
    }
    return norm(el.textContent) || norm(el.title) || norm(el.querySelector("img[alt]")?.alt);
  };
  const SEL = "a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[role=radio],[role=combobox],select,input[type=checkbox],input[type=radio],input[type=submit],input[type=button]";
  const out = [];
  for (const el of main.querySelectorAll(SEL)) {
    if (!visible(el)) continue;
    const outer = el.parentElement?.closest(SEL);
    if (outer && main.contains(outer)) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const kind = role ?? (tag === "a" ? "link" : tag === "input" ? `input:${el.type}` : tag);
    let href = "";
    if (tag === "a") {
      const u = new URL(el.getAttribute("href"), location.href);
      href = u.origin === location.origin ? u.pathname + u.search + u.hash : u.href;
    }
    const type = tag === "button" ? `type=${el.getAttribute("type") ?? "submit"}` : "";
    const state = [
      el.disabled || el.getAttribute("aria-disabled") === "true" ? "disabled" : "",
      el.getAttribute("aria-haspopup") ? `popup=${el.getAttribute("aria-haspopup")}` : "",
      role === "tab" && el.getAttribute("aria-selected") === "true" ? "selected" : "",
      (role === "checkbox" || role === "switch" || el.type === "checkbox") && (el.checked || el.getAttribute("aria-checked") === "true") ? "checked" : "",
      // C2: a toggle button says so, pressed or not (the department filters).
      el.hasAttribute("aria-pressed") ? `pressed=${el.getAttribute("aria-pressed")}` : "",
      // C4: a link marked as the current page (the statement's Client / Vendor links).
      el.getAttribute("aria-current") ? `current=${el.getAttribute("aria-current")}` : "",
    ].filter(Boolean).join(",");
    out.push([kind, nameOf(el), href, type, state].join("|"));
  }
  return out.sort();
};

/**
 * C7: what the heading semantics touch — every visible heading in <main> (tag and level, words), the page title (the
 * first one) and the Tax Invoice QR panel's title with their computed style and box, the number's and the money's
 * faces, the page's text — and whether a level is skipped.
 */
const C7M = () => {
  const main = document.querySelector("main");
  if (!main) return { noMain: true };
  const visible = (e) => {
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const PROPS = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "color", "textAlign", "textWrap", "whiteSpace", "fontVariantNumeric",
    "marginTop", "marginRight", "marginBottom", "marginLeft", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "display", "alignItems",
    "justifyContent", "flexDirection", "columnGap", "rowGap", "width", "height", "boxSizing", "borderTopWidth", "borderBottomWidth"];
  const facts = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), text: norm(el.textContent), cls: el.getAttribute("class") ?? "", style: Object.fromEntries(PROPS.map((p) => [p, cs[p]])),
      box: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100) };
  };
  const heads = [...main.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")].filter(visible);
  const lv = (h) => (h.getAttribute("aria-level") ? Number(h.getAttribute("aria-level")) : Number(h.tagName[1]));
  let skips = 0;
  for (let i = 1; i < heads.length; i++) if (lv(heads[i]) > lv(heads[i - 1]) + 1) skips++;
  const money = [...main.querySelectorAll(".num-tabular")].find(visible) ?? null;
  return {
    heads: heads.map((h) => `${h.tagName.toLowerCase()} ${norm(h.textContent).slice(0, 60)}`),
    h1: heads.filter((h) => h.tagName === "H1").length,
    skips,
    title: facts(heads[0] ?? null),
    qr: facts(main.querySelector(".einvoice-panel .eh > *")),
    moneyFont: money ? getComputedStyle(money).fontFamily : null,
    text: norm(main.innerText),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

/**
 * D-6: every StatRow (.stat-row-2) in <main> — its tracks, how many cards share a line, whether a card
 * clips or leaves the viewport, the cards' widths; what each card says, its tone, its value's classes
 * and colour — and around it the status badges and the tables.
 */
const D6M = () => {
  const vw = document.documentElement.clientWidth;
  const main = document.querySelector("main");
  if (!main) return { noMain: true, overflow: null, statRows: [], badges: [], tables: [] };
  const visible = (e) => {
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  // Where a card's ink is: its text runs (not the blocks holding them) and its icons.
  const ink = (el) => {
    const out = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.nodeValue.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      out.push(...[...r.getClientRects()].filter((b) => b.width > 0));
    }
    for (const g of el.querySelectorAll("svg,img")) if (visible(g)) out.push(g.getBoundingClientRect());
    return out;
  };
  const statRows = [...main.querySelectorAll(".stat-row-2")].filter(visible).map((row) => {
    const cards = [...row.children].filter(visible);
    const boxes = cards.map((c) => c.getBoundingClientRect());
    const tops = boxes.map((b) => Math.round(b.top));
    return {
      tracks: getComputedStyle(row).gridTemplateColumns.split(" ").filter(Boolean).length,
      cards: cards.length,
      perRow: tops.filter((t) => t === tops[0]).length,
      lines: new Set(tops).size,
      // A card clips when its content is wider than the card, or any of its ink lies outside it.
      clipped: cards.filter((c, i) => c.scrollWidth > c.clientWidth + 1 || ink(c).some((b) => b.left < boxes[i].left - 0.5 || b.right > boxes[i].right + 0.5)).length,
      outside: boxes.filter((b) => b.left < -1 || b.right > vw + 1).length,
      widths: boxes.map((b) => Math.round(b.width * 10) / 10),
      height: Math.round(row.getBoundingClientRect().height * 10) / 10,
      facts: cards.map((c) => {
        const [label, value] = c.children;
        return {
          label: norm(label?.textContent),
          value: norm(value?.textContent),
          cls: value ? [...value.classList].filter((x) => x !== "kpi-value").sort().join(" ") : null,
          color: value ? getComputedStyle(value).color : null,
          tone: c.getAttribute("data-tone"),
          status: c.getAttribute("data-status"),
        };
      }),
    };
  });
  const badges = [...main.querySelectorAll(".status-tag")].filter(visible).map((b) => {
    const cs = getComputedStyle(b);
    return [b.getAttribute("data-status-domain"), b.getAttribute("data-status"), b.getAttribute("data-tone"), norm(b.textContent), cs.color, cs.backgroundColor].join("|");
  });
  const tables = [...main.querySelectorAll("table")].filter(visible).map((t) => ({
    heads: [...t.querySelectorAll("thead th")].map((th) => norm(th.textContent)),
    rows: t.querySelectorAll("tbody tr").length,
  }));
  return { overflow: Math.max(0, document.documentElement.scrollWidth - vw), statRows, badges, tables };
};

/** C2: the department filter — tag | type | name | aria-pressed | active, for each — the cards it shows, and focus. */
const DEPT_STATE = () => {
  const btns = [...document.querySelectorAll("main .tab-row > *")];
  const a = document.activeElement;
  const cs = btns.includes(a) ? getComputedStyle(a) : null;
  return {
    filters: btns.map((b) => [b.tagName.toLowerCase(), b.getAttribute("type"), b.textContent.trim(), b.getAttribute("aria-pressed"), b.classList.contains("active") ? "active" : ""].join("|")),
    cards: [...document.querySelectorAll("main .emp-grid .emp-name")].map((e) => e.textContent.trim()),
    focus: cs ? { index: btns.indexOf(a), focusVisible: a.matches(":focus-visible"), ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1 ? `${cs.outlineStyle} ${cs.outlineWidth}` : "none" } : null,
  };
};

/**
 * C2: the payroll rows (name | aria-selected | tabIndex), the focused one, the payslip's heading, and the
 * table / payslip layout — tracks, side by side or stacked, inside the viewport, and whether the table's
 * last column is reachable by scrolling its wrap to the far end.
 */
const PAYROLL_STATE = () => {
  const vw = document.documentElement.clientWidth;
  const rtl = document.documentElement.dir === "rtl";
  const rows = [...document.querySelectorAll("main tr[data-payroll-row]")];
  const a = document.activeElement;
  const two = document.querySelector("main .two-col");
  const [table, slip] = two ? [...two.children] : [];
  let layout = null;
  if (table && slip) {
    const t = table.getBoundingClientRect();
    const s = slip.getBoundingClientRect();
    const wrap = table.matches(".data-table-wrap") ? table : table.querySelector(".data-table-wrap");
    let lastColumn = null;
    if (wrap) {
      const heads = wrap.querySelectorAll("thead th");
      const before = wrap.scrollLeft;
      wrap.scrollLeft = rtl ? -wrap.scrollWidth : wrap.scrollWidth;
      const w = wrap.getBoundingClientRect();
      const l = heads[heads.length - 1].getBoundingClientRect();
      lastColumn = { scrolls: wrap.scrollWidth > wrap.clientWidth + 1, overflowX: getComputedStyle(wrap).overflowX, reachable: l.left >= Math.max(w.left, 0) - 1 && l.right <= Math.min(w.right, vw) + 1 };
      wrap.scrollLeft = before;
    }
    layout = {
      tracks: getComputedStyle(two).gridTemplateColumns.split(" ").filter(Boolean).length,
      sideBySide: Math.abs(t.top - s.top) < 1 && (rtl ? s.right <= t.left + 1 : s.left >= t.right - 1),
      stacked: s.top >= t.bottom - 1,
      inViewport: [t, s].every((r) => r.left >= -1 && r.right <= vw + 1),
      lastColumn,
    };
  }
  return {
    rows: rows.map((r) => [r.cells[0].textContent.trim(), r.getAttribute("aria-selected"), r.tabIndex].join("|")),
    focus: rows.indexOf(a),
    focusVisible: rows.includes(a) && a.matches(":focus-visible"),
    slip: slip?.firstElementChild ? slip.firstElementChild.textContent.replace(/\s+/g, " ").trim() : null,
    layout,
  };
};

/**
 * C3: the project detail's composition — the summary and Cost & Profitability rows (tracks, cards a line,
 * width, clipping; each card's label, value and the colour its value's text is drawn in), the Revenue /
 * Costs breakdown (tracks, side by side or stacked, its headings), the kanban's tracks, the health badge,
 * the registry's tone colours (probed), and the numeric columns (Amount, Hours): each cell's text-align
 * and how far its text sits from the cell's inline end and start, in the page's direction.
 */
const C3M = (numericWords) => {
  const vw = document.documentElement.clientWidth;
  const rtl = document.documentElement.dir === "rtl";
  const main = document.querySelector("main");
  if (!main) return { noMain: true };
  const visible = (e) => {
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const round = (x) => Math.round(x * 10) / 10;
  const tracks = (el) => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length;
  // The colour the first text of an element is drawn in.
  const inkOf = (el) => {
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) if (n.nodeValue.trim()) return getComputedStyle(n.parentElement).color;
    return null;
  };
  const row = (r) => {
    if (!r) return null;
    const cards = [...r.children].filter(visible);
    const boxes = cards.map((c) => c.getBoundingClientRect());
    const tops = boxes.map((b) => Math.round(b.top));
    return {
      tracks: tracks(r), cards: cards.length, perRow: tops.filter((t) => t === tops[0]).length, lines: new Set(tops).size, width: round(r.getBoundingClientRect().width),
      clipped: cards.filter((c) => c.scrollWidth > c.clientWidth + 1).length, outside: boxes.filter((b) => b.left < -1 || b.right > vw + 1).length,
      facts: cards.map((c) => {
        const [label, value] = c.children;
        return { label: norm(label?.textContent), value: norm(value?.textContent), ink: value ? inkOf(value) : null };
      }),
    };
  };
  const section = main.querySelector("section");
  const statRows = [...main.querySelectorAll(".stat-row-2")].filter(visible);
  const summary = row(statRows.find((r) => !section?.contains(r)) ?? null);
  const cost = row(section?.querySelector(".stat-row-2") ?? null);
  const bd = main.querySelector(".cost-breakdown-grid");
  let breakdown = null;
  if (bd && visible(bd)) {
    const cards = [...bd.children].filter(visible);
    const [a, b] = cards.map((c) => c.getBoundingClientRect());
    breakdown = {
      tracks: tracks(bd), cards: cards.length,
      sideBySide: Boolean(a && b) && Math.abs(a.top - b.top) < 1 && (rtl ? b.right <= a.left + 1 : b.left >= a.right - 1),
      stacked: Boolean(a && b) && b.top >= a.bottom - 1,
      inViewport: cards.every((c) => { const r = c.getBoundingClientRect(); return r.left >= -1 && r.right <= vw + 1; }),
      clipped: cards.filter((c) => c.scrollWidth > c.clientWidth + 1).length,
      widths: cards.map((c) => round(c.getBoundingClientRect().width)),
      headings: [...bd.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => `${h.tagName.toLowerCase()} ${norm(h.textContent)}`),
    };
  }
  const kb = main.querySelector(".kanban");
  const kanban = kb && visible(kb) ? { tracks: tracks(kb), columns: kb.children.length } : null;
  const badgeEl = section?.querySelector('.status-tag[data-status-domain="project_health"]');
  let badge = null;
  if (badgeEl) {
    const cs = getComputedStyle(badgeEl);
    const head = badgeEl.closest('[data-slot="section-header"]');
    badge = {
      status: badgeEl.getAttribute("data-status"), tone: badgeEl.getAttribute("data-tone"), text: norm(badgeEl.textContent), color: cs.color, background: cs.backgroundColor,
      inHeading: Boolean(badgeEl.closest("h1,h2,h3,h4,h5,h6")), beside: head ? norm(head.querySelector("h2")?.textContent) : null,
    };
  }
  // The registry's tone colours, as this page draws them.
  const probe = (cls) => {
    const s = document.createElement("span");
    s.className = cls;
    main.appendChild(s);
    const c = getComputedStyle(s).color;
    s.remove();
    return c;
  };
  const tones = { success: probe("text-success"), danger: probe("text-danger"), neutral: probe("text-neutral") };
  const align = (c) => {
    const cs = getComputedStyle(c);
    const r = c.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(c);
    const rects = [...range.getClientRects()].filter((b) => b.width > 0);
    const out = { align: cs.textAlign, cell: c.getAttribute("data-cell") };
    if (!rects.length) return out;
    const left = Math.min(...rects.map((b) => b.left));
    const right = Math.max(...rects.map((b) => b.right));
    const inL = r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
    const inR = r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    return { ...out, endGap: round(rtl ? left - inL : inR - right), startGap: round(rtl ? inR - right : left - inL) };
  };
  const numeric = [];
  // The page's own tables (Time logged this week, Linked Documents) — not the cost control's drill tables,
  // which C3 leaves as they are (their .num cells, §26).
  for (const t of [...main.querySelectorAll("table")].filter((t) => visible(t) && !t.closest("section")))
    [...t.querySelectorAll("thead th")].forEach((th, i) => {
      const col = norm(th.textContent);
      if (!numericWords.includes(col)) return;
      for (const c of [th, ...[...t.querySelectorAll("tbody tr")].map((tr) => tr.children[i]).filter(Boolean)]) numeric.push({ col, tag: c.tagName.toLowerCase(), text: norm(c.textContent), ...align(c) });
    });
  return { vw, overflow: Math.max(0, document.documentElement.scrollWidth - vw), summary, cost, breakdown, kanban, badge, tones, numeric };
};
/**
 * C8 (D-2): which of `words` the page's <main> still says — in its text (as written and as rendered) or in an accessible
 * name or tooltip (aria-label, title, alt) — compared without case (a label may be drawn in capitals).
 */
const SAYS = (words) => {
  const main = document.querySelector("main");
  if (!main) return words;
  const names = [...main.querySelectorAll("[aria-label], [title], [alt]")].flatMap((el) => [el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("alt")]);
  const said = [main.textContent, main.innerText, ...names].filter(Boolean).join("\n").toLowerCase();
  return words.filter((w) => said.includes(w.toLowerCase()));
};

/**
 * C3: the kanban's column heads and cards, compared between C2's div cards and C3's buttons. Each card:
 * its box within its column, its computed style (CARD_PROPS), and each element inside it — box within
 * the card, computed style (INNER_PROPS), text. Each column head: its height, the label's and the
 * count's boxes and type (HEAD_PROPS). `only` limits it to the card with that title (the hovered one).
 */
const KANBAN_FACTS = ([cardProps, innerProps, headProps, only]) => {
  const round = (x) => Math.round(x * 10) / 10;
  const box = (b, o) => [round(b.left - o.left), round(b.top - o.top), round(b.width), round(b.height)].join(",");
  const style = (el, props) => {
    const cs = getComputedStyle(el);
    return props.map((p) => cs.getPropertyValue(p)).join("|");
  };
  const cards = [...document.querySelectorAll("main .kanban-card")]
    .filter((el) => !only || el.querySelector(".t")?.textContent.trim() === only)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        title: el.querySelector(".t")?.textContent.trim(),
        box: box(r, el.closest(".kanban-col").getBoundingClientRect()),
        style: style(el, cardProps),
        inner: [...el.querySelectorAll("*")].map((n) => `${box(n.getBoundingClientRect(), r)}|${style(n, innerProps)}|${n.children.length ? "" : n.textContent.trim()}`),
      };
    });
  if (only) return { cards };
  const heads = [...document.querySelectorAll("main .kanban-col-head")].map((h) => {
    const hb = h.getBoundingClientRect();
    const [label, count] = h.children;
    return {
      label: label.textContent.trim(), count: count?.textContent.trim(), tag: label.tagName.toLowerCase(), height: round(hb.height),
      labelBox: box(label.getBoundingClientRect(), hb), labelStyle: style(label, headProps), countBox: count ? box(count.getBoundingClientRect(), hb) : null, countStyle: count ? style(count, headProps) : null,
    };
  });
  return { heads, cards };
};

/** C3: the kanban by keyboard — where focus is (a card: which, its name, ring), the dialog, the board. */
const KANBAN_STATE = () => {
  const a = document.activeElement;
  const cards = [...document.querySelectorAll("main .kanban-card")];
  const dlg = document.querySelector('[role="dialog"]');
  const probe = document.createElement("span");
  probe.style.color = "var(--focus)";
  document.body.appendChild(probe);
  const focusColor = getComputedStyle(probe).color;
  probe.remove();
  let focus = null;
  if (a && a !== document.body) {
    const cs = getComputedStyle(a);
    focus = {
      card: cards.indexOf(a), taskId: a.getAttribute("data-task-id"), tag: a.tagName.toLowerCase(), type: a.getAttribute("type"), name: a.getAttribute("aria-label") ?? a.textContent.trim().slice(0, 60),
      same: Boolean(window.__opener) && a === window.__opener, focusVisible: a.matches(":focus-visible"),
      ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1 ? { style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset, token: cs.outlineColor === focusColor } : null,
    };
  }
  const o = window.__opener;
  return {
    focus,
    opener: o ? { taskId: o.getAttribute("data-task-id"), title: o.querySelector(".t")?.textContent.trim() ?? null, text: o.textContent.trim().slice(0, 60) } : null,
    dialog: dlg ? { title: dlg.querySelector("h2")?.textContent.trim(), taskTitle: dlg.querySelector("#task-title")?.value ?? null, status: dlg.querySelector("#task-status")?.textContent.trim() ?? null } : null,
    board: [...document.querySelectorAll("main .kanban-col")].map((c) => [...c.querySelectorAll(".kanban-card")].map((k) => k.getAttribute("data-task-id") ?? k.querySelector(".t")?.textContent.trim()).join(",")),
    names: cards.map((c) => [c.getAttribute("data-task-id"), c.tagName.toLowerCase(), c.getAttribute("type"), c.getAttribute("aria-label"), c.hasAttribute("draggable")].join("|")),
  };
};

/** C3: the empty project's Tasks section — its h2, Add Task beside it, the EmptyState, no board — and the page's overflow. */
const EMPTY_FACTS = (W) => {
  const main = document.querySelector("main");
  const vw = document.documentElement.clientWidth;
  const visible = (e) => {
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const h2 = [...main.querySelectorAll("h2")].find((h) => h.textContent.trim() === W.tasks);
  const head = h2?.closest('[data-slot="section-header"]');
  const add = head ? [...head.querySelectorAll("button")].find((b) => b.textContent.trim() === W.addTask) : null;
  const empty = [...main.querySelectorAll('[data-slot="empty-state"]')].find((e) => e.textContent.trim() === W.noTasks);
  return {
    tasksH2: Boolean(h2 && visible(h2)), addTask: Boolean(add && visible(add) && !add.disabled), emptyState: Boolean(empty && visible(empty)),
    emptyAfterHead: Boolean(head && empty && head.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING),
    kanban: main.querySelectorAll(".kanban, .kanban-col, .kanban-card").length, overflow: Math.max(0, document.documentElement.scrollWidth - vw),
  };
};

/**
 * C4: Ledger / Chart of Accounts' account grid — its tracks, the two panes and whether they sit side by side
 * or stacked, inside the viewport; the selected row; the ledger table's own scroll container and, scrolled
 * to its end, whether its last column shows inside it; Add Account inside the viewport and hit-testable.
 */
const LEDGER_FACTS = (addLabel) => {
  const vw = document.documentElement.clientWidth;
  const rtl = document.documentElement.dir === "rtl";
  const grid = document.querySelector("main .acct-grid");
  if (!grid) return null;
  const box = (e) => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
  };
  const inView = (b) => Boolean(b) && b.left >= -1 && b.right <= vw + 1;
  const tracks = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean);
  const [list, detail] = grid.children;
  const lb = box(list);
  const db = box(detail);
  const sel = list?.querySelector(".acct-row.selected");
  const table = detail?.querySelector("table");
  let scroller = null;
  for (let p = table?.parentElement; p && p !== detail; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) { scroller = p; break; }
  let scroll = null;
  if (scroller) {
    const sb = box(scroller);
    const sizes = { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth };
    scroller.scrollLeft = rtl ? -scroller.scrollWidth : scroller.scrollWidth;
    const heads = table.querySelectorAll("thead th");
    const last = box(heads[heads.length - 1]);
    scroll = { ...sizes, inView: inView(sb), lastReachable: Boolean(last) && last.left >= sb.left - 1 && last.right <= sb.right + 1 };
    scroller.scrollLeft = 0;
  }
  const add = [...(list?.querySelectorAll("button") ?? [])].find((b) => b.textContent.replace(/\s+/g, " ").trim() === addLabel);
  let addFacts = null;
  if (add) {
    add.scrollIntoView({ block: "center", inline: "nearest" });
    const ab = box(add);
    const hit = document.elementFromPoint((ab.left + ab.right) / 2, (ab.top + ab.bottom) / 2);
    addFacts = { inView: inView(ab), hit: Boolean(hit && (hit === add || add.contains(hit))), disabled: add.disabled };
    window.scrollTo(0, 0);
  }
  return {
    tracks: tracks.length, first: tracks[0] ?? null, listIn: inView(lb), detailIn: inView(db),
    sideBySide: Boolean(lb && db) && Math.abs(lb.top - db.top) <= 1 && (rtl ? db.right <= lb.left + 1 : db.left >= lb.right - 1),
    stacked: Boolean(lb && db) && db.top >= lb.bottom - 1,
    selected: sel ? { code: sel.querySelector(".code")?.textContent.trim(), name: sel.querySelector(".nm")?.textContent.replace(/\s+/g, " ").trim() } : null,
    table: Boolean(table), scroll, add: addFacts,
  };
};

/**
 * C4: what a report says — the picker (labels, the one shown active), the presets, the range and the compare
 * toggle; the title block above the body; the body itself: every line, every figure, its rows, its summary
 * cards and its drill targets (each with its row's label); the export links. Read the same on C3's build.
 */
const REPORT_FACTS = () => {
  const main = document.querySelector("main");
  const area = main?.querySelector(".reports-print-area");
  if (!area) return null;
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const lines = (el) => (el?.innerText ?? "").split("\n").map(norm).filter(Boolean);
  const body = area.querySelector(":scope > .card:not(.no-print)");
  const filter = area.querySelector(":scope > .card.no-print");
  return {
    picker: [...area.querySelectorAll(":scope > .tab-row button")].map((b) => `${norm(b.textContent)}${b.classList.contains("active") ? " (active)" : ""}`),
    presets: [...(filter?.querySelectorAll("button.doc-pill-btn") ?? [])].map((b) => `${norm(b.textContent)}${b.classList.contains("active") ? " (active)" : ""}`),
    dates: [...(filter?.querySelectorAll('input[type="date"]') ?? [])].map((i) => i.value),
    compare: filter?.querySelector('[role="checkbox"]')?.getAttribute("aria-checked") ?? null,
    title: lines(body?.previousElementSibling),
    body: lines(body),
    figures: (body?.innerText ?? "").match(/[-−]?\(?\d[\d,]*(?:\.\d+)?\)?%?/g) ?? [],
    rows: body ? [body.querySelectorAll(".payslip-line").length, body.querySelectorAll("tbody tr").length, body.querySelectorAll("table").length] : null,
    cards: [...(body?.querySelectorAll(".card") ?? [])].map((c) => lines(c).join(" / ")),
    drills: [...(body?.querySelectorAll("button") ?? [])].map((b) => `${norm(b.closest(".payslip-line, tr")?.firstElementChild?.textContent)} → ${norm(b.textContent)}`),
    exports: [...main.querySelectorAll('a[href^="/finance/reports/export"]')].map((a) => `${norm(a.textContent)} ${a.getAttribute("href")}`),
  };
};

/**
 * C8 final: what the report shows in print media — the report card's lines as the printed page carries them (innerText
 * leaves out what CSS hides), its title, its notes and whether any app chrome or workspace control still shows.
 */
const PRINT_FACTS = () => {
  const area = document.querySelector("main .reports-print-area");
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const lines = (el) => (el?.innerText ?? "").split("\n").map(norm).filter(Boolean);
  const shown = (el) => {
    if (!el || getComputedStyle(el).visibility !== "visible") return false;
    for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).display === "none") return false;
    return true;
  };
  const body = area?.querySelector(":scope > .card:not(.no-print)");
  // An element with text of its own that the printed page would carry from outside the report area (the app shell) or
  // from the workspace controls inside it (.no-print): there must be none.
  const stray = [...document.querySelectorAll("body *")].filter((e) => (!area || !area.contains(e) || e.closest(".no-print")) && shown(e) &&
    [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  return {
    area: shown(area), title: lines(body?.previousElementSibling), body: lines(body),
    notes: [...(body?.querySelectorAll('[role="note"]') ?? [])].map((n) => ({ shown: shown(n), text: norm(n.innerText) })),
    stray: stray.length, straySample: stray.slice(0, 3).map((e) => `${e.tagName.toLowerCase()} ${norm(e.textContent).slice(0, 40)}`),
  };
};

/**
 * C8 final: an export as text — CSV and Excel (HTML) as sent; the PDF read back through pdf-lib (its own text operators):
 * per page its text runs, each at its position and size, as lines top to bottom and cells left to right ("a | b | c");
 * which run would pass the right margin, and which carries the exporter's clip mark ("...").
 */
const exportFonts = (async () => {
  const d = await PDFDocument.create();
  return { regular: await d.embedFont(StandardFonts.Helvetica), bold: await d.embedFont(StandardFonts.HelveticaBold) };
})();
async function exportFacts(format, bytes) {
  if (format !== "pdf") return { text: bytes.toString("utf8") };
  const fonts = await exportFonts;
  let doc;
  try {
    doc = await PDFDocument.load(bytes);
  } catch {
    return { pages: null, lines: [], overflow: [], clipped: [] };
  }
  const lines = [], overflow = [], clipped = [];
  doc.getPages().forEach((page) => {
    const c = page.node.Contents();
    const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
    const ops = streams.map((st) => Buffer.from(st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : st.getContents()).toString("latin1")).join("\n");
    const runs = [];
    let size = 0, bold = false, x = 0, y = 0;
    for (const m of ops.matchAll(/\/(\S+) ([\d.]+) Tf|1 0 0 1 ([\d.-]+) ([\d.-]+) Tm|<([0-9A-Fa-f]*)> Tj/g)) {
      if (m[1]) [bold, size] = [/Bold/.test(m[1]), Number(m[2])];
      else if (m[3]) [x, y] = [Number(m[3]), Number(m[4])];
      else runs.push({ x, y, size, bold, text: Buffer.from(m[5], "hex").toString("latin1") });
    }
    const byY = new Map();
    for (const r of runs) byY.set(r.y, [...(byY.get(r.y) ?? []), r]);
    for (const yy of [...byY.keys()].sort((a, b) => b - a)) lines.push(byY.get(yy).sort((a, b) => a.x - b.x).map((r) => r.text).join(" | "));
    for (const r of runs) {
      if (r.x + (r.bold ? fonts.bold : fonts.regular).widthOfTextAtSize(r.text, r.size) > page.getWidth() - 36 + 0.01) overflow.push(r.text);
      if (r.text.endsWith("...")) clipped.push(r.text);
    }
  });
  return { pages: doc.getPageCount(), lines, overflow, clipped };
}

/** C4: what a statement says — the Client / Vendor links; every line, input, select and table row of the statement view under them. */
const STATEMENT_FACTS = () => {
  const main = document.querySelector("main");
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const row = [...(main?.querySelectorAll(".tab-row") ?? [])].find((r) => r.querySelector(":scope > a.tab"));
  if (!row) return null;
  const view = row.nextElementSibling;
  return {
    tabs: [...row.querySelectorAll(":scope > a")].map((a) => `${norm(a.textContent)} ${a.getAttribute("href")}${a.classList.contains("active") ? " (active)" : ""}`),
    lines: (view?.innerText ?? "").split("\n").map(norm).filter(Boolean),
    tables: [...(view?.querySelectorAll("table") ?? [])].map((t) => [...t.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => norm(c.textContent)).join(" | "))),
    inputs: [...(view?.querySelectorAll("input") ?? [])].map((i) => `${i.type}=${i.value}`),
    selects: [...(view?.querySelectorAll('[role="combobox"]') ?? [])].map((b) => norm(b.textContent)),
  };
};

/** C4: the report picker as a keyboard user meets it — each toggle's label, aria-pressed and .active; focus; the h2; the exports; the URL. */
const PICKER_STATE = () => {
  const main = document.querySelector("main");
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const buttons = [...(main?.querySelectorAll(".reports-print-area > .tab-row button") ?? [])];
  const a = document.activeElement;
  return {
    url: location.pathname + location.search,
    buttons: buttons.map((b) => ({ label: norm(b.textContent), pressed: b.getAttribute("aria-pressed"), active: b.classList.contains("active"), type: b.getAttribute("type") })),
    focus: buttons.indexOf(a), focusVisible: Boolean(a && a.matches(":focus-visible")),
    h2: norm(main?.querySelector(".reports-print-area h2")?.textContent), h2s: main ? main.querySelectorAll("h2").length : 0,
    exports: [...(main?.querySelectorAll('a[href^="/finance/reports/export"]') ?? [])].map((x) => x.getAttribute("href")),
  };
};

/** C4: the statement's Client / Vendor links — label, target, aria-current, .active; focus; the h1; the URL. */
const STMT_LINKS = () => {
  const main = document.querySelector("main");
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const row = [...(main?.querySelectorAll(".tab-row") ?? [])].find((r) => r.querySelector(":scope > a.tab"));
  const links = row ? [...row.querySelectorAll(":scope > a")] : [];
  const a = document.activeElement;
  return {
    url: location.pathname + location.search,
    links: links.map((l) => ({ label: norm(l.textContent), href: l.getAttribute("href"), current: l.getAttribute("aria-current"), active: l.classList.contains("active") })),
    focus: links.indexOf(a), focusVisible: Boolean(a && a.matches(":focus-visible")),
    h1: norm(main?.querySelector("h1")?.textContent),
  };
};

/** C4: every EmptyState in <main> — its text, whether it shows and sits inside the viewport, and the heading it follows. */
const FIN_EMPTY = () => {
  const vw = document.documentElement.clientWidth;
  const main = document.querySelector("main");
  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const heads = [...(main?.querySelectorAll("h1, h2, h3") ?? [])];
  return [...(main?.querySelectorAll('[data-slot="empty-state"]') ?? [])].map((e) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    const before = heads.filter((h) => h.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
    return {
      text: norm(e.textContent), visible: cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0, inView: r.left >= -1 && r.right <= vw + 1,
      after: before ? `${before.tagName.toLowerCase()} ${norm(before.textContent)}` : null,
      controls: e.querySelectorAll("a, button, [role=button]").length,
    };
  });
};

/**
 * C5: Business Settings' navigation and the panel beside or below it — the Radix root's dir and flex
 * direction, the boxes (navigation at the inline start; the panel after it, or below it), the items'
 * alignment and direction, the tabs in order with their labels and the group labels, which is active.
 */
const SETTINGS_FACTS = () => {
  const main = document.querySelector("main");
  const list = main?.querySelector('[role="tablist"].settings-nav');
  if (!list) return null;
  const root = list.parentElement;
  // Radix keeps every panel's element, the inactive ones hidden: the one shown is the active one.
  const panel = main.querySelector('[role="tabpanel"][data-state="active"]');
  const vw = document.documentElement.clientWidth;
  const rtl = document.documentElement.dir === "rtl";
  const r1 = (n) => Math.round(n * 10) / 10;
  const lr = list.getBoundingClientRect();
  const pr = panel?.getBoundingClientRect() ?? null;
  const rr = root.getBoundingClientRect();
  const items = [...list.querySelectorAll('[role="tab"]')];
  const value = (e) => e?.id?.split("-trigger-")[1] ?? null;
  return {
    rootDir: root.getAttribute("dir"), flexDirection: getComputedStyle(root).flexDirection, orientation: list.getAttribute("aria-orientation"),
    rootWidth: r1(rr.width), navWidth: r1(lr.width), panelWidth: pr ? r1(pr.width) : null,
    stacked: pr ? lr.bottom <= pr.top + 0.5 : null,
    beside: pr ? lr.top < pr.bottom && pr.top < lr.bottom : null,
    navAtStart: rtl ? Math.abs(rr.right - lr.right) <= 1 : Math.abs(lr.left - rr.left) <= 1,
    panelAfter: pr ? (rtl ? pr.right <= lr.left + 1 : pr.left >= lr.right - 1) : null,
    navInView: lr.left >= -1 && lr.right <= vw + 1, panelInView: pr ? pr.left >= -1 && pr.right <= vw + 1 : null,
    align: [...new Set(items.map((i) => getComputedStyle(i).textAlign))], itemDir: [...new Set(items.map((i) => getComputedStyle(i).direction))],
    order: items.map(value), labels: items.map((i) => i.textContent.replace(/\s+/g, " ").trim()),
    groups: [...list.querySelectorAll(".settings-nav-group-label")].map((e) => e.textContent.replace(/\s+/g, " ").trim()),
    active: items.filter((i) => i.getAttribute("data-state") === "active").map(value), panel: panel?.id?.split("-content-")[1] ?? null,
  };
};
/** C5: the Security Center's alerts (each one's stripe — the inline-start border — by its title) and the risk pill. */
const SECURITY_FACTS = () => {
  const main = document.querySelector("main");
  const ph = main?.querySelector('[data-slot="page-header"]');
  const meta = ph?.querySelector('[data-slot="page-header-meta"]');
  const alerts = [...(main?.querySelectorAll("div.rounded-xl") ?? [])].filter((e) => e.querySelector("svg") && (e.style.borderInlineStart || e.style.borderLeft || e.style.borderRight)).map((e) => {
    const cs = getComputedStyle(e);
    return {
      title: e.querySelector(".font-semibold")?.textContent.trim() ?? null, dir: cs.direction,
      left: `${cs.borderLeftWidth} ${cs.borderLeftColor}`, right: `${cs.borderRightWidth} ${cs.borderRightColor}`,
      inline: e.style.borderInlineStart, physical: e.style.borderLeft || e.style.borderRight || null,
    };
  });
  const h1 = main?.querySelector("h1");
  const root = getComputedStyle(document.documentElement);
  return {
    alerts, risk: meta ? meta.textContent.replace(/\s+/g, " ").trim() : null, riskInH1: Boolean(h1 && meta && h1.contains(meta)),
    tokens: { warn: root.getPropertyValue("--warn").trim(), crit: root.getPropertyValue("--crit").trim() },
    line: (() => {
      // The card's own border (border border-line), on a probe with the same classes.
      const probe = document.createElement("div");
      probe.className = "border border-line";
      main.append(probe);
      const c = getComputedStyle(probe).borderTopColor;
      probe.remove();
      return c;
    })(),
    warn: (() => {
      const probe = document.createElement("div");
      probe.style.color = "var(--warn)";
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    })(),
  };
};
/**
 * C5: the Security Center at one width — the PageHeader and its risk meta, the Two-Factor Authentication and
 * Password cards (the first two h2s) with their controls and the two password fields, the tables (inside the
 * viewport, or scrolling inside their own box) and the Timeline's EmptyState: each inside the viewport. And
 * the current-password field takes the focus.
 */
const SECURITY_LAYOUT = () => {
  const main = document.querySelector("main");
  const vw = document.documentElement.clientWidth;
  const inView = (e) => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= vw + 1;
  };
  const boxOf = (t) => {
    for (let p = t.parentElement; p && p !== main; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return p;
    return t;
  };
  const h2s = [...main.querySelectorAll("h2")];
  const mfa = h2s[0]?.closest(".card") ?? null;
  const pw = h2s[1]?.closest(".card") ?? null;
  const ph = main.querySelector('[data-slot="page-header"]');
  const cur = main.querySelector("#cur-pw");
  cur?.focus();
  return {
    h2: h2s.map((h) => h.textContent.replace(/\s+/g, " ").trim()), header: inView(ph), meta: inView(ph?.querySelector('[data-slot="page-header-meta"]')),
    mfa: inView(mfa), mfaControls: [...(mfa?.querySelectorAll("button") ?? [])].map(inView), password: inView(pw), passwordControls: [...(pw?.querySelectorAll("button") ?? [])].map(inView),
    fields: [inView(cur), inView(main.querySelector("#new-pw"))], focus: document.activeElement?.id ?? null,
    tables: [...main.querySelectorAll("table")].map((t) => inView(boxOf(t))), timeline: inView(main.querySelector('[data-slot="empty-state"]')),
  };
};
/**
 * C5: Compliance's controls — each inside the viewport (Export, the customer select and Erase, the consent
 * subject, Grant, Withdraw) — and its tables: inside the viewport, or scrolling inside their own box.
 */
const COMPLIANCE_FACTS = (W) => {
  const main = document.querySelector("main");
  const vw = document.documentElement.clientWidth;
  const inView = (e) => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= vw + 1;
  };
  const byText = (txt) => [...main.querySelectorAll("button")].find((b) => b.textContent.replace(/\s+/g, " ").trim() === txt) ?? null;
  const tables = [...main.querySelectorAll("table")].map((t) => {
    let box = null;
    for (let p = t.parentElement; p && p !== main; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) { box = p; break; }
    const r = (box ?? t).getBoundingClientRect();
    return { rows: t.tBodies[0]?.rows.length ?? 0, scrolls: Boolean(box && box.scrollWidth > box.clientWidth + 1), contained: r.left >= -1 && r.right <= vw + 1 };
  });
  return {
    exportBtn: inView(byText(W.export)), customer: inView(main.querySelector("#erase-customer")), erase: inView(byText(W.erase)),
    subject: inView(main.querySelector("#consent-subject")), grant: inView(byText(W.grant)), withdraw: inView(byText(W.withdraw)), tables,
  };
};

/**
 * C6: the Dashboard as laid out and what it says — the grid's tracks; each widget's name (a KPI card's label,
 * else its heading), track span, box and whether its card clips its content (across or down) or sits outside
 * the grid or the viewport, and any inline grid placement; each KPI card's value, trend and sparkline;
 * Financial Overview's total and chart (bars, the revenue line and points, any expense line or points, its
 * labels) and anything else drawn in it; Cash Flow's figures and any sparkline; the recent activities;
 * the feature strip; the PageHeader's actions; and every phrase in W.gone found in <main>'s text or
 * accessible names, hidden or not.
 */
const DASH_FACTS = (W) => {
  const main = document.querySelector("main");
  const grid = main?.querySelector(".dash-grid");
  if (!grid) return null;
  const vw = document.documentElement.clientWidth;
  const text = (e) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();
  const r1 = (n) => Math.round(n * 10) / 10;
  const gcs = getComputedStyle(grid);
  const tracks = gcs.gridTemplateColumns.split(" ").map(parseFloat).filter((n) => !Number.isNaN(n));
  const gap = parseFloat(gcs.columnGap) || 0;
  const g = grid.getBoundingClientRect();
  const sparks = (el) => (el ? el.querySelectorAll('svg linearGradient[id^="spark-"]').length : null);
  const widgets = [...grid.children].map((w) => {
    const r = w.getBoundingClientRect();
    const card = w.firstElementChild;
    const kpi = w.querySelector(".kpi-card-v4");
    const ws = getComputedStyle(w);
    return {
      name: kpi ? text(kpi.querySelector(".kpi-label")) : text(w.querySelector("h1, h2, h3, h4, h5, h6")),
      wide: w.hasAttribute("data-wide"), span: tracks.length ? Math.round((r.width + gap) / (tracks[0] + gap)) : null, width: r1(r.width), height: r1(r.height),
      clipX: card ? card.scrollWidth > card.clientWidth + 1 : null, clipY: card ? card.scrollHeight > card.clientHeight + 1 : null,
      inGrid: r.left >= g.left - 1 && r.right <= g.right + 1, inView: r.left >= -1 && r.right <= vw + 1,
      inline: Boolean(w.style.gridColumn || w.style.gridRow), vars: [w.style.getPropertyValue("--dash-span"), w.style.getPropertyValue("--dash-rows")],
      // How the widget is placed in rows, as computed: `span <rows>` (desktop) or auto (natural rows).
      row: [ws.gridRowStart, ws.gridRowEnd],
    };
  });
  const kpis = [...main.querySelectorAll(".kpi-card-v4")].map((c) => ({
    label: text(c.querySelector(".kpi-label")), value: text(c.querySelector(".kpi-value")),
    trend: c.querySelector(".kpi-trend") ? text(c.querySelector(".kpi-trend")) : null, sparks: sparks(c), sparkBox: c.querySelectorAll(".kpi-spark").length,
  }));
  const finCard = main.querySelector(".fin-card");
  const chart = finCard ? [...finCard.querySelectorAll("svg")].find((v) => v.querySelector("rect")) ?? null : null;
  const fin = finCard && {
    label: text(finCard.querySelector(".fin-total-label")), value: text(finCard.querySelector(".fin-total-value")), pill: text(finCard.querySelector(".select-pill")),
    // Money's currency mark (an svg for the riyal) is the figure's, not a drawing: left out.
    svgs: [...finCard.querySelectorAll("svg")].filter((v) => !v.closest(".num-tabular")).length, donuts: finCard.querySelectorAll("svg circle[stroke-dasharray]").length,
    legends: finCard.querySelectorAll(".fin-legend, .donut-legend-row").length,
    chart: chart && {
      bars: chart.querySelectorAll("rect").length, revenueLine: chart.querySelectorAll('path[stroke="var(--brand-orange)"]').length,
      expenseLine: chart.querySelectorAll('path[stroke="var(--chart-navy)"]').length, revenueDots: chart.querySelectorAll('circle[fill="var(--brand-orange)"]').length,
      expenseDots: chart.querySelectorAll('circle[fill="var(--chart-navy)"]').length, labels: chart.querySelectorAll("text").length,
      width: r1(chart.getBoundingClientRect().width), direction: getComputedStyle(chart).direction,
    },
  };
  const cardOf = (title) => [...main.querySelectorAll(".bottom-card")].find((c) => text(c.querySelector("h1, h2, h3, h4, h5, h6")).startsWith(title)) ?? null;
  const cash = cardOf(W.cash);
  const act = main.querySelector('[data-slot="page-header"] [data-slot="page-header-actions"]');
  const strip = main.querySelector(".feature-strip");
  const hay = [main.textContent ?? "", ...[...main.querySelectorAll("[aria-label], [title], [alt]")].map((e) => ["aria-label", "title", "alt"].map((a) => e.getAttribute(a) ?? "").join(" "))].join("\n");
  return {
    tracks, gap, gridWidth: r1(g.width), autoRows: gcs.gridAutoRows, widgets, kpis, fin,
    cash: cash && { title: text(cash.querySelector("h1, h2, h3, h4, h5, h6")), rows: [...cash.querySelectorAll(".bc-stat-row")].map((r) => text(r)), sparks: sparks(cash) },
    activity: [...main.querySelectorAll(".activity-row")].map((r) => ({ text: text(r.querySelector(".activity-text")), time: text(r.querySelector(".activity-time")) })),
    strip: strip && { cards: [...strip.querySelectorAll(".feature-card")].map((c) => [text(c.querySelector(".f-title")), text(c.querySelector(".f-sub"))]), inView: strip.getBoundingClientRect().right <= vw + 1 },
    header: {
      range: act ? text(act.querySelector('[aria-haspopup="menu"]')) : null,
      customize: act ? [...act.querySelectorAll("button")].some((b) => text(b) === W.customize) : false,
      controlsOutside: [...main.querySelectorAll('[aria-haspopup="menu"], button')].filter((b) => (text(b) === W.customize || b.getAttribute("aria-haspopup") === "menu") && !act?.contains(b)).length,
    },
    gone: W.gone.filter((p) => hay.includes(p)),
  };
};
/**
 * C6: every factual value the Dashboard shows, read the same way from C5's markup and C6's — the KPI cards
 * (value, trend, sparkline path), the revenue chart (bars, line, points, labels), the total revenue (C5: its
 * donut legend row; C6: the Financial Overview total), the range label, Cash Flow, the invoice statuses
 * and total, projects, HR, the activities (and, apart, their times), every link, the data-quality notice
 * and the ZATCA card.
 */
const DASH_VALUES = (W) => {
  const main = document.querySelector("main");
  const text = (e) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();
  const kpis = Object.fromEntries([...main.querySelectorAll(".kpi-card-v4")].map((c) => [text(c.querySelector(".kpi-label")), {
    value: text(c.querySelector(".kpi-value")), trend: c.querySelector(".kpi-trend") ? text(c.querySelector(".kpi-trend")) : null,
    spark: [...c.querySelectorAll(".kpi-spark svg path")].map((p) => p.getAttribute("d")),
  }]));
  const finCard = main.querySelector(".fin-card");
  const chart = finCard ? [...finCard.querySelectorAll("svg")].find((v) => v.querySelector("rect")) ?? null : null;
  const legendTotal = finCard ? [...finCard.querySelectorAll(".donut-legend-row")].find((r) => text(r.querySelector(".lbl")) === W.totalRevenue) : null;
  const cardOf = (title) => [...main.querySelectorAll(".bottom-card")].find((c) => text(c.querySelector("h1, h2, h3, h4, h5, h6")).startsWith(title)) ?? null;
  const rows = (c) => (c ? [...c.querySelectorAll(".bc-stat-row")].map((r) => `${text(r.querySelector(".lbl"))} = ${text(r.querySelector(".val"))}`) : null);
  const [cash, inv, proj, hr] = [W.cash, W.invoices, W.projects, W.hr].map(cardOf);
  return {
    kpis,
    chart: chart && {
      viewBox: chart.getAttribute("viewBox"), bars: [...chart.querySelectorAll("rect")].map((r) => ["x", "y", "width", "height"].map((a) => r.getAttribute(a)).join(",")),
      revenue: chart.querySelector('path[stroke="var(--brand-orange)"]')?.getAttribute("d") ?? null,
      points: [...chart.querySelectorAll('circle[fill="var(--brand-orange)"]')].map((c) => `${c.getAttribute("cx")},${c.getAttribute("cy")}`),
      labels: [...chart.querySelectorAll("text")].map((t) => t.textContent),
    },
    totalRevenue: finCard ? text(finCard.querySelector(".fin-total-value")) || text(legendTotal?.querySelector(".val")) || null : null,
    range: text(finCard?.querySelector(".select-pill")) || null,
    cashTitle: text(cash?.querySelector("h1, h2, h3, h4, h5, h6")) || null, cash: rows(cash),
    invoices: rows(inv), invoicesDonut: inv ? [...inv.querySelectorAll("svg text")].map((t) => t.textContent) : null,
    projects: rows(proj), projectsBig: text(proj?.querySelector(".bc-bignum")) || null, hr: rows(hr), hrBig: text(hr?.querySelector(".bc-bignum")) || null,
    activity: [...main.querySelectorAll(".activity-row")].map((r) => text(r.querySelector(".activity-text"))),
    activityTimes: [...main.querySelectorAll(".activity-time")].map((e) => text(e)),
    links: [...main.querySelectorAll("a[href]")].map((a) => `${a.getAttribute("href")} ${text(a)}`),
    banner: text(main.querySelector('[data-testid="base-data-quality"]')) || null,
    zatca: [...main.querySelectorAll(".feature-card .f-title")].map((e) => text(e)).filter((t) => t === W.zatca).length,
  };
};

// ------------------------------------------------------------------------------------- run
const pinned = WRITE ? null : JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
const pinnedActions = WRITE ? null : JSON.parse(readFileSync(ACTIONS_FILE, "utf8"));

console.log(`• database: ${describe(env.DATABASE_URL)} (TEST-ONLY, fresh copy of ${TEMPLATE_DB})`);
await admin(async (c) => {
  await c.query(`drop database if exists ${DB} with (force)`);
  await c.query(`create database ${DB} template ${TEMPLATE_DB}`);
  await c.query(`comment on database ${DB} is 'DEV-UI-01.7 TEST-ONLY page-archetype runtime database. Synthetic data only.'`);
});
let deptDb = null;
let projDb = null;
let finDb = null;
let c6Seed = null;
{
  // A Staff member for the permission pass (this run's copy only, never the template).
  const c = new pg.Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  await c.query(`insert into users (org_id, name, email, password_hash, role) select org_id, 'Baseline Staff', $1, password_hash, 'staff' from users where email = $2`, [STAFF_EMAIL, OWNER_EMAIL]);
  // C2: what the department filter must show, read from this copy: the owner's departments by name, and
  // every employee by name (the page's order) with their department.
  const org = (await c.query("select org_id from users where email = $1", [OWNER_EMAIL])).rows[0].org_id;
  deptDb = {
    depts: (await c.query("select id, name from departments where org_id = $1 order by name asc", [org])).rows,
    emps: (await c.query("select name, department_id from employees where org_id = $1 order by name asc", [org])).rows,
  };
  // C3: the two seeded projects' names, the populated one's tasks (title, status, priority, assignee) and
  // the empty one's task count — what the outline, the cards' names and the empty kanban must show.
  projDb = {
    org,
    names: Object.fromEntries((await c.query("select id, name from projects where org_id = $1 and id in (1, 2)", [org])).rows.map((r) => [r.id === 1 ? "project-detail" : "project-empty", r.name])),
    tasks: (await c.query("select t.id, t.title, t.status, t.priority, e.name as assignee from tasks t left join employees e on e.id = t.assignee_id where t.org_id = $1 and t.project_id = 1 order by t.id", [org])).rows,
    emptyTasks: (await c.query("select count(*)::int as n from tasks where org_id = $1 and project_id = 2", [org])).rows[0].n,
  };
  // C4: the seed's first account by code (the ledger opens on it) and account 1 — the Cash account whose
  // General Ledger the value pass reads.
  finDb = {
    first: (await c.query("select id, code, name from accounts where org_id = $1 order by code limit 1", [org])).rows[0],
    account1: (await c.query("select code, name from accounts where org_id = $1 and id = 1", [org])).rows[0] ?? null,
  };
  // C6: the seeded org's country — where ZATCA Phase 1 applies, the strip's one card shows.
  c6Seed = { country: (await c.query("select country from orgs where id = $1", [org])).rows[0]?.country ?? null };
  await c.end();
}
/** Every task of the populated project as the database holds it — what opening and closing must not change. */
async function taskRows() {
  const c = new pg.Client({ connectionString: env.DATABASE_URL });
  await c.connect();
  try {
    return (await c.query("select id, title, description, assignee_id, status, priority, due_date::text from tasks where org_id = $1 and project_id = 1 order by id", [projDb.org])).rows;
  } finally {
    await c.end();
  }
}
if (!args.includes("--skip-build")) {
  console.log("• building (test environment)…");
  const b = spawnSync("npm", ["run", "build"], { env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (b.status !== 0) refuse(`build failed\n${(b.stdout ?? "").slice(-3000)}${(b.stderr ?? "").slice(-3000)}`);
}
if (!existsSync(".next/BUILD_ID")) refuse("no build (.next/BUILD_ID)");
try {
  await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(2000) });
  refuse(`something is already listening on ${BASE}`);
} catch {
  /* free */
}
mkdirSync(env.STORAGE_FAKE_DIR, { recursive: true });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
  env: { ...env, NODE_OPTIONS: `--require ${join(ROOT, "tests/ui-baseline/freeze-time.cjs")}` },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
async function stop() {
  for (const sig of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-server.pid, sig);
    } catch {
      return; // gone
    }
    for (let i = 0; i < 40; i++) {
      try {
        process.kill(server.pid, 0);
      } catch {
        return;
      }
      await sleep(250);
    }
  }
}
let up = false;
for (let i = 0; i < 90 && !up; i++) {
  try {
    up = (await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(3000) })).status < 500;
  } catch {
    if (server.exitCode !== null) break;
    await sleep(1000);
  }
}
if (!up) {
  await stop();
  refuse(`server did not answer:\n${serverLog.slice(-2000)}`);
}
await assertFreshBuild(BASE).catch(async (e) => {
  await stop();
  refuse(e.message);
});
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
console.log(`• server ${BASE} (loopback), build ${buildId}, clock frozen at ${FROZEN_NOW}`);

// Loopback only: every request that is not to a loopback address goes to a proxy that does not
// exist (port 9, discard) and fails; loopback bypasses it. Counted below. (Request interception
// would do the same but stalls Next's link prefetches mid-navigation.)
const browser = await chromium.launch({ executablePath: CHROMIUM, proxy: { server: "http://127.0.0.1:9", bypass: "127.0.0.1,localhost,::1" } });
let blocked = 0;
async function context(opts) {
  const ctx = await browser.newContext({ reducedMotion: "reduce", colorScheme: "light", deviceScaleFactor: 1, ...opts });
  ctx.setDefaultTimeout(60000);
  ctx.on("requestfailed", (r) => {
    if (!r.url().startsWith(`${BASE}/`)) blocked++;
  });
  return ctx;
}
async function login(email) {
  const ctx = await context({ timezoneId: "UTC" });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date(FROZEN_NOW));
  await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await p.fill("#email", email);
  await p.fill("#password", readFileSync(PASSWORD_FILE, "utf8"));
  await Promise.all([p.waitForURL(`${BASE}/dashboard`, { timeout: 40000 }), p.click('button[type="submit"]')]);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}
const is418 = (s) => /#418\b|errors\/418|hydrat/i.test(s);

const now = {
  frozenNow: FROZEN_NOW, chromium: browser.version(), states: {}, staff: {}, sweep: {}, d6: {}, c2: { dept: {}, payroll: {}, dates: {} }, c3: { layout: {}, kanban: {}, empty: {}, hours: {} },
  c4: { ledger: {}, values: {}, picker: {}, links: {}, empty: {} },
  c5: { nav: {}, d7: {}, keys: {}, presets: {}, staff: {}, timeline: {}, security: {}, alert: {}, compliance: {} },
  c6: { dash: {}, values: {}, ranges: {}, bp: {}, range: {}, customize: {}, noZatca: {}, zones: {} },
  c7: { states: {}, error: {}, drafts: null, removed: null },
  c8: { exports: {}, access: {}, print: {}, tenant: {} },
};
const prompts = {};
let fdNode = {};
const fdBrowsers = [];
const acts = { owner: {}, staff: {} };
try {
  const ownerState = await login(OWNER_EMAIL);
  const staffState = RECORD_ONLY && !WRITE_C8REF ? null : await login(STAFF_EMAIL);
  // Audit stamps the database wrote with its own clock (these logins' sessions and events, the
  // seeded defaults, the owner's password date): moved to the frozen instant in this TEST-ONLY copy
  // (archetype-states.mjs), as the archetype screenshots do.
  await alignDatabaseTimestamps(env.DATABASE_URL);
  async function pass(label, storageState, locale, zone, widths, onState, routes = ROUTES) {
    const ctx = await context({ storageState, locale: BROWSERS[locale].locale, timezoneId: zone ?? BROWSERS[locale].timezoneId });
    await ctx.addCookies([{ name: "locale", value: locale, url: BASE }, { name: "theme", value: "light", url: BASE }]);
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date(FROZEN_NOW));
    let errors = [];
    let current = null;
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text().slice(0, 160)}`));
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 160)}`));
    // An "unsaved changes" prompt when leaving a page nobody typed into is a defect of the page left
    // behind: counted against it, then accepted so the navigation goes on.
    page.on("dialog", (d) => {
      if (current) prompts[current] = (prompts[current] ?? 0) + 1;
      (d.type() === "beforeunload" ? d.accept() : d.dismiss()).catch(() => {});
    });
    for (const [id, path] of routes)
      for (const [w, h] of widths) {
        errors = [];
        await page.setViewportSize({ width: w, height: h });
        const resp = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
        await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
        await page.waitForTimeout(250);
        const u = new URL(page.url());
        current = `${label}|${id}|${w}`;
        await onState({ id, path, w, page, status: resp?.status() ?? null, finalPath: u.pathname + u.search, errors: [...errors] });
      }
    await ctx.close();
    console.log(`  ${label} done`);
  }
  const errFacts = (errors) => ({
    consoleErrors: errors.filter((e) => e.startsWith("console:")).length,
    pageErrors: errors.filter((e) => e.startsWith("pageerror:")).length,
    r418: errors.filter(is418).length,
    ...(errors.length ? { errorSample: [...new Set(errors)].slice(0, 3) } : {}),
  });

  // C7: the heading pass — first, before any probe writes to this copy, so C6's build (--write-c7ref) and this run read
  // the same database: the five families' TEST-ONLY drafts written for it and removed after. EN / AR at 1440 and 390;
  // then the error boundary's markup rendered into <main> with its title as an h3 (C6) and as an h1 (C7).
  const C7_ON = WRITE_C7REF || (!WRITE_D6 && !WRITE_C3REF && !WRITE_C4REF && !WRITE_C6REF && !WRITE_C8REF && (!ONLY || ONLY.split(",").includes("c7")));
  if (C7_ON) {
    const dbq7 = async (fn) => {
      const c = new pg.Client({ connectionString: env.DATABASE_URL });
      await c.connect();
      try {
        return await fn(c);
      } finally {
        await c.end();
      }
    };
    now.c7.drafts = await dbq7((c) => writeC7Drafts(c));
    try {
      for (const locale of ["en", "ar"])
        await pass(`C7 ${locale}`, ownerState, locale, null, [[1440, 900], [390, 844]], async ({ id, w, page, status, finalPath, errors }) => {
          const m = await page.evaluate(C7M);
          const aria = await page.locator("main").ariaSnapshot().catch((e) => `aria snapshot failed: ${e.message}`);
          now.c7.states[`${id}|${locale}|${w}`] = { status, finalPath, ...m, aria: ariaHeadings(aria), actions: await page.evaluate(ACTIONS), ...errFacts(errors) };
        }, C7_ROUTES);
      const ctx = await context({ storageState: ownerState, locale: BROWSERS.en.locale, timezoneId: BROWSERS.en.timezoneId });
      await ctx.addCookies([{ name: "locale", value: "en", url: BASE }, { name: "theme", value: "light", url: BASE }]);
      const page = await ctx.newPage();
      await page.clock.setFixedTime(new Date(FROZEN_NOW));
      for (const [w, h] of [[1440, 900], [390, 844]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(`${BASE}/recycle-bin`, { waitUntil: "networkidle", timeout: 60000 });
        // A first render settles first (its first paint of the replaced <main> differs from every later one by a few
        // antialiased pixels at the icon's edge, whatever the title's tag); then C6's h3 and C7's h1, each measured.
        for (const tag of ["warm-up", "h3", "h1"]) {
          await page.evaluate((markup) => { document.querySelector("main").innerHTML = markup; }, C7_ERROR_HTML.replace("<TAG", `<${tag === "h1" ? "h1" : "h3"}`).replace("</TAG>", `</${tag === "h1" ? "h1" : "h3"}>`));
          await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
          await page.waitForTimeout(300);
          const m = await page.evaluate(C7M);
          const png = await page.locator("main").screenshot({ animations: "disabled", caret: "hide" });
          if (tag !== "warm-up") now.c7.error[`${tag}|${w}`] = { heads: m.heads, h1: m.h1, title: m.title, png: createHash("sha256").update(png).digest("hex").slice(0, 16), bytes: png.length };
        }
      }
      await ctx.close();
    } finally {
      await dbq7((c) => removeC7Drafts(c));
      now.c7.removed = await dbq7(async (c) => Number((await c.query("select (select count(*) from sales_orders) + (select count(*) from proforma_invoices) + (select count(*) from delivery_challans) + (select count(*) from credit_notes) + (select count(*) from debit_notes) as n")).rows[0].n) === 0);
    }
  }

  if (!RECORD_ONLY)
    for (const locale of ["en", "ar"]) {
      await pass(`owner ${locale}`, ownerState, locale, null, WIDTHS, async ({ id, w, page, status, finalPath, errors }) => {
        now.states[`${id}|${locale}|${w}`] = { status, finalPath, ...(await page.evaluate(MEASURE, C1_LITERALS)), ...errFacts(errors) };
        if (w === 1440 || (w === 390 && locale === "en")) acts.owner[`${id}|${locale}|${w}`] = await page.evaluate(ACTIONS);
        // C4: the ledger / chart gate, last (it scrolls the table and the page).
        if (id === "ledger" || id === "coa") now.c4.ledger[`${id}|${locale}|${w}`] = await page.evaluate(LEDGER_FACTS, C4_WORDS[locale].addAccount);
        // C5: Business Settings' navigation beside or above its panel (D-7), its direction and its tabs.
        if (C5_TABS[id]) now.c5.nav[`${id}|${locale}|${w}`] = await page.evaluate(SETTINGS_FACTS);
        // C6: the Dashboard's grid, widgets and what it says.
        if (id === "dashboard") now.c6.dash[`${locale}|${w}`] = await page.evaluate(DASH_FACTS, c6W(locale));
      });
      await pass(`staff ${locale}`, staffState, locale, null, [[1440, 900]], async ({ id, page, status, finalPath, errors }) => {
        now.staff[`${id}|${locale}`] = { status, finalPath, ...errFacts(errors) };
        acts.staff[`${id}|${locale}|1440`] = await page.evaluate(ACTIONS);
      });
      await pass(`sweep ${locale} (${SWEEP_ZONE})`, ownerState, locale, SWEEP_ZONE, [[1440, 900]], async ({ id, status, finalPath, errors }) => {
        now.sweep[`${id}|${locale}`] = { status, finalPath, ...errFacts(errors) };
      });
    }
  // D-6: every StatRow consumer at every width, EN and AR; actions at 1440 and 390. (--write-d6 records
  // the consumers C2 must leave as they were — not C2's own HR strips.)
  if (!WRITE_C3REF && !WRITE_C4REF && !WRITE_C6REF && !WRITE_C7REF && !WRITE_C8REF)
    for (const locale of ["en", "ar"])
      await pass(`D-6 ${locale}`, ownerState, locale, null, WIDTHS, async ({ id, w, page, status, finalPath, errors }) => {
        now.d6[`${id}|${locale}|${w}`] = { status, finalPath, ...(await page.evaluate(D6M)), ...(w === 1440 || w === 390 ? { actions: await page.evaluate(ACTIONS) } : {}), ...errFacts(errors) };
      }, D6_ROUTES.filter(([id]) => !WRITE_D6 || !D6_C2.includes(id)));

  // C3: the populated and the empty project at every width, EN and AR — the composition (C3M) and, at 1440
  // and 390 on the populated one, the kanban's heads and cards at rest and each card hovered (CSS
  // transitions finished). --write-c3ref records this pass on C2's build.
  if (!WRITE_D6 && !WRITE_C4REF && !WRITE_C6REF && !WRITE_C7REF && !WRITE_C8REF)
    for (const locale of ["en", "ar"])
      await pass(`C3 ${locale}`, ownerState, locale, null, WIDTHS, async ({ id, w, page, status, finalPath, errors }) => {
        const layout = await page.evaluate(C3M, C3_NUMERIC);
        layout.d2Says = await page.evaluate(SAYS, C3_WORDS[locale].hidden); // C8 (D-2)
        let kanbanFacts = null;
        if (id === "project-detail" && (w === 1440 || w === 390)) {
          kanbanFacts = await page.evaluate(KANBAN_FACTS, [CARD_PROPS, INNER_PROPS, HEAD_PROPS, null]);
          kanbanFacts.hover = [];
          for (const c of kanbanFacts.cards) {
            const card = page.locator("main .kanban-card").filter({ has: page.locator(".t", { hasText: new RegExp(`^${c.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
            await card.scrollIntoViewIfNeeded();
            await card.hover();
            await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
            kanbanFacts.hover.push((await page.evaluate(KANBAN_FACTS, [CARD_PROPS, INNER_PROPS, HEAD_PROPS, c.title])).cards[0] ?? null);
          }
          await page.mouse.move(0, 0);
        }
        now.c3.layout[`${id}|${locale}|${w}`] = { status, finalPath, ...layout, ...(kanbanFacts ? { kanbanFacts } : {}), ...errFacts(errors) };
      }, ROUTES.filter(([id]) => C3_DETAIL.includes(id)));

  // C4: the value pass — every report and statement case at 1440 and 390, EN / AR (REPORT_FACTS /
  // STATEMENT_FACTS); at 1440 also a search, the first drill-down and a statement's from-date filter, read
  // the same way. --write-c4ref records this pass on C3's build; every other run holds it to that record.
  const C4_ON = ROUTES.some(([id]) => C4_ROUTES.includes(id));
  if (!WRITE_D6 && !WRITE_C3REF && !WRITE_C6REF && !WRITE_C7REF && !WRITE_C8REF && (C4_ON || WRITE_C4REF)) {
    const settle = async (page) => {
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => { document.getAnimations().forEach((a) => a.finish()); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
    };
    for (const locale of ["en", "ar"])
      await pass(`C4 values ${locale}`, ownerState, locale, null, [[1440, 900], [390, 844]], async ({ id, w, page, status, finalPath, errors }) => {
        now.c4.values[`${id}|${locale}|${w}`] = { status, finalPath, ...(await page.evaluate(id.startsWith("report-") ? REPORT_FACTS : STATEMENT_FACTS)), ...errFacts(errors) };
        if (w !== 1440) return;
        const more = [];
        const onConsole = (m) => m.type() === "error" && more.push(`console: ${m.text().slice(0, 160)}`);
        const onError = (e) => more.push(`pageerror: ${String(e.message).slice(0, 160)}`);
        page.on("console", onConsole);
        page.on("pageerror", onError);
        try {
          if (C4_SEARCH[id]) {
            const box = page.locator(".reports-print-area > .card.no-print input:not([type])");
            await box.fill(C4_SEARCH[id]);
            await settle(page);
            now.c4.values[`${id}+search|${locale}|${w}`] = { term: C4_SEARCH[id], ...(await page.evaluate(REPORT_FACTS)), ...errFacts(more) };
            await box.fill("");
            await settle(page);
          }
          const drillTarget = C4_DRILL[id] ? page.locator(`.reports-print-area > .card:not(.no-print) ${C4_DRILL[id]}`).first() : null;
          if (drillTarget && !(await drillTarget.count())) now.c4.values[`${id}+drill|${locale}|${w}`] = { target: null, opened: false, closed: false, drawer: null, ...errFacts(more) };
          else if (drillTarget) {
            const target = (await drillTarget.innerText())?.replace(/\s+/g, " ").trim() ?? null;
            await drillTarget.click();
            const dialog = page.locator('[role="dialog"]');
            const opened = await dialog.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
            await page.waitForFunction(() => !document.querySelector('[role="dialog"] .animate-spin'), null, { timeout: 15000 }).catch(() => {});
            await settle(page);
            const drawer = opened ? await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText ?? "").split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)) : null;
            await page.keyboard.press("Escape");
            const closed = await dialog.waitFor({ state: "detached", timeout: 15000 }).then(() => true, () => false);
            now.c4.values[`${id}+drill|${locale}|${w}`] = { target, opened, closed, drawer, ...errFacts(more) };
          }
          if (C4_FROM[id]) {
            await page.locator('main input[type="date"]').first().fill(C4_FROM[id]);
            await page.waitForTimeout(500);
            await settle(page);
            now.c4.values[`${id}+from|${locale}|${w}`] = { from: C4_FROM[id], ...(await page.evaluate(STATEMENT_FACTS)), ...errFacts(more) };
          }
        } finally {
          page.off("console", onConsole);
          page.off("pageerror", onError);
        }
      }, C4_VALUE_CASES);
  }

  // C8 final: the Financial Reports exports — the eight kinds × CSV / Excel / PDF for an EN and an AR session over the
  // 2026 range, the PDF read back through its own text operators (exportFacts) — and the export URL without a session
  // and as Staff; then, in print media, the P&L and the Balance Sheet (EN / AR at 1440). --write-c8ref records the
  // exports on the approved remediation's build (c47c65a); every other run holds them to that record.
  const C8_ON = WRITE_C8REF || (!RECORD_ONLY && ROUTES.some(([id]) => C4_ROUTES.includes(id)));
  if (C8_ON) {
    console.log("  C8 exports …");
    const cookieOf = (state) => state.cookies.filter((c) => c.name !== "locale" && c.name !== "theme").map((c) => `${c.name}=${c.value}`).join("; ");
    const exportUrl = (kind, format) => `${BASE}/finance/reports/export?report=${kind}&from=2026-01-01&to=2026-12-31&format=${format}`;
    for (const locale of ["en", "ar"])
      for (const kind of REPORT_KINDS)
        for (const format of ["csv", "xlsx", "pdf"]) {
          const res = await fetch(exportUrl(kind, format), { redirect: "manual", headers: { Cookie: `${cookieOf(ownerState)}; locale=${locale}; theme=light` } });
          const bytes = Buffer.from(await res.arrayBuffer());
          now.c8.exports[`${kind}|${format}|${locale}`] = { status: res.status, type: res.headers.get("content-type"), file: res.headers.get("content-disposition"), ...(await exportFacts(format, bytes)) };
        }
    const anon = await fetch(exportUrl("pl", "csv"), { redirect: "manual" });
    now.c8.access.anonymous = { status: anon.status, location: anon.headers.get("location") };
    if (staffState) {
      const st = await fetch(exportUrl("pl", "csv"), { redirect: "manual", headers: { Cookie: `${cookieOf(staffState)}; locale=en; theme=light` } });
      now.c8.access.staff = { status: st.status, location: st.headers.get("location"), type: st.headers.get("content-type") };
    }
    // Tenant scope, observed: the proxy turns away a request without a valid session before the route runs, so only a
    // second tenant shows that the route itself scopes every query to the session's org. An org registered through the
    // UI in this run's TEST-ONLY copy (no ledger yet) asks for the eight CSV exports; none may carry the seeded org's.
    if (!WRITE_C8REF) {
      const email = "c8-tenant@visual-baseline.test";
      const password = `Aa1!${randomUUID()}`;
      const ctx = await context({ locale: "en-US", timezoneId: "UTC" });
      const p = await ctx.newPage();
      await p.setViewportSize({ width: 1440, height: 900 });
      await p.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 60000 });
      await p.fill('input[name="orgName"]', "TEST-ONLY Tenant Scope Co. (Fictional)");
      await p.fill('input[name="name"]', "Tenant Scope Owner");
      await p.fill('input[name="email"]', email);
      await p.fill('input[name="password"]', password);
      const confirm = p.locator('input[name="confirmPassword"]');
      if (await confirm.count()) await confirm.fill(password);
      await pickCountry(p);
      await Promise.all([p.waitForURL(`${BASE}/dashboard`, { timeout: 60000 }), p.getByRole("button", { name: /register|create|sign up/i }).first().click()]);
      const tenantState = await ctx.storageState();
      await ctx.close();
      for (const kind of REPORT_KINDS) {
        const res = await fetch(exportUrl(kind, "csv"), { redirect: "manual", headers: { Cookie: `${cookieOf(tenantState)}; locale=en; theme=light` } });
        now.c8.tenant[kind] = { status: res.status, text: Buffer.from(await res.arrayBuffer()).toString("utf8") };
      }
    }
    if (!WRITE_C8REF) {
      console.log("  C8 print …");
      for (const locale of ["en", "ar"]) {
        const ctx = await context({ storageState: ownerState, locale: BROWSERS[locale].locale, timezoneId: BROWSERS[locale].timezoneId, viewport: { width: 1440, height: 900 } });
        await ctx.addCookies([{ name: "locale", value: locale, url: BASE }, { name: "theme", value: "light", url: BASE }]);
        const page = await ctx.newPage();
        await page.clock.setFixedTime(new Date(FROZEN_NOW));
        for (const kind of ["pl", "bs"]) {
          await page.goto(`${BASE}/finance/reports?report=${kind}`, { waitUntil: "networkidle" });
          const screen = (await page.evaluate(REPORT_FACTS))?.body ?? null;
          await page.emulateMedia({ media: "print" });
          // The media switch is a style change like any other: under reduced motion every element carries a 0.01 ms
          // transition and visibility is transitionable, so a read straight after it can still see the old value.
          await page.evaluate(() => {
            document.getAnimations().forEach((a) => a.finish());
            return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          });
          now.c8.print[`${kind}|${locale}`] = { screen, ...(await page.evaluate(PRINT_FACTS)) };
          await page.emulateMedia({ media: "screen" });
        }
        await ctx.close();
      }
    }
  }

  // C6: the Dashboard value pass — this month, the last 30 days, this year at 1440 and 390, EN / AR: every
  // factual value (DASH_VALUES), and on C6's build also the C6 facts of those states. --write-c6ref records
  // it on C5's build; every other run holds it to that record.
  const C6_ON = ROUTES.some(([id]) => id === "dashboard");
  if (!WRITE_D6 && !WRITE_C3REF && !WRITE_C4REF && !WRITE_C7REF && !WRITE_C8REF && (C6_ON || WRITE_C6REF))
    for (const locale of ["en", "ar"])
      await pass(`C6 values ${locale}`, ownerState, locale, null, [[1440, 900], [390, 844]], async ({ id, w, page, status, finalPath, errors }) => {
        now.c6.values[`${id}|${locale}|${w}`] = { status, finalPath, ...(await page.evaluate(DASH_VALUES, c6W(locale))), ...errFacts(errors) };
        if (!WRITE_C6REF) {
          const m = await page.evaluate(MEASURE, C1_LITERALS);
          now.c6.ranges[`${id}|${locale}|${w}`] = { outline: m.outline, h1: m.h1, skips: m.skips, overflow: m.overflow, offenders: m.offenders, indic: m.indic, pageHeader: m.pageHeader, ...(await page.evaluate(DASH_FACTS, c6W(locale))), ...errFacts(errors) };
        }
      }, C6_VALUE_CASES);

  // C2 probes, EN and AR, as a person would use the pages. One page each, the frozen clock, the owner
  // (C4: or the org a probe registered).
  async function probePage(locale, [w, h], path, storageState = ownerState) {
    const ctx = await context({ storageState, locale: BROWSERS[locale].locale, timezoneId: BROWSERS[locale].timezoneId });
    await ctx.addCookies([{ name: "locale", value: locale, url: BASE }, { name: "theme", value: "light", url: BASE }]);
    const page = await ctx.newPage();
    await page.clock.setFixedTime(new Date(FROZEN_NOW));
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text().slice(0, 160)}`));
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 160)}`));
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
    return { ctx, page, errors };
  }
  // Tab from the top of the page until `selector` has focus: how many presses it took (null: never).
  async function tabTo(page, selector) {
    for (let i = 1; i <= 200; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return i;
    }
    return null;
  }
  // The department filter: Tab to "All departments"; Tab + Enter onto each department in turn;
  // Shift+Tab back to All and Space; Tab + Space onto each department; back to All and Enter. Keys are
  // pressed only once Tab has reached the filters (C1's chips never were: that step fails, and no key
  // lands on whatever else had focus). Then by pointer, on a fresh Employees page (a key that went
  // elsewhere may have left it), as it worked before C2: click each filter.
  async function deptProbe(locale, size) {
    const { ctx, page, errors } = await probePage(locale, size, "/hr/employees");
    const state = () => page.evaluate(DEPT_STATE);
    const steps = [{ step: "loaded", index: 0, ...(await state()) }];
    const n = steps[0].filters.length;
    const tabs = await tabTo(page, "main .tab-row > :first-child");
    steps.push({ step: `Tab ×${tabs} to the first filter`, index: 0, tabs, keyboard: true, ...(await state()) });
    if (tabs !== null)
      for (const [key, back] of [["Enter", "Space"], ["Space", "Enter"]]) {
        for (let i = 1; i < n; i++) {
          await page.keyboard.press("Tab");
          await page.keyboard.press(key === "Space" ? " " : key);
          steps.push({ step: `Tab, ${key}`, index: i, keyboard: true, ...(await state()) });
        }
        for (let i = 1; i < n; i++) await page.keyboard.press("Shift+Tab");
        await page.keyboard.press(back === "Space" ? " " : back);
        steps.push({ step: `Shift+Tab ×${n - 1}, ${back}`, index: 0, keyboard: true, ...(await state()) });
      }
    await page.goto(`${BASE}/hr/employees`, { waitUntil: "networkidle", timeout: 60000 });
    for (const i of [...Array(n).keys()].reverse()) {
      await page.locator("main .tab-row > *").nth(i).click();
      steps.push({ step: "click", index: i, ...(await state()) });
    }
    await ctx.close();
    return { steps, errors };
  }
  // The payroll page: its layout; and (keys) Tab to the first row, Tab + Enter / Space down the rows,
  // Shift+Tab back to the first and the other key.
  async function payrollProbe(locale, size, keys) {
    const { ctx, page, errors } = await probePage(locale, size, "/hr/payroll");
    const state = () => page.evaluate(PAYROLL_STATE);
    const steps = [{ step: "loaded", index: 0, ...(await state()) }];
    if (keys) {
      const n = steps[0].rows.length;
      const tabs = await tabTo(page, "main tr[data-payroll-row]");
      steps.push({ step: `Tab ×${tabs} to the first row`, index: 0, tabs, keyboard: true, ...(await state()) });
      if (tabs !== null) {
        for (let i = 1; i < n; i++) {
          await page.keyboard.press("Tab");
          await page.keyboard.press(i % 2 ? "Enter" : " ");
          steps.push({ step: `Tab, ${i % 2 ? "Enter" : "Space"}`, index: i, keyboard: true, ...(await state()) });
        }
        for (let i = 1; i < n; i++) await page.keyboard.press("Shift+Tab");
        await page.keyboard.press(n % 2 ? "Enter" : " ");
        steps.push({ step: `Shift+Tab ×${n - 1}, ${n % 2 ? "Enter" : "Space"}`, index: 0, keyboard: true, ...(await state()) });
      }
    }
    await ctx.close();
    return { steps, errors };
  }
  if (!RECORD_ONLY) {
    for (const locale of ["en", "ar"]) {
      if (ROUTES.some(([id]) => id === "hr-employees"))
        for (const size of [[1440, 900], [390, 844]]) now.c2.dept[`${locale}|${size[0]}`] = await deptProbe(locale, size);
      if (ROUTES.some(([id]) => id === "hr-payroll"))
        for (const size of WIDTHS) now.c2.payroll[`${locale}|${size[0]}`] = await payrollProbe(locale, size, size[0] === 1440 || size[0] === 390);
    }
    console.log("  C2 probes done");
  }

  // C3 probes, EN and AR at 1440 and 390, the owner. Keys are pressed only once Tab has reached what they
  // are meant for; a step that cannot be reached is recorded as such and fails below.
  /** Press `key` until the focused element matches `selector` (and, if given, has exactly `text`): presses taken, or null. */
  async function tabUntil(page, selector, text = null, key = "Tab", max = 200) {
    for (let i = 1; i <= max; i++) {
      await page.keyboard.press(key);
      if (await page.evaluate(([s, t]) => { const a = document.activeElement; return Boolean(a && a.matches(s) && (t === null || a.textContent.trim() === t)); }, [selector, text])) return i;
    }
    return null;
  }
  const dialogOpened = (page) => page.locator('[role="dialog"]').waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
  const dialogClosed = (page) => page.locator('[role="dialog"]').waitFor({ state: "detached", timeout: 15000 }).then(() => true, () => false);
  // Steady state before a measurement: running transitions finished (Button's transition-colors would
  // otherwise be caught mid-way), two frames, and — when a control has keyboard focus — its focus
  // outline drawn (a control that never draws one times out here and fails the check).
  const twoFrames = async (page) => {
    await page.evaluate(() => { document.getAnimations().forEach((a) => a.finish()); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
    await page.waitForFunction(() => { const a = document.activeElement; return !a || a === document.body || !a.matches(":focus-visible") || getComputedStyle(a).outlineStyle !== "none"; }, null, { timeout: 3000 }).catch(() => {});
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  };
  const markOpener = (page) => page.evaluate(() => { window.__opener = document.activeElement; });
  // The kanban by keyboard: Tab to a card; Enter opens it, Escape closes; Space opens it, the dialog's
  // close button (by keyboard) closes; Tab to the next card, Enter, Save with nothing changed; Shift+Tab
  // to Add Task, Enter, Escape. Then by pointer on a fresh page: click the third card, click the close
  // button. Every task row is read from the database before and after.
  async function kanbanProbe(locale, size) {
    const W = C3_WORDS[locale];
    const { ctx, page, errors } = await probePage(locale, size, "/projects/1");
    const before = await taskRows();
    const steps = [];
    const push = async (step, kind, extra = {}) => {
      await twoFrames(page);
      steps.push({ step, kind, ...extra, ...(await page.evaluate(KANBAN_STATE)) });
    };
    const tabs = await tabUntil(page, "main .kanban-card");
    await push(`Tab ×${tabs} to a task card`, "focus", { tabs });
    if (tabs !== null) {
      await markOpener(page);
      await page.keyboard.press("Enter");
      await push("Enter", "open", { ok: await dialogOpened(page) });
      await page.keyboard.press("Escape");
      await push("Escape", "return", { ok: await dialogClosed(page) });
      await page.keyboard.press(" ");
      await push("Space", "open", { ok: await dialogOpened(page) });
      const toClose = await tabUntil(page, '[role="dialog"] button', "Close", "Tab", 30);
      if (toClose !== null) await page.keyboard.press("Enter");
      await push(`Tab ×${toClose} to the close button, Enter`, "return", { ok: toClose !== null && (await dialogClosed(page)) });
      await page.keyboard.press("Tab");
      await markOpener(page);
      await push("Tab to the next card", "focus");
      await page.keyboard.press("Enter");
      await push("Enter", "open", { ok: await dialogOpened(page) });
      const toSave = await tabUntil(page, '[role="dialog"] button', W.save, "Tab", 30);
      if (toSave !== null) await page.keyboard.press("Enter");
      await push(`Tab ×${toSave} to Save, Enter (nothing changed)`, "return", { ok: toSave !== null && (await dialogClosed(page)) });
      const toAdd = await tabUntil(page, "main button", W.addTask, "Shift+Tab", 60);
      await markOpener(page);
      if (toAdd !== null) await page.keyboard.press("Enter");
      await push(`Shift+Tab ×${toAdd} to Add Task, Enter`, "new", { ok: toAdd !== null && (await dialogOpened(page)) });
      await page.keyboard.press("Escape");
      await push("Escape", "return-add", { ok: await dialogClosed(page) });
    }
    await page.goto(`${BASE}/projects/1`, { waitUntil: "networkidle", timeout: 60000 });
    const third = page.locator("main .kanban-card").nth(2);
    await third.evaluate((el) => { window.__opener = el; });
    await third.click();
    await push("click the third card", "open", { ok: await dialogOpened(page), pointer: true });
    await page.locator('[role="dialog"] button', { hasText: "Close" }).click();
    await push("click the close button", "return", { ok: await dialogClosed(page), pointer: true });
    const after = await taskRows();
    await ctx.close();
    return { steps, errors, unchanged: JSON.stringify(before) === JSON.stringify(after), rows: before.length };
  }
  // The empty project: its Tasks section as it loads; then Tab to Add Task, Enter (New Task), Escape.
  async function emptyProbe(locale, size) {
    const W = C3_WORDS[locale];
    const { ctx, page, errors } = await probePage(locale, size, "/projects/2");
    const facts = await page.evaluate(EMPTY_FACTS, W);
    const steps = [];
    const push = async (step, kind, extra = {}) => {
      await twoFrames(page);
      steps.push({ step, kind, ...extra, ...(await page.evaluate(KANBAN_STATE)) });
    };
    const tabs = await tabUntil(page, "main button", W.addTask);
    await markOpener(page);
    await push(`Tab ×${tabs} to Add Task`, "focus-add", { tabs });
    if (tabs !== null) {
      await page.keyboard.press("Enter");
      await push("Enter", "new", { ok: await dialogOpened(page) });
      await page.keyboard.press("Escape");
      await push("Escape", "return-add", { ok: await dialogClosed(page) });
    }
    await ctx.close();
    return { facts, steps, errors };
  }
  // The Hours column: one time log on the populated project's first task, today, in this run's TEST-ONLY
  // copy (the seed has none in the rolling week) — measured, then removed.
  async function withTimeLog(fn) {
    const c = new pg.Client({ connectionString: env.DATABASE_URL });
    await c.connect();
    const emp = (await c.query("select id from employees where org_id = $1 and status = 'active' order by id limit 1", [projDb.org])).rows[0].id;
    const id = (await c.query("insert into time_logs (org_id, task_id, employee_id, date, hours, billable) values ($1, $2, $3, $4, 2.5, true) returning id",
      [projDb.org, projDb.tasks[0].id, emp, FROZEN_NOW.slice(0, 10)])).rows[0].id;
    try {
      return await fn();
    } finally {
      await c.query("delete from time_logs where id = $1", [id]);
      await c.end();
    }
  }
  async function hoursProbe(locale, size) {
    const { ctx, page, errors } = await probePage(locale, size, "/projects/1");
    const layout = await page.evaluate(C3M, C3_NUMERIC);
    await ctx.close();
    return { numeric: layout.numeric, overflow: layout.overflow, errors };
  }
  if (!RECORD_ONLY) {
    const EDGE_SIZES = [[1440, 900], [390, 844]];
    for (const locale of ["en", "ar"]) {
      if (ROUTES.some(([id]) => id === "project-detail"))
        for (const size of EDGE_SIZES) now.c3.kanban[`${locale}|${size[0]}`] = await kanbanProbe(locale, size);
      if (ROUTES.some(([id]) => id === "project-empty"))
        for (const size of EDGE_SIZES) now.c3.empty[`${locale}|${size[0]}`] = await emptyProbe(locale, size);
    }
    if (ROUTES.some(([id]) => id === "project-detail"))
      await withTimeLog(async () => {
        for (const locale of ["en", "ar"]) for (const size of EDGE_SIZES) now.c3.hours[`${locale}|${size[0]}`] = await hoursProbe(locale, size);
      });
    console.log("  C3 probes done");
  }

  // C4 probes, EN and AR at 1440 and 390, the owner. Keys are pressed only once Tab has reached what they are
  // meant for; a step that cannot be reached is recorded as such and fails below.
  // The report picker: Tab to it (Profit & Loss, pressed); Tab ×3, Enter — Trial Balance; Tab ×4, Space — VAT
  // Summary; Shift+Tab ×7, Enter — Profit & Loss again. After each: the URL, the toggles, the h2, the exports
  // and what the report says (held to c4ref below). Then the search box's name.
  async function reportProbe(locale, size) {
    const W = C4_WORDS[locale];
    const { ctx, page, errors } = await probePage(locale, size, "/finance/reports");
    const steps = [];
    const shown = async (kind) => {
      await page.waitForFunction((label) => {
        const h = document.querySelector("main .reports-print-area h2");
        return Boolean(h && h.textContent.trim() === label && !document.querySelector("main .reports-print-area .animate-spin, main .reports-print-area [aria-busy='true']"));
      }, W.kinds[kind], { timeout: 30000 }).catch(() => {});
      await page.waitForLoadState("networkidle");
      await twoFrames(page);
    };
    const push = async (step, kind, extra = {}) => steps.push({ step, kind, ...extra, ...(await page.evaluate(PICKER_STATE)), facts: await page.evaluate(REPORT_FACTS) });
    await push("loaded", "pl");
    const tabs = await tabUntil(page, "main .reports-print-area > .tab-row button");
    await push(`Tab ×${tabs} to the picker`, "pl", { tabs, keyboard: true });
    if (tabs !== null)
      for (const [n, key, kind, back] of [[3, "Enter", "tb", false], [4, " ", "vat", false], [7, "Enter", "pl", true]]) {
        for (let i = 0; i < n; i++) await page.keyboard.press(back ? "Shift+Tab" : "Tab");
        await page.keyboard.press(key);
        await shown(kind);
        await push(`${back ? "Shift+Tab" : "Tab"} ×${n}, ${key === " " ? "Space" : key} (${kind})`, kind, { keyboard: true });
      }
    const box = page.locator(".reports-print-area > .card.no-print input:not([type])");
    const search = { label: await box.getAttribute("aria-label"), placeholder: await box.getAttribute("placeholder"), named: await page.getByRole("textbox", { name: W.search, exact: true }).count() };
    await ctx.close();
    return { steps, errors, search };
  }
  // The statement's Client / Vendor links: loaded on Client; Tab to Vendor, Enter — the vendor page; Tab to
  // Client, Enter — back. After each: aria-current, .active, focus, the h1 and the URL.
  async function linksProbe(locale, size) {
    const { ctx, page, errors } = await probePage(locale, size, "/finance/statements?kind=client");
    const state = async () => ({ ...(await page.evaluate(STMT_LINKS)), facts: await page.evaluate(STATEMENT_FACTS) });
    const steps = [{ step: "loaded", kind: "client", ...(await state()) }];
    for (const kind of ["vendor", "client"]) {
      const tabs = await tabUntil(page, `main .tab-row > a[href="/finance/statements?kind=${kind}"]`);
      steps.push({ step: `Tab ×${tabs} to ${kind}`, kind: kind === "vendor" ? "client" : "vendor", to: kind, tabs, keyboard: true, ...(await state()) });
      if (tabs === null) break;
      await Promise.all([page.waitForURL(new RegExp(`kind=${kind}$`), { timeout: 30000 }).catch(() => {}), page.keyboard.press("Enter")]);
      await page.waitForLoadState("networkidle");
      await twoFrames(page);
      steps.push({ step: "Enter", kind, ...(await state()) });
    }
    await ctx.close();
    return { steps, errors };
  }
  // The empty states: no account selected — the seeded org, an id no account has, on Ledger and Chart of
  // Accounts; then an org registered through the UI in this run's TEST-ONLY copy, which has its chart of
  // accounts and a starter bank account but no transaction, payment or journal entry — Ledger (on its first
  // account), Payments, New Journal Entry, Bank Accounts — and Bank Accounts again once that one bank
  // account is deleted (nothing references it: the org has no payment).
  async function finEmptyState(locale, size, path, storageState) {
    const { ctx, page, errors } = await probePage(locale, size, path, storageState);
    const out = { path, ...(await page.evaluate(MEASURE, C1_LITERALS)), empty: await page.evaluate(FIN_EMPTY), actions: await page.evaluate(ACTIONS), ...errFacts(errors) };
    await ctx.close();
    return out;
  }
  async function registerFinanceOrg() {
    const email = "c4-empty-finance@visual-baseline.test";
    const password = `Aa1!${randomUUID()}`;
    const ctx = await context({ locale: "en-US", timezoneId: "UTC" });
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 60000 });
    await p.fill('input[name="orgName"]', "TEST-ONLY Empty Finance Co. (Fictional)");
    await p.fill('input[name="name"]', "Empty Finance Owner");
    await p.fill('input[name="email"]', email);
    await p.fill('input[name="password"]', password);
    const confirm = p.locator('input[name="confirmPassword"]');
    if (await confirm.count()) await confirm.fill(password);
    await pickCountry(p);
    await Promise.all([p.waitForURL(`${BASE}/dashboard`, { timeout: 60000 }), p.getByRole("button", { name: /register|create|sign up/i }).first().click()]);
    const state = await ctx.storageState();
    await ctx.close();
    const c = new pg.Client({ connectionString: env.DATABASE_URL });
    await c.connect();
    try {
      const org = (await c.query("select org_id from users where email = $1", [email])).rows[0].org_id;
      const count = async (table) => (await c.query(`select count(*)::int as n from ${table} where org_id = $1`, [org])).rows[0].n;
      return {
        state, org, first: (await c.query("select code, name from accounts where org_id = $1 order by code limit 1", [org])).rows[0],
        banks: await count("bank_accounts"), payments: await count("payments"), journal: await count("journal_entries"),
      };
    } finally {
      await c.end();
    }
  }
  if (!RECORD_ONLY) {
    const EDGE_SIZES = [[1440, 900], [390, 844]];
    for (const locale of ["en", "ar"])
      for (const size of EDGE_SIZES) {
        if (ROUTES.some(([id]) => id.startsWith("reports-"))) now.c4.picker[`${locale}|${size[0]}`] = await reportProbe(locale, size);
        if (ROUTES.some(([id]) => id.startsWith("statement"))) now.c4.links[`${locale}|${size[0]}`] = await linksProbe(locale, size);
      }
    if (ROUTES.some(([id]) => ["ledger", "coa", "payments", "journal", "bank-accounts"].includes(id))) {
      const fresh = await registerFinanceOrg();
      now.c4.emptyOrg = { first: fresh.first, banks: fresh.banks, payments: fresh.payments, journal: fresh.journal };
      const run = async (name, path, state) => {
        for (const locale of ["en", "ar"]) for (const size of EDGE_SIZES) now.c4.empty[`${name}|${locale}|${size[0]}`] = await finEmptyState(locale, size, path, state);
      };
      await run("no-account-ledger", "/finance/ledger?account=999999", ownerState);
      await run("no-account-coa", "/finance/chart-of-accounts?account=999999", ownerState);
      await run("no-transactions", "/finance/ledger", fresh.state);
      await run("no-payments", "/finance/payments", fresh.state);
      await run("no-journal", "/finance/journal", fresh.state);
      await run("no-recent-payments", "/finance/bank-accounts", fresh.state);
      const c = new pg.Client({ connectionString: env.DATABASE_URL });
      await c.connect();
      now.c4.emptyOrg.deleted = (await c.query("delete from bank_accounts where org_id = $1", [fresh.org])).rowCount;
      await c.end();
      await run("no-bank-accounts", "/finance/bank-accounts", fresh.state);
    }
    console.log("  C4 probes done");
  }
  // C5 probes, EN and AR. The D-7 breakpoint: Business Settings at 767 and 768 px — a column below md, a row
  // from it. The navigation by keyboard (1440 and 390): Tab to the active tab, the only tabbable one; then
  // ArrowDown, ArrowDown, ArrowUp, End, Home — focus and the panel shown follow — and ArrowRight, ArrowLeft —
  // nothing: the list is vertical. Presets (1440 and 390): the 14 tabs, and each panel with a title of its own
  // opened. The Security Center as Staff (1440): no risk pill, no Timeline. The Timeline's EmptyState (the
  // owner; no event in the page's 30-day window). The Security Center's layout (1440, 768, 390): the header
  // and risk meta, both cards, their controls and fields, the tables and the Timeline inside the viewport.
  // Compliance (1440, 768, 390): every control inside the
  // viewport, the customer select's list, and at 390 — a consent granted in this run's TEST-ONLY copy and
  // deleted after — its table inside the card. Last, the Security alert: five failed logins at the frozen
  // instant, for an org of their own registered in this run's TEST-ONLY copy, raise "Repeated failed logins" —
  // its stripe on the inline-start side, the risk Elevated in the PageHeader meta.
  if (!RECORD_ONLY && ROUTES.some(([id]) => C5_ROUTES.includes(id))) {
    const settingsState = (page) => page.evaluate(() => {
      const a = document.activeElement;
      const list = document.querySelector('main [role="tablist"]');
      const value = (e) => e?.id?.split("-trigger-")[1] ?? null;
      const items = [...(list?.querySelectorAll('[role="tab"]') ?? [])];
      return {
        focus: list?.contains(a) ? value(a) : (a?.tagName ?? null),
        active: items.filter((i) => i.getAttribute("data-state") === "active").map(value),
        selected: items.filter((i) => i.getAttribute("aria-selected") === "true").map(value),
        tabbable: items.filter((i) => i.tabIndex === 0).map(value),
        panel: document.querySelector('main [role="tabpanel"][data-state="active"]')?.id?.split("-content-")[1] ?? null,
        h2: [...document.querySelectorAll("main h2")].map((h) => h.textContent.replace(/\s+/g, " ").trim()),
        focusVisible: a?.matches(":focus-visible") ?? false, outline: a ? getComputedStyle(a).outlineStyle : null,
        url: location.pathname + location.search,
      };
    });
    const dbq = async (fn) => {
      const c = new pg.Client({ connectionString: env.DATABASE_URL });
      await c.connect();
      try {
        return await fn(c);
      } finally {
        await c.end();
      }
    };
    // The Timeline's oracle: events in the page's own window (SQL now() − 30 days, the database's clock).
    now.c5.timelineWindow = await dbq(async (c) =>
      (await c.query("select count(*)::int as n from security_events where org_id = (select org_id from users where email = $1) and created_at >= now() - interval '30 days'", [OWNER_EMAIL])).rows[0].n);
    for (const locale of ["en", "ar"]) {
      for (const w of [767, 768]) {
        const { ctx, page, errors } = await probePage(locale, [w, 1024], "/settings/organization?tab=business-details");
        now.c5.d7[`${locale}|${w}`] = { ...(await page.evaluate(SETTINGS_FACTS)), overflow: (await page.evaluate(MEASURE, C1_LITERALS)).overflow, ...errFacts(errors) };
        await ctx.close();
      }
      for (const size of [[1440, 900], [390, 844]]) {
        const { ctx, page, errors } = await probePage(locale, size, "/settings/organization?tab=business-details");
        await twoFrames(page);
        const steps = [{ step: "loaded", ...(await settingsState(page)) }];
        const tabs = await tabUntil(page, 'main [role="tablist"].settings-nav [role="tab"][data-state="active"]');
        await twoFrames(page);
        steps.push({ step: `Tab ×${tabs} to the active tab`, tabs, ...(await settingsState(page)) });
        if (tabs !== null)
          for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "End", "Home", "ArrowRight", "ArrowLeft"]) {
            await page.keyboard.press(key);
            await page.waitForLoadState("networkidle");
            await twoFrames(page);
            steps.push({ step: key, key, ...(await settingsState(page)) });
          }
        now.c5.keys[`${locale}|${size[0]}`] = { steps, ...errFacts(errors) };
        await ctx.close();
      }
      for (const size of [[1440, 900], [390, 844]]) {
        const { ctx, page, errors } = await probePage(locale, size, "/settings/presets");
        const tabs = await page.evaluate(() => {
          const list = document.querySelector('main [role="tablist"]');
          const items = [...list.querySelectorAll('[role="tab"]')];
          return { dir: list.parentElement.getAttribute("dir"), order: items.map((i) => i.id.split("-trigger-")[1]), labels: items.map((i) => i.textContent.replace(/\s+/g, " ").trim()) };
        });
        const panels = {};
        for (const v of Object.keys(C5_PRESET_PANELS)) {
          await page.locator(`main [role="tab"][id$="-trigger-${v}"]`).click();
          await page.waitForLoadState("networkidle");
          await twoFrames(page);
          const m = await page.evaluate(MEASURE, C1_LITERALS);
          panels[v] = { outline: m.outline, h1: m.h1, skips: m.skips, overflow: m.overflow, offenders: m.offenders, panel: (await settingsState(page)).panel };
        }
        now.c5.presets[`${locale}|${size[0]}`] = { ...tabs, panels, ...errFacts(errors) };
        await ctx.close();
      }
      {
        const { ctx, page, errors } = await probePage(locale, [1440, 900], "/settings/security", staffState);
        const m = await page.evaluate(MEASURE, C1_LITERALS);
        now.c5.staff[locale] = { outline: m.outline, h1: m.h1, skips: m.skips, pageHeader: m.pageHeader, ...(await page.evaluate(SECURITY_FACTS)), ...errFacts(errors) };
        await ctx.close();
      }
      for (const size of [[1440, 900], [390, 844]]) {
        const { ctx, page, errors } = await probePage(locale, size, "/settings/security");
        now.c5.timeline[`${locale}|${size[0]}`] = { empty: await page.evaluate(FIN_EMPTY), tables: await page.evaluate(() => document.querySelectorAll("main table").length), ...errFacts(errors) };
        await ctx.close();
      }
      for (const size of [[1440, 900], [768, 1024], [390, 844]]) {
        const { ctx, page, errors } = await probePage(locale, size, "/settings/security");
        const m = await page.evaluate(MEASURE, C1_LITERALS);
        now.c5.security[`${locale}|${size[0]}`] = { ...(await page.evaluate(SECURITY_LAYOUT)), overflow: m.overflow, offenders: m.offenders, tablesBeyond: m.tablesBeyond, pageHeader: m.pageHeader, ...errFacts(errors) };
        await ctx.close();
      }
      const CW = { export: T(locale, "Export organization data"), erase: T(locale, "Erase"), grant: T(locale, "Grant"), withdraw: T(locale, "Withdraw") };
      for (const size of [[1440, 900], [768, 1024], [390, 844]]) {
        const { ctx, page, errors } = await probePage(locale, size, "/settings/compliance");
        const facts = await page.evaluate(COMPLIANCE_FACTS, CW);
        await page.locator("#erase-customer").click();
        const listOpen = await page.locator('[role="listbox"]').waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
        const options = listOpen ? await page.locator('[role="listbox"] [role="option"]').count() : 0;
        await page.keyboard.press("Escape");
        const listClosed = await page.locator('[role="listbox"]').waitFor({ state: "detached", timeout: 15000 }).then(() => true, () => false);
        let consent = null;
        if (size[0] === 390) {
          const before = await dbq(async (c) => (await c.query("select coalesce(max(id), 0)::int as n from consent_records")).rows[0].n);
          await page.getByRole("button", { name: CW.grant, exact: true }).click();
          await page.locator("main table").first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
          await page.waitForLoadState("networkidle");
          await twoFrames(page);
          consent = { ...(await page.evaluate(COMPLIANCE_FACTS, CW)), overflow: (await page.evaluate(MEASURE, C1_LITERALS)).overflow };
          consent.removed = await dbq(async (c) => (await c.query("delete from consent_records where id > $1", [before])).rowCount);
        }
        now.c5.compliance[`${locale}|${size[0]}`] = { ...facts, listOpen, options, listClosed, consent, ...errFacts(errors) };
        await ctx.close();
      }
    }
    // The alert: security_events is append-only (its trigger refuses DELETE), so the five failed logins go to
    // an org of their own, registered through the UI in this run's TEST-ONLY copy — the seeded org is untouched.
    const email = "c5-security-alert@visual-baseline.test";
    const password = `Aa1!${randomUUID()}`;
    {
      const ctx = await context({ locale: "en-US", timezoneId: "UTC" });
      const p = await ctx.newPage();
      await p.setViewportSize({ width: 1440, height: 900 });
      await p.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 60000 });
      await p.fill('input[name="orgName"]', "TEST-ONLY Security Alert Co. (Fictional)");
      await p.fill('input[name="name"]', "Security Alert Owner");
      await p.fill('input[name="email"]', email);
      await p.fill('input[name="password"]', password);
      const confirm = p.locator('input[name="confirmPassword"]');
      if (await confirm.count()) await confirm.fill(password);
      await pickCountry(p);
      await Promise.all([p.waitForURL(`${BASE}/dashboard`, { timeout: 60000 }), p.getByRole("button", { name: /register|create|sign up/i }).first().click()]);
      now.c5.alertOrgState = await ctx.storageState();
      await ctx.close();
    }
    now.c5.alertFixture = await dbq(async (c) => {
      const { org_id: org, role } = (await c.query("select org_id, role from users where email = $1", [email])).rows[0];
      for (let i = 0; i < 5; i++)
        await c.query(
          "insert into security_events (org_id, email, type, severity, ip_address, browser, detail, created_at) values ($1, $2, 'login.failed', 'medium', '203.0.113.7', 'C5 fixture', 'TEST-ONLY fixture', $3)",
          [org, email, FROZEN_NOW],
        );
      return { org, role, failed: (await c.query("select count(*)::int as n from security_events where org_id = $1 and type = 'login.failed'", [org])).rows[0].n };
    });
    for (const locale of ["en", "ar"])
      for (const size of [[1440, 900], [390, 844]]) {
        const { ctx, page, errors } = await probePage(locale, size, "/settings/security", now.c5.alertOrgState);
        now.c5.alert[`${locale}|${size[0]}`] = { ...(await page.evaluate(SECURITY_FACTS)), overflow: (await page.evaluate(MEASURE, C1_LITERALS)).overflow, ...errFacts(errors) };
        await ctx.close();
      }
    delete now.c5.alertOrgState;
    console.log("  C5 probes done");
  }
  // C6 probes, EN and AR. The grid's two breakpoints (1101 / 1100 px: twelve tracks → two; 641 / 640 px: two →
  // one). The range selector in the PageHeader, by pointer (the owner, 1440): Last Month chosen — the URL
  // ?range=last_month, the preference saved, the label, the figures and the chart re-read and equal to a direct
  // load of that range — then This Month again (saved back). Customize Layout, in an org registered through
  // the UI in this run's TEST-ONLY copy (Saudi Arabia: the ZATCA card shows): the feature strip unticked and
  // HR Snapshot moved above Project Overview, saved — the page re-rendered so, the preference stored under the
  // same twelve keys — then Reset to default, saved. An org whose country has no ZATCA Phase 1 (the United Arab
  // Emirates, also registered through the UI): no feature strip and nothing empty in its place, at 1440 and
  // 390. The activity times (the owner): each the formatDisplayDate(…, "dateTime") string of its document's
  // created_at — read from this copy, formatted here in Node — under the usual browsers and under
  // Pacific/Pago_Pago (UTC−11, where the frozen instant is still the 14th).
  if (!RECORD_ONLY && ROUTES.some(([id]) => id === "dashboard")) {
    const dbq6 = async (fn) => {
      const c = new pg.Client({ connectionString: env.DATABASE_URL });
      await c.connect();
      try {
        return await fn(c);
      } finally {
        await c.end();
      }
    };
    const settle6 = async (page) => {
      await page.waitForLoadState("networkidle");
      await twoFrames(page);
    };
    const prefOf = (email) => dbq6(async (c) => (await c.query("select dashboard_range, dashboard_layout from user_preferences where user_id = (select id from users where email = $1)", [email])).rows[0] ?? null);
    for (const locale of ["en", "ar"])
      for (const w of [1101, 1100, 641, 640]) {
        const { ctx, page, errors } = await probePage(locale, [w, 900], "/dashboard");
        const f = await page.evaluate(DASH_FACTS, c6W(locale));
        now.c6.bp[`${locale}|${w}`] = { tracks: f?.tracks.length ?? null, autoRows: f?.autoRows ?? null, widgets: f?.widgets.map(({ name, span, clipX, clipY, inGrid, inView, row }) => ({ name, span, clipX, clipY, inGrid, inView, row })) ?? null,
          gone: f?.gone ?? null, overflow: (await page.evaluate(MEASURE, C1_LITERALS)).overflow, ...errFacts(errors) };
        await ctx.close();
      }
    for (const locale of ["en", "ar"]) {
      const { ctx, page, errors } = await probePage(locale, [1440, 900], "/dashboard");
      const trigger = page.locator('main [data-slot="page-header-actions"] [aria-haspopup="menu"]');
      const before = { range: (await page.evaluate(DASH_FACTS, c6W(locale)))?.header.range ?? null, url: new URL(page.url()).search };
      const choose = async (en) => {
        await trigger.click();
        const menu = page.locator('[role="menu"]');
        const opened = await menu.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
        const items = opened ? (await menu.locator('[role="menuitem"]').allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()) : [];
        if (opened) {
          const key = Object.keys(C6_RANGE_KEYS).find((k) => C6_RANGE_KEYS[k] === en);
          await Promise.all([page.waitForURL((u) => u.search === `?range=${key}`, { timeout: 30000 }).catch(() => {}), menu.getByRole("menuitem", { name: T(locale, en), exact: true }).click()]);
          await page.waitForFunction((label) => document.querySelector('main [data-slot="page-header-actions"] [aria-haspopup="menu"]')?.textContent.includes(label), T(locale, en), { timeout: 30000 }).catch(() => {});
          await settle6(page);
        }
        return { opened, items };
      };
      const pick1 = await choose("Last Month");
      const m1 = await page.evaluate(MEASURE, C1_LITERALS);
      const after = { url: new URL(page.url()).search, facts: await page.evaluate(DASH_FACTS, c6W(locale)), values: await page.evaluate(DASH_VALUES, c6W(locale)), outline: m1.outline, h1: m1.h1, saved: (await prefOf(OWNER_EMAIL))?.dashboard_range ?? null };
      const pick2 = await choose("This Month");
      const back = { url: new URL(page.url()).search, range: (await page.evaluate(DASH_FACTS, c6W(locale)))?.header.range ?? null, saved: (await prefOf(OWNER_EMAIL))?.dashboard_range ?? null };
      await ctx.close();
      const direct = await probePage(locale, [1440, 900], "/dashboard?range=last_month");
      const directValues = await direct.page.evaluate(DASH_VALUES, c6W(locale));
      await direct.ctx.close();
      now.c6.range[locale] = { before, pick1, after, pick2, back, directValues, ...errFacts([...errors, ...direct.errors]) };
    }
    // Fresh orgs, registered as a person would.
    const freshOrg = async (country, tag) => {
      const email = `c6-${tag}@visual-baseline.test`;
      const password = `Aa1!${randomUUID()}`;
      const ctx = await context({ locale: "en-US", timezoneId: "UTC" });
      const p = await ctx.newPage();
      await p.setViewportSize({ width: 1440, height: 900 });
      await p.goto(`${BASE}/register`, { waitUntil: "networkidle", timeout: 60000 });
      await p.fill('input[name="orgName"]', `TEST-ONLY ${tag} Co. (Fictional)`);
      await p.fill('input[name="name"]', `${tag} Owner`);
      await p.fill('input[name="email"]', email);
      await p.fill('input[name="password"]', password);
      const confirm = p.locator('input[name="confirmPassword"]');
      if (await confirm.count()) await confirm.fill(password);
      await pickCountry(p, country);
      await Promise.all([p.waitForURL(`${BASE}/dashboard`, { timeout: 60000 }), p.getByRole("button", { name: /register|create|sign up/i }).first().click()]);
      const state = await ctx.storageState();
      await ctx.close();
      return { email, state, country: await dbq6(async (c) => (await c.query("select o.country from orgs o join users u on u.org_id = o.id where u.email = $1", [email])).rows[0]?.country ?? null) };
    };
    const ksa = await freshOrg("Saudi Arabia", "customize");
    const names = (f) => f?.widgets.map((x) => x.name) ?? null;
    for (const locale of ["en", "ar"]) {
      const { ctx, page, errors } = await probePage(locale, [1440, 900], "/dashboard", ksa.state);
      const before = await page.evaluate(DASH_FACTS, c6W(locale));
      const dialog = page.getByRole("dialog");
      const open = async () => {
        await page.locator('main [data-slot="page-header-actions"]').getByRole("button", { name: T(locale, "Customize Layout"), exact: true }).click();
        return dialog.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
      };
      const save = async () => {
        await dialog.getByRole("button", { name: T(locale, "Save"), exact: true }).click();
        const closed = await dialog.waitFor({ state: "detached", timeout: 30000 }).then(() => true, () => false);
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(500);
        await settle6(page);
        return closed;
      };
      const opened = await open();
      const labels = opened ? (await dialog.locator('label[for^="w-"]').allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()) : [];
      if (opened) {
        await dialog.locator("#w-feature_strip").click();
        await dialog.locator("#w-quick_actions").click();
        await dialog.locator("div").filter({ has: page.locator('label[for="w-hr_snapshot"]') }).last().getByRole("button", { name: T(locale, "Move up"), exact: true }).click();
      }
      const saved = opened ? await save() : false;
      const customized = { facts: await page.evaluate(DASH_FACTS, c6W(locale)), stored: (await prefOf(ksa.email))?.dashboard_layout ?? null };
      const reopened = await open();
      if (reopened) await dialog.getByRole("button", { name: T(locale, "Reset to default"), exact: true }).click();
      const resetSaved = reopened ? await save() : false;
      const reset = { facts: await page.evaluate(DASH_FACTS, c6W(locale)), stored: (await prefOf(ksa.email))?.dashboard_layout ?? null };
      now.c6.customize[locale] = { org: ksa.country, before: { names: names(before), strip: before?.strip ?? null, gone: before?.gone ?? null }, opened, labels, saved,
        customized: { names: names(customized.facts), strip: customized.facts?.strip ?? null, gone: customized.facts?.gone ?? null, stored: customized.stored }, reopened, resetSaved,
        reset: { names: names(reset.facts), strip: reset.facts?.strip ?? null, gone: reset.facts?.gone ?? null, stored: reset.stored }, ...errFacts(errors) };
      await ctx.close();
    }
    const uae = await freshOrg("United Arab Emirates", "no-zatca");
    for (const locale of ["en", "ar"])
      for (const size of [[1440, 900], [390, 844]]) {
        const { ctx, page, errors } = await probePage(locale, size, "/dashboard", uae.state);
        const m = await page.evaluate(MEASURE, C1_LITERALS);
        const f = await page.evaluate(DASH_FACTS, c6W(locale));
        now.c6.noZatca[`${locale}|${size[0]}`] = { org: uae.country, strip: f?.strip ?? null, stripShell: await page.evaluate(() => document.querySelectorAll("main .feature-strip, main .feature-card").length),
          zatcaText: await page.evaluate((z) => (document.querySelector("main")?.textContent ?? "").includes(z), T(locale, "ZATCA Phase 1 QR")),
          outline: m.outline, h1: m.h1, skips: m.skips, overflow: m.overflow, offenders: m.offenders, indic: m.indic, gone: f?.gone ?? null,
          widgets: f?.widgets.map(({ name, span, clipX, clipY, inView }) => ({ name, span, clipX, clipY, inView })) ?? null, ...errFacts(errors) };
        // The preference is still there — Feature Highlights, ticked — though this org has no card to show for it.
        if (size[0] === 1440) {
          await page.locator('main [data-slot="page-header-actions"]').getByRole("button", { name: T(locale, "Customize Layout"), exact: true }).click();
          const dialog = page.getByRole("dialog");
          const opened = await dialog.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
          now.c6.noZatca[`${locale}|${size[0]}`].pref = opened
            ? { labels: (await dialog.locator('label[for^="w-"]').allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim()), strip: await dialog.locator("#w-feature_strip").getAttribute("data-state") }
            : null;
          await page.keyboard.press("Escape");
        }
        await ctx.close();
      }
    // The activity times. The seed's documents carry fixed creation instants (11:00Z / 12:00Z); one more is made
    // deterministic here — the owner's oldest quotation given 23:30Z on the 14th in this TEST-ONLY copy (then the
    // newest activity; already the 15th in Riyadh and on Kiritimati, the 14th in New York and Pago Pago), restored
    // after. The owner's Dashboard (this month) under each browser's own zone, Pacific/Pago_Pago (UTC−11) and
    // Pacific/Kiritimati (UTC+14).
    const moved = await dbq6(async (c) => {
      const q = (await c.query("select q.id, q.quotation_number as number, q.created_at::text as raw from quotations q join users u on u.org_id = q.org_id where u.email = $1 order by q.created_at asc, q.id asc limit 1", [OWNER_EMAIL])).rows[0] ?? null;
      if (q) await c.query("update quotations set created_at = $1::timestamp where id = $2", [C6_STAMP, q.id]);
      return q;
    });
    now.c6.stamp = moved && { number: moved.number, was: moved.raw, at: C6_STAMP };
    try {
      for (const locale of ["en", "ar"])
        for (const zone of [BROWSERS[locale].timezoneId, SWEEP_ZONE, "Pacific/Kiritimati"]) {
          const ctx = await context({ storageState: ownerState, locale: BROWSERS[locale].locale, timezoneId: zone });
          await ctx.addCookies([{ name: "locale", value: locale, url: BASE }, { name: "theme", value: "light", url: BASE }]);
          const page = await ctx.newPage();
          await page.clock.setFixedTime(new Date(FROZEN_NOW));
          const errors = [];
          page.on("console", (msg) => msg.type() === "error" && errors.push(`console: ${msg.text().slice(0, 160)}`));
          page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 160)}`));
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
          const rows = (await page.evaluate(DASH_FACTS, c6W(locale)))?.activity ?? [];
          const docs = await dbq6(async (c) => {
            const out = [];
            for (const r of rows) {
              const isInvoice = r.text.startsWith(T(locale, "Invoice created"));
              const number = r.text.slice(r.text.indexOf(":") + 1).split(" · ")[0].trim();
              const q = isInvoice
                ? "select i.created_at from sales_invoices i join users u on u.org_id = i.org_id where u.email = $1 and i.invoice_number = $2"
                : "select q.created_at from quotations q join users u on u.org_id = q.org_id where u.email = $1 and q.quotation_number = $2";
              out.push({ kind: isInvoice ? "invoice" : "quotation", number, createdAt: (await c.query(q, [OWNER_EMAIL, number])).rows[0]?.created_at?.toISOString() ?? null });
            }
            return out;
          });
          now.c6.zones[`${locale}|${zone}`] = { rows, docs, ...errFacts(errors) };
          await ctx.close();
        }
    } finally {
      if (moved) await dbq6((c) => c.query("update quotations set created_at = $1::timestamp where id = $2", [moved.raw, moved.id]));
      if (now.c6.stamp) now.c6.stamp.restored = await dbq6(async (c) => (await c.query("select created_at::text as raw from quotations where id = $1", [moved.id])).rows[0]?.raw ?? null);
    }
    console.log("  C6 probes done");
  }
  // formatDisplayDate in the browser: identical to Node whatever the browser's locale and zone. (A
  // tree without the helper — main before C0 — has nothing to compare; the check below says so.)
  const fdSource = existsSync("src/lib/i18n/format-date.ts") ? readFileSync("src/lib/i18n/format-date.ts", "utf8") : "exports.formatDisplayDate = () => undefined;";
  const fdJs = ts.transpileModule(fdSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const fdInstants = ["2026-06-15T09:00:00Z", "2026-10-08T23:30:00Z", "2026-10-09T00:30:00Z", "2026-12-31T23:59:59Z", "2027-01-01T00:00:00Z", "2026-03-08T06:45:00Z"];
  const fdRun = (js, instants) => {
    const m = { exports: {} };
    new Function("module", "exports", "require", js)(m, m.exports, (spec) => {
      throw new Error(`format-date.ts imports ${spec}`);
    });
    const out = {};
    for (const i of instants) for (const l of ["en", "ar"]) for (const st of ["date", "dateTime", "monthYear"]) out[`${i}|${l}|${st}`] = m.exports.formatDisplayDate(i, l, st);
    return out;
  };
  fdNode = fdRun(fdJs, fdInstants);
  // C6: what each recent activity's time must say — formatDisplayDate(its document's created_at, locale,
  // "dateTime"), formatted here in Node from the value the database holds.
  {
    const m = { exports: {} };
    new Function("module", "exports", "require", fdJs)(m, m.exports, (spec) => {
      throw new Error(`format-date.ts imports ${spec}`);
    });
    for (const [k, z] of Object.entries(now.c6.zones)) z.expected = z.docs.map((d) => (d.createdAt ? m.exports.formatDisplayDate(d.createdAt, k.split("|")[0], "dateTime") : null));
  }
  // C2: what the two HR dates must say — the frozen day (Attendance) and the first of its month (Payroll).
  const [day, month] = [`${FROZEN_NOW.slice(0, 10)}T00:00:00Z`, `${FROZEN_NOW.slice(0, 7)}-01T00:00:00Z`];
  const c2Fd = fdRun(fdJs, [day, month]);
  for (const l of ["en", "ar"]) now.c2.dates[l] = { day: c2Fd[`${day}|${l}|date`], month: c2Fd[`${month}|${l}|monthYear`] };
  for (const [locale, timezoneId] of [["en-US", "America/New_York"], ["ar-SA", "Asia/Riyadh"], ["ar-EG", "Pacific/Pago_Pago"], ["fr-FR", "Pacific/Kiritimati"]]) {
    const c = await browser.newContext({ locale, timezoneId });
    const p = await c.newPage(); // about:blank — Intl is the browser's own, independent of any page
    const out = await p.evaluate(`(${fdRun.toString()})(${JSON.stringify(fdJs)}, ${JSON.stringify(fdInstants)})`);
    fdBrowsers.push({ locale, timezoneId, diff: Object.keys(fdNode).filter((k) => out[k] !== fdNode[k]).map((k) => `${k}: node "${fdNode[k]}" chromium "${out[k]}"`) });
    await c.close();
  }
} finally {
  await browser.close();
  await stop();
}
for (const [k, n] of Object.entries(prompts)) {
  const [label, id, w] = k.split("|");
  const [role, locale] = label.split(" ");
  if (role === "owner") now.states[`${id}|${locale}|${w}`].unloadPrompt = n;
}
const after = readFileSync(".next/BUILD_ID", "utf8").trim();
if (after !== buildId) refuse(`.next/BUILD_ID changed during the run (${buildId} → ${after})`);

// The D-6 record: the consumers C2 must leave as they were (C2's own HR strips are held to targets
// instead), with the commit and build it was measured on.
const git = (...a) => spawnSync("git", a, { encoding: "utf8" }).stdout?.trim() ?? "";
const d6Record = () => ({
  recordedOn: { commit: git("rev-parse", "HEAD"), srcClean: git("status", "--porcelain", "--", "src") === "", build: buildId, chromium: now.chromium },
  states: Object.fromEntries(Object.entries(now.d6).filter(([k]) => !D6_C2.includes(k.split("|")[0]))),
});
// The C3 record: what C2's build drew for both projects — every figure (label and value), the health
// badge, the kanban's tracks, column heads and cards (at rest and hovered) — with the commit and build.
const c3Record = () => ({
  recordedOn: { commit: git("rev-parse", "HEAD"), srcClean: git("status", "--porcelain", "--", "src") === "", build: buildId, chromium: now.chromium },
  states: Object.fromEntries(Object.entries(now.c3.layout).map(([k, v]) => [k, {
    summary: v.summary?.facts.map(({ label, value }) => ({ label, value })) ?? null,
    cost: v.cost?.facts.map(({ label, value }) => ({ label, value })) ?? null,
    badge: v.badge, kanban: v.kanban, kanbanFacts: v.kanbanFacts ?? null,
  }])),
});
// The C4 record: what C3's build said for every report and statement case — and for the search, the drill-down
// and the statement filter — with the commit and build it was measured on.
const c4Record = () => ({
  recordedOn: { commit: git("rev-parse", "HEAD"), srcClean: git("status", "--porcelain", "--", "src") === "", build: buildId, chromium: now.chromium },
  states: now.c4.values,
});
// The C6 record: every factual value C5's build showed on the Dashboard for the three value cases — with the
// commit and build it was measured on.
const c6Record = () => ({
  recordedOn: { commit: git("rev-parse", "HEAD"), srcClean: git("status", "--porcelain", "--", "src") === "", build: buildId, chromium: now.chromium },
  states: now.c6.values,
});
// The C7 record: every heading-pass state on C6's build — and the error boundary's two renders — with the commit and
// build it was measured on.
const c7Record = () => ({
  recordedOn: { commit: git("rev-parse", "HEAD"), srcClean: git("status", "--porcelain", "--", "src") === "", build: buildId, chromium: now.chromium },
  states: now.c7.states, error: now.c7.error,
});
if (MEASURE_OUT) writeFileSync(MEASURE_OUT, JSON.stringify({ ...now, blockedRequests: blocked, actions: acts }, null, 1) + "\n");
if (WRITE_D6) {
  const failed = Object.entries(now.d6).filter(([, v]) => v.status !== 200 || v.consoleErrors || v.pageErrors || v.r418).map(([k]) => k);
  if (failed.length) refuse(`--write-d6: not recording a pass with errors or a failed route: ${failed.slice(0, 4).join(", ")}`);
  const file = args.find((a) => a.startsWith("--write-d6="))?.slice(11) || BASELINE_FILE;
  const out = JSON.parse(readFileSync(file, "utf8"));
  out.d6 = d6Record();
  writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`• wrote the D-6 record into ${file}: ${Object.keys(out.d6.states).length} states, measured on ${out.d6.recordedOn.commit.slice(0, 7)} (src ${out.d6.recordedOn.srcClean ? "clean" : "MODIFIED"}), build ${buildId}`);
  rmSync(env.STORAGE_FAKE_DIR, { recursive: true, force: true });
  process.exit(0);
}
if (WRITE_C3REF) {
  const failed = Object.entries(now.c3.layout).filter(([, v]) => v.status !== 200 || v.consoleErrors || v.pageErrors || v.r418).map(([k]) => k);
  if (failed.length) refuse(`--write-c3ref: not recording a pass with errors or a failed route: ${failed.slice(0, 4).join(", ")}`);
  const file = args.find((a) => a.startsWith("--write-c3ref="))?.slice(14) || BASELINE_FILE;
  const out = JSON.parse(readFileSync(file, "utf8"));
  out.c3ref = c3Record();
  writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`• wrote the C3 record into ${file}: ${Object.keys(out.c3ref.states).length} states, measured on ${out.c3ref.recordedOn.commit.slice(0, 7)} (src ${out.c3ref.recordedOn.srcClean ? "clean" : "MODIFIED"}), build ${buildId}`);
  rmSync(env.STORAGE_FAKE_DIR, { recursive: true, force: true });
  process.exit(0);
}
if (WRITE_C4REF) {
  const failed = Object.entries(now.c4.values).filter(([k, v]) => (!k.includes("+") && v.status !== 200) || v.consoleErrors || v.pageErrors || v.r418 || v.opened === false || v.closed === false).map(([k]) => k);
  if (failed.length || !Object.keys(now.c4.values).length) refuse(`--write-c4ref: not recording a pass with errors or a failed route: ${failed.slice(0, 4).join(", ") || "(nothing measured)"}`);
  const file = args.find((a) => a.startsWith("--write-c4ref="))?.slice(14) || BASELINE_FILE;
  const out = JSON.parse(readFileSync(file, "utf8"));
  out.c4ref = c4Record();
  writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`• wrote the C4 record into ${file}: ${Object.keys(out.c4ref.states).length} states, measured on ${out.c4ref.recordedOn.commit.slice(0, 7)} (src ${out.c4ref.recordedOn.srcClean ? "clean" : "MODIFIED"}), build ${buildId}`);
  rmSync(env.STORAGE_FAKE_DIR, { recursive: true, force: true });
  process.exit(0);
}
if (WRITE_C6REF) {
  const failed = Object.entries(now.c6.values).filter(([k, v]) => v.status !== 200 || v.finalPath !== Object.fromEntries(C6_VALUE_CASES)[k.split("|")[0]] || v.consoleErrors || v.pageErrors || v.r418 || !Object.keys(v.kpis ?? {}).length || !v.chart).map(([k]) => k);
  if (failed.length || Object.keys(now.c6.values).length !== C6_VALUE_CASES.length * 4) refuse(`--write-c6ref: not recording a pass with errors, a failed route or a missing case: ${failed.slice(0, 4).join(", ") || `${Object.keys(now.c6.values).length} states`}`);
  const file = args.find((a) => a.startsWith("--write-c6ref="))?.slice(14) || BASELINE_FILE;
  const out = JSON.parse(readFileSync(file, "utf8"));
  out.c6ref = c6Record();
  writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`• wrote the C6 record into ${file}: ${Object.keys(out.c6ref.states).length} states, measured on ${out.c6ref.recordedOn.commit.slice(0, 7)} (src ${out.c6ref.recordedOn.srcClean ? "clean" : "MODIFIED"}), build ${buildId}`);
  rmSync(env.STORAGE_FAKE_DIR, { recursive: true, force: true });
  process.exit(0);
}
if (WRITE_C7REF) {
  const failed = Object.entries(now.c7.states).filter(([k, v]) => v.status !== 200 || v.finalPath !== Object.fromEntries(C7_ROUTES)[k.split("|")[0]] || v.consoleErrors || v.pageErrors || v.r418 || !v.title).map(([k]) => k);
  if (failed.length || Object.keys(now.c7.states).length !== C7_ROUTES.length * 4 || Object.keys(now.c7.error).length !== 4 || now.c7.removed !== true)
    refuse(`--write-c7ref: not recording a pass with errors, a failed route, a missing state or drafts left behind: ${failed.slice(0, 4).join(", ") || `${Object.keys(now.c7.states).length} states, removed ${now.c7.removed}`}`);
  const file = args.find((a) => a.startsWith("--write-c7ref="))?.slice(14) || BASELINE_FILE;
  const out = JSON.parse(readFileSync(file, "utf8"));
  out.c7ref = c7Record();
  writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`• wrote the C7 record into ${file}: ${Object.keys(out.c7ref.states).length} states, measured on ${out.c7ref.recordedOn.commit.slice(0, 7)} (src ${out.c7ref.recordedOn.srcClean ? "clean" : "MODIFIED"}), build ${buildId}`);
  rmSync(env.STORAGE_FAKE_DIR, { recursive: true, force: true });
  process.exit(0);
}
if (WRITE_C8REF) {
  const failed = Object.entries(now.c8.exports).filter(([, v]) => v.status !== 200 || (v.pages === null)).map(([k]) => k);
  if (failed.length || Object.keys(now.c8.exports).length !== REPORT_KINDS.length * 3 * 2 || !now.c8.access.anonymous || !now.c8.access.staff)
    refuse(`--write-c8ref: not recording an export pass with a failed or unreadable export, or a missing one: ${failed.slice(0, 4).join(", ") || `${Object.keys(now.c8.exports).length} exports`}`);
  const file = args.find((a) => a.startsWith("--write-c8ref="))?.slice(14) || BASELINE_FILE;
  const out = JSON.parse(readFileSync(file, "utf8"));
  out.c8ref = {
    recordedOn: { commit: git("rev-parse", "HEAD"), srcClean: git("status", "--porcelain", "--", "src") === "", build: buildId, chromium: now.chromium },
    exports: now.c8.exports, access: now.c8.access,
  };
  writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  console.log(`• wrote the C8 record into ${file}: ${Object.keys(out.c8ref.exports).length} exports, measured on ${out.c8ref.recordedOn.commit.slice(0, 7)} (src ${out.c8ref.recordedOn.srcClean ? "clean" : "MODIFIED"}), build ${buildId}`);
  rmSync(env.STORAGE_FAKE_DIR, { recursive: true, force: true });
  process.exit(0);
}
if (WRITE) {
  // The probes are checked, not pinned; the D-6 pass is pinned as its record. The C3, C4, C6 and C7 records were
  // measured on C2's, C3's, C5's and C6's builds and cannot be re-measured here: they are carried over as they are.
  const measured = { frozenNow: now.frozenNow, chromium: now.chromium, states: now.states, staff: now.staff, sweep: now.sweep };
  const prev = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, "utf8")) : {};
  writeFileSync(BASELINE_FILE, JSON.stringify({ ...measured, blockedRequests: blocked, d6: d6Record(), ...(prev.c3ref ? { c3ref: prev.c3ref } : {}), ...(prev.c4ref ? { c4ref: prev.c4ref } : {}), ...(prev.c6ref ? { c6ref: prev.c6ref } : {}), ...(prev.c7ref ? { c7ref: prev.c7ref } : {}), ...(prev.c8ref ? { c8ref: prev.c8ref } : {}) }, null, 1) + "\n");
  writeFileSync(ACTIONS_FILE, JSON.stringify(acts, null, 1) + "\n");
  console.log(`• wrote ${BASELINE_FILE} (${Object.keys(now.states).length} owner states, ${Object.keys(now.staff).length} staff, ${Object.keys(now.sweep).length} sweep, the D-6 record) and ${ACTIONS_FILE}`);
}
const rebased = (k) => Boolean(REBASE?.includes(k.split("|")[0]));
if (REBASE) {
  // The named routes' entries are replaced by this run's; every other entry is kept exactly as pinned
  // (same keys, same order), so the diff of the two files is those routes and nothing else. A named route
  // the baseline does not have yet (C4's three new finance routes) is added after the others; an entry of
  // a route that is not named and not in the baseline is refused.
  const merge = (old, cur, what) => {
    const lost = Object.keys(old).filter((k) => !(k in cur));
    if (lost.length) refuse(`--rebaseline: ${what} in the baseline were not measured: ${lost.slice(0, 4).join(", ")}`);
    const out = {};
    for (const k of Object.keys(old)) out[k] = rebased(k) ? cur[k] : old[k];
    for (const k of Object.keys(cur)) {
      if (k in out) continue;
      if (!rebased(k)) refuse(`--rebaseline: ${what}: ${k} is not in the baseline`);
      out[k] = cur[k];
    }
    return out;
  };
  const nextBase = { ...pinned, states: merge(pinned.states, now.states, "owner states"), staff: merge(pinned.staff, now.staff, "staff states"), sweep: merge(pinned.sweep, now.sweep, "sweep states") };
  const nextActs = { owner: merge(pinnedActions.owner, acts.owner, "owner action lists"), staff: merge(pinnedActions.staff, acts.staff, "staff action lists") };
  writeFileSync(BASELINE_FILE, JSON.stringify(nextBase, null, 1) + "\n");
  writeFileSync(ACTIONS_FILE, JSON.stringify(nextActs, null, 1) + "\n");
  const n = (o) => Object.keys(o).filter(rebased).length;
  console.log(`• re-recorded ${REBASE.length} routes in ${BASELINE_FILE} and ${ACTIONS_FILE}: ${n(now.states)} owner states, ${n(now.staff)} staff, ${n(now.sweep)} sweep, ` +
    `${n(acts.owner) + n(acts.staff)} action lists; every other route kept as pinned. The checks below compare with the baseline they replace.`);
}

// ------------------------------------------------------------------------------------- checks
const base = WRITE ? { ...now } : pinned;
const baseActs = WRITE ? acts : pinnedActions;
const results = [];
const check = (name, cond, extra = "") => results.push([Boolean(cond), name, extra]);
const keys = Object.keys(now.states);
const list = (xs) => (xs.length ? `${xs.length}: ${xs.slice(0, 6).join(" · ")}${xs.length > 6 ? " …" : ""}` : "");
const scoped = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => onlyId(k.split("|")[0])));

check(`isolation: TEST-ONLY loopback database, no .env, server on 127.0.0.1, browser confined to loopback (${blocked} other requests refused)`, target.pathname === `/${DB}` && !existsSync(join(ROOT, ".env")));
check(`pinned Chromium (${now.chromium})`, now.chromium === base.chromium, `baseline ${base.chromium}`);
const pages = new Set(ROUTES.map((r) => r[2]));
check(`the routes exercise all 36 DEV-UI-01.7 pages (${ROUTES.length} routes; C4 added the VAT report and the vendor statement, with and without a party; C5 the seven other Business Settings tabs)`, ONLY || (pages.size === 36 && ROUTES.length === 54), [...pages].length);
check(`measured ${keys.length} owner states (${ROUTES.length} routes × EN/AR × 4 widths), ${Object.keys(now.staff).length} staff, ${Object.keys(now.sweep).length} sweep`,
  keys.length === ROUTES.length * 8 && Object.keys(now.staff).length === ROUTES.length * 2 && Object.keys(now.sweep).length === ROUTES.length * 2);
const B = scoped(base.states);
const missing = Object.keys(B).filter((k) => !now.states[k]);
check("every baseline state was measured", missing.length === 0, list(missing));
const exact = (field) => keys.filter((k) => B[k] && JSON.stringify(now.states[k][field]) !== JSON.stringify(B[k][field])).map((k) => `${k} ${JSON.stringify(B[k][field])}→${JSON.stringify(now.states[k][field])}`);
check("route behaviour: status and final path as the baseline", exact("status").length + exact("finalPath").length === 0, list([...exact("status"), ...exact("finalPath")]));
check("direction: lang / dir as the baseline (ar → rtl, en → ltr)", exact("lang").length + exact("dir").length === 0 && keys.every((k) => now.states[k].dir === (k.includes("|ar|") ? "rtl" : "ltr")), list([...exact("lang"), ...exact("dir")]));
// A --rebaseline run re-records the outline and actions of its routes on purpose: those are listed
// for review below instead of failing; everything else about them is still compared.
// C8 final: the project section's h2 was renamed (Cost & Profitability → Project Revenue & Costs) — the one authorized
// difference from the recorded outlines, applied to the record before comparing; the C3 outline check asserts the name.
const renamedOutline = (k) => {
  const W = C3_WORDS[k.split("|")[1]];
  return /^project-(detail|empty)\|/.test(k) ? B[k].outline.map((h) => (h === `h2 ${W.costC3}` ? `h2 ${W.cost}` : h)) : B[k].outline;
};
const outlineDrift = keys.filter((k) => B[k] && JSON.stringify(now.states[k].outline) !== JSON.stringify(renamedOutline(k)))
  .map((k) => `${k} ${JSON.stringify(renamedOutline(k))}→${JSON.stringify(now.states[k].outline)}`).filter((d) => !rebased(d));
check(`heading outline inside <main> as the baseline${REBASE ? " (re-recorded routes: changes listed below)" : ""}`, outlineDrift.length === 0, list(outlineDrift));
if (REBASE) {
  const byRoute = new Map();
  for (const k of keys.filter((k) => rebased(k) && JSON.stringify(now.states[k].outline) !== JSON.stringify(B[k]?.outline))) {
    const [id, locale, w] = k.split("|");
    const change = `${JSON.stringify(B[k]?.outline)} → ${JSON.stringify(now.states[k].outline)}`;
    const key = `${id}|${locale}  ${change}`;
    byRoute.set(key, [...(byRoute.get(key) ?? []), w]);
  }
  console.log(`• outline changes in the re-recorded routes (${byRoute.size}):`);
  for (const [k, ws] of byRoute) console.log(`    ${k.replace("  ", ` @${ws.join("/")}  `)}`);
}
const worse = (f, better = (n, b) => n <= b) => keys.filter((k) => B[k] && !better(now.states[k][f] ?? 0, B[k][f] ?? 0)).map((k) => `${k} ${B[k][f]}→${now.states[k][f]}`);
const atBase = (f, bad = (v) => v > 0) => Object.keys(B).filter((k) => bad(B[k][f] ?? 0)).length;
check(`page overflow never worse (baseline: ${atBase("overflow")} states overflow)`, worse("overflow").length === 0, list(worse("overflow")));
check(`overflowing elements never more (baseline: ${atBase("offenders")} states)`, worse("offenders").length === 0, list(worse("offenders")));
check(`one h1 per page: distance from 1 never grows (baseline: ${atBase("h1", (v) => v !== 1)} states without exactly one h1)`, worse("h1", (n, b) => Math.abs(n - 1) <= Math.abs(b - 1)).length === 0, list(worse("h1", (n, b) => Math.abs(n - 1) <= Math.abs(b - 1))));
check(`heading-level skips never more (baseline: ${atBase("skips")} states)`, worse("skips").length === 0, list(worse("skips")));
check(`tables past the viewport never more (baseline: ${atBase("tablesBeyond")} states)`, worse("tablesBeyond").length === 0, list(worse("tablesBeyond")));
check(`Arabic-Indic digits never more (baseline: ${atBase("indic")} states)`, worse("indic").length === 0, list(worse("indic")));
check(`unnamed controls never more (baseline: ${atBase("unnamed")} states)`, worse("unnamed").length === 0, list(worse("unnamed")));
check(`pointer-only clickables never more (baseline: ${atBase("pointerOnly")} states)`, worse("pointerOnly").length === 0, list(worse("pointerOnly")));
const navLost = keys.filter((k) => B[k]?.navAtStart === true && now.states[k].navAtStart !== true);
check(`Settings navigation at the inline start never lost (baseline: ${Object.keys(B).filter((k) => B[k].navAtStart === false).length} states with it at the end)`, navLost.length === 0, list(navLost));
check(`"unsaved changes" prompts on pages nobody typed into never more (baseline: ${atBase("unloadPrompt")} states)`, worse("unloadPrompt").length === 0, list(worse("unloadPrompt")));
check("console errors never more", worse("consoleErrors").length === 0, list(worse("consoleErrors")));
check("page errors never more", worse("pageErrors").length === 0, list(worse("pageErrors")));
const r418 = [...Object.entries(now.states), ...Object.entries(now.staff).map(([k, v]) => [`staff ${k}`, v]), ...Object.entries(now.sweep).map(([k, v]) => [`${SWEEP_ZONE} ${k}`, v])].filter(([, v]) => v.r418 > 0).map(([k]) => k);
check(`zero React #418 across all ${keys.length + Object.keys(now.staff).length + Object.keys(now.sweep).length} measured states (owner, staff, ${SWEEP_ZONE} sweep)`, r418.length === 0, list(r418));
const BS = scoped(base.staff);
const perm = Object.keys(now.staff).filter((k) => !BS[k] || BS[k].status !== now.staff[k].status || BS[k].finalPath !== now.staff[k].finalPath).map((k) => `${k} ${BS[k]?.finalPath}→${now.staff[k].finalPath}`);
check("permissions: where Staff land on every route, as the baseline", perm.length === 0, list(perm));
const ownerOnly = ["hr-payroll", "settings-org", "settings-org-business", "settings-org-team", "settings-org-logo", "settings-org-bank", "settings-org-fiscal", "settings-org-vat",
  "settings-org-numbers", "settings-org-roles", "settings-org-zatca", "settings-presets", "settings-compliance", "settings-team"];
const staffRedirects = Object.entries(now.staff).filter(([k]) => ownerOnly.includes(k.split("|")[0]));
check("Staff are sent to /dashboard from Payroll, Business Settings, Presets and Compliance (and /settings/team)",
  staffRedirects.every(([, v]) => v.finalPath === "/dashboard") && (ONLY || staffRedirects.length === ownerOnly.length * 2), list(staffRedirects.filter(([, v]) => v.finalPath !== "/dashboard").map(([k, v]) => `${k}→${v.finalPath}`)));
const staffOpen = Object.entries(now.staff).filter(([k]) => !ownerOnly.includes(k.split("|")[0]) && k.split("|")[0] !== "nf-client");
check("Staff open every other 01.7 route where it is (session pages)", staffOpen.every(([k, v]) => v.status === 200 && v.finalPath === ROUTES.find((r) => r[0] === k.split("|")[0])[1]),
  list(staffOpen.filter(([k, v]) => v.status !== 200 || v.finalPath !== ROUTES.find((r) => r[0] === k.split("|")[0])[1]).map(([k, v]) => `${k} ${v.status} ${v.finalPath}`)));
const BSw = scoped(base.sweep);
const sweepWorse = Object.keys(now.sweep).filter((k) => BSw[k] && (now.sweep[k].consoleErrors > BSw[k].consoleErrors || now.sweep[k].finalPath !== BSw[k].finalPath));
check(`${SWEEP_ZONE} sweep: same routes, console errors never more`, sweepWorse.length === 0, list(sweepWorse));
// ACC-01: a product page's recorded actions with Item type's two radios added (in the page's language) and, on the
// Arabic product page, the recorded English Adjust stock trigger read as its Arabic — nothing else. Applied to the record
// before comparing, as C8 final's renamed outline; a record without that trigger keeps it, and so fails below.
const acc01Actions = (k, recorded) => {
  const [id, l] = k.split("|");
  if (!recorded || !ACC01_PAGES.includes(id)) return recorded;
  const W = ACC01_WORDS[l];
  const trigger = (name) => `button|${name}||type=button|popup=dialog`;
  const read = recorded.map((a) => (id === "product-detail" && l === "ar" && a === trigger(ACC01_WORDS.en.adjust) ? trigger(W.adjust) : a));
  return [...read, `input:radio|${W.stock}|||`, `input:radio|${W.service}|||`];
};
function actionDelta(group, which = (k) => !rebased(k)) {
  const want = scoped(baseActs[group]);
  const got = acts[group];
  const out = [];
  for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) {
    if (!which(k)) continue;
    const w = [...(acc01Actions(k, want[k]) ?? [])];
    const extra = [];
    for (const g of got[k] ?? []) {
      const i = w.indexOf(g);
      if (i >= 0) w.splice(i, 1);
      else extra.push(g);
    }
    if (w.length || extra.length) out.push(`${k}: ${[...w.map((x) => `- ${x}`), ...extra.map((x) => `+ ${x}`)].slice(0, 4).join(" ; ")}`);
  }
  return out;
}
const nOwner = Object.values(acts.owner).reduce((n, a) => n + a.length, 0);
const nStaff = Object.values(acts.staff).reduce((n, a) => n + a.length, 0);
check(`owner action inventory unchanged — ${nOwner} actions (EN + AR at 1440, EN at 390): name, target, type, disabled`, actionDelta("owner").length === 0, list(actionDelta("owner")));
check(`Staff action inventory unchanged — ${nStaff} actions (EN + AR at 1440)`, actionDelta("staff").length === 0, list(actionDelta("staff")));
// ACC-01: the change the two checks above read into the record is exactly the dictionary's words, applied where recorded.
const acc01Lists = (group) => Object.keys(scoped(baseActs[group])).filter((k) => ACC01_PAGES.includes(k.split("|")[0]));
const acc01Words = ["en", "ar"].flatMap((l) => [["Stock item", "stock"], ["Service", "service"], ["Adjust stock", "adjust"]]
  .filter(([en, w]) => T(l, en) !== ACC01_WORDS[l][w]).map(([en]) => `${l}: ${en} → ${T(l, en)}`));
const acc01Trigger = ["owner", "staff"].flatMap((g) => acc01Lists(g).filter((k) => k.startsWith("product-detail|ar|"))
  .filter((k) => !baseActs[g][k].includes(`button|${ACC01_WORDS.en.adjust}||type=button|popup=dialog`)).map((k) => `${g} ${k}: no recorded English Adjust stock trigger`));
check(`ACC-01 (inventory costing): the product pages' one authorized action change, derived from the record (not re-recorded) — Item type's two radios, Stock item / Service in the page's language, on New Product and the product page (owner ${acc01Lists("owner").length} lists, Staff ${acc01Lists("staff").length}); the Arabic product page's Adjust stock trigger in Arabic; the words the dictionary's`,
  acc01Words.length === 0 && acc01Trigger.length === 0 && (ONLY || (acc01Lists("owner").length === 6 && acc01Lists("staff").length === 4)), list([...acc01Words, ...acc01Trigger]));
if (REBASE) {
  // The re-recorded routes' actions must stay EQUIVALENT: the same kinds, targets, types and states.
  // English names are unchanged; an Arabic name may change only from C1 page copy that was still
  // English to Arabic text. C2 has one intended addition: Employees' department filters, buttons now
  // (they were spans, not actions) — "All departments" pressed and each department, named as in the
  // database, not. They must all appear, as exactly that; nothing else may appear or vanish.
  const problems = [];
  const renamed = [];
  const added = [];
  const stated = [];
  const fresh = [];
  const deptNames = (deptDb?.depts ?? []).map((d) => d.name);
  // C5 renames two actions on purpose: the Business Settings tabs Fiscal Year and VAT Configuration had no
  // Arabic (the dictionary entries C5 added; Users and Integrations are group labels, not actions). In Arabic
  // each may change from exactly its English key to exactly its new Arabic, on the Business Settings routes
  // only — nothing else, and never in English.
  const C5_RENAMES = new Map([["Fiscal Year", "السنة المالية"], ["VAT Configuration", "إعدادات ضريبة القيمة المضافة"]]);
  const c5Renamed = (k, gone, came) => /^settings-(org|team)[|-]/.test(k) && k.includes("|ar|") && gone.length === came.length && gone.every((g) => C5_RENAMES.has(g))
    && JSON.stringify([...came].sort()) === JSON.stringify(gone.map((g) => C5_RENAMES.get(g)).sort());
  const c5renamed = [];
  // C4 adds no control; it has two intended state changes: the report picker's buttons say whether they are
  // pressed — pressed=true on the report shown, pressed=false on the other seven — and the statement's
  // Client / Vendor links say which is the current page (current=page on the kind shown). The baseline's
  // lists are read with exactly those states applied; everything else must match as before.
  const c4Intended = (k, a) => {
    const [id, l] = k.split("|");
    const [kind, name, href, type, state] = a.split("|");
    if (id.startsWith("reports-") && kind === "button" && type === "type=button" && !state && Object.values(C4_WORDS[l].kinds).includes(name))
      return [kind, name, href, type, `pressed=${name === C4_WORDS[l].kinds[reportOf(id)]}`].join("|");
    if (id.startsWith("statement") && kind === "link" && /^\/finance\/statements\?kind=(client|vendor)$/.test(href) && !state)
      return [kind, name, href, type, href.endsWith(`kind=${id.includes("vendor") ? "vendor" : "client"}`) ? "current=page" : ""].join("|");
    return a;
  };
  for (const group of ["owner", "staff"])
    for (const k of Object.keys(acts[group]).filter(rebased)) {
      const split = (a) => { const [kind, name, ...rest] = a.split("|"); return [[kind, ...rest].join("|"), name]; };
      const groups = (xs) => xs.map(split).reduce((m, [r, n]) => m.set(r, [...(m.get(r) ?? []), n].sort()), new Map());
      // A route the baseline does not have yet is recorded, not compared (C4 records its three new routes on
      // C3's build first, so its own re-record compares them like the rest).
      if (!baseActs[group][k]) { fresh.push(`${group} ${k}: ${acts[group][k].length} actions`); continue; }
      const applied = baseActs[group][k].map((a) => c4Intended(k, a));
      const changed = applied.filter((a, i) => a !== baseActs[group][k][i]);
      if (changed.length) stated.push(`${group} ${k}: ${changed.length} × ${[...new Set(changed.map((a) => a.split("|").pop().replace(/=.*/, "")))].join(", ")} (${changed.map((a) => `${a.split("|")[1]}: ${a.split("|").pop()}`).join(", ")})`);
      const was = groups(applied);
      const is = groups(acts[group][k]);
      const intended = new Map(k.startsWith("hr-employees|") ? [["button||type=button|pressed=true", [ALL_DEPARTMENTS[k.split("|")[1]]]], ["button||type=button|pressed=false", [...deptNames].sort()]] :
        // C3: the populated project's task cards, buttons now (they were divs with onClick, not actions) —
        // one each, named title / status / priority / assignee as the database says, in the page's language.
        k.startsWith("project-detail|") ? [["button||type=button|", projDb.tasks.map((task) => taskName(k.split("|")[1], task).replace(/\s+/g, " ").trim().slice(0, 80)).sort()]] : []);
      for (const [r] of intended) if (!is.has(r) && !was.has(r)) problems.push(`${group} ${k}: no intended addition × ${r}`);
      for (const r of new Set([...was.keys(), ...is.keys()])) {
        const a = [...(was.get(r) ?? [])];
        const b = [...(is.get(r) ?? [])];
        if (!a.length && intended.has(r)) {
          if (JSON.stringify(b) === JSON.stringify(intended.get(r))) added.push(`${group} ${k}: + ${b.length} × ${r} (${b.join(", ")})`);
          else problems.push(`${group} ${k}: added ${JSON.stringify(b)} ≠ intended ${JSON.stringify(intended.get(r))} (${r})`);
          continue;
        }
        if (a.length !== b.length) { problems.push(`${group} ${k}: ${a.length}→${b.length} × ${r}`); continue; }
        const gone = a.filter((x) => !b.includes(x));
        const came = b.filter((x) => !a.includes(x));
        if (!gone.length) continue;
        if (!k.includes("|en|") && gone.every(isC1Literal) && came.every((x) => /[\u0600-\u06FF]/.test(x))) renamed.push(`${group} ${k}: "${gone.join('", "')}" → "${came.join('", "')}"`);
        else if (c5Renamed(k, gone, came)) c5renamed.push(`${group} ${k}: "${gone.join('", "')}" → "${came.join('", "')}" (${r})`);
        else problems.push(`${group} ${k}: ${gone.join(", ")} → ${came.join(", ")} (${r})`);
      }
    }
  console.log(`• action names translated in the re-recorded routes (${renamed.length}):`);
  for (const x of renamed) console.log(`    ${x}`);
  console.log(`• C5's two Settings tab labels, now in Arabic (${c5renamed.length} groups):`);
  for (const x of c5renamed) console.log(`    ${x}`);
  console.log(`• actions added in the re-recorded routes (${added.length}):`);
  for (const x of added) console.log(`    ${x}`);
  console.log(`• C4 intended state changes in the re-recorded routes (${stated.length} lists):`);
  for (const x of stated) console.log(`    ${x}`);
  if (fresh.length) {
    console.log(`• routes recorded for the first time (${fresh.length} lists; nothing to compare them with):`);
    for (const x of fresh) console.log(`    ${x}`);
  }
  check(`re-recorded routes: actions equivalent to the baseline — same kinds, targets, types and states; English names unchanged; Arabic names changed only from C1 page copy to Arabic (${renamed.length} lists) or, C5's two Business Settings tab labels, from Fiscal Year / VAT Configuration to السنة المالية / إعدادات ضريبة القيمة المضافة (${c5renamed.length} groups); added only the intended controls — C2's department filters, C3's task-card buttons (${added.length} groups); C4's intended states only — the report picker's pressed=true / false, the statement links' current=page (${stated.length} lists)`,
    problems.length === 0, list(problems));
}

// ------------------------------------------------------------------------------------- C1 targets
// The 12 master-data and entity-detail pages, EN and AR at every width (96 states).
const c1Keys = keys.filter((k) => C1_ROUTES.includes(k.split("|")[0]));
const c1 = (pred) => c1Keys.filter((k) => !pred(now.states[k], k));
check(`C1: the ${C1_ROUTES.length} master-data / entity-detail routes were measured (${c1Keys.length} states)`, ONLY || c1Keys.length === C1_ROUTES.length * 8, c1Keys.length);
const phBad = c1((s) => s.pageHeader?.n === 1 && s.pageHeader.h1Inside && s.pageHeader.metaFirst && s.pageHeader.titleAtStart && s.pageHeader.trailing !== "misplaced" && !s.pageHeader.overlap);
check("C1: one PageHeader per page, holding the page's only h1; meta before actions; title at the inline start; meta / actions at the inline end of its line or wrapped below at the start, never over the title",
  phBad.length === 0, list(phBad.map((k) => `${k} ${JSON.stringify(now.states[k].pageHeader)}`)));
const hBad = c1((s) => s.h1 === 1 && s.skips === 0);
check("C1: exactly one h1 and no heading-level skip on every C1 page (EN / AR, all widths) — client and vendor detail jumped h1 → h3", hBad.length === 0, list(hBad.map((k) => `${k} h1=${now.states[k].h1} skips=${now.states[k].skips}`)));
const DETAIL = ["client-detail", "vendor-detail", "product-detail"];
const dBad = c1((s, k) => !DETAIL.includes(k.split("|")[0]) || (s.outline?.[0]?.startsWith("h1 ") && s.outline.length > 1 && s.outline.slice(1).every((o) => o.startsWith("h2 "))));
check("C1: entity detail outlines are the entity's h1, then h2 sections only (side cards, Statement of Account)", dBad.length === 0, list(dBad.map((k) => `${k} ${JSON.stringify(now.states[k].outline)}`)));
const oBad = c1((s) => s.overflow === 0 && s.offenders === 0);
check("C1: no page overflow and no element past the viewport on any C1 page at any width — client detail at 390 was 65 px (EN) / 54 px (AR)", oBad.length === 0, list(oBad.map((k) => `${k} ${now.states[k].overflow}px ${now.states[k].offenders} el`)));
const litBad = c1((s, k) => !k.includes("|ar|") || (s.c1Literals ?? []).length === 0);
check(`C1: in Arabic, no C1 page copy renders in English (${C1_LITERALS.exact.length} strings, ${C1_LITERALS.prefixes.length} prefixes; ${c1Keys.filter((k) => k.includes("|ar|")).length} states)`,
  litBad.length === 0, list(litBad.map((k) => `${k} ${JSON.stringify(now.states[k].c1Literals)}`)));
// The scan is not blind: in English the same copy is found on every C1 page that carries any.
const COPY = ["client-detail", "client-new", "client-bin", "vendor-detail", "vendor-new", "vendor-bin", "product-detail", "product-new", "product-bin"];
const blind = COPY.filter((id) => !c1Keys.some((k) => k.startsWith(`${id}|en|`) && (now.states[k].c1Literals ?? []).length > 0));
check(`C1: …and the scan sees that copy in English on each of the ${COPY.length} pages that carry it (a control)`, ONLY || blind.length === 0, blind.join(" "));

// ------------------------------------------------------------------------------------- C2 targets
// The seven HR routes, EN and AR at every width (56 states), and the two probes.
const c2Keys = keys.filter((k) => C2_ROUTES.includes(k.split("|")[0]));
const c2 = (pred) => c2Keys.filter((k) => !pred(now.states[k], k));
const show = (f) => (k) => `${k} ${f(now.states[k])}`;
check(`C2: the ${C2_ROUTES.length} HR routes were measured (${c2Keys.length} states)`, ONLY || c2Keys.length === C2_ROUTES.length * 8, c2Keys.length);
const c2Ph = c2((s) => s.pageHeader?.n === 1 && s.pageHeader.h1Inside && s.pageHeader.metaFirst && s.pageHeader.titleAtStart && s.pageHeader.trailing !== "misplaced" && !s.pageHeader.overlap);
check("C2: one PageHeader per HR page, holding its only h1; meta before actions; title at the inline start; meta / actions at the end of its line or below it, never over it",
  c2Ph.length === 0, list(c2Ph.map(show((s) => JSON.stringify(s.pageHeader)))));
const c2Out = c2((s, k) => JSON.stringify(s.outline) === JSON.stringify(C2_OUTLINES[k.split("|")[0]][k.split("|")[1]]) && s.h1 === 1 && s.skips === 0);
check("C2: every HR outline is C1's title as the one h1 (the employee's name and code on the detail), then Salary Structure / Past payroll runs as h2s; no skip (EN / AR, all widths)",
  c2Out.length === 0, list(c2Out.map(show((s) => JSON.stringify(s.outline)))));
const c2Ov = c2((s) => s.overflow === 0 && s.offenders === 0);
check("C2: no page overflow, nothing past the viewport, on any HR page at any width — Payroll at 390 was 57 px (EN) / 40 px (AR), Employees 1 px (EN)",
  c2Ov.length === 0, list(c2Ov.map(show((s) => `${s.overflow}px ${s.offenders} el`))));
const c2Err = c2((s) => !s.consoleErrors && !s.pageErrors && !s.r418);
check("C2: zero console errors, page errors and React #418 on every HR state", c2Err.length === 0, list(c2Err.map(show((s) => JSON.stringify(s.errorSample)))));
const c2Ind = c2((s) => s.indic === 0);
check("C2: no Arabic-Indic digit on any HR page — C1 wrote the Arabic Attendance date and Payroll month in them", c2Ind.length === 0, list(c2Ind.map(show((s) => s.indic))));
const c2Ptr = c2((s) => s.pointerOnly === 0);
check("C2: nothing on an HR page is clickable by pointer only — the four department chips were spans with onClick", c2Ptr.length === 0, list(c2Ptr.map(show((s) => s.pointerOnly))));
check(`C2: formatDisplayDate writes the frozen day and month as ${["en", "ar"].map((l) => `"${C2_DATES.day[l]}" / "${C2_DATES.month[l]}"`).join(", ")} — Gregorian, Western digits`,
  ["en", "ar"].every((l) => now.c2.dates[l]?.day === C2_DATES.day[l] && now.c2.dates[l]?.month === C2_DATES.month[l]), JSON.stringify(now.c2.dates));
const c2Date = c2((s, k) => {
  const [id, locale] = k.split("|");
  if (id === "hr-attendance") return s.pageHeader?.meta === C2_DATES.day[locale];
  if (id === "hr-payroll") return s.pageHeader?.title === `${PAYROLL_WORD[locale]} — ${C2_DATES.month[locale]}`;
  return true;
});
check("C2: the Attendance pill (PageHeader meta) is that day and the Payroll title that month, to the character (EN / AR, all widths)", c2Date.length === 0,
  list(c2Date.map(show((s) => `${s.pageHeader?.title} | ${s.pageHeader?.meta}`))));

// The department filter, EN / AR at 1440 and 390, against the database: "All departments" and then the
// departments by name; the chosen one pressed (aria-pressed and .active), no other; its employees' cards.
const deptCards = (i) => (i === 0 ? deptDb.emps : deptDb.emps.filter((e) => e.department_id === deptDb.depts[i - 1].id)).map((e) => e.name);
const deptFilters = (locale, i) => [ALL_DEPARTMENTS[locale], ...deptDb.depts.map((d) => d.name)].map((name, j) => `button|button|${name}|${j === i}|${j === i ? "active" : ""}`);
const deptRuns = Object.entries(now.c2.dept);
const deptBad = { keyboard: [], pointer: [] };
for (const [run, { steps, errors }] of deptRuns) {
  const locale = run.split("|")[0];
  if (errors.length) deptBad.keyboard.push(`${run}: ${errors[0]}`);
  for (const s of steps) {
    const why = [];
    if (JSON.stringify(s.filters) !== JSON.stringify(deptFilters(locale, s.index))) why.push(`filters ${JSON.stringify(s.filters)}`);
    if (JSON.stringify(s.cards) !== JSON.stringify(deptCards(s.index))) why.push(`cards ${JSON.stringify(s.cards)} ≠ ${JSON.stringify(deptCards(s.index))}`);
    if (s.keyboard && !(s.focus?.index === s.index && s.focus.focusVisible && s.focus.ring !== "none")) why.push(`focus ${JSON.stringify(s.focus)}`);
    if (s.tabs === null) why.push("Tab never reached the filters");
    if (why.length) deptBad[s.step === "click" ? "pointer" : "keyboard"].push(`${run} ${s.step} → ${s.index}: ${why.join("; ")}`);
  }
}
const deptKeys = deptRuns.flatMap(([, r]) => r.steps.filter((s) => s.keyboard));
check(`C2: department filter by keyboard — "All departments" starts pressed; Tab reaches it and each department button; Enter and Space choose; aria-pressed and .active on the chosen one only; a visible focus ring; the cards the database says (${deptDb?.depts.length} departments, ${deptDb?.emps.length} employees; EN / AR at 1440 and 390, ${deptKeys.length} keyboard steps)`,
  (ONLY && !deptRuns.length) || ((ONLY || deptRuns.length === 4) && deptDb?.depts.length >= 2 && deptKeys.some((s) => s.step.includes("Enter")) && deptKeys.some((s) => s.step.includes("Space")) && deptBad.keyboard.length === 0), list(deptBad.keyboard));
check("C2: …and by pointer, as before C2: clicking each filter shows exactly that",
  (ONLY && !deptRuns.length) || ((ONLY || deptRuns.length === 4) && deptRuns.every(([, r]) => r.steps.filter((s) => s.step === "click").length === deptDb.depts.length + 1) && deptBad.pointer.length === 0), list(deptBad.pointer));

// Payroll, EN / AR: the layout at every width; the rows by keyboard at 1440 and 390.
const payRuns = Object.entries(now.c2.payroll);
const payBad = { keys: [], layout: [] };
for (const [run, { steps, errors }] of payRuns) {
  const wide = Number(run.split("|")[1]) > 1100;
  const L = steps[0].layout;
  if (!L || L.tracks !== (wide ? 2 : 1) || !(wide ? L.sideBySide : L.stacked) || !L.inViewport || !L.lastColumn?.reachable || (L.lastColumn.scrolls && !/auto|scroll/.test(L.lastColumn.overflowX)))
    payBad.layout.push(`${run} ${JSON.stringify(L)}`);
  if (errors.length) payBad.keys.push(`${run}: ${errors[0]}`);
  const names = steps[0].rows.map((r) => r.split("|")[0]);
  if (names.length < 2) payBad.keys.push(`${run}: ${names.length} payroll rows — the probe needs two`);
  for (const s of steps) {
    const why = [];
    const sel = s.rows.map((r) => r.split("|")[1]);
    if (sel.filter((x) => x === "true").length !== 1 || sel[s.index] !== "true") why.push(`aria-selected ${sel.join(",")}`);
    if (!s.rows.every((r) => r.endsWith("|0"))) why.push("a row left the tab order");
    if (!s.slip?.endsWith(`— ${names[s.index]}`)) why.push(`payslip "${s.slip}"`);
    if (s.keyboard && !(s.focus === s.index && s.focusVisible)) why.push(`focus ${s.focus} ${s.focusVisible}`);
    if (s.tabs === null) why.push("Tab never reached a row");
    if (why.length) payBad.keys.push(`${run} ${s.step} → ${s.index}: ${why.join("; ")}`);
  }
}
const payKeys = payRuns.flatMap(([, r]) => r.steps.filter((s) => s.keyboard));
check(`C2: payroll rows by keyboard, as before — Tab reaches each row, Enter and Space select it (aria-selected moves, the payslip follows), focus visible (EN / AR at 1440 and 390, ${payKeys.length} keyboard steps)`,
  (ONLY && !payRuns.length) || ((ONLY || payRuns.length === 8) && payKeys.some((s) => s.step.includes("Enter")) && payKeys.some((s) => s.step.includes("Space")) && payBad.keys.length === 0), list(payBad.keys));
check("C2: payroll layout — table and payslip side by side at 1440, stacked below 1100 px (1024 / 768 / 390), both inside the viewport, the table's last column reachable by scrolling it (EN / AR)",
  (ONLY && !payRuns.length) || ((ONLY || payRuns.length === 8) && payBad.layout.length === 0), list(payBad.layout));

// ------------------------------------------------------------------------------------- C3 targets
// The four Projects routes, EN and AR at every width (32 states); the project pass; the three probes.
const c3Keys = keys.filter((k) => C3_ROUTES.includes(k.split("|")[0]));
const c3 = (pred) => c3Keys.filter((k) => !pred(now.states[k], k));
check(`C3: the ${C3_ROUTES.length} Projects routes were measured (${c3Keys.length} states)`, ONLY || c3Keys.length === C3_ROUTES.length * 8, c3Keys.length);
const c3Ph = c3((s) => s.pageHeader?.n === 1 && s.pageHeader.h1Inside && s.pageHeader.metaFirst && s.pageHeader.titleAtStart && s.pageHeader.trailing !== "misplaced" && !s.pageHeader.overlap);
check("C3: one PageHeader per Projects page, holding its only h1; meta (the project's pill) before actions (its status select); title at the inline start; meta / actions at the end of its line or below it, never over it",
  c3Ph.length === 0, list(c3Ph.map(show((s) => JSON.stringify(s.pageHeader)))));
const c3Out = c3((s, k) => {
  const [id, l] = k.split("|");
  return JSON.stringify(s.outline) === JSON.stringify(c3Outline(id, l, projDb.names)) && s.h1 === 1 && s.skips === 0;
});
check("C3: every Projects outline exact — the list and New Project their h1; a project its name (h1), Project Revenue & Costs (h2; C8 final — it was Cost & Profitability) › Revenue, Costs (h3), Tasks (h2) › To do, In progress, Blocked, Done (h3, the registry's labels; populated project only), Time logged this week, Linked Documents (h2); no skip (EN / AR, all widths)",
  c3Out.length === 0, list(c3Out.map(show((s) => JSON.stringify(s.outline)))));
const c3Ov = c3((s) => s.overflow === 0 && s.offenders === 0 && s.tablesBeyond === 0);
check("C3: no page overflow, nothing past the viewport, no table beyond it, on any Projects page at any width", c3Ov.length === 0, list(c3Ov.map(show((s) => `${s.overflow}px ${s.offenders} el ${s.tablesBeyond} tables`))));
const c3Err = c3((s) => !s.consoleErrors && !s.pageErrors && !s.r418);
check("C3: zero console errors, page errors and React #418 on every Projects state", c3Err.length === 0, list(c3Err.map(show((s) => JSON.stringify(s.errorSample)))));
const c3Ind = c3((s) => s.indic === 0);
check("C3: Western digits — no Arabic-Indic digit on any Projects page", c3Ind.length === 0, list(c3Ind.map(show((s) => s.indic))));
const c3Ptr = c3((s) => s.pointerOnly === 0);
check("C3: nothing on a Projects page is clickable by pointer only — the eight task cards were divs with onClick", c3Ptr.length === 0, list(c3Ptr.map(show((s) => s.pointerOnly))));
const c3Staff = Object.entries(now.staff).filter(([k]) => C3_ROUTES.includes(k.split("|")[0]));
check("C3: permissions — Staff open the four Projects routes where they are, as the baseline says",
  (ONLY && !c3Staff.length) || ((ONLY || c3Staff.length === 8) && c3Staff.every(([k, v]) => v.status === 200 && v.finalPath === ROUTES.find((r) => r[0] === k.split("|")[0])[1] && BS[k]?.finalPath === v.finalPath)),
  list(c3Staff.filter(([k, v]) => v.status !== 200 || BS[k]?.finalPath !== v.finalPath).map(([k, v]) => `${k} ${v.status} ${v.finalPath}`)));

// The project pass: composition at every width (targets) and what C2 drew (the c3ref record).
const c3Ref = (WRITE ? null : pinned.c3ref) ?? null;
const C3R = scoped(c3Ref?.states ?? {});
const c3L = Object.entries(now.c3.layout);
const c3Lbad = (pred) => c3L.filter(([k, v]) => !pred(v, k)).map(([k]) => k);
const lshow = (f) => (k) => `${k} ${f(now.c3.layout[k])}`;
check(`C3 project pass: both projects measured at every width, EN / AR (${c3L.length} states), each answering 200 with no error`,
  (ONLY ? true : c3L.length === 16) && c3Lbad((v) => v.status === 200 && !v.consoleErrors && !v.pageErrors && !v.r418 && v.overflow === 0).length === 0, list(c3Lbad((v) => v.status === 200 && !v.consoleErrors && !v.pageErrors && !v.r418)));
check(`C3 record: c3ref covers every state of the pass (measured on ${c3Ref?.recordedOn?.commit?.slice(0, 7) ?? "—"}, src ${c3Ref?.recordedOn?.srcClean ? "clean" : "MODIFIED"}, build ${c3Ref?.recordedOn?.build ?? "—"})`,
  c3Ref?.recordedOn?.srcClean === true && c3L.every(([k]) => C3R[k]), list(c3L.filter(([k]) => !C3R[k]).map(([k]) => k)));
const W_ = (k) => C3_WORDS[k.split("|")[1]];
const summaryBad = c3Lbad((v, k) => {
  const s = v.summary;
  return s && s.tracks === 2 && s.cards === 2 && s.perRow === 2 && s.lines === 1 && s.width <= 520.5 && !s.clipped && !s.outside &&
    s.facts[0].label === W_(k).budget && s.facts[1].label.startsWith(`${W_(k).tasks} · `) && s.facts[1].label.endsWith(W_(k).hoursLogged);
});
check("C3 project summary: two across at every width (StatRow columns 2) inside its 520px — Budget, then Tasks · <hours> hours logged — nothing clipped",
  summaryBad.length === 0, list(summaryBad.map(lshow((s) => JSON.stringify(s.summary && [s.summary.tracks, s.summary.perRow, s.summary.width, s.summary.facts.map((f) => f.label)])))));
// C8 (D-2): Cost & Profitability is four factual cards — StatRow columns={4}, two across at ≤640 px (D-6).
const costBad = c3Lbad((v, k) => {
  const c = v.cost;
  const phone = k.endsWith("|390");
  return c && c.cards === 4 && c.tracks === (phone ? 2 : 4) && c.perRow === (phone ? 2 : 4) && c.lines === (phone ? 2 : 1) && !c.clipped && !c.outside &&
    JSON.stringify(c.facts.map((f) => f.label)) === JSON.stringify(W_(k).kpis);
});
check("C3 Cost & Profitability, C8's D-2 applied: exactly four cards — Sales Value, Invoiced, Collected, Total Cost — four across above 640 px (1440 / 1024 / 768) and two across at 390 (D-6); nothing clipped or past the viewport",
  costBad.length === 0, list(costBad.map(lshow((s) => JSON.stringify(s.cost && [s.cost.tracks, s.cost.perRow, s.cost.lines, s.cost.clipped, s.cost.facts.map((f) => f.label)])))));
const colourBad = c3Lbad((v) => {
  const f = v.cost?.facts ?? [];
  const plain = f[0]?.ink;
  return f.length === 4 && plain && f.every((x) => x.ink === plain);
});
check("C3 D-6 colour, C8's D-2 applied: all four figures drawn in the one plain value colour — no health colour anywhere in the row (Collected's green and Total Cost's warning gone since C3)",
  colourBad.length === 0, list(colourBad.map(lshow((s) => JSON.stringify(s.cost?.facts.map((f) => f.ink))))));
// The c3ref record (C2's build) is kept, not re-recorded: what must be shown now is derived from it — the summary as
// recorded, and the cost row's first four figures (Actual Profit and Profit Margin, its last two, are D-2's).
const sameFigures = c3Lbad((v, k) => C3R[k] && JSON.stringify(v.summary?.facts.map(({ label, value }) => ({ label, value }))) === JSON.stringify(C3R[k].summary) &&
  Array.isArray(C3R[k].cost) && C3R[k].cost.length === 6 && JSON.stringify(v.cost?.facts.map(({ label, value }) => ({ label, value }))) === JSON.stringify(C3R[k].cost.slice(0, 4)));
check("D-2 applied, values held: every factual figure C2 showed is shown, to the character — Budget, Tasks · hours, Sales Value, Invoiced, Collected, Total Cost — on both projects, every width, EN / AR (derived from the c3ref record, not re-recorded: its first four cost figures)",
  sameFigures.length === 0, list(sameFigures.map((k) => `${k} ${JSON.stringify(C3R[k]?.cost?.slice(0, 4))} → ${JSON.stringify(now.c3.layout[k].cost?.facts.map((f) => f.value))}`)));
const hiddenBad = c3Lbad((v, k) => v.badge === null && Array.isArray(v.d2Says) && v.d2Says.length === 0 && C3R[k]?.badge && W_(k).hidden.length === 2);
check("D-2 applied: no project_health badge on the page (C2 drew one beside Cost & Profitability, c3ref) and no Actual Profit or Profit Margin — not in the text, not in an accessible name or tooltip — on both projects, every width, EN / AR",
  hiddenBad.length === 0, list(hiddenBad.map(lshow((s) => JSON.stringify({ badge: s.badge, says: s.d2Says })))));
const bdBad = c3Lbad((v, k) => {
  const b = v.breakdown;
  const wide = Number(k.split("|")[2]) > 900;
  return b && b.cards === 2 && b.tracks === (wide ? 2 : 1) && (wide ? b.sideBySide : b.stacked) && b.inViewport && !b.clipped &&
    JSON.stringify(b.headings) === JSON.stringify([`h3 ${W_(k).revenue}`, `h3 ${W_(k).costs}`]);
});
check("C3 cost breakdown: Revenue and Costs (h3s) side by side at 1440 and 1024, stacked at 768 and 390 (≤900 px), inside the viewport, neither card clipped",
  bdBad.length === 0, list(bdBad.map(lshow((s) => JSON.stringify(s.breakdown)))));
const kbBad = c3Lbad((v, k) => (k.startsWith("project-empty|") ? v.kanban === null : v.kanban && C3R[k] && JSON.stringify(v.kanban) === JSON.stringify(C3R[k].kanban) && v.kanban.tracks === (k.endsWith("|1440") ? 4 : 2)));
check("C3 kanban layout as C2's: four columns at 1440, two at 1024, 768 and 390 (its own mobile rule, not redesigned); no board on the empty project",
  kbBad.length === 0, list(kbBad.map(lshow((s) => JSON.stringify(s.kanban)))));
const numAll = [...c3L.map(([k, v]) => [k, v.numeric]), ...Object.entries(now.c3.hours).map(([k, v]) => [`hours ${k}`, v.numeric])];
const numBad = numAll.flatMap(([k, cells]) => cells.filter((c) => !(c.align === "end" && c.cell === "numeric" && c.endGap !== undefined && c.endGap <= 1)).map((c) => `${k} ${c.col} ${c.tag} "${c.text}" ${c.align} gap ${c.endGap}`));
const amountSeen = c3L.filter(([, v]) => v.numeric.some((c) => c.tag === "td")).length;
const hoursRuns = Object.values(now.c3.hours);
check(`C3 logical numeric columns: Amount (Linked Documents) and Hours (time logged — one fixture log) — header and every cell — sit at the inline end in EN and AR: text-align end, the table's numeric cell, flush with the end padding (${numAll.reduce((n, [, c]) => n + c.length, 0)} cells)`,
  numBad.length === 0 && (ONLY || amountSeen === 16) && (ONLY && !hoursRuns.length || (hoursRuns.length === 4 && hoursRuns.every((h) => h.numeric.some((c) => c.tag === "td" && c.text === "2.5") && !h.errors.length && h.overflow === 0))),
  list(numBad));
// §36: the kanban cards, C2's div vs C3's button — computed style and geometry at rest and hovered; the heads.
const factsDiff = [];
for (const [k, v] of c3L) {
  const ref = C3R[k]?.kanbanFacts;
  if (!v.kanbanFacts) continue;
  if (!ref) { factsDiff.push(`${k}: no record`); continue; }
  const byTitle = (xs) => Object.fromEntries((xs ?? []).filter(Boolean).map((c) => [c.title, c]));
  for (const [what, a, b] of [["card", byTitle(ref.cards), byTitle(v.kanbanFacts.cards)], ["hovered", byTitle(ref.hover), byTitle(v.kanbanFacts.hover)]]) {
    if (JSON.stringify(Object.keys(a).sort()) !== JSON.stringify(Object.keys(b).sort())) factsDiff.push(`${k} ${what}s: ${Object.keys(a)} → ${Object.keys(b)}`);
    for (const t of Object.keys(a)) {
      if (!b[t]) continue;
      if (a[t].box !== b[t].box) factsDiff.push(`${k} ${what} "${t}" box ${a[t].box} → ${b[t].box}`);
      const sa = a[t].style.split("|"), sb = b[t].style.split("|");
      CARD_PROPS.forEach((p, i) => sa[i] !== sb[i] && factsDiff.push(`${k} ${what} "${t}" ${p}: ${sa[i]} → ${sb[i]}`));
      if (JSON.stringify(a[t].inner) !== JSON.stringify(b[t].inner)) factsDiff.push(`${k} ${what} "${t}" inside: ${JSON.stringify(a[t].inner).slice(0, 120)} → ${JSON.stringify(b[t].inner).slice(0, 120)}`);
    }
  }
  // A head's label element changes tag on purpose (span → h3); everything else about it is compared.
  const heads = (xs) => JSON.stringify((xs ?? []).map((h) => Object.fromEntries(Object.entries(h).filter(([f]) => f !== "tag"))));
  if (heads(ref.heads) !== heads(v.kanbanFacts.heads)) factsDiff.push(`${k} heads: ${heads(ref.heads).slice(0, 160)} → ${heads(v.kanbanFacts.heads).slice(0, 160)}`);
  if (!v.kanbanFacts.heads.every((h) => h.tag === "h3")) factsDiff.push(`${k} heads: not h3`);
}
const kfStates = c3L.filter(([, v]) => v.kanbanFacts).length;
check(`C3 kanban visual equivalence (C2 div → C3 button): every card's ${CARD_PROPS.length} computed properties (width, height, border, radius, background, shadow, padding, margin, font, colour, text-align, cursor, transform…), its box in the column and everything inside it — at rest and hovered — and every column head (label now an h3: same box, same type) are C2's, at 1440 and 390, EN / AR (${kfStates} states)`,
  (ONLY || kfStates === 4) && factsDiff.length === 0, list(factsDiff));

// §34: the kanban by keyboard (blocking) and by pointer.
const nameOf = (l, id) => { const t = projDb.tasks.find((x) => String(x.id) === String(id)); return t ? taskName(l, t) : null; };
const rowOf = (id) => projDb.tasks.find((x) => String(x.id) === String(id));
const kRuns = Object.entries(now.c3.kanban);
const kBad = [];
for (const [run, r] of kRuns) {
  const l = run.split("|")[0];
  const W = C3_WORDS[l];
  if (r.errors.length) kBad.push(`${run}: ${r.errors[0]}`);
  if (!r.unchanged) kBad.push(`${run}: a task changed in the database`);
  const s0 = r.steps[0];
  const expectNames = projDb.tasks.map((t) => `${t.id}|button|button|${taskName(l, t)}|false`).sort();
  if (JSON.stringify([...s0.names].sort()) !== JSON.stringify(expectNames)) kBad.push(`${run}: card names ${JSON.stringify(s0.names)}`);
  const kinds = r.steps.map((s) => s.kind).join(",");
  if (kinds !== "focus,open,return,open,return,focus,open,return,new,return-add,open,return") kBad.push(`${run}: steps ${kinds} (a step was never reached)`);
  for (const s of r.steps) {
    const why = [];
    const keyboard = !s.pointer;
    if (JSON.stringify(s.board) !== JSON.stringify(s0.board)) why.push("the board changed");
    if (s.kind === "focus") {
      if (!(s.focus?.card >= 0 && s.focus.tag === "button" && s.focus.type === "button")) why.push(`focus ${JSON.stringify(s.focus)}`);
      else if (!(s.focus.focusVisible && s.focus.ring && s.focus.ring.token && parseFloat(s.focus.ring.width) >= 2)) why.push(`no focus ring ${JSON.stringify(s.focus)}`);
      else if (s.focus.name !== nameOf(l, s.focus.taskId)) why.push(`name "${s.focus.name}" ≠ "${nameOf(l, s.focus.taskId)}"`);
    }
    if (s.kind === "open") {
      const t = rowOf(s.opener?.taskId);
      if (!s.ok || !s.dialog || s.dialog.title !== W.editTask || !t || s.dialog.taskTitle !== t.title || s.dialog.status !== TASK_STATUS[l][t.status]) why.push(`dialog ${JSON.stringify(s.dialog)} for ${JSON.stringify(s.opener)}`);
    }
    if (s.kind === "return") {
      if (!s.ok || s.dialog) why.push("the dialog did not close");
      if (!(s.focus?.same && s.focus.card >= 0)) why.push(`focus not back on the card that opened it: ${JSON.stringify(s.focus)}`);
      else if (keyboard && !(s.focus.focusVisible && s.focus.ring?.token)) why.push(`focus back without its ring ${JSON.stringify(s.focus)}`);
    }
    if (s.kind === "new" && (!s.ok || s.dialog?.title !== W.newTask || s.opener?.text !== W.addTask)) why.push(`Add Task: ${JSON.stringify(s.dialog)} ${JSON.stringify(s.opener)}`);
    if (s.kind === "return-add" && (!s.ok || s.dialog || !s.focus?.same || s.focus.name !== W.addTask)) why.push(`Add Task focus: ${JSON.stringify(s.focus)}`);
    if (why.length) kBad.push(`${run} ${s.step}: ${why.join("; ")}`);
  }
}
check(`C3 kanban by keyboard (blocking; EN / AR at 1440 and 390): Tab reaches a task card — a real button with the focus ring in the --focus colour and its full name (title, status, priority, assignee / Unassigned; all ${projDb?.tasks.length} cards); Enter opens Edit Task for that task; Escape closes and focus is back on that very card; Space opens it again; the close button closes, focus back; Save closes, focus back; Add Task opens New Task and Escape returns to it; no task changes`,
  (ONLY && !kRuns.length) || ((ONLY || kRuns.length === 4) && projDb?.tasks.length === 8 && kBad.length === 0), list(kBad));
check("C3 kanban by pointer, as before: clicking a card opens Edit Task for it, the close button closes it and focus returns to that card; the board and the database unchanged",
  (ONLY && !kRuns.length) || ((ONLY || kRuns.length === 4) && kRuns.every(([, r]) => r.steps.filter((s) => s.pointer).length === 2) && !kBad.some((x) => /click/.test(x))), list(kBad.filter((x) => /click/.test(x))));
// §35: the empty project.
const eRuns = Object.entries(now.c3.empty);
const eBad = [];
for (const [run, r] of eRuns) {
  const l = run.split("|")[0];
  const f = r.facts;
  if (r.errors.length) eBad.push(`${run}: ${r.errors[0]}`);
  if (!(f.tasksH2 && f.addTask && f.emptyState && f.emptyAfterHead && f.kanban === 0 && f.overflow === 0)) eBad.push(`${run}: ${JSON.stringify(f)}`);
  const kinds = r.steps.map((s) => s.kind).join(",");
  if (kinds !== "focus-add,new,return-add") eBad.push(`${run}: steps ${kinds}`);
  for (const s of r.steps) {
    if (s.kind === "focus-add" && !(s.focus?.name === C3_WORDS[l].addTask && s.focus.focusVisible)) eBad.push(`${run} ${s.step}: ${JSON.stringify(s.focus)}`);
    if (s.kind === "new" && !(s.ok && s.dialog?.title === C3_WORDS[l].newTask)) eBad.push(`${run} ${s.step}: ${JSON.stringify(s.dialog)}`);
    if (s.kind === "return-add" && !(s.ok && !s.dialog && s.focus?.same && s.focus.focusVisible)) eBad.push(`${run} ${s.step}: ${JSON.stringify(s.focus)}`);
  }
}
check(`C3 empty kanban (EN / AR at 1440 and 390; the seeded project with ${projDb?.emptyTasks} tasks): the Tasks h2 with Add Task beside it, the EmptyState after it, no column or card; Tab reaches Add Task, Enter opens New Task, Escape returns to it; no error, no overflow`,
  (ONLY && !eRuns.length) || ((ONLY || eRuns.length === 4) && projDb?.emptyTasks === 0 && eBad.length === 0), list(eBad));

// ------------------------------------------------------------------------------------- C4 targets
// The 14 finance routes, EN and AR at every width (112 states); the ledger / chart gate; the value pass held
// to c4ref; the three probes.
const c4Keys = keys.filter((k) => C4_ROUTES.includes(k.split("|")[0]));
const c4 = (pred) => c4Keys.filter((k) => !pred(now.states[k], k));
const pathOf = (k) => ROUTES.find((r) => r[0] === k.split("|")[0])?.[1];
check(`C4: the ${C4_ROUTES.length} finance routes were measured (${c4Keys.length} states; ${C4_NEW.join(", ")} new in C4)`, ONLY || c4Keys.length === C4_ROUTES.length * 8, c4Keys.length);
const c4Route = c4((s, k) => s.status === 200 && s.finalPath === pathOf(k));
check("C4: every finance route answers 200 where it is — each report, statement and party variant included", c4Route.length === 0, list(c4Route.map(show((s) => `${s.status} ${s.finalPath}`))));
const c4Ph = c4((s) => s.pageHeader?.n === 1 && s.pageHeader.h1Inside && s.pageHeader.metaFirst && s.pageHeader.titleAtStart && s.pageHeader.trailing !== "misplaced" && !s.pageHeader.overlap);
check("C4: one PageHeader per finance page, holding its only h1 (Financial Reports with CSV / Excel / PDF, Payment Records with Record Payment, New Journal Entry with its Manual pill, Bank Accounts with New Account); meta before actions; the title at the inline start; meta / actions at the end of its line or below it, never over it",
  c4Ph.length === 0, list(c4Ph.map(show((s) => JSON.stringify(s.pageHeader)))));
const c4Out = c4((s, k) => {
  const [id, l] = k.split("|");
  return JSON.stringify(s.outline) === JSON.stringify(c4Outline(id, l, now.c4.ledger[k]?.selected)) && s.h1 === 1 && s.skips === 0;
});
check("C4: every finance outline exact — the page title the h1 (an h3 in C3); the selected report (Profit & Loss, Trial Balance, AR Aging, General Ledger, VAT Summary) the h2; on Ledger and Chart of Accounts the selected account (code · name, as its row lists it) the h2; Recent journal entries and Recent payment records h2s; the statements and Payment Records their h1 alone; no skip (EN / AR, all widths)",
  c4Out.length === 0, list(c4Out.map(show((s) => JSON.stringify(s.outline)))));
const c4Ov = c4((s) => s.overflow === 0 && s.offenders === 0 && s.tablesBeyond === 0);
check("C4: no page overflow, nothing past the viewport and no table beyond it on any finance page at any width — Ledger and Chart of Accounts at 390 were 139 px (EN) / 122 px (AR), 2 elements, 1 table",
  c4Ov.length === 0, list(c4Ov.map(show((s) => `${s.overflow}px ${s.offenders} el ${s.tablesBeyond} tables`))));
const c4Err = c4((s) => !s.consoleErrors && !s.pageErrors && !s.r418);
check("C4: zero console errors, page errors and React #418 on every finance state", c4Err.length === 0, list(c4Err.map(show((s) => JSON.stringify(s.errorSample)))));
const c4Ind = c4((s) => s.indic === 0);
check("C4: Western digits — no Arabic-Indic digit on any finance page", c4Ind.length === 0, list(c4Ind.map(show((s) => s.indic))));
// New Journal Entry's form is not C4's (journal-form.tsx is byte-pinned; its controls are DEV-UI-01.8's).
const JOURNAL_FORM = { unnamed: 6, pointerOnly: 1 };
const c4Ctl = c4((s, k) => s.unnamed === (k.startsWith("journal|") ? JOURNAL_FORM.unnamed : 0) && s.pointerOnly === (k.startsWith("journal|") ? JOURNAL_FORM.pointerOnly : 0));
check("C4: every control named and nothing pointer-only on the finance pages — the report search (unnamed in C3) now named; New Journal Entry keeps exactly its form's 6 unnamed line inputs and pointer-only Add line (JournalForm untouched, deferred to DEV-UI-01.8)",
  c4Ctl.length === 0, list(c4Ctl.map(show((s) => `unnamed ${s.unnamed}, pointer-only ${s.pointerOnly}`))));
const c4Staff = Object.entries(now.staff).filter(([k]) => C4_ROUTES.includes(k.split("|")[0]));
check("C4: permissions — Staff open the 14 finance routes where they are, as the baseline says (as in C3)",
  (ONLY && !c4Staff.length) || ((ONLY || c4Staff.length === 28) && c4Staff.every(([k, v]) => v.status === 200 && v.finalPath === pathOf(k) && BS[k]?.finalPath === v.finalPath)),
  list(c4Staff.filter(([k, v]) => v.status !== 200 || v.finalPath !== pathOf(k) || BS[k]?.finalPath !== v.finalPath).map(([k, v]) => `${k} ${v.status} ${v.finalPath}`)));

// §42: the ledger / chart gate (blocking).
const lg = Object.entries(now.c4.ledger);
const lgBad = lg.filter(([k, f]) => {
  const [, l, w] = k.split("|");
  const wide = Number(w) > 1100;
  const sel = f?.selected;
  return !(f && f.tracks === (wide ? 2 : 1) && (!wide || f.first === "280px") && (wide ? f.sideBySide : f.stacked) && f.listIn && f.detailIn &&
    sel && sel.code === finDb.first.code && (l === "en" ? sel.name === finDb.first.name : /[؀-ۿ]/.test(sel.name)) &&
    f.table && f.scroll && f.scroll.inView && f.scroll.lastReachable && (w !== "390" || f.scroll.scrollWidth > f.scroll.clientWidth) &&
    f.add && f.add.inView && f.add.hit && !f.add.disabled);
}).map(([k, f]) => `${k} ${JSON.stringify(f)}`);
check(`C4 ledger / chart gate (blocking; Ledger and Chart of Accounts, EN / AR, every width — ${lg.length} states): two panes at 1440 (the 280px account list beside the ledger), one track at 1024 / 768 / 390 (the ledger below the list); both panes inside the viewport; the first account (${finDb?.first?.code} · ${finDb?.first?.name}) selected; the ledger table scrolling inside its own container (wider than it at 390) with its last column reachable; Add Account inside the viewport and hit-testable`,
  (ONLY && !lg.length) || ((ONLY || lg.length === 16) && lgBad.length === 0), list(lgBad));

// §47 / §48: what every report and statement says, against what C3's build said (c4ref).
const c4Ref = (WRITE ? null : pinned.c4ref) ?? null;
const C4R = c4Ref?.states ?? {};
const vals = Object.entries(now.c4.values);
const ERR_FIELDS = ["consoleErrors", "pageErrors", "r418", "errorSample"];
const valErr = vals.filter(([k, v]) => (!k.includes("+") && v.status !== 200) || v.consoleErrors || v.pageErrors || v.r418 || v.opened === false || v.closed === false)
  .map(([k, v]) => `${k} ${v.status ?? ""} ${JSON.stringify(v.errorSample ?? "")}`);
const nValues = C4_VALUE_CASES.length * 4 + (Object.keys(C4_SEARCH).length + Object.keys(C4_DRILL).length + Object.keys(C4_FROM).length) * 2;
check(`C4 value pass: ${C4_VALUE_CASES.length} report and statement cases × EN / AR × 1440 / 390 (${vals.filter(([k]) => !k.includes("+")).length} states) and ${vals.filter(([k]) => k.includes("+")).length} interactions (a search, a drill-down, a statement filter) measured, each answering 200 with no error`,
  (ONLY && !vals.length) || ((ONLY || vals.length === nValues) && valErr.length === 0), list(valErr));
check(`C4 record: c4ref covers every state of the pass (measured on ${c4Ref?.recordedOn?.commit?.slice(0, 7) ?? "—"}, src ${c4Ref?.recordedOn?.srcClean ? "clean" : "MODIFIED"}, build ${c4Ref?.recordedOn?.build ?? "—"})`,
  (ONLY && !vals.length) || (c4Ref?.recordedOn?.srcClean === true && vals.every(([k]) => C4R[k]) && (ONLY || Object.keys(C4R).every((k) => now.c4.values[k]))), list(vals.filter(([k]) => !C4R[k]).map(([k]) => k)));
// C8 final (the product owner's policy): a P&L state (the default route, ?report=pl, against the previous period, the P&L
// search) must say exactly what C3's build said without its three profit figures — the Gross Profit card and row (the
// remediation's), the Net Profit card, the Operating Profit and Net Profit / (Loss) rows — and with the notice right after
// its one card; a Balance Sheet state exactly what C3's build said with its current-period line marked Preliminary and
// the disclosure closing it. Derived from the c4ref record, not re-recorded: a card's lines (label, value and, against
// the previous period, its delta) and a row's two lines leave the body, the cards and the line count follow, and the
// figures are re-read from what is left (in c4ref they are exactly the body's numbers, in order). Every other state is
// held to its record as it stands.
const NUMBERS = /[-−]?\(?\d[\d,]*(?:\.\d+)?\)?%?/g;
const P_NOTICE = "Profit figures are temporarily hidden because Cost of Sales and inventory valuation are not yet complete.";
const B_NOTICE = "Preliminary — Cost of Sales and inventory valuation are incomplete. The current-period result may change.";
const CP_LINE = "Current-period Profit / (Loss)";
const isPnl = (k) => /^report-(default|pl|pl-compare|pl\+search)\|/.test(k);
const isBs = (k) => /^report-bs(-compare)?\|/.test(k);
function withoutProfit(ref, l) {
  if (!ref?.body || !ref.cards || !ref.rows) return null;
  const body = [...ref.body];
  let cards = [...ref.cards];
  for (const label of ["Gross Profit", "Net Profit"]) {
    const card = cards.find((c) => c.split(" / ")[0].toLowerCase() === T(l, label).toLowerCase());
    const lines = card?.split(" / ") ?? [];
    const at = card ? body.findIndex((_, i) => lines.every((x, j) => body[i + j] === x)) : -1;
    if (at < 0) return null;
    body.splice(at, lines.length);
    cards = cards.filter((c) => c !== card);
  }
  for (const label of ["Gross Profit", "Operating Profit", "Net Profit / (Loss)"]) {
    const row = body.indexOf(T(l, label));
    if (row < 0) return null;
    body.splice(row, 2);
  }
  if (cards.length !== 1) return null;
  body.splice(cards[0].split(" / ").length, 0, T(l, P_NOTICE));
  return { ...ref, body, figures: body.join("\n").match(NUMBERS) ?? [], rows: [ref.rows[0] - 3, ...ref.rows.slice(1)], cards };
}
function preliminary(ref, l) {
  const at = ref?.body ? ref.body.indexOf(T(l, CP_LINE)) : -1;
  if (at < 0) return null;
  const body = [...ref.body];
  body[at] = `${body[at]} ${T(l, "Preliminary")}`;
  return { ...ref, body: [...body, T(l, B_NOTICE)] };
}
const c4Expect = (k) => (isPnl(k) ? withoutProfit(C4R[k], k.split("|")[1]) : isBs(k) ? preliminary(C4R[k], k.split("|")[1]) : C4R[k]);
const valueDiff = (pred) => vals.filter(([k]) => pred(k) && C4R[k]).flatMap(([k, v]) => {
  const ref = c4Expect(k);
  if (!ref) return [`${k}: its c4ref state lacks what C8 final's expectation is derived from`];
  return [...new Set([...Object.keys(ref), ...Object.keys(v)])].filter((f) => !ERR_FIELDS.includes(f) && JSON.stringify(v[f]) !== JSON.stringify(ref[f]))
    .map((f) => `${k} ${f}: ${JSON.stringify(ref[f]).slice(0, 90)} → ${JSON.stringify(v[f]).slice(0, 90)}`);
});
const reportDiff = valueDiff((k) => k.startsWith("report-"));
check("C4 report value equality (§47, blocking; C8 final's policy applied): the eight reports — and P&L / Balance Sheet / Cash Flow / VAT against the previous period, an account's General Ledger, a custom-range Trial Balance — say exactly what C3's build said (the P&L states without their three profit figures and with the notice, the Balance Sheet states with the Preliminary line and the disclosure — derived from c4ref): every line, figure and row count, every summary card (value, delta, balance badge), every drill target, the title and range, the picker, presets, dates and compare toggle, the CSV / Excel / PDF links; the search's result and the drill-down's drawer the same (EN / AR, 1440 and 390)",
  reportDiff.length === 0, list(reportDiff));
const statementDiff = valueDiff((k) => k.startsWith("statement-"));
check("C4 statement value equality (§48, blocking): the client and vendor statements, with a party and without, say exactly what C3's build said — the Client / Vendor links, the party, every line, filter and date, every table row (opening, transactions, debit / credit, running balance, closing); after the from-date filter the same (EN / AR, 1440 and 390)",
  statementDiff.length === 0, list(statementDiff));
// The policy on its own, too.
const plVals = vals.filter(([k]) => isPnl(k));
const profitWords = (l) => ["Gross Profit", "Net Profit", "Operating Profit"].map((w) => T(l, w).toLowerCase());
const finPlBad = plVals.filter(([k, v]) => {
  const l = k.split("|")[1];
  return !(v.body && v.cards && v.cards.length === 1 && v.cards[0].split(" / ")[0].toLowerCase() === T(l, "Revenue").toLowerCase() &&
    !v.body.some((x) => profitWords(l).some((w) => x.toLowerCase().includes(w))) && v.body.filter((x) => x === T(l, P_NOTICE)).length === 1);
}).map(([k]) => k);
check("C8 final P&L (blocking; the default route, ?report=pl, against the previous period and the P&L search — EN / AR, 1440 / 390): Revenue is the one summary card; no Gross Profit, Operating Profit or Net Profit card, row or word anywhere in the report; the notice once, in the page's language — every line, figure, drill target and delta as C3's build said (above)",
  (ONLY && !vals.length) || (plVals.length === 14 && finPlBad.length === 0), list(finPlBad));
const bsVals = vals.filter(([k]) => isBs(k));
const finBsBad = bsVals.filter(([k, v]) => {
  const l = k.split("|")[1], ref = C4R[k];
  const at = ref?.body ? ref.body.indexOf(T(l, CP_LINE)) : -1;
  return !(at >= 0 && v.body?.[at] === `${T(l, CP_LINE)} ${T(l, "Preliminary")}` && v.body[at + 1] === ref.body[at + 1] && v.body[v.body.length - 1] === T(l, B_NOTICE) &&
    JSON.stringify(v.cards) === JSON.stringify(ref.cards) && JSON.stringify(v.figures) === JSON.stringify(ref.figures) && JSON.stringify(v.rows) === JSON.stringify(ref.rows));
}).map(([k]) => k);
check("C8 final Balance Sheet (blocking; ?report=bs and against the previous period — EN / AR, 1440 / 390): Current-period Profit / (Loss) keeps its line and its amount (c4ref's) and reads Preliminary; the disclosure closes the statement in the page's language; every figure — the assets, liabilities and equity lines, Retained Earnings, the current-period amount, Total Assets, Total Liabilities, Total Equity, Total Liabilities + Equity — and the four cards, the balance check Balanced among them, as C3's build said",
  (ONLY && !vals.length) || (bsVals.length === 8 && finBsBad.length === 0), list(finBsBad));
// Print: the P&L and the Balance Sheet as a printed page carries them.
const prRuns = Object.entries(now.c8.print);
const prBad = prRuns.filter(([k, r]) => {
  const [kind, l] = k.split("|");
  return !(r.area && r.stray === 0 && r.title.length >= 2 && r.body.length > 0 && JSON.stringify(r.body) === JSON.stringify(r.screen) &&
    r.notes.length === 1 && r.notes[0].shown && r.notes[0].text === T(l, kind === "pl" ? P_NOTICE : B_NOTICE));
}).map(([k, r]) => `${k} ${JSON.stringify({ area: r.area, stray: r.stray, sample: r.straySample, title: r.title, notes: r.notes, lines: r.body.length, screen: r.screen?.length })}`);
check("C8 final print (blocking; EN / AR at 1440): in print media the P&L and the Balance Sheet carry the report — its title and range, every line the screen shows, the notice or the disclosure (shown, in the page's language) — and nothing of the app shell or the workspace controls (before C8 final a printed report was blank: the shell's preview-print rule hid it)",
  (ONLY && !prRuns.length) || ((ONLY || prRuns.length === 4) && prBad.length === 0), list(prBad));
// Exports: held to c8ref, the approved remediation's build — the P&L and the Balance Sheet with the policy's changes only.
const C8R = (WRITE ? null : pinned.c8ref) ?? null;
const DROPPED = ["Gross Profit", "Operating Profit", "Net Profit / (Loss)"];
const htmlEsc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function c8Export(key, ref) {
  const [kind, format] = key.split("|");
  if (!ref || (kind !== "pl" && kind !== "bs")) return ref;
  const note = kind === "pl" ? P_NOTICE : B_NOTICE;
  if (format === "csv") {
    const lines = ref.text.replace(/^﻿/, "").split("\r\n");
    const rows = kind === "pl" ? lines.filter((l) => !DROPPED.some((x) => l.startsWith(`,${x},`))) : lines.map((l) => (l.startsWith(`Equity,${CP_LINE},`) ? l.replace(`Equity,${CP_LINE},`, `Equity,${CP_LINE} (Preliminary),`) : l));
    return { ...ref, text: "﻿" + [`Note,${note}`, "", ...rows].join("\r\n") };
  }
  if (format === "xlsx") {
    let html = ref.text.replace("</h3>", `</h3><table style="margin-bottom:10px"><tbody><tr><td style="border:none;font-weight:bold">Note</td><td style="border:none">${htmlEsc(note)}</td></tr></tbody></table>`);
    if (kind === "pl") for (const x of DROPPED) html = html.replace(new RegExp(`<tr><td></td><td>${reEsc(htmlEsc(x))}</td><td>[^<]*</td></tr>`), "");
    else html = html.replace(`<td>${CP_LINE}</td>`, `<td>${CP_LINE} (Preliminary)</td>`);
    return { ...ref, text: html };
  }
  const [title, ...rest] = ref.lines;
  const rows = kind === "pl" ? rest.filter((l) => !DROPPED.some((x) => l.startsWith(` | ${x} | `)))
    : rest.map((l) => (l.startsWith(`Equity | ${CP_LINE} | `) ? l.replace(`Equity | ${CP_LINE} | `, `Equity | ${CP_LINE} (Preliminary) | `) : l));
  return { ...ref, lines: [title, `Note: ${note.replace(/[–—]/g, "-")}`, ...rows] };
}
const exRuns = Object.entries(now.c8.exports);
const exDiff = exRuns.flatMap(([k, v]) => {
  const want = c8Export(k, C8R?.exports?.[k]);
  if (!want) return [`${k}: not in the c8ref record`];
  return [...new Set([...Object.keys(want), ...Object.keys(v)])].filter((f) => JSON.stringify(v[f]) !== JSON.stringify(want[f]))
    .map((f) => `${k} ${f}: ${JSON.stringify(want[f]).slice(0, 90)} → ${JSON.stringify(v[f]).slice(0, 90)}`);
});
check(`C8 final exports (blocking; the eight kinds × CSV / Excel / PDF, an EN and an AR session — held to c8ref, measured on ${C8R?.recordedOn?.commit?.slice(0, 7) ?? "—"}, src ${C8R?.recordedOn?.srcClean ? "clean" : "MODIFIED"}, build ${C8R?.recordedOn?.build ?? "—"}): the P&L says exactly what the approved remediation's build said without its Gross Profit, Operating Profit and Net Profit / (Loss) rows and with the notice in its header block; the Balance Sheet with its current-period line marked (Preliminary) — its amount unchanged — and the disclosure in its header block; Cash Flow, Trial Balance, General Ledger, AR / AP Aging and VAT Summary to the byte (CSV, Excel) and to the text (PDF); every status, content type and file name as recorded`,
  (ONLY && !exRuns.length) || (!!C8R?.recordedOn?.srcClean && exRuns.length === REPORT_KINDS.length * 6 && exDiff.length === 0), list(exDiff));
// The shared exporter (report-export.ts, unchanged) clips a cell at its column's width ("..."): the eight- and nine-column
// Trial Balance, General Ledger and AR Aging have always clipped long names and memos, and c8ref holds those PDFs to their
// recorded text (above). What C8 final writes must not be clipped: the P&L's and the Balance Sheet's every cell and note.
const exFit = exRuns.filter(([k]) => k.includes("|pdf|")).filter(([k, v]) => v.pages === null || v.overflow.length || (/^(pl|bs)\|/.test(k) && v.clipped.length))
  .map(([k, v]) => `${k} ${JSON.stringify({ pages: v.pages, overflow: v.overflow, clipped: v.clipped })}`);
const exClipped = exRuns.filter(([k, v]) => k.includes("|pdf|") && v.clipped?.length).map(([k, v]) => `${k.replace("|pdf", "")} ${v.clipped.length}`);
check(`C8 final PDF exports readable and whole (blocking): every PDF loads and no text runs past the right margin; nothing in the P&L or the Balance Sheet is clipped ("...") — each note one whole header line, the marked line inside its column (the exporter's own clipping of long names in the wider reports, as c8ref recorded it: ${exClipped.join(", ") || "none"})`,
  (ONLY && !exRuns.length) || (exRuns.some(([k]) => /^(pl|bs)\|pdf\|/.test(k)) && exFit.length === 0), list(exFit));
const acc = now.c8.access, accRef = C8R?.access ?? null;
check("C8 final export authorization unchanged (blocking): without a session the export URL answers as recorded — a redirect to /login, no report — and as Staff as recorded",
  (ONLY && !exRuns.length) || (!!accRef && JSON.stringify(acc.anonymous) === JSON.stringify(accRef.anonymous) && acc.anonymous?.status !== 200 && acc.anonymous?.location === "/login" &&
    JSON.stringify(acc.staff) === JSON.stringify(accRef.staff)), JSON.stringify({ acc, accRef }));

const tenantRuns = Object.entries(now.c8.tenant);
const amounts = (text) => new Set((text ?? "").match(/-?\d+\.\d{2}\b/g)?.filter((x) => Number(x) !== 0) ?? []);
const tenantBad = tenantRuns.flatMap(([kind, t]) => {
  const leaked = [...amounts(t.text)].filter((x) => amounts(now.c8.exports[`${kind}|csv|en`]?.text).has(x));
  return t.status !== 200 || leaked.length ? [`${kind} ${t.status}: the seeded org's ${leaked.slice(0, 4).join(", ")}`] : [];
});
// The kinds where the seeded org has an amount to recognise (its AP Aging has no open payable at the range's end).
const tenantCompared = tenantRuns.filter(([kind]) => amounts(now.c8.exports[`${kind}|csv|en`]?.text).size).map(([kind]) => kind);
check(`C8 final export tenant scope (blocking): an org registered in this run asks for the eight CSV exports — each answers 200 and carries none of the seeded org's amounts (compared on the ${tenantCompared.length} kinds that have one: ${tenantCompared.join(", ") || "none"}) — the route scopes every query to the session's org; the proxy alone would not show it`,
  (ONLY && !exRuns.length) || ((ONLY || tenantRuns.length === REPORT_KINDS.length) && tenantCompared.length >= 7 && tenantBad.length === 0), list(tenantBad));

// §43: the report picker by keyboard (blocking).
const pRuns = Object.entries(now.c4.picker);
const pBad = [];
const STEP_URLS = ["/finance/reports", "/finance/reports", "/finance/reports?report=tb", "/finance/reports?report=vat", "/finance/reports?report=pl"];
for (const [run, r] of pRuns) {
  const [l, w] = run.split("|");
  const W = C4_WORDS[l];
  if (r.errors.length) pBad.push(`${run}: ${r.errors[0]}`);
  const kinds = r.steps.map((s) => s.kind).join(",");
  if (kinds !== "pl,pl,tb,vat,pl") pBad.push(`${run}: steps ${kinds} (a step was never reached)`);
  r.steps.forEach((s, i) => {
    const why = [];
    const want = W.kinds[s.kind];
    const pressed = s.buttons.filter((b) => b.pressed === "true");
    if (JSON.stringify(s.buttons.map((b) => b.label)) !== JSON.stringify(REPORT_KINDS.map((k) => W.kinds[k]))) why.push(`toggles ${JSON.stringify(s.buttons.map((b) => b.label))}`);
    if (pressed.length !== 1 || pressed[0].label !== want) why.push(`pressed ${JSON.stringify(pressed.map((b) => b.label))}`);
    if (!s.buttons.every((b) => ["true", "false"].includes(b.pressed) && (b.pressed === "true") === b.active && b.type === "button")) why.push("aria-pressed is not the shown-active state on every toggle");
    if (s.url !== STEP_URLS[i]) why.push(`URL ${s.url}`);
    if (s.h2 !== want || s.h2s !== 1) why.push(`h2 "${s.h2}" (${s.h2s} h2s)`);
    const ref = c4Expect(`report-${i < 2 ? "default" : s.kind}|${l}|${w}`); // C8 final: a P&L step without its profit figures, with the notice
    if (!ref) why.push("no c4ref state to compare with (or none to derive C8 final's P&L expectation from)");
    else {
      if (JSON.stringify(s.exports) !== JSON.stringify(ref.exports.map((e) => e.slice(e.indexOf(" ") + 1)))) why.push(`exports ${JSON.stringify(s.exports)}`);
      const drift = ["title", "body", "figures", "rows", "cards", "drills", "dates", "compare"].filter((f) => JSON.stringify(s.facts?.[f]) !== JSON.stringify(ref[f]));
      if (drift.length) why.push(`the report drifted: ${drift.join(", ")}`);
    }
    if (s.keyboard && !(s.focus === REPORT_KINDS.indexOf(s.kind) && s.focusVisible)) why.push(`focus ${s.focus} (visible ${s.focusVisible})`);
    if (s.tabs === null) why.push("Tab never reached the picker");
    if (why.length) pBad.push(`${run} ${s.step}: ${why.join("; ")}`);
  });
  if (!(r.search.label === W.search && r.search.placeholder === W.search && r.search.named === 1)) pBad.push(`${run}: search ${JSON.stringify(r.search)}`);
}
check(`C4 report picker by keyboard (blocking; EN / AR at 1440 and 390): eight toggle buttons, exactly one pressed — the report shown — and aria-pressed equal to .active on each; Tab reaches the picker (Profit & Loss), Tab ×3 + Enter shows Trial Balance, Tab ×4 + Space VAT Summary, Shift+Tab ×7 + Enter Profit & Loss again — each time the URL, the pressed toggle, the h2, the CSV / Excel / PDF links and the report itself (as C3's build said it) follow and focus stays on the toggle; the search box named "${C4_WORDS.en.search}" / "${C4_WORDS.ar.search}" (its placeholder's words)`,
  (ONLY && !pRuns.length) || ((ONLY || pRuns.length === 4) && pBad.length === 0), list(pBad));

// §44: the statement's Client / Vendor links (blocking).
const lRuns = Object.entries(now.c4.links);
const lBad = [];
for (const [run, r] of lRuns) {
  const [l, w] = run.split("|");
  const W = C4_WORDS[l];
  if (r.errors.length) lBad.push(`${run}: ${r.errors[0]}`);
  const kinds = r.steps.map((s) => s.kind).join(",");
  if (kinds !== "client,client,vendor,vendor,client") lBad.push(`${run}: steps ${kinds} (a step was never reached)`);
  for (const s of r.steps) {
    const why = [];
    if (JSON.stringify(s.links.map((x) => [x.label, x.href])) !== JSON.stringify([[W.client, "/finance/statements?kind=client"], [W.vendor, "/finance/statements?kind=vendor"]])) why.push(`links ${JSON.stringify(s.links)}`);
    const cur = s.links.filter((x) => x.current === "page");
    if (cur.length !== 1 || !cur[0].href.endsWith(`kind=${s.kind}`) || s.links.some((x) => (x.current === "page") !== x.active || (x.current !== null && x.current !== "page")))
      why.push(`current ${JSON.stringify(s.links.map((x) => [x.label, x.current, x.active]))}`);
    if (s.url !== `/finance/statements?kind=${s.kind}`) why.push(`URL ${s.url}`);
    if (s.h1 !== W.statements) why.push(`h1 "${s.h1}"`);
    if (s.keyboard && !(s.focus === (s.to === "vendor" ? 1 : 0) && s.focusVisible)) why.push(`focus ${s.focus} (visible ${s.focusVisible})`);
    if (s.tabs === null) why.push("Tab never reached the link");
    // The statement itself renders as C3's build rendered that page (c4ref).
    const ref = C4R[`statement-${s.kind}|${l}|${w}`];
    if (!ref || ["tabs", "lines", "tables", "inputs", "selects"].some((f) => JSON.stringify(s.facts?.[f]) !== JSON.stringify(ref[f]))) why.push("the statement drifted from C3's");
    if (why.length) lBad.push(`${run} ${s.step}: ${why.join("; ")}`);
  }
}
check(`C4 statement links (blocking; EN / AR at 1440 and 390): Client and Vendor stay links to ?kind=client / ?kind=vendor; the one shown — and only it — is aria-current="page", exactly its .active; Tab to Vendor and Enter: the URL is ?kind=vendor, Vendor current, Client not; Tab to Client and Enter: back; the h1 stays and the statement renders as C3's build rendered it`,
  (ONLY && !lRuns.length) || ((ONLY || lRuns.length === 4) && lBad.length === 0), list(lBad));

// §45: the empty states (blocking).
const EMPTY_WANT = (name, l) => {
  const W = C4_WORDS[l];
  return {
    "no-account-ledger": { outline: [`h1 ${W.ledger}`], empty: [[W.select, `h1 ${W.ledger}`]] },
    "no-account-coa": { outline: [`h1 ${W.coa}`], empty: [[W.select, `h1 ${W.coa}`]] },
    "no-transactions": { outline: null, empty: [[W.noTx, null]] },
    "no-payments": { outline: [`h1 ${W.payments}`], empty: [[W.noPayments, `h1 ${W.payments}`]] },
    "no-journal": { outline: [`h1 ${W.journal}`, `h2 ${W.recentJournal}`], empty: [[W.noJournal, `h2 ${W.recentJournal}`]] },
    "no-recent-payments": { outline: [`h1 ${W.bank}`, `h2 ${W.recentPayments}`], empty: [[W.noPayments, `h2 ${W.recentPayments}`]] },
    "no-bank-accounts": { outline: [`h1 ${W.bank}`, `h2 ${W.recentPayments}`], empty: [[W.noBanks, `h1 ${W.bank}`], [W.noPayments, `h2 ${W.recentPayments}`]] },
  }[name];
};
const org4 = now.c4.emptyOrg;
const e4Runs = Object.entries(now.c4.empty);
const e4Bad = [];
for (const [k, s] of e4Runs) {
  const [name, l] = k.split("|");
  const W = C4_WORDS[l];
  const want = EMPTY_WANT(name, l);
  const why = [];
  // The page's own action survives its empty state (and none moves into the EmptyState: no invented CTA).
  const act = { "no-account-ledger": W.addAccount, "no-account-coa": W.addAccount, "no-transactions": W.addAccount, "no-payments": W.recordPayment, "no-recent-payments": W.newAccount, "no-bank-accounts": W.newAccount }[name];
  if (act && !(s.actions ?? []).some((a) => a.startsWith(`button|${act}|`))) why.push(`no "${act}" action`);
  if ((s.empty ?? []).some((e) => e.controls !== 0)) why.push("a control inside an EmptyState (an invented CTA)");
  if (s.consoleErrors || s.pageErrors || s.r418) why.push(JSON.stringify(s.errorSample));
  if (s.overflow !== 0 || s.offenders !== 0) why.push(`overflow ${s.overflow}px ${s.offenders} el`);
  if (s.h1 !== 1 || s.skips !== 0) why.push(`h1 ${s.h1}, skips ${s.skips}`);
  if (name === "no-transactions") {
    // The fresh org's first account, as the ledger lists it: its code and English name; in Arabic its Arabic name.
    const h2 = s.outline?.[1] ?? "";
    const first = org4?.first;
    if (!(s.outline?.length === 2 && s.outline[0] === `h1 ${C4_WORDS[l].ledger}` && first && h2.startsWith(`h2 ${first.code} · `) && (l === "en" ? h2 === `h2 ${first.code} · ${first.name}` : /[؀-ۿ]/.test(h2))))
      why.push(`outline ${JSON.stringify(s.outline)}`);
    want.empty[0][1] = h2;
  } else if (JSON.stringify(s.outline) !== JSON.stringify(want.outline)) why.push(`outline ${JSON.stringify(s.outline)}`);
  if (JSON.stringify((s.empty ?? []).map((e) => [e.text, e.after])) !== JSON.stringify(want.empty) || !(s.empty ?? []).every((e) => e.visible && e.inView)) why.push(`empty states ${JSON.stringify(s.empty)}`);
  if (why.length) e4Bad.push(`${k}: ${why.join("; ")}`);
}
check(`C4 empty states (blocking; EN / AR at 1440 and 390 — ${e4Runs.length} states): an EmptyState after the heading it belongs to — no account selected (Ledger, Chart of Accounts); and, in an org registered through the UI in this TEST-ONLY copy (${org4 ? `${org4.banks} starter bank account, ${org4.payments} payments, ${org4.journal} journal entries` : "—"}): no transactions (its first account's ledger), no payment records (Payments; Bank Accounts' recent records), no journal entries, and — its bank account deleted (${org4?.deleted ?? "—"} row) — no bank accounts; each visible and inside the viewport; the page's outline exact; no overflow, no error`,
  (ONLY && !e4Runs.length) || ((ONLY || e4Runs.length === 28) && org4?.banks === 1 && org4.payments === 0 && org4.journal === 0 && org4.deleted === 1 && e4Bad.length === 0), list(e4Bad));

// ------------------------------------------------------------------------------------- C5 targets
// The 14 Settings routes, EN and AR at every width (112 states; seven of them new in C5); SettingsNav and D-7
// on every Business Settings state; the probes.
const c5Keys = keys.filter((k) => C5_ROUTES.includes(k.split("|")[0]));
const c5 = (pred) => c5Keys.filter((k) => !pred(now.states[k], k));
const c5Final = (k) => (k.startsWith("settings-team|") ? "/settings/organization?tab=team" : pathOf(k));
const dirOf = (l) => (l === "ar" ? "rtl" : "ltr");
check(`C5: the ${C5_ROUTES.length} Settings routes were measured (${c5Keys.length} states; ${C5_NEW.join(", ")} new in C5)`, ONLY || c5Keys.length === C5_ROUTES.length * 8, c5Keys.length);
const c5Route = c5((s, k) => s.status === 200 && s.finalPath === c5Final(k));
check("C5: every Settings route answers 200 where it is — each Business Settings tab; /settings/team still redirects to its Team tab (/settings/organization?tab=team)",
  c5Route.length === 0, list(c5Route.map(show((s) => `${s.status} ${s.finalPath}`))));
const c5Ph = c5((s) => s.pageHeader?.n === 1 && s.pageHeader.h1Inside && s.pageHeader.metaFirst && s.pageHeader.titleAtStart && s.pageHeader.trailing !== "misplaced" && !s.pageHeader.overlap);
check("C5: one PageHeader per Settings page, holding its only h1 — Business Settings (above its navigation, whichever tab), Presets, Security Center (the owner's risk pill as meta, outside the h1), Security & Compliance Readiness (its disclaimer the description); the title at the inline start, nothing overlapping it",
  c5Ph.length === 0, list(c5Ph.map(show((s) => JSON.stringify(s.pageHeader)))));
const c5Out = c5((s, k) => {
  const [id, l] = k.split("|");
  return JSON.stringify(s.outline) === JSON.stringify(c5Outline(id, l)) && s.h1 === 1 && s.skips === 0;
});
check("C5: every Settings outline exact, no level skipped — Business Settings the h1 with the shown panel's title its h2 (Roles & Permissions keeps its subsection, now an h3); Presets the h1; Security Center the h1 with Two-Factor Authentication, Password, Active Sessions and Security Timeline as h2s; Security & Compliance Readiness the h1 › Readiness checklist (h2) › GDPR, ISO 27001 — roadmap, Platform security (h3s), Data Subject Rights and Consent Management (h2s) — in the dictionary's words",
  c5Out.length === 0, list(c5Out.map(show((s) => JSON.stringify(s.outline)))));
const c5Ov = c5((s) => s.overflow === 0 && s.offenders === 0 && s.tablesBeyond === 0);
check("C5: no page overflow, nothing past the viewport and no table beyond it on any Settings page at any width — at 390 Business Settings was 92 px (Color Theme), 80 px (Business Details), 44 px (Team), Compliance 32 px",
  c5Ov.length === 0, list(c5Ov.map(show((s) => `${s.overflow}px ${s.offenders} el ${s.tablesBeyond} tables`))));
const c5Err = c5((s) => !s.consoleErrors && !s.pageErrors && !s.r418);
check("C5: zero console errors, page errors and React #418 on every Settings state", c5Err.length === 0, list(c5Err.map(show((s) => JSON.stringify(s.errorSample)))));
const c5Ind = c5((s) => s.indic === 0);
check("C5: Western digits — no Arabic-Indic digit on any Settings page", c5Ind.length === 0, list(c5Ind.map(show((s) => s.indic))));
const c5Risk = c5((s, k) => !k.startsWith("settings-security|") || s.pageHeader?.meta === `${T(k.split("|")[1], "Risk")}: ${T(k.split("|")[1], "Low")}` && s.pageHeader.title === T(k.split("|")[1], "Security Center"));
check("C5 Security Center (owner): the risk pill is the PageHeader's meta — Risk: Low (no alert) — and not in the h1, which reads Security Center alone", c5Risk.length === 0,
  list(c5Risk.map(show((s) => JSON.stringify(s.pageHeader)))));

// SettingsNav on every Business Settings state (the ten tabs and /settings/team: 88).
const NAV_ORDER = C5_NAV.map(([v]) => v);
const navBad = Object.entries(now.c5.nav).filter(([k, f]) => {
  const [id, l, w] = k.split("|");
  const tab = C5_TABS[id];
  const wide = Number(w) >= 768;
  return !(f && f.rootDir === dirOf(l) && f.orientation === "vertical" && f.navAtStart && f.navInView && f.panelInView
    && f.align.length === 1 && f.align[0] === "start" && f.itemDir.length === 1 && f.itemDir[0] === dirOf(l)
    && JSON.stringify(f.order) === JSON.stringify(NAV_ORDER) && JSON.stringify(f.labels) === JSON.stringify(C5_NAV.map(([, en]) => T(l, en)))
    && JSON.stringify(f.groups) === JSON.stringify(C5_GROUPS.map((g) => T(l, g))) && JSON.stringify(f.active) === JSON.stringify([tab]) && f.panel === tab
    && (wide
      ? f.flexDirection === "row" && f.beside && !f.stacked && f.panelAfter && f.navWidth === 224
      : f.flexDirection === "column" && f.stacked && !f.beside && f.navWidth === f.rootWidth && f.panelWidth === f.rootWidth));
}).map(([k, f]) => `${k} ${JSON.stringify(f)}`);
check("C5 SettingsNav (blocking; Business Settings, EN / AR, every width — 88 states): the Radix root's dir is the document's (rtl in Arabic; left to itself Radix wrote ltr); a vertical list at the inline start with the panel after it from 768 px (1440 / 1024 / 768: side by side, the list 224 px), full width above the panel below (390: stacked, both the root's width — D-7); the items aligned to the start, in the document's direction; the ten tabs in SETTINGS_TABS order with their labels and the four groups — Fiscal Year, VAT Configuration, Users and Integrations in Arabic too; the tab asked for active (color-theme by default)",
  (ONLY && !Object.keys(now.c5.nav).length) || (navBad.length === 0 && (ONLY || Object.keys(now.c5.nav).length === 88)), list(navBad));
const d7Bad = Object.entries(now.c5.d7).filter(([k, f]) => {
  const [l, w] = k.split("|");
  return !(f && f.rootDir === dirOf(l) && f.overflow === 0 && !f.consoleErrors && !f.pageErrors && !f.r418 && f.navAtStart
    && (w === "767" ? f.flexDirection === "column" && f.stacked && f.navWidth === f.rootWidth && f.panelWidth === f.rootWidth : f.flexDirection === "row" && f.beside && f.panelAfter && f.navWidth === 224));
}).map(([k, f]) => `${k} ${JSON.stringify(f)}`);
check("C5 D-7 breakpoint (blocking; EN / AR): 767 px — a column, the navigation full width above the panel; 768 px (md) — a row, the 224 px navigation at the inline start and the panel after it; no overflow either side",
  (ONLY && !Object.keys(now.c5.d7).length) || (d7Bad.length === 0 && (ONLY || Object.keys(now.c5.d7).length === 4)), list(d7Bad));
const KEY_WANT = ["business-details", "business-details", "logo", "color-theme", "logo", "zatca", "business-details", "business-details", "business-details"];
const keyBad = [];
for (const [run, r] of Object.entries(now.c5.keys)) {
  const l = run.split("|")[0];
  if (r.steps.length !== KEY_WANT.length || r.consoleErrors || r.pageErrors || r.r418) keyBad.push(`${run}: ${r.steps.length} steps ${JSON.stringify(r.errorSample ?? [])}`);
  r.steps.forEach((st, i) => {
    const want = KEY_WANT[i];
    const title = T(l, C5_NAV.find(([v]) => v === want)?.[1] ?? "");
    const ok = st.panel === want && JSON.stringify(st.active) === JSON.stringify([want]) && JSON.stringify(st.selected) === JSON.stringify([want]) && st.h2.includes(title)
      && st.url === "/settings/organization?tab=business-details" && (i === 0 || (st.focus === want && JSON.stringify(st.tabbable) === JSON.stringify([want]) && st.focusVisible && st.outline !== "none"));
    if (!ok) keyBad.push(`${run} ${st.step}: ${JSON.stringify(st)}`);
  });
}
check("C5 SettingsNav by keyboard (blocking; EN / AR at 1440 and 390): Tab reaches the active tab, the only tabbable one; ArrowDown, ArrowDown, ArrowUp move the focus to Logo, Color Theme, Logo and show each panel (its h2); End — the last tab (ZATCA), Home — the first; ArrowRight and ArrowLeft move nothing (a vertical list), in Arabic as in English; the focused tab the only selected one, its focus visible; the URL unchanged (no URL state)",
  (ONLY && !Object.keys(now.c5.keys).length) || (keyBad.length === 0 && (ONLY || Object.keys(now.c5.keys).length === 4)), list(keyBad));
const PRESET_LABELS = ["Tax Rates", "Payment Terms", "Units", "Note Templates", "Terms & Conditions Groups", "Bundles", "Numbering", "Exchange Rates", "Print Layout", "Seal & Signature",
  "Default Bank Accounts", "Departments", "Product Categories", "Leave Types"];
const presetBad = [];
for (const [run, r] of Object.entries(now.c5.presets)) {
  const l = run.split("|")[0];
  if (r.dir !== dirOf(l) || JSON.stringify(r.order) !== JSON.stringify(C5_PRESET_TABS) || JSON.stringify(r.labels) !== JSON.stringify(PRESET_LABELS.map((w) => T(l, w))) || r.consoleErrors || r.pageErrors || r.r418)
    presetBad.push(`${run} tabs: ${JSON.stringify([r.dir, r.order, r.labels, r.errorSample ?? []])}`);
  for (const [v, en] of Object.entries(C5_PRESET_PANELS)) {
    const pn = r.panels[v];
    if (!(pn && pn.panel === v && JSON.stringify(pn.outline) === JSON.stringify([`h1 ${T(l, "Presets")}`, `h2 ${T(l, en)}`]) && pn.h1 === 1 && pn.skips === 0 && pn.overflow === 0 && pn.offenders === 0))
      presetBad.push(`${run} ${v}: ${JSON.stringify(pn)}`);
  }
}
check("C5 Presets (EN / AR at 1440 and 390): the h1 Presets; the 14 tabs in their order, with their labels, the shared Tabs in the document's direction; Print Layout, Seal & Signature and Default Bank Accounts each the h2 under it when opened, nothing past the viewport",
  (ONLY && !Object.keys(now.c5.presets).length) || (presetBad.length === 0 && (ONLY || Object.keys(now.c5.presets).length === 4)), list(presetBad));
const staffSecBad = Object.entries(now.c5.staff).filter(([l, f]) => !(f && JSON.stringify(f.outline) === JSON.stringify(c5Outline("settings-security", l, false)) && f.h1 === 1 && f.skips === 0
  && f.pageHeader?.h1Inside && f.risk === null && f.alerts.length === 0 && !f.consoleErrors && !f.pageErrors && !f.r418)).map(([l, f]) => `${l} ${JSON.stringify(f)}`);
check("C5 Security Center as Staff (EN / AR at 1440): the h1 Security Center with Two-Factor Authentication, Password and Active Sessions as h2s — no Security Timeline, no risk pill, no alert (admin only, as before)",
  (ONLY && !Object.keys(now.c5.staff).length) || (staffSecBad.length === 0 && (ONLY || Object.keys(now.c5.staff).length === 2)), list(staffSecBad));
const tlBad = Object.entries(now.c5.timeline).filter(([run, r]) => {
  const l = run.split("|")[0];
  const e = r.empty;
  return !(e.length === 1 && e[0].text === T(l, "No security events yet.") && e[0].visible && e[0].inView && e[0].after === `h2 ${T(l, "Security Timeline")}` && e[0].controls === 0
    && r.tables === 1 && !r.consoleErrors && !r.pageErrors && !r.r418);
}).map(([run, r]) => `${run} ${JSON.stringify(r)}`);
check(`C5 Security Timeline (owner, EN / AR at 1440 and 390; ${now.c5.timelineWindow ?? "?"} events in the page's 30-day window): the EmptyState "No security events yet." under the Timeline's h2 — no control in it, no table but Active Sessions`,
  (ONLY && !Object.keys(now.c5.timeline).length) || (now.c5.timelineWindow === 0 && tlBad.length === 0 && (ONLY || Object.keys(now.c5.timeline).length === 4)), list(tlBad));
const secLayoutBad = Object.entries(now.c5.security).filter(([run, r]) => {
  const l = run.split("|")[0];
  const all = (xs) => xs.length > 0 && xs.every((x) => x === true);
  return !(r.header && r.meta && r.mfa && all(r.mfaControls) && r.password && all(r.passwordControls) && all(r.fields) && r.focus === "cur-pw" && all(r.tables) && r.timeline
    && JSON.stringify(r.h2) === JSON.stringify(C5_SECURITY.map((w) => T(l, w))) && r.overflow === 0 && r.offenders === 0 && r.tablesBeyond === 0
    && r.pageHeader?.h1Inside && !r.pageHeader.overlap && r.pageHeader.trailing !== "misplaced" && !r.consoleErrors && !r.pageErrors && !r.r418);
}).map(([run, r]) => `${run} ${JSON.stringify(r)}`);
check("C5 Security Center layout (blocking; owner, EN / AR at 1440, 768 and 390): the PageHeader wraps rather than overflows, its risk meta inside the viewport; the Two-Factor Authentication card and its control, the Password card, both password fields (the current one takes the focus) and Change password, the Active Sessions table (or its scroll box) and the Timeline all inside the viewport; no page overflow",
  (ONLY && !Object.keys(now.c5.security).length) || (secLayoutBad.length === 0 && (ONLY || Object.keys(now.c5.security).length === 6)), list(secLayoutBad));
const alertBad = Object.entries(now.c5.alert).filter(([run, r]) => {
  const l = run.split("|")[0];
  const a = r.alerts.find((x) => x.title === "Repeated failed logins");
  // The side the declaration governs: the inline start — left in English, right in Arabic; the card's own
  // 1px line stays on the other side. With --warn defined that side is the 3px stripe in its colour; it is
  // not defined in any stylesheet (nor RISK_STYLE's tokens — deferred), so the declaration is invalid at
  // computed-value time and that side unset: no stripe paints, in C4 (border-left) as in C5 — recorded, not fixed.
  const [start, end] = l === "ar" ? [a?.right, a?.left] : [a?.left, a?.right];
  const startOk = r.tokens.warn ? start === `3px ${r.warn}` : Boolean(start) && start.startsWith("0px ");
  return !(a && r.alerts.length === 1 && a.inline === "3px solid var(--warn)" && !a.physical && a.dir === dirOf(l) && startOk && end === `1px ${r.line}`
    && r.risk === `${T(l, "Risk")}: ${T(l, "Elevated")}` && !r.riskInH1 && r.overflow === 0 && !r.consoleErrors && !r.pageErrors && !r.r418);
}).map(([run, r]) => `${run} ${JSON.stringify(r)}`);
const tokensNow = Object.values(now.c5.alert)[0]?.tokens ?? {};
check(`C5 Security alert (fixture, EN / AR at 1440 and 390): an org registered through the UI in this run's TEST-ONLY copy (its owner: ${now.c5.alertFixture?.role ?? "?"}), five failed logins written for it at the frozen instant (security_events is append-only: the fixture is its own org's, the seeded org untouched) — "Repeated failed logins"; its severity stripe declared on border-inline-start (3px solid var(--warn)), no physical border, the side it governs the inline start — left in English, right in Arabic — the card's 1px line on the other side (--warn ${tokensNow.warn ? "defined: the stripe paints" : "is defined in no stylesheet, so no stripe paints — as in C4; deferred with RISK_STYLE"}); the risk Elevated in the PageHeader's meta, outside the h1; no overflow`,
  (ONLY && !Object.keys(now.c5.alert).length) || (alertBad.length === 0 && now.c5.alertFixture?.role === "owner" && now.c5.alertFixture?.failed === 5 && (ONLY || Object.keys(now.c5.alert).length === 4)), list(alertBad));
const compBad = Object.entries(now.c5.compliance).filter(([run, r]) => {
  const w = run.split("|")[1];
  const reach = (f) => f && f.exportBtn && f.customer && f.erase && f.subject && f.grant && f.withdraw;
  return !(reach(r) && r.listOpen && r.options > 0 && r.listClosed && r.tables.every((t) => t.contained) && !r.consoleErrors && !r.pageErrors && !r.r418
    && (w !== "390" || (r.consent && reach(r.consent) && r.consent.tables.length === 1 && r.consent.tables[0].rows === 1 && r.consent.tables[0].contained && r.consent.overflow === 0 && r.consent.removed === 1)));
}).map(([run, r]) => `${run} ${JSON.stringify(r)}`);
check("C5 Compliance (blocking; EN / AR at 1440, 768 and 390): every control inside the viewport — Export organization data, the customer select and Erase, the consent subject, Grant and Withdraw; the customer select opens its list and closes; at 390 a consent granted in this run's TEST-ONLY copy (deleted after) lists in a table inside its card, nothing past the viewport",
  (ONLY && !Object.keys(now.c5.compliance).length) || (compBad.length === 0 && (ONLY || Object.keys(now.c5.compliance).length === 6)), list(compBad));

// ------------------------------------------------------------------------------------- C6 targets
// The Dashboard, EN and AR at every width (8 states) and its three value cases at 1440 and 390 (12 more), held
// to the targets and to what C5's build showed (c6ref); the breakpoints, the range selector, Customize Layout,
// an org without ZATCA Phase 1 and the activity times.
const c6Keys = keys.filter((k) => k.startsWith("dashboard|"));
const c6Off = ONLY && !c6Keys.length; // an --only run without the Dashboard: nothing of C6's to hold
const c6 = (pred) => c6Keys.filter((k) => !pred(now.states[k], k));
const c6Dash = (k) => now.c6.dash[k.split("|").slice(1).join("|")] ?? null;
const C6_TRACKS = { 1440: 12, 1101: 12, 1100: 2, 1024: 2, 768: 2, 641: 2, 640: 1, 390: 1 };
/** The span each widget must have with `tracks` columns: its desktop span; on two, Financial Overview both, the rest one; on one, one. */
const c6Span = (i, tracks) => (tracks === 12 ? C6_WIDGETS[i][1] : tracks === 2 ? (C6_WIDGETS[i][0] === "Financial Overview" ? 2 : 1) : 1);
/** The widgets' names in the page's language: the KPI labels and the h2s — Cash Flow's carries the range. */
const c6Names = (l, range = "This Month") => C6_WIDGETS.map(([en]) => (en === "Cash Flow" ? `${T(l, en)} · ${T(l, range)}` : T(l, en)));
const finLabel = (l, range) => `${T(l, "Total Revenue")} · ${T(l, range)}`;
const zatcaCard = (l) => JSON.stringify([[T(l, "ZATCA Phase 1 QR"), T(l, "On printed tax invoices")]]);
check(`C6: the Dashboard was measured — EN / AR at every width (${c6Keys.length} states, ${Object.keys(now.c6.dash).length} with its grid); the seeded org: ${c6Seed?.country ?? "?"}`,
  c6Off || (c6Keys.length === 8 && Object.keys(now.c6.dash).length === 8 && c6Seed?.country === "Saudi Arabia"), c6Keys.length);
const c6Route = c6((s) => s.status === 200 && s.finalPath === "/dashboard");
check("C6: /dashboard answers 200 where it is, EN and AR, every width", c6Route.length === 0, list(c6Route.map(show((s) => `${s.status} ${s.finalPath}`))));
const c6Ph = c6((s, k) => {
  const l = k.split("|")[1];
  const h = c6Dash(k)?.header;
  return s.pageHeader?.n === 1 && s.pageHeader.h1Inside && s.pageHeader.metaFirst && s.pageHeader.titleAtStart && s.pageHeader.trailing !== "misplaced" && !s.pageHeader.overlap
    && s.pageHeader.title === T(l, "Dashboard") && s.pageHeader.meta === null && h?.range === T(l, "This Month") && h.customize === true && h.controlsOutside === 0;
});
check("C6 header: one PageHeader — the h1 Dashboard at the inline start (C5 had no h1); its actions the range selector (This Month, the owner's saved range) and Customize Layout, at the end of the title's line or wrapped below it at the start, never over the title; neither control anywhere else",
  c6Ph.length === 0, list(c6Ph.map((k) => `${k} ${JSON.stringify(now.states[k].pageHeader)} ${JSON.stringify(c6Dash(k)?.header)}`)));
const c6Out = c6((s, k) => JSON.stringify(s.outline) === JSON.stringify(c6Outline(k.split("|")[1])) && s.h1 === 1 && s.skips === 0);
check("C6 headings: the outline exact, no level skipped — the h1 Dashboard; Financial Overview, Quick Actions, Recent Activities, Cash Flow · This Month, Invoices Overview, Project Overview and HR Snapshot its h2s (h4s under no h1 in C5), in the dictionary's words",
  c6Out.length === 0, list(c6Out.map(show((s) => JSON.stringify(s.outline)))));
const c6Ov = c6((s) => s.overflow === 0 && s.offenders === 0 && s.tablesBeyond === 0);
check("C6: no page overflow and nothing past the viewport on the Dashboard at any width, EN / AR", c6Ov.length === 0, list(c6Ov.map(show((s) => `${s.overflow}px ${s.offenders} el ${s.tablesBeyond} tables`))));
const c6Err = c6((s) => !s.consoleErrors && !s.pageErrors && !s.r418);
check("C6: zero console errors, page errors and React #418 on every Dashboard state", c6Err.length === 0, list(c6Err.map(show((s) => JSON.stringify(s.errorSample)))));
const c6Ind = c6((s) => s.indic === 0);
check("C6: Western digits — no Arabic-Indic digit anywhere on the Dashboard (C5's activity times were ar-SA's)", c6Ind.length === 0, list(c6Ind.map(show((s) => s.indic))));

// The grid (blocking): tracks, spans, the widgets' order, nothing clipped.
/** Row sizing (§22): above 1100 px the 86 px unit and each widget's desktop row span; at or below it automatic rows, no span. */
const rowsOk = (f, n) => (n === 12
  ? f.autoRows === "86px" && f.widgets.every((x, i) => x.row?.[0] === `span ${C6_WIDGETS[i][2]}` && x.row[1] === "auto")
  : f.autoRows === "auto" && f.widgets.every((x) => x.row?.[0] === "auto" && x.row[1] === "auto"));
const gridOk = (f, w, l, range = "This Month") => {
  const n = C6_TRACKS[w];
  return Boolean(f) && f.tracks.length === n && JSON.stringify(f.widgets.map((x) => x.name)) === JSON.stringify(c6Names(l, range)) && rowsOk(f, n)
    && f.widgets.every((x, i) => x.span === c6Span(i, n) && x.wide === (C6_WIDGETS[i][0] === "Financial Overview") && !x.clipX && !x.clipY && x.inGrid && x.inView && !x.inline
      && x.vars[0].trim() === String(C6_WIDGETS[i][1]) && x.vars[1].trim() === String(C6_WIDGETS[i][2]));
};
const gridBad = Object.entries(now.c6.dash).filter(([k, f]) => !gridOk(f, k.split("|")[1], k.split("|")[0]))
  .map(([k, f]) => `${k} ${JSON.stringify(f && { tracks: f.tracks.length, autoRows: f.autoRows, widgets: f.widgets.map(({ name, span, wide, clipX, clipY, inGrid, inView, inline, vars, row }) => [name, span, wide, clipX, clipY, inGrid, inView, inline, vars, row]) })}`);
check("C6 grid (blocking; EN / AR, every width): 1440 — twelve shrink-safe tracks and 86 px rows, every widget its desktop spans (KPIs 3 × 2, Financial Overview 8 × 5, Quick Actions 4 × 4, Recent Activities 4 × 5, the four cards 3 × 3 / 3 × 4); 1024 and 768 — two tracks, Financial Overview across both, every other widget one, rows automatic and no row span (§22: natural rows); 390 — one track, every widget the full width, rows automatic; the widgets in the default order; none clipped across or down, none outside the grid or the viewport; the spans set as --dash-span / --dash-rows, no inline grid-column or grid-row",
  c6Off || (gridBad.length === 0 && Object.keys(now.c6.dash).length === 8), list(gridBad));
const geo = Object.entries(now.c6.dash).filter(([, f]) => {
  if (!f) return true;
  const n = f.tracks.length;
  const t = f.tracks[0];
  // A widget's width is its span's tracks and the gaps between them (to the pixel).
  return !f.widgets.every((x) => Math.abs(x.width - (x.span * t + (x.span - 1) * f.gap)) <= 1) || (n === 1 && !f.widgets.every((x) => Math.abs(x.width - f.gridWidth) <= 1))
    || (n === 2 && !f.widgets.every((x) => Math.abs(x.width - (x.wide ? f.gridWidth : t)) <= 1));
}).map(([k, f]) => `${k} ${JSON.stringify(f && { tracks: f.tracks, gap: f.gap, grid: f.gridWidth, w: f.widgets.map((x) => [x.span, x.width]) })}`);
check("C6 geometry: every widget as wide as its tracks and gaps — at 768 the two columns equal, Financial Overview the grid's width; at 390 every widget the grid's (the content's) width; no squeezed column",
  c6Off || geo.length === 0, list(geo));
console.log("• C6 grid (tracks · grid width · widget widths × heights):");
for (const [k, f] of Object.entries(now.c6.dash)) console.log(`    ${k.padEnd(8)} ${f?.tracks.length} · ${f?.gridWidth} · ${f?.widgets.map((x) => `${x.width}×${x.height}`).join(" ")}`);

// D-1 / D-4 / D-5 on every Dashboard state.
const d1Bad = Object.entries(now.c6.dash).filter(([k, f]) => {
  const l = k.split("|")[0];
  const fin = f?.fin;
  return !(f && f.gone.length === 0 && fin && fin.label === finLabel(l, "This Month") && fin.value && fin.pill === T(l, "This Month") && fin.svgs === 1 && fin.donuts === 0 && fin.legends === 0
    && fin.chart && fin.chart.bars >= 3 && fin.chart.revenueLine === 1 && fin.chart.revenueDots === fin.chart.bars && fin.chart.labels === fin.chart.bars && fin.chart.expenseLine === 0 && fin.chart.expenseDots === 0);
}).map(([k, f]) => `${k} ${JSON.stringify(f && { gone: f.gone, fin: f.fin })}`);
check("C6 D-1 (EN / AR, every width): no Total Profit, Profit Margin, Total Expenses or Expenses anywhere — text or accessible name; Financial Overview the h2, the range pill, \"Total Revenue · This Month\" and its figure, and one drawing: the revenue chart — its bars, the revenue line and a point per bucket, a label per bucket — with no expense line or points, no donut, no legend",
  c6Off || (d1Bad.length === 0 && Object.keys(now.c6.dash).length === 8), list(d1Bad));
const d4Bad = Object.entries(now.c6.dash).filter(([k, f]) => !(f?.strip && JSON.stringify(f.strip.cards) === zatcaCard(k.split("|")[0]) && f.strip.inView && f.gone.length === 0))
  .map(([k, f]) => `${k} ${JSON.stringify(f?.strip)} ${JSON.stringify(f?.gone)}`);
check(`C6 D-4 (the seeded org — ${c6Seed?.country ?? "?"}: ZATCA Phase 1 applies; EN / AR, every width): the strip holds one card — ZATCA Phase 1 QR · On printed tax invoices — inside the viewport; no Secure & Reliable, Real-time Insights, Automated Processes, CRM Integration or Coming Soon`,
  c6Off || (d4Bad.length === 0 && Object.keys(now.c6.dash).length === 8), list(d4Bad));
const d5Ok = (f, l) => Boolean(f) && f.kpis.length === 4 && C6_KPIS.every(([en, trend, spark], i) => {
  const x = f.kpis[i];
  return x.label === T(l, en) && Boolean(x.value) && (x.trend !== null) === trend && (!trend || x.trend.endsWith(T(l, "vs prev. period"))) && (x.sparks > 0) === spark && x.sparkBox === (spark ? 1 : 0);
}) && f.cash?.sparks === 0 && f.cash.rows.length === 3;
const d5Bad = Object.entries(now.c6.dash).filter(([k, f]) => !d5Ok(f, k.split("|")[0])).map(([k, f]) => `${k} ${JSON.stringify(f && { kpis: f.kpis, cash: f.cash })}`);
check("C6 D-5 (EN / AR, every width): Total Sales — its period-over-period trend and its revenue sparkline; Total Invoices — its trend, no sparkline (C5 borrowed the revenue one); Total Receivables and Total Payables — neither (C5: \"0%\" and a borrowed or flat line); Cash Flow — its three figures and no sparkline (C5 drew one through inflow, outflow and net)",
  c6Off || (d5Bad.length === 0 && Object.keys(now.c6.dash).length === 8), list(d5Bad));

// The value cases (this month, the last 30 days, this year at 1440 and 390): the same targets.
const rangeBad = Object.entries(now.c6.ranges).filter(([k, r]) => {
  const [id, l, w] = k.split("|");
  const range = C6_RANGE_OF[id];
  return !(r && JSON.stringify(r.outline) === JSON.stringify(c6Outline(l, range)) && r.h1 === 1 && r.skips === 0 && r.overflow === 0 && r.offenders === 0 && r.indic === 0
    && r.pageHeader?.n === 1 && r.pageHeader.h1Inside && !r.pageHeader.overlap && r.header.range === T(l, range) && r.header.customize && r.header.controlsOutside === 0
    && r.fin?.label === finLabel(l, range) && r.fin.pill === T(l, range) && r.fin.value && r.fin.svgs === 1 && r.fin.donuts === 0 && r.fin.legends === 0
    && r.fin.chart?.bars >= 3 && r.fin.chart.revenueLine === 1 && r.fin.chart.expenseLine === 0 && r.fin.chart.expenseDots === 0 && r.gone.length === 0
    && gridOk(r, w, l, range) && d5Ok(r, l) && r.strip && JSON.stringify(r.strip.cards) === zatcaCard(l) && !r.consoleErrors && !r.pageErrors && !r.r418);
}).map(([k, r]) => `${k} ${JSON.stringify(r).slice(0, 400)}`);
check(`C6 ranges (EN / AR at 1440 and 390 — This Month, Last 30 Days with day buckets, This Year with month buckets; ${Object.keys(now.c6.ranges).length} states): each its range in the header, the outline (Cash Flow · <range>), Financial Overview ("Total Revenue · <range>") and the pill; the grid, D-1, D-4 and D-5 as above; one h1, no skip, no overflow, Western digits, no error`,
  c6Off || (rangeBad.length === 0 && Object.keys(now.c6.ranges).length === C6_VALUE_CASES.length * 4), list(rangeBad));

// What C5's build said (c6ref): every factual value identical — only the misleading presentation gone.
const c6Ref = (WRITE ? null : pinned.c6ref) ?? null;
const c6ValKeys = Object.keys(now.c6.values);
const INDIC = /[\u0660-\u0669\u06F0-\u06F9]/;
const western = (v) => (typeof v === "string" ? v.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660)) : v);
check(`C6 record: c6ref covers every state of the value pass (${c6ValKeys.length}; measured on ${c6Ref?.recordedOn?.commit?.slice(0, 7) ?? "—"}, src ${c6Ref?.recordedOn?.srcClean ? "clean" : "MODIFIED"}, build ${c6Ref?.recordedOn?.build ?? "—"})`,
  c6Off || (c6Ref?.recordedOn?.srcClean === true && c6Ref.recordedOn.commit === "e8f629b66162143c40eceb78c0d7f56fa5c207ef" && c6ValKeys.length === C6_VALUE_CASES.length * 4
    && c6ValKeys.every((k) => c6Ref.states[k]) && Object.keys(c6Ref.states).every((k) => now.c6.values[k])), list(c6ValKeys.filter((k) => !c6Ref?.states?.[k])));
const c6Diff = [];
const c6Removed = [];
for (const k of c6ValKeys) {
  const a = c6Ref?.states?.[k];
  const b = now.c6.values[k];
  if (!a) continue;
  const l = k.split("|")[1];
  const why = [];
  const eq = (what, x, y) => JSON.stringify(x) !== JSON.stringify(y) && why.push(`${what}: ${JSON.stringify(x)?.slice(0, 160)} → ${JSON.stringify(y)?.slice(0, 160)}`);
  eq("status / path", [a.status, a.finalPath], [b.status, b.finalPath]);
  for (const [en] of C6_KPIS) eq(`${en}`, a.kpis[T(l, en)]?.value, b.kpis[T(l, en)]?.value);
  eq("Total Sales trend and sparkline", [a.kpis[T(l, "Total Sales")]?.trend, a.kpis[T(l, "Total Sales")]?.spark], [b.kpis[T(l, "Total Sales")]?.trend, b.kpis[T(l, "Total Sales")]?.spark]);
  eq("Total Invoices trend", a.kpis[T(l, "Total Invoices")]?.trend, b.kpis[T(l, "Total Invoices")]?.trend);
  eq("revenue chart (viewBox, bars, line, points, labels)", a.chart, b.chart);
  for (const f of ["totalRevenue", "cash", "invoices", "invoicesDonut", "projects", "projectsBig", "hr", "hrBig", "activity", "links", "banner", "zatca"]) eq(f, a[f], b[f]);
  // The range label (and so Cash Flow's title): the same words; C5's Arabic "Last 7 Days" / "Last 30 Days" wrote
  // their number in Arabic-Indic digits, C6's in Western ones (dict.ts) — nothing else may differ.
  eq("range", western(a.range), b.range);
  eq("Cash Flow title", western(a.cashTitle), b.cashTitle);
  if (INDIC.test(`${b.range} ${b.cashTitle}`)) why.push(`an Arabic-Indic digit in the range label: ${b.range}`);
  if (!a.totalRevenue || !a.chart?.bars?.length) why.push("the record has no revenue figure or chart");
  if (why.length) c6Diff.push(`${k}: ${why.join(" · ")}`);
  // The intended removals, each seen in the record and gone now.
  const inv = [a.kpis[T(l, "Total Invoices")], b.kpis[T(l, "Total Invoices")]];
  const rec = [a.kpis[T(l, "Total Receivables")], b.kpis[T(l, "Total Receivables")]];
  const pay = [a.kpis[T(l, "Total Payables")], b.kpis[T(l, "Total Payables")]];
  // (A sparkline is two paths, its area and its line.)
  const removed = inv[0]?.spark.length === 2 && inv[1]?.spark.length === 0
    && rec[0]?.trend?.startsWith("0%") && rec[0].spark.length === 2 && rec[1]?.trend === null && rec[1].spark.length === 0
    && pay[0]?.trend?.startsWith("0%") && pay[0].spark.length === 2 && pay[1]?.trend === null && pay[1].spark.length === 0;
  if (!removed) c6Removed.push(`${k}: ${JSON.stringify({ inv, rec, pay })}`);
}
check("C6 values (§54; EN / AR at 1440 and 390, the three cases): every factual value as C5's build showed it — the four KPI figures, Total Sales' trend and sparkline, Total Invoices' trend; the revenue buckets (the chart's viewBox, bars, line, points and labels, to the attribute); the total revenue (C5: its donut legend's row); the range (in Arabic its number now in Western digits — آخر 30 يوماً, C5 آخر ٣٠ يوماً); Cash Flow's title and three figures; the invoice statuses, counts and donut; Project Overview and HR Snapshot; the recent activities; every link; the data-quality notice; the ZATCA card",
  c6Off || (c6Diff.length === 0 && c6ValKeys.length > 0), list(c6Diff));
check("C6 values: …and what C6 removed was there in C5 — Total Invoices' borrowed sparkline; Total Receivables' and Total Payables' \"0%\" trends and their borrowed / flat sparklines",
  c6Off || (c6Removed.length === 0 && c6ValKeys.length > 0), list(c6Removed));
const ltrBad = C6_VALUE_CASES.flatMap(([id]) => [1440, 390].map((w) => [id, w])).filter(([id, w]) => {
  const [en, ar] = ["en", "ar"].map((l) => now.c6.values[`${id}|${l}|${w}`]?.chart);
  const xs = (c) => c?.bars.map((b) => Number(b.split(",")[0])) ?? [];
  return !(en && ar && JSON.stringify(en.bars) === JSON.stringify(ar.bars) && en.revenue === ar.revenue && JSON.stringify(en.points) === JSON.stringify(ar.points)
    && xs(ar).every((x, i, a) => i === 0 || x > a[i - 1]));
}).map(([id, w]) => `${id}|${w}`);
check("C6 chart (§26 / §52): in Arabic the revenue chart is the English one, bar for bar and point for point — time runs left to right, oldest bucket first, in either language",
  c6Off || ltrBad.length === 0, list(ltrBad));
console.log("• C6 recent-activity times, C5 (c6ref) → C6 (dash-this_month, 1440):");
for (const l of ["en", "ar"]) console.log(`    ${l}  ${JSON.stringify(c6Ref?.states?.[`dash-this_month|${l}|1440`]?.activityTimes)} → ${JSON.stringify(now.c6.values[`dash-this_month|${l}|1440`]?.activityTimes)}`);

// The probes.
const bpBad = Object.entries(now.c6.bp).filter(([k, b]) => {
  const [l, w] = k.split("|");
  const n = C6_TRACKS[w];
  return !(b && b.tracks === n && b.overflow === 0 && b.gone?.length === 0 && JSON.stringify(b.widgets.map((x) => x.name)) === JSON.stringify(c6Names(l)) && rowsOk(b, n)
    && b.widgets.every((x, i) => x.span === c6Span(i, n) && !x.clipX && !x.clipY && x.inGrid && x.inView) && !b.consoleErrors && !b.pageErrors && !b.r418);
}).map(([k, b]) => `${k} ${JSON.stringify(b)}`);
check("C6 breakpoints (blocking; EN / AR): 1101 px — twelve tracks, 86 px rows, the desktop spans; 1100 px — two tracks, Financial Overview across both, every other widget one, rows automatic; 641 px — still two; 640 px — one; nothing clipped, nothing past the viewport, no overflow",
  c6Off || (bpBad.length === 0 && Object.keys(now.c6.bp).length === 8), list(bpBad));
const RANGE_ITEMS = (l) => Object.values(C6_RANGE_KEYS).map((en) => T(l, en));
const rangeE2E = Object.entries(now.c6.range).filter(([l, r]) => {
  const values = r.after?.values;
  return !(r.before.range === T(l, "This Month") && r.before.url === "" && r.pick1.opened && JSON.stringify(r.pick1.items) === JSON.stringify(RANGE_ITEMS(l))
    && !r.pick1.items.some((x) => INDIC.test(x)) && r.after.url === "?range=last_month" && r.after.saved === "last_month" && r.after.facts?.header.range === T(l, "Last Month") && values?.range === T(l, "Last Month")
    && r.after.facts.fin?.label === finLabel(l, "Last Month") && JSON.stringify(r.after.outline) === JSON.stringify(c6Outline(l, "Last Month")) && r.after.h1 === 1
    && JSON.stringify(values) === JSON.stringify(r.directValues) && JSON.stringify(values.chart) !== JSON.stringify(now.c6.values[`dash-this_month|${l}|1440`]?.chart)
    && r.pick2.opened && r.back.url === "?range=this_month" && r.back.range === T(l, "This Month") && r.back.saved === "this_month" && !r.consoleErrors && !r.pageErrors && !r.r418);
}).map(([l, r]) => `${l} ${JSON.stringify(r).slice(0, 600)}`);
check("C6 range selector (E2E, owner, EN / AR at 1440): the trigger in the PageHeader's actions reads This Month; its menu — the seven ranges in order, their numbers in Western digits (آخر 7 أيام, آخر 30 يوماً) — opens; Last Month chosen: the URL ?range=last_month, the preference saved (setDashboardRangeAction), the header, the outline (Cash Flow · Last Month), Financial Overview and every value re-read — equal to a direct load of ?range=last_month and not this month's chart — one h1; then This Month again: ?range=this_month, saved back",
  c6Off || (rangeE2E.length === 0 && Object.keys(now.c6.range).length === 2), list(rangeE2E));
const layoutOf = (mut) => {
  const keysNow = C6_LAYOUT_WIDGETS.map((w) => w.key);
  if (mut) {
    const [h, p] = [keysNow.indexOf("hr_snapshot"), keysNow.indexOf("project_overview")];
    [keysNow[h], keysNow[p]] = [keysNow[p], keysNow[h]];
  }
  return keysNow.map((key) => ({ key, visible: !(mut && (key === "feature_strip" || key === "quick_actions")) }));
};
const custBad = Object.entries(now.c6.customize).filter(([l, c]) => {
  const names = c6Names(l);
  const custom = names.filter((x) => x !== T(l, "Quick Actions"));
  const [h, p] = [custom.indexOf(T(l, "HR Snapshot")), custom.indexOf(T(l, "Project Overview"))];
  [custom[h], custom[p]] = [custom[p], custom[h]];
  return !(c.org === "Saudi Arabia" && JSON.stringify(c.before.names) === JSON.stringify(names) && JSON.stringify(c.before.strip?.cards) === zatcaCard(l)
    && c.opened && JSON.stringify(c.labels) === JSON.stringify(C6_LAYOUT_WIDGETS.map((w) => T(l, w.label))) && c.saved
    && JSON.stringify(c.customized.names) === JSON.stringify(custom) && c.customized.strip === null && JSON.stringify(c.customized.stored) === JSON.stringify(layoutOf(true))
    && c.reopened && c.resetSaved && JSON.stringify(c.reset.names) === JSON.stringify(names) && JSON.stringify(c.reset.strip?.cards) === zatcaCard(l)
    && JSON.stringify(c.reset.stored) === JSON.stringify(layoutOf(false)) && [c.before, c.customized, c.reset].every((x) => x.gone?.length === 0)
    && !c.consoleErrors && !c.pageErrors && !c.r418);
}).map(([l, c]) => `${l} ${JSON.stringify(c).slice(0, 700)}`);
check("C6 Customize Layout (E2E; an org registered through the UI in this run's TEST-ONLY copy, Saudi Arabia; EN / AR at 1440): the trigger, a named button in the PageHeader's actions, opens the dialog — the twelve widgets by their labels (Feature Highlights the strip's, its key unchanged); Feature Highlights and Quick Actions unticked, HR Snapshot moved above Project Overview, saved: the Dashboard re-rendered so — no strip, no Quick Actions, HR Snapshot before Project Overview — and the preference stored under the same twelve keys, in that order, with those two hidden; Reset to default, saved: every widget back in order, the ZATCA card back, the default layout stored",
  c6Off || (custBad.length === 0 && Object.keys(now.c6.customize).length === 2), list(custBad));
const nzBad = Object.entries(now.c6.noZatca).filter(([k, z]) => {
  const [l, w] = k.split("|");
  return !(z.org === "United Arab Emirates" && z.strip === null && z.stripShell === 0 && z.zatcaText === false && JSON.stringify(z.outline) === JSON.stringify(c6Outline(l)) && z.h1 === 1 && z.skips === 0
    && z.overflow === 0 && z.offenders === 0 && z.indic === 0 && z.gone?.length === 0 && JSON.stringify(z.widgets?.map((x) => x.name)) === JSON.stringify(c6Names(l))
    && z.widgets.every((x) => !x.clipX && !x.clipY && x.inView) && (w !== "1440" || (z.pref && z.pref.strip === "checked" && z.pref.labels.includes(T(l, "Feature Highlights"))))
    && !z.consoleErrors && !z.pageErrors && !z.r418);
}).map(([k, z]) => `${k} ${JSON.stringify(z).slice(0, 500)}`);
check("C6 D-4 without ZATCA (an org registered through the UI, the United Arab Emirates; EN / AR at 1440 and 390): no feature strip and nothing empty in its place — no .feature-strip, no card, no ZATCA text; its feature_strip preference still there, ticked (Feature Highlights in Customize Layout); the outline, the grid and nothing clipped or past the viewport as for the seeded org",
  c6Off || (nzBad.length === 0 && Object.keys(now.c6.noZatca).length === 4), list(nzBad));
const zoneBad = [];
const stamp = now.c6.stamp;
for (const [k, z] of Object.entries(now.c6.zones)) {
  const l = k.split("|")[0];
  if (z.rows.length < 2 || z.rows.length !== z.docs.length || z.consoleErrors || z.pageErrors || z.r418) zoneBad.push(`${k}: ${z.rows.length} rows / ${z.docs.length} documents ${JSON.stringify(z.errorSample ?? [])}`);
  z.rows.forEach((r, i) => {
    if (!z.docs[i]?.createdAt || r.time !== z.expected?.[i] || /[٠-٩۰-۹]/.test(r.time) || !r.time.includes("2026"))
      zoneBad.push(`${k} ${r.text}: "${r.time}" — want "${z.expected?.[i]}" (created_at ${z.docs[i]?.createdAt})`);
  });
  // The deterministic one: the newest activity, created at 23:30Z on the 14th — the 14th, 11:30 PM in either language.
  if (!(stamp && z.docs[0]?.number === stamp.number && z.docs[0].createdAt === `${C6_STAMP.replace(" ", "T")}.000Z` && (l !== "en" || z.rows[0]?.time === "Jun 14, 2026, 11:30 PM")
    && (l !== "ar" || (z.rows[0]?.time.startsWith("14 ") && z.rows[0].time.includes("11:30")))))
    zoneBad.push(`${k} the seeded activity: ${JSON.stringify([z.docs[0], z.rows[0]])}`);
}
for (const l of ["en", "ar"]) {
  const runs = Object.entries(now.c6.zones).filter(([k]) => k.startsWith(`${l}|`)).map(([, z]) => JSON.stringify(z.rows));
  if (runs.length !== 3 || new Set(runs).size !== 1) zoneBad.push(`${l}: the rows differ between the browser zones`);
}
if (!stamp || stamp.restored !== stamp.was) zoneBad.push(`the quotation's created_at not restored: ${JSON.stringify(stamp)}`);
check(`C6 recent activity (owner, EN / AR, under each browser's zone, Pacific/Pago_Pago and Pacific/Kiritimati; one activity made deterministic — ${stamp?.number ?? "?"} at ${C6_STAMP}Z, restored after): every time formatDisplayDate(created_at, locale, "dateTime") of its document as the database holds it — the Gregorian calendar, Western digits, UTC (the deterministic one "Jun 14, 2026, 11:30 PM" — already the 15th in Riyadh and on Kiritimati); identical under every browser zone; no error, no #418`,
  c6Off || (zoneBad.length === 0 && Object.keys(now.c6.zones).length === 6), list(zoneBad));

// ------------------------------------------------------------------------------------- D-6
// Every StatRow consumer is held to D-6's targets; all but C2's own strips also to C1's record.
const d6Pinned = (WRITE ? d6Record() : pinned.d6) ?? null;
const D6R = scoped(d6Pinned?.states ?? {});
const d6Keys = Object.keys(now.d6);
const rowsOf = (k) => now.d6[k].statRows ?? [];
const d6Show = (f) => (k) => `${k} ${f(now.d6[k])}`;
check(`D-6: every StatRow consumer measured — ${D6_ROUTES.length} routes × EN / AR × 4 widths (${d6Keys.length} states), each with its row`,
  (ONLY || d6Keys.length === D6_ROUTES.length * 8) && d6Keys.every((k) => rowsOf(k).length >= 1), list(d6Keys.filter((k) => !rowsOf(k).length)));
const d6Recorded = d6Keys.filter((k) => !D6_C2.includes(k.split("|")[0]));
check(`D-6: the record covers every other consumer state (${Object.keys(D6R).length}; measured on ${d6Pinned?.recordedOn?.commit?.slice(0, 7) ?? "—"}, src ${d6Pinned?.recordedOn?.srcClean ? "clean" : "MODIFIED"}, build ${d6Pinned?.recordedOn?.build ?? "—"})`,
  d6Pinned?.recordedOn?.srcClean === true && d6Recorded.every((k) => D6R[k]) && Object.keys(D6R).every((k) => now.d6[k]), list(d6Recorded.filter((k) => !D6R[k])));
const phone = d6Keys.filter((k) => k.endsWith("|390"));
const d6Two = phone.filter((k) => !rowsOf(k).every((r) => r.tracks === 2 && r.perRow === Math.min(2, r.cards) && r.lines === Math.ceil(r.cards / 2)));
check(`D-6: at 390 every StatRow is two across — two tracks, two cards a line (${phone.length} states, EN / AR)`, d6Two.length === 0,
  list(d6Two.map(d6Show((s) => JSON.stringify(s.statRows.map((r) => [r.tracks, r.perRow, r.lines]))))));
const d6Four = d6Keys.filter((k) => !k.endsWith("|390") && !rowsOf(k).every((r) => r.tracks === 4 && r.perRow === Math.min(4, r.cards)));
check(`D-6: above 640 px every row keeps its four columns (1440 / 1024 / 768: ${d6Keys.length - phone.length} states)`, d6Four.length === 0,
  list(d6Four.map(d6Show((s) => JSON.stringify(s.statRows.map((r) => [r.tracks, r.perRow, r.lines]))))));
const d6Clip = d6Keys.filter((k) => rowsOf(k).some((r) => r.clipped || r.outside));
check("D-6: no card clips its label or value and none leaves the viewport — every consumer, every width, EN / AR", d6Clip.length === 0,
  list(d6Clip.map(d6Show((s) => JSON.stringify(s.statRows.map((r) => [r.clipped, r.outside]))))));
const d6Ov = d6Keys.filter((k) => now.d6[k].overflow !== 0);
check("D-6: no page overflow on any StatRow consumer at any width", d6Ov.length === 0, list(d6Ov.map(d6Show((s) => `${s.overflow}px`))));
const d6Err = d6Keys.filter((k) => now.d6[k].status !== 200 || now.d6[k].consoleErrors || now.d6[k].pageErrors || now.d6[k].r418);
check("D-6: every consumer answers 200, with zero console errors, page errors and React #418", d6Err.length === 0, list(d6Err.map(d6Show((s) => `${s.status} ${JSON.stringify(s.errorSample)}`))));
// Against the record: nothing changed but the phone layout.
const d6Diff = (f, which = d6Recorded) =>
  which.filter((k) => D6R[k] && JSON.stringify(f(now.d6[k])) !== JSON.stringify(f(D6R[k]))).map((k) => `${k} ${JSON.stringify(f(D6R[k])).slice(0, 140)} → ${JSON.stringify(f(now.d6[k])).slice(0, 140)}`);
const says = (s) => [s.finalPath, s.statRows.map((r) => r.facts), s.badges, s.tables];
check("D-6: the document lists, Projects and Settings › Security say what the record says — route; each card's label, value, tone, classes and colour; every status badge (tone, colours); every table (heads, rows) — all widths, EN / AR",
  d6Diff(says).length === 0, list(d6Diff(says)));
check("D-6: …offer the same actions (1440 and 390, EN / AR)", d6Diff((s) => s.actions ?? null).length === 0, list(d6Diff((s) => s.actions ?? null)));
const geometry = (s) => s.statRows.map((r) => [r.tracks, r.perRow, r.lines, r.widths, r.height]);
check("D-6: …and above 640 px their rows are the record's to the pixel — tracks, cards a line, card widths, row height (1440 / 1024 / 768)",
  d6Diff(geometry, d6Recorded.filter((k) => !k.endsWith("|390"))).length === 0, list(d6Diff(geometry, d6Recorded.filter((k) => !k.endsWith("|390")))));
// The intended change, listed for the review: each consumer's rows at 390, as recorded → now.
console.log("• D-6 at 390 (tracks / cards a line / lines, recorded → now):");
for (const k of phone.filter((k) => D6R[k])) console.log(`    ${k.padEnd(28)} ${JSON.stringify(D6R[k].statRows.map((r) => [r.tracks, r.perRow, r.lines]))} → ${JSON.stringify(rowsOf(k).map((r) => [r.tracks, r.perRow, r.lines]))}`);
// C2's own strips: the four KPIs each; the two attendance counts in the registry's tones, the rest plain.
const stripBad = d6Keys.filter((k) => D6_C2.includes(k.split("|")[0])).filter((k) => {
  const [id, locale] = k.split("|");
  const f = rowsOf(k)[0]?.facts ?? [];
  if (rowsOf(k).length !== 1 || JSON.stringify(f.map((x) => x.label)) !== JSON.stringify(STRIP_LABELS[id][locale])) return true;
  const col = f.map((x) => x.color);
  if (id === "hr-employees")
    return JSON.stringify(f.map((x) => [x.tone, x.status, x.cls])) !== JSON.stringify([[null, null, ""], ["success", "present", "text-success"], ["info", "on_leave", "text-info"], [null, null, ""]]) ||
      col[3] !== col[0] || col[1] === col[0] || col[2] === col[0] || col[1] === col[2];
  return f.some((x) => x.tone || x.status || x.cls) || new Set(col).size !== 1;
});
check("C2: the Employees strip — Headcount, Present today (attendance/present: success), On leave (attendance/on_leave: info), Departments — tones, classes and colours from the status registry, the two counts plain; the Payroll strip — Employees, Gross pay, Deductions, Net pay — all plain, one colour, Net pay no longer orange (EN / AR, all widths)",
  (ONLY || d6Keys.filter((k) => D6_C2.includes(k.split("|")[0])).length === 16) && stripBad.length === 0, list(stripBad.map(d6Show((s) => JSON.stringify(s.statRows[0]?.facts)))));
check(`formatDisplayDate: Chromium writes exactly the server's (Node's) strings — ${Object.keys(fdNode).length} per browser — under ${fdBrowsers.map((b) => `${b.locale}/${b.timezoneId}`).join(", ")}`,
  Object.keys(fdNode).length === 36 && Object.values(fdNode).every((v) => typeof v === "string" && v) && fdBrowsers.length === 4 && fdBrowsers.every((b) => b.diff.length === 0),
  fdBrowsers.flatMap((b) => b.diff).slice(0, 4).join(" · ") || "no formatDisplayDate in this tree");

// ------------------------------------------------------------------------------------- C7 (D-3)
// The heading pass against what C6's build said (c7ref): the same pages, words, styles, boxes, text and actions —
// the page title h3 → h1 and the Tax Invoice QR panel h4 → h2 the only changes.
if (!ONLY || ONLY.split(",").includes("c7")) {
  const c7Ref = (WRITE ? null : pinned.c7ref) ?? null;
  const S7 = now.c7.states;
  const R7 = c7Ref?.states ?? {};
  const page7 = Object.fromEntries(C7_PAGES.map((pg7) => [pg7[0], pg7]));
  const k7 = C7_PAGES.flatMap(([id]) => ["en", "ar"].flatMap((l) => [1440, 390].map((w) => `${id}|${l}|${w}`)));
  const kind7 = (k) => page7[k.split("|")[0]][2];
  check(`C7 record: c7ref covers every state of the heading pass (${k7.length} — ${C7_PAGES.length} pages × EN / AR × 1440 / 390 — and the error boundary's 4 renders; measured on ${c7Ref?.recordedOn?.commit?.slice(0, 7) ?? "—"}, src ${c7Ref?.recordedOn?.srcClean ? "clean" : "MODIFIED"}, build ${c7Ref?.recordedOn?.build ?? "—"})`,
    k7.every((k) => R7[k]) && c7Ref?.recordedOn?.srcClean === true && Object.keys(c7Ref?.error ?? {}).length === 4, list(k7.filter((k) => !R7[k])));
  check(`C7 fixtures: the five families' TEST-ONLY drafts (${(now.c7.drafts ?? []).join(", ") || "none"}) written into this run's copy for the pass and removed after, the numbering sequences restored`,
    JSON.stringify(now.c7.drafts) === JSON.stringify(["SO-0001", "PF-0001", "DC-0001", "CN-0001", "DN-0001"]) && now.c7.removed === true);
  const bad1 = k7.filter((k) => {
    const v = S7[k];
    const [id, l] = k.split("|");
    const [, path, , title] = page7[id];
    return !v || v.status !== 200 || v.finalPath !== path || v.h1 !== 1 || v.title?.tag !== "h1" || v.title?.text !== title(l);
  });
  check("C7 heading matrix (EN / AR at 1440 and 390): each of the 8 document families' list, detail, create and edit page, the document Recycle Bin and the not-found page (a client, an invoice) answers 200 where it is, with exactly one h1 — its title in the dictionary's words: the family, the document number, Create … / Edit …, Recycle Bin, Page not found",
    bad1.length === 0, list(bad1.map((k) => `${k} ${JSON.stringify({ s: S7[k]?.status, p: S7[k]?.finalPath, h1: S7[k]?.h1, tag: S7[k]?.title?.tag, t: S7[k]?.title?.text })}`)));
  const bad2 = k7.filter((k) => !S7[k] || (kind7(k) === "list" && S7[k].skips !== 0) || (R7[k] && S7[k].skips > R7[k].skips));
  check("C7 levels: the eight lists skip no heading level; no C7 page skips more levels than it did in C6",
    bad2.length === 0, list(bad2.map((k) => `${k} ${R7[k]?.skips}→${S7[k]?.skips} ${JSON.stringify(S7[k]?.heads)}`)));
  // C6's outline with the page title h3 → h1 and the QR panel h4 → h2 — nothing else.
  const qrHead = (R) => (R?.qr ? `h4 ${R.qr.text.slice(0, 60)}` : null);
  const want7 = (R) => R.heads.map((hd, i) => (i === 0 ? hd.replace(/^h3 /, "h1 ") : hd === qrHead(R) ? hd.replace(/^h4 /, "h2 ") : hd));
  const bad3 = k7.filter((k) => !R7[k] || !S7[k] || !/^h3 /.test(R7[k].heads[0] ?? "") || JSON.stringify(S7[k].heads) !== JSON.stringify(want7(R7[k])));
  check("C7 outline against C6 (c7ref): every heading as C6's — same order, same words — but the page title, h3 in C6, now the h1, and the Tax Invoice QR panel's title, h4 in C6, now an h2",
    bad3.length === 0, list(bad3.map((k) => `${k} ${JSON.stringify(R7[k]?.heads)}→${JSON.stringify(S7[k]?.heads)}`)));
  const qrAria = (R) => (R?.qr ? `4 ${R.qr.text}` : null);
  const wantAria = (R) => R.aria.map((a, i) => (i === 0 ? a.replace(/^3 /, "1 ") : a === qrAria(R) ? a.replace(/^4 /, "2 ") : a));
  const bad4 = k7.filter((k) => !R7[k] || !S7[k] || !/^3 /.test(R7[k].aria?.[0] ?? "") || JSON.stringify(S7[k].aria) !== JSON.stringify(wantAria(R7[k])));
  check("C7 accessibility tree (Playwright's aria snapshot of <main>): each page title heading level 3 → 1 and the Tax Invoice QR heading level 4 → 2, every heading's name unchanged, no other level changed",
    bad4.length === 0, list(bad4.map((k) => `${k} ${JSON.stringify(R7[k]?.aria)}→${JSON.stringify(S7[k]?.aria)}`)));
  const sameFacts = (a, b) => Boolean(a) === Boolean(b) && (!a || (a.text === b.text && a.cls === b.cls && JSON.stringify(a.style) === JSON.stringify(b.style) && JSON.stringify(a.box) === JSON.stringify(b.box)));
  const bad5 = k7.filter((k) => !R7[k] || !S7[k] || !sameFacts(S7[k].title, R7[k].title) || !sameFacts(S7[k].qr, R7[k].qr));
  check("C7 computed style and box: each page title's — and the Tax Invoice QR heading's — font family, size, weight, line height, letter spacing, colour, alignment, wrapping, margins, padding, display, alignment, gaps, width, height, x and y identical to C6's, words and classes too (EN / AR, 1440 / 390)",
    bad5.length === 0, list(bad5.map((k) => `${k} ${JSON.stringify([R7[k]?.title?.style?.fontWeight, R7[k]?.title?.box])}→${JSON.stringify([S7[k]?.title?.style?.fontWeight, S7[k]?.title?.box])}`)));
  const bad6 = k7.filter((k) => kind7(k) === "detail" && (!S7[k] || !/mono/i.test(S7[k].title?.style?.fontFamily ?? "") || !/mono/i.test(R7[k]?.title?.style?.fontFamily ?? "") || /mono/i.test(S7[k].moneyFont ?? "")));
  check("C7 Mono: the 8 document numbers (h1.mono) set in the code face, as in C6 — and the money on those pages not",
    bad6.length === 0, list(bad6.map((k) => `${k} ${S7[k]?.title?.style?.fontFamily} / ${S7[k]?.moneyFont}`)));
  const bad7 = k7.filter((k) => !R7[k] || !S7[k] || S7[k].text !== R7[k].text || JSON.stringify(S7[k].actions) !== JSON.stringify(R7[k].actions) || S7[k].overflow !== R7[k].overflow);
  check("C7 nothing else moved: every C7 page's text in <main> and its action inventory identical to C6's — rows, filters, search, saved views, export / import, statuses, row and document actions, relationships, notes, amounts; overflow as C6",
    bad7.length === 0, list(bad7.map((k) => `${k} text ${S7[k]?.text === R7[k]?.text} actions ${JSON.stringify(S7[k]?.actions) === JSON.stringify(R7[k]?.actions)}`)));
  const bad8 = k7.filter((k) => !S7[k] || S7[k].consoleErrors || S7[k].pageErrors || S7[k].r418);
  check("C7: zero console errors, page errors and React #418 on every C7 state", bad8.length === 0, list(bad8.map((k) => `${k} ${JSON.stringify(S7[k]?.errorSample ?? null)}`)));
  const E = now.c7.error;
  const ER = c7Ref?.error ?? {};
  const errBad = [1440, 390].filter((w) => {
    const [a, b] = [E[`h3|${w}`], E[`h1|${w}`]];
    return !a || !b || a.title?.tag !== "h3" || b.title?.tag !== "h1" || b.h1 !== 1 || a.title.text !== "Something went wrong" ||
      JSON.stringify(a.title.style) !== JSON.stringify(b.title.style) || JSON.stringify(a.title.box) !== JSON.stringify(b.title.box) || a.png !== b.png ||
      ER[`h3|${w}`]?.png !== a.png || ER[`h1|${w}`]?.png !== b.png;
  });
  check("C7 error boundary (no route raises it; its markup rendered into <main>, EN at 1440 and 390): the title as C6's h3 and as C7's h1 — identical computed style and box, and the two renders pixel-identical (and identical to C6's build's)",
    errBad.length === 0, list(errBad.map((w) => `${w}: ${E[`h3|${w}`]?.png}/${E[`h1|${w}`]?.png} (C6 ${ER[`h3|${w}`]?.png}/${ER[`h1|${w}`]?.png})`)));
  // The two app-state routes the baseline holds, re-recorded: their outline is the h1 alone now.
  const appStates = ["recycle-bin", "nf-client"].filter((id) => ROUTES.some((r) => r[0] === id));
  const badApp = keys.filter((k) => appStates.includes(k.split("|")[0])).filter((k) => {
    const [id, l] = k.split("|");
    return JSON.stringify(now.states[k].outline) !== JSON.stringify([`h1 ${T(l, id === "recycle-bin" ? "Recycle Bin" : "Page not found")}`]) || now.states[k].h1 !== 1;
  });
  check("C7 app states in the baseline: the document Recycle Bin and the not-found page (re-recorded) — the outline the title's h1 alone (h3 in C6), every width, EN / AR",
    ONLY || (appStates.length === 2 && badApp.length === 0), list(badApp.map((k) => `${k} ${JSON.stringify(now.states[k].outline)}`)));
  console.log("• C7 page titles, C6 (c7ref) → C7, EN 1440 — tag / level, weight, size, box:");
  for (const id of ["c7-inv-list", "c7-qtn-list", "c7-inv-detail", "c7-inv-new", "c7-inv-edit", "c7-bin", "c7-nf"]) {
    const [r, v] = [R7[`${id}|en|1440`], S7[`${id}|en|1440`]];
    // Null-safe: a page whose title heading is gone (a regression the checks above report) must not crash the print.
    if (r && v) console.log(`    ${id.padEnd(14)} ${r.title?.tag ?? "none"}/${r.aria?.[0]?.split(" ")[0]} → ${v.title?.tag ?? "none"}/${v.aria?.[0]?.split(" ")[0]}  ${v.title?.style?.fontWeight ?? "-"} ${v.title?.style?.fontSize ?? "-"}  ${JSON.stringify(r.title?.box ?? null)} → ${JSON.stringify(v.title?.box ?? null)}${v.qr || r.qr ? `  QR ${r.qr?.tag ?? "none"} → ${v.qr?.tag ?? "none"} ${JSON.stringify(v.qr?.box ?? null)}` : ""}`);
  }
}
check("server log has no unhandled error", !/unhandledRejection|Error: (?!connect ECONNREFUSED 127\.0\.0\.1:12750)/.test(serverLog), serverLog.match(/.*Error.*/)?.[0]?.slice(0, 200));

let ok = true;
for (const [cond, name, extra] of results) {
  if (!cond) ok = false;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "PAGE ARCHETYPES RUNTIME PASS" : "PAGE ARCHETYPES RUNTIME FAIL");
rmSync(env.STORAGE_FAKE_DIR, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
