"use client";

import Image from "next/image";
import { Stamp, PenLine } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";

// The document's seal & signature. Seals/signatures are uploaded and defaulted per document type
// under Preset Management → Seal & Signature; here the create/edit form shows the resolved default
// as a live preview and lets you override it for THIS document (use the default, remove it, or pick
// another from the library). The chosen value is snapshotted onto the document at save.
export type SealAsset = { id: number; kind: string; name: string; url: string };

// override: undefined = use the per-document-type default; "" = none for this document; a URL = a
// specific library asset chosen for this document.
function pickerValue(override: string | undefined, assets: SealAsset[]): string {
  if (override === undefined) return "default";
  if (override === "") return "none";
  const asset = assets.find((a) => a.url === override);
  return asset ? String(asset.id) : "none";
}

function SealSigBox({
  locale,
  kind,
  effectiveUrl,
  assets,
  override,
  onOverride,
  icon,
  label,
}: {
  locale: Locale;
  kind: "seal" | "signature";
  effectiveUrl: string | null;
  assets: SealAsset[];
  override: string | undefined;
  onOverride: (v: string | undefined) => void;
  icon: React.ReactNode;
  label: string;
}) {
  function onChange(v: string) {
    if (v === "default") return onOverride(undefined);
    if (v === "none") return onOverride("");
    const asset = assets.find((a) => String(a.id) === v);
    onOverride(asset ? asset.url : undefined);
  }
  return (
    <div className="seal-sig-box flex flex-col items-center justify-center gap-2 p-3">
      {effectiveUrl ? (
        <Image src={effectiveUrl} alt={label} width={140} height={70} className="max-h-[64px] w-auto object-contain" unoptimized />
      ) : (
        <>
          <span className="text-ink-faint">{icon}</span>
          <div className="ss-label">{label}</div>
        </>
      )}
      <Select value={pickerValue(override, assets)} onValueChange={onChange}>
        <SelectTrigger className="h-7 w-[150px] text-[11.5px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">{t(locale, "Default")}</SelectItem>
          <SelectItem value="none">{kind === "seal" ? t(locale, "No seal") : t(locale, "No signature")}</SelectItem>
          {assets.map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function SealSignaturePreview({
  locale,
  sealUrl,
  signatureUrl,
  sealAssets = [],
  sealOverride,
  signatureOverride,
  onSealOverride,
  onSignatureOverride,
}: {
  locale: Locale;
  /** The resolved per-document-type default seal/signature (org-wide fallback). */
  sealUrl?: string | null;
  signatureUrl?: string | null;
  sealAssets?: SealAsset[];
  sealOverride?: string | undefined;
  signatureOverride?: string | undefined;
  onSealOverride?: (v: string | undefined) => void;
  onSignatureOverride?: (v: string | undefined) => void;
}) {
  const seals = sealAssets.filter((a) => a.kind === "seal");
  const signatures = sealAssets.filter((a) => a.kind === "signature");
  const effSeal = sealOverride !== undefined ? sealOverride || null : sealUrl ?? null;
  const effSignature = signatureOverride !== undefined ? signatureOverride || null : signatureUrl ?? null;

  return (
    <div className="seal-sig-grid">
      <SealSigBox
        locale={locale}
        kind="seal"
        effectiveUrl={effSeal}
        assets={seals}
        override={sealOverride}
        onOverride={onSealOverride ?? (() => {})}
        icon={<Stamp className="size-[22px]" />}
        label={t(locale, "Company Seal")}
      />
      <SealSigBox
        locale={locale}
        kind="signature"
        effectiveUrl={effSignature}
        assets={signatures}
        override={signatureOverride}
        onOverride={onSignatureOverride ?? (() => {})}
        icon={<PenLine className="size-[22px]" />}
        label={t(locale, "Authorized Signature")}
      />
    </div>
  );
}
