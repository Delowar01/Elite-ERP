import { t, type Locale } from "@/lib/i18n/dict";

// Matches the mockup's doc_footer_contact() exactly: <div class="doc-footer-contact">
export function DocFooterContact({ locale, email, phone }: { locale: Locale; email?: string | null; phone?: string | null }) {
  if (!email && !phone) return null;
  return (
    <div className="doc-footer-contact">
      {email && (
        <>
          <span>{t(locale, "For any enquiry, reach out via email at")}</span>
          <b>{email}</b>
        </>
      )}
      {phone && (
        <>
          <span>{t(locale, "Call on:")}</span>
          <b>{phone}</b>
        </>
      )}
    </div>
  );
}
