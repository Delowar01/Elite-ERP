/**
 * Platform Owner PO-02D1B (default Trial package and platform settings seed, DATA ONLY) — the approved change to files
 * the DEV-UI-01.7, ACC-01, LCP, PO-01A, PO-01B, PO-01B.1, PO-02A, PO-02B, PO-02C, PO-02C.1, PO-02D1A and PO-02D1A.1
 * verifiers freeze.
 *
 * PO-02D1B adds two reviewed SQL files under drizzle/platform/ — the seed (PO02D1B_seed_trial_and_settings.sql: the
 * singleton platform settings row, the default Trial package and its published version 1 with the owner-approved
 * development values, one audit record) and its guarded rollback (PO02D1B_seed_rollback.sql) — both NOT AUTHORIZED FOR
 * PRODUCTION EXECUTION and run only through the guarded runner. Because drizzle/ is a pinned directory, they are listed
 * here with their sha256 (PO02D1B_NEW) and left out of the older pins' walks. The only frozen files changed are the two
 * freeze verifiers themselves (this layer's hooks). No customer route, component, library, auth, session, registration,
 * business, print, API, schema-module or Platform Owner application file is in either list.
 *
 * The rule for an approved change is the one C8, ACC-01, the LCP stage and PO-01A…PO-02D1A.1 used: no re-baseline. Each
 * changed file's hunks are recorded here byte for byte, [2416ca7's text, PO-02D1B's text]; undone, the file is
 * PO-02D1A.1's (2416ca7) to the byte (PO02D1B_BASE_SHA), so every older pin keeps its strength. Each freeze verifier's
 * PO-02D1B check proves the hunks are each file's only change and the added files are exactly as recorded.
 *
 * Generated from the diff against PO02D1B_BASE (each hunk widened with context until it is unique in both files, its
 * 2416ca7 form nowhere in PO-02D1B's); changing a PO-02D1B file means regenerating this record, which is then part of
 * the change under review.
 */
import { createHash } from "node:crypto";

