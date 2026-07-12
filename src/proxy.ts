import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "elite_erp_session";
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
