/**
 * Platform Owner PO-07 H-1 — hostname binding of the console and the customer ERP: unit checks, source wiring, and
 * REAL Next.js integration (the production build in .next, `next start` on loopback, raw HTTP with chosen Host and
 * X-Forwarded-Host headers, and Chromium for the browser flows).
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   [PO07_CHROMIUM=<chromium or chrome executable>] npm run verify:platform-host-binding
 *
 * Three servers from ONE build and ONE disposable database (dropped at the end), TEST-ONLY secrets generated in memory
 * and never printed, fictional records only:
 *   ADMIN    — the console process: PLATFORM_CONSOLE_ENABLED=true, one trusted proxy (hops 1), bound to
 *              admin.localhost:<port> (console) and localhost:<customer port> (customer);
 *   CUSTOMER — the customer process: the console switch UNSET, no trusted proxy (hops 0), the same binding;
 *   UNBOUND  — the previous configuration (console on, no binding variables): the live ERP's behaviour, unchanged.
 * `*.localhost` resolves to loopback and is a secure context in Chromium, so `__Host-` cookies work over plain http and
 * each host keeps its own cookies — the same separation the two staging hostnames get.
 *
 * The defect this guards (PO-07 readiness test, Next.js 16.4.6): Next forwards a Server Action whose id the addressed
 * page does not own to the page that does, as a new internal request with the original headers; and the proxy matcher
 * skips "<path>.png", which a dynamic page also matches. Every attack below is a real POST of a real action id from
 * this build's manifest; "did not run" is proven by the absence of the action's own effect (its result, its cookie,
 * its database rows), not by a status code alone.
 */
import { createRequire } from "node:module";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext } from "playwright";
import { createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, summary, describeError } from "./platform/harness";
import { testSecrets } from "./platform/browser-env";
import { loadActionIds } from "./action-id.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright") as typeof import("playwright");

const testDbName = disposableName("po07_host_binding");
const secrets = testSecrets();
process.env.DATABASE_URL = databaseUrlFor(testDbName);
Object.assign(process.env, secrets);

