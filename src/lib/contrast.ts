// Shared, standards-based colour-contrast utility (WCAG 2.x).
//
// One implementation for every contrast check in the app, so a ratio shown in Business Settings is
// the same ratio the accessibility rules use. It works on the colours actually rendered:
//   - parses HEX (3/4/6/8), rgb(), rgba(), hsl(), hsla() and the handful of named colours we emit;
//   - resolves `var(--token)` against a supplied token map before measuring;
//   - composites translucent colours over the real underlying background instead of guessing;
//   - samples a gradient at several stops and reports the WORST ratio, because text has to be
//     readable over the whole sweep, not just at one end.
//
// Thresholds are WCAG AA: 4.5:1 for normal text, 3:1 for large text and UI components.

export const CONTRAST_NORMAL_TEXT = 4.5;
export const CONTRAST_LARGE_TEXT = 3;

/** A colour with straight (non-premultiplied) alpha. */
export type Rgba = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, string> = {
  white: "#ffffff", black: "#000000", transparent: "#00000000",
  red: "#ff0000", green: "#008000", blue: "#0000ff", gray: "#808080", grey: "#808080",
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hex2 = (s: string) => parseInt(s, 16);

/** hsl -> rgb, all inputs already normalized (h in [0,360), s/l in [0,1]). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

/** Percent or 0-255 number -> 0-255. */
function num255(tok: string): number {
  const t = tok.trim();
  if (t.endsWith("%")) return clamp(parseFloat(t) / 100, 0, 1) * 255;
  return clamp(parseFloat(t), 0, 255);
}
/** Percent or 0-1 number -> 0-1. */
function alpha01(tok: string | undefined): number {
  if (tok === undefined) return 1;
  const t = tok.trim();
  if (!t) return 1;
  if (t.endsWith("%")) return clamp(parseFloat(t) / 100, 0, 1);
  const n = parseFloat(t);
  return Number.isFinite(n) ? clamp(n, 0, 1) : 1;
}

/**
 * Parse any colour string this app can emit. Returns null when the value cannot be understood, so
 * callers can fall back deliberately instead of silently measuring black.
 *
 * `vars` resolves `var(--token)` (and its fallback) to a concrete value first.
 */
export function parseColor(input: string | null | undefined, vars?: Record<string, string>, depth = 0): Rgba | null {
  if (input == null) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;

  // var(--token[, fallback])
  if (s.startsWith("var(") && depth < 8) {
    const inner = s.slice(4, s.lastIndexOf(")"));
    const comma = splitTop(inner);
    const name = comma[0]?.trim();
    const fallback = comma.slice(1).join(",").trim();
    const resolved = name && vars ? vars[name] ?? vars[name.replace(/^--/, "")] : undefined;
    if (resolved) return parseColor(resolved, vars, depth + 1);
    if (fallback) return parseColor(fallback, vars, depth + 1);
    return null;
  }

  if (NAMED[s]) s = NAMED[s];

  if (s.startsWith("#")) {
    const h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = h.split("").map((c) => hex2(c + c));
      return { r, g, b, a: h.length === 4 ? a / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: hex2(h.slice(0, 2)), g: hex2(h.slice(2, 4)), b: hex2(h.slice(4, 6)),
        a: h.length === 8 ? hex2(h.slice(6, 8)) / 255 : 1,
      };
    }
    return null;
  }

  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (!fn) return null;
  // Both the legacy comma syntax and the modern space syntax with a slash for alpha.
  const parts = fn[2].includes("/")
    ? [...fn[2].split("/")[0].trim().split(/[\s,]+/), fn[2].split("/")[1]]
    : fn[2].split(",").length > 1 ? fn[2].split(",") : fn[2].trim().split(/\s+/);
  const [p0, p1, p2, p3] = parts;
  if (p0 === undefined || p1 === undefined || p2 === undefined) return null;

  if (fn[1].startsWith("rgb")) {
    return { r: num255(p0), g: num255(p1), b: num255(p2), a: alpha01(p3) };
  }
  const h = parseFloat(p0);
  const sat = clamp(parseFloat(p1) / 100, 0, 1);
  const li = clamp(parseFloat(p2) / 100, 0, 1);
  if (!Number.isFinite(h) || !Number.isFinite(sat) || !Number.isFinite(li)) return null;
  const [r, g, b] = hslToRgb(h, sat, li);
  return { r, g, b, a: alpha01(p3) };
}

/** Split on top-level commas (ignores commas nested inside parentheses). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Composite `fg` over `bg` (straight alpha, "source-over"). */
export function blend(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (f: number, b: number) => (f * fg.a + b * bg.a * (1 - fg.a)) / a;
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
}

