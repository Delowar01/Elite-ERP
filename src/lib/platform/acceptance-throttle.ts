import "server-only";
import { and, eq, gt, max, or, sql } from "drizzle-orm";
import { db, platformLoginAttemptsTable, type Tx } from "@/db";
import { platformKeyedDigest } from "./config";

// ---------------------------------------------------------------------------------------------
// PO-02D3 — durable throttling for the PUBLIC invitation-acceptance endpoint (decision A-6, provisional).
//
// Durable and shared by every process: the state lives in PostgreSQL, in PO-01A's keyed-digest attempt store
// platform_login_attempts — NO new table, NO schema change. Its keys are acceptance-only digests
// (platformKeyedDigest purposes "invite-accept-ip" / "invite-accept-email"), so an acceptance key can never match,
// count against or block a Platform Owner sign-in key (those use "login-ip" / "login-email"), and the sign-in
// throttle (throttle.ts) is not changed. The client IP and the invitation's owner e-mail are stored only as
// keyed digests; a token, a password or a plaintext address is never stored.
//
//   ip         — every failed validation or acceptance from the client IP (when a trusted proxy makes the IP
//                knowable: PLATFORM_TRUSTED_PROXY_HOPS; otherwise per-IP limits are skipped, as for sign-in)
//   invitation — failed attempts against ONE real invitation (keyed by its owner e-mail, so a re-issue keeps the
//                count); only a holder of a valid link can reach it, so nobody else can lock an invitee out
//
// A failure that reaches a tier writes `blocked_until`; while a block is active the endpoint refuses before any
// token lookup or password hashing, and writes NOTHING (a flood during a block costs one indexed read). A success
// restarts the invitation counters, as a sign-in success restarts the account counters.
// ---------------------------------------------------------------------------------------------

type Tier = { windowMs: number; maxFailures: number; blockMs: number };
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const ACCEPTANCE_THROTTLE_POLICY: { ip: Tier[]; invitation: Tier[] } = {
  ip: [
    { windowMs: 15 * MINUTE, maxFailures: 10, blockMs: 15 * MINUTE },
    { windowMs: 24 * HOUR, maxFailures: 50, blockMs: 24 * HOUR },
  ],
  invitation: [
    { windowMs: 15 * MINUTE, maxFailures: 5, blockMs: 15 * MINUTE },
    { windowMs: 24 * HOUR, maxFailures: 20, blockMs: 24 * HOUR },
  ],
};

export type AcceptanceThrottleKeys = { invitationHash: string | null; ipHash: string | null };

export function acceptanceThrottleKeys(ownerEmail: string | null, ipAddress: string | null): AcceptanceThrottleKeys {
  const ip = (ipAddress ?? "").trim().toLowerCase();
  return {
    invitationHash: ownerEmail ? platformKeyedDigest("invite-accept-email", ownerEmail) : null,
    ipHash: ip ? platformKeyedDigest("invite-accept-ip", ip) : null,
  };
}

/** The latest active block covering this IP or invitation, or null. */
export async function activeAcceptanceBlock(keys: AcceptanceThrottleKeys, now: Date): Promise<Date | null> {
  const t = platformLoginAttemptsTable;
  const subjects = [keys.invitationHash ? eq(t.emailHash, keys.invitationHash) : undefined, keys.ipHash ? eq(t.ipHash, keys.ipHash) : undefined].filter(
    (s): s is NonNullable<typeof s> => s !== undefined,
  );
  if (subjects.length === 0) return null;
  const [row] = await db.select({ until: max(t.blockedUntil) }).from(t).where(and(subjects.length === 1 ? subjects[0] : or(...subjects), gt(t.blockedUntil, now)));
  return row?.until ?? null;
}

async function countFailures(tx: Tx, column: "invitation" | "ip", key: string, since: Date): Promise<number> {
  const t = platformLoginAttemptsTable;
  const col = column === "invitation" ? t.emailHash : t.ipHash;
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(col, key), eq(t.outcome, "failure"), gt(t.attemptedAt, since)));
  return row?.n ?? 0;
}

/**
 * Record one attempt. A failure is evaluated under transaction-scoped advisory locks on each of its keys (concurrent
 * failures cannot slip past a limit) and written with `blocked_until` when it reaches a tier. Nothing is written for
 * an attempt without any key (an unknown token from an unknown IP).
 */
export async function recordAcceptanceAttempt(keys: AcceptanceThrottleKeys, outcome: "success" | "failure", now: Date): Promise<{ blockedUntil: Date | null }> {
  const t = platformLoginAttemptsTable;
  if (!keys.invitationHash && !keys.ipHash) return { blockedUntil: null };
  if (outcome === "success") {
    await db.insert(t).values({ emailHash: keys.invitationHash, ipHash: keys.ipHash, attemptedAt: now, outcome: "success" });
    return { blockedUntil: null };
  }
  return db.transaction(async (tx) => {
    for (const key of [keys.invitationHash, keys.ipHash]) {
      if (key) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`platform-invite-accept:${key}`}, 0))`);
    }
    let blockedUntil: Date | null = null;
    const extend = (until: Date) => {
      if (!blockedUntil || until > blockedUntil) blockedUntil = until;
    };
    if (keys.invitationHash) {
      const [lastSuccess] = await tx
        .select({ at: max(t.attemptedAt) })
        .from(t)
        .where(and(eq(t.emailHash, keys.invitationHash), eq(t.outcome, "success")));
      for (const tier of ACCEPTANCE_THROTTLE_POLICY.invitation) {
        let since = new Date(now.getTime() - tier.windowMs);
        if (lastSuccess?.at && lastSuccess.at > since) since = lastSuccess.at;
        if ((await countFailures(tx, "invitation", keys.invitationHash, since)) + 1 >= tier.maxFailures) extend(new Date(now.getTime() + tier.blockMs));
      }
    }
    if (keys.ipHash) {
      for (const tier of ACCEPTANCE_THROTTLE_POLICY.ip) {
        if ((await countFailures(tx, "ip", keys.ipHash, new Date(now.getTime() - tier.windowMs))) + 1 >= tier.maxFailures) extend(new Date(now.getTime() + tier.blockMs));
      }
    }
    await tx.insert(t).values({ emailHash: keys.invitationHash, ipHash: keys.ipHash, attemptedAt: now, outcome: "failure", blockedUntil });
    return { blockedUntil };
  });
}
