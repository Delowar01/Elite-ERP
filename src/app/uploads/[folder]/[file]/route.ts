import { readFile } from "fs/promises";
import path from "path";
import { getSession } from "@/lib/session";
import { verifySignedFile } from "@/lib/security/signed-url";
import { recordFileAccess } from "@/lib/security/audit";
import { getRequestContext } from "@/lib/security/request-context";

// Serves org branding uploads (logos/seals/signatures) from the private uploads/ directory.
// Two authorization paths (Part 3):
//   1. A live session whose org matches the filename's orgId prefix (in-app <img> rendering).
//   2. A valid, unexpired HMAC-signed URL (?exp=&sig=) for session-less access (share links, PDFs).
// Seals and signatures are forgery-sensitive, so they are never publicly enumerable (audit, Medium #5).
// Every successful serve is written to the append-only file_access_logs (download auditing).
const FOLDERS = new Set(["logos", "seals", "signatures"]);
const FILE_RE = /^(\d+)-\d+\.(png|jpg)$/;
const CONTENT_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg" };

export async function GET(req: Request, ctx: { params: Promise<{ folder: string; file: string }> }) {
  const { folder, file } = await ctx.params;
  if (!FOLDERS.has(folder)) return new Response("Not found", { status: 404 });

  const match = FILE_RE.exec(file);
  if (!match) return new Response("Not found", { status: 404 });
  const fileOrgId = Number(match[1]);

  // Path 2: signed URL — authorizes without a session, still scoped to this exact file + expiry.
  const url = new URL(req.url);
  const signed = verifySignedFile(folder, file, url.searchParams.get("exp"), url.searchParams.get("sig"));

  // Path 1: session must exist and own the file.
  const session = signed ? null : await getSession();
  if (!signed) {
    if (!session || fileOrgId !== session.orgId) return new Response("Not found", { status: 404 });
  }

  try {
    const bytes = await readFile(path.join(process.cwd(), "uploads", folder, file));
    const reqCtx = await getRequestContext();
    await recordFileAccess({
      orgId: fileOrgId,
      userId: session?.userId ?? null,
      folder,
      fileName: file,
      ipAddress: reqCtx.ipAddress,
    });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": CONTENT_TYPES[match[2]],
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
