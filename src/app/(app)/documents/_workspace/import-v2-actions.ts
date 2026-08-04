"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { recordAudit } from "@/lib/security/audit";
import { docAdmin } from "@/lib/document-registry";
import { importSpec, autoMap, type ImportSpec } from "@/lib/import/spec";
import { parseImportFile, buildErrorCsv } from "@/lib/import/parse";
import {
  validateQuotationImport, commitQuotationImport, MAX_IMPORT_ROWS,
  type PreviewResult, type MappedRow,
} from "@/lib/import/quotation-import";

// Import pipeline (parse -> map -> preview -> commit). Every step is tenant-scoped via the session
// and re-validated server-side; the client's preview is never trusted at commit time.

export type ParseResult = {
  error?: string;
  headers?: string[];
  rows?: string[][];
  mapping?: Record<string, number>;
  fileName?: string;
};

const SUPPORTED = new Set(["quotation"]);

function specOrNull(module: string): ImportSpec | null {
  return SUPPORTED.has(module) ? importSpec(module) : null;
}

/** Step 1 — upload: parse a .csv/.xlsx into a grid and propose an automatic column mapping. */
export async function parseImportFileAction(module: string, form: FormData): Promise<ParseResult> {
  await requireSession();
  const spec = specOrNull(module);
  if (!spec) return { error: "Import is not available for this module yet." };

  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Choose a file to import." };
  if (file.size === 0) return { error: "The file is empty." };
  if (file.size > 10 * 1024 * 1024) return { error: "File is too large (limit 10 MB)." };
  if (!/\.(csv|xlsx)$/i.test(file.name)) return { error: "Only .csv and .xlsx files are supported." };

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const { headers, rows } = await parseImportFile(file.name, buf);
    if (headers.length === 0) return { error: "The file has no header row." };
    if (rows.length === 0) return { error: "The file has no data rows." };
    if (rows.length > MAX_IMPORT_ROWS) return { error: `Import is limited to ${MAX_IMPORT_ROWS} rows per file.` };
    return { headers, rows, mapping: autoMap(spec, headers), fileName: file.name };
  } catch (err) {
    return { error: `Could not read the file: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Apply a column mapping to the raw grid, producing one object per data row. */
function applyMapping(spec: ImportSpec, rows: string[][], mapping: Record<string, number>): MappedRow[] {
  return rows.map((cells) => {
    const o: MappedRow = {};
    for (const f of spec.fields) {
      const i = mapping[f.key];
      o[f.key] = i >= 0 ? (cells[i] ?? "").trim() : "";
    }
    return o;
  });
}

export type PreviewResponse = { error?: string; preview?: PreviewResult; missingRequired?: string[] };

/** Step 2 — preview: validate everything, save nothing. */
export async function previewImportAction(
  module: string,
  rows: string[][],
  mapping: Record<string, number>,
): Promise<PreviewResponse> {
  const session = await requireSession();
  const spec = specOrNull(module);
  if (!spec) return { error: "Import is not available for this module yet." };
  if (!Array.isArray(rows) || rows.length === 0) return { error: "No rows to import." };
  if (rows.length > MAX_IMPORT_ROWS) return { error: `Import is limited to ${MAX_IMPORT_ROWS} rows per file.` };

  const missingRequired = spec.fields.filter((f) => f.required && (mapping[f.key] ?? -1) < 0).map((f) => f.header);
  if (missingRequired.length) return { missingRequired };

  const mapped = applyMapping(spec, rows, mapping);
  const { result } = await validateQuotationImport(session.orgId, mapped);
  return { preview: result };
}

export type CommitResponse = {
  error?: string;
  imported?: number; updated?: number; skipped?: number; failed?: number; total?: number; lineItems?: number;
  errorCsv?: string;
};

/** Step 3 — commit: re-validate, then insert each document in its own transaction. */
export async function commitImportV2Action(
  module: string,
  headers: string[],
  rows: string[][],
  mapping: Record<string, number>,
): Promise<CommitResponse> {
  const session = await requireSession();
  const spec = specOrNull(module);
  if (!spec) return { error: "Import is not available for this module yet." };
  if (!Array.isArray(rows) || rows.length === 0) return { error: "No rows to import." };
  if (rows.length > MAX_IMPORT_ROWS) return { error: `Import is limited to ${MAX_IMPORT_ROWS} rows per file.` };

  const missingRequired = spec.fields.filter((f) => f.required && (mapping[f.key] ?? -1) < 0).map((f) => f.header);
  if (missingRequired.length) return { error: `Map the required column(s) first: ${missingRequired.join(", ")}.` };

  const mapped = applyMapping(spec, rows, mapping);
  const outcome = await commitQuotationImport(session.orgId, session.userId, mapped);

  if (outcome.imported > 0) {
    await logActivity(session, {
      type: `${module}.imported`,
      description: `Imported ${outcome.imported} draft quotation(s) with ${outcome.lineItems} line item(s) from a file`,
      entityType: module,
      entityId: 0,
    });
    await recordAudit(session, {
      action: "import",
      entityType: module,
      entityId: 0,
      newValue: { imported: outcome.imported, skipped: outcome.skipped, failed: outcome.failed, lineItems: outcome.lineItems },
    }).catch(() => {});
    revalidatePath(docAdmin(module as never).listPath);
  }

  const errorCsv = outcome.errors.length ? buildErrorCsv(headers, rows, new Map(outcome.errors)) : undefined;
  return {
    imported: outcome.imported,
    updated: 0, // documents are never overwritten by import
    skipped: outcome.skipped,
    failed: outcome.failed,
    lineItems: outcome.lineItems,
    total: rows.length,
    errorCsv,
  };
}

/** Failed-rows CSV for the preview step (before committing). */
export async function previewErrorCsvAction(
  module: string,
  headers: string[],
  rows: string[][],
  mapping: Record<string, number>,
): Promise<{ error?: string; csv?: string }> {
  const session = await requireSession();
  const spec = specOrNull(module);
  if (!spec) return { error: "Import is not available for this module yet." };
  const mapped = applyMapping(spec, rows, mapping);
  const { result } = await validateQuotationImport(session.orgId, mapped);
  if (!result.rowErrors.length) return { csv: undefined };
  return { csv: buildErrorCsv(headers, rows, new Map(result.rowErrors)) };
}
