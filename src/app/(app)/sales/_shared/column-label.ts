import { DEFAULT_COLUMNS, type ColumnDef } from "@/lib/column-config";
import { t, type Locale } from "@/lib/i18n/dict";

// DEV-UI-01.6: how a line-item column's label is SHOWN. Stored column configurations keep the English
// default labels they were saved with; nothing is migrated or rewritten. At render time a built-in
// column whose label still equals its original English default is translated; a built-in column the
// user renamed, and every custom column, is shown exactly as typed.
const DEFAULT_LABELS = new Map(DEFAULT_COLUMNS.map((c) => [c.key, c.label]));

export function columnDisplayLabel(locale: Locale, column: Pick<ColumnDef, "key" | "label">): string {
  const original = DEFAULT_LABELS.get(column.key);
  return original !== undefined && column.label === original ? t(locale, original) : column.label;
}
