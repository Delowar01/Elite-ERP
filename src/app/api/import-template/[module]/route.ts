import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { importSpec } from "@/lib/import/spec";
import { buildTemplateXlsx, buildTemplateCsv } from "@/lib/import/parse";

// GET /api/import-template/[module]?format=xlsx|csv — the module's import template. The columns come
// from the same spec the validator and importer use, so the template can never drift from what the
// import actually accepts. The .xlsx variant carries a "Field Guide" sheet documenting every column.
export async function GET(request: NextRequest, { params }: { params: Promise<{ module: string }> }) {
  await requireSession(); // templates describe org-importable data; keep them behind auth
  const { module } = await params;
  const spec = importSpec(module);
  if (!spec) return NextResponse.json({ error: "Unknown module." }, { status: 404 });

  const format = (request.nextUrl.searchParams.get("format") ?? "xlsx").toLowerCase();
  const base = `${module}-import-template`;

  if (format === "csv") {
    return new NextResponse(buildTemplateCsv(spec), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const buf = await buildTemplateXlsx(spec);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
