export function StatRow({ items }: { items: { label: string; value: string; colorClass?: string }[] }) {
  return (
    <div className="grid grid-cols-4 gap-3 mb-[18px]">
      {items.map((it) => (
        <div key={it.label} className="rounded-2xl border border-line bg-surface shadow-elevated px-[18px] py-4">
          <div className="text-[11.5px] text-ink-muted capitalize">{it.label}</div>
          <div className={`font-display font-extrabold text-[20px] mt-1 ${it.colorClass ?? "text-ink"}`}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}
