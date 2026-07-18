import { NextResponse, type NextRequest } from "next/server";

// Kept in sync with src/lib/auth.ts (middleware can't import it — bcryptjs isn't edge-safe).
const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-elite_erp_session" : "elite_erp_session";
const AUTH_ROUTES = ["/login", "/register"];

export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;
  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r));

  if (!hasSession && !isAuthRoute && pathname !== "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (hasSession && isAuthRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
