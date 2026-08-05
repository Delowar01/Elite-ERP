// Import field specifications — the ONE source of truth for a module's importable fields. The
// downloadable template, the auto column-mapping, the validation preview and the insert all read
// from the same spec, so a field can never be offered in the template but rejected on import.
//
// Scope note: only fields that are genuinely required by the database / business rules are marked
// `required`. Everything else may be left blank without failing the row.

/** Where a column belongs: the document header, or one of its line items. */
export type FieldScope = "header" | "line";

export type FieldSpec = {
  key: string;
  /** Template column header (also the primary auto-mapping match). */
  header: string;
  scope: FieldScope;
  required: boolean;
  /** Extra header spellings accepted by auto-mapping (lowercased, compared loosely). */
  aliases?: string[];
  /** Shown in the template's field-guide sheet. */
  guide: string;
  /** Value used in the template's single example row. */
  example?: string;
};

export type ImportSpec = {
  module: string;
  label: string;
  /** The column that groups multiple rows into one document (repeat it per line item). */
  groupKey: string;
  fields: FieldSpec[];
  /**
   * Example rows written into the template — ONE ROW PER LINE ITEM. Includes a multi-line document
   * (same number repeated) plus a second document, so the grouping rule is obvious from the file.
   */
  exampleRows: Record<string, string>[];
};

/** Normalize a header for tolerant matching: lowercase, strip punctuation/spaces. */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-./\\]+/g, "").replace(/[^a-z0-9]/g, "");
}

