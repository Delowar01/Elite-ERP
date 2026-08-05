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

/** Accepts YYYY-MM-DD, plus common DD/MM/YYYY and MM/DD/YYYY-ish inputs from legacy exports. */
export function normalizeDate(v: string): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const [, y, mo, d] = m;
    const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  if (m) {
    // Ambiguous D/M vs M/D: treat >12 in the first slot as a day, otherwise assume D/M (ISO-region default).
    const a = Number(m[1]), b = Number(m[2]), y = m[3];
    const day = a > 12 ? a : a, mon = a > 12 ? b : b;
    const iso = `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  return null;
}

/** Does this row carry any line-item data at all? (an empty line block is allowed) */
function hasLineData(r: MappedRow): boolean {
  return !isBlank(r.itemName) || !isBlank(r.quantity) || !isBlank(r.unitPrice) || !isBlank(r.sku) || !isBlank(r.itemDescription);
}

/** Document-level (header) fields, excluding the grouping key itself. */
const HEADER_KEYS = QUOTATION_IMPORT_SPEC.fields
  .filter((f) => f.scope === "header" && f.key !== QUOTATION_IMPORT_SPEC.groupKey)
  .map((f) => f.key);
const HEADER_LABEL = new Map(QUOTATION_IMPORT_SPEC.fields.map((f) => [f.key, f.header]));

/** Two header values conflict only when both are filled in and differ (blank = "same as above"). */
function conflicts(a: string, b: string): boolean {
  const x = (a ?? "").trim(), y = (b ?? "").trim();
  if (!x || !y) return false;
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
export function groupRows(rows: MappedRow[]): DocDraft[] {
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
        if (conflicts(existing, incoming)) {
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
};

export type DocPreview = {
  key: string; number: string; client: string; lineCount: number;
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
export async function validateQuotationImport(orgId: number, rows: MappedRow[]): Promise<{ docs: DocDraft[]; result: PreviewResult }> {
  const docs = groupRows(rows);
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

    if (isBlank(h.issueDate)) doc.errors.push("Issue Date is required.");
    else if (!normalizeDate(h.issueDate)) doc.errors.push(`Issue Date "${h.issueDate}" is not a valid date (use YYYY-MM-DD).`);

    if (!isBlank(h.validUntil) && !normalizeDate(h.validUntil)) doc.errors.push(`Valid Till "${h.validUntil}" is not a valid date.`);
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
export async function commitQuotationImport(orgId: number, userId: number, rows: MappedRow[]): Promise<CommitOutcome> {
  // Re-validate server-side: the client's preview is never trusted.
  const { docs, result } = await validateQuotationImport(orgId, rows);
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

        const [q] = await tx
          .insert(quotationsTable)
          .values({
            orgId,
            quotationNumber: number,
            customerId: look.customers.get(h.client.trim().toLowerCase())!,
            projectId: isBlank(h.project) ? null : (look.projects.get(h.project.trim().toLowerCase()) ?? null),
            issueDate: normalizeDate(h.issueDate)!,
            validUntil: isBlank(h.validUntil) ? null : normalizeDate(h.validUntil),
            title: isBlank(h.title) ? null : h.title.trim(),
            currency: isBlank(h.currency) ? null : h.currency.trim().toUpperCase(),
            notes: noteParts.length ? noteParts.join("\n\n") : null,
            // Terms use the document terms shape ({ text, groupId, groupName }); an imported block is a
            // free-text term with no preset group.
            terms: isBlank(h.terms) ? null : [{ text: h.terms.trim(), groupId: null, groupName: null }],
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
