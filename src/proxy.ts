import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Kept in sync with src/lib/auth.ts (middleware can't import it — bcryptjs isn't edge-safe).
const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-elite_erp_session" : "elite_erp_session";
const AUTH_ROUTES = ["/login", "/register"];
// Paths that must ALWAYS run (they clear cookies / recover the session), never redirected by us.
const ALWAYS_ALLOW = ["/auth/clear"];

const CLEAR_COOKIE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 0,
};

// Edge-safe cryptographic check ONLY (signature + expiry). jose runs on the edge; bcrypt/DB do not.
// Server-side revocation is checked later by requireSession() — never here, so we don't add a DB
// query to every request (and the matcher already excludes static assets).
async function tokenIsCryptoValid(token: string | undefined): Promise<boolean> {
  if (!token || !process.env.AUTH_SECRET) return false;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET));
    return typeof payload.userId === "number" && typeof payload.orgId === "number";
  } catch {
    // malformed, bad signature, or expired -> not usable
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const hasCookie = Boolean(token);

  // Forward the current path so the (auth) layout can build a safe internal return path.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  const pass = () => NextResponse.next({ request: { headers: requestHeaders } });

  // Cookie-clearing / recovery routes must always execute.
  if (ALWAYS_ALLOW.some((r) => pathname.startsWith(r))) return pass();

  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r));

  // Auth routes ALWAYS render. We never redirect based on cookie *presence* — that was the B1
  // loop. A genuinely usable session is redirected to /dashboard by the (auth) layout after a
  // full check (incl. server-side revocation); an unusable-but-present cookie is cleared there.
  if (isAuthRoute) return pass();

  // Root decides for itself (its page runs a full getSession()).
  if (pathname === "/") return pass();

  // Protected routes require a cryptographically valid token to even render. Revocation is checked
  // server-side by requireSession(). A garbage/malformed/expired cookie is cleared here and the
  // user is redirected once to /login — no loop, and protected data is never rendered.
  const cryptoValid = await tokenIsCryptoValid(token);
  if (!cryptoValid) {
    const res = NextResponse.redirect(new URL("/login", request.url));
    if (hasCookie) res.cookies.set(SESSION_COOKIE, "", CLEAR_COOKIE);
    return res;
  }
  return pass();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
