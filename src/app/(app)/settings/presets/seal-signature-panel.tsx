"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Stamp, PenLine, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { CropImageUpload } from "@/components/upload/crop-image-upload";
import { CROP_SEAL, CROP_SIGNATURE } from "@/components/upload/crop-configs";
import { t, type Locale } from "@/lib/i18n/dict";
import type { SealSignatureAsset, Org } from "@/db";
import { PRINTABLE_DOC_TYPES } from "@/lib/doc-print";
import { uploadSealAssetAction, deleteSealAssetAction, updateSealDefaultsAction } from "./document-preset-actions";

function AssetCard({ locale, asset, onDelete }: { locale: Locale; asset: SealSignatureAsset; onDelete: (id: number) => void }) {
  return (
    <div className="rounded-lg border border-line p-2 flex flex-col items-center gap-1.5 w-[110px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset.url} alt={asset.name} className="h-12 w-full object-contain" />
      <span className="text-[11px] font-medium truncate max-w-full" title={asset.name}>{asset.name}</span>
      <button type="button" onClick={() => onDelete(asset.id)} className="text-ink-faint hover:text-danger" aria-label={t(locale, "Delete")}>
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

export function SealSignaturePresetPanel({ locale, org, assets }: { locale: Locale; org: Org; assets: SealSignatureAsset[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sealName, setSealName] = useState("");
  const [sigName, setSigName] = useState("");
  const [defaults, setDefaults] = useState<Record<string, { sealAssetId?: number | null; signatureAssetId?: number | null }>>(org.sealDefaults ?? {});

  const seals = assets.filter((a) => a.kind === "seal");
  const signatures = assets.filter((a) => a.kind === "signature");

  async function upload(kind: "seal" | "signature", name: string, file: File) {
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("name", name.trim() || (kind === "seal" ? `Seal ${seals.length + 1}` : `Signature ${signatures.length + 1}`));
    fd.set("file", file);
    const result = await uploadSealAssetAction(fd);
    if (result.error) return { error: result.error };
    toast.success(t(locale, "Uploaded"));
    router.refresh();
  }

  function remove(id: number) {
    startTransition(async () => {
      const result = await deleteSealAssetAction(id);
      if (result.error) toast.error(result.error);
      else router.refresh();
    });
  }

  function saveDefaults() {
    const fd = new FormData();
    for (const { type } of PRINTABLE_DOC_TYPES) {
      fd.set(`seal__${type}`, String(defaults[type]?.sealAssetId ?? "none"));
      fd.set(`signature__${type}`, String(defaults[type]?.signatureAssetId ?? "none"));
    }
    startTransition(async () => {
      const result = await updateSealDefaultsAction(fd);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  function setDefault(type: string, key: "sealAssetId" | "signatureAssetId", value: string) {
    setDefaults((p) => ({ ...p, [type]: { ...p[type], [key]: value === "none" ? null : Number(value) } }));
  }

  const previewUrl = (id?: number | null) => (id == null ? null : assets.find((a) => a.id === id)?.url ?? null);

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h3 className="text-[17px] font-bold">{t(locale, "Seal & Signature")}</h3>
        <p className="text-[12.5px] text-ink-muted mt-1">
          {t(locale, "Upload seals and signatures, then choose a default for each document type. Changing a default only affects new documents — already-saved documents keep the seal and signature they were saved with.")}
        </p>
      </div>

      {/* Library + upload */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] font-semibold flex items-center gap-1.5"><Stamp className="size-4 text-brand-orange" /> {t(locale, "Seals")}</p>
          <div className="flex flex-wrap gap-2">
            {seals.map((a) => <AssetCard key={a.id} locale={locale} asset={a} onDelete={remove} />)}
            {seals.length === 0 && <p className="text-[11.5px] text-ink-faint">{t(locale, "No seals yet.")}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder={t(locale, "Seal name")} value={sealName} onChange={(e) => setSealName(e.target.value)} className="h-8 w-40" />
            <CropImageUpload locale={locale} config={CROP_SEAL} trigger={<Button type="button" size="sm" variant="secondary">{t(locale, "Upload Seal")}</Button>} onUpload={(f) => upload("seal", sealName, f)} />
          </div>
          <p className="text-[10.5px] text-ink-faint">{t(locale, "1:1 · 600×600 · transparency preserved")}</p>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] font-semibold flex items-center gap-1.5"><PenLine className="size-4 text-brand-orange" /> {t(locale, "Signatures")}</p>
          <div className="flex flex-wrap gap-2">
            {signatures.map((a) => <AssetCard key={a.id} locale={locale} asset={a} onDelete={remove} />)}
            {signatures.length === 0 && <p className="text-[11.5px] text-ink-faint">{t(locale, "No signatures yet.")}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder={t(locale, "Signature name")} value={sigName} onChange={(e) => setSigName(e.target.value)} className="h-8 w-40" />
            <CropImageUpload locale={locale} config={CROP_SIGNATURE} trigger={<Button type="button" size="sm" variant="secondary">{t(locale, "Upload Signature")}</Button>} onUpload={(f) => upload("signature", sigName, f)} />
          </div>
          <p className="text-[10.5px] text-ink-faint">{t(locale, "3:1 · 1200×400 · transparency preserved")}</p>
        </div>
      </div>

      {/* Per-document-type defaults */}
      <Card>
        <CardContent className="p-4 flex flex-col gap-3">
          <p className="text-[12.5px] font-semibold">{t(locale, "Default per document type")}</p>
          <div className="flex flex-col gap-2">
            {PRINTABLE_DOC_TYPES.map((dt) => {
              const sealId = defaults[dt.type]?.sealAssetId ?? null;
              const sigId = defaults[dt.type]?.signatureAssetId ?? null;
              return (
                <div key={dt.type} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-b border-line py-1.5 text-[12.5px]">
                  <span>{t(locale, dt.label)}</span>
                  <Select value={sealId == null ? "none" : String(sealId)} onValueChange={(v) => setDefault(dt.type, "sealAssetId", v)}>
                    <SelectTrigger className="w-[130px] h-8"><SelectValue placeholder={t(locale, "Seal")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t(locale, "No seal")}</SelectItem>
                      {seals.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={sigId == null ? "none" : String(sigId)} onValueChange={(v) => setDefault(dt.type, "signatureAssetId", v)}>
                    <SelectTrigger className="w-[130px] h-8"><SelectValue placeholder={t(locale, "Signature")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t(locale, "No signature")}</SelectItem>
                      {signatures.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1 w-[70px] justify-end">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {previewUrl(sealId) && <img src={previewUrl(sealId)!} alt="" className="h-6 object-contain" />}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {previewUrl(sigId) && <img src={previewUrl(sigId)!} alt="" className="h-6 object-contain" />}
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <Button type="button" onClick={saveDefaults} disabled={pending} size="sm">{pending ? t(locale, "Saving…") : t(locale, "Save defaults")}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
