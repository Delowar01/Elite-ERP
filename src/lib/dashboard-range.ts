// Batch E — dashboard date-range filtering. Resolves a range key into concrete start/end dates
// (YYYY-MM-DD, matching the date columns) plus the immediately-preceding equal-length window so
// KPIs can show a period-over-period trend. Pure + framework-free so both server queries and the
// client toolbar can import it.

export const DASHBOARD_RANGES = [
  "this_month",
  "last_month",
  "last_7_days",
  "last_30_days",
  "this_quarter",
  "this_year",
  "all_time",
] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const RANGE_LABELS: Record<DashboardRange, string> = {
  this_month: "This Month",
  last_month: "Last Month",
  last_7_days: "Last 7 Days",
  last_30_days: "Last 30 Days",
  this_quarter: "This Quarter",
  this_year: "This Year",
  all_time: "All Time",
};

export function isDashboardRange(v: string | undefined | null): v is DashboardRange {
  return !!v && (DASHBOARD_RANGES as readonly string[]).includes(v);
}

const fmt = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export type ResolvedRange = {
  key: DashboardRange;
  labelKey: string;
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
  /** Chart bucket granularity for the selected window. */
  granularity: "day" | "month";
};

export function resolveRange(key: DashboardRange, now = new Date()): ResolvedRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  let start: Date;
  let end: Date;

  switch (key) {
    case "this_month":
      start = new Date(y, m, 1);
      end = new Date(y, m + 1, 0);
      break;
    case "last_month":
      start = new Date(y, m - 1, 1);
      end = new Date(y, m, 0);
      break;
    case "last_7_days":
      end = new Date(y, m, now.getDate());
      start = addDays(end, -6);
      break;
    case "last_30_days":
      end = new Date(y, m, now.getDate());
      start = addDays(end, -29);
      break;
    case "this_quarter": {
      const q = Math.floor(m / 3);
      start = new Date(y, q * 3, 1);
      end = new Date(y, q * 3 + 3, 0);
      break;
    }
    case "this_year":
      start = new Date(y, 0, 1);
      end = new Date(y, 11, 31);
      break;
    case "all_time":
      start = new Date(2000, 0, 1);
      end = new Date(y, m, now.getDate());
      break;
  }

  // Previous comparison window for the KPI trend. Calendar-aware for month/quarter/year ranges
  // (the natural "previous month/quarter/year"); an equal-length preceding window for the
  // day-based ranges; and an empty window for all_time (no prior period to compare against).
  let prevStart: Date;
  let prevEnd: Date;
  switch (key) {
    case "this_month":
    case "last_month":
      prevStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
      prevEnd = new Date(start.getFullYear(), start.getMonth(), 0);
      break;
    case "this_quarter":
      prevStart = new Date(start.getFullYear(), start.getMonth() - 3, 1);
      prevEnd = new Date(start.getFullYear(), start.getMonth(), 0);
      break;
    case "this_year":
      prevStart = new Date(start.getFullYear() - 1, 0, 1);
      prevEnd = new Date(start.getFullYear() - 1, 11, 31);
      break;
    case "all_time":
      // No meaningful prior period — use an empty window so previous total is 0.
      prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      prevEnd = addDays(prevStart, -1);
      break;
    default: {
      // last_7_days / last_30_days — equal-length window immediately before start.
      const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      prevEnd = addDays(start, -1);
      prevStart = addDays(prevEnd, -(spanDays - 1));
    }
  }
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const granularity: "day" | "month" = spanDays <= 45 ? "day" : "month";

  return { key, labelKey: RANGE_LABELS[key], start: fmt(start), end: fmt(end), prevStart: fmt(prevStart), prevEnd: fmt(prevEnd), granularity };
}

// Bucket a resolved range into chart points (day or month), each with a display label.
export function rangeBuckets(r: ResolvedRange): { start: string; end: string; label: string }[] {
  const buckets: { start: string; end: string; label: string }[] = [];
  const start = new Date(r.start + "T00:00:00");
  const end = new Date(r.end + "T00:00:00");
  if (r.granularity === "day") {
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const s = fmt(d);
      buckets.push({ start: s, end: s, label: d.toLocaleDateString("en-US", { day: "numeric", month: "short" }) });
    }
  } else {
    let d = new Date(start.getFullYear(), start.getMonth(), 1);
    while (d <= end) {
      const bStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const bEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      buckets.push({
        start: fmt(bStart < start ? start : bStart),
        end: fmt(bEnd > end ? end : bEnd),
        label: bStart.toLocaleDateString("en-US", { month: "short" }),
      });
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  }
  return buckets;
}
