import "server-only";

// ---------------------------------------------------------------------------------------------
// Single definition of "the platform audit trail is protected", shared by the runtime fail-closed
// check (audit.ts → assertPlatformAuditProtection) and the operator scripts
// (scripts/platform/check-platform-db.ts).
//
// Deliberately NOT a name check: the tenant `verify:db-hardening` is satisfied by decoy triggers
// that merely carry the right names (AUD-08 finding 3, PO-00 §I.1 risk 11). Here a trigger counts
// only if it is bound to platform_audit_events by tgrelid, is enabled, fires BEFORE the right
// events at the right level, and executes the expected function body.
// ---------------------------------------------------------------------------------------------

export const AUDIT_PROTECTION_QUERY = `
select t.tgname as tgname,
       t.tgenabled as tgenabled,
       t.tgtype::int as tgtype,
       p.proname as proname,
       p.prosrc as prosrc
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = current_schema()
  and c.relname = 'platform_audit_events'
  and not t.tgisinternal`;

export type AuditProtectionRow = { tgname: string; tgenabled: string; tgtype: number; proname: string; prosrc: string };

// pg_trigger.tgtype bits (src/include/catalog/pg_trigger.h)
const ROW = 1;
const BEFORE = 2;
const DELETE = 8;
const UPDATE = 16;
const TRUNCATE = 32;
const INSTEAD = 64;

const EXPECTED_FUNCTION = "platform_reject_mutation";
const EXPECTED_BODY = "BEGIN RAISE EXCEPTION 'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP; END;";

function normalizeBody(src: string): string {
  return src.replace(/\s+/g, " ").trim();
}

function rejectsMutation(row: AuditProtectionRow): boolean {
  return (
    row.proname === EXPECTED_FUNCTION &&
    normalizeBody(row.prosrc) === EXPECTED_BODY &&
    // 'O' = fires in origin/local mode (default), 'A' = always. 'D' (disabled) and 'R' (replica only) fail.
    (row.tgenabled === "O" || row.tgenabled === "A")
  );
}

export type AuditProtectionVerdict = { ok: boolean; missing: string[] };

export function evaluateAuditProtection(rows: AuditProtectionRow[]): AuditProtectionVerdict {
  const missing: string[] = [];
  const rowGuard = rows.some(
    (r) => rejectsMutation(r) && (r.tgtype & ROW) === ROW && (r.tgtype & BEFORE) === BEFORE && (r.tgtype & INSTEAD) === 0 && (r.tgtype & (UPDATE | DELETE)) === (UPDATE | DELETE),
  );
  if (!rowGuard) missing.push("BEFORE UPDATE OR DELETE row trigger executing platform_reject_mutation()");
  const truncateGuard = rows.some(
    (r) => rejectsMutation(r) && (r.tgtype & ROW) === 0 && (r.tgtype & BEFORE) === BEFORE && (r.tgtype & TRUNCATE) === TRUNCATE,
  );
  if (!truncateGuard) missing.push("BEFORE TRUNCATE statement trigger executing platform_reject_mutation()");
  return { ok: missing.length === 0, missing };
}
