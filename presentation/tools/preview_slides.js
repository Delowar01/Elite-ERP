/**
 * Dev preview: renders each built slide of the presentation (English-only)
 * and saves screenshots for visual review.
 *
 * Usage: node presentation/tools/preview_slides.js <outDir> [slideCount]
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const OUT = process.argv[2] || '/tmp/slides-preview';
const COUNT = parseInt(process.argv[3] || '4', 10);
const INDEX = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (m) => { if (m.type() === 'error') console.error('page error:', m.text()); });
  page.on('pageerror', (e) => console.error('JS error:', e.message));
  await page.goto(INDEX, { waitUntil: 'load' });
  await page.waitForSelector('#loader.done', { timeout: 8000 });
  for (let i = 0; i < COUNT; i++) {
    await page.evaluate((idx) => window.Presentation.go(idx, { force: true }), i);
    await page.waitForTimeout(2100); // let the full entry sequence finish
    const file = path.join(OUT, `slide-${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: file, type: 'png' });
    console.log('  ✓', path.basename(file));
  }
  await browser.close();
})();
