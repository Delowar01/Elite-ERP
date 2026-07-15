import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";

export function DocActionBar({
  locale,
  pending,
  onSubmit,
  primaryLabel = "Save as Draft",
}: {
  locale: Locale;
  pending: boolean;
  onSubmit: () => void;
  primaryLabel?: string;
}) {
  return (
    <div className="flex justify-end gap-2.5 pt-4 mt-2 border-t border-line">
      <Button type="button" variant="glass" style={{ width: "auto" }} disabled>
        <FileText className="size-3.5" /> {t(locale, "Preview & Print")}
      </Button>
      <Button type="button" style={{ width: "auto" }} disabled={pending} onClick={onSubmit}>
        {pending ? t(locale, "Saving…") : t(locale, primaryLabel)}
      </Button>
    </div>
  );
}
