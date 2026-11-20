import "server-only";
import { headers } from "next/headers";
import { usersTable } from "@/db";
import { logActivity } from "@/lib/activity";
import { hashPassword } from "@/lib/auth";
import { recordSecurityEvent } from "@/lib/security/audit";
import { DEFAULT_POLICY, validatePassword } from "@/lib/security/password-policy";
import type { Session } from "@/lib/session";
import type { JoinAcceptOutcome, JoinLinkCheck, JoinRefusalReason } from "./user-acceptance-types";
import {
  acceptUserInvitation,
  beginUserAcceptance,
  isUserInvitationAcceptanceAvailable,
  normalizeAcceptanceInviteeName,
  previewUserInvitationForAcceptance,
  UserAcceptanceRefusal,
} from "@/lib/platform/user-invitation-acceptance";

// ---------------------------------------------------------------------------------------------
// PO-03D (sub-batch A) — the customer side of USER-invitation acceptance: the ONE customer module that reaches the
// platform's user-acceptance core, as src/lib/onboarding/invitation-acceptance.ts is for company invitations. It owns
// what belongs to the customer: the /register password policy, the password hash (computed here, BEFORE the
// transaction, and never handed to platform code), the user insert, and the customer security and activity evidence —
// the last three run INSIDE the acceptance transaction through the core's callbacks, so a failed acceptance leaves
// neither a user nor a success record.
//
// Every refusal is one of the public reasons; the visitor never learns whether an e-mail address already has an account
// (that refusal is the neutral "unavailable"), no session is issued (the page links to /login), and nothing here logs,
// stores or returns the token.
// ---------------------------------------------------------------------------------------------

export type { JoinAcceptOutcome, JoinLinkCheck } from "./user-acceptance-types";

/** The page may show the acceptance form at all (CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED, exactly "true"). */
export function userInvitationAcceptanceAvailable(): boolean {
  return isUserInvitationAcceptanceAvailable();
}

function reasonOf(err: unknown): JoinRefusalReason {
  if (err instanceof UserAcceptanceRefusal) return err.reason;
  console.error(`[user-invitation-acceptance] unexpected failure (${err instanceof Error ? err.name : "unknown"}); nothing was applied`);
  return "unavailable";
}

/** Validate a link (read-only): what the invitee is about to accept, or why it cannot be used. */
export async function checkJoinLink(token: unknown): Promise<JoinLinkCheck> {
  try {
    const ctx = await beginUserAcceptance(await headers());
    return { ok: true, invitation: await previewUserInvitationForAcceptance(ctx, token) };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}

const PASSWORD_MAX = 200;

/**
 * Accept: the link first (no password work for a dead link), then the invitee's fields — the confirmed name and the
 * /register password policy (DEFAULT_POLICY) — then the hash, then ONE transaction in the core.
 */
export async function acceptJoinLink(input: { token: unknown; name: unknown; password: unknown; confirm: unknown }): Promise<JoinAcceptOutcome> {
  try {
    const ctx = await beginUserAcceptance(await headers());
    await previewUserInvitationForAcceptance(ctx, input.token);
    const name = normalizeAcceptanceInviteeName(input.name);
    if (!name) return { ok: false, reason: "validation", field: "name", message: "Enter your name (up to 200 characters)." };
    if (typeof input.password !== "string" || input.password.length === 0) return { ok: false, reason: "validation", field: "password", message: "Enter a password." };
    if (input.password.length > PASSWORD_MAX) return { ok: false, reason: "validation", field: "password", message: "Use at most 200 characters." };
    const policyErrors = validatePassword(input.password, DEFAULT_POLICY);
    if (policyErrors.length > 0) return { ok: false, reason: "validation", field: "password", message: policyErrors[0] };
    if (input.confirm !== input.password) return { ok: false, reason: "validation", field: "confirm", message: "The passwords do not match." };

    const passwordHash = await hashPassword(input.password);
    const result = await acceptUserInvitation(
      ctx,
      { token: input.token, name },
      {
        createUser: async (tx, f) => {
          const [user] = await tx.insert(usersTable).values({ orgId: f.orgId, name: f.name, email: f.email, passwordHash, role: f.role }).returning({ id: usersTable.id });
          return { userId: user.id };
        },
        evidence: async (tx, f) => {
          await recordSecurityEvent({ email: f.email, orgId: f.orgId, userId: f.userId, type: "account.created", severity: "info", detail: `team member (user invitation, ${f.role})` }, tx);
          // The new member's own entry in the company's activity log (logActivity reads only these three fields).
          const member = { orgId: f.orgId, userId: f.userId, name: f.name } as Pick<Session, "orgId" | "userId" | "name"> as Session;
          await logActivity(member, { type: "team.member-joined", description: `Joined the team by invitation (${f.role})`, entityType: "user", entityId: f.userId }, tx);
        },
      },
    );
    return { ok: true, email: result.email, companyName: result.companyName, role: result.role };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}
