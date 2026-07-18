"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { db, orgsTable, bankAccountsTable } from "@/db";
import { requireRole } from "@/lib/session";
import { logActivity } from "@/lib/activity";

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

// PNG/JPG only, validated by magic bytes (client MIME is spoofable), stored OUTSIDE public/
// and served through the authenticated, org-scoped /uploads route — SVG is excluded entirely
// because an SVG served from the app origin can carry scripts (security audit, High #2 + Medium #5).
function sniffImage(bytes: Buffer): "png" | "jpg" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

async function saveUpload(file: File, folder: string, orgId: number): Promise<string | null> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = sniffImage(bytes);
  if (!ext) return null;
  const filename = `${orgId}-${Date.now()}.${ext}`;
  const dir = path.join(process.cwd(), "uploads", folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), bytes);
  return `/uploads/${folder}/${filename}`;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);

export async function uploadLogoAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return { error: "PNG or JPG only." };
  if (file.size > 2 * 1024 * 1024) return { error: "File must be under 2 MB." };

  const url = await saveUpload(file, "logos", session.orgId);
  if (!url) return { error: "File content is not a valid PNG or JPG image." };
  await db.update(orgsTable).set({ logoUrl: url, updatedAt: new Date() }).where(eq(orgsTable.id, session.orgId));
  revalidatePath(PATH);
  revalidatePath("/", "layout");
  return {};
}

export async function uploadSealSignatureAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const seal = formData.get("seal");
  const signature = formData.get("signature");
  const updates: { sealUrl?: string; signatureUrl?: string } = {};

  if (seal instanceof File && seal.size > 0) {
    if (!ALLOWED_IMAGE_TYPES.has(seal.type)) return { error: "Seal: PNG or JPG only." };
    if (seal.size > 2 * 1024 * 1024) return { error: "Seal: file must be under 2 MB." };
    const url = await saveUpload(seal, "seals", session.orgId);
    if (!url) return { error: "Seal: file content is not a valid PNG or JPG image." };
    updates.sealUrl = url;
  }
  if (signature instanceof File && signature.size > 0) {
    if (!ALLOWED_IMAGE_TYPES.has(signature.type)) return { error: "Signature: PNG or JPG only." };
    if (signature.size > 2 * 1024 * 1024) return { error: "Signature: file must be under 2 MB." };
    const url = await saveUpload(signature, "signatures", session.orgId);
    if (!url) return { error: "Signature: file content is not a valid PNG or JPG image." };
    updates.signatureUrl = url;
  }
  if (!updates.sealUrl && !updates.signatureUrl) return { error: "Choose at least one file to upload." };

  await db.update(orgsTable).set({ ...updates, updatedAt: new Date() }).where(eq(orgsTable.id, session.orgId));
  revalidatePath(PATH);
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
