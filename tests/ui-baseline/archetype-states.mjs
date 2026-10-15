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
  return out;
}

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
  // The department chips are pointer-only today (a span with onClick): the first department.
  department: async (page) => {
    await page.locator("main .tab-row .tab").nth(1).click();
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  // The report picker's entries are real buttons: Tab until the selected one (Trial Balance) has focus.
  "report-focus": async (page) => {
    await tabTo(page, "main .tab-row button.tab.active");
  },
  // A kanban card opens its task for editing on click (there is no keyboard path today).
  "kanban-edit": async (page) => {
    await page.locator("main .kanban-card").first().click();
    await page.getByRole("dialog").waitFor();
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
