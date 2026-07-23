"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, orgsTable, bankAccountsTable } from "@/db";
import { requireRole } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { validateUpload, storeBlob, deleteStoredBlob, IMAGE_MAX_BYTES } from "@/lib/storage/blob-storage";

export type ActionResult = { error?: string };

const PATH = "/settings/organization";

export async function updateBusinessDetailsAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Business name is required." };

  await db
    .update(orgsTable)
    .set({
      name,
      industry: String(formData.get("industry") ?? "").trim() || null,
      address: String(formData.get("address") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      taxId: String(formData.get("taxId") ?? "").trim() || null,
      vatNumber: String(formData.get("vatNumber") ?? "").trim() || null,
      currency: String(formData.get("currency") ?? "SAR").trim() || "SAR",
      country: String(formData.get("country") ?? "").trim() || null,
      defaultLanguage: formData.get("defaultLanguage") === "ar" ? "ar" : "en",
      updatedAt: new Date(),
    })
    .where(eq(orgsTable.id, session.orgId));

  await logActivity(session, {
    type: "org.updated",
    description: "Updated business details",
    entityType: "org",
    entityId: session.orgId,
  });
  revalidatePath(PATH);
  return {};
}

export async function updateColorThemeAction(primaryColor: string, accentColor: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (!hex.test(primaryColor) || !hex.test(accentColor)) return { error: "Colors must be valid hex codes (e.g. #1B1B4E)." };

  await db
    .update(orgsTable)
    .set({ primaryColor, accentColor, updatedAt: new Date() })
    .where(eq(orgsTable.id, session.orgId));
  revalidatePath(PATH);
  revalidatePath("/", "layout");
  return {};
}

// Company logo — cropped client-side; PNG/JPG only, validated by magic bytes + size + dimensions,
// stored on Vercel Blob (tenant-scoped) and served through the authenticated /uploads proxy. SVG is
// excluded (no safe sanitizer). Replace flow: validate → upload new → update DB → delete old blob.
export async function uploadLogoAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const v = await validateUpload(formData.get("logo"), { kind: "image", maxBytes: IMAGE_MAX_BYTES, maxDimension: 2000 });
  if (v.error) return { error: v.error };

  const newUrl = await storeBlob(session.orgId, "logos", v.bytes!, v.ext!, v.contentType!);
  const [prev] = await db.select({ logoUrl: orgsTable.logoUrl }).from(orgsTable).where(eq(orgsTable.id, session.orgId));
  await db.update(orgsTable).set({ logoUrl: newUrl, updatedAt: new Date() }).where(eq(orgsTable.id, session.orgId));
  await deleteStoredBlob(prev?.logoUrl); // only after the DB update succeeds
  await logActivity(session, { type: "org.logo_updated", description: "Updated company logo", entityType: "org", entityId: session.orgId });
  revalidatePath(PATH);
  revalidatePath("/", "layout");
  return {};
}

export async function uploadSealSignatureAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const seal = formData.get("seal");
  const signature = formData.get("signature");
  const updates: { sealUrl?: string; signatureUrl?: string } = {};
  const oldBlobs: (string | null | undefined)[] = [];

  if (seal instanceof File && seal.size > 0) {
    const v = await validateUpload(seal, { kind: "image", maxBytes: IMAGE_MAX_BYTES, exactDimensions: { width: 600, height: 600 } });
    if (v.error) return { error: `Seal: ${v.error}` };
    updates.sealUrl = await storeBlob(session.orgId, "seals", v.bytes!, v.ext!, v.contentType!);
  }
  if (signature instanceof File && signature.size > 0) {
    const v = await validateUpload(signature, { kind: "image", maxBytes: IMAGE_MAX_BYTES, exactDimensions: { width: 1200, height: 400 } });
    if (v.error) return { error: `Signature: ${v.error}` };
    updates.signatureUrl = await storeBlob(session.orgId, "signatures", v.bytes!, v.ext!, v.contentType!);
  }
  if (!updates.sealUrl && !updates.signatureUrl) return { error: "Choose at least one file to upload." };

  const [prev] = await db.select({ sealUrl: orgsTable.sealUrl, signatureUrl: orgsTable.signatureUrl }).from(orgsTable).where(eq(orgsTable.id, session.orgId));
  if (updates.sealUrl) oldBlobs.push(prev?.sealUrl);
  if (updates.signatureUrl) oldBlobs.push(prev?.signatureUrl);
  await db.update(orgsTable).set({ ...updates, updatedAt: new Date() }).where(eq(orgsTable.id, session.orgId));
  for (const old of oldBlobs) await deleteStoredBlob(old);
  await logActivity(session, { type: "org.seal_signature_updated", description: "Updated seal / signature", entityType: "org", entityId: session.orgId });
  revalidatePath(PATH);
  revalidatePath("/", "layout");
  return {};
}

export async function updatePrintLayoutAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const printLayout = String(formData.get("printLayout") ?? "classic");
  const paperSize = String(formData.get("paperSize") ?? "A4");
  const margin = Number(formData.get("printMarginMm"));
  if (!["classic", "modern", "minimal"].includes(printLayout)) return { error: "Invalid layout." };
  if (Number.isNaN(margin) || margin < 0 || margin > 50) return { error: "Margin must be between 0 and 50mm." };

  await db
    .update(orgsTable)
    .set({ printLayout, paperSize, printMarginMm: margin, updatedAt: new Date() })
    .where(eq(orgsTable.id, session.orgId));
  revalidatePath(PATH);
  return {};
}

export async function updateDefaultBankAccountAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const defaultBankAccountIdRaw = String(formData.get("defaultBankAccountId") ?? "");

  let defaultBankAccountId: number | null = null;
  if (defaultBankAccountIdRaw) {
    const id = Number(defaultBankAccountIdRaw);
    const [account] = await db
      .select({ id: bankAccountsTable.id })
      .from(bankAccountsTable)
      .where(and(eq(bankAccountsTable.id, id), eq(bankAccountsTable.orgId, session.orgId)));
    if (!account) return { error: "Bank account not found." };
    defaultBankAccountId = id;
  }

  await db
    .update(orgsTable)
    .set({ defaultBankAccountId, updatedAt: new Date() })
    .where(eq(orgsTable.id, session.orgId));
  revalidatePath(PATH);
  return {};
}

export async function updateFiscalYearAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const fiscalYearStartMonth = Number(formData.get("fiscalYearStartMonth"));
  if (Number.isNaN(fiscalYearStartMonth) || fiscalYearStartMonth < 1 || fiscalYearStartMonth > 12) {
    return { error: "Fiscal year start must be a month between 1 and 12." };
  }

  await db
    .update(orgsTable)
    .set({ fiscalYearStartMonth, updatedAt: new Date() })
    .where(eq(orgsTable.id, session.orgId));
  revalidatePath(PATH);
  return {};
}

export async function updateVatConfigAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const vatRegistrationStatus = String(formData.get("vatRegistrationStatus") ?? "registered");
  const defaultTaxTreatment = String(formData.get("defaultTaxTreatment") ?? "exclusive");
  const vatRounding = String(formData.get("vatRounding") ?? "nearest_0_01");

  await db
    .update(orgsTable)
    .set({ vatRegistrationStatus, defaultTaxTreatment, vatRounding, updatedAt: new Date() })
    .where(eq(orgsTable.id, session.orgId));
  revalidatePath(PATH);
  return {};
}
