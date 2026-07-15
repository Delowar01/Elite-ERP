// Matches the mockup's list_stat_row() exactly: <div class="stat-row-2">
// <div class="card" style="padding:16px 18px;"><div class="kpi-label">...</div><div class="kpi-value">...</div></div>
export function StatRow({ items }: { items: { label: string; value: string; colorClass?: string }[] }) {
  return (
    <div className="stat-row-2">
      {items.map((it) => (
        <div key={it.label} className="card" style={{ padding: "16px 18px" }}>
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
