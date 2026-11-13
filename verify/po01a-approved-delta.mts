/**
 * Platform Owner PO-01A (platform identity foundation) — the approved change to files the DEV-UI-01.7, ACC-01 and
 * LCP verifiers freeze.
 *
 * PO-01A adds the separate Platform Owner identity tables and their server-only library by design: one export line in
 * the schema index, new files under src/lib/platform, src/db/schema/platform.ts and drizzle/platform (the reviewed SQL
 * migration, outside the drizzle-kit journal), and the undo layer in the two freeze verifiers. verify-page-archetypes.mts
 * and verify-document-form.mts pin src/db/** and drizzle/**, and their rule for an approved change is the one the C8
 * remediation, ACC-01 and the LCP stage used: no re-baseline. Each changed file's hunks are recorded here byte for byte,
 * [621f156's text, PO-01A's text]; undone, the file is 621f156's to the byte (PO01A_BASE_SHA), so every older pin —
 * ACC-01's and LCP's included — keeps its strength. The added files are listed with their sha256 (PO01A_NEW) and left
 * out of the older pins' walks. Each freeze verifier's PO-01A check proves the hunks are each file's only change.
 *
 * Generated from the diff against PO01A_BASE (each hunk widened with context until it is unique in both files, its
 * 621f156 form nowhere in PO-01A's); changing a PO-01A file means regenerating this record, which is then part of the
 * change under review. No customer app, component, auth/session, business, print or API file is in either list.
 */
import { createHash } from "node:crypto";

