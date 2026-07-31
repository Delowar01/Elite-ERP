"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Check, RotateCcw } from "lucide-react";
import {
  DEFAULT_PRIMARY,
  DEFAULT_ACCENT,
  DEFAULT_GRADIENT_FROM,
  DEFAULT_GRADIENT_TO,
  HEX_COLOR,
  THEME_COMPONENTS,
  generateComponentColors,
  resolveComponentColors,
  isReadable,
  suggestReadableFg,
  type ColorThemeMode,
  type ThemeComponent,
  type ThemeOverrides,
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

// One overridable channel (background OR font) for a component. Shows the auto value as a
// placeholder; typing / picking a color sets a manual override, and "Auto" clears it back.
function MiniColor({ locale, label, value, auto, overridden, onChange, onAuto }: {
  locale: Locale; label: string; value: string | undefined; auto: string; overridden: boolean; onChange: (v: string) => void; onAuto: () => void;
}) {
  const swatch = overridden && value && HEX_COLOR.test(value) ? value : (HEX_COLOR.test(auto) ? auto : "#000000");
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] text-ink-muted">{t(locale, label)}</span>
        {overridden ? (
          <button type="button" onClick={onAuto} className="inline-flex items-center gap-0.5 text-[10px] text-ink-faint hover:text-brand-orange">
            <RotateCcw className="size-2.5" /> {t(locale, "Auto")}
          </button>
        ) : (
          <span className="text-[10px] text-ink-faint">{t(locale, "Auto")}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <input type="color" value={swatch} onChange={(e) => onChange(e.target.value)} className="size-7 rounded-md border border-line-strong cursor-pointer shrink-0" aria-label={t(locale, label)} />
        <Input value={overridden ? (value ?? "") : ""} placeholder={auto} onChange={(e) => onChange(e.target.value)} className="h-7 font-mono text-[11px] uppercase" spellCheck={false} />
      </div>
    </div>
  );
}

const COMPONENT_LABELS: Record<ThemeComponent, string> = {
  primaryButton: "Primary button",
  accentButton: "Accent button",
  activeTab: "Active tab",
  selectedItem: "Selected item",
  badge: "Badge",
};

// Business Settings → Color Theme (Issue #16). Editable gradient (start/end) and single (primary/
// accent); auto-generated + manually-overridable background/font per component with contrast
// validation; live preview matching the saved appearance. The whole app re-themes on Save via the
// shared injected stylesheet (router.refresh re-reads the org's colors — no full page reload).
export function ColorThemePanel({ locale, org }: { locale: Locale; org: Org }) {
  const router = useRouter();
  const [mode, setMode] = useState<ColorThemeMode>(org.colorThemeMode === "single" ? "single" : "gradient");
  const [primary, setPrimary] = useState(org.primaryColor);
  const [accent, setAccent] = useState(org.accentColor);
  const [gradientFrom, setGradientFrom] = useState(org.gradientFrom);
  const [gradientTo, setGradientTo] = useState(org.gradientTo);
  const [overrides, setOverrides] = useState<ThemeOverrides>((org.themeOverrides as ThemeOverrides | null) ?? {});
  const [pending, startTransition] = useTransition();

  const single = mode === "single";
  const primaryValid = HEX_COLOR.test(primary);
  const accentValid = HEX_COLOR.test(accent);
  const fromValid = HEX_COLOR.test(gradientFrom);
  const toValid = HEX_COLOR.test(gradientTo);
  const canSave = single ? primaryValid && accentValid : fromValid && toValid;

  const input = { mode, primaryColor: primary, accentColor: accent, gradientFrom, gradientTo, overrides };
  const generated = generateComponentColors(input);
  const resolved = resolveComponentColors(input);
  const themeGradient = `linear-gradient(135deg, ${fromValid ? gradientFrom : DEFAULT_GRADIENT_FROM}, ${toValid ? gradientTo : DEFAULT_GRADIENT_TO})`;

  function setOv(comp: ThemeComponent, key: "bg" | "fg", val: string) {
    setOverrides((prev) => ({ ...prev, [comp]: { ...prev[comp], [key]: val } }));
  }
  function clearOv(comp: ThemeComponent, key: "bg" | "fg") {
    setOverrides((prev) => {
      const entry: { bg?: string; fg?: string } = { ...(prev[comp] ?? {}) };
      delete entry[key];
      const next = { ...prev };
      if (entry.bg || entry.fg) next[comp] = entry; else delete next[comp];
      return next;
    });
  }
  // Solid background used for contrast checks (the primary button's gradient isn't a single hex).
  function bgSolid(comp: ThemeComponent): string {
    const bg = overrides[comp]?.bg ?? generated[comp].bg;
    if (HEX_COLOR.test(bg)) return bg;
    return single ? (primaryValid ? primary : DEFAULT_PRIMARY) : (toValid ? gradientTo : DEFAULT_GRADIENT_TO);
  }
  function autoBg(comp: ThemeComponent): string {
    const bg = generated[comp].bg;
    return HEX_COLOR.test(bg) ? bg : bgSolid(comp);
  }

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const result = await updateColorThemeAction({ mode, primaryColor: primary, accentColor: accent, gradientFrom, gradientTo, overrides });
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

      {/* Mode selector */}
      <div role="radiogroup" aria-label={t(locale, "Color mode")} className="grid grid-cols-2 gap-4">
        {([
          { key: "gradient", title: "Gradient Color", desc: "Use an editable two-color brand gradient.", sample: <div className="h-8 rounded-lg" style={{ background: themeGradient }} /> },
          { key: "single", title: "Single Color", desc: "Use your own solid primary and accent colors.", sample: (
            <div className="flex gap-2">
              <div className="h-8 flex-1 rounded-lg" style={{ backgroundColor: primaryValid ? primary : DEFAULT_PRIMARY }} />
              <div className="h-8 flex-1 rounded-lg" style={{ backgroundColor: accentValid ? accent : DEFAULT_ACCENT }} />
            </div>
          ) },
        ] as const).map((opt) => {
          const selected = mode === opt.key;
          return (
            <button key={opt.key} type="button" role="radio" aria-checked={selected} onClick={() => setMode(opt.key)}
              className={`relative text-left rounded-2xl border p-4 transition-colors ${selected ? "border-brand-orange bg-brand-orange/10" : "border-line-strong hover:bg-canvas"}`}>
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

      {/* Main color pickers per mode */}
      {single ? (
        <div className="grid grid-cols-2 gap-4">
          <ColorField locale={locale} label="Primary color" value={primary} onChange={setPrimary} valid={primaryValid} onReset={() => setPrimary(DEFAULT_PRIMARY)} />
          <ColorField locale={locale} label="Accent color" value={accent} onChange={setAccent} valid={accentValid} onReset={() => setAccent(DEFAULT_ACCENT)} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <ColorField locale={locale} label="Gradient start color" value={gradientFrom} onChange={setGradientFrom} valid={fromValid} onReset={() => setGradientFrom(DEFAULT_GRADIENT_FROM)} />
          <ColorField locale={locale} label="Gradient end color" value={gradientTo} onChange={setGradientTo} valid={toValid} onReset={() => setGradientTo(DEFAULT_GRADIENT_TO)} />
        </div>
      )}

      {/* Component colors — auto-generated, individually overridable, contrast-validated */}
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[12.5px] font-semibold">{t(locale, "Component colors")}</p>
          <p className="text-[11px] text-ink-faint">{t(locale, "Generated automatically from your theme colors. Override any background or font; overrides are kept until you change them.")}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {THEME_COMPONENTS.map((comp) => {
            const rBg = resolved[comp].bg;
            const rFg = resolved[comp].fg;
            const readable = isReadable(rFg, bgSolid(comp));
            const ov = overrides[comp];
            return (
              <div key={comp} className="rounded-xl border border-line p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold">{t(locale, COMPONENT_LABELS[comp])}</span>
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex items-center justify-center rounded px-2 py-0.5 text-[11px] font-semibold" style={{ background: rBg, color: rFg }}>Aa</span>
                    {readable ? <span className="text-[10.5px] text-success">{t(locale, "Readable")}</span> : <span className="text-[10.5px] text-danger">{t(locale, "Low contrast")}</span>}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <MiniColor locale={locale} label="Background" value={ov?.bg} auto={autoBg(comp)} overridden={Boolean(ov?.bg)} onChange={(v) => setOv(comp, "bg", v)} onAuto={() => clearOv(comp, "bg")} />
                  <MiniColor locale={locale} label="Font" value={ov?.fg} auto={generated[comp].fg} overridden={Boolean(ov?.fg)} onChange={(v) => setOv(comp, "fg", v)} onAuto={() => clearOv(comp, "fg")} />
                </div>
                {!readable && (
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-danger">{t(locale, "Font color is hard to read on this background.")}</span>
                    <button type="button" className="text-brand-orange underline shrink-0" onClick={() => setOv(comp, "fg", suggestReadableFg(bgSolid(comp), rFg))}>
                      {t(locale, "Fix automatically")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Live preview — updates immediately; applied to the app on Save */}
      <Card>
        <CardContent className="p-5 flex flex-col gap-4">
          <p className="text-[12.5px] font-semibold">{t(locale, "Live preview")}</p>
          <div>
            <div className="text-[11px] text-ink-faint mb-1.5">{single ? t(locale, "Primary / Accent") : t(locale, "Gradient")}</div>
            {single ? (
              <div className="flex gap-2 max-w-[240px]">
                <div className="h-7 flex-1 rounded-lg" style={{ backgroundColor: primaryValid ? primary : DEFAULT_PRIMARY }} title={t(locale, "Primary color")} />
                <div className="h-7 flex-1 rounded-lg" style={{ backgroundColor: accentValid ? accent : DEFAULT_ACCENT }} title={t(locale, "Accent color")} />
              </div>
            ) : (
              <div className="h-7 max-w-[240px] rounded-lg" style={{ background: themeGradient }} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn" style={{ background: resolved.primaryButton.bg, color: resolved.primaryButton.fg, width: "auto", padding: "0 18px" }}>
              {t(locale, "Primary button")}
            </button>
            <button type="button" className="btn" style={{ background: resolved.accentButton.bg, color: resolved.accentButton.fg, width: "auto", padding: "0 18px" }}>
              {t(locale, "Accent button")}
            </button>
            <span style={{ background: resolved.activeTab.bg, color: resolved.activeTab.fg, borderRadius: 999, padding: "7px 16px", fontSize: 12.5, fontWeight: 600 }}>
              {t(locale, "Active tab")}
            </span>
            <span style={{ background: resolved.selectedItem.bg, color: resolved.selectedItem.fg, borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 600 }}>
              {t(locale, "Selected item")}
            </span>
            <span style={{ background: resolved.badge.bg, color: resolved.badge.fg, borderRadius: 999, padding: "4px 12px", fontSize: 11.5, fontWeight: 600 }}>
              {t(locale, "Badge")}
            </span>
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
