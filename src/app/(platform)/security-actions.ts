"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE, platformSessionCookieOptions } from "@/lib/platform/config";
import { regenerateRecoveryCodesCore, revokeSessionCore, signOutOtherSessionsCore, type ConsoleFailure } from "@/lib/platform/console";
import { PLATFORM_ERROR_MESSAGES } from "@/lib/platform/errors";

// ---------------------------------------------------------------------------------------------
// Security-settings server actions (PO-01B). Each one is authorized on its own, independent of
// whatever the UI rendered: the cores re-check feature flag → same-origin → live database session
// → permission on every call (src/lib/platform/console.ts). A session that is no longer usable
// clears the cookie and returns the browser to sign-in; other failures return a localized message.
// ---------------------------------------------------------------------------------------------

export type SecurityActionFailure = { ok: false; message: string };

const CLEARED = { ...platformSessionCookieOptions(new Date(0)), maxAge: 0 };

async function request() {
  const store = await cookies();
  return { headers: await headers(), token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };
}

async function failed(outcome: ConsoleFailure): Promise<SecurityActionFailure> {
  if (outcome.code === "UNAUTHORIZED" || outcome.code === "SESSION_EXPIRED") {
    (await cookies()).set(PLATFORM_SESSION_COOKIE, "", CLEARED);
    redirect("/platform/login?ended=1");
  }
  if (outcome.code === "CONSOLE_DISABLED") redirect("/platform/login");
  const locale = await getLocale();
  return { ok: false, message: PLATFORM_ERROR_MESSAGES[outcome.code][locale] };
}

export async function revokePlatformSessionAction(sessionId: unknown): Promise<{ ok: true } | SecurityActionFailure> {
  const outcome = await revokeSessionCore(await request(), typeof sessionId === "string" ? sessionId : "");
  if (!outcome.ok) return failed(outcome);
  if (outcome.signedOutCurrent) {
    (await cookies()).set(PLATFORM_SESSION_COOKIE, "", CLEARED);
    redirect("/platform/login");
  }
  revalidatePath("/platform/settings");
  return { ok: true };
}

export async function signOutOtherPlatformSessionsAction(): Promise<{ ok: true; count: number } | SecurityActionFailure> {
  const outcome = await signOutOtherSessionsCore(await request());
  if (!outcome.ok) return failed(outcome);
  revalidatePath("/platform/settings");
  return { ok: true, count: outcome.count };
}

const regenerateSchema = z.object({ password: z.string().max(1024), totpCode: z.string().max(16) }).strict();

/**
 * Step-up re-authentication, then a fresh set of recovery codes. The plaintext codes exist only in
 * this one response (shown once by the dialog); the database keeps bcrypt hashes.
 */
export async function regenerateRecoveryCodesAction(input: unknown): Promise<{ ok: true; codes: string[] } | SecurityActionFailure> {
  const parsed = regenerateSchema.safeParse(input);
  if (!parsed.success || !parsed.data.password || !parsed.data.totpCode.trim()) {
    const locale = await getLocale();
    return { ok: false, message: PLATFORM_ERROR_MESSAGES.VALIDATION_FAILED[locale] };
  }
  const outcome = await regenerateRecoveryCodesCore(await request(), {
    password: parsed.data.password,
    totpCode: parsed.data.totpCode.replace(/\s/g, ""),
  });
  if (!outcome.ok) return failed(outcome);
  revalidatePath("/platform/settings");
  return { ok: true, codes: outcome.codes };
}
