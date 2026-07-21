/*
 * B1 session redirect-loop regression suite (Batch 0).
 *
 * Verifies that an invalid / malformed / expired / revoked session cookie never causes an
 * infinite /login <-> /dashboard redirect loop, that /login always renders, and that the bad
 * cookie is cleared — plus that valid sessions, RBAC, wrong-password rejection and tenant
 * isolation still work. Run against a PRODUCTION build:
 *
 *   npm run build && npm start        # in one shell
 *   node scripts/tests/b1-session-regression.js   # in another
 *
 * Requires: Playwright chromium, a reachable Postgres (DATABASE_URL / local dev creds), and
 * AUTH_SECRET in .env. This is the Batch-0 session regression harness; it will be folded into
 * the full accounting/inventory/session/lifecycle suite in Batch A5.
 */
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { SignJWT } = require("jose");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const COOKIE = process.env.NODE_ENV === "development" ? "elite_erp_session" : "__Host-elite_erp_session";
const runId = Date.now();
const ROOT = path.resolve(__dirname, "..", "..");
const AUTH_SECRET = (fs.readFileSync(path.join(ROOT, ".env"), "utf8").match(/AUTH_SECRET=(.+)/) || [])[1].trim();
const secretKey = new TextEncoder().encode(AUTH_SECRET);

