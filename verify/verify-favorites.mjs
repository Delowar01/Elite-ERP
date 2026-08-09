// Task 3 verification — row-level favorites.
import { chromium } from "playwright";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `fav_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

// Refuse to run against a build other than the one on disk — see assert-fresh-build.mjs.
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Favorites Co");
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
const uid = (await db.query("select id from users where email=$1", [email])).rows[0].id;
const cust = (await db.query("insert into customers (org_id,name) values ($1,'ABC Trading') returning id", [org])).rows[0].id;

// One draft quotation we can favorite, unfavorite, and later permanently delete.
const quo = (await db.query(
  `insert into quotations (org_id,quotation_number,title,customer_id,status,issue_date,subtotal,discount,tax_total,total,created_by_id)
   values ($1,'QTN-FAV','Pin me',$2,'draft','2026-01-01','100','0','0','100',$3) returning id`, [org, cust, uid])).rows[0].id;
const href = `/sales/quotations/${quo}`;

async function openRowMenu(listPath, number) {
  await page.goto(`${BASE}${listPath}?record=all`, { waitUntil: "domcontentloaded" });
  await page.locator("table").first().waitFor();
  const row = page.locator("tr", { hasText: number }).first();
  await row.locator("button.row-menu-btn, [aria-haspopup='menu']").last().click();
  await page.waitForTimeout(350);
}

// --- favorite it ---
await openRowMenu("/sales/quotations", "QTN-FAV");
check("row menu offers Add to Favorites", (await page.getByRole("menuitem", { name: "Add to Favorites", exact: true }).count()) === 1);
check("it does NOT simultaneously offer Remove", (await page.getByRole("menuitem", { name: "Remove from Favorites", exact: true }).count()) === 0);
await page.getByRole("menuitem", { name: "Add to Favorites", exact: true }).click();
await page.waitForTimeout(1200);

const row1 = (await db.query(`select label, href from favorites where org_id=$1 and user_id=$2`, [org, uid])).rows;
check("favorite stored with the document number as label", row1.length === 1 && row1[0].label === "QTN-FAV", JSON.stringify(row1));
check("favorite stored against the document's detail route", row1[0]?.href === href, row1[0]?.href);

// --- it shows in the top-bar favorites menu ---
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
await page.locator('[aria-label="Favorites"]').click();
await page.waitForTimeout(500);
check("favorited document appears in the top-bar menu", await page.getByRole("link", { name: "QTN-FAV" }).isVisible().catch(() => false));
await page.keyboard.press("Escape");

// --- the same row now offers the reverse ---
await openRowMenu("/sales/quotations", "QTN-FAV");
check("the same row now offers Remove from Favorites",
  (await page.getByRole("menuitem", { name: "Remove from Favorites", exact: true }).count()) === 1);
check("Add is no longer offered on a favorited row",
  (await page.getByRole("menuitem", { name: "Add to Favorites", exact: true }).count()) === 0);
await page.getByRole("menuitem", { name: "Remove from Favorites", exact: true }).click();
await page.waitForTimeout(1200);
const afterRemove = (await db.query(`select count(*)::int n from favorites where org_id=$1 and user_id=$2`, [org, uid])).rows[0].n;
check("unfavorite actually deletes the row", afterRemove === 0, `n=${afterRemove}`);

// --- available on all 8 document types (static: one shared hook feeds every list) ---
{
  const hook = await readFile("src/app/(app)/_shared/document-row-actions.tsx", "utf8");
  check("the favorite entry is unconditional on document type",
    /items\.push\(\{[\s\S]{0,200}?favorited \? "Remove from Favorites" : "Add to Favorites"/.test(hook));
  const lists = ["sales/quotations/quotations-list-client","sales/orders/orders-list-client","sales/proforma/proforma-list-client",
    "sales/invoices/invoices-list-client","sales/delivery-challans/dc-list-client","sales/credit-notes/cn-list-client",
    "purchasing/orders/po-list-client","purchasing/debit-notes/dn-list-client"];
  let usingHook = 0, deadLeft = 0;
  for (const l of lists) {
    const src = await readFile(`src/app/(app)/${l}.tsx`, "utf8");
    if (src.includes("useDocumentRowActions")) usingHook++;
    if (/label: t\(locale, "Add to Favorites"\) \}/.test(src)) deadLeft++;
  }
  check("all 8 document lists consume the shared row-actions hook", usingHook === 8, `n=${usingHook}`);
  check("no dead local favorite entry remains in any list", deadLeft === 0, `n=${deadLeft}`);
}

// --- permanent delete purges the favorite (the defect this would otherwise ship) ---
await openRowMenu("/sales/quotations", "QTN-FAV");
await page.getByRole("menuitem", { name: "Add to Favorites", exact: true }).click();
await page.waitForTimeout(1200);
check("re-favorited for the delete test",
  (await db.query(`select count(*)::int n from favorites where org_id=$1 and href=$2`, [org, href])).rows[0].n === 1);

// A second user in the same org pins the same document: the purge must clear theirs too.
const u2 = (await db.query(
  `insert into users (org_id,name,email,password_hash,role) values ($1,'Colleague',$2,'x','staff') returning id`,
  [org, `c_${Math.random().toString(36).slice(2, 7)}@t.dev`])).rows[0].id;
await db.query(`insert into favorites (org_id,user_id,label,href) values ($1,$2,'QTN-FAV',$3)`, [org, u2, href]);

// Soft delete first — the favorite must SURVIVE, because the record is recoverable.
await openRowMenu("/sales/quotations", "QTN-FAV");
await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
await page.waitForTimeout(500);
await page.locator('[role="dialog"]').last().getByRole("button", { name: /delete/i }).last().click();
await page.waitForTimeout(1500);
const afterSoft = (await db.query(`select count(*)::int n from favorites where org_id=$1 and href=$2`, [org, href])).rows[0].n;
check("soft delete leaves the favorite intact (still recoverable)", afterSoft === 2, `n=${afterSoft}`);

// Permanent delete from the Recycle Bin. Documents share ONE bin at /recycle-bin (not a per-module
// one like clients/vendors/products), and the row button reads "Permanent Delete" while the
// confirmation's own button reads "Delete Permanently".
await page.goto(`${BASE}/recycle-bin`, { waitUntil: "domcontentloaded" });
await page.locator("table").first().waitFor();
const binRow = page.locator("tr", { hasText: "QTN-FAV" }).first();
check("the deleted document is in the shared Recycle Bin", (await binRow.count()) === 1);
await binRow.getByRole("button", { name: "Permanent Delete", exact: true }).click();
await page.waitForTimeout(500);
await page.locator('[role="dialog"]').last().getByRole("button", { name: "Delete Permanently", exact: true }).click();
await page.waitForTimeout(2000);

const gone = (await db.query(`select count(*)::int n from quotations where id=$1`, [quo])).rows[0].n;
const favLeft = (await db.query(`select count(*)::int n from favorites where org_id=$1 and href=$2`, [org, href])).rows[0].n;
check("document was permanently deleted", gone === 0, `n=${gone}`);
check("permanent delete purges the favorite for EVERY user in the org", favLeft === 0, `n=${favLeft}`);

// --- the cap ---
{
  const reg = await readFile("src/lib/favorites.ts", "utf8");
  const act = await readFile("src/app/(app)/favorites-actions.ts", "utf8");
  check("a favorites ceiling is defined", /MAX_FAVORITES = \d+/.test(reg));
  check("the read query is bounded by it", /\.limit\(MAX_FAVORITES\)/.test(reg));
  check("the write refuses past the ceiling with a clear message",
    /n >= MAX_FAVORITES/.test(act) && /reached the limit/.test(act));
  const menu = await readFile("src/components/layout/favorites-menu.tsx", "utf8");
  check("the menu scrolls rather than growing unbounded", /max-h-\[\d+px\] overflow-y-auto/.test(menu));
}

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter(r => r[0]).length}/${results.length} checks`);
console.log(ok ? "FAVORITES VERIFICATION PASS" : "FAVORITES VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
