/**
 * The browser-tier runner: `npm run verify:browser`.
 *
 * It exists because the tier had none, and a tier with no runner is not a slowly-decaying asset —
 * it is a set of files that tell you nothing while looking like coverage. Two rounds of evidence in
 * one task: fifteen suites broken by a change to the registration form and shipped un-run, and four
 * suites asserting UI that had been deliberately deleted at some unknown earlier point. Neither was
 * visible because nothing ever executed them together.
 *
 * What it does, in order:
 *
 *   1. Refuses to start if something is already listening on the port, unless --no-server is given.
 *      An already-running server is exactly how a suite ends up driving a stale build.
 *   2. Builds, unless --skip-build.
 *   3. Starts `npm start`, waits for it to answer, and fails loudly if it exited instead (the
 *      EADDRINUSE case that once produced a 20/20 pass against the previous build).
 *   4. Runs every browser suite in series — they register orgs and share one database, so parallel
 *      runs would interleave fixtures.
 *   5. Prints one line per suite with its check count, then a summary, and exits non-zero if any
 *      suite failed.
 *   6. Stops the server it started. A server it did not start is left alone.
 *
 * Flags: --skip-build (reuse .next), --no-server (drive a server you started yourself),
 * --only=<substring> (run a subset while iterating).
 */
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}`);
const value = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const BASE = "http://localhost:3000";
const skipBuild = flag("skip-build");
const noServer = flag("no-server");
const only = value("only");

// Suites that drive the app. Discovered rather than listed, so a new suite is picked up without
// anyone remembering to register it — the same reason the tier rotted in the first place.
const SUITES = readdirSync("verify")
  .filter((f) => f.endsWith(".mjs"))
  .filter((f) => !["assert-fresh-build.mjs", "register-org.mjs", "run-browser-suites.mjs"].includes(f))
  .filter((f) => readFileSync(`verify/${f}`, "utf8").includes("localhost:3000"))
  .filter((f) => !only || f.includes(only))
  .sort();

process.env.DATABASE_URL ||= readFileSync(".env", "utf8")
  .split("\n").find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim();

async function serverAnswers() {
  try {
    const res = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(3000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

let server = null;

async function startServer() {
  if (await serverAnswers()) {
    console.error(
      `\nSomething is already listening on ${BASE}.\n\n` +
        `Refusing to start: a second \`npm start\` would exit with EADDRINUSE and every suite would\n` +
        `silently drive whatever build the existing server is running. Stop it first\n` +
        `(\`pkill -f next-server\`), or pass --no-server if you started it deliberately on the\n` +
        `current build.\n`,
    );
    process.exit(2);
  }

  console.log("• starting the server…");
  // The tier's server always points the rate provider at localhost:12750 (see verify/README.md).
  // Suites that need the happy fetch path host a mock er-api there (verify-rate-oneclick); for
  // every other suite the port is dark, so background rate fetches fail instantly (ECONNREFUSED)
  // instead of hanging on the sandbox's blocked egress — same degraded behaviour, no 5s stalls.
  server = spawn("npm", ["start"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, RATE_API_BASE: process.env.RATE_API_BASE ?? "http://127.0.0.1:12750/v6" },
  });
  let log = "";
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });

  for (let i = 0; i < 60; i++) {
    if (await serverAnswers()) return;
    if (server.exitCode !== null) {
      console.error(`\nThe server exited before answering (code ${server.exitCode}):\n\n${log}\n`);
      process.exit(2);
    }
    await sleep(1000);
  }
  console.error(`\nThe server never answered on ${BASE} within 60s:\n\n${log}\n`);
  stopServer();
  process.exit(2);
}

function stopServer() {
  if (!server) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch { /* already gone */ }
  server = null;
}

// ---------------------------------------------------------------------------------------------

if (SUITES.length === 0) {
  console.error(`No browser suites matched${only ? ` --only=${only}` : ""}.`);
  process.exit(2);
}

// The database is a precondition, not something to discover 23 identical stack traces later. The
// first run of this runner did exactly that: Postgres had stopped, and every suite failed with the
// same ECONNREFUSED, which reads like 23 broken suites rather than one stopped service.
{
  const { Client } = await import("pg");
  const probe = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await probe.connect();
    await probe.end();
  } catch (e) {
    console.error(
      `\nCannot reach the database (${e.code ?? e.message}).\n\n` +
        `Every browser suite creates its own organization, so none of them can run. Start Postgres\n` +
        `and try again — on a Debian-style box that is \`pg_ctlcluster 16 main start\`.\n`,
    );
    process.exit(2);
  }
}

if (!skipBuild) {
  console.log("• building…");
  const build = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
  if (build.status !== 0) {
    console.error("\nBuild failed — not running the browser suites against a stale .next.");
    process.exit(2);
  }
}

if (!noServer) await startServer();
else if (!(await serverAnswers())) {
  console.error(`--no-server was given but nothing is answering on ${BASE}.`);
  process.exit(2);
}

console.log(`\nRunning ${SUITES.length} browser suites in series.\n`);

const results = [];
for (const suite of SUITES) {
  const started = Date.now();
  const run = spawnSync("node", [`verify/${suite}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  // Suites print "N/M checks"; the two import-style ones print only a verdict line.
  const counts = out.match(/(\d+)\/(\d+) checks/);
  const failures = [...out.matchAll(/^(?:FAIL|\s*✗ FAIL)\s+(.*)$/gm)].map((m) => m[1].trim());
  const ok = run.status === 0;
  results.push({ suite, ok, counts: counts?.[0] ?? null, failures, out, secs: ((Date.now() - started) / 1000).toFixed(0) });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${suite.padEnd(38)} ${(counts?.[0] ?? "").padEnd(14)} ${results.at(-1).secs}s`,
  );
}

if (!noServer) stopServer();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} suites passed.`);

for (const r of failed) {
  console.log(`\n--- ${r.suite} ---`);
  if (r.failures.length) for (const f of r.failures.slice(0, 12)) console.log(`  ✗ ${f}`);
  else console.log(r.out.split("\n").slice(-18).join("\n"));
}

process.exit(failed.length === 0 ? 0 : 1);
