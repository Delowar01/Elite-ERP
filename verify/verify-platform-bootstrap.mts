/**
 * Platform Owner PO-01A — bootstrap CLI and database-target guard suite.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-bootstrap
 *
 * Fictional administrators only. Interactive answers are scripted through the injected I/O;
 * everything the bootstrap "shows once" (provisioning URI, manual key, recovery codes) is captured
 * in memory for assertions and NEVER printed.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  assertDisposableLocalDatabaseUrl,
  assertDisposableLocalServer,
  isLoopbackOnlyListenAddresses,
  UnsafeDatabaseTargetError,
} from "../scripts/platform/local-db-guard";
import { createDisposableDatabase, createPlatformTestDatabase, disposableName, dropDisposableDatabase, pushSchema } from "../scripts/platform/disposable-db";
import { section, ok, rejects, summary, describeError } from "./platform/harness";

const reason = (code: string) => (e: unknown) => e instanceof UnsafeDatabaseTargetError && e.reasonCode === code;

section("1. Database-target guard (pure, no connection)");
const refusals: [string, string, string][] = [
  ["Neon-like remote host", "postgres://app@ep-fictional-123.eu-central-1.aws.neon.tech/neondb_test_only_x?sslmode=require", "NON_LOOPBACK_HOST"],
  ["LAN address", "postgres://u@10.0.0.5:5432/x_test_only_y", "NON_LOOPBACK_HOST"],
  ["IPv6 non-loopback", "postgres://u@[2001:db8::1]:5432/x_test_only_y", "NON_LOOPBACK_HOST"],
  ["loopback look-alike hostname", "postgres://u@127.0.0.1.nip.io/x_test_only_y", "NON_LOOPBACK_HOST"],
  ["localhost subdomain", "postgres://u@localhost.example.com/x_test_only_y", "NON_LOOPBACK_HOST"],
  ["empty host (socket default)", "postgres:///x_test_only_y", "NON_LOOPBACK_HOST"],
  ["?host= override", "postgres://u@127.0.0.1/x_test_only_y?host=/var/run/postgresql", "FORBIDDEN_PARAMETER"],
  ["?hostaddr= override", "postgres://u@127.0.0.1/x_test_only_y?hostaddr=10.0.0.5", "FORBIDDEN_PARAMETER"],
  ["?options= injection", "postgres://u@127.0.0.1/x_test_only_y?options=-c%20search_path%3Devil", "FORBIDDEN_PARAMETER"],
  ["multi-host list", "postgres://u@127.0.0.1,10.0.0.5/x_test_only_y", "MULTIPLE_HOSTS"],
  ["production-style name on loopback", "postgres://u@127.0.0.1:5432/elite_erp", "NOT_DISPOSABLE_NAME"],
  ["marker in the wrong place (suffix only)", "postgres://u@127.0.0.1:5432/elite_erp_test_only", "NOT_DISPOSABLE_NAME"],
  ["uppercase name", "postgres://u@127.0.0.1:5432/X_test_only_Y", "NOT_DISPOSABLE_NAME"],
  ["mysql protocol", "mysql://u@127.0.0.1/x_test_only_y", "UNSUPPORTED_PROTOCOL"],
  ["missing URL", "", "MISSING_URL"],
];
for (const [name, url, code] of refusals) {
  await rejects(`refuses ${name} [${code}]`, async () => assertDisposableLocalDatabaseUrl(url), reason(code));
}
for (const url of ["postgres://u@127.0.0.1:55432/a_test_only_b", "postgresql://u@localhost/a_test_only_b", "postgres://u@[::1]:5432/a_test_only_b?application_name=po01a"]) {
  ok(`accepts ${url.replace(/\/\/[^@]*@/, "//…@")}`, assertDisposableLocalDatabaseUrl(url).database === "a_test_only_b");
}
ok("listen_addresses: loopback-only values accepted", ["127.0.0.1", "localhost", "127.0.0.1,::1", " ::1 , localhost "].every(isLoopbackOnlyListenAddresses));
ok("listen_addresses: '*', 0.0.0.0, :: and LAN values refused", !["*", "0.0.0.0", "::", "127.0.0.1,10.0.0.2", ""].some(isLoopbackOnlyListenAddresses));
const target = { host: "127.0.0.1", port: "5432", database: "a_test_only_b" };
const fakeServer = (row: Record<string, unknown>) => ({ query: async () => ({ rows: [row] }) });
const base = { db: "a_test_only_b", addr: "127.0.0.1", listen: "127.0.0.1", version: 160000 };
await rejects("server listening on '*' refused after connect", () => assertDisposableLocalServer(fakeServer({ ...base, listen: "*" }), target), reason("SERVER_LISTENS_BEYOND_LOOPBACK"));
await rejects("non-loopback server address refused", () => assertDisposableLocalServer(fakeServer({ ...base, addr: "10.0.0.5" }), target), reason("SERVER_NOT_LOOPBACK"));
await rejects("unix-socket connection (no server address) refused", () => assertDisposableLocalServer(fakeServer({ ...base, addr: null }), target), reason("SERVER_NOT_LOOPBACK"));
await rejects("connected database differing from the requested one refused", () => assertDisposableLocalServer(fakeServer({ ...base, db: "elite_erp" }), target), reason("SERVER_DATABASE_MISMATCH"));
await rejects("PostgreSQL 13 refused", () => assertDisposableLocalServer(fakeServer({ ...base, version: 130000 }), target), reason("SERVER_TOO_OLD"));

// ---- databases (created inside main's try/finally, so a failure leaks nothing) ---------------
const ready = { name: disposableName("po01a_boot"), url: "" };
const notReadyName = disposableName("po01a_boot_nr");
let notReadyUrl = "";
const createdNames: string[] = [];

const SECRET_ENV = {
  PLATFORM_AUTH_SECRET: randomBytes(48).toString("base64url"),
  AUTH_SECRET: randomBytes(48).toString("base64url"),
  FIELD_ENCRYPTION_KEYS: `1:${randomBytes(32).toString("base64")}`,
};

function cli(env: Record<string, string | undefined>): { status: number | null; stderr: string; stdout: string } {
  const res = spawnSync(join(process.cwd(), "node_modules", ".bin", "tsx"), ["--conditions=react-server", "scripts/platform/bootstrap.ts"], {
    cwd: process.cwd(),
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    input: "",
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: res.status, stderr: res.stderr ?? "", stdout: res.stdout ?? "" };
}
const adminCount = async () => {
  const { connectDisposable } = await import("../scripts/platform/disposable-db");
  const c = await connectDisposable(ready.url);
  try {
    return ((await c.query("select count(*)::int as n from platform_admins")).rows[0] as { n: number }).n;
  } finally {
    await c.end();
  }
};

async function main() {
  createdNames.push(ready.name);
  ready.url = (await createPlatformTestDatabase("po01a_boot", ready.name)).url;
  createdNames.push(notReadyName);
  notReadyUrl = await createDisposableDatabase(notReadyName);
  const notReadyPush = pushSchema(notReadyUrl, "full");

  section("2. CLI refuses unsafe targets and unready databases (exit codes)");
  for (const [name, url] of [
    ["remote (Neon-like) URL", "postgres://app@ep-fictional-123.eu-central-1.aws.neon.tech/neondb_test_only_x"],
    ["non-disposable local name", "postgres://postgres@127.0.0.1:55432/elite_erp"],
    ["host-override parameter", `${ready.url}?host=/tmp`],
  ] as const) {
    const r = cli({ DATABASE_URL: url, ...SECRET_ENV });
    ok(`CLI: ${name} → exit 2 (REFUSED, nothing contacted or created)`, r.status === 2 && /REFUSED \[/.test(r.stderr), `exit ${r.status}`);
  }
  ok("not-ready DB prepared (push only, no platform SQL/triggers)", notReadyPush.ok);
  const nr = cli({ DATABASE_URL: notReadyUrl, ...SECRET_ENV });
  ok("CLI: platform tables without audit triggers → exit 5 (NOT READY)", nr.status === 5 && /SCHEMA_NOT_READY/.test(nr.stderr), `exit ${nr.status}`);
  const noEnc = cli({ DATABASE_URL: ready.url, PLATFORM_AUTH_SECRET: SECRET_ENV.PLATFORM_AUTH_SECRET });
  ok("CLI: missing FIELD_ENCRYPTION_KEYS → exit 5 (NOT READY)", noEnc.status === 5 && /ENCRYPTION_NOT_CONFIGURED/.test(noEnc.stderr), `exit ${noEnc.status}`);
  const nonTty = cli({ DATABASE_URL: ready.url, ...SECRET_ENV });
  ok("CLI: safe + ready target but non-interactive stdin → exit 4 (NOT INTERACTIVE)", nonTty.status === 4 && /NOT_INTERACTIVE/.test(nonTty.stderr), `exit ${nonTty.status}`);
  ok("refusals created no administrator", (await adminCount()) === 0);
  ok("CLI output never contains the database URL", ![nr, noEnc, nonTty].some((r) => r.stdout.includes("postgres://") || r.stderr.includes("postgres://")));

  // ---- in-process scripted bootstrap (the CLI's interactive layer is just a TTY adapter) ----
  Object.assign(process.env, { DATABASE_URL: ready.url, PLATFORM_CONSOLE_ENABLED: "true", ...SECRET_ENV });
  const { runBootstrap, BootstrapRefusedError } = await import("../scripts/platform/bootstrap-core");
  const { platformClock } = await import("../src/lib/platform/clock");
  const totp = await import("../src/lib/platform/totp");
  const { platformLogin } = await import("../src/lib/platform/login");
  const { isPlatformError } = await import("../src/lib/platform/errors");
  const { db, pool, platformAdminsTable, platformAuditEventsTable } = await import("../src/db");
  const { eq } = await import("drizzle-orm");

  let nowMs = Date.parse("2026-11-13T09:00:00.000Z");
  platformClock.now = () => new Date(nowMs);
  const STRONG = "Quartz-Harbor-71!x";

  type Answer = string | ((captured: string[]) => string);
  const scripted = (answers: Answer[]) => {
    const captured: string[] = [];
    let i = 0;
    const next = async () => {
      const a = answers[i++];
      if (a === undefined) throw new Error("scripted answers exhausted");
      return typeof a === "function" ? a(captured) : a;
    };
    return { captured, io: { ask: next, askHidden: next, say: (l: string) => void captured.push(l), saySecret: (l: string) => void captured.push(l) } };
  };
  const manualKey = (captured: string[]) => (captured.find((l) => l.includes("Manual key:")) ?? "").split("Manual key:")[1]?.trim() ?? "";
  const currentCode = (captured: string[]) => totp.hotpCode(manualKey(captured), totp.totpStepAt(new Date(nowMs)));
  const wrongCode = (n: number) => (captured: string[]) => {
    const secret = manualKey(captured);
    const step = totp.totpStepAt(new Date(nowMs));
    const valid = new Set([-1, 0, 1].map((d) => totp.hotpCode(secret, step + d)));
    let c = n;
    while (valid.has(String(c).padStart(6, "0"))) c = (c + 7919) % 1_000_000;
    return String(c).padStart(6, "0");
  };

  section("3. Interactive bootstrap — abort path creates nothing");
  const abort = scripted(["abort@platform.test", "Fictional Abort", STRONG, STRONG, wrongCode(1), wrongCode(2), wrongCode(3)]);
  await rejects("three wrong TOTP codes → aborted (exit 6)", () => runBootstrap(abort.io), (e) => e instanceof BootstrapRefusedError && e.exitCode === 6);
  ok("abort left no administrator behind", (await adminCount()) === 0);

  section("4. Concurrent bootstraps — exactly one administrator");
  const a = scripted(["not-an-email", "first@platform.test", "Fictional First", "short", STRONG, "different", STRONG, STRONG, wrongCode(4), currentCode]);
  const b = scripted(["second@platform.test", "Fictional Second", STRONG, STRONG, currentCode]);
  const results = await Promise.allSettled([runBootstrap(a.io), runBootstrap(b.io)]);
  const winners = results.filter((r) => r.status === "fulfilled");
  const losers = results.filter((r) => r.status === "rejected");
  ok("one run created the administrator", winners.length === 1);
  ok("the other was refused: active administrator exists (exit 3)", losers.length === 1 && (losers[0] as PromiseRejectedResult).reason instanceof BootstrapRefusedError && ((losers[0] as PromiseRejectedResult).reason as InstanceType<typeof BootstrapRefusedError>).exitCode === 3);
  ok("exactly one platform_admins row", (await adminCount()) === 1);
  const winnerIndex = results.findIndex((r) => r.status === "fulfilled");
  const winner = winnerIndex === 0 ? a : b;
  const winnerEmail = winnerIndex === 0 ? "first@platform.test" : "second@platform.test";
  ok("run A re-prompted for the invalid e-mail, weak password, mismatch and wrong code", a.captured.some((l) => /not a valid e-mail/.test(l)) && a.captured.some((l) => /at least 14/.test(l)) && a.captured.some((l) => /do not match/.test(l)) && a.captured.some((l) => /does not match/.test(l)));

  section("5. What the bootstrap stored and showed");
  const [admin] = await db.select().from(platformAdminsTable);
  ok("admin is active with the typed e-mail and name", admin.isActive && admin.emailNormalized === winnerEmail && admin.displayName.startsWith("Fictional"));
  ok("password stored as bcrypt cost 12 (never plaintext)", /^\$2[aby]\$12\$/.test(admin.passwordHash) && admin.passwordHash !== STRONG);
  ok("TOTP secret stored encrypted (envelope, not the shown key)", /^v1:/.test(admin.mfaSecretEncrypted ?? "") && !(admin.mfaSecretEncrypted ?? "").includes(manualKey(winner.captured)));
  ok("10 recovery hashes (bcrypt), MFA enrolled", (admin.mfaRecoveryHashes as string[]).length === 10 && (admin.mfaRecoveryHashes as string[]).every((h) => /^\$2[aby]\$10\$/.test(h)) && admin.mfaEnrolledAt instanceof Date);
  ok("enrollment step recorded (mfa_last_totp_step)", admin.mfaLastTotpStep === totp.totpStepAt(new Date(nowMs)));
  const secretLines = winner.captured.filter((l) => /otpauth:\/\/|Manual key:|^\s+[0-9A-F]{5}-[0-9A-F]{5}$/.test(l));
  ok("shown once: 1 provisioning URI, 1 manual key, 10 recovery codes", secretLines.filter((l) => l.includes("otpauth://")).length === 1 && secretLines.filter((l) => l.includes("Manual key:")).length === 1 && secretLines.filter((l) => /^\s+[0-9A-F]{5}-[0-9A-F]{5}$/.test(l)).length === 10);
  const [boot] = await db.select().from(platformAuditEventsTable).where(eq(platformAuditEventsTable.action, "bootstrap.completed"));
  const snap = (boot?.afterSafe ?? {}) as Record<string, unknown>;
  ok("bootstrap.completed audited (no secrets in the snapshot)", Boolean(boot) && boot.actorPlatformAdminId === admin.id && Object.keys(snap).sort().join(",") === "backupCodesIssued,channel,mfa" && snap.channel === "local-cli" && snap.mfa === "totp" && snap.backupCodesIssued === 10);

  section("6. The enrollment code cannot be replayed to log in");
  await rejects("login with the enrollment code → MFA_INVALID (replay)", () => platformLogin({ email: winnerEmail, password: STRONG, totpCode: currentCode(winner.captured), ipAddress: "203.0.113.80" }), (e) => isPlatformError(e, "MFA_INVALID"));
  nowMs += 30_000;
  const login = await platformLogin({ email: winnerEmail, password: STRONG, totpCode: currentCode(winner.captured), ipAddress: "203.0.113.80" });
  ok("the next step's code logs in", login.status === "authenticated" && login.method === "totp");
  const recoveryCode = (winner.captured.find((l) => /^\s+[0-9A-F]{5}-[0-9A-F]{5}$/.test(l)) ?? "").trim();
  const viaRecovery = await platformLogin({ email: winnerEmail, password: STRONG, recoveryCode, ipAddress: "203.0.113.80" });
  ok("a shown recovery code works once", viaRecovery.method === "recovery_code" && viaRecovery.remainingRecoveryCodes === 9);

  section("7. Bootstrap is one-time");
  const again = scripted(["third@platform.test", "Fictional Third", STRONG, STRONG, currentCode]);
  await rejects("in-process re-run → refused before any prompt (exit 3)", () => runBootstrap(again.io), (e) => e instanceof BootstrapRefusedError && e.exitCode === 3);
  ok("…and nothing was prompted", again.captured.length === 0);
  const cliAgain = cli({ DATABASE_URL: ready.url, ...SECRET_ENV });
  ok("CLI re-run → exit 3 (ACTIVE_ADMIN_EXISTS)", cliAgain.status === 3 && /ACTIVE_ADMIN_EXISTS/.test(cliAgain.stderr), `exit ${cliAgain.status}`);
  ok("still exactly one administrator", (await adminCount()) === 1);
  await pool.end();
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-bootstrap");
} catch (e) {
  console.error(`verify:platform-bootstrap aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  if (process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") {
    for (const name of createdNames) await dropDisposableDatabase(name).catch(() => undefined);
  }
}
process.exit(exitCode);
