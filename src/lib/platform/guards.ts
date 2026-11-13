import "server-only";
import { cache } from "react";
import { assertPlatformConfiguration, PLATFORM_SESSION_COOKIE } from "./config";
import { isPlatformError, PlatformError } from "./errors";
import { assertPlatformConsoleEnabled, isPlatformConsoleEnabled } from "./flags";
import { validatePlatformSession, type PlatformSessionContext } from "./session";

// ---------------------------------------------------------------------------------------------
// Server-side authorization for every privileged platform operation (PR #11 TRD §3.1).
// A valid cookie alone is never enough: each call re-validates the live session row.
// These guards read ONLY the platform cookie and never the customer session; nothing here can
// grant tenant access, and no tenant role (requireRole('owner')) can grant platform access.
//
// PO-01A ships the guards; PO-01B wires them into /platform routes, layouts and actions.
// ---------------------------------------------------------------------------------------------

/** One-role allowlist for the single Platform Owner (TRD §3.1); later phases extend the list. */
export const PLATFORM_PERMISSIONS = ["platform.access", "platform.sessions.manage", "platform.mfa.manage"] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
const OWNER_PERMISSIONS: ReadonlySet<string> = new Set(PLATFORM_PERMISSIONS);

export function hasPlatformPermission(_ctx: PlatformSessionContext, permission: PlatformPermission): boolean {
  return OWNER_PERMISSIONS.has(permission);
}

/**
 * Core check, independent of Next.js request APIs (directly testable): flag → configuration →
 * live session → permission. Throws PlatformError (CONSOLE_DISABLED, CONFIG_ERROR, UNAUTHORIZED,
 * SESSION_EXPIRED, FORBIDDEN).
 */
export async function authorizePlatformToken(token: string | null | undefined, permission: PlatformPermission = "platform.access"): Promise<PlatformSessionContext> {
  assertPlatformConsoleEnabled();
  assertPlatformConfiguration();
  const ctx = await validatePlatformSession(token);
  if (!hasPlatformPermission(ctx, permission)) throw new PlatformError("FORBIDDEN", `missing permission ${permission}`);
  return ctx;
}

// Next.js request APIs are loaded lazily, inside the wrappers that need a request context. This
// keeps the core above importable by the verification suites (outside the Next runtime).
async function platformCookie(): Promise<string | undefined> {
  const { cookies } = await import("next/headers");
  return (await cookies()).get(PLATFORM_SESSION_COOKIE)?.value;
}

/** For pages/layouts: 404 while the console is disabled, otherwise redirect to the platform login. */
export const requirePlatformSession = cache(async (): Promise<PlatformSessionContext> => {
  const { notFound, redirect } = await import("next/navigation");
  // `return` makes the never-returning Next.js helpers explicit to the type checker.
  if (!isPlatformConsoleEnabled()) return notFound();
  try {
    return await authorizePlatformToken(await platformCookie());
  } catch (err) {
    if (isPlatformError(err, "CONSOLE_DISABLED")) return notFound();
    // PO-01B: via the cookie-clearing handler, which re-runs this same check before clearing — so a
    // stale cookie is removed, a live one is never force-cleared, and no redirect loop can form.
    return redirect("/platform/session-expired");
  }
});

/** For server actions and exports: throws instead of redirecting. */
export async function requirePlatformPermission(permission: PlatformPermission): Promise<PlatformSessionContext> {
  if (!isPlatformConsoleEnabled()) throw new PlatformError("CONSOLE_DISABLED");
  return authorizePlatformToken(await platformCookie(), permission);
}
