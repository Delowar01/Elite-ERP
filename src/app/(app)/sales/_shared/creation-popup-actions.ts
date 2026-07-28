"use server";

import { and, eq } from "drizzle-orm";
import { db, orgsTable, customersTable, vendorsTable, documentSequencesTable, productsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { validateUpload, storeBlob, IMAGE_MAX_BYTES, ATTACHMENT_MAX_BYTES, CONTENT_TYPES } from "@/lib/storage/blob-storage";
import { buildingNumberError, postalCodeError, composeAddress } from "@/lib/geo/countries";
import { sanitizeIfHtml } from "@/lib/sanitize-html";

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

// To-card "Edit" popup for a client (customer) or vendor. Tenant-scoped partial update. For clients,
// the popup also carries the Client Type + structured address (kept in-page, no redirect).
export async function updatePartyContactAction(
  party: "client" | "vendor",
  id: number,
  input: {
    name: string; email: string; phone: string; address: string;
    clientType?: string;
    countryCode?: string; stateProvince?: string; district?: string; city?: string;
    buildingNumber?: string; additionalNumber?: string; postalCode?: string; streetAddress?: string;
  },
): Promise<PopupResult> {
  const session = await requireSession();
  const name = input.name.trim();
  if (!name) return { error: "Name is required." };
  const base = { name, email: input.email.trim() || null, phone: input.phone.trim() || null };
  if (party === "client") {
    const countryCode = (input.countryCode ?? "").trim().toUpperCase() || null;
    const buildingNumber = (input.buildingNumber ?? "").trim() || null;
    const postalCode = (input.postalCode ?? "").trim() || null;
    if (buildingNumberError(countryCode, buildingNumber ?? "")) return { error: "Building number must be 4 digits." };
    if (postalCodeError(postalCode ?? "")) return { error: "Enter a valid postal / zip code." };
    const structured = {
      countryCode,
      stateProvince: (input.stateProvince ?? "").trim() || null,
      district: (input.district ?? "").trim() || null,
      city: (input.city ?? "").trim() || null,
      buildingNumber,
      additionalNumber: (input.additionalNumber ?? "").trim() || null,
      postalCode,
      streetAddress: (input.streetAddress ?? "").trim() || null,
    };
    const composed = composeAddress(structured);
    const values = {
      ...base,
      clientType: input.clientType === "company" ? "company" : "individual",
      ...structured,
      address: composed || input.address.trim() || null,
    };
    const res = await db.update(customersTable).set(values).where(and(eq(customersTable.id, id), eq(customersTable.orgId, session.orgId))).returning({ id: customersTable.id });
    if (!res.length) return { error: "Client not found." };
    await logActivity(session, { type: "client.updated", description: `Updated client "${name}"`, entityType: "client", entityId: id });
  } else {
    const values = { ...base, address: input.address.trim() || null };
    const res = await db.update(vendorsTable).set(values).where(and(eq(vendorsTable.id, id), eq(vendorsTable.orgId, session.orgId))).returning({ id: vendorsTable.id });
    if (!res.length) return { error: "Vendor not found." };
    await logActivity(session, { type: "vendor.updated", description: `Updated vendor "${name}"`, entityType: "vendor", entityId: id });
  }
  return { ok: true };
}

// "Save this item" popup (Line Items). Promotes a typed document line into a saved product in the
// master, capturing name / description / image / unit / rate / tax, and returns the new product so
// the editor can auto-link the line and offer it in future searches — all in-page, unsaved document
// data preserved. Description is sanitized server-side (authoritative). Tenant-scoped, audited.
export type SavedItem = {
  id: number;
  name: string;
  sku: string;
  description: string | null;
  imageUrl: string | null;
  unit: string;
  unitPrice: string;
  taxRatePercent: string;
};
export type SaveItemResult = { error?: string; product?: SavedItem };

// Build a unique, human-ish SKU from the item name (falls back to ITEM), scoped to the org.
async function uniqueSku(orgId: number, name: string): Promise<string> {
  const base = (name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "ITEM");
  for (let n = 1; n <= 9999; n++) {
    const candidate = `${base}-${String(n).padStart(3, "0")}`;
    const [hit] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(and(eq(productsTable.orgId, orgId), eq(productsTable.sku, candidate)))
      .limit(1);
    if (!hit) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function saveLineItemAsProductAction(input: {
  name: string;
  description?: string;
  imageUrl?: string;
  unit?: string;
  unitPrice?: string;
  taxRatePercent?: string;
}): Promise<SaveItemResult> {
  const session = await requireSession();
  const name = input.name.trim();
  if (!name) return { error: "Item name is required." };
  const unit = (input.unit ?? "").trim() || "pcs";
  const unitPrice = String(input.unitPrice ?? "0").trim() || "0";
  const taxRatePercent = String(input.taxRatePercent ?? "15").trim() || "15";
  const description = sanitizeIfHtml(input.description) || null;
  const imageUrl = (input.imageUrl ?? "").trim() || null;

  const sku = await uniqueSku(session.orgId, name);
  const [row] = await db
    .insert(productsTable)
    .values({ orgId: session.orgId, sku, name, description, imageUrl, unit, unitPrice, taxRatePercent })
    .returning({
      id: productsTable.id,
      name: productsTable.name,
      sku: productsTable.sku,
      description: productsTable.description,
      imageUrl: productsTable.imageUrl,
      unit: productsTable.unit,
      unitPrice: productsTable.unitPrice,
      taxRatePercent: productsTable.taxRatePercent,
    });

  await logActivity(session, {
    type: "product.created",
    description: `Created product "${name}" (${sku}) from a document line`,
    entityType: "product",
    entityId: row.id,
  });
  return { product: row };
}

// "Save to Item": explicitly push a document line's description onto the linked product's master
// record. Only called on user request (existing items are never silently updated from a document);
// for items created in-place we call this automatically since the item is brand-new. Tenant-scoped;
// description is sanitized server-side.
export async function updateProductDescriptionAction(productId: number, description: string): Promise<PopupResult> {
  const session = await requireSession();
  const res = await db
    .update(productsTable)
    .set({ description: sanitizeIfHtml(description) || null, updatedAt: new Date() })
    .where(and(eq(productsTable.id, productId), eq(productsTable.orgId, session.orgId)))
    .returning({ id: productsTable.id });
  if (!res.length) return { error: "Item not found." };
  await logActivity(session, { type: "product.updated", description: `Updated item description from a document`, entityType: "product", entityId: productId });
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
