import { SafeRichText } from "./safe-rich-text";
import { getLineDesc } from "./line-item-desc";

// A saved document line's item text: the item NAME (the `description` column) as the primary line,
// plus the optional long-form description (stored in the line's custom_fields) beneath it. Both are
// re-sanitized on render by SafeRichText, so stored HTML is always safe to show.
export function LineItemCell({ description, customFields }: { description: string | null | undefined; customFields?: unknown }) {
  const desc = getLineDesc(customFields);
  return (
    <div className="flex flex-col gap-0.5">
      <SafeRichText value={description} />
      {desc.trim() ? <div className="text-ink-muted text-[11.5px]"><SafeRichText value={desc} /></div> : null}
    </div>
  );
}
