// PO-03D — the shapes the public user-invitation acceptance page (/join/accept) exchanges with its server actions. Types
// only (no runtime code, no server import), so the client page can use them without pulling server modules into the
// bundle. The platform core (src/lib/platform/user-invitation-acceptance.ts) produces these values; nothing here carries
// a token.

export type JoinRefusalReason = "disabled" | "invalid" | "expired" | "used" | "throttled" | "unavailable" | "seats_full" | "company_unavailable";

export type JoinInvitationView = {
  reference: string;
  companyName: string;
  name: string;
  email: string;
  role: "admin" | "staff";
  expiresAt: string;
  expiresAtText: { en: string; ar: string };
  plan: { packageName: string; versionNumber: number; isTrial: boolean } | null;
  seats: { state: "enforced" | "shown"; seats: number; occupied: number } | { state: "none" };
};

export type JoinLinkCheck = { ok: true; invitation: JoinInvitationView } | { ok: false; reason: JoinRefusalReason };
export type JoinField = "name" | "password" | "confirm";
export type JoinAcceptOutcome =
  | { ok: true; email: string; companyName: string; role: "admin" | "staff" }
  | { ok: false; reason: JoinRefusalReason }
  | { ok: false; reason: "validation"; field: JoinField; message: string };
