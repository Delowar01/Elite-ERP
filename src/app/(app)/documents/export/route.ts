import { requireSession } from "@/lib/session";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/document-lifecycle";
import { workspaceEntry, type ExportColumn } from "@/lib/document-list-workspace";
import { filtersFromParams } from "../_workspace/filter-types";

// Batch B — list export. GET /documents/export?module=<type>&format=csv|xlsx|pdf&<filters>.
// Re-queries the module server-side, tenant-scoped (requireSession → orgId) and applying the
// same filters the list is showing, so the export always respects the active filters and can
// never leak another tenant's rows. Read-only: no accounting/inventory/lifecycle effect.

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function toCsv(columns: ExportColumn[], rows: Record<string, string>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key] ?? "")).join(","));
  return "﻿" + [head, ...body].join("\r\n"); // BOM so Excel reads UTF-8
}
function htmlEscape(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function toExcelHtml(title: string, columns: ExportColumn[], rows: Record<string, string>[]): string {
  const th = columns.map((c) => `<th>${htmlEscape(c.header)}</th>`).join("");
  const trs = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${htmlEscape(r[c.key] ?? "")}</td>`).join("")}</tr>`)
    .join("");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px;font-family:Calibri,Arial,sans-serif;font-size:11pt}th{background:#1B1B4E;color:#fff;text-align:left}</style></head><body><h3>${htmlEscape(title)}</h3><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
}
async function toPdf(title: string, columns: ExportColumn[], rows: Record<string, string>[]): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageW = 595.28, pageH = 841.89, margin = 36; // A4 portrait
  const usable = pageW - margin * 2;
  const colW = usable / columns.length;
  const size = 8, rowH = 16;
  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - margin;
  page.drawText(title, { x: margin, y, size: 13, font: bold, color: rgb(0.106, 0.106, 0.306) });
  y -= 24;
  const clip = (s: string, max: number) => {
    let out = s;
    while (out.length && font.widthOfTextAtSize(out, size) > max) out = out.slice(0, -1);
    return out.length < s.length ? out.slice(0, -1) + "…" : out;
  };
  const drawRow = (cells: string[], f: typeof font) => {
    columns.forEach((_, i) => {
      page.drawText(clip(cells[i] ?? "", colW - 6), { x: margin + i * colW + 2, y, size, font: f, color: rgb(0.15, 0.15, 0.2) });
    });
    y -= rowH;
  };
  drawRow(columns.map((c) => c.header), bold);
  page.drawLine({ start: { x: margin, y: y + 6 }, end: { x: pageW - margin, y: y + 6 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.85) });
  for (const r of rows) {
    if (y < margin + rowH) {
      page = pdf.addPage([pageW, pageH]);
      y = pageH - margin;
    }
    drawRow(columns.map((c) => r[c.key] ?? ""), font);
  }
  return pdf.save();
}

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
  const title = `${moduleParam} export`;
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${moduleParam}-${stamp}`;

  if (format === "xlsx" || format === "xls") {
    return new Response(toExcelHtml(title, columns, rows), {
      headers: { "Content-Type": "application/vnd.ms-excel; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.xls"` },
    });
  }
  if (format === "pdf") {
    const bytes = await toPdf(title, columns, rows);
    return new Response(Buffer.from(bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` },
    });
  }
  // default CSV
  return new Response(toCsv(columns, rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` },
  });
}
