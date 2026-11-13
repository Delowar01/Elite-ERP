/**
 * Platform Owner PO-01B (secure login, MFA, platform shell and UI preview) — the approved change to files the DEV-UI-01.7,
 * ACC-01, LCP and PO-01B verifiers freeze.
 *
 * PO-01B adds the Platform Owner console by design: a narrowly scoped /platform branch in src/proxy.ts (one import, one
 * delegation line before the customer branch — the customer branch and the matcher are untouched), one redirect target
 * in the PO-01B platform guard (an unusable session goes to the cookie-clearing /platform/session-expired handler), new
 * files under src/app/(platform), src/components/platform, src/lib/platform-edge and src/lib/platform, and the undo layer
 * in the two freeze verifiers. Their rule for an approved change is the one C8, ACC-01, the LCP stage and PO-01B used: no
 * re-baseline. Each changed file's hunks are recorded here byte for byte, [92c4397's text, PO-01B's text]; undone, the
 * file is PO-01B's (92c4397) to the byte (PO01B_BASE_SHA), so every older pin — PO-01B's, LCP's and ACC-01's included —
 * keeps its strength. The added files are listed with their sha256 (PO01B_NEW) and left out of the older pins' walks.
 * Each freeze verifier's PO-01B check proves the hunks are each file's only change.
 *
 * Generated from the diff against PO01B_BASE (each hunk widened with context until it is unique in both files, its
 * 92c4397 form nowhere in PO-01B's); changing a PO-01B file means regenerating this record, which is then part of the
 * change under review. No customer route, component, auth/session, business, schema, print or API file is in either list.
 */
import { createHash } from "node:crypto";

