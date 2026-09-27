/**
 * Creating a test object, as a seam the self-tests can drive against the fake stores.
 *
 * This lives outside the main harness because it is the single most destructive thing the harness
 * does. Overwriting would destroy bytes the run did not write and then record the run as their
 * owner, so cleanup would afterwards delete somebody else's object with a clean conscience. The
 * sequence is therefore: plan (so a crash mid-write still leaves a record), prove the pathname is
 * free, write WITHOUT overwrite, and only then claim it. A collision stops the test.
 */
import type { BlobStore } from "../../src/lib/storage/blob-client";
import type { ManifestObject, Run, StoreRole } from "./manifest.mjs";

export class SeedCollisionError extends Error {}

export async function seedObject(
  run: Run,
  store: BlobStore,
  role: StoreRole,
  pathname: string,
  bytes: Buffer,
  purpose: string,
  contentType = "image/png",
): Promise<ManifestObject> {
  const entry = run.planObject(role, pathname, purpose, bytes);
  const existing = await store.head(pathname);
  if (existing) {
    run.markObjectCreateFailed(entry, "pathname already occupied — refusing to overwrite an object this run did not create");
    throw new SeedCollisionError(`collision at ${pathname} in the ${role} store: refusing to overwrite`);
  }
  try {
    // No allowOverwrite. put() defaults to refusing, so a pathname that became occupied between the
    // head() above and this line is rejected by the provider rather than silently clobbered.
    await store.put(pathname, bytes, { contentType });
    run.markObjectCreated(entry);
  } catch (e) {
    // The write may still have committed on the provider. Cleanup resolves that by matching bytes.
    run.markObjectCreateFailed(entry, e);
    throw e;
  }
  return entry;
}
