// Shared model for a document's final Terms & Conditions — a single continuously-numbered list that
// can mix terms appended from one or more master Terms Groups with individual document-only terms.
// The list is stored as a snapshot on the document (jsonb `terms`), so later edits/reorders/deletes
// of a master group never change already-saved documents. Number = position in the list.

export type DocumentTerm = {
  text: string;
  // Which master group this term was appended from (null for an individual document-only term). Used
  // only for the in-document "remove group" control — it is a tag, not a live link to the master.
  groupId: number | null;
  groupName: string | null;
};

// Split a master group's stored content (one term per line) into individual term strings.
export function splitGroupTerms(content: string | null | undefined): string[] {
  return (content ?? "")
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim()) // tolerate a leading "1." if present
    .filter(Boolean);
}

// Join individual term strings back into a master group's stored content (one term per line).
export function joinGroupTerms(terms: string[]): string {
  return terms.map((s) => s.trim()).filter(Boolean).join("\n");
}

// Normalize a document terms array for storage: trim text, drop empty terms, coerce metadata.
export function normalizeDocumentTerms(terms: unknown): DocumentTerm[] {
  if (!Array.isArray(terms)) return [];
  return terms
    .map((t) => {
      const o = (t ?? {}) as Record<string, unknown>;
      return {
        text: String(o.text ?? "").trim(),
        groupId: typeof o.groupId === "number" ? o.groupId : null,
        groupName: o.groupName == null ? null : String(o.groupName),
      };
    })
    .filter((t) => t.text.length > 0);
}
