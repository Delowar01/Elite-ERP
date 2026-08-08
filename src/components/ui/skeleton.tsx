"use client";

import { useEffect, useState } from "react";

/**
 * Loading placeholders.
 *
 * Two rules, applied identically here and in the reports workspace so a tab switch and a list load
 * feel like the same system:
 *
 *  1. SHAPE — a skeleton stands in for a specific table, so it takes that table's real column count
 *     and row height. A generic three-bar block under a nine-column list flashes and then reflows
 *     into something structurally different, which reads worse than showing nothing.
 *
 *  2. DELAY — nothing paints for the first {DELAY_MS}. Most responses land inside that window, so
 *     the common case never sees a placeholder at all.
 *
 * On the delay vs. minimum-hold question: a route-level Next.js `loading.tsx` cannot hold. React
 * unmounts the fallback the moment the payload arrives, and nothing inside the fallback can veto
 * that. A minimum visible duration is only achievable where we own the pending state (the reports
 * workspace). Rather than run two different rules, both use delay-only — see DELAY_MS for why the
 * threshold is where it is.
 */

/**
 * Chosen against the measured route timings rather than by feel: locally the slowest list settles
 * around 300–400ms and most land under 150ms, so this threshold keeps the placeholder off screen
 * for the common case while still covering the genuinely slow ones. The residual case — a response
 * arriving just after the threshold, painting briefly — is the accepted cost of not being able to
 * hold at route level.
 */
export const DELAY_MS = 150;

/** A single shimmering bar. Sized by the caller; colour comes from the theme so dark mode follows. */
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`rounded-lg ${className}`} style={{ background: "var(--line)", ...style }} />;
}

/** Renders nothing until DELAY_MS has passed, so a fast response never paints a placeholder. */
export function Delayed({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShow(true), DELAY_MS);
    return () => clearTimeout(id);
  }, []);
  if (!show) return null;
  return <>{children}</>;
}

/**
 * A stand-in for one specific table. `columns` must match the real table's column count — that is
 * the whole point of the component, and the verification asserts it per list.
 */
export function TableSkeleton({
  columns,
  rows = 6,
  statCards = 0,
  toolbar = true,
}: {
  columns: number;
  rows?: number;
  /** Number of cards in the list's stat row, when it has one. */
  statCards?: number;
  /** Whether the list has a search/actions toolbar above the table. */
  toolbar?: boolean;
}) {
  return (
    <Delayed>
      <div className="animate-pulse" aria-busy="true" aria-label="Loading" role="status">
        <Skeleton className="h-7 w-56 mb-6" />

        {statCards > 0 && (
          <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: `repeat(${statCards}, minmax(0, 1fr))` }}>
            {Array.from({ length: statCards }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        )}

        {toolbar && (
          <div className="flex items-center gap-3 mb-4">
            <Skeleton className="h-[42px] w-[260px] rounded-[10px]" />
            <div className="ms-auto flex gap-2">
              <Skeleton className="h-[42px] w-24 rounded-[10px]" />
              <Skeleton className="h-[42px] w-32 rounded-[10px]" />
            </div>
          </div>
        )}

        {/* The table itself: real column count, real row height (52px matches .data-table rows).
            data-skeleton-table marks the grid whose column count must equal the real table's —
            the stat row above is also a grid, so the verification needs to name this one exactly. */}
        <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--line)" }}>
          <div
            data-skeleton-table={columns}
            className="grid gap-4 px-4 py-3"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, background: "var(--surface-raised)" }}
          >
            {Array.from({ length: columns }, (_, i) => (
              <Skeleton key={i} className="h-3.5" />
            ))}
          </div>
          {Array.from({ length: rows }, (_, r) => (
            <div
              key={r}
              className="grid gap-4 px-4 items-center"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, height: 52, borderTop: "1px solid var(--line)" }}
            >
              {Array.from({ length: columns }, (_, c) => (
                <Skeleton key={c} className="h-3.5" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Delayed>
  );
}

/** A stand-in for a block of report/statement body content, used inside the reports workspace. */
export function ReportBodySkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <Delayed>
      <div className="animate-pulse" aria-busy="true" aria-label="Loading" role="status">
        <Skeleton className="h-5 w-64 mb-5" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 py-2.5" style={{ borderTop: i ? "1px solid var(--line)" : undefined }}>
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        ))}
      </div>
    </Delayed>
  );
}
