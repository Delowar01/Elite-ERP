#!/usr/bin/env node
// PO-07 S6-R: the build output of `next build` is complete for `next start` (run in CI right after the build).
//   node check-build.mjs <app dir>
// Checks: BUILD_ID; the manifests `next start` loads; every page and route under src/app has its entry in the
// app-paths manifest and its compiled server file (extra manifest entries only Next's own: /_not-found,
// /_global-error and metadata files that exist in src/app); the Server Action manifest is non-empty; every link Turbopack
// created in .next/node_modules for the external server packages resolves to a package in node_modules.
// Prints a summary; exit 1 on any failure.
import fs from "node:fs";
import path from "node:path";

const app = path.resolve(process.argv[2] ?? ".");
const next = path.join(app, ".next");
let failures = 0;
const ok = (c, msg) => { console.log(`${c ? "PASS" : "FAIL"} ${msg}`); if (!c) failures++; };
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(next, p), "utf8"));

const buildId = fs.existsSync(path.join(next, "BUILD_ID")) ? fs.readFileSync(path.join(next, "BUILD_ID"), "utf8").trim() : "";
ok(/^[A-Za-z0-9_-]{8,64}$/.test(buildId), `BUILD_ID present (${buildId || "missing"})`);
for (const f of ["build-manifest.json", "prerender-manifest.json", "routes-manifest.json", "required-server-files.json", "app-path-routes-manifest.json",
  "server/app-paths-manifest.json", "server/server-reference-manifest.json", "server/middleware-manifest.json", "server/pages-manifest.json", "server/next-font-manifest.json"]) {
  ok(fs.existsSync(path.join(next, f)), `.next/${f} exists`);
}
const staticDir = path.join(next, "static");
const staticCount = fs.existsSync(staticDir) ? fs.readdirSync(staticDir, { recursive: true }).length : 0;
ok(staticCount > 0, `.next/static has ${staticCount} entries`);

// pages and routes
const appDir = path.join(app, "src", "app");
const expected = new Set();
for (const rel of fs.readdirSync(appDir, { recursive: true })) {
  const p = String(rel).replace(/\\/g, "/");
  const m = /^(?:(.*)\/)?(page|route)\.(tsx|ts|jsx|js|mdx)$/.exec(p);
  if (m) expected.add(`/${m[1] ? `${m[1]}/` : ""}${m[2]}`);
}
const metadataFiles = new Set(fs.readdirSync(appDir).filter((f) => /^(favicon\.ico|icon\.\w+|apple-icon\.\w+|opengraph-image\.\w+|twitter-image\.\w+|robots\.(txt|ts)|sitemap\.(xml|ts)|manifest\.(webmanifest|json|ts))$/.test(f)));
const frameworkOwn = new Set(["/_not-found/page", "/_global-error/page", ...[...metadataFiles].map((f) => `/${f.replace(/\.ts$/, f.startsWith("robots") ? ".txt" : f.startsWith("sitemap") ? ".xml" : ".webmanifest")}/route`)]);
let manifest = {};
try { manifest = readJson("server/app-paths-manifest.json"); } catch { /* reported below */ }
const keys = new Set(Object.keys(manifest));
const missing = [...expected].filter((k) => !keys.has(k));
const extra = [...keys].filter((k) => !expected.has(k) && !frameworkOwn.has(k));
ok(expected.size > 0 && missing.length === 0, `every page/route under src/app is in the app-paths manifest (${expected.size} expected${missing.length ? `; missing: ${missing.slice(0, 10).join(", ")}` : ""})`);
ok(extra.length === 0, `no unexplained manifest entries (${keys.size} total${extra.length ? `; extra: ${extra.slice(0, 10).join(", ")}` : ""})`);
const noFile = Object.entries(manifest).filter(([, f]) => !fs.existsSync(path.join(next, "server", f)));
ok(keys.size > 0 && noFile.length === 0, `every manifest entry has its compiled server file${noFile.length ? ` (missing: ${noFile.slice(0, 5).map(([k]) => k).join(", ")})` : ""}`);

// Server Actions
let actions = 0;
try { const s = readJson("server/server-reference-manifest.json"); actions = Object.keys(s.node ?? {}).length + Object.keys(s.edge ?? {}).length; } catch { /* counted as 0 */ }
ok(actions > 0, `Server Action manifest lists ${actions} actions`);

// external packages linked by Turbopack
const nm = path.join(next, "node_modules");
const links = [];
if (fs.existsSync(nm)) {
  for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
    if (e.isDirectory() && e.name.startsWith("@")) for (const s of fs.readdirSync(path.join(nm, e.name), { withFileTypes: true })) links.push([`${e.name}/${s.name}`, s]);
    else links.push([e.name, e]);
  }
}
for (const [name, e] of links) {
  const p = path.join(nm, name);
  const target = e.isSymbolicLink() ? fs.readlinkSync(p) : "(not a link)";
  let real = "";
  try { real = fs.realpathSync(p); } catch { /* dangling */ }
  const inNm = real.startsWith(path.join(fs.realpathSync(app), "node_modules") + path.sep) && fs.existsSync(path.join(real, "package.json"));
  ok(e.isSymbolicLink() && inNm, `.next/node_modules/${name} -> ${target} resolves to a package in node_modules`);
}
console.log(`BUILD-CHECK ${failures ? "FAIL" : "PASS"} build_id=${buildId} routes=${keys.size} actions=${actions} external_links=${links.length} failures=${failures}`);
process.exit(failures ? 1 : 0);
