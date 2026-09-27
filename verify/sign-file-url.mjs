/**
 * An INDEPENDENT implementation of the signed-file URL, for the test process.
 *
 * Not an import of src/lib/security/signed-url.ts on purpose: a suite that signs with the same
 * function the server verifies with proves only that the code agrees with itself. Re-deriving
 * HMAC-SHA256(`${pathname}:${exp}`) from AUTH_SECRET here means the server's verifier is checked
 * against the scheme rather than against its own output.
 */
import { createHmac } from "node:crypto";

export function signFileUrl(pathname, ttlSeconds) {
  const exp = Math.floor(Date.now() / 1000) + Math.floor(ttlSeconds);
  const sig = createHmac("sha256", process.env.AUTH_SECRET).update(`${pathname}:${exp}`).digest("base64url");
  return `/uploads/${pathname}?exp=${exp}&sig=${sig}`;
}