export const PO01A_BASE = "621f156f7b129b9c2e289bc46d314ce7587beec2";
export const PO01A_EDITS: Record<string, [string, string][]> = {
  "src/db/schema/index.ts": [
    ["export * from \"./security\";\nexport * from \"./saved-views\";\n",
      "export * from \"./security\";\nexport * from \"./platform\";\nexport * from \"./saved-views\";\n"],
  ],
  "verify/verify-document-form.mts": [
    ["import { LCP_EDITS, LCP_NEW, lcpDrift, undoLcp } from \"./lcp-approved-delta.mjs\";\n\n",
      "import { LCP_EDITS, LCP_NEW, lcpDrift, undoLcp } from \"./lcp-approved-delta.mjs\";\nimport { PO01A_EDITS, PO01A_NEW, po01aDrift, undoPo01a } from \"./po01a-approved-delta.mjs\";\n\n"],
    ["const actualRead = (p: string) => undoLcp(p, diskRead(p));\n",
      "// Platform Owner PO-01A: its recorded hunks are undone first (its check below proves they are each file's only change),\n// so the LCP layer and every older pin read 621f156's bytes; the files PO-01A added stay out of the directory pins.\nconst po01aRead = (p: string) => undoPo01a(p, diskRead(p));\nconst actualRead = (p: string) => undoLcp(p, po01aRead(p));\n"],
    ["  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!(p in ACC01_NEW) && !(p in LCP_NEW)) files.push(p); } };\n",
      "  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW)) files.push(p); } };\n"],
    ["  for (const f of files.sort()) { hh.update(f + \"\\0\"); hh.update(f in ACC01_EDITS || f in LCP_EDITS ? read(f) : readFileSync(join(ROOT, f))); }\n",
      "  for (const f of files.sort()) { hh.update(f + \"\\0\"); hh.update(f in ACC01_EDITS || f in LCP_EDITS || f in PO01A_EDITS ? read(f) : readFileSync(join(ROOT, f))); }\n"],
    ["const lcpDriftNow = lcpDrift((f) => { try { return diskRead(f); } catch { return null; } });\n",
      "const lcpDriftNow = lcpDrift((f) => { try { return po01aRead(f); } catch { return null; } });\n"],
    ["  lcpDriftNow.length === 0 && Object.keys(LCP_EDITS).length > 0, lcpDriftNow.join(\" \"));\nconst SUBMIT: Record<string, string> = {\n",
      "  lcpDriftNow.length === 0 && Object.keys(LCP_EDITS).length > 0, lcpDriftNow.join(\" \"));\nconst po01aDriftNow = po01aDrift((f) => { try { return diskRead(f); } catch { return null; } });\ncheck(\"Platform Owner PO-01A's approved change: each recorded file is 621f156's plus exactly its hunks, each added file (src/lib/platform, src/db/schema/platform.ts, drizzle/platform) as recorded (verify/po01a-approved-delta.mts)\",\n  po01aDriftNow.length === 0 && Object.keys(PO01A_EDITS).length > 0, po01aDriftNow.join(\" \"));\nconst SUBMIT: Record<string, string> = {\n"],
  ],
  "verify/verify-page-archetypes.mts": [
    ["import { LCP_BASE, LCP_EDITS, LCP_NEW, lcpDrift, undoLcp } from \"./lcp-approved-delta.mjs\";\nimport { renderToStaticMarkup } from \"react-dom/server\";\n",
      "import { LCP_BASE, LCP_EDITS, LCP_NEW, lcpDrift, undoLcp } from \"./lcp-approved-delta.mjs\";\nimport { PO01A_BASE, PO01A_EDITS, PO01A_NEW, po01aDrift, undoPo01a } from \"./po01a-approved-delta.mjs\";\nimport { renderToStaticMarkup } from \"react-dom/server\";\n"],
    ["const actualRead = (p: string) => undoLcp(p, diskRead(p));\n",
      "// Platform Owner PO-01A: its recorded hunks are undone before the LCP layer (group 21 proves they are each file's only\n// change), so every older group reads 621f156's bytes; the files PO-01A added stay out of `walk` like ACC-01's and LCP's.\nconst po01aRead = (p: string) => undoPo01a(p, diskRead(p));\nconst actualRead = (p: string) => undoLcp(p, po01aRead(p));\n"],
    ["    : f in ACC01_EDITS ? rawRead(f) : f in LCP_EDITS ? actualRead(f) : readFileSync(path.join(ROOT, f));\n",
      "    : f in ACC01_EDITS ? rawRead(f) : f in LCP_EDITS || f in PO01A_EDITS ? actualRead(f) : readFileSync(path.join(ROOT, f));\n"],
    ["    else if (!(p in ACC01_NEW) && !(p in LCP_NEW)) out.push(p);\n",
      "    else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW)) out.push(p);\n"],
    ["  walk(\"src\").length + Object.keys(ACC01_NEW).length + Object.keys(LCP_NEW).length === (function all(d: string): number {\n",
      "  walk(\"src\").length + Object.keys(ACC01_NEW).length + Object.keys(LCP_NEW).length + Object.keys(PO01A_NEW).filter((f) => f.startsWith(\"src/\")).length === (function all(d: string): number {\n"],
    ["const lcpDriftNow = lcpDrift((f) => (existsSync(path.join(ROOT, f)) ? diskRead(f) : null));\n",
      "const lcpDriftNow = lcpDrift((f) => (existsSync(path.join(ROOT, f)) ? po01aRead(f) : null));\n"],
    ["check(\"the LCP stage touched no business, schema, posting, API, auth, print or server-action file\", lcpBusiness.length === 0, lcpBusiness.join(\" \"));\n\nconsole.log(\"\\nGroups:\");\nfor (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);\n",
      "check(\"the LCP stage touched no business, schema, posting, API, auth, print or server-action file\", lcpBusiness.length === 0, lcpBusiness.join(\" \"));\n\n// ---------- 21. Platform Owner PO-01A — the approved change to frozen files ----------\nsection(\"21. Platform Owner PO-01A — platform identity foundation (the approved change to frozen files)\");\n// Read as they are on disk: each changed file is 621f156's plus exactly its recorded hunks, each added file as recorded.\nconst po01aDriftNow = po01aDrift((f) => (existsSync(path.join(ROOT, f)) ? diskRead(f) : null));\ncheck(`PO-01A changed its ${Object.keys(PO01A_EDITS).length} files (the schema index and the two freeze verifiers) by exactly their ${Object.values(PO01A_EDITS).flat().length} recorded hunks — undone, each file is ${PO01A_BASE.slice(0, 7)}'s to the byte — and added exactly its ${Object.keys(PO01A_NEW).length} files, as recorded`,\n  po01aDriftNow.length === 0 && PO01A_BASE === \"621f156f7b129b9c2e289bc46d314ce7587beec2\" &&\n    Object.keys(PO01A_EDITS).every((f) => [\"src/db/schema/index.ts\", \"verify/verify-document-form.mts\", \"verify/verify-page-archetypes.mts\"].includes(f)) &&\n    Object.keys(PO01A_NEW).every((f) => /^(src\\/lib\\/platform\\/[\\w-]+\\.ts|src\\/db\\/schema\\/platform\\.ts|drizzle\\/platform\\/[\\w-]+\\.sql)$/.test(f)),\n  po01aDriftNow.map(rel).join(\" \"));\n// PO-01A is additive and platform-only: no customer app, component, auth/session, business, print or API file changed.\nconst PO01A_FORBIDDEN = /^src\\/(app|components)\\/|^src\\/proxy\\.ts$|^src\\/lib\\/(?!platform\\/)|^src\\/db\\/(?!schema\\/(index|platform)\\.ts$)|^drizzle\\/(?!platform\\/)/;\nconst po01aTouched = [...Object.keys(PO01A_EDITS), ...Object.keys(PO01A_NEW)].filter((f) => PO01A_FORBIDDEN.test(f));\ncheck(\"PO-01A touched no customer app, component, auth/session, business, print, API or historical-migration file\", po01aTouched.length === 0, po01aTouched.join(\" \"));\n\nconsole.log(\"\\nGroups:\");\nfor (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);\n"],
  ],
};

