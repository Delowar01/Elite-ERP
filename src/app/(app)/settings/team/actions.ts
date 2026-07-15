"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db, usersTable, type Role } from "@/db";
import { requireRole } from "@/lib/session";
import { canAssignRole } from "@/lib/tenant";
import { hashPassword } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export type ActionResult = { error?: string };

const PATH = "/settings/organization";
const VALID_ROLES: Role[] = ["owner", "admin", "staff"];

// No email/invite infrastructure exists yet — this creates the account directly with a password
// the admin sets and shares with the new member out of band, rather than promising an email
// invite that wouldn't actually be sent.
export async function addTeamMemberAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "staff") as Role;

  if (!name || !email || !password) return { error: "Name, email, and password are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (!VALID_ROLES.includes(role)) return { error: "Invalid role." };
  if (!canAssignRole(session.role, role)) return { error: "You can't assign a role above your own." };

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (existing) return { error: "A user with this email already exists." };

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(usersTable)
    .values({ orgId: session.orgId, name, email, passwordHash, role })
    .returning({ id: usersTable.id });

  await logActivity(session, {
    type: "team.member-added",
    description: `Added team member "${name}" (${role})`,
    entityType: "user",
    entityId: user.id,
  });
  revalidatePath(PATH);
  return {};
}

export async function changeRoleAction(userId: number, role: Role): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!VALID_ROLES.includes(role)) return { error: "Invalid role." };
  if (!canAssignRole(session.role, role)) return { error: "You can't assign a role above your own." };
  if (userId === session.userId) return { error: "You can't change your own role." };

  const [target] = await db.select({ role: usersTable.role }).from(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.orgId, session.orgId)));
  if (!target) return { error: "User not found." };
  if (!canAssignRole(session.role, target.role as Role)) return { error: "You can't change this member's role." };

  await db.update(usersTable).set({ role, updatedAt: new Date() }).where(eq(usersTable.id, userId));
  await logActivity(session, {
    type: "team.role-changed",
    description: `Changed a team member's role to ${role}`,
    entityType: "user",
    entityId: userId,
  });
  revalidatePath(PATH);
  return {};
}

export async function toggleMemberActiveAction(userId: number, isActive: boolean): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (userId === session.userId) return { error: "You can't deactivate your own account." };

  // Never allow the org's last active owner to be deactivated — would lock everyone out.
  if (!isActive) {
    const [target] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
    if (target?.role === "owner") {
      const otherOwners = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.orgId, session.orgId), eq(usersTable.role, "owner"), eq(usersTable.isActive, true), ne(usersTable.id, userId)));
      if (otherOwners.length === 0) return { error: "The organization must keep at least one active owner." };
    }
  }

  const result = await db
    .update(usersTable)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(usersTable.id, userId), eq(usersTable.orgId, session.orgId)))
    .returning({ id: usersTable.id });
  if (!result.length) return { error: "User not found." };

  await logActivity(session, {
    type: isActive ? "team.member-activated" : "team.member-deactivated",
    description: `Marked a team member ${isActive ? "active" : "inactive"}`,
    entityType: "user",
    entityId: userId,
  });
  revalidatePath(PATH);
  return {};
}
