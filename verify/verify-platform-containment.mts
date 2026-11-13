/**
 * Platform Owner PO-01B.1 — session changes vs. audit records: failure injection, emergency
 * containment, concurrency, expiry, tenant isolation and leakage.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-containment
 *
 * An AUDIT OUTAGE is injected for real: a test-only BEFORE INSERT trigger on platform_audit_events
 * that raises (the append-only protection triggers stay intact, so the protection check passes and
 * the failure happens exactly at the audit INSERT). One freshly created disposable database, dropped
 * at the end; fictional administrators; a deterministic platform clock; secrets never printed.
 *
 *   1. normal operations are all-or-nothing when the audit record cannot be written
 *   2. emergency containment stays available, is access-reducing only and never claims to be audited
 *   3. unaudited revocations are recorded in the audit trail late — once, labelled as such
 *   4. concurrent revocations are safe and idempotent
 *   5. revoked sessions cannot regain access
 *   6. session expiry stays correct, with or without the audit trail
 *   7. the tenant ERP's sessions and authentication are untouched
 *   8. nothing sensitive leaks (incident lines, audit rows, results)
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { decodeJwt } from "jose";
import { createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, rejects, summary, describeError } from "./platform/harness";

const testDbName = disposableName("po01b1_containment");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PLATFORM_CONSOLE_ENABLED = "true";
delete process.env.PLATFORM_TRUSTED_PROXY_HOPS;

const { db, pool, platformAdminsTable, platformSessionsTable, platformAuditEventsTable, orgsTable, usersTable, sessionsTable } = await import("../src/db");
const { and, eq, sql } = await import("drizzle-orm");
const auth = await import("../src/lib/platform/auth");
const { platformClock } = await import("../src/lib/platform/clock");
const { isPlatformError, PLATFORM_ERROR_MESSAGES } = await import("../src/lib/platform/errors");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const guards = await import("../src/lib/platform/guards");
const session = await import("../src/lib/platform/session");
const console_ = await import("../src/lib/platform/console");
const tenantAuth = await import("../src/lib/auth");
const tenantSessions = await import("../src/lib/security/session-store");

// ---- deterministic platform clock -------------------------------------------------------------
const MIN = 60_000;
let nowMs = Date.parse("2026-11-14T09:00:00.000Z");
platformClock.now = () => new Date(nowMs);
const advance = (ms: number) => {
  nowMs += ms;
};
const nextStep = () => {
  nowMs = (totp.totpStepAt(new Date(nowMs)) + 1) * 30_000 + 1_000;
};
const codeAt = (secret: string, offset = 0) => totp.hotpCode(secret, totp.totpStepAt(new Date(nowMs)) + offset);

// ---- captured server error stream (incident lines) -----------------------------------------------
const incidents: Record<string, unknown>[] = [];
const errorLines: string[] = [];
const realConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const line = args.map(String).join(" ");
  errorLines.push(line);
  const m = /^\[platform-security-incident\] (.*)$/.exec(line);
  if (m) incidents.push(JSON.parse(m[1]) as Record<string, unknown>);
};
const incidentsSince = (n: number) => incidents.slice(n);

// ---- fixtures -----------------------------------------------------------------------------------
const PASSWORD = "Saffron-Meridian-47!t";
const secretsSeen: string[] = [PASSWORD];
type Admin = { id: string; email: string; secret: string; codes: string[] };
async function createAdmin(email: string): Promise<Admin> {
  const { secret } = mfa.createTotpEnrollment(email);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date(nowMs);
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName: `Fictional ${email.split("@")[0]}`, passwordHash: await auth.hashPlatformPassword(PASSWORD), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  secretsSeen.push(email, secret, ...codes);
  return { id: row.id, email, secret, codes };
}
const HOST = "containment.erp.test";
const browser = (extra: Record<string, string> = {}) => new Headers({ host: HOST, origin: `https://${HOST}`, "sec-fetch-site": "same-origin", "user-agent": "verify-platform-containment", ...extra });
const reqOf = (token: string | null, headers: Headers = browser()) => ({ headers, token });
const fail = (r: { ok: boolean; code?: string }, code: string) => !r.ok && r.code === code && Object.keys(r).sort().join(",") === "code,ok";
type Live = { token: string; id: string };
async function signIn(a: Admin): Promise<Live> {
  nextStep();
  const r = await console_.signInCore({ email: a.email, password: PASSWORD, totpCode: codeAt(a.secret) }, { headers: browser() });
  if (!r.ok) {
    const [row] = await db.select({ step: platformAdminsTable.mfaLastTotpStep }).from(platformAdminsTable).where(eq(platformAdminsTable.id, a.id));
    throw new Error(`fixture sign-in failed: ${r.code} (presented step ${totp.totpStepAt(new Date(nowMs))}, last consumed ${row?.step})`);
  }
  secretsSeen.push(r.token, String(decodeJwt(r.token).jti));
  return { token: r.token, id: (await guards.authorizePlatformToken(r.token)).sessionId };
}
/** Fixture sessions one after another: each sign-in needs its own TOTP step on the shared deterministic clock. */
async function signInMany(a: Admin, n: number): Promise<Live[]> {
  const out: Live[] = [];
  for (let i = 0; i < n; i++) out.push(await signIn(a));
  return out;
}
const alive = (t: string) => guards.authorizePlatformToken(t).then(() => true, () => false);
const rowOf = async (id: string) => (await db.select().from(platformSessionsTable).where(eq(platformSessionsTable.id, id)))[0];
const auditCount = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(platformAuditEventsTable))[0].n;
const auditFor = async (sessionId: string) =>
  db.select({ action: platformAuditEventsTable.action, after: platformAuditEventsTable.afterSafe, actor: platformAuditEventsTable.actorLabel }).from(platformAuditEventsTable).where(and(eq(platformAuditEventsTable.entityType, "platform_session"), eq(platformAuditEventsTable.entityId, sessionId)));