function byPath(pairs: [string, string][]): Record<string, string> {
  return Object.fromEntries(pairs.map(([sha, file]) => [file, sha]));
}
/** 621f156's bytes of each changed file (sha256, 16 hex) — what the file is once its hunks are undone. */
export const PO01A_BASE_SHA: Record<string, string> = byPath([
  ["2baff2c5d67783b4", "src/db/schema/index.ts"],
  ["12126497cfc0c445", "verify/verify-document-form.mts"],
  ["f8a7f7ab3b02743e", "verify/verify-page-archetypes.mts"],
]);
/** The files PO-01A added under src/ and drizzle/ (sha256, 16 hex). */
export const PO01A_NEW: Record<string, string> = byPath([
  ["337cdfe1469037bf", "drizzle/platform/PO01_platform_identity.sql"],
  ["7307cbc8fae7d77c", "src/db/schema/platform.ts"],
  ["d7d6b014da1ee38e", "src/lib/platform/audit-protection.ts"],
  ["4c4d49bdec70f6f6", "src/lib/platform/audit.ts"],
  ["4bdb1f41a08b7402", "src/lib/platform/auth.ts"],
  ["3352eec0cd3e613b", "src/lib/platform/clock.ts"],
  ["b0cb37c60778b6b7", "src/lib/platform/config.ts"],
  ["64c6a105acc63023", "src/lib/platform/errors.ts"],
  ["c28d839046d92317", "src/lib/platform/flags.ts"],
  ["e31847eb086792cf", "src/lib/platform/guards.ts"],
  ["90fb5743841a55e6", "src/lib/platform/login.ts"],
  ["18847c07009e8f2b", "src/lib/platform/mfa.ts"],
  ["e23f172c69ac60c2", "src/lib/platform/session.ts"],
  ["425ab710f72c0e82", "src/lib/platform/throttle.ts"],
  ["f286af4cc3ea56d8", "src/lib/platform/totp.ts"],
]);

const h16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** A file's text with the PO-01A hunks undone — 621f156's text when they are its only change; any other file as it is. */
export function undoPo01a(file: string, text: string): string {
  return (PO01A_EDITS[file] ?? []).reduce((acc, [was, is]) => acc.replace(is, () => was), text);
}
/** Files whose bytes are not 621f156's plus exactly the recorded hunks, and added files not as recorded. */
export function po01aDrift(actual: (file: string) => string | null): string[] {
  const drift: string[] = [];
  for (const [f, hunks] of Object.entries(PO01A_EDITS)) {
    const src = actual(f);
    if (src === null || !hunks.every(([was, is]) => src.split(is).length === 2 && !src.includes(was)) || h16(undoPo01a(f, src)) !== PO01A_BASE_SHA[f]) drift.push(f);
  }
  for (const [f, sha] of Object.entries(PO01A_NEW)) {
    const src = actual(f);
    if (src === null || h16(src) !== sha) drift.push(`new: ${f}`);
  }
  return drift;
}
