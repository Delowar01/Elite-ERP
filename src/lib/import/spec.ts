// Import field specifications — the ONE source of truth for a module's importable fields. The
// downloadable template, the auto column-mapping, the validation preview and the insert all read
// from the same spec, so a field can never be offered in the template but rejected on import.
//
// Scope note: only fields that are genuinely required by the database / business rules are marked
// `required`. Everything else may be left blank without failing the row.

/** Where a column belongs: the document header, or one of its line items. */
export type FieldScope = "header" | "line";

/** Value shape of a column, where it changes how the column is read. */
export type FieldKind = "text" | "date";

export type FieldSpec = {
  key: string;
  /** Template column header (also the primary auto-mapping match). */
  header: string;
  scope: FieldScope;
  required: boolean;
  /** "date" columns get a date-format selector in the mapping step. Defaults to "text". */
  kind?: FieldKind;
  /** Extra header spellings accepted by auto-mapping (lowercased, compared loosely). */
  aliases?: string[];
  /** Shown in the template's field-guide sheet. */
  guide: string;
  /** Value used in the template's single example row. */
  example?: string;
};

/**
 * What one spreadsheet row means:
 *  - "document": several rows can build one document (one row per line item) — the sales-chain shape.
 *  - "record":   one row is one record, with no line items — the master-data shape.
 */
export type ImportEntity = "document" | "record";

export type ImportSpec = {
  module: string;
  label: string;
  entity: ImportEntity;
  /** Document specs only: the column that groups multiple rows into one document. */
  groupKey?: string;
  /** Record specs only: offer the "skip vs. update matching records" choice in the preview step. */
  duplicateHandling?: boolean;
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
  entity: "document",
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
      key: "issueDate", header: "Issue Date", scope: "header", required: true, kind: "date",
      aliases: ["date", "documentdate", "docdate", "quotationdate"],
      guide: "REQUIRED. Choose this column's date format during column mapping. Excel date cells are read directly.",
      example: "2026-01-15",
    },
    {
      key: "validUntil", header: "Valid Till", scope: "header", required: false, kind: "date",
      aliases: ["validuntil", "validtilldate", "expirydate", "duedate"],
      guide: "Optional. Same date format as Issue Date; leave blank if the quotation has no expiry.",
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
      key: "terms", header: "Terms & Conditions", scope: "header", required: false,
      aliases: ["terms", "termsandconditions", "termsconditions", "tc"],
      guide: "Optional. Put several terms in ONE cell, separated by a new line or by ||. Each becomes its own numbered term on the quotation. For a multi-line quotation, fill this on the first row only.",
      example: "Payment must be made within 30 days.\nPrices are valid for 15 days.",
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
  // QT-1001 has THREE line items (same number repeated on each row). Document-level values —
  // including the multi-term Terms & Conditions cell — are written on the FIRST row only and left
  // blank on the rest, which is the shortest correct way to fill the sheet in. QT-1002 is a separate
  // quotation with one line item.
  exampleRows: [
    {
      number: "QT-1001", client: "ABC Company", issueDate: "2026-08-05", validUntil: "2026-09-05",
      title: "Exhibition package", currency: "SAR", discount: "0", notes: "Delivery within 4 weeks.",
      terms: "Payment must be made within 30 days.\nPrices are valid for 15 days.\nAdditional work will be charged separately.",
      itemName: "Exhibition Stand", itemDescription: "6x4 custom stand", quantity: "1", unitPrice: "15000", unit: "pcs", taxRate: "15",
    },
    {
      number: "QT-1001",
      itemName: "LED Screen", itemDescription: "4x2 metre screen", quantity: "2", unitPrice: "2500", unit: "pcs", taxRate: "15",
    },
    {
      number: "QT-1001",
      itemName: "Furniture", itemDescription: "Sofa and table set", quantity: "3", unitPrice: "800", unit: "set", taxRate: "15",
    },
    {
      number: "QT-1002", client: "XYZ Company", issueDate: "2026-08-12", validUntil: "2026-09-12", currency: "SAR",
      terms: "Payment must be made within 30 days. || Prices are valid for 15 days.",
      itemName: "Branding", itemDescription: "Vinyl branding", quantity: "10", unitPrice: "120", unit: "m2", taxRate: "15",
    },
  ],
};

/**
 * Clients — one row per client. Every column maps to a column that already exists on `customers`;
 * nothing here invents a field the create/edit form cannot also set. Only Client Name is mandatory.
 */
