import "server-only";
import type { ImportSpec } from "./spec";

// Server-side file parsing for imports. Both .csv and .xlsx are turned into the same
// `{ headers, rows }` grid, so everything downstream (mapping, validation, insert) is
// format-agnostic. Parsing runs on the server so exceljs never ships to the browser.

export type Grid = { headers: string[]; rows: string[][] };

/** Minimal RFC-4180 CSV parser (quotes, embedded commas/newlines, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** Excel serial / Date cell -> YYYY-MM-DD; everything else -> trimmed string. */
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const y = v.getUTCFullYear(), m = String(v.getUTCMonth() + 1).padStart(2, "0"), d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // exceljs rich text / hyperlink / formula result shapes
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? "").join("").trim();
    if ("text" in o) return String(o.text ?? "").trim();
    if ("result" in o) return String(o.result ?? "").trim();
    if ("hyperlink" in o) return String(o.hyperlink ?? "").trim();
    return "";
  }
  return String(v).trim();
}

async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  // First worksheet that has data (the template's field-guide sheet is added AFTER the data sheet).
  const ws = wb.worksheets.find((w) => w.rowCount > 0);
  if (!ws) return [];
  const grid: string[][] = [];
  let width = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = row.values as unknown[]; // exceljs is 1-indexed; index 0 is unused
    const cells: string[] = [];
    for (let i = 1; i < vals.length; i++) cells.push(cellToString(vals[i]));
    width = Math.max(width, cells.length);
    grid.push(cells);
  });
  return grid.map((r) => { const c = r.slice(); while (c.length < width) c.push(""); return c; });
}

/** Parse an uploaded file into a header row + data rows. Blank rows are dropped. */
export async function parseImportFile(fileName: string, buf: Buffer): Promise<Grid> {
  const isXlsx = /\.xlsx$/i.test(fileName) || (buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b); // PK zip magic
  const grid = isXlsx ? await parseXlsx(buf) : parseCsv(buf.toString("utf8"));
  const nonEmpty = grid.filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => (h ?? "").trim());
  return { headers, rows: nonEmpty.slice(1) };
}

/** Build the template workbook (data sheet with headers + one example row, plus a field guide). */
export async function buildTemplateXlsx(spec: ImportSpec): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Elite ERP";
  wb.created = new Date();

  const ws = wb.addWorksheet(spec.label);
  ws.addRow(spec.fields.map((f) => f.header));
  // One row per LINE ITEM: the example set contains a multi-line document plus a second document.
  for (const ex of spec.exampleRows) ws.addRow(spec.fields.map((f) => ex[f.key] ?? ""));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((cell, col) => {
    const f = spec.fields[col - 1];
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: f?.required ? "FFC1403B" : "FF1B1B4E" } };
    cell.alignment = { vertical: "middle" };
  });
  head.height = 22;
  spec.fields.forEach((f, i) => { ws.getColumn(i + 1).width = Math.max(14, Math.min(38, f.header.length + 6)); });
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const guide = wb.addWorksheet("Field Guide");
  guide.addRow(["Column", "Required", "Scope", "Notes"]);
  guide.getRow(1).font = { bold: true };
  for (const f of spec.fields) {
    guide.addRow([f.header, f.required ? "REQUIRED" : "Optional", f.scope === "line" ? "Line item" : "Document", f.guide]);
  }
  guide.getColumn(1).width = 26; guide.getColumn(2).width = 12; guide.getColumn(3).width = 12; guide.getColumn(4).width = 90;
  guide.getColumn(4).alignment = { wrapText: true, vertical: "top" };
  guide.addRow([]);
  guide.addRow([
    "How multiple line items work", "", "",
    "Use one row per line item. Repeat the same quotation number and document-level values for all items belonging to the same quotation.",
  ]);
  guide.addRow([
    "Conflicting values", "", "",
    "If two rows with the same quotation number carry different document-level values (client, dates, currency, terms, notes, discount…), that quotation is blocked during preview with a clear error.",
  ]);
  guide.addRow([
    "Blank numbers", "", "",
    "A row with a blank quotation number becomes its own auto-numbered quotation. Blank-number rows are never grouped together.",
  ]);
  guide.addRow(["Status", "", "", "Imported documents are always created as Draft. Nothing is posted to the ledger or stock by import."]);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** CSV variant of the template (headers + one example row). */
export function buildTemplateCsv(spec: ImportSpec): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = spec.fields.map((f) => esc(f.header)).join(",");
  // One row per LINE ITEM — the examples show a document with several items plus a second document.
  const examples = spec.exampleRows.map((ex) => spec.fields.map((f) => esc(ex[f.key] ?? "")).join(","));
  return "﻿" + [header, ...examples].join("\r\n") + "\r\n";
}

/** Build the failed-rows CSV the user downloads after a preview/import (original cells + errors). */
export function buildErrorCsv(headers: string[], rows: string[][], errorsByRow: Map<number, string[]>): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [[...headers, "Row", "Errors"].map(esc).join(",")];
  for (const [rowIndex, errs] of [...errorsByRow.entries()].sort((a, b) => a[0] - b[0])) {
    const cells = rows[rowIndex] ?? [];
    lines.push([...headers.map((_, i) => cells[i] ?? ""), String(rowIndex + 2), errs.join(" ")].map(esc).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
