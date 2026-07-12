import "server-only";
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
};

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

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
    })
    .from(usersTable)
    .innerJoin(orgsTable, eq(orgsTable.id, usersTable.orgId))
    .where(eq(usersTable.id, payload.userId))
    .limit(1);

  if (!row || !row.isActive) return null;
  return { ...row, role: row.role as Role };
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
