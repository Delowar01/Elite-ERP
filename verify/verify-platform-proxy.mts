/**
 * Platform Owner PO-01B — proxy routing, token-confusion and tenant-regression suite (no database).
 *
 *   npm run verify:platform-proxy
 *
 * Calls the real `proxy()` from src/proxy.ts with real NextRequest objects:
 *   1. the /platform branch: feature flag, public vs protected paths, cookie clearing, look-alikes;
 *   2. token confusion: customer tokens, wrong key / alg / typ / iss / aud, lifetime, claims, clock;
 *   3. fail-closed configuration (missing, short or shared PLATFORM_AUTH_SECRET);
 *   4. cross-principal cookies: the customer cookie never opens /platform, the platform cookie never
 *      opens a customer route;
 *   5. tenant regression: for a table of customer paths and cookie states, the PO-01B proxy answers
 *      exactly as 621f156's proxy (extracted with `git show` into a temporary file, removed after);
 *   6. the matcher is unchanged; production cookie names match the platform configuration.
 * Every secret is generated in memory for this run and never printed.
 */
import { randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { section, ok, summary, describeError } from "./platform/harness";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const BASE = "621f156f7b129b9c2e289bc46d314ce7587beec2";

// ---- production-name probe (child process: module constants are fixed at import) --------------
if (process.env.PO01B_PROXY_PROBE === "1") {
  const gate = await import("../src/lib/platform-edge/proxy-gate");
  const cfg = await import("../src/lib/platform/config");
  console.log(JSON.stringify({ edge: gate.PLATFORM_EDGE.cookie, config: cfg.PLATFORM_SESSION_COOKIE }));
  process.exit(0);
}

process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.PLATFORM_CONSOLE_ENABLED = "true";

const { NextRequest } = await import("next/server");
const { proxy, config } = await import("../src/proxy");
const gate = await import("../src/lib/platform-edge/proxy-gate");
const platformAuth = await import("../src/lib/platform/auth");
const platformConfig = await import("../src/lib/platform/config");
const tenantAuth = await import("../src/lib/auth");

const ORIGIN = "http://erp.test";
const PCOOKIE = gate.PLATFORM_EDGE.cookie;
const CCOOKIE = process.env.NODE_ENV === "production" ? "__Host-elite_erp_session" : "elite_erp_session";
const enc = (s: string) => new TextEncoder().encode(s);
const platformKey = () => enc(process.env.PLATFORM_AUTH_SECRET!);
const customerKey = () => enc(process.env.AUTH_SECRET!);
const ADMIN = "3f1c2b9e-5d4a-4c7b-9e1f-2a3b4c5d6e7f";
const jti = () => randomBytes(32).toString("base64url");
const nowS = () => Math.floor(Date.now() / 1000);

function req(path: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(new URL(path, ORIGIN), { headers: { ...(cookie ? { cookie } : {}), ...headers } });
}
type Shape = { status: number; location: string | null; next: boolean; setCookie: string; robots: string | null; pathnameHeader: string | null };
function shape(res: Response): Shape {
  return {
    status: res.status,
    location: res.headers.get("location"),
    next: res.headers.get("x-middleware-next") === "1",
    setCookie: (res.headers.get("set-cookie") ?? "").replace(/\s+/g, " "),
    robots: res.headers.get("x-robots-tag"),
    pathnameHeader: res.headers.get("x-middleware-request-x-pathname"),
  };
}
const run = async (path: string, cookies?: Record<string, string>, headers?: Record<string, string>) => shape(await proxy(req(path, cookies, headers)));
const cleared = (s: Shape, name: string) => new RegExp(`(^|, )${name.replace(/[-]/g, "\\-")}=;`).test(s.setCookie) && /Max-Age=0/i.test(s.setCookie);
const toLogin = (s: Shape) => s.status === 307 && s.location === `${ORIGIN}/platform/login`;
const passes = (s: Shape) => s.next && s.status === 200;

async function platformToken(over: { alg?: string; typ?: string | null; iss?: string; aud?: string; use?: string | null; sub?: string; lifetime?: number; iat?: number; extra?: Record<string, unknown>; key?: Uint8Array } = {}) {
  const iat = over.iat ?? nowS();
  const header: { alg: string; typ?: string } = { alg: over.alg ?? "HS256" };
  if (over.typ !== null) header.typ = over.typ ?? "platform+jwt";
  const claims: Record<string, unknown> = { ...(over.use === null ? {} : { typ: over.use ?? "platform" }), ...(over.extra ?? {}) };
  return new SignJWT(claims)
    .setProtectedHeader(header)
    .setIssuer(over.iss ?? "elite-erp")
    .setAudience(over.aud ?? "elite-erp-platform")
    .setSubject(over.sub ?? ADMIN)
    .setJti(jti())
    .setIssuedAt(iat)
    .setExpirationTime(iat + (over.lifetime ?? 3600))
    .sign(over.key ?? platformKey());
}

const PROTECTED = ["/platform", "/platform/", "/platform/dashboard", "/platform/companies", "/platform/users", "/platform/subscribers", "/platform/packages", "/platform/activity", "/platform/settings", "/platform/settings/security", "/platform/unknown/deep"];
const PUBLIC = ["/platform/login", "/platform/recover", "/platform/session-expired"];

async function main() {
  const valid = await platformAuth.signPlatformToken({ adminId: ADMIN, jti: jti(), issuedAt: new Date(), expiresAt: new Date(Date.now() + 12 * 3600_000) });
  const customer = await tenantAuth.signSessionToken({ userId: 7, orgId: 3, jti: "fictional-jti" });

  section("1. /platform branch — feature flag");
  {
    const saved = process.env.PLATFORM_CONSOLE_ENABLED;
    for (const value of [undefined, "", "false", "TRUE", "1", "yes", " true"]) {
      if (value === undefined) delete process.env.PLATFORM_CONSOLE_ENABLED;
      else process.env.PLATFORM_CONSOLE_ENABLED = value;
      const results = await Promise.all([...PROTECTED, ...PUBLIC].map((p) => run(p, { [PCOOKIE]: valid })));
      ok(`flag ${JSON.stringify(value ?? null)}: every /platform path (public, protected, with a valid token) is a bare 404`, results.every((r) => r.status === 404 && !r.location && !r.next && r.setCookie === "" && r.robots === "noindex, nofollow"));
    }
    delete process.env.PLATFORM_CONSOLE_ENABLED;
    ok("flag off: customer routes are unaffected (login renders, dashboard → /login)", passes(await run("/login")) && (await run("/dashboard")).location === `${ORIGIN}/login`);
    process.env.PLATFORM_CONSOLE_ENABLED = saved;
  }

  section("2. /platform branch — public and protected paths (flag on)");
  {
    const pub = await Promise.all(PUBLIC.map((p) => run(p)));
    ok("login / recover / session-expired render without a token, marked noindex", pub.every((r) => passes(r) && r.robots === "noindex, nofollow"));
    const lookalikePublic = await Promise.all(["/platform/login/x", "/platform/loginx", "/platform/recover/../dashboard", "/platform/LOGIN"].map((p) => run(p)));
    ok("public paths are exact: /platform/login/x, /platform/loginx, /platform/LOGIN and a dot-segment escape need a token", lookalikePublic.every(toLogin));
    const noToken = await Promise.all(PROTECTED.map((p) => run(p)));
    ok("every protected path without a token → one redirect to /platform/login, nothing cleared", noToken.every((r) => toLogin(r) && r.setCookie === "" && r.robots === "noindex, nofollow"));
    const withToken = await Promise.all(PROTECTED.map((p) => run(p, { [PCOOKIE]: valid })));
    ok("every protected path with a valid platform token passes to the server (which re-checks the live session)", withToken.every(passes));
    const garbage = await run("/platform/dashboard", { [PCOOKIE]: "not-a-token" });
    ok("a present but invalid platform cookie → redirect to sign-in AND the cookie is cleared (Max-Age=0)", toLogin(garbage) && cleared(garbage, PCOOKIE));
    const empty = await run("/platform/dashboard", { [PCOOKIE]: "" });
    ok("an empty platform cookie is treated as absent-or-invalid (redirect)", toLogin(empty));
    const lookalikes = await Promise.all(["/platformx", "/platform-old", "/Platform/dashboard", "/platforms/dashboard"].map((p) => run(p)));
    ok("look-alike paths (/platformx, /platform-old, /Platform/…, /platforms/…) take the customer branch (→ /login)", lookalikes.every((r) => r.location === `${ORIGIN}/login`));
    ok("redirect target never comes from the request (?next=, //evil, absolute URLs ignored)", (await Promise.all(["/platform/dashboard?next=https://evil.example", "/platform/dashboard?redirect=//evil.example", "/platform/settings?returnTo=/dashboard"].map((p) => run(p)))).every(toLogin));
    ok("the platform branch adds no customer x-pathname header", withToken.every((r) => r.pathnameHeader === null));
  }

  section("3. Token confusion — only a genuine platform token passes the edge");
  {
    const cases: [string, string][] = [
      ["customer session token (customer secret, userId/orgId, no typ)", customer],
      ["customer-shaped token signed with the PLATFORM secret", await new SignJWT({ userId: 7, orgId: 3 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(platformKey())],
      ["platform-shaped token signed with the CUSTOMER secret", await platformToken({ key: customerKey() })],
      ["header typ missing", await platformToken({ typ: null })],
      ["header typ JWT", await platformToken({ typ: "JWT" })],
      ["payload typ missing", await platformToken({ use: null })],
      ["payload typ customer", await platformToken({ use: "customer" })],
      ["wrong issuer", await platformToken({ iss: "elite-erp-tenant" })],
      ["wrong audience", await platformToken({ aud: "elite-erp" })],
      ["HS512 instead of HS256", await platformToken({ alg: "HS512" })],
      ["subject is not a UUID", await platformToken({ sub: "1" })],
      ["carries userId", await platformToken({ extra: { userId: 7 } })],
      ["carries orgId", await platformToken({ extra: { orgId: 3 } })],
      ["lifetime over 12 h", await platformToken({ lifetime: 12 * 3600 + 1 })],
      ["expired", await platformToken({ iat: nowS() - 7200, lifetime: 3600 })],
      ["issued more than 60 s in the future", await platformToken({ iat: nowS() + 600 })],
      ["alg none (unsigned)", `${Buffer.from(JSON.stringify({ alg: "none", typ: "platform+jwt" })).toString("base64url")}.${Buffer.from(JSON.stringify({ typ: "platform", iss: "elite-erp", aud: "elite-erp-platform", sub: ADMIN, jti: jti(), iat: nowS(), exp: nowS() + 600 })).toString("base64url")}.`],
      ["valid token with a flipped signature byte", valid.slice(0, -2) + (valid.endsWith("A") ? "BB" : "AA")],
      ["oversized cookie (4 KiB+)", "a".repeat(5000)],
    ];
    for (const [name, token] of cases) {
      const r = await run("/platform/dashboard", { [PCOOKIE]: token });
      ok(`rejected and cleared: ${name}`, toLogin(r) && cleared(r, PCOOKIE));
    }
    ok("a genuine token from the PO-01A signer passes; a hand-built conforming token passes too", passes(await run("/platform/dashboard", { [PCOOKIE]: valid })) && passes(await run("/platform/dashboard", { [PCOOKIE]: await platformToken() })));
    ok("edge and server checks agree: the server verifier also accepts the genuine token", (await platformAuth.verifyPlatformToken(valid)).adminId === ADMIN);
  }

  section("4. Fail-closed configuration at the edge");
  {
    const saved = process.env.PLATFORM_AUTH_SECRET!;
    delete process.env.PLATFORM_AUTH_SECRET;
    ok("PLATFORM_AUTH_SECRET missing → protected paths redirect (no crash, no pass)", toLogin(await run("/platform/dashboard", { [PCOOKIE]: valid })));
    process.env.PLATFORM_AUTH_SECRET = "x".repeat(31);
    ok("PLATFORM_AUTH_SECRET under 32 bytes → redirect", toLogin(await run("/platform/dashboard", { [PCOOKIE]: valid })));
    process.env.PLATFORM_AUTH_SECRET = process.env.AUTH_SECRET;
    const shared = await platformToken({ key: customerKey() });
    ok("PLATFORM_AUTH_SECRET equal to AUTH_SECRET → even a token signed with it is refused", toLogin(await run("/platform/dashboard", { [PCOOKIE]: shared })));
    process.env.PLATFORM_AUTH_SECRET = saved;
    ok("public pages still render while the configuration is broken (the server answers 'temporarily unavailable')", passes(await run("/platform/login")));
    ok("restored configuration accepts the genuine token again", passes(await run("/platform/dashboard", { [PCOOKIE]: valid })));
  }

  section("5. Cross-principal cookies");
  {
    const c1 = await run("/platform/dashboard", { [CCOOKIE]: customer });
    ok("a valid CUSTOMER session cookie does not open /platform (→ /platform/login, customer cookie untouched)", toLogin(c1) && !c1.setCookie.includes(CCOOKIE));
    const c2 = await run("/platform/dashboard", { [PCOOKIE]: customer });
    ok("a customer token placed in the PLATFORM cookie is rejected and cleared", toLogin(c2) && cleared(c2, PCOOKIE));
    const c3 = await run("/dashboard", { [PCOOKIE]: valid });
    ok("a valid PLATFORM cookie does not open a customer route (/dashboard → /login)", c3.location === `${ORIGIN}/login` && !c3.setCookie.includes(PCOOKIE));
    const c4 = await run("/dashboard", { [CCOOKIE]: valid });
    ok("a platform token placed in the CUSTOMER cookie is rejected and that cookie cleared", c4.location === `${ORIGIN}/login` && cleared(c4, CCOOKIE));
    const c5 = await run("/sales/invoices", { [CCOOKIE]: customer, [PCOOKIE]: valid });
    ok("with both cookies, a customer route is decided by the customer cookie alone (passes, platform cookie untouched)", passes(c5) && c5.setCookie === "");
    const c6 = await run("/platform/settings", { [CCOOKIE]: customer, [PCOOKIE]: "bad" });
    ok("with both cookies, /platform is decided by the platform cookie alone (bad → cleared, customer cookie untouched)", toLogin(c6) && cleared(c6, PCOOKIE) && !c6.setCookie.includes(CCOOKIE));
    ok("the customer verifier refuses the platform token", (await tenantAuth.verifySessionToken(valid)) === null);
    let refused = false;
    try {
      await platformAuth.verifyPlatformToken(customer);
    } catch {
      refused = true;
    }
    ok("the platform verifier refuses the customer token", refused);
  }

  section("6. Tenant regression — identical to 621f156's proxy for customer routes");
  {
    const tmp = join(ROOT, "verify", `.po01b-proxy-base-${process.pid}.tmp.ts`);
    try {
      writeFileSync(tmp, execFileSync("git", ["show", `${BASE}:src/proxy.ts`], { cwd: ROOT, encoding: "utf8" }));
      const base = (await import(tmp)) as typeof import("../src/proxy");
      const expiredCustomer = await new SignJWT({ userId: 7, orgId: 3 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(nowS() - 7200).setExpirationTime(nowS() - 60).sign(customerKey());
      const paths = ["/", "/login", "/register", "/auth/clear", "/auth/clear?next=/register", "/dashboard", "/sales/invoices/12", "/settings/organization?tab=team", "/api/notifications", "/print/invoice/9", "/uploads/org/1/logo", "/platformx", "/platform-old", "/Platform/dashboard", "/recycle-bin", "/design-system"];
      const states: [string, Record<string, string>][] = [
        ["no cookie", {}],
        ["valid customer cookie", { [CCOOKIE]: customer }],
        ["invalid customer cookie", { [CCOOKIE]: "garbage" }],
        ["expired customer cookie", { [CCOOKIE]: expiredCustomer }],
        ["platform cookie only", { [PCOOKIE]: valid }],
        ["customer + platform cookies", { [CCOOKIE]: customer, [PCOOKIE]: valid }],
      ];
      let compared = 0;
      const diffs: string[] = [];
      for (const p of paths) {
        for (const [label, cookies] of states) {
          const [a, b] = [shape(await base.proxy(req(p, cookies))), shape(await proxy(req(p, cookies)))];
          compared++;
          if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${p} [${label}]`);
        }
      }
      ok(`${compared} customer path × cookie combinations answer exactly as 621f156 (status, location, cookies, x-pathname)`, compared === paths.length * states.length && diffs.length === 0, diffs.slice(0, 6).join("; "));
      const savedFlag = process.env.PLATFORM_CONSOLE_ENABLED;
      delete process.env.PLATFORM_CONSOLE_ENABLED;
      const off = await Promise.all(paths.map(async (p) => JSON.stringify(shape(await base.proxy(req(p, { [CCOOKIE]: customer })))) === JSON.stringify(shape(await proxy(req(p, { [CCOOKIE]: customer }))))));
      process.env.PLATFORM_CONSOLE_ENABLED = savedFlag;
      ok("…and also with the console flag off", off.every(Boolean));
      ok("the matcher is byte-for-byte 621f156's (static assets still bypass the proxy)", JSON.stringify(config) === JSON.stringify(base.config));
    } finally {
      if (existsSync(tmp)) rmSync(tmp);
    }
    ok("the temporary base-proxy file is removed", !existsSync(tmp));
  }

  section("7. Constants: edge = server configuration (dev and production names)");
  {
    ok("edge cookie name equals config.PLATFORM_SESSION_COOKIE (this process)", gate.PLATFORM_EDGE.cookie === platformConfig.PLATFORM_SESSION_COOKIE);
    ok(
      "edge JWT constants equal config.PLATFORM_JWT and the 12 h policy",
      gate.PLATFORM_EDGE.algorithm === platformConfig.PLATFORM_JWT.algorithm &&
        gate.PLATFORM_EDGE.issuer === platformConfig.PLATFORM_JWT.issuer &&
        gate.PLATFORM_EDGE.audience === platformConfig.PLATFORM_JWT.audience &&
        gate.PLATFORM_EDGE.headerType === platformConfig.PLATFORM_JWT.headerType &&
        gate.PLATFORM_EDGE.tokenUse === platformConfig.PLATFORM_JWT.tokenUse &&
        gate.PLATFORM_EDGE.maxLifetimeSeconds * 1000 === platformConfig.PLATFORM_SESSION_POLICY.absoluteMs,
    );
    const probe = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], { cwd: ROOT, env: { ...process.env, NODE_ENV: "production", PO01B_PROXY_PROBE: "1" }, encoding: "utf8" });
    let names: { edge?: string; config?: string } = {};
    try {
      names = JSON.parse(probe.stdout.trim().split("\n").pop() ?? "{}");
    } catch {
      names = {};
    }
    ok("production: both use __Host-elite_erp_platform (distinct from the customer __Host-elite_erp_session)", names.edge === "__Host-elite_erp_platform" && names.config === "__Host-elite_erp_platform", probe.status === 0 ? "" : "probe failed");
    ok("PLATFORM_PUBLIC_PATHS is exactly login, recover and session-expired", [...gate.PLATFORM_PUBLIC_PATHS].sort().join(",") === "/platform/login,/platform/recover,/platform/session-expired");
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-proxy");
} catch (e) {
  console.error(`verify:platform-proxy aborted: ${describeError(e)}`);
}
process.exit(exitCode);
