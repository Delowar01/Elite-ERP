/**
 * Platform Owner PO-07 H-1 (hostname binding of the Platform Owner console and the customer ERP — development only) —
 * the approved change to files the DEV-UI-01.7, ACC-01, LCP, PO-01A … PO-03D verifiers freeze, on PO07H1_BASE (the
 * PO-07 planning head; its application tree is PO-03D's).
 *
 * Why: the PO-07 readiness tests (Next.js 16.4.6) showed that nginx path rules and the proxy are not a boundary for
 * Server Actions — Next forwards an action whose id the addressed page does not own to the page that does, as a new
 * internal request with the original headers, and the proxy matcher skips "<path>.png", which a dynamic page also
 * matches. H-1 adds ONE edge-safe decision (src/lib/security/host-binding.ts: PLATFORM_CONSOLE_HOST and
 * CUSTOMER_APP_HOST, both or neither; X-Forwarded-Host only behind a configured trusted proxy and only as one value;
 * fail closed on anything else) and checks it at the proxy (first, for every request; and for every request carrying a
 * Next-Action header, whatever its suffix) and at every server-side entry point: the console guards, the public console
 * pages and the session-expired handler, every console mutation core (right before its origin check), the customer
 * session check, sign-in and sign-up, both invitation acceptances (inside their origin step) and the uploads route.
 * Unbound (neither variable set — the live ERP's configuration), behaviour is unchanged. It also widens the boundary
 * test's and the invitations suite's pinned patterns to require the console-host check in place, and hooks this layer
 * into the three verifiers that chain the layers. No schema, migration, seed, SQL, dependency or page file changes.
 *
 * The rule for an approved change is the one every earlier phase used: no re-baseline. Each changed file's hunks are
 * recorded here byte for byte, [ae37b28's text, H-1's text]; undone, the file is ae37b28's to the byte
 * (PO07H1_BASE_SHA), so every older pin keeps its strength. Generated from the diff against PO07H1_BASE (each hunk
 * widened with context until it is unique in both files, its ae37b28 form nowhere in H-1's); changing an H-1 file means
 * regenerating this record, which is then part of the change under review.
 */
import { createHash } from "node:crypto";

