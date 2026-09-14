import "server-only";
import { randomBytes } from "crypto";
import { destinationStore, sourceStore } from "./blob-client";

// ---------------------------------------------------------------------------
// Shared Vercel Blob storage service for every upload in Elite ERP (logos,
// seals, signatures, item images, client/vendor logos, employee photos,
// document attachments). Replaces the old local-filesystem writes, which fail
// on Vercel (read-only /var/task).
//
// WHAT IS AND IS NOT GUARANTEED, stated precisely because the previous version
// of this comment overstated it. It claimed "blob URLs are never exposed and
// cross-tenant access is denied" while every object was written
// `access: "public"` — so the URLs were not exposed by this application, but
// anyone who came by one could fetch the bytes straight from the provider,
// outside the org check, outside the signature check and outside the audit log.
// Not exposing a URL is not the same as the storage being private, and the old
// wording read as though it were.
//
// Now:
//  - STORAGE is private, and that is a property of the STORE. New uploads are
//    written to the PRIVATE DESTINATION store; possession of a URL grants
//    nothing there. The legacy PUBLIC SOURCE store still holds everything
//    uploaded before this change, and reads fall back to it until migration
//    completes — server-side only, never as a URL handed to a browser.
//  - AUTHORIZATION is the application's. /uploads/[...path] requires a session
//    whose org matches the path's {orgId}, or a valid unexpired HMAC signature.
//  - TENANT ISOLATION is encoded in the pathname and re-checked on every read.
//  - The DB keeps an app-relative proxy path and NEVER learns which store an
//    object currently lives in. That is what lets the migration move objects
//    without touching a single row.
// ---------------------------------------------------------------------------

export type FileExt = "png" | "jpg" | "pdf";
export const CONTENT_TYPES: Record<FileExt, string> = { png: "image/png", jpg: "image/jpeg", pdf: "application/pdf" };

// Folders map 1:1 to asset kinds. All are tenant-scoped under organizations/{orgId}/.
export const BLOB_FOLDERS = [
  "logos", "seals", "signatures", "item-images", "attachments", "employee-photos", "client-logos", "vendor-logos", "layouts",
] as const;
export type BlobFolder = (typeof BLOB_FOLDERS)[number];
export const BLOB_FOLDER_SET = new Set<string>(BLOB_FOLDERS);

// Every object this application writes goes to the PRIVATE store. Kept as a named constant because
// the committed security suite asserts on it: a silent return to public storage is the exact
// regression that created F-3, and it has to be visible to a grep in CI, not only to a live test.
export const BLOB_ACCESS = "private" as const;

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB for images
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024; // 8 MB for attachments
const ALLOWED_IMAGE_MIME = new Set(["image/png", "image/jpeg"]);
const ALLOWED_ATTACH_MIME = new Set(["image/png", "image/jpeg", "application/pdf"]);

// Magic-byte sniff — client MIME is spoofable, so the real bytes decide the extension.
// SVG is intentionally NOT sniffed/allowed (no safe sanitizer in place).
export function sniffFile(bytes: Buffer, allowPdf: boolean): FileExt | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (allowPdf && bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  return null;
}

// Extract pixel dimensions from a PNG/JPEG buffer without any image library.
export function imageDimensions(bytes: Buffer, ext: FileExt): { width: number; height: number } | null {
  if (ext === "png") {
    if (bytes.length < 24) return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (ext === "jpg") {
    let off = 2;
    while (off + 9 < bytes.length) {
      if (bytes[off] !== 0xff) { off++; continue; }
      const marker = bytes[off + 1];
      // SOF markers carry the frame dimensions (skip C4/C8/CC which are not SOF)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(off + 5), width: bytes.readUInt16BE(off + 7) };
      }
      const len = bytes.readUInt16BE(off + 2);
      off += 2 + len;
    }
    return null;
  }
  return null;
}

export type ValidatedUpload = { error?: string; bytes?: Buffer; ext?: FileExt; contentType?: string; width?: number; height?: number };

// Validate an uploaded File: MIME allowlist + size cap + magic bytes (+ optional exact/max
// dimensions for cropped output). Runs on the server for every upload, including cropped images.
export async function validateUpload(
  file: unknown,
  opts: { kind: "image" | "attachment"; maxBytes: number; exactDimensions?: { width: number; height: number }; maxDimension?: number },
): Promise<ValidatedUpload> {
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  if (file.size > opts.maxBytes) return { error: `File must be under ${Math.round(opts.maxBytes / 1024 / 1024)} MB.` };
  const allowed = opts.kind === "attachment" ? ALLOWED_ATTACH_MIME : ALLOWED_IMAGE_MIME;
  if (file.type && !allowed.has(file.type)) return { error: opts.kind === "attachment" ? "PDF, PNG or JPG only." : "PNG or JPG only." };
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = sniffFile(bytes, opts.kind === "attachment");
  if (!ext) return { error: opts.kind === "attachment" ? "File content is not a valid PDF, PNG or JPG." : "File content is not a valid PNG or JPG image." };
  let width: number | undefined, height: number | undefined;
  if (ext !== "pdf") {
    const dim = imageDimensions(bytes, ext);
    if (!dim || dim.width < 1 || dim.height < 1) return { error: "Could not read the image dimensions." };
    width = dim.width; height = dim.height;
    if (opts.exactDimensions && (dim.width !== opts.exactDimensions.width || dim.height !== opts.exactDimensions.height)) {
      return { error: `Image must be exactly ${opts.exactDimensions.width}×${opts.exactDimensions.height}px.` };
    }
    if (opts.maxDimension && (dim.width > opts.maxDimension || dim.height > opts.maxDimension)) {
      return { error: `Image must be at most ${opts.maxDimension}px on each side.` };
    }
  }
  return { bytes, ext, contentType: CONTENT_TYPES[ext], width, height };
}

