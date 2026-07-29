// Visual + behavioral verification for the left-sidebar collapse fix (Issue #11).
// Registers a fresh org, then exercises: group expand/collapse, full-sidebar icon-only collapse,
// tooltips, active highlight after nav, active group staying open, scroll-position persistence, and
// cookie persistence across reload. Also screenshots light / dark / Arabic-RTL.
// Run: DATABASE_URL=... npx tsx scripts/tests/sidebar-collapse.verify.mjs   (server must be running)
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3000";
const SHOT_DIR = "/tmp/claude-0/-home-user-Exhibition-Lead-Pro/762bdf67-a9fd-5562-88ca-0fa1fa890980/scratchpad";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}`); } };
const uniq = () => Math.random().toString(36).slice(2, 8);

function findChrome() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"]) {
    try { execSync(`test -f ${p}`); return p; } catch {}
  }
  return undefined;
}

async function main() {
  const email = `sb_${uniq()}@test.dev`;
  const pass_ = `Zx${uniq()}Q7!vray${uniq()}`;
  const browser = await chromium.launch({ executablePath: findChrome() });
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });

  // --- register a fresh org → lands on dashboard ---
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.fill("#orgName", `Sidebar Org ${uniq()}`);
  await page.fill("#name", "SB Owner");
  await page.fill("#email", email);
  await page.fill("#password", pass_);
  await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 20000 }), page.click('button[type="submit"]')]);

  console.log("\n== Sidebar collapse behavior ==");

  // 1. Active page highlighted (Dashboard)
  ok("active nav-item highlighted on Dashboard", (await page.locator('.nav-item.active[href="/dashboard"]').count()) === 1);

  // 2. Group expand/collapse: Sales group header toggles its items
  const salesHeader = page.locator('.nav-divider', { hasText: /Sales/i }).first();
  ok("Sales group header is a clickable toggle", (await salesHeader.count()) === 1);
  ok("Sales items visible initially", await page.locator('.nav-item[href="/sales/invoices"]').isVisible());
  await salesHeader.click();
  await page.waitForTimeout(150);
  ok("Sales items hidden after collapse", (await page.locator('.nav-item[href="/sales/invoices"]').count()) === 0 || !(await page.locator('.nav-item[href="/sales/invoices"]').isVisible()));
  ok("collapsed group recorded in cookie", (await page.context().cookies()).some((c) => c.name === "sidebar_groups" && /Sales/.test(decodeURIComponent(c.value))));
  await salesHeader.click();
  await page.waitForTimeout(150);
  ok("Sales items visible after re-expand", await page.locator('.nav-item[href="/sales/invoices"]').isVisible());

  // 3. Full sidebar collapse → icons only + tooltip title + cookie
  await page.locator(".sidebar-toggle").click();
  await page.waitForTimeout(250);
  ok("aside has collapsed class", (await page.locator("aside.sidebar.collapsed").count()) === 1);
  ok("nav labels hidden when collapsed", !(await page.locator('.nav-item[href="/dashboard"] .nav-item-label').isVisible()));
  ok("nav item keeps a title tooltip (page name)", (await page.locator('.nav-item[href="/dashboard"]').getAttribute("title")) === "Dashboard");
  const w = await page.locator("aside.sidebar").evaluate((el) => el.getBoundingClientRect().width);
  ok("collapsed sidebar is a narrow icon rail (<90px)", w < 90);
  ok("collapse recorded in cookie", (await page.context().cookies()).some((c) => c.name === "sidebar_collapsed" && c.value === "1"));
  await page.screenshot({ path: `${SHOT_DIR}/sidebar_collapsed.png` });

  // 4. Refresh preserves collapsed state (cookie read server-side, no flash)
  await page.reload({ waitUntil: "networkidle" });
  ok("still collapsed after refresh", (await page.locator("aside.sidebar.collapsed").count()) === 1);

  // Expand again for the remaining checks
  await page.locator(".sidebar-toggle").click();
  await page.waitForTimeout(250);
  ok("expands back to full sidebar", (await page.locator("aside.sidebar.collapsed").count()) === 0);

  // 5. Scroll-position persistence across client-side navigation
  await page.locator("aside.sidebar").evaluate((el) => { el.scrollTop = 140; });
  const before = await page.locator("aside.sidebar").evaluate((el) => el.scrollTop);
  // Navigate via the topbar Settings link (a client-side Link that does not touch the sidebar)
  await Promise.all([page.waitForURL(`${BASE}/settings/organization`, { timeout: 15000 }), page.click('a.topbar-icon-btn[href="/settings/organization"]')]);
  await page.waitForTimeout(200);
  const after = await page.locator("aside.sidebar").evaluate((el) => el.scrollTop);
  ok(`sidebar scroll preserved across navigation (${before} → ${after})`, before > 0 && after === before);

  // 6. Active highlight + active group stays open after navigating to Invoices
  await page.goto(`${BASE}/sales/invoices`, { waitUntil: "networkidle" });
  ok("Invoices highlighted as active after navigation", (await page.locator('.nav-item.active[href="/sales/invoices"]').count()) === 1);
  ok("active (Sales) group is expanded after navigation", await page.locator('.nav-item[href="/sales/quotations"]').isVisible());

  // 7. Screenshots — light, dark, Arabic RTL
  await page.screenshot({ path: `${SHOT_DIR}/sidebar_light.png` });
  await page.evaluate(() => { document.cookie = "theme=dark; path=/; max-age=31536000"; });
  await page.reload({ waitUntil: "networkidle" });
  ok("dark theme applied", (await page.locator('html[data-theme="dark"]').count()) === 1);
  await page.screenshot({ path: `${SHOT_DIR}/sidebar_dark.png` });
  await page.evaluate(() => { document.cookie = "theme=light; path=/; max-age=31536000"; document.cookie = "locale=ar; path=/; max-age=31536000"; });
  await page.reload({ waitUntil: "networkidle" });
  ok("RTL applied in Arabic", (await page.locator('html[dir="rtl"]').count()) === 1);
  await page.screenshot({ path: `${SHOT_DIR}/sidebar_ar_rtl.png` });

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
