/**
 * Platform Owner PO-01B — console operations suite (sign-in, sign-out, security settings).
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-console
 *
 * Exercises src/lib/platform/console.ts — the exact functions the /platform server actions call —
 * against one freshly created disposable database (dropped at the end), with fictional
 * administrators and a deterministic platform clock. Covers the PO-01A review conditions:
 * trusted client IP and throttle bypass, concurrent revocation, expiry, missing audit protection,
 * the feature flag on every operation, authorization independent of the UI, MFA / recovery-code
 * replay, cross-principal isolation, CSRF / origin on every mutation, and generic errors.
 * Every secret is generated in memory for this run and never printed.
 */
import { randomBytes } from "node:crypto";
import { decodeJwt } from "jose";
import { createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, rejects, summary, describeError } from "./platform/harness";

const testDbName = disposableName("po01b_console");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PLATFORM_CONSOLE_ENABLED = "true";
delete process.env.PLATFORM_TRUSTED_PROXY_HOPS;

const { db, pool, platformAdminsTable, platformSessionsTable, platformAuditEventsTable, platformLoginAttemptsTable } = await import("../src/db");
const { eq, sql, desc } = await import("drizzle-orm");
const auth = await import("../src/lib/platform/auth");
const { platformClock } = await import("../src/lib/platform/clock");
const { isPlatformError, PLATFORM_ERROR_CODES, PLATFORM_ERROR_MESSAGES } = await import("../src/lib/platform/errors");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const audit = await import("../src/lib/platform/audit");
const guards = await import("../src/lib/platform/guards");
const console_ = await import("../src/lib/platform/console");
const ipmod = await import("../src/lib/platform/client-ip");
const { assertSameOrigin } = await import("../src/lib/platform/origin");
const tenantAuth = await import("../src/lib/auth");

// ---- deterministic platform clock -------------------------------------------------------------
const MIN = 60_000;
let nowMs = Date.parse("2026-11-13T09:00:00.000Z");
platformClock.now = () => new Date(nowMs);
const realNow = platformClock.now;
const advance = (ms: number) => {
  nowMs += ms;
};
const codeAt = (secret: string, offsetSteps = 0) => totp.hotpCode(secret, totp.totpStepAt(new Date(nowMs)) + offsetSteps);
/** Move to the start of the next 30-s step, so the following code is a fresh one. */
const nextStep = () => {
  nowMs = (totp.totpStepAt(new Date(nowMs)) + 1) * 30_000 + 1_000;
};

const STRONG = "Cedar-Lantern-58!q";
const secretsSeen: string[] = [STRONG];

type Fixture = { id: string; email: string; password: string; secret: string; codes: string[] };
async function createAdmin(email: string, password = STRONG): Promise<Fixture> {
  const { secret } = mfa.createTotpEnrollment(email);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date(nowMs);
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName: `Fictional ${email.split("@")[0]}`, passwordHash: await auth.hashPlatformPassword(password), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  secretsSeen.push(password, secret, ...codes);
  return { id: row.id, email, password, secret, codes };
}

const HOST = "console.erp.test";
/** A same-origin browser request (what a real server-action POST from the console carries). */
function browser(extra: Record<string, string> = {}): Headers {
  return new Headers({ host: HOST, origin: `https://${HOST}`, "sec-fetch-site": "same-origin", "user-agent": "verify-platform-console", ...extra });
}
const reqOf = (token: string | null, headers: Headers = browser()) => ({ headers, token });
const fail = (r: { ok: boolean; code?: string }, code: string) => !r.ok && r.code === code && Object.keys(r).sort().join(",") === "code,ok";

