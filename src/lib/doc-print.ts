// Shared Print Layout / document color-theme definitions, used by both Preset Management → Print
// Layout (the editor) and the /print pipeline (preview, browser print, PDF, download/share — all
// go through the one print route, so applying it there covers every output).

export const DOCUMENT_LAYOUTS = [
  { value: "classic", label: "Classic", desc: "Bordered table, tinted party boxes" },
  { value: "modern", label: "Modern", desc: "Minimal rules, accent-only color" },
  { value: "minimal", label: "Minimal", desc: "Letterhead style, no fills" },
] as const;

export type DocumentLayout = (typeof DOCUMENT_LAYOUTS)[number]["value"] | "custom";

export function isBuiltInLayout(v: string): v is (typeof DOCUMENT_LAYOUTS)[number]["value"] {
  return DOCUMENT_LAYOUTS.some((l) => l.value === v);
}

// Named document color themes → the header/accent color used across the printed document. One
// theme is applied to all of an org's documents ("Apply one color theme to all documents").
export const DOCUMENT_COLOR_THEMES = [
  { value: "navy", label: "Navy", color: "#1B1B4E" },
  { value: "graphite", label: "Graphite", color: "#2B2F36" },
  { value: "emerald", label: "Emerald", color: "#0F766E" },
  { value: "royal", label: "Royal Blue", color: "#1D4ED8" },
  { value: "burgundy", label: "Burgundy", color: "#8C1D40" },
  { value: "orange", label: "Elite Orange", color: "#E87722" },
] as const;

export type DocumentColorTheme = (typeof DOCUMENT_COLOR_THEMES)[number]["value"];

export function colorForTheme(theme: string | null | undefined): string {
  return DOCUMENT_COLOR_THEMES.find((t) => t.value === theme)?.color ?? DOCUMENT_COLOR_THEMES[0].color;
}

// The 8 document types (matching DOCUMENT_TYPES) with their print-route key + label, for the
// per-document-type layout override table.
export const PRINTABLE_DOC_TYPES = [
  { type: "quotation", label: "Quotation" },
  { type: "sales_order", label: "Sales Order" },
  { type: "proforma_invoice", label: "Proforma Invoice" },
  { type: "sales_invoice", label: "Invoice" },
  { type: "delivery_challan", label: "Delivery Challan" },
  { type: "credit_note", label: "Credit Note" },
  { type: "purchase_order", label: "Purchase Order" },
  { type: "debit_note", label: "Debit Note" },
] as const;

// Resolve the effective layout for one document type: a per-type override wins over the org's
// default layout.
export function resolveDocLayout(
  org: { printLayout: string; documentLayoutOverrides: Record<string, string> | null },
  documentType: string,
): string {
  const override = org.documentLayoutOverrides?.[documentType];
  return override && (isBuiltInLayout(override) || override === "custom") ? override : org.printLayout;
}
