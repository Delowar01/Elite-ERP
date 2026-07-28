"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ClientForm } from "@/app/(app)/clients/client-form";
import { createClientInlineAction } from "@/app/(app)/clients/actions";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Customer } from "@/db";

// In-document "Add New Client" popup. Reuses the exact same shared ClientForm, fields, validation and
// (via createClientInlineAction) the same server insert as the full Create Client page — no reduced
// quick-create form. On success the created client is returned to the caller for auto-selection; the
// document page never reloads, so unsaved document data is preserved. Confirms before discarding
// unsaved client input.
export function ClientCreateDialog({
  locale,
  open,
  onOpenChange,
  onCreated,
  defaultCountryCode = "",
  taxOverrides,
}: {
  locale: Locale;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (client: Customer) => void;
  // Org country — default country for the new client. The form's fields/labels/validation then follow
  // whatever client country is selected.
  defaultCountryCode?: string;
  // Org's configured generic tax terminology, applied only to Global-profile clients.
  taxOverrides?: { customTaxName?: string | null; customTaxNumberLabel?: string | null; customRegistrationLabel?: string | null };
}) {
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function close() {
    setConfirming(false);
    setDirty(false);
    onOpenChange(false);
  }
  // Intercept X / Escape / outside-click / Cancel: confirm first when there is unsaved client input.
  function requestClose() {
    if (dirty) setConfirming(true);
    else close();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) onOpenChange(true); else requestClose(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(locale, "New Client")}</DialogTitle>
          <DialogDescription>{t(locale, "Add a client to bill and quote against.")}</DialogDescription>
        </DialogHeader>

        <ClientForm
          inDialog
          locale={locale}
          action={createClientInlineAction}
          submitLabel="Save Client"
          defaultCountryCode={defaultCountryCode}
          taxOverrides={taxOverrides}
          onDirty={() => setDirty(true)}
          onCancel={requestClose}
          onSuccess={(client) => {
            toast.success(t(locale, "Client created"));
            setDirty(false);
            onCreated(client);
            onOpenChange(false);
          }}
        />

        {confirming && (
          <div className="sticky bottom-0 -mx-6 -mb-6 mt-2 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-surface px-6 py-3">
            <span className="mr-auto text-[12.5px] text-ink-muted">{t(locale, "Discard unsaved client details?")}</span>
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
