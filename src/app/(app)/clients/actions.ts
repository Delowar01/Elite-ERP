"use server";

import { revalidatePath } from "next/cache";
import { validateUpload, storeBlob, deleteStoredBlob, IMAGE_MAX_BYTES } from "@/lib/storage/blob-storage";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, customersTable, type Customer } from "@/db";
import { requireSession, requireRole } from "@/lib/session";
import type { Session } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { normalizeClientFields } from "@/lib/clients/client-fields";

// `client` is set only by the inline (popup) create action so the caller can auto-select the new
// record without a page reload; the full-page create action redirects instead.
export type ActionState = { error?: string; client?: Customer } | undefined;

function s(formData: FormData, key: string): string { return String(formData.get(key) ?? "").trim(); }

// Reads client fields including Client Type + the structured address. Field shaping and validation
// live in `normalizeClientFields`, shared with the batch importer so the two entry points can never
// accept different data. Returns { error } on failure.
function readClientFields(formData: FormData): { error?: string; fields?: Record<string, string | null> } {
  const keys = [
    "name", "clientType", "email", "phone", "taxId", "vatNumber", "notes",
    "countryCode", "stateProvince", "district", "city", "buildingNumber", "additionalNumber",
    "postalCode", "streetAddress",
  ];
  const input: Record<string, string> = {};
  for (const k of keys) input[k] = s(formData, k);

  // strictCountry: false keeps the form's long-standing behaviour of accepting whatever country
  // value it was given; the importer uses the strict default.
  const { errors, fields } = normalizeClientFields(input, { strictCountry: false });
  if (!fields) return { error: errors[0] ?? "Please check the client details." };
  return { fields };
}

// Shared insert used by both the full-page create action and the in-document popup create action, so
// field handling, tenant scoping and audit logging never diverge between the two entry points.
async function insertClientRecord(session: Session, fields: Record<string, string | null>): Promise<Customer> {
  const [row] = await db
    .insert(customersTable)
    .values({ orgId: session.orgId, ...fields, name: fields.name! })
    .returning();

  await logActivity(session, {
    type: "client.created",
    description: `Created client "${fields.name}"`,
    entityType: "client",
    entityId: row.id,
  });
  revalidatePath("/clients");
  return row;
}

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const { error, fields } = readClientFields(formData);
  if (error || !fields) return { error };

  const row = await insertClientRecord(session, fields);
  redirect(`/clients/${row.id}`);
}

// In-document popup create action: same validation + insert as the full page, but returns the created
// (tenant-scoped) client so the document's client selector can auto-select it in place — no redirect,
// preserving all unsaved document data.
export async function createClientInlineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const { error, fields } = readClientFields(formData);
  if (error || !fields) return { error };

  const client = await insertClientRecord(session, fields);
  return { client };
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
  // Owner-only, matching the lifecycle rule for documents. A permanently-deleted client or product
  // may have posted transactions behind it, which is at least as destructive as erasing a draft.
  const session = await requireRole("owner");
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