const revocationRows = async (sessionId: string) => (await auditFor(sessionId)).filter((r) => (session.SESSION_REVOCATION_ACTIONS as readonly string[]).includes(r.action));

/** Inject (or remove) an audit-write outage: every INSERT into platform_audit_events raises. */
async function auditOutage(on: boolean) {
  if (on) {
    await db.execute(sql.raw(`create or replace function po01b1_test_only_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit outage (test only)'; end $$`));
    await db.execute(sql.raw(`create trigger po01b1_test_only_fail_audit before insert on platform_audit_events for each row execute function po01b1_test_only_fail_audit()`));
  } else {
    await db.execute(sql.raw(`drop trigger if exists po01b1_test_only_fail_audit on platform_audit_events`));
    await db.execute(sql.raw(`drop function if exists po01b1_test_only_fail_audit()`));
  }
}

async function main() {
  const owner = await createAdmin("owner@containment.test");
  const other = await createAdmin("other@containment.test");

  // Fictional TENANT session (the customer ERP), created exactly as session-store.createSession does.
  const [org] = await db.insert(orgsTable).values({ name: "Fictional Tenant Co" }).returning({ id: orgsTable.id });
  const [user] = await db.insert(usersTable).values({ orgId: org.id, email: "tenant-user@containment.test", passwordHash: "$2a$10$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZa", name: "Tenant User" }).returning({ id: usersTable.id });
  const tenantJti = randomBytes(24).toString("base64url");
  await db.insert(sessionsTable).values({ orgId: org.id, userId: user.id, tokenHash: createHash("sha256").update(tenantJti).digest("hex"), expiresAt: new Date(Date.now() + 30 * 24 * 3600_000) });
  const tenantToken = await tenantAuth.signSessionToken({ userId: user.id, orgId: org.id, jti: tenantJti });
  secretsSeen.push(tenantJti, tenantToken);
  const tenantSnapshot = async () => JSON.stringify(await db.select().from(sessionsTable));
  const tenantBefore = await tenantSnapshot();

  // Every session the outage sections need is created first (sign-in is refused during an outage).
  const A = await signIn(owner); // the operator's current session
  const B = await signIn(owner);
  const C = await signIn(owner);
  const D = await signIn(owner);
  const G = await signIn(owner); // a second operator browser, for the guard checks
  const X = await signIn(other); // another administrator

  section("1. Normal operations under an injected audit outage are all-or-nothing");
  {
    await auditOutage(true);
    const audits0 = await auditCount();
    const inc0 = incidents.length;

    const r1 = await console_.revokeSessionCore(reqOf(A.token), B.id);
    ok("revoke one session → AUDIT_UNAVAILABLE (nothing else)", fail(r1, "AUDIT_UNAVAILABLE"));
    ok("…and the session is NOT revoked (still live, revoked_at null)", (await alive(B.token)) && (await rowOf(B.id)).revokedAt === null);

    const r2 = await console_.signOutOtherSessionsCore(reqOf(A.token));
    ok("sign out other sessions → AUDIT_UNAVAILABLE", fail(r2, "AUDIT_UNAVAILABLE"));
    ok("…and NONE of the four other sessions was revoked (no partial bulk revocation)", (await Promise.all([B, C, D, G].map((s) => alive(s.token)))).every(Boolean));

    await rejects("administrative invalidation (admin_disabled) → AUDIT_UNAVAILABLE", () => session.revokeAllPlatformSessions(owner.id, "admin_disabled"), (e) => isPlatformError(e, "AUDIT_UNAVAILABLE"));
    await rejects("…also inside a caller's transaction (it joins and rolls back with it)", () => db.transaction((tx) => session.revokeAllPlatformSessions(owner.id, "password_change", {}, tx)), (e) => isPlatformError(e, "AUDIT_UNAVAILABLE"));
    ok("…and every session of that administrator is still live", (await Promise.all([A, B, C, D, G].map((s) => alive(s.token)))).every(Boolean));

    await rejects("library logout → AUDIT_UNAVAILABLE (the normal logout is atomic too)", () => session.logoutPlatformSession(B.token), (e) => isPlatformError(e, "AUDIT_UNAVAILABLE"));
    ok("…and that session is still live", await alive(B.token));

    const hashesBefore = JSON.stringify((await db.select({ h: platformAdminsTable.mfaRecoveryHashes, step: platformAdminsTable.mfaLastTotpStep }).from(platformAdminsTable).where(eq(platformAdminsTable.id, owner.id)))[0]);
    nextStep();
    const fresh = codeAt(owner.secret);
    const r3 = await console_.regenerateRecoveryCodesCore(reqOf(A.token), { password: PASSWORD, totpCode: fresh });
    ok("recovery-code regeneration (a credential change) → AUDIT_UNAVAILABLE", fail(r3, "AUDIT_UNAVAILABLE"));
    ok("…codes NOT rotated and the TOTP step NOT consumed (one transaction)", JSON.stringify((await db.select({ h: platformAdminsTable.mfaRecoveryHashes, step: platformAdminsTable.mfaLastTotpStep }).from(platformAdminsTable).where(eq(platformAdminsTable.id, owner.id)))[0]) === hashesBefore);

    const sessionsBefore = (await db.select({ n: sql<number>`count(*)::int` }).from(platformSessionsTable))[0].n;
    const stepBefore = (await db.select({ step: platformAdminsTable.mfaLastTotpStep }).from(platformAdminsTable).where(eq(platformAdminsTable.id, owner.id)))[0].step;
    const r4 = await console_.signInCore({ email: owner.email, password: PASSWORD, totpCode: codeAt(owner.secret, 1) }, { headers: browser() });
    const stepAfter = (await db.select({ step: platformAdminsTable.mfaLastTotpStep }).from(platformAdminsTable).where(eq(platformAdminsTable.id, owner.id)))[0].step;
    ok("sign-in fails closed with the generic CONFIG_ERROR and creates no session", fail(r4, "CONFIG_ERROR") && (await db.select({ n: sql<number>`count(*)::int` }).from(platformSessionsTable))[0].n === sessionsBefore, JSON.stringify(r4));
    ok("…and the authenticator step it presented is NOT consumed (the code stays usable after the outage)", stepAfter === stepBefore, `${stepBefore} → ${stepAfter}`);

    ok("no audit row and no session change happened during the outage", (await auditCount()) === audits0);
    ok("the operator is told the truth: 'not applied because it could not be recorded' (EN and AR)", PLATFORM_ERROR_MESSAGES.AUDIT_UNAVAILABLE.en === "This change was not applied because it could not be recorded in the audit trail." && /[؀-ۿ]/.test(PLATFORM_ERROR_MESSAGES.AUDIT_UNAVAILABLE.ar));
    const refused = incidentsSince(inc0).filter((i) => i.type === "audit_write_failed").map((i) => i.action);
    ok("each refused operation logged an audit_write_failed incident (revoke, logout-all, regeneration, sign-in)", ["session.revoked", "session.logout_all", "mfa.recovery_codes.regenerated", "auth.login"].every((a) => refused.includes(a)), refused.join(" "));
    ok("no refused operation was ever reported as an unaudited revocation", incidentsSince(inc0).every((i) => i.type !== "unaudited_session_revocation"));
  }

  section("2. Emergency containment during the outage — available, access-reducing, never 'audited'");
  {
    const inc0 = incidents.length;
    const audits0 = await auditCount();
    const e1 = await console_.emergencyContainmentCore(reqOf(A.token), { scope: "session", sessionId: B.id });
    ok("end one session → ok, audited: false, count 1", e1.ok && e1.audited === false && e1.count === 1 && e1.signedOutCurrent === false);
    ok("…that session is refused at once", !(await alive(B.token)) && (await rowOf(B.id)).revokedReason === "revoked");
    const i1 = incidentsSince(inc0).find((i) => i.type === "unaudited_session_revocation");
    ok("…and an incident line records it: action, actor, the session id, count, request id", !!i1 && i1.action === "session.revoked" && i1.actorAdminId === owner.id && JSON.stringify(i1.sessionIds) === JSON.stringify([B.id]) && i1.count === 1 && typeof i1.requestId === "string");

    const e2 = await console_.emergencyContainmentCore(reqOf(A.token), { scope: "others" });
    ok("end all other sessions → ok, audited: false, count 3 (C, D, G)", e2.ok && e2.audited === false && e2.count === 3);
    ok("…C, D and G are refused; the operator's current session A stays", !(await alive(C.token)) && !(await alive(D.token)) && !(await alive(G.token)) && (await alive(A.token)));
    ok("…another administrator's session is untouched", await alive(X.token));

    const guardsInc = incidents.length;
    const saved = process.env.PLATFORM_CONSOLE_ENABLED;
    delete process.env.PLATFORM_CONSOLE_ENABLED;
    const off = await console_.emergencyContainmentCore(reqOf(A.token), { scope: "others" });
    process.env.PLATFORM_CONSOLE_ENABLED = saved;
    ok("guards: console flag off → CONSOLE_DISABLED", fail(off, "CONSOLE_DISABLED"));
    ok("guards: a cross-site request → FORBIDDEN", fail(await console_.emergencyContainmentCore(reqOf(A.token, browser({ origin: "https://evil.example" })), { scope: "others" }), "FORBIDDEN"));
    ok("guards: no session token → UNAUTHORIZED", fail(await console_.emergencyContainmentCore(reqOf(null), { scope: "others" }), "UNAUTHORIZED"));
    const customer = await tenantAuth.signSessionToken({ userId: 1, orgId: 1, jti: "fictional" });
    ok("guards: a customer (tenant) token → UNAUTHORIZED", fail(await console_.emergencyContainmentCore(reqOf(customer), { scope: "others" }), "UNAUTHORIZED"));
    ok("guards: a contained (revoked) session cannot use it → UNAUTHORIZED", fail(await console_.emergencyContainmentCore(reqOf(B.token), { scope: "others" }), "UNAUTHORIZED"));
    ok("guards: another administrator's session id → NOT_FOUND, and it stays live", fail(await console_.emergencyContainmentCore(reqOf(A.token), { scope: "session", sessionId: X.id }), "NOT_FOUND") && (await alive(X.token)));
    ok("guards: a malformed id → VALIDATION_FAILED", fail(await console_.emergencyContainmentCore(reqOf(A.token), { scope: "session", sessionId: "1; drop table" }), "VALIDATION_FAILED"));
    ok("guards: no refused attempt revoked anything or logged an unaudited revocation", incidentsSince(guardsInc).every((i) => i.type !== "unaudited_session_revocation"));

    const out = await console_.signOutCore(reqOf(A.token));
    ok("sign-out of the current session (fail-safe) → ok, audited: false", out.ok && out.audited === false);
    ok("…the session is refused (never left usable) and an incident names it", !(await alive(A.token)) && incidentsSince(inc0).some((i) => i.type === "unaudited_session_revocation" && i.action === "session.logout"));
    ok("no audit row was written by any containment (and none was faked)", (await auditCount()) === audits0);
    ok("every containment result says audited: false — none claims an audit record", [e1, e2, out].every((r) => r.ok && r.audited === false));
  }

  section("3. Recovery: unaudited revocations are recorded late — once, labelled as such");
  {
    await auditOutage(false);
    const lateTargets = [A, B, C, D, G];
    ok("before reconciliation, the contained sessions have no revocation audit row", (await Promise.all(lateTargets.map((s) => revocationRows(s.id)))).every((rows) => rows.length === 0));
    const recorded = await session.reconcileUnauditedRevocations();
    ok("reconciliation records the five contained revocations", recorded === 5, String(recorded));
    const late = await Promise.all(lateTargets.map((s) => auditFor(s.id)));
    ok("each has exactly one session.revocation_recorded_late row, by 'system', with recordedLate: true and the original reason",
      late.every((rows) => rows.filter((r) => r.action === "session.revocation_recorded_late").length === 1 && rows.some((r) => r.action === "session.revocation_recorded_late" && r.actor === "system" && (r.after as { recordedLate?: boolean }).recordedLate === true && typeof (r.after as { revokedReason?: string }).revokedReason === "string")));
    ok("running it again records nothing (idempotent)", (await session.reconcileUnauditedRevocations()) === 0);
    ok("the late record never pretends to be the original event (no session.revoked / logout row was invented)", late.every((rows) => rows.every((r) => r.action === "session.revocation_recorded_late" || !(session.SESSION_REVOCATION_ACTIONS as readonly string[]).includes(r.action))));

    // Automatic: the next successful audited change records any outstanding unaudited revocation.
    const K = await signIn(owner);
    const L = await signIn(owner);
    const M = await signIn(owner);
    await auditOutage(true);
    const ek = await console_.emergencyContainmentCore(reqOf(L.token), { scope: "session", sessionId: K.id });
    await auditOutage(false);
    ok("contained K during a second outage", ek.ok && ek.audited === false && (await revocationRows(K.id)).length === 0);
    const normal = await console_.revokeSessionCore(reqOf(L.token), M.id);
    ok("the next successful audited change (revoking M) also records K late, automatically", normal.ok && (await revocationRows(M.id)).some((r) => r.action === "session.revoked") && (await revocationRows(K.id)).filter((r) => r.action === "session.revocation_recorded_late").length === 1);

    // Concurrent reconcilers never record the same revocation twice.
    const batch = await signInMany(owner, 6);
    await auditOutage(true);
    const eb = await console_.emergencyContainmentCore(reqOf(L.token), { scope: "others" });
    await auditOutage(false);
    const runs = await Promise.all(Array.from({ length: 5 }, () => session.reconcileUnauditedRevocations()));
    const perSession = await Promise.all(batch.map((s) => revocationRows(s.id)));
    ok(`5 concurrent reconcilers: ${runs.reduce((a, b) => a + b, 0)} recorded in total for ${eb.ok ? eb.count : 0} contained sessions, each exactly once`, eb.ok && runs.reduce((a, b) => a + b, 0) === eb.count && perSession.every((rows) => rows.length === 1));

    // Exactly once does not depend on timing: reconcilers are serialised by a transaction-scoped advisory lock, so none
    // can act on a snapshot taken before another one committed. Holding that lock from another connection proves it.
    const parked = await signIn(owner);
    await auditOutage(true);
    const ep = await console_.emergencyContainmentCore(reqOf(L.token), { scope: "session", sessionId: parked.id });
    await auditOutage(false);
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [session.RECONCILE_LOCK_NAME]);
      const whileHeld = await session.reconcileUnauditedRevocations();
      ok("while another reconciler holds the lock, a reconciler returns at once and records nothing", ep.ok && ep.audited === false && whileHeld === 0 && (await revocationRows(parked.id)).length === 0, String(whileHeld));
      await holder.query("commit");
    } finally {
      holder.release();
    }
    const afterRelease = await session.reconcileUnauditedRevocations();
    ok("…once it is released, the next one records the pending revocation exactly once", afterRelease === 1 && (await revocationRows(parked.id)).length === 1, String(afterRelease));
    await console_.signOutCore(reqOf(L.token));
  }

  section("4. Concurrent revocations are safe and idempotent");
  {
    const P = await signIn(owner);
    const Q = await signIn(owner);
    const race = await Promise.all(Array.from({ length: 8 }, () => console_.revokeSessionCore(reqOf(P.token), Q.id)));
    ok("8 concurrent revocations of one session → exactly 1 ok, 7 NOT_FOUND", race.filter((r) => r.ok).length === 1 && race.filter((r) => fail(r, "NOT_FOUND")).length === 7);
    ok("…exactly one session.revoked audit row for it", (await revocationRows(Q.id)).length === 1);

    const others = await signInMany(owner, 5);
    const bulk = await Promise.all(Array.from({ length: 4 }, () => console_.signOutOtherSessionsCore(reqOf(P.token))));
    const total = bulk.reduce((n, r) => n + (r.ok ? r.count : 0), 0);
    ok("4 concurrent sign-out-others over 5 sessions → 5 revoked in total, each audited exactly once", bulk.every((r) => r.ok) && total === 5 && (await Promise.all(others.map((s) => revocationRows(s.id)))).every((rows) => rows.length === 1));

    const under = await signInMany(owner, 4);
    await auditOutage(true);
    const failing = await Promise.all(Array.from({ length: 6 }, () => console_.revokeSessionCore(reqOf(P.token), under[0].id)));
    ok("during an outage, 6 concurrent normal revocations all report AUDIT_UNAVAILABLE and the session stays live", failing.every((r) => fail(r, "AUDIT_UNAVAILABLE")) && (await alive(under[0].token)));
    const mixed = await Promise.all([
      console_.revokeSessionCore(reqOf(P.token), under[1].id),
      console_.emergencyContainmentCore(reqOf(P.token), { scope: "session", sessionId: under[1].id }),
      console_.emergencyContainmentCore(reqOf(P.token), { scope: "session", sessionId: under[1].id }),
    ]);
    const contained = mixed.filter((r) => r.ok && "audited" in r && r.audited === false).length;
    ok("normal + two emergency revocations of one session during an outage → it is contained exactly once", contained === 1 && !(await alive(under[1].token)));
    const emOthers = await Promise.all(Array.from({ length: 3 }, () => console_.emergencyContainmentCore(reqOf(P.token), { scope: "others" })));
    const emTotal = emOthers.reduce((n, r) => n + (r.ok ? r.count : 0), 0);
    ok(`3 concurrent emergency sign-out-others → the 3 live sessions contained exactly once in total (${emTotal})`, emOthers.every((r) => r.ok) && emTotal === 3 && !(await alive(under[0].token)) && !(await alive(under[2].token)) && !(await alive(under[3].token)) && (await alive(P.token)));
    await auditOutage(false);
    await session.reconcileUnauditedRevocations();
    ok("after recovery each contained session has exactly one revocation record", (await Promise.all(under.map((s) => revocationRows(s.id)))).every((rows) => rows.length === 1));

    const R = await signIn(owner);
    advance(31 * MIN);
    const exp = await Promise.all(Array.from({ length: 6 }, () => guards.authorizePlatformToken(R.token).then(() => "valid", (e) => (isPlatformError(e) ? e.code : "error"))));
    ok("6 concurrent requests on an idle-expired session → all SESSION_EXPIRED, exactly one session.idle_timeout record", exp.every((c) => c === "SESSION_EXPIRED") && (await revocationRows(R.id)).filter((r) => r.action === "session.idle_timeout").length === 1);
    await console_.signOutCore(reqOf(P.token));
  }

  section("5. Revoked sessions cannot regain access");
  {
    const S = await signIn(owner);
    const T = await signIn(owner);
    ok("normally revoked", (await console_.revokeSessionCore(reqOf(S.token), T.id)).ok);
    const before = (await rowOf(T.id)).revokedAt?.getTime();
    for (let i = 0; i < 3; i++) await guards.authorizePlatformToken(T.token).catch(() => undefined);
    ok("repeated use is refused and never touches the row (revoked_at and last_seen unchanged)", !(await alive(T.token)) && (await rowOf(T.id)).revokedAt?.getTime() === before);
    ok("revoking it again changes nothing (NOT_FOUND)", fail(await console_.revokeSessionCore(reqOf(S.token), T.id), "NOT_FOUND") && (await rowOf(T.id)).revokedAt?.getTime() === before);
    await rejects("the page data refuses it", () => console_.securityOverviewCore(reqOf(T.token)), (e) => isPlatformError(e, "UNAUTHORIZED"));
    ok("it is no longer listed among active sessions", !(await session.listActivePlatformSessions(owner.id)).some((r) => r.id === T.id));
    ok("an emergency-contained session (B) is refused too, and stays revoked after recovery", !(await alive(B.token)) && (await rowOf(B.id)).revokedAt !== null);
    const U = await signIn(owner);
    ok("signing in again creates a NEW session; the old token stays dead", U.id !== T.id && !(await alive(T.token)) && (await alive(U.token)));
    await console_.signOutCore(reqOf(S.token));
    await console_.signOutCore(reqOf(U.token));
  }

  section("6. Session expiry stays correct, with or without the audit trail");
  {
    const V = await signIn(owner);
    advance(30 * MIN);
    ok("exactly 30 min idle → still valid (and touched)", await alive(V.token));
    advance(30 * MIN + 1);
    await auditOutage(true);
    const inc0 = incidents.length;
    await rejects("30 min + 1 ms idle during an outage → SESSION_EXPIRED anyway", () => guards.authorizePlatformToken(V.token), (e) => isPlatformError(e, "SESSION_EXPIRED"));
    ok("…the expiry could not be recorded: the row is NOT revoked (no unaudited revocation), an incident says so", (await rowOf(V.id)).revokedAt === null && incidentsSince(inc0).some((i) => i.type === "audit_write_failed" && i.action === "session.idle_timeout" && JSON.stringify(i.sessionIds) === JSON.stringify([V.id])));
    ok("…and the idle session is not listed as active", !(await session.listActivePlatformSessions(owner.id)).some((r) => r.id === V.id));
    await rejects("…still refused on every later request during the outage", () => guards.authorizePlatformToken(V.token), (e) => isPlatformError(e, "SESSION_EXPIRED"));
    await auditOutage(false);
    await rejects("after recovery the next request is refused again", () => guards.authorizePlatformToken(V.token), (e) => isPlatformError(e, "SESSION_EXPIRED"));
    ok("…and now the revocation and its single session.idle_timeout record are written together", (await rowOf(V.id)).revokedReason === "idle_timeout" && (await revocationRows(V.id)).filter((r) => r.action === "session.idle_timeout").length === 1);

    const W = await signIn(owner);
    for (let i = 0; i < 24; i++) {
      advance(29 * MIN);
      await guards.authorizePlatformToken(W.token);
    }
    await auditOutage(true);
    advance(29 * MIN); // past the 12 h absolute limit while always active
    // The token's own exp equals the row's 12 h limit, so the token check refuses it first (UNAUTHORIZED);
    // a row whose limit came earlier is refused by the row check (SESSION_EXPIRED). Either way: refused.
    const ended = (e: unknown) => isPlatformError(e, "SESSION_EXPIRED") || isPlatformError(e, "UNAUTHORIZED");
    await rejects("an always-active session ends at 12 h even during an outage", () => guards.authorizePlatformToken(W.token), ended);
    await auditOutage(false);
    await rejects("…and after recovery", () => guards.authorizePlatformToken(W.token), ended);
    const wRow = await rowOf(W.id);
    const wRec = await revocationRows(W.id);
    ok("…never revoked without its record (untouched, or revoked together with one session.expired row) and not listed as active",
      ((wRow.revokedAt === null && wRec.length === 0) || (wRow.revokedReason === "expired" && wRec.filter((r) => r.action === "session.expired").length === 1)) &&
        !(await session.listActivePlatformSessions(owner.id)).some((r) => r.id === W.id));
    // A row whose absolute limit precedes its token's (e.g. shortened server-side) takes the row path: revoked + audited, atomically.
    const Y = await signIn(owner);
    await db.update(platformSessionsTable).set({ expiresAt: new Date(nowMs + 60_000) }).where(eq(platformSessionsTable.id, Y.id));
    advance(2 * MIN);
    await auditOutage(true);
    await rejects("a row-level absolute expiry during an outage → SESSION_EXPIRED, nothing written", () => guards.authorizePlatformToken(Y.token), (e) => isPlatformError(e, "SESSION_EXPIRED"));
    ok("…the row is not revoked (no unaudited revocation)", (await rowOf(Y.id)).revokedAt === null);
    await auditOutage(false);
    await rejects("…after recovery → SESSION_EXPIRED again", () => guards.authorizePlatformToken(Y.token), (e) => isPlatformError(e, "SESSION_EXPIRED"));
    ok("…now revoked as expired together with exactly one session.expired record", (await rowOf(Y.id)).revokedReason === "expired" && (await revocationRows(Y.id)).filter((r) => r.action === "session.expired").length === 1);
  }

  section("7. The tenant ERP's sessions and authentication are untouched");
  {
    ok("the tenant session row is byte-for-byte what it was before every outage, containment and reconciliation", (await tenantSnapshot()) === tenantBefore);
    ok("the tenant session is still valid by the tenant's own check (session-store.isSessionValid)", await tenantSessions.isSessionValid(tenantJti));
    ok("the tenant token still verifies with the tenant verifier", (await tenantAuth.verifySessionToken(tenantToken))?.userId === user.id);
    await auditOutage(true);
    ok("a platform audit outage does not affect tenant session validation", await tenantSessions.isSessionValid(tenantJti));
    await auditOutage(false);
    await tenantSessions.revokeCurrentSession(tenantJti);
    ok("tenant revocation still works on its own (independent of the platform)", !(await tenantSessions.isSessionValid(tenantJti)));
    const touched = execFileSync("git", ["diff", "--name-only", "621f156f7b129b9c2e289bc46d314ce7587beec2", "--", "src/lib/session.ts", "src/lib/auth.ts", "src/lib/security", "src/app/(auth)", "src/app/auth", "src/app/(app)", "src/components/layout", "src/components/ui"], { encoding: "utf8" }).trim();
    ok("no tenant session, authentication, app-route, layout or UI-component file differs from the live ERP (621f156)", touched === "", touched);
    const proxyDiff = execFileSync("git", ["diff", "621f156f7b129b9c2e289bc46d314ce7587beec2", "--", "src/proxy.ts"], { encoding: "utf8" });
    const changed = proxyDiff.split("\n").filter((l) => /^[+-](?![+-])/.test(l));
    ok("src/proxy.ts differs from the live ERP only by the PO-01B edge-gate import and /platform delegation (2 code lines plus a comment, nothing removed)", changed.every((l) => l.startsWith("+")) && changed.filter((l) => !/^\+\s*\/\//.test(l)).length === 2, changed.join(" | "));
  }

  section("8. Nothing sensitive leaks");
  {
    const ALLOWED = ["incidentId", "at", "type", "action", "actorAdminId", "sessionIds", "count", "requestId", "ip", "error"];
    ok(`${incidents.length} incident lines: only the allow-listed fields`, incidents.length >= 10 && incidents.every((i) => Object.keys(i).every((k) => ALLOWED.includes(k))));
    const text = errorLines.join("\n");
    const leaked = secretsSeen.filter((s) => s && s.length >= 6 && text.includes(s));
    ok(`the server error stream contains no password, TOTP secret, recovery code, token, jti or e-mail (${secretsSeen.length} values checked)`, leaked.length === 0);
    ok("…no database error text (the injected exception message never surfaces)", !/injected audit outage|raise exception|platform_audit_events/.test(text));
    ok("…and no user agent", !/verify-platform-containment/.test(text));
    const auditText = JSON.stringify(await db.select().from(platformAuditEventsTable));
    ok("audit rows contain no secret either", !secretsSeen.filter((s) => !s.includes("@")).some((s) => s.length >= 6 && auditText.includes(s)));
  }
}

let exitCode = 1;
let created = false;
try {
  await createPlatformTestDatabase("po01b1_containment", testDbName);
  created = true;
  await main();
  console.error = realConsoleError;
  exitCode = summary("verify:platform-containment");
} catch (e) {
  console.error = realConsoleError;
  console.error(`verify:platform-containment aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  console.error = realConsoleError;
  await auditOutage(false).catch(() => undefined);
  await pool.end().catch(() => undefined);
  if (created && process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
