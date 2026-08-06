import { DOCUMENT_TYPES } from "@/db/schema/document-sequences";

// What one import row means for each document module — purely descriptive (column headers, aliases,
// which dates exist, whether the module carries prices). No database access, so the column-mapping UI
// can read this in the browser. The matching write logic lives in document-config.ts (server-only).
//
// Every entry is grounded in the module's real table: a column the document does not have
// (Delivery Challan pricing, Proforma projects, …) is simply not offered for import.

export type DocModule = (typeof DOCUMENT_TYPES)[number];

/** Whose record the document is addressed to. Purchasing documents use vendors, not clients. */
export type PartyKind = "customer" | "vendor";

export type DateFieldConfig = {
  key: string; header: string; aliases: string[]; required: boolean; guide: string; example: string;
};

/** A required reference to another document (Credit Note -> Invoice, Debit Note -> Purchase Order). */
export type SourceDocConfig = {
  key: string; header: string; aliases: string[]; module: DocModule; guide: string; example: string;
};

export type DocFieldConfig = {
  module: DocModule;
  /** Plural label used for the template and the modal title. */
  label: string;
  /** Singular lowercase name used inside error messages. */
  noun: string;
  numberHeader: string;
  numberAliases: string[];
  numberExample: string;
  /** Document-number prefix used by the template's two example documents. */
  examplePrefix: string;
  party: PartyKind;
  partyHeader: string;
  partyAliases: string[];
  partyExample: string;
  dates: DateFieldConfig[];
  /** false = quantity-only document (Delivery Challan): no prices, no tax, no totals. */
  pricing: boolean;
  /** Header for the per-unit money column — sales documents say Rate, purchasing says Unit Cost. */
  priceHeader: string;
  priceAliases: string[];
  priceExample: string;
  hasProject: boolean;
  hasReason: boolean;
  hasLogistics: boolean;
  /** Credit/Debit notes have no `notes` column, so they offer no Notes or migration columns. */
  hasNotes: boolean;
  sourceDoc?: SourceDocConfig;
};

const DATE_GUIDE = "Choose this column's date format during column mapping. Excel date cells are read directly.";

const dateField = (key: string, header: string, aliases: string[], required: boolean, example: string, extra = ""): DateFieldConfig => ({
  key, header, aliases, required, example,
  guide: `${required ? "REQUIRED. " : "Optional. "}${extra}${extra ? " " : ""}${DATE_GUIDE}`,
});

const CLIENT_ALIASES = ["customer", "clientname", "customername", "party", "account"];
const VENDOR_ALIASES = ["supplier", "vendorname", "suppliername", "party", "account"];
const RATE_ALIASES = ["unitprice", "price", "rate", "unitrate"];
const COST_ALIASES = ["unitcost", "cost", "unitprice", "price", "rate"];

