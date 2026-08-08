/**
 * Runtime half of Task 7. Three things source-reading cannot answer:
 *
 *  1. Does a fast response paint a placeholder at all? (It must not.)
 *  2. What does the awkward case actually look like — a response arriving just after the delay,
 *     so the skeleton paints and is torn away? This is the case the delay does NOT solve, and the
 *     one a route-level loading.tsx cannot hold open, so it is measured rather than assumed.
 *  3. Do the empty state and the placeholder render correctly in dark mode and Arabic RTL?
 */
import { chromium } from "playwright";
import { Client } from "pg";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `sk_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const results = [];
const check = (n, c, x = "") => results.push([c, n, x]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Skeleton Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });

const skeleton = () => page.locator('[role="status"][aria-busy="true"]');

// ---- 1. a fast response paints no placeholder ----
// The org is empty, so every list responds well under the 150ms delay.
let sawSkeleton = false;
const watch = setInterval(async () => {
  if (await skeleton().count().catch(() => 0)) sawSkeleton = true;
}, 20);
await page.goto(`${BASE}/sales/quotations`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
clearInterval(watch);
check("a fast list load never paints a placeholder", !sawSkeleton);

// ---- 2. the empty state, since this org has no documents ----
const emptyText = await page.locator("main").innerText();
check("an empty list shows an empty state, not a bare header row", /No quotations yet/i.test(emptyText), emptyText.split("\n").slice(0, 3).join(" | "));
const createBtn = page.getByRole("link", { name: /New Quotation/i });
check("the empty state offers the create action", (await createBtn.count()) > 0);
if (await createBtn.count()) {
  await createBtn.first().click();
  await page.waitForTimeout(1500);
  check("the empty state's create action actually opens the builder", new URL(page.url()).pathname === "/sales/quotations/new", page.url());
}

// ---- 3. the awkward case: a response arriving just after the delay ----
// Throttle the list response so it lands around 200ms and measure how long the placeholder is
// actually on screen. This is the flash the delay cannot prevent.
// Must be a CLIENT-SIDE navigation: loading.tsx does not participate in a full document load, so
// measuring a page.goto here would show 0ms and prove nothing about the flash.
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.route("**/sales/invoices**", async (route) => {
  await new Promise((r) => setTimeout(r, 200));
  await route.continue();
});
let firstSeen = 0, lastSeen = 0;
const watch2 = setInterval(async () => {
  const n = await skeleton().count().catch(() => 0);
  if (n) { const t = Date.now(); if (!firstSeen) firstSeen = t; lastSeen = t; }
}, 15);
await page.locator('a[href="/sales/invoices"]').first().click();
await page.waitForTimeout(900);
clearInterval(watch2);
const visibleMs = firstSeen ? lastSeen - firstSeen : 0;
console.log(`DIAG  with a ~200ms response the placeholder was on screen for ~${visibleMs}ms (0 = never painted).`);
check("the ~200ms case does not produce a sub-100ms flash",
  visibleMs === 0 || visibleMs >= 100, `${visibleMs}ms`);
await page.unroute("**/sales/invoices**");

// ---- 4. a genuinely slow response DOES paint, with the right shape ----
// A route-level loading.tsx participates in CLIENT-SIDE navigation and streaming, not in the
// initial document load — delaying the document would just leave the old page on screen and prove
// nothing. So navigate in-app (sidebar link) and delay the RSC payload for the destination.
await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await page.route("**/purchasing/orders**", async (route) => {
  await new Promise((r) => setTimeout(r, 900));
  await route.continue();
});
const poLink = page.locator('a[href="/purchasing/orders"]').first();
check("found an in-app link to the slow list", (await poLink.count()) > 0);
await poLink.click();
await page.waitForTimeout(500);
const shown = await skeleton().count();
check("a slow list load DOES paint a placeholder", shown > 0, `n=${shown}`);
if (shown) {
  // Target the table grid by its marker: the stat-card row above is also a grid, and picking the
  // first one measured the 4 stat cards instead of the 10 table columns.
  const grid = skeleton().locator("[data-skeleton-table]").first();
  const colCount = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  const declared = Number(await grid.getAttribute("data-skeleton-table"));
  check("the placeholder carries the list's real column count (10)", colCount === 10 && declared === 10, `rendered=${colCount} declared=${declared}`);
}
await page.waitForTimeout(1200);
await page.unroute("**/purchasing/orders**");

// ---- 5. dark mode + Arabic RTL ----
await page.goto(`${BASE}/sales/quotations`, { waitUntil: "networkidle" });
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await page.waitForTimeout(400);
const darkBg = await page.locator(".rounded-2xl.border").first().evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "");
check("the empty state has a solid background in dark mode", !!darkBg && !/, 0\)$/.test(darkBg), darkBg);

await ctx.addCookies([{ name: "locale", value: "ar", domain: "localhost", path: "/" }]);
await page.goto(`${BASE}/sales/quotations`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const dir = await page.evaluate(() => document.documentElement.dir);
const arText = await page.locator("main").innerText();
check("the empty state renders in Arabic with RTL layout", dir === "rtl" && /[؀-ۿ]/.test(arText), `dir=${dir}`);
check("the Arabic empty state is actually translated, not English", !/No quotations yet/i.test(arText), arText.split("\n").slice(0, 2).join(" | "));

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "SKELETON RUNTIME PASS" : "SKELETON RUNTIME FAIL");
process.exit(ok ? 0 : 1);
