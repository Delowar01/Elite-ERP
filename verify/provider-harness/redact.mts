/**
 * Secret redaction for the real-provider harness.
 *
 * Every line the harness prints and every byte it writes to a report passes through here. A run of
 * this harness holds two Blob read-write tokens, a database password and the auth secret, and its
 * output is meant to be pasted into a PR or an issue — so a single unredacted stack trace is a
 * credential disclosure. The default is to redact, and the caller has to do nothing to get it.
 */

/** Environment variables whose VALUES must never appear in output. */
const SECRET_ENV = [
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN",
  "DATABASE_URL",
  "AUTH_SECRET",
  "FIELD_ENCRYPTION_KEYS",
  "VERCEL_TOKEN",
  "VERCEL_OIDC_TOKEN",
] as const;

/** Patterns that look like credentials wherever they appear, even from a value we were not given. */
const PATTERNS: [RegExp, string][] = [
  [/vercel_blob_rw_[A-Za-z0-9]+_[A-Za-z0-9]+/g, "vercel_blob_rw_***REDACTED***"],
  [/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://***REDACTED***"],
  [/\b(authorization|cookie|set-cookie)\b\s*[:=]\s*[^\s,;"']+/gi, "$1: ***REDACTED***"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer ***REDACTED***"],
  [/\b(session|token|secret|password|pwd)=[^\s&;"']+/gi, "$1=***REDACTED***"],
];

function currentSecretValues(): string[] {
  const out: string[] = [];
  for (const name of SECRET_ENV) {
    const v = process.env[name];
    // Short values are skipped: redacting a 3-character string would blank out unrelated text.
    if (v && v.length >= 8) out.push(v);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Redact secrets from any value — string, Error, or object — returning a safe string. */
export function redact(input: unknown): string {
  let text: string;
  if (typeof input === "string") text = input;
  else if (input instanceof Error) text = `${input.name}: ${input.message}\n${input.stack ?? ""}`;
  else {
    try { text = JSON.stringify(input); } catch { text = String(input); }
  }
  // Literal values first: an exact token match is the highest-confidence redaction available.
  for (const v of currentSecretValues()) text = text.replace(new RegExp(escapeRe(v), "g"), "***REDACTED***");
  for (const [re, to] of PATTERNS) text = text.replace(re, to);
  return text;
}

/** Deep-redact a structure destined for report.json, preserving its shape. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map(redactDeep) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}

/** console.log, but redacted. The harness uses only this. */
export function say(...parts: unknown[]): void {
  console.log(parts.map((p) => (typeof p === "string" ? redact(p) : redact(p))).join(" "));
}

/**
 * Install a last line of defence. An uncaught throw inside a provider SDK can carry a request
 * object — headers, authorization, the lot — straight to stderr, which is exactly the path that
 * would leak a token from an otherwise careful run.
 */
export function installRedactedCrashHandler(): void {
  const emit = (label: string) => (err: unknown) => {
    console.error(`${label}: ${redact(err)}`);
    process.exit(1);
  };
  process.on("uncaughtException", emit("UNCAUGHT"));
  process.on("unhandledRejection", emit("UNHANDLED REJECTION"));
}
