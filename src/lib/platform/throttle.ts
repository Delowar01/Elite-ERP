import "server-only";
import { and, eq, gt, max, or, sql } from "drizzle-orm";
import { db, platformLoginAttemptsTable, type Tx } from "@/db";
import { platformKeyedDigest } from "./config";

// ---------------------------------------------------------------------------------------------
// Durable login throttling (PR #11 Schema.md §3.3, TRD §3.1). State lives in
// platform_login_attempts, so it survives restarts and is shared by every process. Unlike the
// in-memory customer limiter (src/lib/rate-limit.ts), it limits per ACCOUNT and per IP. E-mail and
// IP are stored only as keyed digests; passwords and codes are never stored.
//
// A failure that reaches a tier's limit writes `blocked_until`. While a block is active, further
// attempts are recorded as "blocked" and do not extend it (bounds lock-out abuse). Account
// counters restart after a successful login; IP counters do not.
// ---------------------------------------------------------------------------------------------

type Tier = { windowMs: number; maxFailures: number; blockMs: number };
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const PLATFORM_THROTTLE_POLICY: { account: Tier[]; ip: Tier[] } = {
  account: [
    { windowMs: 15 * MINUTE, maxFailures: 5, blockMs: 15 * MINUTE },
    { windowMs: 24 * HOUR, maxFailures: 20, blockMs: 24 * HOUR },
  ],
  ip: [
    { windowMs: 15 * MINUTE, maxFailures: 20, blockMs: 15 * MINUTE },
    { windowMs: 24 * HOUR, maxFailures: 100, blockMs: 24 * HOUR },
  ],
};

export type ThrottleKeys = { emailHash: string; ipHash: string | null };
export type LoginAttemptOutcome = "success" | "failure" | "blocked" | "mfa_required";

export function throttleKeys(normalizedEmail: string, ipAddress: string | null | undefined): ThrottleKeys {
  const ip = (ipAddress ?? "").trim().toLowerCase();
  return {
    emailHash: platformKeyedDigest("login-email", normalizedEmail),
    ipHash: ip ? platformKeyedDigest("login-ip", ip) : null,
  };
}

/** The latest active block covering this account or IP, or null. */
export async function activeLoginBlock(keys: ThrottleKeys, now: Date): Promise<Date | null> {
  const t = platformLoginAttemptsTable;
  const subject = keys.ipHash ? or(eq(t.emailHash, keys.emailHash), eq(t.ipHash, keys.ipHash)) : eq(t.emailHash, keys.emailHash);
  const [row] = await db.select({ until: max(t.blockedUntil) }).from(t).where(and(subject, gt(t.blockedUntil, now)));
  return row?.until ?? null;
}

async function countFailures(tx: Tx, column: "email" | "ip", key: string, since: Date): Promise<number> {
  const t = platformLoginAttemptsTable;
  const col = column === "email" ? t.emailHash : t.ipHash;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(col, key), eq(t.outcome, "failure"), gt(t.attemptedAt, since)));
  return row?.n ?? 0;
}

/**
 * Record one attempt. For a failure, the per-account and per-IP counters are evaluated under
 * transaction-scoped advisory locks (concurrent failures cannot slip past a limit) and the row is
 * written with `blocked_until` when this failure reaches a limit.
 */
export async function recordLoginAttempt(keys: ThrottleKeys, outcome: LoginAttemptOutcome, now: Date): Promise<{ id: string; blockedUntil: Date | null }> {
  const t = platformLoginAttemptsTable;
  if (outcome !== "failure") {
    const [row] = await db.insert(t).values({ emailHash: keys.emailHash, ipHash: keys.ipHash, attemptedAt: now, outcome }).returning({ id: t.id });
    return { id: row.id, blockedUntil: null };
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`platform-login:${keys.emailHash}`}, 0))`);
    if (keys.ipHash) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`platform-login:${keys.ipHash}`}, 0))`);

    const [lastSuccess] = await tx
      .select({ at: max(t.attemptedAt) })
      .from(t)
      .where(and(eq(t.emailHash, keys.emailHash), eq(t.outcome, "success")));
    let blockedUntil: Date | null = null;
    const extend = (until: Date) => {
      if (!blockedUntil || until > blockedUntil) blockedUntil = until;
    };

    for (const tier of PLATFORM_THROTTLE_POLICY.account) {
      let since = new Date(now.getTime() - tier.windowMs);
      if (lastSuccess?.at && lastSuccess.at > since) since = lastSuccess.at;
      const prior = await countFailures(tx, "email", keys.emailHash, since);
      if (prior + 1 >= tier.maxFailures) extend(new Date(now.getTime() + tier.blockMs));
    }
    if (keys.ipHash) {
      for (const tier of PLATFORM_THROTTLE_POLICY.ip) {
        const prior = await countFailures(tx, "ip", keys.ipHash, new Date(now.getTime() - tier.windowMs));
        if (prior + 1 >= tier.maxFailures) extend(new Date(now.getTime() + tier.blockMs));
      }
    }
    const [row] = await tx
      .insert(t)
      .values({ emailHash: keys.emailHash, ipHash: keys.ipHash, attemptedAt: now, outcome: "failure", blockedUntil })
      .returning({ id: t.id });
    return { id: row.id, blockedUntil };
  });
}
