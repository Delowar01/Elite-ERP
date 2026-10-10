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
 */
import pg from "pg";
import { FROZEN_NOW, VIEWPORTS } from "./config.mjs";
import { DB_PREFIX, IsolationError } from "./isolation.mjs";

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
  return out;
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
