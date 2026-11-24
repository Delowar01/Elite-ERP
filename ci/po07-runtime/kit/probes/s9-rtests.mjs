// PO-07 S9 route and binding tests R2–R9 (plan §C), against the two proxy Unix sockets with explicit Host and
// X-Forwarded-Host headers (no DNS, no nginx). Runs on the host as root (only root — <NGINX_GROUP> — can open the
// sockets). Fictional data only. Prints status codes, header names and counts — never a cookie value or a secret.
// Usage: node s9-rtests.mjs <config.json>   (written by s9_units_start.sh: hosts, sockets, app dir, psql argv)
import http from "node:http";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const C = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const PCOOKIE = "__Host-elite_erp_platform";
const CCOOKIE = "__Host-elite_erp_session";
const ADMIN_ORIGIN = `https://${C.adminHost}`;
const CUST_ORIGIN = `https://${C.custHost}`;
let pass = 0, fail = 0;
const rec = (ok, name, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const raw = (sock, method, path, headers, body) => new Promise((res, rej) => {
  const req = http.request({ socketPath: sock, method, path, headers: { "x-forwarded-proto": "https", ...headers } }, (r) => {
    const chunks = []; r.on("data", (c) => chunks.push(c));
    r.on("end", () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks).toString("utf8") }));
  });
  req.setTimeout(30000, () => req.destroy(new Error("timeout")));
  req.on("error", rej);
  if (body) req.write(body);
  req.end();
});
const A = (method, path, extra = {}, body) => raw(C.adminSock, method, path, { host: C.adminHost, "x-forwarded-host": C.adminHost, ...extra }, body);
const U = (method, path, extra = {}, body) => raw(C.custSock, method, path, { host: C.custHost, "x-forwarded-host": C.custHost, ...extra }, body);
const setCookies = (r) => [].concat(r.headers["set-cookie"] ?? []);
const setsCookie = (r, name) => setCookies(r).some((c) => c.startsWith(`${name}=`) && !/Max-Age=0/i.test(c) && !c.startsWith(`${name}=;`));
const noindex = (r) => /noindex/i.test(String(r.headers["x-robots-tag"] ?? ""));
const psql = (sql) => {
  const r = spawnSync(C.psql[0], [...C.psql.slice(1), "-c", sql], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr.split("\n")[0]}`);
  return Number(r.stdout.trim());
};
const rows = () => psql("select (select count(*) from security_events) + (select count(*) from sessions) + (select count(*) from platform_login_attempts) + (select count(*) from platform_sessions) + (select count(*) from users) + (select count(*) from orgs)");

const manifest = JSON.parse(fs.readFileSync(`${C.appDir}/.next/server/server-reference-manifest.json`, "utf8"));
const ids = (name) => Object.entries(manifest.node).filter(([, v]) => v.exportedName === name).map(([id]) => id)[0] ?? null;
const actionHeaders = (id, origin, extra = {}) => ({ "next-action": id, accept: "text/x-component", "content-type": "text/plain;charset=UTF-8", "sec-fetch-site": "same-origin", ...(origin ? { origin } : {}), ...extra });
const postJson = (fn, path, name, arg, origin, extra = {}) => fn("POST", path, actionHeaders(ids(name), origin, extra), JSON.stringify([arg]));
async function postForm(fn, path, name, fields, origin, extra = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(`_1_${k}`, v);
  fd.append("0", JSON.stringify(["$undefined", "$K1"]));
  const r = new Request("http://encoder.invalid/", { method: "POST", body: fd });
  const body = Buffer.from(await r.arrayBuffer());
  return fn("POST", path, { ...actionHeaders(ids(name), origin, extra), "content-type": r.headers.get("content-type") }, body);
}

for (const n of ["platformSignInAction", "loginAction", "registerAction", "readCompanyAccessAction", "acceptInvitationAction", "acceptJoinLinkAction"]) {
  rec(Boolean(ids(n)), `precondition: action ${n} is in this build's manifest`);
}
const fakeEmail = `r-test-${randomBytes(4).toString("hex")}@example.invalid`;
const fakePw = `Rt-${randomBytes(18).toString("base64url")}!9a`;

