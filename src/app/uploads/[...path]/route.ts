import { getSession } from "@/lib/session";
import { verifySignedFile } from "@/lib/security/signed-url";
import { recordFileAccess } from "@/lib/security/audit";
import { getRequestContext } from "@/lib/security/request-context";
import { blobBaseUrl, BLOB_FOLDER_SET, CONTENT_TYPES, type FileExt } from "@/lib/storage/blob-storage";

// Authenticated proxy that streams a tenant-scoped file from Vercel Blob. The stored path is
// organizations/{orgId}/{folder}/{file}; ownership is encoded in the path, so a request is served
// only to (1) a live session whose org matches path segment {orgId}, or (2) a valid HMAC-signed URL
// (session-less PDF/share access). Blob URLs are never exposed to the client, and every serve is
// written to the append-only file_access_logs. Branding folders may use signed URLs; document
// uploads require a live owning session.
const BRANDING_FOLDERS = new Set(["logos", "seals", "signatures", "client-logos", "vendor-logos", "employee-photos"]);
// server-generated names only: {orgId}-{ts}-{16 hex}.{ext}
const FILE_RE = /^(\d+)-\d+-[0-9a-f]{16}\.(png|jpg|pdf)$/;

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  // Expected shape: ["organizations", "{orgId}", "{folder}", "{file}"]
  if (!path || path.length !== 4 || path[0] !== "organizations") return new Response("Not found", { status: 404 });
  const [, orgIdRaw, folder, file] = path;
  const fileOrgId = Number(orgIdRaw);
  if (!Number.isInteger(fileOrgId) || fileOrgId < 1) return new Response("Not found", { status: 404 });
  if (!BLOB_FOLDER_SET.has(folder)) return new Response("Not found", { status: 404 });
  const match = FILE_RE.exec(file);
  if (!match) return new Response("Not found", { status: 404 });
  if (Number(match[1]) !== fileOrgId) return new Response("Not found", { status: 404 });
  const ext = match[2] as FileExt;
  if (ext === "pdf" && folder !== "attachments") return new Response("Not found", { status: 404 });

  const pathname = `organizations/${fileOrgId}/${folder}/${file}`;

  // Path 2: signed URL (branding folders only).
  const url = new URL(req.url);
  const signed = BRANDING_FOLDERS.has(folder) && verifySignedFile(pathname, url.searchParams.get("exp"), url.searchParams.get("sig"));

  // Path 1: live session that owns the file.
  const session = signed ? null : await getSession();
  if (!signed && (!session || session.orgId !== fileOrgId)) return new Response("Not found", { status: 404 });

  try {
    const res = await fetch(`${blobBaseUrl()}/${pathname}`, { cache: "no-store" });
    if (!res.ok) return new Response("Not found", { status: 404 });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const reqCtx = await getRequestContext();
    await recordFileAccess({ orgId: fileOrgId, userId: session?.userId ?? null, folder, fileName: file, ipAddress: reqCtx.ipAddress });
    return new Response(bytes, {
      headers: {
        "Content-Type": CONTENT_TYPES[ext],
        "Content-Disposition": folder === "attachments" ? "attachment" : "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
