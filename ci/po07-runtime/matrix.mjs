#!/usr/bin/env node
// PO-07 J1: the verified build under `next start` with the build WRITABLE versus fully READ-ONLY (systemd
// ReadOnlyPaths= on the whole app tree), on a GitHub-hosted runner. Every route class is requested and checked by
// CONTENT, not by status alone; the servers' own logs are collected; the files the servers wrote are listed.
//   node matrix.mjs <app dir> <readonly|writable> <report.json>
// Environment: MX_DATABASE_URL (a disposable, schema'd database on the runner's loopback), MX_UID, MX_GID.
// Two servers per mode, from the one build: the customer process (console switch unset) and the console process
// (switch on), bound with the H-1 variables, as the staging units are. Test-only secrets, generated here.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";

const [appArg, mode, reportFile] = process.argv.slice(2);
if (!appArg || !["readonly", "writable"].includes(mode) || !reportFile) { console.error("usage: matrix.mjs <app dir> <readonly|writable> <report.json>"); process.exit(64); }
const app = fs.realpathSync(appArg);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const BUILD_ID = fs.readFileSync(path.join(app, ".next/BUILD_ID"), "utf8").trim();
const FAVICON = sha(fs.readFileSync(path.join(app, "src/app/favicon.ico")));
const bm = JSON.parse(fs.readFileSync(path.join(app, ".next/build-manifest.json"), "utf8"));
const CHUNK = bm.rootMainFiles[0];
const CHUNK_SHA = sha(fs.readFileSync(path.join(app, ".next", CHUNK)));
const HOSTS = { admin: "admin.mx.test", customer: "customer.mx.test" };
const PORTS = { readonly: { customer: 14300, admin: 14310 }, writable: { customer: 14400, admin: 14410 } }[mode];
const secret = () => randomBytes(32).toString("base64url");
const common = {
  NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", DATABASE_URL: process.env.MX_DATABASE_URL, AUTH_SECRET: secret(), PLATFORM_AUTH_SECRET: secret(),
  FIELD_ENCRYPTION_KEYS: `1:${randomBytes(32).toString("base64")}`, PLATFORM_CONSOLE_HOST: HOSTS.admin, CUSTOMER_APP_HOST: HOSTS.customer,
  PLATFORM_TRUSTED_PROXY_HOPS: "0", CUSTOMER_PUBLIC_ORIGIN: `https://${HOSTS.customer}`, STORAGE_DRIVER: "fake", STORAGE_FAKE_DIR: "/tmp/po07-mx-storage",
};
const env = { customer: common, admin: { ...common, PLATFORM_CONSOLE_ENABLED: "true" } };
const unit = (role) => `po07-mx-${mode}-${role}.service`;
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

function start(role) {
  const props = ["-p", `WorkingDirectory=${app}`, "-p", "PrivateTmp=yes", "-p", "NoNewPrivileges=yes"];
  if (mode === "readonly") props.push("-p", `ReadOnlyPaths=${app}`);
  const envArgs = Object.entries(env[role]).flatMap(([k, v]) => ["--setenv", `${k}=${v}`]);
  const r = sh("sudo", ["systemd-run", `--unit=${unit(role)}`, `--uid=${process.env.MX_UID}`, `--gid=${process.env.MX_GID}`, "--quiet", ...props, ...envArgs,
    "--", process.execPath, "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(PORTS[role])]);
  if (r.status !== 0) throw new Error(`systemd-run ${role}: ${r.stderr}`);
}
const stop = (role) => sh("sudo", ["systemctl", "stop", unit(role)]);
const restart = (role) => sh("sudo", ["systemctl", "restart", unit(role)]);
const journal = (role) => sh("sudo", ["journalctl", "-u", unit(role), "--no-pager", "-o", "cat"]).stdout;

const req = (role, method, p, { host = HOSTS[role], headers = {}, body } = {}) => new Promise((resolve) => {
  const r = http.request({ host: "127.0.0.1", port: PORTS[role], method, path: p, headers: { host, ...headers } }, (res) => {
    const chunks = []; res.on("data", (c) => chunks.push(c));
    res.on("end", () => { const b = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, body: b, text: b.toString("utf8") }); });
  });
  r.setTimeout(30000, () => r.destroy(new Error("timeout")));
  r.on("error", (e) => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), text: String(e.message) }));
  if (body) r.write(body);
  r.end();
});
async function ready(role) {
  for (let i = 0; i < 120; i++) { const r = await req(role, "GET", "/favicon.ico"); if (r.status === 200) return; await new Promise((s) => setTimeout(s, 500)); }
  throw new Error(`${role} server not ready: ${journal(role).split("\n").slice(-15).join("\n")}`);
}

