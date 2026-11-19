"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE, platformSessionCookieOptions } from "@/lib/platform/config";
import { formatPlatformDateTime } from "@/lib/platform/display";
import { PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from "@/lib/platform/errors";
import {
  createCompanyInvitation,
  previewCompanyInvitation,
  readCompanyInvitation,
  reissueCompanyInvitation,
  revokeCompanyInvitation,
  type InvitationFailure,
} from "@/lib/platform/invitation-actions";

// ---------------------------------------------------------------------------------------------
// Company invitation server actions (PO-02D2). Thin wrappers: every rule — both flags, same-origin,
// live platform session, platform.companies.invite, the step-up, the transaction and its audit — is
// re-checked by the cores in src/lib/platform/invitation-actions.ts on every call, never trusted from
// what the UI rendered. An unusable platform session clears the cookie and returns to sign-in.
//
// The one-time link is returned ONLY by createInvitationAction / reissueInvitationAction, once, in the
// action's response; nothing here logs, stores or caches it, and no action can return it again.
// No action revalidates a path: a revalidation re-renders the page inside the action's response, which would
// unmount a re-issued or revoked row — and with it the dialog still showing the link or the confirmation. The
// dialogs refresh the page themselves when the operator closes them (router.refresh(); every console page is
// dynamic, so nothing else holds a cached copy).
// ---------------------------------------------------------------------------------------------

export type InvitationActionFailure = {
  ok: false;
  code: PlatformErrorCode;
  message: string;
  pendingReference?: string;
  nameMatches?: { organizations: number; invitations: number };
};
export type InvitationTrialView = { packageName: string; versionNumber: number; trialDays: number; includedSeats: number; storageGb: number; price: string };
export type InvitationPreviewView = {
  ok: true;
  trial: InvitationTrialView | null;
  pendingReference: string | null;
  expiredReference: string | null;
  emailInUse: boolean;
  nameMatches: { organizations: number; invitations: number };
  rateLimited: boolean;
};
export type InvitationLinkView = { ok: true; reference: string; link: string; expires: string; replacedReference: string | null };
export type InvitationCurrentView = { ok: true; state: "pending" | "expired" | "revoked" | "accepted"; reference: string; companyName: string; ownerEmail: string; expires: string };

const CLEARED = { ...platformSessionCookieOptions(new Date(0)), maxAge: 0 };

async function request() {
  const store = await cookies();
  return { headers: await headers(), token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };
}

async function failed(outcome: InvitationFailure): Promise<InvitationActionFailure> {
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
    ...(outcome.nameMatches ? { nameMatches: outcome.nameMatches } : {}),
  };
}

async function invalidInput(): Promise<InvitationActionFailure> {
  const locale = await getLocale();
  return { ok: false, code: "VALIDATION_FAILED", message: PLATFORM_ERROR_MESSAGES.VALIDATION_FAILED[locale] };
}

const fields = {
  companyName: z.string().max(400),
  industry: z.string().max(200),
  companyEmail: z.string().max(400),
  country: z.string().max(120),
  currency: z.string().max(8),
  ownerName: z.string().max(400),
  ownerEmail: z.string().max(400),
};
const previewSchema = z.object(fields).strict();
const createSchema = z.object({ ...fields, confirmDuplicateName: z.boolean(), password: z.string().max(1024), totpCode: z.string().max(16) }).strict();
const idSchema = z.string().max(40);
const revokeSchema = z.object({ invitationId: idSchema, reason: z.string().max(2000), totpCode: z.string().max(16) }).strict();
const reissueSchema = z.object({ invitationId: idSchema, password: z.string().max(1024), totpCode: z.string().max(16) }).strict();
const code = (value: string) => value.replace(/\s/g, "");

/** What a create would meet — offered Trial, slot holder, e-mail in use, name matches, hourly limit. Read-only. */
export async function previewInvitationAction(input: unknown): Promise<InvitationPreviewView | InvitationActionFailure> {
  const parsed = previewSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await previewCompanyInvitation(await request(), parsed.data);
  if (!outcome.ok) return failed(outcome);
  const t = outcome.trial;
  return {
    ok: true,
    trial: t ? { packageName: t.packageName, versionNumber: t.versionNumber, trialDays: t.trialDays, includedSeats: t.includedSeats, storageGb: t.storageGb, price: `${t.currency} ${t.monthlyPrice}` } : null,
    pendingReference: outcome.pendingReference,
    expiredReference: outcome.expiredReference,
    emailInUse: outcome.emailInUse,
    nameMatches: outcome.nameMatches,
    rateLimited: outcome.rateLimited,
  };
}

/** Create one invitation (password + a fresh TOTP code); the response carries its link — once. */
export async function createInvitationAction(input: unknown): Promise<InvitationLinkView | InvitationActionFailure> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await createCompanyInvitation(await request(), { ...parsed.data, totpCode: code(parsed.data.totpCode) });
  if (!outcome.ok) return failed(outcome);
  const locale = await getLocale();
  return { ok: true, reference: outcome.reference, link: outcome.link, expires: formatPlatformDateTime(outcome.expiresAt, locale), replacedReference: outcome.replacedReference };
}

/** Revoke one pending or expired invitation (a fresh TOTP code and a reason). */
export async function revokeInvitationAction(input: unknown): Promise<{ ok: true; reference: string } | InvitationActionFailure> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await revokeCompanyInvitation(await request(), { ...parsed.data, totpCode: code(parsed.data.totpCode) });
  if (!outcome.ok) return failed(outcome);
  return { ok: true, reference: outcome.reference };
}

/** Re-issue one pending or expired invitation (password + a fresh TOTP code); returns only the NEW link, once. */
export async function reissueInvitationAction(input: unknown): Promise<(InvitationLinkView & { previousReference: string }) | InvitationActionFailure> {
  const parsed = reissueSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const outcome = await reissueCompanyInvitation(await request(), { ...parsed.data, totpCode: code(parsed.data.totpCode) });
  if (!outcome.ok) return failed(outcome);
  const locale = await getLocale();
  return { ok: true, reference: outcome.reference, previousReference: outcome.previousReference, link: outcome.link, expires: formatPlatformDateTime(outcome.expiresAt, locale), replacedReference: outcome.previousReference };
}

/** One invitation's state as it is now — a dialog acts on this, not on what the page showed. */
export async function readInvitationAction(invitationId: unknown): Promise<InvitationCurrentView | InvitationActionFailure> {
  const parsed = idSchema.safeParse(invitationId);
  if (!parsed.success) return invalidInput();
  const outcome = await readCompanyInvitation(await request(), parsed.data);
  if (!outcome.ok) return failed(outcome);
  const locale = await getLocale();
  return { ok: true, state: outcome.state, reference: outcome.reference, companyName: outcome.companyName, ownerEmail: outcome.ownerEmail, expires: formatPlatformDateTime(outcome.expiresAt, locale) };
}
