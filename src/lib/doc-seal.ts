import "server-only";
import { eq } from "drizzle-orm";
import { db, orgsTable, sealSignatureAssetsTable, type Tx } from "@/db";

// Resolve the seal / signature to snapshot onto a NEW document of `documentType`, from the org's
// Preset Management → Seal & Signature per-document-type defaults (falling back to the org-wide
// seal/signature for unmapped types / legacy orgs). Snapshotting at save is what makes later preset
// changes affect new documents only — saved documents keep their captured seal & signature.
export type SealSnapshot = { sealUrl: string | null; signatureUrl: string | null };

export async function snapshotSealForDoc(
  runner: Pick<typeof db, "select"> | Tx,
  orgId: number,
  documentType: string,
): Promise<SealSnapshot> {
  const [org] = await runner
    .select({ sealDefaults: orgsTable.sealDefaults, sealUrl: orgsTable.sealUrl, signatureUrl: orgsTable.signatureUrl })
    .from(orgsTable)
    .where(eq(orgsTable.id, orgId));
  if (!org) return { sealUrl: null, signatureUrl: null };

  const map = org.sealDefaults?.[documentType];
  let sealUrl: string | null = org.sealUrl ?? null;
  let signatureUrl: string | null = org.signatureUrl ?? null;

  if (map && (map.sealAssetId != null || map.signatureAssetId != null)) {
    const assets = await runner
      .select({ id: sealSignatureAssetsTable.id, url: sealSignatureAssetsTable.url })
      .from(sealSignatureAssetsTable)
      .where(eq(sealSignatureAssetsTable.orgId, orgId));
    const urlOf = (id?: number | null) => (id == null ? null : assets.find((a) => a.id === id)?.url ?? null);
    if (map.sealAssetId != null) sealUrl = urlOf(map.sealAssetId);
    if (map.signatureAssetId != null) signatureUrl = urlOf(map.signatureAssetId);
  }
  return { sealUrl, signatureUrl };
}

// Apply an optional per-document override on top of the resolved default. An override URL of ""
// (empty string) means "none" for that document; `undefined` means "use the resolved default".
export function applySealOverride(
  snapshot: SealSnapshot,
  override: { sealUrl?: string; signatureUrl?: string },
): SealSnapshot {
  return {
    sealUrl: override.sealUrl !== undefined ? override.sealUrl || null : snapshot.sealUrl,
    signatureUrl: override.signatureUrl !== undefined ? override.signatureUrl || null : snapshot.signatureUrl,
  };
}
