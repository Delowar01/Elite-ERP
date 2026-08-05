import "server-only";
import { and, eq, sql, inArray } from "drizzle-orm";
import {
  db, quotationsTable, quotationItemsTable, customersTable, projectsTable, productsTable,
} from "@/db";
import { nextDocumentNumber } from "@/lib/documents";
import { computeTotals } from "@/app/(app)/sales/_shared/totals";
import { LINE_DESC_KEY } from "@/app/(app)/sales/_shared/line-item-desc";
import { isValidCurrencyCode } from "@/lib/currency/currencies";
import { QUOTATION_IMPORT_SPEC } from "./spec";
import { parseDateCell, DEFAULT_DATE_FORMAT, type DateFormat } from "./dates";

// Quotation import: turns the mapped grid into grouped documents, validates every group against the
// organization's real data, then inserts each quotation + its line items in ONE transaction per
// document. Imported quotations are always DRAFT — nothing posts to the ledger or stock.

export type MappedRow = Record<string, string>;

export type LineDraft = {
  itemName: string; itemDescription: string; sku: string;
  quantity: string; unitPrice: string; unit: string; taxRate: string; itemDiscount: string; imageUrl: string;
  sourceRow: number; // 0-based index into the uploaded data rows
};

export type DocDraft = {
  key: string;                 // grouping key (number, or a synthetic key for blank numbers)
  number: string;              // "" = auto-generate
  header: MappedRow;
  lines: LineDraft[];
  sourceRows: number[];        // all data-row indexes contributing to this document
  errors: string[];            // document-level errors
  rowErrors: Map<number, string[]>; // per-source-row errors
  /** Document-level values that disagree between rows of the same document number. */
  conflicts: { field: string; values: [string, string]; row: number }[];
};

const isBlank = (v: string | undefined) => !v || !v.trim();
const num = (v: string) => Number(String(v ?? "").replace(/[,\s]/g, ""));
const isNum = (v: string) => v.trim() !== "" && Number.isFinite(num(v));

/** The date format chosen per mapped date column during column mapping. */
export type DateFormats = Record<string, DateFormat>;

const fmtFor = (formats: DateFormats | undefined, key: string): DateFormat =>
  formats?.[key] ?? DEFAULT_DATE_FORMAT;

/** Parse a date cell with the column's selected format; null when it cannot be read safely. */
export function normalizeDate(v: string, format: DateFormat = DEFAULT_DATE_FORMAT): string | null {
  const r = parseDateCell(v, format);
  return r.ok ? r.iso : null;
}

/** Message explaining exactly why a date cell was rejected, so the user knows what to change. */
function dateError(label: string, raw: string, reason: "ambiguous" | "impossible" | "unrecognized"): string {
  const v = (raw ?? "").trim();
  if (reason === "ambiguous") {
    return `${label} "${v}" could be read more than one way. Select the date format for this column during column mapping.`;
  }
  if (reason === "impossible") return `${label} "${v}" is not a real calendar date.`;
  return `${label} "${v}" is not a date the importer recognizes (use DD/MM/YYYY, MM/DD/YYYY or YYYY-MM-DD).`;
}

/**
 * Split one Terms & Conditions cell into individual terms. Terms may be separated by a new line or
 * by `||`; blank entries and surrounding whitespace are dropped, a leading "1." / "2)" numbering
 * marker is stripped (the document re-numbers terms itself), and the original order is preserved.
 */
export function splitTerms(raw: string): string[] {
  return (raw ?? "")
    .split(/\r?\n|\|\|/)
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}

/** Comparable form of a terms cell, so the same terms written with different separators still match. */
const termsKey = (raw: string) => splitTerms(raw).join("\n");

/** Does this row carry any line-item data at all? (an empty line block is allowed) */
function hasLineData(r: MappedRow): boolean {
  return !isBlank(r.itemName) || !isBlank(r.quantity) || !isBlank(r.unitPrice) || !isBlank(r.sku) || !isBlank(r.itemDescription);
}

/** Document-level (header) fields, excluding the grouping key itself. */
const HEADER_KEYS = QUOTATION_IMPORT_SPEC.fields
  .filter((f) => f.scope === "header" && f.key !== QUOTATION_IMPORT_SPEC.groupKey)
  .map((f) => f.key);
const HEADER_LABEL = new Map(QUOTATION_IMPORT_SPEC.fields.map((f) => [f.key, f.header]));

