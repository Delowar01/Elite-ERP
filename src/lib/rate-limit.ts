import "server-only";

// Minimal in-memory sliding-window limiter for the login endpoint (security audit, Medium #4).
// Per-process state: on a multi-instance deployment each instance keeps its own window, so the
// effective ceiling is attempts × instances — still a hard stop for online brute force. A shared
// store (Redis/DB) is the upgrade path if the app ever runs multi-instance.
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function sweep(now: number) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Returns minutes to wait when limited, or null when the attempt is allowed. */
export function checkLoginRateLimit(key: string): number | null {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  if (bucket.count >= MAX_ATTEMPTS) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 60000));
  }
  bucket.count += 1;
  return null;
}

export function clearLoginRateLimit(key: string) {
  buckets.delete(key);
}
