"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, orgsTable, sealSignatureAssetsTable } from "@/db";
import { requireRole } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { validateUpload, storeBlob, deleteStoredBlob, IMAGE_MAX_BYTES } from "@/lib/storage/blob-storage";
import { isBuiltInLayout, DOCUMENT_COLOR_THEMES, PRINTABLE_DOC_TYPES } from "@/lib/doc-print";

export type ActionResult = { error?: string };

const PATH = "/settings/presets";

// ---------------------------------------------------------------------------
// Print Layout preset (Preset Management → Print Layout)
// ---------------------------------------------------------------------------

export async function updatePrintLayoutPresetAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");

  const defaultLayout = String(formData.get("printLayout") ?? "classic");
  if (!(isBuiltInLayout(defaultLayout) || defaultLayout === "custom")) return { error: "Invalid layout." };

  const paperSize = String(formData.get("paperSize") ?? "A4");
  if (!["A4", "Letter"].includes(paperSize)) return { error: "Invalid paper size." };

  const margin = Number(formData.get("printMarginMm"));
  if (Number.isNaN(margin) || margin < 0 || margin > 50) return { error: "Margin must be between 0 and 50mm." };

  const colorTheme = String(formData.get("documentColorTheme") ?? "orange");
  if (!DOCUMENT_COLOR_THEMES.some((t) => t.value === colorTheme)) return { error: "Invalid color theme." };

  // Per-document-type layout overrides: only keep valid, non-"default" entries.
  const overrides: Record<string, string> = {};
  for (const { type } of PRINTABLE_DOC_TYPES) {
    const v = String(formData.get(`layout__${type}`) ?? "");
    if (v && v !== "default" && (isBuiltInLayout(v) || v === "custom")) overrides[type] = v;
  }

  // Guard: "custom" requires an uploaded letterhead.
  const [org] = await db.select({ customLayoutUrl: orgsTable.customLayoutUrl }).from(orgsTable).where(eq(orgsTable.id, session.orgId));
  const usesCustom = defaultLayout === "custom" || Object.values(overrides).includes("custom");
  if (usesCustom && !org?.customLayoutUrl) return { error: "Upload a custom document design before selecting the Custom layout." };

  await db
    .update(orgsTable)
    .set({
      printLayout: defaultLayout,
      paperSize,
      printMarginMm: margin,
      documentColorTheme: colorTheme,
      documentLayoutOverrides: Object.keys(overrides).length ? overrides : null,
      updatedAt: new Date(),
    })
    .where(eq(orgsTable.id, session.orgId));

  await logActivity(session, { type: "org.print_layout_updated", description: "Updated document print layout", entityType: "org", entityId: session.orgId });
  revalidatePath(PATH);
  return {};
}

// Custom document design (letterhead/background). Validated + org-scoped in the private uploads store.
export async function uploadCustomLayoutAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const v = await validateUpload(formData.get("customLayout"), { kind: "image", maxBytes: IMAGE_MAX_BYTES, maxDimension: 3000 });
  if (v.error) return { error: v.error };

  const newUrl = await storeBlob(session.orgId, "layouts", v.bytes!, v.ext!, v.contentType!);
  const [prev] = await db.select({ customLayoutUrl: orgsTable.customLayoutUrl }).from(orgsTable).where(eq(orgsTable.id, session.orgId));
  await db.update(orgsTable).set({ customLayoutUrl: newUrl, updatedAt: new Date() }).where(eq(orgsTable.id, session.orgId));
  await deleteStoredBlob(prev?.customLayoutUrl);
  await logActivity(session, { type: "org.custom_layout_uploaded", description: "Uploaded custom document design", entityType: "org", entityId: session.orgId });
  revalidatePath(PATH);
  return {};
}

// ---------------------------------------------------------------------------
// Seal & Signature preset (Preset Management → Seal & Signature)
// ---------------------------------------------------------------------------

const SEAL_DIMS = { width: 600, height: 600 };
const SIGNATURE_DIMS = { width: 1200, height: 400 };