export const PO01B_BASE = "92c4397b7935228f946a64ffa2d40603b7258724";
export const PO01B_EDITS: Record<string, [string, string][]> = {
  "src/proxy.ts": [
    ["import { jwtVerify } from \"jose\";\n\n",
      "import { jwtVerify } from \"jose\";\nimport { isPlatformPath, platformGate } from \"@/lib/platform-edge/proxy-gate\";\n\n"],
    ["  const { pathname } = request.nextUrl;\n  const token = request.cookies.get(SESSION_COOKIE)?.value;\n",
      "  const { pathname } = request.nextUrl;\n  // Platform Owner console (PO-01B): its own narrowly scoped branch, decided before — and without —\n  // the customer session cookie. Nothing below this line changes for customer routes.\n  if (isPlatformPath(pathname)) return platformGate(request);\n  const token = request.cookies.get(SESSION_COOKIE)?.value;\n"],
  ],
  "src/lib/platform/guards.ts": [
    ["    return redirect(\"/platform/login\");\n",
      "    // PO-01B: via the cookie-clearing handler, which re-runs this same check before clearing — so a\n    // stale cookie is removed, a live one is never force-cleared, and no redirect loop can form.\n    return redirect(\"/platform/session-expired\");\n"],
  ],
  "verify/verify-document-form.mts": [
    ["import { PO01A_EDITS, PO01A_NEW, po01aDrift, undoPo01a } from \"./po01a-approved-delta.mjs\";\n\n",
      "import { PO01A_EDITS, PO01A_NEW, po01aDrift, undoPo01a } from \"./po01a-approved-delta.mjs\";\nimport { PO01B_EDITS, PO01B_NEW, po01bDrift, undoPo01b } from \"./po01b-approved-delta.mjs\";\n\n"],
    ["const po01aRead = (p: string) => undoPo01a(p, diskRead(p));\n",
      "// Platform Owner PO-01B: its recorded hunks are undone before PO-01A's (its check below proves they are each file's only\n// change), so the PO-01A layer and every older pin read PO-01A's bytes; the files PO-01B added stay out of the directory pins.\nconst po01bRead = (p: string) => undoPo01b(p, diskRead(p));\nconst po01aRead = (p: string) => undoPo01a(p, po01bRead(p));\n"],
    ["  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW)) files.push(p); } };\n",
      "  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW)) files.push(p); } };\n"],
    ["  for (const f of files.sort()) { hh.update(f + \"\\0\"); hh.update(f in ACC01_EDITS || f in LCP_EDITS || f in PO01A_EDITS ? read(f) : readFileSync(join(ROOT, f))); }\n",
      "  for (const f of files.sort()) { hh.update(f + \"\\0\"); hh.update(f in ACC01_EDITS || f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS ? read(f) : readFileSync(join(ROOT, f))); }\n"],
    ["const po01aDriftNow = po01aDrift((f) => { try { return diskRead(f); } catch { return null; } });\n",
      "const po01aDriftNow = po01aDrift((f) => { try { return po01bRead(f); } catch { return null; } });\n"],
    ["  po01aDriftNow.length === 0 && Object.keys(PO01A_EDITS).length > 0, po01aDriftNow.join(\" \"));\nconst SUBMIT: Record<string, string> = {\n",
      "  po01aDriftNow.length === 0 && Object.keys(PO01A_EDITS).length > 0, po01aDriftNow.join(\" \"));\nconst po01bDriftNow = po01bDrift((f) => { try { return diskRead(f); } catch { return null; } });\ncheck(\"Platform Owner PO-01B's approved change: each recorded file is PO-01A's (92c4397) plus exactly its hunks, each added file (the /platform routes, src/components/platform, the edge gate, the console library) as recorded (verify/po01b-approved-delta.mts)\",\n  po01bDriftNow.length === 0 && Object.keys(PO01B_EDITS).length > 0, po01bDriftNow.join(\" \"));\nconst SUBMIT: Record<string, string> = {\n"],
  ],
  "verify/verify-page-archetypes.mts": [
    ["import { PO01A_BASE, PO01A_EDITS, PO01A_NEW, po01aDrift, undoPo01a } from \"./po01a-approved-delta.mjs\";\nimport { renderToStaticMarkup } from \"react-dom/server\";\n",
      "import { PO01A_BASE, PO01A_EDITS, PO01A_NEW, po01aDrift, undoPo01a } from \"./po01a-approved-delta.mjs\";\nimport { PO01B_BASE, PO01B_EDITS, PO01B_NEW, po01bDrift, undoPo01b } from \"./po01b-approved-delta.mjs\";\nimport { renderToStaticMarkup } from \"react-dom/server\";\n"],
    ["const po01aRead = (p: string) => undoPo01a(p, diskRead(p));\n",
      "// Platform Owner PO-01B: its recorded hunks are undone before PO-01A's (group 22 proves they are each file's only change),\n// so the PO-01A layer and every older group read PO-01A's bytes; the files PO-01B added stay out of `walk` like PO-01A's.\nconst po01bRead = (p: string) => undoPo01b(p, diskRead(p));\nconst po01aRead = (p: string) => undoPo01a(p, po01bRead(p));\n"],
    ["    : f in ACC01_EDITS ? rawRead(f) : f in LCP_EDITS || f in PO01A_EDITS ? actualRead(f) : readFileSync(path.join(ROOT, f));\n",
      "    : f in ACC01_EDITS ? rawRead(f) : f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS ? actualRead(f) : readFileSync(path.join(ROOT, f));\n"],
    ["    else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW)) out.push(p);\n",
      "    else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW)) out.push(p);\n"],
    ["  walk(\"src\").length + Object.keys(ACC01_NEW).length + Object.keys(LCP_NEW).length + Object.keys(PO01A_NEW).filter((f) => f.startsWith(\"src/\")).length === (function all(d: string): number {\n",
      "  walk(\"src\").length + Object.keys(ACC01_NEW).length + Object.keys(LCP_NEW).length + Object.keys(PO01A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B_NEW).filter((f) => f.startsWith(\"src/\")).length === (function all(d: string): number {\n"],
    ["const po01aDriftNow = po01aDrift((f) => (existsSync(path.join(ROOT, f)) ? diskRead(f) : null));\n",
      "const po01aDriftNow = po01aDrift((f) => (existsSync(path.join(ROOT, f)) ? po01bRead(f) : null));\n"],
    ["check(\"PO-01A touched no customer app, component, auth/session, business, print, API or historical-migration file\", po01aTouched.length === 0, po01aTouched.join(\" \"));\n\nconsole.log(\"\\nGroups:\");\nfor (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);\n",
      "check(\"PO-01A touched no customer app, component, auth/session, business, print, API or historical-migration file\", po01aTouched.length === 0, po01aTouched.join(\" \"));\n\n// ---------- 22. Platform Owner PO-01B — the approved change to frozen files ----------\nsection(\"22. Platform Owner PO-01B — secure login, MFA, platform shell and UI preview (the approved change to frozen files)\");\n// Read as they are on disk: each changed file is PO-01A's (92c4397) plus exactly its recorded hunks, each added file as recorded.\nconst po01bDriftNow = po01bDrift((f) => (existsSync(path.join(ROOT, f)) ? diskRead(f) : null));\nconst PO01B_EDITABLE = [\"src/proxy.ts\", \"src/lib/platform/guards.ts\", \"verify/verify-document-form.mts\", \"verify/verify-page-archetypes.mts\"];\ncheck(`PO-01B changed its ${Object.keys(PO01B_EDITS).length} files (the proxy's /platform branch, the platform guard's redirect target and the two freeze verifiers) by exactly their ${Object.values(PO01B_EDITS).flat().length} recorded hunks — undone, each file is ${PO01B_BASE.slice(0, 7)}'s to the byte — and added exactly its ${Object.keys(PO01B_NEW).length} files, as recorded (verify/po01b-approved-delta.mts)`,\n  po01bDriftNow.length === 0 && PO01B_BASE === \"92c4397b7935228f946a64ffa2d40603b7258724\" &&\n    Object.keys(PO01B_EDITS).every((f) => PO01B_EDITABLE.includes(f)) && (PO01B_EDITS[\"src/proxy.ts\"] ?? []).length === 2,\n  po01bDriftNow.map(rel).join(\" \"));\n// PO-01B is the console only: its added files live under the platform route group, the platform components, the edge\n// gate and the platform library; it changes no customer route, component, library, schema or migration.\nconst PO01B_NEW_SCOPE = /^src\\/(app\\/\\(platform\\)\\/|components\\/platform\\/|lib\\/platform-edge\\/|lib\\/platform\\/)[\\w()./-]+$/;\nconst po01bOutside = Object.keys(PO01B_NEW).filter((f) => !PO01B_NEW_SCOPE.test(f));\ncheck(\"PO-01B added files only under src/app/(platform), src/components/platform, src/lib/platform-edge and src/lib/platform\", Object.keys(PO01B_NEW).length > 0 && po01bOutside.length === 0, po01bOutside.join(\" \"));\n// Line-level: what each proxy hunk adds and removes (its context lines appear on both sides).\nconst lineDelta = (hunks: [string, string][]) => hunks.reduce(\n  (acc, [was, is]) => {\n    const w = was.split(\"\\n\"), n = is.split(\"\\n\");\n    return { added: [...acc.added, ...n.filter((l) => !w.includes(l))], removed: [...acc.removed, ...w.filter((l) => !n.includes(l))] };\n  },\n  { added: [] as string[], removed: [] as string[] },\n);\nconst proxyDelta = lineDelta(PO01B_EDITS[\"src/proxy.ts\"] ?? []);\nconst proxyCode = proxyDelta.added.filter((l) => !/^\\s*\\/\\//.test(l));\ncheck(\"PO-01B's only change to src/proxy.ts is the edge-gate import and the one-line /platform delegation (plus its comment) — nothing removed, the customer branch and matcher untouched\",\n  proxyDelta.removed.length === 0 && proxyCode.length === 2 &&\n    proxyCode[0] === 'import { isPlatformPath, platformGate } from \"@/lib/platform-edge/proxy-gate\";' &&\n    proxyCode[1] === \"  if (isPlatformPath(pathname)) return platformGate(request);\",\n  JSON.stringify(proxyDelta));\nconst guardDelta = lineDelta(PO01B_EDITS[\"src/lib/platform/guards.ts\"] ?? []);\ncheck(\"PO-01B's only change to the platform guard is its redirect target for an unusable session (/platform/session-expired, the cookie-clearing handler)\",\n  guardDelta.removed.filter((l) => !/^\\s*\\/\\//.test(l)).join(\"\") === '    return redirect(\"/platform/login\");' &&\n    guardDelta.added.filter((l) => !/^\\s*\\/\\//.test(l)).join(\"\") === '    return redirect(\"/platform/session-expired\");',\n  JSON.stringify(guardDelta));\n\nconsole.log(\"\\nGroups:\");\nfor (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);\n"],
  ],
};

