import { readFile } from "fs/promises";
import path from "path";
import { getSession } from "@/lib/session";

// Serves org branding uploads (logos/seals/signatures) from the private uploads/ directory.
// Requires a session, and the filename's orgId prefix must match the session's org — seals and
// signatures are forgery-sensitive, so they are never publicly enumerable (audit, Medium #5).
const FOLDERS = new Set(["logos", "seals", "signatures"]);
const FILE_RE = /^(\d+)-\d+\.(png|jpg)$/;
const CONTENT_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg" };

export async function GET(_req: Request, ctx: { params: Promise<{ folder: string; file: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Not found", { status: 404 });

  const { folder, file } = await ctx.params;
  if (!FOLDERS.has(folder)) return new Response("Not found", { status: 404 });
  const match = FILE_RE.exec(file);
  if (!match || Number(match[1]) !== session.orgId) return new Response("Not found", { status: 404 });

  try {
    const bytes = await readFile(path.join(process.cwd(), "uploads", folder, file));
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
