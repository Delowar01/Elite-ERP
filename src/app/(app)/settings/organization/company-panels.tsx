"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Check, RotateCcw } from "lucide-react";
import {
  DEFAULT_PRIMARY,
  DEFAULT_ACCENT,
  HEX_COLOR,
  readableForeground,
  type ColorThemeMode,
} from "@/lib/brand-theme";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CropImageUpload } from "@/components/upload/crop-image-upload";
import { CROP_LOGO } from "@/components/upload/crop-configs";
import { CurrencyMark } from "@/components/ui/currency-mark";
import { CURRENCIES, resolveCurrencyMark } from "@/lib/currency/currencies";
import { COUNTRIES } from "@/lib/geo/countries";
import { getProfileByCountryName, resolveTaxLabels } from "@/lib/geo/country-profiles";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Org } from "@/db";
import { updateBusinessDetailsAction, updateColorThemeAction, uploadLogoAction } from "./actions";

export function BusinessDetailsForm({ locale, org }: { locale: Locale; org: Org }) {
  const [pending, startTransition] = useTransition();
  const [country, setCountry] = useState(org.country ?? "Saudi Arabia");
  const [language, setLanguage] = useState(org.defaultLanguage);
  const [currency, setCurrency] = useState(org.currency);
  // Global-profile overrides (only shown/editable when the resolved profile is configurable).
  const [customTaxName, setCustomTaxName] = useState(org.customTaxName ?? "");
  const [customTaxNumberLabel, setCustomTaxNumberLabel] = useState(org.customTaxNumberLabel ?? "");
  const [customRegistrationLabel, setCustomRegistrationLabel] = useState(org.customRegistrationLabel ?? "");

  // The org's country drives its profile: default currency, tax terminology, registration field.
  const profile = getProfileByCountryName(country);
  const labels = resolveTaxLabels(profile, { customTaxName, customTaxNumberLabel, customRegistrationLabel });
  const countryOptions = COUNTRIES.map((c) => ({ value: c.name, label: c.name, sublabel: c.code }));

  function onCountryChange(name: string) {
    setCountry(name);
    // Follow the new country's default currency (user can still change it afterwards).
    setCurrency(getProfileByCountryName(name).defaultCurrencyCode);
  }

  function submit(formData: FormData) {
    formData.set("country", country);
    formData.set("defaultLanguage", language);
    formData.set("currency", currency);
    formData.set("customTaxName", profile.configurable ? customTaxName : "");
    formData.set("customTaxNumberLabel", profile.configurable ? customTaxNumberLabel : "");
    formData.set("customRegistrationLabel", profile.configurable ? customRegistrationLabel : "");
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
          <SearchableSelect
            id="org-country"
            options={countryOptions}
            value={country}
            onChange={onCountryChange}
            placeholder={t(locale, "Select Country")}
            searchPlaceholder={t(locale, "Search…")}
            emptyText={t(locale, "No matches.")}
            aria-label={t(locale, "Country")}
          />
        </FormField>
        <FormField label={t(locale, "Address")} htmlFor="org-address" span={2}>
          <Input id="org-address" name="address" defaultValue={org.address ?? ""} />
        </FormField>
        <FormField label={t(locale, "Phone")} htmlFor="org-phone">
          <Input id="org-phone" name="phone" defaultValue={org.phone ?? ""} />
        </FormField>
        <FormField label={t(locale, "Currency")} htmlFor="org-currency">
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger id="org-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((cur) => (
                <SelectItem key={cur.currencyCode} value={cur.currencyCode}>
                  <span className="inline-flex items-center gap-1.5">
                    <span>{cur.countryName} — {cur.currencyCode}</span>
                    <span className="text-ink-faint">
                      — <CurrencyMark mark={resolveCurrencyMark(cur.currencyCode)} />
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        {/* Tax-number + registration labels follow the country profile (VAT Number/CR, TRN/Trade License…). */}
        <FormField label={t(locale, labels.taxNumberLabel)} htmlFor="org-vat">
          <Input id="org-vat" name="vatNumber" defaultValue={org.vatNumber ?? ""} className="font-mono" />
        </FormField>
        <FormField label={t(locale, labels.registrationLabel)} htmlFor="org-tax-id">
          <Input id="org-tax-id" name="taxId" defaultValue={org.taxId ?? ""} className="font-mono" />
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

      {/* Country Profile summary — live, driven by the selected country. */}
      <Card>
        <CardContent className="p-5 flex flex-col gap-3">
          <p className="text-[12.5px] font-semibold">{t(locale, "Country Profile")}</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px]">
            <div className="flex justify-between"><span className="text-ink-faint">{t(locale, "Tax System")}</span><span>{profile.taxSystem === "None" ? t(locale, labels.taxName) : profile.taxSystem}</span></div>
            <div className="flex justify-between"><span className="text-ink-faint">{t(locale, "Default Currency")}</span><span className="font-mono">{profile.defaultCurrencyCode}</span></div>
            <div className="flex justify-between"><span className="text-ink-faint">{t(locale, "Tax Number Label")}</span><span>{t(locale, labels.taxNumberLabel)}</span></div>
            <div className="flex justify-between"><span className="text-ink-faint">{t(locale, "Registration Field")}</span><span>{t(locale, labels.registrationLabel)}</span></div>
            <div className="flex justify-between"><span className="text-ink-faint">{t(locale, "Default VAT Rate")}</span><span>{profile.defaultTaxRate}%</span></div>
            <div className="flex justify-between"><span className="text-ink-faint">{t(locale, "E-Invoicing")}</span><span>{profile.enabledFeatures.includes("zatca_phase1") ? t(locale, "ZATCA Phase 1") : "—"}</span></div>
          </div>
          {profile.configurable && (
            <div className="border-t border-line pt-3 mt-1 flex flex-col gap-3">
              <p className="text-[11.5px] text-ink-muted">{t(locale, "This country has no dedicated profile — customize the tax terminology below.")}</p>
              <div className="grid grid-cols-3 gap-3">
                <FormField label={t(locale, "Tax Name")} htmlFor="ctn"><Input id="ctn" value={customTaxName} onChange={(e) => setCustomTaxName(e.target.value)} placeholder={profile.taxName} /></FormField>
                <FormField label={t(locale, "Tax Number Label")} htmlFor="ctnl"><Input id="ctnl" value={customTaxNumberLabel} onChange={(e) => setCustomTaxNumberLabel(e.target.value)} placeholder={profile.taxNumberLabel} /></FormField>
                <FormField label={t(locale, "Registration Field")} htmlFor="crl"><Input id="crl" value={customRegistrationLabel} onChange={(e) => setCustomRegistrationLabel(e.target.value)} placeholder={profile.registrationFields[0].label} /></FormField>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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

const ELITE_GRADIENT = "linear-gradient(135deg, #f5a25c, #e87722)";
const ELITE_ORANGE = "#e87722";

function ColorField({ locale, label, value, onChange, valid, onReset }: {
  locale: Locale; label: string; value: string; onChange: (v: string) => void; valid: boolean; onReset: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[12.5px] font-semibold">{t(locale, label)}</p>
          <button type="button" onClick={onReset} className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-brand-orange">
            <RotateCcw className="size-3" /> {t(locale, "Reset to default")}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <input type="color" value={valid ? value : DEFAULT_PRIMARY} onChange={(e) => onChange(e.target.value)} className="size-11 rounded-xl border border-line-strong cursor-pointer shrink-0" aria-label={t(locale, label)} />
          <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono uppercase" spellCheck={false} />
          <span className="size-9 rounded-lg border border-line-strong shrink-0" style={{ backgroundColor: valid ? value : "transparent" }} aria-hidden />
        </div>
        {!valid && <p className="text-[11.5px] text-danger">{t(locale, "Enter a valid 6-digit hex color (e.g. #1B1B4E).")}</p>}
      </CardContent>
    </Card>
  );
}

// Business Settings → Color Theme. Two modes: Gradient (existing Elite branding, default) and
// Single (solid Primary + Accent). Live preview reflects the current picks without saving; the
// whole app re-themes on Save (the app shell re-reads the org's mode/colors via router.refresh).
export function ColorThemePanel({ locale, org }: { locale: Locale; org: Org }) {
  const router = useRouter();
  const [mode, setMode] = useState<ColorThemeMode>(org.colorThemeMode === "single" ? "single" : "gradient");
  const [primary, setPrimary] = useState(org.primaryColor);
  const [accent, setAccent] = useState(org.accentColor);
  const [pending, startTransition] = useTransition();

  const primaryValid = HEX_COLOR.test(primary);
  const accentValid = HEX_COLOR.test(accent);
  const canSave = mode === "gradient" || (primaryValid && accentValid);

  const isSingle = mode === "single";
  const pv = primaryValid ? primary : DEFAULT_PRIMARY;
  const av = accentValid ? accent : DEFAULT_ACCENT;
  // Preview colors derive from the *current* form state, independent of what is saved.
  const primaryBtnBg = isSingle ? pv : ELITE_GRADIENT;
  const primarySolid = isSingle ? pv : ELITE_ORANGE;
  const primaryFg = isSingle ? readableForeground(pv) : "#ffffff";
  const accentBg = isSingle ? av : ELITE_ORANGE;
  const accentFg = isSingle ? readableForeground(av) : "#ffffff";
  const linkColor = isSingle ? pv : ELITE_ORANGE;
  const accentTint = `color-mix(in srgb, ${accentBg} 14%, transparent)`;

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const result = await updateColorThemeAction(mode, primary, accent);
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Saved"));
        router.refresh(); // re-theme the whole app immediately
      }
    });
  }

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <h3 className="text-[17px] font-bold">{t(locale, "Color Theme")}</h3>
      <p className="text-[12.5px] text-ink-muted -mt-3">{t(locale, "Choose how your organization's brand colors are applied. This is separate from light/dark appearance.")}</p>

      {/* Mode selector — radio cards with a filled state + checkmark on the selected one */}
      <div role="radiogroup" aria-label={t(locale, "Color mode")} className="grid grid-cols-2 gap-4">
        {([
          { key: "gradient", title: "Gradient Color", desc: "Use the classic Elite gradient branding.", sample: <div className="h-8 rounded-lg" style={{ background: ELITE_GRADIENT }} /> },
          { key: "single", title: "Single Color", desc: "Use your own solid primary and accent colors.", sample: (
            <div className="flex gap-2">
              <div className="h-8 flex-1 rounded-lg" style={{ backgroundColor: pv }} />
              <div className="h-8 flex-1 rounded-lg" style={{ backgroundColor: av }} />
            </div>
          ) },
        ] as const).map((opt) => {
          const selected = mode === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(opt.key)}
              className={`relative text-left rounded-2xl border p-4 transition-colors ${selected ? "border-brand-orange bg-brand-orange/10" : "border-line-strong hover:bg-canvas"}`}
            >
              {selected && (
                <span className="absolute top-3 right-3 inline-flex size-5 items-center justify-center rounded-full bg-brand-orange text-[color:var(--brand-primary-foreground)]">
                  <Check className="size-3.5" />
                </span>
              )}
              <div className="text-[13.5px] font-bold mb-1">{t(locale, opt.title)}</div>
              <div className="text-[11.5px] text-ink-muted mb-3">{t(locale, opt.desc)}</div>
              {opt.sample}
            </button>
          );
        })}
      </div>

      {/* Single-color pickers */}
      {isSingle && (
        <div className="grid grid-cols-2 gap-4">
          <ColorField locale={locale} label="Primary color" value={primary} onChange={setPrimary} valid={primaryValid} onReset={() => setPrimary(DEFAULT_PRIMARY)} />
          <ColorField locale={locale} label="Accent color" value={accent} onChange={setAccent} valid={accentValid} onReset={() => setAccent(DEFAULT_ACCENT)} />
        </div>
      )}

      {/* Live preview — updates immediately, applied to the app only on Save */}
      <Card>
        <CardContent className="p-5 flex flex-col gap-4">
          <p className="text-[12.5px] font-semibold">{t(locale, "Live preview")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn" style={{ background: primaryBtnBg, color: primaryFg, width: "auto", padding: "0 18px" }}>
              {t(locale, "Primary button")}
            </button>
            <button type="button" className="btn" style={{ backgroundColor: accentBg, color: accentFg, width: "auto", padding: "0 18px" }}>
              {t(locale, "Accent button")}
            </button>
            <span className="tab" style={{ background: primarySolid, color: primaryFg, borderRadius: 999, padding: "7px 16px", fontSize: 12.5, fontWeight: 600 }}>
              {t(locale, "Active tab")}
            </span>
            <span style={{ background: primarySolid, color: primaryFg, borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 600, boxShadow: "0 4px 12px -3px color-mix(in srgb, " + primarySolid + " 50%, transparent)" }}>
              {t(locale, "Selected item")}
            </span>
            <span className="pill" style={{ backgroundColor: accentTint, color: accentBg }}>
              {t(locale, "Badge")}
            </span>
            <a href="#" onClick={(e) => e.preventDefault()} style={{ color: linkColor, fontSize: 13, fontWeight: 600 }}>
              {t(locale, "Primary link")}
            </a>
          </div>
          <div>
            <div className="text-[11px] text-ink-faint mb-1.5">{t(locale, "Sample")}</div>
            {isSingle ? (
              <div className="flex gap-2 max-w-[240px]">
                <div className="h-7 flex-1 rounded-lg" style={{ backgroundColor: pv }} title={t(locale, "Primary color")} />
                <div className="h-7 flex-1 rounded-lg" style={{ backgroundColor: av }} title={t(locale, "Accent color")} />
              </div>
            ) : (
              <div className="h-7 max-w-[240px] rounded-lg" style={{ background: ELITE_GRADIENT }} />
            )}
          </div>
        </CardContent>
      </Card>

      <div>
        <Button onClick={save} disabled={pending || !canSave}>
          {pending ? t(locale, "Saving…") : t(locale, "Save theme")}
        </Button>
      </div>
    </div>
  );
}
