import "server-only";
import { PlatformError } from "./errors";

/**
 * Feature flag for the whole Platform Owner console. Default OFF: only the exact string "true"
 * enables it, so a missing, empty or misspelled value fails closed. Every later flag (PO-02D2's
 * PLATFORM_INVITATIONS_ENABLED, below) requires it as well.
 */
export function isPlatformConsoleEnabled(): boolean {
  return process.env.PLATFORM_CONSOLE_ENABLED === "true";
}

export function assertPlatformConsoleEnabled(): void {
  if (!isPlatformConsoleEnabled()) throw new PlatformError("CONSOLE_DISABLED", "PLATFORM_CONSOLE_ENABLED is not \"true\"");
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
