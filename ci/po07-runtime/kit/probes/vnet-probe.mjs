// PO-07 V-NET / V-SBX probe (plan §B.2). Runs INSIDE the sandbox (elite-po-run ... probe), as the app user, reading this
// script from stdin. The stage script prepends one line: `const CFG = {...};` (ports, addresses and socket paths from
// the fresh S0 baseline; the profile). It prints PASS/FAIL lines and exits 1 if anything that must fail succeeded.
// It reads no secret and prints no environment value.
import net from "node:net";
import dns from "node:dns/promises";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";

/* global CFG */
const results = [];
const rec = (ok, name, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const tcp = (host, port, ms = 2500) => new Promise((res) => {
  const s = net.connect({ host, port });
  const t = setTimeout(() => { s.destroy(); res("TIMEOUT"); }, ms);
  s.on("connect", () => { clearTimeout(t); s.destroy(); res("CONNECTED"); });
  s.on("error", (e) => { clearTimeout(t); res(e.code || "ERROR"); });
});
const unix = (path) => new Promise((res) => {
  const s = net.connect({ path });
  const t = setTimeout(() => { s.destroy(); res("TIMEOUT"); }, 2500);
  s.on("connect", () => { clearTimeout(t); s.destroy(); res("CONNECTED"); });
  s.on("error", (e) => { clearTimeout(t); res(e.code || "ERROR"); });
});
const code = (fn) => { try { fn(); return "OK"; } catch (e) { return e.code || "ERROR"; } };
const ls = (p) => { try { return fs.readdirSync(p).sort(); } catch (e) { return e.code || "ERROR"; } };

// ---- identity and privileges ----
const st = fs.readFileSync("/proc/self/status", "utf8");
rec(process.getuid() !== 0 && process.getgid() !== 0, "runs as an unprivileged user", `uid ${process.getuid()}`);
rec(/^CapEff:\s*0+$/m.test(st) && /^CapBnd:\s*0+$/m.test(st), "no effective or bounding capability");
rec(/^NoNewPrivs:\s*1$/m.test(st), "NoNewPrivileges is set");

// ---- network: interfaces, every S0 host listener, public addresses, DNS, HTTP ----
const ifs = Object.keys(os.networkInterfaces()).sort();
rec(ifs.length === 1 && ifs[0] === "lo", "the only interface is lo", ifs.join(","));
for (const port of CFG.tcpPorts) {
  const must = CFG.answer.includes(port);
  for (const host of ["127.0.0.1", "::1"]) {
    const r = await tcp(host, port);
    if (must && host === "127.0.0.1") rec(r === "CONNECTED", `staging service answers on ${host}:${port}`, r);
    else if (!must) rec(r !== "CONNECTED", `host loopback ${host}:${port} is unreachable`, r);
  }
}
for (const a of CFG.hostAddrs) {
  const r = await tcp(a.host, a.port);
  rec(r !== "CONNECTED", `host address listener <addr>:${a.port} is unreachable`, r);
}
for (const [host, port] of [["1.1.1.1", 443], ["1.1.1.1", 5432], ["8.8.8.8", 53], ["2606:4700:4700::1111", 443]]) {
  const r = await tcp(host, port);
  rec(r !== "CONNECTED", `public ${host}:${port} is unreachable`, r);
}
for (const name of ["example.com", "github.com", "ep-guard-probe.us-east-2.aws.neon.tech"]) {
  let r; try { r = (await dns.lookup(name)).address ? "RESOLVED" : "?"; } catch (e) { r = e.code || "ERROR"; }
  rec(r !== "RESOLVED", `DNS lookup of ${name} fails`, r);
  const g = spawnSync("getent", ["hosts", name], { encoding: "utf8", timeout: 10000 });
  rec(g.status !== 0, `getent hosts ${name} fails`, `exit ${g.status}`);
}
let f; try { await fetch("https://example.com/", { signal: AbortSignal.timeout(8000) }); f = "FETCHED"; } catch (e) { f = e.cause?.code || e.name; }
rec(f !== "FETCHED", "fetch https://example.com fails", f);

// ---- filesystem: every S0 unix socket, the hidden trees, the allow-list view ----
for (const p of CFG.unixPaths) {
  const r = await unix(p);
  rec(r === "ENOENT" || r === "EACCES", `unix socket ${p} is invisible or denied`, r);
}
for (const p of ["/srv/po07-absent-erp", "/run/postgresql", "/var/run/postgresql", "/run/po07-absent-c", "/var/run/po07-absent-c", "/run/dbus/system_bus_socket",
  "/run/systemd/resolve", "/run/po07-absent-a", "/run/docker.sock", "/var/lib/postgresql", "/var/lib/po07-absent-b", "/var/lib/docker", "/var/lib/elite-po-staging/backups",
  "/home/po07-absent-d", "/root/elite-po-kit", "/srv/elite-po-staging/.build-home"]) {
  const r = code(() => fs.statSync(p));
  rec(r === "ENOENT" || r === "EACCES", `${p} is hidden`, r);
}
const view = { "/srv": ["elite-po-staging"], "/srv/elite-po-staging": ["app"], "/opt": ["google"], "/var/www": [], "/var/spool": [], "/var/backups": [] };
for (const [p, want] of Object.entries(view)) {
  const got = ls(p);
  rec(Array.isArray(got) && JSON.stringify(got) === JSON.stringify(want), `${p} shows only ${JSON.stringify(want)}`, JSON.stringify(got));
}
const hm = ls("/home");
rec(hm === "EACCES" || (Array.isArray(hm) && hm.length === 0), "/home is inaccessible or empty", JSON.stringify(hm));
const vl = ls("/var/lib");
rec(Array.isArray(vl) && vl.every((x) => CFG.profile === "customer" && x === "elite-po-staging"), "/var/lib is empty (customer: only the storage bind)", JSON.stringify(vl));
rec(code(() => fs.readFileSync("/etc/elite-po-staging/admin.env")) === "EACCES" || code(() => fs.readFileSync("/etc/elite-po-staging/admin.env")) === "ENOENT", "the env files are not readable");
const others = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d)).filter((d) => { try { return fs.statSync(`/proc/${d}`).uid !== process.getuid(); } catch { return false; } });
rec(others.length === 0, "no other user's process is visible in /proc", `${others.length} visible`);
const tmp = ls("/tmp");
rec(Array.isArray(tmp) && tmp.every((x) => x.startsWith(".npm") || x.startsWith("tsx-") || x.startsWith("node-compile-cache")), "/tmp is private (no other application's files)", JSON.stringify(tmp).slice(0, 200));

