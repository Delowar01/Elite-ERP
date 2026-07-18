import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, securityEventsTable } from "@/db";

// ---------------------------------------------------------------------------
// Stage 11 Part 10 — heuristics over the security-event feed. Read-only; returns
// alerts for the Security Center. Windows are deliberately short so the signal
// reflects "now", not historical noise.
// ---------------------------------------------------------------------------

export type ThreatAlert = {
  kind: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  detail: string;
  count: number;
};

const HOUR_MS = 60 * 60 * 1000;

export async function detectThreats(orgId: number): Promise<ThreatAlert[]> {
  const since = new Date(Date.now() - 24 * HOUR_MS);
  const rows = await db
    .select({ type: securityEventsTable.type, email: securityEventsTable.email, ip: securityEventsTable.ipAddress, n: sql<number>`count(*)::int` })
    .from(securityEventsTable)
    .where(and(eq(securityEventsTable.orgId, orgId), gte(securityEventsTable.createdAt, since)))
    .groupBy(securityEventsTable.type, securityEventsTable.email, securityEventsTable.ipAddress);

  const alerts: ThreatAlert[] = [];

  // Brute force / credential stuffing: many failed logins for one email.
  const failedByEmail = new Map<string, number>();
  const failedByIp = new Map<string, number>();
  let mfaFailures = 0;
  let rateLimited = 0;
  for (const r of rows) {
    if (r.type === "login.failed") {
      if (r.email) failedByEmail.set(r.email, (failedByEmail.get(r.email) ?? 0) + r.n);
      if (r.ip) failedByIp.set(r.ip, (failedByIp.get(r.ip) ?? 0) + r.n);
    }
    if (r.type === "mfa.failed") mfaFailures += r.n;
    if (r.type === "login.rate_limited") rateLimited += r.n;
  }

  for (const [email, n] of failedByEmail) {
    if (n >= 5) alerts.push({ kind: "brute_force", severity: n >= 15 ? "high" : "medium", title: "Repeated failed logins", detail: `${n} failed attempts for ${email} in 24h`, count: n });
  }
  // Enumeration / distributed attack: one IP hammering many accounts.
  for (const [ip, n] of failedByIp) {
    if (n >= 10) alerts.push({ kind: "enumeration", severity: "high", title: "Login enumeration from one source", detail: `${n} failed logins from ${ip} in 24h`, count: n });
  }
  if (mfaFailures >= 3) alerts.push({ kind: "mfa_bypass", severity: "high", title: "Repeated MFA failures", detail: `${mfaFailures} invalid MFA codes in 24h — possible account-takeover attempt`, count: mfaFailures });
  if (rateLimited > 0) alerts.push({ kind: "rate_limit", severity: "medium", title: "Login lockouts triggered", detail: `${rateLimited} lockout event(s) in 24h`, count: rateLimited });

  return alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(s: string): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[s] ?? 0;
}

/** Coarse org risk level from the active alerts. */
export function riskLevel(alerts: ThreatAlert[]): "low" | "elevated" | "high" | "critical" {
  if (alerts.some((a) => a.severity === "critical")) return "critical";
  if (alerts.some((a) => a.severity === "high")) return "high";
  if (alerts.length > 0) return "elevated";
  return "low";
}
