/**
 * Platform Owner PO-02A (company database foundation) — the approved change to files the DEV-UI-01.7, ACC-01, LCP,
 * PO-01A, PO-01B and PO-01B.1 verifiers freeze.
 *
 * PO-02A adds the company access-control and invitation schema: a new schema module (src/db/schema/platform-companies.ts,
 * exported from the schema index), the compatibility rule (src/lib/platform/company-access.ts), the reviewed SQL under
 * drizzle/platform/PO02A_*.sql, one audit lookup index in the PO-01A platform schema, and ONE additive index (M4,
 * sessions_org_active_idx) in the customer sessions schema, src/db/schema/security.ts — the only customer file in
 * either list, whose change verify-page-archetypes group 24 pins line by line. The rule for an approved change is the
 * one C8, ACC-01, the LCP stage and PO-01A…PO-01B.1 used: no re-baseline. Each changed file's hunks are recorded here
 * byte for byte, [021ceb4's text, PO-02A's text]; undone, the file is PO-01B.1's (021ceb4) to the byte
 * (PO02A_BASE_SHA), so every older pin — PO-01B.1's, PO-01B's, PO-01A's, LCP's and ACC-01's included — keeps its
 * strength. The added files are listed with their sha256 (PO02A_NEW) and left out of the older pins' walks. Each
 * freeze verifier's PO-02A check proves the hunks are each file's only change.
 *
 * Generated from the diff against PO02A_BASE (each hunk widened with context until it is unique in both files, its
 * 021ceb4 form nowhere in PO-02A's); changing a PO-02A file means regenerating this record, which is then part of the
 * change under review. No customer route, component, library, auth or session code, business, print or API file is in
 * either list.
 */
import { createHash } from "node:crypto";

