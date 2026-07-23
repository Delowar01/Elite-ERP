"use server";

import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db, orgsTable, customersTable, vendorsTable, documentSequencesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";

// Magic-byte sniff (client MIME is spoofable) — png/jpg for images, %PDF for attachments.
function sniff(bytes: Buffer, allowPdf: boolean): "png" | "jpg" | "pdf" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (allowPdf && bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  return null;
}

async function storeUpload(file: File, folder: string, orgId: number, allowPdf: boolean): Promise<{ url: string; ext: string } | null> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = sniff(bytes, allowPdf);
  if (!ext) return null;
  const filename = `${orgId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  const dir = path.join(process.cwd(), "uploads", folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), bytes);
  return { url: `/uploads/${folder}/${filename}`, ext };
}

export type UploadResult = { error?: string; url?: string; fileName?: string; contentType?: string; sizeBytes?: number };

// Item image upload (Line Items → Add Image). Stores the file and returns its URL; the URL is held
// in the line-item draft and persisted with the document (imageUrl column) on save.
export async function uploadItemImageAction(formData: FormData): Promise<UploadResult> {
  const session = await requireSession();
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > 2 * 1024 * 1024) return { error: "File must be under 2 MB." };
  const stored = await storeUpload(file, "item-images", session.orgId, false);
  if (!stored) return { error: "File content is not a valid PNG or JPG image." };
  return { url: stored.url };
}

// Document attachment upload (Terms, Notes & Attachments → Add Attachment). Stores the file and
// returns metadata; the create/update action inserts the document_attachments row on save so the
// attachment is tied to the real document. PDF/PNG/JPG only.
export async function uploadDocumentAttachmentAction(formData: FormData): Promise<UploadResult> {
  const session = await requireSession();
  const file = formData.get("attachment");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > 8 * 1024 * 1024) return { error: "File must be under 8 MB." };
  const stored = await storeUpload(file, "attachments", session.orgId, true);
  if (!stored) return { error: "PDF, PNG or JPG only." };
  return { url: stored.url, fileName: file.name.slice(0, 200), contentType: stored.ext === "pdf" ? "application/pdf" : stored.ext === "png" ? "image/png" : "image/jpeg", sizeBytes: file.size };
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
