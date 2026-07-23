import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Stage 11 Part 3 — signed, expiring file-access URLs.
//
// The private uploads route (/uploads/[folder]/[file]) normally serves a file
// only to a live session whose org matches the filename's orgId prefix. That
// covers in-app <img> rendering. For anywhere a file has to be reachable
// WITHOUT a session cookie — an emailed link, a generated PDF, a short-lived
// share — we mint an HMAC-signed URL that carries its own authorization and a
// hard expiry, so nothing depends on a guessable path alone.
//
// The signature binds folder|file|exp with AUTH_SECRET (HMAC-SHA256). It is not
// an encryption of the file, just a tamper-proof, time-boxed capability token.
// ---------------------------------------------------------------------------

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function sign(pathname: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${pathname}:${exp}`).digest("base64url");
}

const DEFAULT_TTL_SECONDS = 15 * 60;

/** Returns a relative URL (`/uploads/<pathname>?exp=...&sig=...`) valid for `ttlSeconds`.
 *  `pathname` is the tenant-scoped blob pathname, e.g. organizations/1/seals/abc.png. */
export function signFileUrl(pathname: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds));
  const sig = sign(pathname, exp);
  return `/uploads/${pathname}?exp=${exp}&sig=${sig}`;
}

/**
 * Verifies a signed request. Returns true only when the signature matches and
 * the token has not expired. Constant-time comparison; never throws on bad input.
 */
export function verifySignedFile(pathname: string, expRaw: string | null, sigRaw: string | null): boolean {
  if (!expRaw || !sigRaw) return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(pathname, exp);
  const a = Buffer.from(expected);
  const b = Buffer.from(sigRaw);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
