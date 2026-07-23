// Phase 3 fix — E2E login + registration flow in English AND Arabic.
// Drives the real /register and /login pages in a headless browser to prove that after the
// i18n rewrite the auth logic/validation/redirects/security still work, and that Arabic renders
// with RTL. Requires the production server on :3000.
//   node scripts/tests/auth-i18n.e2e.mjs
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
let failures = 0;
const ok = (name, cond) => { console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}`); if (!cond) failures++; };
const uniq = () => Math.random().toString(36).slice(2, 9);

async function run(locale) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "locale", value: locale, url: BASE }]);
  const page = await ctx.newPage();
  const email = `e2e_${locale}_${uniq()}@test.dev`;
  const pass = `Zx9$mQ${uniq()}vK!`;

  console.log(`\n== locale=${locale} ==`);

  // --- REGISTER ---
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  const dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
  const lang = await page.evaluate(() => document.documentElement.getAttribute("lang"));
  ok(`register page dir/lang correct`, dir === (locale === "ar" ? "rtl" : "ltr") && lang === locale);
  const arChars = await page.evaluate(() => (document.body.innerText.match(/[؀-ۿ]/g) || []).length);
  ok(`register page ${locale === "ar" ? "shows Arabic" : "shows no Arabic"}`, locale === "ar" ? arChars > 5 : arChars === 0);

  // validation: submit empty-ish (missing fields) should NOT redirect (stays on /register)
  await page.fill("#orgName", `E2E Org ${uniq()}`);
  await page.fill("#name", "Test Owner");
  await page.fill("#email", email);
  await page.fill("#password", pass);
  await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 15000 }), page.click('button[type="submit"]')]);
  ok(`register redirects to /dashboard`, page.url() === `${BASE}/dashboard`);

  // --- LOGOUT (clear session cookie) ---
  await ctx.clearCookies();
  await ctx.addCookies([{ name: "locale", value: locale, url: BASE }]);

  // --- LOGIN with wrong password → error, no redirect ---
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", "wrong-password");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  ok(`bad login stays on /login (validation preserved)`, page.url().startsWith(`${BASE}/login`));
  const errText = await page.evaluate(() => document.querySelector("p.text-danger")?.textContent || "");
  ok(`bad login shows an error message`, errText.trim().length > 0);
  if (locale === "ar") ok(`error message is in Arabic`, /[؀-ۿ]/.test(errText));

  // --- LOGIN with correct password → redirect to /dashboard ---
  await page.fill("#email", email);
  await page.fill("#password", pass);
  await Promise.all([page.waitForURL(`${BASE}/dashboard`, { timeout: 15000 }), page.click('button[type="submit"]')]);
  ok(`correct login redirects to /dashboard`, page.url() === `${BASE}/dashboard`);

  await browser.close();
}

(async () => {
  await run("en");
  await run("ar");
  console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