export const PO07H1_BASE = "ae37b2839a69c45c01a2bc8929e78ab26fff4590";
export const PO07H1_EDITS: Record<string, [string, string][]> = {
  "src/app/(auth)/actions.ts": [
    ["import { cookies } from \"next/headers\";\n",
      "import { cookies, headers } from \"next/headers\";\n"],
    ["import { isValidCurrencyCode } from \"@/lib/currency/currencies\";\nimport bcrypt from \"bcryptjs\";\n",
      "import { isValidCurrencyCode } from \"@/lib/currency/currencies\";\nimport { hostAllowed } from \"@/lib/security/host-binding\";\nimport bcrypt from \"bcryptjs\";\n"],
    ["const SIGN_IN_UNAVAILABLE_MESSAGE = \"Sign-in is temporarily unavailable. Try again later.\";\n\n",
      "const SIGN_IN_UNAVAILABLE_MESSAGE = \"Sign-in is temporarily unavailable. Try again later.\";\n// PO-07 H-1: shown when sign-up is attempted on a host that is not the customer host (translated in the\n// customer dictionary). It names neither host.\nconst REGISTER_UNAVAILABLE_MESSAGE = \"Something went wrong. Please try again.\";\n\n/** PO-07 H-1: customer sign-in and sign-up run only on the configured customer host (always, while unbound). */\nasync function onCustomerHost(): Promise<boolean> {\n  return hostAllowed(\"customer\", await headers());\n}\n\n"],
    ["export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {\n  const email = String(formData.get(\"email\") ?? \"\").trim().toLowerCase();\n",
      "export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {\n  // PO-07 H-1: before any lookup, throttle or record — so the console host never checks a customer credential.\n  if (!(await onCustomerHost())) return { error: SIGN_IN_UNAVAILABLE_MESSAGE };\n  const email = String(formData.get(\"email\") ?? \"\").trim().toLowerCase();\n"],
    ["export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {\n  const orgName = String(formData.get(\"orgName\") ?? \"\").trim();\n",
      "export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {\n  // PO-07 H-1: no company or account is created from any host but the customer host.\n  if (!(await onCustomerHost())) return { error: REGISTER_UNAVAILABLE_MESSAGE };\n  const orgName = String(formData.get(\"orgName\") ?? \"\").trim();\n"],
  ],
  "src/app/(platform)/platform/(public)/layout.tsx": [
    ["import { cookies } from \"next/headers\";\n",
      "import { cookies, headers } from \"next/headers\";\n"],
    ["import { authorizePlatformToken } from \"@/lib/platform/guards\";\nimport \"@/app/(auth)/auth.css\";\n",
      "import { authorizePlatformToken } from \"@/lib/platform/guards\";\nimport { isConsoleHost } from \"@/lib/platform/origin\";\nimport \"@/app/(auth)/auth.css\";\n"],
    ["  if (!isPlatformConsoleEnabled()) notFound();\n  const token = (await cookies()).get(PLATFORM_SESSION_COOKIE)?.value;\n",
      "  if (!isPlatformConsoleEnabled()) notFound();\n  // PO-07 H-1: the sign-in pages exist only on the configured console host.\n  if (!isConsoleHost(await headers())) notFound();\n  const token = (await cookies()).get(PLATFORM_SESSION_COOKIE)?.value;\n"],
  ],
  "src/app/(platform)/platform/session-expired/route.ts": [
    ["import { isPlatformConsoleEnabled } from \"@/lib/platform/flags\";\n\n",
      "import { isPlatformConsoleEnabled } from \"@/lib/platform/flags\";\nimport { isConsoleHost } from \"@/lib/platform/origin\";\n\n"],
    ["  if (!isPlatformConsoleEnabled()) return new NextResponse(null, { status: 404, headers: NO_STORE });\n  const store = await cookies();\n",
      "  if (!isPlatformConsoleEnabled()) return new NextResponse(null, { status: 404, headers: NO_STORE });\n  // PO-07 H-1: only on the configured console host.\n  if (!isConsoleHost(request.headers)) return new NextResponse(null, { status: 404, headers: NO_STORE });\n  const store = await cookies();\n"],
  ],
  "src/app/uploads/[...path]/route.ts": [
    ["import { getSession } from \"@/lib/session\";\nimport { verifySignedFile } from \"@/lib/security/signed-url\";\n",
      "import { getSession } from \"@/lib/session\";\nimport { hostAllowed } from \"@/lib/security/host-binding\";\nimport { verifySignedFile } from \"@/lib/security/signed-url\";\n"],
    ["export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {\n  const { path } = await ctx.params;\n",
      "export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {\n  // PO-07 H-1: files are served only on the customer host (the session path is bound by getSession() too;\n  // this also binds the signed-URL path, which has no session).\n  if (!hostAllowed(\"customer\", req.headers)) return new Response(\"Not found\", { status: 404 });\n  const { path } = await ctx.params;\n"],
  ],
  "src/lib/platform/company-access-actions.ts": [
    ["import { assertSameOrigin } from \"./origin\";\n",
      "import { assertConsoleHost, assertSameOrigin } from \"./origin\";\n"],
    ["  assertPlatformConsoleEnabled();\n  assertSameOrigin(req.headers);\n",
      "  assertPlatformConsoleEnabled();\n  assertConsoleHost(req.headers);\n  assertSameOrigin(req.headers);\n"],
  ],
  "src/lib/platform/console.ts": [
    ["import { assertSameOrigin } from \"./origin\";\n",
      "import { assertConsoleHost, assertSameOrigin } from \"./origin\";\n"],
    ["  assertPlatformConsoleEnabled();\n  assertSameOrigin(req.headers);\n",
      "  assertPlatformConsoleEnabled();\n  assertConsoleHost(req.headers);\n  assertSameOrigin(req.headers);\n"],
    ["  try {\n    assertPlatformConsoleEnabled();\n    assertSameOrigin(req.headers);\n    const result = await platformLogin({ ...input, ...requestMeta(req.headers) });\n",
      "  try {\n    assertPlatformConsoleEnabled();\n    assertConsoleHost(req.headers);\n    assertSameOrigin(req.headers);\n    const result = await platformLogin({ ...input, ...requestMeta(req.headers) });\n"],
    ["  try {\n    assertPlatformConsoleEnabled();\n    assertSameOrigin(req.headers);\n    const meta = requestMeta(req.headers);\n",
      "  try {\n    assertPlatformConsoleEnabled();\n    assertConsoleHost(req.headers);\n    assertSameOrigin(req.headers);\n    const meta = requestMeta(req.headers);\n"],
  ],
  "src/lib/platform/customer-user-actions.ts": [
    ["import { assertSameOrigin } from \"./origin\";\n",
      "import { assertConsoleHost, assertSameOrigin } from \"./origin\";\n"],
    ["async function authorizeUserManagement(req: ConsoleRequest): Promise<PlatformSessionContext> {\n  assertPlatformConsoleEnabled();\n  assertSameOrigin(req.headers);\n  return authorizePlatformToken(req.token, \"platform.users.manage\");\n",
      "async function authorizeUserManagement(req: ConsoleRequest): Promise<PlatformSessionContext> {\n  assertPlatformConsoleEnabled();\n  assertConsoleHost(req.headers);\n  assertSameOrigin(req.headers);\n  return authorizePlatformToken(req.token, \"platform.users.manage\");\n"],
    ["async function authorizeRoleManagement(req: ConsoleRequest): Promise<PlatformSessionContext> {\n  assertPlatformConsoleEnabled();\n  assertSameOrigin(req.headers);\n  return authorizePlatformToken(req.token, \"platform.users.manage_roles\");\n",
      "async function authorizeRoleManagement(req: ConsoleRequest): Promise<PlatformSessionContext> {\n  assertPlatformConsoleEnabled();\n  assertConsoleHost(req.headers);\n  assertSameOrigin(req.headers);\n  return authorizePlatformToken(req.token, \"platform.users.manage_roles\");\n"],
  ],
  "src/lib/platform/guards.ts": [
    ["import { cache } from \"react\";\nimport { assertPlatformConfiguration, PLATFORM_SESSION_COOKIE } from \"./config\";\n",
      "import { cache } from \"react\";\nimport { hostAllowed } from \"@/lib/security/host-binding\";\nimport { assertPlatformConfiguration, PLATFORM_SESSION_COOKIE } from \"./config\";\n"],
    ["  return (await cookies()).get(PLATFORM_SESSION_COOKIE)?.value;\n}\n\n/** For pages/layouts: 404 while the console is disabled, otherwise redirect to the platform login. */\nexport const requirePlatformSession = cache(async (): Promise<PlatformSessionContext> => {\n  const { notFound, redirect } = await import(\"next/navigation\");\n",
      "  return (await cookies()).get(PLATFORM_SESSION_COOKIE)?.value;\n}\n\n/** PO-07 H-1: did this request address the configured console host? (Always true while unbound.) */\nasync function onConsoleHost(): Promise<boolean> {\n  const { headers } = await import(\"next/headers\");\n  return hostAllowed(\"console\", await headers());\n}\n\n/** For pages/layouts: 404 while the console is disabled, otherwise redirect to the platform login. */\nexport const requirePlatformSession = cache(async (): Promise<PlatformSessionContext> => {\n  const { notFound, redirect } = await import(\"next/navigation\");\n"],
    ["  if (!isPlatformConsoleEnabled()) return notFound();\n  try {\n",
      "  if (!isPlatformConsoleEnabled()) return notFound();\n  // PO-07 H-1: on any other host the console does not exist (404), whatever the cookie says.\n  if (!(await onConsoleHost())) return notFound();\n  try {\n"],
    ["  if (!isPlatformConsoleEnabled()) throw new PlatformError(\"CONSOLE_DISABLED\");\n  return authorizePlatformToken(await platformCookie(), permission);\n",
      "  if (!isPlatformConsoleEnabled()) throw new PlatformError(\"CONSOLE_DISABLED\");\n  // PO-07 H-1: an action or export reached on another host (e.g. a forwarded Server Action) is refused\n  // exactly like a disabled console — before the cookie is even read.\n  if (!(await onConsoleHost())) throw new PlatformError(\"CONSOLE_DISABLED\", \"not the console host\");\n  return authorizePlatformToken(await platformCookie(), permission);\n"],
  ],
  "src/lib/platform/invitation-acceptance.ts": [
    ["import { assertSameOrigin } from \"./origin\";\n",
      "import { assertCustomerHost, assertSameOrigin } from \"./origin\";\n"],
    ["    assertSameOrigin(headers);\n  } catch {\n",
      "    assertSameOrigin(headers);\n    assertCustomerHost(headers); // PO-07 H-1: the customer host only\n  } catch {\n"],
  ],
  "src/lib/platform/invitation-actions.ts": [
    ["import { assertSameOrigin } from \"./origin\";\n",
      "import { assertConsoleHost, assertSameOrigin } from \"./origin\";\n"],
    ["  assertPlatformInvitationsEnabled();\n  assertSameOrigin(req.headers);\n",
      "  assertPlatformInvitationsEnabled();\n  assertConsoleHost(req.headers);\n  assertSameOrigin(req.headers);\n"],
  ],
  "src/lib/platform/origin.ts": [
    ["import \"server-only\";\nimport { trustedProxyHops, type HeaderSource } from \"./client-ip\";\nimport { PlatformError } from \"./errors\";\n\n/**\n",
      "import \"server-only\";\nimport { hostDecision } from \"@/lib/security/host-binding\";\nimport { trustedProxyHops, type HeaderSource } from \"./client-ip\";\nimport { PlatformError } from \"./errors\";\n\n/**\n * PO-07 H-1 — the hostname binding (src/lib/security/host-binding.ts) at the server-side entry points.\n * Every state-changing console core calls assertConsoleHost right before assertSameOrigin; the public\n * customer-side acceptance calls assertCustomerHost right after it. Both are no-ops while unbound.\n */\n\n/** PO-07 H-1: did the request address the configured console host? (The console's pages and route handlers.) */\nexport function isConsoleHost(headers: HeaderSource): boolean {\n  return hostDecision(\"console\", headers).allowed;\n}\n\n/** PO-07 H-1: refuse unless the request addressed the configured console host. */\nexport function assertConsoleHost(headers: HeaderSource): void {\n  const decision = hostDecision(\"console\", headers);\n  if (!decision.allowed) throw new PlatformError(decision.reason === \"config\" ? \"CONFIG_ERROR\" : \"FORBIDDEN\", \"not the console host\");\n}\n\n/** PO-07 H-1: refuse unless the request addressed the configured customer host. */\nexport function assertCustomerHost(headers: HeaderSource): void {\n  const decision = hostDecision(\"customer\", headers);\n  if (!decision.allowed) throw new PlatformError(decision.reason === \"config\" ? \"CONFIG_ERROR\" : \"FORBIDDEN\", \"not the customer host\");\n}\n\n/**\n"],
  ],
  "src/lib/platform/user-invitation-acceptance.ts": [
    ["import { assertSameOrigin } from \"./origin\";\n",
      "import { assertCustomerHost, assertSameOrigin } from \"./origin\";\n"],
    ["    assertSameOrigin(headers);\n  } catch {\n",
      "    assertSameOrigin(headers);\n    assertCustomerHost(headers); // PO-07 H-1: the customer host only\n  } catch {\n"],
  ],
  "src/lib/platform/user-invitation-actions.ts": [
    ["import { assertSameOrigin } from \"./origin\";\n",
      "import { assertConsoleHost, assertSameOrigin } from \"./origin\";\n"],
    ["  assertPlatformUserInvitationsEnabled();\n  assertSameOrigin(req.headers);\n",
      "  assertPlatformUserInvitationsEnabled();\n  assertConsoleHost(req.headers);\n  assertSameOrigin(req.headers);\n"],
  ],
  "src/lib/session.ts": [
    ["import { cookies } from \"next/headers\";\n",
      "import { cookies, headers } from \"next/headers\";\n"],
    ["import { SESSION_COOKIE, verifySessionToken } from \"./auth\";\nimport { isSessionValid, readSessionRow } from \"./security/session-store\";\n",
      "import { SESSION_COOKIE, verifySessionToken } from \"./auth\";\nimport { hostAllowed } from \"./security/host-binding\";\nimport { isSessionValid, readSessionRow } from \"./security/session-store\";\n"],
    ["export async function getSessionState(): Promise<SessionState> {\n  const cookieStore = await cookies();\n",
      "export async function getSessionState(): Promise<SessionState> {\n  // PO-07 H-1: a customer session exists only on the configured customer host (always, while unbound).\n  // Everywhere else — the console host, a forwarded action, an unknown or listed host — it is signed out,\n  // so no customer page, action, export, PDF or file can be reached there with a customer cookie.\n  if (!hostAllowed(\"customer\", await headers())) return SIGNED_OUT;\n  const cookieStore = await cookies();\n"],
  ],
  "src/proxy.ts": [
    ["import { isPlatformPath, platformGate } from \"@/lib/platform-edge/proxy-gate\";\n\n",
      "import { isPlatformPath, platformGate } from \"@/lib/platform-edge/proxy-gate\";\nimport { hostDecision } from \"@/lib/security/host-binding\";\n\n"],
    ["\nexport async function proxy(request: NextRequest) {\n  const { pathname } = request.nextUrl;\n  // Platform Owner console (PO-01B): its own narrowly scoped branch, decided before — and without —\n",
      "\n// PO-07 H-1: assets every surface needs (the matcher normally skips them; an action POST still runs here).\nconst SHARED_ASSET = (pathname: string) => pathname.startsWith(\"/_next/static/\") || pathname === \"/favicon.ico\";\nconst NOT_HERE = { \"x-robots-tag\": \"noindex, nofollow\", \"cache-control\": \"no-store\" };\n\nexport async function proxy(request: NextRequest) {\n  const { pathname } = request.nextUrl;\n  // PO-07 H-1: with PLATFORM_CONSOLE_HOST / CUSTOMER_APP_HOST configured, /platform answers only on the\n  // console host and every other path only on the customer host — first, for every request (a\n  // forwarded Server Action re-enters here with the original headers). Unbound: nothing changes. The\n  // server-side entry points repeat this check; this is the first layer, not the only one.\n  if (!SHARED_ASSET(pathname) && !hostDecision(isPlatformPath(pathname) ? \"console\" : \"customer\", request.headers).allowed) {\n    return new NextResponse(null, { status: 404, headers: NOT_HERE });\n  }\n  // Platform Owner console (PO-01B): its own narrowly scoped branch, decided before — and without —\n"],
    ["  matcher: [\"/((?!_next/static|_next/image|favicon.ico|.*\\\\.(?:svg|png|jpg|jpeg|webp)$).*)\"],\n",
      "  matcher: [\n    \"/((?!_next/static|_next/image|favicon.ico|.*\\\\.(?:svg|png|jpg|jpeg|webp)$).*)\",\n    // PO-07 H-1: a Server Action is never exempt — a dynamic page also matches \"<anything>.png\".\n    { source: \"/((?!_next/static|_next/image|favicon.ico).*)\", has: [{ type: \"header\", key: \"next-action\" }] },\n  ],\n"],
  ],
  "tests/security/platform-boundary.test.mjs": [
    ["ok(\"console mutations check the flag, then same-origin, then the live session\", /async function authorizeMutation[\\s\\S]{0,200}assertPlatformConsoleEnabled\\(\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken\\(/.test(coreSrc) && (coreSrc.match(/authorizeMutation\\(req,/g) ?? []).length === 4 && /signInCore[\\s\\S]{0,200}assertSameOrigin/.test(coreSrc) && /signOutCore[\\s\\S]{0,200}assertSameOrigin/.test(coreSrc));\n",
      "ok(\"console mutations check the flag, then same-origin, then the live session\", /async function authorizeMutation[\\s\\S]{0,200}assertPlatformConsoleEnabled\\(\\);\\s*assertConsoleHost\\(req\\.headers\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken\\(/.test(coreSrc) && (coreSrc.match(/authorizeMutation\\(req,/g) ?? []).length === 4 && /signInCore[\\s\\S]{0,200}assertSameOrigin/.test(coreSrc) && /signOutCore[\\s\\S]{0,200}assertSameOrigin/.test(coreSrc));\n"],
    ["ok(\"…authorizeAccessChange = flag, then same-origin, then the live platform session with platform.companies.manage_access (the platform token only)\", /async function authorizeAccessChange\\(req: ConsoleRequest\\): Promise<PlatformSessionContext> \\{\\s*assertPlatformConsoleEnabled\\(\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken\\(req\\.token, \"platform\\.companies\\.manage_access\"\\);\\s*\\}/.test(accessCore));\n",
      "ok(\"…authorizeAccessChange = flag, then same-origin, then the live platform session with platform.companies.manage_access (the platform token only)\", /async function authorizeAccessChange\\(req: ConsoleRequest\\): Promise<PlatformSessionContext> \\{\\s*assertPlatformConsoleEnabled\\(\\);\\s*assertConsoleHost\\(req\\.headers\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken\\(req\\.token, \"platform\\.companies\\.manage_access\"\\);\\s*\\}/.test(accessCore));\n"],
    ["  invFns.length === 5 && unordered.length === 0 && /async function authorizeInvitationChange\\(req: ConsoleRequest\\): Promise<PlatformSessionContext> \\{\\s*assertPlatformInvitationsEnabled\\(\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken\\(req\\.token, \"platform\\.companies\\.invite\"\\);\\s*\\}/.test(invActions),\n",
      "  invFns.length === 5 && unordered.length === 0 && /async function authorizeInvitationChange\\(req: ConsoleRequest\\): Promise<PlatformSessionContext> \\{\\s*assertPlatformInvitationsEnabled\\(\\);\\s*assertConsoleHost\\(req\\.headers\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken\\(req\\.token, \"platform\\.companies\\.invite\"\\);\\s*\\}/.test(invActions),\n"],
    ["    /async function authorizeUserManagement\\(req: ConsoleRequest\\): Promise<PlatformSessionContext> \\{\\s*assertPlatformConsoleEnabled\\(\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken\\(req\\.token, \"platform\\.users\\.manage\"\\);\\s*\\}/.test(usersActions));\n",
      "    /async function authorizeUserManagement\\(req: ConsoleRequest\\): Promise<PlatformSessionContext> \\{\\s*assertPlatformConsoleEnabled\\(\\);\\s*assertConsoleHost\\(req\\.headers\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken\\(req\\.token, \"platform\\.users\\.manage\"\\);\\s*\\}/.test(usersActions));\n"],
    ["    /async function authorizeRoleManagement\\(req: ConsoleRequest\\): Promise<PlatformSessionContext> \\{\\s*assertPlatformConsoleEnabled\\(\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken\\(req\\.token, \"platform\\.users\\.manage_roles\"\\);\\s*\\}/.test(usersActions) &&\n",
      "    /async function authorizeRoleManagement\\(req: ConsoleRequest\\): Promise<PlatformSessionContext> \\{\\s*assertPlatformConsoleEnabled\\(\\);\\s*assertConsoleHost\\(req\\.headers\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken\\(req\\.token, \"platform\\.users\\.manage_roles\"\\);\\s*\\}/.test(usersActions) &&\n"],
    ["    /async function authorizeUserInvitationChange\\(req: ConsoleRequest\\): Promise<PlatformSessionContext> \\{\\s*assertPlatformUserInvitationsEnabled\\(\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken\\(req\\.token, \"platform\\.users\\.invite\"\\);\\s*\\}/.test(uinvActions) &&\n",
      "    /async function authorizeUserInvitationChange\\(req: ConsoleRequest\\): Promise<PlatformSessionContext> \\{\\s*assertPlatformUserInvitationsEnabled\\(\\);\\s*assertConsoleHost\\(req\\.headers\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken\\(req\\.token, \"platform\\.users\\.invite\"\\);\\s*\\}/.test(uinvActions) &&\n"],
  ],
  "verify/verify-document-form.mts": [
    ["import { PO03D_EDITS, PO03D_NEW, po03dDrift, undoPo03d } from \"./po03d-approved-delta.mjs\";\n\n",
      "import { PO03D_EDITS, PO03D_NEW, po03dDrift, undoPo03d } from \"./po03d-approved-delta.mjs\";\nimport { PO07H1_EDITS, PO07H1_NEW, po07h1Drift, undoPo07h1 } from \"./po07h1-approved-delta.mjs\";\n\n"],
    ["const po03dRead = (p: string) => undoPo03d(p, diskRead(p));\n",
      "// Platform Owner PO-07 H-1: its recorded hunks are undone before PO-03D's (its check below proves they are each file's\n// only change), so the PO-03D layer and every older pin read PO-03D's (ae37b28) bytes; the one src file H-1 added (the\n// hostname-binding decision) stays out of the directory pins.\nconst po07h1Read = (p: string) => undoPo07h1(p, diskRead(p));\nconst po03dRead = (p: string) => undoPo03d(p, po07h1Read(p));\n"],
    ["  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW) && !(p in PO02B_NEW) && !(p in PO02C_NEW) && !(p in PO02C1_NEW) && !(p in PO02D1A_NEW) && !(p in PO02D1A1_NEW) && !(p in PO02D1B_NEW) && !(p in PO02D2_NEW) && !(p in PO02D3_NEW) && !(p in PO03A_NEW) && !(p in PO03B_NEW) && !(p in PO03C_NEW) && !(p in PO03D_NEW)) files.push(p); } };\n",
      "  const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW) && !(p in PO02B_NEW) && !(p in PO02C_NEW) && !(p in PO02C1_NEW) && !(p in PO02D1A_NEW) && !(p in PO02D1A1_NEW) && !(p in PO02D1B_NEW) && !(p in PO02D2_NEW) && !(p in PO02D3_NEW) && !(p in PO03A_NEW) && !(p in PO03B_NEW) && !(p in PO03C_NEW) && !(p in PO03D_NEW) && !(p in PO07H1_NEW)) files.push(p); } };\n"],
    ["  for (const f of files.sort()) { hh.update(f + \"\\0\"); hh.update(f in ACC01_EDITS || f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS || f in PO02B_EDITS || f in PO02C_EDITS || f in PO02C1_EDITS || f in PO02D1A_EDITS || f in PO02D1A1_EDITS || f in PO02D1B_EDITS || f in PO02D2_EDITS || f in PO02D3_EDITS || f in PO03A_EDITS || f in PO03B_EDITS || f in PO03C_EDITS || f in PO03D_EDITS ? read(f) : readFileSync(join(ROOT, f))); }\n",
      "  for (const f of files.sort()) { hh.update(f + \"\\0\"); hh.update(f in ACC01_EDITS || f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS || f in PO02B_EDITS || f in PO02C_EDITS || f in PO02C1_EDITS || f in PO02D1A_EDITS || f in PO02D1A1_EDITS || f in PO02D1B_EDITS || f in PO02D2_EDITS || f in PO02D3_EDITS || f in PO03A_EDITS || f in PO03B_EDITS || f in PO03C_EDITS || f in PO03D_EDITS || f in PO07H1_EDITS ? read(f) : readFileSync(join(ROOT, f))); }\n"],
    ["const po03dDriftNow = po03dDrift((f) => { try { return diskRead(f); } catch { return null; } });\n",
      "const po03dDriftNow = po03dDrift((f) => { try { return po07h1Read(f); } catch { return null; } });\n"],
    ["  po03dDriftNow.join(\" \"));\nconst SUBMIT: Record<string, string> = {\n",
      "  po03dDriftNow.join(\" \"));\nconst po07h1DriftNow = po07h1Drift((f) => { try { return diskRead(f); } catch { return null; } });\ncheck(\"Platform Owner PO-07 H-1's approved change: each recorded file is PO-03D's (ae37b28) plus exactly its hunks — the hostname binding at the proxy, the console guards, origin check and mutation cores, the customer session check, sign-in / sign-up, acceptance and uploads, and the verifiers that record it — and the one added file (the binding decision) is as pinned\",\n  po07h1DriftNow.length === 0 && JSON.stringify(Object.keys(PO07H1_EDITS).sort()) === JSON.stringify([\"src/app/(auth)/actions.ts\", \"src/app/(platform)/platform/(public)/layout.tsx\", \"src/app/(platform)/platform/session-expired/route.ts\", \"src/app/uploads/[...path]/route.ts\", \"src/lib/platform/company-access-actions.ts\", \"src/lib/platform/console.ts\", \"src/lib/platform/customer-user-actions.ts\", \"src/lib/platform/guards.ts\", \"src/lib/platform/invitation-acceptance.ts\", \"src/lib/platform/invitation-actions.ts\", \"src/lib/platform/origin.ts\", \"src/lib/platform/user-invitation-acceptance.ts\", \"src/lib/platform/user-invitation-actions.ts\", \"src/lib/session.ts\", \"src/proxy.ts\", \"tests/security/platform-boundary.test.mjs\", \"verify/verify-document-form.mts\", \"verify/verify-page-archetypes.mts\", \"verify/verify-platform-containment.mts\", \"verify/verify-platform-invitations.mts\", \"verify/verify-platform-proxy.mts\"]) && JSON.stringify(Object.keys(PO07H1_NEW)) === JSON.stringify([\"src/lib/security/host-binding.ts\"]),\n  po07h1DriftNow.join(\" \"));\nconst SUBMIT: Record<string, string> = {\n"],
  ],
  "verify/verify-page-archetypes.mts": [
    ["import { PO03D_BASE, PO03D_EDITS, PO03D_NEW, po03dDrift, undoPo03d } from \"./po03d-approved-delta.mjs\";\nimport { renderToStaticMarkup } from \"react-dom/server\";\n",
      "import { PO03D_BASE, PO03D_EDITS, PO03D_NEW, po03dDrift, undoPo03d } from \"./po03d-approved-delta.mjs\";\nimport { PO07H1_BASE, PO07H1_EDITS, PO07H1_NEW, po07h1Drift, undoPo07h1 } from \"./po07h1-approved-delta.mjs\";\nimport { renderToStaticMarkup } from \"react-dom/server\";\n"],
    ["const po03dRead = (p: string) => undoPo03d(p, diskRead(p));\n",
      "// Platform Owner PO-07 H-1: its recorded hunks are undone before PO-03D's (group 37 proves they are each file's only\n// change), so the PO-03D layer — its added-file pins included — and every older group read PO-03D's (ae37b28) bytes; the\n// one src file it added (the hostname-binding decision, src/lib/security/host-binding.ts) stays out of `walk`.\nconst po07h1Read = (p: string) => undoPo07h1(p, diskRead(p));\nconst po03dRead = (p: string) => undoPo03d(p, po07h1Read(p));\n"],
    ["    : f in ACC01_EDITS ? rawRead(f) : f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS || f in PO02B_EDITS || f in PO02C_EDITS || f in PO02C1_EDITS || f in PO02D1A_EDITS || f in PO02D1A1_EDITS || f in PO02D1B_EDITS || f in PO02D2_EDITS || f in PO02D3_EDITS || f in PO03A_EDITS || f in PO03B_EDITS || f in PO03C_EDITS || f in PO03D_EDITS ? actualRead(f) : readFileSync(path.join(ROOT, f));\n",
      "    : f in ACC01_EDITS ? rawRead(f) : f in LCP_EDITS || f in PO01A_EDITS || f in PO01B_EDITS || f in PO01B1_EDITS || f in PO02A_EDITS || f in PO02B_EDITS || f in PO02C_EDITS || f in PO02C1_EDITS || f in PO02D1A_EDITS || f in PO02D1A1_EDITS || f in PO02D1B_EDITS || f in PO02D2_EDITS || f in PO02D3_EDITS || f in PO03A_EDITS || f in PO03B_EDITS || f in PO03C_EDITS || f in PO03D_EDITS || f in PO07H1_EDITS ? actualRead(f) : readFileSync(path.join(ROOT, f));\n"],
    ["    else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW) && !(p in PO02B_NEW) && !(p in PO02C_NEW) && !(p in PO02C1_NEW) && !(p in PO02D1A_NEW) && !(p in PO02D1A1_NEW) && !(p in PO02D1B_NEW) && !(p in PO02D2_NEW) && !(p in PO02D3_NEW) && !(p in PO03A_NEW) && !(p in PO03B_NEW) && !(p in PO03C_NEW) && !(p in PO03D_NEW)) out.push(p);\n",
      "    else if (!(p in ACC01_NEW) && !(p in LCP_NEW) && !(p in PO01A_NEW) && !(p in PO01B_NEW) && !(p in PO01B1_NEW) && !(p in PO02A_NEW) && !(p in PO02B_NEW) && !(p in PO02C_NEW) && !(p in PO02C1_NEW) && !(p in PO02D1A_NEW) && !(p in PO02D1A1_NEW) && !(p in PO02D1B_NEW) && !(p in PO02D2_NEW) && !(p in PO02D3_NEW) && !(p in PO03A_NEW) && !(p in PO03B_NEW) && !(p in PO03C_NEW) && !(p in PO03D_NEW) && !(p in PO07H1_NEW)) out.push(p);\n"],
    ["  walk(\"src\").length + Object.keys(ACC01_NEW).length + Object.keys(LCP_NEW).length + Object.keys(PO01A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02C_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02C1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D1A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D1A1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D1B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D2_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D3_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO03A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO03B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO03C_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO03D_NEW).filter((f) => f.startsWith(\"src/\")).length === (function all(d: string): number {\n",
      "  walk(\"src\").length + Object.keys(ACC01_NEW).length + Object.keys(LCP_NEW).length + Object.keys(PO01A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO01B1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02C_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02C1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D1A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D1A1_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D1B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D2_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO02D3_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO03A_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO03B_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO03C_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO03D_NEW).filter((f) => f.startsWith(\"src/\")).length + Object.keys(PO07H1_NEW).filter((f) => f.startsWith(\"src/\")).length === (function all(d: string): number {\n"],
    ["const po03dDriftNow = po03dDrift((f) => (existsSync(path.join(ROOT, f)) ? diskRead(f) : null));\n",
      "const po03dDriftNow = po03dDrift((f) => (existsSync(path.join(ROOT, f)) ? po07h1Read(f) : null));\n"],
    ["    !(\"src/app/(app)/settings/team/page.tsx\" in PO03D_EDITS), \"\");\n\nconsole.log(\"\\nGroups:\");\nfor (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);\n",
      "    !(\"src/app/(app)/settings/team/page.tsx\" in PO03D_EDITS), \"\");\n\nsection(\"37. Platform Owner PO-07 H-1 — hostname binding of the console and the customer ERP (the approved change to frozen files)\");\n// Read as they are on disk: each changed file is PO-03D's (ae37b28) plus exactly its recorded hunks, the added file as recorded.\nconst po07h1DriftNow = po07h1Drift((f) => (existsSync(path.join(ROOT, f)) ? diskRead(f) : null));\nconst PO07H1_EDITABLE = [\"src/app/(auth)/actions.ts\", \"src/app/(platform)/platform/(public)/layout.tsx\", \"src/app/(platform)/platform/session-expired/route.ts\", \"src/app/uploads/[...path]/route.ts\", \"src/lib/platform/company-access-actions.ts\", \"src/lib/platform/console.ts\", \"src/lib/platform/customer-user-actions.ts\", \"src/lib/platform/guards.ts\", \"src/lib/platform/invitation-acceptance.ts\", \"src/lib/platform/invitation-actions.ts\", \"src/lib/platform/origin.ts\", \"src/lib/platform/user-invitation-acceptance.ts\", \"src/lib/platform/user-invitation-actions.ts\", \"src/lib/session.ts\", \"src/proxy.ts\", \"tests/security/platform-boundary.test.mjs\", \"verify/verify-document-form.mts\", \"verify/verify-page-archetypes.mts\", \"verify/verify-platform-containment.mts\", \"verify/verify-platform-invitations.mts\", \"verify/verify-platform-proxy.mts\"];\nconst PO07H1_ADDED = [\"src/lib/security/host-binding.ts\"];\ncheck(`PO-07 H-1 changed exactly its ${PO07H1_EDITABLE.length} files by exactly their ${Object.values(PO07H1_EDITS).flat().length} recorded hunks — undone, each is ${PO07H1_BASE.slice(0, 7)}'s to the byte — and added exactly its ${PO07H1_ADDED.length} file, as recorded (verify/po07h1-approved-delta.mts)`,\n  po07h1DriftNow.length === 0 && PO07H1_BASE === \"ae37b2839a69c45c01a2bc8929e78ab26fff4590\" &&\n    JSON.stringify(Object.keys(PO07H1_EDITS).sort()) === JSON.stringify(PO07H1_EDITABLE) && JSON.stringify(Object.keys(PO07H1_NEW).sort()) === JSON.stringify(PO07H1_ADDED),\n  po07h1DriftNow.map(rel).join(\" \"));\ncheck(\"…no database, schema, migration, seed, SQL or dependency file; no page, layout or route is added; the customer-side files it changes are exactly the session check, sign-in / sign-up, the uploads route and the proxy\",\n  ![...Object.keys(PO07H1_EDITS), ...Object.keys(PO07H1_NEW)].some((f) => /^(src\\/db\\/|drizzle\\/|package(-lock)?\\.json$)/.test(f)) &&\n    !Object.keys(PO07H1_NEW).some((f) => /\\/(page|layout|route|loading|error|not-found)\\.tsx?$/.test(f)) &&\n    JSON.stringify(Object.keys(PO07H1_EDITS).filter((f) => f.startsWith(\"src/\") && !/^src\\/(lib\\/platform|app\\/\\(platform\\))\\//.test(f)).sort()) === JSON.stringify([\"src/app/(auth)/actions.ts\", \"src/app/uploads/[...path]/route.ts\", \"src/lib/session.ts\", \"src/proxy.ts\"]), \"\");\ncheck(\"…every recorded hunk only ADDS the binding: undone, no hunk removes a line other than an import it widens or the matcher it extends\",\n  Object.entries(PO07H1_EDITS).filter(([f]) => f.startsWith(\"src/\")).every(([, hunks]) => hunks.every(([was, is]) => {\n    const rest = is.split(\"\\n\");\n    return was.split(\"\\n\").every((line) => { const i = rest.indexOf(line); if (i >= 0) { rest.splice(i, 1); return true; } return /^import |matcher: \\[|^\\s*assertSameOrigin|^\\s*if \\(!isPlatformConsoleEnabled\\(\\)\\)/.test(line); });\n  })), \"\");\n\nconsole.log(\"\\nGroups:\");\nfor (const [g, [p, f]] of Object.entries(counts)) console.log(`  ${g}: ${p}/${p + f}`);\n"],
  ],
  "verify/verify-platform-containment.mts": [
    ["import { PO03D_EDITS, undoPo03d } from \"./po03d-approved-delta.mjs\";\n\n",
      "import { PO03D_EDITS, undoPo03d } from \"./po03d-approved-delta.mjs\";\nimport { PO07H1_EDITS, PO07H1_NEW, undoPo07h1 } from \"./po07h1-approved-delta.mjs\";\n\n"],
    ["    // first, before PO-03B's. It adds no file here.\n    const LIVE = \"621f156f7b129b9c2e289bc46d314ce7587beec2\";\n",
      "    // first, before PO-03B's. It adds no file here.\n    // PO-07 H-1 binds the customer session check, sign-in / sign-up and the uploads route to the configured customer host\n    // and adds the binding decision (src/lib/security/host-binding.ts) — recorded byte for byte\n    // (verify/po07h1-approved-delta.mts): its hunks are undone first of all, and the added file must be exactly as pinned.\n    const LIVE = \"621f156f7b129b9c2e289bc46d314ce7587beec2\";\n"],
    ["      const text = existsSync(f) ? undoPo02c1(f, undoPo02d3(f, undoPo03a(f, undoPo03b(f, undoPo03d(f, readFileSync(f, \"utf8\")))))) : null;\n",
      "      if (f in PO07H1_NEW) return !existsSync(f) || h16(readFileSync(f, \"utf8\")) !== PO07H1_NEW[f];\n      const text = existsSync(f) ? undoPo02c1(f, undoPo02d3(f, undoPo03a(f, undoPo03b(f, undoPo03d(f, undoPo07h1(f, readFileSync(f, \"utf8\"))))))) : null;\n"],
    ["      if ((!(f in PO02C_EDITS) && !(f in PO02C1_EDITS) && !(f in PO02D3_EDITS) && !(f in PO03A_EDITS) && !(f in PO03B_EDITS)) || text === null) return true;\n",
      "      if ((!(f in PO02C_EDITS) && !(f in PO02C1_EDITS) && !(f in PO02D3_EDITS) && !(f in PO03A_EDITS) && !(f in PO03B_EDITS) && !(f in PO07H1_EDITS)) || text === null) return true;\n"],
    ["      JSON.stringify(differing) === JSON.stringify([\"src/app/(app)/settings/organization/page.tsx\", \"src/app/(app)/settings/team/actions.ts\", \"src/app/(app)/settings/team/seat-summary.tsx\", \"src/app/(app)/settings/team/team-panel.tsx\", \"src/app/(auth)/actions.ts\", \"src/lib/security/audit.ts\", \"src/lib/security/session-store.ts\", \"src/lib/security/tenant-access-gate.ts\", \"src/lib/session.ts\"]), differing.join(\", \"));\n",
      "      JSON.stringify(differing) === JSON.stringify([\"src/app/(app)/settings/organization/page.tsx\", \"src/app/(app)/settings/team/actions.ts\", \"src/app/(app)/settings/team/seat-summary.tsx\", \"src/app/(app)/settings/team/team-panel.tsx\", \"src/app/(auth)/actions.ts\", \"src/lib/security/audit.ts\", \"src/lib/security/host-binding.ts\", \"src/lib/security/session-store.ts\", \"src/lib/security/tenant-access-gate.ts\", \"src/lib/session.ts\"]), differing.join(\", \"));\n"],
    ["    const proxyUndone = undoPo03d(\"src/proxy.ts\", proxyNow);\n",
      "    const proxyUndone = undoPo03d(\"src/proxy.ts\", undoPo07h1(\"src/proxy.ts\", proxyNow));\n"],
    ["      proxyUndone !== proxyNow && JSON.stringify(proxyAdded.filter((l) => l.trim() && !/^\\s*\\/\\//.test(l)).map((l) => l.trim())) === JSON.stringify(['const PUBLIC_INVITE_PATHS = new Set([\"/join/accept\"]);', \"if (PUBLIC_INVITE_PATHS.has(pathname)) return pass();\"]),\n",
      "      proxyUndone !== undoPo07h1(\"src/proxy.ts\", proxyNow) && JSON.stringify(proxyAdded.filter((l) => l.trim() && !/^\\s*\\/\\//.test(l)).map((l) => l.trim())) === JSON.stringify(['const PUBLIC_INVITE_PATHS = new Set([\"/join/accept\"]);', \"if (PUBLIC_INVITE_PATHS.has(pathname)) return pass();\"]),\n"],
  ],
  "verify/verify-platform-invitations.mts": [
    ["    ok(\"#8 the change entry point checks the flags, then same-origin, then the session (in that order)\", /assertPlatformInvitationsEnabled\\(\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken/.test(actionsSrc));\n",
      "    ok(\"#8 the change entry point checks the flags, then same-origin, then the session (in that order)\", /assertPlatformInvitationsEnabled\\(\\);\\s*assertConsoleHost\\(req\\.headers\\);\\s*assertSameOrigin\\(req\\.headers\\);\\s*return authorizePlatformToken/.test(actionsSrc));\n"],
  ],
  "verify/verify-platform-proxy.mts": [
    ["      ok(\"the matcher is byte-for-byte 621f156's (static assets still bypass the proxy)\", JSON.stringify(config) === JSON.stringify(base.config));\n",
      "      // PO-07 H-1 adds exactly one matcher entry: every request carrying a Next-Action header runs the proxy (a dynamic page\n      // also matches \"<path>.png\", so a Server Action may never be exempt). 621f156's entry stays first and unchanged.\n      ok(\"the matcher is 621f156's (static assets still bypass the proxy) plus exactly H-1's one Next-Action entry\",\n        Array.isArray(base.config.matcher) && base.config.matcher.length === 1 && Array.isArray(config.matcher) && config.matcher.length === 2 &&\n          JSON.stringify(config.matcher[0]) === JSON.stringify(base.config.matcher[0]) &&\n          JSON.stringify(config.matcher[1]) === JSON.stringify({ source: \"/((?!_next/static|_next/image|favicon.ico).*)\", has: [{ type: \"header\", key: \"next-action\" }] }),\n        JSON.stringify(config.matcher));\n"],
  ],
};

