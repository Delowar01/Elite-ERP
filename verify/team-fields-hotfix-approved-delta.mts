/**
 * Security hotfix TFX (Team sensitive fields) — the approved change to files the DEV-UI-01.7 page-archetypes verifier
 * freezes on main (621f156), prepared for a separate, owner-approved production release.
 *
 * The customer Business Settings page loaded the team with an unqualified db.select() — every users column, the bcrypt
 * password hash and the field-encrypted MFA secret / recovery-code envelopes included — and passed the rows to the
 * client component TeamPanel, so React serialized them into the page (HTML and RSC payload) for every owner or admin.
 * The fix selects exactly the five fields the panel renders (id, name, email, role, isActive) and narrows TeamPanel's
 * prop type to that shape (TeamMember), so a full row can no longer be passed. Nothing else changes: the Team
 * interface, actions, permissions, sign-in and MFA are untouched.
 *
 * The rule for an approved change is the one C8, ACC-01 and the LCP stage used: no re-baseline. Each changed file's
 * hunks are recorded here byte for byte, [621f156's text, the hotfix's text]; undone, the file is main's (621f156) to
 * the byte (TFX_BASE_SHA), so every pin keeps its strength. verify:page-archetypes group 21 proves the hunks are each
 * file's only change. Generated from the diff against TFX_BASE (each hunk widened with context until it is unique in
 * both files, its 621f156 form nowhere in the hotfix's); changing a hotfix file means regenerating this record.
 */
import { createHash } from "node:crypto";

export const TFX_BASE = "621f156f7b129b9c2e289bc46d314ce7587beec2";
export const TFX_EDITS: Record<string, [string, string][]> = {
  "src/app/(app)/settings/organization/page.tsx": [
    ["    .orderBy(asc(bankAccountsTable.name));\n  const members = await db.select().from(usersTable).where(eq(usersTable.orgId, session.orgId)).orderBy(asc(usersTable.name));\n\n",
      "    .orderBy(asc(bankAccountsTable.name));\n  // Security: only the fields the Team panel renders. The rows are serialized to the browser, so never select the\n  // password hash or the MFA secret / recovery-code envelopes here.\n  const members = await db\n    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, isActive: usersTable.isActive })\n    .from(usersTable)\n    .where(eq(usersTable.orgId, session.orgId))\n    .orderBy(asc(usersTable.name));\n\n"],
  ],
  "src/app/(app)/settings/team/team-panel.tsx": [
    ["\nexport function TeamPanel({\n  locale,\n  members,\n  currentUserId,\n  currentUserRole,\n}: {\n  locale: Locale;\n  members: User[];\n  currentUserId: number;\n",
      "\n/** Exactly what the panel renders — the props are serialized to the browser, so no authentication field belongs here. */\nexport type TeamMember = Pick<User, \"id\" | \"name\" | \"email\" | \"role\" | \"isActive\">;\n\nexport function TeamPanel({\n  locale,\n  members,\n  currentUserId,\n  currentUserRole,\n}: {\n  locale: Locale;\n  members: TeamMember[];\n  currentUserId: number;\n"],
  ],
};

function byPath(pairs: [string, string][]): Record<string, string> {
  return Object.fromEntries(pairs.map(([sha, file]) => [file, sha]));
}
/** 621f156's bytes of each changed file (sha256, 16 hex) — what the file is once its hunks are undone. */
export const TFX_BASE_SHA: Record<string, string> = byPath([
  ["e5238b33f8f955af", "src/app/(app)/settings/organization/page.tsx"],
  ["54f2bc449cd89d80", "src/app/(app)/settings/team/team-panel.tsx"],
]);
/** The files the hotfix added under src/ (none) (sha256, 16 hex). */
export const TFX_NEW: Record<string, string> = byPath([
]);

const h16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** A file's text with the hotfix hunks undone — 621f156's text when they are its only change; any other file as it is. */
export function undoTfx(file: string, text: string): string {
  return (TFX_EDITS[file] ?? []).reduce((acc, [was, is]) => acc.replace(is, () => was), text);
}
/** Files whose bytes are not 621f156's plus exactly the recorded hunks, and added files not as recorded. */
export function tfxDrift(actual: (file: string) => string | null): string[] {
  const drift: string[] = [];
  for (const [f, hunks] of Object.entries(TFX_EDITS)) {
    const src = actual(f);
    if (src === null || !hunks.every(([was, is]) => src.split(is).length === 2 && !src.includes(was)) || h16(undoTfx(f, src)) !== TFX_BASE_SHA[f]) drift.push(f);
  }
  for (const [f, sha] of Object.entries(TFX_NEW)) {
    const src = actual(f);
    if (src === null || h16(src) !== sha) drift.push(`new: ${f}`);
  }
  return drift;
}