const DATE_KEYS = new Set(QUOTATION_IMPORT_SPEC.fields.filter((f) => f.kind === "date").map((f) => f.key));

/**
 * Two header values conflict only when both are filled in and mean different things — a blank cell
 * reads as "same as above". Comparison is per field: terms are compared as their split term list (so
 * the same terms written with `||` on one row and new lines on another are NOT a conflict), and dates
 * are compared as the date they resolve to (so 05/08/2026 and 2026-08-05 are the same day).
 */
function valuesConflict(key: string, a: string, b: string, formats?: DateFormats): boolean {
  let x = (a ?? "").trim(), y = (b ?? "").trim();
  if (!x || !y) return false;
  if (key === "terms") { x = termsKey(x); y = termsKey(y); }
  else if (DATE_KEYS.has(key)) {
    const da = normalizeDate(x, fmtFor(formats, key)), dbv = normalizeDate(y, fmtFor(formats, key));
    if (da && dbv) return da !== dbv;
  }
  return x.localeCompare(y, undefined, { sensitivity: "accent" }) !== 0;
}

/**
 * Group mapped rows into documents — ONE ROW PER LINE ITEM. Rows sharing a non-empty document
 * number form ONE document with one line item per row; the header is merged from the group's rows
 * (first non-blank value per field, so document values may be repeated on every row or written
 * once on the first). Rows with a blank number each become their own auto-numbered document and
 * are never grouped together. Document-level values that genuinely disagree within a group are
 * recorded in `conflicts` and block that document during preview.
 */
export function groupRows(rows: MappedRow[], formats?: DateFormats): DocDraft[] {
  const byKey = new Map<string, DocDraft>();
  const out: DocDraft[] = [];
  rows.forEach((r, i) => {
    const number = (r.number ?? "").trim();
    const key = number ? `n:${number.toLowerCase()}` : `r:${i}`;
    let doc = byKey.get(key);
    if (!doc) {
      doc = { key, number, header: { ...r }, lines: [], sourceRows: [], errors: [], rowErrors: new Map(), conflicts: [] };
      byKey.set(key, doc);
      out.push(doc);
    } else {
      // Merge this row's document-level values into the group header, flagging real disagreements.
      for (const k of HEADER_KEYS) {
        const existing = (doc.header[k] ?? "").trim();
        const incoming = (r[k] ?? "").trim();
        if (!incoming) continue;
        if (!existing) { doc.header[k] = incoming; continue; }
        if (valuesConflict(k, existing, incoming, formats)) {
          const label = HEADER_LABEL.get(k) ?? k;
          if (!doc.conflicts.some((c) => c.field === label)) {
            doc.conflicts.push({ field: label, values: [existing, incoming], row: i });
          }
        }
      }
    }
    doc.sourceRows.push(i);
    if (hasLineData(r)) {
      doc.lines.push({
        itemName: (r.itemName ?? "").trim(),
        itemDescription: (r.itemDescription ?? "").trim(),
        sku: (r.sku ?? "").trim(),
        quantity: (r.quantity ?? "").trim(),
        unitPrice: (r.unitPrice ?? "").trim(),
        unit: (r.unit ?? "").trim(),
        taxRate: (r.taxRate ?? "").trim(),
        itemDiscount: (r.itemDiscount ?? "").trim(),
        imageUrl: (r.imageUrl ?? "").trim(),
        sourceRow: i,
      });
    }
  });
  return out;
}

type OrgLookups = {
  customers: Map<string, number>;
  projects: Map<string, number>;
  products: Map<string, number>;
  existingNumbers: Set<string>;
};

/** One batched read of everything the validation needs — no per-row queries. */
async function loadLookups(orgId: number, docs: DocDraft[]): Promise<OrgLookups> {
  const [cust, proj, prod] = await Promise.all([
    db.select({ id: customersTable.id, name: customersTable.name }).from(customersTable).where(eq(customersTable.orgId, orgId)),
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.orgId, orgId)),
    db.select({ id: productsTable.id, sku: productsTable.sku }).from(productsTable).where(eq(productsTable.orgId, orgId)),
  ]);
  const numbers = docs.map((d) => d.number).filter(Boolean);
  const existing = numbers.length
    ? await db
        .select({ n: quotationsTable.quotationNumber })
        .from(quotationsTable)
        .where(and(eq(quotationsTable.orgId, orgId), inArray(quotationsTable.quotationNumber, numbers)))
    : [];
  return {
    customers: new Map(cust.map((c) => [c.name.trim().toLowerCase(), c.id])),
    projects: new Map(proj.map((p) => [p.name.trim().toLowerCase(), p.id])),
    products: new Map(prod.map((p) => [p.sku.trim().toLowerCase(), p.id])),
    existingNumbers: new Set(existing.map((e) => e.n.trim().toLowerCase())),
  };
}

