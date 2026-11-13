/**
 * Platform Owner PO-01A — authentication, MFA, sessions, throttling, timing and audit suite.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-auth
 *
 * Runs against one freshly created disposable database (dropped at the end). All accounts are
 * fictional; every secret is generated in memory for this run and never printed.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { SignJWT, decodeJwt, decodeProtectedHeader } from "jose";
import { createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, rejects, summary, describeError, sqlState } from "./platform/harness";

// The name is generated first and modules are loaded before the database exists: the app pool
// connects lazily, so a failing import leaves no database behind.
const testDbName = disposableName("po01a_auth");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PLATFORM_CONSOLE_ENABLED = "true";

const { db, pool, platformAdminsTable, platformSessionsTable, platformAuditEventsTable } = await import("../src/db");
const { eq, sql } = await import("drizzle-orm");
const auth = await import("../src/lib/platform/auth");
const config = await import("../src/lib/platform/config");
const { platformClock } = await import("../src/lib/platform/clock");
const { isPlatformError } = await import("../src/lib/platform/errors");
const flags = await import("../src/lib/platform/flags");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const session = await import("../src/lib/platform/session");
const { platformLogin } = await import("../src/lib/platform/login");
const audit = await import("../src/lib/platform/audit");
const guards = await import("../src/lib/platform/guards");
const tenantAuth = await import("../src/lib/auth");
const sharedTotp = await import("../src/lib/security/totp");

// ---- deterministic platform clock -------------------------------------------------------------
const MIN = 60_000;
let nowMs = Date.parse("2026-11-13T08:00:00.000Z");
platformClock.now = () => new Date(nowMs);
const advance = (ms: number) => {
  nowMs += ms;
};

const is = (code: Parameters<typeof isPlatformError>[1]) => (e: unknown) => isPlatformError(e, code);
const key = () => config.platformSigningKey();
const codeAt = (secret: string, offsetSteps = 0) => totp.hotpCode(secret, totp.totpStepAt(new Date(nowMs)) + offsetSteps);
const STRONG = "Quartz-Harbor-71!x";
const secretsSeen: string[] = [STRONG];

type Fixture = { id: string; email: string; password: string; secret: string; codes: string[] };
async function createAdmin(email: string, password = STRONG, active = true): Promise<Fixture> {
  const { secret } = mfa.createTotpEnrollment(email);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date(nowMs);
  const [row] = await db
    .insert(platformAdminsTable)
    .values({
      emailNormalized: email,
      displayName: `Fictional ${email.split("@")[0]}`,
      passwordHash: await auth.hashPlatformPassword(password),
      isActive: active,
      mfaSecretEncrypted: mfa.encryptTotpSecret(secret),
      mfaRecoveryHashes: hashes,
      mfaEnrolledAt: at,
      passwordChangedAt: at,
      createdAt: at,
      updatedAt: at,
    })
    .returning({ id: platformAdminsTable.id });
  secretsSeen.push(password, secret, ...codes);
  return { id: row.id, email, password, secret, codes };
}

const loginOk = async (f: Fixture, ip: string, extra: { totpCode?: string; recoveryCode?: string } = {}) => {
  const result = await platformLogin({ email: f.email, password: f.password, totpCode: extra.recoveryCode ? undefined : (extra.totpCode ?? codeAt(f.secret)), recoveryCode: extra.recoveryCode, ipAddress: ip, userAgent: "verify-platform-auth" });
  secretsSeen.push(result.token, decodeJwt(result.token).jti as string);
  return result;
};
const countSessions = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(platformSessionsTable))[0].n;

async function main() {
  const owner = await createAdmin("owner@platform.test");

  section("0. Configuration and feature flag fail closed");
  {
    const saved = { secret: process.env.PLATFORM_AUTH_SECRET, flag: process.env.PLATFORM_CONSOLE_ENABLED, enc: process.env.FIELD_ENCRYPTION_KEYS };
    for (const value of [undefined, "", "TRUE", "1", "yes"]) {
      if (value === undefined) delete process.env.PLATFORM_CONSOLE_ENABLED;
      else process.env.PLATFORM_CONSOLE_ENABLED = value;
      ok(`flag ${JSON.stringify(value ?? null)} → console disabled`, !flags.isPlatformConsoleEnabled());
    }
    delete process.env.PLATFORM_CONSOLE_ENABLED;
    await rejects("login refused while the flag is unset (default off)", () => platformLogin({ email: owner.email, password: owner.password, totpCode: codeAt(owner.secret) }), is("CONSOLE_DISABLED"));
    process.env.PLATFORM_CONSOLE_ENABLED = saved.flag;
    delete process.env.PLATFORM_AUTH_SECRET;
    await rejects("missing PLATFORM_AUTH_SECRET → CONFIG_ERROR", async () => config.platformSigningKey(), is("CONFIG_ERROR"));
    process.env.PLATFORM_AUTH_SECRET = "x".repeat(31);
    await rejects("31-byte PLATFORM_AUTH_SECRET → CONFIG_ERROR", async () => config.platformSigningKey(), is("CONFIG_ERROR"));
    process.env.PLATFORM_AUTH_SECRET = process.env.AUTH_SECRET;
    await rejects("PLATFORM_AUTH_SECRET equal to customer AUTH_SECRET → CONFIG_ERROR", async () => config.platformSigningKey(), is("CONFIG_ERROR"));
    process.env.PLATFORM_AUTH_SECRET = saved.secret;
    delete process.env.FIELD_ENCRYPTION_KEYS;
    await rejects("missing field encryption → CONFIG_ERROR (TOTP secrets must be encrypted)", async () => config.assertPlatformConfiguration(), is("CONFIG_ERROR"));
    process.env.FIELD_ENCRYPTION_KEYS = saved.enc;
    ok("platform cookie is distinct from the customer cookie", String(config.PLATFORM_SESSION_COOKIE) !== String(tenantAuth.SESSION_COOKIE) && !config.PLATFORM_SESSION_COOKIE.includes("session"));
    const opts = config.platformSessionCookieOptions(new Date(nowMs));
    ok("cookie options: HttpOnly, SameSite=Lax, Path=/, no Domain", opts.httpOnly && opts.sameSite === "lax" && opts.path === "/" && !("domain" in opts));
  }

  section("1. Platform token creation and strict claim verification");
  {
    const jti = auth.newSessionJti();
    const issuedAt = new Date(nowMs);
    const expiresAt = new Date(nowMs + config.PLATFORM_SESSION_POLICY.absoluteMs);
    const token = await auth.signPlatformToken({ adminId: owner.id, jti, issuedAt, expiresAt });
    const header = decodeProtectedHeader(token);
    const payload = decodeJwt(token);
    ok("header alg HS256 + typ platform+jwt", header.alg === "HS256" && header.typ === "platform+jwt");
    ok("claims iss/aud/sub/jti/typ", payload.iss === "elite-erp" && payload.aud === "elite-erp-platform" && payload.sub === owner.id && payload.jti === jti && payload.typ === "platform");
    ok("lifetime is exactly the 12 h policy", (payload.exp as number) - (payload.iat as number) === 12 * 3600);
    const claims = await auth.verifyPlatformToken(token);
    ok("verifyPlatformToken round-trips adminId and jti", claims.adminId === owner.id && claims.jti === jti);
    await rejects("signing refuses lifetimes above 12 h", () => auth.signPlatformToken({ adminId: owner.id, jti, issuedAt, expiresAt: new Date(expiresAt.getTime() + 1000) }), is("CONFIG_ERROR"));
    await rejects("signing refuses a non-UUID subject", () => auth.signPlatformToken({ adminId: "42", jti, issuedAt, expiresAt }), is("CONFIG_ERROR"));
    const [h, p, s] = token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, sub: "00000000-0000-4000-8000-000000000001" })).toString("base64url");
    await rejects("tampered payload rejected", () => auth.verifyPlatformToken(`${h}.${tamperedPayload}.${s}`), is("UNAUTHORIZED"));
    await rejects("signature from another secret rejected", async () => {
      const other = await new SignJWT({ typ: "platform" }).setProtectedHeader({ alg: "HS256", typ: "platform+jwt" }).setIssuer("elite-erp").setAudience("elite-erp-platform").setSubject(owner.id).setJti(jti).setIssuedAt(issuedAt).setExpirationTime(expiresAt).sign(new TextEncoder().encode(randomBytes(48).toString("hex")));
      return auth.verifyPlatformToken(other);
    }, is("UNAUTHORIZED"));
    await rejects("unsigned alg:none token rejected", () => auth.verifyPlatformToken(`${Buffer.from(JSON.stringify({ alg: "none", typ: "platform+jwt" })).toString("base64url")}.${p}.`), is("UNAUTHORIZED"));
    await rejects("HS512 token (not allow-listed) rejected", async () => {
      const t = await new SignJWT({ typ: "platform" }).setProtectedHeader({ alg: "HS512", typ: "platform+jwt" }).setIssuer("elite-erp").setAudience("elite-erp-platform").setSubject(owner.id).setJti(jti).setIssuedAt(issuedAt).setExpirationTime(expiresAt).sign(key());
      return auth.verifyPlatformToken(t);
    }, is("UNAUTHORIZED"));
    await rejects("token issued in the future rejected", async () => {
      const t = await new SignJWT({ typ: "platform" }).setProtectedHeader({ alg: "HS256", typ: "platform+jwt" }).setIssuer("elite-erp").setAudience("elite-erp-platform").setSubject(owner.id).setJti(jti).setIssuedAt(Math.floor(nowMs / 1000) + 600).setExpirationTime(Math.floor(nowMs / 1000) + 3600).sign(key());
      return auth.verifyPlatformToken(t);
    }, is("UNAUTHORIZED"));
    await rejects("over-long lifetime claim (13 h) rejected", async () => {
      const t = await new SignJWT({ typ: "platform" }).setProtectedHeader({ alg: "HS256", typ: "platform+jwt" }).setIssuer("elite-erp").setAudience("elite-erp-platform").setSubject(owner.id).setJti(jti).setIssuedAt(Math.floor(nowMs / 1000)).setExpirationTime(Math.floor(nowMs / 1000) + 13 * 3600).sign(key());
      return auth.verifyPlatformToken(t);
    }, is("UNAUTHORIZED"));
    const saved = nowMs;
    nowMs = expiresAt.getTime() + 1000;
    await rejects("expired token rejected", () => auth.verifyPlatformToken(token), is("UNAUTHORIZED"));
    nowMs = saved;
  }

  section("2. Customer ERP tokens are never accepted (and vice versa)");
  {
    const customer = await tenantAuth.signSessionToken({ userId: 1, orgId: 1, jti: "fictional-customer-jti" });
    await rejects("customer JWT (customer secret) rejected by verifyPlatformToken", () => auth.verifyPlatformToken(customer), is("UNAUTHORIZED"));
    await rejects("customer JWT rejected by validatePlatformSession", () => session.validatePlatformSession(customer), is("UNAUTHORIZED"));
    await rejects("customer JWT rejected by the platform guard", () => guards.authorizePlatformToken(customer), is("UNAUTHORIZED"));
    await rejects("customer-shaped claims signed with the PLATFORM secret rejected", async () => {
      const t = await new SignJWT({ userId: 1, orgId: 1 }).setProtectedHeader({ alg: "HS256" }).setJti(auth.newSessionJti()).setIssuedAt(Math.floor(nowMs / 1000)).setExpirationTime("1h").sign(key());
      return auth.verifyPlatformToken(t);
    }, is("UNAUTHORIZED"));
    await rejects("platform-typed token smuggling userId/orgId rejected", async () => {
      const t = await new SignJWT({ typ: "platform", userId: 1, orgId: 1 }).setProtectedHeader({ alg: "HS256", typ: "platform+jwt" }).setIssuer("elite-erp").setAudience("elite-erp-platform").setSubject(owner.id).setJti(auth.newSessionJti()).setIssuedAt(Math.floor(nowMs / 1000)).setExpirationTime(Math.floor(nowMs / 1000) + 3600).sign(key());
      return auth.verifyPlatformToken(t);
    }, is("UNAUTHORIZED"));
    const platformToken = await auth.signPlatformToken({ adminId: owner.id, jti: auth.newSessionJti(), issuedAt: new Date(nowMs), expiresAt: new Date(nowMs + 3600_000) });
    ok("platform JWT is rejected by the customer verifySessionToken", (await tenantAuth.verifySessionToken(platformToken)) === null);
  }

  section("3. Wrong audience, issuer and token type rejected");
  for (const [name, mutate] of [
    ["wrong audience", (b: SignJWT) => b.setAudience("elite-erp")],
    ["wrong issuer", (b: SignJWT) => b.setIssuer("someone-else")],
    ["wrong header typ (JWT)", (b: SignJWT) => b.setProtectedHeader({ alg: "HS256", typ: "JWT" })],
    ["missing header typ", (b: SignJWT) => b.setProtectedHeader({ alg: "HS256" })],
  ] as const) {
    await rejects(`${name} rejected`, async () => {
      const b = new SignJWT({ typ: "platform" }).setProtectedHeader({ alg: "HS256", typ: "platform+jwt" }).setIssuer("elite-erp").setAudience("elite-erp-platform").setSubject(owner.id).setJti(auth.newSessionJti()).setIssuedAt(Math.floor(nowMs / 1000)).setExpirationTime(Math.floor(nowMs / 1000) + 3600);
      return auth.verifyPlatformToken(await mutate(b).sign(key()));
    }, is("UNAUTHORIZED"));
  }
  await rejects("wrong payload typ (customer) rejected", async () => {
    const t = await new SignJWT({ typ: "customer" }).setProtectedHeader({ alg: "HS256", typ: "platform+jwt" }).setIssuer("elite-erp").setAudience("elite-erp-platform").setSubject(owner.id).setJti(auth.newSessionJti()).setIssuedAt(Math.floor(nowMs / 1000)).setExpirationTime(Math.floor(nowMs / 1000) + 3600).sign(key());
    return auth.verifyPlatformToken(t);
  }, is("UNAUTHORIZED"));
  await rejects("missing jti rejected", async () => {
    const t = await new SignJWT({ typ: "platform" }).setProtectedHeader({ alg: "HS256", typ: "platform+jwt" }).setIssuer("elite-erp").setAudience("elite-erp-platform").setSubject(owner.id).setIssuedAt(Math.floor(nowMs / 1000)).setExpirationTime(Math.floor(nowMs / 1000) + 3600).sign(key());
    return auth.verifyPlatformToken(t);
  }, is("UNAUTHORIZED"));

  section("4. MFA is mandatory for every Platform Owner session");
  {
    const before = await countSessions();
    await rejects("correct password without a code → MFA_REQUIRED", () => platformLogin({ email: owner.email, password: owner.password, ipAddress: "203.0.113.10" }), is("MFA_REQUIRED"));
    await rejects("correct password + wrong TOTP → MFA_INVALID", () => platformLogin({ email: owner.email, password: owner.password, totpCode: "000000", ipAddress: "203.0.113.10" }), is("MFA_INVALID"));
    ok("no session row exists after password-only attempts", (await countSessions()) === before);
    const r = await loginOk(owner, "203.0.113.10");
    const [row] = await db.select().from(platformSessionsTable).where(eq(platformSessionsTable.id, r.sessionId));
    ok("password + valid TOTP → session with mfa_verified_at", r.status === "authenticated" && r.method === "totp" && row?.mfaVerifiedAt instanceof Date);
    const ctx = await guards.authorizePlatformToken(r.token);
    ok("platform guard accepts the MFA-verified session", ctx.adminId === owner.id && ctx.sessionId === r.sessionId);
    await rejects("guard refuses a permission outside the allowlist", () => guards.authorizePlatformToken(r.token, "tenant.data.read" as never), is("FORBIDDEN"));
    await rejects("DB refuses a session row without MFA verification", () => db.execute(sql`insert into platform_sessions (platform_admin_id, token_hash, mfa_verified_at, expires_at) values (${owner.id}, ${"9".repeat(64)}, null, now() + interval '1 hour')`), (e) => sqlState(e) === "23502" || sqlState((e as { cause?: unknown }).cause) === "23502");
    const inactive = await createAdmin("inactive@platform.test", STRONG, false);
    await rejects("inactive admin with correct password → generic INVALID_CREDENTIALS", () => platformLogin({ email: inactive.email, password: inactive.password, totpCode: codeAt(inactive.secret), ipAddress: "203.0.113.11" }), is("INVALID_CREDENTIALS"));
  }

  section("5. TOTP replay prevention");
  {
    advance(31 * MIN);
    const replayer = await createAdmin("replay@platform.test");
    const code = codeAt(replayer.secret);
    const first = await loginOk(replayer, "203.0.113.20", { totpCode: code });
    ok("fresh code accepted once", first.status === "authenticated");
    await rejects("the same code is rejected on re-use (replay)", () => platformLogin({ email: replayer.email, password: replayer.password, totpCode: code, ipAddress: "203.0.113.20" }), is("MFA_INVALID"));
    await rejects("an older in-window code is rejected after a newer step was used", () => platformLogin({ email: replayer.email, password: replayer.password, totpCode: codeAt(replayer.secret, -1), ipAddress: "203.0.113.20" }), is("MFA_INVALID"));
    const [replayAudit] = await db.select({ n: sql<number>`count(*)::int` }).from(platformAuditEventsTable).where(eq(platformAuditEventsTable.action, "auth.mfa.replay_rejected"));
    ok("replays are audited as auth.mfa.replay_rejected", replayAudit.n >= 2, String(replayAudit.n));
    advance(30_000);
    const next = await loginOk(replayer, "203.0.113.20");
    ok("the next time step's code is accepted", next.status === "authenticated");
    advance(30_000);
    const racer = codeAt(replayer.secret);
    const race = await Promise.allSettled([1, 2].map(() => platformLogin({ email: replayer.email, password: replayer.password, totpCode: racer, ipAddress: "203.0.113.21" })));
    ok("two concurrent logins with one code: exactly one succeeds", race.filter((r) => r.status === "fulfilled").length === 1 && race.filter((r) => r.status === "rejected" && isPlatformError(r.reason, "MFA_INVALID")).length === 1);
    for (const r of race) if (r.status === "fulfilled") secretsSeen.push(r.value.token);
    ok("platform TOTP core agrees with the shared customer verifier (real clock)", sharedTotp.verifyTotp(replayer.secret, totp.hotpCode(replayer.secret, totp.totpStepAt(new Date()))));
    ok("platform TOTP core rejects malformed codes", totp.matchTotpStep(replayer.secret, "12a456", new Date(nowMs)) === null && totp.matchTotpStep(replayer.secret, "1234567", new Date(nowMs)) === null);
  }

  section("6. Recovery codes are hashed and single-use; TOTP secrets are encrypted");
  {
    const rc = await createAdmin("recovery@platform.test");
    const [stored] = await db.select().from(platformAdminsTable).where(eq(platformAdminsTable.id, rc.id));
    const hashes = stored.mfaRecoveryHashes as string[];
    ok("10 recovery hashes stored, all bcrypt, none equal to a code", hashes.length === 10 && hashes.every((h) => /^\$2[aby]\$10\$/.test(h)) && !hashes.some((h) => rc.codes.includes(h)));
    ok("TOTP secret stored as an encryption envelope, not the base32 seed", /^v1:/.test(stored.mfaSecretEncrypted ?? "") && !(stored.mfaSecretEncrypted ?? "").includes(rc.secret));
    await rejects("decryptTotpSecret refuses legacy plaintext", async () => mfa.decryptTotpSecret(rc.secret), is("CONFIG_ERROR"));
    const used = await loginOk(rc, "203.0.113.30", { recoveryCode: rc.codes[0] });
    ok("recovery code logs in (method recovery_code, 9 left)", used.method === "recovery_code" && used.remainingRecoveryCodes === 9);
    await rejects("the same recovery code cannot be used twice", () => platformLogin({ email: rc.email, password: rc.password, recoveryCode: rc.codes[0], ipAddress: "203.0.113.30" }), is("MFA_INVALID"));
    const relaxed = rc.codes[1].toLowerCase().replace("-", " ");
    const second = await loginOk(rc, "203.0.113.30", { recoveryCode: relaxed });
    ok("recovery codes are normalized (case/spacing) — 8 left", second.remainingRecoveryCodes === 8);
    const race = await Promise.allSettled([1, 2].map(() => platformLogin({ email: rc.email, password: rc.password, recoveryCode: rc.codes[2], ipAddress: "203.0.113.31" })));
    ok("two concurrent uses of one recovery code: exactly one succeeds", race.filter((r) => r.status === "fulfilled").length === 1);
    for (const r of race) if (r.status === "fulfilled") secretsSeen.push(r.value.token);
    const [after] = await db.select({ h: platformAdminsTable.mfaRecoveryHashes }).from(platformAdminsTable).where(eq(platformAdminsTable.id, rc.id));
    ok("exactly 7 hashes remain after three uses", (after.h as string[]).length === 7);
    const [usedAudit] = await db.select({ n: sql<number>`count(*)::int` }).from(platformAuditEventsTable).where(eq(platformAuditEventsTable.action, "auth.recovery_code.used"));
    ok("each use is audited (auth.recovery_code.used)", usedAudit.n === 3, String(usedAudit.n));
  }

  section("7. Session revocation, logout and logout-all");
  {
    advance(2 * MIN);
    const s = await createAdmin("sessions@platform.test");
    const a = await loginOk(s, "203.0.113.40");
    advance(31_000);
    const b = await loginOk(s, "203.0.113.41");
    advance(31_000);
    const c = await loginOk(s, "203.0.113.42");
    const ctxA = await session.validatePlatformSession(a.token);
    ok("three live sessions listed (no token hashes exposed)", (await session.listActivePlatformSessions(s.id)).length === 3 && !Object.keys((await session.listActivePlatformSessions(s.id))[0]).some((k) => /hash|token/i.test(k)));
    ok("revoke one session", await session.revokePlatformSession(ctxA, b.sessionId));
    await rejects("revoked session is refused immediately", () => session.validatePlatformSession(b.token), is("UNAUTHORIZED"));
    const n = await session.revokeAllPlatformSessions(s.id, "logout_all", { exceptSessionId: ctxA.sessionId, actorLabel: "Fictional sessions" });
    ok("logout-all revokes the others and keeps the current one", n === 1 && (await session.validatePlatformSession(a.token)).sessionId === a.sessionId);
    await rejects("logout-all victim refused", () => session.validatePlatformSession(c.token), is("UNAUTHORIZED"));
    ok("logout revokes the presenting session", await session.logoutPlatformSession(a.token));
    ok("second logout is a harmless no-op", !(await session.logoutPlatformSession(a.token)));
    await rejects("logged-out token refused", () => session.validatePlatformSession(a.token), is("UNAUTHORIZED"));
    advance(31_000);
    const d = await loginOk(s, "203.0.113.43");
    await db.update(platformAdminsTable).set({ isActive: false, mfaSecretEncrypted: null, mfaEnrolledAt: null }).where(eq(platformAdminsTable.id, s.id));
    await rejects("disabling the admin invalidates a live session row", () => session.validatePlatformSession(d.token), is("UNAUTHORIZED"));
    const reasons = await db.select({ r: platformSessionsTable.revokedReason }).from(platformSessionsTable).where(eq(platformSessionsTable.platformAdminId, s.id));
    ok("revocation reasons recorded (revoked, logout_all, logout)", ["revoked", "logout_all", "logout"].every((x) => reasons.some((r) => r.r === x)));
  }

  section("8. Absolute and idle expiration (provisional 12 h / 30 min)");
  {
    advance(2 * MIN);
    const e = await createAdmin("expiry@platform.test");
    const idle = await loginOk(e, "203.0.113.50");
    advance(10 * MIN);
    await session.validatePlatformSession(idle.token);
    advance(29 * MIN);
    ok("29 min after the last activity: still valid (and touched)", (await session.validatePlatformSession(idle.token)).sessionId === idle.sessionId);
    advance(20_000);
    await session.validatePlatformSession(idle.token);
    const [t1] = await db.select({ seen: platformSessionsTable.lastSeenAt }).from(platformSessionsTable).where(eq(platformSessionsTable.id, idle.sessionId));
    ok("touches are throttled to one write per minute", nowMs - t1.seen.getTime() === 20_000, `${nowMs - t1.seen.getTime()} ms`);
    advance(30 * MIN + 1000);
    await rejects("31 min idle → SESSION_EXPIRED", () => session.validatePlatformSession(idle.token), is("SESSION_EXPIRED"));
    const [idleRow] = await db.select({ r: platformSessionsTable.revokedReason }).from(platformSessionsTable).where(eq(platformSessionsTable.id, idle.sessionId));
    ok("idle session is revoked (idle_timeout), never revivable", idleRow.r === "idle_timeout");
    await rejects("idle-expired token stays refused", () => session.validatePlatformSession(idle.token), is("UNAUTHORIZED"));

    advance(31_000);
    const abs = await loginOk(e, "203.0.113.51");
    const start = nowMs;
    let alive = true;
    while (nowMs + 25 * MIN < start + 12 * 60 * MIN) {
      advance(25 * MIN);
      alive = alive && (await session.validatePlatformSession(abs.token)).sessionId === abs.sessionId;
    }
    ok("an active session stays valid up to the 12 h absolute limit", alive);
    nowMs = start + 12 * 60 * MIN;
    await rejects("at 12 h the session is unusable even though it was active", () => session.validatePlatformSession(abs.token), (x) => isPlatformError(x, "UNAUTHORIZED") || isPlatformError(x, "SESSION_EXPIRED"));
    advance(31_000);
    const shortened = await loginOk(e, "203.0.113.52");
    await db.update(platformSessionsTable).set({ expiresAt: new Date(nowMs + 1000) }).where(eq(platformSessionsTable.id, shortened.sessionId));
    advance(2000);
    await rejects("server-side expires_at is enforced independently of the JWT exp", () => session.validatePlatformSession(shortened.token), is("SESSION_EXPIRED"));
    const [absRow] = await db.select({ r: platformSessionsTable.revokedReason }).from(platformSessionsTable).where(eq(platformSessionsTable.id, shortened.sessionId));
    ok("absolute expiry revokes the row (expired)", absRow.r === "expired");
  }

  section("9. Durable account and IP throttling");
  {
    advance(60 * MIN);
    const t = await createAdmin("throttle@platform.test");
    const ip = "203.0.113.60";
    for (let i = 1; i <= 4; i++) await rejects(`wrong password #${i} → INVALID_CREDENTIALS`, () => platformLogin({ email: t.email, password: "Wrong-Password-000!", ipAddress: ip }), is("INVALID_CREDENTIALS"));
    await rejects("wrong password #5 → INVALID_CREDENTIALS (block set)", () => platformLogin({ email: t.email, password: "Wrong-Password-000!", ipAddress: ip }), is("INVALID_CREDENTIALS"));
    await rejects("6th attempt with the CORRECT password + valid TOTP → RATE_LIMITED", () => platformLogin({ email: t.email, password: t.password, totpCode: codeAt(t.secret), ipAddress: "203.0.113.61" }), is("RATE_LIMITED"));
    const probe = spawnSync(join(process.cwd(), "node_modules", ".bin", "tsx"), ["--conditions=react-server", "verify/platform/throttle-probe.mts"], {
      cwd: process.cwd(),
      env: { ...process.env, PROBE_EMAIL: t.email, PROBE_IP: "", PROBE_NOW_MS: String(nowMs) },
      encoding: "utf8",
      timeout: 120_000,
    });
    ok("a separate process (as after a restart) sees the block — durable", probe.stdout.trim() === "BLOCKED", `${probe.status} ${probe.stdout.trim()} ${probe.stderr.trim().slice(-200)}`);
    const [blockedAudit] = await db.select({ n: sql<number>`count(*)::int` }).from(platformAuditEventsTable).where(eq(platformAuditEventsTable.action, "auth.login.blocked"));
    ok("blocked attempts are audited (auth.login.blocked)", blockedAudit.n >= 1);
    advance(15 * MIN + 1000);
    const back = await loginOk(t, ip);
    ok("after the 15 min block the correct credentials work again", back.status === "authenticated");
    await rejects("a success resets the account counter (next failure is not blocked)", () => platformLogin({ email: t.email, password: "Wrong-Password-000!", ipAddress: ip }), is("INVALID_CREDENTIALS"));
    advance(30_000);
    ok("…and the correct login still succeeds right after", (await loginOk(t, ip)).status === "authenticated");

    advance(60 * MIN);
    const sharedIp = "203.0.113.99";
    for (let i = 0; i < 20; i++) {
      await platformLogin({ email: `nobody${i}@platform.test`, password: "Wrong-Password-000!", ipAddress: sharedIp }).catch(() => undefined);
    }
    await rejects("20 failures from one IP block that IP for every account", () => platformLogin({ email: t.email, password: t.password, totpCode: codeAt(t.secret), ipAddress: sharedIp }), is("RATE_LIMITED"));
    advance(30_000);
    ok("the same account from another IP is unaffected", (await loginOk(t, "203.0.113.98")).status === "authenticated");

    const daily = await createAdmin("daily@platform.test");
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 4; i++) await platformLogin({ email: daily.email, password: "Wrong-Password-000!", ipAddress: `198.51.100.${round * 4 + i + 1}` }).catch(() => undefined);
      advance(16 * MIN);
    }
    await rejects("20 failures within 24 h (paced under the 15 min tier) → 24 h block", () => platformLogin({ email: daily.email, password: daily.password, totpCode: codeAt(daily.secret), ipAddress: "198.51.100.200" }), is("RATE_LIMITED"));
    const raw = await db.execute(sql`select string_agg(coalesce(email_hash, '') || ' ' || coalesce(ip_hash, ''), ' ') as s from platform_login_attempts`);
    const stored = String((raw.rows[0] as { s: string }).s);
    ok("no plaintext e-mail or IP is stored in platform_login_attempts", !stored.includes("@") && !stored.includes("203.0.113") && !stored.includes("198.51.100"));
  }

  section("10. Authentication timing protections");
  {
    advance(25 * 60 * MIN);
    const timing = await createAdmin("timing@platform.test");
    await createAdmin("timing-inactive@platform.test", STRONG, false);
    const sample = async (email: string, ip: string) => {
      advance(16 * MIN);
      const t0 = performance.now();
      let code = "";
      try {
        await platformLogin({ email, password: "Wrong-Password-000!", ipAddress: ip });
      } catch (e) {
        code = isPlatformError(e) ? `${e.code}|${e.message}` : "other";
      }
      return { ms: performance.now() - t0, code };
    };
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const known: number[] = [];
    const unknown: number[] = [];
    const inactive: number[] = [];
    const codes = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const k = await sample(timing.email, `192.0.2.${10 + i}`);
      const u = await sample(`ghost${i}@platform.test`, `192.0.2.${30 + i}`);
      const n = await sample("timing-inactive@platform.test", `192.0.2.${50 + i}`);
      known.push(k.ms);
      unknown.push(u.ms);
      inactive.push(n.ms);
      codes.add(k.code).add(u.code).add(n.code);
    }
    ok("unknown, inactive and wrong-password logins return the identical error", codes.size === 1 && [...codes][0].startsWith("INVALID_CREDENTIALS|"), [...codes].join(" / "));
    const ratioUnknown = median(unknown) / median(known);
    const ratioInactive = median(inactive) / median(known);
    ok(`unknown-account work ≈ wrong-password work (median ratio ${ratioUnknown.toFixed(2)})`, ratioUnknown > 0.6 && ratioUnknown < 1.6);
    ok(`inactive-account work ≈ wrong-password work (median ratio ${ratioInactive.toFixed(2)})`, ratioInactive > 0.6 && ratioInactive < 1.6);
    const t0 = performance.now();
    await auth.verifyPlatformPassword("anything", null);
    ok("the no-account path performs a full-cost bcrypt compare (≥ 50 ms)", performance.now() - t0 >= 50);
  }

  section("11. Append-only audit trail");
  {
    const actions = (await db.selectDistinct({ a: platformAuditEventsTable.action }).from(platformAuditEventsTable)).map((r) => r.a).sort();
    for (const required of ["auth.login.succeeded", "auth.login.failed", "auth.login.blocked", "auth.mfa.required", "auth.mfa.failed", "auth.mfa.replay_rejected", "auth.recovery_code.used", "auth.recovery_code.failed", "session.revoked", "session.logout", "session.logout_all", "session.idle_timeout", "session.expired"]) {
      ok(`audited: ${required}`, actions.includes(required));
    }
    const [one] = await db.select({ id: platformAuditEventsTable.id }).from(platformAuditEventsTable).limit(1);
    await rejects("UPDATE through the app connection rejected", () => db.update(platformAuditEventsTable).set({ reason: "tamper" }).where(eq(platformAuditEventsTable.id, one.id)), (e) => /append-only/.test(String((e as Error)?.message) + String((e as { cause?: Error })?.cause?.message)));
    await rejects("DELETE through the app connection rejected", () => db.delete(platformAuditEventsTable).where(eq(platformAuditEventsTable.id, one.id)), (e) => /append-only/.test(String((e as Error)?.message) + String((e as { cause?: Error })?.cause?.message)));
    await rejects("TRUNCATE through the app connection rejected", () => db.execute(sql`truncate platform_audit_events`), (e) => /append-only/.test(String((e as Error)?.message) + String((e as { cause?: Error })?.cause?.message)));
    for (const badKey of ["password", "token", "recoveryCodes", "totpSecret", "sessionHash", "cookie"]) {
      await rejects(`snapshot key "${badKey}" refused`, () => audit.recordPlatformAudit({ actorLabel: "test", action: "test.redaction", entityType: "test", entityId: "1", result: "success", after: { [badKey]: "x" } }), is("VALIDATION_FAILED"));
    }
    await rejects("nested secret-looking key refused", () => audit.recordPlatformAudit({ actorLabel: "test", action: "test.redaction", entityType: "test", entityId: "1", result: "success", after: { outer: { apiToken: "x" } } }), is("VALIDATION_FAILED"));
    await rejects("malformed action code refused", () => audit.recordPlatformAudit({ actorLabel: "test", action: "Bad Action", entityType: "test", entityId: "1", result: "success" }), is("VALIDATION_FAILED"));
    await db.execute(sql`alter table platform_audit_events disable trigger platform_audit_events_immutable`);
    await rejects("disabled trigger → login fails closed (CONFIG_ERROR)", async () => {
      await audit.assertPlatformAuditProtection({ force: true });
    }, is("CONFIG_ERROR"));
    await rejects("…and platformLogin refuses to run", () => platformLogin({ email: owner.email, password: owner.password, totpCode: codeAt(owner.secret), ipAddress: "203.0.113.70" }), is("CONFIG_ERROR"));
    await db.execute(sql`alter table platform_audit_events enable trigger platform_audit_events_immutable`);
    await audit.assertPlatformAuditProtection({ force: true });
    ok("re-enabled trigger → protection verified again", true);
    const dump = await db.execute(sql`select coalesce(string_agg(row_to_json(e)::text, ' '), '') as s from platform_audit_events e`);
    const text = String((dump.rows[0] as { s: string }).s);
    const leaked = secretsSeen.filter((s) => s && s.length >= 6 && text.includes(s));
    ok("no password, TOTP secret, recovery code, token or jti appears in any audit row", leaked.length === 0, `${leaked.length} leaked value(s)`);
    const sessionsDump = await db.execute(sql`select coalesce(string_agg(row_to_json(s)::text, ' '), '') as s from platform_sessions s`);
    const sessionsText = String((sessionsDump.rows[0] as { s: string }).s);
    ok("platform_sessions stores no raw token or jti", !secretsSeen.some((s) => s && s.length >= 32 && sessionsText.includes(s)));
  }

  section("12. Password policy");
  {
    ok("strong password accepted", auth.validatePlatformPassword(STRONG, { email: "owner@platform.test" }).length === 0);
    ok("13 characters rejected", auth.validatePlatformPassword("Quartz-Harb7!", {}).length > 0);
    ok("common/leet password rejected", auth.validatePlatformPassword("P@ssw0rd-P@ssw0rd-1", {}).length > 0);
    ok("missing symbol rejected", auth.validatePlatformPassword("QuartzHarbor71xyz", {}).length > 0);
    ok("password containing the e-mail name rejected", auth.validatePlatformPassword("Harbor-Quartz-71!", { email: "harbor@platform.test" }).length > 0);
    ok("over 72 bytes rejected (no silent bcrypt truncation)", auth.validatePlatformPassword(`Qq1!${"ب".repeat(40)}`, {}).some((x) => /72 bytes/.test(x)));
    ok("e-mail normalization trims and lowercases", auth.normalizePlatformEmail("  Owner@Platform.TEST ") === "owner@platform.test" && auth.isValidPlatformEmail("owner@platform.test") && !auth.isValidPlatformEmail("Owner@platform.test"));
  }
}

let exitCode = 1;
let created = false;
try {
  await createPlatformTestDatabase("po01a_auth", testDbName);
  created = true;
  await main();
  exitCode = summary("verify:platform-auth");
} catch (e) {
  console.error(`verify:platform-auth aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
  if (created && process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
