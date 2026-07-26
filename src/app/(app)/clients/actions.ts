"use server";

import { revalidatePath } from "next/cache";
import { validateUpload, storeBlob, deleteStoredBlob, IMAGE_MAX_BYTES } from "@/lib/storage/blob-storage";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, customersTable } from "@/db";
import { requireSession, requireRole } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { buildingNumberError, postalCodeError, composeAddress } from "@/lib/geo/countries";

export type ActionState = { error?: string } | undefined;

function s(formData: FormData, key: string): string { return String(formData.get(key) ?? "").trim(); }

// Reads client fields including Client Type + the structured address. Server-side validation mirrors
// the client (SA 4-digit building number; alphanumeric postal). Returns { error } on failure.
function readClientFields(formData: FormData): { error?: string; fields?: Record<string, string | null> } {
  const name = s(formData, "name");
  if (!name) return { error: "Name is required." };
  const clientType = s(formData, "clientType") === "company" ? "company" : "individual";
  const countryCode = s(formData, "countryCode").toUpperCase() || null;
  const buildingNumber = s(formData, "buildingNumber") || null;
  const postalCode = s(formData, "postalCode") || null;
  if (buildingNumberError(countryCode, buildingNumber ?? "")) return { error: "Building number must be 4 digits." };
  if (postalCodeError(postalCode ?? "")) return { error: "Enter a valid postal / zip code." };

  const structured = {
    countryCode,
    stateProvince: s(formData, "stateProvince") || null,
    district: s(formData, "district") || null,
    city: s(formData, "city") || null,
    buildingNumber,
    postalCode,
    streetAddress: s(formData, "streetAddress") || null,
  };
  // Keep the legacy single-line `address` (used by cards/PDFs) in sync when any structured field is
  // set; leave it untouched otherwise so existing clients never lose their legacy address.
  const composed = composeAddress(structured);

  return {
    fields: {
      name,
      clientType,
      email: s(formData, "email") || null,
      phone: s(formData, "phone") || null,
      taxId: s(formData, "taxId") || null,
      vatNumber: s(formData, "vatNumber") || null,
      notes: s(formData, "notes") || null,
      ...structured,
      ...(composed ? { address: composed } : {}),
    },
  };
}

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const { error, fields } = readClientFields(formData);
  if (error || !fields) return { error };

  const [row] = await db
    .insert(customersTable)
    .values({ orgId: session.orgId, ...fields, name: fields.name! })
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
  const { error, fields } = readClientFields(formData);
  if (error || !fields) return { error };

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
