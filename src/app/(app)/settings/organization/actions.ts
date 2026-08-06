"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, orgsTable, bankAccountsTable } from "@/db";
import { requireRole, requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { recordAudit } from "@/lib/security/audit";
import { getProfileByCountryName, profileHasFeature } from "@/lib/geo/country-profiles";
import { validateUpload, storeBlob, deleteStoredBlob, IMAGE_MAX_BYTES } from "@/lib/storage/blob-storage";
import { isValidCurrencyCode } from "@/lib/currency/currencies";
import {
  isColorThemeMode, HEX_COLOR, THEME_COMPONENTS, APPEARANCES,
  normalizeOverrides,
  type ThemeOverrides, type ThemeOverridesByMode, type Appearance,
} from "@/lib/brand-theme";

export type ActionResult = { error?: string };

const PATH = "/settings/organization";

export async function updateBusinessDetailsAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Business name is required." };

  // Currency must be a known ISO 4217 code from the shared catalog.
  const currency = String(formData.get("currency") ?? "SAR").trim().toUpperCase() || "SAR";
  if (!isValidCurrencyCode(currency)) return { error: "Choose a valid currency." };

  await db
    .update(orgsTable)
    .set({
      name,
      industry: String(formData.get("industry") ?? "").trim() || null,
      address: String(formData.get("address") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      taxId: String(formData.get("taxId") ?? "").trim() || null,
      vatNumber: String(formData.get("vatNumber") ?? "").trim() || null,
      currency,
      country: String(formData.get("country") ?? "").trim() || null,
      // Country-profile overrides (only meaningful for the configurable Global profile).
      customTaxName: String(formData.get("customTaxName") ?? "").trim() || null,
      customTaxNumberLabel: String(formData.get("customTaxNumberLabel") ?? "").trim() || null,
      customRegistrationLabel: String(formData.get("customRegistrationLabel") ?? "").trim() || null,
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

export async function updateColorThemeAction(payload: {
  mode: string;
  primaryColor: string;
  accentColor: string;
  gradientFrom: string;
  gradientTo: string;
  overrides?: ThemeOverridesByMode | ThemeOverrides | null;
}): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!isColorThemeMode(payload.mode)) return { error: "Choose a valid theme mode." };
  const cols = [payload.primaryColor, payload.accentColor, payload.gradientFrom, payload.gradientTo];
  // Validate + persist every main color so all four are kept regardless of the active mode.
  if (!cols.every((c) => HEX_COLOR.test(c))) return { error: "Colors must be valid hex codes (e.g. #1B1B4E)." };

  // Sanitize manual overrides: keep only valid hex. Low contrast is a WARNING, never a blocker —
  // the panel shows the measured ratio and the recommended minimum, and the org's chosen colours are
  // persisted exactly as picked. Nothing here silently substitutes a different colour.
  // Clean each appearance INDEPENDENTLY: a light-mode override never touches the dark-mode value
  // (and vice versa).
  const incoming = normalizeOverrides(payload.overrides ?? null);
  const cleanedByMode: ThemeOverridesByMode = {};
  for (const appearance of APPEARANCES as Appearance[]) {
    const src = incoming[appearance] ?? {};
    const cleaned: ThemeOverrides = {};
    for (const c of THEME_COMPONENTS) {
      const o = src[c];
      if (!o) continue;
      const entry: { bg?: string; fg?: string } = {};
      if (o.bg && HEX_COLOR.test(o.bg)) entry.bg = o.bg;
      // Saved exactly as chosen, even when the contrast is low — the user was warned and decided.
      if (o.fg && HEX_COLOR.test(o.fg)) entry.fg = o.fg;
      if (entry.bg || entry.fg) cleaned[c] = entry;
    }
    if (Object.keys(cleaned).length) cleanedByMode[appearance] = cleaned;
  }
  const hasOverrides = Boolean(cleanedByMode.light || cleanedByMode.dark);

  await db
    .update(orgsTable)
    .set({
      colorThemeMode: payload.mode,
      primaryColor: payload.primaryColor,
      accentColor: payload.accentColor,
      gradientFrom: payload.gradientFrom,
      gradientTo: payload.gradientTo,
      themeOverrides: hasOverrides ? cleanedByMode : null,
      updatedAt: new Date(),
    })
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

// ZATCA Phase 1 — enable only. Eligible Saudi organizations may turn Phase 1 on (after an
// explicit confirmation in the UI). Once on, organization users can NOT turn it off: there is
// deliberately no org-facing disable action. Only a backend administrator / Elite Marcom Platform
// Owner may disable it, via disableZatcaPhase1Backend() below. Both events are audit-logged.
export async function enableZatcaPhase1Action(): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const [org] = await db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId));
  if (!org) return { error: "Organization not found." };
  // Eligibility: only countries whose profile enables ZATCA Phase 1 (Saudi Arabia today).
  const profile = getProfileByCountryName(org.country);
  if (!profileHasFeature(profile, "zatca_phase1")) {
    return { error: "ZATCA Phase 1 is only available for eligible Saudi Arabian organizations." };
  }
  if (org.zatcaPhase1Enabled) return {}; // already on — idempotent, stays locked

  await db.update(orgsTable).set({ zatcaPhase1Enabled: true, updatedAt: new Date() }).where(eq(orgsTable.id, session.orgId));
  await recordAudit(
    { orgId: session.orgId, userId: session.userId, userName: session.name },
    {
      action: "zatca.phase1_enabled",
      entityType: "org",
      entityId: session.orgId,
      previousValue: { zatcaPhase1Enabled: false },
      newValue: { zatcaPhase1Enabled: true },
    },
  );
  await logActivity(session, { type: "org.zatca_phase1_enabled", description: "Enabled ZATCA Phase 1 e-invoicing", entityType: "org", entityId: session.orgId });
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
  // Tax/VAT registration number (the org's "tax-number" setting). Trimmed; empty clears it.
  const vatNumber = String(formData.get("vatNumber") ?? "").trim().slice(0, 40) || null;

  await db
    .update(orgsTable)
    .set({ vatRegistrationStatus, defaultTaxTreatment, vatRounding, vatNumber, updatedAt: new Date() })
    .where(eq(orgsTable.id, session.orgId));
  revalidatePath(PATH);
  return {};
}

