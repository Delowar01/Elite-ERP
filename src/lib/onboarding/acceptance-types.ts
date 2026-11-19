// PO-02D3 — the shapes the public invitation-acceptance page exchanges with its server actions. Types only (no
// runtime code, no server import), so the client page can use them without pulling server modules into the bundle.
// The platform core (src/lib/platform/invitation-acceptance.ts) produces these values; nothing here carries a token.

export type PublicRefusalReason = "disabled" | "invalid" | "expired" | "used" | "throttled" | "unavailable";

export type InvitationPreviewView = {
  reference: string;
  companyName: string;
  ownerName: string;
  ownerEmail: string;
  countryName: string;
  currencyCode: string;
  expiresAt: string;
  expiresAtText: { en: string; ar: string };
  trial: { packageName: string; versionNumber: number; trialDays: number; seats: number; storageGb: number; modules: string[]; price: string; currency: string; cycle: "trial" };
};

export type LinkCheck = { ok: true; invitation: InvitationPreviewView } | { ok: false; reason: PublicRefusalReason };
export type AcceptField = "ownerName" | "password" | "confirm";
export type AcceptOutcome =
  | { ok: true; ownerEmail: string; startDateText: { en: string; ar: string }; endDateText: { en: string; ar: string } }
  | { ok: false; reason: PublicRefusalReason }
  | { ok: false; reason: "validation"; field: AcceptField; message: string };
