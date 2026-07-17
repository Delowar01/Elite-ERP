/**
 * Phase 0 QA — asserts the asset base is complete and sound:
 *  - all 10 screens captured in both en/ and ar/, uniform 2× dimensions
 *  - every capture is unique (no stuck-screen duplicates)
 *  - each AR capture differs from its EN counterpart
 *  - logo SVGs extracted with tight viewBoxes, white variants recolored
 *  - fonts present (Inter variable latin + IBM Plex Sans Arabic weights)
 *
 * Usage: node presentation/tools/verify_phase0.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!cond) failures++;
};

const SCREENS = ['dashboard', 'quotations', 'clients', 'ledger', 'invoices',
  'employees', 'payroll', 'po', 'products', 'projects'];

function pngDims(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');

console.log('Screenshots:');
const hashes = new Map();
for (const lang of ['en', 'ar']) {
  for (const key of SCREENS) {
    const file = path.join(ROOT, 'assets', 'screenshots', lang, `${key}.png`);
    if (!fs.existsSync(file)) { ok(false, `${lang}/${key}.png exists`); continue; }
    const { w, h } = pngDims(file);
    ok(w === 3040 && h === 1900, `${lang}/${key}.png is 3040×1900 (got ${w}×${h})`);
    hashes.set(`${lang}/${key}`, md5(file));
  }
}
ok(new Set(hashes.values()).size === hashes.size, 'all captures unique (no stuck screens)');
for (const key of SCREENS) {
  ok(hashes.get(`en/${key}`) !== hashes.get(`ar/${key}`), `ar/${key} differs from en/${key}`);
}

console.log('Logos:');
for (const f of ['eis-lockup.svg', 'eis-icon.svg', 'eis-lockup-white.svg', 'eis-icon-white.svg']) {
  const file = path.join(ROOT, 'assets', 'logo', f);
  const exists = fs.existsSync(file);
  ok(exists, `${f} exists`);
  if (!exists) continue;
  const svg = fs.readFileSync(file, 'utf8');
  ok(/viewBox="[-\d. ]+"/.test(svg), `${f} has viewBox`);
  if (f.includes('white')) {
    ok(!/#(e56c25|151348)/i.test(svg), `${f} fully recolored to white`);
  } else {
    ok(/#(e56c25|151348)/i.test(svg), `${f} keeps brand colors`);
  }
}

console.log('Fonts:');
ok(fs.existsSync(path.join(ROOT, 'fonts', 'inter', 'inter-var-latin.woff2')), 'Inter variable (latin) present');
for (const w of [400, 500, 600, 700]) {
  ok(fs.existsSync(path.join(ROOT, 'fonts', 'arabic', `plex-arabic-arabic-${w}.woff2`)), `Plex Sans Arabic ${w} (arabic) present`);
  ok(fs.existsSync(path.join(ROOT, 'fonts', 'arabic', `plex-arabic-latin-${w}.woff2`)), `Plex Sans Arabic ${w} (latin) present`);
}

console.log('Icons:');
const icons = fs.readFileSync(path.join(ROOT, 'assets', 'icons', 'icons.svg'), 'utf8');
const symbolCount = (icons.match(/<symbol /g) || []).length;
ok(symbolCount >= 24, `icon sprite has ${symbolCount} symbols (≥24)`);
ok(!/emoji|fill="#(?!currentColor)/.test(icons.replace(/fill="currentColor"|fill="none"/g, '')), 'icons use currentColor/none fills only');

console.log(failures === 0 ? '\nPhase 0 VERIFIED — all checks passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
