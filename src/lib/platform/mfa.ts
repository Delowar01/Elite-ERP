import "server-only";
import bcrypt from "bcryptjs";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { platformAdminsTable, type Tx } from "@/db";
import { decryptField, encryptField, encryptionConfigured } from "@/lib/crypto/field-encryption";
import { generateRecoveryCodes, generateTotpSecret, totpProvisioningUri } from "@/lib/security/totp";
import { PlatformError } from "./errors";
import { matchTotpStep } from "./totp";

// ---------------------------------------------------------------------------------------------
// Mandatory MFA for Platform Owner sessions:
//  • TOTP secrets exist only as field-encryption envelopes (legacy plaintext is refused);
//  • a TOTP code is accepted at most once — the matched time step must be strictly greater than
//    platform_admins.mfa_last_totp_step, enforced by one atomic compare-and-set UPDATE, so a code
//    (or an older one) cannot be replayed, even concurrently;
//  • recovery codes are bcrypt hashes, consumed (removed) under a row lock — single use.
// ---------------------------------------------------------------------------------------------

export const PLATFORM_TOTP_ISSUER = "Elite ERP Platform";
export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_ROUNDS = 10;
const ENVELOPE = /^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;
const BASE32_SECRET = /^[A-Z2-7]{16,}$/;
const RECOVERY_CODE = /^([0-9A-F]{5})-?([0-9A-F]{5})$/;

export function createTotpEnrollment(email: string): { secret: string; otpauthUri: string } {
  const secret = generateTotpSecret();
  return { secret, otpauthUri: totpProvisioningUri(secret, email, PLATFORM_TOTP_ISSUER) };
}

export function encryptTotpSecret(secret: string): string {
  if (!encryptionConfigured()) throw new PlatformError("CONFIG_ERROR", "FIELD_ENCRYPTION_KEYS is not configured");
  if (!BASE32_SECRET.test(secret)) throw new PlatformError("VALIDATION_FAILED", "not a base32 TOTP secret");
  const envelope = encryptField(secret);
  if (!envelope || !ENVELOPE.test(envelope)) throw new PlatformError("CONFIG_ERROR", "field encryption did not produce an envelope");
  return envelope;
}

/** Refuses anything that is not an encryption envelope (the shared helper would pass plaintext through). */
export function decryptTotpSecret(envelope: string | null | undefined): string {
  if (!envelope || !ENVELOPE.test(envelope)) throw new PlatformError("CONFIG_ERROR", "stored TOTP secret is not encrypted");
  const secret = decryptField(envelope);
  if (!secret || !BASE32_SECRET.test(secret)) throw new PlatformError("CONFIG_ERROR", "stored TOTP secret is unreadable");
  return secret;
}

/** Canonical XXXXX-XXXXX form, or null when the input cannot be a recovery code. */
export function normalizeRecoveryCode(input: string): string | null {
  const m = RECOVERY_CODE.exec(String(input ?? "").replace(/\s/g, "").toUpperCase());
  return m ? `${m[1]}-${m[2]}` : null;
}

/** New single-use codes (shown once by the caller) and their bcrypt hashes (stored). */
export async function createRecoveryCodeSet(): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, RECOVERY_CODE_ROUNDS)));
  return { codes, hashes };
}

export type TotpConsumption = { ok: true; step: number } | { ok: false; reason: "invalid" | "replayed" };

/** Verify a TOTP code and atomically record its time step. Must run inside the caller's transaction. */
export async function consumeTotpCode(tx: Tx, adminId: string, code: string, now: Date): Promise<TotpConsumption> {
  const [admin] = await tx
    .select({ secret: platformAdminsTable.mfaSecretEncrypted })
    .from(platformAdminsTable)
    .where(eq(platformAdminsTable.id, adminId));
  if (!admin) return { ok: false, reason: "invalid" };
  const step = matchTotpStep(decryptTotpSecret(admin.secret), code, now, 1);
  if (step === null) return { ok: false, reason: "invalid" };
  const updated = await tx
    .update(platformAdminsTable)
    .set({ mfaLastTotpStep: step, updatedAt: now })
    .where(
      and(
        eq(platformAdminsTable.id, adminId),
        or(isNull(platformAdminsTable.mfaLastTotpStep), lt(platformAdminsTable.mfaLastTotpStep, step)),
      ),
    )
    .returning({ id: platformAdminsTable.id });
  return updated.length === 1 ? { ok: true, step } : { ok: false, reason: "replayed" };
}

export type RecoveryConsumption = { ok: true; remaining: number } | { ok: false };

/**
 * Verify and consume one recovery code under a row lock (concurrent reuse cannot both succeed).
 * Every stored hash is compared — no early exit — so timing does not reveal the code's position.
 */
export async function consumeRecoveryCode(tx: Tx, adminId: string, code: string, now: Date): Promise<RecoveryConsumption> {
  const normalized = normalizeRecoveryCode(code);
  const [admin] = await tx
    .select({ hashes: platformAdminsTable.mfaRecoveryHashes })
    .from(platformAdminsTable)
    .where(eq(platformAdminsTable.id, adminId))
    .for("update");
  if (!admin || !normalized) return { ok: false };
  const hashes = Array.isArray(admin.hashes) ? admin.hashes.filter((h): h is string => typeof h === "string") : [];
  let matchIndex = -1;
  for (let i = 0; i < hashes.length; i++) {
    if ((await bcrypt.compare(normalized, hashes[i])) && matchIndex === -1) matchIndex = i;
  }
  if (matchIndex === -1) return { ok: false };
  const remaining = hashes.filter((_, i) => i !== matchIndex);
  await tx
    .update(platformAdminsTable)
    .set({ mfaRecoveryHashes: remaining, updatedAt: now })
    .where(eq(platformAdminsTable.id, adminId));
  return { ok: true, remaining: remaining.length };
}

/** Replace all recovery codes (step-up verification is the caller's responsibility). */
export async function replaceRecoveryCodes(tx: Tx, adminId: string, now: Date): Promise<string[]> {
  const { codes, hashes } = await createRecoveryCodeSet();
  const updated = await tx
    .update(platformAdminsTable)
    .set({ mfaRecoveryHashes: hashes, updatedAt: now })
    .where(eq(platformAdminsTable.id, adminId))
    .returning({ id: platformAdminsTable.id });
  if (updated.length !== 1) throw new PlatformError("NOT_FOUND", "platform admin not found");
  return codes;
}
