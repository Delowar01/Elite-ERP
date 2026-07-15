import { QrCode } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { Money } from "./money";

// Matches the mockup's invoice_main e-invoice/ZATCA panel exactly:
// <div class="card einvoice-panel"><div class="eh">... .qr-box .zatca-fields .zf ...
export function EInvoicePreviewPanel({
  locale,
  vatNumber,
  taxTotal,
  invoiceType = "Simplified",
  variant = "detail",
}: {
  locale: Locale;
  vatNumber?: string | null;
  taxTotal: string;
  invoiceType?: string;
  /** "detail" = sticky sidebar on the invoice detail page; "create" = static panel next to the create form's totals card. */
  variant?: "detail" | "create";
}) {
  return (
    <div className="card einvoice-panel" style={variant === "create" ? { position: "static", maxWidth: "100%", padding: 18 } : undefined}>
      <div className="eh">
        <h4>{variant === "create" ? t(locale, "E-Invoice preview") : t(locale, "E-Invoice")}</h4>
        <span className="badge-zatca">ZATCA-aligned</span>
      </div>
      <div className="desc">
        {variant === "create"
          ? t(locale, "Generated automatically on send — QR encodes seller VAT, timestamp, and totals per ZATCA Phase 1.")
          : t(locale, "Simplified tax invoice fields per ZATCA Phase 1. QR encodes seller, VAT number, timestamp, and totals.")}
      </div>
      <div className="qr-box flex items-center justify-center text-ink-faint">
        <QrCode className="size-9" />
      </div>
      <div className="zatca-fields">
        <div className="zf">
          <span className="k">{t(locale, "Invoice type")}</span>
          <span className="v">{invoiceType}</span>
        </div>
        <div className="zf">
          <span className="k">{t(locale, "Seller VAT")}</span>
          <span className="v">{vatNumber ?? "—"}</span>
        </div>
        <div className="zf">
          <span className="k">{t(locale, "VAT total")}</span>
          <span className="v">
            <Money amount={taxTotal} />
          </span>
        </div>
      </div>
    </div>
  );
}
