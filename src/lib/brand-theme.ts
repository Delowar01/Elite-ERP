// Per-org "Color Theme" (Business Settings). Two modes, independent of light/dark Appearance:
//   - "gradient" (default): the existing Elite navy/orange gradient branding, unchanged. The saved
//     single-color values are ignored for rendering but kept so they restore if the user switches back.
//   - "single": flat solid Primary color wherever the design used the main (orange) gradient, plus an
//     Accent color for secondary highlights. No gradient is ever built from the two chosen colors.
// The stylesheet is injected once in the app shell (server-rendered) so colors are correct before
// first paint — no flash of the wrong brand.

export type ColorThemeMode = "gradient" | "single";

export const DEFAULT_PRIMARY = "#1B1B4E"; // Elite navy
export const DEFAULT_ACCENT = "#E87722"; // Elite orange
export const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

export function isColorThemeMode(v: unknown): v is ColorThemeMode {
  return v === "gradient" || v === "single";
}

// Relative luminance (WCAG). Used to pick a readable foreground automatically.
function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const lin = ch.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

// Contrast ratio between two hex colors (1..21).
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Auto foreground: white on dark colors, dark ink on light colors — never unreadable text on a button.
export const INK = "#17173f";
export function readableForeground(hex: string): string {
  const bg = HEX_COLOR.test(hex) ? hex : DEFAULT_PRIMARY;
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, INK) ? "#ffffff" : INK;
}

// Build the injected <style> that applies the org's color theme. Empty string in gradient mode
// (the built-in Elite gradient from globals.css already renders it). In single mode, overriding
// --brand-orange/--brand-orange-light to the same solid Primary flattens every existing orange
// gradient to a solid fill in one place, while --accent-* drives secondary highlights.
export function buildThemeOverrideCss(mode: ColorThemeMode, primaryColor: string, accentColor: string): string {
  if (mode !== "single") return "";
  const p = HEX_COLOR.test(primaryColor) ? primaryColor : DEFAULT_PRIMARY;
  const a = HEX_COLOR.test(accentColor) ? accentColor : DEFAULT_ACCENT;
  const pf = readableForeground(p);
  const af = readableForeground(a);
  const vars = `
    --brand-orange: ${p} !important;
    --brand-orange-light: ${p} !important;
    --brand-primary: ${p} !important;
    --brand-primary-foreground: ${pf} !important;
    --brand-accent: ${a} !important;
    --brand-accent-foreground: ${af} !important;
    --brand-gradient: ${p} !important;
    --accent-orange-bg: color-mix(in srgb, ${a} 14%, transparent) !important;
    --chart-navy: ${a} !important;
    --ring-orange: 0 0 0 3px color-mix(in srgb, ${p} 24%, transparent) !important;
  `;
  return `:root{${vars}} :root[data-theme="dark"]{${vars}} @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${vars}}}`;
}
