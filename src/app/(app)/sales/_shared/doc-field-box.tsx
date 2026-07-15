import { Settings } from "lucide-react";

// Matches the mockup's doc_field() helper exactly:
// <div class="doc-field"><label>{label}<span class="req">*</span></label>
// <div class="doc-field-input-row"><div class="input">{value}</div><div class="doc-gear-btn">...</div></div></div>
export function DocFieldBox({
  label,
  required,
  plain = false,
  gear = false,
  children,
}: {
  label: string;
  required?: boolean;
  plain?: boolean;
  gear?: boolean;
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
          <div className="doc-gear-btn">
            <Settings className="size-[15px]" />
          </div>
        )}
      </div>
    </div>
  );
}
