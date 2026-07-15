import { t, type Locale } from "@/lib/i18n/dict";
import { Money } from "./money";
import { fmt, amountInWords } from "./totals";

function vatPercent(subtotal: string, taxTotal: string): string {
  const sub = Number(subtotal);
  if (!sub) return "0";
  return ((Number(taxTotal) / sub) * 100).toFixed(0);
}

// Matches the mockup's doc_totals() exactly: <div class="card totals-strip doc-totals-card">
// with .t-row / .t-row.discount / .t-row.grand rows, used on every document's create screen.
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
    <div className="card totals-strip doc-totals-card">
      <div className="t-row">
        <span>{t(locale, "Sub Total")}</span>
        <span className="v">
          <Money amount={subtotal} />
        </span>
      </div>
      <div className="t-row discount">
        <span>{t(locale, "Discount")}</span>
        <span className="v">
          {onDiscountChange ? (
            <input type="number" step="0.01" min="0" value={discount} onChange={(e) => onDiscountChange(e.target.value)} />
          ) : (
            fmt(discount)
          )}
        </span>
      </div>
      <div className="t-row">
        <span>
          {t(locale, "Total VAT")} ({vatPercent(subtotal, taxTotal)}%)
        </span>
        <span className="v">
          <Money amount={taxTotal} />
        </span>
      </div>
      <div className="t-row grand">
        <span className="lbl">{t(locale, totalLabel)}</span>
        <span className="v">
          <Money amount={total} />
        </span>
      </div>
      <div className="doc-totals-words">
        {t(locale, "In Words:")} {amountInWords(total, locale)}
      </div>
    </div>
  );
}
