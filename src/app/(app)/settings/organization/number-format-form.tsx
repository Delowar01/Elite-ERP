"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { CurrencyMark } from "@/components/ui/currency-mark";
import { buildMoneyMark, formatAmount, formatRate, formatQuantity, markFormat } from "@/lib/currency/currencies";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Org } from "@/db";
import { updateNumberFormatAction } from "./actions";

// The single shared Number Format form + validation. Used by Business Settings → Number Format AND
// by the in-document "Number Format" pill popup, so there is exactly one form and one save path
// (updateNumberFormatAction). Configures document DISPLAY only — grouping, decimals, optional
// rounding of quantities/rates, and an optional custom symbol — never stored accounting values.
//
// - onSaved   runs after a successful save (e.g. close the popup + router.refresh()); when omitted,
//             the form stays put (Business Settings relies on revalidatePath).
// - onCancel  runs when Cancel is pressed; when omitted, Cancel resets the fields to the saved org.
export function NumberFormatForm({
  locale,
  org,
  onSaved,
  onCancel,
  heading = true,
}: {
  locale: Locale;
  org: Org;
  onSaved?: () => void;
  onCancel?: () => void;
  heading?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [digitGrouping, setDigitGrouping] = useState(org.numberDigitGrouping === "indian" ? "indian" : "international");
  const [decimalPlaces, setDecimalPlaces] = useState(String(org.numberDecimalPlaces));
  const [roundQuantities, setRoundQuantities] = useState(org.roundQuantities);
  const [roundRates, setRoundRates] = useState(org.roundRates);
  const [customSymbol, setCustomSymbol] = useState(org.customCurrencySymbol ?? "");
  const [error, setError] = useState<string | null>(null);

  // A live mark built from the CURRENT (unsaved) selections, so the preview reflects edits instantly.
  const previewMark = buildMoneyMark({
    currencyCode: org.currency,
    customCurrencySymbol: customSymbol,
    digitGrouping,
    decimalPlaces: Number(decimalPlaces),
    roundQuantities,
    roundRates,
  });
  const cfg = markFormat(previewMark);
  const sym = <CurrencyMark mark={previewMark} />;

  function reset() {
    setDigitGrouping(org.numberDigitGrouping === "indian" ? "indian" : "international");
    setDecimalPlaces(String(org.numberDecimalPlaces));
    setRoundQuantities(org.roundQuantities);
    setRoundRates(org.roundRates);
    setCustomSymbol(org.customCurrencySymbol ?? "");
    setError(null);
  }

  function cancel() {
    if (onCancel) onCancel();
    else reset();
  }

  function submit() {
    const fd = new FormData();
    fd.set("numberDigitGrouping", digitGrouping);
    fd.set("numberDecimalPlaces", decimalPlaces);
    fd.set("roundQuantities", roundQuantities ? "1" : "0");
    fd.set("roundRates", roundRates ? "1" : "0");
    fd.set("customCurrencySymbol", customSymbol);
    setError(null);
    startTransition(async () => {
      const result = await updateNumberFormatAction(fd);
      if (result.error) {
        // Validation failed — keep the form open, surface the error, keep the entered settings.
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(t(locale, "Saved"));
      onSaved?.();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {heading && (
        <div>
          <h3 className="text-[17px] font-bold">{t(locale, "Number Format")}</h3>
          <p className="text-[12px] text-ink-muted mt-1">
            {t(locale, "Controls how numbers appear on documents. This never changes stored accounting values or recalculates past transactions.")}
          </p>
        </div>
      )}

      {/* Live preview */}
      <div className="rounded-[12px] border border-line bg-canvas p-4">
        <div className="text-[10.5px] uppercase tracking-wide text-ink-faint mb-2">{t(locale, "Live Preview")}</div>
        <div className="flex flex-col gap-1.5 text-[13px]">
          <div className="flex justify-between gap-4">
            <span className="text-ink-muted">{t(locale, "Amount")}</span>
            <span className="font-mono font-semibold">{sym} {formatAmount(12345679.5, cfg)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-ink-muted">{t(locale, "Rate")}</span>
            <span className="font-mono">{sym} {formatRate(1234.567, cfg)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-ink-muted">{t(locale, "Qty")}</span>
            <span className="font-mono">{formatQuantity(12.5, cfg)}</span>
          </div>
        </div>
      </div>

      <FormField label={t(locale, "Digit Grouping")} htmlFor="nf-grouping">
        <Select value={digitGrouping} onValueChange={setDigitGrouping}>
          <SelectTrigger id="nf-grouping">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="international">{t(locale, "International")} (12,345,679)</SelectItem>
            <SelectItem value="indian">{t(locale, "Indian")} (1,23,45,679)</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <FormField label={t(locale, "Decimal Places")} htmlFor="nf-decimals">
        <Select value={decimalPlaces} onValueChange={setDecimalPlaces}>
          <SelectTrigger id="nf-decimals">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["0", "1", "2", "3"].map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2.5 cursor-pointer">
          <Checkbox checked={roundQuantities} onCheckedChange={(v) => setRoundQuantities(v === true)} />
          <span className="text-[13px]">{t(locale, "Round quantities to whole numbers")}</span>
        </label>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <Checkbox checked={roundRates} onCheckedChange={(v) => setRoundRates(v === true)} />
          <span className="text-[13px]">{t(locale, "Round rates to whole numbers")}</span>
        </label>
      </div>

      <FormField label={t(locale, "Custom Currency Symbol")} htmlFor="nf-symbol">
        <Input
          id="nf-symbol"
          value={customSymbol}
          onChange={(e) => setCustomSymbol(e.target.value)}
          placeholder={t(locale, "Leave empty to use the official symbol")}
          maxLength={8}
        />
        <p className="text-[11px] text-ink-faint mt-1">
          {t(locale, "When set, this symbol is shown instead of the official currency symbol. Leave empty to keep the official symbol (or the currency code when none exists).")}
        </p>
      </FormField>

      {error && (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? t(locale, "Saving…") : t(locale, "Save Changes")}
        </Button>
        <Button type="button" variant="glass" onClick={cancel} disabled={pending}>
          {t(locale, "Cancel")}
        </Button>
      </div>
    </div>
  );
}
