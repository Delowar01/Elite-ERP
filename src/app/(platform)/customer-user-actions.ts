"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE, platformSessionCookieOptions } from "@/lib/platform/config";
import type { ConsoleFailure } from "@/lib/platform/console";
import { readCustomerUserStateCore, revokeCustomerUserSessionsCore, setCustomerUserStatusCore } from "@/lib/platform/customer-user-actions";
import { PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from "@/lib/platform/errors";

// ---------------------------------------------------------------------------------------------
// Customer-user server actions (PO-03B). Each is authorized on its own, never by what the UI rendered: the cores
// re-check feature flag → same-origin → live platform session → platform.users.manage, then the reason and a fresh
// TOTP step-up, on every call (src/lib/platform/customer-user-actions.ts). An unusable platform session clears the
// cookie and returns to sign-in; every other failure returns its code and a localized message. Nothing returned
// here ever carries a customer token, hash or secret — only states, counts and codes.
// ---------------------------------------------------------------------------------------------

export type CustomerUserActionFailure = { ok: false; code: PlatformErrorCode; message: string };
export type CustomerUserStateView = { isActive: boolean; version: string; primaryOwner: "yes" | "no" | "not_installed" | "unavailable"; lastActiveOwner: boolean; liveSessions: number };

const CLEARED = { ...platformSessionCookieOptions(new Date(0)), maxAge: 0 };

async function request() {
  const store = await cookies();
  return { headers: await headers(), token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };
}

async function failed(outcome: ConsoleFailure): Promise<CustomerUserActionFailure> {
  if (outcome.code === "UNAUTHORIZED" || outcome.code === "SESSION_EXPIRED") {
    (await cookies()).set(PLATFORM_SESSION_COOKIE, "", CLEARED);
    redirect("/platform/login?ended=1");
  }
  if (outcome.code === "CONSOLE_DISABLED") redirect("/platform/login");
  const locale = await getLocale();
  return { ok: false, code: outcome.code, message: PLATFORM_ERROR_MESSAGES[outcome.code][locale] };
}

async function invalidInput(): Promise<CustomerUserActionFailure> {
  const locale = await getLocale();
  return { ok: false, code: "VALIDATION_FAILED", message: PLATFORM_ERROR_MESSAGES.VALIDATION_FAILED[locale] };
}

const userIdSchema = z.string().max(12);
const statusSchema = z
  .object({ userId: userIdSchema, target: z.enum(["disabled", "active"]), reason: z.string().max(2000), totpCode: z.string().max(16), version: z.string().max(40) })
  .strict();
const sessionsSchema = z.object({ userId: userIdSchema, reason: z.string().max(2000), totpCode: z.string().max(16) }).strict();

function refresh(userId: number) {
  revalidatePath(`/platform/users/${userId}`);
  revalidatePath("/platform/users");
}

/** The account as it is now (not as the page was rendered) — the dialogs act on this. */
export async function readCustomerUserStateAction(userId: unknown): Promise<{ ok: true; state: CustomerUserStateView } | CustomerUserActionFailure> {
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) return invalidInput();
  const outcome = await readCustomerUserStateCore(await request(), parsed.data);
  if (!outcome.ok) return failed(outcome);
  const s = outcome.state;
  return { ok: true, state: { isActive: s.isActive, version: s.version, primaryOwner: s.primaryOwner, lastActiveOwner: s.lastActiveOwner, liveSessions: s.liveSessions } };
}

/** Disable or enable one customer user (reason and a fresh TOTP code; the version the dialog confirmed against). */
export async function changeCustomerUserStatusAction(input: unknown): Promise<{ ok: true; status: "active" | "disabled"; sessionsEnded: number } | CustomerUserActionFailure> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await setCustomerUserStatusCore(await request(), { ...parsed.data, totpCode: parsed.data.totpCode.replace(/\s/g, "") });
  if (!outcome.ok) return failed(outcome);
  refresh(outcome.userId);
  return { ok: true, status: outcome.status, sessionsEnded: outcome.sessionsEnded };
}

/** End every live session of one customer user (reason and a fresh TOTP code). */
export async function revokeCustomerUserSessionsAction(input: unknown): Promise<{ ok: true; sessionsEnded: number } | CustomerUserActionFailure> {
  const parsed = sessionsSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await revokeCustomerUserSessionsCore(await request(), { ...parsed.data, totpCode: parsed.data.totpCode.replace(/\s/g, "") });
  if (!outcome.ok) return failed(outcome);
  refresh(outcome.userId);
  return { ok: true, sessionsEnded: outcome.sessionsEnded };
}
