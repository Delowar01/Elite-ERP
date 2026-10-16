/**
 * DEV-UI-01.7 — page-archetype screenshot states, captured by `run.mjs capture-archetypes`.
 *
 * The Stage 1 representative set: one page for each archetype the 01.7 stages recompose — dashboard,
 * master-data list, entity detail, an empty recycle bin, HR list / detail / payroll, projects, the
 * kanban with and without tasks, a financial report, a statement, the ledger and two Settings pages —
 * each EN + AR at 1440 / 1024 / 768 / 390 in light (120) and EN + AR at 1440 in dark (30), full page.
 * Plus the interactions those pages can already do (12), as viewport screenshots: a department chosen
 * in the employees filter, keyboard focus on the report picker, a kanban task opened for editing.
 *
 * C0 records today's behaviour and does not fake what later stages add. Not captured, because the
 * page cannot do it yet: choosing a department by keyboard (the chips are not focusable), opening or
 * moving a kanban card by keyboard. Each arrives with the stage that builds it.
 *
 * Same frozen clock, seed, TEST-ONLY database and pinned Chromium as the 256-state matrix, no
 * masking and no injected CSS. One fixture step belongs to this set (alignDatabaseTimestamps
 * below): the Security page shows rows the database stamped with its own clock.
 *
 * C1 (master data + entity detail) adds the other nine of its 12 pages — the vendor and product
 * lists, the vendor and product detail, the three New pages, the vendor and product recycle bins —
 * EN + AR at 1440 and 390, light, full page (36); the clients list, client detail and clients bin
 * are already above at every width. And one fixture state (4): the PageHeader under a long name —
 * client 1 renamed in the run's TEST-ONLY copy for that state only and restored straight after —
 * which fails the capture if the header overflows, clips, or puts its actions over the title.
 *
 * C2 (HR) adds the four HR pages not above — New Employee, Departments, Attendance, Leave — EN + AR at
 * 1440 and 390, light, full page (16); the employees list, employee detail and payroll are above at
 * every width. Two interactions (8), viewport screenshots: a department chosen by keyboard (Tab to it,
 * Enter — it is pressed and keeps the focus ring; the department chips were not focusable before C2),
 * and a payroll row selected by keyboard (Tab to the second row, Enter — its payslip). Each fails the
 * capture if the page does not do it. And the D-6 evidence: the eight document lists — the StatRow
 * consumers C2 does not own — EN + AR at 1440 and 390, light, full page (32; Projects and Settings ›
 * Security are above at every width), and Bank Accounts, the other .two-col page, at every width (8).
 *
 * C3 (Projects + kanban) adds New Project, EN + AR at 1440 and 390, light, full page (4); the list and
 * both projects are above at every width. Three interactions (12), viewport screenshots: a task card
 * focused by keyboard (Tab to it — a button now, with the focus ring), Edit Task opened by keyboard
 * (Tab, Enter — the dialog for that card's task), and the empty project's Tasks section with Add Task
 * reached by keyboard beside its EmptyState. Each fails the capture if the page does not do it.
 *
 * C4 (finance + reports) adds the finance states not above — the Profit & Loss report, the vendor
 * statement with a party, Chart of Accounts and the ledger with no account selected (its EmptyState) —
 * EN + AR at 1440 and 390, light, full page (16); the Trial Balance, the client statement, the ledger and
 * Bank Accounts are above at every width (Payments and New Journal Entry are in the lists set). Two
 * interactions (8), viewport screenshots: the report picker by keyboard (Tab to it, Tab ×3, Enter —
 * Trial Balance pressed, its h2, the focus kept on it) and the statement's Vendor link by keyboard (Tab
 * to it, Enter — the vendor page, Vendor the current page). Each fails the capture if the page does not do it.
 *
 * C5 (Settings) adds the Settings states not above — Business Settings on Color Theme (its default tab),
 * Team, Fiscal Year and VAT Configuration, Presets and Security & Compliance Readiness — EN + AR at 1440
 * and 390, light, full page (24); Business Details and the Security Center are above at every width. Two
 * interactions (6), viewport screenshots: the Settings navigation by keyboard (Tab to the active tab,
 * ArrowDown — Logo focused, selected and shown, the focus ring on it; at 390 the navigation stacked full
 * width above the panel, in Arabic in the document's direction) and Compliance's controls at 390 (Tab to
 * the customer select — the erase and consent rows wrapped, every control inside the viewport). Each
 * fails the capture if the page does not do it.
 */
