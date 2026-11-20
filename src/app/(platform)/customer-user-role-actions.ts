"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE, platformSessionCookieOptions } from "@/lib/platform/config";
import type { ConsoleFailure } from "@/lib/platform/console";
import { changeCustomerUserRoleCore, readCustomerUserRoleStateCore, readPrimaryOwnerTransferOptionsCore, transferPrimaryOwnerCore } from "@/lib/platform/customer-user-actions";
import { PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from "@/lib/platform/errors";

// ---------------------------------------------------------------------------------------------
// Role and primary-ownership server actions (PO-03C, sub-batch A). Each is authorized on its own, never by what the UI
// rendered: the cores re-check feature flag → same-origin → live platform session → platform.users.manage_roles, then
// the reason and a fresh TOTP step-up, on every call (src/lib/platform/customer-user-actions.ts). An unusable platform
// session clears the cookie and returns to sign-in; every other failure returns its code and a localized message.
// Nothing returned here carries a customer token, hash or secret — only roles, states, change markers, counts and the
// directory's own allow-listed identity fields (name, e-mail) of the company's users.
// ---------------------------------------------------------------------------------------------

export type RoleActionFailure = { ok: false; code: PlatformErrorCode; message: string };
export type RoleStateView = { orgId: number; role: string; isActive: boolean; version: string; primaryOwner: "yes" | "no" | "not_installed" | "unavailable"; lastActiveOwner: boolean };
export type TransferCandidateView = { userId: number; name: string; email: string; role: string; version: string };
export type TransferOptionsView = {
  designation: "designated" | "not_designated" | "not_installed" | "unavailable";
  primaryOwner: TransferCandidateView | null;
  candidates: TransferCandidateView[];
  truncated: boolean;
};

const CLEARED = { ...platformSessionCookieOptions(new Date(0)), maxAge: 0 };

async function request() {
  const store = await cookies();
  return { headers: await headers(), token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };
}

async function failed(outcome: ConsoleFailure): Promise<RoleActionFailure> {
  if (outcome.code === "UNAUTHORIZED" || outcome.code === "SESSION_EXPIRED") {
    (await cookies()).set(PLATFORM_SESSION_COOKIE, "", CLEARED);
    redirect("/platform/login?ended=1");
  }
  if (outcome.code === "CONSOLE_DISABLED") redirect("/platform/login");
  const locale = await getLocale();
  return { ok: false, code: outcome.code, message: PLATFORM_ERROR_MESSAGES[outcome.code][locale] };
}

async function invalidInput(): Promise<RoleActionFailure> {
  const locale = await getLocale();
  return { ok: false, code: "VALIDATION_FAILED", message: PLATFORM_ERROR_MESSAGES.VALIDATION_FAILED[locale] };
}

const idSchema = z.string().max(12);
const versionSchema = z.string().max(40);
const roleSchema = z
  .object({ userId: idSchema, orgId: idSchema, role: z.enum(["owner", "admin", "staff"]), reason: z.string().max(2000), totpCode: z.string().max(16), version: versionSchema })
  .strict();
const transferSchema = z
  .object({ orgId: idSchema, fromUserId: idSchema, toUserId: idSchema, fromVersion: versionSchema, toVersion: versionSchema, reason: z.string().max(2000), totpCode: z.string().max(16) })
  .strict();

const candidateView = (c: TransferCandidateView): TransferCandidateView => ({ userId: c.userId, name: c.name, email: c.email, role: c.role, version: c.version });

/** One account as it is now, for the role control. */
export async function readCustomerUserRoleStateAction(userId: unknown): Promise<{ ok: true; state: RoleStateView } | RoleActionFailure> {
  const parsed = idSchema.safeParse(userId);
  if (!parsed.success) return invalidInput();
  const outcome = await readCustomerUserRoleStateCore(await request(), parsed.data);
  if (!outcome.ok) return failed(outcome);
  const s = outcome.state;
  return { ok: true, state: { orgId: s.orgId, role: s.role, isActive: s.isActive, version: s.version, primaryOwner: s.primaryOwner, lastActiveOwner: s.lastActiveOwner } };
}

/** Change one customer user's role (reason and a fresh TOTP code; the company and version the dialog confirmed against). */
export async function changeCustomerUserRoleAction(input: unknown): Promise<{ ok: true; role: "owner" | "admin" | "staff"; sessionsEnded: number } | RoleActionFailure> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await changeCustomerUserRoleCore(await request(), { ...parsed.data, totpCode: parsed.data.totpCode.replace(/\s/g, "") });
  if (!outcome.ok) return failed(outcome);
  revalidatePath(`/platform/users/${outcome.userId}`);
  revalidatePath("/platform/users");
  revalidatePath(`/platform/companies/${outcome.orgId}`);
  return { ok: true, role: outcome.role, sessionsEnded: outcome.sessionsEnded };
}

/** A company's primary-owner transfer options, as they are now. */
export async function readPrimaryOwnerTransferOptionsAction(orgId: unknown): Promise<{ ok: true; options: TransferOptionsView } | RoleActionFailure> {
  const parsed = idSchema.safeParse(orgId);
  if (!parsed.success) return invalidInput();
  const outcome = await readPrimaryOwnerTransferOptionsCore(await request(), parsed.data);
  if (!outcome.ok) return failed(outcome);
  const o = outcome.options;
  return { ok: true, options: { designation: o.designation, primaryOwner: o.primaryOwner ? candidateView(o.primaryOwner) : null, candidates: o.candidates.map(candidateView), truncated: o.truncated } };
}

/** Transfer a company's primary ownership (reason and a fresh TOTP code; both accounts' versions the dialog showed). */
export async function transferPrimaryOwnerAction(input: unknown): Promise<{ ok: true; sessionsEnded: number } | RoleActionFailure> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await transferPrimaryOwnerCore(await request(), { ...parsed.data, totpCode: parsed.data.totpCode.replace(/\s/g, "") });
  if (!outcome.ok) return failed(outcome);
  revalidatePath(`/platform/companies/${outcome.orgId}`);
  revalidatePath(`/platform/users/${outcome.fromUserId}`);
  revalidatePath(`/platform/users/${outcome.toUserId}`);
  revalidatePath("/platform/users");
  return { ok: true, sessionsEnded: outcome.sessionsEnded };
}
