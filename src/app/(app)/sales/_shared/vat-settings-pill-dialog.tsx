"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Org } from "@/db";
import { VatSettingsForm } from "../../settings/organization/vat-settings-form";

// In-document VAT Settings popup. Clicking the "VAT Settings" config pill on any document
// create/edit page opens the FULL VAT form right here — no redirect to Business Settings. It reuses
// the exact shared form + validation + save action (updateVatConfigAction). On save it closes and
// refreshes the current route (server components re-run so the document reflects the new VAT
// settings immediately) while the client-side form state — line items and every other unsaved field
// — is preserved by React. Validation/permission errors keep the popup open.
export function VatSettingsPillDialog({ locale, org, trigger }: { locale: Locale; org: Org; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg w-[92vw] max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{t(locale, "VAT Settings")}</DialogTitle>
        </DialogHeader>
        <VatSettingsForm
          locale={locale}
          org={org}
          heading={false}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
