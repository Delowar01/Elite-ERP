/**
 * Platform Owner PO-02D1A (company onboarding database foundation, SCHEMA ONLY) — the approved change to files the
 * DEV-UI-01.7, ACC-01, LCP, PO-01A, PO-01B, PO-01B.1, PO-02A, PO-02B, PO-02C and PO-02C.1 verifiers freeze.
 *
 * PO-02D1A adds the onboarding schema: a new schema module (src/db/schema/platform-onboarding.ts — platform settings,
 * subscription packages and their immutable versions, primary owners, subscriptions, append-only subscription events and
 * invitation terms; exported from the schema index), the reviewed SQL under drizzle/platform/PO02D1_*.sql (foundation,
 * concurrent F1 runbook, two-step rollback — none authorized for production execution), and ONE additive key (F1,
 * users_org_id_id_uq UNIQUE (id, org_id)) in the customer users schema, src/db/schema/users.ts — the only customer file
 * in either list, whose change verify-page-archetypes group 28 pins line by line. It creates no row: no settings value,
 * Trial, package, subscription, primary owner or invitation terms exist until an owner-approved PO-02D1B.
 *
 * The rule for an approved change is the one C8, ACC-01, the LCP stage and PO-01A…PO-02C.1 used: no re-baseline. Each
 * changed file's hunks are recorded here byte for byte, [87efa15's text, PO-02D1A's text]; undone, the file is PO-02D0's
 * (87efa15) to the byte (PO02D1A_BASE_SHA), so every older pin — PO-02C.1's, PO-02C's, PO-02B's, PO-02A's, PO-01B.1's,
 * PO-01B's, PO-01A's, LCP's and ACC-01's included — keeps its strength. The added files are listed with their sha256
 * (PO02D1A_NEW) and left out of the older pins' walks. Each freeze verifier's PO-02D1A check proves the hunks are each
 * file's only change.
 *
 * Generated from the diff against PO02D1A_BASE (each hunk widened with context until it is unique in both files, its
 * 87efa15 form nowhere in PO-02D1A's); changing a PO-02D1A file means regenerating this record, which is then part of the
 * change under review. No customer route, component, library, auth, session, registration, business, print or API file
 * is in either list.
 */
import { createHash } from "node:crypto";

