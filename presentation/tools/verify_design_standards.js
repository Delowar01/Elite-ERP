/**
 * Static-analysis gate for the client's design-revision brief
 * (docs: "Elite ERP Presentation — Design Improvement Prompt"). Encodes the
 * two objectively-checkable rules from its self-check list so every future
 * slide batch inherits the same discipline instead of relying on manual
 * re-reading of the brief:
 *
 *  [ ] No component larger than a small icon-label pair uses a flat 4-side
 *      border as its only visual definition
 *  [ ] No readable text is under ~18px (true section eyebrows excepted,
 *      provided they carry uppercase + letter-spacing + weight)
 *
 * "No obviously empty quadrant" and "premium as a standalone screenshot"
 * are visual-judgment calls verified by rendering + human review each pass
 * (see tools/preview_slides.js) — not something a static check can assess.
 *
 * Usage: node presentation/tools/verify_design_standards.js
 */
const fs = require('fs');
const path = require('path');

const CSS_DIR = path.resolve(__dirname, '..', 'css');
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!cond) failures++;
};

// Selectors sanctioned to keep a plain border: the single primary container
// per slide (hero screenshot, main diagram panel), pure nav chrome (not
// slide content), and the decorative corner-orbit rings (a deliberately
// asymmetric, off-canvas background device — not a card/chip outline).
const BORDER_ALLOWLIST = ['.shot-card', '.s02-panel', '.chrome-btn', '.corner-orbit'];

// Selectors sanctioned to render under 18px: ONLY micro-labels genuinely
// constrained by a small chip/pill's footprint, styled as true eyebrows
// (uppercase + letter-spacing + weight), and the decorative (non-
// informational) ghost-num watermark. Round 2 client feedback explicitly
// rejected exempting nav chrome / slide-counter / section eyebrows that
// have room to breathe — those must hit the real 18px floor like
// everything else, so they are NOT in this list.
const SIZE_ALLOWLIST = [
  '.core-sub', '.stat-chip .sc-label', '.mini-tag span', '.ghost-num',
];

function readAllCss() {
  return fs.readdirSync(CSS_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(CSS_DIR, f), 'utf8') }));
}

function extractRules(css) {
  // naive but sufficient CSS rule splitter for this hand-authored stylesheet
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    rules.push({ selector: m[1].trim(), body: m[2] });
  }
  return rules;
}

console.log('Border audit (flat 4-side borders on content components):');
for (const { file, text } of readAllCss()) {
  for (const { selector, body } of extractRules(text)) {
    // plain `border:` shorthand with a non-zero width (not border-inline-*/border-radius/`border:0`)
    if (!/\bborder\s*:\s*(?!0\b)\d/.test(body)) continue;
    const allowed = BORDER_ALLOWLIST.some((sel) => selector.includes(sel));
    ok(allowed, `${file} — "${selector}" ${allowed ? 'is an approved primary-container/chrome exception' : 'uses a flat border — needs shadow/accent-edge treatment'}`);
  }
}

console.log('Typography floor audit (functional text ≥ ~18px):');
for (const { file, text } of readAllCss()) {
  for (const { selector, body } of extractRules(text)) {
    const sizeMatch = body.match(/font-size\s*:\s*([\d.]+)px/);
    if (!sizeMatch) continue;
    const size = parseFloat(sizeMatch[1]);
    if (size >= 18) continue;
    if (/@keyframes|from|to/.test(selector)) continue;
    const allowed = SIZE_ALLOWLIST.some((sel) => selector.includes(sel));
    ok(allowed, `${file} — "${selector}" is ${size}px ${allowed ? '(sanctioned eyebrow/chrome exception)' : '— below the 18px floor, needs bumping or eyebrow-style treatment'}`);
  }
}

console.log(failures === 0
  ? '\nDESIGN STANDARDS VERIFIED — no unsanctioned flat borders or undersized text.'
  : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