export const PO02A_BASE = "021ceb4d0badb425a5353282bdc506e719085dfe";
export const PO02A_EDITS: Record<string, [string, string][]> = {
  "src/db/schema/index.ts": [
    ["export * from \"./platform\";\nexport * from \"./saved-views\";\n",
      "export * from \"./platform\";\nexport * from \"./platform-companies\";\nexport * from \"./saved-views\";\n"],
  ],
  "src/db/schema/platform.ts": [
    ["    index(\"platform_audit_events_request_idx\").on(t.requestId),\n    check(\"platform_audit_events_action_chk\", sql`${t.action} ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'`),\n",
      "    index(\"platform_audit_events_request_idx\").on(t.requestId),\n    // PO-02A: per-entity lookups and timelines (late revocation recording, invitation / company /\n    // session history) without scanning the trail.\n    index(\"platform_audit_events_entity_idx\").on(t.entityType, t.entityId, t.createdAt.desc()),\n    check(\"platform_audit_events_action_chk\", sql`${t.action} ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'`),\n"],
  ],
  "src/db/schema/security.ts": [
    ["import { pgTable, serial, integer, text, boolean, timestamp, jsonb, index } from \"drizzle-orm/pg-core\";\nimport { orgsTable } from \"./orgs\";\nimport { usersTable } from \"./users\";\n\n// ---------------------------------------------------------------------------\n// Stage 11 — Enterprise security schema. All additive; no existing column or\n// table is changed, so this is fully backward-compatible.\n// ---------------------------------------------------------------------------\n\n// Active sessions: one row per issued session token. The JWT stays the transport,\n// but a server-side row lets us list devices, terminate individual sessions, and\n// hard-invalidate on password/role/disable/MFA changes (JWT alone can't be revoked).\nexport const sessionsTable = pgTable(\n  \"sessions\",\n  {\n    id: serial(\"id\").primaryKey(),\n    orgId: integer(\"org_id\")\n      .notNull()\n      .references(() => orgsTable.id, { onDelete: \"cascade\" }),\n    userId: integer(\"user_id\")\n      .notNull()\n      .references(() => usersTable.id, { onDelete: \"cascade\" }),\n    // Random opaque token id carried inside the JWT (jti). We store only its SHA-256 hash.\n    tokenHash: text(\"token_hash\").notNull().unique(),\n    ipAddress: text(\"ip_address\"),\n    userAgent: text(\"user_agent\"),\n    browser: text(\"browser\"),\n    os: text(\"os\"),\n    device: text(\"device\"),\n    createdAt: timestamp(\"created_at\").notNull().defaultNow(),\n    lastActivityAt: timestamp(\"last_activity_at\").notNull().defaultNow(),\n    expiresAt: timestamp(\"expires_at\").notNull(),\n    revokedAt: timestamp(\"revoked_at\"),\n    revokedReason: text(\"revoked_reason\"), // logout | logout_all | password_change | role_change | disabled | mfa_change | expired\n  },\n  (t) => [index(\"sessions_user_idx\").on(t.userId), index(\"sessions_token_idx\").on(t.tokenHash)],\n",
      "import { sql } from \"drizzle-orm\";\nimport { pgTable, serial, integer, text, boolean, timestamp, jsonb, index } from \"drizzle-orm/pg-core\";\nimport { orgsTable } from \"./orgs\";\nimport { usersTable } from \"./users\";\n\n// ---------------------------------------------------------------------------\n// Stage 11 — Enterprise security schema. All additive; no existing column or\n// table is changed, so this is fully backward-compatible.\n// ---------------------------------------------------------------------------\n\n// Active sessions: one row per issued session token. The JWT stays the transport,\n// but a server-side row lets us list devices, terminate individual sessions, and\n// hard-invalidate on password/role/disable/MFA changes (JWT alone can't be revoked).\nexport const sessionsTable = pgTable(\n  \"sessions\",\n  {\n    id: serial(\"id\").primaryKey(),\n    orgId: integer(\"org_id\")\n      .notNull()\n      .references(() => orgsTable.id, { onDelete: \"cascade\" }),\n    userId: integer(\"user_id\")\n      .notNull()\n      .references(() => usersTable.id, { onDelete: \"cascade\" }),\n    // Random opaque token id carried inside the JWT (jti). We store only its SHA-256 hash.\n    tokenHash: text(\"token_hash\").notNull().unique(),\n    ipAddress: text(\"ip_address\"),\n    userAgent: text(\"user_agent\"),\n    browser: text(\"browser\"),\n    os: text(\"os\"),\n    device: text(\"device\"),\n    createdAt: timestamp(\"created_at\").notNull().defaultNow(),\n    lastActivityAt: timestamp(\"last_activity_at\").notNull().defaultNow(),\n    expiresAt: timestamp(\"expires_at\").notNull(),\n    revokedAt: timestamp(\"revoked_at\"),\n    revokedReason: text(\"revoked_reason\"), // logout | logout_all | password_change | role_change | disabled | mfa_change | expired\n  },\n  (t) => [\n    index(\"sessions_user_idx\").on(t.userId),\n    index(\"sessions_token_idx\").on(t.tokenHash),\n    // Platform Owner PO-02A (M4): an organization's live sessions, for the org-wide revocation of\n    // PO-02C. Additive index only; no column, constraint or session behaviour changes.\n    index(\"sessions_org_active_idx\").on(t.orgId).where(sql`${t.revokedAt} IS NULL`),\n  ],\n"],
  ],
  "verify/verify-document-form.mts": [
    ["import { PO01B1_EDITS, PO01B1_NEW, po01b1Drift, undoPo01b1 } from \"./po01b1-approved-delta.mjs\";\n\n",
      "import { PO01B1_EDITS, PO01B1_NEW, po01b1Drift, undoPo01b1 } from \"./po01b1-approved-delta.mjs\";\nimport { PO02A_EDITS, PO02A_NEW, po02aDrift, undoPo02a } from \"./po02a-approved-delta.mjs\";\n\n"],
    ["const po01b1Read = (p: string) => undoPo01b1(p, diskRead(p));\n",
      "// Platform Owner PO-02A: its recorded hunks are undone before PO-01B.1's (its check below proves they are each file's only\n// change), so the PO-01B.1 layer and every older pin read PO-01B.1's bytes; the files PO-02A added stay out of the directory pins.\nconst po02aRead = (p: string) => undoPo02a(p, diskRead(p));\nconst po01b1Read = (p: string) => undoPo01b1(p, po02aRead(p));\n"],
    ["  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW)) files.push(p); } };\n",
      "  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW)) files.push(p); } };\n"],
    ["  for (const f of files.sort()) { hh.update(f + \"\\0\"); hh.update(f in ACC01_EDITS || f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS ? read(f) : readFileSync(join(ROOT, f))); }\n",
      "  for (const f of files.sort()) { hh.update(f + \"\\0\"); hh.update(f in ACC01_EDITS || f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS ? read(f) : readFileSync(join(ROOT, f))); }\n"],
    ["const po01b1DriftNow = po01b1Drift((f) => { try { return diskRead(f); } catch { return null; } });\n",
      "const po01b1DriftNow = po01b1Drift((f) => { try { return po02aRead(f); } catch { return null; } });\n"],
    ["  po01b1DriftNow.length === 0 && Object.keys(PO01B1_EDITS).length > 0, po01b1DriftNow.join(\" \"));\nconst SUBMIT: Record<string, string> = {\n",
      "  po01b1DriftNow.length === 0 && Object.keys(PO01B1_EDITS).length > 0, po01b1DriftNow.join(\" \"));\nconst po02aDriftNow = po02aDrift((f) => { try { return diskRead(f); } catch { return null; } });\ncheck(\"Platform Owner PO-02A's approved change: each recorded file is PO-01B.1's (021ceb4) plus exactly its hunks, each added file (the company schema, the compatibility rule, the reviewed PO-02A SQL) as recorded (verify/po02a-approved-delta.mts)\",\n  po02aDriftNow.length === 0 && Object.keys(PO02A_EDITS).length > 0, po02aDriftNow.join(\" \"));\nconst SUBMIT: Record<string, string> = {\n"],
  ],
  "verify/verify-page-archetypes.mts": [
    ["import { PO01B1_BASE, PO01B1_EDITS, PO01B1_NEW, po01b1Drift, undoPo01b1 } from \"./po01b1-approved-delta.mjs\";\nimport { renderToStaticMarkup } from \"react-dom/server\";\n",
      "import { PO01B1_BASE, PO01B1_EDITS, PO01B1_NEW, po01b1Drift, undoPo01b1 } from \"./po01b1-approved-delta.mjs\";\nimport { PO02A_BASE, PO02A_EDITS, PO02A_NEW, po02aDrift, undoPo02a } from \"./po02a-approved-delta.mjs\";\nimport { renderToStaticMarkup } from \"react-dom/server\";\n"],
    ["const po01b1Read = (p: string) => undoPo01b1(p, diskRead(p));\n",
      "// Platform Owner PO-02A: its recorded hunks are undone before PO-01B.1's (group 24 proves they are each file's only change),\n// so the PO-01B.1 layer and every older group read PO-01B.1's bytes; the files PO-02A added stay out of `walk`.\nconst po02aRead = (p: string) => undoPo02a(p, diskRead(p));\nconst po01b1Read = (p: string) => undoPo01b1(p, po02aRead(p));\n"],
    ["    : f in ACC01_EDITS ? rawRead(f) : f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS ? actualRead(f) : readFileSync(path.join(ROOT, f));\n",
      "    : f in ACC01_EDITS ? rawRead(f) : f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS ? actualRead(f) : readFileSync(path.join(ROOT, f));\n"],
    ["    else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW)) out.push(p);\n",
      "    else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW)) out.push(p);\n"],
    ["  walk(\"src\").length + Object.keys(ACC01_NEW).length + Object.keys(LCP_NEW).length + Object.keys(PO01A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B1_NEW).filter((f) => f.startsWith(\"src/\")).length === (function all(d: string): number {\n",
      "  walk(\"src\").length + Object.keys(ACC01_NEW).length + Object.keys(LCP_NEW).length + Object.keys(PO01A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02A_NEW).filter((f) => f.startsWith(\"src/\")).length === (function all(d: string): number {\n"],
    ["const po01b1DriftNow = po01b1Drift((f) => (existsSync(path.join(ROOT, f)) ? diskRead(f) : null));\n",
      "const po01b1DriftNow = po01b1Drift((f) => (existsSync(path.join(ROOT, f)) ? po02aRead(f) : null));\n"],
    ["check(\"each file PO-01B.1 changed is one an earlier platform layer added or recorded — no customer or older frozen file gains a new approved change\", po01b1Fresh.length === 0, po01b1Fresh.join(\" \"));\n\nconsole.log(\"\\nGroups:\");\nfor (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);\n",
      "check(\"each file PO-01B.1 changed is one an earlier platform layer added or recorded — no customer or older frozen file gains a new approved change\", po01b1Fresh.length === 0, po01b1Fresh.join(\" \"));\n\n// ---------- 24. Platform Owner PO-02A — the approved change to frozen files ----------\nsection(\"24. Platform Owner PO-02A — company database foundation (the approved change to frozen files)\");\n// Read as they are on disk: each changed file is PO-01B.1's (021ceb4) plus exactly its recorded hunks, each added file as recorded.\nconst po02aDriftNow = po02aDrift((f) => (existsSync(path.join(ROOT, f)) ? diskRead(f) : null));\nconst PO02A_EDITABLE = [\"src/db/schema/index.ts\", \"src/db/schema/platform.ts\", \"src/db/schema/security.ts\", \"verify/verify-document-form.mts\", \"verify/verify-page-archetypes.mts\"];\nconst PO02A_NEW_SCOPE = /^(src\\/db\\/schema\\/platform-companies\\.ts|src\\/lib\\/platform\\/[\\w-]+\\.ts|drizzle\\/platform\\/PO02A_\\w+\\.sql)$/;\ncheck(`PO-02A changed its ${Object.keys(PO02A_EDITS).length} files (the schema index, the platform schema's audit index, the M4 index in the sessions schema and the two freeze verifiers) by exactly their ${Object.values(PO02A_EDITS).flat().length} recorded hunks — undone, each file is ${PO02A_BASE.slice(0, 7)}'s to the byte — and added exactly its ${Object.keys(PO02A_NEW).length} files, as recorded (verify/po02a-approved-delta.mts)`,\n  po02aDriftNow.length === 0 && PO02A_BASE === \"021ceb4d0badb425a5353282bdc506e719085dfe\" &&\n    Object.keys(PO02A_EDITS).length > 0 && Object.keys(PO02A_EDITS).every((f) => PO02A_EDITABLE.includes(f)),\n  po02aDriftNow.map(rel).join(\" \"));\nconst po02aOutside = Object.keys(PO02A_NEW).filter((f) => !PO02A_NEW_SCOPE.test(f));\ncheck(\"PO-02A added files only as the company schema module, platform library modules and the reviewed drizzle/platform/PO02A_*.sql files — no customer route, component, library, auth or session code\", Object.keys(PO02A_NEW).length > 0 && po02aOutside.length === 0, po02aOutside.join(\" \"));\n// Line-level: the only change to the CUSTOMER sessions schema is the additive M4 index (the existing two entries reflowed).\nconst codeLines = (lines: string[]) => lines.filter((l) => !/^\\s*\\/\\//.test(l));\nconst securityDelta = lineDelta(PO02A_EDITS[\"src/db/schema/security.ts\"] ?? []);\ncheck(\"PO-02A's only change to src/db/schema/security.ts (customer sessions) is the `sql` import and the partial index sessions_org_active_idx — the two existing index entries unchanged, nothing else removed\",\n  JSON.stringify(codeLines(securityDelta.removed)) === JSON.stringify(['  (t) => [index(\"sessions_user_idx\").on(t.userId), index(\"sessions_token_idx\").on(t.tokenHash)],']) &&\n    JSON.stringify(codeLines(securityDelta.added)) === JSON.stringify([\n      'import { sql } from \"drizzle-orm\";',\n      \"  (t) => [\",\n      '    index(\"sessions_user_idx\").on(t.userId),',\n      '    index(\"sessions_token_idx\").on(t.tokenHash),',\n      '    index(\"sessions_org_active_idx\").on(t.orgId).where(sql`${t.revokedAt} IS NULL`),',\n      \"  ],\",\n    ]),\n  JSON.stringify(securityDelta));\nconst platformDelta = lineDelta(PO02A_EDITS[\"src/db/schema/platform.ts\"] ?? []);\nconst indexDelta = lineDelta(PO02A_EDITS[\"src/db/schema/index.ts\"] ?? []);\ncheck(\"PO-02A's only changes to the platform schema and the schema index: the audit entity index, and the export of the company schema module\",\n  platformDelta.removed.length === 0 &&\n    JSON.stringify(codeLines(platformDelta.added)) === JSON.stringify(['    index(\"platform_audit_events_entity_idx\").on(t.entityType, t.entityId, t.createdAt.desc()),']) &&\n    indexDelta.removed.length === 0 && JSON.stringify(indexDelta.added) === JSON.stringify(['export * from \"./platform-companies\";']),\n  JSON.stringify([platformDelta, indexDelta]));\n\nconsole.log(\"\\nGroups:\");\nfor (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);\n"],
  ],
};

