"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Stamp, PenLine } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Org, NoteTemplate } from "@/db";
import { uploadSealSignatureAction, updatePrintLayoutAction } from "./actions";

export function SealSignaturePanel({ locale, org }: { locale: Locale; org: Org }) {
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await uploadSealSignatureAction(formData);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-5 max-w-xl">
      <h3 className="text-[17px] font-bold">{t(locale, "Seal & Signature")}</h3>
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
            {org.sealUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.sealUrl} alt="Seal" className="size-16 object-contain" />
            ) : (
              <Stamp className="size-6 text-brand-orange" />
            )}
            <p className="text-[12.5px] font-medium">{t(locale, "Company Seal")}</p>
            <p className="text-[11px] text-ink-faint">{t(locale, "PNG or JPG · transparent background recommended")}</p>
            <Input type="file" name="seal" accept="image/png,image/jpeg" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
            {org.signatureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.signatureUrl} alt="Signature" className="size-16 object-contain" />
            ) : (
              <PenLine className="size-6 text-brand-orange" />
            )}
            <p className="text-[12.5px] font-medium">{t(locale, "Authorized Signature")}</p>
            <p className="text-[11px] text-ink-faint">{t(locale, "PNG or JPG · transparent background recommended")}</p>
            <Input type="file" name="signature" accept="image/png,image/jpeg" />
          </CardContent>
        </Card>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t(locale, "Saving…") : t(locale, "Save")}
        </Button>
      </div>
    </form>
  );
}

const LAYOUTS = [
  { value: "classic", label: "Classic", desc: "Bordered table, tinted party boxes" },
  { value: "modern", label: "Modern", desc: "Minimal rules, accent-only color" },
  { value: "minimal", label: "Minimal", desc: "Letterhead style, no fills" },
] as const;

export function PrintLayoutPanel({ locale, org }: { locale: Locale; org: Org }) {
  const [layout, setLayout] = useState(org.printLayout);
  const [paperSize, setPaperSize] = useState(org.paperSize);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    formData.set("printLayout", layout);
    formData.set("paperSize", paperSize);
    startTransition(async () => {
      const result = await updatePrintLayoutAction(formData);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-5 max-w-xl">
      <h3 className="text-[17px] font-bold">{t(locale, "Print Layout")}</h3>
      <div className="grid grid-cols-3 gap-3">
        {LAYOUTS.map((l) => (
          <button
            type="button"
            key={l.value}
            onClick={() => setLayout(l.value)}
            className={cn(
              "text-left rounded-xl border-2 p-4 transition-colors",
              layout === l.value ? "border-brand-orange" : "border-line hover:border-line-strong",
            )}
          >
            <div className="h-14 rounded-lg bg-canvas mb-2.5" />
            <p className="text-[12.5px] font-semibold">{t(locale, l.label)}</p>
            <p className="text-[11px] text-ink-faint mt-0.5">{t(locale, l.desc)}</p>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t(locale, "Paper Size")} htmlFor="paperSize">
          <Select value={paperSize} onValueChange={setPaperSize}>
            <SelectTrigger id="paperSize">
              <SelectValue />
            </SelectTrigger>
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
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t(locale, "Saving…") : t(locale, "Save layout")}
        </Button>
      </div>
    </form>
  );
}

export function DefaultTermsSummary({ locale, templates }: { locale: Locale; templates: NoteTemplate[] }) {
  const defaults = templates.filter((tmpl) => tmpl.isDefault);
  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <h3 className="text-[17px] font-bold">{t(locale, "Default Terms & Conditions")}</h3>
      <p className="text-[12.5px] text-ink-muted -mt-2">
        {t(locale, "Which note template is pre-filled on each document type. Manage templates under Preset Management → Note Templates.")}
      </p>
      {defaults.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-ink-muted text-sm">{t(locale, "No default templates set yet.")}</CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {defaults.map((tmpl) => (
            <li key={tmpl.id} className="flex items-center justify-between text-[13px] py-2 border-b border-line last:border-0">
              <span className="font-medium">{tmpl.documentType}</span>
              <span className="text-ink-muted">{tmpl.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button variant="ghost" asChild size="sm">
          <Link href="/settings/presets">{t(locale, "Manage in Preset Management")}</Link>
        </Button>
      </div>
    </div>
  );
}
