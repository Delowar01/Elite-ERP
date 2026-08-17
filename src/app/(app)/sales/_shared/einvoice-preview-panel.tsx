import { QrCode } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { Money } from "./money";

/**
 * A preview of the ZATCA PHASE 1 QR — nothing more.
 *
 * What the system actually produces is a QR code on the PRINTED PDF of a tax invoice, encoding
 * seller name, VAT number, invoice date, total and VAT amount. There is no XML, no UUID, no
 * cryptographic stamp, no CSID, no clearance or reporting, and no connection to ZATCA systems, so
 * this panel says only what the printed document carries. The earlier "ZATCA-aligned" badge and
 * "generated on send" wording claimed a compliance posture and a moment that do not exist.
 *
 * Rendered only where the country profile enables `zatca_phase1` — the caller gates it, so a UAE
 * organization is not shown a Saudi scheme.
 */
export function EInvoicePreviewPanel({
  locale,
  vatNumber,
  taxTotal,
  variant = "detail",
}: {
  locale: Locale;
  vatNumber?: string | null;
  taxTotal: string;
  /** "detail" = sticky sidebar on the invoice detail page; "create" = static panel next to the create form's totals card. */
  variant?: "detail" | "create";
}) {
  return (
    <div className="card einvoice-panel" style={variant === "create" ? { position: "static", maxWidth: "100%", padding: 18 } : undefined}>
      <div className="eh">
        <h4>{variant === "create" ? t(locale, "Tax Invoice QR preview") : t(locale, "Tax Invoice QR")}</h4>
      </div>
      <div className="desc">
        {variant === "create"
          ? t(locale, "A ZATCA Phase 1 QR is added to the printed PDF of this invoice. It encodes seller name, VAT number, invoice date, total and VAT amount.")
          : t(locale, "The ZATCA Phase 1 QR on this invoice's printed PDF encodes seller name, VAT number, invoice date, total and VAT amount.")}
      </div>
      <div className="qr-box flex items-center justify-center text-ink-faint">
        <QrCode className="size-9" />
      </div>
      <div className="zatca-fields">
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
