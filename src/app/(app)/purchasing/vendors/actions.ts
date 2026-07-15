"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, vendorsTable } from "@/db";
import { requireSession, requireRole } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

export type ActionState = { error?: string } | undefined;

function readVendorFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  return {
    name,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    taxId: String(formData.get("taxId") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

export async function createVendorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const fields = readVendorFields(formData);
  if (!fields.name) return { error: "Name is required." };

  const [row] = await db
    .insert(vendorsTable)
    .values({ orgId: session.orgId, ...fields })
    .returning({ id: vendorsTable.id });

  await logActivity(session, {
    type: "vendor.created",
    description: `Created vendor "${fields.name}"`,
    entityType: "vendor",
    entityId: row.id,
  });

  revalidatePath("/purchasing/vendors");
  redirect(`/purchasing/vendors/${row.id}`);
}

export async function updateVendorAction(id: number, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const fields = readVendorFields(formData);
  if (!fields.name) return { error: "Name is required." };

  const result = await db
    .update(vendorsTable)
    .set(fields)
    .where(and(eq(vendorsTable.id, id), tenantScope(session.orgId, vendorsTable)))
    .returning({ id: vendorsTable.id });
  if (!result.length) return { error: "Vendor not found." };

  await logActivity(session, {
    type: "vendor.updated",
    description: `Updated vendor "${fields.name}"`,
    entityType: "vendor",
    entityId: id,
  });

  revalidatePath("/purchasing/vendors");
  revalidatePath(`/purchasing/vendors/${id}`);
  return { error: undefined };
}

export async function toggleVendorActiveAction(id: number, isActive: boolean) {
  const session = await requireSession();
  await db
    .update(vendorsTable)
    .set({ isActive })
    .where(and(eq(vendorsTable.id, id), tenantScope(session.orgId, vendorsTable)));
  await logActivity(session, {
    type: isActive ? "vendor.activated" : "vendor.deactivated",
    description: `Marked vendor ${isActive ? "active" : "inactive"}`,
    entityType: "vendor",
    entityId: id,
  });
  revalidatePath("/purchasing/vendors");
  revalidatePath(`/purchasing/vendors/${id}`);
}

async function setRecordState(id: number, recordState: "active" | "archived" | "deleted", type: string, description: string) {
  const session = await requireSession();
  const result = await db
    .update(vendorsTable)
    .set({ recordState })
    .where(and(eq(vendorsTable.id, id), tenantScope(session.orgId, vendorsTable, { includeArchived: true, includeDeleted: true })))
    .returning({ id: vendorsTable.id });
  if (!result.length) return { error: "Vendor not found." };

  await logActivity(session, { type, description, entityType: "vendor", entityId: id });
  revalidatePath("/purchasing/vendors");
  revalidatePath("/purchasing/vendors/recycle-bin");
  revalidatePath(`/purchasing/vendors/${id}`);
  return { error: undefined };
}

export async function archiveVendorAction(id: number) {
  return setRecordState(id, "archived", "vendor.archived", "Archived vendor");
}

export async function unarchiveVendorAction(id: number) {
  return setRecordState(id, "active", "vendor.unarchived", "Unarchived vendor");
}

export async function deleteVendorAction(id: number) {
  return setRecordState(id, "deleted", "vendor.deleted", "Moved vendor to Recycle Bin");
}

export async function restoreVendorAction(id: number) {
  return setRecordState(id, "active", "vendor.restored", "Restored vendor from Recycle Bin");
}

export async function permanentlyDeleteVendorAction(id: number) {
  const session = await requireRole("owner", "admin");
  const result = await db
    .delete(vendorsTable)
    .where(and(eq(vendorsTable.id, id), eq(vendorsTable.orgId, session.orgId), eq(vendorsTable.recordState, "deleted")))
    .returning({ id: vendorsTable.id });
  if (!result.length) return { error: "Vendor not found in Recycle Bin." };

  await logActivity(session, {
    type: "vendor.permanently-deleted",
    description: "Permanently deleted vendor",
    entityType: "vendor",
    entityId: id,
  });
  revalidatePath("/purchasing/vendors/recycle-bin");
  return { error: undefined };
}
