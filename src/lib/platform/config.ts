import "server-only";
import { createHmac } from "node:crypto";
import { encryptionConfigured } from "@/lib/crypto/field-encryption";
import { PlatformError } from "./errors";

// ---------------------------------------------------------------------------------------------
// Platform Owner configuration. Everything here fails CLOSED: a missing or weak secret, a secret
// shared with the customer ERP, or missing field encryption makes platform authentication refuse
// to run rather than degrade.
// ---------------------------------------------------------------------------------------------

/**
 * PROVISIONAL development policy (PR #11 TRD §3.1 candidate defaults; PO-00 decision D-9):
 * 12-hour absolute and 30-minute idle expiry. Owner confirmation is REQUIRED before production.
 * The database also enforces the 12-hour ceiling (platform_sessions_expiry_chk).
 */
export const PLATFORM_SESSION_POLICY = {
  absoluteMs: 12 * 60 * 60 * 1000,
  idleMs: 30 * 60 * 1000,
  /** last_seen_at is persisted at most this often (bounds write load; idle precision ±1 min). */
  touchIntervalMs: 60 * 1000,
} as const;

export const PLATFORM_JWT = {
  algorithm: "HS256",
  issuer: "elite-erp",
  audience: "elite-erp-platform",
  /** JOSE header `typ` (RFC 8725 explicit typing) — customer tokens carry none. */
  headerType: "platform+jwt",
  /** Payload claim `typ` — a second, independent marker. */
  tokenUse: "platform",
} as const;

/** Separate cookie from the customer `__Host-elite_erp_session`; the two never authorize each other. */
export const PLATFORM_SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-elite_erp_platform" : "elite_erp_platform";

/** Attributes for PO-01B when it sets/clears the platform cookie (TRD §3.1: HttpOnly; Secure; SameSite=Lax; Path=/; no Domain). */
export function platformSessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

const MIN_SECRET_BYTES = 32;

/** HS256 key for platform tokens. Never falls back; never equals the customer AUTH_SECRET. */
export function platformSigningKey(): Uint8Array {
  const secret = process.env.PLATFORM_AUTH_SECRET;
  if (!secret) throw new PlatformError("CONFIG_ERROR", "PLATFORM_AUTH_SECRET is not set");
  if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new PlatformError("CONFIG_ERROR", `PLATFORM_AUTH_SECRET must be at least ${MIN_SECRET_BYTES} bytes`);
  }
  if (process.env.AUTH_SECRET && secret === process.env.AUTH_SECRET) {
    throw new PlatformError("CONFIG_ERROR", "PLATFORM_AUTH_SECRET must differ from the customer AUTH_SECRET");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Keyed, purpose-separated digest (HMAC-SHA-256 under a sub-key derived from the platform secret).
 * Used for throttle keys so submitted e-mails and client IPs are never stored in plaintext.
 */
export function platformKeyedDigest(purpose: "login-email" | "login-ip", value: string): string {
  const subKey = createHmac("sha256", platformSigningKey()).update(`elite-erp/platform/${purpose}/v1`).digest();
  return createHmac("sha256", subKey).update(value, "utf8").digest("hex");
}

/** Everything platform authentication needs before it may run at all. */
export function assertPlatformConfiguration(): void {
  platformSigningKey();
  if (!encryptionConfigured()) {
    throw new PlatformError("CONFIG_ERROR", "FIELD_ENCRYPTION_KEYS is not configured (TOTP secrets must be encrypted)");
  }
}
