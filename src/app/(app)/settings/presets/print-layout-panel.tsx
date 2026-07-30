"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { CropImageUpload } from "@/components/upload/crop-image-upload";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Org } from "@/db";
import { DOCUMENT_LAYOUTS, DOCUMENT_COLOR_THEMES, PRINTABLE_DOC_TYPES, colorForTheme } from "@/lib/doc-print";
import { updatePrintLayoutPresetAction, uploadCustomLayoutAction } from "./document-preset-actions";

const CUSTOM_LAYOUT_CROP = { title: "Custom Document Design", format: "png" as const, presets: [{ label: "A4", aspect: 794 / 1123, width: 1588, height: 2246 }] };

// A small live document preview that reflects the chosen layout + color theme.
function LayoutPreview({ locale, layout, accent }: { locale: Locale; layout: string; accent: string }) {
  const filled = layout === "classic" || layout === "custom";
  const badgeStyle = layout === "minimal" ? { color: accent, border: `1.5px solid ${accent}`, background: "transparent" } : { background: accent, color: "#fff" };
  return (
    <div className="rounded-lg border border-line bg-white p-3 w-full max-w-[220px] text-[8px] leading-tight shadow-sm" aria-label={t(locale, "Preview")}>
      <div className="flex items-center justify-between mb-2">
        <span className="px-2 py-0.5 rounded font-bold uppercase tracking-wide" style={badgeStyle}>{t(locale, "Invoice")}</span>
        <span className="font-bold" style={{ color: "#1B1B4E" }}>ELITE</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <div className={cn("rounded p-1.5", filled ? "" : "border border-line")} style={filled ? { background: "#EEF0FC" } : undefined}>FROM</div>
        <div className="rounded p-1.5 border border-line">TO</div>
      </div>
      <div className="rounded overflow-hidden border border-line">
        <div className="px-1.5 py-1 font-semibold" style={layout === "minimal" ? { color: "#171A3D", borderBottom: `2px solid ${accent}` } : { background: accent, color: "#fff" }}>
          {t(locale, "Item")}
        </div>
        <div className={cn("px-1.5 py-1", layout === "classic" && "bg-[#F7F7FB]")}>Line 1</div>
        <div className="px-1.5 py-1">Line 2</div>
      </div>
    </div>
  );
}

