import "server-only";
import { headers } from "next/headers";

// ---------------------------------------------------------------------------
// Stage 11 — derive IP + browser/OS/device from the incoming request headers.
// A tiny dependency-free UA parser (covers the mainstream cases the Security
// Center displays; not meant to be exhaustive fingerprinting).
// ---------------------------------------------------------------------------

export type RequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
};

export function parseUserAgent(ua: string | null): { browser: string | null; os: string | null; device: string | null } {
  if (!ua) return { browser: null, os: null, device: null };

  let browser: string | null = null;
  if (/edg/i.test(ua)) browser = "Edge";
  else if (/opr|opera/i.test(ua)) browser = "Opera";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";

  let os: string | null = null;
  if (/windows nt/i.test(ua)) os = "Windows";
  else if (/mac os x|macintosh/i.test(ua)) os = "macOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/linux/i.test(ua)) os = "Linux";

  const device = /mobile|iphone|android/i.test(ua) ? "Mobile" : /ipad|tablet/i.test(ua) ? "Tablet" : "Desktop";
  return { browser, os, device };
}

export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers();
  // Behind a reverse proxy, the real client IP is the first hop in X-Forwarded-For.
  const forwarded = h.get("x-forwarded-for");
  const ipAddress = (forwarded ? forwarded.split(",")[0].trim() : h.get("x-real-ip")) || null;
  const userAgent = h.get("user-agent");
  const parsed = parseUserAgent(userAgent);
  return { ipAddress, userAgent, ...parsed };
}
