import "server-only";
import { put, del } from "@vercel/blob";
import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Shared Vercel Blob storage service for every upload in Elite ERP (logos,
// seals, signatures, item images, client/vendor logos, employee photos,
// document attachments). Replaces the old local-filesystem writes, which fail
// on Vercel (read-only /var/task). Files are stored on Vercel Blob under
// tenant-scoped pathnames; the DB keeps an app-relative proxy path that the
// authenticated /uploads/[...] route resolves back to the blob (tenant-checked
// + audited), so blob URLs are never exposed and cross-tenant access is denied.
// ---------------------------------------------------------------------------

export type FileExt = "png" | "jpg" | "pdf";
export const CONTENT_TYPES: Record<FileExt, string> = { png: "image/png", jpg: "image/jpeg", pdf: "application/pdf" };

// Folders map 1:1 to asset kinds. All are tenant-scoped under organizations/{orgId}/.
export const BLOB_FOLDERS = [
  "logos", "seals", "signatures", "item-images", "attachments", "employee-photos", "client-logos", "vendor-logos",
] as const;
export type BlobFolder = (typeof BLOB_FOLDERS)[number];
export const BLOB_FOLDER_SET = new Set<string>(BLOB_FOLDERS);

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
  await put(pathname, bytes, { access: "public", addRandomSuffix: false, contentType, token: process.env.BLOB_READ_WRITE_TOKEN });
  return `/uploads/${pathname}`;
}

// Base public host of this project's blob store, derived from the token (vercel_blob_rw_<store>_<secret>).
export function blobBaseUrl(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  const storeId = token.split("_")[3];
  if (!storeId) throw new Error("BLOB_READ_WRITE_TOKEN is malformed");
  return `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
}

// Resolve a stored proxy path (`/uploads/organizations/...`) or bare pathname to its blob URL.
export function blobUrlFromStored(stored: string): string {
  const pathname = stored.replace(/^\/uploads\//, "").replace(/^\//, "");
  return `${blobBaseUrl()}/${pathname}`;
}

// Delete a previously-stored blob. Never throws for a missing/blank value (idempotent cleanup).
export async function deleteStoredBlob(stored: string | null | undefined): Promise<void> {
  if (!stored || !stored.startsWith("/uploads/organizations/")) return;
  try {
    await del(blobUrlFromStored(stored), { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch {
    // best-effort; a missing blob is not an error for cleanup
  }
}
