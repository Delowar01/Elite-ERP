/**
 * Platform Owner PO-01A — disposable test-database helpers for the platform verification suites.
 *
 * Every database created, pushed, migrated or dropped here goes through local-db-guard: the admin
 * connection (PLATFORM_TEST_ADMIN_DATABASE_URL) must itself be a loopback `*_test_only_*` database
 * on a loopback-only server, and every created/dropped database name must carry `_test_only_`.
 * Fictional data only. Connection strings are never printed.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { assertDisposableLocalDatabaseUrl, assertDisposableLocalServer, isDisposableDatabaseName, UnsafeDatabaseTargetError } from "./local-db-guard";
import { applyPlatformSql } from "./apply-platform-sql";

export const ADMIN_URL_ENV = "PLATFORM_TEST_ADMIN_DATABASE_URL";

export function adminUrl(): string {
  const raw = process.env[ADMIN_URL_ENV];
  assertDisposableLocalDatabaseUrl(raw);
  return raw as string;
}

/** Same server/credentials as the admin URL, different (disposable) database. */
export function databaseUrlFor(name: string): string {
  if (!isDisposableDatabaseName(name)) throw new UnsafeDatabaseTargetError("NOT_DISPOSABLE_NAME", `"${name}" is not a disposable name.`);
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

export function disposableName(prefix: string): string {
  const name = `${prefix}_test_only_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  if (!isDisposableDatabaseName(name)) throw new Error(`generated name "${name}" is not disposable`);
  return name;
}

export async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const raw = adminUrl();
  const target = assertDisposableLocalDatabaseUrl(raw);
  const client = new Client({ connectionString: raw });
  await client.connect();
  try {
    await assertDisposableLocalServer(client, target);
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function createDisposableDatabase(name: string): Promise<string> {
  if (!isDisposableDatabaseName(name)) throw new UnsafeDatabaseTargetError("NOT_DISPOSABLE_NAME", `"${name}" is not a disposable name.`);
  await withAdmin((c) => c.query(`create database "${name}"`));
  return databaseUrlFor(name);
}

export async function dropDisposableDatabase(name: string): Promise<void> {
  if (!isDisposableDatabaseName(name)) throw new UnsafeDatabaseTargetError("NOT_DISPOSABLE_NAME", `refusing to drop "${name}".`);
  await withAdmin((c) => c.query(`drop database if exists "${name}" with (force)`));
}

/** Guarded raw client for a disposable database. */
export async function connectDisposable(url: string): Promise<Client> {
  const target = assertDisposableLocalDatabaseUrl(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await assertDisposableLocalServer(client, target);
  } catch (err) {
    await client.end();
    throw err;
  }
  return client;
}

const SCHEMA_DIR = join(process.cwd(), "src", "db", "schema");

/**
 * `drizzle-kit push` into a disposable database.
 *   full        — the branch schema (tenant tables + platform tables), i.e. src/db/schema/index.ts
 *   tenant-only — every schema module except platform.ts: the 621f156 tenant schema shape
 * A throw-away config in the OS temp dir is used so the repository's drizzle.config.ts (which loads
 * .env through dotenv) is never involved; the URL reaches the child only through its environment.
 */
export function pushSchema(url: string, mode: "full" | "tenant-only"): { ok: boolean; output: string } {
  assertDisposableLocalDatabaseUrl(url);
  const files =
    mode === "full"
      ? [join(SCHEMA_DIR, "index.ts")]
      : readdirSync(SCHEMA_DIR)
          .filter((f) => f.endsWith(".ts") && f !== "index.ts" && f !== "platform.ts")
          .sort()
          .map((f) => join(SCHEMA_DIR, f));
  const dir = mkdtempSync(join(tmpdir(), "po01a-drizzle-"));
  const config = join(dir, "drizzle.push.config.ts");
  writeFileSync(
    config,
    `export default { dialect: "postgresql", schema: ${JSON.stringify(files)}, dbCredentials: { url: process.env.DATABASE_URL as string } };\n`,
  );
  try {
    const res = spawnSync(join(process.cwd(), "node_modules", ".bin", "drizzle-kit"), ["push", "--config", config], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      timeout: 300_000,
    });
    const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>");
    return { ok: res.status === 0 && /Changes applied|No changes detected/.test(output), output };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function applyPlatformMigration(url: string): Promise<void> {
  const result = await applyPlatformSql(url);
  if (!result.ok) throw new Error(`platform SQL verification failed: ${result.findings.join("; ")}`);
}

/** Create a disposable DB with the full branch schema + platform SQL (triggers). */
export async function createPlatformTestDatabase(prefix: string, name = disposableName(prefix)): Promise<{ name: string; url: string }> {
  const url = await createDisposableDatabase(name);
  const push = pushSchema(url, "full");
  if (!push.ok) {
    await dropDisposableDatabase(name);
    throw new Error(`drizzle-kit push failed for ${name}:\n${push.output.slice(-2000)}`);
  }
  await applyPlatformMigration(url);
  return { name, url };
}
