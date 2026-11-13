/**
 * Child-process probe for verify-platform-auth: proves throttle state is durable across processes
 * (a fresh process — as after a restart — sees a block recorded by another). Prints only
 * BLOCKED or OPEN. Guarded: refuses anything but a loopback `_test_only_` database.
 */
import { assertDisposableLocalDatabaseUrl } from "../../scripts/platform/local-db-guard";

assertDisposableLocalDatabaseUrl(process.env.DATABASE_URL);
const { activeLoginBlock, throttleKeys } = await import("../../src/lib/platform/throttle");
const { pool } = await import("../../src/db");
const keys = throttleKeys(String(process.env.PROBE_EMAIL ?? ""), process.env.PROBE_IP || null);
const until = await activeLoginBlock(keys, new Date(Number(process.env.PROBE_NOW_MS)));
console.log(until ? "BLOCKED" : "OPEN");
await pool.end();
