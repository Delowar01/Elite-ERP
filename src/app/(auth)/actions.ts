"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usersTable, orgsTable } from "@/db/schema";
import { hashPassword, verifyPassword, signSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { checkLoginRateLimit, clearLoginRateLimit } from "@/lib/rate-limit";
import { seedOrgDefaults } from "@/lib/seed-org";
import { recordSecurityEvent, recordAudit } from "@/lib/security/audit";
import { validatePassword, DEFAULT_POLICY } from "@/lib/security/password-policy";
import { createSession } from "@/lib/security/session-store";
import { verifyTotp } from "@/lib/security/totp";
import { decryptField } from "@/lib/crypto/field-encryption";
import bcrypt from "bcryptjs";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type ActionState = { error?: string } | undefined;

async function issueSession(userId: number, orgId: number) {
  const jti = await createSession(userId, orgId);
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
  if (user.mfaEnabled) {
    if (!mfaCode) return { error: "MFA_REQUIRED" };
    const secret = decryptField(user.mfaSecret);
    let mfaOk = secret ? verifyTotp(secret, mfaCode) : false;
    if (!mfaOk && user.mfaRecoveryCodes) {
      // Recovery codes are single-use: on match, consume it.
      const hashes: string[] = JSON.parse(decryptField(user.mfaRecoveryCodes) ?? "[]");
      for (let i = 0; i < hashes.length; i++) {
        if (await bcrypt.compare(mfaCode.toUpperCase(), hashes[i])) {
          hashes.splice(i, 1);
          const { encryptField } = await import("@/lib/crypto/field-encryption");
          await db.update(usersTable).set({ mfaRecoveryCodes: encryptField(JSON.stringify(hashes)) }).where(eq(usersTable.id, user.id));
          mfaOk = true;
          await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "mfa.recovery_used", severity: "medium" });
          break;
        }
      }
    }
    if (!mfaOk) {
      await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "mfa.failed", severity: "high" });
      return { error: "MFA_INVALID" };
    }
  }

  clearLoginRateLimit(email);

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  await recordSecurityEvent({ email, orgId: user.orgId, userId: user.id, type: "login.success", severity: "info" });

  await issueSession(user.id, user.orgId);
  redirect("/dashboard");
}

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orgName = String(formData.get("orgName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!orgName || !name || !email || !password) return { error: "All fields are required." };
  // First account uses the default enterprise policy; per-org policy applies to later members.
  const pwErrors = validatePassword(password, DEFAULT_POLICY);
  if (pwErrors.length > 0) return { error: pwErrors[0] };

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) return { error: "An account with this email already exists." };

  const passwordHash = await hashPassword(password);

  const { userId, orgId } = await db.transaction(async (tx) => {
    const [org] = await tx.insert(orgsTable).values({ name: orgName }).returning();
    const [user] = await tx
      .insert(usersTable)
      .values({ orgId: org.id, email, passwordHash, name, role: "owner" })
      .returning();
    await seedOrgDefaults(tx, org.id);
    return { userId: user.id, orgId: org.id };
  });

  await recordAudit({ orgId, userId, userName: name }, { action: "org.registered", entityType: "org", entityId: orgId, newValue: { orgName, ownerEmail: email } });
  await recordSecurityEvent({ email, orgId, userId, type: "account.created", severity: "info", detail: "organization owner" });

  await issueSession(userId, orgId);
  redirect("/dashboard");
}
