"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { t, type Locale } from "@/lib/i18n/dict";
import { getConvertTargets, runConvertTarget, type ConvertSource, type ConvertCtx, type ConvertTarget } from "../sales/_shared/convert-config";
import { useConfirm } from "./confirm-provider";
import { withRateRescue, type RescuableResult } from "./missing-rate";

/**
 * Confirmation wrappers around flows that already have one shared implementation, so the popup is
 * added once rather than per module. Converting a document is the case that matters most here: it
 * is offered from the list three-dot menu AND from the Preview's "Convert to…" menu, and both must
 * warn identically before creating a new document.
 */
export function useConvertConfirm(locale: Locale) {
  const confirm = useConfirm();
  const [, startTransition] = useTransition();

  /** `sourceTypeLabel`/`number` name the document being converted, e.g. "Quotation QTN-000123". */
  function requestConvert(target: ConvertTarget, id: number, sourceTypeLabel: string, number: string) {
    confirm({
      action: "document.convert",
      entityType: sourceTypeLabel,
      entityNumber: number,
      description: "A new document will be created from this one. The original stays as it is.",
      details: [{ label: "Creates", value: t(locale, target.labelKey) }],
      // href targets navigate to a prefilled create page; action targets redirect on success.
      navigatesOnSuccess: true,
      onConfirm: () => {
        // Recursive on purpose: a conversion that posts (proforma with advances) can be blocked by
        // a missing rate, which maps to "Fetch rate & retry" re-running this same attempt — the
        // identical seam as the posting paths.
        const attempt = (): Promise<RescuableResult> =>
          new Promise((resolve) => {
            runConvertTarget(target, id, startTransition, (result) => resolve(withRateRescue(locale, result, attempt)));
            // Successful conversions redirect, so nothing resolves on the happy path — the dialog
            // stays in its working state until the new page takes over.
          });
        return attempt();
      },
    });
  }

  return { requestConvert, getConvertTargets };
}

export type { ConvertSource, ConvertCtx };

/** Toast helper shared by the confirmed flows above, kept here so call sites stay one-liners. */
export function toastSaved(locale: Locale) {
  toast.success(t(locale, "Saved"));
}
