"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/document-lifecycle";
import { workspaceEntry, type ImportRowResult } from "@/lib/document-list-workspace";
import { docAdmin } from "@/lib/document-registry";

/**
 * Batch B — import validation + commit for a document module. Both run server-side, tenant-
 * scoped, and create DRAFT documents only (no posting, no stock). Preview validates every row
 * and returns row-level errors; commit re-validates and inserts only the valid rows in one
 * transaction, so invalid or duplicate records are never created. The commit is audited.
 */

export type ImportResult = { error?: string; results?: ImportRowResult[]; inserted?: number; skipped?: number };

function isModule(m: string): m is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(m);
}

async function validateAll(orgId: number, module: DocumentType, rows: Record<string, string>[]): Promise<ImportRowResult[]> {
  const entry = workspaceEntry(module);
  const seen = new Set<string>();
  const results: ImportRowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const errors = await entry.validateRow(orgId, rows[i], seen);
    results.push({ row: i + 1, ok: errors.length === 0, errors });
    const num = (rows[i].number || "").trim().toLowerCase();
    if (num) seen.add(num); // subsequent identical numbers are flagged as in-file duplicates
  }
  return results;
}

export async function previewImportAction(module: string, rows: Record<string, string>[]): Promise<ImportResult> {
  const session = await requireSession();
  if (!isModule(module)) return { error: "Unknown module." };
  if (!Array.isArray(rows) || rows.length === 0) return { error: "No rows to import." };
  if (rows.length > 2000) return { error: "Import is limited to 2000 rows per file." };
  const results = await validateAll(session.orgId, module, rows);
  return { results };
}

export async function commitImportAction(module: string, rows: Record<string, string>[]): Promise<ImportResult> {
  const session = await requireSession();
  if (!isModule(module)) return { error: "Unknown module." };
  if (!Array.isArray(rows) || rows.length === 0) return { error: "No rows to import." };
  if (rows.length > 2000) return { error: "Import is limited to 2000 rows per file." };

  const entry = workspaceEntry(module);
  const results = await validateAll(session.orgId, module, rows);
  const valid = results.filter((r) => r.ok).map((r) => rows[r.row - 1]);

  let inserted = 0;
  if (valid.length > 0) {
    await db.transaction(async (tx) => {
      for (const cells of valid) {
        await entry.insertRow(tx, session.orgId, session.userId, cells);
        inserted++;
      }
    });
  }

  if (inserted > 0) {
    await logActivity(session, { type: `${module}.imported`, description: `Imported ${inserted} draft ${module} record(s) from a file`, entityType: module, entityId: 0 });
    revalidatePath(docAdmin(module).listPath);
  }
  return { results, inserted, skipped: results.length - inserted };
}
