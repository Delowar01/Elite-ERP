import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, usersTable, securityEventsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { detectThreats, riskLevel } from "@/lib/security/threat-detection";
import { listActiveSessions } from "@/lib/security/session-store";
import { SecurityCenterClient } from "./security-client";

export default async function SecurityCenterPage() {
  const session = await requireSession();
  const locale = await getLocale();
  const isAdmin = session.role === "owner" || session.role === "admin";

  const [me] = await db
    .select({ mfaEnabled: usersTable.mfaEnabled, passwordChangedAt: usersTable.passwordChangedAt })
    .from(usersTable)
    .where(eq(usersTable.id, session.userId));

  const [org] = await db.select({ mfaRequired: orgsTable.mfaRequiredForPrivileged }).from(orgsTable).where(eq(orgsTable.id, session.orgId));

  const activeSessions = await listActiveSessions(session.userId);

  // Org-wide security signal (admins only): recent events, threat alerts, login stats.
  // Compute the 30-day window in SQL — calling Date.now() during render is an impure-function violation.
  const since = sql`now() - interval '30 days'`;
  const [events, alerts, stats] = isAdmin
    ? await Promise.all([
        db
          .select()
          .from(securityEventsTable)
          .where(and(eq(securityEventsTable.orgId, session.orgId), gte(securityEventsTable.createdAt, since)))
          .orderBy(desc(securityEventsTable.createdAt))
          .limit(50),
        detectThreats(session.orgId),
        db
          .select({ type: securityEventsTable.type, n: sql<number>`count(*)::int` })
          .from(securityEventsTable)
          .where(and(eq(securityEventsTable.orgId, session.orgId), gte(securityEventsTable.createdAt, since)))
          .groupBy(securityEventsTable.type),
      ])
    : [[], [], []];

  const statMap = Object.fromEntries((stats as { type: string; n: number }[]).map((s) => [s.type, s.n]));

  return (
    <SecurityCenterClient
      locale={locale}
      isAdmin={isAdmin}
      mfaEnabled={me?.mfaEnabled ?? false}
      mfaRequired={isAdmin && (org?.mfaRequired ?? true)}
      passwordChangedAt={me?.passwordChangedAt?.toISOString() ?? null}
      currentJti={session.jti ?? null}
      sessions={activeSessions.map((s) => ({
        id: s.id,
        browser: s.browser,
        os: s.os,
        device: s.device,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt.toISOString(),
        lastActivityAt: s.lastActivityAt.toISOString(),
        tokenHash: s.tokenHash,
      }))}
      riskLevel={riskLevel(alerts)}
      alerts={alerts}
      events={(events as (typeof securityEventsTable.$inferSelect)[]).map((e) => ({
        id: e.id,
        type: e.type,
        severity: e.severity,
        email: e.email,
        ipAddress: e.ipAddress,
        browser: e.browser,
        detail: e.detail,
        createdAt: e.createdAt.toISOString(),
      }))}
      stats={{
        loginSuccess: statMap["login.success"] ?? 0,
        loginFailed: statMap["login.failed"] ?? 0,
        mfaEvents: (statMap["mfa.enabled"] ?? 0) + (statMap["mfa.disabled"] ?? 0) + (statMap["mfa.failed"] ?? 0),
        passwordChanges: statMap["password.changed"] ?? 0,
      }}
    />
  );
}
