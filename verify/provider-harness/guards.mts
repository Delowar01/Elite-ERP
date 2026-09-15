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
  previewHost: string;
  declaredProductionHosts: string[];
  signingSecretAttested: boolean;
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

/** Lowercased, trimmed, without a trailing dot, a scheme, a port or a path. */
function normalizeHost(raw: string): string {
  let h = raw.trim().toLowerCase();
  if (!h) return "";
  if (h.includes("://")) { try { h = new URL(h).hostname; } catch { return ""; } }
  else { h = h.split("/")[0].split("@").pop() ?? ""; h = h.replace(/:\d+$/, ""); }
  return h.replace(/\.$/, "");
}

function hostnameOf(url: string, label: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ArmingError(`${label} is not a valid URL`); }
  const host = normalizeHost(parsed.hostname);
  if (!host) throw new ArmingError(`${label} has no hostname`);
  return host;
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

  // 5. Preview identity — MANDATORY, and compared as a hostname rather than as a substring.
  //
  //    The disposable tokens and the disposable DATABASE_URL protect what this PROCESS touches.
  //    They do not protect what the remote application touches: /register and every browser action
  //    run inside the deployment at BATCH3_PREVIEW_BASE_URL, using ITS environment. If that URL is
  //    Production, the run writes to the production database with production credentials and no
  //    guard in this file is anywhere near it. So the production host must be declared, every time.
  //
  //    Substring matching would be both too weak and too strong: "erp.example.com" is contained in
  //    "not-erp.example.com.evil.test" and does not contain "www.erp.example.com". Hostnames are
  //    compared exactly, after normalization.
  const previewHost = hostnameOf(previewBaseUrl, "BATCH3_PREVIEW_BASE_URL");
  if (!previewBaseUrl.startsWith("https://")) {
    throw new ArmingError(`BATCH3_PREVIEW_BASE_URL must be https:// — got "${previewBaseUrl.split("://")[0]}://"`);
  }
  const prodHostsRaw = process.env.BATCH3_KNOWN_PRODUCTION_HOST;
  if (!prodHostsRaw || !prodHostsRaw.trim()) {
    throw new ArmingError(
      "BATCH3_KNOWN_PRODUCTION_HOST is required for every armed run.\n" +
      "Browser actions execute inside the deployment at BATCH3_PREVIEW_BASE_URL, using that\n" +
      "deployment's own environment — so a Preview URL that is really Production would write to the\n" +
      "production database no matter how disposable this process's own credentials are.\n" +
      "Declare every production hostname (comma- or semicolon-separated if there are several,\n" +
      "including custom domains).",
    );
  }
  const prodHosts = prodHostsRaw.split(/[;,]/).map((h) => normalizeHost(h)).filter(Boolean);
  if (!prodHosts.length) throw new ArmingError("BATCH3_KNOWN_PRODUCTION_HOST contained no usable hostname");
  if (prodHosts.includes(previewHost)) {
    throw new ArmingError(`BATCH3_PREVIEW_BASE_URL resolves to the declared production host "${previewHost}" — refusing`);
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

  // The harness mints signatures LOCALLY with AUTH_SECRET and sends them to the remote Preview. If
  // the two secrets differ, every signed-access assertion fails for a configuration reason and would
  // be read as an application defect. The secret itself is never compared or printed — the operator
  // attests, and the report says so.
  if (process.env.BATCH3_SIGNING_SECRET_MATCHES_PREVIEW !== "YES") {
    throw new ArmingError(
      "BATCH3_SIGNING_SECRET_MATCHES_PREVIEW=YES is required.\n" +
      "The signed-access section signs locally with AUTH_SECRET and verifies remotely on the Preview;\n" +
      "if those secrets differ the results are meaningless. Confirm they match, then set it.",
    );
  }

  return { previewBaseUrl, previewHost, declaredProductionHosts: prodHosts, privateStoreId, publicStoreId, dbHost: db.host, dbName: db.name, dbUser: db.user, expectedCommitSha, previewShaVerifiedExternally: attested, signingSecretAttested: true };
}

/** The sanitized summary printed before anything is written. */
export function printSafetySummary(id: Identities): void {
  say("──────── BATCH 3 REAL-PROVIDER VERIFICATION — SAFETY SUMMARY ────────");
  say(`  Preview URL       : ${id.previewBaseUrl}`);
  say(`  Preview host      : ${id.previewHost}`);
  say(`  Production hosts  : ${id.declaredProductionHosts.join(", ")} (declared; none may equal the Preview host)`);
  say(`  Private store ID  : ${id.privateStoreId}`);
  say(`  Public store ID   : ${id.publicStoreId}`);
  say(`  DB host           : ${id.dbHost}`);
  say(`  DB name           : ${id.dbName}`);
  say(`  DB user           : ${id.dbUser}`);
  say(`  Expected commit   : ${id.expectedCommitSha}`);
  say(`  Preview SHA proof : ${id.previewShaVerifiedExternally ? "PREVIEW_SHA_VERIFIED_EXTERNALLY (operator attestation)" : "NONE"}`);
  say(`  Signing secret    : ${id.signingSecretAttested ? "BATCH3_SIGNING_SECRET_MATCHES_PREVIEW (operator attestation)" : "NOT ATTESTED"}`);
  say(`  Production mode   : FALSE`);
  say("  (no token, password or connection string is printed by this harness)");
  say("─────────────────────────────────────────────────────────────────────");
}

export function reportArmingFailure(e: unknown): never {
  console.error(`REFUSING TO RUN: ${redact(e instanceof Error ? e.message : e)}`);
  process.exit(1);
}