import pg from "pg";
import { FROZEN_NOW, VIEWPORTS } from "./config.mjs";
import { DB_PREFIX, IsolationError, RUN_DB, dbUrl } from "./isolation.mjs";

const vp = (name) => VIEWPORTS.find((v) => v.name === name);
const ALLW = ["1440", "1024", "768", "390"];
const EDGE = ["1440", "390"];
const BOTH = ["en", "ar"];

/** [id, path, area] — seed-stable ids: client 1, employee 1, project 1 (eight tasks), project 2 (none). */
export const ARCHETYPE_ROUTES = [
  ["a01-dashboard", "/dashboard", "Dashboard"],
  ["a02-clients", "/clients", "Master-data list"],
  ["a03-client-detail", "/clients/1", "Entity detail"],
  ["a04-clients-recycle-bin-empty", "/clients/recycle-bin", "Recycle bin (empty)"],
  ["a05-employees", "/hr/employees", "HR list"],
  ["a06-employee-detail", "/hr/employees/1", "HR entity detail"],
  ["a07-payroll", "/hr/payroll", "HR payroll"],
  ["a08-projects", "/projects", "Projects list"],
  ["a09-project-kanban", "/projects/1", "Project detail (kanban)"],
  ["a10-project-kanban-empty", "/projects/2", "Project detail (empty kanban)"],
  ["a11-trial-balance", "/finance/reports?report=tb", "Financial report (Trial Balance)"],
  ["a12-statement-party", "/finance/statements?kind=client&party=1", "Statement (with a party)"],
  ["a13-ledger", "/finance/ledger", "Ledger"],
  ["a14-settings-business", "/settings/organization?tab=business-details", "Settings (organization / business)"],
  ["a15-settings-security", "/settings/security", "Settings (security)"],
];

/** [id, path, action, viewports] — interactions that exist today. */
const INTERACTIONS = [
  ["i01-department-filter", "/hr/employees", "department", EDGE],
  ["i02-report-picker-focus", "/finance/reports?report=tb", "report-focus", EDGE],
  ["i03-kanban-task-edit", "/projects/1", "kanban-edit", EDGE],
];

export function archetypeMatrix() {
  const out = [];
  const add = (id, path, area, locale, theme, name, action, full) =>
    out.push({ id: `arch-${id}__${locale}__${theme}__${name}`, route: { id, path, area }, locale, theme, viewport: vp(name), action, full });
  for (const [id, path, area] of ARCHETYPE_ROUTES)
    for (const locale of BOTH) {
      for (const name of ALLW) add(id, path, area, locale, "light", name, null, true);
      add(id, path, area, locale, "dark", "1440", null, true);
    }
  for (const [id, path, action, viewports] of INTERACTIONS)
    for (const locale of BOTH) for (const name of viewports) add(id, path, "Interaction (today's behaviour)", locale, "light", name, action, false);
  for (const [id, path, area] of C1_ROUTES) for (const locale of BOTH) for (const name of EDGE) add(id, path, area, locale, "light", name, null, true);
  for (const [id, path, action, viewports] of C1_FIXTURES)
    for (const locale of BOTH) for (const name of viewports) add(id, path, "PageHeader under a long name (fixture)", locale, "light", name, action, false);
  for (const [id, path, area, viewports] of C2_ROUTES) for (const locale of BOTH) for (const name of viewports) add(id, path, area, locale, "light", name, null, true);
  for (const [id, path, action, viewports] of C2_INTERACTIONS) for (const locale of BOTH) for (const name of viewports) add(id, path, "Interaction (C2)", locale, "light", name, action, false);
  for (const [id, path, area, viewports] of C3_ROUTES) for (const locale of BOTH) for (const name of viewports) add(id, path, area, locale, "light", name, null, true);
  for (const [id, path, action, viewports] of C3_INTERACTIONS) for (const locale of BOTH) for (const name of viewports) add(id, path, "Interaction (C3)", locale, "light", name, action, false);
  for (const [id, path, area, viewports] of C4_ROUTES) for (const locale of BOTH) for (const name of viewports) add(id, path, area, locale, "light", name, null, true);
  for (const [id, path, action, viewports] of C4_INTERACTIONS) for (const locale of BOTH) for (const name of viewports) add(id, path, "Interaction (C4)", locale, "light", name, action, false);
  for (const [id, path, area, viewports] of C5_ROUTES) for (const locale of BOTH) for (const name of viewports) add(id, path, area, locale, "light", name, null, true);
  for (const [id, path, action, viewports] of C5_INTERACTIONS) for (const locale of BOTH) for (const name of viewports) add(id, path, "Interaction (C5)", locale, "light", name, action, false);
  return out;
}

