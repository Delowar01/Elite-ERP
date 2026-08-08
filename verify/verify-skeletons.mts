/**
 * Task 7. The property that matters is SHAPE: a skeleton's column count must equal the real table's,
 * or it flashes and then reflows into something structurally different — which is the defect this
 * task exists to remove, not a cosmetic detail.
 *
 * That is asserted here by reading both numbers from source: the `columns={n}` in each loading.tsx
 * and the `<TableHead` count in the list client it stands in for. Hardcode a wrong count and this
 * fails, which is what makes it a test rather than a decoration.
 *
 * Also asserts the deliberate absences, so "this route has no skeleton" stays a decision rather
 * than an oversight: every route in the (app) group is either listed as covered here or listed as
 * deliberately uncovered, and a new route that is neither fails the check.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const results: [boolean, string, string?][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const APP = "src/app/(app)";

/** route -> the list client whose columns it must match. */
const COVERED: Record<string, string> = {
  "sales/quotations": "sales/quotations/quotations-list-client.tsx",
  "sales/orders": "sales/orders/orders-list-client.tsx",
  "sales/proforma": "sales/proforma/proforma-list-client.tsx",
  "sales/invoices": "sales/invoices/invoices-list-client.tsx",
  "sales/delivery-challans": "sales/delivery-challans/dc-list-client.tsx",
  "sales/credit-notes": "sales/credit-notes/cn-list-client.tsx",
  "purchasing/orders": "purchasing/orders/po-list-client.tsx",
  "purchasing/debit-notes": "purchasing/debit-notes/dn-list-client.tsx",
  "finance/payments": "finance/payments/payments-list-client.tsx",
  "projects": "projects/projects-list-client.tsx",
};

/**
 * Routes with a skeleton whose table markup lives in the page itself rather than a list client —
 * the count is asserted against the page.
 */
const COVERED_INLINE = [
  "clients", "inventory/products", "purchasing/vendors", "recycle-bin",
  "clients/recycle-bin", "inventory/products/recycle-bin", "purchasing/vendors/recycle-bin",
  "hr/attendance", "hr/leave", "hr/payroll", "finance/bank-accounts", "finance/journal",
];

/**
 * Deliberately NO skeleton, with the reason. Narrowing the old catch-all means these now render
 * nothing while loading instead of something wrong-shaped; that is the intended trade.
 */
const DELIBERATELY_NONE: Record<string, string> = {
  "dashboard": "has its own KPI-shaped placeholder (dashboard/loading.tsx)",
  "finance/reports": "in-workspace: only the report body skeletons, controls stay live",
  "finance/statements": "same in-workspace pattern as reports",
  "finance/chart-of-accounts": "two-pane account browser, bounded by the chart of accounts, not tenant row growth",
  "finance/ledger": "same two-pane browser as chart-of-accounts",
  "hr/employees": "card grid, not a table — no column count to mirror",
  "hr/departments": "card grid, not a table",
  "settings/organization": "fixed settings panels, bounded",
  "settings/presets": "fixed settings panels, bounded",
  "settings/team": "fixed settings panels, bounded",
  "settings/security": "fixed settings panels, bounded",
  "settings/compliance": "fixed settings panels, bounded",
};
/** Route SHAPES that never need one: forms and detail pages fetch a bounded amount. */
const NONE_PATTERNS = [/\/new$/, /\[id\]/];

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.name === "page.tsx") out.push(full);
  }
  return out;
}

const routes = (await walk(APP)).map((f) => f.slice(APP.length + 1).replace(/\/page\.tsx$/, "")).sort();
check("found the routes in the app group", routes.length > 40, `n=${routes.length}`);

const heads = (s: string) => (s.match(/<TableHead[\s>]/g) ?? []).length;
const cols = (s: string) => Number(/columns=\{(\d+)\}/.exec(s)?.[1] ?? -1);

// ---------- shape: the skeleton's column count equals the real table's ----------
for (const [route, client] of Object.entries(COVERED)) {
  const loading = await readFile(path.join(APP, route, "loading.tsx"), "utf8").catch(() => "");
  const list = await readFile(path.join(APP, client), "utf8").catch(() => "");
  const declared = cols(loading);
  const actual = heads(list);
  check(`${route}: has a loading placeholder`, loading.length > 0);
  check(`${route}: skeleton column count matches the real table`, declared === actual && actual > 0, `skeleton=${declared} table=${actual}`);
}

