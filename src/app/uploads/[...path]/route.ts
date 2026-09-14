import { getSession } from "@/lib/session";
import { verifySignedFile } from "@/lib/security/signed-url";
import { recordFileAccess } from "@/lib/security/audit";
import { getRequestContext } from "@/lib/security/request-context";
import { readBlob, BLOB_FOLDER_SET, CONTENT_TYPES, type FileExt } from "@/lib/storage/blob-storage";

// The ONLY read path for uploaded files. The stored path is organizations/{orgId}/{folder}/{file};
// ownership is encoded in the path, so a request is served only to (1) a live session whose org
// matches path segment {orgId}, or (2) a valid, unexpired HMAC signature over that exact pathname.
// Every serve is written to the append-only file_access_logs.
//
// The bytes are now fetched with readBlob(), which authenticates to the store with the project
// token. It replaces `fetch(blobBaseUrl()/pathname)`, which worked only because every object was
// written public — meaning the authorization below was a gate on a door that also stood open at the
// provider. With private storage the provider refuses an unauthenticated read outright, so this
// route is the only way to the bytes and its checks are the whole of the access control.
//
// Branding folders MAY be reached with a signature; item-images, attachments and layouts require a
// live owning session. Note that no caller currently MINTS a signed URL — signFileUrl() has no
// callers — so signed access is a preserved capability rather than an active workflow: PDF
// generation reaches these files with the session cookie Puppeteer forwards.
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
  const expRaw = url.searchParams.get("exp");
  const signed = BRANDING_FOLDERS.has(folder) && verifySignedFile(pathname, expRaw, url.searchParams.get("sig"));

  // A signed response must not outlive its signature in the browser's own cache. With a flat
  // max-age=3600 a client that fetched the file once could keep re-serving it from cache for an hour
  // after `exp` had passed, without ever asking the server again — which makes the expiry a promise
  // the system does not keep. Cap the lifetime at whatever validity is left, so the cache entry dies
  // no later than the capability does. Session-authorized responses are unaffected and keep the full
  // hour: that is what makes a print page full of <img> tags affordable.
  const signedTtl = signed ? Math.max(0, Number(expRaw) - Math.floor(Date.now() / 1000)) : 0;
  const maxAge = signed ? Math.min(3600, signedTtl) : 3600;

  // Path 1: live session that owns the file.
  const session = signed ? null : await getSession();
  if (!signed && (!session || session.orgId !== fileOrgId)) return new Response("Not found", { status: 404 });

  try {
    const object = await readBlob(pathname);
    if (!object) return new Response("Not found", { status: 404 });
    const bytes = new Uint8Array(object.bytes);
    const reqCtx = await getRequestContext();
    await recordFileAccess({ orgId: fileOrgId, userId: session?.userId ?? null, folder, fileName: file, ipAddress: reqCtx.ipAddress });
    return new Response(bytes, {
      headers: {
        // The extension is taken from the validated path rather than from the store, so a stored
        // object cannot talk this route into serving a type the folder rules disallow.
        "Content-Type": CONTENT_TYPES[ext],
        "Content-Disposition": folder === "attachments" ? "attachment" : "inline",
        "X-Content-Type-Options": "nosniff",
        // `private` keeps these bytes out of every SHARED cache — CDN, proxy, Vercel's edge —
        // whichever path authorized the request. max-age is the full hour for a session and the
        // signature's remaining validity for a signed request (see above); a signature with no time
        // left yields max-age=0, so the entry is never reusable.
        "Cache-Control": `private, max-age=${maxAge}`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