/** [id, path, area, viewports] — C2: the HR pages not in the set above, and the D-6 / .two-col evidence. */
const C2_ROUTES = [
  ["c2-employee-new", "/hr/employees/new", "HR (new employee)", EDGE],
  ["c2-departments", "/hr/departments", "HR (departments placeholder)", EDGE],
  ["c2-attendance", "/hr/attendance", "HR (attendance)", EDGE],
  ["c2-leave", "/hr/leave", "HR (leave requests)", EDGE],
  ["d6-quotations", "/sales/quotations", "D-6 StatRow (quotations list)", EDGE],
  ["d6-sales-orders", "/sales/orders", "D-6 StatRow (sales orders list)", EDGE],
  ["d6-proforma", "/sales/proforma", "D-6 StatRow (proforma list)", EDGE],
  ["d6-sales-invoices", "/sales/invoices", "D-6 StatRow (sales invoices list)", EDGE],
  ["d6-delivery-challans", "/sales/delivery-challans", "D-6 StatRow (delivery challans list)", EDGE],
  ["d6-purchase-orders", "/purchasing/orders", "D-6 StatRow (purchase orders list)", EDGE],
  ["d6-credit-notes", "/sales/credit-notes", "D-6 StatRow (credit notes list)", EDGE],
  ["d6-debit-notes", "/purchasing/debit-notes", "D-6 StatRow (debit notes list)", EDGE],
  ["c2-bank-accounts", "/finance/bank-accounts", ".two-col (bank accounts)", ALLW],
];
/** [id, path, action, viewports] — C2 interactions (viewport screenshots). */
const C2_INTERACTIONS = [
  ["i04-department-keyboard", "/hr/employees", "department-keyboard", EDGE],
  ["i05-payroll-keyboard", "/hr/payroll", "payroll-keyboard", EDGE],
];

/** [id, path, area, viewports] — C3: the Projects page not in the set above. */
const C3_ROUTES = [["c3-project-new", "/projects/new", "Projects (new project)", EDGE]];
/** [id, path, action, viewports] — C3 interactions (viewport screenshots). */
const C3_INTERACTIONS = [
  ["i06-kanban-card-focus", "/projects/1", "kanban-card-focus", EDGE],
  ["i07-kanban-keyboard-edit", "/projects/1", "kanban-keyboard-edit", EDGE],
  ["i08-kanban-empty", "/projects/2", "kanban-empty", EDGE],
];

/** [id, path, area, viewports] — C4: the finance states not in the set above (seed-stable: vendor 1; no account 999999). */
const C4_ROUTES = [
  ["c4-profit-loss", "/finance/reports", "Financial report (Profit & Loss)", EDGE],
  ["c4-statement-vendor", "/finance/statements?kind=vendor&party=1", "Statement (vendor, with a party)", EDGE],
  ["c4-chart-of-accounts", "/finance/chart-of-accounts", "Chart of Accounts", EDGE],
  ["c4-ledger-no-account", "/finance/ledger?account=999999", "Ledger (no account selected)", EDGE],
];
/** [id, path, action, viewports] — C4 interactions (viewport screenshots). */
const C4_INTERACTIONS = [
  ["i09-report-picker-keyboard", "/finance/reports", "report-keyboard", EDGE],
  ["i10-statement-vendor-link", "/finance/statements?kind=client", "statement-vendor-keyboard", EDGE],
];

