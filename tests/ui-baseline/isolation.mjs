/**
 * DEV-UI-01.0 — database isolation for the visual baseline.
 *
 * The baseline harness drives a real `next start` server, and that server reads DATABASE_URL. This
 * module is the single place that decides which database that is, and it refuses rather than
 * guesses:
 *
 *   - The ONLY input is UI_BASELINE_ADMIN_URL. The repository's own DATABASE_URL (shell or .env) is
 *     never read as a target, never used as a fallback, and is refused if it is the same database.
 *   - The host must be loopback. A remote host is refused outright — there is no flag to allow it.
 *   - Every database the harness creates, drops or serves is named `devui010_test_only_*`. Anything
 *     else is refused before a connection is opened.
 *   - The server process gets EVERY key the repository's .env defines explicitly overridden, so
 *     Next.js's automatic .env loading (which never overrides an already-set variable) contributes
 *     nothing. The harness checks this by key name; values in .env are never read or printed.
 *
 * Nothing here prints a password. `describe()` prints user@host:port/db only.
 */
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

export const DB_PREFIX = "devui010_test_only_";
export const TEMPLATE_DB = `${DB_PREFIX}seed`;
export const RUN_DB = `${DB_PREFIX}run`;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export class IsolationError extends Error {}

export function adminUrl() {
  const raw = process.env.UI_BASELINE_ADMIN_URL;
  if (!raw) {
    throw new IsolationError(
      "UI_BASELINE_ADMIN_URL is not set. The visual baseline needs a disposable, LOCAL PostgreSQL role\n" +
        "with CREATEDB. It never falls back to DATABASE_URL. See tests/ui-baseline/README.md.",
    );
  }
  const u = new URL(raw);
  if (!LOOPBACK.has(u.hostname)) throw new IsolationError(`refusing non-local database host '${u.hostname}'`);
  return u;
}

export function dbUrl(name) {
  if (!name.startsWith(DB_PREFIX)) throw new IsolationError(`refusing database '${name}': not a ${DB_PREFIX}* database`);
  const u = adminUrl();
  u.pathname = `/${name}`;
  return u.toString();
}

export function describe(url) {
  const u = new URL(url);
  return `${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}`;
}

/** Key names the repository .env defines — names only, values are never read into memory here. */
export function dotenvKeys() {
  if (!existsSync(".env")) return [];
  return readFileSync(".env", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => l.slice(0, l.indexOf("=")).replace(/^export\s+/, "").trim());
}

/** The repository's configured database identity (host/port/db), so the harness can refuse it. */
function repoDatabaseIdentity() {
  const fromShell = process.env.DATABASE_URL;
  let raw = fromShell;
  if (!raw && existsSync(".env")) {
    const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
    raw = line?.slice("DATABASE_URL=".length).trim();
  }
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * The complete environment for the baseline server. Every .env key is overridden; the result is
 * checked so a key added to .env later cannot leak through silently.
 */
export function serverEnv({ frozenNow, storageDir }) {
  const url = dbUrl(RUN_DB);
  const target = new URL(url);
  const repo = repoDatabaseIdentity();
  if (repo && repo === `${target.hostname}:${target.port || 5432}${target.pathname}`) {
    throw new IsolationError("refusing: the baseline database is the repository's own DATABASE_URL database");
  }

  const overrides = {
    DATABASE_URL: url,
    // Fresh per run, never written anywhere. Nothing rendered depends on these values.
    AUTH_SECRET: randomBytes(32).toString("hex"),
    FIELD_ENCRYPTION_KEYS: `1:${randomBytes(32).toString("base64")}`,
    STORAGE_DRIVER: "fake",
    STORAGE_FAKE_DIR: storageDir,
    STORAGE_FAKE_SOURCE: "0",
    // The dashboard fires a background exchange-rate fetch. Pointed at a closed local port so it
    // fails instantly and never reaches the network (same convention as verify:browser).
    RATE_API_BASE: "http://127.0.0.1:12750/v6",
    UI_BASELINE_FROZEN_NOW: frozenNow,
    TZ: "UTC",
    NEXT_TELEMETRY_DISABLED: "1",
  };

  const missing = dotenvKeys().filter((k) => !(k in overrides));
  if (missing.length) {
    throw new IsolationError(
      `refusing: .env defines ${missing.join(", ")} which the baseline does not override — the server would inherit it`,
    );
  }

  const env = { ...process.env, ...overrides };
  delete env.UI_BASELINE_ADMIN_URL; // the server never needs the admin credential
  return env;
}
