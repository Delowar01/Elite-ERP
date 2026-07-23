"use server";

import { revalidatePath } from "next/cache";
import { validateUpload, storeBlob, deleteStoredBlob, IMAGE_MAX_BYTES } from "@/lib/storage/blob-storage";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, customersTable } from "@/db";
import { requireSession, requireRole } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

export type ActionState = { error?: string } | undefined;

function readClientFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  return {
    name,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    taxId: String(formData.get("taxId") ?? "").trim() || null,
    vatNumber: String(formData.get("vatNumber") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const fields = readClientFields(formData);
  if (!fields.name) return { error: "Name is required." };

  const [row] = await db
    .insert(customersTable)
    .values({ orgId: session.orgId, ...fields })
    .returning({ id: customersTable.id });

  await logActivity(session, {
    type: "client.created",
    description: `Created client "${fields.name}"`,
    entityType: "client",
    entityId: row.id,
  });

  revalidatePath("/clients");
  redirect(`/clients/${row.id}`);
}

export async function updateClientAction(id: number, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const fields = readClientFields(formData);
  if (!fields.name) return { error: "Name is required." };

  const result = await db
    .update(customersTable)
    .set(fields)
    .where(and(eq(customersTable.id, id), tenantScope(session.orgId, customersTable)))
    .returning({ id: customersTable.id });
  if (!result.length) return { error: "Client not found." };

  await logActivity(session, {
    type: "client.updated",
    description: `Updated client "${fields.name}"`,
    entityType: "client",
    entityId: id,
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return { error: undefined };
}

export async function toggleClientActiveAction(id: number, isActive: boolean) {
  const session = await requireSession();
  await db
    .update(customersTable)
    .set({ isActive })
    .where(and(eq(customersTable.id, id), tenantScope(session.orgId, customersTable)));
  await logActivity(session, {
    type: isActive ? "client.activated" : "client.deactivated",
    description: `Marked client ${isActive ? "active" : "inactive"}`,
    entityType: "client",
    entityId: id,
  });
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

async function setRecordState(id: number, recordState: "active" | "archived" | "deleted", type: string, description: string) {
  const session = await requireSession();
  const result = await db
    .update(customersTable)
    .set({ recordState })
    .where(and(eq(customersTable.id, id), tenantScope(session.orgId, customersTable, { includeArchived: true, includeDeleted: true })))
    .returning({ id: customersTable.id });
  if (!result.length) return { error: "Client not found." };

  await logActivity(session, { type, description, entityType: "client", entityId: id });
  revalidatePath("/clients");
  revalidatePath("/clients/recycle-bin");
  revalidatePath(`/clients/${id}`);
  return { error: undefined };
}

export async function archiveClientAction(id: number) {
  return setRecordState(id, "archived", "client.archived", "Archived client");
}

export async function unarchiveClientAction(id: number) {
  return setRecordState(id, "active", "client.unarchived", "Unarchived client");
}

export async function deleteClientAction(id: number) {
  return setRecordState(id, "deleted", "client.deleted", "Moved client to Recycle Bin");
}

export async function restoreClientAction(id: number) {
  return setRecordState(id, "active", "client.restored", "Restored client from Recycle Bin");
}

// Hard delete: the only action in this module that issues a real SQL DELETE. Owner/admin only.
export async function permanentlyDeleteClientAction(id: number) {
  const session = await requireRole("owner", "admin");
  const result = await db
    .delete(customersTable)
    .where(and(eq(customersTable.id, id), eq(customersTable.orgId, session.orgId), eq(customersTable.recordState, "deleted")))
    .returning({ id: customersTable.id });
  if (!result.length) return { error: "Client not found in Recycle Bin." };

  await logActivity(session, {
    type: "client.permanently-deleted",
    description: "Permanently deleted client",
    entityType: "client",
    entityId: id,
  });
  revalidatePath("/clients/recycle-bin");
  return { error: undefined };
}

// Client logo — cropped (square/wide) client-side, stored on Vercel Blob (tenant-scoped).
export async function uploadClientLogoAction(clientId: number, formData: FormData): Promise<{ error?: string }> {
  const session = await requireSession();
  const [row] = await db.select({ id: customersTable.id, logoUrl: customersTable.logoUrl }).from(customersTable).where(and(tenantScope(session.orgId, customersTable), eq(customersTable.id, clientId)));
  if (!row) return { error: "Client not found." };
  const v = await validateUpload(formData.get("logo"), { kind: "image", maxBytes: IMAGE_MAX_BYTES, maxDimension: 2000 });
  if (v.error) return { error: v.error };
  const newUrl = await storeBlob(session.orgId, "client-logos", v.bytes!, v.ext!, v.contentType!);
  await db.update(customersTable).set({ logoUrl: newUrl }).where(and(tenantScope(session.orgId, customersTable), eq(customersTable.id, clientId)));
  await deleteStoredBlob(row.logoUrl);
  await logActivity(session, { type: "client.logo_updated", description: "Updated client logo", entityType: "client", entityId: clientId });
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return {};
}
