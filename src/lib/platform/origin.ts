import "server-only";
import { hostDecision } from "@/lib/security/host-binding";
import { trustedProxyHops, type HeaderSource } from "./client-ip";
import { PlatformError } from "./errors";

/**
 * PO-07 H-1 — the hostname binding (src/lib/security/host-binding.ts) at the server-side entry points.
 * Every state-changing console core calls assertConsoleHost right before assertSameOrigin; the public
 * customer-side acceptance calls assertCustomerHost right after it. Both are no-ops while unbound.
 */

/** PO-07 H-1: did the request address the configured console host? (The console's pages and route handlers.) */
export function isConsoleHost(headers: HeaderSource): boolean {
  return hostDecision("console", headers).allowed;
}

/** PO-07 H-1: refuse unless the request addressed the configured console host. */
export function assertConsoleHost(headers: HeaderSource): void {
  const decision = hostDecision("console", headers);
  if (!decision.allowed) throw new PlatformError(decision.reason === "config" ? "CONFIG_ERROR" : "FORBIDDEN", "not the console host");
}

/** PO-07 H-1: refuse unless the request addressed the configured customer host. */
export function assertCustomerHost(headers: HeaderSource): void {
  const decision = hostDecision("customer", headers);
  if (!decision.allowed) throw new PlatformError(decision.reason === "config" ? "CONFIG_ERROR" : "FORBIDDEN", "not the customer host");
}

/**
 * CSRF / origin guard for every state-changing platform action (PO-01B), in addition to Next.js's
 * own Server Actions origin check. A browser always sends `Origin` on these POSTs; it must name
 * the host the browser addressed, and a present `Sec-Fetch-Site` must say `same-origin`. A
 * cross-site page cannot set `Host` / `X-Forwarded-Host`, so it cannot make the two agree.
 *
 * PO-01B.1 — no trust in arbitrary forwarded headers. The addressed host is `Host`, unless a trusted
 * reverse proxy is configured (PLATFORM_TRUSTED_PROXY_HOPS ≥ 1, the same setting that governs the
 * client IP): only then is `X-Forwarded-Host` used, and only as the single value that proxy sets —
 * a comma-separated list means a client-supplied value was passed along, and is refused. A
 * malformed hop setting fails closed (CONFIG_ERROR).
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
  const host = addressedHost(headers);
  if (!host || originHost !== host) throw new PlatformError("FORBIDDEN", "cross-origin request");
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin") throw new PlatformError("FORBIDDEN", "cross-site request");
}

/** The host the browser addressed, or null when it cannot be determined unambiguously. */
export function addressedHost(headers: HeaderSource): string | null {
  const forwarded = trustedProxyHops() > 0 ? headers.get("x-forwarded-host") : null;
  if (forwarded !== null) {
    const values = forwarded.split(",").map((v) => v.trim()).filter(Boolean);
    return values.length === 1 ? values[0].toLowerCase() : null;
  }
  const host = (headers.get("host") ?? "").trim().toLowerCase();
  return host || null;
}
