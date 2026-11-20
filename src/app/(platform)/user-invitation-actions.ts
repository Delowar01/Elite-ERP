"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE, platformSessionCookieOptions } from "@/lib/platform/config";
import { formatPlatformDateTime } from "@/lib/platform/display";
import { PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from "@/lib/platform/errors";
import { createUserInvitation, previewUserInvitation, readUserInvitation, reissueUserInvitation, revokeUserInvitation, type UserInvitationFailure } from "@/lib/platform/user-invitation-actions";

// ---------------------------------------------------------------------------------------------
// Customer-user invitation server actions (PO-03C, sub-batch C). Thin wrappers: every rule — both flags, same-origin,
// live platform session, platform.users.invite, the staged table, the step-up, the transaction and its audit — is
// re-checked by the cores in src/lib/platform/user-invitation-actions.ts on every call, never trusted from what the UI
// rendered. An unusable platform session clears the cookie and returns to sign-in.
//
// The one-time link is returned ONLY by createUserInvitationAction / reissueUserInvitationAction, once, in the action's
// response; nothing here logs, stores or caches it, and no action can return it again. No action revalidates a path
// (as PO-02D2): the dialogs refresh the page themselves when the operator closes them.
// ---------------------------------------------------------------------------------------------

export type UserInvitationActionFailure = { ok: false; code: PlatformErrorCode; message: string; pendingReference?: string; companyInvitationReference?: string };
export type UserInvitationSeatsView = { occupied: number; seats: number | null; overBy: number };
export type UserInvitationPreviewView = {
  ok: true;
  company: { name: string; reference: string; access: "active" | "suspended" };
  pendingReference: string | null;
  expiredReference: string | null;
  emailInUse: boolean;
  companyInvitationReference: string | null;
  rateLimited: boolean;
  /** The company's seats now and after this invitation (display only — nothing is refused because of them). */
  seats: (UserInvitationSeatsView & { after: UserInvitationSeatsView }) | null;
};
export type UserInvitationLinkView = { ok: true; reference: string; link: string; expires: string; replacedReference: string | null; acceptanceOpen: boolean };
export type UserInvitationCurrentView = { ok: true; state: "pending" | "expired" | "revoked" | "accepted"; reference: string; companyName: string; name: string; email: string; role: "admin" | "staff"; expires: string };

const CLEARED = { ...platformSessionCookieOptions(new Date(0)), maxAge: 0 };

async function request() {
  const store = await cookies();
  return { headers: await headers(), token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };
}

async function failed(outcome: UserInvitationFailure): Promise<UserInvitationActionFailure> {
  if (outcome.code === "UNAUTHORIZED" || outcome.code === "SESSION_EXPIRED") {
    (await cookies()).set(PLATFORM_SESSION_COOKIE, "", CLEARED);
    redirect("/platform/login?ended=1");
  }
  if (outcome.code === "CONSOLE_DISABLED") redirect("/platform/login");
  const locale = await getLocale();
  return {
    ok: false,
    code: outcome.code,
    message: PLATFORM_ERROR_MESSAGES[outcome.code][locale],
    ...(outcome.pendingReference ? { pendingReference: outcome.pendingReference } : {}),
    ...(outcome.companyInvitationReference ? { companyInvitationReference: outcome.companyInvitationReference } : {}),
  };
}

async function invalidInput(): Promise<UserInvitationActionFailure> {
  const locale = await getLocale();
  return { ok: false, code: "VALIDATION_FAILED", message: PLATFORM_ERROR_MESSAGES.VALIDATION_FAILED[locale] };
}

const fields = { orgId: z.string().max(12), name: z.string().max(400), email: z.string().max(400), role: z.enum(["admin", "staff"]) };
const previewSchema = z.object(fields).strict();
const createSchema = z.object({ ...fields, password: z.string().max(1024), totpCode: z.string().max(16) }).strict();
const idSchema = z.string().max(40);
const revokeSchema = z.object({ invitationId: idSchema, reason: z.string().max(2000), totpCode: z.string().max(16) }).strict();
const reissueSchema = z.object({ invitationId: idSchema, password: z.string().max(1024), totpCode: z.string().max(16) }).strict();
const code = (value: string) => value.replace(/\s/g, "");

/** What a create would meet — the company and its access, slot holder, e-mail in use, company invitation, hourly limit, seats. Read-only. */
export async function previewUserInvitationAction(input: unknown): Promise<UserInvitationPreviewView | UserInvitationActionFailure> {
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await previewUserInvitation(await request(), parsed.data);
  if (!outcome.ok) return failed(outcome);
  const s = outcome.seats;
  const seatsOf = (occupied: number) => {
    const seats = s && s.allowance.state === "assigned" ? s.allowance.seats : null;
    return { occupied, seats, overBy: seats === null ? 0 : Math.max(0, occupied - seats) };
  };
  return {
    ok: true,
    company: { name: outcome.company.name, reference: outcome.company.reference, access: outcome.company.access },
    pendingReference: outcome.pendingReference,
    expiredReference: outcome.expiredReference,
    emailInUse: outcome.emailInUse,
    companyInvitationReference: outcome.companyInvitationReference,
    rateLimited: outcome.rateLimited,
    seats: s ? { ...seatsOf(s.occupied), after: seatsOf(s.occupied + 1) } : null,
  };
}

/** Create one user invitation (password + a fresh TOTP code); the response carries its link — once. */
export async function createUserInvitationAction(input: unknown): Promise<UserInvitationLinkView | UserInvitationActionFailure> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await createUserInvitation(await request(), { ...parsed.data, totpCode: code(parsed.data.totpCode) });
  if (!outcome.ok) return failed(outcome);
  const locale = await getLocale();
  return { ok: true, reference: outcome.reference, link: outcome.link, expires: formatPlatformDateTime(outcome.expiresAt, locale), replacedReference: outcome.replacedReference, acceptanceOpen: outcome.acceptanceOpen };
}