export const QUOTATION_IMPORT_SPEC: ImportSpec = {
  module: "quotation",
  label: "Quotations",
  groupKey: "number",
  fields: [
    // ---- document header ----
    {
      key: "number", header: "Quotation Number", scope: "header", required: false,
      aliases: ["quotationno", "quoteno", "quotenumber", "documentnumber", "docnumber", "number"],
      guide: "Groups rows into one quotation — repeat the same number on every line item of that quotation. Leave blank to auto-generate a number (each blank row becomes its own quotation). Must not already exist.",
      example: "QTN-2026-0001",
    },
    {
      key: "client", header: "Client", scope: "header", required: true,
      aliases: ["customer", "clientname", "customername", "party", "account"],
      guide: "REQUIRED. Must match an existing client name in your organization (case-insensitive).",
      example: "Acme Trading Co.",
    },
    {
      key: "issueDate", header: "Issue Date", scope: "header", required: true,
      aliases: ["date", "documentdate", "docdate", "quotationdate"],
      guide: "REQUIRED. Format YYYY-MM-DD (Excel date cells are also accepted).",
      example: "2026-01-15",
    },
    {
      key: "validUntil", header: "Valid Till", scope: "header", required: false,
      aliases: ["validuntil", "validtilldate", "expirydate", "duedate"],
      guide: "Optional. Format YYYY-MM-DD.",
      example: "2026-02-15",
    },
    {
      key: "title", header: "Title", scope: "header", required: false,
      aliases: ["subject", "documenttitle"],
      guide: "Optional free-text title for the quotation.",
      example: "Exhibition stand — Hall 3",
    },
    {
      key: "currency", header: "Currency", scope: "header", required: false,
      aliases: ["currencycode", "curr"],
      guide: "Optional ISO code (e.g. SAR, AED, USD). Defaults to the organization currency.",
      example: "SAR",
    },
    {
      key: "discount", header: "Discount", scope: "header", required: false,
      aliases: ["documentdiscount", "headerdiscount", "discountamount"],
      guide: "Optional document-level discount amount (applied before VAT). Numbers only.",
      example: "100",
    },
    {
      key: "project", header: "Project", scope: "header", required: false,
      aliases: ["projectname", "projectref"],
      guide: "Optional. Must match an existing project name if provided.",
      example: "",
    },
    {
      key: "notes", header: "Notes", scope: "header", required: false,
      aliases: ["note", "remarks", "comment"],
      guide: "Optional free-text notes shown on the document.",
      example: "Delivery within 4 weeks of approval.",
    },
    {
      key: "terms", header: "Terms and Conditions", scope: "header", required: false,
      aliases: ["terms", "termsconditions", "tc"],
      guide: "Optional plain-text terms. Imported as a single custom terms block.",
      example: "Payment 50% advance, balance on delivery.",
    },
    // ---- migration (optional) ----
    {
      key: "externalRef", header: "External Reference", scope: "header", required: false,
      aliases: ["originaldocumentnumber", "originalnumber", "legacyreference", "externalsystemreference", "previousreference", "reference"],
      guide: "Optional migration field. The document's number in your previous system; recorded on the imported quotation and in the audit log.",
      example: "",
    },
    {
      key: "migrationNote", header: "Migration Note", scope: "header", required: false,
      aliases: ["migrationnotes", "importnote"],
      guide: "Optional migration field. Free text recorded with the imported record.",
      example: "",
    },
    // ---- line items ----
    {
      key: "itemName", header: "Item Name", scope: "line", required: false,
      aliases: ["item", "product", "productname", "itemtitle", "description"],
      guide: "The line item's name. Required for any row that carries line-item data (quantity/rate/etc.).",
      example: "Custom stand build 6x3m",
    },
    {
      key: "itemDescription", header: "Item Description", scope: "line", required: false,
      aliases: ["longdescription", "itemlongdescription", "details", "itemdetails"],
      guide: "Optional long description for the line, stored as the line's elaboration (customFields.__desc). The Item Name stays the primary text.",
      example: "Includes design, print, build and dismantle.",
    },
    {
      key: "sku", header: "SKU", scope: "line", required: false,
      aliases: ["productcode", "itemcode", "code"],
      guide: "Optional. If it matches an existing product SKU the line is linked to that product. Product master data is never modified by import.",
      example: "",
    },
    {
      key: "quantity", header: "Quantity", scope: "line", required: false,
      aliases: ["qty", "units"],
      guide: "Required for a line item. Must be a number greater than 0.",
      example: "1",
    },
    {
      key: "unitPrice", header: "Rate", scope: "line", required: false,
      aliases: ["unitprice", "price", "rate", "unitrate"],
      guide: "Required for a line item. Unit price, numbers only (no currency symbol).",
      example: "18500",
    },
    {
      key: "unit", header: "Unit", scope: "line", required: false,
      aliases: ["uom", "unitofmeasure"],
      guide: "Optional unit label (e.g. pcs, m2, hrs).",
      example: "pcs",
    },
    {
      key: "taxRate", header: "Tax Rate %", scope: "line", required: false,
      aliases: ["vat", "vatrate", "taxpercent", "taxratepercent", "vatpercent"],
      guide: "Optional VAT percentage for the line (e.g. 15). Defaults to 0.",
      example: "15",
    },
    {
      key: "itemDiscount", header: "Item Discount", scope: "line", required: false,
      aliases: ["linediscount", "discountperitem"],
      guide: "Optional per-line discount amount; added to the document discount total.",
      example: "",
    },
    {
      key: "imageUrl", header: "Item Image URL", scope: "line", required: false,
      aliases: ["image", "itemimage", "imagelink", "itemimagereference"],
      guide: "Optional link to a line-item image.",
      example: "",
    },
  ],
  // QT-1001 has THREE line items (same number repeated, document values echoed on each row);
  // QT-1002 is a separate quotation with one line item.
  exampleRows: [
    {
      number: "QT-1001", client: "ABC Company", issueDate: "2026-08-05", validUntil: "2026-09-05",
      title: "Exhibition package", currency: "SAR", discount: "0", notes: "Delivery within 4 weeks.",
      terms: "Payment 50% advance, balance on delivery.",
      itemName: "Exhibition Stand", itemDescription: "6x4 custom stand", quantity: "1", unitPrice: "15000", unit: "pcs", taxRate: "15",
    },
    {
      number: "QT-1001", client: "ABC Company", issueDate: "2026-08-05", validUntil: "2026-09-05",
      title: "Exhibition package", currency: "SAR", discount: "0", notes: "Delivery within 4 weeks.",
      terms: "Payment 50% advance, balance on delivery.",
      itemName: "LED Screen", itemDescription: "4x2 metre screen", quantity: "2", unitPrice: "2500", unit: "pcs", taxRate: "15",
    },
    {
      number: "QT-1001", client: "ABC Company", issueDate: "2026-08-05", validUntil: "2026-09-05",
      title: "Exhibition package", currency: "SAR", discount: "0", notes: "Delivery within 4 weeks.",
      terms: "Payment 50% advance, balance on delivery.",
      itemName: "Furniture", itemDescription: "Sofa and table set", quantity: "3", unitPrice: "800", unit: "set", taxRate: "15",
    },
    {
      number: "QT-1002", client: "XYZ Company", issueDate: "2026-08-05", currency: "SAR",
      itemName: "Branding", itemDescription: "Vinyl branding", quantity: "10", unitPrice: "120", unit: "m2", taxRate: "15",
    },
  ],
};

export const IMPORT_SPECS: Record<string, ImportSpec> = {
  quotation: QUOTATION_IMPORT_SPEC,
};

export function importSpec(module: string): ImportSpec | null {
  return IMPORT_SPECS[module] ?? null;
}

/**
 * Auto-map uploaded file headers to spec fields: exact header match first, then aliases, then a
 * normalized comparison. Unmatched source columns are simply ignored (mapping[key] === -1).
 */
export function autoMap(spec: ImportSpec, fileHeaders: string[]): Record<string, number> {
  const norm = fileHeaders.map((h) => normalizeHeader(h));
  const used = new Set<number>();
  const out: Record<string, number> = {};
  for (const f of spec.fields) {
    const candidates = [f.header, ...(f.aliases ?? [])].map(normalizeHeader);
    let found = -1;
    for (const c of candidates) {
      const i = norm.findIndex((h, idx) => h === c && !used.has(idx));
      if (i >= 0) { found = i; break; }
    }
    if (found >= 0) used.add(found);
    out[f.key] = found;
  }
  return out;
}
