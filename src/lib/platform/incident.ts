import "server-only";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { platformClock } from "./clock";
import { isPlatformError } from "./errors";

// ---------------------------------------------------------------------------------------------
// Security-incident reporting for the Platform Owner console (PO-01B.1).
//
// Used when something that MUST be audited could not be: an emergency session containment made
// while the audit trail was unavailable, or an audit write that failed. The audit table is, by
// definition, not usable at that moment, so the incident goes to the server's error stream (the
// process log the operator already collects) as ONE structured line:
//
//   [platform-security-incident] {"incidentId":…,"at":…,"type":…,"action":…,"actorAdminId":…,
//                                 "sessionIds":[…],"count":…,"requestId":…,"ip":…,"error":…}
//
// Allow-listed fields only, each validated: identifiers (UUIDs), counts, a dotted action code, the
// trusted client IP and an error CLASS (SQLSTATE / PlatformError code / constructor name). Never a
// token, jti, hash, password, code, e-mail, user-agent or an error message (messages can quote
// values). The emergency revocation itself is also recorded in the audit trail — late, labelled as
// such — once it is available again (session.ts → reconcileUnauditedRevocations).
// ---------------------------------------------------------------------------------------------

export type SecurityIncidentType = "unaudited_session_revocation" | "audit_write_failed";

export type SecurityIncident = {
  type: SecurityIncidentType;
  /** Dotted action code of the operation, e.g. "session.revoked". */
  action: string;
  actorAdminId?: string | null;
  sessionIds?: readonly string[];
  count?: number;
  requestId?: string | null;
  ipAddress?: string | null;
  /** From errorClass(): never a message. */
  error?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const ERROR_CLASS = /^[A-Za-z0-9_:.-]{1,80}$/;

/** A non-sensitive classification of an error: PlatformError code, SQLSTATE or constructor name. */
export function errorClass(err: unknown): string {
  if (isPlatformError(err)) return `PlatformError:${err.code}`;
  for (const e of [err, typeof err === "object" && err !== null ? (err as { cause?: unknown }).cause : undefined]) {
    const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
    if (/^[0-9A-Z]{5}$/.test(code)) return `SQLSTATE:${code}`;
  }
  return err instanceof Error ? err.name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 60) || "Error" : "UnknownError";
}

/** Emit one incident line (no secrets) and return its id. Never throws. */
export function reportSecurityIncident(incident: SecurityIncident): string {
  const incidentId = randomUUID();
  try {
    const line = {
      incidentId,
      at: platformClock.now().toISOString(),
      type: incident.type === "audit_write_failed" ? "audit_write_failed" : "unaudited_session_revocation",
      action: ACTION.test(incident.action) ? incident.action : "invalid",
      actorAdminId: incident.actorAdminId && UUID.test(incident.actorAdminId) ? incident.actorAdminId : null,
      sessionIds: (incident.sessionIds ?? []).filter((id) => UUID.test(id)).slice(0, 50),
      count: Number.isInteger(incident.count) && (incident.count as number) >= 0 ? incident.count : null,
      requestId: incident.requestId && UUID.test(incident.requestId) ? incident.requestId : null,
      ip: incident.ipAddress && isIP(incident.ipAddress) ? incident.ipAddress : null,
      error: incident.error && ERROR_CLASS.test(incident.error) ? incident.error : null,
    };
    console.error(`[platform-security-incident] ${JSON.stringify(line)}`);
  } catch {
    console.error(`[platform-security-incident] {"incidentId":"${incidentId}","type":"report_failed"}`);
  }
  return incidentId;
}
