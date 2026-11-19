import "server-only";
import { PlatformError } from "./errors";

/**
 * Feature flag for the whole Platform Owner console. Default OFF: only the exact string "true"
 * enables it, so a missing, empty or misspelled value fails closed. Every later console flag (PO-02D2's
 * PLATFORM_INVITATIONS_ENABLED, below) requires it as well; PO-02D3's customer-facing acceptance flag
 * (CUSTOMER_INVITE_ACCEPTANCE_ENABLED, next) is independent of it.
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