/** Revoke one pending or expired user invitation (a fresh TOTP code and a reason). */
export async function revokeUserInvitationAction(input: unknown): Promise<{ ok: true; reference: string } | UserInvitationActionFailure> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await revokeUserInvitation(await request(), { ...parsed.data, totpCode: code(parsed.data.totpCode) });
  if (!outcome.ok) return failed(outcome);
  return { ok: true, reference: outcome.reference };
}

/** Re-issue one pending, expired or revoked user invitation (password + a fresh TOTP code); returns only the NEW link, once. */
export async function reissueUserInvitationAction(input: unknown): Promise<(UserInvitationLinkView & { previousReference: string }) | UserInvitationActionFailure> {
  const parsed = reissueSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await reissueUserInvitation(await request(), { ...parsed.data, totpCode: code(parsed.data.totpCode) });
  if (!outcome.ok) return failed(outcome);
  const locale = await getLocale();
  return { ok: true, reference: outcome.reference, previousReference: outcome.previousReference, link: outcome.link, expires: formatPlatformDateTime(outcome.expiresAt, locale), replacedReference: outcome.previousReference, acceptanceOpen: outcome.acceptanceOpen };
}

/** One user invitation's state as it is now — a dialog acts on this, not on what the page showed. */
export async function readUserInvitationAction(invitationId: unknown): Promise<UserInvitationCurrentView | UserInvitationActionFailure> {
  const parsed = idSchema.safeParse(invitationId);
  if (!parsed.success) return invalidInput();
  const outcome = await readUserInvitation(await request(), parsed.data);
  if (!outcome.ok) return failed(outcome);
  const locale = await getLocale();
  return { ok: true, state: outcome.state, reference: outcome.reference, companyName: outcome.companyName, name: outcome.name, email: outcome.email, role: outcome.role, expires: formatPlatformDateTime(outcome.expiresAt, locale) };
}
