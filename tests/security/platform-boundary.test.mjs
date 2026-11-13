// Platform Owner PO-01A + PO-01B — static boundary checks (no database, no network).
// Run: node tests/security/platform-boundary.test.mjs   (npm run verify:platform-boundary)
//
// Encodes the separation rules between the Platform Owner console and the customer ERP so a later
// change cannot silently erode them. Rules 1–8 are PO-01A's; PO-01B widened rule 3 (the console
// routes may import the platform library) and replaced rule 9 ("no platform routes yet") with the
// console rules 9–18 below; PO-01B.1 added rules 19–20 (session changes and the audit-outage policy).
// PO-02B made Companies and the Dashboard operational (read-only): rule 18 now covers the four
// sections that are still previews, and rules 21–28 pin the company read model and its pages; rule 29
// keeps Platform Owner states colour-free (neutral tags from one table of labels and icons).
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
const importers = allSrc.filter((f) => !under(f, "src/lib/platform") && !under(f, "src/app/(platform)") && importsOf(read(f)).some((s) => s.startsWith("@/lib/platform/") || s.includes("/lib/platform/")));
ok("outside src/lib/platform only src/app/(platform) imports the platform library", importers.length === 0, importers.map(rel).join(", "));
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
const UI_ALLOWED = [/^next(\/|$)/, /^react$/, /^lucide-react$/, /^sonner$/, /^@radix-ui\/react-dialog$/, /^@\/components\/ui\//, /^@\/components\/brand\//, /^@\/components\/layout\/(brand-mark|language-switcher|theme-toggle|page-header)$/, /^@\/lib\/utils$/, /^@\/lib\/i18n\/dict$/, /^@\/lib\/theme$/, /^@\/app\/\(platform\)\/(auth|security)-actions$/, /^\.\/[a-z0-9-]+$/];
const badApp = consoleApp.flatMap((f) => [...importsOf(read(f)), ...sideEffectImports(read(f))].filter((s) => !APP_ALLOWED.some((re) => re.test(s))).map((s) => `${rel(f)} → ${s}`));
ok("src/app/(platform) imports only the platform library, console components, shared UI and i18n (no @/db, session, auth, tenant)", consoleApp.length >= 15 && badApp.length === 0, badApp.join(", "));
const badUi = consoleUi.flatMap((f) => [...importsOf(read(f)), ...sideEffectImports(read(f))].filter((s) => !UI_ALLOWED.some((re) => re.test(s))).map((s) => `${rel(f)} → ${s}`));
ok("src/components/platform imports no server module, no customer shell (AppShell/Sidebar/NavList) and no customer action", consoleUi.length >= 10 && badUi.length === 0, badUi.join(", "));
const PLATFORM_MODULES = (s) => s.startsWith("@/lib/platform") || s.startsWith("@/components/platform") || s.startsWith("@/app/(platform)");
const leaks = allSrc.filter((f) => !under(f, "src/app/(platform)") && !under(f, "src/components/platform") && !under(f, "src/lib/platform") && !under(f, "src/lib/platform-edge") && rel(f) !== join("src", "proxy.ts") && importsOf(read(f)).some(PLATFORM_MODULES));
ok("no customer route, component or library imports any platform module", leaks.length === 0, leaks.map(rel).join(", "));

// 12. Server actions are authorized on their own (never by the UI): each exported action calls a
//     console core, which checks flag → origin → live session → permission.
const CORES = /\b(signInCore|signOutCore|revokeSessionCore|signOutOtherSessionsCore|regenerateRecoveryCodesCore|emergencyContainmentCore)\(/;
const actionFiles = consoleApp.filter((f) => /^\s*"use server";/.test(read(f)));
const unguardedActions = actionFiles.flatMap((f) => {
  const src = read(f);
  const parts = src.split(/\n(?=export )/).filter((p) => p.startsWith("export "));
  const stray = parts.filter((p) => !/^export (async function|type) /.test(p)).map((p) => `${rel(f)}: ${p.slice(0, 40)}`);
  const unauth = parts.filter((p) => p.startsWith("export async function") && !CORES.test(p)).map((p) => `${rel(f)}: ${p.slice(22, 60)}`);
  return [...stray, ...unauth];
});
ok("every exported server action in src/app/(platform) runs through a console core (and exports nothing else)", actionFiles.length === 2 && unguardedActions.length === 0, unguardedActions.join(", "));
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
const companyPages = ["companies/page.tsx", "companies/[orgId]/page.tsx", "companies/[orgId]/not-found.tsx", "dashboard/page.tsx"].map((p) => join(root, "src/app/(platform)/platform/(console)", p));
const consoleCode = [...platformLib, ...consoleApp, ...consoleUi];

// 21. Only the read model touches the customer orgs / users tables (the compatibility rule reads orgs.id only).
const tenantTableRefs = consoleCode.filter((f) => /\b(orgsTable|usersTable)\b/.test(code(f)));
ok("only companies.ts and company-access.ts reference orgsTable / usersTable in platform code", JSON.stringify(tenantTableRefs.map(rel).sort()) === JSON.stringify([join("src", "lib", "platform", "companies.ts"), join("src", "lib", "platform", "company-access.ts")]), tenantTableRefs.map(rel).join(", "));
const accessSrc = code(join(root, "src/lib/platform/company-access.ts"));
ok("company-access.ts reads orgs only for existence (orgs.id) and never the users table", (accessSrc.match(/orgsTable\.\w+/g) ?? []).every((m) => m === "orgsTable.id") && !/usersTable/.test(accessSrc));
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
ok("platform.companies.read is the only new permission and grants no company change", /PLATFORM_PERMISSIONS = \["platform\.access", "platform\.sessions\.manage", "platform\.mfa\.manage", "platform\.companies\.read"\] as const;/.test(guardsSrc) && !/platform\.companies\.(write|manage|update|suspend|edit|delete|invite)/.test(consoleCode.map(code).join("\n")));

// 24. A company detail view is audited under the PO-01B.1 policy, or not shown at all.
const detailFn = fnBodies(readModel).find((f) => f.name === "getCompanyDetail")?.body ?? "";
const at = (re) => detailFn.search(re);
ok("getCompanyDetail: authorize → validate id → assert audit protection → read → record company.viewed → return", at(/authorizeCompanyRead\(req\)/) >= 0 && at(/authorizeCompanyRead\(req\)/) < at(/parseOrgId\(rawOrgId\)/) && at(/parseOrgId\(rawOrgId\)/) < at(/await assertPlatformAuditProtection\(\);/) && at(/await assertPlatformAuditProtection\(\);/) < at(/getTenantAccess\(orgId\)/) && at(/getTenantAccess\(orgId\)/) < at(/recordPlatformAudit\(/) && at(/recordPlatformAudit\(/) < at(/return detail;/));
ok("the view record is exact and bounded: company.viewed on organization/<decimal id>, with the org id and request metadata", /action: "company\.viewed",\s*entityType: "organization",\s*entityId: String\(orgId\),\s*orgId,\s*result: "success",\s*\.\.\.meta,/.test(detailFn));
ok("a failed view record is reported as an incident and re-thrown (never swallowed)", /catch \(err\) \{\s*if \(isPlatformError\(err, "AUDIT_UNAVAILABLE"\)\) reportSecurityIncident\(\{ type: "audit_write_failed", action: "company\.viewed", error: errorClass\(err\) \}\);\s*throw err;\s*\}/.test(detailFn));

// 25. Every console page, at any depth, checks the platform session itself; company pages read only the read model.
const allConsolePages = consoleApp.filter((f) => /\(console\)\/.+\/page\.tsx$/.test(f));
const unguardedNested = allConsolePages.filter((f) => !/await requirePlatformSession\(\)/.test(read(f)));
ok("every page.tsx under (console), nested routes included, awaits requirePlatformSession()", allConsolePages.length === 8 && unguardedNested.length === 0, unguardedNested.map(rel).join(", ") || String(allConsolePages.length));
const pageImports = companyPages.flatMap((f) => importsOf(read(f)).filter((s) => s.startsWith("@/lib/platform/")).map((s) => `${rel(f)} → ${s}`));
ok("company pages and the dashboard read data only through the read model (plus config, display, errors, guards)", pageImports.every((x) => /→ @\/lib\/platform\/(companies|config|display|errors|guards)$/.test(x)), pageImports.filter((x) => !/→ @\/lib\/platform\/(companies|config|display|errors|guards)$/.test(x)).join(", "));

// 26. Later-phase company actions never operate: no POST, no server action, disabled controls only.
const companyPageCode = companyPages.map(code).join("\n");
ok("company pages hold no server action and no POST form; the only forms are GET searches of /platform/companies", !/"use server"|<form[^>]*\saction=\{|method="post"|formAction/i.test(companyPageCode) && (companyPageCode.match(/<form /g) ?? []).length === 2 && (companyPageCode.match(/<form method="get" action="\/platform\/companies" role="search"/g) ?? []).length === 2);
const kitSrc = code(join(root, "src/components/platform/companies-kit.tsx"));
ok("DisabledAction is a disabled element; invite, export, suspend/reactivate, edit and user management use it or PreviewAction", /<Button type="button" variant="secondary" disabled aria-disabled="true"/.test(kitSrc) && ["action.inviteCompany", "action.export", "action.suspend", "action.reactivate", "action.editCompany", "action.manageUsers"].every((k) => companyPageCode.includes(`"${k}"`)) && !/onClick|useActionState|useTransition/.test(companyPageCode + kitSrc));

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
ok("one table of labels and icons for Platform Owner states (access active/suspended, invitation pending/expired, audit result success/rejected/failed), with no tone in it",
  stateTable === 'company_access: { active: { label: "access.active", icon: ShieldCheck }, suspended: { label: "access.suspended", icon: ShieldOff }, }, invitation: { pending: { label: "inv.statePending", icon: Clock }, expired: { label: "inv.stateExpired", icon: CalendarX }, }, audit_result: { success: { label: "result.success", icon: CircleCheck }, rejected: { label: "result.rejected", icon: CircleMinus }, failed: { label: "result.failed", icon: CircleX }, },',
  stateTable.slice(0, 120));
ok("PlatformStatusTag renders the design system's status tag with the literal neutral tone", /<span className="status-tag" data-tone="neutral" data-status=\{value\} data-status-domain=\{`platform\.\$\{domain\}`\}>/.test(kitSrc));
const toneByValue = [...companyPages, kitPath].flatMap((f) => [...code(f).matchAll(/<Badge\b[^>]*\svariant=\{|data-tone=\{(?!tone\})|\stone=\{/g)].map((m) => `${rel(f)}: ${m[0]}`));
ok("no company page or kit component chooses a badge variant or a tone from a value (PageState forwards its caller's literal)", toneByValue.length === 0, toneByValue.join(", "));
ok("platform code does not reach into the customer status registry or StatusBadge for its states", !consoleCode.some((f) => /status-registry|status-badge|StatusBadge/.test(code(f))));

console.log(`\n${pass}/${pass + fail} platform boundary checks passed`);
process.exit(fail ? 1 : 0);
