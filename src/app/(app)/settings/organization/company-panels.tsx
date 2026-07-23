"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { CropImageUpload } from "@/components/upload/crop-image-upload";
import { CROP_LOGO } from "@/components/upload/crop-configs";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Org } from "@/db";
import { updateBusinessDetailsAction, updateColorThemeAction, uploadLogoAction } from "./actions";

export function BusinessDetailsForm({ locale, org }: { locale: Locale; org: Org }) {
  const [pending, startTransition] = useTransition();
  const [country, setCountry] = useState(org.country ?? "Saudi Arabia");
  const [language, setLanguage] = useState(org.defaultLanguage);

  function submit(formData: FormData) {
    formData.set("country", country);
    formData.set("defaultLanguage", language);
    startTransition(async () => {
      const result = await updateBusinessDetailsAction(formData);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-5 max-w-2xl">
      <h3 className="text-[17px] font-bold">{t(locale, "Business Details")}</h3>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t(locale, "Business Name")} htmlFor="org-name" span={2}>
          <Input id="org-name" name="name" required defaultValue={org.name} />
        </FormField>
        <FormField label={t(locale, "Industry")} htmlFor="org-industry">
          <Input id="org-industry" name="industry" defaultValue={org.industry ?? ""} />
        </FormField>
        <FormField label={t(locale, "Country")} htmlFor="org-country">
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger id="org-country">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Saudi Arabia">🇸🇦 Saudi Arabia</SelectItem>
              <SelectItem value="United Arab Emirates">🇦🇪 United Arab Emirates</SelectItem>
              <SelectItem value="Bahrain">🇧🇭 Bahrain</SelectItem>
              <SelectItem value="Kuwait">🇰🇼 Kuwait</SelectItem>
              <SelectItem value="Oman">🇴🇲 Oman</SelectItem>
              <SelectItem value="Qatar">🇶🇦 Qatar</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label={t(locale, "Address")} htmlFor="org-address" span={2}>
          <Input id="org-address" name="address" defaultValue={org.address ?? ""} />
        </FormField>
        <FormField label={t(locale, "Phone")} htmlFor="org-phone">
          <Input id="org-phone" name="phone" defaultValue={org.phone ?? ""} />
        </FormField>
        <FormField label={t(locale, "Currency")} htmlFor="org-currency">
          <Input id="org-currency" name="currency" defaultValue={org.currency} className="font-mono" />
        </FormField>
        <FormField label={t(locale, "Tax ID")} htmlFor="org-tax-id">
          <Input id="org-tax-id" name="taxId" defaultValue={org.taxId ?? ""} className="font-mono" />
        </FormField>
        <FormField label={t(locale, "VAT Number")} htmlFor="org-vat">
          <Input id="org-vat" name="vatNumber" defaultValue={org.vatNumber ?? ""} className="font-mono" />
        </FormField>
        <FormField label={t(locale, "Default Language")} htmlFor="org-language">
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger id="org-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">🇬🇧 {t(locale, "English")}</SelectItem>
              <SelectItem value="ar">🇸🇦 {t(locale, "Arabic")}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t(locale, "Saving…") : t(locale, "Save changes")}
        </Button>
      </div>
    </form>
  );
}

export function LogoPanel({ locale, org }: { locale: Locale; org: Org }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-[17px] font-bold">{t(locale, "Logo")}</h3>
      <div className="grid grid-cols-2 gap-5 max-w-xl">
      <Card>
        <CardContent className="p-5 flex flex-col items-center gap-3">
          <div className="w-full aspect-square rounded-2xl bg-brand-navy flex items-center justify-center overflow-hidden">
            {org.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logoUrl} alt={org.name} className="max-w-[70%] max-h-[70%] object-contain" />
            ) : (
              <span className="text-white font-display font-extrabold text-2xl">
                {org.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <p className="text-[11px] text-ink-faint text-center">{t(locale, "Current logo")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
          <Upload className="size-6 text-brand-orange" />
          <p className="text-[12.5px] font-medium">{t(locale, "Click to choose a logo, then crop it")}</p>
          <p className="text-[11px] text-ink-faint">{t(locale, "PNG or JPG · square or wide crop · transparency preserved")}</p>
          <CropImageUpload
            locale={locale}
            config={CROP_LOGO}
            trigger={<Button type="button" size="sm">{t(locale, "Upload Logo")}</Button>}
            onUpload={async (file) => {
              const fd = new FormData();
              fd.set("logo", file);
              const result = await uploadLogoAction(fd);
              if (result.error) return { error: result.error };
              router.refresh();
            }}
          />
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

export function ColorThemePanel({ locale, org }: { locale: Locale; org: Org }) {
  const [primary, setPrimary] = useState(org.primaryColor);
  const [accent, setAccent] = useState(org.accentColor);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await updateColorThemeAction(primary, accent);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  return (
    <div className="flex flex-col gap-5 max-w-xl">
      <h3 className="text-[17px] font-bold">{t(locale, "Color Theme")}</h3>
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5 flex flex-col gap-3">
            <p className="text-[12.5px] font-semibold">{t(locale, "Primary color")}</p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                className="size-11 rounded-xl border border-line-strong cursor-pointer"
              />
              <Input value={primary} onChange={(e) => setPrimary(e.target.value)} className="font-mono" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex flex-col gap-3">
            <p className="text-[12.5px] font-semibold">{t(locale, "Accent color")}</p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="size-11 rounded-xl border border-line-strong cursor-pointer"
              />
              <Input value={accent} onChange={(e) => setAccent(e.target.value)} className="font-mono" />
            </div>
          </CardContent>
        </Card>
      </div>
      <div>
        <Button onClick={save} disabled={pending}>
          {pending ? t(locale, "Saving…") : t(locale, "Save theme")}
        </Button>
      </div>
    </div>
  );
}
