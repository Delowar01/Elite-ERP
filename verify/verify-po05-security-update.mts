/**
 * verify:po05-security-update — Platform Owner PO-05 (Next.js security update and complete build recovery, development
 * only). The focused dependency verification for the record in verify/po05-security-update.mts.
 *
 *   npm run verify:po05-security-update              the manifests, the lockfile, the installed tree, the advisories
 *   npm run verify:po05-security-update -- --build   …and the compiled output in .next (run it after `next build`)
 *
 * 1. The manifests — next and eslint-config-next are pinned exactly to the patched release; react / react-dom are
 *    unchanged; package.json is the base's plus exactly the recorded hunks (undone, it is 741686e's to the byte).
 * 2. The lockfile — byte-pinned (here and in verify/document-form-pins.json); exactly the recorded entries changed,
 *    each to the patched release from the npm registry; undone, it is 741686e's to the byte; npm's six bundled-metadata
 *    entries of the optional wasm32 Tailwind binary stay out, as in the earlier lockfile changes (cf0c6e5, 041eb23).
 * 3. The installed tree — node_modules holds exactly the pinned releases.
 * 4. The advisories — every advisory recorded from the npm advisory database and the GitHub Advisory Database covers
 *    the old release and none covers the new one; each one's patched release is at or below the pin.
 * 5. With --build — the compiled output was produced by the pinned release, it is complete (build id, last recorded
 *    build stage, proxy), and the route table is the recorded one (no route added or removed). The advisory gate is
 *    awaited only after the output is written, so a build the gate stops leaves the same files: the gate's verdict is
 *    the build's exit code, recorded with the run (docs/platform-owner/PO05_NEXTJS_SECURITY.md §H), not something this
 *    check can see. What it does prove is that the output is the pinned release's, which no recorded advisory covers.
 *
 * Static and local only: no network, no database, nothing written.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { section, ok, summary } from "./platform/harness";
import {
  PO05_ADVISORIES, PO05_BASE, PO05_BASE_SHA, PO05_BUILD, PO05_EDITS, PO05_LOCK_CHANGED, PO05_LOCK_LEFT_OUT, PO05_LOCK_PIN,
  PO05_UNCHANGED, PO05_VERSIONS, po05Drift, undoPo05,
} from "./po05-security-update.mjs";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const require = createRequire(join(ROOT, "package.json"));
const semver = require("next/dist/compiled/semver") as { satisfies(v: string, r: string): boolean; lte(a: string, b: string): boolean; valid(v: string): string | null; validRange(r: string): string | null };
const installed = (pkg: string): string | null => {
  const f = join(ROOT, "node_modules", pkg, "package.json");
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { version: string }).version : null;
};
const BUILD = process.argv.includes("--build");
const NEW: string = PO05_VERSIONS.next[1];
const OLD: string = PO05_VERSIONS.next[0];

try {
  section("1. the manifests");
  const pkgText = read("package.json");
  const pkg = JSON.parse(pkgText) as { dependencies: Record<string, string>; devDependencies: Record<string, string>; optionalDependencies?: Record<string, string> };
  ok(`next is pinned exactly to ${NEW} and eslint-config-next to ${PO05_VERSIONS["eslint-config-next"][1]} (no range)`,
    pkg.dependencies.next === NEW && pkg.devDependencies["eslint-config-next"] === PO05_VERSIONS["eslint-config-next"][1],
    `${pkg.dependencies.next} / ${pkg.devDependencies["eslint-config-next"]}`);
  ok("the patched release keeps the installed major and minor line (16.4.x; no major upgrade)", semver.satisfies(NEW, `~${OLD}`) && NEW !== OLD);
  ok(`react and react-dom are unchanged (${PO05_UNCHANGED.react}), and neither sharp nor any override was added for this change`,
    pkg.dependencies.react === PO05_UNCHANGED.react && pkg.dependencies["react-dom"] === PO05_UNCHANGED["react-dom"] && !pkg.dependencies.sharp && !pkg.devDependencies.sharp &&
      JSON.stringify((JSON.parse(pkgText) as { overrides?: unknown }).overrides) === JSON.stringify({ "@vercel/cli-config": { zod: "^4.6.6" } }));
  const pkgUndone = undoPo05("package.json", pkgText);
  ok(`package.json is ${PO05_BASE.slice(0, 7)}'s plus exactly the recorded hunks (undone: ${PO05_BASE_SHA["package.json"]})`,
    sha16(pkgUndone) === PO05_BASE_SHA["package.json"] && PO05_EDITS["package.json"].length === 3, sha16(pkgUndone));

  section("2. the lockfile");
  const lockText = read("package-lock.json");
  const pins = JSON.parse(read("verify/document-form-pins.json")) as Record<string, string>;
  ok(`the lockfile is byte-pinned to ${PO05_LOCK_PIN.after}, here and in verify/document-form-pins.json (it was ${PO05_LOCK_PIN.before})`,
    sha16(lockText) === PO05_LOCK_PIN.after && pins["package-lock.json"] === PO05_LOCK_PIN.after, `${sha16(lockText)} / ${pins["package-lock.json"]}`);
  const lockUndone = undoPo05("package-lock.json", lockText);
  ok(`undone, the lockfile is ${PO05_BASE.slice(0, 7)}'s to the byte (${PO05_LOCK_PIN.before})`, sha16(lockUndone) === PO05_LOCK_PIN.before, sha16(lockUndone));
  const lock = JSON.parse(lockText) as { lockfileVersion: number; packages: Record<string, { version?: string; resolved?: string; integrity?: string; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }> };
  const base = JSON.parse(lockUndone) as typeof lock;
  const changed = Object.keys(lock.packages).filter((k) => JSON.stringify(lock.packages[k]) !== JSON.stringify(base.packages[k]));
  const sameKeys = Object.keys(lock.packages).length === Object.keys(base.packages).length && Object.keys(base.packages).every((k) => k in lock.packages);
  ok(`exactly the ${PO05_LOCK_CHANGED.length} recorded entries changed (the root manifest, next, its env and eight SWC binaries, eslint-config-next and its plugin); no entry added or removed`,
    sameKeys && JSON.stringify(changed.sort()) === JSON.stringify([...PO05_LOCK_CHANGED].sort()), changed.join(" "));
  const viaRegistry = PO05_LOCK_CHANGED.filter((k) => k !== "").every((k) => {
    const e = lock.packages[k];
    const name = k.slice("node_modules/".length);
    const file = name.split("/").pop();
    return e.version === NEW && e.resolved === `https://registry.npmjs.org/${name}/-/${file}-${NEW}.tgz` && /^sha512-[A-Za-z0-9+/]{86}==$/.test(e.integrity ?? "");
  });
  ok(`each changed package entry is ${NEW}, resolved from registry.npmjs.org, with a sha512 integrity`, viaRegistry);
  const nextEntry = lock.packages["node_modules/next"];
  ok(`next's own dependency ranges moved only with it (@next/env and the SWC binaries ${NEW}; sharp still ^0.35.5; react peer range unchanged)`,
    nextEntry.dependencies?.["@next/env"] === NEW && Object.entries(nextEntry.optionalDependencies ?? {}).every(([d, r]) => (d === "sharp" ? r === "^0.35.5" : d.startsWith("@next/swc-") && r === NEW)) &&
      JSON.stringify(Object.keys(nextEntry.dependencies ?? {}).sort()) === JSON.stringify(Object.keys(base.packages["node_modules/next"].dependencies ?? {}).sort()));
  ok("npm's six bundled-metadata entries of the optional wasm32 Tailwind binary are absent, as in the base lockfile",
    PO05_LOCK_LEFT_OUT.length === 6 && PO05_LOCK_LEFT_OUT.every((k) => !(k in lock.packages) && !(k in base.packages)) && lock.lockfileVersion === 3 && base.lockfileVersion === 3);
  const unchangedPkgs = Object.entries(PO05_UNCHANGED).every(([n, v]) => lock.packages[`node_modules/${n}`]?.version === v);
  ok(`react, react-dom and sharp keep their locked versions (${Object.entries(PO05_UNCHANGED).map(([n, v]) => `${n} ${v}`).join(", ")})`, unchangedPkgs);
  const drift = po05Drift((f) => { try { return read(f); } catch { return null; } });
  ok("PO-05's approved change: each recorded file is the base's plus exactly its hunks (po05Drift)", drift.length === 0, drift.join(" "));

  section("3. the installed tree");
  const tree = { next: installed("next"), "@next/env": installed("@next/env"), "eslint-config-next": installed("eslint-config-next"), "@next/eslint-plugin-next": installed("@next/eslint-plugin-next") };
  ok(`node_modules holds next, @next/env, eslint-config-next and @next/eslint-plugin-next ${NEW}`, Object.values(tree).every((v) => v === NEW), JSON.stringify(tree));
  const swc = ["@next/swc-linux-x64-gnu", "@next/swc-linux-x64-musl", "@next/swc-linux-arm64-gnu", "@next/swc-linux-arm64-musl", "@next/swc-darwin-arm64", "@next/swc-darwin-x64", "@next/swc-win32-arm64-msvc", "@next/swc-win32-x64-msvc"]
    .map((p) => [p, installed(p)] as const).filter(([, v]) => v !== null);
  ok(`every installed SWC binary is ${NEW} (at least the one for this platform)`, swc.length >= 1 && swc.every(([, v]) => v === NEW), JSON.stringify(swc));
  ok(`react, react-dom ${PO05_UNCHANGED.react} and sharp ${PO05_UNCHANGED.sharp} are installed unchanged`,
    installed("react") === PO05_UNCHANGED.react && installed("react-dom") === PO05_UNCHANGED["react-dom"] && installed("sharp") === PO05_UNCHANGED.sharp);

  section("4. the advisories");
  ok("seven advisories are recorded, each with its npm advisory id, GHSA id, CVE id, severity, CVSS and ranges, none repeated",
    PO05_ADVISORIES.length === 7 && new Set(PO05_ADVISORIES.map((a) => a.ghsa)).size === 7 && new Set(PO05_ADVISORIES.map((a) => a.cve)).size === 7 &&
      PO05_ADVISORIES.every((a) => /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/.test(a.ghsa) && /^CVE-\d{4}-\d{4,}$/.test(a.cve) && Number.isInteger(a.npm) && a.severity === "moderate" && a.cvss > 0 && a.cvss < 10 && semver.validRange(a.vulnerable) !== null && semver.valid(a.patched) !== null));
  const coverOld = PO05_ADVISORIES.filter((a) => !semver.satisfies(OLD, a.vulnerable)).map((a) => a.ghsa);
  ok(`every advisory covers the old release ${OLD}`, coverOld.length === 0, coverOld.join(" "));
  const coverNew = PO05_ADVISORIES.filter((a) => semver.satisfies(NEW, a.vulnerable)).map((a) => a.ghsa);
  ok(`no advisory covers the pinned release ${NEW}`, coverNew.length === 0, coverNew.join(" "));
  ok(`each advisory's patched release (${[...new Set(PO05_ADVISORIES.map((a) => a.patched))].join(", ")}) is at or below the pin, and is outside its own range`,
    PO05_ADVISORIES.every((a) => semver.lte(a.patched, NEW) && !semver.satisfies(a.patched, a.vulnerable)));

  if (BUILD) {
    section("5. the compiled output (--build)");
    const fw = JSON.parse(read(".next/diagnostics/framework.json")) as { name: string; version: string };
    ok(`the compiled output in .next was produced by Next.js ${NEW}`, fw.name === "Next.js" && fw.version === NEW, JSON.stringify(fw));
    const stage = (JSON.parse(read(".next/diagnostics/build-diagnostics.json")) as { buildStage?: string }).buildStage;
    ok(`the output is complete: a build id, and Next.js's last recorded build stage ("${PO05_BUILD.lastStage}")`,
      stage === PO05_BUILD.lastStage && existsSync(join(ROOT, ".next/BUILD_ID")) && read(".next/BUILD_ID").trim().length > 0, String(stage));
    const routes = [...new Set(Object.values(JSON.parse(read(".next/app-path-routes-manifest.json")) as Record<string, string>))].sort();
    ok(`the route table is the recorded one: ${PO05_BUILD.appRoutes} App Router routes (sha ${PO05_BUILD.routesSha}), the same as the blocked ${OLD} build`,
      routes.length === PO05_BUILD.appRoutes && sha16(routes.join("\n")) === PO05_BUILD.routesSha, `${routes.length} routes, ${sha16(routes.join("\n"))}`);
    ok("the proxy (src/proxy.ts) is compiled", existsSync(join(ROOT, ".next/server/middleware.js")));
  }
} catch (e) {
  ok("the PO-05 verification ran to the end", false, e instanceof Error ? e.message : String(e));
}

if (summary("verify:po05-security-update") !== 0) process.exitCode = 1;