const PA = Number(process.env.PO07_PORT_ADMIN || 3471);
const PC = Number(process.env.PO07_PORT_CUSTOMER || 3472);
const PU = Number(process.env.PO07_PORT_UNBOUND || 3473);
const ADMIN_HOST = `admin.localhost:${PA}`;
const CUST_HOST = `localhost:${PC}`;
const CUST_ORIGIN = `http://${CUST_HOST}`;
const ADMIN_ORIGIN = `http://${ADMIN_HOST}`;
const PCOOKIE = "__Host-elite_erp_platform";
const CCOOKIE = "__Host-elite_erp_session";
const PASSWORD = "Juniper-Compass-62!k";
const CUST_PASSWORD = "Harbor-Lattice-73!q";
const secretsSeen: string[] = [PASSWORD, CUST_PASSWORD, ...Object.values(secrets)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- part A: the decision function, without Next.js ----------------------------------------------------------------
const hb = await import("../src/lib/security/host-binding");
const H = (h: Record<string, string>) => new Headers(h);
const BOUND = { PLATFORM_CONSOLE_HOST: "admin.example.test", CUSTOMER_APP_HOST: "erp.example.test", PLATFORM_TRUSTED_PROXY_HOPS: "1" };

section("A. The binding decision (src/lib/security/host-binding.ts)");
ok("A1 unbound (neither variable): every surface allowed — the previous behaviour", hb.hostDecision("console", H({ host: "anything.test" }), {}).allowed && hb.hostDecision("customer", H({}), {}).allowed);
for (const [name, env] of [
  ["only the console host set", { PLATFORM_CONSOLE_HOST: "admin.example.test" }],
  ["only the customer host set", { CUSTOMER_APP_HOST: "erp.example.test" }],
  ["equal hosts", { PLATFORM_CONSOLE_HOST: "a.example.test", CUSTOMER_APP_HOST: "a.example.test" }],
  ["an upper-case host", { ...BOUND, PLATFORM_CONSOLE_HOST: "Admin.example.test" }],
  ["a host with a path", { ...BOUND, CUSTOMER_APP_HOST: "erp.example.test/x" }],
  ["a single-label host", { ...BOUND, PLATFORM_CONSOLE_HOST: "admin" }],
  ["an IP address", { ...BOUND, PLATFORM_CONSOLE_HOST: "203.0.113.5" }],
  ["a malformed hop count", { ...BOUND, PLATFORM_TRUSTED_PROXY_HOPS: "one" }],
  ["a malformed PDF_RENDER_ORIGIN", { ...BOUND, PDF_RENDER_ORIGIN: "not a url" }],
] as const) {
  const e = env as Record<string, string>;
  ok(`A2 invalid configuration (${name}) refuses BOTH surfaces — fail closed, never unbound`, hb.hostBinding(e).status === "invalid" && !hb.hostAllowed("console", H({ host: "admin.example.test", "x-forwarded-host": "admin.example.test" }), e) && !hb.hostAllowed("customer", H({ host: "erp.example.test", "x-forwarded-host": "erp.example.test" }), e));
}
ok("A3 bound, hops 1: the single trusted X-Forwarded-Host decides — the console host reaches only the console, the customer host only the customer surface",
  hb.hostAllowed("console", H({ host: "127.0.0.1:3000", "x-forwarded-host": "admin.example.test" }), BOUND) && !hb.hostAllowed("customer", H({ host: "127.0.0.1:3000", "x-forwarded-host": "admin.example.test" }), BOUND) &&
    hb.hostAllowed("customer", H({ host: "127.0.0.1:3000", "x-forwarded-host": "erp.example.test" }), BOUND) && !hb.hostAllowed("console", H({ host: "127.0.0.1:3000", "x-forwarded-host": "erp.example.test" }), BOUND));
ok("A4 a listed X-Forwarded-Host (a client value passed along) is refused on both surfaces", !hb.hostAllowed("console", H({ "x-forwarded-host": "admin.example.test, erp.example.test" }), BOUND) && !hb.hostAllowed("customer", H({ "x-forwarded-host": "erp.example.test,admin.example.test" }), BOUND) && hb.hostDecision("console", H({ "x-forwarded-host": "a, b" }), BOUND).allowed === false);
ok("A5 hops 0: X-Forwarded-Host is ignored — Host decides, so a client cannot forward itself onto the console", !hb.hostAllowed("console", H({ host: "erp.example.test", "x-forwarded-host": "admin.example.test" }), { ...BOUND, PLATFORM_TRUSTED_PROXY_HOPS: "0" }) && hb.hostAllowed("customer", H({ host: "erp.example.test", "x-forwarded-host": "admin.example.test" }), { ...BOUND, PLATFORM_TRUSTED_PROXY_HOPS: "0" }));
ok("A6 missing, empty, malformed or foreign hosts are refused (host_missing / wrong_host)",
  hb.hostDecision("console", H({}), { ...BOUND, PLATFORM_TRUSTED_PROXY_HOPS: "0" }).allowed === false &&
    [{ host: "" }, { host: "admin.example.test/evil" }, { host: "admin.example.test@evil.test" }, { host: "evil.test" }, { host: "admin.example.test.evil.test" }, { host: "admin.example.test:8443" }].every((h) => !hb.hostAllowed("console", H(h), { ...BOUND, PLATFORM_TRUSTED_PROXY_HOPS: "0" })));
ok("A7 the comparison is exact: no suffix, prefix or port tolerance; letter case of the request is ignored", hb.hostAllowed("console", H({ host: "ADMIN.example.test" }), { ...BOUND, PLATFORM_TRUSTED_PROXY_HOPS: "0" }) && !hb.hostAllowed("console", H({ host: "xadmin.example.test" }), { ...BOUND, PLATFORM_TRUSTED_PROXY_HOPS: "0" }));
ok("A8 the PDF renderer's loopback origin is a customer host only (never the console), and only when it is http on loopback",
  hb.hostAllowed("customer", H({ host: "127.0.0.1:3999" }), { ...BOUND, PLATFORM_TRUSTED_PROXY_HOPS: "0", PDF_RENDER_ORIGIN: "http://127.0.0.1:3999" }) && !hb.hostAllowed("console", H({ host: "127.0.0.1:3999" }), { ...BOUND, PLATFORM_TRUSTED_PROXY_HOPS: "0", PDF_RENDER_ORIGIN: "http://127.0.0.1:3999" }) &&
    !hb.hostAllowed("customer", H({ host: "render.example.test" }), { ...BOUND, PLATFORM_TRUSTED_PROXY_HOPS: "0", PDF_RENDER_ORIGIN: "https://render.example.test" }));

// ---- part B: every entry point is wired (source) ----------------------------------------------------------------------
section("B. The binding is checked at every entry point (source)");
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const proxySrc = src("src/proxy.ts");
ok("B1 the proxy decides the host FIRST — before the /platform branch and before any cookie is read — and answers 404 noindex",
  proxySrc.indexOf("hostDecision(isPlatformPath(pathname)") > 0 && proxySrc.indexOf("hostDecision(isPlatformPath(pathname)") < proxySrc.indexOf("if (isPlatformPath(pathname)) return platformGate(request);") && /status: 404, headers: NOT_HERE/.test(proxySrc));
ok("B2 the proxy matcher also runs for every request carrying a Next-Action header (no static-suffix exemption)", /has: \[\{ type: "header", key: "next-action" \}\]/.test(proxySrc));
const consoleCores = ["company-access-actions.ts", "console.ts", "customer-user-actions.ts", "invitation-actions.ts", "user-invitation-actions.ts"].map((f) => src(`src/lib/platform/${f}`));
ok("B3 every console mutation core checks the console host right before the origin check (8 call sites)", consoleCores.map((s) => (s.match(/assertConsoleHost\(req\.headers\);\s*assertSameOrigin\(req\.headers\);/g) ?? []).length).join() === "1,3,2,1,1" && consoleCores.every((s) => (s.match(/assertSameOrigin\(req\.headers\);/g) ?? []).length === (s.match(/assertConsoleHost\(req\.headers\);/g) ?? []).length));
const guards = src("src/lib/platform/guards.ts");
ok("B4 the console guards (pages, layouts, actions, exports) refuse another host before reading the cookie", /if \(!\(await onConsoleHost\(\)\)\) return notFound\(\);\s*try \{\s*return await authorizePlatformToken\(await platformCookie\(\)\);/.test(guards) && /if \(!\(await onConsoleHost\(\)\)\) throw new PlatformError\("CONSOLE_DISABLED", "not the console host"\);\s*return authorizePlatformToken\(await platformCookie\(\), permission\);/.test(guards));
ok("B5 the public console pages and the session-expired handler exist only on the console host", /if \(!isConsoleHost\(await headers\(\)\)\) notFound\(\);/.test(src("src/app/(platform)/platform/(public)/layout.tsx")) && /if \(!isConsoleHost\(request\.headers\)\) return new NextResponse\(null, \{ status: 404/.test(src("src/app/(platform)/platform/session-expired/route.ts")) &&
    /export function isConsoleHost\(headers: HeaderSource\): boolean \{\s*return hostDecision\("console", headers\)\.allowed;/.test(src("src/lib/platform/origin.ts")));
ok("B6 the customer session exists only on the customer host (getSessionState: first statement)", /export async function getSessionState\(\): Promise<SessionState> \{\s*(\/\/[^\n]*\s*)*if \(!hostAllowed\("customer", await headers\(\)\)\) return SIGNED_OUT;/.test(src("src/lib/session.ts")));
const auth = src("src/app/(auth)/actions.ts");
ok("B7 customer sign-in and sign-up refuse another host before any lookup, throttle or record", /export async function loginAction\([^)]*\): Promise<ActionState> \{\s*(\/\/[^\n]*\s*)*if \(!\(await onCustomerHost\(\)\)\) return \{ error: SIGN_IN_UNAVAILABLE_MESSAGE \};/.test(auth) && /export async function registerAction\([^)]*\): Promise<ActionState> \{\s*(\/\/[^\n]*\s*)*if \(!\(await onCustomerHost\(\)\)\) return \{ error: REGISTER_UNAVAILABLE_MESSAGE \};/.test(auth));
ok("B8 both invitation acceptances check the customer host inside their origin step", ["invitation-acceptance.ts", "user-invitation-acceptance.ts"].every((f) => /assertSameOrigin\(headers\);\s*assertCustomerHost\(headers\);/.test(src(`src/lib/platform/${f}`))));
ok("B9 /uploads refuses another host first (it also has a signed-URL path without a session)", /export async function GET\([^)]*\) \{\s*(\/\/[^\n]*\s*)*if \(!hostAllowed\("customer", req\.headers\)\) return new Response\("Not found", \{ status: 404 \}\);/.test(src("src/app/uploads/[...path]/route.ts")));
const dict = src("src/lib/i18n/dict.ts");
ok("B10 the refusal messages are existing, translated strings (Arabic in the customer dictionary)", /"Sign-in is temporarily unavailable\. Try again later\.": "[؀-ۿ]/.test(dict) && /"Something went wrong\. Please try again\.": "[؀-ۿ]/.test(dict));

// ---- part C: the real application --------------------------------------------------------------------------------------
type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
type Srv = { name: string; port: number; proc: ChildProcess; out: () => string; stop: () => Promise<void> };

/** A raw HTTP/1.1 request to 127.0.0.1:port with exactly the given headers (Host included). */
function raw(port: number, method: string, path: string, headers: Record<string, string>, body?: Buffer | string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers: { ...headers, ...(body !== undefined ? { "content-length": String(Buffer.byteLength(body)) } : {}) }, setHost: false }, (res) => {
      let b = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: b }));
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("timeout")));
    if (body !== undefined) req.write(body);
    req.end();
  });
}
/** HTTP/1.0 with NO Host header at all (Node's client always sends one). */
function rawNoHost(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = connect(port, "127.0.0.1", () => s.write(`GET ${path} HTTP/1.0\r\nConnection: close\r\n\r\n`));
    let b = "";
    s.on("data", (d) => (b += String(d)));
    s.on("end", () => resolve(Number(/^HTTP\/1\.[01] (\d{3})/.exec(b)?.[1] ?? 0)));
    s.on("error", reject);
    s.setTimeout(30_000, () => s.destroy(new Error("timeout")));
  });
}
const setCookies = (r: Res) => ([] as string[]).concat(r.headers["set-cookie"] ?? []);
const setsCookie = (r: Res, name: string) => setCookies(r).some((c) => c.startsWith(`${name}=`) && !/Max-Age=0/i.test(c) && !c.startsWith(`${name}=;`));
const cookieValue = (r: Res, name: string) => setCookies(r).find((c) => c.startsWith(`${name}=`))?.split(";")[0].slice(name.length + 1) ?? "";

