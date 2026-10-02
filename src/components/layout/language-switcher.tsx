"use client";

import { useTransition } from "react";
import { setLocaleAction } from "@/lib/i18n/actions";
import { t, type Locale } from "@/lib/i18n/dict";

// EN | ع — both languages always visible and one tap away (D-01.3-E); no menu, no flags. Each option
// is labelled in its own language (and tagged with `lang`) so it is understandable whichever language
// is active. The cookie + server action are unchanged.
const OPTIONS: { locale: Locale; short: string; name: string }[] = [
  { locale: "en", short: "EN", name: "English" },
  { locale: "ar", short: "ع", name: "العربية" },
];

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="topbar-lang" role="group" aria-label={t(locale, "Language")}>
      {OPTIONS.map((o) => {
        const current = o.locale === locale;
        return (
          <button
            key={o.locale}
            type="button"
            lang={o.locale}
            className="topbar-lang-option"
            aria-pressed={current}
            aria-label={o.name}
            title={o.name}
            disabled={pending}
            onClick={() => {
              if (!current) startTransition(() => setLocaleAction(o.locale));
            }}
          >
            {o.short}
          </button>
        );
      })}
    </div>
  );
}
