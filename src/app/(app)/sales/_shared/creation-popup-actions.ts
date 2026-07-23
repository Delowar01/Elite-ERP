"use server";

import { and, eq } from "drizzle-orm";
import { db, orgsTable, customersTable, vendorsTable, documentSequencesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { validateUpload, storeBlob, IMAGE_MAX_BYTES, ATTACHMENT_MAX_BYTES, CONTENT_TYPES } from "@/lib/storage/blob-storage";

export type UploadResult = { error?: string; url?: string; fileName?: string; contentType?: string; sizeBytes?: number };

// Item image upload (Line Items → Add Image). Receives the cropped 1:1 image, stores it on Vercel
// Blob (tenant-scoped) and returns its proxy URL; the URL is held in the line-item draft and
// persisted with the document (imageUrl column) on save.
export async function uploadItemImageAction(formData: FormData): Promise<UploadResult> {
  const session = await requireSession();
  const v = await validateUpload(formData.get("image"), { kind: "image", maxBytes: IMAGE_MAX_BYTES, maxDimension: 1600 });
  if (v.error) return { error: v.error };
  const url = await storeBlob(session.orgId, "item-images", v.bytes!, v.ext!, v.contentType!);
  return { url };
}

// Document attachment upload (Terms, Notes & Attachments → Add Attachment). PDFs are stored as-is
// (no crop); images may be cropped client-side. Stored on Vercel Blob; the create/update action
// inserts the document_attachments row on save so the attachment is tied to the real document.
export async function uploadDocumentAttachmentAction(formData: FormData): Promise<UploadResult> {
  const session = await requireSession();
  const file = formData.get("attachment");
  const v = await validateUpload(file, { kind: "attachment", maxBytes: ATTACHMENT_MAX_BYTES });
  if (v.error) return { error: v.error };
  const url = await storeBlob(session.orgId, "attachments", v.bytes!, v.ext!, v.contentType!);
  return { url, fileName: (file as File).name.slice(0, 200), contentType: CONTENT_TYPES[v.ext!], sizeBytes: v.bytes!.length };
}

// In-page creation-page popups. Each updates the real record and the caller refreshes the form
// (router.refresh) so the From/To cards / number reflect the change immediately while the rest of
// the unsaved form state is preserved. All tenant-scoped, audited.

export type PopupResult = { error?: string; ok?: boolean };

// From-card "Edit business details" popup. Partial update of only the contact fields the popup
// shows — other org settings (tax id, currency, branding…) are untouched.
export async function updateOrgContactAction(input: { name: string; email: string; phone: string; address: string }): Promise<PopupResult> {
  const session = await requireSession();
  if (session.role === "staff") return { error: "You don't have permission to edit business details." };
  const name = input.name.trim();
  if (!name) return { error: "Business name is required." };
  await db
    .update(orgsTable)
    .set({ name, email: input.email.trim() || null, phone: input.phone.trim() || null, address: input.address.trim() || null, updatedAt: new Date() })
    .where(eq(orgsTable.id, session.orgId));
  await logActivity(session, { type: "org.updated", description: "Updated business contact details", entityType: "org", entityId: session.orgId });
  return { ok: true };
}

// To-card "Edit" popup for a client (customer). Tenant-scoped partial update.
export async function updatePartyContactAction(
  party: "client" | "vendor",
  id: number,
  input: { name: string; email: string; phone: string; address: string },
): Promise<PopupResult> {
  const session = await requireSession();
  const name = input.name.trim();
  if (!name) return { error: "Name is required." };
  const values = { name, email: input.email.trim() || null, phone: input.phone.trim() || null, address: input.address.trim() || null };
  if (party === "client") {
    const res = await db.update(customersTable).set(values).where(and(eq(customersTable.id, id), eq(customersTable.orgId, session.orgId))).returning({ id: customersTable.id });
    if (!res.length) return { error: "Client not found." };
    await logActivity(session, { type: "client.updated", description: `Updated client "${name}"`, entityType: "client", entityId: id });
  } else {
    const res = await db.update(vendorsTable).set(values).where(and(eq(vendorsTable.id, id), eq(vendorsTable.orgId, session.orgId))).returning({ id: vendorsTable.id });
    if (!res.length) return { error: "Vendor not found." };
    await logActivity(session, { type: "vendor.updated", description: `Updated vendor "${name}"`, entityType: "vendor", entityId: id });
  }
  return { ok: true };
}

export type SequenceDTO = { id: number; prefix: string; nextNumber: number; padding: number };

// Number gear popup — load the current numbering rule for a document type.
export async function getDocumentSequenceAction(documentType: string): Promise<SequenceDTO | null> {
  const session = await requireSession();
  const [row] = await db
    .select({ id: documentSequencesTable.id, prefix: documentSequencesTable.prefix, nextNumber: documentSequencesTable.nextNumber, padding: documentSequencesTable.padding })
    .from(documentSequencesTable)
    .where(and(eq(documentSequencesTable.orgId, session.orgId), eq(documentSequencesTable.documentType, documentType)));
  return row ?? null;
}

// Number gear popup — save the numbering rule (prefix / next number / padding).
export async function saveDocumentSequenceAction(id: number, prefix: string, nextNumber: string, padding: string): Promise<PopupResult> {
  const session = await requireSession();
  if (session.role === "staff") return { error: "You don't have permission to change numbering." };
  const next = Number(nextNumber);
  const pad = Number(padding);
  if (!prefix.trim()) return { error: "Prefix is required." };
  if (Number.isNaN(next) || next < 1) return { error: "Next number must be at least 1." };
  if (Number.isNaN(pad) || pad < 1 || pad > 10) return { error: "Padding must be between 1 and 10." };
  const res = await db
    .update(documentSequencesTable)
    .set({ prefix: prefix.trim(), nextNumber: next, padding: pad })
    .where(and(eq(documentSequencesTable.id, id), eq(documentSequencesTable.orgId, session.orgId)))
    .returning({ id: documentSequencesTable.id });
  if (!res.length) return { error: "Not found." };
  await logActivity(session, { type: "document-sequence.updated", description: `Updated numbering: ${prefix.trim()}`, entityType: "document_sequence", entityId: id });
  return { ok: true };
}
