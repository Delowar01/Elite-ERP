import Image from "next/image";
import { Stamp, PenLine } from "lucide-react";
import { t, type Locale } from "@/lib/i18n/dict";

function SealSigBox({ url, icon, label }: { url?: string | null; icon: React.ReactNode; label: string }) {
  if (url) {
    return (
      <div className="rounded-xl border border-line bg-surface flex items-center justify-center p-3 min-h-[100px]">
        <Image src={url} alt={label} width={140} height={70} className="max-h-[70px] w-auto object-contain" unoptimized />
      </div>
    );
  }
  return (
    <div className="rounded-xl border-[1.5px] border-dashed border-line-strong flex flex-col items-center justify-center gap-2 text-center min-h-[100px] p-4">
      <span className="text-ink-faint">{icon}</span>
      <div className="text-[12px] font-semibold text-ink-faint">{label}</div>
    </div>
  );
}

export function SealSignaturePreview({ locale, sealUrl, signatureUrl }: { locale: Locale; sealUrl?: string | null; signatureUrl?: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-3.5 mt-5">
      <SealSigBox url={sealUrl} icon={<Stamp className="size-[22px]" />} label={t(locale, "Company Seal")} />
      <SealSigBox url={signatureUrl} icon={<PenLine className="size-[22px]" />} label={t(locale, "Authorized Signature")} />
    </div>
  );
}
