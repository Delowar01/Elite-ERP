// A document line's optional long-form description is stored under a reserved key in the line's
// `custom_fields` jsonb, so it flows through every create / edit / convert insert (which already
// carry custom_fields) with no schema change. The line's `description` column holds the item NAME
// (the searchable, primary text rendered on every detail/print view); this holds the elaboration.
export const LINE_DESC_KEY = "__desc";

// Read the line description out of a line's custom_fields (tolerates unknown/jsonb typing).
export function getLineDesc(customFields: unknown): string {
  if (customFields && typeof customFields === "object") {
    const v = (customFields as Record<string, unknown>)[LINE_DESC_KEY];
    if (typeof v === "string") return v;
  }
  return "";
}