export const PO02D1B_BASE = "2416ca70d61f2810f7354023f1604bb2a6195aa3";
export const PO02D1B_EDITS: Record<string, [string, string][]> = {
  "verify/verify-document-form.mts": [
    ["import { PO02D1A1_EDITS, PO02D1A1_NEW, po02d1a1Drift, undoPo02d1a1 } from \"./po02d1a1-approved-delta.mjs\";\n\n",
      "import { PO02D1A1_EDITS, PO02D1A1_NEW, po02d1a1Drift, undoPo02d1a1 } from \"./po02d1a1-approved-delta.mjs\";\nimport { PO02D1B_EDITS, PO02D1B_NEW, po02d1bDrift, undoPo02d1b } from \"./po02d1b-approved-delta.mjs\";\n\n"],
    ["const po02d1a1Read = (p: string) => undoPo02d1a1(p, diskRead(p));\n",
      "// Platform Owner PO-02D1B: its recorded hunks are undone before PO-02D1A.1's (its check below proves they are each file's\n// only change), so the PO-02D1A.1 layer and every older pin read PO-02D1A.1's (2416ca7) bytes; the two reviewed seed SQL\n// files PO-02D1B added stay out of the directory pins.\nconst po02d1bRead = (p: string) => undoPo02d1b(p, diskRead(p));\nconst po02d1a1Read = (p: string) => undoPo02d1a1(p, po02d1bRead(p));\n"],
    ["  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW) && !(p in PO02B_NEW) && !(p in PO02C_NEW) && !(p in PO02C1_NEW) && !(p in PO02D1A_NEW) && !(p in PO02D1A1_NEW)) files.push(p); } };\n",
      "  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW) && !(p in PO02B_NEW) && !(p in PO02C_NEW) && !(p in PO02C1_NEW) && !(p in PO02D1A_NEW) && !(p in PO02D1A1_NEW) && !(p in PO02D1B_NEW)) files.push(p); } };\n"],
    ["  for (const f of files.sort()) { hh.update(f + \"\\0\"); hh.update(f in ACC01_EDITS || f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS || f in PO02B_EDITS || f in PO02C_EDITS || f in PO02C1_EDITS || f in PO02D1A_EDITS || f in PO02D1A1_EDITS ? read(f) : readFileSync(join(ROOT, f))); }\n",
      "  for (const f of files.sort()) { hh.update(f + \"\\0\"); hh.update(f in ACC01_EDITS || f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS || f in PO02B_EDITS || f in PO02C_EDITS || f in PO02C1_EDITS || f in PO02D1A_EDITS || f in PO02D1A1_EDITS || f in PO02D1B_EDITS ? read(f) : readFileSync(join(ROOT, f))); }\n"],
    ["const po02d1a1DriftNow = po02d1a1Drift((f) => { try { return diskRead(f); } catch { return null; } });\n",
      "const po02d1a1DriftNow = po02d1a1Drift((f) => { try { return po02d1bRead(f); } catch { return null; } });\n"],
    ["  po02d1a1DriftNow.length === 0 && Object.keys(PO02D1A1_EDITS).length === 3 && \"drizzle/platform/PO02A_company_foundation.sql\" in PO02D1A1_EDITS && Object.keys(PO02D1A1_NEW).length === 0, po02d1a1DriftNow.join(\" \"));\nconst SUBMIT: Record<string, string> = {\n",
      "  po02d1a1DriftNow.length === 0 && Object.keys(PO02D1A1_EDITS).length === 3 && \"drizzle/platform/PO02A_company_foundation.sql\" in PO02D1A1_EDITS && Object.keys(PO02D1A1_NEW).length === 0, po02d1a1DriftNow.join(\" \"));\nconst po02d1bDriftNow = po02d1bDrift((f) => { try { return diskRead(f); } catch { return null; } });\ncheck(\"Platform Owner PO-02D1B's approved change: the two freeze verifiers are PO-02D1A.1's (2416ca7) plus exactly their hunks, and the two added reviewed seed SQL files (drizzle/platform/PO02D1B_seed_trial_and_settings.sql and its rollback) as recorded (verify/po02d1b-approved-delta.mts)\",\n  po02d1bDriftNow.length === 0 && Object.keys(PO02D1B_EDITS).length === 2 && Object.keys(PO02D1B_NEW).length === 2 && Object.keys(PO02D1B_NEW).every((f) => f.startsWith(\"drizzle/platform/PO02D1B_\")), po02d1bDriftNow.join(\" \"));\nconst SUBMIT: Record<string, string> = {\n"],
  ],
  "verify/verify-page-archetypes.mts": [
    ["import { PO02D1A1_BASE, PO02D1A1_EDITS, PO02D1A1_NEW, po02d1a1Drift, undoPo02d1a1 } from \"./po02d1a1-approved-delta.mjs\";\nimport { renderToStaticMarkup } from \"react-dom/server\";\n",
      "import { PO02D1A1_BASE, PO02D1A1_EDITS, PO02D1A1_NEW, po02d1a1Drift, undoPo02d1a1 } from \"./po02d1a1-approved-delta.mjs\";\nimport { PO02D1B_BASE, PO02D1B_EDITS, PO02D1B_NEW, po02d1bDrift, undoPo02d1b } from \"./po02d1b-approved-delta.mjs\";\nimport { renderToStaticMarkup } from \"react-dom/server\";\n"],
    ["const po02d1a1Read = (p: string) => undoPo02d1a1(p, diskRead(p));\n",
      "// Platform Owner PO-02D1B: its recorded hunks are undone before PO-02D1A.1's (group 30 proves they are each file's only\n// change), so the PO-02D1A.1 layer and every older group read PO-02D1A.1's (2416ca7) bytes; the two reviewed seed SQL\n// files it added stay out of `walk`.\nconst po02d1bRead = (p: string) => undoPo02d1b(p, diskRead(p));\nconst po02d1a1Read = (p: string) => undoPo02d1a1(p, po02d1bRead(p));\n"],
    ["    : f in ACC01_EDITS ? rawRead(f) : f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS || f in PO02B_EDITS || f in PO02C_EDITS || f in PO02C1_EDITS || f in PO02D1A_EDITS || f in PO02D1A1_EDITS ? actualRead(f) : readFileSync(path.join(ROOT, f));\n",
      "    : f in ACC01_EDITS ? rawRead(f) : f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS || f in PO02B_EDITS || f in PO02C_EDITS || f in PO02C1_EDITS || f in PO02D1A_EDITS || f in PO02D1A1_EDITS || f in PO02D1B_EDITS ? actualRead(f) : readFileSync(path.join(ROOT, f));\n"],
    ["    else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW) && !(p in PO02B_NEW) && !(p in PO02C_NEW) && !(p in PO02C1_NEW) && !(p in PO02D1A_NEW) && !(p in PO02D1A1_NEW)) out.push(p);\n",
      "    else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW) && !(p in PO02B_NEW) && !(p in PO02C_NEW) && !(p in PO02C1_NEW) && !(p in PO02D1A_NEW) && !(p in PO02D1A1_NEW) && !(p in PO02D1B_NEW)) out.push(p);\n"],
    ["  walk(\"src\").length + Object.keys(ACC01_NEW).length + Object.keys(LCP_NEW).length + Object.keys(PO01A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02C_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02C1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D1A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D1A1_NEW).filter((f) => f.startsWith(\"src/\")).length === (function all(d: string): number {\n",
      "  walk(\"src\").length + Object.keys(ACC01_NEW).length + Object.keys(LCP_NEW).length + Object.keys(PO01A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02C_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02C1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D1A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D1A1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D1B_NEW).filter((f) => f.startsWith(\"src/\")).length === (function all(d: string): number {\n"],
    ["// Read as they are on disk: each changed file is PO-02D1A's (43b0611) plus exactly its recorded hunks; no file added.\nconst po02d1a1DriftNow = po02d1a1Drift((f) => (existsSync(path.join(ROOT, f)) ? diskRead(f) : null));\n",
      "// Read with PO-02D1B's hunks undone (group 30): each changed file is PO-02D1A's (43b0611) plus exactly its recorded hunks; no file added.\nconst po02d1a1DriftNow = po02d1a1Drift((f) => (existsSync(path.join(ROOT, f)) ? po02d1bRead(f) : null));\n"],
    ["  \"\");\n\nconsole.log(\"\\nGroups:\");\nfor (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);\n",
      "  \"\");\n\n// ---------- 30. Platform Owner PO-02D1B — the approved change to frozen files ----------\nsection(\"30. Platform Owner PO-02D1B — default Trial and platform settings seed, data only (the approved change to frozen files)\");\n// Read as they are on disk: each changed file is PO-02D1A.1's (2416ca7) plus exactly its recorded hunks, each added file as recorded.\nconst po02d1bDriftNow = po02d1bDrift((f) => (existsSync(path.join(ROOT, f)) ? diskRead(f) : null));\nconst PO02D1B_EDITABLE = [\"verify/verify-document-form.mts\", \"verify/verify-page-archetypes.mts\"];\nconst PO02D1B_ADDED = [\"drizzle/platform/PO02D1B_seed_rollback.sql\", \"drizzle/platform/PO02D1B_seed_trial_and_settings.sql\"];\ncheck(`PO-02D1B changed only the two freeze verifiers by exactly their ${Object.values(PO02D1B_EDITS).flat().length} recorded hunks — undone, each is ${PO02D1B_BASE.slice(0, 7)}'s to the byte — and added exactly the two reviewed seed SQL files, as recorded (verify/po02d1b-approved-delta.mts)`,\n  po02d1bDriftNow.length === 0 && PO02D1B_BASE === \"2416ca70d61f2810f7354023f1604bb2a6195aa3\" &&\n    JSON.stringify(Object.keys(PO02D1B_EDITS).sort()) === JSON.stringify([...PO02D1B_EDITABLE].sort()) && JSON.stringify(Object.keys(PO02D1B_NEW).sort()) === JSON.stringify(PO02D1B_ADDED),\n  po02d1bDriftNow.map(rel).join(\" \"));\ncheck(\"…no application, schema-module, UI, route, auth, session or customer file is changed or added by PO-02D1B (nothing under src/)\",\n  Object.keys(PO02D1B_EDITS).every((f) => f.startsWith(\"verify/\")) && Object.keys(PO02D1B_NEW).every((f) => f.startsWith(\"drizzle/platform/PO02D1B_\")), \"\");\n\nconsole.log(\"\\nGroups:\");\nfor (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);\n"],
  ],
};