function byPath(pairs: [string, string][]): Record<string, string> {
  return Object.fromEntries(pairs.map(([sha, file]) => [file, sha]));
}
/** 92c4397's bytes of each changed file (sha256, 16 hex) — what the file is once its hunks are undone. */
export const PO01B_BASE_SHA: Record<string, string> = byPath([
  ["70f267b1db15884b", "src/proxy.ts"],
  ["e31847eb086792cf", "src/lib/platform/guards.ts"],
  ["6f7957d706c7d514", "verify/verify-document-form.mts"],
  ["6ffad6062c6dd766", "verify/verify-page-archetypes.mts"],
]);
/** The files PO-01B added under src/ and drizzle/ (sha256, 16 hex). */
export const PO01B_NEW: Record<string, string> = byPath([
  ["e24e2c580250501a", "src/app/(platform)/auth-actions.ts"],
  ["0e1ee8ca9389efd9", "src/app/(platform)/platform.css"],
  ["a566a4a79ba8b72d", "src/app/(platform)/platform/(console)/activity/page.tsx"],
  ["2ced9f620ba7bcc1", "src/app/(platform)/platform/(console)/companies/page.tsx"],
  ["ed75e10f4d548b3a", "src/app/(platform)/platform/(console)/dashboard/page.tsx"],
  ["1ce26e60783b066c", "src/app/(platform)/platform/(console)/error.tsx"],
  ["fe2c4e8d74ae9710", "src/app/(platform)/platform/(console)/layout.tsx"],
  ["1bb00359f23f4730", "src/app/(platform)/platform/(console)/loading.tsx"],
  ["47b7b03de3beb4f6", "src/app/(platform)/platform/(console)/packages/page.tsx"],
  ["e91bad93b147e257", "src/app/(platform)/platform/(console)/settings/page.tsx"],
  ["4a7cf76c87102776", "src/app/(platform)/platform/(console)/subscribers/page.tsx"],
  ["0318db7a219d58db", "src/app/(platform)/platform/(console)/users/page.tsx"],
  ["a7f6204363ecb1b0", "src/app/(platform)/platform/(public)/layout.tsx"],
  ["09145f4f121ce965", "src/app/(platform)/platform/(public)/login/page.tsx"],
  ["84961ca104df81fe", "src/app/(platform)/platform/(public)/recover/page.tsx"],
  ["997ed13b371b62ab", "src/app/(platform)/platform/layout.tsx"],
  ["89f6705087ab77cf", "src/app/(platform)/platform/page.tsx"],
  ["f0756f3989d74601", "src/app/(platform)/platform/session-expired/route.ts"],
  ["450e9cc9b54a0faf", "src/app/(platform)/security-actions.ts"],
  ["37c4298dda3d00be", "src/components/platform/device.ts"],
  ["3313f77819084c4f", "src/components/platform/i18n.ts"],
  ["06a7e1d8c4202f8c", "src/components/platform/nav-config.ts"],
  ["2f799bbd6534ef19", "src/components/platform/page-kit.tsx"],
  ["53c3d920153adae3", "src/components/platform/platform-account-menu.tsx"],
  ["9a06fa9329f3e23e", "src/components/platform/platform-dialog.tsx"],
  ["4945114ca7e8c8a8", "src/components/platform/platform-mobile-nav.tsx"],
  ["11fbd0a764064e5c", "src/components/platform/platform-nav-list.tsx"],
  ["327ebfa70f89a618", "src/components/platform/platform-shell.tsx"],
  ["944cfdbb83b85e2e", "src/components/platform/platform-sidebar.tsx"],
  ["f83f842db72dc515", "src/components/platform/security-panel.tsx"],
  ["745679b1882964fe", "src/components/platform/settings-tabs.tsx"],
  ["97f5b10199ecca86", "src/components/platform/sign-in-form.tsx"],
  ["d3686f3c48836be1", "src/components/platform/utils.ts"],
  ["1f7ff9af2aa8b95b", "src/lib/platform-edge/proxy-gate.ts"],
  ["4451b76b860d653f", "src/lib/platform/client-ip.ts"],
  ["41b9ff7a263e2e0a", "src/lib/platform/console.ts"],
  ["ebf7c25eb689b393", "src/lib/platform/origin.ts"],
]);

const h16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** A file's text with the PO-01B hunks undone — 92c4397's text when they are its only change; any other file as it is. */
export function undoPo01b(file: string, text: string): string {
  return (PO01B_EDITS[file] ?? []).reduce((acc, [was, is]) => acc.replace(is, () => was), text);
}
/** Files whose bytes are not 92c4397's plus exactly the recorded hunks, and added files not as recorded. */
export function po01bDrift(actual: (file: string) => string | null): string[] {
  const drift: string[] = [];
  for (const [f, hunks] of Object.entries(PO01B_EDITS)) {
    const src = actual(f);
    if (src === null || !hunks.every(([was, is]) => src.split(is).length === 2 && !src.includes(was)) || h16(undoPo01b(f, src)) !== PO01B_BASE_SHA[f]) drift.push(f);
  }
  for (const [f, sha] of Object.entries(PO01B_NEW)) {
    const src = actual(f);
    if (src === null || h16(src) !== sha) drift.push(`new: ${f}`);
  }
  return drift;
}
