"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, usersTable, type Role } from "@/db";
import { requireRole } from "@/lib/session";
import { canAssignRole } from "@/lib/tenant";
import { hashPassword } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { getLocale } from "@/lib/i18n/server";
import { changeTeamMemberRole, setTeamMemberActive } from "@/lib/team/member-changes";

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

// PO-03A: role changes and (de)activation run as ONE locked transaction in src/lib/team/member-changes.ts — the
// existing rules and messages (now localized), re-checked on the locked rows, plus primary-owner protection (O-3).
export async function changeRoleAction(userId: number, role: Role): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const result = await changeTeamMemberRole(session, userId, role, await getLocale());
  if (!result.error) revalidatePath(PATH);
  return result;
}

export async function toggleMemberActiveAction(userId: number, isActive: boolean): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const result = await setTeamMemberActive(session, userId, isActive, await getLocale());
  if (!result.error) revalidatePath(PATH);
  return result;
}
