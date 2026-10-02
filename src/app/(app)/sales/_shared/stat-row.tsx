import type { StatusDomain, StatusTone } from "@/lib/status-registry";

type StatItem = {
  label: string;
  value: string;
  colorClass?: string;
  // Set by statusStat() for a status count: label and tone came from the status registry.
  tone?: StatusTone;
  status?: string;
  statusDomain?: StatusDomain;
};

// Matches the mockup's list_stat_row() exactly: <div class="stat-row-2">
// <div class="card" style="padding:16px 18px;"><div class="kpi-label">...</div><div class="kpi-value">...</div></div>
export function StatRow({ items }: { items: StatItem[] }) {
  return (
    <div className="stat-row-2">
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
