/**
 * Builds a single self-contained HTML file of the presentation for easy
 * sharing/review: inlines CSS, JS, fonts, logos, and the screenshots the
 * built slides reference, as data URIs. The multi-file presentation/ tree
 * remains the source of truth; this is a build artifact.
 *
 * Usage: node presentation/tools/build_standalone.js [outFile]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'dist', 'elite-erp-presentation.html');

const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const dataUri = (file) => {
  const ext = path.extname(file);
  return `data:${MIME[ext]};base64,${fs.readFileSync(file).toString('base64')}`;
};

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Inline stylesheets (resolving their ../fonts/ url() references first)
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)" \/>/g, (m, href) => {
  let css = fs.readFileSync(path.join(ROOT, href), 'utf8');
  css = css.replace(/url\('\.\.\/(fonts\/[^']+)'\)/g, (m2, rel) => `url('${dataUri(path.join(ROOT, rel))}')`);
  return `<style>\n${css}\n</style>`;
});

// Inline scripts
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (m, src) =>
  `<script>\n${fs.readFileSync(path.join(ROOT, src), 'utf8')}\n</script>`);

// Inline every referenced asset path (src, data-src-en/ar, favicon)
const assetRefs = new Set();
for (const re of [/(?:src|href|data-src-en|data-src-ar)="(assets\/[^"]+)"/g]) {
  let m;
  while ((m = re.exec(html)) !== null) assetRefs.add(m[1]);
}
for (const ref of assetRefs) {
  html = html.split(`"${ref}"`).join(`"${dataUri(path.join(ROOT, ref))}"`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`built ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB, ${assetRefs.size} assets inlined)`);
