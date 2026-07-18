import type { NextConfig } from "next";

// Baseline security headers on every response (security audit, Medium #3).
// CSP is intentionally strict but allows what this app actually uses: same-origin everything,
// inline styles (the per-org white-label <style> block + print CSS), and data: images (the
// ZATCA QR is a data: URL). 'unsafe-inline' for scripts is required by Next's inlined runtime;
// frame-ancestors 'none' blocks clickjacking, object-src 'none' blocks plugin vectors.
const isDev = process.env.NODE_ENV !== "production";

// React Fast Refresh uses eval() and an HMR websocket in dev only — never in production.
// Relaxing just those two directives in dev keeps the production CSP strict.
const csp = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
