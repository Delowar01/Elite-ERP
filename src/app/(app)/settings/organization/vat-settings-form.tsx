"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import { getProfileByCountryName } from "@/lib/geo/country-profiles";
import type { Org } from "@/db";
import { updateVatConfigAction } from "./actions";

// The single shared VAT Settings form + validation + save action. Used by Business Settings → VAT
// Configuration AND by the in-document "VAT Settings" pill popup, so there is exactly one form and one
// save path (updateVatConfigAction). Edits the org's VAT registration number (tax-number), the
// registration status, the default tax treatment, and the rounding rule.
//
// - onSaved  runs after a successful save (the popup closes + router.refresh()); when omitted, the
//            form stays put (Business Settings relies on revalidatePath).
// - onCancel runs when Cancel is pressed; when omitted, Cancel resets to the saved org values.
export function VatSettingsForm({
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
  const [vatStatus, setVatStatus] = useState(org.vatRegistrationStatus);
  const [vatNumber, setVatNumber] = useState(org.vatNumber ?? "");
  const [taxTreatment, setTaxTreatment] = useState(org.defaultTaxTreatment);
  const [rounding, setRounding] = useState(org.vatRounding);

  const profile = getProfileByCountryName(org.country);

  function reset() {
    setVatStatus(org.vatRegistrationStatus);
    setVatNumber(org.vatNumber ?? "");
    setTaxTreatment(org.defaultTaxTreatment);
    setRounding(org.vatRounding);
  }

  function cancel() {
    if (onCancel) onCancel();
    else reset();
  }

  function submit() {
    const formData = new FormData();
    formData.set("vatRegistrationStatus", vatStatus);
    formData.set("vatNumber", vatNumber);
    formData.set("defaultTaxTreatment", taxTreatment);
    formData.set("vatRounding", rounding);
    startTransition(async () => {
      const result = await updateVatConfigAction(formData);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t(locale, "Saved"));
      onSaved?.();
    });
  }

  return (
    <div className="flex flex-col gap-4 max-w-lg">
      {heading && <h3 className="text-[17px] font-bold">{t(locale, "VAT Configuration")}</h3>}
      <p className="text-[12.5px] text-ink-muted -mt-1">
        {t(locale, "Default VAT Rate")}: <span className="font-semibold">{profile.defaultTaxRate}%</span> · {t(locale, "from your country profile")} ({profile.countryName})
      </p>
      <div className="grid grid-cols-1 gap-4">
        <FormField label={t(locale, "Registration Status")} htmlFor="vat-status">
          <Select value={vatStatus} onValueChange={setVatStatus}>
            <SelectTrigger id="vat-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="registered">{t(locale, "Registered")}</SelectItem>
              <SelectItem value="not_registered">{t(locale, "Not Registered")}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField label={t(locale, "VAT Number")} htmlFor="vat-number">
          <Input id="vat-number" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} placeholder={t(locale, "Tax registration number")} maxLength={40} />
        </FormField>
        <FormField label={t(locale, "Default Tax Treatment")} htmlFor="tax-treatment">
          <Select value={taxTreatment} onValueChange={setTaxTreatment}>
            <SelectTrigger id="tax-treatment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exclusive">{t(locale, "Exclusive of VAT")}</SelectItem>
              <SelectItem value="inclusive">{t(locale, "Inclusive of VAT")}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        {/* The Rounding Rule control is deliberately not rendered.
            Its two options were "Round to nearest 0.01 (Halala)" and "Round to nearest 1" — a
            Saudi-shaped choice that is simply wrong for a 3-decimal currency, where the nearest
            minor unit is 0.001, not 0.01. Nothing in the app has ever READ `vatRounding` (grep:
            it is written here and stored, never consulted by any calculation), so hiding the
            control changes no behaviour at all.
            The column, the state below and the `formData.set("vatRounding", …)` write are all kept
            intact so an existing org's stored value round-trips unchanged rather than silently
            resetting on the next save. When rounding rules are designed properly they will be
            expressed in minor units of the document's own currency. */}
      </div>
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
