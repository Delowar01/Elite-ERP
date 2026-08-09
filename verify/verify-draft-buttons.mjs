// Verifies the "Fix Save as Draft and Print Preview Buttons" task on live create pages.
// The app renders a top titlebar action row AND a bottom sticky action bar; each is one
// intentional container that mirrors the other (this is NOT the duplicate the task targets).
// The task's duplicate was "Save as Draft" living inside the Save & Submit dropdown — removed.
// So we assert, PER container: exactly one Save as Draft, one Print Preview, no More Actions,
// no split-button dropdown; the bottom bar additionally has the primary submit; and page-wide
// there are exactly 2 Save as Draft (top + bottom) — never 3+ and never inside a dropdown.
import { chromium } from "playwright";
import { readFileSync } from "fs";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";
const BASE = "http://localhost:3000";
readFileSync(".env", "utf8"); // ensure cwd correct
let fail = 0;
const ok = (n, c) => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${n}`); if (!c) fail++; };
const uniq = () => Math.random().toString(36).slice(2, 8);
const PAGES = [
  ["/sales/quotations/new", "Save & Submit"],
  ["/sales/orders/new", "Confirm Order"],
  ["/sales/proforma/new", "Send to Client"],
  ["/sales/invoices/new", "Send to Client"],
  ["/sales/delivery-challans/new", "Create & Dispatch"],
  ["/sales/credit-notes/new", "Issue Credit Note"],
  ["/purchasing/orders/new", "Send to Vendor"],
  ["/purchasing/debit-notes/new", "Issue Debit Note"],
];
const rx = (s) => new RegExp("^" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");

async function main() {
  // Refuse to run against a build other than the one on disk — see assert-fresh-build.mjs.
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.fill("#orgName", `BTN Org ${uniq()}`);
  await page.fill("#name", "BTN Owner");
  await page.fill("#email", `btn_${uniq()}@test.dev`);
  await page.fill("#password", `Zx9$mQ${uniq()}vK!ray`);
  // Registration requires a country as of FX-1a; the currency follows it.
  await pickCountry(page);
  await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 20000 }), page.click('button[type="submit"]')]);

  for (const [path, primary] of PAGES) {
    console.log(`\n== ${path} ==`);
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const bar = page.locator(".doc-action-bar");
    const top = page.locator(".doc-titlebar-actions");
    ok("bottom action bar present", (await bar.count()) === 1);
    ok("top titlebar actions present", (await top.count()) === 1);

    // bottom bar: Save as Draft | Print Preview | primary, one each, in that DOM order
    ok("bottom: exactly one Save as Draft", (await bar.getByRole("button", { name: /^Save as Draft$/ }).count()) === 1);
    ok("bottom: exactly one Print Preview", (await bar.getByRole("button", { name: /Print Preview/ }).count() + await bar.getByRole("link", { name: /Print Preview/ }).count()) === 1);
    ok(`bottom: primary "${primary}" present`, (await bar.getByRole("button", { name: rx(primary) }).count()) === 1);
    const barText = (await bar.innerText()).replace(/\s+/g, " ");
    ok("bottom order = Save as Draft → Print Preview → primary",
       barText.indexOf("Save as Draft") < barText.indexOf("Print Preview") && barText.indexOf("Print Preview") < barText.indexOf(primary));

    // top titlebar: Save as Draft + Print Preview, one each, NO More Actions
    ok("top: exactly one Save as Draft", (await top.getByRole("button", { name: /^Save as Draft$/ }).count()) === 1);
    ok("top: exactly one Print Preview", (await top.getByRole("button", { name: /Print Preview/ }).count()) === 1);
    ok("top: no More Actions", (await top.getByRole("button", { name: /More Actions/ }).count()) === 0);

    // page-wide guards
    ok("page: no 'More Actions' anywhere", (await page.getByRole("button", { name: /More Actions/ }).count()) === 0);
    ok("page: no split-button dropdown (.btn-split)", (await page.locator(".btn-split").count()) === 0);
    ok("page: exactly 2 Save as Draft (top + bottom, no 3rd/dropdown copy)", (await page.getByRole("button", { name: /^Save as Draft$/ }).count()) === 2);
  }
  await browser.close();
  console.log(`\n${fail === 0 ? "ALL PASSED" : fail + " CHECK(S) FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
