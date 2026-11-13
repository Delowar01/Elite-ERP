"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE, platformSessionCookieOptions } from "@/lib/platform/config";
import { signInCore, signOutCore } from "@/lib/platform/console";
import { PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from "@/lib/platform/errors";

// ---------------------------------------------------------------------------------------------
// Platform Owner sign-in / sign-out server actions (PO-01B). Thin wrappers: every rule (feature
// flag, same-origin check, throttle, password, mandatory second factor, session creation, audit)
// lives in src/lib/platform/console.ts → login.ts and is tested there.
//
//  • Input is a plain object from the client component, bounded by zod before anything runs.
//  • The session token goes ONLY into the HttpOnly cookie (PO-01A attributes); it is never
//    returned to the browser, put in a URL, or logged.
//  • Errors are generic, localized messages for a fixed set of codes — never internal detail.
//  • No caller-supplied redirect target exists; navigation targets are constants.
// ---------------------------------------------------------------------------------------------

const signInSchema = z
  .object({
    email: z.string().max(320),
    password: z.string().max(1024),
    totpCode: z.string().max(16).optional(),
    recoveryCode: z.string().max(32).optional(),
  })
  .strict();

export type PlatformSignInResult =
  | { status: "mfa_required" }
  | { status: "authenticated"; method: "totp" | "recovery_code"; remainingRecoveryCodes: number | null }
  | { status: "error"; code: PlatformErrorCode; message: string };

async function errorResult(code: PlatformErrorCode): Promise<{ status: "error"; code: PlatformErrorCode; message: string }> {
  const locale = await getLocale();
  return { status: "error", code, message: PLATFORM_ERROR_MESSAGES[code][locale] };
}

const CLEARED = { ...platformSessionCookieOptions(new Date(0)), maxAge: 0 };

export async function platformSignInAction(input: unknown): Promise<PlatformSignInResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return errorResult("VALIDATION_FAILED");
  const email = parsed.data.email.trim();
  const password = parsed.data.password;
  const totpCode = parsed.data.totpCode?.replace(/\s/g, "") || null;
  const recoveryCode = parsed.data.recoveryCode?.trim() || null;
  if (!email || !password || (totpCode && recoveryCode)) return errorResult("VALIDATION_FAILED");

  const outcome = await signInCore({ email, password, totpCode, recoveryCode }, { headers: await headers() });
  if (!outcome.ok) {
    // The password was accepted; the UI moves to the second-factor step (nothing is stored server-side).
    if (outcome.code === "MFA_REQUIRED") return { status: "mfa_required" };
    return errorResult(outcome.code);
  }
  (await cookies()).set(PLATFORM_SESSION_COOKIE, outcome.token, platformSessionCookieOptions(outcome.expiresAt));
  return { status: "authenticated", method: outcome.method, remainingRecoveryCodes: outcome.remainingRecoveryCodes ?? null };
}

/** Ends the current platform session (server-side revocation + cookie removal) and returns to sign-in. */
export async function platformSignOutAction(): Promise<{ status: "error"; message: string }> {
  const store = await cookies();
  const outcome = await signOutCore({ headers: await headers(), token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null });
  // A cross-origin attempt changes nothing. Any other failure (e.g. the database is unreachable)
  // still removes the cookie from this browser; the server-side row then ends at its idle limit.
  if (!outcome.ok && outcome.code === "FORBIDDEN") {
    const { message } = await errorResult("FORBIDDEN");
    return { status: "error", message };
  }
  store.set(PLATFORM_SESSION_COOKIE, "", CLEARED);
  redirect("/platform/login");
}
