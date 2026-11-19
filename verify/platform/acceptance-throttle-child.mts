/**
 * PO-02D3 test helper (verify:platform-invitation-acceptance, A26): a SEPARATE Node.js process that asks the durable
 * acceptance throttle whether an IP is blocked. It shares nothing with the suite but the database (DATABASE_URL) and the
 * platform key (PLATFORM_AUTH_SECRET) from its environment, so a "blocked" answer proves the state is in PostgreSQL —
 * not in a process. Prints one JSON line; never prints a key, a digest or a URL.
 *   tsx --conditions=react-server verify/platform/acceptance-throttle-child.mts <ip> <now ISO>
 */
const [ip, nowIso] = process.argv.slice(2);
const { acceptanceThrottleKeys, activeAcceptanceBlock } = await import("../../src/lib/platform/acceptance-throttle");
const { pool } = await import("../../src/db");
const until = await activeAcceptanceBlock(acceptanceThrottleKeys(null, ip), new Date(nowIso));
console.log(JSON.stringify({ blocked: until !== null }));
await pool.end();
