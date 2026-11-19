"use server";

import { z } from "zod";
import { acceptInvitationLink, checkInvitationLink } from "@/lib/onboarding/invitation-acceptance";
import type { AcceptOutcome, LinkCheck } from "@/lib/onboarding/acceptance-types";

// PO-02D3 — the two public server actions of /register/accept. Same-origin POSTs only (Next.js checks the Origin, and
// the platform core checks it again against the canonical CUSTOMER_PUBLIC_ORIGIN). Strict shapes: an unexpected field
// or type is refused as an invalid link before anything runs. The token arrives only in the request BODY — never in
// a URL, a cookie or a header — and nothing here logs, stores or returns it. No revalidation, no redirect: the page
// shows the result and links to the existing /login (no session is ever issued here).

const CHECK = z.object({ token: z.string().max(200) }).strict();
const ACCEPT = z
  .object({ token: z.string().max(200), ownerName: z.string().max(1000), password: z.string().max(1000), confirm: z.string().max(1000) })
  .strict();

export async function checkInvitationLinkAction(input: unknown): Promise<LinkCheck> {
  const parsed = CHECK.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return checkInvitationLink(parsed.data.token);
}

export async function acceptInvitationAction(input: unknown): Promise<AcceptOutcome> {
  const parsed = ACCEPT.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return acceptInvitationLink(parsed.data);
}
