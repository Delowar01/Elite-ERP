// PO-07 S11: the staging vhosts tested THROUGH nginx (fictional data only). Prints status codes and header names only —
// never a credential, cookie value or secret.
//   node s11-nginx-probe.mjs <config.json>
// config: { phase "A"|"B", adminHost, custHost, connect (address nginx listens on), httpsPort, httpPort,
//           caFile | null (null: the system trust store), tlsInsecure (Phase A self-signed certificate only),
//           appDir, psql [argv] | null, expectClientIp | null (default: connect), credFd | null, expectHsts,
//           echoHost | null (CI only) }
// Credentials (D4): only from file descriptor credFd, four lines (admin user, admin password, customer user, customer password) — the owner's
// tools/s11-owner-probe.sh prompts for them in the owner's own terminal; CI passes fictional ones. They are sent ONLY
// over TLS verified against caFile or the system trust store: with tlsInsecure the probe refuses to load them.
import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const C = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const H = { admin: C.adminHost, customer: C.custHost };
const ca = C.caFile ? fs.readFileSync(C.caFile) : undefined;
let pass = 0, fail = 0;
const rec = (ok, name, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
if (C.tlsInsecure && C.credFd != null) { console.log("REFUSED: credentials are never sent over unverified TLS"); process.exit(2); }
const creds = (() => { if (C.credFd == null) return null; const [au, ap, cu, cp] = fs.readFileSync(`/dev/fd/${C.credFd}`, "utf8").split(/\r?\n/);
  if (!au || !ap || !cu || !cp) { console.log("REFUSED: four credential lines expected on the descriptor"); process.exit(2); } return { admin: { user: au, pass: ap }, customer: { user: cu, pass: cp } }; })();
const basic = (who) => (creds ? { authorization: `Basic ${Buffer.from(`${creds[who].user}:${creds[who].pass}`).toString("base64")}` } : {});

function req({ who, host, method = "GET", path, headers = {}, body, scheme = "https", auth = false }) {
  const h = host ?? H[who];
  return new Promise((res, rej) => {
    const opt = { host: C.connect, port: scheme === "https" ? C.httpsPort : C.httpPort, method, path, servername: h,
      headers: { host: h, ...(auth ? basic(who) : {}), ...headers }, ca, rejectUnauthorized: !C.tlsInsecure, agent: false };
    if (auth && (C.tlsInsecure || scheme !== "https")) { rej(new Error("credentials only over verified TLS")); return; }
    const r = (scheme === "https" ? https : http).request(opt, (x) => {
      const chunks = []; x.on("data", (c) => chunks.push(c));
      x.on("end", () => res({ status: x.statusCode, headers: x.headers, raw: x.rawHeaders, body: Buffer.concat(chunks) }));
    });
    r.setTimeout(120000, () => r.destroy(new Error("timeout")));
    r.on("error", rej);
    if (body) r.write(body);
    r.end();
  });
}
const text = (r) => r.body.toString("utf8");
// application content: Next.js markers, a cookie, an RSC/action response — none may leave nginx unauthenticated
const appLike = (r) => Boolean(r.headers["x-powered-by"] || r.headers["set-cookie"] || /RSC|Next-Router/i.test(String(r.headers.vary ?? "")) ||
  /text\/x-component/.test(String(r.headers["content-type"] ?? "")) || /_next\/static|__next|self\.__next_f/.test(text(r)));
const noindex = (r) => /noindex/i.test(String(r.headers["x-robots-tag"] ?? ""));
const serverOk = (r) => !r.headers.server || /^nginx$/i.test(r.headers.server);
const psqlOut = (sql) => { const r = spawnSync(C.psql[0], [...C.psql.slice(1), "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr.split("\n")[0]); return r.stdout.trim(); };
const rows = () => (C.psql ? Number(psqlOut("select (select count(*) from security_events) + (select count(*) from sessions) + (select count(*) from platform_login_attempts) + (select count(*) from platform_sessions) + (select count(*) from users) + (select count(*) from orgs)")) : null);
const manifest = JSON.parse(fs.readFileSync(`${C.appDir}/.next/server/server-reference-manifest.json`, "utf8"));
const actionId = (name) => Object.entries(manifest.node).filter(([, v]) => v.exportedName === name).map(([id]) => id)[0] ?? "0";
const actionHeaders = (name, origin, extra = {}) => ({ "next-action": actionId(name), accept: "text/x-component", "sec-fetch-site": "same-origin", ...(origin ? { origin } : {}), ...extra });
async function form(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(`_1_${k}`, v);
  fd.append("0", JSON.stringify(["$undefined", "$K1"]));
  const r = new Request("http://encoder.invalid/", { method: "POST", body: fd });
  return { type: r.headers.get("content-type"), body: Buffer.from(await r.arrayBuffer()) };
}
const postAction = async (who, path, name, fields, origin, extra = {}, auth = true) => {
  const f = await form(fields);
  return req({ who, method: "POST", path, auth, headers: { ...actionHeaders(name, origin, extra), "content-type": f.type }, body: f.body });
};
const cookies = (r) => [].concat(r.headers["set-cookie"] ?? []);
const setsCookie = (r, n) => cookies(r).some((c) => c.startsWith(`${n}=`) && !/Max-Age=0/i.test(c) && !c.startsWith(`${n}=;`));
const PCOOKIE = "__Host-elite_erp_platform", CCOOKIE = "__Host-elite_erp_session";
const ORIGIN = { admin: `https://${C.adminHost}`, customer: `https://${C.custHost}` };
const chunk = (() => { try { const d = `${C.appDir}/.next/static/chunks`; const f = fs.readdirSync(d).find((x) => x.endsWith(".js")); return f ? `/_next/static/chunks/${f}` : null; } catch { return null; } })();
const rawPath = (who, method, path, auth = false) => req({ who, method, path, auth });   // Node sends the path exactly as given (no normalization)

// ---------------- unauthenticated: exactly the permitted responses, nothing of the application ----------------
const rows0 = rows();
for (const who of ["admin", "customer"]) {
  const h = H[who];
  { const r = await req({ who, path: "/", scheme: "http" });
    rec(r.status === 301 && r.headers.location === `https://${h}/` && !r.headers["www-authenticate"] && !appLike(r), `${who}: http:// → 301 https, no credential challenge over plain HTTP`, `${r.status} ${r.headers.location ?? ""}`); }
  { const r = await req({ who, path: "/.well-known/acme-challenge/po07-probe", scheme: "http" });
    rec([301, 404].includes(r.status) && !r.headers["www-authenticate"], `${who}: ACME challenge over HTTP is never behind Basic Auth`, `${r.status}`); }
  { const r = await req({ who, path: "/.well-known/acme-challenge/po07-probe" });
    rec(r.status === 404 && !r.headers["www-authenticate"] && !appLike(r), `${who}: ACME challenge over HTTPS: outside Basic Auth, served by nginx only`, `${r.status}`); }
  { const r = await req({ who, path: "/robots.txt" });
    rec(r.status === 200 && /Disallow: \//.test(text(r)) && noindex(r), `${who}: robots.txt (deny all) without credentials`, `${r.status}`); }
  { const r = await req({ who, path: who === "admin" ? "/platform/login" : "/login", headers: { authorization: "Basic " + Buffer.from("nobody:wrong").toString("base64") } });
    rec(r.status === 401, `${who}: wrong credentials → 401`, `${r.status}`); }
}
const blocked = { admin: ["/login", "/register", "/dashboard", "/api/document-pdf/x/y", "/print/x/y", "/uploads/x", "/register/accept", "/join/accept", "/login.png", "/dashboard/x.png"],
  customer: ["/platform", "/platform/login", "/platform/dashboard", "/platform/companies/x.png"] };
const proxied = { admin: ["/platform", "/platform/login", "/platform/dashboard", "/favicon.ico", ...(chunk ? [chunk] : [])],
  customer: ["/", "/login", "/register", "/dashboard", "/register/accept", "/join/accept", "/api/document-pdf/x/y", "/print/x/y", "/uploads/x", "/favicon.ico", ...(chunk ? [chunk] : [])] };
if (C.phase === "A") {
  for (const who of ["admin", "customer"]) for (const p of [...new Set([...blocked[who], ...proxied[who], "/", "/_next/image?url=%2Fx&w=64&q=75"])]) {
    const r = await req({ who, path: p });
    rec(r.status === 401 && /Basic/i.test(String(r.headers["www-authenticate"] ?? "")) && !appLike(r) && noindex(r) && serverOk(r), `A ${who} ${p} → 401 (closed: nothing reachable)`, `${r.status}`);
  }
  for (const [who, p] of [["customer", "/login"], ["admin", "/platform/login"]]) {
    const r = await postAction(who, p, "loginAction", { email: "a@example.invalid", password: "x" }, ORIGIN[who], {}, false);
    rec(r.status === 401 && !appLike(r), `A ${who} Server Action POST ${p} → 401`, `${r.status}`);
  }
} else {
  { const r = await req({ who: "admin", path: "/" });
    rec(r.status === 302 && r.headers.location === `https://${C.adminHost}/platform/login` && !appLike(r), "B admin / → 302 /platform/login without credentials (a fixed redirect; no content)", `${r.status} ${r.headers.location ?? ""}`); }
  for (const who of ["admin", "customer"]) {
    for (const p of blocked[who]) { const r = await req({ who, path: p }); rec(r.status === 404 && !appLike(r) && noindex(r) && serverOk(r), `B ${who} ${p} → 404 from nginx (blocked; no content)`, `${r.status}`); }
    { const r = await req({ who, path: "/_next/image?url=%2Fx&w=64&q=75" }); rec(r.status === 404 && !appLike(r), `B ${who} /_next/image → 404 (denied, D-R8)`, `${r.status}`); }
    for (const p of ["/platform/../login", "/platform/%2e%2e/login", "/x/..%2Flogin", "/a%5C..%5Clogin"]) { const r = await rawPath(who, "GET", p); rec(r.status === 400 && !appLike(r), `B ${who} ${p} → 400 (traversal refused before routing)`, `${r.status}`); }
    for (const p of proxied[who]) { const r = await req({ who, path: p }); rec(r.status === 401 && /Basic/i.test(String(r.headers["www-authenticate"] ?? "")) && !appLike(r), `B ${who} ${p} → 401 (the application only behind Basic Auth)`, `${r.status}`); }
    { const p = who === "admin" ? "/platform/login" : "/login"; const r = await postAction(who, p, who === "admin" ? "platformSignInAction" : "loginAction", { email: "a@example.invalid", password: "x" }, ORIGIN[who], {}, false);
      rec(r.status === 401 && !appLike(r), `B ${who} Server Action POST ${p} without credentials → 401 (never reaches the application)`, `${r.status}`); }
    if (C.expectHsts) { const r = await req({ who, path: "/robots.txt" }); rec(r.headers["strict-transport-security"] === "max-age=300", `B ${who} HSTS exactly "max-age=300" (no includeSubDomains, no preload; D8)`, String(r.headers["strict-transport-security"] ?? "absent")); }
  }
}
{ const r = await req({ host: "unknown.invalid", path: "/" }).catch((e) => ({ status: 0, headers: {}, body: Buffer.from(e.message) }));
  rec(r.status !== 401 && !appLike(r), "an unknown host never reaches a staging vhost (the existing default server answers)", `${r.status}`); }
if (rows0 !== null) rec(rows() === rows0, "no unauthenticated request wrote anything (sessions, attempts, events, users, companies)", `${rows0} → ${rows()}`);

// ---------------- authenticated (owner credentials; verified TLS only): R1–R12 through nginx ----------------
if (C.phase === "B" && creds) {
  { const r = await req({ who: "customer", host: C.adminHost, path: "/platform/login", auth: false, headers: basic("customer") });
    rec(r.status === 401, "the customer host's credentials do not open the console host (separate Basic Auth per host)", `${r.status}`); }
  { const r = await req({ who: "admin", path: "/", auth: true }); rec(r.status === 302 && r.headers.location === `https://${C.adminHost}/platform/login`, "R1 admin / → 302 /platform/login", `${r.status}`); }
  for (const p of ["/login", "/register", "/dashboard", "/api/document-pdf/x/y", "/print/x/y", "/uploads/x"]) { const r = await req({ who: "admin", path: p, auth: true }); rec(r.status === 404 && noindex(r), `R2 admin ${p} → 404`, `${r.status}`); }
  { const r = await req({ who: "admin", path: "/platform/login", auth: true }); rec(r.status === (C.f1 ? 200 : 404) && noindex(r), `R3 admin /platform/login → ${C.f1 ? 200 : 404} (F1 ${C.f1 ? "on" : "off"}), noindex`, `${r.status}`); }
  for (const p of ["/platform/login", "/platform/dashboard"]) { const r = await req({ who: "customer", path: p, auth: true }); rec(r.status === 404, `R4 customer ${p} → 404`, `${r.status}`); }
  const fakeEmail = `ngx-${randomBytes(4).toString("hex")}@example.invalid`, fakePw = `Ng-${randomBytes(18).toString("base64url")}!9a`;
  let before = rows();
  { const spoof = { "x-forwarded-host": C.adminHost, forwarded: `host=${C.adminHost};proto=https` };
    const r = await postAction("customer", "/login", "platformSignInAction", { email: fakeEmail, password: fakePw }, ORIGIN.customer, spoof);
    rec(!setsCookie(r, PCOOKIE) && (before === null || rows() === before), "R5 the console sign-in action at customer /login (with spoofed forwarding headers) never runs: no platform cookie, no row", `${r.status}`); }
  before = rows();
  for (const p of ["/platform/login", "/platform/dashboard"]) {
    const r = await postAction("admin", p, "loginAction", { email: fakeEmail, password: fakePw }, ORIGIN.admin);
    rec(!setsCookie(r, CCOOKIE) && (C.f1 || r.status === 404), `R6 the customer login action at admin ${p}: no session cookie`, `${r.status}`);
  }
  if (before !== null) rec(rows() === before, "R6 no row written by the customer login action on the console host");
  before = rows();
  for (const [who, p, name] of [["admin", "/login.png", "loginAction"], ["admin", "/dashboard/x.png", "loginAction"], ["customer", "/platform/companies/x.png", "platformSignInAction"], ["customer", "/dashboard/x.png", "platformSignInAction"]]) {
    const r = await postAction(who, p, name, { email: fakeEmail, password: fakePw }, ORIGIN[who]);
    rec(!setsCookie(r, PCOOKIE) && !setsCookie(r, CCOOKIE) && (who === "customer" && p.startsWith("/dashboard") ? true : r.status === 404), `R7 ${name} at ${who} ${p}: refused, no cookie`, `${r.status}`);
  }
  if (before !== null) rec(rows() === before, "R7 no row written");
  for (const p of ["/register/accept", "/join/accept"]) { const r = await req({ who: "admin", path: p, auth: true }); rec(r.status === 404, `R8 admin ${p} (acceptance on the console host) → 404`, `${r.status}`); }
  before = rows();
  for (const o of ["https://evil.example.invalid", ORIGIN.admin]) {
    const r = await postAction("customer", "/login", "loginAction", { email: fakeEmail, password: fakePw }, o);
    rec(!setsCookie(r, CCOOKIE), `R8 a customer action with Origin ${o.replace(C.adminHost, "<admin host>")} is refused (no cookie)`, `${r.status}`);
  }
  if (before !== null) rec(rows() === before, "R8 the foreign-Origin actions wrote nothing");
  const reg = await postAction("customer", "/register", "registerAction", { orgName: "Nginx Fictional Test Co", name: "Nginx Test", email: fakeEmail, password: fakePw, country: "Saudi Arabia", currency: "SAR" }, ORIGIN.customer);
  const sc = cookies(reg).find((c) => c.startsWith(`${CCOOKIE}=`)) ?? "";
  rec(/;\s*Secure/i.test(sc) && /;\s*HttpOnly/i.test(sc) && /;\s*Path=\/(;|$)/i.test(sc) && !/;\s*Domain=/i.test(sc), "R9 the customer session cookie through nginx: __Host-, Secure, HttpOnly, Path=/, no Domain", `${reg.status}, ${cookies(reg).length} cookie(s)`);
  const cookie = sc.split(";")[0];
  if (C.psql) {
    const ip = C.expectClientIp ?? C.connect;
    const c0 = Number(psqlOut(`select count(*) from security_events where ip_address = '${ip}'`));
    const spoof = { "x-forwarded-for": ["1.2.3.4", "5.6.7.8"], "x-real-ip": "1.2.3.4", forwarded: "for=1.2.3.4" };
    await postAction("customer", "/login", "loginAction", { email: fakeEmail, password: "wrong-password-on-purpose" }, ORIGIN.customer, spoof);
    const forged = Number(psqlOut("select count(*) from security_events where ip_address in ('1.2.3.4', '5.6.7.8')"));
    const real = Number(psqlOut(`select count(*) from security_events where ip_address = '${ip}'`));
    rec(forged === 0 && real > c0, "R10 client X-Forwarded-For / X-Real-IP / Forwarded are replaced: the application records the address nginx saw", `forged ${forged}, recorded at the real address +${real - c0}`);
  } else rec(false, "R10 needs the read-only database check (psql)");
  for (const p of ["/register/accept", "/join/accept"]) { const r = await req({ who: "customer", path: p, auth: true }); rec(r.status === 200, `R11 customer ${p} (the invitation landing pages) → 200 behind Basic Auth`, `${r.status}`); }
  if (C.psql && cookie) {
    let qid = "";
    try { qid = psqlOut(`with u as (select id, org_id from users where email = '${fakeEmail}'), c as (insert into customers (org_id, name) select org_id, 'Nginx PDF Client (fictional)' from u returning id, org_id)
      insert into quotations (org_id, quotation_number, title, customer_id, issue_date, created_by_id) select c.org_id, 'QT-PO07-NGX-0001', 'PO-07 S11 fictional quotation', c.id, current_date, u.id from c, u returning id;`).split("\n")[0]; } catch (e) { console.log(`psql: ${e.message}`); }
    const r = /^\d+$/.test(qid) ? await req({ who: "customer", path: `/api/document-pdf/quotation/${qid}`, auth: true, headers: { cookie } }) : { status: 0, headers: {}, body: Buffer.alloc(0) };
    rec(r.status === 200 && /application\/pdf/.test(String(r.headers["content-type"])) && r.body.subarray(0, 5).toString("latin1") === "%PDF-", "R12 a customer PDF through nginx: 200 application/pdf", `${r.status} ${r.body.length} bytes`);
    const up = await req({ who: "customer", path: `/uploads/po07-${randomBytes(4).toString("hex")}`, auth: true, headers: { cookie } });
    rec(up.status !== 401 && up.status !== 502 && up.status < 500, "customer /uploads/* is proxied to the application, which authorizes it (a missing object: no content)", `${up.status}`);
  } else rec(false, "R12 needs the session and the read-only database check");
  if (chunk) for (const who of ["admin", "customer"]) { const r = await req({ who, path: chunk, auth: true }); rec(r.status === 200, `${who} static asset ${chunk.slice(0, 40)}… → 200`, `${r.status}`); }
  for (const who of ["admin", "customer"]) { const r = await req({ who, path: "/favicon.ico", auth: true }); rec(r.status !== 401 && r.status !== 502 && r.status < 500, `${who} /favicon.ico is proxied`, `${r.status}`); }
  { const big = Buffer.alloc(13 * 1024 * 1024, 0x61); const r = await req({ who: "customer", method: "POST", path: "/login", auth: true, headers: { "content-type": "text/plain" }, body: big }).catch(() => ({ status: 0 }));
    rec(r.status === 413, "customer body over 12 MB → 413 at nginx", `${r.status}`); }
  { const big = Buffer.alloc(3 * 1024 * 1024, 0x61); const r = await req({ who: "admin", method: "POST", path: "/platform/login", auth: true, headers: { "content-type": "text/plain" }, body: big }).catch(() => ({ status: 0 }));
    rec(r.status === 413, "admin body over 2 MB → 413 at nginx", `${r.status}`); }
  if (C.echoHost) {   // CI only: an echo backend behind the SAME kit-owned server-level block shows what the application receives
    const r = await req({ who: "admin", host: C.echoHost, path: "/echo", auth: true, headers: { "x-forwarded-for": ["1.2.3.4", "5.6.7.8"], "x-forwarded-host": "evil.example.invalid", "x-forwarded-proto": "http",
      forwarded: "for=1.2.3.4;host=evil.example.invalid", "x-real-ip": "1.2.3.4", "x-middleware-subrequest": "middleware", "x-original-url": "/admin", "x-forwarded-server": "evil" } });
    let e = {}; try { e = JSON.parse(text(r)); } catch { /* not echo */ }
    const one = (n, v) => (e[n] ?? []).length === 1 && e[n][0] === v;
    rec(r.status === 200 && one("host", C.echoHost) && one("x-forwarded-host", C.echoHost) && one("x-forwarded-proto", "https") && one("x-forwarded-for", C.expectClientIp ?? C.connect) && one("x-real-ip", C.expectClientIp ?? C.connect) &&
      !e.forwarded && !e["x-middleware-subrequest"] && !e["x-original-url"] && !e["x-forwarded-server"] && !e.authorization,
      "duplicate and spoofed forwarding headers are normalized: exactly one of each, set by nginx; the rest and the Basic Auth header never reach the application", JSON.stringify(Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v.length]))).slice(0, 160));
  }
}
// S13's website gate, part 2 (kit-5): only a fully passing AUTHENTICATED Phase B run, over verified TLS, after the
// trusted certificates were recorded (part 1, requireFile = S11.tls-ok), writes recordFile (S11.phaseB-ok). The record
// holds the time, the hosts and the counts only: never a credential or any response content.
if (C.recordFile) {
  const prior = C.requireFile && fs.existsSync(C.requireFile);
  if (fail === 0 && C.phase === "B" && creds && !C.tlsInsecure && prior) {
    fs.writeFileSync(`${C.recordFile}.tmp`, `${new Date().toISOString()} S11a-B authenticated through nginx (R1–R12 and the full matrix): pass=${pass} fail=0, hosts ${C.adminHost} ${C.custHost}\n`, { mode: 0o600 });
    fs.renameSync(`${C.recordFile}.tmp`, C.recordFile);
    console.log(`RECORDED ${C.recordFile}`);
  } else {
    console.log(`NOT RECORDED: the S13 website gate needs a fully passing authenticated Phase B run over verified TLS after ${C.requireFile ?? "S11.tls-ok"}`);
  }
}
console.log(`S11-PROBE phase=${C.phase} pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
