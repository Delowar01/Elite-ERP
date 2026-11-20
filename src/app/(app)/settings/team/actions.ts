"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@/db";
import { requireRole } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { addTeamMember } from "@/lib/team/member-add";
import { changeTeamMemberRole, setTeamMemberActive } from "@/lib/team/member-changes";

export type ActionResult = { error?: string };

const PATH = "/settings/organization";
// No email/invite infrastructure exists yet — this creates the account directly with a password
// the admin sets and shares with the new member out of band, rather than promising an email
// invite that wouldn't actually be sent.
// PO-03D: the add runs as ONE locked transaction in src/lib/team/member-add.ts — the existing rules and messages (now
// localized), re-checked under the shared lock order of every seat change, plus the shared seat check while user limits
// are enforced (CUSTOMER_SEAT_ENFORCEMENT_ENABLED).
export async function addTeamMemberAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const result = await addTeamMember(
    session,
    {
      name: String(formData.get("name") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      role: String(formData.get("role") ?? "staff"),
    },
    await getLocale(),
  );
  if (!result.error) revalidatePath(PATH);
  return result;
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
