import type * as React from "react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/dict";
import { resolveStatus, statusLabel, type StatusDomain } from "@/lib/status-registry";

// The ONE way a status or state is shown (DEV-UI-01.2). A thin consumer of src/lib/status-registry:
// the registry owns the tone, the label (EN + AR) and whether the tag pulses — callers pass only
// WHAT is being shown (domain + raw value) and the locale. There is deliberately no `variant` or
// `live` prop: a page choosing its own colour or pulse is exactly the drift this replaces.
//
// No hooks, so it renders in server and client components alike. An unknown value never throws; it
// renders neutral with a readable label.
export function StatusBadge({
  domain,
  status,
  locale,
  className,
  icon,
  detail,
}: {
  domain: StatusDomain;
  status: string | null | undefined;
  locale: Locale;
  className?: string;
  /** Decorative leading icon (e.g. the ZATCA lock). Does not affect tone or label. */
  icon?: React.ReactNode;
  /** Extra plain text after the label, inside the tag (e.g. "(>7 days)"). */
  detail?: string;
}) {
  const s = resolveStatus(domain, status);
  return (
    <span
      className={cn("status-tag", className)}
      data-tone={s.tone}
      data-status={s.raw}
      data-status-domain={domain}
      data-status-known={s.known ? undefined : "false"}
    >
      {s.pulse && <span className="status-tag-pulse" aria-hidden="true" />}
      {icon}
      {statusLabel(locale, domain, status)}
      {detail ? ` ${detail}` : null}
    </span>
  );
}
