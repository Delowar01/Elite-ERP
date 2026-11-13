"use client";

import { useEffect, useSyncExternalStore } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pt } from "@/components/platform/i18n";

// Console error boundary (PO-01B): a localized message and a retry. The language comes from the
// document itself (<html lang>, set by the root layout), so it needs no server context. Internal
// error detail is never shown; only a console trace with the digest is kept.
const noop = () => () => {};

export default function PlatformConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = useSyncExternalStore(noop, () => (document.documentElement.lang === "ar" ? "ar" : "en"), () => "en" as const);
  useEffect(() => {
    console.error("[platform-console] render error", error.digest ?? "");
  }, [error]);

  return (
    <div className="platform-page">
      <div className="platform-empty platform-error" role="alert">
        <span className="platform-empty-icon" data-tone="danger" aria-hidden>
          <TriangleAlert className="size-5" />
        </span>
        <h1 className="platform-empty-title">{pt(locale, "state.errorTitle")}</h1>
        <p className="platform-empty-hint">{pt(locale, "state.errorText")}</p>
        <div className="platform-empty-action">
          <Button type="button" onClick={reset}>
            <RefreshCw aria-hidden />
            {pt(locale, "state.retry")}
          </Button>
        </div>
      </div>
    </div>
  );
}