function byPath(pairs: [string, string][]): Record<string, string> {
  return Object.fromEntries(pairs.map(([sha, file]) => [file, sha]));
}
/** ae37b28's bytes of each changed file (sha256, 16 hex) — what the file is once its hunks are undone. */
export const PO07H1_BASE_SHA: Record<string, string> = byPath([
  ["21858fea887c7d49", "src/app/(auth)/actions.ts"],
  ["a7f6204363ecb1b0", "src/app/(platform)/platform/(public)/layout.tsx"],
  ["f0756f3989d74601", "src/app/(platform)/platform/session-expired/route.ts"],
  ["db4abafbb3bce65d", "src/app/uploads/[...path]/route.ts"],
  ["136f3347523b9d65", "src/lib/platform/company-access-actions.ts"],
  ["5afb48671c23779a", "src/lib/platform/console.ts"],
  ["7b3688f0c5293240", "src/lib/platform/customer-user-actions.ts"],
  ["c187ba0bf7713851", "src/lib/platform/guards.ts"],
  ["bef93397b8ea5f88", "src/lib/platform/invitation-acceptance.ts"],
  ["30d688b6d68f416f", "src/lib/platform/invitation-actions.ts"],
  ["fd7d2a23115607d6", "src/lib/platform/origin.ts"],
  ["0affa63913e99bb6", "src/lib/platform/user-invitation-acceptance.ts"],
  ["5eadd08d65a13b27", "src/lib/platform/user-invitation-actions.ts"],
  ["6478dd315ae3bdfa", "src/lib/session.ts"],
  ["01ddd52d02d8b052", "src/proxy.ts"],
  ["b179db1821079d70", "tests/security/platform-boundary.test.mjs"],
  ["9ac969e7c0f0443b", "verify/verify-document-form.mts"],
  ["5a024787191162fd", "verify/verify-page-archetypes.mts"],
  ["2bb1d6ef4505992a", "verify/verify-platform-containment.mts"],
  ["adabccbe106cfe1b", "verify/verify-platform-invitations.mts"],
  ["366f15ae9fb5946a", "verify/verify-platform-proxy.mts"],
]);
/** The file H-1 added (sha256, 16 hex). */
export const PO07H1_NEW: Record<string, string> = byPath([
  ["bfdda383adc1ea8b", "src/lib/security/host-binding.ts"],
]);

const h16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** A file's text with the H-1 hunks undone — ae37b28's text when they are its only change; any other file as it is. */
export function undoPo07h1(file: string, text: string): string {
  return (PO07H1_EDITS[file] ?? []).reduce((acc, [was, is]) => acc.replace(is, () => was), text);
}
/** Files whose bytes are not ae37b28's plus exactly the recorded hunks, and added files not as recorded. */
export function po07h1Drift(actual: (file: string) => string | null): string[] {
  const drift: string[] = [];
  for (const [f, hunks] of Object.entries(PO07H1_EDITS)) {
    const src = actual(f);
    if (src === null || !hunks.every(([was, is]) => src.split(is).length === 2 && !src.includes(was)) || h16(undoPo07h1(f, src)) !== PO07H1_BASE_SHA[f]) drift.push(f);
  }
  for (const [f, sha] of Object.entries(PO07H1_NEW)) {
    const src = actual(f);
    if (src === null || h16(src) !== sha) drift.push(`new: ${f}`);
  }
  return drift;
}
