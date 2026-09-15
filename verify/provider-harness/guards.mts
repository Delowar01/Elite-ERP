/**
 * Arming and identity guards for the real-provider harness.
 *
 * EVERY CHECK HERE RUNS BEFORE THE FIRST WRITE. The harness holds live read-write credentials for
 * two Blob stores and a database; if the operator points it at the wrong ones it will happily
 * create objects and rows in production. So it refuses to start unless the resources it was handed
 * match, exactly, the identities the operator declared in advance.
 *
 * The declaration is the safety mechanism, not a confirmation prompt: the operator has to name the
 * store ids and the database up front, and the harness compares what it actually holds against
 * that. Typing "yes" at a prompt proves nothing about which store a token addresses.
 */
import { redact, say } from "./redact.mjs";

export const ARMING_VALUE = "YES_I_AM_USING_DISPOSABLE_RESOURCES";

export type Identities = {
  previewBaseUrl: string;
  privateStoreId: string;
  publicStoreId: string;
  dbHost: string;
  dbName: string;
  dbUser: string;
  expectedCommitSha: string;
  previewShaVerifiedExternally: boolean;
};

export class ArmingError extends Error {}

const required = (name: string): string => {
  const v = process.env[name];
  if (!v || !v.trim()) throw new ArmingError(`${name} is not set`);
  return v.trim();
};

/** storeId is the 4th underscore-separated segment of a read-write token — never the token itself. */
export function storeIdFromToken(token: string, label: string): string {
  const id = token.split("_")[3];
  if (!id) throw new ArmingError(`${label} is malformed: no store id could be extracted`);
  return id;
}

