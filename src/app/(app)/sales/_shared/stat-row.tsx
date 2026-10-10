import type { StatusDomain, StatusTone } from "@/lib/status-registry";

type StatItem = {
  label: string;
  /** Text, or a node such as <Money> (DEV-UI-01.7). */
  value: React.ReactNode;
  colorClass?: string;
  // Set by statusStat() for a status count: label and tone came from the status registry.
  tone?: StatusTone;
  status?: string;
  statusDomain?: StatusDomain;
};

// Matches the mockup's list_stat_row() exactly: <div class="stat-row-2">
// <div class="card" style="padding:16px 18px;"><div class="kpi-label">...</div><div class="kpi-value">...</div></div>
// `columns` (DEV-UI-01.7) fixes the column count for a row that is not the default four. Left out,
// the row is exactly what it always was: the .stat-row-2 grid, with no extra attribute or style.
export function StatRow({ items, columns }: { items: StatItem[]; columns?: 2 | 3 | 4 }) {
  // Only 2, 3 or 4; anything else an untyped caller passes falls back to the default row.
  const cols = columns === 2 || columns === 3 || columns === 4 ? columns : undefined;
  return (
    <div className="stat-row-2" data-columns={cols} style={cols ? { gridTemplateColumns: `repeat(${cols}, 1fr)` } : undefined}>
      {items.map((it) => (
        <div
          key={it.label}
          className="card"
          style={{ padding: "16px 18px" }}
          data-status-domain={it.statusDomain}
          data-status={it.status}
          data-tone={it.tone}
        >
          <div className="kpi-label" style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>
            {it.label}
          </div>
          <div className={`kpi-value ${it.colorClass ?? ""}`} style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4 }}>
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}
