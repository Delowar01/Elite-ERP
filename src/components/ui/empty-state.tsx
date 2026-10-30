import * as React from "react";
import { cn } from "@/lib/utils";

/** Something to render: `false`, `""`, null and undefined (the results of `cond && …`) are nothing; 0 is something. */
const present = (n: React.ReactNode) => n !== undefined && n !== null && n !== false && n !== "";

/**
 * "Nothing here yet" (DEV-UI-01.7): a message, an optional hint and an optional action, centred on
 * the DEV-UI-01.5 list-card surface — 12px radius, line border, surface fill, no shadow — the
 * recipe the document lists' ListEmptyState uses, without its fixed create link.
 *
 * That is all it is. A table's "no rows match the filters" row (TableEmptyRow), loading
 * placeholders (skeletons) and error states are different situations and stay where they are.
 */
function EmptyState({
  message,
  hint,
  action,
  className,
}: {
  /** Text or inline content; it renders inside a <p>. */
  message: React.ReactNode;
  /** Text or inline content; it renders inside a <p>. */
  hint?: React.ReactNode;
  /** Usually one Button or Link; centred under the text. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="empty-state" className={cn("rounded-xl border border-line bg-surface py-12 px-6 text-center", className)}>
      <p className="text-body text-ink-muted">{message}</p>
      {present(hint) && <p className="mt-1.5 text-body-sm text-ink-faint">{hint}</p>}
      {present(action) && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export { EmptyState };