function byPath(pairs: [string, string][]): Record<string, string> {
  return Object.fromEntries(pairs.map(([sha, file]) => [file, sha]));
}
/** 2416ca7's bytes of each changed file (sha256, 16 hex) — what the file is once its hunks are undone. */
export const PO02D1B_BASE_SHA: Record<string, string> = byPath([
  ["7ff3b3760a2afbe5", "verify/verify-document-form.mts"],
  ["83de54e2d25e4d5d", "verify/verify-page-archetypes.mts"],
]);
/** The files PO-02D1B added under src/ and drizzle/ (sha256, 16 hex). */
export const PO02D1B_NEW: Record<string, string> = byPath([
  ["026848ed4efd9a30", "drizzle/platform/PO02D1B_seed_rollback.sql"],
  ["0bce59ca04e43b35", "drizzle/platform/PO02D1B_seed_trial_and_settings.sql"],
]);

const h16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** A file's text with the PO-02D1B hunks undone — 2416ca7's text when they are its only change; any other file as it is. */
export function undoPo02d1b(file: string, text: string): string {
  return (PO02D1B_EDITS[file] ?? []).reduce((acc, [was, is]) => acc.replace(is, () => was), text);
}
/** Files whose bytes are not 2416ca7's plus exactly the recorded hunks, and added files not as recorded. */
export function po02d1bDrift(actual: (file: string) => string | null): string[] {
  const drift: string[] = [];
  for (const [f, hunks] of Object.entries(PO02D1B_EDITS)) {
    const src = actual(f);
    if (src === null || !hunks.every(([was, is]) => src.split(is).length === 2 && !src.includes(was)) || h16(undoPo02d1b(f, src)) !== PO02D1B_BASE_SHA[f]) drift.push(f);
  }
  for (const [f, sha] of Object.entries(PO02D1B_NEW)) {
    const src = actual(f);
    if (src === null || h16(src) !== sha) drift.push(`new: ${f}`);
  }
  return drift;
}
