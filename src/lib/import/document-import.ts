import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, customersTable, vendorsTable, projectsTable, productsTable,
  salesInvoicesTable, purchaseOrdersTable,
} from "@/db";
import { nextDocumentNumber } from "@/lib/documents";
import { computeTotals } from "@/app/(app)/sales/_shared/totals";
import { LINE_DESC_KEY } from "@/app/(app)/sales/_shared/line-item-desc";
import { isValidCurrencyCode } from "@/lib/currency/currencies";
import { DOC_FIELD_CONFIGS, partyKeyOf, type DocFieldConfig, type DocModule } from "./document-fields";
import { DOCUMENT_IMPORT_SPECS } from "./spec";
import { DOC_WRITERS } from "./document-config";
import { parseDateCell, DEFAULT_DATE_FORMAT, type DateFormat } from "./dates";

// Document import: turns the mapped grid into grouped documents, validates every group against the
// organization's real data, then writes each document + its line items in ONE transaction per
// document. Imported documents are always DRAFT — nothing posts to the ledger, moves stock, or
// triggers send/issue/receive/approve/cancel/payment.
//
// The same code runs for all eight document modules; per-module differences (which columns exist,
// which dates, priced vs. quantity-only, which table to write) come from the module's config.

export const MAX_IMPORT_ROWS = 5000;

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

type ModuleMeta = {
  cfg: DocFieldConfig;
  partyKey: string;
  headerKeys: string[];
  headerLabel: Map<string, string>;
  dateKeys: Set<string>;
};

const META = new Map<string, ModuleMeta>();

/** Field metadata for a module, derived once from its spec. */
function metaFor(module: DocModule): ModuleMeta {
  const hit = META.get(module);
  if (hit) return hit;
  const cfg = DOC_FIELD_CONFIGS[module];
  // Built from the same spec the template and mapping use, so header/label lists can never drift.
  const spec = DOCUMENT_IMPORT_SPECS[module];
  const m: ModuleMeta = {
    cfg,
    partyKey: partyKeyOf(cfg),
    headerKeys: spec.fields.filter((f) => f.scope === "header" && f.key !== "number").map((f) => f.key),
    headerLabel: new Map(spec.fields.map((f) => [f.key, f.header])),
    dateKeys: new Set(cfg.dates.map((d) => d.key)),
  };
  META.set(module, m);
  return m;
}

/**
 * Two header values conflict only when both are filled in and mean different things — a blank cell
 * reads as "same as above". Comparison is per field: terms are compared as their split term list (so
 * the same terms written with `||` on one row and new lines on another are NOT a conflict), and dates
 * are compared as the date they resolve to (so 05/08/2026 and 2026-08-05 are the same day).
 */