export type PreviewSummary = {
  totalRows: number;
  documents: number;
  validDocuments: number;
  invalidDocuments: number;
  duplicateNumbers: string[];
  willCreate: number;
  /** Line items that will actually be created (valid documents only). */
  lineItems: number;
  /** Every line item detected in the file, valid or not. */
  totalLineItems: number;
  /** Documents blocked because their document-level values disagree across rows. */
  conflictingDocuments: number;
  invalidRows: number;
  /** Terms & Conditions entries detected across every document in the file. */
  totalTerms: number;
};

export type DocPreview = {
  key: string; number: string; client: string; lineCount: number;
  /** Parsed Issue Date / Valid Till (ISO), or "" when blank or unreadable. */
  issueDate: string; validUntil: string;
  /** How many individual terms this document's Terms & Conditions cell produced. */
  termCount: number;
  rows: number[]; ok: boolean; errors: string[];
  /** Human-readable description of any document-level value conflicts. */
  conflicts: string[];
};

export type PreviewResult = {
  summary: PreviewSummary;
  documents: DocPreview[];
  /** rowIndex -> messages, for the failed-rows CSV. */
  rowErrors: [number, string[]][];
};

/** Validate every grouped document against org data + the module's real rules. */
export async function validateQuotationImport(
  orgId: number,
  rows: MappedRow[],
  formats?: DateFormats,
): Promise<{ docs: DocDraft[]; result: PreviewResult }> {
  const docs = groupRows(rows, formats);
  const look = await loadLookups(orgId, docs);
  const seenNumbers = new Set<string>();
  const duplicateNumbers: string[] = [];

  for (const doc of docs) {
    const h = doc.header;
    const addRow = (row: number, msg: string) => {
      const cur = doc.rowErrors.get(row) ?? [];
      cur.push(msg);
      doc.rowErrors.set(row, cur);
    };
    const firstRow = doc.sourceRows[0];

    // --- document-level value conflicts across the group's rows ---
    for (const c of doc.conflicts) {
      doc.errors.push(`${c.field} differs between rows of quotation "${doc.number}" ("${c.values[0]}" vs "${c.values[1]}"). Document-level values must match on every row.`);
    }

    // --- header ---
    if (isBlank(h.client)) doc.errors.push("Client is required.");
    else if (!look.customers.has(h.client.trim().toLowerCase())) doc.errors.push(`Client "${h.client.trim()}" not found.`);

    // Dates are read with the format the user picked for that column during mapping. Issue Date is
    // mandatory; Valid Till is optional, and a blank cell is never an error.
    if (isBlank(h.issueDate)) doc.errors.push("Issue Date is required.");
    else {
      const r = parseDateCell(h.issueDate, fmtFor(formats, "issueDate"));
      if (!r.ok) doc.errors.push(dateError("Issue Date", h.issueDate, r.reason));
    }
    if (!isBlank(h.validUntil)) {
      const r = parseDateCell(h.validUntil, fmtFor(formats, "validUntil"));
      if (!r.ok) doc.errors.push(dateError("Valid Till", h.validUntil, r.reason));
    }
    if (!isBlank(h.currency) && !isValidCurrencyCode(h.currency.trim().toUpperCase())) doc.errors.push(`Currency "${h.currency.trim()}" is not a supported code.`);
    if (!isBlank(h.discount) && (!isNum(h.discount) || num(h.discount) < 0)) doc.errors.push("Discount must be a non-negative number.");
    if (!isBlank(h.project) && !look.projects.has(h.project.trim().toLowerCase())) doc.errors.push(`Project "${h.project.trim()}" not found.`);

    // Document numbers: never overwrite an existing document, and no repeats inside the file.
    if (doc.number) {
      const k = doc.number.toLowerCase();
      if (look.existingNumbers.has(k)) { doc.errors.push(`Quotation number "${doc.number}" already exists.`); duplicateNumbers.push(doc.number); }
      else if (seenNumbers.has(k)) { doc.errors.push(`Duplicate quotation number "${doc.number}" within the file.`); duplicateNumbers.push(doc.number); }
      seenNumbers.add(k);
    }

    // --- line items ---
    if (doc.lines.length === 0) doc.errors.push("At least one line item is required (Item Name, Quantity and Rate).");
    for (const l of doc.lines) {
      if (isBlank(l.itemName)) addRow(l.sourceRow, "Item Name is required for a line item.");
      if (isBlank(l.quantity)) addRow(l.sourceRow, "Quantity is required for a line item.");
      else if (!isNum(l.quantity) || num(l.quantity) <= 0) addRow(l.sourceRow, "Quantity must be a number greater than 0.");
      if (isBlank(l.unitPrice)) addRow(l.sourceRow, "Rate is required for a line item.");
      else if (!isNum(l.unitPrice) || num(l.unitPrice) < 0) addRow(l.sourceRow, "Rate must be a non-negative number.");
      if (!isBlank(l.taxRate) && (!isNum(l.taxRate) || num(l.taxRate) < 0 || num(l.taxRate) > 100)) addRow(l.sourceRow, "Tax Rate % must be between 0 and 100.");
      if (!isBlank(l.itemDiscount) && (!isNum(l.itemDiscount) || num(l.itemDiscount) < 0)) addRow(l.sourceRow, "Item Discount must be a non-negative number.");
      if (!isBlank(l.sku) && !look.products.has(l.sku.toLowerCase())) addRow(l.sourceRow, `SKU "${l.sku}" not found.`);
    }
    // Document-level problems are reported on the group's first row too, so the error file is complete.
    if (doc.errors.length) {
      const cur = doc.rowErrors.get(firstRow) ?? [];
      doc.rowErrors.set(firstRow, [...cur, ...doc.errors]);
    }
  }

  const documents: DocPreview[] = docs.map((d) => ({
    key: d.key,
    number: d.number || "(auto)",
    client: (d.header.client ?? "").trim(),
    lineCount: d.lines.length,
    issueDate: normalizeDate(d.header.issueDate ?? "", fmtFor(formats, "issueDate")) ?? "",
    validUntil: normalizeDate(d.header.validUntil ?? "", fmtFor(formats, "validUntil")) ?? "",
    termCount: splitTerms(d.header.terms ?? "").length,
    rows: d.sourceRows.map((r) => r + 2), // +2 = 1-based data row under the header row
    ok: d.errors.length === 0 && d.rowErrors.size === 0,
    errors: [...d.errors, ...[...d.rowErrors.values()].flat()].filter((v, i, a) => a.indexOf(v) === i),
    conflicts: d.conflicts.map((c) => `${c.field}: "${c.values[0]}" vs "${c.values[1]}"`),
  }));

  const rowErrorMap = new Map<number, string[]>();
  for (const d of docs) for (const [r, msgs] of d.rowErrors) rowErrorMap.set(r, [...(rowErrorMap.get(r) ?? []), ...msgs]);

  const validDocs = docs.filter((d) => d.errors.length === 0 && d.rowErrors.size === 0);
  const result: PreviewResult = {
    summary: {
      totalRows: rows.length,
      documents: docs.length,
      validDocuments: validDocs.length,
      invalidDocuments: docs.length - validDocs.length,
      duplicateNumbers: [...new Set(duplicateNumbers)],
      willCreate: validDocs.length,
      lineItems: validDocs.reduce((n, d) => n + d.lines.length, 0),
      totalLineItems: docs.reduce((n, d) => n + d.lines.length, 0),
      conflictingDocuments: docs.filter((d) => d.conflicts.length > 0).length,
      invalidRows: rowErrorMap.size,
      totalTerms: documents.reduce((n, d) => n + d.termCount, 0),
    },
    documents,
    rowErrors: [...rowErrorMap.entries()],
  };
  return { docs, result };
}

