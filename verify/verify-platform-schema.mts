/**
 * Platform Owner PO-01A — schema equivalence, tenant non-interference and DB-constraint suite.
 * Since PO-02A the reviewed platform SQL is PO01_platform_identity.sql THEN
 * PO02A_company_foundation.sql: S is built from the pre-PO-02A (621f156) tenant shape, the PO01 file
 * alone must still leave every tenant object untouched, and the full Drizzle schema must equal the
 * pre-PO-02A tenant shape plus both files. PO-02A's own objects and its single tenant change (M4)
 * are pinned in detail by verify:platform-company-schema and verify:platform-migration-safety.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-schema
 *
 * Disposable loopback databases only (local-db-guard). Fictional data only. All databases created
 * here are dropped at the end (set PLATFORM_TEST_KEEP_DATABASES=1 to keep them for inspection).
 */
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import {
  connectDisposable,
  createDisposableDatabase,
  disposableName,
  dropDisposableDatabase,
  pushSchema,
  pushPreCompanyTenantSchema,
  applyPlatformMigration,
} from "../scripts/platform/disposable-db";
import { projectCatalog, withoutRoutines, diffProjection, checkPlatformObjects, projectionDigest, PLATFORM_SQL_PATH, PO02A_SQL_PATH } from "../scripts/platform/catalog";
import { section, ok, rejects, sqlState, summary, describeError } from "./platform/harness";

const created: string[] = [];
const keep = process.env.PLATFORM_TEST_KEEP_DATABASES === "1";

async function newDb(prefix: string): Promise<{ name: string; url: string }> {
  const name = disposableName(prefix);
  const url = await createDisposableDatabase(name);
  created.push(name);
  return { name, url };
}

function runNpm(script: string, url: string): { status: number | null; output: string } {
  const res = spawnSync("npm", ["run", "-s", script], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
    timeout: 300_000,
  });
  return { status: res.status, output: `${res.stdout ?? ""}${res.stderr ?? ""}`.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>") };
}

const state = (code: string) => (e: unknown) => sqlState(e) === code;
const CHECK = state("23514");
const UNIQUE = state("23505");
const FK = state("23503");
const APPEND_ONLY = (e: unknown) => sqlState(e) === "P0001" && /append-only/.test(String((e as Error).message));

