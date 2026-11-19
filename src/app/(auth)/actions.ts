"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usersTable } from "@/db/schema";
import { hashPassword, verifyPassword, signSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { checkLoginRateLimit, clearLoginRateLimit } from "@/lib/rate-limit";
import { bootstrapOrganization } from "@/lib/org-bootstrap";
import { recordSecurityEvent, recordAudit } from "@/lib/security/audit";
import { validatePassword, DEFAULT_POLICY } from "@/lib/security/password-policy";
import { createSession } from "@/lib/security/session-store";
import { lockOrgAccessForSessionIssue, tenantAccessEnforcementEnabled, TenantAccessUnavailableError } from "@/lib/security/tenant-access-gate";
import { verifyTotp } from "@/lib/security/totp";
import { decryptField, encryptField } from "@/lib/crypto/field-encryption";
import { COUNTRIES } from "@/lib/geo/countries";
import { isValidCurrencyCode } from "@/lib/currency/currencies";
import bcrypt from "bcryptjs";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type ActionState = { error?: string } | undefined;

// PO-02C: shown only AFTER the credentials (and second factor) were verified; translated in the
// customer dictionary. Before that point every failure stays generic.
const COMPANY_SUSPENDED_MESSAGE = "Your company's access is suspended. Contact your service provider.";
const SIGN_IN_UNAVAILABLE_MESSAGE = "Sign-in is temporarily unavailable. Try again later.";

// PO-02C.1: the sign-in and session-issue transactions run at READ COMMITTED explicitly — the company-lock
// protocol (src/lib/platform/company-access.ts) relies on each statement seeing what committed before it began.
const READ_COMMITTED = { isolationLevel: "read committed" } as const;

async function issueSession(userId: number, orgId: number) {
  // PO-02C, defence in depth: no session is ever issued for a company whose access is not active.
  // PO-02C.1: with enforcement on, that check and the session insert are ONE transaction under the
  // company-row lock, so a concurrent suspension either is seen here or sees (and ends) the session.
  const jti = tenantAccessEnforcementEnabled()
    ? await db.transaction(async (tx) => {
        if ((await lockOrgAccessForSessionIssue(tx, orgId)) !== "active") throw new Error("session refused: company access is not active");
        return createSession(userId, orgId, tx);
      }, READ_COMMITTED)
    : await createSession(userId, orgId);
  await setSessionCookie(userId, orgId, jti);
}

/** The session cookie for a session row that has been committed. */
async function setSessionCookie(userId: number, orgId: number, jti: string) {
  const token = await signSessionToken({ userId, orgId, jti });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

/**
 * PO-02C.1: the stored recovery codes with `matchedHash` (the stored hash the submitted code matched)
 * removed and re-encrypted — or null when that hash is no longer stored, because a concurrent sign-in
 * spent the code first (or the codes were regenerated). Always applied to the row as read under its
 * lock, so a code is accepted at most once and no write can restore another sign-in's spent code.
 */
function withoutRecoveryCode(stored: string | null, matchedHash: string): string | null {
  const hashes: string[] = JSON.parse(decryptField(stored) ?? "[]");
  const i = hashes.indexOf(matchedHash);
  if (i < 0) return null;
  hashes.splice(i, 1);
  return encryptField(JSON.stringify(hashes));
}

/** PO-02C.1, enforcement off: spend a matched recovery code atomically. False when it was spent already. */
async function consumeRecoveryCode(userId: number, matchedHash: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ codes: usersTable.mfaRecoveryCodes }).from(usersTable).where(eq(usersTable.id, userId)).for("no key update");
    const remaining = row ? withoutRecoveryCode(row.codes, matchedHash) : null;
    if (!remaining) return false;
    await tx.update(usersTable).set({ mfaRecoveryCodes: remaining }).where(eq(usersTable.id, userId));
    return true;
  }, READ_COMMITTED);
}

type SignIn = { ok: true; jti: string } | { ok: false; reason: "suspended" | "account" | "code_spent" };

