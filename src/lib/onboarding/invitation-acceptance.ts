import "server-only";
import { headers } from "next/headers";
import { hashPassword } from "@/lib/auth";
import { bootstrapOrganization } from "@/lib/org-bootstrap";
import { recordAudit, recordSecurityEvent } from "@/lib/security/audit";
import { DEFAULT_POLICY, validatePassword } from "@/lib/security/password-policy";
import type { AcceptOutcome, LinkCheck } from "./acceptance-types";
import {
  AcceptanceRefusal,
  acceptInvitation,
  beginAcceptance,
  isInvitationAcceptanceAvailable,
  normalizeAcceptanceOwnerName,
  previewInvitationForAcceptance,
  type InvitationPreview,
  type PublicRefusalReason,
} from "@/lib/platform/invitation-acceptance";

// ---------------------------------------------------------------------------------------------
// PO-02D3 — the customer side of invitation acceptance: the ONE customer module that reaches the platform's
// acceptance core (boundary rule 45), as src/lib/security/tenant-access-gate.ts is the one that reaches the
// access rule. It owns what belongs to the customer: the /register password policy, the password hash (computed
// here, BEFORE the transaction, and never handed to platform code), the shared organization bootstrap, and the
// customer audit / security evidence — the last two run INSIDE the acceptance transaction through the core's
// callbacks, so a failed acceptance leaves neither a company nor a success record.
//
// Every refusal is one of the public reasons below; the visitor never learns whether an e-mail address already has
// an account (that refusal is the neutral "unavailable"), and nothing here logs, stores or returns the token.
// ---------------------------------------------------------------------------------------------

export type { InvitationPreview, PublicRefusalReason };
export type { AcceptField, AcceptOutcome, LinkCheck } from "./acceptance-types";

/** The page may show the acceptance form at all (CUSTOMER_INVITE_ACCEPTANCE_ENABLED, exactly "true"). */
export function invitationAcceptanceAvailable(): boolean {
  return isInvitationAcceptanceAvailable();
}

function reasonOf(err: unknown): PublicRefusalReason {
  if (err instanceof AcceptanceRefusal) return err.reason;
  console.error(`[invitation-acceptance] unexpected failure (${err instanceof Error ? err.name : "unknown"}); nothing was applied`);
  return "unavailable";
}

/** Validate a link (read-only): what the invitee is about to accept, or why it cannot be used. */
export async function checkInvitationLink(token: unknown): Promise<LinkCheck> {
  try {
    const ctx = await beginAcceptance(await headers());
    return { ok: true, invitation: await previewInvitationForAcceptance(ctx, token) };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}

const PASSWORD_MAX = 200;

/**
 * Accept: the link first (no password work for a dead link), then the invitee's fields — the confirmed name and the
 * /register password policy (DEFAULT_POLICY, decision A-3) — then the hash, then ONE transaction in the core.
 */
export async function acceptInvitationLink(
  input: { token: unknown; ownerName: unknown; password: unknown; confirm: unknown },
): Promise<AcceptOutcome> {
  try {
    const ctx = await beginAcceptance(await headers());
    await previewInvitationForAcceptance(ctx, input.token);
    const ownerName = normalizeAcceptanceOwnerName(input.ownerName);
    if (!ownerName) return { ok: false, reason: "validation", field: "ownerName", message: "Enter your name (up to 200 characters)." };
    if (typeof input.password !== "string" || input.password.length === 0) return { ok: false, reason: "validation", field: "password", message: "Enter a password." };
    if (input.password.length > PASSWORD_MAX) return { ok: false, reason: "validation", field: "password", message: "Use at most 200 characters." };
    const policyErrors = validatePassword(input.password, DEFAULT_POLICY);
    if (policyErrors.length > 0) return { ok: false, reason: "validation", field: "password", message: policyErrors[0] };
    if (input.confirm !== input.password) return { ok: false, reason: "validation", field: "confirm", message: "The passwords do not match." };

    const passwordHash = await hashPassword(input.password);
    const result = await acceptInvitation(
      ctx,
      { token: input.token, ownerName },
      {
        bootstrap: (tx, f) =>
          bootstrapOrganization(tx, {
            orgName: f.companyName,
            country: f.countryName,
            currency: f.currencyCode,
            ownerName: f.ownerName,
            ownerEmail: f.ownerEmail,
            passwordHash,
            industry: f.industry,
            companyEmail: f.companyEmail,
          }),
        evidence: async (tx, f) => {
          await recordAudit(
            { orgId: f.orgId, userId: f.userId, userName: f.ownerName },
            {
              action: "org.registered",
              entityType: "org",
              entityId: f.orgId,
              newValue: { orgName: f.companyName, ownerEmail: f.ownerEmail, country: f.countryName, currency: f.currencyCode, source: "invitation", invitation: f.reference },
            },
            tx,
          );
          await recordSecurityEvent({ email: f.ownerEmail, orgId: f.orgId, userId: f.userId, type: "account.created", severity: "info", detail: "organization owner (invitation)" }, tx);
        },
      },
    );
    return { ok: true, ownerEmail: result.ownerEmail, startDateText: result.startDateText, endDateText: result.endDateText };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}