async function main(): Promise<number> {
  section("1. Build disposable databases (both paths)");
  const P = await newDb("po01a_schema_p");
  const S = await newDb("po01a_schema_s");
  const pushP = pushSchema(P.url, "full");
  ok("P: drizzle-kit push of the branch schema (tenant + platform) succeeds", pushP.ok, pushP.output.slice(-400));
  const pushS = await pushPreCompanyTenantSchema(S.url);
  ok("S: drizzle-kit push of the pre-PO-02A tenant schema (621f156 shape) succeeds", pushS.ok, pushS.output.slice(-400));

  const cP = await connectDisposable(P.url);
  const cS = await connectDisposable(S.url);
  try {
    const S0 = await projectCatalog(cS);
    ok("S before platform SQL has no platform objects", S0.platform.tables.length === 0 && S0.platform.functions.length === 0);
    await applyPlatformMigration(S.url, [PLATFORM_SQL_PATH]);
    const S1a = await projectCatalog(cS);
    await applyPlatformMigration(S.url, [PO02A_SQL_PATH]);
    const S1 = await projectCatalog(cS);
    const P0 = await projectCatalog(cP);

    section("2. Drizzle schema ≡ reviewed SQL (tables, columns, defaults, constraints, indexes, sequences)");
    ok(
      "P (push) creates exactly the 6 platform-owned tables (PO-01A's 4 + PO-02A's tenant_access_controls, organization_invitations)",
      JSON.stringify(P0.platform.tables) === JSON.stringify(["organization_invitations", "platform_admins", "platform_audit_events", "platform_login_attempts", "platform_sessions", "tenant_access_controls"]),
      P0.platform.tables.join(","),
    );
    ok("P (push) creates no platform triggers or functions (push cannot)", P0.platform.triggers.length === 0 && P0.platform.functions.length === 0);
    const d1 = diffProjection(withoutRoutines(P0.platform), withoutRoutines(S1.platform), "drizzle-push", "reviewed-sql");
    ok("platform projection: drizzle push == reviewed SQL, PO01 + PO02A (excluding routines)", d1.length === 0, d1.slice(0, 8).join("\n        "));
    // PO-01A: 45 columns, 27 constraints, 14 indexes. PO-02A adds 7 + 17 columns, 9 + 19 constraints and
    // 7 indexes (2 primary keys, 3 unique + 1 partial on organization_invitations, the audit entity index).
    ok(
      "column / constraint / index counts (PO-01A 45/27/14 + PO-02A 24/28/7)",
      P0.platform.columns.length === 69 && P0.platform.constraints.length === 55 && P0.platform.indexes.length === 21,
      `${P0.platform.columns.length} columns, ${P0.platform.constraints.length} constraints, ${P0.platform.indexes.length} indexes`,
    );

    await applyPlatformMigration(P.url);
    const P1 = await projectCatalog(cP);
    const d2 = diffProjection(P1.platform, S1.platform, "push+sql", "sql-only");
    ok("platform projection incl. triggers + function: push+SQL == SQL-only", d2.length === 0, d2.slice(0, 8).join("\n        "));
    ok("S1 has the row trigger, the truncate trigger and platform_reject_mutation()", S1.platform.triggers.length === 2 && S1.platform.functions.length === 1);

    section("3. No tenant object is created, altered or removed");
    const d3 = diffProjection(S0.other, S1a.other, "before-sql", "after-PO01-sql");
    ok("applying the PO01 platform SQL leaves every non-platform object identical", d3.length === 0, d3.slice(0, 8).join("\n        "));
    const d4 = diffProjection(P1.other, S1.other, "full-schema-push", "pre-PO-02A-tenant-push+sql");
    ok("every tenant object of the full Drizzle schema equals the pre-PO-02A tenant shape + the reviewed SQL (PO-02A's M4 index included)", d4.length === 0, d4.slice(0, 8).join("\n        "));
    ok("tenant table count unchanged (67)", S1.other.tables.length === 67, String(S1.other.tables.length));

    section("4. Idempotency");
    await applyPlatformMigration(S.url);
    const S2 = await projectCatalog(cS);
    ok("re-applying the SQL is a no-op (full projection digest unchanged)", projectionDigest(S2.platform) === projectionDigest(S1.platform) && projectionDigest(S2.other) === projectionDigest(S1.other));

    section("5. Constraints (fictional rows on S)");
    const hash = await bcrypt.hash("Fictional-Passw0rd!x", 4);
    const envelope = "v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB==:CCCCCCCC";
    const insertAdmin = (email: string, opts: { hash?: string; secret?: string | null; active?: boolean; enrolled?: boolean } = {}) =>
      cS.query(
        `insert into platform_admins (email_normalized, display_name, password_hash, is_active, mfa_secret_encrypted, mfa_enrolled_at)
         values ($1, 'Fictional Owner', $2, $3, $4, $5) returning id`,
        [email, opts.hash ?? hash, opts.active ?? true, opts.secret === undefined ? envelope : opts.secret, opts.enrolled === false ? null : new Date()],
      );
    const admin = (await insertAdmin("owner@platform.test")).rows[0].id as string;
    ok("valid active admin (bcrypt hash + encrypted MFA envelope) inserts", typeof admin === "string" && admin.length === 36);
    await rejects("plaintext password_hash rejected", () => insertAdmin("a1@platform.test", { hash: "Fictional-Passw0rd!x" }), CHECK);
    await rejects("plaintext (base32) MFA secret rejected", () => insertAdmin("a2@platform.test", { secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" }), CHECK);
    await rejects("active admin without MFA rejected (mandatory MFA)", () => insertAdmin("a3@platform.test", { secret: null, enrolled: false }), CHECK);
    const inactive = await insertAdmin("pending@platform.test", { secret: null, enrolled: false, active: false });
    ok("inactive admin without MFA is allowed (cannot log in)", inactive.rows.length === 1);
    await rejects("non-normalized (uppercase) email rejected", () => insertAdmin("Owner2@Platform.test"), CHECK);
    await rejects("email with surrounding whitespace rejected", () => insertAdmin(" owner3@platform.test"), CHECK);
    await rejects("duplicate email rejected", () => insertAdmin("owner@platform.test"), UNIQUE);
    await rejects("recovery hashes must be a JSON array", () => cS.query(`update platform_admins set mfa_recovery_hashes = '{}'::jsonb where id = $1`, [admin]), CHECK);
    await rejects("negative TOTP step rejected", () => cS.query(`update platform_admins set mfa_last_totp_step = -1 where id = $1`, [admin]), CHECK);

    const hex64 = "a".repeat(64);
    const insertSession = (o: { admin?: string; hash?: string; created?: string; expires?: string; revokedAt?: string | null; reason?: string | null } = {}) =>
      cS.query(
        `insert into platform_sessions (platform_admin_id, token_hash, mfa_verified_at, created_at, last_seen_at, expires_at, revoked_at, revoked_reason)
         values ($1, $2, $3::timestamptz, $3::timestamptz, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6)`,
        [o.admin ?? admin, o.hash ?? hex64, o.created ?? "2026-11-13T00:00:00Z", o.expires ?? "2026-11-13T12:00:00Z", o.revokedAt ?? null, o.reason ?? null],
      );
    await insertSession();
    ok("valid session (12 h) inserts", true);
    await rejects("duplicate token_hash rejected", () => insertSession(), UNIQUE);
    await rejects("non-hex token_hash rejected", () => insertSession({ hash: "not-a-hash" }), CHECK);
    await rejects("session longer than the 12 h ceiling rejected", () => insertSession({ hash: "b".repeat(64), expires: "2026-11-13T12:00:01Z" }), CHECK);
    await rejects("session expiring before creation rejected", () => insertSession({ hash: "c".repeat(64), expires: "2026-11-12T23:59:59Z" }), CHECK);
    await rejects("revoked_at without reason rejected", () => insertSession({ hash: "d".repeat(64), revokedAt: "2026-11-13T01:00:00Z" }), CHECK);
    await rejects("unknown revocation reason rejected", () => insertSession({ hash: "e".repeat(64), revokedAt: "2026-11-13T01:00:00Z", reason: "whatever" }), CHECK);
    await rejects("session for unknown admin rejected (FK)", () => insertSession({ hash: "f".repeat(64), admin: "00000000-0000-4000-8000-000000000000" }), FK);
    await rejects("deleting an admin with sessions is restricted", () => cS.query(`delete from platform_admins where id = $1`, [admin]), FK);

    await rejects("unknown login-attempt outcome rejected", () => cS.query(`insert into platform_login_attempts (outcome) values ('maybe')`), CHECK);
    await rejects("plaintext e-mail in email_hash rejected", () => cS.query(`insert into platform_login_attempts (email_hash, outcome) values ('owner@platform.test', 'failure')`), CHECK);
    await rejects("blocked_until not after attempted_at rejected", () => cS.query(`insert into platform_login_attempts (email_hash, outcome, attempted_at, blocked_until) values ($1, 'failure', '2026-11-13T00:00:00Z', '2026-11-13T00:00:00Z')`, [hex64]), CHECK);

    const org = (await cS.query(`insert into orgs (name) values ('Fictional Audit Org') returning id`)).rows[0].id as number;
    const insertAudit = (o: { action?: string; result?: string; before?: unknown; org?: number | null } = {}) =>
      cS.query(
        `insert into platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, org_id, result, before_safe)
         values ($1, 'Fictional Owner', $2, 'platform_admin', $6, $3, $4, $5) returning id`,
        [admin, o.action ?? "auth.login.succeeded", o.org === undefined ? org : o.org, o.result ?? "success", o.before === undefined ? null : JSON.stringify(o.before), admin],
      );
    const auditId = (await insertAudit()).rows[0].id;
    ok("valid audit event inserts", Number(auditId) >= 1);
    await rejects("malformed action code rejected", () => insertAudit({ action: "Login Succeeded" }), CHECK);
    await rejects("unknown result rejected", () => insertAudit({ result: "ok" }), CHECK);
    await rejects("non-object snapshot rejected", () => insertAudit({ before: [1, 2] }), CHECK);
    await rejects("UPDATE on platform_audit_events rejected", () => cS.query(`update platform_audit_events set reason = 'tamper' where id = $1`, [auditId]), APPEND_ONLY);
    await rejects("DELETE on platform_audit_events rejected", () => cS.query(`delete from platform_audit_events where id = $1`, [auditId]), APPEND_ONLY);
    await rejects("TRUNCATE on platform_audit_events rejected", () => cS.query(`truncate platform_audit_events`), APPEND_ONLY);
    await rejects("deleting an org referenced by platform audit is restricted", () => cS.query(`delete from orgs where id = $1`, [org]), FK);
    const count = (await cS.query(`select count(*)::int as n from platform_audit_events`)).rows[0].n;
    ok("audit row survives every tampering attempt", count === 1, String(count));
  } finally {
    await cP.end();
    await cS.end();
  }

  section("6. Decoy-resistant protection check");
  const D = await newDb("po01a_schema_d");
  const pushD = pushSchema(D.url, "full");
  ok("D: push (no platform SQL yet)", pushD.ok);
  const cD = await connectDisposable(D.url);
  try {
    let r = await checkPlatformObjects(cD);
    ok("push alone: protection reported MISSING (fail closed)", !r.ok && r.findings.some((f) => /audit protection missing/.test(f)), r.findings.join("; "));
    await cD.query(`create table decoy_audit (x int)`);
    await cD.query(`create function platform_reject_mutation() returns trigger language plpgsql as $$ BEGIN RAISE EXCEPTION 'Table % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP; END; $$`);
    await cD.query(`create trigger platform_audit_events_immutable before update or delete on decoy_audit for each row execute function platform_reject_mutation()`);
    await cD.query(`create trigger platform_audit_events_no_truncate before truncate on decoy_audit for each statement execute function platform_reject_mutation()`);
    r = await checkPlatformObjects(cD);
    ok("same-named decoy triggers on another table do NOT satisfy the check", !r.ok, r.findings.join("; "));
    await applyPlatformMigration(D.url);
    r = await checkPlatformObjects(cD);
    ok("after the reviewed SQL: protection OK", r.ok, r.findings.join("; "));
    await cD.query(`alter table platform_audit_events disable trigger platform_audit_events_immutable`);
    r = await checkPlatformObjects(cD);
    ok("a DISABLED row trigger is reported missing", !r.ok, r.findings.join("; "));
    await cD.query(`alter table platform_audit_events enable trigger platform_audit_events_immutable`);
    await cD.query(`create or replace function platform_reject_mutation() returns trigger language plpgsql as $$ BEGIN RETURN NULL; END; $$`);
    r = await checkPlatformObjects(cD);
    ok("a neutered function body is reported missing", !r.ok, r.findings.join("; "));
  } finally {
    await cD.end();
  }

  section("7. Existing tenant hardening + migration gate on the push-shaped DB (P)");
  const harden = runNpm("db:harden", P.url);
  ok("npm run db:harden on disposable P", harden.status === 0, harden.output.slice(-300));
  const hardenCheck = runNpm("verify:db-hardening", P.url);
  ok("npm run verify:db-hardening on disposable P", hardenCheck.status === 0 && /both append-only triggers present/.test(hardenCheck.output), hardenCheck.output.slice(-300));
  const cP2 = await connectDisposable(P.url);
  try {
    const r = await checkPlatformObjects(cP2);
    ok("platform protection still OK alongside tenant hardening", r.ok, r.findings.join("; "));
  } finally {
    await cP2.end();
  }
  const preflight = runNpm("db:preflight", P.url);
  const stateLine = preflight.output.split("\n").find((l) => l.startsWith("STATE:")) ?? "(no STATE line)";
  console.log(`  INFO  db:preflight on the push-shaped DB: exit ${preflight.status}, ${stateLine}`);
  ok("db:preflight still refuses push-shaped DBs (INCONSISTENT, exit 20) — PO-00 §F.2 unchanged", preflight.status === 20, stateLine);
  return 0;
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-schema");
} catch (e) {
  console.error(`verify:platform-schema aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  if (!keep) for (const name of created) await dropDisposableDatabase(name).catch(() => undefined);
}
process.exit(exitCode);