// ---- writes: read-only code and system, writable only where the plan allows ----
const tryWrite = (p) => code(() => { fs.writeFileSync(p, "x"); fs.unlinkSync(p); });
rec(tryWrite("/srv/elite-po-staging/app/.po-probe") === "EROFS", "the code tree is read-only", tryWrite("/srv/elite-po-staging/app/.po-probe"));
rec(["EROFS", "EACCES"].includes(tryWrite("/etc/.po-probe")), "/etc is read-only");
rec(["EROFS", "EACCES"].includes(tryWrite("/usr/local/.po-probe")), "/usr is read-only");
rec(tryWrite("/tmp/.po-probe") === "OK", "/tmp is writable (private)");
// decision J1: the WHOLE build is read-only — no cache directory is writable, in any profile
for (const p of [".next/cache/.po-probe", ".next/server/.po-probe", ".next/server/app/.po-probe", "node_modules/.po-probe"]) {
  const r = tryWrite(`/srv/elite-po-staging/app/${p}`);
  rec(r === "EROFS", `${p.slice(0, p.lastIndexOf("/"))} is read-only`, r);
}
const rc = code(() => fs.mkdirSync("/srv/elite-po-staging/app/.next/server/route-cache"));
rec(rc === "EROFS", ".next/server/route-cache cannot be created (Next.js serves the build seed from memory)", rc);
if (CFG.profile === "customer") rec(tryWrite("/var/lib/elite-po-staging/storage/.po-probe") === "OK", "the fake storage directory is writable");
if (CFG.profile === "admin") rec(tryWrite("/var/lib/elite-po-staging/storage/.po-probe") !== "OK", "the admin process cannot write the storage directory");

