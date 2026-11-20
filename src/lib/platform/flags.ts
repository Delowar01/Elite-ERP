import "server-only";
import { PlatformError } from "./errors";

/**
 * Feature flag for the whole Platform Owner console. Default OFF: only the exact string "true"
 * enables it, so a missing, empty or misspelled value fails closed. Every later console flag (PO-02D2's
 * PLATFORM_INVITATIONS_ENABLED and PO-03C's PLATFORM_USER_INVITATIONS_ENABLED, below) requires it as well; PO-02D3's
 * customer-facing acceptance flag (CUSTOMER_INVITE_ACCEPTANCE_ENABLED, next) is independent of it, and so is PO-03D's
 * CUSTOMER_SEAT_ENFORCEMENT_ENABLED (at the end).
 */
export function isPlatformConsoleEnabled(): boolean {
  return process.env.PLATFORM_CONSOLE_ENABLED === "true";
}

export function assertPlatformConsoleEnabled(): void {
  if (!isPlatformConsoleEnabled()) throw new PlatformError("CONSOLE_DISABLED", "PLATFORM_CONSOLE_ENABLED is not \"true\"");
}

/**
 * PO-02D3 — public invitation acceptance (/register/accept). Default OFF (A-1, provisional): only the exact
 * string "true" enables it. Independent of the console flags — acceptance is a customer-facing route — and it
 * changes nothing else: /register stays open, and no session, delivery or enforcement is switched on by it.
 */
export function isCustomerInviteAcceptanceEnabled(): boolean {
  return process.env.CUSTOMER_INVITE_ACCEPTANCE_ENABLED === "true";
}

export function assertCustomerInviteAcceptanceEnabled(): void {
  if (!isCustomerInviteAcceptanceEnabled()) throw new PlatformError("ACCEPTANCE_DISABLED", "CUSTOMER_INVITE_ACCEPTANCE_ENABLED is not \"true\"");
}

/**
 * PO-02D2 — company invitation administration (create, revoke, re-issue; copy-link only). Default OFF
 * (R-5, provisional): only the exact string "true" enables it, and only while the console itself is
 * enabled. It never enables invitation acceptance (PO-02D3) and changes no other flag.
 */
export function isPlatformInvitationsEnabled(): boolean {
  return isPlatformConsoleEnabled() && process.env.PLATFORM_INVITATIONS_ENABLED === "true";
}

export function assertPlatformInvitationsEnabled(): void {
  assertPlatformConsoleEnabled();
  if (process.env.PLATFORM_INVITATIONS_ENABLED !== "true") throw new PlatformError("INVITATIONS_DISABLED", "PLATFORM_INVITATIONS_ENABLED is not \"true\"");
}

/**
 * PO-03C — customer-user invitation administration (invite a NEW user into an EXISTING company: create, revoke,
 * re-issue; copy-link only). Default OFF (provisional, pending owner approval): only the exact string "true" enables
 * it, and only while the console itself is enabled. It needs the user_invitations table as well (a staged schema,
 * not installed by the platform SQL chain), and it never enables acceptance (PO-04) or seat enforcement.
 */
export function isPlatformUserInvitationsEnabled(): boolean {
  return isPlatformConsoleEnabled() && process.env.PLATFORM_USER_INVITATIONS_ENABLED === "true";
}

export function assertPlatformUserInvitationsEnabled(): void {
  assertPlatformConsoleEnabled();
  if (process.env.PLATFORM_USER_INVITATIONS_ENABLED !== "true") throw new PlatformError("USER_INVITATIONS_DISABLED", "PLATFORM_USER_INVITATIONS_ENABLED is not \"true\"");
}

/**
 * PO-03D — user-seat enforcement: the current subscription's seats_snapshot limits every path that adds a customer user
 * or reserves a seat (user-invitation create, re-issue and acceptance; the customer Team "add member"). Default OFF
 * (provisional — the specifications ask for the owner's consent before any active company's seats are capped): only the
 * exact string "true" enables it. Independent of the console flags. While it is off, seats are counted and shown and
 * never enforced, exactly as before PO-03D.
 */
export function isCustomerSeatEnforcementEnabled(): boolean {
  return process.env.CUSTOMER_SEAT_ENFORCEMENT_ENABLED === "true";
}