export function PrintLayoutPanel({ locale, org }: { locale: Locale; org: Org }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [layout, setLayout] = useState(org.printLayout);
  const [paperSize, setPaperSize] = useState(org.paperSize);
  const [colorTheme, setColorTheme] = useState(org.documentColorTheme);
  const [overrides, setOverrides] = useState<Record<string, string>>(org.documentLayoutOverrides ?? {});
  // Read directly from the (server-refreshed) org prop so an upload reflects immediately.
  const customUrl = org.customLayoutUrl;

  const accent = colorForTheme(colorTheme);
  const layoutOptions = [...DOCUMENT_LAYOUTS.map((l) => ({ value: l.value as string, label: l.label })), ...(customUrl ? [{ value: "custom", label: "Custom" }] : [])];

  async function uploadCustom(file: File) {
    const fd = new FormData();
    fd.set("customLayout", file);
    const result = await uploadCustomLayoutAction(fd);
    if (result.error) return { error: result.error };
    toast.success(t(locale, "Custom design uploaded."));
    router.refresh();
  }

  function submit() {
    const fd = new FormData();
    fd.set("printLayout", layout);
    fd.set("paperSize", paperSize);
    fd.set("printMarginMm", String((document.getElementById("printMarginMm") as HTMLInputElement)?.value ?? org.printMarginMm));
    fd.set("documentColorTheme", colorTheme);
    for (const { type } of PRINTABLE_DOC_TYPES) fd.set(`layout__${type}`, overrides[type] ?? "default");
    startTransition(async () => {
      const result = await updatePrintLayoutPresetAction(fd);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h3 className="text-[17px] font-bold">{t(locale, "Print Layout")}</h3>
        <p className="text-[12.5px] text-ink-muted mt-1">
          {t(locale, "Choose how your documents look when previewed, printed, exported to PDF, downloaded and shared. Settings are saved for your whole organization.")}
        </p>
      </div>

      <div className="grid md:grid-cols-[1fr_auto] gap-6 items-start">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-[12.5px] font-semibold mb-2">{t(locale, "Default layout")}</p>
            <div className="grid grid-cols-3 gap-3">
              {DOCUMENT_LAYOUTS.map((l) => (
                <button
                  type="button"
                  key={l.value}
                  onClick={() => setLayout(l.value)}
                  className={cn("text-left rounded-xl border-2 p-3 transition-colors", layout === l.value ? "border-brand-orange" : "border-line hover:border-line-strong")}
                >
                  <div className="h-10 rounded-lg bg-canvas mb-2" />
                  <p className="text-[12px] font-semibold flex items-center gap-1">{layout === l.value && <Check className="size-3 text-brand-orange" />}{t(locale, l.label)}</p>
                  <p className="text-[10.5px] text-ink-faint mt-0.5">{t(locale, l.desc)}</p>
                </button>
              ))}
              <button
                type="button"
                onClick={() => customUrl && setLayout("custom")}
                disabled={!customUrl}
                className={cn("text-left rounded-xl border-2 p-3 transition-colors disabled:opacity-50", layout === "custom" ? "border-brand-orange" : "border-line hover:border-line-strong")}
              >
                <div className="h-10 rounded-lg bg-canvas mb-2 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {customUrl ? <img src={customUrl} alt="" className="w-full h-full object-cover" /> : null}
                </div>
                <p className="text-[12px] font-semibold flex items-center gap-1">{layout === "custom" && <Check className="size-3 text-brand-orange" />}{t(locale, "Custom")}</p>
                <p className="text-[10.5px] text-ink-faint mt-0.5">{customUrl ? t(locale, "Your uploaded design") : t(locale, "Upload a design below")}</p>
              </button>
            </div>
          </div>

          <div>
            <p className="text-[12.5px] font-semibold mb-2">{t(locale, "Document color theme")}</p>
            <div className="flex flex-wrap gap-2">
              {DOCUMENT_COLOR_THEMES.map((th) => (
                <button
                  key={th.value}
                  type="button"
                  onClick={() => setColorTheme(th.value)}
                  title={t(locale, th.label)}
                  aria-label={t(locale, th.label)}
                  className={cn("size-8 rounded-full border-2 flex items-center justify-center", colorTheme === th.value ? "border-ink" : "border-line")}
                  style={{ background: th.color }}
                >
                  {colorTheme === th.value && <Check className="size-4 text-white" />}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-faint mt-1.5">{t(locale, "One color theme is applied to all your documents.")}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label={t(locale, "Paper Size")} htmlFor="paperSize">
              <Select value={paperSize} onValueChange={setPaperSize}>
                <SelectTrigger id="paperSize"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A4">A4</SelectItem>
                  <SelectItem value="Letter">Letter</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={t(locale, "Margins (mm)")} htmlFor="printMarginMm">
              <Input id="printMarginMm" name="printMarginMm" type="number" defaultValue={org.printMarginMm} />
            </FormField>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <p className="text-[11px] text-ink-faint uppercase tracking-wide">{t(locale, "Preview")}</p>
          <LayoutPreview locale={locale} layout={layout} accent={accent} />
        </div>
      </div>

      <div>
        <p className="text-[12.5px] font-semibold mb-2">{t(locale, "Document-specific layout")}</p>
        <p className="text-[11px] text-ink-faint mb-3">{t(locale, "Override the default layout for specific document types. Leave as Default to use the layout above.")}</p>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          {PRINTABLE_DOC_TYPES.map((dt) => (
            <div key={dt.type} className="flex items-center justify-between gap-3 text-[12.5px] border-b border-line py-1.5">
              <span>{t(locale, dt.label)}</span>
              <Select value={overrides[dt.type] ?? "default"} onValueChange={(v) => setOverrides((p) => ({ ...p, [dt.type]: v }))}>
                <SelectTrigger className="w-[140px] h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t(locale, "Default")}</SelectItem>
                  {layoutOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{t(locale, o.label)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <CropImageUpload
          locale={locale}
          config={CUSTOM_LAYOUT_CROP}
          trigger={<Button type="button" variant="secondary" size="sm">{customUrl ? t(locale, "Replace custom design") : t(locale, "Upload custom design")}</Button>}
          onUpload={uploadCustom}
        />
        {customUrl && <span className="text-[11.5px] text-success">{t(locale, "Custom design ready")}</span>}
      </div>

      <div>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? t(locale, "Saving…") : t(locale, "Save layout")}
        </Button>
      </div>
    </div>
  );
}
