"use server";

import { revalidatePath } from "next/cache";
import { eq, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable, passwordHistoryTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { encryptField, decryptField } from "@/lib/crypto/field-encryption";
import { generateTotpSecret, totpProvisioningUri, verifyTotp, generateRecoveryCodes } from "@/lib/security/totp";
import { revokeSession, revokeUserSessions } from "@/lib/security/session-store";
import { recordSecurityEvent, recordAudit } from "@/lib/security/audit";
import { validatePassword, isPasswordReused, DEFAULT_POLICY, type PasswordPolicy } from "@/lib/security/password-policy";

export type ActionResult = { error?: string; ok?: boolean };

const PATH = "/settings/security";

async function orgPolicy(orgId: number): Promise<PasswordPolicy> {
  const [o] = await db.select().from(orgsTable).where(eq(orgsTable.id, orgId));
  if (!o) return DEFAULT_POLICY;
  return {
    minLength: o.pwdMinLength,
    requireUppercase: o.pwdRequireUppercase,
    requireLowercase: o.pwdRequireLowercase,
    requireNumber: o.pwdRequireNumber,
    requireSpecial: o.pwdRequireSpecial,
    historyCount: o.pwdHistoryCount,
    expiryDays: o.pwdExpiryDays,
  };
}

// ---- MFA: begin setup (returns the secret + provisioning URI; not yet enabled) ----
export async function beginMfaSetupAction(): Promise<{ secret: string; uri: string } | { error: string }> {
  const session = await requireSession();
  const secret = generateTotpSecret();
  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, session.userId));
  // Stash the (encrypted) pending secret; it only becomes active once a code is confirmed.
  await db.update(usersTable).set({ mfaSecret: encryptField(secret) }).where(eq(usersTable.id, session.userId));
  return { secret, uri: totpProvisioningUri(secret, user?.email ?? "user", "Elite ERP") };
}

// ---- MFA: confirm + enable, returns one-time recovery codes ----
export async function confirmMfaAction(code: string): Promise<{ recoveryCodes: string[] } | { error: string }> {
  const session = await requireSession();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!user?.mfaSecret) return { error: "Start MFA setup first." };
  const secret = decryptField(user.mfaSecret);
  if (!secret || !verifyTotp(secret, code)) return { error: "That code didn't match. Check your app's time and try again." };

  const codes = generateRecoveryCodes(10);
  const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
  await db
    .update(usersTable)
    .set({ mfaEnabled: true, mfaRecoveryCodes: encryptField(JSON.stringify(hashes)), updatedAt: new Date() })
    .where(eq(usersTable.id, session.userId));

  // Enabling MFA invalidates other sessions (Stage 11 auto-invalidation rule).
  await revokeUserSessions(session.userId, "mfa_change", session.jti);
  await recordSecurityEvent({ orgId: session.orgId, userId: session.userId, email: user.email, type: "mfa.enabled", severity: "info" });
  await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, { action: "mfa.enabled", entityType: "user", entityId: session.userId });
  revalidatePath(PATH);
  return { recoveryCodes: codes };
}

// ---- MFA: disable (requires current password) ----
export async function disableMfaAction(password: string): Promise<ActionResult> {
  const session = await requireSession();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!user) return { error: "User not found." };
  if (session.role === "owner" || session.role === "admin") {
    const [o] = await db.select({ req: orgsTable.mfaRequiredForPrivileged }).from(orgsTable).where(eq(orgsTable.id, session.orgId));
    if (o?.req) return { error: "MFA is required for your role and can't be disabled." };
  }
  if (!(await verifyPassword(password, user.passwordHash))) return { error: "Incorrect password." };
  await db
    .update(usersTable)
    .set({ mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: null, updatedAt: new Date() })
    .where(eq(usersTable.id, session.userId));
  await recordSecurityEvent({ orgId: session.orgId, userId: session.userId, email: user.email, type: "mfa.disabled", severity: "medium" });
  await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, { action: "mfa.disabled", entityType: "user", entityId: session.userId });
  revalidatePath(PATH);
  return { ok: true };
}

// ---- Change password (policy + history enforced; revokes other sessions) ----
export async function changePasswordAction(currentPassword: string, newPassword: string): Promise<ActionResult> {
  const session = await requireSession();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!user) return { error: "User not found." };
  if (!(await verifyPassword(currentPassword, user.passwordHash))) return { error: "Current password is incorrect." };

  const policy = await orgPolicy(session.orgId);
  const errors = validatePassword(newPassword, policy);
  if (errors.length > 0) return { error: errors[0] };

  const recent = await db
    .select({ passwordHash: passwordHistoryTable.passwordHash })
    .from(passwordHistoryTable)
    .where(eq(passwordHistoryTable.userId, session.userId))
    .orderBy(desc(passwordHistoryTable.createdAt))
    .limit(policy.historyCount);
  if (await isPasswordReused(newPassword, [user.passwordHash, ...recent.map((r) => r.passwordHash)])) {
    return { error: `You can't reuse one of your last ${policy.historyCount} passwords.` };
  }

  const newHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.insert(passwordHistoryTable).values({ userId: session.userId, passwordHash: user.passwordHash });
    await tx.update(usersTable).set({ passwordHash: newHash, passwordChangedAt: new Date(), updatedAt: new Date() }).where(eq(usersTable.id, session.userId));
  });

  // Password change invalidates all OTHER sessions.
  await revokeUserSessions(session.userId, "password_change", session.jti);
  await recordSecurityEvent({ orgId: session.orgId, userId: session.userId, email: user.email, type: "password.changed", severity: "info" });
  await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, { action: "password.changed", entityType: "user", entityId: session.userId });
  revalidatePath(PATH);
  return { ok: true };
}

// ---- Session management ----
export async function terminateSessionAction(sessionId: number): Promise<ActionResult> {
  const session = await requireSession();
  const ok = await revokeSession(session.userId, sessionId, "logout");
  if (!ok) return { error: "Session not found." };
  await recordSecurityEvent({ orgId: session.orgId, userId: session.userId, email: session.email, type: "session.terminated", severity: "info" });
  revalidatePath(PATH);
  return { ok: true };
}

export async function logoutAllOtherSessionsAction(): Promise<ActionResult> {
  const session = await requireSession();
  const n = await revokeUserSessions(session.userId, "logout_all", session.jti);
  await recordSecurityEvent({ orgId: session.orgId, userId: session.userId, email: session.email, type: "session.logout_all", severity: "info", detail: `${n} sessions` });
  revalidatePath(PATH);
  return { ok: true };
}