// Remembers the "Valid Till = Issue Date + N days" offset (Issue #4). Called from the Valid Till
// gear popup on a document so the last-used number of days persists for future documents.
export async function updateValidityDaysAction(days: number): Promise<ActionResult> {
  const session = await requireSession();
  const n = Number.isFinite(days) ? Math.min(3650, Math.max(0, Math.round(days))) : 30;
  await db.update(orgsTable).set({ defaultValidityDays: n, updatedAt: new Date() }).where(eq(orgsTable.id, session.orgId));
  revalidatePath(PATH);
  return {};
}

export async function updateNumberFormatAction(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");

  // Digit grouping + decimal places are display-only settings, validated to the supported values.
  const numberDigitGrouping = String(formData.get("numberDigitGrouping") ?? "international") === "indian" ? "indian" : "international";
  const rawDecimals = Number(formData.get("numberDecimalPlaces") ?? 2);
  const numberDecimalPlaces = [0, 1, 2, 3].includes(rawDecimals) ? rawDecimals : 2;
  const roundQuantities = String(formData.get("roundQuantities") ?? "0") === "1";
  const roundRates = String(formData.get("roundRates") ?? "0") === "1";
  // Custom symbol: trimmed, capped; empty clears it (falls back to the official symbol / code).
  const customCurrencySymbol = String(formData.get("customCurrencySymbol") ?? "").trim().slice(0, 8) || null;

  await db
    .update(orgsTable)
    .set({ numberDigitGrouping, numberDecimalPlaces, roundQuantities, roundRates, customCurrencySymbol, updatedAt: new Date() })
    .where(eq(orgsTable.id, session.orgId));
  revalidatePath(PATH);
  return {};
}
