"use client";

import { type Locale } from "@/lib/i18n/dict";
import type { Org } from "@/db";
import { NumberFormatForm } from "./number-format-form";

// Business Settings → Number Format. Thin wrapper around the shared NumberFormatForm (the same form
// used by the in-document Number Format pill popup), so there is a single source of settings logic.
export function NumberFormatPanel({ locale, org }: { locale: Locale; org: Org }) {
  return (
    <div className="max-w-xl">
      <NumberFormatForm locale={locale} org={org} heading />
    </div>
  );
}