export const CLIENT_IMPORT_SPEC: ImportSpec = {
  module: "client",
  label: "Clients",
  entity: "record",
  duplicateHandling: true,
  fields: [
    {
      key: "name", header: "Client Name", scope: "header", required: true,
      aliases: ["name", "customer", "customername", "clientname", "company", "companyname", "party"],
      guide: "REQUIRED. The client's business or personal name, exactly as it should appear on documents.",
      example: "ABC Trading Co.",
    },
    {
      key: "clientType", header: "Client Type", scope: "header", required: false,
      aliases: ["type", "customertype", "partytype"],
      guide: "Optional. Either \"company\" or \"individual\". Defaults to individual.",
      example: "company",
    },
    {
      key: "email", header: "Email", scope: "header", required: false,
      aliases: ["emailaddress", "mail", "contactemail"],
      guide: "Optional. Must be a valid email address if provided. Also used to match existing clients.",
      example: "accounts@abctrading.com",
    },
    {
      key: "phone", header: "Phone", scope: "header", required: false,
      aliases: ["phonenumber", "mobile", "mobilenumber", "telephone", "tel", "contactnumber"],
      guide: "Optional. Digits with optional + ( ) - and spaces. Also used to match existing clients.",
      example: "+966 11 234 5678",
    },
    {
      key: "vatNumber", header: "VAT Number", scope: "header", required: false,
      aliases: ["vat", "vatno", "taxnumber", "trn", "vatregistrationnumber"],
      guide: "Optional. The client's tax/VAT registration number. Strongest identifier for matching an existing client.",
      example: "300012345600003",
    },
    {
      key: "taxId", header: "Commercial Registration Number", scope: "header", required: false,
      aliases: ["cr", "crnumber", "commercialregistration", "registrationnumber", "taxid", "companyregistrationnumber"],
      guide: "Optional. The client's commercial registration (CR) number. Used to match an existing client.",
      example: "1010123456",
    },
    {
      key: "country", header: "Country", scope: "header", required: false,
      aliases: ["countrycode", "countryname"],
      guide: "Optional. An ISO country code (SA) or a country name (Saudi Arabia).",
      example: "SA",
    },
    {
      key: "stateProvince", header: "State / Province", scope: "header", required: false,
      aliases: ["state", "province", "region"],
      guide: "Optional. State, province or region.",
      example: "Riyadh Province",
    },
    {
      key: "city", header: "City", scope: "header", required: false,
      aliases: ["town"],
      guide: "Optional. City or town.",
      example: "Riyadh",
    },
    {
      key: "district", header: "District", scope: "header", required: false,
      aliases: ["area", "neighbourhood", "neighborhood"],
      guide: "Optional. District / neighbourhood.",
      example: "Al Olaya",
    },
    {
      key: "streetAddress", header: "Street Address", scope: "header", required: false,
      aliases: ["street", "addressline1", "road"],
      guide: "Optional. Street name and number.",
      example: "King Fahd Road",
    },
    {
      key: "buildingNumber", header: "Building Number", scope: "header", required: false,
      aliases: ["building", "buildingno", "housenumber"],
      guide: "Optional. For Saudi addresses this must be exactly 4 digits (the app's existing rule).",
      example: "3521",
    },
    {
      key: "additionalNumber", header: "Additional Number", scope: "header", required: false,
      aliases: ["additionalno", "secondarynumber"],
      guide: "Optional. Saudi National Address additional number.",
      example: "8452",
    },
    {
      key: "postalCode", header: "Postal Code", scope: "header", required: false,
      aliases: ["zip", "zipcode", "postcode"],
      guide: "Optional. Letters, digits, spaces and hyphens, up to 12 characters.",
      example: "12214",
    },
    {
      key: "address", header: "Address", scope: "header", required: false,
      aliases: ["fulladdress", "addressline", "billingaddress", "postaladdress"],
      guide: "Optional single-line address, for migrating clients whose address was never split into parts. Ignored when the structured address columns above are filled in.",
      example: "",
    },
    {
      key: "notes", header: "Notes", scope: "header", required: false,
      aliases: ["note", "remarks", "comment", "description"],
      guide: "Optional free-text notes kept on the client record.",
      example: "Key account — invoices go to the finance team.",
    },
  ],
  exampleRows: [
    {
      name: "ABC Trading Co.", clientType: "company", email: "accounts@abctrading.com", phone: "+966 11 234 5678",
      vatNumber: "300012345600003", taxId: "1010123456", country: "SA", stateProvince: "Riyadh Province",
      city: "Riyadh", district: "Al Olaya", streetAddress: "King Fahd Road", buildingNumber: "3521",
      additionalNumber: "8452", postalCode: "12214", notes: "Key account — invoices go to the finance team.",
    },
    {
      name: "XYZ Exhibitions LLC", clientType: "company", email: "hello@xyzexhibitions.com", phone: "+971 4 555 0110",
      vatNumber: "100123456700003", country: "AE", city: "Dubai", streetAddress: "Sheikh Zayed Road",
    },
    // Only Client Name is mandatory — this row shows the minimum a client can be imported with.
    { name: "Layla Khan" },
  ],
};

export const IMPORT_SPECS: Record<string, ImportSpec> = {
  quotation: QUOTATION_IMPORT_SPEC,
  client: CLIENT_IMPORT_SPEC,
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
