import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_COOKIE_CLEAR } from "@/lib/auth";

// Framework-supported response boundary for clearing an unusable session cookie. Server Components
// cannot mutate cookies during render, so requireSession() / the (auth) layout redirect here when
// they detect a present-but-unusable cookie (invalid, expired or server-side revoked). This route
// deletes the cookie and bounces the user back to an auth page — breaking the B1 redirect loop.
//
// Open-redirect safe: `next` is restricted to a fixed allow-list of internal auth paths, so a
// crafted ?next=//evil.com or ?next=/dashboard can never be honoured.
function safeNext(raw: string | null): string {
  return raw === "/register" ? "/register" : "/login";
}

export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const store = await cookies();
  store.set(SESSION_COOKIE, "", SESSION_COOKIE_CLEAR);
  return NextResponse.redirect(new URL(next, request.url));
}
