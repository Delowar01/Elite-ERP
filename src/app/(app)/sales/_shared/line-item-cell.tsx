import { SafeRichText } from "./safe-rich-text";
import { TableRow, TableCell } from "@/components/ui/table";
import { getLineDesc } from "./line-item-desc";

// A saved document line's item text: the item NAME only (the `description` column). The long-form
// description is NOT shown here — it renders in its own full-width row beneath the item (see
// LineDescRow), so the item stays on the normal financial row and the description spans every column.
export function LineItemCell({ description }: { description: string | null | undefined; customFields?: unknown }) {
  return <SafeRichText value={description} />;
}

// The full-width description row placed directly under an item row. It spans every column of the
// document's items table (a large colSpan so the exact column count never has to be threaded through)
// so paragraphs and bullet/numbered lists wrap across the full table width and are never clipped.
// Renders nothing when the line has no long-form description, so empty descriptions add no blank row.
export function LineDescRow({ customFields, colSpan = 99 }: { customFields?: unknown; colSpan?: number }) {
  const desc = getLineDesc(customFields);
  if (!desc.trim()) return null;
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="line-desc-cell">
        <SafeRichText value={desc} />
      </TableCell>
    </TableRow>
  );
}
