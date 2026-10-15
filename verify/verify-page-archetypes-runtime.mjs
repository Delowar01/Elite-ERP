/**
 * DEV-UI-01.7 C0 — page-archetype runtime baseline (C1: master-data and entity-detail targets; C2: HR
 * targets and the D-6 StatRow gate).
 *
 *   node verify/verify-page-archetypes-runtime.mjs                   measure, compare with the baseline
 *   node verify/verify-page-archetypes-runtime.mjs --write-baseline  measure, write the baseline files
 *   node verify/verify-page-archetypes-runtime.mjs --rebaseline=<route id,…>
 *                                                   measure every route; re-record only those routes
 *   node verify/verify-page-archetypes-runtime.mjs --write-d6        measure the D-6 pass alone; write it as
 *                                                   the baseline's `d6` record (C2 recorded it on C1's build)
 *   node verify/verify-page-archetypes-runtime.mjs --write-c3ref     measure the C3 project pass alone; write it as
 *                                                   the baseline's `c3ref` record (C3 recorded it on C2's build)
 *   flags: --skip-build (reuse .next — only when it was built from the current tree), --only=<route id>,
 *          --measure-out=<file> (also write what this run measured, for review evidence)
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
 * The 36 DEV-UI-01.7 pages, through 44 routes (detail, tab and report variants, an empty project, an
 * unknown id), served by a production build. For every route it records what the page is TODAY:
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
import ts from "typescript";
import { FROZEN_NOW, OWNER_EMAIL } from "../tests/ui-baseline/config.mjs";
import { STAFF_EMAIL } from "../tests/ui-baseline/shell-states.mjs";
import { DB_PREFIX, TEMPLATE_DB, adminUrl, dbUrl, describe, serverEnv } from "../tests/ui-baseline/isolation.mjs";
import { alignDatabaseTimestamps } from "../tests/ui-baseline/archetype-states.mjs";
import { assertFreshBuild } from "./assert-fresh-build.mjs";

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
/** A pass that records one thing alone: no owner / Staff / sweep passes, no probes. */
const RECORD_ONLY = WRITE_D6 || WRITE_C3REF;

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
  ["reports-gl", "/finance/reports?report=gl", "finance/reports"],
  ["statements", "/finance/statements", "finance/statements"], ["statement-client1", "/finance/statements?kind=client&party=1", "finance/statements"],
  ["hr-attendance", "/hr/attendance", "hr/attendance"], ["hr-departments", "/hr/departments", "hr/departments"], ["hr-employees", "/hr/employees", "hr/employees"],
  ["hr-employee-detail", "/hr/employees/1", "hr/employees/[id]"], ["hr-employee-new", "/hr/employees/new", "hr/employees/new"], ["hr-leave", "/hr/leave", "hr/leave"], ["hr-payroll", "/hr/payroll", "hr/payroll"],
  ["projects", "/projects", "projects"], ["project-detail", "/projects/1", "projects/[id]"], ["project-empty", "/projects/2", "projects/[id]"], ["project-new", "/projects/new", "projects/new"],
  ["recycle-bin", "/recycle-bin", "recycle-bin"],
  ["settings-org", "/settings/organization", "settings/organization"], ["settings-org-business", "/settings/organization?tab=business-details", "settings/organization"],
  ["settings-org-team", "/settings/organization?tab=team", "settings/organization"],
  ["settings-presets", "/settings/presets", "settings/presets"], ["settings-security", "/settings/security", "settings/security"], ["settings-compliance", "/settings/compliance", "settings/compliance"],
  ["settings-team", "/settings/team", "settings/team"],
  ["nf-client", "/clients/999999", "clients/[id]"],
].filter(([id]) => !ONLY || id.includes(ONLY));
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
].filter(([id]) => !ONLY || id.includes(ONLY));
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
    projects: "Projects", newProject: "New Project", cost: "Cost & Profitability", revenue: "Revenue", costs: "Costs", tasks: "Tasks", time: "Time logged this week",
    docs: "Linked Documents", priority: "Priority", assignee: "Assignee", unassigned: "Unassigned", low: "Low", medium: "Medium", high: "High", sep: ", ",
    editTask: "Edit Task", newTask: "New Task", addTask: "Add Task", save: "Save", noTasks: "No tasks yet. Add the first task to this project.",
    amount: "Amount", hours: "Hours", budget: "Budget", hoursLogged: "hours logged",
    kpis: ["Sales Value", "Invoiced", "Collected", "Total Cost", "Actual Profit", "Profit Margin"],
  },
  ar: {
    projects: "المشاريع", newProject: "مشروع جديد", cost: "التكلفة والربحية", revenue: "الإيرادات", costs: "التكاليف", tasks: "المهام", time: "الساعات المسجلة هذا الأسبوع",
    docs: "المستندات المرتبطة", priority: "الأولوية", assignee: "المكلَّف", unassigned: "غير مكلَّف", low: "منخفض", medium: "متوسط", high: "مرتفع", sep: "، ",
    editTask: "تعديل المهمة", newTask: "مهمة جديدة", addTask: "إضافة مهمة", save: "حفظ", noTasks: "لا توجد مهام بعد. أضف المهمة الأولى لهذا المشروع.",
    amount: "المبلغ", hours: "الساعات", budget: "الميزانية", hoursLogged: "الساعات المسجَّلة",
    kpis: ["قيمة المبيعات", "المفوتر", "المُحصَّل", "إجمالي التكلفة", "الربح الفعلي", "هامش الربح"],
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

// ------------------------------------------------------------------------------------- isolation
function refuse(why) {
  console.error(`✗ refusing: ${why}`);
  process.exit(2);
}
if (existsSync(join(ROOT, ".env"))) refuse("a .env exists in this tree — run in an isolated worktree with no .env (the production configuration is never loaded)");
if (!existsSync(PASSWORD_FILE)) refuse("no synthetic seed password (.ui-baseline-work/owner-password) — run `node tests/ui-baseline/run.mjs prepare` first");
if (WRITE_D6 && (WRITE || REBASE || ONLY)) refuse("--write-d6 records the D-6 pass alone, every consumer: not with --write-baseline, --rebaseline or --only");
if (WRITE_C3REF && (WRITE || REBASE || ONLY || WRITE_D6)) refuse("--write-c3ref records the C3 project pass alone, both projects: not with --write-baseline, --rebaseline, --only or --write-d6");
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
    ].filter(Boolean).join(",");
    out.push([kind, nameOf(el), href, type, state].join("|"));
  }
  return out.sort();
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