// Store bytes on Vercel Blob under a tenant-scoped, collision-proof pathname. Returns the
// app-relative proxy path saved in the DB (never the raw blob URL). Filenames are server-generated
// (never client-provided) to prevent path traversal / overwrite.
export async function storeBlob(orgId: number, folder: BlobFolder, bytes: Buffer, ext: FileExt, contentType: string): Promise<string> {
  const name = `${orgId}-${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`;
  const pathname = `organizations/${orgId}/${folder}/${name}`;
  // Destination only. No public copy is written "to make rollback easier" — that would recreate the
  // exposure this batch exists to close, for every new file, for as long as the copy survived.
  await destinationStore().put(pathname, bytes, { contentType });
  return `/uploads/${pathname}`;
}

/**
 * Read a stored object for the proxy route: private destination first, legacy public source second.
 *
 * The fallback is TEMPORARY migration compatibility — it lets objects uploaded before this change
 * keep loading while everything new is already protected — and it is deliberately narrow:
 *
 *  - it happens ONLY when the destination genuinely does not hold the object. A read that FAILS
 *    (auth, network, service) throws BlobReadError from the store and is allowed to propagate, so a
 *    broken token can never be mistaken for "not migrated yet" and quietly serve the public copy.
 *  - the source is read SERVER-SIDE with its own token. Its provider URL is never constructed for,
 *    or returned to, a browser.
 *  - it disappears by configuration: sourceStore() is null once the legacy token is removed, which
 *    is the operational signal that migration is complete.
 */
export async function readBlob(pathname: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const fromDestination = await destinationStore().get(pathname);
  if (fromDestination) return fromDestination;
  const source = sourceStore();
  if (!source) return null;
  return source.get(pathname);
}

/** Strip the `/uploads/` proxy prefix the DB stores, yielding the provider pathname. */
export function pathnameFromStored(stored: string): string {
  return stored.replace(/^\/uploads\//, "").replace(/^\//, "");
}

// `blobBaseUrl()` and `blobUrlFromStored()` were both REMOVED. blobUrlFromStored only ever built a
// provider URL for the delete, which now addresses objects by pathname. blobBaseUrl hardcoded
// `.public.` into the host, which is wrong for a private store — the SDK builds
// `https://${storeId}.${access}.blob.vercel-storage.com/${pathname}`, so the access level IS part of
// the host and a private object is a different address, not the same one with different permissions.
// Probing now belongs to a store (BlobStore.providerUrl / probeAnonymous), which knows its own mode
// and therefore its own host. Nothing in the request path constructs a provider URL.

// `blobUrlFromStored()` was removed with this change. Its only caller was deleteStoredBlob, and the
// delete now addresses the object by pathname, so the helper existed solely to manufacture a
// provider URL — the shape this batch is trying to stop relying on.

/**
 * Delete a previously-stored blob, for a USER action — replacing a logo, removing a seal. Idempotent
 * and never throws for a missing or blank value.
 *
 * DURING THE MIGRATION WINDOW AN OBJECT MAY LIVE IN EITHER STORE OR BOTH, and all three cases are
 * handled deliberately, because getting this wrong is how an "I removed that file" action leaves the
 * file publicly downloadable forever:
 *
 *   only in the private destination  -> delete it there
 *   only in the legacy public source -> delete it THERE, or the user's removal is cosmetic and the
 *                                       object stays anonymously fetchable at its public URL
 *   in both                          -> delete BOTH, same reason
 *
 * So this deletes unconditionally from every store that exists. That is the opposite of what the
 * MIGRATION does: the migration never deletes a source object, because a copied object is not a
 * removed one. Intentional removal and migration housekeeping are different acts and only one of
 * them is allowed to destroy the public copy.
 */
export async function deleteStoredBlob(stored: string | null | undefined): Promise<void> {
  if (!stored || !stored.startsWith("/uploads/organizations/")) return;
  const pathname = pathnameFromStored(stored);
  await destinationStore().del(pathname);
  const source = sourceStore();
  if (source) await source.del(pathname);
}