async function signIn(f: Fixture, opts: { totpCode?: string; recoveryCode?: string; headers?: Headers } = {}) {
  const r = await console_.signInCore(
    { email: f.email, password: f.password, totpCode: opts.recoveryCode ? null : (opts.totpCode ?? codeAt(f.secret)), recoveryCode: opts.recoveryCode ?? null },
    { headers: opts.headers ?? browser() },
  );
  if (r.ok) secretsSeen.push(r.token, decodeJwt(r.token).jti as string);
  return r;
}
async function token(f: Fixture, headers?: Headers): Promise<string> {
  nextStep();
  const r = await signIn(f, { headers });
  if (!r.ok) throw new Error(`fixture sign-in failed: ${r.code}`);
  return r.token;
}
const hashesOf = async (id: string) => JSON.stringify((await db.select({ h: platformAdminsTable.mfaRecoveryHashes }).from(platformAdminsTable).where(eq(platformAdminsTable.id, id)))[0].h);
const lastAudit = async (n = 1) => db.select({ action: platformAuditEventsTable.action, ip: platformAuditEventsTable.ipAddress, after: platformAuditEventsTable.afterSafe, result: platformAuditEventsTable.result }).from(platformAuditEventsTable).orderBy(desc(platformAuditEventsTable.id)).limit(n);
const sessionsCount = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(platformSessionsTable))[0].n;
const clearThrottle = async () => {
  await db.delete(platformLoginAttemptsTable);
};
const is = (code: Parameters<typeof isPlatformError>[1]) => (e: unknown) => isPlatformError(e, code);

