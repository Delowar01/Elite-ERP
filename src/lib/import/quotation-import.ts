import "server-only";
import { QUOTATION_IMPORT_SPEC } from "./spec";
import {
  validateDocumentImport, commitDocumentImport, groupRows as groupDocumentRows,
  type MappedRow, type DateFormats, type DocDraft, type PreviewResult,
} from "./document-import";

// Quotations are one of the eight document modules; the engine lives in document-import.ts. This
// file keeps the quotation-shaped entry points the module was first built with, so nothing that
// already calls them has to change.

export {
  normalizeDate, splitTerms, MAX_IMPORT_ROWS,
  type MappedRow, type LineDraft, type DocDraft, type DateFormats,
  type PreviewSummary, type DocPreview, type PreviewResult, type CommitOutcome,
} from "./document-import";

export const groupRows = (rows: MappedRow[], formats?: DateFormats) => groupDocumentRows("quotation", rows, formats);

export const validateQuotationImport = (orgId: number, rows: MappedRow[], formats?: DateFormats) =>
  validateDocumentImport("quotation", orgId, rows, formats);

export const commitQuotationImport = (orgId: number, userId: number, rows: MappedRow[], formats?: DateFormats) =>
  commitDocumentImport("quotation", orgId, userId, rows, formats);

export const QUOTATION_SPEC = QUOTATION_IMPORT_SPEC;

/** Documents that will actually be created, used by the preview's counter. */
export function countCreated(docs: DocDraft[]): number {
  return docs.filter((d) => d.errors.length === 0 && d.rowErrors.size === 0).length;
}

export type { PreviewResult as QuotationPreviewResult };