let ids!: (name: string) => string | null;
const manifest = JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName?: string; workers: Record<string, unknown> }> };
const workersOf = (id: string) => Object.keys(manifest.node[id]?.workers ?? {});
const actionHeaders = (id: string, host: string, origin: string | null, extra: Record<string, string> = {}) => ({
  host,
  "next-action": id,
  accept: "text/x-component",
  "content-type": "text/plain;charset=UTF-8",
  "sec-fetch-site": "same-origin",
  ...(origin ? { origin } : {}),
  ...extra,
});
/** POST a JSON-argument action (single object argument) to `path` on `port`, addressing `host`. */
const postJson = (port: number, path: string, name: string, arg: unknown, host: string, origin: string | null, extra: Record<string, string> = {}) => {
  const id = ids(name);
  if (!id) throw new Error(`server action ${name} is not in the build manifest`);
  return raw(port, "POST", path, actionHeaders(id, host, origin, extra), JSON.stringify([arg]));
};
/** POST a (prevState, FormData) action — React's reply encoding: "0" = ["$undefined","$K1"], fields "_1_<name>". */
async function postForm(port: number, path: string, name: string, fields: Record<string, string>, host: string, origin: string | null, extra: Record<string, string> = {}): Promise<Res> {
  const id = ids(name);
  if (!id) throw new Error(`server action ${name} is not in the build manifest`);
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(`_1_${k}`, v);
  fd.append("0", JSON.stringify(["$undefined", "$K1"]));
  const r = new Request("http://encoder.invalid/", { method: "POST", body: fd });
  const body = Buffer.from(await r.arrayBuffer());
  const h = actionHeaders(id, host, origin, extra);
  h["content-type"] = r.headers.get("content-type") ?? "";
  return raw(port, "POST", path, h, body);
}

async function start(name: string, port: number, env: Record<string, string | undefined>, ready: { host: string; path: string }): Promise<Srv> {
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) if (v !== undefined) childEnv[k] = v;
  const proc = spawn(process.execPath, [join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: process.cwd(),
    env: { ...childEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout?.on("data", (d) => (out += String(d)));
  proc.stderr?.on("data", (d) => (out += String(d)));
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`${name}: next start exited early (${proc.exitCode})`);
    try {
      if ((await raw(port, "GET", ready.path, { host: ready.host })).status === 200) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`${name}: next start did not become ready in 90 s`);
    await sleep(400);
  }
  return {
    name,
    port,
    proc,
    out: () => out,
    stop: () =>
      new Promise<void>((resolve) => {
        if (proc.exitCode !== null) return resolve();
        proc.once("exit", () => resolve());
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5_000).unref();
      }),
  };
}

let created = false;
const servers: Srv[] = [];
let browser: Browser | null = null;
const contexts: BrowserContext[] = [];

