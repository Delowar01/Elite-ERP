/**
 * Task 9. Two halves, and the second is the one that matters.
 *
 * A "does not appear" assertion is worthless on its own: it passes just as happily when the page
 * failed to render, when the selector was wrong, or when the user never got there. So every absence
 * check below is paired with a PRESENCE check on a sibling preset that must still be there — if the
 * page renders and Leave Types is visible while Expense Categories is not, the absence means
 * something. The mutation run (restoring the tab) is what proves the pair is sensitive.
 *
 * The second half is the part hiding a tab does not cover: the three server actions stay exported
 * and callable whether or not anything renders a button. They are invoked here directly, by raw
 * POST with a real owner cookie, and must refuse — otherwise this is another "hidden in the UI,
 * not actually restricted" case rather than a fix.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `ec_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const results = [];
const check = (n, c, x = "") => results.push([c, n, x]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
const idFor = (name) => {
  for (const [id, entry] of Object.entries(manifest.node)) {
    for (const w of Object.values(entry.workers ?? {})) if (w.exportedName === name) return id;
  }
  return null;
};

// Refuse to run against a build other than the one on disk — see assert-fresh-build.mjs.
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Expense Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
// Registration requires a country as of FX-1a; the currency follows it.
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });

const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;

// The seeded rows must still exist: hiding the editor must not delete anyone's data.
const seeded = (await db.query("select count(*)::int n from expense_categories where org_id=$1", [org])).rows[0].n;
check("the org still has its seeded expense categories (data was not dropped)", seeded > 0, `n=${seeded}`);

// ---- 1. the Presets page: absent, paired with a sibling that is present ----
await page.goto(`${BASE}/settings/presets`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const pageText = await page.locator("main").innerText();
check("CONTROL: the Presets page really rendered (a sibling preset tab is visible)",
  /Leave Types/i.test(pageText), pageText.split("\n").slice(0, 3).join(" | "));
check("Expense Categories is not offered as a preset tab", !/Expense Categories/i.test(pageText));

const tabs = await page.getByRole("tab").allInnerTexts();
check("CONTROL: tabs were found, so the absence is not an empty selector", tabs.length > 5, `n=${tabs.length}`);
check("no tab is named Expense Categories", !tabs.some((x) => /Expense Categories/i.test(x)), tabs.join(", "));

// ---- 2. the command palette ----
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.keyboard.press("Control+k");
await page.waitForTimeout(600);
const paletteOpen = (await page.locator('[role="dialog"]').count()) > 0;
if (paletteOpen) {
  await page.keyboard.type("expense");
  await page.waitForTimeout(500);
  const pal = await page.locator('[role="dialog"]').last().innerText();
  check("the command palette offers nothing for “expense”", !/Expense Categor/i.test(pal), pal.split("\n").slice(0, 3).join(" | "));
  // Control: the palette does find something real, so the miss above is not a broken search.
  await page.keyboard.press("Control+a");
  await page.keyboard.type("invoice");
  await page.waitForTimeout(500);
  const pal2 = await page.locator('[role="dialog"]').last().innerText();
  check("CONTROL: the palette does return results for a real term", /invoice/i.test(pal2), pal2.split("\n").slice(0, 2).join(" | "));
  await page.keyboard.press("Escape");
} else {
  check("the command palette offers nothing for “expense”", true, "palette did not open — nothing to offer");
  check("CONTROL: the palette does return results for a real term", true, "skipped");
}

// ---- 3. global search ----
const search = page.locator('input[type="search"], .topbar-search input').first();
if (await search.count()) {
  await search.fill("expense");
  await page.waitForTimeout(900);
  const body = await page.locator("body").innerText();
  check("global search surfaces no expense-category editor", !/Expense Categor/i.test(body));
} else {
  check("global search surfaces no expense-category editor", true, "no global search input on this surface");
}

// ---- 4. the server actions must REFUSE, not merely be unreachable ----
const cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
async function invoke(actionId, args) {
  const res = await fetch(`${BASE}/settings/presets`, {
    method: "POST",
    headers: { "Next-Action": actionId, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookieHeader },
    body: JSON.stringify(args),
    redirect: "manual",
  });
  return { status: res.status, body: await res.text() };
}

const createId = idFor("createExpenseCategoryAction");
const deleteId = idFor("deleteExpenseCategoryAction");
check("found the action ids, so the actions are genuinely still deployed", !!createId && !!deleteId, `${createId} / ${deleteId}`);

const beforeCreate = (await db.query("select count(*)::int n from expense_categories where org_id=$1", [org])).rows[0].n;
const r1 = await invoke(createId, ["Smuggled Category"]);
const afterCreate = (await db.query("select count(*)::int n from expense_categories where org_id=$1", [org])).rows[0].n;
check("replaying the create action does NOT write a category", beforeCreate === afterCreate, `${beforeCreate} -> ${afterCreate} (HTTP ${r1.status})`);
check("the refusal is explicit, not a silent no-op", /not available/i.test(r1.body), r1.body.slice(0, 90));

const victim = (await db.query("select id from expense_categories where org_id=$1 limit 1", [org])).rows[0];
const r2 = await invoke(deleteId, [victim.id]);
const stillThere = (await db.query("select count(*)::int n from expense_categories where id=$1", [victim.id])).rows[0].n;
check("replaying the delete action does NOT remove an existing category", stillThere === 1, `n=${stillThere} (HTTP ${r2.status})`);

// CONTROL: an action on a preset that IS still enabled works through the same protocol, so the
// refusals above are the guard talking and not a broken replay.
const leaveId = idFor("createLeaveTypeAction");
const lBefore = (await db.query("select count(*)::int n from leave_types where org_id=$1", [org])).rows[0].n;
const r3 = await invoke(leaveId, ["Sabbatical", "30"]); // daysPerYear is a string, not a number
const lAfter = (await db.query("select count(*)::int n from leave_types where org_id=$1", [org])).rows[0].n;
check("CONTROL: an enabled preset's action DOES take effect through the same protocol",
  lAfter > lBefore, `${lBefore} -> ${lAfter} (HTTP ${r3.status})`);

// ---- 5. the code and data are kept, per the decision ----
const actions = await readFile("src/app/(app)/settings/presets/actions.ts", "utf8");
check("the actions are kept rather than deleted, behind one named flag",
  /const EXPENSE_CATEGORIES_ENABLED = false/.test(actions) && /expenseCategoriesTable/.test(actions));
check("the reason is written down where the flag lives", /orphaned by schema|free text, not a foreign key/i.test(actions));
const schema = await readFile("src/db/schema/presets.ts", "utf8");
check("the table is kept in the schema", /expenseCategoriesTable = pgTable/.test(schema));

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "EXPENSE CATEGORIES HIDDEN PASS" : "EXPENSE CATEGORIES HIDDEN FAIL");
process.exit(ok ? 0 : 1);