// ---- V-SBX: Chromium starts inside the sandbox (customer: PDFs) ----
if (CFG.profile === "customer") {
  const c = spawnSync(CFG.chromium, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--user-data-dir=/tmp/po-probe-chrome", "--dump-dom", "about:blank"], { encoding: "utf8", timeout: 90000 });
  rec(c.status === 0 && /<html/i.test(c.stdout || ""), "Chromium starts headless inside the sandbox", `exit ${c.status} ${(c.stderr || "").split("\n").filter(Boolean).slice(-1)[0] ?? ""}`.slice(0, 200));
  // ...and renders a PDF the way the customer process does (src/lib/pdf/document-pdf.ts with CHROMIUM_EXECUTABLE_PATH):
  // puppeteer-core from the installed build, the same launch options, page.pdf(); its profile lives in the private /tmp
  let head = "", why = "";
  try {
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const req = createRequire("/srv/elite-po-staging/app/package.json");
    const mod = await import(pathToFileURL(req.resolve("puppeteer-core")).href);
    const puppeteer = mod.default ?? mod;
    const browser = await puppeteer.launch({ executablePath: CFG.chromium, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
      const page = await browser.newPage();
      await page.setContent("<h1>PO-07 V-SBX</h1><p>العربية · 123</p>", { waitUntil: "load" });
      head = Buffer.from(await page.pdf({ format: "A4" })).subarray(0, 5).toString("latin1");
    } finally { await browser.close(); }
  } catch (e) { why = String(e?.message ?? e).split("\n")[0].slice(0, 160); }
  rec(head === "%PDF-", "Chromium renders a PDF through puppeteer-core inside the sandbox (the app's own path)", why || `head ${JSON.stringify(head)}`);
  // diagnostics (printed, never a secret): this unit's task and memory limits and events, and Chrome's own stderr
  const cg = (() => { try { return fs.readFileSync("/proc/self/cgroup", "utf8").trim().split(":").pop(); } catch { return ""; } })();
  const rd = (f) => { try { return fs.readFileSync(`/sys/fs/cgroup${cg}/${f}`, "utf8").trim().replace(/\n/g, " "); } catch (e) { return e.code; } };
  console.log(`DIAG cgroup ${cg}: pids.max=${rd("pids.max")} pids.peak=${rd("pids.peak")} pids.events=[${rd("pids.events")}] memory.max=${rd("memory.max")} memory.peak=${rd("memory.peak")} memory.events=[${rd("memory.events")}]`);
  if (head !== "%PDF-") {
    const d = spawnSync(CFG.chromium, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-port=0", "--user-data-dir=/tmp/po-probe-diag", "about:blank"], { encoding: "utf8", timeout: 20000 });
    console.log(`DIAG chrome with remote debugging: status ${d.status} signal ${d.signal}; stderr tail:\n${(d.stderr || "").split("\n").filter(Boolean).slice(-10).map((l) => `DIAG   ${l.slice(0, 200)}`).join("\n")}`);
    console.log(`DIAG after: pids.events=[${rd("pids.events")}] memory.events=[${rd("memory.events")}]`);
  }
}

const fail = results.filter((x) => !x).length;
console.log(`VNET-SUMMARY profile=${CFG.profile} pass=${results.length - fail} fail=${fail}`);
process.exit(fail ? 1 : 0);
