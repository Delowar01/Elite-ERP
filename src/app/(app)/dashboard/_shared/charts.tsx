// Ports the mockup's own sparkline()/donut()/combo_chart() SVG-path generators
// (build_mockup_v12.py) as small dependency-free React components — same math,
// no charting library. The mockup's load-time stroke-draw-in animation
// (.chart-draw/.donut-draw keyframes) is not ported; these render statically.

export function Sparkline({ values, color, w = 180, h = 48 }: { values: number[]; color: string; w?: number; h?: number }) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const n = values.length;
  const pts = values.map((v, i) => [(i * w) / (n - 1), h - ((v - lo) / span) * (h - 6) - 3] as const);
  const line = pts.map(([x, y]) => `${x},${y}`).join(" L ");
  const area = `M 0,${h} L ${pts.map(([x, y]) => `${x},${y}`).join(" L ")} L ${w},${h} Z`;
  const gid = `spark-${color.replace(/[^a-zA-Z0-9]/g, "")}-${Math.round(values.reduce((a, b) => a + b, 0))}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={`M ${line}`} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Donut({
  segments,
  size = 150,
  thickness = 16,
  centerLabel,
  centerValue,
}: {
  segments: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments.map((s, i) => {
    const frac = s.value / total;
    const dash = circumference * frac;
    const el = (
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={s.color}
        strokeWidth={thickness}
        strokeDasharray={`${dash.toFixed(1)} ${circumference.toFixed(1)}`}
        strokeDashoffset={(-offset).toFixed(1)}
        transform={`rotate(-90 ${cx} ${cy})`}
        strokeLinecap="butt"
      />
    );
    offset += dash;
    return el;
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {arcs}
      {centerLabel && (
        <>
          <text x={cx} y={cy - 4} textAnchor="middle" fontFamily="IBM Plex Sans" fontSize="10.5" fill="var(--ink-faint)">
            {centerLabel}
          </text>
          <text x={cx} y={cy + 16} textAnchor="middle" fontFamily="Plus Jakarta Sans" fontWeight="800" fontSize="18" fill="var(--ink)">
            {centerValue}
          </text>
        </>
      )}
    </svg>
  );
}

export function ComboChart({
  revenue,
  expenses,
  labels,
  w = 620,
  h = 230,
}: {
  revenue: number[];
  expenses: number[];
  labels: string[];
  w?: number;
  h?: number;
}) {
  const n = revenue.length;
  const padL = 22;
  const padB = 24;
  const plotW = w - padL * 2;
  const plotH = h - padB;
  const hi = Math.max(...revenue, ...expenses) * 1.15 || 1;
  const step = plotW / (n - 1);
  const y = (v: number) => plotH - (v / hi) * (plotH - 10);
  const revPts = revenue.map((v, i) => [padL + i * step, y(v)] as const);
  const expPts = expenses.map((v, i) => [padL + i * step, y(v)] as const);
  const barW = step * 0.42;
  const revLine = revPts.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(" L ");
  const expLine = expPts.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(" L ");
  const gridYs = [plotH * 0.02, plotH * 0.26, plotH * 0.5, plotH * 0.74, plotH * 0.98];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand-orange)" stopOpacity="0.30" />
          <stop offset="100%" stopColor="var(--brand-orange)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <g>
        {gridYs.map((gy, i) => (
          <line key={i} x1={0} y1={gy} x2={w} y2={gy} stroke="var(--line)" strokeWidth={1} />
        ))}
        {revPts.map(([x, yy], i) => (
          <rect key={i} x={x - barW / 2} y={yy} width={barW} height={plotH - yy} rx={4} fill="url(#barGrad)" />
        ))}
      </g>
      <path d={`M ${expLine}`} fill="none" stroke="var(--chart-navy)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d={`M ${revLine}`} fill="none" stroke="var(--brand-orange)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {expPts.map(([x, yy], i) => (
        <circle key={`e${i}`} cx={x} cy={yy} r={3} fill="var(--chart-navy)" />
      ))}
      {revPts.map(([x, yy], i) => (
        <circle key={`r${i}`} cx={x} cy={yy} r={3.2} fill="var(--brand-orange)" />
      ))}
      {labels.map((lbl, i) => (
        <text key={i} x={padL + i * step} y={h - 6} fontFamily="IBM Plex Mono" fontSize={10} fill="var(--ink-faint)" textAnchor="middle">
          {lbl}
        </text>
      ))}
    </svg>
  );
}
