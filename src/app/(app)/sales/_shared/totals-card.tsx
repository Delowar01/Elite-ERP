import { t, type Locale } from "@/lib/i18n/dict";
import { fmt, amountInWords } from "./totals";

export function TotalsCard({
  locale,
  subtotal,
  discount,
  onDiscountChange,
  taxTotal,
  total,
  totalLabel = "Grand Total",
}: {
  locale: Locale;
  subtotal: string;
  discount: string;
  onDiscountChange?: (v: string) => void;
  taxTotal: string;
  total: string;
  totalLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface shadow-elevated p-5">
      <div className="flex justify-between text-[13px] text-ink-muted py-1">
        <span>{t(locale, "Sub Total")}</span>
        <span className="font-mono text-ink">{t(locale, "SAR")} {fmt(subtotal)}</span>
      </div>
      <div className="flex justify-between items-center text-[13px] text-ink-muted py-1">
        <span>{t(locale, "Discount")}</span>
        {onDiscountChange ? (
          <input
            type="number"
            step="0.01"
            min="0"
            value={discount}
            onChange={(e) => onDiscountChange(e.target.value)}
            className="w-24 h-7 rounded-[7px] border border-line-strong bg-surface text-right font-mono text-[12.5px] px-2 text-ink"
          />
        ) : (
          <span className="font-mono text-ink">{fmt(discount)}</span>
        )}
      </div>
      <div className="flex justify-between text-[13px] text-ink-muted py-1">
        <span>{t(locale, "Total VAT")}</span>
        <span className="font-mono text-ink">{t(locale, "SAR")} {fmt(taxTotal)}</span>
      </div>
      <div className="flex justify-between items-center pt-3.5 mt-2 border-t border-line">
        <span className="text-[13px] font-bold text-ink">{t(locale, totalLabel)}</span>
        <span className="font-display font-extrabold text-[22px] text-brand-orange">
          {t(locale, "SAR")} {fmt(total)}
        </span>
      </div>
      <div className="text-[11px] text-ink-faint italic mt-1.5">
        {t(locale, "In Words:")} {amountInWords(total, locale)}
      </div>
    </div>
  );
}
