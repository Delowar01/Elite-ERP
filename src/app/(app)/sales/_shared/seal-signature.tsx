import Image from "next/image";
import { Stamp, PenLine } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

// Matches the mockup's seal_signature_block() exactly: <div class="seal-sig-grid">
// <div class="seal-sig-box">...</div><div class="seal-sig-box">...</div></div>
function SealSigBox({ url, icon, label, sub }: { url?: string | null; icon: React.ReactNode; label: string; sub: string }) {
  if (url) {
    return (
      <div className="seal-sig-box">
        <Image src={url} alt={label} width={140} height={70} className="max-h-[70px] w-auto object-contain" unoptimized />
      </div>
    );
  }
  return (
    <div className="seal-sig-box">
      <span className="text-ink-faint">{icon}</span>
      <div className="ss-label">{label}</div>
      <div className="ss-sub">{sub}</div>
    </div>
  );
}

export function SealSignaturePreview({ locale, sealUrl, signatureUrl }: { locale: Locale; sealUrl?: string | null; signatureUrl?: string | null }) {
  return (
    <div className="seal-sig-grid">
      <SealSigBox url={sealUrl} icon={<Stamp className="size-[22px]" />} label={t(locale, "Upload Seal")} sub="PNG, JPG" />
      <SealSigBox url={signatureUrl} icon={<PenLine className="size-[22px]" />} label={t(locale, "Upload Signature")} sub="PNG, JPG" />
    </div>
  );
}
