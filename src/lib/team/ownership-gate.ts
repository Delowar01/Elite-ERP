import "server-only";
import { db, type Tx } from "@/db";
import { lockPrimaryOwnerMapping, primaryOwnerFoundation, primaryOwnerMappingsExpected, readPrimaryOwnerMapping } from "@/lib/platform/primary-owners";
import { readSeatAccounting } from "@/lib/platform/seat-accounting";
import type { TeamOwnershipSummary, TeamPrimaryOwner, TeamSeatSummary } from "./seat-summary-types";

// ---------------------------------------------------------------------------------------------
// Team ownership gate (PO-03A). The ONE customer module that consults the Platform Owner primary-owner mapping and
// seat accounting (src/lib/platform/primary-owners.ts, src/lib/platform/seat-accounting.ts). Used by the Team-change
// service (src/lib/team/member-changes.ts) and the Business Settings page (the Team tab), always for the signed-in
// user's OWN company — the callers pass session.orgId and nothing else.
//
//  • Changes fail CLOSED. Inside the Team-change transaction the mapping is read under lock; missing or malformed
//    foundation objects (a deployment-order error) refuse the change with TeamProtectionUnavailableError and an
//    incident line — a missing TABLE is never read as a missing ROW. Where the table does not exist at all and no
//    feature creates mappings, no mapping can exist: the company is "not designated", and the Team works as before.
//  • The summary is display only. Anything unreadable is shown as unavailable — never as "no subscription" or
//    "not designated".
// ---------------------------------------------------------------------------------------------

/** The primary-owner check could not be made (missing foundation objects, or a feature that needs them is on). */
export class TeamProtectionUnavailableError extends Error {
  constructor() {
    super("team ownership protection unavailable");
    this.name = "TeamProtectionUnavailableError";
  }
}

// undefined_table, undefined_column — what a database without (or with a damaged) PO-02D1 foundation answers.
const MISSING_OBJECT_CODES = new Set(["42P01", "42703"]);

function sqlStateOf(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function unavailable(): never {
  console.error("[team-ownership] primary-owner protection unavailable — team change refused (fail closed)");
  throw new TeamProtectionUnavailableError();
}

/** Missing foundation objects → TeamProtectionUnavailableError (after the incident line); any other error unchanged. */
function failClosed(err: unknown): never {
  if (MISSING_OBJECT_CODES.has(sqlStateOf(err) ?? "")) unavailable();
  throw err;
}

/**
 * Inside the Team-change transaction, after the company row and the affected user rows are locked: the company's
 * primary owner (user id), or null when it has none. Throws TeamProtectionUnavailableError when the check cannot be
 * made — the caller's transaction then rolls back and nothing changes.
 */
export async function lockPrimaryOwnerForTeamChange(tx: Tx, orgId: number): Promise<{ userId: number } | null> {
  let foundation: Awaited<ReturnType<typeof primaryOwnerFoundation>>;
  try {
    foundation = await primaryOwnerFoundation(tx);
  } catch (err) {
    failClosed(err);
  }
  if (foundation === "absent") {
    if (primaryOwnerMappingsExpected()) unavailable();
    return null;
  }
  try {
    return await lockPrimaryOwnerMapping(tx, orgId);
  } catch (err) {
    failClosed(err);
  }
}

function errorClass(err: unknown): string {
  const code = sqlStateOf(err);
  if (code && /^[0-9A-Z]{5}$/.test(code)) return `SQLSTATE ${code}`;
  return err instanceof Error ? err.name : "unknown";
}

async function seatSummary(orgId: number): Promise<TeamSeatSummary> {
  try {
    const s = await readSeatAccounting(db, orgId);
    if (s.allowance.state === "not_installed" && primaryOwnerMappingsExpected()) return { available: false };
    const allowance: Extract<TeamSeatSummary, { available: true }>["allowance"] =
      s.allowance.state === "assigned"
        ? { state: "assigned", seats: s.allowance.seats, packageName: s.allowance.packageName, versionNumber: s.allowance.versionNumber, isTrial: s.allowance.isTrial, endDate: s.allowance.endDate }
        : { state: "none" };
    return { available: true, users: s.users, occupied: s.occupied, allowance, remaining: s.remaining, overBy: s.overBy };
  } catch (err) {
    console.error(`[team-ownership] seat summary unavailable: ${errorClass(err)}`);
    return { available: false };
  }
}

async function primaryOwnerSummary(orgId: number): Promise<TeamPrimaryOwner> {
  try {
    if ((await primaryOwnerFoundation(db)) === "absent") return primaryOwnerMappingsExpected() ? { state: "unavailable" } : { state: "not_designated" };
    const mapping = await readPrimaryOwnerMapping(db, orgId);
    return mapping ? { state: "designated", userId: mapping.userId } : { state: "not_designated" };
  } catch (err) {
    console.error(`[team-ownership] primary owner unavailable: ${errorClass(err)}`);
    return { state: "unavailable" };
  }
}

/** The Team page's read-only summary for the signed-in user's own company (pass session.orgId). */
export async function readTeamOwnershipSummary(orgId: number): Promise<TeamOwnershipSummary> {
  const [seats, primaryOwner] = await Promise.all([seatSummary(orgId), primaryOwnerSummary(orgId)]);
  return { seats, primaryOwner };
}
