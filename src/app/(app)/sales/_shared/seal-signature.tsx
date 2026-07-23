import Image from "next/image";
import Link from "next/link";
import { Stamp, PenLine } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

// Matches the mockup's seal_signature_block() exactly: <div class="seal-sig-grid">
// <div class="seal-sig-box">...</div><div class="seal-sig-box">...</div></div>
//
// The org's seal/signature are uploaded once in Business Settings and reused on every document
// (single source of truth). When set, the image renders here; when empty, the box is a real link
// to the upload location rather than a dead placeholder.
const SEAL_SETTINGS_HREF = "/settings/organization?tab=seal-signature";

function SealSigBox({ url, icon, label, sub, hint }: { url?: string | null; icon: React.ReactNode; label: string; sub: string; hint: string }) {
  if (url) {
    return (
      <div className="seal-sig-box">
        <Image src={url} alt={label} width={140} height={70} className="max-h-[70px] w-auto object-contain" unoptimized />
      </div>
    );
  }
  return (
    <Link href={SEAL_SETTINGS_HREF} className="seal-sig-box" title={hint} aria-label={hint}>
      <span className="text-ink-faint">{icon}</span>
      <div className="ss-label">{label}</div>
      <div className="ss-sub">{sub}</div>
    </Link>
  );
}

export function SealSignaturePreview({ locale, sealUrl, signatureUrl }: { locale: Locale; sealUrl?: string | null; signatureUrl?: string | null }) {
  const hint = t(locale, "Upload in Business Settings");
  return (
    <div className="seal-sig-grid">
      <SealSigBox url={sealUrl} icon={<Stamp className="size-[22px]" />} label={t(locale, "Upload Seal")} sub="PNG, JPG" hint={hint} />
      <SealSigBox url={signatureUrl} icon={<PenLine className="size-[22px]" />} label={t(locale, "Upload Signature")} sub="PNG, JPG" hint={hint} />
    </div>
  );
}