/** Parse a Postgres URL for its NON-SECRET identity. The password is never read out. */
export function dbIdentity(url: string): { host: string; name: string; user: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ArmingError("DATABASE_URL is not a parseable URL");
  }
  return { host: u.hostname, name: u.pathname.replace(/^\//, ""), user: decodeURIComponent(u.username) };
}

/**
 * Run every guard. Throws ArmingError on the first failure, before any resource is touched.
 * Returns the sanitized identities for the report.
 */
export function armOrRefuse(): Identities {
  // 1. Explicit arming. Not a default, not a boolean, not inferable from a typo.
  const arming = process.env.BATCH3_PROVIDER_TEST;
  if (arming !== ARMING_VALUE) {
    throw new ArmingError(`BATCH3_PROVIDER_TEST must be exactly "${ARMING_VALUE}" — refusing to run`);
  }

  // 2. Never against a production environment.
  if (process.env.VERCEL_ENV === "production") {
    throw new ArmingError("VERCEL_ENV=production — this harness must never run against Production");
  }
  if (process.env.STORAGE_DRIVER === "fake") {
    throw new ArmingError("STORAGE_DRIVER=fake — this harness is for REAL provider verification; the fake driver would produce worthless evidence");
  }

  const previewBaseUrl = required("BATCH3_PREVIEW_BASE_URL");
  const expectedCommitSha = required("BATCH3_EXPECT_COMMIT_SHA");
  if (!/^[0-9a-f]{40}$/.test(expectedCommitSha)) throw new ArmingError("BATCH3_EXPECT_COMMIT_SHA must be a full 40-character commit sha");

  // 3. Store identity. Derived from the tokens themselves and compared to what the operator
  //    declared, so a token pasted into the wrong variable is caught rather than used.
  const privateToken = required("BLOB_READ_WRITE_TOKEN");
  const publicToken = required("BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN");
  const privateStoreId = storeIdFromToken(privateToken, "BLOB_READ_WRITE_TOKEN");
  const publicStoreId = storeIdFromToken(publicToken, "BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN");
  const expectPrivate = required("BATCH3_EXPECT_PRIVATE_STORE_ID");
  const expectPublic = required("BATCH3_EXPECT_PUBLIC_STORE_ID");

  if (privateStoreId !== expectPrivate) throw new ArmingError(`the private token addresses store "${privateStoreId}", not the declared "${expectPrivate}" — refusing before any write`);
  if (publicStoreId !== expectPublic) throw new ArmingError(`the public token addresses store "${publicStoreId}", not the declared "${expectPublic}" — refusing before any write`);
  // Two tokens for ONE store would silently turn every cross-store proof into a same-store no-op.
  if (privateStoreId === publicStoreId) throw new ArmingError(`both tokens address the SAME store "${privateStoreId}" — the two-store model cannot be verified against one store`);

  // 4. Database identity, from the non-secret parts only.
  const db = dbIdentity(required("DATABASE_URL"));
  const expectHost = required("BATCH3_EXPECT_DB_HOST");
  const expectName = required("BATCH3_EXPECT_DB_NAME");
  if (db.host !== expectHost) throw new ArmingError(`DATABASE_URL host is "${db.host}", not the declared "${expectHost}" — refusing before any write`);
  if (db.name !== expectName) throw new ArmingError(`DATABASE_URL database is "${db.name}", not the declared "${expectName}" — refusing before any write`);
  const expectUser = process.env.BATCH3_EXPECT_DB_USER;
  if (expectUser && db.user !== expectUser) throw new ArmingError(`DATABASE_URL user is "${db.user}", not the declared "${expectUser}"`);

  // 5. Preview identity. A production hostname is rejected when one can be determined; when it
  //    cannot, the limitation is stated rather than papered over.
  const knownProdHost = process.env.BATCH3_KNOWN_PRODUCTION_HOST;
  if (knownProdHost && previewBaseUrl.includes(knownProdHost)) {
    throw new ArmingError(`BATCH3_PREVIEW_BASE_URL points at the known production host "${knownProdHost}"`);
  }

  // 6. The Preview's commit. Nothing in the application exposes its git sha, and this harness will
  //    NOT add a public debug endpoint to obtain one — that would be a permanent hole opened for a
  //    one-off test. So the operator attests to it and the report records that it was verified
  //    externally rather than claiming an automatic proof.
  const attested = process.env.BATCH3_PREVIEW_SHA_VERIFIED_EXTERNALLY === "YES";
  if (!attested) {
    throw new ArmingError(
      "BATCH3_PREVIEW_SHA_VERIFIED_EXTERNALLY=YES is required.\n" +
      `Confirm in the Vercel dashboard that the Preview at ${previewBaseUrl} was built from ${expectedCommitSha}, then set it.\n` +
      "This harness deliberately does not add an endpoint to read the deployment's commit.",
    );
  }

  return { previewBaseUrl, privateStoreId, publicStoreId, dbHost: db.host, dbName: db.name, dbUser: db.user, expectedCommitSha, previewShaVerifiedExternally: attested };
}

/** The sanitized summary printed before anything is written. */
export function printSafetySummary(id: Identities): void {
  say("──────── BATCH 3 REAL-PROVIDER VERIFICATION — SAFETY SUMMARY ────────");
  say(`  Preview URL       : ${id.previewBaseUrl}`);
  say(`  Private store ID  : ${id.privateStoreId}`);
  say(`  Public store ID   : ${id.publicStoreId}`);
  say(`  DB host           : ${id.dbHost}`);
  say(`  DB name           : ${id.dbName}`);
  say(`  DB user           : ${id.dbUser}`);
  say(`  Expected commit   : ${id.expectedCommitSha}`);
  say(`  Preview SHA proof : ${id.previewShaVerifiedExternally ? "PREVIEW_SHA_VERIFIED_EXTERNALLY (operator attestation)" : "NONE"}`);
  say(`  Production mode   : FALSE`);
  say("  (no token, password or connection string is printed by this harness)");
  say("─────────────────────────────────────────────────────────────────────");
}

export function reportArmingFailure(e: unknown): never {
  console.error(`REFUSING TO RUN: ${redact(e instanceof Error ? e.message : e)}`);
  process.exit(1);
}