// R2 — admin host: every customer path is 404 (application level, H-1)
for (const p of ["/login", "/register", "/dashboard", "/api/document-pdf/x/y", "/print/x/y", "/uploads/x"]) {
  const r = await A("GET", p);
  rec(r.status === 404 && noindex(r), `R2 admin ${p} → 404 noindex`, `${r.status}`);
}
// R3 — admin /platform/login: 404 while F1 is off, noindex
{ const r = await A("GET", "/platform/login"); rec(r.status === (C.f1 ? 200 : 404) && noindex(r), `R3 admin /platform/login → ${C.f1 ? "200 (F1 on, S13)" : "404 (F1 off)"} noindex`, `${r.status}`); }
// R4 — customer host: the console is 404
for (const p of ["/platform/login", "/platform/dashboard"]) {
  const r = await U("GET", p);
  rec(r.status === 404 && noindex(r), `R4 customer ${p} → 404 noindex`, `${r.status}`);
}
// controls: the customer surface works where it belongs
{ const r = await U("GET", "/login"); rec(r.status === 200, "control: customer /login → 200", `${r.status}`); }
{ const r = await U("GET", "/register"); rec(r.status === 200, "control: customer /register → 200", `${r.status}`); }
// a foreign Host header on either socket: refused (fail closed)
{ const r = await raw(C.custSock, "GET", "/login", { host: "evil.example.invalid", "x-forwarded-host": "evil.example.invalid" }); rec(r.status === 404, "unknown host on the customer socket → 404", `${r.status}`); }
{ const r = await raw(C.adminSock, "GET", "/platform/login", { host: "evil.example.invalid", "x-forwarded-host": "evil.example.invalid" }); rec(r.status === 404, "unknown host on the admin socket → 404", `${r.status}`); }