export const DOC_FIELD_CONFIGS: Record<DocModule, DocFieldConfig> = {
  quotation: {
    module: "quotation", label: "Quotations", noun: "quotation",
    numberHeader: "Quotation Number",
    numberAliases: ["quotationno", "quoteno", "quotenumber", "documentnumber", "docnumber", "number"],
    numberExample: "QTN-2026-0001", examplePrefix: "QT",
    party: "customer", partyHeader: "Client", partyAliases: CLIENT_ALIASES, partyExample: "ABC Company",
    dates: [
      dateField("issueDate", "Issue Date", ["date", "documentdate", "docdate", "quotationdate"], true, "2026-08-05"),
      dateField("validUntil", "Valid Till", ["validuntil", "validtilldate", "expirydate", "duedate"], false, "2026-09-05", "Leave blank if the quotation has no expiry."),
    ],
    pricing: true, priceHeader: "Rate", priceAliases: RATE_ALIASES, priceExample: "15000",
    hasProject: true, hasReason: false, hasLogistics: false, hasNotes: true,
  },

  sales_order: {
    module: "sales_order", label: "Sales Orders", noun: "sales order",
    numberHeader: "Sales Order Number",
    numberAliases: ["sono", "sonumber", "salesorderno", "ordernumber", "documentnumber", "docnumber", "number"],
    numberExample: "SO-2026-0001", examplePrefix: "SO",
    party: "customer", partyHeader: "Client", partyAliases: CLIENT_ALIASES, partyExample: "ABC Company",
    dates: [
      dateField("issueDate", "Order Date", ["date", "issuedate", "documentdate", "docdate", "orderdate"], true, "2026-08-05"),
      dateField("expectedDate", "Expected Delivery", ["expecteddate", "expecteddeliverydate", "deliverydate", "duedate"], false, "2026-09-05"),
    ],
    pricing: true, priceHeader: "Rate", priceAliases: RATE_ALIASES, priceExample: "15000",
    hasProject: true, hasReason: false, hasLogistics: false, hasNotes: true,
  },

  proforma_invoice: {
    module: "proforma_invoice", label: "Proforma Invoices", noun: "proforma invoice",
    numberHeader: "Proforma Number",
    numberAliases: ["proformano", "proformainvoiceno", "pfno", "documentnumber", "docnumber", "number"],
    numberExample: "PF-2026-0001", examplePrefix: "PF",
    party: "customer", partyHeader: "Client", partyAliases: CLIENT_ALIASES, partyExample: "ABC Company",
    dates: [dateField("issueDate", "Issue Date", ["date", "documentdate", "docdate", "proformadate"], true, "2026-08-05")],
    pricing: true, priceHeader: "Rate", priceAliases: RATE_ALIASES, priceExample: "15000",
    hasProject: false, hasReason: false, hasLogistics: false, hasNotes: true,
  },

  sales_invoice: {
    module: "sales_invoice", label: "Invoices", noun: "invoice",
    numberHeader: "Invoice Number",
    numberAliases: ["invoiceno", "invno", "billnumber", "documentnumber", "docnumber", "number"],
    numberExample: "INV-2026-0001", examplePrefix: "INV",
    party: "customer", partyHeader: "Client", partyAliases: CLIENT_ALIASES, partyExample: "ABC Company",
    dates: [
      dateField("issueDate", "Issue Date", ["date", "documentdate", "docdate", "invoicedate"], true, "2026-08-05"),
      dateField("dueDate", "Due Date", ["paymentduedate", "duedate"], false, "2026-09-05"),
    ],
    pricing: true, priceHeader: "Rate", priceAliases: RATE_ALIASES, priceExample: "15000",
    hasProject: true, hasReason: false, hasLogistics: false, hasNotes: true,
  },

  delivery_challan: {
    module: "delivery_challan", label: "Delivery Challans", noun: "delivery challan",
    numberHeader: "Challan Number",
    numberAliases: ["dcno", "dcnumber", "challanno", "deliverynote", "documentnumber", "docnumber", "number"],
    numberExample: "DC-2026-0001", examplePrefix: "DC",
    party: "customer", partyHeader: "Client", partyAliases: CLIENT_ALIASES, partyExample: "ABC Company",
    // Logistics-only: both dates are nullable on the table, so neither is mandatory here.
    dates: [
      dateField("dispatchDate", "Dispatch Date", ["dispatchdate", "date", "senddate"], false, "2026-08-05"),
      dateField("deliveredDate", "Delivered Date", ["delivereddate", "deliverydate", "receiveddate"], false, ""),
    ],
    pricing: false, priceHeader: "", priceAliases: [], priceExample: "",
    hasProject: false, hasReason: false, hasLogistics: true, hasNotes: true,
  },

  purchase_order: {
    module: "purchase_order", label: "Purchase Orders", noun: "purchase order",
    numberHeader: "PO Number",
    numberAliases: ["pono", "ponumber", "purchaseorderno", "documentnumber", "docnumber", "number"],
    numberExample: "PO-2026-0001", examplePrefix: "PO",
    party: "vendor", partyHeader: "Vendor", partyAliases: VENDOR_ALIASES, partyExample: "Northbound Steel Ltd",
    dates: [
      dateField("orderDate", "Order Date", ["date", "issuedate", "documentdate", "docdate", "podate"], true, "2026-08-05"),
      dateField("expectedDate", "Expected Delivery", ["expecteddate", "expecteddeliverydate", "deliverydate"], false, "2026-09-05"),
    ],
    pricing: true, priceHeader: "Unit Cost", priceAliases: COST_ALIASES, priceExample: "1200",
    hasProject: false, hasReason: false, hasLogistics: false, hasNotes: true,
  },

  credit_note: {
    module: "credit_note", label: "Credit Notes", noun: "credit note",
    numberHeader: "Credit Note Number",
    numberAliases: ["cnno", "cnnumber", "creditnoteno", "documentnumber", "docnumber", "number"],
    numberExample: "CN-2026-0001", examplePrefix: "CN",
    party: "customer", partyHeader: "Client", partyAliases: CLIENT_ALIASES, partyExample: "ABC Company",
    dates: [dateField("issueDate", "Issue Date", ["date", "documentdate", "docdate", "creditnotedate"], true, "2026-08-05")],
    pricing: true, priceHeader: "Rate", priceAliases: RATE_ALIASES, priceExample: "1500",
    hasProject: false, hasReason: true, hasLogistics: false, hasNotes: false,
    sourceDoc: {
      key: "sourceNumber", header: "Against Invoice",
      aliases: ["invoicenumber", "invoiceno", "againstinvoice", "sourceinvoice", "originalinvoice"],
      module: "sales_invoice",
      guide: "REQUIRED. The number of the invoice this credit note is raised against — it must already exist in your organization.",
      example: "INV-2026-0001",
    },
  },

  debit_note: {
    module: "debit_note", label: "Debit Notes", noun: "debit note",
    numberHeader: "Debit Note Number",
    numberAliases: ["dnno", "dnnumber", "debitnoteno", "documentnumber", "docnumber", "number"],
    numberExample: "DN-2026-0001", examplePrefix: "DN",
    party: "vendor", partyHeader: "Vendor", partyAliases: VENDOR_ALIASES, partyExample: "Northbound Steel Ltd",
    dates: [dateField("issueDate", "Issue Date", ["date", "documentdate", "docdate", "debitnotedate"], true, "2026-08-05")],
    pricing: true, priceHeader: "Unit Cost", priceAliases: COST_ALIASES, priceExample: "1200",
    hasProject: false, hasReason: true, hasLogistics: false, hasNotes: false,
    sourceDoc: {
      key: "sourceNumber", header: "Against Purchase Order",
      aliases: ["ponumber", "pono", "againstpo", "sourcepurchaseorder", "originalpo"],
      module: "purchase_order",
      guide: "REQUIRED. The number of the purchase order this debit note is raised against — it must already exist in your organization.",
      example: "PO-2026-0001",
    },
  },
};

export function docFieldConfig(module: string): DocFieldConfig | null {
  return (DOC_FIELD_CONFIGS as Record<string, DocFieldConfig>)[module] ?? null;
}

/** The header key that holds the party name — `client` for sales, `vendor` for purchasing. */
export const partyKeyOf = (c: DocFieldConfig): string => (c.party === "customer" ? "client" : "vendor");