// ---- the request matrix: [id, role, method, path, options, check(r) → true | "reason"] ----
const html = (r) => String(r.headers["content-type"] ?? "").startsWith("text/html");
const CASES = [
  ["favicon (customer)", "customer", "GET", "/favicon.ico", {}, (r) => r.status === 200 && /image\/x-icon/.test(r.headers["content-type"]) && sha(r.body) === FAVICON || `status ${r.status} sha ${sha(r.body).slice(0, 12)}`],
  ["favicon (console)", "admin", "GET", "/favicon.ico", {}, (r) => r.status === 200 && sha(r.body) === FAVICON || `status ${r.status}`],
  ["static chunk (immutable)", "customer", "GET", `/_next/${CHUNK}`, {}, (r) => r.status === 200 && sha(r.body) === CHUNK_SHA && /immutable/.test(r.headers["cache-control"] ?? "") || `status ${r.status}`],
  ["customer sign-in page (dynamic)", "customer", "GET", "/login", {}, (r) => r.status === 200 && html(r) && r.text.includes(BUILD_ID) && /type="password"/.test(r.text) || `status ${r.status}`],
  ["protected page without a session → /login", "customer", "GET", "/dashboard", {}, (r) => [303, 307, 308].includes(r.status) && /\/login/.test(r.headers.location ?? "") || `status ${r.status} → ${r.headers.location}`],
  ["unknown path without a session → /login (the proxy, before routing)", "customer", "GET", "/po07-no-such-page", {}, (r) => [303, 307, 308].includes(r.status) && /\/login/.test(r.headers.location ?? "") || `status ${r.status} → ${r.headers.location}`],
  ["PDF route handler without a session (dynamic route handler)", "customer", "GET", "/api/document-pdf/invoice/00000000-0000-4000-8000-000000000000", {}, (r) => r.status > 0 && r.status < 500 || `status ${r.status}`],
  ["image optimizer, SVG source (refused by default)", "customer", "GET", "/_next/image?url=%2Fnext.svg&w=64&q=75", {}, (r) => r.status === 400 || `status ${r.status}`],
  ["image optimizer, ICO source (unused by the app; reachable without a session)", "customer", "GET", "/_next/image?url=%2Ffavicon.ico&w=32&q=75", {}, (r) => r.status === 200 && r.body.length > 0 || `status ${r.status}`],
  ["unknown Server Action id → refused, not a crash", "customer", "POST", "/", { headers: { "next-action": "0".repeat(42), "content-type": "text/plain;charset=UTF-8" }, body: "[]" }, (r) => r.status > 0 && r.status < 500 || `status ${r.status}`],
  ["console host on the customer process → refused (H-1)", "customer", "GET", "/login", { host: HOSTS.admin }, (r) => r.status >= 400 && r.status < 500 && !/type="password"/.test(r.text) || `status ${r.status}`],
  ["console sign-in page (console process)", "admin", "GET", "/platform/login", {}, (r) => r.status === 200 && html(r) && r.text.includes(BUILD_ID) && /type="password"/.test(r.text) || `status ${r.status}`],
  ["customer host on the console process → refused (H-1)", "admin", "GET", "/platform/login", { host: HOSTS.customer }, (r) => r.status >= 400 && r.status < 500 && !/type="password"/.test(r.text) || `status ${r.status}`],
  ["customer route on the console host → refused (H-1)", "admin", "GET", "/login", {}, (r) => r.status >= 400 && r.status < 500 && !/type="password"/.test(r.text) || `status ${r.status}`],
];
const results = []; let failures = 0;
async function run(label, ids = null) {
  for (const [id, role, method, p, opts, check] of CASES) {
    if (ids && !ids.includes(id)) continue;
    const r = await req(role, method, p, opts);
    const v = check(r);
    const ok = v === true;
    if (!ok) failures++;
    results.push({ phase: label, id, status: r.status, ok, detail: ok ? "" : v, bytes: r.body.length, sha256: sha(r.body).slice(0, 16) });
    console.log(`${ok ? "PASS" : "FAIL"} [${mode}/${label}] ${id} — ${r.status}${ok ? "" : ` (${v})`}`);
  }
}

