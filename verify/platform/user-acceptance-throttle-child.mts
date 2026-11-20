/**
 * PO-03D test helper (verify:platform-user-acceptance, H3): a SEPARATE Node.js process that uses the durable throttle of
 * the public USER-invitation acceptance endpoint. It shares nothing with the suite but the database (DATABASE_URL) and the
 * platform key (PLATFORM_AUTH_SECRET) from its environment, so its answers prove the state is in PostgreSQL — not in a
 * process. Prints one JSON line; never prints a key, a digest or a URL.
 *   tsx --conditions=react-server verify/platform/user-acceptance-throttle-child.mts probe <ip> <now ISO>
 *   tsx --conditions=react-server verify/platform/user-acceptance-throttle-child.mts fail <ip> <now ISO> <count>
 */
const [mode, ip, nowIso, countText] = process.argv.slice(2);
const { activeAcceptanceBlock, recordAcceptanceAttempt } = await import("../../src/lib/platform/acceptance-throttle");
const { userAcceptanceThrottleKeys } = await import("../../src/lib/platform/user-invitation-acceptance");
const { pool } = await import("../../src/db");
const keys = userAcceptanceThrottleKeys(null, ip);
const now = new Date(nowIso);
if (mode === "fail") {
  let blocked = 0;
  for (let i = 0; i < Number(countText); i++) if ((await recordAcceptanceAttempt(keys, "failure", now)).blockedUntil) blocked++;
  console.log(JSON.stringify({ recorded: Number(countText), blockedAnswers: blocked }));
} else {
  console.log(JSON.stringify({ blocked: (await activeAcceptanceBlock(keys, now)) !== null }));
}
await pool.end();