async function main() {
  const owner = await createAdmin("owner@console.test");
  const other = await createAdmin("second@console.test");

  section("1. Missing / disabled audit protection fails closed (cold cache, generic error)");
  {
    await db.execute(sql`alter table platform_audit_events disable trigger platform_audit_events_immutable`);
    const before = await sessionsCount();
    const r = await signIn(owner);
    ok("sign-in with valid credentials returns CONFIG_ERROR while the audit trigger is disabled", fail(r, "CONFIG_ERROR"));
    ok("…and creates no session", (await sessionsCount()) === before);
    ok("the user sees only the generic 'temporarily unavailable' message", PLATFORM_ERROR_MESSAGES.CONFIG_ERROR.en === "The platform console is temporarily unavailable." && PLATFORM_ERROR_MESSAGES.CONFIG_ERROR.ar.length > 0);
    await db.execute(sql`alter table platform_audit_events enable trigger platform_audit_events_immutable`);
    await audit.assertPlatformAuditProtection({ force: true });
    ok("re-enabled trigger → sign-in works again", (await signIn(owner)).ok);

    const t = await token(owner);
    await db.execute(sql`alter table platform_audit_events disable trigger platform_audit_events_no_truncate`);
    await rejects("forced re-check notices the disabled TRUNCATE trigger", () => audit.assertPlatformAuditProtection({ force: true }), is("CONFIG_ERROR"));
    const hashes = await hashesOf(owner.id);
    nextStep();
    const regen = await console_.regenerateRecoveryCodesCore(reqOf(t), { password: owner.password, totpCode: codeAt(owner.secret) });
    ok("recovery-code regeneration (a credential change) fails closed with CONFIG_ERROR and rotates nothing", fail(regen, "CONFIG_ERROR") && (await hashesOf(owner.id)) === hashes);
    const others = await console_.signOutOtherSessionsCore(reqOf(t));
    ok("access-reducing actions (sign out others) stay available so an incident can be contained", others.ok);
    await db.execute(sql`alter table platform_audit_events enable trigger platform_audit_events_no_truncate`);
    await audit.assertPlatformAuditProtection({ force: true });

    const logged: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
    platformClock.now = () => {
      throw new TypeError("internal detail: connection string and stack");
    };
    let internal: { ok: boolean; code?: string } = { ok: true };
    try {
      internal = await signIn(owner);
    } finally {
      platformClock.now = realNow;
      console.error = origError;
    }
    ok("an unexpected internal exception becomes CONFIG_ERROR (no detail returned)", fail(internal, "CONFIG_ERROR"));
    ok("the server log line names the error class only, never its message", logged.length === 1 && logged[0] === "[platform-console] internal failure: TypeError");
  }

  section("2. Feature flag gates every console operation");
  {
    const t = await token(owner);
    const saved = process.env.PLATFORM_CONSOLE_ENABLED;
    for (const value of [undefined, "false", "TRUE", "1"]) {
      if (value === undefined) delete process.env.PLATFORM_CONSOLE_ENABLED;
      else process.env.PLATFORM_CONSOLE_ENABLED = value;
      const results = await Promise.all([
        signIn(owner),
        console_.signOutCore(reqOf(t)),
        console_.revokeSessionCore(reqOf(t), "00000000-0000-4000-8000-000000000000"),
        console_.signOutOtherSessionsCore(reqOf(t)),
        console_.regenerateRecoveryCodesCore(reqOf(t), { password: owner.password, totpCode: "000000" }),
      ]);
      ok(`flag ${JSON.stringify(value ?? null)}: sign-in, sign-out, revoke, sign-out-others and regenerate all return CONSOLE_DISABLED`, results.every((r) => fail(r, "CONSOLE_DISABLED")));
      await rejects(`flag ${JSON.stringify(value ?? null)}: the security overview (page data) throws CONSOLE_DISABLED`, () => console_.securityOverviewCore(reqOf(t)), is("CONSOLE_DISABLED"));
    }
    process.env.PLATFORM_CONSOLE_ENABLED = saved;
    ok("flag restored: the same session is still valid (nothing was revoked while disabled)", (await guards.authorizePlatformToken(t)).adminId === owner.id);
  }

  section("3. CSRF / origin — every state-changing operation");
  {
    const t = await token(owner);
    const bad: [string, Headers][] = [
      ["no Origin header", new Headers({ host: HOST })],
      ["Origin of another site", browser({ origin: "https://evil.example" })],
      ["Origin 'null' (sandboxed / file)", browser({ origin: "null" })],
      ["same host, different port", browser({ origin: `https://${HOST}:8443` })],
      ["Sec-Fetch-Site: cross-site", browser({ "sec-fetch-site": "cross-site" })],
      ["Sec-Fetch-Site: same-site (sibling subdomain)", browser({ "sec-fetch-site": "same-site" })],
      ["X-Forwarded-Host differs from Origin", browser({ "x-forwarded-host": "other.erp.test" })],
      ["no Host / X-Forwarded-Host at all", new Headers({ origin: `https://${HOST}` })],
    ];
    const sessionsBefore = await sessionsCount();
    const hashes = await hashesOf(owner.id);
    for (const [name, h] of bad) {
      nextStep();
      const results = await Promise.all([
        signIn(owner, { headers: h }),
        console_.signOutCore(reqOf(t, h)),
        console_.revokeSessionCore(reqOf(t, h), "00000000-0000-4000-8000-000000000000"),
        console_.signOutOtherSessionsCore(reqOf(t, h)),
        console_.regenerateRecoveryCodesCore(reqOf(t, h), { password: owner.password, totpCode: codeAt(owner.secret) }),
      ]);
      ok(`${name}: all five mutations → FORBIDDEN`, results.every((r) => fail(r, "FORBIDDEN")));
    }
    ok("no forbidden request created a session, revoked one or rotated codes", (await sessionsCount()) === sessionsBefore && (await hashesOf(owner.id)) === hashes && (await guards.authorizePlatformToken(t)).adminId === owner.id);
    ok("Host comparison is case-insensitive and X-Forwarded-Host (first value) is honoured", (() => {
      try {
        assertSameOrigin(browser({ origin: `https://${HOST.toUpperCase()}` }));
        assertSameOrigin(new Headers({ host: "internal:3000", "x-forwarded-host": `${HOST}, proxy.local`, origin: `https://${HOST}` }));
        return true;
      } catch {
        return false;
      }
    })());
    ok("a request without Sec-Fetch-Site (older browser) is accepted when Origin matches", (() => {
      try {
        assertSameOrigin(new Headers({ host: HOST, origin: `https://${HOST}` }));
        return true;
      } catch {
        return false;
      }
    })());
  }

  section("4. Trusted client IP — never chosen by the client");
  {
    const h = (xff?: string, extra: Record<string, string> = {}) => new Headers({ ...(xff ? { "x-forwarded-for": xff } : {}), ...extra });
    ok("hops 0 (no trusted proxy): spoofed X-Forwarded-For / X-Real-IP are ignored → IP unknown", ipmod.clientIpFromHeaders(h("203.0.113.7", { "x-real-ip": "198.51.100.1" }), 0) === null);
    ok("hops 1: the entry appended by the proxy (rightmost) is the client; client-supplied entries to its left are ignored", ipmod.clientIpFromHeaders(h("6.6.6.6, 7.7.7.7, 203.0.113.9"), 1) === "203.0.113.9");
    ok("hops 2 (CDN + nginx): the second entry from the right", ipmod.clientIpFromHeaders(h("6.6.6.6, 203.0.113.9, 10.0.0.2"), 2) === "203.0.113.9");
    ok("fewer entries than trusted hops → unknown (never the attacker's value)", ipmod.clientIpFromHeaders(h("203.0.113.9"), 2) === null && ipmod.clientIpFromHeaders(h(), 1) === null);
    ok("a non-IP entry at the trusted position → unknown", ipmod.clientIpFromHeaders(h("6.6.6.6, not-an-ip"), 1) === null && ipmod.clientIpFromHeaders(h("6.6.6.6, 203.0.113.9; drop table"), 1) === null);
    ok("normalization: IPv4:port, [IPv6]:port, IPv4-mapped IPv6, upper-case IPv6", ipmod.normalizeIp("203.0.113.9:443") === "203.0.113.9" && ipmod.normalizeIp("[2001:DB8::1]:443") === "2001:db8::1" && ipmod.normalizeIp("::ffff:203.0.113.9") === "203.0.113.9" && ipmod.normalizeIp("2001:DB8::2") === "2001:db8::2");
    ok("PLATFORM_TRUSTED_PROXY_HOPS: unset/empty → 0, single digit accepted", ipmod.trustedProxyHops({}) === 0 && ipmod.trustedProxyHops({ PLATFORM_TRUSTED_PROXY_HOPS: "" }) === 0 && ipmod.trustedProxyHops({ PLATFORM_TRUSTED_PROXY_HOPS: "2" }) === 2);
    for (const v of ["a", "10", "-1", " 1", "1.5", "true"]) {
      process.env.PLATFORM_TRUSTED_PROXY_HOPS = v;
      const r = await signIn(owner);
      ok(`invalid PLATFORM_TRUSTED_PROXY_HOPS=${JSON.stringify(v)} → sign-in fails closed (CONFIG_ERROR)`, fail(r, "CONFIG_ERROR"));
    }
    delete process.env.PLATFORM_TRUSTED_PROXY_HOPS;
  }

  section("5. Throttle cannot be bypassed by rotating client-controlled headers");
  {
    await clearThrottle();
    const victim = await createAdmin("victim@console.test");
    // hops 0: the IP is unknown, so rotating X-Forwarded-For changes nothing — the account tier blocks.
    for (let i = 0; i < 5; i++) {
      const r = await console_.signInCore({ email: victim.email, password: "Wrong-Password-00!", totpCode: null }, { headers: browser({ "x-forwarded-for": `198.51.100.${i + 1}` }) });
      ok(`hops 0 · attempt ${i + 1} with a fresh spoofed X-Forwarded-For → INVALID_CREDENTIALS`, fail(r, "INVALID_CREDENTIALS"));
    }
    nextStep();
    const blocked = await signIn(victim, { headers: browser({ "x-forwarded-for": "198.51.100.99" }) });
    ok("hops 0 · after 5 failures the CORRECT password + TOTP is refused (account tier) despite yet another spoofed IP", fail(blocked, "RATE_LIMITED"));
    const [a] = await lastAudit();
    ok("…and the audit row records no client-supplied IP", a.action === "auth.login.blocked" && a.ip === null);

    // hops 1: spoofed entries to the left of the proxy's value do not create fresh IP buckets.
    await clearThrottle();
    process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
    const proxyAppended = "203.0.113.50";
    for (let i = 0; i < 20; i++) {
      await console_.signInCore({ email: `nobody${i}@console.test`, password: "Wrong-Password-00!", totpCode: null }, { headers: browser({ "x-forwarded-for": `10.9.${i}.1, ${proxyAppended}` }) });
    }
    nextStep();
    const ipBlocked = await signIn(other, { headers: browser({ "x-forwarded-for": `172.16.0.1, ${proxyAppended}` }) });
    ok("hops 1 · 20 failures across 20 accounts from one real client IP → that IP is blocked even for a valid account", fail(ipBlocked, "RATE_LIMITED"));
    nextStep();
    const elsewhere = await signIn(other, { headers: browser({ "x-forwarded-for": "6.6.6.6, 203.0.113.51" }) });
    ok("…while the same account from a different real client IP still signs in", elsewhere.ok);
    const [b] = await lastAudit(3);
    ok("audit records the proxy-appended client IP, not the spoofed one", (await db.select({ ip: platformAuditEventsTable.ipAddress }).from(platformAuditEventsTable).where(eq(platformAuditEventsTable.action, "auth.login.blocked")).orderBy(desc(platformAuditEventsTable.id)).limit(1))[0]?.ip === proxyAppended && b !== undefined);
    delete process.env.PLATFORM_TRUSTED_PROXY_HOPS;
    await clearThrottle();
  }

  section("6. Sign-in: generic failures, mandatory second factor, replay");
  {
    const before = await sessionsCount();
    const pw = await console_.signInCore({ email: owner.email, password: owner.password, totpCode: null }, { headers: browser() });
    ok("correct password without a code → MFA_REQUIRED and no session", fail(pw, "MFA_REQUIRED") && (await sessionsCount()) === before);
    const wrong = await console_.signInCore({ email: owner.email, password: "Wrong-Password-00!", totpCode: null }, { headers: browser() });
    const unknown = await console_.signInCore({ email: "ghost@console.test", password: owner.password, totpCode: null }, { headers: browser() });
    ok("wrong password and unknown account are indistinguishable (INVALID_CREDENTIALS, same shape)", fail(wrong, "INVALID_CREDENTIALS") && JSON.stringify(wrong) === JSON.stringify(unknown));
    nextStep();
    const code = codeAt(owner.secret);
    const good = await signIn(owner, { totpCode: code });
    ok("password + current TOTP → session; the outcome carries the token only for the cookie", good.ok && good.method === "totp" && good.expiresAt.getTime() <= nowMs + 12 * 60 * MIN);
    const replay = await signIn(owner, { totpCode: code });
    ok("the same TOTP code again → MFA_INVALID (replay)", fail(replay, "MFA_INVALID"));
    const [r] = await lastAudit();
    ok("…audited as auth.mfa.replay_rejected", r.action === "auth.mfa.replay_rejected");
    const older = await signIn(owner, { totpCode: codeAt(owner.secret, -1) });
    ok("an OLDER step's code (still inside the window) → MFA_INVALID", fail(older, "MFA_INVALID"));
    const rc = owner.codes[0];
    const viaRecovery = await signIn(owner, { recoveryCode: rc });
    ok("a recovery code signs in once (method recovery_code, 9 left)", viaRecovery.ok && viaRecovery.method === "recovery_code" && viaRecovery.remainingRecoveryCodes === 9);
    const rcReplay = await signIn(owner, { recoveryCode: rc });
    ok("the same recovery code again → MFA_INVALID", fail(rcReplay, "MFA_INVALID"));
    await clearThrottle();
  }

  section("7. Security overview, revocation and sign-out (only the caller's own sessions)");
  {
    const a1 = await token(owner);
    const a2 = await token(owner);
    const b1 = await token(other);
    const view = await console_.securityOverviewCore(reqOf(a1));
    const aIds = view.sessions.map((s) => s.id);
    const bView = await console_.securityOverviewCore(reqOf(b1));
    ok("overview lists only the caller's sessions, exactly one marked current", view.sessions.length >= 2 && view.sessions.filter((s) => s.current).length === 1 && !bView.sessions.some((s) => aIds.includes(s.id)));
    ok("overview reports the provisional 12 h / 30 min policy and the recovery codes left", view.policy.absoluteHours === 12 && view.policy.idleMinutes === 30 && view.recoveryCodesRemaining === 9 && view.operator.email === owner.email);
    const a2Id = (await guards.authorizePlatformToken(a2)).sessionId;
    const b1Id = (await guards.authorizePlatformToken(b1)).sessionId;
    ok("revoke: a non-UUID id → VALIDATION_FAILED", fail(await console_.revokeSessionCore(reqOf(a1), "1 or 1=1"), "VALIDATION_FAILED"));
    ok("revoke: an unknown id → NOT_FOUND", fail(await console_.revokeSessionCore(reqOf(a1), "00000000-0000-4000-8000-000000000000"), "NOT_FOUND"));
    ok("revoke: ANOTHER administrator's session id → NOT_FOUND, indistinguishable from unknown", fail(await console_.revokeSessionCore(reqOf(a1), b1Id), "NOT_FOUND"));
    ok("…and that session stays valid", (await guards.authorizePlatformToken(b1)).sessionId === b1Id);
    const race = await Promise.all(Array.from({ length: 6 }, () => console_.revokeSessionCore(reqOf(a1), a2Id)));
    ok("6 concurrent revocations of one session → exactly one succeeds, the rest NOT_FOUND", race.filter((r) => r.ok).length === 1 && race.filter((r) => fail(r, "NOT_FOUND")).length === 5);
    await rejects("the revoked session's token no longer authorizes", () => guards.authorizePlatformToken(a2), is("UNAUTHORIZED"));
    const okRevoke = race.find((r) => r.ok) as { ok: true; signedOutCurrent: boolean };
    ok("revoking another of one's own sessions does not sign out the current one", okRevoke.signedOutCurrent === false && (await guards.authorizePlatformToken(a1)).adminId === owner.id);

    const a3 = await token(owner);
    const a4 = await token(owner);
    const [others, revokeA3] = await Promise.all([console_.signOutOtherSessionsCore(reqOf(a1)), console_.revokeSessionCore(reqOf(a1), (await guards.authorizePlatformToken(a3)).sessionId)]);
    ok("sign-out-others racing a single revoke: each live session is ended exactly once", others.ok && (revokeA3.ok ? others.count >= 1 : fail(revokeA3, "NOT_FOUND")));
    await rejects("…other sessions are invalid afterwards", () => guards.authorizePlatformToken(a4), is("UNAUTHORIZED"));
    ok("…the current session and the other administrator's session survive", (await guards.authorizePlatformToken(a1)).adminId === owner.id && (await guards.authorizePlatformToken(b1)).adminId === other.id);
    const again = await console_.signOutOtherSessionsCore(reqOf(a1));
    ok("sign-out-others with no other session → ok, count 0", again.ok && again.count === 0);
    const selfId = (await guards.authorizePlatformToken(a1)).sessionId;
    const self = await console_.revokeSessionCore(reqOf(a1), selfId);
    ok("revoking the CURRENT session reports signedOutCurrent (the action then clears the cookie)", self.ok && self.signedOutCurrent === true);
    await rejects("…and that token is dead", () => guards.authorizePlatformToken(a1), is("UNAUTHORIZED"));

    const s1 = await token(owner);
    ok("sign-out → ok and the token is dead", (await console_.signOutCore(reqOf(s1))).ok);
    await rejects("…confirmed", () => guards.authorizePlatformToken(s1), is("UNAUTHORIZED"));
    ok("sign-out is idempotent and a missing / garbage token is a no-op", (await console_.signOutCore(reqOf(s1))).ok && (await console_.signOutCore(reqOf(null))).ok && (await console_.signOutCore(reqOf("garbage"))).ok);
  }

  section("8. Expiry: idle and absolute limits end the session for every operation");
  {
    const t = await token(owner);
    advance(31 * MIN);
    const results = await Promise.all([console_.signOutOtherSessionsCore(reqOf(t)), console_.revokeSessionCore(reqOf(t), "00000000-0000-4000-8000-000000000000"), console_.regenerateRecoveryCodesCore(reqOf(t), { password: owner.password, totpCode: "000000" })]);
    ok("after 31 idle minutes every mutation returns SESSION_EXPIRED or UNAUTHORIZED (the action then clears the cookie)", results.every((r) => !r.ok && (r.code === "SESSION_EXPIRED" || r.code === "UNAUTHORIZED")));
    await rejects("…and the page data refuses too", () => console_.securityOverviewCore(reqOf(t)), (e) => is("SESSION_EXPIRED")(e) || is("UNAUTHORIZED")(e));
    const t2 = await token(owner);
    for (let i = 0; i < 24; i++) {
      advance(29 * MIN);
      await guards.authorizePlatformToken(t2); // keeps it active
    }
    advance(29 * MIN); // 12 h 25 min after sign-in, never idle for 30 min
    await rejects("an always-active session still ends at the 12 h absolute limit", () => guards.authorizePlatformToken(t2), (e) => is("SESSION_EXPIRED")(e) || is("UNAUTHORIZED")(e));
  }

  section("9. Recovery-code regeneration: step-up, atomic, replay-proof, shown once");
  {
    await clearThrottle();
    const t = await token(owner);
    const loginCode = codeAt(owner.secret); // the step just consumed by this sign-in
    const before = await hashesOf(owner.id);
    const wrongPw = await console_.regenerateRecoveryCodesCore(reqOf(t), { password: "Wrong-Password-00!", totpCode: codeAt(owner.secret, 1) });
    ok("wrong password → INVALID_CREDENTIALS, codes NOT rotated", fail(wrongPw, "INVALID_CREDENTIALS") && (await hashesOf(owner.id)) === before);
    ok("…audited as mfa.recovery_codes.reauth_failed (stage password)", (await lastAudit())[0].action === "mfa.recovery_codes.reauth_failed");
    const wrongCode = await console_.regenerateRecoveryCodesCore(reqOf(t), { password: owner.password, totpCode: "000000" === codeAt(owner.secret) ? "111111" : "000000" });
    ok("right password + wrong TOTP → MFA_INVALID, codes NOT rotated", fail(wrongCode, "MFA_INVALID") && (await hashesOf(owner.id)) === before);
    const replayed = await console_.regenerateRecoveryCodesCore(reqOf(t), { password: owner.password, totpCode: loginCode });
    ok("right password + the TOTP code already used to sign in → MFA_INVALID (replay), codes NOT rotated", fail(replayed, "MFA_INVALID") && (await hashesOf(owner.id)) === before);
    ok("…audited as mfa.recovery_codes.replay_rejected", (await lastAudit())[0].action === "mfa.recovery_codes.replay_rejected");

    nextStep();
    const fresh = codeAt(owner.secret);
    const race = await Promise.all([console_.regenerateRecoveryCodesCore(reqOf(t), { password: owner.password, totpCode: fresh }), console_.regenerateRecoveryCodesCore(reqOf(t), { password: owner.password, totpCode: fresh })]);
    const winners = race.filter((r) => r.ok) as { ok: true; codes: string[] }[];
    ok("two concurrent regenerations with one fresh code → exactly one succeeds (single-use step)", winners.length === 1 && race.filter((r) => fail(r, "MFA_INVALID")).length === 1);
    const newCodes = winners[0]?.codes ?? [];
    secretsSeen.push(...newCodes);
    ok("10 new codes in the XXXXX-XXXXX format; the stored hashes changed", newCodes.length === 10 && newCodes.every((c) => /^[0-9A-F]{5}-[0-9A-F]{5}$/.test(c)) && (await hashesOf(owner.id)) !== before);
    const view = await console_.securityOverviewCore(reqOf(t));
    ok("overview now reports 10 remaining", view.recoveryCodesRemaining === 10);
    ok("the TOTP code consumed by regeneration cannot then sign in (shared replay guard)", fail(await signIn(owner, { totpCode: fresh }), "MFA_INVALID"));
    ok("an OLD recovery code no longer signs in", fail(await signIn(owner, { recoveryCode: owner.codes[1] }), "MFA_INVALID"));
    ok("a NEW recovery code signs in", (await signIn(owner, { recoveryCode: newCodes[0] })).ok);
    const regenAudit = (await db.select({ after: platformAuditEventsTable.afterSafe }).from(platformAuditEventsTable).where(eq(platformAuditEventsTable.action, "mfa.recovery_codes.regenerated")))[0];
    ok("the regeneration audit row records the count only", JSON.stringify(regenAudit?.after) === JSON.stringify({ backupCodesIssued: 10 }));
    ok("the other administrator's recovery codes are untouched", (await signIn(other, { recoveryCode: other.codes[0] })).ok);

    await clearThrottle();
    const t2 = await token(owner);
    const pinned = await hashesOf(owner.id);
    // (the clock moves 1 s per attempt, as real time would: failures are counted strictly after the last success)
    for (let i = 0; i < 5; i++) {
      advance(1_000);
      await console_.regenerateRecoveryCodesCore(reqOf(t2), { password: "Wrong-Password-00!", totpCode: "000000" });
    }
    nextStep();
    const blocked = await console_.regenerateRecoveryCodesCore(reqOf(t2), { password: owner.password, totpCode: codeAt(owner.secret) });
    ok("5 failed step-ups → even a correct step-up is RATE_LIMITED, codes not rotated", fail(blocked, "RATE_LIMITED") && (await hashesOf(owner.id)) === pinned);
    nextStep();
    ok("…and the shared account bucket also blocks sign-in", fail(await signIn(owner), "RATE_LIMITED"));
    await clearThrottle();
  }

  section("10. Authorization never depends on the UI: tokens and principals");
  {
    const customer = await tenantAuth.signSessionToken({ userId: 1, orgId: 1, jti: "fictional" });
    const results = await Promise.all([console_.signOutOtherSessionsCore(reqOf(customer)), console_.revokeSessionCore(reqOf(customer), "00000000-0000-4000-8000-000000000000"), console_.regenerateRecoveryCodesCore(reqOf(customer), { password: owner.password, totpCode: "000000" })]);
    ok("a customer session token → UNAUTHORIZED for every platform mutation", results.every((r) => fail(r, "UNAUTHORIZED")));
    const none = await Promise.all([console_.signOutOtherSessionsCore(reqOf(null)), console_.revokeSessionCore(reqOf(null), "00000000-0000-4000-8000-000000000000"), console_.regenerateRecoveryCodesCore(reqOf(null), { password: owner.password, totpCode: "000000" })]);
    ok("no token → UNAUTHORIZED for every platform mutation (a direct POST without the UI gets nothing)", none.every((r) => fail(r, "UNAUTHORIZED")));
    await rejects("a customer token never reads platform data", () => console_.securityOverviewCore(reqOf(customer)), is("UNAUTHORIZED"));
    const b = await token(other);
    await db.update(platformAdminsTable).set({ isActive: false }).where(eq(platformAdminsTable.id, other.id));
    ok("a deactivated administrator's live token stops working immediately", fail(await console_.signOutOtherSessionsCore(reqOf(b)), "UNAUTHORIZED"));
    await db.update(platformAdminsTable).set({ isActive: true }).where(eq(platformAdminsTable.id, other.id));
    ok("every failure outcome is exactly { ok: false, code } with a known code that has EN and AR text", PLATFORM_ERROR_CODES.every((c) => PLATFORM_ERROR_MESSAGES[c].en.length > 0 && /[؀-ۿ]/.test(PLATFORM_ERROR_MESSAGES[c].ar)));
  }

  section("11. No secret in the audit trail or the attempts table");
  {
    const auditText = JSON.stringify(await db.select().from(platformAuditEventsTable));
    const attemptsText = JSON.stringify(await db.select().from(platformLoginAttemptsTable));
    const leaked = secretsSeen.filter((s) => s && s.length >= 6 && (auditText.includes(s) || attemptsText.includes(s)));
    ok(`no password, TOTP secret, recovery code, token or jti in audit / attempts rows (${secretsSeen.length} values checked)`, leaked.length === 0);
    ok("no plaintext e-mail in the attempts table (keyed digests only)", !attemptsText.includes("@console.test"));
  }
}

let exitCode = 1;
let created = false;
try {
  await createPlatformTestDatabase("po01b_console", testDbName);
  created = true;
  await main();
  exitCode = summary("verify:platform-console");
} catch (e) {
  console.error(`verify:platform-console aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
  if (created && process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
