"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getLocale } from "@/lib/i18n/server";
import { readCompanyAccessCore, setCompanyAccessCore } from "@/lib/platform/company-access-actions";
import { PLATFORM_SESSION_COOKIE, platformSessionCookieOptions } from "@/lib/platform/config";
import type { ConsoleFailure } from "@/lib/platform/console";
import { PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from "@/lib/platform/errors";

// ---------------------------------------------------------------------------------------------
// Company access server actions (PO-02C). Each is authorized on its own, never by what the UI
// rendered: the cores re-check feature flag → same-origin → live platform session →
// platform.companies.manage_access, then the password + TOTP step-up, on every call
// (src/lib/platform/company-access-actions.ts). An unusable platform session clears the cookie and
// returns to sign-in; every other failure returns its code and a localized message.
// ---------------------------------------------------------------------------------------------

export type CompanyAccessActionFailure = { ok: false; code: PlatformErrorCode; message: string };
export type CompanyAccessView = { status: "active" | "suspended"; source: "legacy_default" | "access_control" | "invalid_state"; enforced: boolean };

const CLEARED = { ...platformSessionCookieOptions(new Date(0)), maxAge: 0 };

async function request() {
  const store = await cookies();
  return { headers: await headers(), token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };
}

async function failed(outcome: ConsoleFailure): Promise<CompanyAccessActionFailure> {
  if (outcome.code === "UNAUTHORIZED" || outcome.code === "SESSION_EXPIRED") {
    (await cookies()).set(PLATFORM_SESSION_COOKIE, "", CLEARED);
    redirect("/platform/login?ended=1");
  }
  if (outcome.code === "CONSOLE_DISABLED") redirect("/platform/login");
  const locale = await getLocale();
  return { ok: false, code: outcome.code, message: PLATFORM_ERROR_MESSAGES[outcome.code][locale] };
}

async function invalidInput(): Promise<CompanyAccessActionFailure> {
  const locale = await getLocale();
  return { ok: false, code: "VALIDATION_FAILED", message: PLATFORM_ERROR_MESSAGES.VALIDATION_FAILED[locale] };
}

const orgIdSchema = z.string().max(12);
const changeSchema = z
  .object({
    orgId: orgIdSchema,
    target: z.enum(["suspended", "active"]),
    reference: z.string().max(32),
    reason: z.string().max(2000),
    password: z.string().max(1024),
    totpCode: z.string().max(16),
  })
  .strict();

/** The access state as it is now (not as the page was rendered) — the dialog acts on this. */
export async function readCompanyAccessAction(orgId: unknown): Promise<{ ok: true; state: CompanyAccessView } | CompanyAccessActionFailure> {
  const parsed = orgIdSchema.safeParse(orgId);
  if (!parsed.success) return invalidInput();
  const outcome = await readCompanyAccessCore(await request(), parsed.data);
  if (!outcome.ok) return failed(outcome);
  return { ok: true, state: { status: outcome.state.status, source: outcome.state.source, enforced: outcome.state.enforced } };
}

/** Suspend or reactivate one company's access (typed reference, reason, password and a fresh TOTP code). */
export async function changeCompanyAccessAction(input: unknown): Promise<{ ok: true; status: "active" | "suspended"; sessionsEnded: number } | CompanyAccessActionFailure> {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await setCompanyAccessCore(await request(), { ...parsed.data, totpCode: parsed.data.totpCode.replace(/\s/g, "") });
  if (!outcome.ok) return failed(outcome);
  revalidatePath(`/platform/companies/${outcome.orgId}`);
  revalidatePath("/platform/companies");
  revalidatePath("/platform/dashboard");
  return { ok: true, status: outcome.status, sessionsEnded: outcome.sessionsEnded };
}
