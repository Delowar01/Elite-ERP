import "server-only";
import { PlatformError } from "./errors";

/**
 * Feature flag for the whole Platform Owner console. Default OFF: only the exact string "true"
 * enables it, so a missing, empty or misspelled value fails closed.
 */
export function isPlatformConsoleEnabled(): boolean {
  return process.env.PLATFORM_CONSOLE_ENABLED === "true";
}

export function assertPlatformConsoleEnabled(): void {
  if (!isPlatformConsoleEnabled()) throw new PlatformError("CONSOLE_DISABLED", "PLATFORM_CONSOLE_ENABLED is not \"true\"");
}
