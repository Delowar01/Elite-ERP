// Date parsing for imports. The uploaded file's date format is chosen by the user during column
// mapping — the importer never guesses between DD/MM and MM/DD, because "05/08/2026" is a different
// day depending on which one the file used. Auto Detect only resolves values that are unambiguous on
// their own; anything else is reported so the user can pick the right format.

export const DATE_FORMATS = ["auto", "dmy", "mdy", "iso", "dmy_dash", "mdy_dash", "excel"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Labels shown in the mapping step's format selector (English source strings; translated via t()). */
export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  auto: "Auto Detect",
  dmy: "DD/MM/YYYY",
  mdy: "MM/DD/YYYY",
  iso: "YYYY-MM-DD",
  dmy_dash: "DD-MM-YYYY",
  mdy_dash: "MM-DD-YYYY",
  excel: "Excel Date",
};

export const DEFAULT_DATE_FORMAT: DateFormat = "auto";

export function isDateFormat(v: unknown): v is DateFormat {
  return typeof v === "string" && (DATE_FORMATS as readonly string[]).includes(v);
}

/** Keep only recognized format choices — the client's selection is never trusted as-is. */
export function sanitizeDateFormats(input: unknown): Record<string, DateFormat> {
  const out: Record<string, DateFormat> = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (isDateFormat(v)) out[k] = v;
  }
  return out;
}

export type DateParseResult =
  | { ok: true; iso: string }
  | { ok: false; reason: "ambiguous" | "impossible" | "unrecognized" };

const pad = (n: number) => String(n).padStart(2, "0");

/** Build an ISO date only if the y/m/d combination is a real calendar date (rejects 31/02). */
function toIso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Excel serial number -> ISO. Day 0 is 1899-12-30, which absorbs Excel's 1900 leap-year bug for every
 * serial above 60 (the range any real document date falls in). Fractional times are truncated.
 */
function fromExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  const dt = new Date(ms);
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Which slot holds the day vs. the month, per selected format. */
const ORDER: Record<Exclude<DateFormat, "auto" | "iso" | "excel">, "dmy" | "mdy"> = {
  dmy: "dmy",
  dmy_dash: "dmy",
  mdy: "mdy",
  mdy_dash: "mdy",
};

/**
 * Parse one date cell using the format the user selected for that column.
 *
 * The separator (/ - .) is accepted interchangeably — the DD/MM vs DD-MM distinction in the picker is
 * about which slot is the day, which is the only genuinely ambiguous part. `YYYY-MM-DD` input is
 * always accepted regardless of the selection, because it cannot be read two ways and it is what a
 * real Excel date cell has already been normalized to by the file parser.
 */
export function parseDateCell(raw: string, format: DateFormat = DEFAULT_DATE_FORMAT): DateParseResult {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, reason: "unrecognized" };

  // ISO (or YYYY/MM/DD) — unambiguous, accepted under every format.
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) {
    const iso = toIso(Number(m[1]), Number(m[2]), Number(m[3]));
    return iso ? { ok: true, iso } : { ok: false, reason: "impossible" };
  }

  // Bare number: an Excel serial. Only honoured when the user explicitly picked "Excel Date" —
  // under Auto Detect a lone number is not safely a date.
  if (/^\d+(\.\d+)?$/.test(s)) {
    if (format !== "excel") return { ok: false, reason: "ambiguous" };
    const iso = fromExcelSerial(Number(s));
    return iso ? { ok: true, iso } : { ok: false, reason: "impossible" };
  }

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (!m) return { ok: false, reason: "unrecognized" };
  const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);

  let order: "dmy" | "mdy";
  if (format === "auto" || format === "iso" || format === "excel") {
    // Auto Detect: resolve only when one reading is impossible; never pick a side on a tie.
    const aIsDay = a > 12, bIsDay = b > 12;
    if (aIsDay && bIsDay) return { ok: false, reason: "impossible" };
    if (aIsDay) order = "dmy";
    else if (bIsDay) order = "mdy";
    else return { ok: false, reason: "ambiguous" };
  } else {
    order = ORDER[format];
  }

  const iso = order === "dmy" ? toIso(y, b, a) : toIso(y, a, b);
  return iso ? { ok: true, iso } : { ok: false, reason: "impossible" };
}
