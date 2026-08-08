"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VendorForm } from "@/app/(app)/purchasing/vendors/vendor-form";
import { createVendorInlineAction } from "@/app/(app)/purchasing/vendors/actions";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Vendor } from "@/db";

// In-document "Add New Vendor" popup — the vendor-side twin of ClientCreateDialog, deliberately the
// same shape. Reuses the exact same shared VendorForm, fields, validation and (via
// createVendorInlineAction) the same server insert as the full Create Vendor page — no reduced
// quick-create form. On success the created vendor is returned to the caller for auto-selection; the
// document page never reloads, so unsaved document data is preserved. Confirms before discarding
// unsaved vendor input.
export function VendorCreateDialog({
  locale,
  open,
  onOpenChange,
  onCreated,
  taxNumberLabel,
  registrationLabel,
}: {
  locale: Locale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (vendor: Vendor) => void;
  // Tax/registration labels follow the org's country profile, same as the full Vendors page.
  taxNumberLabel?: string;
  registrationLabel?: string;
}) {
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function close() {
    setConfirming(false);
    setDirty(false);
    onOpenChange(false);
  }
  // Intercept X / Escape / outside-click / Cancel: confirm first when there is unsaved vendor input.
  // Only this dialog's own dirty state is consulted — the parent document's unsaved changes are a
  // separate tracker and must not be disturbed by discarding a half-typed vendor.
  function requestClose() {
    if (dirty) setConfirming(true);
    else close();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) onOpenChange(true); else requestClose(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(locale, "New Vendor")}</DialogTitle>
          <DialogDescription>{t(locale, "Add a vendor to raise purchase orders against.")}</DialogDescription>
        </DialogHeader>

        <VendorForm
          inDialog
          action={createVendorInlineAction}
          submitLabel={t(locale, "Save Vendor")}
          taxNumberLabel={taxNumberLabel}
          registrationLabel={registrationLabel}
          onDirty={() => setDirty(true)}
          onCancel={requestClose}
          onSuccess={(vendor) => {
            toast.success(t(locale, "Vendor created"));
            setDirty(false);
            onCreated(vendor);
            onOpenChange(false);
          }}
        />

        {confirming && (
          <div className="sticky bottom-0 -mx-6 -mb-6 mt-2 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface px-6 py-3">
            <span className="mr-auto text-[12.5px] text-ink-muted">{t(locale, "Discard unsaved vendor details?")}</span>
            <button type="button" className="btn btn-glass" style={{ width: "auto", padding: "0 16px" }} onClick={() => setConfirming(false)}>
              {t(locale, "Keep editing")}
            </button>
            <button type="button" className="btn" style={{ width: "auto", padding: "0 16px", background: "var(--danger)", color: "#fff" }} onClick={close}>
              {t(locale, "Discard")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
