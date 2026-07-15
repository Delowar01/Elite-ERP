import { t, type Locale } from "@/lib/i18n/dict";
import { Money } from "./money";
import { fmt } from "./totals";

function vatPercent(subtotal: string, taxTotal: string): string {
  const sub = Number(subtotal);
  if (!sub) return "0";
  return ((Number(taxTotal) / sub) * 100).toFixed(0);
}

// Matches the mockup's detail-screen totals block exactly: <div class="card totals-strip">
// with plain .t-row rows and a bold .t-row.final row — used on Quotation/SO/Proforma/Invoice/
// Credit Note detail pages (invoice_main, proforma_main, cn_main, etc.).
export function TotalsStrip({
  locale,
  subtotal,
  discount,
  taxTotal,
  finalLabel,
  finalValue,
  extraRows,
}: {
  locale: Locale;
  subtotal: string;
  discount?: string;
  taxTotal: string;
  finalLabel: string;
  finalValue: string;
  extraRows?: { label: string; value: string; colorClass?: string }[];
}) {
  return (
    <div className="card totals-strip">
      <div className="t-row">
        <span>{t(locale, "Subtotal")}</span>
        <span className="v">
          <Money amount={subtotal} />
        </span>
      </div>
      {discount && Number(discount) > 0 && (
        <div className="t-row">
          <span>{t(locale, "Discount")}</span>
          <span className="v">{fmt(discount)}</span>
        </div>
      )}
      <div className="t-row">
        <span>
          {t(locale, "VAT")} ({vatPercent(subtotal, taxTotal)}%)
        </span>
        <span className="v">
          <Money amount={taxTotal} />
        </span>
      </div>
      {extraRows?.map((row) => (
        <div className="t-row" key={row.label}>
          <span>{t(locale, row.label)}</span>
          <span className="v">
            <Money amount={row.value} className={row.colorClass} />
          </span>
        </div>
      ))}
      <div className="t-row final">
        <span>{t(locale, finalLabel)}</span>
        <span className="v">
          <Money amount={finalValue} />
        </span>
      </div>
    </div>
  );
}