function byPath(pairs: [string, string][]): Record<string, string> {
  return Object.fromEntries(pairs.map(([sha, file]) => [file, sha]));
}
/** 021ceb4's bytes of each changed file (sha256, 16 hex) — what the file is once its hunks are undone. */
export const PO02A_BASE_SHA: Record<string, string> = byPath([
  ["d3d536f9f9bf185f", "src/db/schema/index.ts"],
  ["7307cbc8fae7d77c", "src/db/schema/platform.ts"],
  ["a2f63cfb85ecb6d7", "src/db/schema/security.ts"],
  ["41ad1cc57e6c79aa", "verify/verify-document-form.mts"],
  ["390209805a8f991f", "verify/verify-page-archetypes.mts"],
]);
/** The files PO-02A added under src/ and drizzle/ (sha256, 16 hex). */
export const PO02A_NEW: Record<string, string> = byPath([
  ["9a3563aeb8183171", "drizzle/platform/PO02A_company_foundation.sql"],
  ["db89d75915df8320", "drizzle/platform/PO02A_m4_sessions_index_concurrently.sql"],
  ["ed87e54c409f187e", "drizzle/platform/PO02A_rollback.sql"],
  ["37403b02ec745eee", "src/db/schema/platform-companies.ts"],
  ["4e28f2f226720d8b", "src/lib/platform/company-access.ts"],
]);

const h16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** A file's text with the PO-02A hunks undone — 021ceb4's text when they are its only change; any other file as it is. */
export function undoPo02a(file: string, text: string): string {
  return (PO02A_EDITS[file] ?? []).reduce((acc, [was, is]) => acc.replace(is, () => was), text);
}
/** Files whose bytes are not 021ceb4's plus exactly the recorded hunks, and added files not as recorded. */
export function po02aDrift(actual: (file: string) => string | null): string[] {
  const drift: string[] = [];
  for (const [f, hunks] of Object.entries(PO02A_EDITS)) {
    const src = actual(f);
    if (src === null || !hunks.every(([was, is]) => src.split(is).length === 2 && !src.includes(was)) || h16(undoPo02a(f, src)) !== PO02A_BASE_SHA[f]) drift.push(f);
  }
  for (const [f, sha] of Object.entries(PO02A_NEW)) {
    const src = actual(f);
    if (src === null || h16(src) !== sha) drift.push(`new: ${f}`);
  }
  return drift;
}
