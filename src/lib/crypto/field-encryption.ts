import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Stage 11 Part 2 — server-side field-level encryption (AES-256-GCM).
//
// Storage format:  v<keyVersion>:<iv_b64>:<authTag_b64>:<ciphertext_b64>
// The version prefix makes key ROTATION safe: old values decrypt with their
// original key; new writes use the current key. Keys never leave the server
// and are never hardcoded — they come from FIELD_ENCRYPTION_KEYS.
//
// FIELD_ENCRYPTION_KEYS is a comma-separated list of "version:base64key(32B)".
// The FIRST entry is the current write key; all entries are available for read.
// Example: FIELD_ENCRYPTION_KEYS="2:<newkey>,1:<oldkey>"
// ---------------------------------------------------------------------------

type KeyRing = { current: { version: number; key: Buffer }; byVersion: Map<number, Buffer> };

let cached: KeyRing | null = null;

function loadKeyRing(): KeyRing {
  if (cached) return cached;
  const raw = process.env.FIELD_ENCRYPTION_KEYS;
  if (!raw) throw new Error("FIELD_ENCRYPTION_KEYS environment variable is not set");

  const byVersion = new Map<number, Buffer>();
  let current: { version: number; key: Buffer } | null = null;
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx < 0) throw new Error("FIELD_ENCRYPTION_KEYS entries must be 'version:base64key'");
    const version = Number(trimmed.slice(0, idx));
    const key = Buffer.from(trimmed.slice(idx + 1), "base64");
    if (!Number.isInteger(version) || version < 1) throw new Error("FIELD_ENCRYPTION_KEYS: invalid version");
    if (key.length !== 32) throw new Error("FIELD_ENCRYPTION_KEYS: each key must be 32 bytes (base64-encoded)");
    byVersion.set(version, key);
    if (current === null) current = { version, key };
  }
  if (!current) throw new Error("FIELD_ENCRYPTION_KEYS contained no usable keys");
  cached = { current, byVersion };
  return cached;
}

/** Whether encryption is configured. Lets callers degrade gracefully in dev if a key isn't set. */
export function encryptionConfigured(): boolean {
  return Boolean(process.env.FIELD_ENCRYPTION_KEYS);
}

/** Encrypt a UTF-8 string. Returns the versioned envelope, or null for null/empty input. */
export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  const { current } = loadKeyRing();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", current.key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v${current.version}:${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/** Decrypt a versioned envelope back to its UTF-8 string. Returns null for null input. */
export function decryptField(envelope: string | null | undefined): string | null {
  if (envelope === null || envelope === undefined || envelope === "") return null;
  const parts = envelope.split(":");
  if (parts.length !== 4 || !parts[0].startsWith("v")) {
    // Not an encrypted envelope (e.g. legacy plaintext written before encryption existed).
    // Returning it as-is keeps reads backward-compatible; a re-save will encrypt it.
    return envelope;
  }
  const version = Number(parts[0].slice(1));
  const { byVersion } = loadKeyRing();
  const key = byVersion.get(version);
  if (!key) throw new Error(`No encryption key available for version ${version}`);
  const iv = Buffer.from(parts[1], "base64");
  const authTag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/** True if the value is already a versioned ciphertext envelope. */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(":");
  return parts.length === 4 && /^v\d+$/.test(parts[0]);
}

/** Mask a value for display, keeping only the last `visible` characters. */
export function maskValue(plaintext: string | null | undefined, visible = 4): string {
  if (!plaintext) return "";
  if (plaintext.length <= visible) return "•".repeat(plaintext.length);
  return "•".repeat(Math.max(4, plaintext.length - visible)) + plaintext.slice(-visible);
}