/**
 * PO-02C.1, enforcement on: everything the sign-in writes, as ONE transaction, after the password and
 * the second factor were verified (bcrypt stays outside it):
 *   company-row SHARE lock + access → user-row lock + re-check (still active, same company) → recovery
 *   code spent (if one was used) + last sign-in time → session row → code-used and success records.
 * Nothing is applied unless all of it commits, and the caller sets the cookie only after the commit.
 * Lock order: the company row, then the user row. The access action locks the company row and never a
 * user row, and no customer transaction locks a user row and then its company, so neither can deadlock.
 */
async function completeSignIn(email: string, user: { id: number; orgId: number }, recoveryHash: string | null): Promise<SignIn> {
  return db.transaction(async (tx) => {
    if ((await lockOrgAccessForSessionIssue(tx, user.orgId)) !== "active") return { ok: false, reason: "suspended" } as const;
    const [current] = await tx
      .select({ orgId: usersTable.orgId, isActive: usersTable.isActive, mfaRecoveryCodes: usersTable.mfaRecoveryCodes })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .for("no key update");
    if (!current || !current.isActive || current.orgId !== user.orgId) return { ok: false, reason: "account" } as const;
    const remaining = recoveryHash ? withoutRecoveryCode(current.mfaRecoveryCodes, recoveryHash) : null;
    if (recoveryHash && !remaining) return { ok: false, reason: "code_spent" } as const;
    await tx
      .update(usersTable)
      .set(remaining ? { mfaRecoveryCodes: remaining, lastLoginAt: new Date() } : { lastLoginAt: new Date() })
      .where(eq(usersTable.id, user.id));
    const jti = await createSession(user.id, user.orgId, tx);
    if (recoveryHash) await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "mfa.recovery_used", severity: "medium" }, tx);
    await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "login.success", severity: "info" }, tx);
    return { ok: true, jti } as const;
  }, READ_COMMITTED);
}