const marker = Date.now();
try {
  start("customer"); start("admin");
  await ready("customer"); await ready("admin");
  await run("first");
  await run("second (warm)", ["favicon (customer)", "customer sign-in page (dynamic)", "console sign-in page (console process)"]);
  // concurrency: 240 requests, 24 at a time, across both processes
  const mix = ["favicon (customer)", "static chunk (immutable)", "customer sign-in page (dynamic)", "console sign-in page (console process)", "customer host on the console process → refused (H-1)"];
  const jobs = Array.from({ length: 240 }, (_, i) => CASES.find((c) => c[0] === mix[i % mix.length]));
  let concurrentFail = 0;
  for (let i = 0; i < jobs.length; i += 24) {
    const batch = await Promise.all(jobs.slice(i, i + 24).map(async ([, role, method, p, opts, check]) => check(await req(role, method, p, opts)) === true));
    concurrentFail += batch.filter((x) => !x).length;
  }
  if (concurrentFail) failures++;
  results.push({ phase: "concurrency", id: "240 requests, 24 concurrent, both processes", ok: concurrentFail === 0, detail: `${concurrentFail} wrong` });
  console.log(`${concurrentFail ? "FAIL" : "PASS"} [${mode}/concurrency] 240 requests, 24 concurrent, both processes — ${concurrentFail} wrong`);
  // restart: the in-memory cache is gone; the build seed serves again
  restart("customer"); restart("admin");
  await ready("customer"); await ready("admin");
  await run("after restart", ["favicon (customer)", "favicon (console)", "customer sign-in page (dynamic)", "console sign-in page (console process)"]);
} catch (e) {
  failures++; console.log(`FAIL [${mode}] harness: ${e.message}`);
}
stop("customer"); stop("admin");
const logs = { customer: journal("customer"), admin: journal("admin") };
const exits = Object.fromEntries(["customer", "admin"].map((k) => [k, sh("sudo", ["systemctl", "show", "-p", "ExecMainCode,ExecMainStatus,Result", unit(k)]).stdout.trim().replace(/\n/g, " ")]));
console.log(`${mode}: after systemctl stop: ${JSON.stringify(exits)}`);
const notable = Object.fromEntries(Object.entries(logs).map(([k, v]) => [k, v.split("\n").filter((l) => /EROFS|EACCES|EPERM|ENOENT|fail|error|warn|unhandled|Main process exited/i.test(l)).slice(0, 40)]));
const written = execFileSync("find", [path.join(app, ".next"), path.join(app, "node_modules"), "-newermt", `@${Math.floor(marker / 1000)}`, "(", "-type", "f", "-o", "-type", "d", ")"], { encoding: "utf8" })
  .split("\n").filter(Boolean).map((p) => path.relative(app, p));
const report = { mode, build_id: BUILD_ID, failures, results, server_log_lines_of_note: notable, files_written: written };
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
console.log(`\n${mode}: files written inside the app tree: ${written.length}${written.length ? `\n  ${written.slice(0, 20).join("\n  ")}` : ""}`);
for (const [k, v] of Object.entries(notable)) console.log(`${mode}: ${k} log lines of note: ${v.length}${v.length ? `\n  ${v.join("\n  ")}` : ""}`);
console.log(`MATRIX ${mode} ${failures ? "FAIL" : "PASS"} cases=${results.length} failures=${failures}`);
process.exit(failures ? 1 : 0);
