import "server-only";
import { isIP } from "node:net";
import { PlatformError } from "./errors";

// ---------------------------------------------------------------------------------------------
// Trusted client-IP resolution for platform throttling and audit (PO-01B).
//
// Next.js only fills `x-forwarded-for` when the header is ABSENT (base-server: `??=`) — it never
// appends the socket address — so without a reverse proxy the header is entirely client-controlled.
// Trust therefore comes only from explicitly configured infrastructure:
//
//   PLATFORM_TRUSTED_PROXY_HOPS = N  — the number of trusted reverse proxies in front of Next.js
//                                      that each APPEND their peer's address to X-Forwarded-For
//                                      (nginx `proxy_add_x_forwarded_for` = 1; CDN + nginx = 2).
//   The client is the N-th entry counted from the right; everything to its left was supplied by
//   the client and is ignored.
//   N = 0 / unset                    — no trusted proxy: the IP is UNKNOWN (null). Per-IP limits are
//                                      skipped, per-account limits still apply, and nothing the
//                                      client sends can choose its own throttle bucket.
// X-Real-IP and other single-value headers are never trusted (they are client-settable unless the
// proxy overwrites them, which this code cannot verify).
// ---------------------------------------------------------------------------------------------

export type HeaderSource = { get(name: string): string | null };

export function trustedProxyHops(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env.PLATFORM_TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw === "") return 0;
  if (!/^[0-9]$/.test(raw)) throw new PlatformError("CONFIG_ERROR", "PLATFORM_TRUSTED_PROXY_HOPS must be a single digit (0-9)");
  return Number(raw);
}

/** Strip brackets / port / IPv4-mapped prefix, lower-case IPv6; null when the value is not an IP. */
export function normalizeIp(value: string): string | null {
  let v = value.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracketed) v = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(":"));
  v = v.toLowerCase();
  if (v.startsWith("::ffff:") && isIP(v.slice(7)) === 4) v = v.slice(7);
  return isIP(v) ? v : null;
}

export function clientIpFromHeaders(headers: HeaderSource, hops: number = trustedProxyHops()): string | null {
  if (hops <= 0) return null;
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const entries = forwarded.split(",").map((e) => e.trim()).filter(Boolean);
  const index = entries.length - hops;
  if (index < 0) return null;
  return normalizeIp(entries[index]);
}