export async function uploadSealAssetAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const kind = String(formData.get("kind") ?? "");
  if (kind !== "seal" && kind !== "signature") return { error: "Invalid asset kind." };
  const name = String(formData.get("name") ?? "").trim().slice(0, 80) || (kind === "seal" ? "Seal" : "Signature");

  const v = await validateUpload(formData.get("file"), {
    kind: "image",
    maxBytes: IMAGE_MAX_BYTES,
    exactDimensions: kind === "seal" ? SEAL_DIMS : SIGNATURE_DIMS,
  });
  if (v.error) return { error: v.error };

  const url = await storeBlob(session.orgId, kind === "seal" ? "seals" : "signatures", v.bytes!, v.ext!, v.contentType!);
  await db.insert(sealSignatureAssetsTable).values({ orgId: session.orgId, kind, name, url });
  await logActivity(session, { type: "org.seal_asset_added", description: `Added ${kind}`, entityType: "org", entityId: session.orgId });
  revalidatePath(PATH);
  return {};
}

export async function deleteSealAssetAction(id: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const [asset] = await db
    .select()
    .from(sealSignatureAssetsTable)
    .where(and(eq(sealSignatureAssetsTable.id, id), eq(sealSignatureAssetsTable.orgId, session.orgId)));
  if (!asset) return { error: "Asset not found." };

  // Clear any per-document-type default that referenced this asset (documents keep their snapshot).
  const [org] = await db.select({ sealDefaults: orgsTable.sealDefaults }).from(orgsTable).where(eq(orgsTable.id, session.orgId));
  const defaults = { ...(org?.sealDefaults ?? {}) };
  let changed = false;
  for (const key of Object.keys(defaults)) {
    const entry = { ...defaults[key] };
    if (asset.kind === "seal" && entry.sealAssetId === id) { entry.sealAssetId = null; changed = true; }
    if (asset.kind === "signature" && entry.signatureAssetId === id) { entry.signatureAssetId = null; changed = true; }
    defaults[key] = entry;
  }

  await db.delete(sealSignatureAssetsTable).where(and(eq(sealSignatureAssetsTable.id, id), eq(sealSignatureAssetsTable.orgId, session.orgId)));
  if (changed) await db.update(orgsTable).set({ sealDefaults: defaults, updatedAt: new Date() }).where(eq(orgsTable.id, session.orgId));
  await deleteStoredBlob(asset.url);
  revalidatePath(PATH);
  return {};
}

export async function updateSealDefaultsAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const assets = await db
    .select({ id: sealSignatureAssetsTable.id, kind: sealSignatureAssetsTable.kind })
    .from(sealSignatureAssetsTable)
    .where(eq(sealSignatureAssetsTable.orgId, session.orgId));
  const sealIds = new Set(assets.filter((a) => a.kind === "seal").map((a) => a.id));
  const sigIds = new Set(assets.filter((a) => a.kind === "signature").map((a) => a.id));

  const defaults: Record<string, { sealAssetId?: number | null; signatureAssetId?: number | null }> = {};
  for (const { type } of PRINTABLE_DOC_TYPES) {
    const sealRaw = String(formData.get(`seal__${type}`) ?? "");
    const sigRaw = String(formData.get(`signature__${type}`) ?? "");
    const sealAssetId = sealRaw && sealRaw !== "none" && sealIds.has(Number(sealRaw)) ? Number(sealRaw) : null;
    const signatureAssetId = sigRaw && sigRaw !== "none" && sigIds.has(Number(sigRaw)) ? Number(sigRaw) : null;
    if (sealAssetId != null || signatureAssetId != null) defaults[type] = { sealAssetId, signatureAssetId };
  }

  await db
    .update(orgsTable)
    .set({ sealDefaults: Object.keys(defaults).length ? defaults : null, updatedAt: new Date() })
    .where(eq(orgsTable.id, session.orgId));
  await logActivity(session, { type: "org.seal_defaults_updated", description: "Updated per-document seal & signature defaults", entityType: "org", entityId: session.orgId });
  revalidatePath(PATH);
  return {};
}
