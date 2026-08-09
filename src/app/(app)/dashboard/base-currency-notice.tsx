"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Coins, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";
import { confirmBaseCurrencyAction } from "./actions";

/**
 * Shown once, only to orgs that predate the base-currency question and have posted nothing yet.
 * It blocks nothing: no overlay, no disabled controls, and the dashboard renders underneath it
 * whether or not it is dismissed. Dismissing is permanent — it stamps the org row, so it will not
 * come back on the next login or on another device.
 */
export function BaseCurrencyNotice({
  locale,
  currency,
  country,
}: {
  locale: Locale;
  currency: string;
  country: string | null;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (dismissed) return null;

  function dismiss() {
    startTransition(async () => {
      await confirmBaseCurrencyAction();
      setDismissed(true);
    });
  }

  return (
    <div
      data-base-currency-notice
      className="mb-5 flex items-start gap-3 rounded-[14px] border border-line-strong bg-surface-raised p-4"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-warning-bg text-warning">
        <Coins size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold">
          {t(locale, "Check your base currency")}
        </p>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          {t(locale, "Your organization was created before we asked for a base currency, so it was set to")}{" "}
          <strong className="font-semibold text-ink">{currency}</strong>
          {country ? ` (${country})` : ""}.{" "}
          {t(locale, "Every report and ledger entry is kept in this currency, and it cannot be changed once you post your first transaction. If it is wrong, change it now.")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link href="/settings/organization">{t(locale, "Review in Business Settings")}</Link>
          </Button>
          <Button variant="secondary" size="sm" onClick={dismiss} disabled={pending}>
            {pending ? t(locale, "Saving…") : t(locale, "{currency} is correct").replace("{currency}", currency)}
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        disabled={pending}
        aria-label={t(locale, "Dismiss")}
        className="shrink-0 rounded-md p-1 text-ink-faint hover:text-ink"
      >
        <X size={15} />
      </button>
    </div>
  );
}
