"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Org } from "@/db";
import { NumberFormatForm } from "../../settings/organization/number-format-form";

// In-document Number Format popup. Clicking the "Number Format" config pill on any document
// create/edit page opens the FULL Number Format form right here — no redirect to Business Settings,
// no second page. It reuses the exact shared form + validation + save action. On save it closes and
// refreshes the current route (server components re-run → the currency mark in context updates), so
// every displayed amount reformats immediately while the client-side form state (item lines and all
// other unsaved fields) is preserved by React. Validation errors keep the popup open.
export function NumberFormatPillDialog({ locale, org, trigger }: { locale: Locale; org: Org; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg w-[92vw] max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{t(locale, "Number Format")}</DialogTitle>
        </DialogHeader>
        <NumberFormatForm
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
