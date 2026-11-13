import "server-only";
import type { HeaderSource } from "./client-ip";
import { PlatformError } from "./errors";

/**
 * CSRF / origin guard for every state-changing platform action (PO-01B), in addition to Next.js's
 * own Server Actions origin check. A browser always sends `Origin` on these POSTs; it must name
 * this host, and a present `Sec-Fetch-Site` must say `same-origin`. A cross-site page cannot set
 * `Host` / `X-Forwarded-Host`, so it cannot make the two agree.
 */
export function assertSameOrigin(headers: HeaderSource): void {
  const origin = headers.get("origin");
  if (!origin) throw new PlatformError("FORBIDDEN", "missing Origin header");
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    throw new PlatformError("FORBIDDEN", "malformed Origin header");
  }
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (!host || originHost !== host) throw new PlatformError("FORBIDDEN", "cross-origin request");
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin") throw new PlatformError("FORBIDDEN", "cross-site request");
}