function valuesConflict(m: ModuleMeta, key: string, a: string, b: string, formats?: DateFormats): boolean {
  let x = (a ?? "").trim(), y = (b ?? "").trim();
  if (!x || !y) return false;
  if (key === "terms") { x = termsKey(x); y = termsKey(y); }
  else if (m.dateKeys.has(key)) {
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
export function groupRows(module: DocModule, rows: MappedRow[], formats?: DateFormats): DocDraft[] {
  const m = metaFor(module);
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
      for (const k of m.headerKeys) {
        const existing = (doc.header[k] ?? "").trim();
        const incoming = (r[k] ?? "").trim();
        if (!incoming) continue;
        if (!existing) { doc.header[k] = incoming; continue; }
        if (valuesConflict(m, k, existing, incoming, formats)) {
          const label = m.headerLabel.get(k) ?? k;
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
  parties: Map<string, number>;
  projects: Map<string, number>;
  products: Map<string, number>;
  existingNumbers: Set<string>;
  sourceDocs: Map<string, number>;
};

/** One batched read of everything the validation needs — no per-row queries. */
async function loadLookups(module: DocModule, orgId: number, docs: DocDraft[]): Promise<OrgLookups> {
  const cfg = DOC_FIELD_CONFIGS[module];
  const [parties, proj, prod] = await Promise.all([
    cfg.party === "customer"
      ? db.select({ id: customersTable.id, name: customersTable.name }).from(customersTable).where(eq(customersTable.orgId, orgId))
      : db.select({ id: vendorsTable.id, name: vendorsTable.name }).from(vendorsTable).where(eq(vendorsTable.orgId, orgId)),
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.orgId, orgId)),
    db.select({ id: productsTable.id, sku: productsTable.sku }).from(productsTable).where(eq(productsTable.orgId, orgId)),
  ]);

  const numbers = docs.map((d) => d.number).filter(Boolean);
  const existing = numbers.length ? await existingNumbersFor(module, orgId, numbers) : [];

  // Credit/Debit notes must point at a document that already exists in this organization.
  let sourceDocs = new Map<string, number>();
  if (cfg.sourceDoc) {
    const refs = [...new Set(docs.map((d) => (d.header[cfg.sourceDoc!.key] ?? "").trim()).filter(Boolean))];
    if (refs.length) {
      const rows = cfg.sourceDoc.module === "sales_invoice"
        ? await db.select({ id: salesInvoicesTable.id, n: salesInvoicesTable.invoiceNumber }).from(salesInvoicesTable)
            .where(and(eq(salesInvoicesTable.orgId, orgId), inArray(salesInvoicesTable.invoiceNumber, refs)))
        : await db.select({ id: purchaseOrdersTable.id, n: purchaseOrdersTable.poNumber }).from(purchaseOrdersTable)
            .where(and(eq(purchaseOrdersTable.orgId, orgId), inArray(purchaseOrdersTable.poNumber, refs)));
      sourceDocs = new Map(rows.map((r) => [r.n.trim().toLowerCase(), r.id]));
    }
  }

  return {
    parties: new Map(parties.map((c) => [c.name.trim().toLowerCase(), c.id])),
    projects: new Map(proj.map((p) => [p.name.trim().toLowerCase(), p.id])),
    products: new Map(prod.map((p) => [p.sku.trim().toLowerCase(), p.id])),
    existingNumbers: new Set(existing.map((e) => e.trim().toLowerCase())),
    sourceDocs,
  };
}

/** Numbers already used by this module in this org (tenant-scoped). */
async function existingNumbersFor(module: DocModule, orgId: number, numbers: string[]): Promise<string[]> {
  const {
    quotationsTable, salesOrdersTable, proformaInvoicesTable, deliveryChallansTable,
    creditNotesTable, debitNotesTable,
  } = await import("@/db");
  switch (module) {
    case "quotation": {
      const r = await db.select({ n: quotationsTable.quotationNumber }).from(quotationsTable)
        .where(and(eq(quotationsTable.orgId, orgId), inArray(quotationsTable.quotationNumber, numbers)));
      return r.map((x) => x.n);
    }
    case "sales_order": {
      const r = await db.select({ n: salesOrdersTable.soNumber }).from(salesOrdersTable)
        .where(and(eq(salesOrdersTable.orgId, orgId), inArray(salesOrdersTable.soNumber, numbers)));
      return r.map((x) => x.n);
    }
    case "proforma_invoice": {
      const r = await db.select({ n: proformaInvoicesTable.proformaNumber }).from(proformaInvoicesTable)
        .where(and(eq(proformaInvoicesTable.orgId, orgId), inArray(proformaInvoicesTable.proformaNumber, numbers)));
      return r.map((x) => x.n);
    }
    case "sales_invoice": {
      const r = await db.select({ n: salesInvoicesTable.invoiceNumber }).from(salesInvoicesTable)
        .where(and(eq(salesInvoicesTable.orgId, orgId), inArray(salesInvoicesTable.invoiceNumber, numbers)));
      return r.map((x) => x.n);
    }
    case "delivery_challan": {
      const r = await db.select({ n: deliveryChallansTable.dcNumber }).from(deliveryChallansTable)
        .where(and(eq(deliveryChallansTable.orgId, orgId), inArray(deliveryChallansTable.dcNumber, numbers)));
      return r.map((x) => x.n);
    }
    case "purchase_order": {
      const r = await db.select({ n: purchaseOrdersTable.poNumber }).from(purchaseOrdersTable)
        .where(and(eq(purchaseOrdersTable.orgId, orgId), inArray(purchaseOrdersTable.poNumber, numbers)));
      return r.map((x) => x.n);
    }
    case "credit_note": {
      const r = await db.select({ n: creditNotesTable.creditNoteNumber }).from(creditNotesTable)
        .where(and(eq(creditNotesTable.orgId, orgId), inArray(creditNotesTable.creditNoteNumber, numbers)));
      return r.map((x) => x.n);
    }
    case "debit_note": {
      const r = await db.select({ n: debitNotesTable.debitNoteNumber }).from(debitNotesTable)
        .where(and(eq(debitNotesTable.orgId, orgId), inArray(debitNotesTable.debitNoteNumber, numbers)));
      return r.map((x) => x.n);
    }
  }
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
  /** Parsed primary / secondary dates (ISO), or "" when blank or unreadable. */
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
export async function validateDocumentImport(
  module: DocModule,
  orgId: number,
  rows: MappedRow[],
  formats?: DateFormats,
): Promise<{ docs: DocDraft[]; result: PreviewResult }> {
  const m = metaFor(module);
  const cfg = m.cfg;
  const docs = groupRows(module, rows, formats);
  const look = await loadLookups(module, orgId, docs);
  const seenNumbers = new Set<string>();
  const duplicateNumbers: string[] = [];
  const partyLabel = cfg.partyHeader;

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
      doc.errors.push(`${c.field} differs between rows of ${cfg.noun} "${doc.number}" ("${c.values[0]}" vs "${c.values[1]}"). Document-level values must match on every row.`);
    }

    // --- party (client / vendor) ---
    const party = (h[m.partyKey] ?? "").trim();
    if (!party) doc.errors.push(`${partyLabel} is required.`);
    else if (!look.parties.has(party.toLowerCase())) doc.errors.push(`${partyLabel} "${party}" not found.`);

    // --- dates: read with the format picked for that column during mapping ---
    for (const d of cfg.dates) {
      const raw = h[d.key] ?? "";
      if (isBlank(raw)) {
        if (d.required) doc.errors.push(`${d.header} is required.`);
        continue;
      }
      const r = parseDateCell(raw, fmtFor(formats, d.key));
      if (!r.ok) doc.errors.push(dateError(d.header, raw, r.reason));
    }

    if (!isBlank(h.currency) && !isValidCurrencyCode(h.currency.trim().toUpperCase())) doc.errors.push(`Currency "${h.currency.trim()}" is not a supported code.`);
    if (cfg.pricing && !isBlank(h.discount) && (!isNum(h.discount) || num(h.discount) < 0)) doc.errors.push("Discount must be a non-negative number.");
    if (cfg.hasProject && !isBlank(h.project) && !look.projects.has(h.project.trim().toLowerCase())) doc.errors.push(`Project "${h.project.trim()}" not found.`);

    // --- required reference to an existing document (Credit Note / Debit Note) ---
    if (cfg.sourceDoc) {
      const ref = (h[cfg.sourceDoc.key] ?? "").trim();
      if (!ref) doc.errors.push(`${cfg.sourceDoc.header} is required.`);
      else if (!look.sourceDocs.has(ref.toLowerCase())) doc.errors.push(`${cfg.sourceDoc.header} "${ref}" not found.`);
    }

    // Document numbers: never overwrite an existing document, and no repeats inside the file.
    if (doc.number) {
      const k = doc.number.toLowerCase();
      const Noun = cfg.noun.charAt(0).toUpperCase() + cfg.noun.slice(1);
      if (look.existingNumbers.has(k)) { doc.errors.push(`${Noun} number "${doc.number}" already exists.`); duplicateNumbers.push(doc.number); }
      else if (seenNumbers.has(k)) { doc.errors.push(`Duplicate ${cfg.noun} number "${doc.number}" within the file.`); duplicateNumbers.push(doc.number); }
      seenNumbers.add(k);
    }

    // --- line items ---
    if (doc.lines.length === 0) {
      doc.errors.push(cfg.pricing
        ? `At least one line item is required (Item Name, Quantity and ${cfg.priceHeader}).`
        : "At least one line item is required (Item Name and Quantity).");
    }
    for (const l of doc.lines) {
      if (isBlank(l.itemName)) addRow(l.sourceRow, "Item Name is required for a line item.");
      if (isBlank(l.quantity)) addRow(l.sourceRow, "Quantity is required for a line item.");
      else if (!isNum(l.quantity) || num(l.quantity) <= 0) addRow(l.sourceRow, "Quantity must be a number greater than 0.");
      if (cfg.pricing) {
        if (isBlank(l.unitPrice)) addRow(l.sourceRow, `${cfg.priceHeader} is required for a line item.`);
        else if (!isNum(l.unitPrice) || num(l.unitPrice) < 0) addRow(l.sourceRow, `${cfg.priceHeader} must be a non-negative number.`);
        if (!isBlank(l.taxRate) && (!isNum(l.taxRate) || num(l.taxRate) < 0 || num(l.taxRate) > 100)) addRow(l.sourceRow, "Tax Rate % must be between 0 and 100.");
        if (!isBlank(l.itemDiscount) && (!isNum(l.itemDiscount) || num(l.itemDiscount) < 0)) addRow(l.sourceRow, "Item Discount must be a non-negative number.");
      }
      if (!isBlank(l.sku) && !look.products.has(l.sku.toLowerCase())) addRow(l.sourceRow, `SKU "${l.sku}" not found.`);
    }
    // Document-level problems are reported on the group's first row too, so the error file is complete.
    if (doc.errors.length) {
      const cur = doc.rowErrors.get(firstRow) ?? [];
      doc.rowErrors.set(firstRow, [...cur, ...doc.errors]);
    }
  }

  const d0 = cfg.dates[0]?.key, d1 = cfg.dates[1]?.key;
  const documents: DocPreview[] = docs.map((d) => ({
    key: d.key,
    number: d.number || "(auto)",
    client: (d.header[m.partyKey] ?? "").trim(),
    lineCount: d.lines.length,
    issueDate: d0 ? (normalizeDate(d.header[d0] ?? "", fmtFor(formats, d0)) ?? "") : "",
    validUntil: d1 ? (normalizeDate(d.header[d1] ?? "", fmtFor(formats, d1)) ?? "") : "",
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
 * Write the valid documents. Each document + its lines go in their OWN transaction, so a failure can
 * never leave a header without its items or wrong totals, and one bad document cannot roll back the
 * rest. Everything is created as a draft; no lifecycle action is triggered.
 */
export async function commitDocumentImport(
  module: DocModule,
  orgId: number,
  userId: number,
  rows: MappedRow[],
  formats?: DateFormats,
): Promise<CommitOutcome> {
  const m = metaFor(module);
  const cfg = m.cfg;
  // Re-validate server-side: the client's preview is never trusted.
  const { docs, result } = await validateDocumentImport(module, orgId, rows, formats);
  const look = await loadLookups(module, orgId, docs);
  const valid = docs.filter((d) => d.errors.length === 0 && d.rowErrors.size === 0);

  let imported = 0, failed = 0, lineItems = 0;
  const errors: [number, string[]][] = [...result.rowErrors];

  for (const doc of valid) {
    const h = doc.header;
    try {
      await db.transaction(async (tx) => {
        const number = doc.number || (await nextDocumentNumber(tx, orgId, module));

        // Totals: quantity-only modules (Delivery Challan) carry no money at all.
        const totals = cfg.pricing
          ? computeTotals(
              doc.lines.map((l) => ({
                quantity: String(num(l.quantity)),
                unitPrice: String(num(l.unitPrice)),
                taxRatePercent: isBlank(l.taxRate) ? "0" : String(num(l.taxRate)),
              })),
              (isBlank(h.discount) ? 0 : num(h.discount)) +
                doc.lines.reduce((s, l) => s + (isBlank(l.itemDiscount) ? 0 : num(l.itemDiscount)), 0),
            )
          : { subtotal: "0", discount: "0", taxTotal: "0", total: "0" };

        // Migration metadata is appended to the document notes under a clear marker (no separate
        // migration store, no schema change) and is also captured in the audit log by the caller.
        const noteParts: string[] = [];
        if (!isBlank(h.notes)) noteParts.push(h.notes.trim());
        const migration: string[] = [];
        if (!isBlank(h.externalRef)) migration.push(`External reference: ${h.externalRef.trim()}`);
        if (!isBlank(h.migrationNote)) migration.push(h.migrationNote.trim());
        if (migration.length) noteParts.push(`— Imported —\n${migration.join("\n")}`);

        // One cell can carry several terms (new line or ||) — each becomes its own numbered,
        // group-less term, in the order written. Terms are never folded into the notes field.
        const importedTerms = splitTerms(h.terms ?? "").map((text) => ({ text, groupId: null, groupName: null }));

        const dates: Record<string, string> = {};
        for (const d of cfg.dates) {
          const iso = normalizeDate(h[d.key] ?? "", fmtFor(formats, d.key));
          if (iso) dates[d.key] = iso;
        }

        await DOC_WRITERS[module]({
          tx,
          orgId,
          userId,
          number,
          partyId: look.parties.get((h[m.partyKey] ?? "").trim().toLowerCase())!,
          projectId: cfg.hasProject && !isBlank(h.project) ? (look.projects.get(h.project.trim().toLowerCase()) ?? null) : null,
          sourceDocId: cfg.sourceDoc ? (look.sourceDocs.get((h[cfg.sourceDoc.key] ?? "").trim().toLowerCase()) ?? null) : null,
          h,
          dates,
          title: isBlank(h.title) ? null : h.title.trim(),
          currency: isBlank(h.currency) ? null : h.currency.trim().toUpperCase(),
          notes: noteParts.length ? noteParts.join("\n\n") : null,
          terms: importedTerms.length ? importedTerms : null,
          totals,
          lines: doc.lines.map((l) => ({
            productId: isBlank(l.sku) ? null : (look.products.get(l.sku.toLowerCase()) ?? null),
            // Item name is the line's primary text; the long description is kept separately.
            description: l.itemName,
            quantity: String(num(l.quantity)),
            unitPrice: cfg.pricing ? String(num(l.unitPrice)) : "0",
            taxRatePercent: cfg.pricing && !isBlank(l.taxRate) ? String(num(l.taxRate)) : "0",
            lineTotal: cfg.pricing ? (num(l.quantity) * num(l.unitPrice)).toFixed(2) : "0",
            unit: isBlank(l.unit) ? null : l.unit,
            imageUrl: isBlank(l.imageUrl) ? null : l.imageUrl,
            customFields: (isBlank(l.itemDescription) ? {} : { [LINE_DESC_KEY]: l.itemDescription }) as Record<string, string>,
          })),
        });
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
