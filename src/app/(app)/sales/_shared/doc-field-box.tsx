import { Settings } from "lucide-react";

export function DocFieldBox({
  label,
  required,
  mono = true,
  gear = false,
  children,
}: {
  label: string;
  required?: boolean;
  mono?: boolean;
  gear?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-ink-muted mb-1.5">
        {label} {required && <span className="text-brand-orange">*</span>}
      </label>
      <div className="flex items-center gap-1.5">
        <div
          className={`flex-1 min-w-0 h-[38px] rounded-[9px] border border-line-strong bg-surface flex items-center px-3 text-[12.5px] text-ink ${mono ? "font-mono" : ""}`}
        >
          {children}
        </div>
        {gear && (
          <div className="size-[38px] rounded-[9px] border border-line-strong bg-surface flex items-center justify-center text-ink-muted shrink-0">
            <Settings className="size-[15px]" />
          </div>
        )}
      </div>
    </div>
  );
}