async function main() {
  await createPlatformTestDatabase("po07_host_binding", testDbName);
  created = true;
  {
    // The reviewed Trial seed SQL, through the same disposable-server guard and post-check runSeed uses. The release
    // preflight (runSeed's first step) is a gate for real targets and is exercised by its own suites; this database was
    // created by this run a moment ago, and this suite tests the hostname binding, not the seed.
    const { PO02D1B_SEED_SQL_PATH, checkTrialSeed } = await import("../scripts/platform/trial-seed");
    const { assertDisposableLocalDatabaseUrl, assertDisposableLocalServer } = await import("../scripts/platform/local-db-guard");
    const pg = (await import("pg")).default;
    const target = assertDisposableLocalDatabaseUrl(process.env.DATABASE_URL);
    const seedClient = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: "po07-host-binding-seed" });
    await seedClient.connect();
    try {
      await assertDisposableLocalServer(seedClient, target);
      await seedClient.query(readFileSync(PO02D1B_SEED_SQL_PATH, "utf8"));
      const check = await checkTrialSeed(seedClient);
      if (check.state !== "complete") throw new Error(`the Trial seed did not complete: ${check.state}`);
    } finally {
      await seedClient.end();
    }
  }
  const { db, pool, platformAdminsTable } = await import("../src/db");
  const platformAuth = await import("../src/lib/platform/auth");
  const mfa = await import("../src/lib/platform/mfa");
  const totp = await import("../src/lib/platform/totp");
  const invitations = await import("../src/lib/platform/invitations");
  const n = async (text: string, values: unknown[] = []) => Number((await pool.query(text, values)).rows[0]?.n ?? 0);
  ids = await loadActionIds();

  // fictional Platform Owner with TOTP
  const ownerEmail = "owner@host-binding.test";
  const { secret } = mfa.createTotpEnrollment(ownerEmail);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  secretsSeen.push(secret, ...codes);
  const at = new Date();
  await db.insert(platformAdminsTable).values({ emailNormalized: ownerEmail, displayName: "Fictional Operator", passwordHash: await platformAuth.hashPlatformPassword(PASSWORD), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at });
  let lastStep = 0;
  const freshCode = async (): Promise<string> => {
    for (;;) {
      const cur = totp.totpStepAt(new Date());
      const step = Math.max(cur, lastStep + 1);
      if (step <= cur + 1) {
        lastStep = step;
        return totp.hotpCode(secret, step);
      }
      await sleep((cur + 1) * 30_000 - Date.now() + 750);
    }
  };
  const wrongCode = () => {
    const cur = totp.totpStepAt(new Date());
    const valid = new Set([-1, 0, 1].map((d) => totp.hotpCode(secret, cur + d)));
    return ["000000", "111111", "222222"].find((c) => !valid.has(c))!;
  };

  const common = { ...secrets, DATABASE_URL: process.env.DATABASE_URL, PLATFORM_INVITATIONS_LOOPBACK_ORIGIN: "true", CUSTOMER_PUBLIC_ORIGIN: CUST_ORIGIN, CUSTOMER_INVITE_ACCEPTANCE_ENABLED: "true", PDF_RENDER_ORIGIN: undefined };
  const binding = { PLATFORM_CONSOLE_HOST: ADMIN_HOST, CUSTOMER_APP_HOST: CUST_HOST };
  const ADMIN = await start("ADMIN", PA, { ...common, ...binding, PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1" }, { host: ADMIN_HOST, path: "/platform/login" });
  servers.push(ADMIN);
  const CUSTOMER = await start("CUSTOMER", PC, { ...common, ...binding, PLATFORM_CONSOLE_ENABLED: undefined, PLATFORM_TRUSTED_PROXY_HOPS: "0" }, { host: CUST_HOST, path: "/login" });
  servers.push(CUSTOMER);
  const UNBOUND = await start("UNBOUND", PU, { ...common, PLATFORM_CONSOLE_HOST: undefined, CUSTOMER_APP_HOST: undefined, PLATFORM_CONSOLE_ENABLED: "true", PLATFORM_TRUSTED_PROXY_HOPS: "1", CUSTOMER_PUBLIC_ORIGIN: `http://localhost:${PU}` }, { host: `localhost:${PU}`, path: "/login" });
  servers.push(UNBOUND);
  const UNB_HOST = `localhost:${PU}`;

  const platformRows = () => n(`select (select count(*) from platform_login_attempts) + (select count(*) from platform_sessions) as n`);
  const customerRows = (email: string) => n(`select (select count(*) from security_events where email = $1) + (select count(*) from sessions s join users u on u.id = s.user_id where u.email = $1) as n`, [email]);
  const signIn = (port: number, path: string, host: string, origin: string | null, extra: Record<string, string> = {}, code?: string) =>
    postJson(port, path, "platformSignInAction", { email: ownerEmail, password: PASSWORD, ...(code ? { totpCode: code } : {}) }, host, origin, extra);

  // ----------------------------------------------------------------------------------------------------------------------
  section("C1. Console sign-in on the correct admin host (tests 1, 15)");
  const mfaStep = await signIn(PA, "/platform/login", ADMIN_HOST, ADMIN_ORIGIN);
  ok("1a the console sign-in runs on the admin host: the correct password reaches the second-factor step", mfaStep.status === 200 && mfaStep.body.includes("mfa_required") && !setsCookie(mfaStep, PCOOKIE), `${mfaStep.status} ${mfaStep.body.slice(0, 120)}`);
  const wrong = await signIn(PA, "/platform/login", ADMIN_HOST, ADMIN_ORIGIN, {}, wrongCode());
  ok("15a a wrong TOTP code is refused and sets no cookie (MFA stays mandatory)", !wrong.body.includes('"authenticated"') && !setsCookie(wrong, PCOOKIE));
  const good = await signIn(PA, "/platform/login", ADMIN_HOST, ADMIN_ORIGIN, {}, await freshCode());
  const platformToken = cookieValue(good, PCOOKIE);
  if (platformToken) secretsSeen.push(platformToken);
  ok("1b password + fresh TOTP on the admin host signs in: authenticated, one __Host- platform cookie (Secure, HttpOnly, Path=/, no Domain)",
    good.body.includes('"authenticated"') && setsCookie(good, PCOOKIE) && setCookies(good).filter((c) => c.startsWith(`${PCOOKIE}=`)).every((c) => /;\s*Secure/i.test(c) && /;\s*HttpOnly/i.test(c) && /;\s*Path=\/(;|$)/i.test(c) && !/;\s*Domain=/i.test(c)), `${good.status}`);
  const replay = await signIn(PA, "/platform/login", ADMIN_HOST, ADMIN_ORIGIN, {}, totp.hotpCode(secret, lastStep));
  ok("15b the same TOTP step cannot be replayed", !replay.body.includes('"authenticated"') && !setsCookie(replay, PCOOKIE));
  const dash = await raw(PA, "GET", "/platform/dashboard", { host: ADMIN_HOST, cookie: `${PCOOKIE}=${platformToken}` });
  const dashAnon = await raw(PA, "GET", "/platform/dashboard", { host: ADMIN_HOST });
  ok("15c with the session the dashboard renders (200); without it the console redirects to /platform/login (authorization unchanged)", dash.status === 200 && dashAnon.status >= 300 && dashAnon.status < 400 && /\/platform\/login/.test(String(dashAnon.headers.location)));

  // ----------------------------------------------------------------------------------------------------------------------
  section("C2. Console sign-in through the customer host (tests 2, 11)");
  let before = await platformRows();
  const c2a = await signIn(PC, "/platform/login", CUST_HOST, CUST_ORIGIN);
  const c2b = await raw(PC, "GET", "/platform/login", { host: CUST_HOST });
  ok("2a customer process: /platform/login is 404 and the console sign-in action does not run (no MFA step, no cookie, no attempt or session row)", c2b.status === 404 && c2a.status === 404 && !c2a.body.includes("mfa_required") && !setsCookie(c2a, PCOOKIE) && (await platformRows()) === before, `${c2a.status}/${c2b.status}`);
  before = await platformRows();
  const c2c = await signIn(PA, "/platform/login", CUST_HOST, CUST_ORIGIN, { "x-forwarded-host": CUST_HOST });
  const c2d = await raw(PA, "GET", "/platform/login", { host: CUST_HOST, "x-forwarded-host": CUST_HOST });
  ok("2b the console process itself, addressed as the customer host (a misrouted request): /platform/login 404, the action does not run", c2d.status === 404 && !c2c.body.includes("mfa_required") && !setsCookie(c2c, PCOOKIE) && (await platformRows()) === before, `${c2c.status}/${c2d.status}`);
  before = await platformRows();
  const c11a = await raw(PC, "GET", "/platform/login", { host: ADMIN_HOST });
  const c11b = await signIn(PC, "/platform/login", ADMIN_HOST, ADMIN_ORIGIN);
  const c11c = await raw(PC, "GET", "/platform/dashboard", { host: ADMIN_HOST, cookie: `${PCOOKIE}=${platformToken}` });
  ok("11 console switch off in the customer process: even addressed as the admin host, with a LIVE platform cookie, the console is 404 and sign-in does not run", c11a.status === 404 && c11c.status === 404 && !c11b.body.includes("mfa_required") && !setsCookie(c11b, PCOOKIE) && (await platformRows()) === before, `${c11a.status}/${c11b.status}/${c11c.status}`);

  // ----------------------------------------------------------------------------------------------------------------------
  section("C3. Customer registration and sign-in (tests 3, 4)");
  const custEmail = "owner@customer-host.test";
  const regAdmin = await postForm(PA, "/register", "registerAction", { orgName: "Fixture Trading Co", name: "Fixture Owner", email: "admin-side@customer-host.test", password: CUST_PASSWORD, country: "Saudi Arabia", currency: "SAR" }, ADMIN_HOST, ADMIN_ORIGIN);
  const regAdminFwd = await postForm(PA, "/platform/login", "registerAction", { orgName: "Fixture Trading Co", name: "Fixture Owner", email: "admin-side@customer-host.test", password: CUST_PASSWORD, country: "Saudi Arabia", currency: "SAR" }, ADMIN_HOST, ADMIN_ORIGIN);
  ok("3a sign-up through the admin host (direct and forwarded via /platform/login) creates nothing", !setsCookie(regAdmin, CCOOKIE) && !setsCookie(regAdminFwd, CCOOKIE) && (await n(`select count(*) as n from users where email = 'admin-side@customer-host.test'`)) === 0, `${regAdmin.status}/${regAdminFwd.status}`);
  const reg = await postForm(PC, "/register", "registerAction", { orgName: "Fixture Trading Co", name: "Fixture Owner", email: custEmail, password: CUST_PASSWORD, country: "Saudi Arabia", currency: "SAR" }, CUST_HOST, CUST_ORIGIN);
  const custToken0 = cookieValue(reg, CCOOKIE);
  if (custToken0) secretsSeen.push(custToken0);
  ok("4a sign-up on the customer host works (company and owner created, host-only __Host- session cookie)", setsCookie(reg, CCOOKIE) && (await n(`select count(*) as n from users where email = $1`, [custEmail])) === 1 && setCookies(reg).filter((c) => c.startsWith(`${CCOOKIE}=`)).every((c) => !/;\s*Domain=/i.test(c) && /;\s*Secure/i.test(c)), `${reg.status} ${reg.body.slice(0, 160)}`);
  let cBefore = await customerRows(custEmail);
  const loginAdmin = await postForm(PA, "/login", "loginAction", { email: custEmail, password: CUST_PASSWORD }, ADMIN_HOST, ADMIN_ORIGIN);
  ok("3b customer sign-in POSTed to /login on the admin host: 404, no session cookie, no security event or session row", loginAdmin.status === 404 && !setsCookie(loginAdmin, CCOOKIE) && (await customerRows(custEmail)) === cBefore, `${loginAdmin.status}`);
  const login = await postForm(PC, "/login", "loginAction", { email: custEmail, password: CUST_PASSWORD }, CUST_HOST, CUST_ORIGIN);
  const custToken = cookieValue(login, CCOOKIE);
  if (custToken) secretsSeen.push(custToken);
  ok("4b customer sign-in on the customer host works: session cookie (host-only __Host-, Secure, HttpOnly), redirect to /dashboard, the security event and session recorded",
    setsCookie(login, CCOOKIE) && /\/dashboard/.test(String(login.headers["x-action-redirect"] ?? login.headers.location ?? "")) && (await customerRows(custEmail)) > cBefore && setCookies(login).filter((c) => c.startsWith(`${CCOOKIE}=`)).every((c) => !/;\s*Domain=/i.test(c) && /;\s*HttpOnly/i.test(c)), `${login.status}`);
  const custDash = await raw(PC, "GET", "/dashboard", { host: CUST_HOST, cookie: `${CCOOKIE}=${custToken}` });
  ok("4c the customer dashboard renders with that session on the customer host", custDash.status === 200, `${custDash.status}`);

  // ----------------------------------------------------------------------------------------------------------------------
  section("C4. Forwarded Server Actions — the demonstrated bypass, both directions (tests 5, 6)");
  const signInId = ids("platformSignInAction")!;
  const loginId = ids("loginAction")!;
  ok("precondition: the console sign-in action belongs to /platform pages only and the customer login to customer pages only (so each attack below needs forwarding)",
    workersOf(signInId).length > 0 && workersOf(signInId).every((w) => w.includes("/platform/")) && workersOf(loginId).length > 0 && workersOf(loginId).every((w) => !w.includes("/platform/")), `${workersOf(signInId).join(",")} | ${workersOf(loginId).join(",")}`);
  before = await platformRows();
  const f5a = await signIn(PC, "/login", CUST_HOST, CUST_ORIGIN);
  const f5b = await signIn(PA, "/login", CUST_HOST, CUST_ORIGIN, { "x-forwarded-host": CUST_HOST });
  const f5c = await signIn(PA, "/login", ADMIN_HOST, ADMIN_ORIGIN);
  const f5d = await signIn(PA, "/login", CUST_HOST, CUST_ORIGIN, { "x-forwarded-host": CUST_HOST }, await freshCode());
  ok("5 the console sign-in action POSTed to /login — customer process, console process addressed as the customer host, console host, and with a valid TOTP — never runs (no MFA step, no cookie, no row)",
    [f5a, f5b, f5c, f5d].every((r) => !r.body.includes("mfa_required") && !r.body.includes('"authenticated"') && !setsCookie(r, PCOOKIE)) && (await platformRows()) === before, [f5a, f5b, f5c, f5d].map((r) => r.status).join("/"));
  cBefore = await customerRows(custEmail);
  const f6a = await postForm(PA, "/platform/login", "loginAction", { email: custEmail, password: CUST_PASSWORD }, ADMIN_HOST, ADMIN_ORIGIN);
  const f6b = await postForm(PA, "/platform/dashboard", "loginAction", { email: custEmail, password: CUST_PASSWORD }, ADMIN_HOST, ADMIN_ORIGIN, { cookie: `${PCOOKIE}=${platformToken}` });
  ok("6 the customer sign-in action POSTed to /platform/login and /platform/dashboard on the admin host never runs (no session cookie, no security event, no session row)",
    [f6a, f6b].every((r) => !setsCookie(r, CCOOKIE)) && (await customerRows(custEmail)) === cBefore, `${f6a.status}/${f6b.status}`);
  const ctl = await signIn(UNBOUND.port, "/login", UNB_HOST, `http://${UNB_HOST}`);
  ok("6c control (the defect itself): on the UNBOUND process the same forwarded POST to /login DOES run the console sign-in — the test reproduces the bypass the binding closes", ctl.body.includes("mfa_required"), `${ctl.status} ${ctl.body.slice(0, 80)}`);

  // ----------------------------------------------------------------------------------------------------------------------
  section("C5. A privileged action through a proxy-excluded \".png\" path (test 7)");
  const readId = ids("readCompanyAccessAction")!;
  const orgId = Number((await pool.query(`select org_id from users where email = $1`, [custEmail])).rows[0].org_id);
  ok("precondition: readCompanyAccessAction is owned by the dynamic company page", workersOf(readId).some((w) => w.includes("companies/[orgId]")), workersOf(readId).join(","));
  const ctl7 = await postJson(PA, `/platform/companies/${orgId}`, "readCompanyAccessAction", String(orgId), ADMIN_HOST, ADMIN_ORIGIN, { cookie: `${PCOOKIE}=${platformToken}` });
  ok("7a control: on the admin host, with the live session, the privileged read runs and returns the company's access state", ctl7.body.includes('"ok":true'), `${ctl7.status} ${ctl7.body.slice(0, 100)}`);
  const p7 = [
    await postJson(PA, `/platform/companies/${orgId}.png`, "readCompanyAccessAction", String(orgId), CUST_HOST, CUST_ORIGIN, { cookie: `${PCOOKIE}=${platformToken}`, "x-forwarded-host": CUST_HOST }),
    await postJson(PA, `/platform/companies/${orgId}.png`, "readCompanyAccessAction", String(orgId), ADMIN_HOST, CUST_ORIGIN, { cookie: `${PCOOKIE}=${platformToken}`, "x-forwarded-host": CUST_HOST }),
    await postJson(PC, `/platform/companies/${orgId}.png`, "readCompanyAccessAction", String(orgId), ADMIN_HOST, ADMIN_ORIGIN, { cookie: `${PCOOKIE}=${platformToken}` }),
    await postJson(PA, `/login.png`, "readCompanyAccessAction", String(orgId), CUST_HOST, CUST_ORIGIN, { cookie: `${PCOOKIE}=${platformToken}`, "x-forwarded-host": CUST_HOST }),
  ];
  ok("7b the same action with the same live session via \"/platform/companies/<id>.png\" or \"/login.png\" on the customer host (both processes) returns nothing", p7.every((r) => !r.body.includes('"ok":true') && !r.body.includes("Fixture Trading")), p7.map((r) => r.status).join("/"));

  // ----------------------------------------------------------------------------------------------------------------------
  section("C6. Missing, malicious and spoofed host information (tests 8, 9)");
  const noHostA = await rawNoHost(PA, "/platform/login");
  const noHostC = await rawNoHost(PC, "/login");
  const bad = await Promise.all([
    raw(PA, "GET", "/platform/login", { host: "evil.test" }),
    raw(PA, "GET", "/platform/login", { host: `${ADMIN_HOST}.evil.test`, "x-forwarded-host": `${ADMIN_HOST}.evil.test` }),
    raw(PA, "GET", "/platform/login", { host: ADMIN_HOST, "x-forwarded-host": `${ADMIN_HOST}, evil.test` }),
    raw(PA, "GET", "/platform/login", { host: ADMIN_HOST, "x-forwarded-host": `evil.test, ${ADMIN_HOST}` }),
    raw(PA, "GET", "/platform/login", { host: ADMIN_HOST, "x-forwarded-host": "" }),
    raw(PA, "GET", "/platform/login", { host: ADMIN_HOST, "x-forwarded-host": `${ADMIN_HOST}/x` }),
    raw(PC, "GET", "/login", { host: "evil.test" }),
    raw(PC, "GET", "/login", { host: `${CUST_HOST}@evil.test` }),
  ]);
  ok("8 no Host at all, a foreign Host, a look-alike, a listed or empty or malformed X-Forwarded-Host: 404 on both processes (fail closed)", noHostA === 404 && noHostC === 404 && bad.every((r) => r.status === 404), `${noHostA}/${noHostC}/${bad.map((r) => r.status).join("/")}`);
  const sp1 = await raw(PC, "GET", "/platform/login", { host: CUST_HOST, "x-forwarded-host": ADMIN_HOST });
  const sp2 = await raw(PC, "GET", "/login", { host: CUST_HOST, "x-forwarded-host": ADMIN_HOST });
  before = await platformRows();
  const sp3 = await signIn(PC, "/platform/login", CUST_HOST, ADMIN_ORIGIN, { "x-forwarded-host": ADMIN_HOST });
  ok("9a without a trusted proxy (hops 0) a client X-Forwarded-Host is ignored: claiming the admin host reaches no console; the customer page still answers on its Host", sp1.status === 404 && sp2.status === 200 && !sp3.body.includes("mfa_required") && (await platformRows()) === before, `${sp1.status}/${sp2.status}/${sp3.status}`);
  const sp4 = await signIn(PA, "/platform/login", ADMIN_HOST, ADMIN_ORIGIN, { "x-forwarded-host": `${ADMIN_HOST}, ${ADMIN_HOST}` });
  ok("9b with a trusted proxy (hops 1) an appended (listed) X-Forwarded-Host is refused even when every value names the admin host", sp4.status === 404 && !sp4.body.includes("mfa_required"), `${sp4.status}`);

  // ----------------------------------------------------------------------------------------------------------------------
  section("C7. Cross-host Origin (test 10)");
  before = await platformRows();
  const o1 = await signIn(PA, "/platform/login", ADMIN_HOST, CUST_ORIGIN);
  const o2 = await signIn(PA, "/platform/login", ADMIN_HOST, null);
  ok("10a a console action from the customer origin, or with no Origin, is refused on the admin host (no MFA step, no row)", !o1.body.includes("mfa_required") && !o2.body.includes("mfa_required") && (await platformRows()) === before, `${o1.status}/${o2.status}`);
  cBefore = await customerRows(custEmail);
  const o3 = await postForm(PC, "/login", "loginAction", { email: custEmail, password: CUST_PASSWORD }, CUST_HOST, ADMIN_ORIGIN);
  ok("10b a customer sign-in from the admin origin is refused on the customer host (Next's own origin check): no cookie, no record", !setsCookie(o3, CCOOKIE) && (await customerRows(custEmail)) === cBefore, `${o3.status}`);

  // ----------------------------------------------------------------------------------------------------------------------
  section("C8. Session cookie separation (test 12)");
  const x1 = await raw(PA, "GET", "/dashboard", { host: ADMIN_HOST, cookie: `${CCOOKIE}=${custToken}` });
  const x2 = await raw(PA, "GET", "/uploads/organizations/1/logos/1-1-0123456789abcdef.png", { host: ADMIN_HOST, cookie: `${CCOOKIE}=${custToken}` });
  const x3 = await raw(PA, "GET", "/platform/dashboard", { host: ADMIN_HOST, cookie: `${CCOOKIE}=${custToken}` });
  const x4 = await raw(PC, "GET", "/platform/dashboard", { host: CUST_HOST, cookie: `${PCOOKIE}=${platformToken}` });
  const x5 = await raw(PA, "GET", "/dashboard", { host: CUST_HOST, "x-forwarded-host": CUST_HOST, cookie: `${CCOOKIE}=${custToken}` });
  ok("12a a customer cookie on the admin host reaches no customer page or file (404) and is no console session (redirect to /platform/login)", x1.status === 404 && x2.status === 404 && x3.status >= 300 && x3.status < 400 && /\/platform\/login/.test(String(x3.headers.location)), `${x1.status}/${x2.status}/${x3.status}`);
  ok("12b a live platform cookie on the customer host reaches no console page (404)", x4.status === 404, `${x4.status}`);
  ok("12c control: the customer cookie works where it belongs (the customer host, via the console process too — it is the host that decides)", x5.status === 200, `${x5.status}`);

  // browser: real cookies on two hosts
  const exe = process.env.PO07_CHROMIUM || "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.goto(`${ADMIN_ORIGIN}/platform/login`);
  await page.getByLabel("Email", { exact: true }).fill(ownerEmail);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Verification code", { exact: true }).fill(await freshCode());
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  const signedIn = await page.waitForURL("**/platform/dashboard", { timeout: 20_000 }).then(() => true, () => false);
  await page.goto(`${CUST_ORIGIN}/login`);
  await page.getByLabel(/email/i).first().fill(custEmail);
  await page.getByLabel(/password/i).first().fill(CUST_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).first().click();
  const custIn = await page.waitForURL("**/dashboard", { timeout: 20_000 }).then(() => true, () => false);
  const jar = await ctx.cookies();
  const pc = jar.filter((c) => c.name === PCOOKIE);
  const cc = jar.filter((c) => c.name === CCOOKIE);
  pc.forEach((c) => secretsSeen.push(c.value));
  cc.forEach((c) => secretsSeen.push(c.value));
  ok("1c / 4d in Chromium: the console signs in on the admin host (password + TOTP), the customer on the customer host", signedIn && custIn, `${signedIn}/${custIn}`);
  ok("12d each session cookie is held by its own host only — host-only, Secure, HttpOnly — and neither host ever holds the other's",
    pc.length === 1 && pc[0].domain === "admin.localhost" && pc[0].secure && pc[0].httpOnly && cc.length === 1 && cc[0].domain === "localhost" && cc[0].secure && cc[0].httpOnly, JSON.stringify(jar.map((c) => [c.name, c.domain])));
  // a same-origin fetch from a real page on each host: the browser's own cookies and resolver (a bare 404 has no
  // document for page.goto to land on)
  const statusFrom = async (origin: string, landing: string, path: string) => {
    await page.goto(`${origin}${landing}`);
    return page.evaluate(async (p) => (await fetch(p, { redirect: "manual", credentials: "same-origin" })).status, path);
  };
  const adminLoginPage = await statusFrom(ADMIN_ORIGIN, "/platform/dashboard", "/login");
  const custConsolePage = await statusFrom(CUST_ORIGIN, "/dashboard", "/platform/dashboard");
  ok("12e with the browser's own cookies, the customer sign-in page does not exist on the admin host and the console does not exist on the customer host (404)", adminLoginPage === 404 && custConsolePage === 404, `${adminLoginPage}/${custConsolePage}`);

  // ----------------------------------------------------------------------------------------------------------------------
  section("C9. Invitation acceptance on the customer test host (test 13)");
  const trialV1 = String((await pool.query(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.is_default_trial and v.version_number = 1`)).rows[0].id);
  const adminId = String((await pool.query(`select id from platform_admins where email_normalized = $1`, [ownerEmail])).rows[0].id);
  const makeInvitation = async (tag: string) => {
    const { token, tokenHash } = invitations.newInvitationToken();
    secretsSeen.push(token);
    const row = (await pool.query(
      `insert into organization_invitations (company_name, industry, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, expires_at, invited_by_platform_admin_id, created_at, updated_at)
       values ($1, 'Exhibitions', $2, 'Saudi Arabia', 'SAR', 'Fixture Invitee', $3, $4, now() + interval '72 hours', $5, now(), now()) returning id`,
      [`Fixture ${tag} Co`, `office-${tag}@host-binding.test`, `invitee-${tag}@host-binding.test`, tokenHash, adminId],
    )).rows[0].id as string;
    await pool.query(`insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_is_trial, initial_cycle) values ($1, $2, true, 'trial')`, [row, trialV1]);
    return { id: row, token };
  };
  const accepted = async (id: string) => (await pool.query(`select accepted_at from organization_invitations where id = $1`, [id])).rows[0].accepted_at !== null;
  const inv1 = await makeInvitation("a");
  const inv2 = await makeInvitation("b");
  const acc = { ownerName: "Fixture Invitee", password: CUST_PASSWORD, confirm: CUST_PASSWORD };
  const a1 = await postJson(PA, "/register/accept", "acceptInvitationAction", { token: inv2.token, ...acc }, ADMIN_HOST, ADMIN_ORIGIN);
  const a2 = await postJson(PA, "/platform/login", "acceptInvitationAction", { token: inv2.token, ...acc }, ADMIN_HOST, ADMIN_ORIGIN);
  ok("13a acceptance through the admin host (direct, and forwarded via /platform/login) accepts nothing", !(await accepted(inv2.id)) && (await n(`select count(*) as n from users where email = 'invitee-b@host-binding.test'`)) === 0, `${a1.status}/${a2.status}`);
  const a3 = await postJson(PC, "/register/accept", "acceptInvitationAction", { token: inv1.token, ...acc }, CUST_HOST, CUST_ORIGIN, { "x-forwarded-for": "203.0.113.9" });
  ok("13b acceptance on the customer test host works: the invitation is accepted and its company owner exists", (await accepted(inv1.id)) && (await n(`select count(*) as n from users where email = 'invitee-a@host-binding.test'`)) === 1, `${a3.status} ${a3.body.slice(0, 120)}`);
  Object.assign(process.env, { CUSTOMER_PUBLIC_ORIGIN: CUST_ORIGIN, PLATFORM_INVITATIONS_LOOPBACK_ORIGIN: "true" });
  ok("13c an invitation link names only the configured customer origin (never a request header)", invitations.invitationLink(invitations.customerPublicOrigin(), "x".repeat(43)) === `${CUST_ORIGIN}/register/accept#t=${"x".repeat(43)}`);

  // ----------------------------------------------------------------------------------------------------------------------
  section("C10. Non-regression without binding — the live ERP's configuration (test 14)");
  const u = await Promise.all([
    raw(PU, "GET", "/login", { host: UNB_HOST }),
    raw(PU, "GET", "/register", { host: UNB_HOST }),
    raw(PU, "GET", "/platform/login", { host: UNB_HOST }),
    raw(PU, "GET", "/dashboard", { host: UNB_HOST }),
    raw(PU, "GET", "/", { host: UNB_HOST }),
  ]);
  ok("14a unbound: /login 200, /register 200, /platform/login 200 (console on), /dashboard and / redirect to sign-in — exactly as before H-1", u[0].status === 200 && u[1].status === 200 && u[2].status === 200 && u[3].status >= 300 && u[3].status < 400 && u[4].status >= 300 && u[4].status < 400, u.map((r) => r.status).join("/"));
  const ul = await postForm(PU, "/login", "loginAction", { email: custEmail, password: CUST_PASSWORD }, UNB_HOST, `http://${UNB_HOST}`);
  const ud = await raw(PU, "GET", "/dashboard", { host: UNB_HOST, cookie: `${CCOOKIE}=${cookieValue(ul, CCOOKIE)}` });
  secretsSeen.push(cookieValue(ul, CCOOKIE));
  ok("14b unbound: customer sign-in and the dashboard work on any host, as before", setsCookie(ul, CCOOKIE) && ud.status === 200, `${ul.status}/${ud.status}`);
  const us = await signIn(PU, "/platform/login", UNB_HOST, `http://${UNB_HOST}`);
  ok("14c unbound: the console sign-in reaches the MFA step on its own page, as before", us.body.includes("mfa_required"));
  const PUBLIC = ["/", "/login", "/register", "/register/accept", "/join/accept", "/access-suspended", "/auth/clear", "/dashboard", "/sales/invoices", "/favicon.ico"];
  const cs = await Promise.all(PUBLIC.map((p) => raw(PC, "GET", p, { host: CUST_HOST })));
  const us2 = await Promise.all(PUBLIC.map((p) => raw(PU, "GET", p, { host: UNB_HOST })));
  ok("14d bound customer host = unbound, path by path (status and redirect target) for the public pages, a protected page and the shared assets",
    cs.every((r, i) => r.status === us2[i].status && String(r.headers.location ?? "").replace(/^https?:\/\/[^/]+/, "") === String(us2[i].headers.location ?? "").replace(/^https?:\/\/[^/]+/, "")) && cs.filter((r) => r.status === 200).length >= 5,
    PUBLIC.map((p, i) => `${p}:${cs[i].status}/${us2[i].status}`).join(" "));

  // ----------------------------------------------------------------------------------------------------------------------
  section("C11. Nothing secret in any server's output");
  const outputs = servers.map((s) => s.out()).join("\n");
  const leaked = secretsSeen.filter((s) => s && s.length >= 8 && outputs.includes(s));
  ok("no secret, password, TOTP secret, recovery code, token or cookie value appears in any server output", leaked.length === 0, `${leaked.length} value(s)`);
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-host-binding");
} catch (e) {
  console.log(`verify:platform-host-binding aborted: ${describeError(e)}`);
  for (const s of servers) console.log(`--- ${s.name} output tail (scanned, secrets withheld):\n${secretsSeen.reduce((acc, v) => (v && v.length >= 8 ? acc.split(v).join("<redacted>") : acc), s.out().slice(-1500))}`);
  exitCode = 1;
} finally {
  for (const c of contexts) await c.close().catch(() => undefined);
  const b = browser as Browser | null;
  if (b) await b.close().catch(() => undefined);
  for (const s of servers) await s.stop().catch(() => undefined);
  try {
    const { pool } = await import("../src/db");
    await pool.end().catch(() => undefined);
  } catch {
    // never connected
  }
  if (created && process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") await dropDisposableDatabase(testDbName).catch(() => undefined);
}
process.exit(exitCode);