export type CommitOutcome = { imported: number; failed: number; skipped: number; lineItems: number; errors: [number, string[]][] };

/**
 * Insert the valid documents. Each quotation + its lines are written in their OWN transaction, so a
 * failure can never leave a header without its items, and one bad document cannot roll back the rest.
 */
export async function commitQuotationImport(
  orgId: number,
  userId: number,
  rows: MappedRow[],
  formats?: DateFormats,
): Promise<CommitOutcome> {
  // Re-validate server-side: the client's preview is never trusted.
  const { docs, result } = await validateQuotationImport(orgId, rows, formats);
  const look = await loadLookups(orgId, docs);
  const valid = docs.filter((d) => d.errors.length === 0 && d.rowErrors.size === 0);

  let imported = 0, failed = 0, lineItems = 0;
  const errors: [number, string[]][] = [...result.rowErrors];

  for (const doc of valid) {
    const h = doc.header;
    try {
      await db.transaction(async (tx) => {
        const number = doc.number || (await nextDocumentNumber(tx, orgId, "quotation"));
        const items = doc.lines.map((l) => ({
          description: l.itemName,
          quantity: String(num(l.quantity)),
          unitPrice: String(num(l.unitPrice)),
          taxRatePercent: isBlank(l.taxRate) ? "0" : String(num(l.taxRate)),
        }));
        const lineDiscounts = doc.lines.reduce((s, l) => s + (isBlank(l.itemDiscount) ? 0 : num(l.itemDiscount)), 0);
        const headerDiscount = isBlank(h.discount) ? 0 : num(h.discount);
        const totals = computeTotals(items, headerDiscount + lineDiscounts);

        // Migration metadata is appended to the document notes under a clear marker (no separate
        // migration store, no schema change) and is also captured in the audit log by the caller.
        const noteParts: string[] = [];
        if (!isBlank(h.notes)) noteParts.push(h.notes.trim());
        const migration: string[] = [];
        if (!isBlank(h.externalRef)) migration.push(`External reference: ${h.externalRef.trim()}`);
        if (!isBlank(h.migrationNote)) migration.push(h.migrationNote.trim());
        if (migration.length) noteParts.push(`— Imported —\n${migration.join("\n")}`);

        const importedTerms = splitTerms(h.terms ?? "").map((text) => ({ text, groupId: null, groupName: null }));

        const [q] = await tx
          .insert(quotationsTable)
          .values({
            orgId,
            quotationNumber: number,
            customerId: look.customers.get(h.client.trim().toLowerCase())!,
            projectId: isBlank(h.project) ? null : (look.projects.get(h.project.trim().toLowerCase()) ?? null),
            issueDate: normalizeDate(h.issueDate, fmtFor(formats, "issueDate"))!,
            validUntil: isBlank(h.validUntil) ? null : normalizeDate(h.validUntil, fmtFor(formats, "validUntil")),
            title: isBlank(h.title) ? null : h.title.trim(),
            currency: isBlank(h.currency) ? null : h.currency.trim().toUpperCase(),
            notes: noteParts.length ? noteParts.join("\n\n") : null,
            // Terms use the document terms shape ({ text, groupId, groupName }). One cell can carry
            // several terms (new line or ||) — each becomes its own numbered, group-less term, in the
            // order written. Terms are never folded into the notes field.
            terms: importedTerms.length ? importedTerms : null,
            status: "draft", // imports are always drafts — never posted
            subtotal: totals.subtotal,
            discount: totals.discount,
            taxTotal: totals.taxTotal,
            total: totals.total,
            createdById: userId,
          })
          .returning({ id: quotationsTable.id });

        await tx.insert(quotationItemsTable).values(
          doc.lines.map((l) => ({
            quotationId: q.id,
            productId: isBlank(l.sku) ? null : (look.products.get(l.sku.toLowerCase()) ?? null),
            description: l.itemName,
            quantity: String(num(l.quantity)),
            unitPrice: String(num(l.unitPrice)),
            taxRatePercent: isBlank(l.taxRate) ? "0" : String(num(l.taxRate)),
            lineTotal: (num(l.quantity) * num(l.unitPrice)).toFixed(2),
            unit: isBlank(l.unit) ? null : l.unit,
            imageUrl: isBlank(l.imageUrl) ? null : l.imageUrl,
            // Long description lives under the reserved key; the name stays in `description`.
            customFields: isBlank(l.itemDescription) ? {} : { [LINE_DESC_KEY]: l.itemDescription },
          })),
        );
        lineItems += doc.lines.length;
      });
      imported++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push([doc.sourceRows[0], [`Import failed: ${msg}`]]);
    }
  }

  return { imported, failed, skipped: docs.length - valid.length, lineItems, errors };
}

export const QUOTATION_SPEC = QUOTATION_IMPORT_SPEC;
export const MAX_IMPORT_ROWS = 5000;

/** Rows actually stored per document, used by the preview's "records that will be created" count. */
export function countCreated(docs: DocDraft[]): number {
  return docs.filter((d) => d.errors.length === 0 && d.rowErrors.size === 0).length;
}

export const _internal = { sql };