const now = { frozenNow: FROZEN_NOW, chromium: browser.version(), states: {}, staff: {}, sweep: {}, d6: {}, c2: { dept: {}, payroll: {}, dates: {} }, c3: { layout: {}, kanban: {}, empty: {}, hours: {} } };
const prompts = {};
let fdNode = {};
const fdBrowsers = [];
const acts = { owner: {}, staff: {} };
try {
  const ownerState = await login(OWNER_EMAIL);
  const staffState = RECORD_ONLY ? null : await login(STAFF_EMAIL);
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

  if (!RECORD_ONLY)
    for (const locale of ["en", "ar"]) {
      await pass(`owner ${locale}`, ownerState, locale, null, WIDTHS, async ({ id, w, page, status, finalPath, errors }) => {
        now.states[`${id}|${locale}|${w}`] = { status, finalPath, ...(await page.evaluate(MEASURE, C1_LITERALS)), ...errFacts(errors) };
        if (w === 1440 || (w === 390 && locale === "en")) acts.owner[`${id}|${locale}|${w}`] = await page.evaluate(ACTIONS);
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
  if (!WRITE_C3REF)
    for (const locale of ["en", "ar"])
      await pass(`D-6 ${locale}`, ownerState, locale, null, WIDTHS, async ({ id, w, page, status, finalPath, errors }) => {
        now.d6[`${id}|${locale}|${w}`] = { status, finalPath, ...(await page.evaluate(D6M)), ...(w === 1440 || w === 390 ? { actions: await page.evaluate(ACTIONS) } : {}), ...errFacts(errors) };
      }, D6_ROUTES.filter(([id]) => !WRITE_D6 || !D6_C2.includes(id)));

  // C3: the populated and the empty project at every width, EN and AR — the composition (C3M) and, at 1440
  // and 390 on the populated one, the kanban's heads and cards at rest and each card hovered (CSS
  // transitions finished). --write-c3ref records this pass on C2's build.
  if (!WRITE_D6)
    for (const locale of ["en", "ar"])
      await pass(`C3 ${locale}`, ownerState, locale, null, WIDTHS, async ({ id, w, page, status, finalPath, errors }) => {
        const layout = await page.evaluate(C3M, C3_NUMERIC);
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

  // C2 probes, EN and AR, as a person would use the pages. One page each, the frozen clock, the owner.
  async function probePage(locale, [w, h], path) {
    const ctx = await context({ storageState: ownerState, locale: BROWSERS[locale].locale, timezoneId: BROWSERS[locale].timezoneId });
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
if (WRITE) {
  // The probes are checked, not pinned; the D-6 pass is pinned as its record. The C3 record was measured
  // on C2's build and cannot be re-measured here: it is carried over as it is.
  const measured = { frozenNow: now.frozenNow, chromium: now.chromium, states: now.states, staff: now.staff, sweep: now.sweep };
  const c3ref = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, "utf8")).c3ref : undefined;
  writeFileSync(BASELINE_FILE, JSON.stringify({ ...measured, blockedRequests: blocked, d6: d6Record(), ...(c3ref ? { c3ref } : {}) }, null, 1) + "\n");
  writeFileSync(ACTIONS_FILE, JSON.stringify(acts, null, 1) + "\n");
  console.log(`• wrote ${BASELINE_FILE} (${Object.keys(now.states).length} owner states, ${Object.keys(now.staff).length} staff, ${Object.keys(now.sweep).length} sweep, the D-6 record) and ${ACTIONS_FILE}`);
}
const rebased = (k) => Boolean(REBASE?.includes(k.split("|")[0]));
if (REBASE) {
  // The named routes' entries are replaced by this run's; every other entry is kept exactly as pinned
  // (same keys, same order), so the diff of the two files is those routes and nothing else.
  const merge = (old, cur, what) => {
    const lost = Object.keys(old).filter((k) => !(k in cur));
    if (lost.length) refuse(`--rebaseline: ${what} in the baseline were not measured: ${lost.slice(0, 4).join(", ")}`);
    const out = {};
    for (const k of Object.keys(old)) out[k] = rebased(k) ? cur[k] : old[k];
    for (const k of Object.keys(cur)) if (!(k in out)) refuse(`--rebaseline: ${what}: ${k} is not in the baseline`);
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
const scoped = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !ONLY || k.split("|")[0].includes(ONLY)));

check(`isolation: TEST-ONLY loopback database, no .env, server on 127.0.0.1, browser confined to loopback (${blocked} other requests refused)`, target.pathname === `/${DB}` && !existsSync(join(ROOT, ".env")));
check(`pinned Chromium (${now.chromium})`, now.chromium === base.chromium, `baseline ${base.chromium}`);
const pages = new Set(ROUTES.map((r) => r[2]));
check(`the routes exercise all 36 DEV-UI-01.7 pages (${ROUTES.length} routes)`, ONLY || (pages.size === 36 && ROUTES.length === 44), [...pages].length);
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
const outlineDrift = exact("outline").filter((d) => !rebased(d));
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
const ownerOnly = ["hr-payroll", "settings-org", "settings-org-business", "settings-org-team", "settings-presets", "settings-compliance", "settings-team"];
const staffRedirects = Object.entries(now.staff).filter(([k]) => ownerOnly.includes(k.split("|")[0]));
check("Staff are sent to /dashboard from Payroll, Business Settings, Presets and Compliance (and /settings/team)",
  staffRedirects.every(([, v]) => v.finalPath === "/dashboard") && (ONLY || staffRedirects.length === ownerOnly.length * 2), list(staffRedirects.filter(([, v]) => v.finalPath !== "/dashboard").map(([k, v]) => `${k}→${v.finalPath}`)));
const staffOpen = Object.entries(now.staff).filter(([k]) => !ownerOnly.includes(k.split("|")[0]) && k.split("|")[0] !== "nf-client");
check("Staff open every other 01.7 route where it is (session pages)", staffOpen.every(([k, v]) => v.status === 200 && v.finalPath === ROUTES.find((r) => r[0] === k.split("|")[0])[1]),
  list(staffOpen.filter(([k, v]) => v.status !== 200 || v.finalPath !== ROUTES.find((r) => r[0] === k.split("|")[0])[1]).map(([k, v]) => `${k} ${v.status} ${v.finalPath}`)));
const BSw = scoped(base.sweep);
const sweepWorse = Object.keys(now.sweep).filter((k) => BSw[k] && (now.sweep[k].consoleErrors > BSw[k].consoleErrors || now.sweep[k].finalPath !== BSw[k].finalPath));
check(`${SWEEP_ZONE} sweep: same routes, console errors never more`, sweepWorse.length === 0, list(sweepWorse));
function actionDelta(group, which = (k) => !rebased(k)) {
  const want = scoped(baseActs[group]);
  const got = acts[group];
  const out = [];
  for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) {
    if (!which(k)) continue;
    const w = [...(want[k] ?? [])];
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
if (REBASE) {
  // The re-recorded routes' actions must stay EQUIVALENT: the same kinds, targets, types and states.
  // English names are unchanged; an Arabic name may change only from C1 page copy that was still
  // English to Arabic text. C2 has one intended addition: Employees' department filters, buttons now
  // (they were spans, not actions) — "All departments" pressed and each department, named as in the
  // database, not. They must all appear, as exactly that; nothing else may appear or vanish.
  const problems = [];
  const renamed = [];
  const added = [];
  const deptNames = (deptDb?.depts ?? []).map((d) => d.name);
  for (const group of ["owner", "staff"])
    for (const k of Object.keys(acts[group]).filter(rebased)) {
      const split = (a) => { const [kind, name, ...rest] = a.split("|"); return [[kind, ...rest].join("|"), name]; };
      const groups = (xs) => xs.map(split).reduce((m, [r, n]) => m.set(r, [...(m.get(r) ?? []), n].sort()), new Map());
      const was = groups(baseActs[group][k] ?? []);
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
        if (k.includes("|en|") || !gone.every(isC1Literal) || !came.every((x) => /[\u0600-\u06FF]/.test(x))) problems.push(`${group} ${k}: ${gone.join(", ")} → ${came.join(", ")} (${r})`);
        else renamed.push(`${group} ${k}: "${gone.join('", "')}" → "${came.join('", "')}"`);
      }
    }
  console.log(`• action names translated in the re-recorded routes (${renamed.length}):`);
  for (const x of renamed) console.log(`    ${x}`);
  console.log(`• actions added in the re-recorded routes (${added.length}):`);
  for (const x of added) console.log(`    ${x}`);
  check(`re-recorded routes: actions equivalent to the baseline — same kinds, targets, types and states; English names unchanged; Arabic names changed only from C1 page copy to Arabic (${renamed.length} lists); added only the intended controls — C2's department filters, C3's task-card buttons (${added.length} groups)`,
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
check("C3: every Projects outline exact — the list and New Project their h1; a project its name (h1), Cost & Profitability (h2) › Revenue, Costs (h3), Tasks (h2) › To do, In progress, Blocked, Done (h3, the registry's labels; populated project only), Time logged this week, Linked Documents (h2); no skip (EN / AR, all widths)",
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
const costBad = c3Lbad((v, k) => {
  const c = v.cost;
  const phone = k.endsWith("|390");
  return c && c.cards === 6 && c.tracks === (phone ? 2 : 3) && c.perRow === (phone ? 2 : 3) && c.lines === (phone ? 3 : 2) && !c.clipped && !c.outside &&
    JSON.stringify(c.facts.map((f) => f.label)) === JSON.stringify(W_(k).kpis);
});
check("C3 Cost & Profitability: six cards — Sales Value, Invoiced, Collected, Total Cost, Actual Profit, Profit Margin — three across above 640 px (1440 / 1024 / 768) and two across at 390 (D-6); nothing clipped or past the viewport",
  costBad.length === 0, list(costBad.map(lshow((s) => JSON.stringify(s.cost && [s.cost.tracks, s.cost.perRow, s.cost.lines, s.cost.clipped, s.cost.facts.map((f) => f.label)])))));
const colourBad = c3Lbad((v) => {
  const f = v.cost?.facts ?? [];
  const plain = f[0]?.ink;
  const tone = v.badge?.tone;
  return f.length === 6 && plain && [1, 2, 3].every((i) => f[i].ink === plain) && v.tones[tone] && f[4].ink === v.tones[tone] && f[5].ink === v.tones[tone] && (tone === "neutral" || f[4].ink !== plain);
});
check("C3 D-6 colour: Sales Value, Invoiced, Collected and Total Cost drawn in the one plain value colour (Collected's green and Total Cost's warning gone); Actual Profit and Profit Margin in the registry colour of the project's health — the badge's tone",
  colourBad.length === 0, list(colourBad.map(lshow((s) => JSON.stringify([s.cost?.facts.map((f) => f.ink), s.badge?.tone, s.tones])))));
const sameFigures = c3Lbad((v, k) => C3R[k] && JSON.stringify(v.summary?.facts.map(({ label, value }) => ({ label, value }))) === JSON.stringify(C3R[k].summary) &&
  JSON.stringify(v.cost?.facts.map(({ label, value }) => ({ label, value }))) === JSON.stringify(C3R[k].cost));
check("D-2 held: every figure C2 showed is shown, to the character — Budget, Tasks · hours, Sales Value, Invoiced, Collected, Total Cost, Actual Profit, Profit Margin — on both projects, every width, EN / AR (the c3ref record)",
  sameFigures.length === 0, list(sameFigures.map((k) => `${k} ${JSON.stringify(C3R[k]?.cost)} → ${JSON.stringify(now.c3.layout[k].cost?.facts.map((f) => f.value))}`)));
const badgeBad = c3Lbad((v, k) => v.badge && !v.badge.inHeading && v.badge.beside === W_(k).cost && C3R[k] && JSON.stringify(v.badge) .length > 0 &&
  ["status", "tone", "text", "color", "background"].every((f) => v.badge[f] === C3R[k].badge?.[f]));
check("D-2 held: the project_health badge as C2 drew it — status, tone, label, colours — now the meta of the Cost & Profitability h2, outside the heading",
  badgeBad.length === 0, list(badgeBad.map(lshow((s) => JSON.stringify(s.badge)))));
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