/** [id, path, area, viewports] — C5: the Settings states not in the set above. */
const C5_ROUTES = [
  ["c5-settings-color-theme", "/settings/organization", "Settings (Business Settings, Color Theme — the default tab)", EDGE],
  ["c5-settings-team", "/settings/organization?tab=team", "Settings (Business Settings, Team)", EDGE],
  ["c5-settings-fiscal-year", "/settings/organization?tab=fiscal-year", "Settings (Business Settings, Fiscal Year)", EDGE],
  ["c5-settings-vat", "/settings/organization?tab=vat-config", "Settings (Business Settings, VAT Configuration)", EDGE],
  ["c5-settings-presets", "/settings/presets", "Settings (Presets)", EDGE],
  ["c5-settings-compliance", "/settings/compliance", "Settings (Security & Compliance Readiness)", EDGE],
];
/** [id, path, action, viewports] — C5 interactions (viewport screenshots). */
const C5_INTERACTIONS = [
  ["i11-settings-nav-keyboard", "/settings/organization?tab=business-details", "settings-nav-keyboard", EDGE],
  ["i12-compliance-mobile-controls", "/settings/compliance", "compliance-mobile-controls", ["390"]],
];

/** [id, path, area] — C1: the master-data / entity-detail pages not in the set above (seed-stable ids; the seed's bins are empty). */
const C1_ROUTES = [
  ["c1-vendors", "/purchasing/vendors", "Master-data list (vendors)"],
  ["c1-vendor-detail", "/purchasing/vendors/1", "Entity detail (vendor)"],
  ["c1-vendor-new", "/purchasing/vendors/new", "New vendor"],
  ["c1-vendor-recycle-bin-empty", "/purchasing/vendors/recycle-bin", "Recycle bin (vendors, empty)"],
  ["c1-products", "/inventory/products", "Master-data list (products)"],
  ["c1-product-detail", "/inventory/products/1", "Entity detail (product)"],
  ["c1-product-new", "/inventory/products/new", "New product"],
  ["c1-product-recycle-bin-empty", "/inventory/products/recycle-bin", "Recycle bin (products, empty)"],
  ["c1-client-new", "/clients/new", "New client"],
];
/** [id, path, action, viewports] — C1 fixture states (viewport screenshots). */
const C1_FIXTURES = [["f01-page-header-long-name", "/clients/1", "long-name", EDGE]];

// A client name long enough to wrap the h1 at every width, with one 44-character word that only
// breaks because the title column may shrink (min-w-0) and wrap it (break-words).
const LONG_NAME = "AlNoorContractingGeneralTradingEstablishment for Exhibitions, Events and Conference Services (Fictional)";
/** Rename client 1 in the run's TEST-ONLY copy; returns the name it had. */
async function renameClient1(name) {
  const url = dbUrl(RUN_DB);
  if (!new URL(url).pathname.startsWith(`/${DB_PREFIX}`)) throw new IsolationError(`refusing to edit '${new URL(url).pathname}': not a ${DB_PREFIX}* database`);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const before = (await c.query("select name from customers where id = 1")).rows[0]?.name;
    if (before === undefined) throw new Error("client 1 is not in the run copy");
    await c.query("update customers set name = $1 where id = 1", [name]);
    return before;
  } finally {
    await c.end();
  }
}

/** Reach a control with the keyboard (Tab), so :focus-visible matches as it would for a user. */
async function tabTo(page, selector) {
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((sel) => document.activeElement?.matches(sel) ?? false, selector)) return;
  }
  throw new Error(`keyboard focus never reached ${selector}`);
}