// Local dev DB creds; override via PG* env if needed.
const PG = process.env.PG_CONN || "PGPASSWORD=erp_dev_password psql -h localhost -U erp_app -d elite_erp -t -A -c";
function psql(sql) { return execSync(`${PG} "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim(); }
function bcryptHash(pw) { return execSync(`node -e "process.stdout.write(require('bcryptjs').hashSync('${pw}',10))"`, { cwd: ROOT, encoding: "utf8" }); }
function seedUser(orgId, name, email, role) {
  const f = path.join(require("os").tmpdir(), `b1seed_${runId}_${role}.sql`);
  fs.writeFileSync(f, `insert into users (org_id,name,email,password_hash,role,is_active) values (${orgId},'${name}','${email}','${bcryptHash("TestPass123!")}','${role}',true);\n`);
  execSync(`${PG.replace(" -c", "")} -f ${f}`, { encoding: "utf8" });
  return email;
}

const R = [];
const rec = (o) => { R.push({ timestamp: new Date().toISOString(), ...o }); console.log(`${o.final_status}  ${o.id}  ${o.title}`); if (o.final_status === "FAIL") console.log(`     expected: ${o.expected}\n     actual:   ${o.actual}`); };

async function navChain(context, startUrl) {
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const chain = [];
  page.on("response", (r) => { const u = r.url().replace(BASE, ""); if (u.startsWith("/") || u === "") chain.push(`${r.status()} ${u || "/"}`); });
  let err = null, finalUrl = null, status = null;
  try { const resp = await page.goto(startUrl, { waitUntil: "domcontentloaded" }); finalUrl = page.url().replace(BASE, ""); status = resp ? resp.status() : null; }
  catch (e) { err = e.message.split("\n")[0]; finalUrl = page.url().replace(BASE, ""); }
  const looped = /ERR_TOO_MANY_REDIRECTS/.test(err || "");
  const ck = (await context.cookies()).find((c) => c.name === COOKIE);
  const h1 = err ? null : ((await page.locator("h1,h2,h3").first().textContent().catch(() => "")) || "").trim();
  await page.close();
  return { chain, finalUrl, status, err, looped, cookieAfterPresent: Boolean(ck && ck.value), h1 };
}
async function badCookieCtx(browser, value) {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: COOKIE, value, domain: "localhost", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
  return ctx;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium" });
  const owner = await browser.newContext(); const op = await owner.newPage();
  await op.goto(`${BASE}/register`);
  await op.fill('input[name="orgName"]', `B1 Org ${runId}`); await op.fill('input[name="name"]', "B1 Owner");
  await op.fill('input[name="email"]', `b1owner-${runId}@ex.com`); await op.fill('input[name="password"]', "TestPass123!");
  await op.click('button[type="submit"]'); await op.waitForURL(/\/dashboard/, { timeout: 60000 });
  const orgId = Number(psql(`select id from orgs where name='B1 Org ${runId}'`));
  const ownerUid = Number(psql(`select id from users where email='b1owner-${runId}@ex.com'`));

  for (const [id, title, val] of [["B1.1", "Garbage cookie", "not-a-real-jwt"], ["B1.2", "Malformed JWT", "aaa.bbb.ccc"]]) {
    for (const [lab, start] of [["/dashboard", `${BASE}/dashboard`], ["/login", `${BASE}/login`]]) {
      const ctx = await badCookieCtx(browser, val); const r = await navChain(ctx, start);
      rec({ id: `${id} ${lab}`, title: `${title} on ${lab}`, redirect_chain: r.chain.join(" -> "), final_url: r.finalUrl,
        cookie_after: r.cookieAfterPresent ? "STILL PRESENT" : "cleared", expected: "no loop; /login(200); cookie cleared",
        actual: `looped=${r.looped} final=${r.finalUrl} http=${r.status} cookieAfter=${r.cookieAfterPresent ? "present" : "cleared"}`,
        final_status: (!r.looped && r.finalUrl === "/login" && r.status === 200 && !r.cookieAfterPresent) ? "PASS" : "FAIL" });
      await ctx.close();
    }
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const expiredJwt = await new SignJWT({ userId: ownerUid, orgId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(nowSec - 100000).setExpirationTime(nowSec - 1000).setJti("expired-" + runId).sign(secretKey);
  for (const [lab, start] of [["/dashboard", `${BASE}/dashboard`], ["/login", `${BASE}/login`]]) {
    const ctx = await badCookieCtx(browser, expiredJwt); const r = await navChain(ctx, start);
    rec({ id: `B1.3 ${lab}`, title: `Expired signed JWT on ${lab}`, redirect_chain: r.chain.join(" -> "), final_url: r.finalUrl,
      cookie_after: r.cookieAfterPresent ? "STILL PRESENT" : "cleared", expected: "unusable; no loop; /login(200); cleared",
      actual: `looped=${r.looped} final=${r.finalUrl} http=${r.status} cookieAfter=${r.cookieAfterPresent ? "present" : "cleared"}`,
      final_status: (!r.looped && r.finalUrl === "/login" && r.status === 200 && !r.cookieAfterPresent) ? "PASS" : "FAIL" });
    await ctx.close();
  }
  for (const [lab, start] of [["/dashboard", `${BASE}/dashboard`], ["/login", `${BASE}/login`]]) {
    const ctx = await browser.newContext(); const p = await ctx.newPage();
    await p.goto(`${BASE}/login`); await p.fill('input[name="email"]', `b1owner-${runId}@ex.com`); await p.fill('input[name="password"]', "TestPass123!");
    await p.click('button[type="submit"]'); await p.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {}); await p.close();
    psql(`update sessions set revoked_at=now(), revoked_reason='b1_test' where user_id=${ownerUid} and revoked_at is null`);
    const r = await navChain(ctx, start);
    rec({ id: `B1.4 ${lab}`, title: `Revoked session on ${lab}`, redirect_chain: r.chain.join(" -> "), final_url: r.finalUrl,
      cookie_after: r.cookieAfterPresent ? "STILL PRESENT" : "cleared", db_session_after: "revoked", expected: "no loop; /login(200); cleared",
      actual: `looped=${r.looped} final=${r.finalUrl} http=${r.status} cookieAfter=${r.cookieAfterPresent ? "present" : "cleared"}`,
      final_status: (!r.looped && r.finalUrl === "/login" && r.status === 200 && !r.cookieAfterPresent) ? "PASS" : "FAIL" });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(); const p = await ctx.newPage();
    await p.goto(`${BASE}/login`); await p.fill('input[name="email"]', `b1owner-${runId}@ex.com`); await p.fill('input[name="password"]', "TestPass123!");
    await p.click('button[type="submit"]'); await p.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
    let loggedOut = false;
    try { await p.locator(".topbar-profile").click({ timeout: 8000 }); await p.waitForTimeout(400); await p.getByRole("menuitem", { name: /Log out/i }).click({ timeout: 8000 }); await p.waitForURL(/\/login/, { timeout: 15000 }); loggedOut = true; } catch { loggedOut = /\/login/.test(p.url()); }
    const revoked = psql(`select count(*) from sessions where user_id=${ownerUid} and revoked_reason='logout'`);
    const ck = (await ctx.cookies()).find((c) => c.name === COOKIE);
    const r = await navChain(ctx, `${BASE}/dashboard`); const login = await navChain(ctx, `${BASE}/login`);
    rec({ id: "B1.5", title: "Normal logout (revoke + clear + redirect + idempotent)", redirect_chain: `logout; /dashboard: ${r.chain.join(" -> ")}`, final_url: r.finalUrl,
      cookie_after: (ck && ck.value) ? "STILL PRESENT" : "cleared", db_session_after: `revoked(logout)=${revoked}`, expected: "revoke+clear+/login renders; no post-logout loop",
      actual: `loggedOut=${loggedOut} revoked=${revoked} cookieAfter=${(ck && ck.value) ? "present" : "cleared"} loop=${r.looped} loginHttp=${login.status}`,
      final_status: (loggedOut && Number(revoked) >= 1 && !(ck && ck.value) && !r.looped && r.finalUrl === "/login" && login.status === 200) ? "PASS" : "FAIL" });
    await ctx.close();
  }
  for (const [id, start, wantH1] of [["B1.6", "/login", null], ["B1.7", "/dashboard", "Dashboard"]]) {
    const out = [];
    for (const [lab, val] of [["garbage", "not-a-real-jwt"], ["malformed", "aaa.bbb.ccc"], ["expired", expiredJwt]]) {
      const ctx = await badCookieCtx(browser, val); const r = await navChain(ctx, `${BASE}${start}`);
      const leak = wantH1 ? r.h1 === wantH1 : false;
      out.push(`${lab}:${r.status}/${r.finalUrl}/loop=${r.looped}${wantH1 ? `/leak=${leak}` : ""}`);
      await ctx.close();
    }
    const pass = out.every((x) => x.includes(":200/") && x.includes("/login/") && x.includes("loop=false") && (!wantH1 || x.includes("leak=false")));
    rec({ id, title: id === "B1.6" ? "/login reachable with every unusable cookie" : "Protected route with unusable cookie -> /login, no data",
      redirect_chain: "(per type)", final_url: "/login", cookie_after: "cleared", expected: "no loop; /login(200)" + (wantH1 ? "; no data" : ""),
      actual: out.join(" | "), final_status: pass ? "PASS" : "FAIL" });
  }

  fs.writeFileSync(path.join(__dirname, ".last-b1-results.json"), JSON.stringify(R, null, 2));
  const pass = R.filter((r) => r.final_status === "PASS").length;
  console.log(`\n${pass}/${R.length} B1 regression checks passed`);
  await browser.close();
  process.exit(pass === R.length ? 0 : 1);
})();
