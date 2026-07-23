import Link from "next/link";
import { Settings } from "lucide-react";

// Matches the mockup's doc_field() helper exactly:
// <div class="doc-field"><label>{label}<span class="req">*</span></label>
// <div class="doc-field-input-row"><div class="input">{value}</div><div class="doc-gear-btn">...</div></div></div>
//
// The gear was decorative in the mockup port; it now opens the settings location where the
// field's defaults are configured (document numbering + validity/terms defaults live in Presets),
// so it is a real, working link rather than a dead icon.
export function DocFieldBox({
  label,
  required,
  plain = false,
  gear = false,
  gearHref = "/settings/presets",
  gearTitle = "Configure in Presets",
  children,
}: {
  label: string;
  required?: boolean;
  plain?: boolean;
  gear?: boolean;
  gearHref?: string;
  gearTitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="doc-field">
      <label>
        {label} {required && <span className="req">*</span>}
      </label>
      <div className="doc-field-input-row">
        <div className={plain ? "input plain" : "input"}>{children}</div>
        {gear && (
          <Link href={gearHref} title={gearTitle} aria-label={gearTitle} className="doc-gear-btn">
            <Settings className="size-[15px]" />
          </Link>
        )}
      </div>
    </div>
  );
}
