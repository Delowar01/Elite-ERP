import * as React from "react";
import { cn } from "@/lib/utils";

/** Something to render: `false`, `""`, null and undefined (the results of `cond && …`) are nothing; 0 is something. */
const present = (n: React.ReactNode) => n !== undefined && n !== null && n !== false && n !== "";

/**
 * A page's header (DEV-UI-01.7 C1, decision D-9: evolved in place): the page's one <h1>, with an
 * optional description under it and optional meta and actions beside it.
 *
 * Only the title is inside the <h1>. The description, the meta (non-interactive status: badges, a
 * record state) and the actions (the page's buttons and record menu) sit outside it, meta first, so a
 * screen reader's list of headings reads just the title.
 *
 * The row is flex with gaps only — no left / right, no fixed width, nothing positioned — so it
 * mirrors under dir="rtl" by itself. A long title wraps inside its own column; when the row runs out
 * of width, the meta and actions wrap below the title instead of pushing the page wider than the
 * viewport. It knows nothing of the page it heads: no router, pathname, session or domain.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  className,
}: {
  title: React.ReactNode;
  /** Text or inline content; it renders inside a <p>. */
  description?: React.ReactNode;
  /** Non-interactive status (badges); rendered before the actions. */
  meta?: React.ReactNode;
  /** Interactive page / record actions. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="page-header" className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-6", className)}>
      <div className="min-w-0">
        <h1 className="text-page font-semibold break-words">{title}</h1>
        {present(description) && <p className="mt-1 text-body-lg text-ink-muted">{description}</p>}
      </div>
      {(present(meta) || present(actions)) && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {present(meta) && <div data-slot="page-header-meta" className="flex flex-wrap items-center gap-2">{meta}</div>}
          {present(actions) && <div data-slot="page-header-actions" className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
    </div>
  );
}