export const PO02D1A_BASE = "87efa158268b8486a8208c0d87d9a5f7a0346a76";
export const PO02D1A_EDITS: Record<string, [string, string][]> = {
  "src/db/schema/index.ts": [
    ["export * from \"./platform-companies\";\nexport * from \"./saved-views\";\n",
      "export * from \"./platform-companies\";\nexport * from \"./platform-onboarding\";\nexport * from \"./saved-views\";\n"],
  ],
  "src/db/schema/users.ts": [
    ["import { pgTable, serial, integer, text, boolean, timestamp } from \"drizzle-orm/pg-core\";\n",
      "import { pgTable, serial, integer, text, boolean, timestamp, unique } from \"drizzle-orm/pg-core\";\n"],
    ["  updatedAt: timestamp(\"updated_at\").notNull().defaultNow(),\n});\n\n",
      "  updatedAt: timestamp(\"updated_at\").notNull().defaultNow(),\n}, (t) => [\n  // Platform Owner PO-02D1A (F1): the composite key the primary-owner foreign key references, so a company's primary\n  // owner must be one of ITS users. Additive key only — id is the primary key, so it can never reject a row; no\n  // column, row or behaviour changes. Columns in table order (id, org_id): drizzle-kit re-creates any other order.\n  unique(\"users_org_id_id_uq\").on(t.id, t.orgId),\n]);\n\n"],
  ],
  "verify/verify-document-form.mts": [
    ["import { PO02C1_EDITS, PO02C1_NEW, po02c1Drift, undoPo02c1 } from \"./po02c1-approved-delta.mjs\";\n\n",
      "import { PO02C1_EDITS, PO02C1_NEW, po02c1Drift, undoPo02c1 } from \"./po02c1-approved-delta.mjs\";\nimport { PO02D1A_EDITS, PO02D1A_NEW, po02d1aDrift, undoPo02d1a } from \"./po02d1a-approved-delta.mjs\";\n\n"],
    ["const po02c1Read = (p: string) => undoPo02c1(p, diskRead(p));\n",
      "// Platform Owner PO-02D1A: its recorded hunks are undone before PO-02C.1's (its check below proves they are each file's only\n// change), so the PO-02C.1 layer and every older pin read PO-02D0's (87efa15) bytes; the files PO-02D1A added (the onboarding\n// schema module and the reviewed drizzle/platform/PO02D1_*.sql) stay out of the directory pins.\nconst po02d1aRead = (p: string) => undoPo02d1a(p, diskRead(p));\nconst po02c1Read = (p: string) => undoPo02c1(p, po02d1aRead(p));\n"],
    ["  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW) && !(p in PO02B_NEW) && !(p in PO02C_NEW) && !(p in PO02C1_NEW)) files.push(p); } };\n",
      "  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW) && !(p in PO02B_NEW) && !(p in PO02C_NEW) && !(p in PO02C1_NEW) && !(p in PO02D1A_NEW)) files.push(p); } };\n"],
    ["  for (const f of files.sort()) { hh.update(f + \"\\0\"); hh.update(f in ACC01_EDITS || f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS || f in PO02B_EDITS || f in PO02C_EDITS || f in PO02C1_EDITS ? read(f) : readFileSync(join(ROOT, f))); }\n",
      "  for (const f of files.sort()) { hh.update(f + \"\\0\"); hh.update(f in ACC01_EDITS || f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS || f in PO02B_EDITS || f in PO02C_EDITS || f in PO02C1_EDITS || f in PO02D1A_EDITS ? read(f) : readFileSync(join(ROOT, f))); }\n"],
    ["const po02c1DriftNow = po02c1Drift((f) => { try { return diskRead(f); } catch { return null; } });\n",
      "const po02c1DriftNow = po02c1Drift((f) => { try { return po02d1aRead(f); } catch { return null; } });\n"],
    ["  po02c1DriftNow.length === 0 && Object.keys(PO02C1_EDITS).length > 0 && Object.keys(PO02C1_NEW).length === 0, po02c1DriftNow.join(\" \"));\nconst SUBMIT: Record<string, string> = {\n",
      "  po02c1DriftNow.length === 0 && Object.keys(PO02C1_EDITS).length > 0 && Object.keys(PO02C1_NEW).length === 0, po02c1DriftNow.join(\" \"));\nconst po02d1aDriftNow = po02d1aDrift((f) => { try { return diskRead(f); } catch { return null; } });\ncheck(\"Platform Owner PO-02D1A's approved change: each recorded file is PO-02D0's (87efa15) plus exactly its hunks — the schema index and the customer users schema's F1 key included — and each added file (the onboarding schema module, the four reviewed drizzle/platform/PO02D1_*.sql files) as recorded (verify/po02d1a-approved-delta.mts)\",\n  po02d1aDriftNow.length === 0 && Object.keys(PO02D1A_EDITS).length > 0 && Object.keys(PO02D1A_NEW).length === 5, po02d1aDriftNow.join(\" \"));\nconst SUBMIT: Record<string, string> = {\n"],
  ],
  "verify/verify-page-archetypes.mts": [
    ["import { PO02C1_BASE, PO02C1_EDITS, PO02C1_NEW, po02c1Drift, undoPo02c1 } from \"./po02c1-approved-delta.mjs\";\nimport { renderToStaticMarkup } from \"react-dom/server\";\n",
      "import { PO02C1_BASE, PO02C1_EDITS, PO02C1_NEW, po02c1Drift, undoPo02c1 } from \"./po02c1-approved-delta.mjs\";\nimport { PO02D1A_BASE, PO02D1A_EDITS, PO02D1A_NEW, po02d1aDrift, undoPo02d1a } from \"./po02d1a-approved-delta.mjs\";\nimport { renderToStaticMarkup } from \"react-dom/server\";\n"],
    ["const po02c1Read = (p: string) => undoPo02c1(p, diskRead(p));\n",
      "// Platform Owner PO-02D1A: its recorded hunks are undone before PO-02C.1's (group 28 proves they are each file's only change),\n// so the PO-02C.1 layer and every older group read PO-02D0's (87efa15) bytes; the files PO-02D1A added stay out of `walk`.\nconst po02d1aRead = (p: string) => undoPo02d1a(p, diskRead(p));\nconst po02c1Read = (p: string) => undoPo02c1(p, po02d1aRead(p));\n"],
    ["    : f in ACC01_EDITS ? rawRead(f) : f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS || f in PO02B_EDITS || f in PO02C_EDITS || f in PO02C1_EDITS ? actualRead(f) : readFileSync(path.join(ROOT, f));\n",
      "    : f in ACC01_EDITS ? rawRead(f) : f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS || f in PO02B_EDITS || f in PO02C_EDITS || f in PO02C1_EDITS || f in PO02D1A_EDITS ? actualRead(f) : readFileSync(path.join(ROOT, f));\n"],
    ["    else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW) && !(p in PO02B_NEW) && !(p in PO02C_NEW) && !(p in PO02C1_NEW)) out.push(p);\n",
      "    else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW) && !(p in PO02B_NEW) && !(p in PO02C_NEW) && !(p in PO02C1_NEW) && !(p in PO02D1A_NEW)) out.push(p);\n"],
    ["  walk(\"src\").length + Object.keys(ACC01_NEW).length + Object.keys(LCP_NEW).length + Object.keys(PO01A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02C_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02C1_NEW).filter((f) => f.startsWith(\"src/\")).length === (function all(d: string): number {\n",
      "  walk(\"src\").length + Object.keys(ACC01_NEW).length + Object.keys(LCP_NEW).length + Object.keys(PO01A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02C_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02C1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D1A_NEW).filter((f) => f.startsWith(\"src/\")).length === (function all(d: string): number {\n"],
    ["const po02c1DriftNow = po02c1Drift((f) => (existsSync(path.join(ROOT, f)) ? diskRead(f) : null));\n",
      "const po02c1DriftNow = po02c1Drift((f) => (existsSync(path.join(ROOT, f)) ? po02d1aRead(f) : null));\n"],
    ["  login1Added.slice(0, 300));\n\nconsole.log(\"\\nGroups:\");\nfor (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);\n",
      "  login1Added.slice(0, 300));\n\n// ---------- 28. Platform Owner PO-02D1A — the approved change to frozen files ----------\nsection(\"28. Platform Owner PO-02D1A — onboarding database foundation, schema only (the approved change to frozen files)\");\n// Read as they are on disk: each changed file is PO-02D0's (87efa15) plus exactly its recorded hunks, each added file as recorded.\nconst po02d1aDriftNow = po02d1aDrift((f) => (existsSync(path.join(ROOT, f)) ? diskRead(f) : null));\nconst PO02D1A_EDITABLE = [\"src/db/schema/index.ts\", \"src/db/schema/users.ts\", \"verify/verify-document-form.mts\", \"verify/verify-page-archetypes.mts\"];\nconst PO02D1A_ADDED = [\"drizzle/platform/PO02D1_onboarding_foundation.sql\", \"drizzle/platform/PO02D1_rollback.sql\", \"drizzle/platform/PO02D1_users_org_id_id_concurrently.sql\", \"drizzle/platform/PO02D1_users_org_id_id_drop.sql\", \"src/db/schema/platform-onboarding.ts\"];\ncheck(`PO-02D1A changed its ${Object.keys(PO02D1A_EDITS).length} files (the schema index, the customer users schema's F1 key and the two freeze verifiers) by exactly their ${Object.values(PO02D1A_EDITS).flat().length} recorded hunks — undone, each file is ${PO02D1A_BASE.slice(0, 7)}'s to the byte — and added exactly its ${Object.keys(PO02D1A_NEW).length} files (the onboarding schema module and the four reviewed PO02D1 SQL files), as recorded (verify/po02d1a-approved-delta.mts)`,\n  po02d1aDriftNow.length === 0 && PO02D1A_BASE === \"87efa158268b8486a8208c0d87d9a5f7a0346a76\" &&\n    JSON.stringify(Object.keys(PO02D1A_EDITS).sort()) === JSON.stringify([...PO02D1A_EDITABLE].sort()) && JSON.stringify(Object.keys(PO02D1A_NEW).sort()) === JSON.stringify(PO02D1A_ADDED),\n  po02d1aDriftNow.map(rel).join(\" \"));\n// Line-level: the only change to the CUSTOMER users schema is F1 — the `unique` import and the table's one key declaration.\nconst usersD1Delta = lineDelta(PO02D1A_EDITS[\"src/db/schema/users.ts\"] ?? []);\ncheck(\"PO-02D1A's only change to src/db/schema/users.ts (the customer users table) is F1: the `unique` import and ONE UNIQUE (id, org_id) declaration in a new table callback — no column, default, type or existing key changed\",\n  JSON.stringify(codeLines(usersD1Delta.removed)) === JSON.stringify(['import { pgTable, serial, integer, text, boolean, timestamp } from \"drizzle-orm/pg-core\";', \"});\"]) &&\n    JSON.stringify(codeLines(usersD1Delta.added)) === JSON.stringify(['import { pgTable, serial, integer, text, boolean, timestamp, unique } from \"drizzle-orm/pg-core\";', \"}, (t) => [\", '  unique(\"users_org_id_id_uq\").on(t.id, t.orgId),', \"]);\"]),\n  JSON.stringify(usersD1Delta));\nconst indexD1Delta = lineDelta(PO02D1A_EDITS[\"src/db/schema/index.ts\"] ?? []);\ncheck(\"…and its only change to the schema index is the export of the onboarding schema module\",\n  indexD1Delta.removed.length === 0 && JSON.stringify(indexD1Delta.added) === JSON.stringify(['export * from \"./platform-onboarding\";']), JSON.stringify(indexD1Delta));\nconst onboardingModule = diskRead(\"src/db/schema/platform-onboarding.ts\");\ncheck(\"…the onboarding schema module imports only drizzle-orm and the existing orgs, users, platform and company schema modules (no application code)\",\n  JSON.stringify([...onboardingModule.matchAll(/^import [^\"]*\"([^\"]+)\";$/gm)].map((m) => m[1]).sort()) === JSON.stringify([\"./orgs\", \"./platform\", \"./platform-companies\", \"./users\", \"drizzle-orm\", \"drizzle-orm/pg-core\"]),\n  [...onboardingModule.matchAll(/^import [^\"]*\"([^\"]+)\";$/gm)].map((m) => m[1]).join(\", \"));\n\nconsole.log(\"\\nGroups:\");\nfor (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);\n"],
  ],
};

