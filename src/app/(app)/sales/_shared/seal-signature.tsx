import Image from "next/image";
import { Stamp, PenLine } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";
import { SealSignatureUploadDialog } from "./seal-signature-dialog";

// Matches the mockup's seal_signature_block(). The org's seal/signature are uploaded once and
// reused on every document. When set, the image renders here; when empty, the box is an in-page
// upload popup (no redirect) — on upload the preview appears immediately.
function SealSigBox({ locale, kind, url, icon, label, sub }: { locale: Locale; kind: "seal" | "signature"; url?: string | null; icon: React.ReactNode; label: string; sub: string }) {
  if (url) {
    // Set: clicking the preview re-opens the in-page upload popup to replace it (no redirect).
    return (
      <SealSignatureUploadDialog
        locale={locale}
        kind={kind}
        trigger={
          <button type="button" className="seal-sig-box" title={label} aria-label={label}>
            <Image src={url} alt={label} width={140} height={70} className="max-h-[70px] w-auto object-contain" unoptimized />
          </button>
        }
      />
    );
  }
  return (
    <SealSignatureUploadDialog
      locale={locale}
      kind={kind}
      trigger={
        <button type="button" className="seal-sig-box" title={label} aria-label={label}>
          <span className="text-ink-faint">{icon}</span>
          <div className="ss-label">{label}</div>
          <div className="ss-sub">{sub}</div>
        </button>
      }
    />
  );
}

export function SealSignaturePreview({ locale, sealUrl, signatureUrl }: { locale: Locale; sealUrl?: string | null; signatureUrl?: string | null }) {
  return (
    <div className="seal-sig-grid">
      <SealSigBox locale={locale} kind="seal" url={sealUrl} icon={<Stamp className="size-[22px]" />} label={t(locale, "Upload Seal")} sub="PNG, JPG" />
      <SealSigBox locale={locale} kind="signature" url={signatureUrl} icon={<PenLine className="size-[22px]" />} label={t(locale, "Upload Signature")} sub="PNG, JPG" />
    </div>
  );
}
