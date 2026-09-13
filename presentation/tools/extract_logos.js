/**
 * Extract the two approved EIS logo SVGs from the logo pack, tight-crop their
 * viewBoxes via getBBox(), and emit brand + knockout (white) variants.
 *
 * Usage: node presentation/tools/extract_logos.js <path-to-eislogos.html>
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const SRC = process.argv[2];
const OUT = path.resolve(__dirname, '..', 'assets', 'logo');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(SRC));
  const results = await page.evaluate(() => {
    const pad = 2;
    return Array.from(document.querySelectorAll('svg')).map((svg) => {
      const box = svg.getBBox();
      const vb = [box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2]
        .map((n) => Math.round(n * 100) / 100).join(' ');
      const clone = svg.cloneNode(true);
      clone.setAttribute('viewBox', vb);
      clone.removeAttribute('width');
      clone.removeAttribute('height');
      // drop inkscape metadata attributes
      clone.removeAttribute('xmlns:inkscape');
      clone.querySelectorAll('*').forEach((el) => {
        el.removeAttribute('inkscape:groupmode');
        el.removeAttribute('inkscape:label');
      });
      return { vb, svg: clone.outerHTML };
    });
  });
  await browser.close();

  fs.mkdirSync(OUT, { recursive: true });
  const [lockup, icon] = results;
  const write = (name, content) => {
    fs.writeFileSync(path.join(OUT, name), content + '\n');
    console.log(`  ✓ ${name} (${Buffer.byteLength(content)} bytes)`);
  };
  write('eis-lockup.svg', lockup.svg);
  write('eis-icon.svg', icon.svg);
  // Approved reversed applications: all-white knockout for navy/orange surfaces
  write('eis-lockup-white.svg', lockup.svg.replace(/#e56c25|#151348/gi, '#ffffff'));
  write('eis-icon-white.svg', icon.svg.replace(/#e56c25|#151348/gi, '#ffffff'));
  console.log('viewBoxes:', lockup.vb, '|', icon.vb);
})();
