import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { validatePassword, type PasswordPolicy } from "@/lib/security/password-policy";
import { PLATFORM_JWT, PLATFORM_SESSION_POLICY, platformSigningKey } from "./config";
import { platformClock } from "./clock";
import { PlatformError } from "./errors";

// ---------------------------------------------------------------------------------------------
// Platform Owner credentials and tokens. Independent of the customer ERP: separate secret
// (PLATFORM_AUTH_SECRET), explicit header type, issuer, audience and payload marker. A customer
// token can never verify here, and a platform token can never verify in src/lib/auth.ts.
// ---------------------------------------------------------------------------------------------

/** Stronger than the customer default (cost 10). */
export const PLATFORM_BCRYPT_ROUNDS = 12;

/** Proposed platform password policy (PO-00 §J; reviewer may adjust). */
export const PLATFORM_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 14,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
  historyCount: 0,
  expiryDays: 0,
};
/** bcrypt ignores input beyond 72 bytes; longer passwords are refused rather than truncated. */
export const PLATFORM_PASSWORD_MAX_BYTES = 72;

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizePlatformEmail(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function isValidPlatformEmail(email: string): boolean {
  return email.length <= 320 && email === normalizePlatformEmail(email) && EMAIL_SHAPE.test(email);
}

/** Policy failures (empty array = acceptable). */
export function validatePlatformPassword(password: string, context: { email?: string } = {}): string[] {
  const errors = validatePassword(password, PLATFORM_PASSWORD_POLICY);
  if (Buffer.byteLength(password, "utf8") > PLATFORM_PASSWORD_MAX_BYTES) {
    errors.push(`Must be at most ${PLATFORM_PASSWORD_MAX_BYTES} bytes.`);
  }
  const localPart = context.email ? normalizePlatformEmail(context.email).split("@")[0] : "";
  if (localPart.length >= 4 && password.toLowerCase().includes(localPart)) errors.push("Must not contain your email name.");
  return errors;
}

export async function hashPlatformPassword(password: string): Promise<string> {
  if (Buffer.byteLength(password, "utf8") > PLATFORM_PASSWORD_MAX_BYTES) {
    throw new PlatformError("VALIDATION_FAILED", "password exceeds the bcrypt input limit");
  }
  return bcrypt.hash(password, PLATFORM_BCRYPT_ROUNDS);
}

// A same-cost hash of an unknowable random value, generated per process (no hash constant is
// shipped). Comparing against it makes unknown and inactive accounts cost exactly as much as a
// wrong password for a real one, so response timing does not reveal which accounts exist.
let dummyHash: Promise<string> | null = null;
function dummyPasswordHash(): Promise<string> {
  dummyHash ??= bcrypt.hash(randomBytes(32).toString("base64url"), PLATFORM_BCRYPT_ROUNDS);
  return dummyHash;
}

/** Constant-work password check. `hash === null` (unknown/inactive account) still costs one compare. */
export async function verifyPlatformPassword(password: string, hash: string | null): Promise<boolean> {
  // Bound the work for absurd inputs; bcrypt reads at most 72 bytes anyway.
  const candidate = typeof password === "string" ? password.slice(0, 256) : "";
  if (!hash) {
    await bcrypt.compare(candidate, await dummyPasswordHash());
    return false;
  }
  return bcrypt.compare(candidate, hash);
}

/** Pre-compute the dummy hash so the first unknown-account login is not measurably slower. */
export function warmPlatformAuth(): void {
  void dummyPasswordHash();
}

/** Opaque 256-bit session identifier carried as the token's `jti`. */
export function newSessionJti(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this digest is stored (platform_sessions.token_hash). */
export function hashSessionJti(jti: string): string {
  return createHash("sha256").update(jti, "utf8").digest("hex");
}

export type PlatformTokenClaims = { adminId: string; jti: string; issuedAt: Date; expiresAt: Date };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JTI = /^[A-Za-z0-9_-]{43}$/;
const MAX_LIFETIME_S = PLATFORM_SESSION_POLICY.absoluteMs / 1000;

export async function signPlatformToken(input: { adminId: string; jti: string; issuedAt: Date; expiresAt: Date }): Promise<string> {
  const iat = Math.floor(input.issuedAt.getTime() / 1000);
  const exp = Math.floor(input.expiresAt.getTime() / 1000);
  if (!UUID.test(input.adminId) || !JTI.test(input.jti) || exp <= iat || exp - iat > MAX_LIFETIME_S) {
    throw new PlatformError("CONFIG_ERROR", "refusing to sign a platform token outside policy");
  }
  return new SignJWT({ typ: PLATFORM_JWT.tokenUse })
    .setProtectedHeader({ alg: PLATFORM_JWT.algorithm, typ: PLATFORM_JWT.headerType })
    .setIssuer(PLATFORM_JWT.issuer)
    .setAudience(PLATFORM_JWT.audience)
    .setSubject(input.adminId)
    .setJti(input.jti)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(platformSigningKey());
}

/**
 * Strict verification: HS256 only, platform secret, header typ, issuer, audience, payload marker,
 * required claims, lifetime ≤ policy, not issued in the future, and no customer-token claims.
 * Every failure is the same UNAUTHORIZED (no oracle about which check failed).
 */
export async function verifyPlatformToken(token: string): Promise<PlatformTokenClaims> {
  if (typeof token !== "string" || token.length < 32 || token.length > 4096) {
    throw new PlatformError("UNAUTHORIZED", "malformed token");
  }
  const now = platformClock.now();
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, platformSigningKey(), {
      algorithms: [PLATFORM_JWT.algorithm],
      issuer: PLATFORM_JWT.issuer,
      audience: PLATFORM_JWT.audience,
      typ: PLATFORM_JWT.headerType,
      requiredClaims: ["sub", "jti", "iat", "exp"],
      currentDate: now,
    }));
  } catch (err) {
    if (err instanceof PlatformError) throw err; // configuration failure stays a configuration failure
    throw new PlatformError("UNAUTHORIZED", "token verification failed");
  }
  const nowS = Math.floor(now.getTime() / 1000);
  const ok =
    payload.typ === PLATFORM_JWT.tokenUse &&
    !("userId" in payload) &&
    !("orgId" in payload) &&
    typeof payload.sub === "string" &&
    UUID.test(payload.sub) &&
    typeof payload.jti === "string" &&
    JTI.test(payload.jti) &&
    typeof payload.iat === "number" &&
    typeof payload.exp === "number" &&
    payload.exp > payload.iat &&
    payload.exp - payload.iat <= MAX_LIFETIME_S &&
    payload.iat <= nowS + 60;
  if (!ok) throw new PlatformError("UNAUTHORIZED", "token claims rejected");
  return {
    adminId: payload.sub as string,
    jti: payload.jti as string,
    issuedAt: new Date((payload.iat as number) * 1000),
    expiresAt: new Date((payload.exp as number) * 1000),
  };
}