// R5 — the console sign-in action POSTed to /login on the customer host (forwarding): never runs
let before = rows();
{
  const a = await postJson(U, "/login", "platformSignInAction", { email: fakeEmail, password: fakePw }, CUST_ORIGIN);
  const b = await postJson(A, "/login", "platformSignInAction", { email: fakeEmail, password: fakePw }, CUST_ORIGIN, { "x-forwarded-host": C.custHost, host: C.adminHost });
  rec([a, b].every((r) => !setsCookie(r, PCOOKIE) && !/mfa_required|"authenticated"/.test(r.body)) && rows() === before, "R5 console sign-in action at customer /login (both processes): refused, no platform cookie, no row", `${a.status}/${b.status}`);
}
// R6 — the customer login action POSTed to /platform/login on the admin host: never runs
before = rows();
{
  const a = await postForm(A, "/platform/login", "loginAction", { email: fakeEmail, password: fakePw }, ADMIN_ORIGIN);
  const b = await postForm(A, "/platform/dashboard", "loginAction", { email: fakeEmail, password: fakePw }, ADMIN_ORIGIN);
  rec([a, b].every((r) => (C.f1 || r.status === 404) && !setsCookie(r, CCOOKIE)) && rows() === before, "R6 customer login action at admin /platform/login and /platform/dashboard: refused (404 while F1 is off), no session cookie, no row", `${a.status}/${b.status}`);
}
// control for R5/R6: the customer login action DOES run on the customer host (a failed sign-in is recorded)
before = rows();
{
  const r = await postForm(U, "/login", "loginAction", { email: fakeEmail, password: fakePw }, CUST_ORIGIN);
  rec(r.status === 200 && rows() > before && !setsCookie(r, CCOOKIE), "control: the customer login action runs on the customer host (failed sign-in recorded, no cookie)", `${r.status}`);
}
// R7 — static-suffix paths: a dynamic console page's action on the customer upstream, a customer action on the admin upstream
before = rows();
{
  const a = await postJson(U, "/platform/companies/1.png", "readCompanyAccessAction", "1", CUST_ORIGIN);
  const b = await postJson(A, "/platform/companies/1.png", "readCompanyAccessAction", "1", CUST_ORIGIN, { "x-forwarded-host": C.custHost, host: C.adminHost });
  const c = await postForm(A, "/login.png", "loginAction", { email: fakeEmail, password: fakePw }, ADMIN_ORIGIN);
  const d = await postForm(A, "/dashboard/x.png", "loginAction", { email: fakeEmail, password: fakePw }, ADMIN_ORIGIN);
  rec([a, b, c, d].every((r) => r.status === 404 && !setsCookie(r, CCOOKIE) && !setsCookie(r, PCOOKIE)) && rows() === before, "R7 actions at *.png paths on the wrong upstream: 404 at the server-side entry point, no cookie, no row", [a, b, c, d].map((r) => r.status).join("/"));
}
// R8 — acceptance actions on the admin host; any action with a foreign Origin
before = rows();
{
  const a = await postForm(A, "/register/accept", "acceptInvitationAction", { token: "x".repeat(43), password: fakePw }, ADMIN_ORIGIN);
  const b = await postForm(A, "/join/accept", "acceptJoinLinkAction", { token: "x".repeat(43), password: fakePw }, ADMIN_ORIGIN);
  rec([a, b].every((r) => r.status === 404 && !setsCookie(r, CCOOKIE)) && rows() === before, "R8a acceptance actions on the admin host: 404, no cookie, no row", `${a.status}/${b.status}`);
  const c = await postForm(U, "/login", "loginAction", { email: fakeEmail, password: fakePw }, "https://evil.example.invalid");
  const d = await postForm(U, "/login", "loginAction", { email: fakeEmail, password: fakePw }, ADMIN_ORIGIN);
  // As in the H-1 suite (10b): "refused" is proven by the absence of the action's effect, not by one status code.
  rec([c, d].every((r) => !setsCookie(r, CCOOKIE)) && rows() === before, "R8b a customer action with a foreign or the admin Origin: refused (no cookie, no security event, no row)", `${c.status}/${d.status}`);
}
// R9 — cookie attributes on the customer host: a FICTIONAL sign-up (example.invalid), then the cookie's attributes.
// The console cookie needs the owner's bootstrap and F1: it is checked at S13, not here.
if (C.r9Register) {
  const r = await postForm(U, "/register", "registerAction", { orgName: "R9 Fictional Test Co", name: "R9 Test", email: fakeEmail, password: fakePw, country: "Saudi Arabia", currency: "SAR" }, CUST_ORIGIN);
  const ck = setCookies(r).filter((c) => c.startsWith(`${CCOOKIE}=`));
  rec(ck.length === 1 && ck.every((c) => /;\s*Secure/i.test(c) && /;\s*HttpOnly/i.test(c) && /;\s*Path=\/(;|$)/i.test(c) && !/;\s*Domain=/i.test(c)),
    "R9 customer session cookie: __Host-, Secure, HttpOnly, Path=/, no Domain (fictional sign-up)", `${r.status}, ${ck.length} cookie(s)`);
  const ad = await A("GET", "/dashboard", { cookie: `${CCOOKIE}=${(ck[0] ?? "").split(";")[0].slice(CCOOKIE.length + 1)}` });
  rec(ad.status === 404, "the customer cookie on the admin host reaches nothing (404)", `${ad.status}`);
} else {
  console.log("SKIP R9 (r9Register=false)");
}
console.log("NOTE R10 (client X-Forwarded-For) is an nginx property (the vhost overwrites it with $remote_addr): checked at S11a, not here.");
console.log(`RTESTS-SUMMARY pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
