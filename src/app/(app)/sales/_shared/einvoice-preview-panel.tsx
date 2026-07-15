import { QrCode } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { fmt } from "./totals";

export function EInvoicePreviewPanel({
  locale,
  vatNumber,
  taxTotal,
  invoiceType = "Simplified",
}: {
  locale: Locale;
  vatNumber?: string | null;
  taxTotal: string;
  invoiceType?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-elevated p-5">
      <div className="flex items-center gap-2 mb-1">
        <h4 className="text-[13.5px] font-bold text-ink">{t(locale, "E-Invoice")}</h4>
        <span className="font-mono text-[10px] tracking-wide bg-info-bg text-info px-2 py-0.5 rounded-md">ZATCA-aligned</span>
      </div>
      <p className="text-[12px] text-ink-muted my-2 leading-relaxed">
        {t(locale, "Generated automatically on send — QR encodes seller VAT, timestamp, and totals per ZATCA Phase 1.")}
      </p>
      <div className="rounded-xl border border-dashed border-line-strong h-24 flex items-center justify-center text-ink-faint">
        <QrCode className="size-9" />
      </div>
      <div className="flex flex-col gap-1.5 mt-3">
        <div className="flex justify-between text-[11.5px]">
          <span className="text-ink-muted">{t(locale, "Invoice type")}</span>
          <span className="font-medium text-ink">{invoiceType}</span>
        </div>
        <div className="flex justify-between text-[11.5px]">
          <span className="text-ink-muted">{t(locale, "Seller VAT")}</span>
          <span className="font-medium text-ink">{vatNumber ?? "—"}</span>
        </div>
        <div className="flex justify-between text-[11.5px]">
          <span className="text-ink-muted">{t(locale, "VAT total")}</span>
          <span className="font-medium text-ink font-mono">{t(locale, "SAR")} {fmt(taxTotal)}</span>
        </div>
      </div>
    </div>
  );
}