export const ARCH_ACTIONS = {
  // The first department, by pointer (C0 recorded it on the pointer-only chips; buttons since C2).
  department: async (page) => {
    await page.locator("main .tab-row .tab").nth(1).click();
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  // The report picker's entries are real buttons: Tab until the selected one (Trial Balance) has focus.
  "report-focus": async (page) => {
    await tabTo(page, "main .tab-row button.tab.active");
  },
  // C2: the first department by keyboard — Tab to its button, Enter. It must be the one pressed, with
  // the focus ring on it.
  "department-keyboard": async (page) => {
    await tabTo(page, "main .tab-row > :nth-child(2)");
    await page.keyboard.press("Enter");
    const f = await page.evaluate(() => {
      const b = document.activeElement;
      return { pressed: b.getAttribute("aria-pressed"), focusVisible: b.matches(":focus-visible"), allPressed: document.querySelectorAll('main .tab-row > [aria-pressed="true"]').length };
    });
    if (f.pressed !== "true" || !f.focusVisible || f.allPressed !== 1) throw new Error(`department by keyboard: ${JSON.stringify(f)}`);
  },
  // C2 (keyboard path since DEV-UI-01.5): the second payroll row by keyboard — Tab to it, Enter. It must
  // be the selected row, and the payslip its employee's.
  "payroll-keyboard": async (page) => {
    await tabTo(page, "main tr[data-payroll-row]:nth-child(2)");
    await page.keyboard.press("Enter");
    const f = await page.evaluate(() => {
      const r = document.activeElement;
      const slip = document.querySelector("main .two-col > :nth-child(2) > :first-child")?.textContent ?? "";
      return { selected: r.getAttribute("aria-selected"), focusVisible: r.matches(":focus-visible"), slipIsRow: slip.trim().endsWith(`— ${r.cells[0].textContent.trim()}`) };
    });
    if (f.selected !== "true" || !f.focusVisible || !f.slipIsRow) throw new Error(`payroll row by keyboard: ${JSON.stringify(f)}`);
  },
  // A kanban card opens its task for editing on click (there is no keyboard path today).
  "kanban-edit": async (page) => {
    await page.locator("main .kanban-card").first().click();
    await page.getByRole("dialog").waitFor();
  },
  // C3: the first task card by keyboard — Tab to it. It must be a button with a name and the focus ring.
  "kanban-card-focus": async (page) => {
    await tabTo(page, "main .kanban-card");
    const f = await page.evaluate(() => {
      const a = document.activeElement;
      return { tag: a.tagName, name: a.getAttribute("aria-label"), focusVisible: a.matches(":focus-visible"), ring: getComputedStyle(a).outlineStyle };
    });
    if (f.tag !== "BUTTON" || !f.name || !f.focusVisible || f.ring === "none") throw new Error(`kanban card by keyboard: ${JSON.stringify(f)}`);
  },
  // C3: Edit Task by keyboard — Tab to the first card, Enter. The dialog must be that card's task.
  "kanban-keyboard-edit": async (page) => {
    await tabTo(page, "main .kanban-card");
    const title = await page.evaluate(() => document.activeElement.querySelector(".t").textContent.trim());
    await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    const got = await page.evaluate(() => document.querySelector('[role="dialog"] #task-title')?.value);
    if (got !== title) throw new Error(`Edit Task by keyboard opened "${got}", not "${title}"`);
  },
  // C3: the empty project — Tab to Add Task in the Tasks header; the EmptyState beside it, no board.
  "kanban-empty": async (page) => {
    await tabTo(page, 'main [data-slot="section-header"] button');
    const f = await page.evaluate(() => ({
      focusVisible: document.activeElement.matches(":focus-visible"),
      empty: document.querySelectorAll('main [data-slot="empty-state"]').length,
      board: document.querySelectorAll("main .kanban, main .kanban-card").length,
    }));
    if (!f.focusVisible || f.empty < 1 || f.board !== 0) throw new Error(`empty kanban: ${JSON.stringify(f)}`);
  },
  // C4: the report picker by keyboard — Tab to it (Profit & Loss), Tab ×3 to Trial Balance, Enter. Trial
  // Balance must be the one toggle pressed, the URL ?report=tb, the h2 its name, the focus still on it.
  "report-keyboard": async (page) => {
    await tabTo(page, "main .reports-print-area > .tab-row button");
    for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.waitForURL(/report=tb$/, { timeout: 30000 });
    await page.waitForFunction(() => {
      const h2 = document.querySelector("main .reports-print-area h2")?.textContent.trim();
      const on = document.querySelector('main .tab-row button[aria-pressed="true"]')?.textContent.trim();
      return Boolean(h2 && h2 === on && !document.querySelector("main .reports-print-area [aria-busy='true'], main .reports-print-area .animate-spin"));
    }, null, { timeout: 30000 });
    await page.waitForLoadState("networkidle");
    const f = await page.evaluate(() => {
      const a = document.activeElement;
      return {
        pressed: [...document.querySelectorAll('main .tab-row button[aria-pressed="true"]')].map((b) => b.textContent.trim()),
        focus: a?.textContent.trim(), focusPressed: a?.getAttribute("aria-pressed"), focusVisible: a?.matches(":focus-visible"),
        h2: document.querySelector("main .reports-print-area h2")?.textContent.trim(),
      };
    });
    if (f.pressed.length !== 1 || f.focus !== f.pressed[0] || f.focusPressed !== "true" || !f.focusVisible || f.h2 !== f.pressed[0]) throw new Error(`report picker by keyboard: ${JSON.stringify(f)}`);
  },
  // C4: the statement's Vendor link by keyboard — Tab to it, Enter. The vendor page must load with Vendor the
  // current page (aria-current="page") and Client not.
  "statement-vendor-keyboard": async (page) => {
    await tabTo(page, 'main .tab-row > a[href="/finance/statements?kind=vendor"]');
    await Promise.all([page.waitForURL(/kind=vendor$/, { timeout: 30000 }), page.keyboard.press("Enter")]);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
    const f = await page.evaluate(() => [...document.querySelectorAll("main .tab-row > a")].map((a) => [a.getAttribute("href"), a.getAttribute("aria-current")]));
    if (JSON.stringify(f) !== JSON.stringify([["/finance/statements?kind=client", null], ["/finance/statements?kind=vendor", "page"]])) throw new Error(`statement Vendor link by keyboard: ${JSON.stringify(f)}`);
  },
  // C5: the Settings navigation by keyboard — Tab to the active tab (Business Details), ArrowDown. Logo must be
  // the focused tab — the one selected, the only tabbable one, its panel shown, the focus ring on it; the list
  // in the document's direction (Radix's root dir = <html dir>), stacked above the panel below 768 px, beside
  // it from there; the URL unchanged.
  "settings-nav-keyboard": async (page) => {
    await tabTo(page, 'main [role="tablist"].settings-nav [role="tab"][data-state="active"]');
    await page.keyboard.press("ArrowDown");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
    const f = await page.evaluate(() => {
      const a = document.activeElement;
      const list = document.querySelector('main [role="tablist"].settings-nav');
      const tabs = [...list.querySelectorAll('[role="tab"]')];
      const panel = document.querySelector('main [role="tabpanel"][data-state="active"]');
      const value = (e) => e?.id?.split("-trigger-")[1] ?? null;
      const l = list.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      return {
        focus: value(a), selected: tabs.filter((t) => t.getAttribute("aria-selected") === "true").map(value), tabbable: tabs.filter((t) => t.tabIndex === 0).map(value),
        panel: panel.id.split("-content-")[1], focusVisible: a.matches(":focus-visible"), ring: getComputedStyle(a).outlineStyle,
        dir: list.parentElement.getAttribute("dir"), docDir: document.documentElement.dir, stacked: p.top >= l.bottom - 1, url: location.pathname + location.search,
      };
    });
    const narrow = page.viewportSize().width < 768;
    const ok = f.focus === "logo" && f.selected.join() === "logo" && f.tabbable.join() === "logo" && f.panel === "logo" && f.focusVisible && f.ring !== "none"
      && f.dir === f.docDir && f.stacked === narrow && f.url === "/settings/organization?tab=business-details";
    if (!ok) throw new Error(`Settings navigation by keyboard: ${JSON.stringify(f)}`);
  },
  // C5: Compliance at 390 — Tab to the customer select. The erase and consent rows wrap: the six controls of
  // the two cards — Export organization data, the customer select, Erase, the consent subject, Grant and
  // Withdraw — all inside the viewport, nothing past it.
  "compliance-mobile-controls": async (page) => {
    await tabTo(page, "#erase-customer");
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
    const f = await page.evaluate(() => {
      const de = document.documentElement;
      const cards = ["#erase-customer", "#consent-subject"].map((sel) => document.querySelector(sel).closest(".card"));
      const controls = cards.flatMap((c) => [...c.querySelectorAll("button")]).filter((e) => e.getClientRects().length);
      return {
        focus: document.activeElement.id, focusVisible: document.activeElement.matches(":focus-visible"), overflow: de.scrollWidth - de.clientWidth,
        controls: controls.length, outside: controls.filter((e) => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > de.clientWidth + 1; }).length,
      };
    });
    if (f.focus !== "erase-customer" || !f.focusVisible || f.overflow > 0 || f.controls !== 6 || f.outside !== 0) throw new Error(`Compliance controls at 390: ${JSON.stringify(f)}`);
  },
  // C1 fixture: client 1 under LONG_NAME. The header must wrap — the h1 over several lines inside its
  // column, at the inline start; meta and actions at the end of the title's line or below it at the
  // start, never over the title; nothing past the viewport — or the capture fails here.
  "long-name": async (page) => {
    const before = await renameClient1(LONG_NAME);
    try {
      await page.reload({ waitUntil: "networkidle", timeout: 60000 });
      await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
      const f = await page.evaluate(() => {
        const de = document.documentElement;
        const ph = document.querySelector('main [data-slot="page-header"]');
        if (!ph) return { error: "no PageHeader" };
        const rtl = de.dir === "rtl";
        const box = ph.getBoundingClientRect();
        const h1 = ph.querySelector("h1");
        const r = h1.getBoundingClientRect();
        const title = ph.firstElementChild.getBoundingClientRect();
        const trail = ph.children[1]?.getBoundingClientRect();
        const sameLine = Boolean(trail && trail.top < title.bottom - 1);
        const startGap = (x) => (rtl ? box.right - x.right : x.left - box.left);
        const endGap = (x) => (rtl ? x.left - box.left : box.right - x.right);
        return {
          dir: de.dir,
          text: h1.textContent,
          overflow: de.scrollWidth - de.clientWidth,
          lines: Math.round(r.height / parseFloat(getComputedStyle(h1).lineHeight)),
          h1Inside: r.left >= box.left - 1 && r.right <= box.right + 1 && h1.scrollWidth <= h1.clientWidth + 1,
          titleAtStart: startGap(title) <= 1,
          trailing: !trail ? "none" : sameLine ? (endGap(trail) <= 1 ? "end" : "misplaced") : startGap(trail) <= 1 ? "below" : "misplaced",
          overlap: sameLine && (rtl ? trail.right > title.left + 1 : trail.left < title.right - 1),
          inViewport: box.left >= -1 && box.right <= de.clientWidth + 1,
        };
      });
      const { text, ...facts } = f;
      const width = page.viewportSize().width;
      console.log(`    PageHeader long name @${width}: ${JSON.stringify(facts)}`);
      // At 1440 the name fits on one line beside meta and actions; at 390 it cannot, so it must wrap.
      const ok = text === LONG_NAME && f.overflow <= 0 && (width >= 1024 || f.lines >= 2) && f.h1Inside && f.titleAtStart && f.trailing !== "misplaced" && !f.overlap && f.inViewport;
      if (!ok) throw new Error(`PageHeader under a long name: ${JSON.stringify(f)}`);
    } finally {
      await renameClient1(before);
    }
  },
};

