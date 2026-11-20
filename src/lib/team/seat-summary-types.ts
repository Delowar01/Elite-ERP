// PO-03A — the shape of the Team page's read-only "User seats" summary (types only: no runtime code, client-safe).
// Produced on the server by src/lib/team/ownership-gate.ts for the session's own company; rendered by
// src/app/(app)/settings/team/seat-summary.tsx. Nothing here is enforced.

export type TeamSeatAllowance =
  /** The current subscription's seats snapshot. */
  | { state: "assigned"; seats: number; packageName: string; versionNumber: number; isTrial: boolean; endDate: string }
  /** No current subscription (a company created before invitation onboarding): nothing is inferred. */
  | { state: "none" };

export type TeamSeatSummary =
  | {
      available: true;
      users: { total: number; active: number; disabled: number };
      occupied: number;
      allowance: TeamSeatAllowance;
      remaining: number | null;
      overBy: number;
    }
  /** The seat information could not be read: shown as unavailable, never as "no subscription". */
  | { available: false };

export type TeamPrimaryOwner =
  | { state: "designated"; userId: number }
  /** No mapping (every company created before invitation onboarding — decision O-2: never guessed from role = owner). */
  | { state: "not_designated" }
  | { state: "unavailable" };

export type TeamOwnershipSummary = { seats: TeamSeatSummary; primaryOwner: TeamPrimaryOwner };
