/**
 * Platform Owner PO-01A — fail-closed guard for every database operation performed by the
 * platform scripts (SQL apply, catalog check, bootstrap CLI) and their tests.
 *
 * PO-01A is development-only. A target is accepted only when ALL of these hold:
 *   1. URL form   — postgres:// or postgresql://, a single host, no host-override parameters
 *                   (libpq/pg accept `?host=` and friends, which would silently redirect the
 *                   connection), and only an allow-listed set of harmless parameters.
 *   2. Host       — loopback literal: 127.0.0.1, ::1, or localhost.
 *   3. Name       — the database name contains `_test_only_` (explicitly disposable).
 *   4. Server     — after connecting: the server-side address of THIS connection is loopback,
 *                   the server's `listen_addresses` is loopback-only, current_database() still
 *                   carries `_test_only_`, and the server is PostgreSQL >= 14.
 * Anything else throws UnsafeDatabaseTargetError before (1–3) or immediately after (4) the
 * connection is opened; nothing is ever written to a non-qualifying database. The connection
 * string is never printed — only the host and database name are reported.
 */

export class UnsafeDatabaseTargetError extends Error {
  constructor(
    readonly reasonCode:
      | "MISSING_URL"
      | "MALFORMED_URL"
      | "UNSUPPORTED_PROTOCOL"
      | "MULTIPLE_HOSTS"
      | "NON_LOOPBACK_HOST"
      | "FORBIDDEN_PARAMETER"
      | "NOT_DISPOSABLE_NAME"
      | "SERVER_NOT_LOOPBACK"
      | "SERVER_LISTENS_BEYOND_LOOPBACK"
      | "SERVER_DATABASE_MISMATCH"
      | "SERVER_TOO_OLD",
    message: string,
  ) {
    super(message);
    this.name = "UnsafeDatabaseTargetError";
  }
}

export type DisposableTarget = { host: string; port: string; database: string };

export const DISPOSABLE_MARKER = "_test_only_";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const LOOPBACK_SERVER_ADDRESSES = new Set(["127.0.0.1", "::1"]);
const LOOPBACK_LISTEN_ENTRIES = new Set(["127.0.0.1", "::1", "localhost"]);
// Harmless connection parameters. Everything else — notably host, hostaddr, service, options,
// passfile and target_session_attrs — is refused rather than interpreted.
const ALLOWED_PARAMETERS = new Set(["application_name", "connect_timeout", "sslmode"]);
const DATABASE_NAME = /^[a-z0-9_]{1,63}$/;

export function isDisposableDatabaseName(name: string): boolean {
  return DATABASE_NAME.test(name) && name.includes(DISPOSABLE_MARKER);
}

/** Pure URL validation (steps 1–3). Never opens a connection; never echoes the URL. */
export function assertDisposableLocalDatabaseUrl(raw: string | undefined | null): DisposableTarget {
  if (!raw || !raw.trim()) {
    throw new UnsafeDatabaseTargetError("MISSING_URL", "No database URL is set. PO-01A requires an explicit disposable local database.");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeDatabaseTargetError("MALFORMED_URL", "The database URL could not be parsed.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new UnsafeDatabaseTargetError("UNSUPPORTED_PROTOCOL", "Only postgres:// or postgresql:// URLs are accepted.");
  }
  // WHATWG URL keeps "a,b" multi-host lists inside hostname; libpq would try each host in turn.
  if (url.hostname.includes(",") || raw.includes(",")) {
    throw new UnsafeDatabaseTargetError("MULTIPLE_HOSTS", "Multi-host database URLs are refused.");
  }
  if (!url.hostname || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new UnsafeDatabaseTargetError(
      "NON_LOOPBACK_HOST",
      `Refusing non-loopback database host "${url.hostname || "(empty)"}". PO-01A may only use 127.0.0.1, ::1 or localhost.`,
    );
  }
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMETERS.has(key.toLowerCase())) {
      throw new UnsafeDatabaseTargetError("FORBIDDEN_PARAMETER", `Refusing database URL parameter "${key}".`);
    }
  }
  let database: string;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    throw new UnsafeDatabaseTargetError("MALFORMED_URL", "The database name could not be decoded.");
  }
  if (!isDisposableDatabaseName(database)) {
    throw new UnsafeDatabaseTargetError(
      "NOT_DISPOSABLE_NAME",
      `Refusing database "${database || "(none)"}": the name must be lowercase [a-z0-9_] and contain "${DISPOSABLE_MARKER}".`,
    );
  }
  return { host: url.hostname, port: url.port || "5432", database };
}

/** `listen_addresses` must name loopback interfaces only ('*', '0.0.0.0', '::' or any LAN IP fail). */
export function isLoopbackOnlyListenAddresses(value: string): boolean {
  const entries = value
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return entries.length > 0 && entries.every((e) => LOOPBACK_LISTEN_ENTRIES.has(e));
}

type Queryable = { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> };

/** Server-side confirmation (step 4). Call immediately after connecting, before any other query. */
export async function assertDisposableLocalServer(client: Queryable, target: DisposableTarget): Promise<void> {
  const { rows } = await client.query(
    `select current_database() as db,
            host(inet_server_addr()) as addr,
            current_setting('listen_addresses') as listen,
            current_setting('server_version_num')::int as version`,
  );
  const row = rows[0] as { db: string; addr: string | null; listen: string; version: number };
  if (!row || row.db !== target.database || !isDisposableDatabaseName(row.db)) {
    throw new UnsafeDatabaseTargetError("SERVER_DATABASE_MISMATCH", "The connected database is not the requested disposable database.");
  }
  if (!row.addr || !LOOPBACK_SERVER_ADDRESSES.has(row.addr)) {
    throw new UnsafeDatabaseTargetError("SERVER_NOT_LOOPBACK", "The connection does not terminate on a loopback address.");
  }
  if (!isLoopbackOnlyListenAddresses(row.listen)) {
    throw new UnsafeDatabaseTargetError(
      "SERVER_LISTENS_BEYOND_LOOPBACK",
      "The PostgreSQL server listens beyond loopback; PO-01A requires a loopback-only server.",
    );
  }
  if (!(row.version >= 140000)) {
    throw new UnsafeDatabaseTargetError("SERVER_TOO_OLD", "PostgreSQL 14 or newer is required (CREATE OR REPLACE TRIGGER).");
  }
}

export function describeTarget(target: DisposableTarget): string {
  return `${target.database} on ${target.host}:${target.port}`;
}
