// Platform Owner PO-01A + PO-01B — static boundary checks (no database, no network).
// Run: node tests/security/platform-boundary.test.mjs   (npm run verify:platform-boundary)
//
// Encodes the separation rules between the Platform Owner console and the customer ERP so a later
// change cannot silently erode them. Rules 1–8 are PO-01A's; PO-01B widened rule 3 (the console
// routes may import the platform library) and replaced rule 9 ("no platform routes yet") with the
// console rules 9–18 below; PO-01B.1 added rules 19–20 (session changes and the audit-outage policy).
// PO-02B made Companies and the Dashboard operational (read-only): rule 18 now covers the four
// sections that are still previews, and rules 21–28 pin the company read model and its pages; rule 29
// keeps Platform Owner states colour-free (neutral tags from one table of labels and icons). PO-02C made
// company access operational: rules 3, 11, 12, 21, 23, 24 and 26 name its exact exceptions, and rules
// 30–36 pin the customer tenant-access gate, the access action, the dialog and the suspended screen.
// PO-02C.1 added rule 37 (the sign-in / access lock protocol). PO-02D1A added rules 38–41: the onboarding
// database foundation is schema only (no code path, permission, route, flag or seed) and its SQL stays bounded.
// PO-02D1A.1 added rule 42: the reviewed foundations' scratch references never point at a live table (D-11b), the
// release preflight is read-only, and the customer db:push command is unchanged. PO-02D1B narrowed rule 41's "no seed
// file" to "no seed file but PO-02D1B's two reviewed ones" and added rule 43 (the seed is data-only, development-only
// and narrowly scoped; its rollback suspends exactly one trigger for one statement). PO-02D2 made company invitation
// administration operational (create · revoke · re-issue · one-time copy link) behind PLATFORM_INVITATIONS_ENABLED:
// rules 11, 12, 21, 23, 25, 26, 29, 38, 39 and 40 name its exact exceptions (no acceptance route, no other flag, no
// subscription write), and rule 44 pins the invitation service, its token handling and its transactions. PO-02D3 made
// invitation acceptance operational behind CUSTOMER_INVITE_ACCEPTANCE_ENABLED (default off): rules 3, 11's customer twin,
// 33, 38, 39, 40 and 44 name its exact exceptions (the one onboarding bridge, the new company's access row, its primary
// owner / Trial subscription / event, the /register/accept route, the acceptance flag, the acceptance itself and the
// digest lookup), and rule 45 pins the acceptance flow: the bridge, the route and its token handling, the ONE
// transaction and its writes, the durable throttle, the shared organization bootstrap and the customer audit executor.
// PO-03A added primary-owner protection (O-3) and read-only user-seat accounting: rules 3, 11's customer twin, 21 and 38
// name their exact exceptions (the ONE Team ownership gate; the seat service's user counts; the primary-owner and seat
// cores naming their onboarding tables), and rule 46 pins the Team-change transaction and its lock order, the read-only
// cores, the gate and its callers, the activity executor, and that nothing enforces seats or writes a mapping.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
let pass = 0;
let fail = 0;
function ok(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}
const read = (p) => readFileSync(p, "utf8");
const rel = (p) => relative(root, p);
const importsOf = (src) => [...src.matchAll(/(?:import|export)\s[^"'`]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);

const platformLib = walk(join(root, "src/lib/platform"));
const allSrc = walk(join(root, "src"));
const platformScripts = walk(join(root, "scripts/platform"));

// 1. Every platform library module is server-only.
const notServerOnly = platformLib.filter((f) => !/^import "server-only";/m.test(read(f).split("\n").find((l) => l.trim() && !l.startsWith("//")) ?? ""));
ok("every src/lib/platform module starts with import \"server-only\"", platformLib.length >= 12 && notServerOnly.length === 0, notServerOnly.map(rel).join(", ") || `${platformLib.length} modules`);

// 2. The platform library never imports customer identity/session code.
const TENANT_AUTH = ["@/lib/session", "@/lib/auth", "@/lib/rate-limit", "@/lib/tenant", "@/lib/security/session-store", "@/lib/security/audit"];
const tenantImports = platformLib.filter((f) => importsOf(read(f)).some((s) => TENANT_AUTH.includes(s) || s.startsWith("@/app/")));
ok("src/lib/platform imports no customer session/auth/tenant/rate-limit/audit module", tenantImports.length === 0, tenantImports.map(rel).join(", "));

// 3. Only the console routes import the platform library; only the proxy imports the edge gate.
const under = (f, d) => f.startsWith(join(root, d) + "/") || f === join(root, d);
// PO-02C: the one exception is the customer tenant-access gate, which imports the access rule alone (rule 30).
const GATE = join(root, "src/lib/security/tenant-access-gate.ts");
// PO-02D3: the onboarding bridge is the ONE customer module that reaches the platform acceptance core (rule 45 pins its imports).
const ACCEPTANCE_BRIDGE = join(root, "src/lib/onboarding/invitation-acceptance.ts");
// PO-03A: the Team ownership gate is the ONE customer module that reaches the primary-owner and seat cores (rule 46 pins its imports).
const OWNERSHIP_GATE = join(root, "src/lib/team/ownership-gate.ts");
const importers = allSrc.filter((f) => f !== GATE && f !== ACCEPTANCE_BRIDGE && f !== OWNERSHIP_GATE && !under(f, "src/lib/platform") && !under(f, "src/app/(platform)") && importsOf(read(f)).some((s) => s.startsWith("@/lib/platform/") || s.includes("/lib/platform/")));
ok("outside src/lib/platform only src/app/(platform) imports the platform library (and the PO-02C tenant-access gate, the access rule alone; the PO-02D3 onboarding bridge, the acceptance core alone — rule 45; and the PO-03A Team ownership gate, the primary-owner and seat cores alone — rule 46)", importers.length === 0, importers.map(rel).join(", "));
const edgeImporters = allSrc.filter((f) => importsOf(read(f)).some((s) => s.startsWith("@/lib/platform-edge") || s.includes("/platform-edge/")));
ok("only src/proxy.ts imports the edge gate (src/lib/platform-edge)", edgeImporters.length === 1 && rel(edgeImporters[0]) === join("src", "proxy.ts"), edgeImporters.map(rel).join(", "));
const appToScripts = allSrc.filter((f) => importsOf(read(f)).some((s) => s.includes("scripts/platform")));
ok("no src/ file imports scripts/platform (bootstrap stays out of the app bundle)", appToScripts.length === 0, appToScripts.map(rel).join(", "));

// 4. Separate secrets: the customer auth never reads PLATFORM_AUTH_SECRET; the platform reads
//    AUTH_SECRET only to refuse sharing it (config.ts).
const tenantAuthFiles = ["src/lib/auth.ts", "src/lib/session.ts", "src/proxy.ts", "src/app/(auth)/actions.ts"].map((p) => join(root, p));
ok("customer auth code never references PLATFORM_AUTH_SECRET", tenantAuthFiles.every((f) => !read(f).includes("PLATFORM_AUTH_SECRET")));
const authSecretReaders = platformLib.filter((f) => /process\.env\.AUTH_SECRET/.test(read(f)));
ok("only platform/config.ts reads AUTH_SECRET (to refuse a shared secret)", authSecretReaders.length === 1 && rel(authSecretReaders[0]) === join("src", "lib", "platform", "config.ts"), authSecretReaders.map(rel).join(", "));
const fallback = [...platformLib, ...platformScripts].filter((f) => /PLATFORM_AUTH_SECRET\s*(\|\||\?\?)\s*["'`]/.test(read(f)));
ok("no insecure PLATFORM_AUTH_SECRET fallback", fallback.length === 0, fallback.map(rel).join(", "));
const cfg = read(join(root, "src/lib/platform/config.ts"));
const cookieAssignment = (cfg.match(/export const PLATFORM_SESSION_COOKIE\s*=[^;]*;/) ?? [""])[0];
ok("platform cookie name differs from the customer session cookie", /"__Host-elite_erp_platform"/.test(cookieAssignment) && !/elite_erp_session/.test(cookieAssignment), cookieAssignment);

// 5. Append-only by construction: no update/delete of platform_audit_events anywhere in code.
const auditMutators = [...allSrc, ...platformScripts].filter((f) => /\.(update|delete)\(\s*platformAuditEventsTable/.test(read(f)));
ok("no code path updates or deletes platformAuditEventsTable", auditMutators.length === 0, auditMutators.map(rel).join(", "));

// 6. No default administrator credentials in shipped code.
// literal e-mail strings, or a quoted literal assigned to a password/hash/secret identifier
const credentialish = [...platformLib, ...platformScripts].filter((f) => /["'`][A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}["'`]/.test(read(f)) || /\b(password|passwordHash|secret|mfaSecretEncrypted)\s*[:=]\s*["'`][^"'`\s]{6,}["'`]/i.test(read(f)));
ok("no hard-coded e-mail, password or password hash in platform code/scripts", credentialish.length === 0, credentialish.map(rel).join(", "));

// 7. Database operations in platform scripts go through the fail-closed guard.
const dbScripts = platformScripts.filter((f) => /new (Client|Pool)\(/.test(read(f)));
const unguarded = dbScripts.filter((f) => !/assertDisposableLocalDatabaseUrl/.test(read(f)) || !/assertDisposableLocalServer/.test(read(f)));
ok("every platform script that opens a connection uses both guard steps", dbScripts.length >= 3 && unguarded.length === 0, unguarded.map(rel).join(", ") || `${dbScripts.length} scripts`);

// 8. Migration hygiene: historical Drizzle migrations untouched; platform SQL outside the journal.
const journal = JSON.parse(read(join(root, "drizzle/meta/_journal.json")));
ok("drizzle journal still lists exactly 0000–0004 (no generated migration)", journal.entries.length === 5 && !existsSync(join(root, "drizzle/0005")) && readdirSync(join(root, "drizzle")).filter((n) => /^\d{4}_.*\.sql$/.test(n)).length === 5);
ok("platform SQL lives outside the journal", existsSync(join(root, "drizzle/platform/PO01_platform_identity.sql")) && !JSON.stringify(journal).includes("platform"));
const sqlText = read(join(root, "drizzle/platform/PO01_platform_identity.sql"));
const alters = [...sqlText.matchAll(/ALTER\s+TABLE\s+(\w+)/gi)].map((m) => m[1]).filter((t) => !t.startsWith("platform_"));
const creates = [...sqlText.matchAll(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi)].map((m) => m[1]);
ok("platform SQL alters no existing table and creates only platform_* objects", alters.length === 0 && creates.length > 0 && creates.every((n) => n.startsWith("platform_")), alters.join(", "));

// ---------------------------------------------------------------------------------------------
// PO-01B — the Platform Owner console (src/app/(platform), src/components/platform, the edge gate).
// ---------------------------------------------------------------------------------------------
const consoleApp = walk(join(root, "src/app/(platform)"));
const consoleUi = walk(join(root, "src/components/platform"));
const edgeGate = join(root, "src/lib/platform-edge/proxy-gate.ts");
const proxySrc = read(join(root, "src/proxy.ts"));
const sideEffectImports = (src) => [...src.matchAll(/^import\s+["']([^"']+)["'];/gm)].map((m) => m[1]);
// Source without comments, for content rules that must not trip over explanatory comments.
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// 9. The proxy's /platform branch: one delegation, before the customer cookie is read; nothing else.
const branchAt = proxySrc.indexOf("if (isPlatformPath(pathname)) return platformGate(request);");
ok("src/proxy.ts delegates /platform to platformGate before it reads the customer cookie", branchAt > 0 && branchAt < proxySrc.indexOf("request.cookies.get(SESSION_COOKIE)") && proxySrc.split("platformGate(").length === 2);
ok("src/proxy.ts never reads the platform cookie or secret itself", !/PLATFORM_AUTH_SECRET|elite_erp_platform|PLATFORM_EDGE/.test(proxySrc));
ok("the console routes exist: login, recover, session-expired and the seven sections", ["(public)/login/page.tsx", "(public)/recover/page.tsx", "session-expired/route.ts", ...["dashboard", "companies", "users", "subscribers", "packages", "activity", "settings"].map((p) => `(console)/${p}/page.tsx`)].every((p) => existsSync(join(root, "src/app/(platform)/platform", p))));

// 10. The edge gate is edge-safe and mirrors the server configuration.
const gateSrc = read(edgeGate);
ok("edge gate is not server-only and imports only next/server and jose", !/^import\s+["']server-only["']/m.test(gateSrc) && importsOf(gateSrc).every((s) => s === "next/server" || s === "jose") && walk(join(root, "src/lib/platform-edge")).length === 1);
ok("edge gate constants equal src/lib/platform/config.ts (cookie, iss, aud, typ, payload marker, HS256, 12 h)", [
  /cookie: process\.env\.NODE_ENV === "production" \? "__Host-elite_erp_platform" : "elite_erp_platform"/,
  /algorithm: "HS256"/, /issuer: "elite-erp"/, /audience: "elite-erp-platform"/, /headerType: "platform\+jwt"/, /tokenUse: "platform"/, /maxLifetimeSeconds: 12 \* 60 \* 60/,
].every((re) => re.test(gateSrc)) && /PLATFORM_SESSION_COOKIE = process\.env\.NODE_ENV === "production" \? "__Host-elite_erp_platform" : "elite_erp_platform"/.test(cfg) && /absoluteMs: 12 \* 60 \* 60 \* 1000/.test(cfg));
ok("edge gate public paths are exactly login, recover and session-expired", /new Set\(\["\/platform\/login", "\/platform\/recover", "\/platform\/session-expired"\]\)/.test(gateSrc));
ok("edge gate reads AUTH_SECRET only to refuse a shared secret", (gateSrc.match(/process\.env\.AUTH_SECRET/g) ?? []).length === 2 && /process\.env\.AUTH_SECRET && secret === process\.env\.AUTH_SECRET/.test(gateSrc));

// 11. Console imports are allow-listed: no customer session/auth/tenant code, no direct database.
const APP_ALLOWED = [/^next(\/|$)/, /^react$/, /^lucide-react$/, /^zod$/, /^@\/lib\/platform\//, /^@\/components\/platform\//, /^@\/components\/ui\//, /^@\/components\/brand\//, /^@\/lib\/i18n\/(server|dict)$/, /^@\/lib\/theme$/, /^@\/app\/\((app|auth)\)\/[a-z-]+\.css$/, /^@\/app\/\(platform\)\/platform\.css$/];
const UI_ALLOWED = [/^next(\/|$)/, /^react$/, /^lucide-react$/, /^sonner$/, /^@radix-ui\/react-dialog$/, /^@\/components\/ui\//, /^@\/components\/brand\//, /^@\/components\/layout\/(brand-mark|language-switcher|theme-toggle|page-header)$/, /^@\/lib\/utils$/, /^@\/lib\/i18n\/dict$/, /^@\/lib\/theme$/, /^@\/app\/\(platform\)\/(auth|security|company-access|invitation)-actions$/, /^\.\/[a-z0-9-]+$/];
// PO-02D2: the invitation dialog alone may also import the two client-safe catalogues /register uses (pure data, no imports).
const UI_ALLOWED_FOR = { [join(root, "src/components/platform/invitation-dialogs.tsx")]: [/^@\/lib\/geo\/countries$/, /^@\/lib\/currency\/currencies$/] };
const badApp = consoleApp.flatMap((f) => [...importsOf(read(f)), ...sideEffectImports(read(f))].filter((s) => !APP_ALLOWED.some((re) => re.test(s))).map((s) => `${rel(f)} → ${s}`));
ok("src/app/(platform) imports only the platform library, console components, shared UI and i18n (no @/db, session, auth, tenant)", consoleApp.length >= 15 && badApp.length === 0, badApp.join(", "));
const badUi = consoleUi.flatMap((f) => [...importsOf(read(f)), ...sideEffectImports(read(f))].filter((s) => ![...UI_ALLOWED, ...(UI_ALLOWED_FOR[f] ?? [])].some((re) => re.test(s))).map((s) => `${rel(f)} → ${s}`));
ok("src/components/platform imports no server module, no customer shell (AppShell/Sidebar/NavList) and no customer action", consoleUi.length >= 10 && badUi.length === 0, badUi.join(", "));
const PLATFORM_MODULES = (s) => s.startsWith("@/lib/platform") || s.startsWith("@/components/platform") || s.startsWith("@/app/(platform)");
const leaks = allSrc.filter((f) => f !== GATE && f !== ACCEPTANCE_BRIDGE && f !== OWNERSHIP_GATE && !under(f, "src/app/(platform)") && !under(f, "src/components/platform") && !under(f, "src/lib/platform") && !under(f, "src/lib/platform-edge") && rel(f) !== join("src", "proxy.ts") && importsOf(read(f)).some(PLATFORM_MODULES));
ok("no customer route, component or library imports any platform module (except the PO-02C tenant-access gate — rule 30 —, the PO-02D3 onboarding bridge — rule 45 — and the PO-03A Team ownership gate — rule 46)", leaks.length === 0, leaks.map(rel).join(", "));

// 12. Server actions are authorized on their own (never by the UI): each exported action calls a
//     console core, which checks flag → origin → live session → permission.
// PO-02D2: the five invitation cores (src/lib/platform/invitation-actions.ts) join the list; rule 44 pins their order.
const CORES = /\b(signInCore|signOutCore|revokeSessionCore|signOutOtherSessionsCore|regenerateRecoveryCodesCore|emergencyContainmentCore|setCompanyAccessCore|readCompanyAccessCore|previewCompanyInvitation|createCompanyInvitation|revokeCompanyInvitation|reissueCompanyInvitation|readCompanyInvitation)\(/;
const actionFiles = consoleApp.filter((f) => /^\s*"use server";/.test(read(f)));
const unguardedActions = actionFiles.flatMap((f) => {
  const src = read(f);
  const parts = src.split(/\n(?=export )/).filter((p) => p.startsWith("export "));
  const stray = parts.filter((p) => !/^export (async function|type) /.test(p)).map((p) => `${rel(f)}: ${p.slice(0, 40)}`);
  const unauth = parts.filter((p) => p.startsWith("export async function") && !CORES.test(p)).map((p) => `${rel(f)}: ${p.slice(22, 60)}`);
  return [...stray, ...unauth];
});
ok("every exported server action in src/app/(platform) runs through a console core (and exports nothing else) — auth, security, (PO-02C) company access and (PO-02D2) invitations", actionFiles.length === 4 && unguardedActions.length === 0, unguardedActions.join(", "));
const coreSrc = read(join(root, "src/lib/platform/console.ts"));
ok("console mutations check the flag, then same-origin, then the live session", /async function authorizeMutation[\s\S]{0,200}assertPlatformConsoleEnabled\(\);\s*assertSameOrigin\(req\.headers\);\s*return authorizePlatformToken\(/.test(coreSrc) && (coreSrc.match(/authorizeMutation\(req,/g) ?? []).length === 4 && /signInCore[\s\S]{0,200}assertSameOrigin/.test(coreSrc) && /signOutCore[\s\S]{0,200}assertSameOrigin/.test(coreSrc));

// 13. Every console page, layout and handler checks the platform session or the flag itself.
const pages = consoleApp.filter((f) => /\(console\)\/[a-z-]+\/page\.tsx$/.test(f) || /\(console\)\/layout\.tsx$/.test(f) || /\/platform\/page\.tsx$/.test(f));
const unguardedPages = pages.filter((f) => !/await requirePlatformSession\(\)/.test(read(f)));
ok("every console page and the console layout await requirePlatformSession()", pages.length === 9 && unguardedPages.length === 0, unguardedPages.map(rel).join(", "));
const pubLayout = read(join(root, "src/app/(platform)/platform/(public)/layout.tsx"));
const expired = read(join(root, "src/app/(platform)/platform/session-expired/route.ts"));
ok("public pages and the session-expired handler check the feature flag server-side", /if \(!isPlatformConsoleEnabled\(\)\) notFound\(\);/.test(pubLayout) && /if \(!isPlatformConsoleEnabled\(\)\) return new NextResponse\(null, \{ status: 404/.test(expired));
ok("session-expired clears the cookie only when the same session check fails (no loop)", /authorizePlatformToken\(token\)/.test(expired) && expired.indexOf("authorizePlatformToken(token)") < expired.indexOf('res.cookies.set(PLATFORM_SESSION_COOKIE, ""'));
ok("the guard sends an unusable session to the cookie-clearing handler, not straight back to a guarded page", /return redirect\("\/platform\/session-expired"\);/.test(read(join(root, "src/lib/platform/guards.ts"))));

// 14. Credentials and tokens stay out of the browser.
const consoleFiles = [...consoleApp, ...consoleUi];
const storage = consoleFiles.filter((f) => /\b(localStorage|sessionStorage|indexedDB)\b/.test(code(f)));
ok("no console file touches localStorage, sessionStorage or IndexedDB", storage.length === 0, storage.map(rel).join(", "));
const cookieWrites = consoleFiles.flatMap((f) => [...read(f).matchAll(/document\.cookie\s*=\s*([^;]+);/g)].map((m) => `${rel(f)}: ${m[1]}`));
ok("the only client-written cookie is the sidebar layout preference (path /platform)", cookieWrites.length === 1 && /PLATFORM_SIDEBAR_COOKIE/.test(cookieWrites[0]) && /path=\/platform/.test(read(join(root, "src/components/platform/platform-sidebar.tsx"))));
const authActions = read(join(root, "src/app/(platform)/auth-actions.ts"));
ok("the sign-in action puts the token only into the HttpOnly cookie, never in a return value", (authActions.match(/outcome\.token/g) ?? []).length === 1 && /cookies\(\)\)\.set\(PLATFORM_SESSION_COOKIE, outcome\.token, platformSessionCookieOptions\(outcome\.expiresAt\)\)/.test(authActions) && !authActions.split("\n").some((l) => /\breturn\b/.test(l) && /token/i.test(l)));
ok("platform cookie options are HttpOnly, SameSite=Lax, Path=/, Secure in production, no Domain", /httpOnly: true,\s*secure: process\.env\.NODE_ENV === "production",\s*sameSite: "lax" as const,\s*path: "\/",\s*expires: expiresAt,/.test(cfg) && !/domain:/i.test(cfg));
const logged = consoleFiles.filter((f) => /console\.(log|info|debug)\(/.test(code(f)) || /console\.\w+\([^)]*(password|token|totp|code)/i.test(code(f)));
ok("no console file logs credentials, codes or tokens", logged.length === 0, logged.map(rel).join(", "));

// 15. No open redirect: every navigation target in the console is a fixed /platform path.
const NAV = /\b(redirect|router\.replace|router\.push)\(\s*([^)]*)\)|new URL\(\s*([^,)]*)\s*,\s*request\.url\)|NextResponse\.redirect\(\s*new URL\(\s*([^,)]*)/g;
const targets = [...consoleFiles, edgeGate].flatMap((f) => [...read(f).matchAll(NAV)].map((m) => ({ f, arg: (m[2] ?? m[3] ?? m[4] ?? "").trim() })));
const dynamicTargets = targets.filter((t) => !/^"\/platform(\/[a-z-]+)?(\?ended=(1|unaudited))?"$/.test(t.arg));
ok("every redirect / router navigation in the console targets a literal /platform path", targets.length >= 10 && dynamicTargets.length === 0, dynamicTargets.map((t) => `${rel(t.f)}: ${t.arg}`).join(", "));

// 16. Bilingual from the first commit: every console string has native Arabic; no hard-coded copy.
const dict = read(join(root, "src/components/platform/i18n.ts"));
const entries = [...dict.matchAll(/^\s*"([a-z][a-zA-Z.]+)": \{ en: "([^"]+)", ar: "([^"]+)" \},$/gm)];
const declared = (dict.match(/^\s*"[a-z][a-zA-Z.]+": \{/gm) ?? []).length;
ok("every PLATFORM_STRINGS entry has English and Arabic (Arabic script) text", entries.length === declared && entries.length >= 150 && entries.every((m) => /[؀-ۿ]/.test(m[3]) && /[A-Za-z]/.test(m[2])), `${entries.length}/${declared}`);
const ALLOWED_TEXT = new Set(["Elite ERP", "Loading…", "—", "·"]);
const hardcoded = consoleFiles.filter((f) => f.endsWith(".tsx")).flatMap((f) => {
  const src = code(f);
  const texts = [...src.matchAll(/(?<![=\-])>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*?)\s*</g)].map((m) => m[1].trim()).filter((x) => x && !ALLOWED_TEXT.has(x) && !/^[A-Za-z]+(\.[A-Za-z]+)+$/.test(x) && !/=>|&&|\|\||\?\s|^\w+\s*[<>=]|[;)]$/.test(x));
  const attrs = [...src.matchAll(/\b(aria-label|title|placeholder|alt)="([^"]*[A-Za-z][^"]*)"/g)].map((m) => `${m[1]}="${m[2]}"`);
  return [...texts, ...attrs].map((x) => `${rel(f)}: ${x}`);
});
ok("no hard-coded user-visible English in console markup (text, aria-label, title, placeholder, alt)", hardcoded.length === 0, hardcoded.slice(0, 8).join(" | "));

// 17. Design rule and tokens: platform.css uses only existing tokens; text on orange is white.
const css = read(join(root, "src/app/(platform)/platform.css")).replace(/\/\*[\s\S]*?\*\//g, "");
ok("platform.css introduces no colour literal (tokens only — no hex, rgb() or hsl())", !/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(css));
const ORANGE_BG = /background(-color)?:\s*var\(--(primary|accent|selected-item-background|active-tab-background|accent-background|primary-background|brand-orange)\)/;
const WHITE_TEXT = /(^|;|\s)color:\s*var\(--(primary-foreground|selected-item-text|accent-foreground|active-tab-text|accent-text|primary-text)\)/;
const orangeRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => ORANGE_BG.test(m[2]));
ok("every platform.css rule that paints an orange fill sets the white foreground on it", orangeRules.length >= 1 && orangeRules.every((m) => WHITE_TEXT.test(m[2])), orangeRules.filter((m) => !WHITE_TEXT.test(m[2])).map((m) => m[1].trim()).join(", "));
ok("platform.css styles only platform classes (or shared classes scoped under one)", [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((sel) => !sel.startsWith("@") && !/^(from|to|\d+%)$/.test(sel)).every((sel) => sel.split(",").every((part) => /\.platform-/.test(part))));

// 18. Preview sections never operate: later-phase controls are disabled and every section page
//     that is not Settings carries a phase marker; no price or KPI figure is hard-coded.
const kit = read(join(root, "src/components/platform/page-kit.tsx"));
ok("PreviewAction, PreviewToolbar filters and search are disabled elements", /<Button type="button" variant="secondary" disabled aria-disabled="true"/.test(kit) && /<input type="search" placeholder=\{search\} disabled aria-disabled="true" \/>/.test(kit) && /className="platform-filter" disabled aria-disabled="true"/.test(kit));
// (PO-02B: Dashboard and Companies are operational now — rules 21–28 below cover them.)
const previewPages = ["users", "subscribers", "packages", "activity"].map((p) => read(join(root, `src/app/(platform)/platform/(console)/${p}/page.tsx`)));
ok("every later-phase section page is marked with its phase (PO-02 … PO-06) and calls no data source", previewPages.every((src) => /phase="PO-0[2-6]"/.test(src) && !/@\/lib\/platform\/(console|session|login|mfa|audit|companies)|@\/db/.test(src)));
ok("no hard-coded money, price or KPI figure in console pages (values read “—”)", !consoleFiles.some((f) => /\b(SAR|ر\.س)\s?\d|\d[\d,.]*\s?(SAR|ريال)\b|value=\{?["']?\d{2,}/.test(read(f))));

// ---------------------------------------------------------------------------------------------
// PO-01B.1 — session changes and their audit records (atomicity and the audit-outage policy).
// ---------------------------------------------------------------------------------------------
const sessionSrc = code(join(root, "src/lib/platform/session.ts"));
const fnBodies = (src) => src.split(/\n(?=(?:export )?(?:async )?function )/).map((part) => ({ name: (part.match(/function (\w+)/) ?? [])[1] ?? "", body: part }));

// 19. Every revocation write is transactional with its audit record — except the two documented
//     emergency containment functions — and nothing can clear revoked_at.
const revokers = fnBodies(sessionSrc).filter((f) => /\.set\(\{ revokedAt/.test(f.body));
const containment = revokers.filter((f) => /^containPlatform/.test(f.name)).map((f) => f.name).sort();
const nonAtomic = revokers.filter((f) => !/^containPlatform/.test(f.name) && f.name !== "revokeRow" && !(/(db\.transaction|atomically)\(/.test(f.body) && /recordPlatformAudit\(/.test(f.body)));
ok("every session revocation in session.ts writes its audit record in the same transaction (except the containment functions)", revokers.length >= 6 && nonAtomic.length === 0 && containment.join(",") === "containPlatformSessionByToken,containPlatformSessions", nonAtomic.map((f) => f.name).join(", "));
const expiry = fnBodies(sessionSrc).find((f) => f.name === "endExpiredSession")?.body ?? "";
ok("idle / absolute expiry revokes and audits in one transaction and is enforced by time either way", /db\.transaction\(/.test(expiry) && /revokeRow\(row\.sessionId, reason, now, tx\)/.test(expiry) && /recordPlatformAudit\([\s\S]*tx,\s*\)/.test(expiry) && (sessionSrc.match(/await endExpiredSession\(row, "(expired|idle_timeout)", now\);\s*throw new PlatformError\("SESSION_EXPIRED"/g) ?? []).length === 2);
const unRevoke = [...platformLib, ...consoleApp, ...consoleUi].filter((f) => /revokedAt:\s*null|revoked_at\s*=\s*null/i.test(code(f)));
ok("no platform code can clear revoked_at (a revoked session cannot regain access)", unRevoke.length === 0, unRevoke.map(rel).join(", "));

// 20. The unaudited containment path is reachable only through the console, only after the audited
//     path failed with AUDIT_UNAVAILABLE, and is always reported as an incident and as NOT audited.
const containImporters = allSrc.filter((f) => rel(f) !== join("src", "lib", "platform", "session.ts") && /containPlatformSession/.test(code(f)));
ok("only src/lib/platform/console.ts uses the containment functions", containImporters.length === 1 && rel(containImporters[0]) === join("src", "lib", "platform", "console.ts"), containImporters.map(rel).join(", "));
const consoleFns = fnBodies(code(join(root, "src/lib/platform/console.ts"))).filter((f) => f.name && /containPlatformSession\w*\(/.test(f.body));
ok("each containment in the console follows an AUDIT_UNAVAILABLE check, reports an incident and returns audited: false",
  consoleFns.length === 2 && consoleFns.every((f) => {
    const at = f.body.search(/containPlatformSession/);
    return /isPlatformError\(err, "AUDIT_UNAVAILABLE"\)/.test(f.body.slice(0, at)) && /reportSecurityIncident\(\{\s*type: "unaudited_session_revocation"/.test(f.body.slice(at)) && /audited: false/.test(f.body.slice(at));
  }), consoleFns.map((f) => f.name).join(", "));
const incidentSrc = code(join(root, "src/lib/platform/incident.ts"));
ok("the incident line is allow-listed and never carries an error message, token, e-mail or user agent", !/\.message\b/.test(incidentSrc) && !/token|email|userAgent|jti|hash|password/i.test(incidentSrc.replace(/never a token, jti, hash, password, code, e-mail, user-agent/g, "")) && (incidentSrc.match(/console\.error\(/g) ?? []).length === 2);
const auditSrc = code(join(root, "src/lib/platform/audit.ts"));
ok("a failed audit INSERT surfaces as AUDIT_UNAVAILABLE (its database message is never passed on)", /catch \(err\) \{\s*throw new PlatformError\("AUDIT_UNAVAILABLE", `audit insert failed \(\$\{errorClass\(err\)\}\)`\);/.test(auditSrc));

// ---------------------------------------------------------------------------------------------
// PO-02B — the read-only company read model (src/lib/platform/companies.ts) and its pages.
// ---------------------------------------------------------------------------------------------
const readModelPath = join(root, "src/lib/platform/companies.ts");
const readModel = code(readModelPath);
// PO-02D2: the invitation detail page and its not-found join the company pages (rules 25 and 26 cover them too).
const companyPages = ["companies/page.tsx", "companies/[orgId]/page.tsx", "companies/[orgId]/not-found.tsx", "companies/invitations/[invitationId]/page.tsx", "companies/invitations/[invitationId]/not-found.tsx", "dashboard/page.tsx"].map((p) => join(root, "src/app/(platform)/platform/(console)", p));
const consoleCode = [...platformLib, ...consoleApp, ...consoleUi];

// 21. Only the read model touches the customer orgs / users tables (the compatibility rule reads orgs.id only).
const tenantTableRefs = consoleCode.filter((f) => /\b(orgsTable|usersTable)\b/.test(code(f)));
// PO-03A: and the seat service, which counts one company's users (orgId, isActive only — rule 46) and writes nothing.
ok("only companies.ts, company-access.ts, (PO-02C) company-access-actions.ts, (PO-02D2) invitations.ts and (PO-03A) seat-accounting.ts reference orgsTable / usersTable in platform code", JSON.stringify(tenantTableRefs.map(rel).sort()) === JSON.stringify([join("src", "lib", "platform", "companies.ts"), join("src", "lib", "platform", "company-access-actions.ts"), join("src", "lib", "platform", "company-access.ts"), join("src", "lib", "platform", "invitations.ts"), join("src", "lib", "platform", "seat-accounting.ts")]), tenantTableRefs.map(rel).join(", "));
const invitationsLibCode = code(join(root, "src/lib/platform/invitations.ts"));
ok("…PO-02D2: invitations.ts reads users.email only (the case-insensitive collision check) and orgs.name only (the name collision count), and writes neither",
  JSON.stringify([...new Set(invitationsLibCode.match(/usersTable\.\w+/g) ?? [])]) === JSON.stringify(["usersTable.email"]) && JSON.stringify([...new Set(invitationsLibCode.match(/orgsTable\.\w+/g) ?? [])]) === JSON.stringify(["orgsTable.name"]) &&
    !/\.(insert|update|delete)\((usersTable|orgsTable)\)/.test(invitationsLibCode + code(join(root, "src/lib/platform/invitation-actions.ts"))) && !/\b(usersTable|orgsTable)\b/.test(code(join(root, "src/lib/platform/invitation-actions.ts"))));
const accessSrc = code(join(root, "src/lib/platform/company-access.ts"));
ok("company-access.ts reads orgs only for existence (orgs.id) and never the users table", (accessSrc.match(/orgsTable\.\w+/g) ?? []).every((m) => m === "orgsTable.id") && !/usersTable/.test(accessSrc));
const accessCore = code(join(root, "src/lib/platform/company-access-actions.ts"));
ok("company-access-actions.ts uses orgs only by id (existence and the row lock) and never the users table", (accessCore.match(/orgsTable\.\w+/g) ?? []).length > 0 && (accessCore.match(/orgsTable\.\w+/g) ?? []).every((m) => m === "orgsTable.id") && !/usersTable/.test(accessCore));
const rawTenantSql = consoleCode.filter((f) => /\b(from|join|update|into)\s+"?(orgs|users|sessions|customers|invoices)"?(\s|$|\))/i.test(code(f)));
ok("no platform module names a customer table in raw SQL text", rawTenantSql.length === 0, rawTenantSql.map(rel).join(", "));

// 22. The read model selects allow-listed metadata only — never whole rows, secrets or business data.
const dbImports = (readModel.match(/import \{([^}]+)\} from "@\/db";/) ?? ["", ""])[1].split(",").map((s) => s.trim()).filter(Boolean).sort();
ok("companies.ts imports only db, orgs, users, access controls, invitations, platform admins and the audit table from @/db", JSON.stringify(dbImports) === JSON.stringify(["db", "organizationInvitationsTable", "orgsTable", "platformAdminsTable", "platformAuditEventsTable", "tenantAccessControlsTable", "usersTable"]), dbImports.join(","));
const columnsOf = (alias) => [...new Set([...readModel.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, "g"))].map((m) => m[1]))].sort();
const allowed = {
  orgsTable: ["country", "createdAt", "currency", "id", "industry", "logoUrl", "name"],
  usersTable: ["createdAt", "email", "id", "isActive", "lastLoginAt", "name", "orgId", "role"],
  tenantAccessControlsTable: ["accessStatus", "changedAt", "changedByPlatformAdminId", "orgId", "reason"],
  inv: ["acceptedAt", "companyName", "countryName", "createdAt", "expiresAt", "id", "ownerEmailNormalized", "revokedAt"],
  platformAdminsTable: ["displayName", "id"],
  ev: ["action", "actorLabel", "createdAt", "id", "orgId", "reason", "result"],
};
const offAllowlist = Object.entries(allowed).flatMap(([alias, cols]) => columnsOf(alias).filter((c) => !cols.includes(c)).map((c) => `${alias}.${c}`));
ok("every column the read model references is on its allowlist (orgs, users, access controls, invitations, admins, audit)", offAllowlist.length === 0 && columnsOf("orgsTable").length > 0, offAllowlist.join(", "));
ok("the logo URL is only tested for presence (one boolean expression), never selected", (readModel.match(/orgsTable\.logoUrl/g) ?? []).length === 2 && /hasLogo: sql<boolean>`\(\$\{orgsTable\.logoUrl\} is not null and \$\{orgsTable\.logoUrl\} <> ''\)`/.test(readModel));
ok("no secret, token, tax, contact, branding or settings field is named anywhere in the read model", !/tokenHash|token_hash|passwordHash|password_hash|mfaSecret|mfa_secret|mfaRecovery|recovery_codes|taxId|tax_id|vatNumber|vat_number|\baddress\b|\bphone\b|orgsTable\.email|themeOverrides|primaryColor|sealUrl|signatureUrl|printLayout|zatca|bankAccount/i.test(readModel));
ok("no whole-row selection, relational query API, raw SQL or dynamic identifiers in the read model", !/\.select\(\s*\)|\.selectDistinct\(\s*\)|db\.query\.|sql\.raw\(|sql\.identifier\(|select \*|\.returning\(\s*\)/.test(readModel));

// 23. Every exported read authorizes first, with the narrow permission, from the platform token only.
const exportedFns = fnBodies(readModel).filter((f) => /^export async function /.test(f.body.trimStart()));
const unauthorized = exportedFns.filter((f) => !/^\s*export async function \w+\([^)]*\)[^{]*\{\s*(const ctx = )?await authorizeCompanyRead\(req\);/.test(f.body));
ok("every exported function of companies.ts starts with authorizeCompanyRead(req)", exportedFns.length === 5 && unauthorized.length === 0, unauthorized.map((f) => f.name).join(", ") || exportedFns.map((f) => f.name).join(","));
ok("authorizeCompanyRead = feature flag, then the live platform session with platform.companies.read", /async function authorizeCompanyRead\(req: CompanyReadRequest\): Promise<PlatformSessionContext> \{\s*assertPlatformConsoleEnabled\(\);\s*return authorizePlatformToken\(req\.token, "platform\.companies\.read"\);\s*\}/.test(readModel));
ok("the read model never reads cookies or headers itself (the page passes the platform cookie's token)", !/next\/headers|cookies\(\)|SESSION_COOKIE/.test(readModel));
const guardsSrc = code(join(root, "src/lib/platform/guards.ts"));
const manageAccessUsers = consoleCode.filter((f) => /"platform\.companies\.manage_access"/.test(code(f))).map(rel).sort();
const inviteUsers = consoleCode.filter((f) => /"platform\.companies\.invite"/.test(code(f))).map(rel).sort();
ok("the company permissions are exactly platform.companies.read, (PO-02C) platform.companies.manage_access — which only the access action checks — and (PO-02D2) platform.companies.invite, which only the invitation service checks; no other company permission exists",
  /PLATFORM_PERMISSIONS = \["platform\.access", "platform\.sessions\.manage", "platform\.mfa\.manage", "platform\.companies\.read", "platform\.companies\.manage_access", "platform\.companies\.invite"\] as const;/.test(guardsSrc) &&
    !/platform\.companies\.(write|update|suspend|edit|delete|accept|manage(?!_access\b)|invite(?!"))/.test(consoleCode.map(code).join("\n")) &&
    JSON.stringify(manageAccessUsers) === JSON.stringify([join("src", "lib", "platform", "company-access-actions.ts"), join("src", "lib", "platform", "guards.ts")]) &&
    JSON.stringify(inviteUsers) === JSON.stringify([join("src", "lib", "platform", "guards.ts"), join("src", "lib", "platform", "invitation-actions.ts")]),
  `${manageAccessUsers.join(", ")} | ${inviteUsers.join(", ")}`);

// 24. A company detail view is audited under the PO-01B.1 policy, or not shown at all.
const detailFn = fnBodies(readModel).find((f) => f.name === "getCompanyDetail")?.body ?? "";
const at = (re) => detailFn.search(re);
ok("getCompanyDetail: authorize → validate id → assert audit protection → read → record company.viewed → return", at(/authorizeCompanyRead\(req\)/) >= 0 && at(/authorizeCompanyRead\(req\)/) < at(/parseOrgId\(rawOrgId\)/) && at(/parseOrgId\(rawOrgId\)/) < at(/await assertPlatformAuditProtection\(\);/) && at(/await assertPlatformAuditProtection\(\);/) < at(/\.\.\.ACCESS_FIELDS,/) && at(/\.\.\.ACCESS_FIELDS,/) < at(/recordPlatformAudit\(/) && at(/recordPlatformAudit\(/) < at(/return detail;/));
ok("PO-02C: the detail's access state, reason, change date and operator come from ONE statement (no separate access read)", !/getTenantAccess\(/.test(readModel) && (detailFn.match(/\.\.\.ACCESS_FIELDS,/g) ?? []).length === 1 && /access: \{ \.\.\.accessOf\(org\), reason: org\.reason \?\? null, changedAt: org\.changedAt \?\? null, changedBy: org\.changedBy \?\? null, enforced: tenantAccessEnforcementEnabled\(\) \},/.test(detailFn));
ok("the view record is exact and bounded: company.viewed on organization/<decimal id>, with the org id and request metadata", /action: "company\.viewed",\s*entityType: "organization",\s*entityId: String\(orgId\),\s*orgId,\s*result: "success",\s*\.\.\.meta,/.test(detailFn));
ok("a failed view record is reported as an incident and re-thrown (never swallowed)", /catch \(err\) \{\s*if \(isPlatformError\(err, "AUDIT_UNAVAILABLE"\)\) reportSecurityIncident\(\{ type: "audit_write_failed", action: "company\.viewed", error: errorClass\(err\) \}\);\s*throw err;\s*\}/.test(detailFn));

// 25. Every console page, at any depth, checks the platform session itself; company pages read only the read model.
const allConsolePages = consoleApp.filter((f) => /\(console\)\/.+\/page\.tsx$/.test(f));
const unguardedNested = allConsolePages.filter((f) => !/await requirePlatformSession\(\)/.test(read(f)));
ok("every page.tsx under (console), nested routes included, awaits requirePlatformSession() — nine since PO-02D2 added the invitation detail", allConsolePages.length === 9 && unguardedNested.length === 0, unguardedNested.map(rel).join(", ") || String(allConsolePages.length));
const pageImports = companyPages.flatMap((f) => importsOf(read(f)).filter((s) => s.startsWith("@/lib/platform/")).map((s) => `${rel(f)} → ${s}`));
// PO-02D2: plus the invitation flag (flags) and the invitation history read model (invitations) — never the mutation cores.
ok("company pages and the dashboard read data only through the read models (companies, PO-02D2 invitations) plus config, display, errors, flags, guards", pageImports.every((x) => /→ @\/lib\/platform\/(companies|config|display|errors|flags|guards|invitations)$/.test(x)), pageImports.filter((x) => !/→ @\/lib\/platform\/(companies|config|display|errors|flags|guards|invitations)$/.test(x)).join(", "));

// 26. Later-phase company actions never operate: no POST, no server action, disabled controls only.
const companyPageCode = companyPages.map(code).join("\n");
ok("company pages hold no server action and no POST form; the only forms are GET searches of /platform/companies (three since PO-02D2's history view)", !/"use server"|<form[^>]*\saction=\{|method="post"|formAction/i.test(companyPageCode) && (companyPageCode.match(/<form /g) ?? []).length === 3 && (companyPageCode.match(/<form method="get" action="\/platform\/companies" role="search"/g) ?? []).length === 3);
const kitSrc = code(join(root, "src/components/platform/companies-kit.tsx"));
ok("DisabledAction is a disabled element; invite, export, edit and user management use it or PreviewAction; suspend / reactivate exist only as the PO-02C access dialog (header + Access tab)",
  /<Button type="button" variant="secondary" disabled aria-disabled="true"/.test(kitSrc) && ["action.inviteCompany", "action.export", "action.editCompany", "action.manageUsers"].every((k) => companyPageCode.includes(`"${k}"`)) && !/"action\.(suspend|reactivate)"/.test(companyPageCode) && (companyPageCode.match(/<CompanyAccessControl /g) ?? []).length === 2 && !/onClick|useActionState|useTransition/.test(companyPageCode + kitSrc));

// 27. No impersonation: no platform code can mint, read or forward a customer session.
const customerSessionApi = consoleCode.filter((f) => /\b(signSessionToken|verifySessionToken|issueSession|requireSession|requireRole|getSession|SESSION_COOKIE_CLEAR|lookupSessionByToken|revokeUserSessions)\b|elite_erp_session/.test(code(f)));
ok("no platform module references the customer session API or cookie (no token minting, no impersonation)", customerSessionApi.length === 0, customerSessionApi.map(rel).join(", "));

// 28. Pending invitations are read without token material and the read model writes only its audit record.
const invitationSelect = (readModel.match(/\.select\(\{ id: inv\.id, ([^}]+) \}\)/) ?? ["", ""])[1];
ok("the invitation listing selects exactly id, company, owner e-mail, country, created and expiry", invitationSelect === "companyName: inv.companyName, ownerEmail: inv.ownerEmailNormalized, country: inv.countryName, createdAt: inv.createdAt, expiresAt: inv.expiresAt");
ok("the read model never inserts, updates or deletes (except through recordPlatformAudit)", !/\b(db|tx|executor)\s*\.\s*(insert|update|delete|execute)\(/.test(readModel) && (readModel.match(/recordPlatformAudit\(/g) ?? []).length === 1);

// 29. Status colour belongs to the design system's canonical registry alone (verify:status-registry,
//     ui:guardrails G4). Platform Owner states are not in that customer registry, so they are neutral
//     status tags from ONE table of labels and icons (PLATFORM_STATES / PlatformStatusTag in
//     companies-kit.tsx); no company page or kit component chooses a badge variant or a tone from a value.
const kitPath = join(root, "src/components/platform/companies-kit.tsx");
const stateTable = (kitSrc.match(/const PLATFORM_STATES = \{([\s\S]*?)\n\} as const satisfies PlatformStateTable;/) ?? ["", ""])[1].replace(/\s+/g, " ").trim();
ok("one table of labels and icons for Platform Owner states (access active/suspended, invitation pending/expired and — PO-02D2 — revoked/accepted, audit result success/rejected/failed), with no tone in it",
  stateTable === 'company_access: { active: { label: "access.active", icon: ShieldCheck }, suspended: { label: "access.suspended", icon: ShieldOff }, }, invitation: { pending: { label: "inv.statePending", icon: Clock }, expired: { label: "inv.stateExpired", icon: CalendarX }, revoked: { label: "inv.stateRevoked", icon: MailX }, accepted: { label: "inv.stateAccepted", icon: MailCheck }, }, audit_result: { success: { label: "result.success", icon: CircleCheck }, rejected: { label: "result.rejected", icon: CircleMinus }, failed: { label: "result.failed", icon: CircleX }, },',
  stateTable.slice(0, 120));
ok("PlatformStatusTag renders the design system's status tag with the literal neutral tone", /<span className="status-tag" data-tone="neutral" data-status=\{value\} data-status-domain=\{`platform\.\$\{domain\}`\}>/.test(kitSrc));
const toneByValue = [...companyPages, kitPath].flatMap((f) => [...code(f).matchAll(/<Badge\b[^>]*\svariant=\{|data-tone=\{(?!tone\})|\stone=\{/g)].map((m) => `${rel(f)}: ${m[0]}`));
ok("no company page or kit component chooses a badge variant or a tone from a value (PageState forwards its caller's literal)", toneByValue.length === 0, toneByValue.join(", "));
ok("platform code does not reach into the customer status registry or StatusBadge for its states", !consoleCode.some((f) => /status-registry|status-badge|StatusBadge/.test(code(f))));

// ---------------------------------------------------------------------------------------------
// PO-02C — company access: the customer tenant-access gate, the access action, its dialog and the
// access-suspended screen.
// ---------------------------------------------------------------------------------------------
const gateText = read(GATE);
const usesGate = (f) => importsOf(read(f)).some((s) => /(^|\/)security\/tenant-access-gate$/.test(s));

// 30. ONE customer module consults the company-access rule, and exactly three customer files use it.
const gateImports = [...importsOf(gateText), ...sideEffectImports(gateText)].sort();
ok("30. the tenant-access gate imports server-only and @/lib/platform/company-access — nothing else", JSON.stringify(gateImports) === JSON.stringify(["@/lib/platform/company-access", "server-only"]), gateImports.join(", "));
const gateUsers = allSrc.filter((f) => f !== GATE && usesGate(f)).map(rel).sort();
ok("…exactly the session check, the sign-in actions and the uploads route use the gate", JSON.stringify(gateUsers) === JSON.stringify([join("src", "app", "(auth)", "actions.ts"), join("src", "app", "uploads", "[...path]", "route.ts"), join("src", "lib", "session.ts")].sort()), gateUsers.join(", "));
ok("…the gate fails closed: a missing access table or column (42P01 / 42703) is 'unavailable' (denied), never a missing row", /const MISSING_OBJECT_CODES = new Set\(\["42P01", "42703"\]\);/.test(gateText) && /if \(err instanceof TenantAccessUnavailableError\) return "unavailable";/.test(gateText) && /return \(await orgAccessDecision\(orgId\)\) === "active";/.test(gateText) && /return access\?\.status === "active";/.test(gateText));
const dialogPath = join(root, "src/components/platform/company-access-dialog.tsx");
const dialogSrc = read(dialogPath);
ok("…the dialog's reason limits equal the server's (10–500 characters)", /const REASON_MIN = 10;\s*const REASON_MAX = 500;/.test(dialogSrc) && /export const ACCESS_REASON_MIN = 10;\s*export const ACCESS_REASON_MAX = 500;/.test(accessCore));

// 31. Off by default: deploying the code changes nothing until the switches are set explicitly.
const envReaders = (name) => allSrc.filter((f) => new RegExp(`process\\.env\\.${name}\\b`).test(code(f))).map(rel);
ok('31. enforcement is off unless TENANT_ACCESS_ENFORCEMENT is exactly "enabled" (read by company-access.ts alone); legacy-token rejection only when CUSTOMER_LEGACY_TOKENS is exactly "reject" (the gate alone)',
  /return process\.env\.TENANT_ACCESS_ENFORCEMENT === "enabled";/.test(accessSrc) && JSON.stringify(envReaders("TENANT_ACCESS_ENFORCEMENT")) === JSON.stringify([join("src", "lib", "platform", "company-access.ts")]) &&
    /return process\.env\.CUSTOMER_LEGACY_TOKENS === "reject";/.test(gateText) && JSON.stringify(envReaders("CUSTOMER_LEGACY_TOKENS")) === JSON.stringify([join("src", "lib", "security", "tenant-access-gate.ts")]),
  JSON.stringify([envReaders("TENANT_ACCESS_ENFORCEMENT"), envReaders("CUSTOMER_LEGACY_TOKENS")]));

// 32. The access change: authorization, step-up, validation and ONE transaction, in this order.
const setFn = fnBodies(accessCore).find((f) => f.name === "setCompanyAccessCore")?.body ?? "";
const order = [
  /await authorizeAccessChange\(req\)/, /await assertPlatformAuditProtection\(\)/, /parseChange\(input\)/, /!tenantAccessEnforcementEnabled\(\)/, /activeLoginBlock\(keys, now\)/, /verifyPlatformPassword\(change\.password/,
  /db\.transaction\(/, /consumeTotpCode\(tx, ctx\.adminId, change\.totpCode, now\)/, /\.for\("no key update"\)/, /\.for\("update"\)/, /new PlatformError\("CONFLICT"/, /\.insert\(tac\)/, /\.update\(sessionsTable\)/, /result: "success",?\s*\},\s*tx,?\s*\)/,
].map((re) => setFn.search(re));
ok("32. setCompanyAccessCore: flag/origin/session/permission → audit protection → input format → enforcement → throttle → password → ONE transaction (TOTP → org lock → access-row lock → state check → upsert → end sessions → audit record in the transaction)", order.every((p, i) => p >= 0 && (i === 0 || p > order[i - 1])), order.join(","));
ok("…authorizeAccessChange = flag, then same-origin, then the live platform session with platform.companies.manage_access (the platform token only)", /async function authorizeAccessChange\(req: ConsoleRequest\): Promise<PlatformSessionContext> \{\s*assertPlatformConsoleEnabled\(\);\s*assertSameOrigin\(req\.headers\);\s*return authorizePlatformToken\(req\.token, "platform\.companies\.manage_access"\);\s*\}/.test(accessCore));
ok("…a failed password or code counts against the durable throttle and is recorded as a rejected attempt; a replayed code is told apart", (setFn.match(/recordLoginAttempt\(keys, "failure", now\);\s*await rejected\(/g) ?? []).length === 2 && /totp\.reason === "replayed" \? \("replay" as const\) : \("mfa" as const\)/.test(setFn));

// 33. What the access action may write.
const tacWriters = consoleCode.filter((f) => /\.(insert|update|delete)\(\s*(tenantAccessControlsTable|tac)\b/.test(code(f))).map(rel);
// PO-02D3: and the acceptance core — ONE insert, the new company's active row, inside the acceptance transaction; never an update or a delete.
const ACCEPT_CORE = join(root, "src/lib/platform/invitation-acceptance.ts");
const acceptCore = code(ACCEPT_CORE);
ok("33. only the access action writes tenant_access_controls (one upsert; never a delete) — and (PO-02D3) the acceptance core: one insert of the new company's active row, nothing else",
  JSON.stringify(tacWriters) === JSON.stringify([join("src", "lib", "platform", "company-access-actions.ts"), join("src", "lib", "platform", "invitation-acceptance.ts")]) && (accessCore.match(/\.insert\(tac\)/g) ?? []).length === 1 && !/\.(update|delete)\(\s*tac\b/.test(accessCore) &&
    (acceptCore.match(/\.insert\(tenantAccessControlsTable\)/g) ?? []).length === 1 && /\.insert\(tenantAccessControlsTable\)\.values\(\{ orgId: ids\.orgId, accessStatus: "active", createdAt: now, updatedAt: now \}\)/.test(acceptCore) && !/\.(update|delete)\(\s*tenantAccessControlsTable/.test(acceptCore),
  tacWriters.join(", "));
const sessionRefs = consoleCode.filter((f) => /\bsessionsTable\b/.test(code(f))).map(rel);
const sessionCols = [...new Set([...accessCore.matchAll(/sessionsTable\.(\w+)/g)].map((m) => m[1]))].sort();
ok("…only the access action references the customer sessions table, solely to END one company's live sessions (set revokedAt + revokedReason; no insert, no token hash, no un-revoke)",
  JSON.stringify(sessionRefs) === JSON.stringify([join("src", "lib", "platform", "company-access-actions.ts")]) && (accessCore.match(/\.update\(sessionsTable\)/g) ?? []).length === 1 && !/\.(insert|delete)\(\s*sessionsTable/.test(accessCore) &&
    /\.set\(\{ revokedAt: now, revokedReason: ORG_SUSPENDED_REVOKE_REASON \}\)/.test(accessCore) && /\.where\(and\(eq\(sessionsTable\.orgId, change\.orgId\), isNull\(sessionsTable\.revokedAt\), gt\(sessionsTable\.expiresAt, now\)\)\)/.test(accessCore) &&
    JSON.stringify(sessionCols) === JSON.stringify(["expiresAt", "id", "orgId", "revokedAt"]),
  `${sessionRefs.join(", ")} | ${sessionCols.join(",")}`);
ok("…the access action never reads or writes a subscription, package or customer business table", !/subscription|package|invoice|journal|ledger|stock|employee|payroll|document/i.test(accessCore));

// 34. The customer side: every request, sign-in and signed file is checked; nothing is served for a suspended company.
const custSession = code(join(root, "src/lib/session.ts"));
ok("34. session check (enforcement on): the session row must belong to the token's user AND company, and the company's access is checked on EVERY request after the user lookup — a missed revocation cannot grant access",
  /sessionRow\.userId !== payload\.userId \|\| sessionRow\.orgId !== payload\.orgId\) return SIGNED_OUT;/.test(custSession) &&
    /if \(row\.orgId !== payload\.orgId\) return SIGNED_OUT;\s*const decision = await orgAccessDecision\(row\.orgId\);\s*if \(decision === "suspended"\) return SUSPENDED;\s*if \(decision === "unavailable"\) return UNAVAILABLE;/.test(custSession));
ok("…requireSession sends a suspended (or undeterminable) company to /access-suspended; getSession never returns a session for it", /if \(state\.status === "suspended" \|\| state\.status === "unavailable"\) redirect\("\/access-suspended"\);/.test(custSession) && /return state\.status === "active" \? state\.session : null;/.test(custSession));
const loginSrc = code(join(root, "src/app/(auth)/actions.ts"));
// PO-02C.1 re-pins the sign-in: the PO-02C order (credentials → access → writes) holds, and with enforcement on the
// access check and every write are ONE transaction under the company lock. `inOrder` finds each pattern after the last.
const loginFns = Object.fromEntries(fnBodies(loginSrc).map((f) => [f.name, f.body]));
const inOrder = (src, res) => {
  let at = 0;
  for (const re of res) {
    const i = src.slice(at).search(re);
    if (i < 0) return false;
    at += i + 1;
  }
  return true;
};
ok("…sign-in (enforcement on): password and second factor first; then completeSignIn's ONE transaction — company lock + access check → user-row lock + re-check → recovery code + last-login time → session row → code-used and success records — and the cookie only after it committed",
  inOrder(loginFns.loginAction ?? "", [/verifyPassword\(password, user\.passwordHash\)/, /mfaOk = true/, /if \(!tenantAccessEnforcementEnabled\(\)\) \{/, /signIn = await completeSignIn\(email, user, recoveryHash\);/, /if \(!signIn\.ok\) \{/, /clearLoginRateLimit\(email\);\s*await setSessionCookie\(user\.id, user\.orgId, signIn\.jti\);\s*redirect\("\/dashboard"\);/]) &&
    inOrder(loginFns.completeSignIn ?? "", [/return db\.transaction\(async \(tx\) => \{/, /if \(\(await lockOrgAccessForSessionIssue\(tx, user\.orgId\)\) !== "active"\) return \{ ok: false, reason: "suspended" \} as const;/, /\.where\(eq\(usersTable\.id, user\.id\)\)\s*\.for\("no key update"\);/, /if \(!current \|\| !current\.isActive \|\| current\.orgId !== user\.orgId\) return \{ ok: false, reason: "account" \} as const;/, /withoutRecoveryCode\(current\.mfaRecoveryCodes, recoveryHash\)/, /if \(recoveryHash && !remaining\) return \{ ok: false, reason: "code_spent" \} as const;/, /await tx\s*\.update\(usersTable\)/, /const jti = await createSession\(user\.id, user\.orgId, tx\);/, /type: "mfa\.recovery_used", severity: "medium" \}, tx\);/, /type: "login\.success", severity: "info" \}, tx\);/, /\}, READ_COMMITTED\);/]) &&
    !/\bdb\.(insert|update|select|execute)\b/.test(loginFns.completeSignIn ?? "db.insert") && /const READ_COMMITTED = \{ isolationLevel: "read committed" \} as const;/.test(loginSrc));
ok("…sign-in (enforcement off): the accepted sequence, except that a matched recovery code is spent atomically under the user-row lock — a second use is refused like a wrong code",
  inOrder(loginFns.loginAction ?? "", [/if \(!tenantAccessEnforcementEnabled\(\)\) \{/, /if \(!\(await consumeRecoveryCode\(user\.id, recoveryHash\)\)\) \{/, /return \{ error: "MFA_INVALID" \};/, /type: "mfa\.recovery_used", severity: "medium" \}\);/, /clearLoginRateLimit\(email\);/, /lastLoginAt: new Date\(\)/, /type: "login\.success", severity: "info" \}\);/, /await issueSession\(user\.id, user\.orgId\);/, /redirect\("\/dashboard"\);/, /signIn = await completeSignIn\(/]) &&
    inOrder(loginFns.consumeRecoveryCode ?? "", [/return db\.transaction\(async \(tx\) => \{/, /\.for\("no key update"\);/, /withoutRecoveryCode\(row\.codes, matchedHash\)/, /if \(!remaining\) return false;/, /await tx\.update\(usersTable\)\.set\(\{ mfaRecoveryCodes: remaining \}\)/, /\}, READ_COMMITTED\);/]) &&
    /const i = hashes\.indexOf\(matchedHash\);\s*if \(i < 0\) return null;\s*hashes\.splice\(i, 1\);\s*return encryptField\(JSON\.stringify\(hashes\)\);/.test(loginFns.withoutRecoveryCode ?? ""));
ok("…issueSession refuses a company that is not active — with enforcement on in ONE transaction with the session insert under the company lock; the cookie is set after it",
  inOrder(loginFns.issueSession ?? "", [/const jti = tenantAccessEnforcementEnabled\(\)\s*\? await db\.transaction\(async \(tx\) => \{/, /if \(\(await lockOrgAccessForSessionIssue\(tx, orgId\)\) !== "active"\) throw new Error\(/, /return createSession\(userId, orgId, tx\);/, /\}, READ_COMMITTED\)/, /: await createSession\(userId, orgId\);/, /await setSessionCookie\(userId, orgId, jti\);/]));
ok("…a failed sign-in transaction leaves nothing behind: missing access objects → 'unavailable'; any other failure → the same generic message with only its SQLSTATE or class logged (never its message); no cookie on either path",
  inOrder(loginFns.loginAction ?? "", [/signIn = await completeSignIn\(/, /\} catch \(err\) \{/, /if \(err instanceof TenantAccessUnavailableError\) \{/, /type: "login\.access_unavailable", severity: "high" \}\);\s*return \{ error: SIGN_IN_UNAVAILABLE_MESSAGE \};/, /console\.error\(`\[auth\] sign-in could not be completed \(\$\{errorClass\(err\)\}\); nothing was applied`\);/, /\.catch\(\(\) => undefined\);\s*return \{ error: SIGN_IN_UNAVAILABLE_MESSAGE \};/, /await setSessionCookie\(/]) &&
    !/\.message\b/.test(loginFns.errorClass ?? ".message"));
const uploadsSrc = code(join(root, "src/app/uploads/[...path]/route.ts"));
ok("…uploads: a VALID signature is still refused (404) while the owning company is not active, before the store is read; the session path goes through getSession()",
  /if \(signed && tenantAccessEnforcementEnabled\(\) && !\(await orgAccessAllowed\(fileOrgId\)\)\) return new Response\("Not found", \{ status: 404 \}\);/.test(uploadsSrc) && uploadsSrc.indexOf("orgAccessAllowed(fileOrgId)") < uploadsSrc.indexOf("readBlob(pathname)") && /const session = signed \? null : await getSession\(\);/.test(uploadsSrc));

// 35. The access-suspended screen shows no company data.
const suspendedPage = join(root, "src/app/access-suspended/page.tsx");
const spImports = [...importsOf(read(suspendedPage)), ...sideEffectImports(read(suspendedPage))].sort();
const spExpected = ["../(auth)/auth.css", "@/app/(app)/actions", "@/components/brand/logo-lockup", "@/components/ui/button", "@/lib/i18n/dict", "@/lib/i18n/server", "@/lib/session", "lucide-react", "next/navigation"].sort();
ok("35. the access-suspended screen reads only the session STATE — no database, no platform module, no company field — and offers sign-out", JSON.stringify(spImports) === JSON.stringify(spExpected) && /<form action=\{logoutAction\}/.test(read(suspendedPage)) && !/state\.session|\borg[A-Z]\w*|\.reason\b/.test(code(suspendedPage)), spImports.join(", "));

// 36. The dialog: two actions, credentials cleared after every attempt, no secret kept.
const dialogAppImports = importsOf(dialogSrc).filter((s) => s.startsWith("@/app/"));
ok("36. the access dialog calls only the two company-access server actions and clears the password and code after every attempt", JSON.stringify(dialogAppImports) === JSON.stringify(["@/app/(platform)/company-access-actions"]) && /changeCompanyAccessAction\(\{ orgId: String\(orgId\), target, reference: typed\.trim\(\), reason: cleanReason, password, totpCode: code \}\);\s*setPassword\(""\);\s*setTotp\(""\);/.test(dialogSrc) && /readCompanyAccessAction\(String\(orgId\)\)/.test(dialogSrc));

// 37. PO-02C.1 — one lock protocol between customer sign-in and the access action (no schema change).
const lockFn = fnBodies(accessSrc).find((f) => f.name === "lockTenantAccessForSessionIssue")?.body ?? "";
ok("37. session issuance reads the company's access under a SHARE lock on its organization row (statement 1), then reads the access in a separate statement (fresh snapshot after the wait) — the only lock company-access.ts takes",
  inOrder(lockFn, [/export async function lockTenantAccessForSessionIssue\(tx: Tx, orgId: number\): Promise<TenantAccess \| null> \{/, /await tx\.select\(\{ id: orgsTable\.id \}\)\.from\(orgsTable\)\.where\(eq\(orgsTable\.id, orgId\)\)\.for\("share"\);/, /return getTenantAccess\(orgId, tx\);/]) &&
    (accessSrc.match(/\.for\(/g) ?? []).length === 1);
const lockUsers = (name) => allSrc.filter((f) => new RegExp(`\\b${name}\\b`).test(code(f))).map(rel).sort();
ok("…the gate wraps it fail-closed (missing access objects → TenantAccessUnavailableError); only the sign-in actions call the wrapper",
  /export async function lockOrgAccessForSessionIssue\(tx: SessionIssueTx, orgId: number\): Promise<"active" \| "suspended"> \{\s*try \{\s*return accessAllows\(await lockTenantAccessForSessionIssue\(tx, orgId\)\) \? "active" : "suspended";\s*\} catch \(err\) \{\s*failClosed\(err\);/.test(gateText) &&
    /function failClosed\(err: unknown\): never \{\s*if \(MISSING_OBJECT_CODES\.has\(sqlStateOf\(err\) \?\? ""\)\) \{[\s\S]*?throw new TenantAccessUnavailableError\(\);\s*\}\s*throw err;\s*\}/.test(gateText) &&
    JSON.stringify(lockUsers("lockTenantAccessForSessionIssue")) === JSON.stringify([join("src", "lib", "platform", "company-access.ts"), join("src", "lib", "security", "tenant-access-gate.ts")]) &&
    JSON.stringify(lockUsers("lockOrgAccessForSessionIssue")) === JSON.stringify([join("src", "app", "(auth)", "actions.ts"), join("src", "lib", "security", "tenant-access-gate.ts")]),
  `${lockUsers("lockTenantAccessForSessionIssue").join(", ")} | ${lockUsers("lockOrgAccessForSessionIssue").join(", ")}`);
ok("…the access action keeps its FOR NO KEY UPDATE organization lock (not strengthened — foreign-key KEY SHARE checks of ordinary inserts stay unblocked) and runs its transaction at READ COMMITTED explicitly",
  (accessCore.match(/\.for\("no key update"\)/g) ?? []).length === 1 && !/from\(orgsTable\)[^;]*\.for\("(update|share|key share)"\)/.test(accessCore) && /return \{ ok: true as const, sessionsEnded: ended\.length \};\s*\}, \{ isolationLevel: "read committed" \}\);/.test(accessCore));
const sessionStoreCode = code(join(root, "src/lib/security/session-store.ts"));
const customerAuditCode = code(join(root, "src/lib/security/audit.ts"));
ok("…createSession and recordSecurityEvent take an optional executor (default: the autocommit db) so the sign-in transaction can pass its own",
  /export async function createSession\(userId: number, orgId: number, executor: Tx \| typeof db = db\): Promise<string> \{[\s\S]*?await executor\.insert\(sessionsTable\)/.test(sessionStoreCode) &&
    /export async function recordSecurityEvent\(\s*entry: \{[\s\S]*?\},\s*executor: Tx \| typeof db = db,\s*\) \{[\s\S]*?await executor\.insert\(securityEventsTable\)/.test(customerAuditCode));

// ---------------------------------------------------------------------------------------------
// PO-02D1A — the onboarding database foundation is SCHEMA ONLY: no code path, permission, route, flag or seed yet.
// ---------------------------------------------------------------------------------------------
// 38. Only the schema barrel imports the onboarding module; no application code names an onboarding table.
const ONBOARDING_SCHEMA = join(root, "src/db/schema/platform-onboarding.ts");
const onboardingImporters = allSrc.filter((f) => f !== ONBOARDING_SCHEMA && importsOf(read(f)).some((s) => /(^|\/)platform-onboarding$/.test(s))).map(rel).sort();
ok("38. PO-02D1A: only src/db/schema/index.ts imports the onboarding schema module", JSON.stringify(onboardingImporters) === JSON.stringify([join("src", "db", "schema", "index.ts")]), onboardingImporters.join(", "));
const ONBOARDING_NAMES = /\b(platformSettingsTable|subscriptionPackagesTable|subscriptionPackageVersionsTable|tenantPrimaryOwnersTable|tenantSubscriptionsTable|subscriptionEventsTable|organizationInvitationTermsTable|platform_settings|subscription_packages|subscription_package_versions|tenant_primary_owners|tenant_subscriptions|subscription_events|organization_invitation_terms)\b/;
const onboardingUsers = allSrc.filter((f) => f !== ONBOARDING_SCHEMA && ONBOARDING_NAMES.test(code(f))).map(rel).sort();
// PO-02D2: exactly the invitation read model and service name onboarding tables — the published Trial (packages and
// versions, read) and the invitation terms (written with the invitation) — and nothing names settings, subscriptions,
// subscription events or primary owners.
const SUBSCRIPTION_NAMES = /\b(platformSettingsTable|tenantPrimaryOwnersTable|tenantSubscriptionsTable|subscriptionEventsTable|platform_settings|tenant_primary_owners|tenant_subscriptions|subscription_events)\b/;
// PO-02D3: and the acceptance core — the ONE writer of a company's primary owner, Trial subscription and subscription
// event (one insert each, rule 45), reading the invitation's published Trial version; still nothing names platform settings.
// PO-03A: and the two READ-ONLY cores — primary-owners.ts names the primary-owner table alone, seat-accounting.ts the
// subscription, version and package tables alone (rule 46 proves both write nothing); still nothing names platform settings.
const subscriptionNamers = allSrc.filter((f) => f !== ONBOARDING_SCHEMA && SUBSCRIPTION_NAMES.test(code(f))).map(rel).sort();
const namesIn = (f) => [...new Set(code(join(root, f)).match(new RegExp(ONBOARDING_NAMES.source, "g")) ?? [])].sort();
ok("…no application code (comments ignored) names an onboarding table or its Drizzle symbol except (PO-02D2) invitations.ts and invitation-actions.ts, (PO-02D3) the acceptance core and (PO-03A) the read-only primary-owner and seat cores; nothing names platform settings",
  JSON.stringify(onboardingUsers) === JSON.stringify([join("src", "lib", "platform", "invitation-acceptance.ts"), join("src", "lib", "platform", "invitation-actions.ts"), join("src", "lib", "platform", "invitations.ts"), join("src", "lib", "platform", "primary-owners.ts"), join("src", "lib", "platform", "seat-accounting.ts")]) &&
    JSON.stringify(subscriptionNamers) === JSON.stringify([join("src", "lib", "platform", "invitation-acceptance.ts"), join("src", "lib", "platform", "primary-owners.ts"), join("src", "lib", "platform", "seat-accounting.ts")]) && !allSrc.some((f) => f !== ONBOARDING_SCHEMA && /\b(platformSettingsTable|platform_settings)\b/.test(code(f))) &&
    JSON.stringify(namesIn("src/lib/platform/primary-owners.ts")) === JSON.stringify(["tenantPrimaryOwnersTable", "tenant_primary_owners"]) &&
    JSON.stringify(namesIn("src/lib/platform/seat-accounting.ts")) === JSON.stringify(["subscriptionPackageVersionsTable", "subscriptionPackagesTable", "subscription_package_versions", "subscription_packages", "tenantSubscriptionsTable", "tenant_subscriptions"]),
  `${onboardingUsers.join(", ")} | ${subscriptionNamers.join(", ")} | ${namesIn("src/lib/platform/primary-owners.ts")} | ${namesIn("src/lib/platform/seat-accounting.ts")}`);

// 39. No permission and no route but the named ones: PO-02D2's console invitation detail and PO-02D3's /register/accept.
const d1GuardsSrc = read(join(root, "src/lib/platform/guards.ts"));
const permsLine = (d1GuardsSrc.match(/export const PLATFORM_PERMISSIONS = \[([^\]]*)\] as const;/) ?? ["", "(not found)"])[1];
ok("39. PO-02D1A: the platform permission list is unchanged except (PO-02D2) platform.companies.invite — no package, subscription, Trial or acceptance permission", permsLine === `"platform.access", "platform.sessions.manage", "platform.mfa.manage", "platform.companies.read", "platform.companies.manage_access", "platform.companies.invite"`, permsLine);
const onboardingRoutes = walk(join(root, "src/app")).map(rel).filter((p) => /\/(page|route)\.tsx?$/.test(p) && /invit|accept|onboard|subscri|packag|trial|join|regist/i.test(p)).sort();
// PO-02D3: plus /register/accept — in a route group of its own, (invite), which holds exactly its four files (no layout,
// so the (auth) layout's signed-in redirect can never carry the link's fragment to another URL).
const ACCEPT_ROUTE_FILES = ["accept-invitation.tsx", "actions.ts", "copy.ts", "page.tsx"].map((n) => join("src", "app", "(invite)", "register", "accept", n));
const acceptDirFiles = walk(join(root, "src/app")).map(rel).filter((p) => /[\\/]accept[\\/]/.test(p)).sort();
const inviteGroup = existsSync(join(root, "src/app/(invite)")) ? walk(join(root, "src/app/(invite)")).map(rel).sort() : [];
ok("…the only invitation-, package-, subscription- or registration-named routes are the existing /register, the two console previews, (PO-02D2) the console invitation detail and (PO-02D3) /register/accept — in its own route group (invite) holding exactly its four files; nothing under src/app/(auth)/register/accept",
  JSON.stringify(onboardingRoutes) === JSON.stringify([join("src", "app", "(auth)", "register", "page.tsx"), join("src", "app", "(invite)", "register", "accept", "page.tsx"), join("src", "app", "(platform)", "platform", "(console)", "companies", "invitations", "[invitationId]", "page.tsx"), join("src", "app", "(platform)", "platform", "(console)", "packages", "page.tsx"), join("src", "app", "(platform)", "platform", "(console)", "subscribers", "page.tsx")].sort()) &&
    !existsSync(join(root, "src/app/(auth)/register/accept")) && JSON.stringify(acceptDirFiles) === JSON.stringify(ACCEPT_ROUTE_FILES) && JSON.stringify(inviteGroup) === JSON.stringify(ACCEPT_ROUTE_FILES),
  `${onboardingRoutes.join(", ")} | ${acceptDirFiles.join(", ")}`);

// 40. No invitation feature flag but the named ones (none is activated by default).
// PO-02D2: PLATFORM_INVITATIONS_ENABLED now exists — read (code, comments ignored) ONLY in src/lib/platform/flags.ts, as the
// exact string "true", together with the console flag; the acceptance and invite-only flags still do not exist anywhere.
// PO-02D3: CUSTOMER_INVITE_ACCEPTANCE_ENABLED now exists — read (code, comments ignored) ONLY in flags.ts, once, as the exact
// string "true", and independent of the console flags; INVITE_ONLY still exists nowhere (public registration stays open).
const flagFiles = [...allSrc, ...platformScripts].filter((f) => /INVITE_ONLY/.test(read(f))).map(rel);
const acceptanceFlagCode = [...allSrc, ...platformScripts].filter((f) => /CUSTOMER_INVITE_ACCEPTANCE_ENABLED/.test(code(f))).map(rel);
const invitationFlagReaders = [...allSrc, ...platformScripts].filter((f) => /PLATFORM_INVITATIONS_ENABLED/.test(code(f))).map(rel);
const flagsSrc = code(join(root, "src/lib/platform/flags.ts"));
ok("40. PO-02D1A: no invite-only flag (INVITE_ONLY) in src or scripts/platform; (PO-02D2) PLATFORM_INVITATIONS_ENABLED is read only in flags.ts, only as === \"true\" and only after the console flag; (PO-02D3) CUSTOMER_INVITE_ACCEPTANCE_ENABLED is read only in flags.ts, once, only as === \"true\", without the console flags",
  flagFiles.length === 0 && JSON.stringify(invitationFlagReaders) === JSON.stringify([join("src", "lib", "platform", "flags.ts")]) &&
    /return isPlatformConsoleEnabled\(\) && process\.env\.PLATFORM_INVITATIONS_ENABLED === "true";/.test(flagsSrc) && /assertPlatformConsoleEnabled\(\);\s*if \(process\.env\.PLATFORM_INVITATIONS_ENABLED !== "true"\) throw new PlatformError\("INVITATIONS_DISABLED"/.test(flagsSrc) &&
    (flagsSrc.match(/process\.env\.PLATFORM_INVITATIONS_ENABLED/g) ?? []).length === 2 &&
    JSON.stringify(acceptanceFlagCode) === JSON.stringify([join("src", "lib", "platform", "flags.ts")]) && (flagsSrc.match(/process\.env\.CUSTOMER_INVITE_ACCEPTANCE_ENABLED/g) ?? []).length === 1 &&
    /export function isCustomerInviteAcceptanceEnabled\(\): boolean \{\s*return process\.env\.CUSTOMER_INVITE_ACCEPTANCE_ENABLED === "true";\s*\}/.test(flagsSrc) &&
    /export function assertCustomerInviteAcceptanceEnabled\(\): void \{\s*if \(!isCustomerInviteAcceptanceEnabled\(\)\) throw new PlatformError\("ACCEPTANCE_DISABLED", /.test(flagsSrc),
  `${flagFiles.join(", ")} | ${invitationFlagReaders.join(", ")} | ${acceptanceFlagCode.join(", ")}`);

// 41. The PO-02D1 SQL: four files, none authorized for production, no seed; the foundation writes no row and alters
//     only F1 on users; the rollback drops only PO-02D1 objects; nothing links a subscription to access control.
const d1Files = readdirSync(join(root, "drizzle/platform")).filter((n) => n.startsWith("PO02D1_")).sort();
const d1 = (n) => read(join(root, "drizzle/platform", n));
const sqlCode = (text) => text.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
// PO-02D1B: the "no seed file" clause now admits exactly PO-02D1B's two reviewed seed files (rule 43 pins their content).
const seedFiles = readdirSync(join(root, "drizzle/platform")).filter((n) => /seed/i.test(n)).sort();
ok("41. PO-02D1A: drizzle/platform holds exactly the four PO-02D1 files, each marked NOT AUTHORIZED FOR PRODUCTION EXECUTION, and no seed file but PO-02D1B's two reviewed ones (seed and its rollback, rule 43)",
  JSON.stringify(d1Files) === JSON.stringify(["PO02D1_onboarding_foundation.sql", "PO02D1_rollback.sql", "PO02D1_users_org_id_id_concurrently.sql", "PO02D1_users_org_id_id_drop.sql"]) &&
    d1Files.every((n) => /NOT AUTHORIZED FOR PRODUCTION EXECUTION/.test(d1(n))) && JSON.stringify(seedFiles) === JSON.stringify(["PO02D1B_seed_rollback.sql", "PO02D1B_seed_trial_and_settings.sql"]),
  `${d1Files.join(", ")} | seed files: ${seedFiles.join(", ")}`);
const foundationSql = sqlCode(d1("PO02D1_onboarding_foundation.sql"));
const foundationAlters = [...foundationSql.matchAll(/ALTER\s+TABLE\s+([\w.]+)\s+([^;\n]*)/gi)].map((m) => `${m[1]} ${m[2]}`.trim());
ok("…the foundation writes no row (no INSERT / UPDATE / DELETE / TRUNCATE statement) and its only ALTER TABLE adds F1 to users (created, or attached from the runbook's index)",
  !/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im.test(foundationSql) &&
    JSON.stringify(foundationAlters.sort()) === JSON.stringify(["public.users ADD CONSTRAINT users_org_id_id_uq UNIQUE (id, org_id)", "public.users ADD CONSTRAINT users_org_id_id_uq UNIQUE USING INDEX users_org_id_id_uq"]),
  foundationAlters.join(" | "));
const rollbackSql = sqlCode(d1("PO02D1_rollback.sql"));
const drops = [...rollbackSql.matchAll(/DROP\s+(TABLE|FUNCTION)\s+IF\s+EXISTS\s+public\.(\w+)/gi)].map((m) => m[2]).sort();
ok("…rollback step 1 drops only the seven onboarding tables and three guard functions, never CASCADE, never F1; step 2 removes only users_org_id_id_uq",
  JSON.stringify(drops) === JSON.stringify(["organization_invitation_terms", "platform_settings", "subscription_events", "subscription_package_versions", "subscription_packages", "subscription_package_version_guard", "tenant_primary_owner_guard", "tenant_primary_owners", "tenant_subscription_guard", "tenant_subscriptions"].sort()) &&
    !/CASCADE/i.test(rollbackSql) && !/users_org_id_id_uq/.test(rollbackSql) &&
    JSON.stringify([...sqlCode(d1("PO02D1_users_org_id_id_drop.sql")).matchAll(/(ALTER TABLE [\w.]+ DROP CONSTRAINT \w+|DROP INDEX CONCURRENTLY IF EXISTS [\w.]+)/g)].map((m) => m[1])) === JSON.stringify(["ALTER TABLE public.users DROP CONSTRAINT users_org_id_id_uq", "DROP INDEX CONCURRENTLY IF EXISTS public.users_org_id_id_uq"]),
  drops.join(", "));
ok("…subscription expiry can never suspend a company: no PO-02D1 file references tenant_access_controls except the foundation's precondition column check",
  (foundationSql.match(/tenant_access_controls/g) ?? []).length === 1 && /\('tenant_access_controls', 'org_id', 'integer'\)/.test(foundationSql) &&
    ["PO02D1_rollback.sql", "PO02D1_users_org_id_id_concurrently.sql", "PO02D1_users_org_id_id_drop.sql"].every((n) => !/tenant_access_controls/.test(sqlCode(d1(n)))));

// 42. PO-02D1A.1 (D-11b) — the reviewed foundations' scratch references never point at a live table: every foreign key in
//     their DDL templates references %1$I.<table> — a key-only stand-in (or a table the reference itself creates) when
//     the template builds the scratch reference, the live table only when it is formatted with public — so building and
//     dropping the reference takes no lock on any existing table; and the shape comparison strips the schema prefix.
for (const [file, schema, standIns] of [
  ["PO02A_company_foundation.sql", "po02a_reference", ["orgs", "platform_admins"]],
  ["PO02D1_onboarding_foundation.sql", "po02d1_reference", ["orgs", "users", "platform_admins", "organization_invitations"]],
]) {
  const text = read(join(root, "drizzle/platform", file));
  const code = sqlCode(text);
  const templates = code.split("$ddl$").filter((_, i) => i % 2 === 1);
  const created = templates.flatMap((x) => [...x.matchAll(/CREATE TABLE %1\$I\.(\w+)/g)].map((m) => m[1]));
  const refs = templates.flatMap((x) => [...x.matchAll(/REFERENCES\s+([^\s(]+)/g)].map((m) => m[1]));
  const strays = refs.filter((r) => !r.startsWith("%1$I.") || ![...standIns, ...created].includes(r.slice(5)));
  ok(`42. PO-02D1A.1: ${file} — every foreign key in its DDL templates references %1$I.<table>, a stand-in or a table the reference creates (${refs.length} keys), never public.<table>`,
    code.split("$ddl$").length % 2 === 1 && refs.length > 0 && strays.length === 0 && !/REFERENCES\s+public\./i.test(code), strays.join(", "));
  const at = code.indexOf(`CREATE SCHEMA ${schema};`);
  const firstTemplate = code.indexOf("$ddl$", at);
  const standInAt = standIns.map((s) => code.indexOf(`CREATE TABLE ${schema}.${s} (`));
  ok(`…its key-only stand-ins (${standIns.join(", ")}) are created inside ${schema} after CREATE SCHEMA and before the first template; the scratch schema is dropped before COMMIT`,
    at > 0 && standInAt.every((i) => i > at && i < firstTemplate) && new RegExp(`DROP SCHEMA ${schema} CASCADE;[\\s\\S]*\\nCOMMIT;\\s*$`).test(code), standInAt.join(","));
  ok("…and its shape comparison strips the schema prefix from constraint definitions (a reference key to a stand-in equals a public key to the live table)",
    /\|\| replace\(pg_get_constraintdef\(con\.oid, true\), p_schema \|\| '\.', ''\)/.test(code));
}
const preflightSrc = read(join(root, "scripts/platform/release-preflight.ts"));
ok("…the release preflight opens its session READ ONLY (verified before its first query), never applies drizzle-kit's plan, and is guarded like every platform script",
  /options: "-c default_transaction_read_only=on/.test(preflightSrc) && /current_setting\('default_transaction_read_only'\)/.test(preflightSrc) && !/\.apply\(/.test(preflightSrc) &&
    /assertDisposableLocalDatabaseUrl\(databaseUrl\)/.test(preflightSrc) && /assertDisposableLocalServer\(client, target\)/.test(preflightSrc));
const pkgScripts = JSON.parse(read(join(root, "package.json"))).scripts;
ok("…the customer db:push command is unchanged (gating it is an owner decision, documented in PO02D1A1_MIGRATION_HARDENING.md)",
  pkgScripts["db:push"] === "drizzle-kit push && npm run db:harden" && pkgScripts["db:migrate"] === "drizzle-kit migrate" && pkgScripts["platform:db:preflight"] === "tsx --conditions=react-server scripts/platform/release-preflight.ts");

// 43. PO-02D1B — the default Trial / platform settings seed is data-only, development-only and narrowly scoped.
//     Statement-level checks (line starts): both files also carry reviewed trigger definitions as string literals.
const SEED_FILE = "drizzle/platform/PO02D1B_seed_trial_and_settings.sql";
const SEED_RB_FILE = "drizzle/platform/PO02D1B_seed_rollback.sql";
const seedSql = read(join(root, SEED_FILE));
const seedRbSql = read(join(root, SEED_RB_FILE));
const seedCode = sqlCode(seedSql);
const seedRbCode = sqlCode(seedRbSql);
const dmlOf = (codeText) => [...codeText.matchAll(/^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+([\w.]+)/gim)].map((m) => `${m[1].toUpperCase().replace(/\s+/g, " ")} ${m[2]}`);
const uniq = (xs) => [...new Set(xs)].sort();
const oneTxn = (codeText) => (codeText.match(/^BEGIN;$/gm) ?? []).length === 1 && (codeText.match(/^COMMIT;$/gm) ?? []).length === 1 && /\nCOMMIT;\s*$/.test(codeText);
const targetGuard = (codeText) => /position\('_test_only_' IN current_database\(\)\) = 0/.test(codeText) && /host\(inet_server_addr\(\)\) NOT IN \('127\.0\.0\.1', '::1'\)/.test(codeText) && /listen_addresses/.test(codeText);
ok("43. PO-02D1B: both seed files are marked NOT AUTHORIZED FOR PRODUCTION EXECUTION, run as ONE transaction each, and refuse by themselves any database that is not a loopback-only disposable *_test_only_* database",
  [seedSql, seedRbSql].every((s) => /NOT AUTHORIZED FOR PRODUCTION EXECUTION/.test(s)) && oneTxn(seedCode) && oneTxn(seedRbCode) && targetGuard(seedCode) && targetGuard(seedRbCode));
ok("…the seed writes ONLY the three catalog tables and one audit record (INSERT only — no UPDATE, DELETE or TRUNCATE; no schema change; no customer, subscription, primary-owner or invitation table)",
  JSON.stringify(uniq(dmlOf(seedCode))) === JSON.stringify(["INSERT INTO public.platform_audit_events", "INSERT INTO public.platform_settings", "INSERT INTO public.subscription_package_versions", "INSERT INTO public.subscription_packages"]) &&
    !/^\s*(CREATE|ALTER|DROP)\s+(TABLE|INDEX|TRIGGER|SCHEMA|VIEW|SEQUENCE)\b/im.test(seedCode) && !/DISABLE\s+TRIGGER|session_replication_role/i.test(seedCode),
  uniq(dmlOf(seedCode)).join(" | "));
const disables = [...seedRbCode.matchAll(/^\s*ALTER TABLE ([\w.]+) (DISABLE|ENABLE) TRIGGER (\w+);$/gim)].map((m) => `${m[2].toUpperCase()} ${m[1]}.${m[3]}`);
ok("…the rollback deletes ONLY the three seed records (by exact identity) and appends one audit record; no schema object is created, altered or dropped except ONE scoped trigger suspension",
  JSON.stringify(uniq(dmlOf(seedRbCode))) === JSON.stringify(["DELETE FROM public.platform_settings", "DELETE FROM public.subscription_package_versions", "DELETE FROM public.subscription_packages", "INSERT INTO public.platform_audit_events"]) &&
    !/^\s*(CREATE|DROP)\s+(TABLE|INDEX|TRIGGER|SCHEMA|VIEW|SEQUENCE)\b/im.test(seedRbCode) && (seedRbCode.match(/^\s*ALTER\s+TABLE\b/gim) ?? []).length === 2,
  uniq(dmlOf(seedRbCode)).join(" | "));
const allPlatformSql = readdirSync(join(root, "drizzle/platform")).map((n) => sqlCode(read(join(root, "drizzle/platform", n)))).join("\n");
ok("…that suspension is the ONLY trigger bypass in the reviewed SQL: exactly one DISABLE and one ENABLE of subscription_package_versions_guard, never ALL/USER triggers, never the audit trail, never session_replication_role",
  JSON.stringify(disables) === JSON.stringify(["DISABLE public.subscription_package_versions.subscription_package_versions_guard", "ENABLE public.subscription_package_versions.subscription_package_versions_guard"]) &&
    (allPlatformSql.match(/DISABLE\s+TRIGGER/gi) ?? []).length === 1 && !/DISABLE\s+TRIGGER\s+(ALL|USER)\b/i.test(allPlatformSql) && !/session_replication_role/i.test(allPlatformSql) &&
    !/ALTER\s+TABLE\s+(public\.)?platform_audit_events/i.test(allPlatformSql),
  disables.join(" | "));
const approvedBlock = (s) => { const i = s.indexOf("CREATE FUNCTION pg_temp.po02d1b_approved()"); const o = s.indexOf("$fn$", i); return i < 0 ? "" : s.slice(i, s.indexOf("$fn$;", o + 4) + 5); };
ok("…the approved values are written once per file and identically in both (the owner's 14 days / 3 seats / 5 GB / SAR 0.00 / grace 0 / alerts on)",
  approvedBlock(seedSql).length > 500 && approvedBlock(seedSql) === approvedBlock(seedRbSql) &&
    ["'default_trial_days', 14", "'grace_days', 0", "'expiry_alerts_enabled', true", "'included_seats', 3", "'storage_allowance_gb', 5", "'trial_days', 14", "'monthly_price', '0.00'", "'annual_price', '0.00'", "'currency_code', 'SAR'"].every((x) => approvedBlock(seedSql).includes(x)));
const seedRunner = read(join(root, "scripts/platform/trial-seed.ts"));
ok("…the seed runs only through the guarded runner: both guard steps, then the release preflight (PUSH_SAFE and REVIEWED_SQL_COMPLETE) before any write connection; it never pushes or migrates",
  /assertDisposableLocalDatabaseUrl\(databaseUrl\)/.test(seedRunner) && /assertDisposableLocalServer\(client, target\)/.test(seedRunner) &&
    seedRunner.indexOf("await runPreflight(databaseUrl)") > 0 && seedRunner.indexOf("await runPreflight(databaseUrl)") < seedRunner.indexOf("new Client(") &&
    /preflight\.verdict !== "PUSH_SAFE" \|\| preflight\.state !== "REVIEWED_SQL_COMPLETE"/.test(seedRunner) && !/drizzle-kit|pushSchema|db:push|db:migrate/.test(seedRunner.replace(/\/\*[\s\S]*?\*\//g, "")));
const seedUsers = allSrc.filter((f) => /PO02D1B|trial-seed|platform:db:seed/.test(read(f))).map(rel);
ok("…no application code runs or references the seed (nothing in src/), and no permission, route or flag exists beyond those rules 39–40 name (PO-02D2's, narrowly)", seedUsers.length === 0, seedUsers.join(", "));


// ---------------------------------------------------------------------------------------------
// 44. PO-02D2 — company invitation administration: one service writes invitations, the token never leaves the creating
//     response, every change is authorized in the PO-02C order and is ONE audited transaction; nothing is delivered.
// ---------------------------------------------------------------------------------------------
const INV_ACTIONS = join(root, "src/lib/platform/invitation-actions.ts");
const INV_LIB = join(root, "src/lib/platform/invitations.ts");
const INV_WRAPPERS = join(root, "src/app/(platform)/invitation-actions.ts");
const INV_DIALOGS = join(root, "src/components/platform/invitation-dialogs.tsx");
const invActions = code(INV_ACTIONS);
const invLib = code(INV_LIB);
const invWriters = consoleCode.filter((f) => /\.(insert|update|delete)\((inv|terms|organizationInvitationsTable|organizationInvitationTermsTable)\)/.test(code(f))).map(rel).sort();
// PO-02D3: and the acceptance core — exactly ONE update, the acceptance itself (accepted_at + accepted_org_id, only while
// neither accepted nor revoked); it never inserts, revokes or deletes an invitation and never writes the terms.
ok("44. PO-02D2: only invitation-actions.ts writes invitations and their terms — one insert of each, one revocation update, no delete, never an acceptance; (PO-02D3) the acceptance core writes one thing: the acceptance",
  JSON.stringify(invWriters) === JSON.stringify([rel(ACCEPT_CORE), rel(INV_ACTIONS)].sort()) &&
    (acceptCore.match(/\.update\(inv\)/g) ?? []).length === 1 && /\.update\(inv\)\s*\.set\(\{ acceptedAt: now, acceptedOrgId: ids\.orgId, updatedAt: now \}\)\s*\.where\(and\(eq\(inv\.id, current\.id\), isNull\(inv\.acceptedAt\), isNull\(inv\.revokedAt\)\)\)/.test(acceptCore) &&
    !/\.(insert|delete)\(\s*(inv|terms|organizationInvitationsTable|organizationInvitationTermsTable)\)/.test(acceptCore) && !/\.update\(\s*(terms|organizationInvitationTermsTable)\)/.test(acceptCore) && !/\.set\(\{[^}]*revoked/i.test(acceptCore) && (invActions.match(/\.insert\(inv\)/g) ?? []).length === 1 && (invActions.match(/\.insert\(terms\)/g) ?? []).length === 1 &&
    (invActions.match(/\.update\(inv\)/g) ?? []).length === 1 && /\.update\(inv\)\s*\.set\(\{ revokedAt: notBeforeCreation\(now\), revokedByPlatformAdminId: adminId, updatedAt: notBeforeCreation\(now\) \}\)/.test(invActions) &&
    !/\.delete\(/.test(invActions) && !/\.set\(\{[^}]*accepted/i.test(invActions),
  invWriters.join(", "));
ok("…the read model writes nothing but its view record (invitation.viewed, once), and every read authorizes with platform.companies.read after both flags",
  !/\b(db|tx|executor)\s*\.\s*(insert|update|delete)\(/.test(invLib) && (invLib.match(/recordPlatformAudit\(/g) ?? []).length === 1 && /action: "invitation\.viewed"/.test(invLib) &&
    /async function authorizeInvitationRead\(req: ConsoleRequest\): Promise<PlatformSessionContext> \{\s*assertPlatformInvitationsEnabled\(\);\s*return authorizePlatformToken\(req\.token, "platform\.companies\.read"\);\s*\}/.test(invLib) &&
    (invLib.match(/await authorizeInvitationRead\(req\)/g) ?? []).length === 2);
const TOKEN_ANYWHERE = /\binv\.tokenHash\b|organizationInvitationsTable\.tokenHash|token_hash|tokenHash:\s*inv\./;
// PO-02D3: the acceptance core is the one exception — it finds an invitation by the sha256 of the PRESENTED token and
// re-checks that digest under the row lock; the digest is never returned to a caller, logged or audited (rule 45).
ok("…the token is 32 random bytes (base64url) made in one place; only its sha256 is stored, by the one insert; no platform code selects or names the stored hash column — except (PO-02D3) the acceptance core's one lookup by the presented token's digest and its in-transaction re-check",
  /export function newInvitationToken\(\): \{ token: string; tokenHash: string \} \{\s*const token = randomBytes\(32\)\.toString\("base64url"\);/.test(invLib) && /createHash\("sha256"\)\.update\(token, "utf8"\)\.digest\("hex"\)/.test(invLib) &&
    (invActions.match(/newInvitationToken\(\)/g) ?? []).length === 1 && (invActions.match(/\btokenHash\b/g) ?? []).length === 2 && !consoleCode.filter((f) => f !== ACCEPT_CORE).some((f) => TOKEN_ANYWHERE.test(code(f))) &&
    (acceptCore.match(/\binv\.tokenHash\b/g) ?? []).length === 2 && /const tokenHash = invitationTokenHash\(token\);\s*const \[row\] = await db\.select\(INVITATION_COLUMNS\)\.from\(inv\)\.where\(eq\(inv\.tokenHash, tokenHash\)\)\.limit\(1\);/.test(acceptCore) &&
    /tokenHash: inv\.tokenHash,/.test(acceptCore) && /if \(!current \|\| current\.tokenHash !== pre\.tokenHash\) throw new AcceptanceRefusal\("invalid", "changed"\);/.test(acceptCore));
const originReaders = [...allSrc, ...platformScripts].filter((f) => /CUSTOMER_PUBLIC_ORIGIN/.test(code(f))).map(rel);
ok("…the link is built only by create and re-issue, from CUSTOMER_PUBLIC_ORIGIN (read only in invitations.ts, https or an explicitly approved loopback) — never from Host, X-Forwarded-* or Origin; the token rides in the fragment",
  JSON.stringify(originReaders) === JSON.stringify([rel(INV_LIB)]) && (invActions.match(/const origin = customerPublicOrigin\(\);/g) ?? []).length === 2 && (invActions.match(/link: invitationLink\(origin, outcome\.token\)/g) ?? []).length === 2 &&
    /return `\$\{origin\}\/register\/accept#t=\$\{token\}`;/.test(invLib) && /process\.env\.PLATFORM_INVITATIONS_LOOPBACK_ORIGIN === "true"/.test(invLib) && !/headers\.get\(|x-forwarded/i.test(invLib + invActions));
const invFns = fnBodies(read(INV_ACTIONS)).filter((f) => /^export async function /.test(f.body.trimStart()));
const unordered = invFns.filter((f) => !/^\s*export async function \w+\(req: ConsoleRequest, [^)]*\)[^{]*\{\s*(const action = "[a-z.]+";\s*)?try \{\s*(const ctx = )?await authorizeInvitationChange\(req\);/.test(f.body));
ok("…every exported core starts with authorizeInvitationChange(req) = both flags → same-origin → the live platform session with platform.companies.invite",
  invFns.length === 5 && unordered.length === 0 && /async function authorizeInvitationChange\(req: ConsoleRequest\): Promise<PlatformSessionContext> \{\s*assertPlatformInvitationsEnabled\(\);\s*assertSameOrigin\(req\.headers\);\s*return authorizePlatformToken\(req\.token, "platform\.companies\.invite"\);\s*\}/.test(invActions),
  unordered.map((f) => f.name).join(", ") || invFns.map((f) => f.name).join(","));
const changeFn = (name) => invFns.find((f) => f.name === name)?.body ?? "";
const stepUpOrder = (body, withPassword) => inOrder(body, [
  /await authorizeInvitationChange\(req\)/,
  /await assertPlatformAuditProtection\(\)/,
  withPassword ? /stepUpPassword\(input\.password\)/ : /normalizeInvitationReason\(input\.reason\)/,
  /stepUpCode\(input\.totpCode\)/,
  /throttleKeys\(ctx\.email, meta\.ipAddress\)/,
  new RegExp(`await stepUpOutsideTransaction\\(ctx, keys, ${withPassword ? "password" : "null"}, now, rejected\\)`),
  /await db\.transaction\(/,
  /const totp = await consumeTotpCode\(tx, ctx\.adminId, totpCode, now\);/,
  /await lockInvitationEmail\(tx, /,
  /recordPlatformAudit\(/,
  /\{ isolationLevel: "read committed" \}/,
  /await recordLoginAttempt\(keys, "failure", now\);/,
]);
ok("…create and re-issue: audit protection → format → password step-up (throttled) → ONE read-committed transaction that consumes the TOTP code first, then takes the owner e-mail lock, then writes with its audit; revoke the same with the code and a reason instead of a password",
  stepUpOrder(changeFn("createCompanyInvitation"), true) && stepUpOrder(changeFn("reissueCompanyInvitation"), true) && stepUpOrder(changeFn("revokeCompanyInvitation"), false) &&
    (invActions.match(/db\.transaction\(/g) ?? []).length === 3 && (invActions.match(/\{ isolationLevel: "read committed" \}/g) ?? []).length === 3 &&
    (invActions.match(/recordPlatformAudit\(/g) ?? []).length === 8 && (invActions.match(/\},\s*tx,?\s*\)/g) ?? []).length === 5);
ok("…the e-mail lock is a transaction-scoped advisory lock on the normalized owner e-mail; one pending invitation per e-mail stays enforced by PO-02A's partial unique index (a 23505 is CONFLICT)",
  /pg_advisory_xact_lock\(hashtextextended\(\$\{`platform-invitation-email:\$\{ownerEmail\}`\}, 0\)\)/.test(invLib) && /if \(pgCode\(err\) === "23505"\) throw new PlatformError\("CONFLICT"/.test(invActions));
ok("…the hourly limit is counted from committed rows (creates and re-issues of the operator, a rolling hour) before the step-up and again inside the transaction — never from process memory",
  /export const INVITATION_RATE_LIMIT = \{ windowMs: 60 \* 60 \* 1000, max: 20 \} as const;/.test(invLib) && /\.from\(inv\)\s*\.where\(and\(eq\(inv\.invitedByPlatformAdminId, adminId\), sql`\$\{inv\.createdAt\} > \$\{since\.toISOString\(\)\}::timestamptz`\)\)/.test(invLib) &&
    (invActions.match(/recentInvitationsBy\(db, ctx\.adminId, now\)\) >= INVITATION_RATE_LIMIT\.max/g) ?? []).length === 2 && (invActions.match(/recentInvitationsBy\(tx, ctx\.adminId, now\)\) >= INVITATION_RATE_LIMIT\.max/g) ?? []).length === 2 &&
    !/new Map\(|new Set\(|globalThis/.test(invActions));
const invModules = [INV_ACTIONS, INV_LIB, INV_WRAPPERS, INV_DIALOGS, join(root, "src/components/platform/invitations-kit.tsx")];
const invImports = invModules.flatMap((f) => [...importsOf(read(f)), ...sideEffectImports(read(f))]);
ok("…no delivery: the invitation modules import no mail, SMS, messaging or HTTP client and call no fetch / XMLHttpRequest / sendBeacon / WebSocket (copy-link only)",
  invImports.every((spec) => /^(@\/|\.\/|next\/|react$|zod$|lucide-react$|drizzle-orm$|node:crypto$|server-only$)/.test(spec)) && !invModules.some((f) => /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(code(f))),
  invImports.filter((spec) => !/^(@\/|\.\/|next\/|react$|zod$|lucide-react$|drizzle-orm$|node:crypto$|server-only$)/.test(spec)).join(", "));
const wrappers = code(INV_WRAPPERS);
const dialogs = code(INV_DIALOGS);
ok("…the link reaches the browser only in the create / re-issue action responses and lives only in the dialog's state (no storage, cookie, URL or log); no action revalidates the page under an open dialog; every action input is a strict schema",
  (wrappers.match(/link: outcome\.link/g) ?? []).length === 2 && !/revalidatePath|revalidateTag|console\./.test(wrappers) && (wrappers.match(/\.strict\(\)/g) ?? []).length === 4 &&
    !/localStorage|sessionStorage|indexedDB|document\.cookie|pushState|replaceState|location\.|console\./.test(dialogs) && (dialogs.match(/result\.link/g) ?? []).length === 2);

// ---------------------------------------------------------------------------------------------
// 45. PO-02D3 — invitation acceptance (development only, CUSTOMER_INVITE_ACCEPTANCE_ENABLED): ONE customer bridge reaches the
//     platform core; the route never renders a token or invitation data; the token lives in the browser's memory only and
//     travels only in the two same-origin actions' bodies; acceptance is ONE transaction in a fixed lock order that writes
//     exactly the new company's rows; the throttle is durable; nothing is delivered and no session is issued.
// ---------------------------------------------------------------------------------------------
const BRIDGE_IMPORTS = ["./acceptance-types", "@/lib/auth", "@/lib/org-bootstrap", "@/lib/platform/invitation-acceptance", "@/lib/security/audit", "@/lib/security/password-policy", "next/headers", "server-only"];
const bridgeSrc = read(ACCEPTANCE_BRIDGE);
const bridgeImports = [...new Set([...importsOf(bridgeSrc), ...sideEffectImports(bridgeSrc)])].sort();
const coreImporters = allSrc.filter((f) => importsOf(read(f)).some((s) => s === "@/lib/platform/invitation-acceptance" || (under(f, "src/lib/platform") && s === "./invitation-acceptance"))).map(rel);
ok("45. PO-02D3: the onboarding bridge imports exactly server-only, next/headers, the password hash, the password policy, the shared bootstrap, the customer audit writer, its types and ONE platform module — the acceptance core — and nothing else imports that core",
  JSON.stringify(bridgeImports) === JSON.stringify(BRIDGE_IMPORTS) && JSON.stringify(coreImporters) === JSON.stringify([rel(ACCEPTANCE_BRIDGE)]),
  `${bridgeImports.join(", ")} | ${coreImporters.join(", ")}`);
const ROUTE_IMPORTS = {
  "accept-invitation.tsx": ["./actions", "./copy", "@/app/(app)/actions", "@/components/brand/logo-lockup", "@/components/ui/button", "@/components/ui/input", "@/components/ui/label", "@/lib/i18n/dict", "@/lib/onboarding/acceptance-types", "lucide-react", "react"],
  "actions.ts": ["@/lib/onboarding/acceptance-types", "@/lib/onboarding/invitation-acceptance", "zod"],
  "copy.ts": ["@/lib/i18n/dict"],
  "page.tsx": ["../../../(auth)/auth.css", "./accept-invitation", "@/lib/i18n/server", "@/lib/onboarding/invitation-acceptance", "@/lib/session", "next"],
};
const badRouteImports = Object.entries(ROUTE_IMPORTS).filter(([n, want]) => {
  const src = read(join(root, "src/app/(invite)/register/accept", n));
  return JSON.stringify([...new Set([...importsOf(src), ...sideEffectImports(src)])].sort()) !== JSON.stringify(want);
}).map(([n]) => n);
ok("…the /register/accept route imports only the bridge (page, actions), its types, the UI kit, the dictionary, the session read (page: signed-in check), the sign-out action (client) and the auth stylesheet — no platform module and no database",
  badRouteImports.length === 0, badRouteImports.join(", "));
const acceptPage = code(join(root, "src/app/(invite)/register/accept/page.tsx"));
ok("…the page renders per request (force-dynamic), is not indexed (noindex, nofollow, nocache), sends no referrer, checks the flag first and hands the client only the mode — never a token or invitation data",
  /export const dynamic = "force-dynamic";/.test(acceptPage) && /robots: \{ index: false, follow: false, nocache: true \}/.test(acceptPage) && /referrer: "no-referrer"/.test(acceptPage) &&
    inOrder(acceptPage, [/if \(!invitationAcceptanceAvailable\(\)\) return <AcceptInvitation initialLocale=\{locale\} mode="disabled" \/>;/, /const signedIn = Boolean\(await getSession\(\)\);/, /return <AcceptInvitation initialLocale=\{locale\} mode=\{signedIn \? "signed-in" : "ready"\} \/>;/]) &&
    (acceptPage.match(/<AcceptInvitation /g) ?? []).length === 2);
const acceptClient = code(join(root, "src/app/(invite)/register/accept/accept-invitation.tsx"));
ok("…the client reads the fragment once (#t=… only — never the query), removes it from the address bar and its history entry at once, tells Next.js's router (replaceState without state) and only THEN checks the link; the token lives in a ref, never in React state, and is dropped on pagehide",
  (acceptClient.match(/TOKEN_FRAGMENT\.exec\(window\.location\.hash\)/g) ?? []).length === 1 && !/searchParams|useSearchParams|URLSearchParams/.test(acceptClient) &&
    inOrder(acceptClient, [/const match = TOKEN_FRAGMENT\.exec\(window\.location\.hash\);/, /window\.history\.replaceState\(window\.history\.state, "", clean\);/, /window\.setTimeout\(\(\) => \{\s*window\.history\.replaceState\(null, "", clean\);\s*if \(mode === "ready"\) void validateLink\(token\.current\)\.then\(applyCheck\);/]) &&
    /const token = useRef<string \| null>\(null\);/.test(acceptClient) && !/setToken|useState<string \| null>/.test(acceptClient) && /const onHide = \(\) => \{\s*token\.current = null;\s*\};/.test(acceptClient) && /window\.addEventListener\("pagehide", onHide\);/.test(acceptClient));
ok("…no storage, no log, no other request: no localStorage / sessionStorage / indexedDB, no console call, document.cookie written once and only for the language; the token travels only as the `token` field of the two server actions",
  !/\b(localStorage|sessionStorage|indexedDB)\b/.test(acceptClient) && !/console\./.test(acceptClient) && (acceptClient.match(/document\.cookie/g) ?? []).length === 1 && /document\.cookie = `\$\{LOCALE_COOKIE\}=\$\{locale\}; /.test(acceptClient) &&
    (acceptClient.match(/token: (held|token\.current \?\? "")/g) ?? []).length === 2 && !/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(acceptClient));
ok("…one acceptance request at a time, even for two submits in one instant (a ref set synchronously); a page restored from the back/forward cache, or given a second link, reloads instead of reviving the old one",
  /if \(inFlight\.current \|\| submitting \|\| view\.kind !== "form"\) return;/.test(acceptClient) && inOrder(acceptClient, [/inFlight\.current = true;/, /await acceptInvitationAction\(/, /inFlight\.current = false;/]) &&
    /if \(event\.persisted\) window\.location\.reload\(\);/.test(acceptClient) && /if \(window\.location\.hash\.startsWith\("#t="\)\) window\.location\.reload\(\);/.test(acceptClient));
const acceptActions = code(join(root, "src/app/(invite)/register/accept/actions.ts"));
ok("…the route's server actions: exactly two (check, accept), each a strict schema whose refusal is an 'invalid' link; no redirect, revalidation, cookie, header read or log",
  /^\s*"use server";/.test(acceptActions) && (acceptActions.match(/export async function \w+/g) ?? []).length === 2 && (acceptActions.match(/\.strict\(\)/g) ?? []).length === 2 &&
    (acceptActions.match(/return \{ ok: false, reason: "invalid" \};/g) ?? []).length === 2 && !/redirect\(|revalidatePath|revalidateTag|cookies\(|headers\(|console\./.test(acceptActions));
ok("…every request: flag → configuration → same origin → the canonical customer origin → the protected audit trail → the per-IP block, before any token is read",
  inOrder(acceptCore, [/if \(!isCustomerInviteAcceptanceEnabled\(\)\) throw new AcceptanceRefusal\("disabled", "flag"\);/, /origin = customerPublicOrigin\(\);/, /platformSigningKey\(\);/, /assertSameOrigin\(headers\);/, /if \(headers\.get\("origin"\) !== origin\) throw new AcceptanceRefusal\("unavailable", "origin"\);/, /await assertPlatformAuditProtection\(\);/, /if \(await activeAcceptanceBlock\(ipKeys, platformClock\.now\(\)\)\) throw new AcceptanceRefusal\("throttled", "ip_blocked"\);/, /async function resolveUsable\(/]));
const acceptFn = fnBodies(read(ACCEPT_CORE)).find((f) => f.name === "acceptInvitation")?.body ?? "";
ok("…acceptance is ONE read-committed transaction in a fixed lock order: owner e-mail lock → invitation row FOR UPDATE → the decision time → state, terms and e-mail checks again → bootstrap (callback) → access row → primary owner → Trial subscription → its event → the acceptance → platform audit (in the transaction) → customer evidence (callback); after COMMIT only the throttle's success mark",
  inOrder(acceptFn, [/const pre = await resolveUsable\(ctx, input\.token\);/, /await db\.transaction\(/, /await lockInvitationEmail\(tx, pre\.row\.ownerEmail\);/, /\.for\("update"\)/, /const now = platformClock\.now\(\);/, /const t = await loadTerms\(tx, current\.id\);/, /if \(await customerEmailInUse\(tx, current\.ownerEmail\)\)/, /await hooks\.bootstrap\(tx, facts\)/, /\.insert\(tenantAccessControlsTable\)/, /\.insert\(tenantPrimaryOwnersTable\)/, /\.insert\(tenantSubscriptionsTable\)/, /\.insert\(subscriptionEventsTable\)/, /\.update\(inv\)/, /await recordPlatformAudit\(/, /\},\s*tx,\s*\);/, /await hooks\.evidence\(tx, /, /\{ isolationLevel: "read committed" \}/, /await recordAcceptanceAttempt\(pre\.keys, "success", result\.decidedAt\)/]) &&
    (acceptFn.match(/db\.transaction\(/g) ?? []).length === 1);
ok("…what the core writes: one insert each into tenant_access_controls, tenant_primary_owners, tenant_subscriptions and subscription_events, and the acceptance update — never a delete, never orgs, users, packages, versions, terms or settings (the company and its owner come from the shared bootstrap callback)",
  (acceptCore.match(/\.insert\(/g) ?? []).length === 4 && ["tenantAccessControlsTable", "tenantPrimaryOwnersTable", "tenantSubscriptionsTable", "subscriptionEventsTable"].every((tb) => (acceptCore.match(new RegExp(`\\.insert\\(${tb}\\)`, "g")) ?? []).length === 1) &&
    (acceptCore.match(/\.update\(/g) ?? []).length === 1 && !/\.delete\(/.test(acceptCore) && !/\b(orgsTable|usersTable|platformSettingsTable)\b/.test(acceptCore));
ok("…the Trial comes from the invitation's OWN terms row and the published version it names (never the current default Trial): a published Trial version on the trial cycle at SAR 0, snapshotted; start = the Riyadh business day of the decision, inclusive end = start + days − 1; no payment, no enforcement",
  /\.where\(eq\(terms\.invitationId, invitationId\)\)/.test(acceptCore) && /row\.publishState !== "published" \|\| !row\.termsIsTrial \|\| !row\.versionIsTrial \|\| !row\.packageIsTrial \|\| row\.cycle !== "trial"/.test(acceptCore) && /Number\(row\.price\) !== 0/.test(acceptCore) &&
    !/isDefaultTrial|is_default_trial/.test(acceptCore) && /packageVersionId: t\.versionId,\s*versionState: "published",\s*isTrial: true,\s*cycle: "trial",\s*lifecycleState: "trialing",/.test(acceptCore) &&
    /const startDate = riyadhBusinessDate\(now\);\s*const endDate = addDays\(startDate, t\.trialDays - 1\);/.test(acceptCore) && /priceSnapshotSar: t\.price,\s*seatsSnapshot: t\.seats,\s*storageSnapshotGb: t\.storageGb,\s*moduleGroupsSnapshot: t\.modules,\s*assignmentSource: "invitation_acceptance",/.test(acceptCore) &&
    !/payment|invoice|suspend|enforce/i.test(acceptCore.replace(/AcceptanceRefusal|refusal/g, "")));
const throttleSrc = code(join(root, "src/lib/platform/acceptance-throttle.ts"));
ok("…the public throttle is durable: it writes only platform_login_attempts (two inserts — a success, a failure — never an update or delete), keyed by acceptance-only digest purposes (never a sign-in key), and keeps nothing in process memory",
  (throttleSrc.match(/\.insert\(/g) ?? []).length === 2 && (throttleSrc.match(/\.insert\(t\)/g) ?? []).length === 2 && !/\.(update|delete)\(/.test(throttleSrc) && /const t = platformLoginAttemptsTable;/.test(throttleSrc) &&
    /platformKeyedDigest\("invite-accept-email", ownerEmail\)/.test(throttleSrc) && /platformKeyedDigest\("invite-accept-ip", ip\)/.test(throttleSrc) && !/"login-(email|ip)"/.test(throttleSrc) && !/new Map\(|new Set\(|globalThis/.test(throttleSrc) &&
    /export function platformKeyedDigest\(purpose: "login-email" \| "login-ip" \| "invite-accept-email" \| "invite-accept-ip", value: string\): string \{/.test(code(join(root, "src/lib/platform/config.ts"))));
const acceptModules = [ACCEPT_CORE, join(root, "src/lib/platform/acceptance-throttle.ts"), ACCEPTANCE_BRIDGE, join(root, "src/lib/onboarding/acceptance-types.ts"), join(root, "src/lib/org-bootstrap.ts"), ...ACCEPT_ROUTE_FILES.map((f) => join(root, f))];
ok("…no delivery and no session: the acceptance modules import no mail, SMS, messaging or HTTP client, call no fetch / XMLHttpRequest / sendBeacon / WebSocket, and never issue a session or touch a cookie store",
  !acceptModules.some((f) => /nodemailer|@sendgrid|twilio|whatsapp|mailgun|postmark|\bsmtp\b|axios|\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/i.test(code(f))) &&
    !acceptModules.some((f) => /issueSession|createSession|signSessionToken|cookies\(\)/.test(code(f))));
const bootstrapSrc = code(join(root, "src/lib/org-bootstrap.ts"));
const registerSrc = code(join(root, "src/app/(auth)/actions.ts"));
ok("…ONE organization bootstrap (organization, base currency confirmed → owner → seedOrgDefaults, in the caller's transaction, refusing a non-normalized e-mail), used by exactly /register and the bridge; /register's transaction is exactly that call, and its audit, security event and session still follow COMMIT",
  inOrder(bootstrapSrc, [/if \(fields\.ownerEmail !== fields\.ownerEmail\.trim\(\)\.toLowerCase\(\)\)/, /\.insert\(orgsTable\)/, /baseCurrencyConfirmedAt: new Date\(\)/, /\.insert\(usersTable\)/, /await seedOrgDefaults\(tx, org\.id, fields\.country\);/]) && !/db\.transaction|\bdb\./.test(bootstrapSrc) &&
    inOrder(registerSrc, [/const passwordHash = await hashPassword\(password\);/, /await db\.transaction\(async \(tx\) =>\s*bootstrapOrganization\(tx, \{ orgName, country, currency, ownerName: name, ownerEmail: email, passwordHash \}\),\s*\);/, /await recordAudit\(\{ orgId, userId, userName: name \}, \{ action: "org\.registered"/, /await recordSecurityEvent\(\{ email, orgId, userId, type: "account\.created"/, /await issueSession\(userId, orgId\);/]) &&
    JSON.stringify(allSrc.filter((f) => f !== join(root, "src/lib/org-bootstrap.ts") && /\bbootstrapOrganization\(/.test(code(f))).map(rel).sort()) === JSON.stringify([join("src", "app", "(auth)", "actions.ts"), rel(ACCEPTANCE_BRIDGE)].sort()));
/** Top-level argument counts of every call `name(…)` in source (comments removed; a declaration is skipped). */
const callArity = (src, name) => [...src.matchAll(new RegExp(`(function\\s+)?\\b${name}\\(`, "g"))].filter((m) => !m[1]).map((m) => {
  let depth = 0, commas = 0, tail = false, quote = null, i = m.index + m[0].length;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; tail = true; continue; }
    if ("([{".includes(ch)) { depth++; tail = true; continue; }
    if (")]}".includes(ch)) { if (depth === 0) break; depth--; continue; }
    if (ch === "," && depth === 0) { commas++; tail = false; continue; }
    if (!/\s/.test(ch)) tail = true;
  }
  return commas + (tail ? 1 : 0);
});
const auditExecutorCallers = allSrc.filter((f) => callArity(code(f), "recordAudit").some((n) => n > 2)).map(rel);
ok("…the customer audit writer takes an optional transaction executor (default db, so every existing caller writes exactly as before), and only the bridge passes one — its customer evidence is inside the acceptance transaction",
  /executor: Tx \| typeof db = db,\s*\) \{\s*const ctx = await getRequestContext\(\);\s*await executor\.insert\(auditLogsTable\)/.test(code(join(root, "src/lib/security/audit.ts"))) && JSON.stringify(auditExecutorCallers) === JSON.stringify([rel(ACCEPTANCE_BRIDGE)]) &&
    inOrder(code(ACCEPTANCE_BRIDGE), [/evidence: async \(tx, f\) => \{/, /await recordAudit\(/, /\},\s*tx,\s*\);/, /await recordSecurityEvent\(\{[^}]*\}, tx\);/]),
  auditExecutorCallers.join(", "));

// ---------------------------------------------------------------------------------------------
// 46. PO-03A — primary-owner protection (O-3) and READ-ONLY user-seat accounting: ONE customer gate reaches the two
//     read-only platform cores; every Team change that can affect ownership is ONE read-committed transaction in a fixed
//     lock order (company row → user rows by id → mapping) that writes only the user's role or status and its activity
//     record; nothing enforces seats, writes a mapping or reads a new flag.
// ---------------------------------------------------------------------------------------------
const PO_CORE = join(root, "src/lib/platform/primary-owners.ts");
const SEAT_CORE = join(root, "src/lib/platform/seat-accounting.ts");
const TEAM_SERVICE = join(root, "src/lib/team/member-changes.ts");
const TEAM_PAGE = join(root, "src/app/(app)/settings/organization/page.tsx");
const TEAM_ACTIONS = join(root, "src/app/(app)/settings/team/actions.ts");
const gateSrc46 = read(OWNERSHIP_GATE);
const ownershipGateImports = [...new Set([...importsOf(gateSrc46), ...sideEffectImports(gateSrc46)])].sort();
const coreUsers46 = (spec, local) => allSrc.filter((f) => importsOf(read(f)).some((s) => s === spec || (under(f, "src/lib/platform") && s === local))).map(rel).sort();
ok("46. PO-03A: the Team ownership gate imports exactly server-only, the database handle, its types and the TWO read-only platform cores; outside src/lib/platform nothing else imports either core, inside it only the company read model does",
  JSON.stringify(ownershipGateImports) === JSON.stringify(["./seat-summary-types", "@/db", "@/lib/platform/primary-owners", "@/lib/platform/seat-accounting", "server-only"]) &&
    JSON.stringify(coreUsers46("@/lib/platform/primary-owners", "./primary-owners")) === JSON.stringify([join("src", "lib", "platform", "companies.ts"), rel(OWNERSHIP_GATE)].sort()) &&
    JSON.stringify(coreUsers46("@/lib/platform/seat-accounting", "./seat-accounting")) === JSON.stringify([join("src", "lib", "platform", "companies.ts"), rel(OWNERSHIP_GATE)].sort()),
  `${ownershipGateImports.join(", ")} | ${coreUsers46("@/lib/platform/primary-owners", "./primary-owners")} | ${coreUsers46("@/lib/platform/seat-accounting", "./seat-accounting")}`);
const gateCallers = allSrc.filter((f) => importsOf(read(f)).some((s) => s === "@/lib/team/ownership-gate" || (under(f, "src/lib/team") && s === "./ownership-gate"))).map(rel).sort();
ok("…the gate has exactly two callers, always for the signed-in user's OWN company: the Team-change service (inside its transaction) and the Business Settings page (session.orgId)",
  JSON.stringify(gateCallers) === JSON.stringify([join("src", "app", "(app)", "settings", "organization", "page.tsx"), rel(TEAM_SERVICE)].sort()) &&
    (code(TEAM_PAGE).match(/readTeamOwnershipSummary\(/g) ?? []).length === 1 && /readTeamOwnershipSummary\(session\.orgId\)/.test(code(TEAM_PAGE)) &&
    (code(TEAM_SERVICE).match(/lockPrimaryOwnerForTeamChange\(/g) ?? []).length === 1 && /lockPrimaryOwnerForTeamChange\(tx, session\.orgId\)/.test(code(TEAM_SERVICE)),
  gateCallers.join(", "));
const poCore = code(PO_CORE);
const seatCore = code(SEAT_CORE);
ok("…both platform cores are server-only and READ-ONLY: no insert, update or delete, no environment read; the seat core takes no lock; the primary-owner core takes exactly one, FOR SHARE, in lockPrimaryOwnerMapping; the foundation is asked of the catalog (to_regclass on the unqualified names)",
  [poCore, seatCore].every((s) => /^import "server-only";/.test(s.trim()) && !/\.(insert|update|delete)\(|\b(insert\s+into|delete\s+from)\b|process\.env/i.test(s)) && !/\.for\(/.test(seatCore) &&
    (poCore.match(/\.for\(/g) ?? []).length === 1 && /export async function lockPrimaryOwnerMapping\(tx: Tx, orgId: number\)[\s\S]*?\.limit\(2\)\.for\("share"\);/.test(poCore) &&
    /to_regclass\('tenant_primary_owners'\) is not null as present/.test(poCore) && /to_regclass\('tenant_subscriptions'\)[\s\S]*to_regclass\('subscription_package_versions'\)[\s\S]*to_regclass\('subscription_packages'\)/.test(seatCore) &&
    JSON.stringify(importsOf(poCore).sort()) === JSON.stringify(["./flags", "@/db", "drizzle-orm"]) && JSON.stringify(importsOf(seatCore).sort()) === JSON.stringify(["@/db", "drizzle-orm"]));
ok("…seat accounting is display only: `enforced: false`, pending invitations counted as 0 (none exists), the current subscription's seats snapshot as the only allowance — and no seat-enforcement function exists anywhere",
  /enforced: false;/.test(seatCore) && /enforced: false,/.test(seatCore) && /computeSeatAccounting\(orgId, \{ total: Number\(counts\?\.total \?\? 0\), active: Number\(counts\?\.active \?\? 0\) \}, 0, allowance\)/.test(seatCore) &&
    /seats: sub\.seatsSnapshot,/.test(seatCore) && /\.where\(and\(eq\(sub\.orgId, orgId\), isNull\(sub\.supersededAt\)\)\)/.test(seatCore) &&
    !allSrc.some((f) => /assertUserSeatAvailable|enforceSeat|seatLimitExceeded/i.test(code(f))));
const teamSvc = code(TEAM_SERVICE);
const lockFn46 = fnBodies(read(TEAM_SERVICE)).find((f) => f.name === "lockTeamChange")?.body ?? "";
ok("…a Team change is ONE read-committed transaction: bounded lock wait → the company row FOR NO KEY UPDATE → the actor's and target's user rows of THIS company, by ascending id, FOR NO KEY UPDATE → the primary-owner mapping (gate, FOR SHARE) — then the checks on the locked rows",
  inOrder(lockFn46, [/select set_config\('lock_timeout', \$\{TEAM_LOCK_TIMEOUT\}, true\)/, /\.from\(orgsTable\)\.where\(eq\(orgsTable\.id, session\.orgId\)\)\.for\("no key update"\)/, /\.where\(and\(eq\(usersTable\.orgId, session\.orgId\), inArray\(usersTable\.id, \[session\.userId, targetId\]\)\)\)\s*\.orderBy\(asc\(usersTable\.id\)\)\s*\.for\("no key update"\)/, /await lockPrimaryOwnerForTeamChange\(tx, session\.orgId\)/]) &&
    (teamSvc.match(/db\.transaction\(/g) ?? []).length === 1 && /\}, READ_COMMITTED\);/.test(teamSvc) && /export const TEAM_LOCK_TIMEOUT = "5s";/.test(teamSvc) && (teamSvc.match(/\.for\(/g) ?? []).length === 2);
ok("…what a Team change writes: the target's role or status only (two updates, each scoped to the id AND the company), its activity record in the same transaction, and — for a refused change to the primary owner — one security event; never an insert into users, a delete, an organization change or a mapping write",
  (teamSvc.match(/\.update\(usersTable\)/g) ?? []).length === 2 && /\.set\(\{ role, updatedAt: new Date\(\) \}\)\.where\(and\(eq\(usersTable\.id, target\.id\), eq\(usersTable\.orgId, session\.orgId\)\)\)/.test(teamSvc) &&
    /\.set\(\{ isActive, updatedAt: new Date\(\) \}\)\.where\(and\(eq\(usersTable\.id, target\.id\), eq\(usersTable\.orgId, session\.orgId\)\)\)/.test(teamSvc) && !/\.(insert|delete)\(|orgId:\s*[^,}]+,?\s*updatedAt/.test(teamSvc) &&
    !/tenantPrimaryOwnersTable|tenant_primary_owners/.test(teamSvc) && callArity(teamSvc, "logActivity").length === 2 && callArity(teamSvc, "logActivity").every((n) => n === 3) &&
    (teamSvc.match(/recordSecurityEvent\(/g) ?? []).length === 1 && /type: "team\.primary_owner_protected", severity: "medium"/.test(teamSvc) && callArity(teamSvc, "recordSecurityEvent").every((n) => n === 2));
ok("…the rules on the locked rows: the actor is still an active owner or admin of the company, the target belongs to it, the existing role rules, the primary owner keeps the owner role and stays active, and the last active owner is never removed",
  /if \(!actor \|\| !actor\.isActive \|\| !MANAGERS\.includes\(actor\.role as Role\)\) throw new TeamRefusal\("notManager"\);/.test(teamSvc) && /if \(!target\) throw new TeamRefusal\("notFound"\);/.test(teamSvc) &&
    /if \(!canAssignRole\(actor\.role, role\)\) throw new TeamRefusal\("aboveOwn"\);/.test(teamSvc) && /if \(!canAssignRole\(actor\.role, target\.role as Role\)\) throw new TeamRefusal\("memberRole"\);/.test(teamSvc) &&
    /if \(target\.id === primaryOwnerId && role !== "owner"\) await protectedOwnerRefusal\(tx, session, target\.id, "role_change"\);/.test(teamSvc) &&
    /if \(target\.id === primaryOwnerId\) await protectedOwnerRefusal\(tx, session, target\.id, "deactivation"\);/.test(teamSvc) &&
    (teamSvc.match(/throw new TeamRefusal\("lastOwner"\)/g) ?? []).length === 2);
const teamActions = code(TEAM_ACTIONS);
ok("…the two Team actions authorize (requireRole owner/admin) and hand the change to the service — they no longer write users themselves; adding a member is unchanged",
  /export async function changeRoleAction\(userId: number, role: Role\): Promise<ActionResult> \{\s*const session = await requireRole\("owner", "admin"\);\s*const result = await changeTeamMemberRole\(session, userId, role, await getLocale\(\)\);\s*if \(!result\.error\) revalidatePath\(PATH\);\s*return result;\s*\}/.test(teamActions) &&
    /export async function toggleMemberActiveAction\(userId: number, isActive: boolean\): Promise<ActionResult> \{\s*const session = await requireRole\("owner", "admin"\);\s*const result = await setTeamMemberActive\(session, userId, isActive, await getLocale\(\)\);\s*if \(!result\.error\) revalidatePath\(PATH\);\s*return result;\s*\}/.test(teamActions) &&
    (teamActions.match(/\.update\(usersTable\)/g) ?? []).length === 0 && (teamActions.match(/\.insert\(usersTable\)/g) ?? []).length === 1);
const activityExecutorCallers = allSrc.filter((f) => callArity(code(f), "logActivity").some((n) => n > 2)).map(rel);
ok("…the activity writer takes an optional transaction executor (default db, every existing caller unchanged) and only the Team-change service passes one",
  /executor: Tx \| typeof db = db,\s*\) \{\s*await executor\.insert\(activityLogsTable\)/.test(code(join(root, "src/lib/activity.ts"))) && JSON.stringify(activityExecutorCallers) === JSON.stringify([rel(TEAM_SERVICE)]),
  activityExecutorCallers.join(", "));
const po03aModules = [OWNERSHIP_GATE, TEAM_SERVICE, PO_CORE, SEAT_CORE, join(root, "src/lib/team/seat-summary-types.ts"), join(root, "src/app/(app)/settings/team/seat-summary.tsx")];
ok("…no new flag or environment read: the PO-03A modules read no process.env (the only feature they consult is the existing acceptance flag, through flags.ts)",
  po03aModules.every((f) => !/process\.env/.test(code(f))) && (poCore.match(/isCustomerInviteAcceptanceEnabled\(\)/g) ?? []).length === 1);
const detailPage = code(join(root, "src/app/(platform)/platform/(console)/companies/[orgId]/page.tsx"));
const seatsPanel = (detailPage.match(/function SeatsPanel\([\s\S]*?\n\}\n/) ?? [""])[0];
const readModel46 = code(join(root, "src/lib/platform/companies.ts"));
ok("…the console's Users & seats is display only (no form, button, link or action) and the read model gets it from the shared cores alone — the mapped user's name, e-mail, role and status, nothing more",
  seatsPanel.length > 0 && !/<form|<button|<Link|action=|onClick|"use server"/.test(seatsPanel) && /readSeatAccounting\(db, orgId\)/.test(readModel46) && /readPrimaryOwnerMapping\(db, orgId\)/.test(readModel46) &&
    /\.select\(\{ name: usersTable\.name, email: usersTable\.email, role: usersTable\.role, isActive: usersTable\.isActive \}\)/.test(readModel46));
const teamPanel = code(join(root, "src/app/(app)/settings/team/team-panel.tsx"));
ok("…the Team panel never offers a demotion or a deactivation of the primary owner (only changes that restore it) — the server refuses them anyway",
  /\.filter\(\(r\) => r !== member\.role && \(member\.id !== primaryOwnerId \|\| r === "owner"\)\)/.test(teamPanel) && /\{!\(member\.id === primaryOwnerId && member\.isActive\) && \(/.test(teamPanel) &&
    /<DropdownMenuItem disabled data-testid="team-primary-owner-protected">/.test(teamPanel));

console.log(`\n${pass}/${pass + fail} platform boundary checks passed`);
process.exit(fail ? 1 : 0);
