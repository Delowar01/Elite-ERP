// Platform Owner PO-01A + PO-01B — static boundary checks (no database, no network).
// Run: node tests/security/platform-boundary.test.mjs   (npm run verify:platform-boundary)
//
// Encodes the separation rules between the Platform Owner console and the customer ERP so a later
// change cannot silently erode them. Rules 1–8 are PO-01A's; PO-01B widened rule 3 (the console
// routes may import the platform library) and replaced rule 9 ("no platform routes yet") with the
// console rules 9–18 below.
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
const CORES = /\b(signInCore|signOutCore|revokeSessionCore|signOutOtherSessionsCore|regenerateRecoveryCodesCore)\(/;
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
ok("console mutations check the flag, then same-origin, then the live session", /async function authorizeMutation[\s\S]{0,200}assertPlatformConsoleEnabled\(\);\s*assertSameOrigin\(req\.headers\);\s*return authorizePlatformToken\(/.test(coreSrc) && (coreSrc.match(/authorizeMutation\(req,/g) ?? []).length === 3 && /signInCore[\s\S]{0,200}assertSameOrigin/.test(coreSrc) && /signOutCore[\s\S]{0,200}assertSameOrigin/.test(coreSrc));

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
const dynamicTargets = targets.filter((t) => !/^"\/platform(\/[a-z-]+)?(\?ended=1)?"$/.test(t.arg));
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
const previewPages = ["dashboard", "companies", "users", "subscribers", "packages", "activity"].map((p) => read(join(root, `src/app/(platform)/platform/(console)/${p}/page.tsx`)));
ok("every later-phase section page is marked with its phase (PO-02 … PO-06) and calls no data source", previewPages.every((src) => /phase="PO-0[2-6]"/.test(src) && !/@\/lib\/platform\/(console|session|login|mfa|audit)|@\/db/.test(src)));
ok("no hard-coded money, price or KPI figure in console pages (values read “—”)", !consoleFiles.some((f) => /\b(SAR|ر\.س)\s?\d|\d[\d,.]*\s?(SAR|ريال)\b|value=\{?["']?\d{2,}/.test(read(f))));

console.log(`\n${pass}/${pass + fail} platform boundary checks passed`);
process.exit(fail ? 1 : 0);
