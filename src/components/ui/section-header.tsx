import * as React from "react";
import { cn } from "@/lib/utils";

/** Something to render: `false`, `""`, null and undefined (the results of `cond && …`) are nothing; 0 is something. */
const present = (n: React.ReactNode) => n !== undefined && n !== null && n !== false && n !== "";

/**
 * A section's heading row (DEV-UI-01.7): the heading, with an optional description under it and
 * optional meta and actions beside it.
 *
 * Only the title is a heading. `level` gives a real <h2> (the default) or <h3> — never the page's
 * <h1>, never a styled div — and `id` goes on that heading, so the caller's <section> can name
 * itself with aria-labelledby. Description, meta and actions sit outside the heading, so a screen
 * reader's list of headings reads just the titles.
 *
 * It owns nothing around it: whether there is a <section>, a card, a landmark or a collapse toggle
 * is the caller's choice. The row is flex with gaps only — no left/right — so it mirrors under
 * dir="rtl" by itself, and when it runs out of width the meta and actions wrap below the title.
 */
function SectionHeader({
  title,
  level = 2,
  id,
  description,
  meta,
  actions,
  className,
}: {
  title: React.ReactNode;
  level?: 2 | 3;
  /** Set on the heading element itself. */
  id?: string;
  /** Text or inline content; it renders inside a <p>. */
  description?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <div data-slot="section-header" className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0 grow">
        <Heading id={id} className={level === 3 ? "text-body-lg font-semibold text-ink" : "text-title-sm font-semibold text-ink"}>
          {title}
        </Heading>
        {present(description) && <p className="mt-0.5 text-body-sm text-ink-muted">{description}</p>}
      </div>
      {(present(meta) || present(actions)) && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {present(meta) && <div className="text-body-sm text-ink-muted">{meta}</div>}
          {present(actions) && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
    </div>
  );
}

export { SectionHeader };
