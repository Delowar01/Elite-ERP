#!/usr/bin/env node
// PO-07 CI rehearsal, after S9 (the kit's S9 already ran R2–R9, V-NET/V-SBX in both units and its own checks):
// content checks through the two proxy sockets, a restart of both units, concurrent load across both processes,
// build integrity, a journal scan for write attempts, and the footprint. Run as root (only root can open the sockets).
//   node after-s9.mjs <config.json>   {adminHost, custHost, adminSock, custSock, appDir, manifest}
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const C = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const BUILD_ID = fs.readFileSync(path.join(C.appDir, ".next/BUILD_ID"), "utf8").trim();
const FAVICON = sha(fs.readFileSync(path.join(C.appDir, "src/app/favicon.ico")));
const CHUNK = JSON.parse(fs.readFileSync(path.join(C.appDir, ".next/build-manifest.json"), "utf8")).rootMainFiles[0];
const CHUNK_SHA = sha(fs.readFileSync(path.join(C.appDir, ".next", CHUNK)));
let pass = 0, fail = 0;
const rec = (ok, name, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const sh = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
const raw = (sock, host, method, p, headers = {}) => new Promise((resolve) => {
  const r = http.request({ socketPath: sock, method, path: p, headers: { host, "x-forwarded-host": host, "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.9", ...headers } }, (res) => {
    const chunks = []; res.on("data", (c) => chunks.push(c));
    res.on("end", () => { const b = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, body: b, text: b.toString("utf8") }); });
  });
  r.setTimeout(30000, () => r.destroy(new Error("timeout")));
  r.on("error", (e) => resolve({ status: 0, headers: {}, body: Buffer.alloc(0), text: e.message }));
  r.end();
});
const U = (p) => raw(C.custSock, C.custHost, "GET", p);
const A = (p) => raw(C.adminSock, C.adminHost, "GET", p);
const CHECKS = [
  ["customer: favicon bytes = the build seed", () => U("/favicon.ico"), (r) => r.status === 200 && sha(r.body) === FAVICON],
  ["console host: favicon bytes = the build seed", () => A("/favicon.ico"), (r) => r.status === 200 && sha(r.body) === FAVICON],
  ["customer: immutable static chunk bytes = the build file", () => U(`/_next/${CHUNK}`), (r) => r.status === 200 && sha(r.body) === CHUNK_SHA],
  ["customer: sign-in page (dynamic) carries this build id and a password field", () => U("/login"), (r) => r.status === 200 && r.text.includes(BUILD_ID) && /type="password"/.test(r.text)],
  ["customer: a protected page without a session redirects to /login", () => U("/dashboard"), (r) => [303, 307, 308].includes(r.status) && /\/login/.test(r.headers.location ?? "")],
  ["customer: unknown page → 404 page of this build", () => U("/po07-no-such-page"), (r) => r.status === 404 && r.text.includes(BUILD_ID)],
  ["console host: the console is 404 while its switch is off (S9 state)", () => A("/platform/login"), (r) => r.status === 404],
];
async function round(label) {
  for (const [name, go, ok] of CHECKS) { const r = await go(); rec(ok(r), `[${label}] ${name}`, `${r.status}`); }
}
const units = ["elite-po-admin.service", "elite-po-customer.service"];
const pids = () => units.map((u) => sh("systemctl", ["show", "-p", "MainPID", "--value", u]).stdout.trim());
async function ready() {
  for (let i = 0; i < 120; i++) { const a = await A("/favicon.ico"), b = await U("/favicon.ico"); if (a.status === 200 && b.status === 200) return true; await new Promise((s) => setTimeout(s, 500)); }
  return false;
}

await round("running");
// restart both units: the in-memory response cache is discarded, the read-only build seed serves again
const before = pids();
const rs = sh("systemctl", ["restart", ...units]);
rec(rs.status === 0 && (await ready()), "both app units restart and serve again", rs.stderr.trim());
const after = pids();
rec(after.every((p, i) => p !== "0" && p !== before[i]), "new processes after the restart", `${before.join(",")} → ${after.join(",")}`);
await round("after restart");
// concurrency: 240 requests, 24 at a time, alternating the two processes
let wrong = 0;
for (let i = 0; i < 240; i += 24) {
  const batch = await Promise.all(Array.from({ length: 24 }, (_, j) => {
    const [, go, ok] = CHECKS[(i + j) % 4];
    return go().then((r) => ok(r));
  }));
  wrong += batch.filter((x) => !x).length;
}
rec(wrong === 0, "240 concurrent requests (24 at a time) across both processes return the expected content", `${wrong} wrong`);
rec(units.every((u) => sh("systemctl", ["is-active", u]).stdout.trim() === "active" && sh("systemctl", ["show", "-p", "NRestarts", "--value", u]).stdout.trim() === "0"),
  "both units still active, no automatic restart");
// integrity: every build file unchanged, nothing added, no cache written
const chk = sh("sh", ["-c", `cd "${C.appDir}" && sha256sum --quiet --strict -c "${C.manifest}"`]);
rec(chk.status === 0, "every build file's SHA-256 still equals the archive manifest", chk.stdout.split("\n").slice(0, 5).join(" "));
const count = Number(sh("sh", ["-c", `cd "${C.appDir}" && find .next node_modules -type f | wc -l`]).stdout.trim());
const listed = fs.readFileSync(C.manifest, "utf8").split("\n").filter(Boolean).length;
rec(count === listed, "no file was added to the build", `${count} files, manifest ${listed}`);
rec(fs.readdirSync(path.join(C.appDir, ".next/cache")).length === 0 && !fs.existsSync(path.join(C.appDir, ".next/server/route-cache")), ".next/cache is empty and no route cache exists");
const j = sh("journalctl", ["-u", units[0], "-u", units[1], "--no-pager", "-o", "cat"]).stdout;
const noteworthy = j.split("\n").filter((l) => /EROFS|EACCES|EPERM|Failed to (update prerender cache|write image)|unhandled|uncaught|error/i.test(l));
rec(noteworthy.length === 0, "no write attempt, permission error or error in either app's journal", noteworthy.slice(0, 5).join(" | "));
// footprint after the load
for (const u of [...units, "postgresql@16-po07ns.service", "elite-po-staging.slice"]) {
  const v = (p) => Math.round(Number(sh("systemctl", ["show", "-p", p, "--value", u]).stdout.trim()) / 1048576);
  console.log(`footprint ${u}: current ${v("MemoryCurrent")} MB, peak ${v("MemoryPeak")} MB`);
}
console.log(`AFTER-S9 pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
