import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { PLATFORM_SESSION_COOKIE, platformSessionCookieOptions } from "@/lib/platform/config";
import { authorizePlatformToken } from "@/lib/platform/guards";
import { isPlatformConsoleEnabled } from "@/lib/platform/flags";

// Platform Owner session-ended boundary (PO-01B). Server Components cannot change cookies while
// rendering, so requirePlatformSession() sends a request whose database session is no longer usable
// (expired, idle, revoked, or never valid) here. This handler clears the platform cookie and sends
// the browser to the sign-in page.
//
// Loop-proof: it runs the SAME check as the guard first. If the session IS usable (for example a
// stale link or a back button), it sends the user to the dashboard and leaves the cookie alone, so
// a live session is never force-cleared and guard → here → guard can never cycle.
// Open-redirect-proof: both destinations are fixed; nothing in the request picks the target.
// The customer session cookie is never read or written here.

const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };

export async function GET(request: NextRequest) {
  if (!isPlatformConsoleEnabled()) return new NextResponse(null, { status: 404, headers: NO_STORE });
  const store = await cookies();
  const token = store.get(PLATFORM_SESSION_COOKIE)?.value;

  if (token) {
    const usable = await authorizePlatformToken(token).then(
      () => true,
      () => false,
    );
    if (usable) return NextResponse.redirect(new URL("/platform/dashboard", request.url), { headers: NO_STORE });
  }

  const res = NextResponse.redirect(new URL("/platform/login?ended=1", request.url), { headers: NO_STORE });
  // Same attributes the cookie was issued with (Max-Age 0 + past expiry), so the browser drops it.
  if (token !== undefined) res.cookies.set(PLATFORM_SESSION_COOKIE, "", { ...platformSessionCookieOptions(new Date(0)), maxAge: 0 });
  return res;
}
