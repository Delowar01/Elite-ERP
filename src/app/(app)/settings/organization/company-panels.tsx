"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, Check, RotateCcw, AlertTriangle } from "lucide-react";
import {
  DEFAULT_PRIMARY,
  DEFAULT_ACCENT,
  DEFAULT_GRADIENT_FROM,
  DEFAULT_GRADIENT_TO,
  HEX_COLOR,
  APPEARANCES,
  NEUTRALS,
  generateComponentColors,
  resolveComponentColors,
  componentBgSolid,
  normalizeOverrides,
  suggestReadableFg,
  AUDITED_COMPONENTS,
  auditedPair,
  auditTheme,
  componentContrast,
  formatRatio,
  type AuditedComponent,
  type ColorThemeMode,
  type ThemeComponent,
  type ThemeOverrides,
  type ThemeOverridesByMode,
  type Appearance,
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

export function BusinessDetailsForm({ locale, org, postedCount }: { locale: Locale; org: Org; postedCount: number }) {
  // FX-1b: one posted journal entry locks the base currency for good. The select is disabled AND
  // the reason is written out with the count — greying out without saying why reads as a bug. The
  // server refuses a changed currency independently of this; the UI is only the explanation.
  const currencyLocked = postedCount > 0;
  const [pending, startTransition] = useTransition();
  // No fallback here. This used to read `org.country ?? "Saudi Arabia"`, which displayed a country
  // that was not stored: every org registered before the country question existed has
  // `country = NULL`, and this screen told its owner they had selected Saudi Arabia. They had no
  // way to detect that, and saving anything else on the form would then write the guess for real.
  // Null now renders as the empty placeholder, which is the truth.
  const [country, setCountry] = useState(org.country ?? "");
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
    // Follow the new country's default currency (user can still change it afterwards) — unless the
    // currency is locked: country stays freely editable (it drives the tax profile), but it must
    // not drag a locked currency along and turn every country edit into a refused submit.
    if (!currencyLocked) setCurrency(getProfileByCountryName(name).defaultCurrencyCode);
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
          <Select value={currency} onValueChange={setCurrency} disabled={currencyLocked}>
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
          {currencyLocked && (
            <p className="mt-1 text-[12px]" role="status" data-testid="currency-locked" style={{ color: "var(--warning-ink)" }}>
              {t(locale, "Base currency cannot be changed: this organization has")} {postedCount} {t(locale, "posted transactions.")}
            </p>
          )}
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

/** "Light Mode", "Dark Mode" or "Light and Dark Mode" — which appearance(s) a warning applies to. */
function modeScopeLabel(fails: { appearance: Appearance }[]): string {
  const light = fails.some((f) => f.appearance === "light");
  const dark = fails.some((f) => f.appearance === "dark");
  if (light && dark) return "Light and Dark Mode";
  return dark ? "Dark Mode" : "Light Mode";
}

const COMPONENT_LABELS: Record<AuditedComponent, string> = {
  primaryButton: "Primary button",
  accentButton: "Accent button",
  activeTab: "Active tab",
  selectedItem: "Selected item",
  badge: "Badge",
  // Painted from the Selected item tokens; audited under its own name so the warning is findable.
  sidebarActive: "Sidebar active item",
};

// Business Settings → Color Theme (Issue #16). Editable gradient (start/end) and single (primary/
// accent); auto-generated + manually-overridable background/font per component with contrast
// validation; live preview matching the saved appearance. The whole app re-themes on Save via the
// shared injected stylesheet (router.refresh re-reads the org's colors — no full page reload).
/** A preview of the five themed components rendered with ONE appearance's calculated colors, on
    that appearance's own surfaces — so light and dark can be compared side by side. */
function ModePreview({ locale, input, appearance, lowContrast }: {
  locale: Locale; input: Parameters<typeof resolveComponentColors>[0]; appearance: Appearance;
  /** Components below the recommended ratio in THIS appearance — outlined so they are easy to spot. */
  lowContrast: Set<string>;
}) {
  const r = resolveComponentColors(input, appearance);
  const n = NEUTRALS[appearance];
  // A dashed warning outline on the offending swatch, without touching the colours being previewed.
  const mark = (comp: string) =>
    lowContrast.has(comp) ? { outline: "2px dashed var(--warning)", outlineOffset: 2 } : {};
  return (
    <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ background: n.background, borderColor: n.border }}>
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-bold" style={{ color: n.textPrimary }}>
          {t(locale, appearance === "light" ? "Light mode" : "Dark mode")}
        </span>
        <span className="text-[10.5px]" style={{ color: n.textMuted }}>{t(locale, "Preview")}</span>
      </div>
      <div className="rounded-lg p-3 flex flex-col gap-2.5" style={{ background: n.surface, border: `1px solid ${n.border}` }}>
        <div className="text-[11.5px]" style={{ color: n.textSecondary }}>{t(locale, "Sample interface text")}</div>
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ background: r.primaryButton.bg, color: r.primaryButton.fg, borderRadius: 9, padding: "6px 12px", fontSize: 11.5, fontWeight: 600 , ...mark("primaryButton") }}>
            {t(locale, "Primary button")}
          </span>
          <span style={{ background: r.accentButton.bg, color: r.accentButton.fg, borderRadius: 9, padding: "6px 12px", fontSize: 11.5, fontWeight: 600 , ...mark("accentButton") }}>
            {t(locale, "Accent button")}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ background: r.activeTab.bg, color: r.activeTab.fg, borderRadius: 999, padding: "5px 12px", fontSize: 11, fontWeight: 600 , ...mark("activeTab") }}>
            {t(locale, "Active tab")}
          </span>
          <span style={{ background: r.selectedItem.bg, color: r.selectedItem.fg, borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 600 , ...mark("selectedItem") }}>
            {t(locale, "Selected item")}
          </span>
          <span style={{ background: r.badge.bg, color: r.badge.fg, borderRadius: 999, padding: "3px 10px", fontSize: 10.5, fontWeight: 600 , ...mark("badge") }}>
            {t(locale, "Badge")}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ColorThemePanel({ locale, org }: { locale: Locale; org: Org }) {
  const router = useRouter();
  const [mode, setMode] = useState<ColorThemeMode>(org.colorThemeMode === "single" ? "single" : "gradient");
  const [primary, setPrimary] = useState(org.primaryColor);
  const [accent, setAccent] = useState(org.accentColor);
  const [gradientFrom, setGradientFrom] = useState(org.gradientFrom);
  const [gradientTo, setGradientTo] = useState(org.gradientTo);
  // Overrides are stored per appearance, so editing light never changes dark (and vice versa).
  const [overrides, setOverrides] = useState<ThemeOverridesByMode>(() => normalizeOverrides(org.themeOverrides ?? null));
  const [editMode, setEditMode] = useState<Appearance>("light");
  const [pending, startTransition] = useTransition();

  const single = mode === "single";
  const primaryValid = HEX_COLOR.test(primary);
  const accentValid = HEX_COLOR.test(accent);
  const fromValid = HEX_COLOR.test(gradientFrom);
  const toValid = HEX_COLOR.test(gradientTo);
  const colorsValid = single ? primaryValid && accentValid : fromValid && toValid;

  const input = { mode, primaryColor: primary, accentColor: accent, gradientFrom, gradientTo, overrides };
  // Everything below is computed for the appearance currently being edited.
  const generated = generateComponentColors(input, editMode);
  const modeOverrides: ThemeOverrides = overrides[editMode] ?? {};
  const themeGradient = `linear-gradient(135deg, ${fromValid ? gradientFrom : DEFAULT_GRADIENT_FROM}, ${toValid ? gradientTo : DEFAULT_GRADIENT_TO})`;

  // Live contrast audit — recomputed on every render, so any colour change updates the warnings
  // immediately. Low contrast is a WARNING: it never disables Save and never rewrites a colour.
  const audit = auditTheme(input);
  const failing = audit.filter((a) => !a.passes);
  /** Failures for one component, keyed by appearance, so a warning can name light / dark / both. */
  const failuresFor = (comp: AuditedComponent) => failing.filter((a) => a.component === comp);
  /** Which components to outline in each preview — recomputed with the audit, so it stays live. */
  const lowByMode = {
    light: new Set(failing.filter((a) => a.appearance === "light").map((a) => a.component)),
    dark: new Set(failing.filter((a) => a.appearance === "dark").map((a) => a.component)),
  };
  const canSave = colorsValid;

  function setOv(comp: ThemeComponent, key: "bg" | "fg", val: string) {
    setOverrides((prev) => ({ ...prev, [editMode]: { ...(prev[editMode] ?? {}), [comp]: { ...(prev[editMode]?.[comp] ?? {}), [key]: val } } }));
  }
  function clearOv(comp: ThemeComponent, key: "bg" | "fg") {
    setOverrides((prev) => {
      const forMode: ThemeOverrides = { ...(prev[editMode] ?? {}) };
      const entry: { bg?: string; fg?: string } = { ...(forMode[comp] ?? {}) };
      delete entry[key];
      if (entry.bg || entry.fg) forMode[comp] = entry; else delete forMode[comp];
      const next = { ...prev };
      if (Object.keys(forMode).length) next[editMode] = forMode; else delete next[editMode];
      return next;
    });
  }
  /** Reset THIS appearance back to fully automatic colors (leaves the other appearance untouched). */
  function resetModeToAuto() {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[editMode];
      return next;
    });
  }
  function autoBg(comp: ThemeComponent): string {
    const bg = generated[comp].bg;
    return HEX_COLOR.test(bg) ? bg : componentBgSolid({ ...input, overrides: {} }, editMode, comp);
  }

  function save() {
    if (!canSave) return;
    startTransition(async () => {
      const result = await updateColorThemeAction({ mode, primaryColor: primary, accentColor: accent, gradientFrom, gradientTo, overrides });
      if (result.error) toast.error(result.error);
      else {
        // Low contrast is allowed — say so plainly instead of blocking the save.
        toast.success(t(locale, failing.length ? "Theme saved with contrast warnings." : "Saved"));
        router.refresh(); // re-theme the whole app immediately, no reload needed
      }
    });
  }

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <h3 className="text-[17px] font-bold">{t(locale, "Color Theme")}</h3>
      <p className="text-[12.5px] text-ink-muted -mt-3">{t(locale, "Choose how your organization's brand colors are applied. Interface colors are calculated separately for light and dark mode so text stays readable in both.")}</p>

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
                <span className="absolute top-3 right-3 inline-flex size-5 items-center justify-center rounded-full bg-brand-orange text-[color:var(--primary-text)]">
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

      {/* Main brand colors (shared by both appearances; each mode adapts them for contrast) */}
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

      {/* Light + dark previews, always both visible */}
      <div className="grid sm:grid-cols-2 gap-3">
        <ModePreview locale={locale} input={input} appearance="light" lowContrast={lowByMode.light} />
        <ModePreview locale={locale} input={input} appearance="dark" lowContrast={lowByMode.dark} />
      </div>

      {/* Per-appearance component overrides */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[12.5px] font-semibold">{t(locale, "Component colors")}</p>
            <p className="text-[11px] text-ink-faint">{t(locale, "Generated automatically from your brand colors. Overrides apply only to the mode you are editing.")}</p>
          </div>
          <button type="button" onClick={resetModeToAuto} disabled={!Object.keys(modeOverrides).length}
            className="inline-flex items-center gap-1 text-[11.5px] text-ink-muted hover:text-brand-orange disabled:opacity-40 disabled:pointer-events-none">
            <RotateCcw className="size-3" /> {t(locale, "Reset to Automatic")}
          </button>
        </div>

        {/* Which appearance the overrides below belong to */}
        <div role="tablist" aria-label={t(locale, "Edit mode")} className="tab-row inline-flex gap-1 rounded-2xl p-1 bg-canvas w-fit">
          {APPEARANCES.map((ap) => (
            <button key={ap} type="button" role="tab" aria-selected={editMode === ap} onClick={() => setEditMode(ap)}
              className={`tab px-3 py-1.5 rounded-xl text-[12px] font-semibold ${editMode === ap ? "active" : "text-ink-muted"}`}>
              {t(locale, ap === "light" ? "Light mode" : "Dark mode")}
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {AUDITED_COMPONENTS.map((comp) => {
            // Sidebar active is painted from the Selected item tokens: it is audited and shown, but
            // has no controls of its own — editing Selected item is what changes it.
            const editable = comp !== "sidebarActive";
            const pair = auditedPair(input, editMode, comp);
            const rBg = pair.bg;
            const rFg = pair.fg;
            const here = componentContrast(input, editMode, comp);
            const fails = failuresFor(comp);
            const readable = here.passes;
            const ov = editable ? modeOverrides[comp as ThemeComponent] : undefined;
            return (
              <div key={comp} className="rounded-xl border border-line p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold">{t(locale, COMPONENT_LABELS[comp])}</span>
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex items-center justify-center rounded px-2 py-0.5 text-[11px] font-semibold" style={{ background: rBg, color: rFg }}>Aa</span>
                    <span className={`text-[10.5px] ${readable ? "text-success" : "text-warning"}`}>
                      {formatRatio(here.ratio)}
                    </span>
                  </span>
                </div>
                {editable ? (
                  <div className="grid grid-cols-2 gap-2">
                    <MiniColor locale={locale} label="Background" value={ov?.bg} auto={autoBg(comp as ThemeComponent)} overridden={Boolean(ov?.bg)} onChange={(v) => setOv(comp as ThemeComponent, "bg", v)} onAuto={() => clearOv(comp as ThemeComponent, "bg")} />
                    <MiniColor locale={locale} label="Font" value={ov?.fg} auto={generated[comp as ThemeComponent].fg} overridden={Boolean(ov?.fg)} onChange={(v) => setOv(comp as ThemeComponent, "fg", v)} onAuto={() => clearOv(comp as ThemeComponent, "fg")} />
                  </div>
                ) : (
                  <span className="text-[11px] text-ink-faint">{t(locale, "Follows the Selected item colors.")}</span>
                )}
                {fails.length > 0 && (
                  // Warning, not an error: it explains the measurement and offers a fix the user
                  // must click. Nothing here changes a colour on its own.
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-2 flex flex-col gap-1.5 text-[11px]">
                    <div className="flex items-start gap-1.5">
                      <AlertTriangle className="size-3.5 shrink-0 mt-px text-warning" />
                      <div className="flex flex-col gap-0.5">
                        <span className="text-warning-ink font-semibold">
                          {t(locale, "Low contrast in")} {t(locale, modeScopeLabel(fails))}: {formatRatio(Math.min(...fails.map((f) => f.ratio)))}
                        </span>
                        <span className="text-ink-muted">
                          {t(locale, "Recommended minimum:")} {formatRatio(here.required)}
                        </span>
                        {here.gradient && (
                          <span className="text-ink-faint">
                            {t(locale, "Lowest ratio across the gradient.")}
                          </span>
                        )}
                      </div>
                    </div>
                    {comp !== "sidebarActive" && (
                      <button type="button" className="self-start text-brand-orange underline"
                        onClick={() => setOv(comp as ThemeComponent, "fg", suggestReadableFg(componentBgSolid(input, editMode, comp as ThemeComponent), rFg))}>
                        {t(locale, "Use suggested text color")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={save} disabled={pending || !canSave}>
          {pending ? t(locale, "Saving…") : t(locale, "Save theme")}
        </Button>
        {failing.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-warning-ink">
            <AlertTriangle className="size-3.5 text-warning" />
            {t(locale, "Some colors are below the recommended contrast. You can still save.")}
          </span>
        )}
      </div>
    </div>
  );
}