/**
 * Rows stamped by the DATABASE's clock (`now()`) — which freeze-time.cjs does not reach — carry the
 * real time of the run (the login's session and security event) or of the last `prepare` (the
 * default chart of accounts, departments and cash account, the owner's "password last changed"),
 * and the Security page prints some of them. Every audit stamp — created_at, updated_at,
 * last_activity_at, password_changed_at — later than the frozen instant was written that way; in
 * the run's TEST-ONLY copy only, this moves each to the frozen instant, as if it had happened then.
 * Business dates are not stamps and are left alone. Fixture normalisation, not masking: the pages
 * render whatever the rows say. The two insert-only tables (audit_logs, security_events) reject
 * UPDATE through a trigger, so a table's own triggers are set aside for its statement, inside one
 * transaction, and restored.
 */
const STAMPS = ["created_at", "updated_at", "last_activity_at", "password_changed_at"];
export async function alignDatabaseTimestamps(databaseUrl) {
  if (!new URL(databaseUrl).pathname.startsWith(`/${DB_PREFIX}`)) throw new IsolationError(`refusing to edit '${new URL(databaseUrl).pathname}': not a ${DB_PREFIX}* database`);
  const c = new pg.Client({ connectionString: databaseUrl });
  await c.connect();
  try {
    await c.query("begin");
    const cols = (
      await c.query(
        "select table_name, column_name from information_schema.columns where table_schema = 'public' and data_type like 'timestamp%' and column_name = any($1) order by 1, 2",
        [STAMPS],
      )
    ).rows;
    for (const { table_name: table, column_name: column } of cols) {
      const t = c.escapeIdentifier(table);
      const col = c.escapeIdentifier(column);
      const triggers = (await c.query("select tgname from pg_trigger where tgrelid = $1::regclass and not tgisinternal", [table])).rows.map((r) => c.escapeIdentifier(r.tgname));
      for (const g of triggers) await c.query(`alter table ${t} disable trigger ${g}`);
      await c.query(`update ${t} set ${col} = $1 where ${col} > $1`, [FROZEN_NOW]);
      for (const g of triggers) await c.query(`alter table ${t} enable trigger ${g}`);
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}
