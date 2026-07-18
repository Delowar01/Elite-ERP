import "server-only";
import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// Stage 11 Part 1 — configurable enterprise password policy + common-password
// detection + reuse (history) checks. Policy is per-org (orgs.pwd* columns).
// ---------------------------------------------------------------------------

export type PasswordPolicy = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
  historyCount: number;
  expiryDays: number;
};

export const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
  historyCount: 5,
  expiryDays: 0,
};

// A compact blocklist of the most-abused passwords + obvious app-specific weak choices.
// Kept small and in-memory (no dependency); the substring check below catches the
// "Password1!" family that a naive exact-match list would miss.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd", "123456", "12345678", "123456789",
  "qwerty", "qwerty123", "111111", "000000", "abc123", "letmein", "welcome", "admin",
  "admin123", "iloveyou", "monkey", "dragon", "sunshine", "princess", "football",
  "changeme", "secret", "master", "test1234", "elite", "eliteerp", "erp12345",
]);

function normalize(pw: string): string {
  // Fold common leet substitutions so "P@ssw0rd" is caught by the base word.
  return pw.toLowerCase().replace(/@/g, "a").replace(/0/g, "o").replace(/1/g, "i").replace(/\$/g, "s").replace(/3/g, "e");
}

export function isCommonPassword(password: string): boolean {
  const norm = normalize(password);
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || COMMON_PASSWORDS.has(norm)) return true;
  // Substring match against the base words for the "<common>+digits+symbol" pattern.
  for (const common of COMMON_PASSWORDS) {
    if (common.length >= 5 && norm.includes(common)) return true;
  }
  return false;
}

/** Validate against a policy. Returns an array of human-readable failures (empty = ok). */
export function validatePassword(password: string, policy: PasswordPolicy): string[] {
  const errors: string[] = [];
  if (password.length < policy.minLength) errors.push(`Must be at least ${policy.minLength} characters.`);
  if (policy.requireUppercase && !/[A-Z]/.test(password)) errors.push("Must include an uppercase letter.");
  if (policy.requireLowercase && !/[a-z]/.test(password)) errors.push("Must include a lowercase letter.");
  if (policy.requireNumber && !/[0-9]/.test(password)) errors.push("Must include a number.");
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) errors.push("Must include a special character.");
  if (isCommonPassword(password)) errors.push("This password is too common. Choose something less guessable.");
  return errors;
}

/** Rough 0–4 strength score for the meter UI. */
export function passwordStrength(password: string): number {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  if (isCommonPassword(password)) score = Math.min(score, 1);
  return Math.min(4, score);
}

/** True if the new password matches any of the recent hashes (reuse prevention). */
export async function isPasswordReused(newPassword: string, recentHashes: string[]): Promise<boolean> {
  for (const hash of recentHashes) {
    if (await bcrypt.compare(newPassword, hash)) return true;
  }
  return false;
}

/** True if a password set at `changedAt` is expired under `expiryDays` (0 = never). */
export function isPasswordExpired(changedAt: Date, expiryDays: number): boolean {
  if (!expiryDays || expiryDays <= 0) return false;
  const ageMs = Date.now() - changedAt.getTime();
  return ageMs > expiryDays * 24 * 60 * 60 * 1000;
}
