/**
 * The cleanup ALGORITHM, separated from the CLI that guards it.
 *
 * Split so the safety property — only manifest entries are deleted, anything else survives — can be
 * tested directly against the fake stores. The CLI refuses to run against the fake driver (it is
 * for real verification), so without this seam the one rule that matters most here would be
 * untestable and would have to be taken on trust.
 */
import type { BlobStore } from "../../src/lib/storage/blob-client";
import type { Manifest } from "./manifest.mjs";

export type CleanupResult = { deleted: number; alreadyGone: number; failed: number; log: string[] };

export async function cleanupManifestObjects(
  manifest: Manifest,
  stores: { destination: BlobStore; source: BlobStore | null },
  onProgress?: (m: Manifest) => void,
): Promise<CleanupResult> {
  const res: CleanupResult = { deleted: 0, alreadyGone: 0, failed: 0, log: [] };
  for (const entry of manifest.objects) {
    const store = entry.storeRole === "private-destination" ? stores.destination : stores.source;
    if (!store) { entry.cleanupStatus = "failed"; entry.cleanupNote = "store not configured"; res.failed++; continue; }
    try {
      const before = await store.head(entry.pathname);
      if (!before) { entry.cleanupStatus = "verified-gone"; res.alreadyGone++; res.log.push(`already gone: ${entry.storeRole} ${entry.pathname}`); onProgress?.(manifest); continue; }
      await store.del(entry.pathname);
      // Verify rather than assume: a delete that reported success and left the object behind is the
      // failure mode this whole batch has been chasing.
      const after = await store.head(entry.pathname);
      if (after) { entry.cleanupStatus = "failed"; entry.cleanupNote = "still present after delete"; res.failed++; res.log.push(`FAILED: ${entry.pathname} still present`); }
      else { entry.cleanupStatus = "verified-gone"; res.deleted++; res.log.push(`deleted: ${entry.storeRole} ${entry.pathname}`); }
    } catch (e) {
      entry.cleanupStatus = "failed";
      entry.cleanupNote = String(e);
      res.failed++;
      res.log.push(`FAILED: ${entry.pathname}`);
    }
    onProgress?.(manifest);
  }
  return res;
}
