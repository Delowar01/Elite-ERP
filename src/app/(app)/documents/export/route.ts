import { requireSession } from "@/lib/session";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/document-lifecycle";
import { workspaceEntry } from "@/lib/document-list-workspace";
import { exportResponse } from "@/lib/report-export";
import { filtersFromParams } from "../_workspace/filter-types";

// Batch B — list export. GET /documents/export?module=<type>&format=csv|xlsx|pdf&<filters>.
// Re-queries the module server-side, tenant-scoped (requireSession → orgId) and applying the
// same filters the list is showing, so the export always respects the active filters and can
// never leak another tenant's rows. Read-only: no accounting/inventory/lifecycle effect.

export async function GET(req: Request) {
  const session = await requireSession();
  const url = new URL(req.url);
  const moduleParam = url.searchParams.get("module") ?? "";
  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
  if (!(DOCUMENT_TYPES as readonly string[]).includes(moduleParam)) {
    return new Response("Unknown module", { status: 400 });
  }
  const entry = workspaceEntry(moduleParam as DocumentType);
  const filters = filtersFromParams(url.searchParams);
  const { columns, rows } = await entry.loadForExport(session.orgId, filters);
  const stamp = new Date().toISOString().slice(0, 10);
  return exportResponse(format, `${moduleParam} export`, `${moduleParam}-${stamp}`, columns, rows);
}