for (const route of COVERED_INLINE) {
  const loading = await readFile(path.join(APP, route, "loading.tsx"), "utf8").catch(() => "");
  const page = await readFile(path.join(APP, route, "page.tsx"), "utf8").catch(() => "");
  const declared = cols(loading);
  check(`${route}: has a loading placeholder`, loading.length > 0);
  // Some of these render their table through a sibling client; accept a match against either.
  const sibling = (await readdir(path.join(APP, route)).catch(() => []))
    .filter((f) => f.endsWith(".tsx") && f !== "page.tsx" && f !== "loading.tsx");
  let actual = heads(page);
  for (const f of sibling) actual = Math.max(actual, heads(await readFile(path.join(APP, route, f), "utf8")));
  check(`${route}: skeleton column count matches the real table`, declared === actual && actual > 0, `skeleton=${declared} table=${actual}`);
}

// ---------- the delay rule is shared, not re-implemented per placeholder ----------
const skel = await readFile("src/components/ui/skeleton.tsx", "utf8");
check("one shared delay constant governs every placeholder", /export const DELAY_MS = \d+/.test(skel), /DELAY_MS = (\d+)/.exec(skel)?.[1] ?? "");
check("the delay is applied by a single component", /export function Delayed/.test(skel));
check("TableSkeleton goes through the delay", /export function TableSkeleton[\s\S]{0,600}<Delayed>/.test(skel));
check("the reports body skeleton uses the SAME delay, so both feel like one system",
  /export function ReportBodySkeleton[\s\S]{0,400}<Delayed>/.test(skel));

const loadingFiles = (await walk(APP)).length; // reuse walk for a sanity count only
void loadingFiles;

// ---------- reports: body only, controls stay live ----------
const rw = await readFile(path.join(APP, "finance/reports/reports-workspace.tsx"), "utf8");
check("the reports body skeletons during a transition", /\{pending \?\s*\(\s*<ReportBodySkeleton/.test(rw));
const bodyStart = rw.indexOf("<ReportBodySkeleton");
const filterBar = rw.indexOf("Filter bar");
check("the filter bar is rendered ABOVE the body, so it is not inside the skeletoned region",
  filterBar > 0 && filterBar < bodyStart, `filterBar@${filterBar} body@${bodyStart}`);
check("the report picker is not gated on pending",
  !/pending[\s\S]{0,200}REPORTS\.map/.test(rw));

// ---------- every route is a deliberate decision ----------
const undecided = routes.filter((r) => {
  if (r in COVERED || COVERED_INLINE.includes(r)) return false;
  if (r in DELIBERATELY_NONE) return false;
  return !NONE_PATTERNS.some((p) => p.test(r));
});
check("every route in the group is either covered or explicitly declared skeleton-free",
  undecided.length === 0, undecided.join(", "));

// And the declared-none list must not silently rot into a list of routes that do have one.
for (const route of Object.keys(DELIBERATELY_NONE)) {
  if (route === "dashboard") continue; // dashboard genuinely has one, by design
  const has = await readFile(path.join(APP, route, "loading.tsx"), "utf8").then(() => true).catch(() => false);
  check(`${route}: declared skeleton-free and really has none`, !has, DELIBERATELY_NONE[route]);
}

// ---------- empty states: all eight document lists, each with the create action ----------
const DOC_LISTS = Object.values(COVERED).filter((c) => c.includes("sales/") || c.includes("purchasing/"));
for (const client of DOC_LISTS) {
  const s = await readFile(path.join(APP, client), "utf8");
  const name = client.split("/").pop();
  check(`${name}: renders an empty state when there are no rows`, /rows\.length === 0 \?/.test(s) && /<ListEmptyState/.test(s));
  check(`${name}: the empty state offers the primary create action`, /<ListEmptyState[\s\S]{0,320}createHref=/.test(s));
}
const empty = await readFile(path.join(APP, "sales/_shared/list-empty-state.tsx"), "utf8");
check("all eight share one empty-state component rather than eight copies", /export function ListEmptyState/.test(empty));
check("the empty state's create action is a real link", /<Link href=\{createHref\}/.test(empty));

// ---------- the old catch-all is gone ----------
const catchAll = await readFile(path.join(APP, "loading.tsx"), "utf8").then(() => true).catch(() => false);
check("the group-level catch-all placeholder no longer stands in for every screen", !catchAll);
const dash = await readFile(path.join(APP, "dashboard/loading.tsx"), "utf8").catch(() => "");
check("the KPI-shaped placeholder now lives with the dashboard it depicts", /grid-cols-4/.test(dash));

// ---------- Arabic ----------
const dict = await readFile("src/lib/i18n/dict.ts", "utf8");
for (const k of ["No quotations yet.", "No sales orders yet.", "No proforma invoices yet.", "No invoices yet.", "No delivery challans yet."]) {
  check(`"${k}" has Arabic`, new RegExp(`"${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\s*"[^"]*[\\u0600-\\u06FF]`).test(dict));
}

let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "SKELETON VERIFICATION PASS" : "SKELETON VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
