/**
 * Helper for verify-private-storage.mjs. Runs under `tsx --conditions=react-server` so it can call
 * the REAL storeBlob() — the production write path, server-only imports and all — rather than a
 * test-local imitation of it. Prints one JSON line: { folder: storedPath }.
 */
import { storeBlob, BLOB_FOLDERS, type BlobFolder } from "../src/lib/storage/blob-storage";

const orgId = Number(process.argv[2]);
if (!Number.isInteger(orgId)) throw new Error("usage: private-storage-writer.mts <orgId>");

// Smallest valid PNG and JPEG, so validateUpload's magic-byte rules would accept them too.
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd4000000004945", "hex");
const PDF = Buffer.from("255044462d312e340a25e2e3cfd30a312030206f626a0a3c3c2f547970652f436174616c6f673e3e0a656e646f626a0a", "hex");

const out: Record<string, string> = {};
for (const folder of BLOB_FOLDERS as readonly BlobFolder[]) {
  const isPdf = folder === "attachments";
  out[folder] = await storeBlob(orgId, folder, isPdf ? PDF : PNG, isPdf ? "pdf" : "png", isPdf ? "application/pdf" : "image/png");
}
console.log(JSON.stringify(out));