/** A failure's SQLSTATE or class for the server log — never its message, which can carry statement values. */
function errorClass(err: unknown): string {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return `SQLSTATE ${code}`;
  }
  return err instanceof Error ? err.name : "unknown";
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const mfaCode = String(formData.get("mfaCode") ?? "").trim();

  if (!email || !password) return { error: "Email and password are required." };

  // Rate-limit before touching the database: 5 attempts per email per 15 minutes
  // (security audit, Medium #4). A successful login clears the counter.
  const waitMinutes = checkLoginRateLimit(email);
  if (waitMinutes !== null) {
    await recordSecurityEvent({ email, type: "login.rate_limited", severity: "high", detail: `Locked for ${waitMinutes} min` });
    return { error: `Too many login attempts. Try again in ${waitMinutes} min.` };
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user || !user.isActive) {
    await recordSecurityEvent({ email, orgId: user?.orgId ?? null, type: "login.failed", severity: "medium", detail: user ? "account disabled" : "unknown email" });
    return { error: "Invalid email or password." };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "login.failed", severity: "medium", detail: "bad password" });
    return { error: "Invalid email or password." };
  }
  // MFA challenge — password is correct; require a valid TOTP or recovery code.
  // PO-02C: a matching recovery code is only consumed once the company's access is confirmed below.
  // PO-02C.1: …and atomically with the sign-in (completeSignIn / consumeRecoveryCode), at most once.
  let recoveryHash: string | null = null;
  if (user.mfaEnabled) {
    if (!mfaCode) return { error: "MFA_REQUIRED" };
    const secret = decryptField(user.mfaSecret);
    let mfaOk = secret ? verifyTotp(secret, mfaCode) : false;
    if (!mfaOk && user.mfaRecoveryCodes) {
      // Recovery codes are single-use: on match, consume it (below, under the user-row lock).
      const hashes: string[] = JSON.parse(decryptField(user.mfaRecoveryCodes) ?? "[]");
      for (const hash of hashes) {
        if (await bcrypt.compare(mfaCode.toUpperCase(), hash)) {
          recoveryHash = hash;
          mfaOk = true;
          break;
        }
      }
    }
    if (!mfaOk) {
      await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "mfa.failed", severity: "high" });
      return { error: "MFA_INVALID" };
    }
  }

  if (!tenantAccessEnforcementEnabled()) {
    // Enforcement off: the accepted sequence. PO-02C.1 changes one thing in it — a matched recovery code
    // is spent atomically (under the user-row lock), so a concurrent second use is refused like a wrong code.
    if (recoveryHash) {
      if (!(await consumeRecoveryCode(user.id, recoveryHash))) {
        await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "mfa.failed", severity: "high", detail: "recovery code already used" });
        return { error: "MFA_INVALID" };
      }
      await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "mfa.recovery_used", severity: "medium" });
    }

    clearLoginRateLimit(email);

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "login.success", severity: "info" });

    await issueSession(user.id, user.orgId);
    redirect("/dashboard");
  }

  // PO-02C: company access, checked only after authentication succeeded (so the neutral suspension
  // message is never shown to someone who has not proven the credentials). PO-02C.1: in the same
  // transaction as everything the sign-in writes — a suspended company gets no session, no spent
  // recovery code, no last-login time and no success record, however the sign-in and a suspension
  // interleave; a failed transaction leaves nothing behind and sets no cookie.
  let signIn: SignIn;
  try {
    signIn = await completeSignIn(email, user, recoveryHash);
  } catch (err) {
    if (err instanceof TenantAccessUnavailableError) {
      await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "login.access_unavailable", severity: "high" });
      return { error: SIGN_IN_UNAVAILABLE_MESSAGE };
    }
    console.error(`[auth] sign-in could not be completed (${errorClass(err)}); nothing was applied`);
    await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "login.failed", severity: "medium", detail: "sign-in could not be completed" }).catch(() => undefined);
    return { error: SIGN_IN_UNAVAILABLE_MESSAGE };
  }
  if (!signIn.ok) {
    if (signIn.reason === "suspended") {
      await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "login.company_suspended", severity: "medium" });
      return { error: COMPANY_SUSPENDED_MESSAGE };
    }
    if (signIn.reason === "code_spent") {
      await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "mfa.failed", severity: "high", detail: "recovery code already used" });
      return { error: "MFA_INVALID" };
    }
    await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "login.failed", severity: "medium", detail: "account changed during sign-in" });
    return { error: "Invalid email or password." };
  }

  clearLoginRateLimit(email);
  await setSessionCookie(user.id, user.orgId, signIn.jti);
  redirect("/dashboard");
}

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orgName = String(formData.get("orgName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const country = String(formData.get("country") ?? "").trim();
  const currency = String(formData.get("currency") ?? "").trim().toUpperCase();

  if (!orgName || !name || !email || !password) return { error: "All fields are required." };

  // Country and currency are asked here rather than left to the column default. `orgs.currency`
  // defaults to SAR, which silently gave every non-Saudi org a Saudi base currency — and, once
  // FX-1b lands, would silently lock it there. The country is stored as its NAME, matching what
  // `getProfileByCountryName` reads everywhere else in the app.
  if (!COUNTRIES.some((c) => c.name === country)) return { error: "Choose a valid country." };
  if (!isValidCurrencyCode(currency)) return { error: "Choose a valid currency." };
  // First account uses the default enterprise policy; per-org policy applies to later members.
  const pwErrors = validatePassword(password, DEFAULT_POLICY);
  if (pwErrors.length > 0) return { error: pwErrors[0] };

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) return { error: "An account with this email already exists." };

  const passwordHash = await hashPassword(password);

  // PO-02D3: the same three statements, now in the one shared bootstrap (src/lib/org-bootstrap.ts) that invitation
  // acceptance also uses — organization, owner, seedOrgDefaults, in this transaction; behaviour unchanged.
  const { userId, orgId } = await db.transaction(async (tx) =>
    bootstrapOrganization(tx, { orgName, country, currency, ownerName: name, ownerEmail: email, passwordHash }),
  );

  await recordAudit({ orgId, userId, userName: name }, { action: "org.registered", entityType: "org", entityId: orgId, newValue: { orgName, ownerEmail: email, country, currency } });
  await recordSecurityEvent({ email, orgId, userId, type: "account.created", severity: "info", detail: "organization owner" });

  await issueSession(userId, orgId);
  redirect("/dashboard");
}
