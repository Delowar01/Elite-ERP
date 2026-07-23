import { Settings } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { NumberSettingsDialog } from "./number-settings-dialog";

// Matches the mockup's doc_field() helper. The gear was decorative in the mockup port; it now
// opens an in-page popup (no redirect): the Number gear opens the numbering-settings dialog for
// this document type. A gear without a documentType (e.g. a date field) stays a clearly-disabled
// icon with a reason.
export function DocFieldBox({
  label,
  required,
  plain = false,
  gear = false,
  gearDocType,
  gearDialog,
  locale,
  children,
}: {
  label: string;
  required?: boolean;
  plain?: boolean;
  gear?: boolean;
  /** When set, the gear opens the numbering-settings popup for this document type. */
  gearDocType?: string;
  /** A ready-made in-page gear dialog (e.g. the date-settings popup) rendered in the gear slot. */
  gearDialog?: React.ReactNode;
  locale?: Locale;
  children: React.ReactNode;
}) {
  return (
    <div className="doc-field">
      <label>
        {label} {required && <span className="req">*</span>}
      </label>
      <div className="doc-field-input-row">
        <div className={plain ? "input plain" : "input"}>{children}</div>
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