function byPath(pairs: [string, string][]): Record<string, string> {
  return Object.fromEntries(pairs.map(([sha, file]) => [file, sha]));
}
/** 87efa15's bytes of each changed file (sha256, 16 hex) — what the file is once its hunks are undone. */
export const PO02D1A_BASE_SHA: Record<string, string> = byPath([
  ["cb2a6b64de1038fb", "src/db/schema/index.ts"],
  ["1a987201d631387a", "src/db/schema/users.ts"],
  ["b78ded0bbe47335a", "verify/verify-document-form.mts"],
  ["3adb4bf7e2c3516e", "verify/verify-page-archetypes.mts"],
]);
/** The files PO-02D1A added under src/ and drizzle/ (sha256, 16 hex). */
export const PO02D1A_NEW: Record<string, string> = byPath([
  ["3fae0e23310f1ae3", "drizzle/platform/PO02D1_onboarding_foundation.sql"],
  ["e5f40f3433c47e9c", "drizzle/platform/PO02D1_rollback.sql"],
  ["1da56a0358a10835", "drizzle/platform/PO02D1_users_org_id_id_concurrently.sql"],
  ["c4a6f0aa5d47197e", "drizzle/platform/PO02D1_users_org_id_id_drop.sql"],
  ["02e048a8a3f4ccab", "src/db/schema/platform-onboarding.ts"],
]);

const h16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** A file's text with the PO-02D1A hunks undone — 87efa15's text when they are its only change; any other file as it is. */
export function undoPo02d1a(file: string, text: string): string {
  return (PO02D1A_EDITS[file] ?? []).reduce((acc, [was, is]) => acc.replace(is, () => was), text);
}
/** Files whose bytes are not 87efa15's plus exactly the recorded hunks, and added files not as recorded. */
export function po02d1aDrift(actual: (file: string) => string | null): string[] {
  const drift: string[] = [];
  for (const [f, hunks] of Object.entries(PO02D1A_EDITS)) {
    const src = actual(f);
    if (src === null || !hunks.every(([was, is]) => src.split(is).length === 2 && !src.includes(was)) || h16(undoPo02d1a(f, src)) !== PO02D1A_BASE_SHA[f]) drift.push(f);
  }
  for (const [f, sha] of Object.entries(PO02D1A_NEW)) {
    const src = actual(f);
    if (src === null || h16(src) !== sha) drift.push(`new: ${f}`);
  }
  return drift;
}