/** WCAG relative luminance with correct sRGB linearization. */
export function relativeLuminance(c: Rgba): number {
  const lin = [c.r, c.g, c.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two opaque colours. */
export function ratioOf(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastOptions = {
  /** Token map used to resolve `var(--x)` in either colour. */
  vars?: Record<string, string>;
  /** What a translucent colour actually sits on. Defaults to white. */
  surface?: string;
};

/**
 * Contrast between a foreground and a background as they are actually rendered: variables resolved,
 * translucency composited over the real surface. Returns 1 (the worst possible) when either colour
 * cannot be parsed, so an unreadable input can never masquerade as a pass.
 */
export function contrast(fg: string, bg: string, opts: ContrastOptions = {}): number {
  const surface = parseColor(opts.surface ?? "#ffffff", opts.vars) ?? { r: 255, g: 255, b: 255, a: 1 };
  const bgRaw = parseColor(bg, opts.vars);
  const fgRaw = parseColor(fg, opts.vars);
  if (!bgRaw || !fgRaw) return 1;
  const bgSolid = blend(bgRaw, surface);
  const fgSolid = blend(fgRaw, bgSolid); // translucent text sits on its own background
  return ratioOf(fgSolid, bgSolid);
}

// ---- gradients -------------------------------------------------------------------------------

/** Colour stops found in a CSS gradient, in order. */
export function gradientStops(value: string): string[] {
  const m = /gradient\(([\s\S]*)\)$/i.exec(String(value ?? "").trim());
  if (!m) return [];
  // Drop the leading direction/angle argument when it is not itself a colour.
  const args = splitTop(m[1]).map((a) => a.trim()).filter(Boolean);
  const stops: string[] = [];
  for (const a of args) {
    // "‹color› ‹position›" — strip a trailing percentage/length so the colour parses.
    const colorPart = a.replace(/\s+(-?[\d.]+(%|px|em|rem|deg)?)+$/i, "").trim();
    if (/^(to\s|-?[\d.]+deg|circle|ellipse|at\s|closest|farthest)/i.test(a)) continue;
    if (parseColor(colorPart)) stops.push(colorPart);
  }
  return stops;
}

export const isGradient = (value: string) => /gradient\(/i.test(String(value ?? ""));

export type GradientContrast = {
  /** Lowest ratio across the sampled stops — the one that decides pass/fail. */
  ratio: number;
  /** Every sampled ratio, in sample order (start … end). */
  samples: number[];
};

/**
 * Contrast of text over a gradient. Samples the start, the midpoint(s) and the end rather than one
 * colour, and reports the LOWEST ratio, because the text has to stay readable across the whole
 * sweep. A non-gradient value is measured directly.
 */
export function contrastOverGradient(fg: string, bg: string, opts: ContrastOptions = {}): GradientContrast {
  if (!isGradient(bg)) {
    const r = contrast(fg, bg, opts);
    return { ratio: r, samples: [r] };
  }
  const stops = gradientStops(bg);
  if (stops.length === 0) return { ratio: 1, samples: [1] };
  if (stops.length === 1) {
    const r = contrast(fg, stops[0], opts);
    return { ratio: r, samples: [r] };
  }

  // Sample every declared stop plus the midpoint between consecutive stops, so a dark-to-dark
  // gradient with a light middle (or vice versa) cannot slip through.
  const surface = parseColor(opts.surface ?? "#ffffff", opts.vars) ?? { r: 255, g: 255, b: 255, a: 1 };
  const points: Rgba[] = [];
  for (let i = 0; i < stops.length; i++) {
    const a = parseColor(stops[i], opts.vars);
    if (!a) continue;
    points.push(a);
    const next = parseColor(stops[i + 1] ?? "", opts.vars);
    if (next) points.push(midpoint(a, next));
  }
  const fgRaw = parseColor(fg, opts.vars);
  if (!fgRaw || points.length === 0) return { ratio: 1, samples: [1] };

  const samples = points.map((p) => {
    const solid = blend(p, surface);
    return ratioOf(blend(fgRaw, solid), solid);
  });
  return { ratio: Math.min(...samples), samples };
}

function midpoint(a: Rgba, b: Rgba): Rgba {
  return { r: (a.r + b.r) / 2, g: (a.g + b.g) / 2, b: (a.b + b.b) / 2, a: (a.a + b.a) / 2 };
}

/** Ratio rounded the way it is displayed ("4.5:1"). Rounds DOWN so a shown 4.5 always really passes. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}

/** Does this pair meet the threshold? Compares the true ratio, not the rounded display value. */
export function meets(ratio: number, threshold: number): boolean {
  return ratio + 1e-9 >= threshold;
}
