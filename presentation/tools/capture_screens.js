/**
 * Elite ERP Executive Presentation — Phase 0 screenshot pipeline.
 *
 * Drives the approved V27 mockup (tools/mockup-v27.html) with Playwright and
 * captures the product screens needed by the deck, once in English and once
 * in Arabic (RTL), at 2× device scale.
 *
 * Usage: node presentation/tools/capture_screens.js
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const EXECUTABLE = '/opt/pw-browsers/chromium';
const MOCKUP = 'file://' + path.resolve(__dirname, 'mockup-v27.html');
const OUT = path.resolve(__dirname, '..', 'assets', 'screenshots');

// Screens used by the presentation (slide mapping in docs/PRESENTATION_IMPLEMENTATION_PLAN.md)
const SCREENS = [
  'dashboard',   // slides 05 + 11
  'quotations',  // slide 06 primary
  'clients',     // slide 06 secondary
  'ledger',      // slide 07 primary
  'invoices',    // slide 07 secondary
  'employees',   // slide 08 primary
  'payroll',     // slide 08 secondary
  'po',          // slide 09 primary
  'products',    // slide 09 secondary
  'projects',    // slide 10
];

const VIEWPORT = { width: 1720, height: 1100 };
const SCALE = 2;

// Uniform framing: every capture is the same 1520×950 app window (16:10-ish),
// content beyond the fold is clipped exactly like a real browser window.
// The frame is pinned to the viewport origin and captured via a fixed clip
// rect — element screenshots mis-clip when the RTL page overflows horizontally.
const FRAME_W = 1520;
const FRAME_H = 950;
const CAPTURE_CSS = `
  html, body { overflow: hidden !important; }
  .mode-view.active .frame.app-router {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: auto !important;
    width: ${FRAME_W}px !important;
    height: ${FRAME_H}px !important;
    max-width: none !important;
    margin: 0 !important;
    z-index: 99999;
    overflow: hidden !important;
    display: flex; flex-direction: column;
    border-radius: 0 !important;
  }
  .mode-view.active .frame.app-router .app-shell {
    flex: 1 1 auto;
    min-height: 0 !important;
    height: auto !important;
    overflow: hidden !important;
  }
  *, *::before, *::after { animation: none !important; transition: none !important; }
`;

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450); // sparklines/canvas + transition settle
}

async function captureSet(page, lang) {
  const dir = path.join(OUT, lang);
  fs.mkdirSync(dir, { recursive: true });
  for (const key of SCREENS) {
    await page.evaluate((k) => {
      const item = document.querySelector(`.nav-item[data-screen="${k}"]`);
      if (!item) throw new Error(`nav item not found for screen: ${k}`);
      item.click();
    }, key);
    await settle(page);
    const file = path.join(dir, `${key}.png`);
    await page.screenshot({
      path: file,
      type: 'png',
      clip: { x: 0, y: 0, width: FRAME_W, height: FRAME_H },
    });
    console.log(`  ✓ ${lang}/${key}.png`);
  }
}

async function captureLanguage(browser, lang) {
  // Fresh page per language: the mockup mirrors inline styles when switching to
  // RTL, so the language must be applied BEFORE the framing clamp is injected.
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  page.on('console', (m) => { if (m.type() === 'error') console.error('page error:', m.text()); });
  await page.goto(MOCKUP, { waitUntil: 'load' });
  await settle(page);
  await page.evaluate((l) => setLanguage(l), lang);
  await settle(page);
  if (lang === 'ar') {
    const rtlOk = await page.evaluate(() => {
      const rtl = document.documentElement.getAttribute('dir') === 'rtl'
        || document.body.getAttribute('dir') === 'rtl'
        || getComputedStyle(document.body).direction === 'rtl';
      const arabic = /[؀-ۿ]/.test(document.body.textContent);
      return rtl && arabic;
    });
    if (!rtlOk) throw new Error('Arabic mode did not apply RTL + Arabic content — aborting capture.');
  }
  await page.addStyleTag({ content: CAPTURE_CSS });
  await settle(page);
  console.log(`Capturing ${lang === 'en' ? 'English' : 'Arabic'} set…`);
  await captureSet(page, lang);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  await captureLanguage(browser, 'en');
  await captureLanguage(browser, 'ar');
  await browser.close();
  console.log('Done.');
})();
