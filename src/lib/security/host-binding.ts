// ---------------------------------------------------------------------------------------------
// PO-07 H-1 — hostname binding of the two surfaces (Platform Owner console / customer ERP).
//
// Edge-safe and dependency-free on purpose: src/proxy.ts (edge) and the server-side entry points
// (console guards and origin check, customer session and sign-in, invitation acceptance, uploads)
// all decide with this ONE function, so the proxy and the server can never disagree.
//
// Why it exists: nginx path rules and the proxy are not a boundary for Server Actions. Next.js
// forwards an action whose id the current page does not own to the page that does, as a new
// internal request that keeps the original headers; and the proxy matcher skips paths that end in
// a static-file suffix, which a dynamic page also matches. So every privileged entry point checks
// the addressed host itself.
//
// Configuration (both, or neither):
//   PLATFORM_CONSOLE_HOST — the console's exact host, lower case ("admin.example.com", or with a
//                           ":port" for local tests);
//   CUSTOMER_APP_HOST     — the customer ERP's exact host, same form, different from the console's.
// Neither set → unbound: the previous behaviour, unchanged (the live ERP today). Only one set, an
// invalid value, equal values or a malformed PLATFORM_TRUSTED_PROXY_HOPS → "invalid": BOTH surfaces
// refuse every request (fail closed), they never fall back to unbound.
//
// The addressed host follows the rule assertSameOrigin already uses: X-Forwarded-Host is read ONLY
// when PLATFORM_TRUSTED_PROXY_HOPS ≥ 1 (a reverse proxy that overwrites it is configured), and only
// as a single value — a list means a client-supplied value was passed along. Otherwise Host. A
// missing, empty, listed or malformed value is refused. Nothing is ever normalized into a match:
// the comparison is exact (lower-cased), ports included.
//
// The customer surface also accepts the loopback host of PDF_RENDER_ORIGIN (http, loopback only):
// the PDF renderer loads /print and its files from the app's own loopback origin, never via nginx.
// ---------------------------------------------------------------------------------------------

export type HostHeaders = { get(name: string): string | null };
export type HostSurface = "console" | "customer";
type Env = Readonly<Record<string, string | undefined>>;

export type HostBinding =
  | { status: "unbound" }
  | { status: "invalid"; reason: string }
  | { status: "bound"; consoleHost: string; customerHosts: readonly string[]; trustedProxyHops: number };

export type HostDecision =
  | { allowed: true; bound: boolean }
  | { allowed: false; reason: "config" | "host_missing" | "wrong_host" };

// A DNS name of at least two labels (or exactly "localhost", for local tests), lower case, optional
// port. Loopback IP addresses are not configurable surface hosts.
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const CONFIG_HOST = new RegExp(`^(?=[^:]{1,253}(?::|$))(?:${LABEL}(?:\\.${LABEL})+|localhost)(?::[1-9][0-9]{0,4})?$`);
// What a request may name: a host[:port] or a bracketed IPv6[:port].
const ADDRESSED_HOST = /^(?:[a-z0-9.-]{1,253}|\[[0-9a-f:.]{2,45}\])(?::[0-9]{1,5})?$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const IPV4_LITERAL = /^[0-9]+(?:\.[0-9]+){3}(?::[0-9]+)?$/;
const set = (v: string | undefined): v is string => v !== undefined && v !== "";
const configHost = (v: string) => CONFIG_HOST.test(v) && !IPV4_LITERAL.test(v);

/** The binding the environment configures. Never throws. */
export function hostBinding(env: Env = process.env): HostBinding {
  const consoleRaw = env.PLATFORM_CONSOLE_HOST;
  const customerRaw = env.CUSTOMER_APP_HOST;
  if (!set(consoleRaw) && !set(customerRaw)) return { status: "unbound" };
  if (!set(consoleRaw) || !set(customerRaw)) return { status: "invalid", reason: "PLATFORM_CONSOLE_HOST and CUSTOMER_APP_HOST must be set together" };
  if (!configHost(consoleRaw)) return { status: "invalid", reason: "PLATFORM_CONSOLE_HOST is not a lower-case host name" };
  if (!configHost(customerRaw)) return { status: "invalid", reason: "CUSTOMER_APP_HOST is not a lower-case host name" };
  if (consoleRaw === customerRaw) return { status: "invalid", reason: "PLATFORM_CONSOLE_HOST and CUSTOMER_APP_HOST must differ" };
  const hopsRaw = env.PLATFORM_TRUSTED_PROXY_HOPS;
  if (set(hopsRaw) && !/^[0-9]$/.test(hopsRaw)) return { status: "invalid", reason: "PLATFORM_TRUSTED_PROXY_HOPS must be a single digit (0-9)" };
  const customerHosts = [customerRaw];
  const render = env.PDF_RENDER_ORIGIN;
  if (set(render)) {
    let url: URL;
    try {
      url = new URL(render);
    } catch {
      return { status: "invalid", reason: "PDF_RENDER_ORIGIN is not a URL" };
    }
    if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) customerHosts.push(url.host);
  }
  return { status: "bound", consoleHost: consoleRaw, customerHosts, trustedProxyHops: set(hopsRaw) ? Number(hopsRaw) : 0 };
}

/** The host the request addressed, or null when it is missing, listed or malformed. */
export function addressedRequestHost(headers: HostHeaders, trustedProxyHops: number): string | null {
  const forwarded = trustedProxyHops > 0 ? headers.get("x-forwarded-host") : null;
  let value: string;
  if (forwarded !== null) {
    const values = forwarded.split(",").map((v) => v.trim()).filter(Boolean);
    if (values.length !== 1) return null;
    value = values[0];
  } else {
    value = (headers.get("host") ?? "").trim();
  }
  value = value.toLowerCase();
  return value && ADDRESSED_HOST.test(value) ? value : null;
}

/** May this request use the given surface? Fail closed on anything but an exact match. */
export function hostDecision(surface: HostSurface, headers: HostHeaders, env: Env = process.env): HostDecision {
  const binding = hostBinding(env);
  if (binding.status === "unbound") return { allowed: true, bound: false };
  if (binding.status === "invalid") return { allowed: false, reason: "config" };
  const host = addressedRequestHost(headers, binding.trustedProxyHops);
  if (host === null) return { allowed: false, reason: "host_missing" };
  const allowed = surface === "console" ? host === binding.consoleHost : binding.customerHosts.includes(host);
  return allowed ? { allowed: true, bound: true } : { allowed: false, reason: "wrong_host" };
}

/** Shorthand: true when the request may use the surface. */
export function hostAllowed(surface: HostSurface, headers: HostHeaders, env: Env = process.env): boolean {
  return hostDecision(surface, headers, env).allowed;
}
