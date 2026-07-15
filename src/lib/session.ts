import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usersTable, orgsTable, type Role } from "@/db/schema";
import { SESSION_COOKIE, verifySessionToken } from "./auth";

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
};

// Session -> org resolution happens once per request: every Server Component/Action on a page
// calls getSession(), but React's cache() dedups the underlying DB lookup within that one render.
const lookupSessionByToken = cache(async (token: string): Promise<Session | null> => {
  const payload = await verifySessionToken(token);
  if (!payload) return null;

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
    })
    .from(usersTable)
    .innerJoin(orgsTable, eq(orgsTable.id, usersTable.orgId))
    .where(eq(usersTable.id, payload.userId))
    .limit(1);

  if (!row || !row.isActive) return null;
  return { ...row, role: row.role as Role };
});

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return lookupSessionByToken(token);
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await requireSession();
  if (!roles.includes(session.role)) redirect("/dashboard");
  return session;
}
