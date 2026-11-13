import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// ---------------------------------------------------------------------------------------------
// Platform Owner — edge-safe route gate used by src/proxy.ts (PO-01B).
//
// Deliberately free of "server-only", Node built-ins, bcrypt and the database: the proxy can only
// afford a cryptographic check. It answers one question — "may this /platform request reach the
// server at all?" — and every page, route handler and server action then re-validates the LIVE
// database session (src/lib/platform/guards.ts). The constants below mirror
// src/lib/platform/config.ts; tests/security/platform-boundary.test.mjs fails if they drift.
//
// Separation from the customer ERP:
//  • reads ONLY the platform cookie; the customer session cookie is never consulted here;
//  • the customer branch of the proxy never reads the platform cookie;
//  • a token is accepted only with the platform secret, HS256, header typ, issuer, audience,
//    payload marker, UUID subject, opaque jti and a ≤ 12 h lifetime — a customer token can't pass.
// ---------------------------------------------------------------------------------------------

export const PLATFORM_EDGE = {
  cookie: process.env.NODE_ENV === "production" ? "__Host-elite_erp_platform" : "elite_erp_platform",
  algorithm: "HS256",
  issuer: "elite-erp",
  audience: "elite-erp-platform",
  headerType: "platform+jwt",
  tokenUse: "platform",
  maxLifetimeSeconds: 12 * 60 * 60,
} as const;

/** Rendered without a token (only while the console is enabled). Exact matches only. */
export const PLATFORM_PUBLIC_PATHS: ReadonlySet<string> = new Set(["/platform/login", "/platform/recover", "/platform/session-expired"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JTI = /^[A-Za-z0-9_-]{43}$/;
const MIN_SECRET_BYTES = 32;

/** `/platform` and anything below it — but not look-alikes such as `/platformx` or `/platform-old`. */
export function isPlatformPath(pathname: string): boolean {
  return pathname === "/platform" || pathname.startsWith("/platform/");
}

/** Feature flag, default OFF: only the exact string "true" enables the console. */
export function platformConsoleEnabledAtEdge(): boolean {
  return process.env.PLATFORM_CONSOLE_ENABLED === "true";
}

/** The platform key, or null when it is missing, too short or shared with the customer AUTH_SECRET. */
function platformKey(): Uint8Array | null {
  const secret = process.env.PLATFORM_AUTH_SECRET;
  if (!secret) return null;
  const bytes = new TextEncoder().encode(secret);
  if (bytes.length < MIN_SECRET_BYTES) return null;
  if (process.env.AUTH_SECRET && secret === process.env.AUTH_SECRET) return null;
  return bytes;
}

/** Edge-safe cryptographic + claim check of a platform token (no revocation — that is server-side). */
export async function isPlatformTokenValidAtEdge(token: string | undefined, now: Date = new Date()): Promise<boolean> {
  if (!token || token.length < 32 || token.length > 4096) return false;
  const key = platformKey();
  if (!key) return false;
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [PLATFORM_EDGE.algorithm],
      issuer: PLATFORM_EDGE.issuer,
      audience: PLATFORM_EDGE.audience,
      typ: PLATFORM_EDGE.headerType,
      requiredClaims: ["sub", "jti", "iat", "exp"],
      currentDate: now,
    });
    const nowS = Math.floor(now.getTime() / 1000);
    return (
      payload.typ === PLATFORM_EDGE.tokenUse &&
      !("userId" in payload) &&
      !("orgId" in payload) &&
      typeof payload.sub === "string" &&
      UUID.test(payload.sub) &&
      typeof payload.jti === "string" &&
      JTI.test(payload.jti) &&
      typeof payload.iat === "number" &&
      typeof payload.exp === "number" &&
      payload.exp > payload.iat &&
      payload.exp - payload.iat <= PLATFORM_EDGE.maxLifetimeSeconds &&
      payload.iat <= nowS + 60
    );
  } catch {
    return false; // malformed, wrong key/alg/typ/iss/aud, or expired
  }
}

const CLEAR_PLATFORM_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 0,
};
/** The admin console is never indexed. */
const NO_INDEX = { "x-robots-tag": "noindex, nofollow" };

/**
 * The proxy's whole /platform branch:
 *   flag off            → 404 for every /platform path (nothing renders, nothing is revealed);
 *   public paths        → render (login, recovery, the cookie-clearing session-expired handler);
 *   any other path      → requires a cryptographically valid platform token, otherwise a single
 *                         redirect to /platform/login that also clears a present platform cookie.
 * No redirect target is ever taken from the request, so there is no open redirect.
 */
export async function platformGate(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (!platformConsoleEnabledAtEdge()) return new NextResponse(null, { status: 404, headers: NO_INDEX });
  if (PLATFORM_PUBLIC_PATHS.has(pathname)) return NextResponse.next({ headers: NO_INDEX });
  const token = request.cookies.get(PLATFORM_EDGE.cookie)?.value;
  if (await isPlatformTokenValidAtEdge(token)) return NextResponse.next({ headers: NO_INDEX });
  const res = NextResponse.redirect(new URL("/platform/login", request.url));
  res.headers.set("x-robots-tag", NO_INDEX["x-robots-tag"]);
  if (token !== undefined) res.cookies.set(PLATFORM_EDGE.cookie, "", CLEAR_PLATFORM_COOKIE);
  return res;
}
