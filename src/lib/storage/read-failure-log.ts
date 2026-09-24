import "server-only";
import { classifyBlobFailure, BlobReadError, DESTINATION_TOKEN_ENV, SOURCE_TOKEN_ENV, storeIdFromToken } from "./blob-client";

/**
 * One sanitized line for a storage read that FAILED after the request was already authorized.
 *
 * It exists because the /uploads route cannot safely tell the caller anything — it returns 404 for
 * every refusal, which is correct, and which also means an operator watching a Preview cannot tell
 * "this Preview holds no destination token" apart from "this object genuinely is not there". The
 * answer goes to the server log instead of the response.
 *
 * WHAT MAY NEVER APPEAR HERE: a token, AUTH_SECRET, a session cookie, an Authorization header, a
 * DATABASE_URL, a password, a signature, request headers, or any environment VALUE. Store ids are
 * included deliberately — Batch 3 already treats them as non-secret (they are the public part of a
 * provider hostname, and the harness prints them in its safety summary) and they are exactly the
 * fact that distinguishes "pointed at the wrong store" from "the read failed".
 *
 * The underlying error is never printed. An SDK failure can carry the request headers, so it is
 * reduced to a fixed category by classifyBlobFailure() and nothing else survives.
 */
export type StorageReadDiagnostic = {
  event: "upload_storage_read_failed";
  pathname: string;
  folder: string;
  orgId: number;
  category: string;
  failedRole: string;
  destinationTokenConfigured: boolean;
  sourceTokenConfigured: boolean;
  destinationStoreId: string | null;
  sourceStoreId: string | null;
};

/** The store id is the token's 4th underscore-delimited segment; never the token itself. */
function storeIdOf(env: string): string | null {
  const token = process.env[env];
  if (!token) return null;
  try { return storeIdFromToken(token); } catch { return null; }
}

export function buildStorageReadDiagnostic(pathname: string, folder: string, orgId: number, cause: unknown): StorageReadDiagnostic {
  return {
    event: "upload_storage_read_failed",
    pathname,
    folder,
    orgId,
    category: cause instanceof BlobReadError ? cause.category : classifyBlobFailure(cause),
    failedRole: cause instanceof BlobReadError ? cause.role : "unknown",
    destinationTokenConfigured: Boolean(process.env[DESTINATION_TOKEN_ENV]),
    sourceTokenConfigured: Boolean(process.env[SOURCE_TOKEN_ENV]),
    destinationStoreId: storeIdOf(DESTINATION_TOKEN_ENV),
    sourceStoreId: storeIdOf(SOURCE_TOKEN_ENV),
  };
}

export function logStorageReadFailure(pathname: string, folder: string, orgId: number, cause: unknown): void {
  // A single structured line, so Vercel Runtime Logs show one searchable event per failure.
  console.error(JSON.stringify(buildStorageReadDiagnostic(pathname, folder, orgId, cause)));
}
