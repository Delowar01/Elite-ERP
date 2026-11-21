import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usersTable, orgsTable, type Role } from "@/db/schema";
import { SESSION_COOKIE, verifySessionToken } from "./auth";
import { hostAllowed } from "./security/host-binding";
import { isSessionValid, readSessionRow } from "./security/session-store";
import { legacyCustomerTokensRejected, ORG_SUSPENDED_REVOKE_REASON, orgAccessDecision, tenantAccessEnforcementEnabled } from "./security/tenant-access-gate";

export type Session = {
  userId: number;
  orgId: number;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  orgName: string;
  orgLogoUrl: string | null;
  orgPrimaryColor: string;
  orgAccentColor: string;
  orgColorThemeMode: string;
  orgGradientFrom: string;
  orgGradientTo: string;
  orgThemeOverrides: Record<string, { bg?: string; fg?: string }> | null;
  orgCurrency: string;
  orgCountry: string | null;
  // Number Format (Business Settings → Number Format) — display config for documents.
  orgCustomCurrencySymbol: string | null;
  orgNumberDigitGrouping: string;
  orgNumberDecimalPlaces: number;
  orgRoundQuantities: boolean;
  orgRoundRates: boolean;
  jti?: string;
};

/**
 * PO-02C: what a session token resolves to. `suspended` = authentic, but the company's access is
 * not active; `unavailable` = authentic, but the company's access cannot be determined (the
 * access-control objects are missing — fail closed). Neither is ever a usable session.
 */
export type SessionState = { status: "active"; session: Session } | { status: "suspended" } | { status: "unavailable" } | { status: "signed_out" };
const SIGNED_OUT: SessionState = { status: "signed_out" };
const SUSPENDED: SessionState = { status: "suspended" };
const UNAVAILABLE: SessionState = { status: "unavailable" };

/**
 * Token → session state (uncached; the request path below wraps it in React's cache()).
 *
 * PO-02C tenant-access gate — only while TENANT_ACCESS_ENFORCEMENT=enabled; with the switch off
 * this is exactly the previous lookup:
 *  • the session row must belong to the token's user AND organization, and the user must still
 *    belong to that organization (an ownership mismatch is signed out);
 *  • the company's effective access is checked on EVERY request, independently of session
 *    revocation, so a session the suspension missed still cannot be used;
 *  • a session ended by the suspension shows the suspended screen while the company stays
 *    suspended; after reactivation it is simply signed out (every user signs in again).
 * D-8 (proposal, CUSTOMER_LEGACY_TOKENS=reject): tokens without a server-side session id are refused.
 */
export async function resolveSessionToken(token: string): Promise<SessionState> {
  const payload = await verifySessionToken(token);
  if (!payload) return SIGNED_OUT;
  const enforce = tenantAccessEnforcementEnabled();

  if (!payload.jti) {
    // Legacy tokens minted before Stage 11 have no jti and remain valid until they expire — unless
    // the D-8 proposal is switched on.
    if (legacyCustomerTokensRejected()) return SIGNED_OUT;
  } else if (enforce) {
    const sessionRow = await readSessionRow(payload.jti);
    if (!sessionRow || sessionRow.userId !== payload.userId || sessionRow.orgId !== payload.orgId) return SIGNED_OUT;
    if (sessionRow.revokedAt || sessionRow.expiresAt.getTime() < Date.now()) {
      if (sessionRow.revokedAt && sessionRow.revokedReason === ORG_SUSPENDED_REVOKE_REASON && (await orgAccessDecision(sessionRow.orgId)) === "suspended") return SUSPENDED;
      return SIGNED_OUT;
    }
  } else if (!(await isSessionValid(payload.jti))) {
    // Server-side revocation check: a token carrying a jti must map to a live session row.
    return SIGNED_OUT;
  }

  const [row] = await db
    .select({
      userId: usersTable.id,
      orgId: usersTable.orgId,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      isActive: usersTable.isActive,
      orgName: orgsTable.name,
      orgLogoUrl: orgsTable.logoUrl,
      orgPrimaryColor: orgsTable.primaryColor,
      orgAccentColor: orgsTable.accentColor,
      orgColorThemeMode: orgsTable.colorThemeMode,
      orgGradientFrom: orgsTable.gradientFrom,
      orgGradientTo: orgsTable.gradientTo,
      orgThemeOverrides: orgsTable.themeOverrides,
      orgCurrency: orgsTable.currency,
      orgCountry: orgsTable.country,
      orgCustomCurrencySymbol: orgsTable.customCurrencySymbol,
      orgNumberDigitGrouping: orgsTable.numberDigitGrouping,
      orgNumberDecimalPlaces: orgsTable.numberDecimalPlaces,
      orgRoundQuantities: orgsTable.roundQuantities,
      orgRoundRates: orgsTable.roundRates,
    })
    .from(usersTable)
    .innerJoin(orgsTable, eq(orgsTable.id, usersTable.orgId))
    .where(eq(usersTable.id, payload.userId))
    .limit(1);

  if (!row || !row.isActive) return SIGNED_OUT;
  if (enforce) {
    // The token's organization must still be the user's organization, and that company's access
    // must be active (no access row = active; a suspended or unrecognized row = not; an unreadable
    // access table = not — fail closed, reported as unavailable rather than as a suspension).
    if (row.orgId !== payload.orgId) return SIGNED_OUT;
    const decision = await orgAccessDecision(row.orgId);
    if (decision === "suspended") return SUSPENDED;
    if (decision === "unavailable") return UNAVAILABLE;
  }
  return { status: "active", session: { ...row, role: row.role as Role, jti: payload.jti } };
}

// Session -> org resolution happens once per request: every Server Component/Action on a page
// calls getSession(), but React's cache() dedups the underlying DB lookup within that one render.
const lookupSessionByToken = cache(resolveSessionToken);

/** PO-02C: the current request's session state (the access-suspended screen and requireSession). */
export async function getSessionState(): Promise<SessionState> {
  // PO-07 H-1: a customer session exists only on the configured customer host (always, while unbound).
  // Everywhere else — the console host, a forwarded action, an unknown or listed host — it is signed out,
  // so no customer page, action, export, PDF or file can be reached there with a customer cookie.
  if (!hostAllowed("customer", await headers())) return SIGNED_OUT;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return SIGNED_OUT;
  return lookupSessionByToken(token);
}

export async function getSession(): Promise<Session | null> {
  const state = await getSessionState();
  return state.status === "active" ? state.session : null;
}

export async function requireSession(): Promise<Session> {
  const state = await getSessionState();
  // PO-02C: an authentic session of a suspended company (or one whose access cannot be determined)
  // goes to the access-suspended screen; the cookie is kept so that screen can re-check the state
  // and offer sign-out.
  if (state.status === "suspended" || state.status === "unavailable") redirect("/access-suspended");
  // A request can reach here with a cryptographically-valid but server-side-REVOKED cookie
  // (the edge middleware can't check revocation). Redirect through /auth/clear so the stale
  // cookie is deleted at a real response boundary instead of bouncing to /login and looping (B1).
  if (state.status !== "active") redirect("/auth/clear?next=/login");
  return state.session;
}

export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await requireSession();
  if (!roles.includes(session.role)) redirect("/dashboard");
  return session;
}
