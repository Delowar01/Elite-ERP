import { Settings } from "lucide-react";
import { Label } from "@/components/ui/label";
import { t, type Locale } from "@/lib/i18n/dict";
import { NumberSettingsDialog } from "./number-settings-dialog";

// A document header field (the mockup's doc_field()). DEV-UI-01.6:
//  • An EDITABLE field passes `htmlFor` = its control's id. The caption becomes a real <label> bound to
//    that control, and the control (an approved <Input> / <SelectTrigger>) renders as-is, carrying its
//    own chrome and focus treatment.
//  • A DISPLAY field (the document number preview) has no control: no `htmlFor`, so the caption is plain
//    text — no label pretending to name something that cannot be focused. Its value sits in the boxed,
//    read-only presentation; `mono` keeps codes in the code face (everything else uses the UI font).
// The gear opens the numbering-settings popup for `gearDocType` (unchanged); a gear without one stays a
// clearly-disabled icon with a reason.
export function DocFieldBox({
  label,
  htmlFor,
  required,
  mono = false,
  gear = false,
  gearDocType,
  gearDialog,
  locale,
  children,
}: {
  label: string;
  /** Id of the editable control inside; omit for a display-only value. */
  htmlFor?: string;
  required?: boolean;
  /** Code face for identifiers (the document number). */
  mono?: boolean;
  gear?: boolean;
  /** When set, the gear opens the numbering-settings popup for this document type. */
  gearDocType?: string;
  /** A ready-made in-page gear dialog (e.g. the date-settings popup) rendered in the gear slot. */
  gearDialog?: React.ReactNode;
  locale?: Locale;
  children: React.ReactNode;
}) {
  const caption = (
    <>
      {label}
      {required && (
        <span className="req" aria-hidden>
          {" "}*
        </span>
      )}
    </>
  );
  return (
    <div className="doc-field" data-doc-field={htmlFor ? "control" : "display"}>
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="doc-field-label">
          {caption}
        </Label>
      ) : (
        <div className="doc-field-label">{caption}</div>
      )}
      <div className="doc-field-input-row">
        {htmlFor ? <div className="doc-field-control">{children}</div> : <div className={mono ? "input mono" : "input"}>{children}</div>}
        {gearDialog ? (
          gearDialog
        ) : gear && gearDocType && locale ? (
          <NumberSettingsDialog
            locale={locale}
            documentType={gearDocType}
            trigger={
              <button type="button" className="doc-gear-btn" title={t(locale, "Document Numbering")} aria-label={t(locale, "Document Numbering")}>
                <Settings className="size-[15px]" />
              </button>
            }
          />
        ) : gear ? (
          <button type="button" className="doc-gear-btn cursor-not-allowed opacity-60" disabled title={locale ? t(locale, "Set the date in the field.") : "Set the date in the field."}>
            <Settings className="size-[15px]" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
