// Per-org "Color Theme" (Business Settings → Color Theme, Issue #16). Independent of the
// light/dark Appearance setting.
//
//   - "gradient" mode: an editable two-stop brand gradient (start + end). The default start/end are
//     the classic Elite orange gradient, so an org that never customizes looks exactly as before.
//   - "single" mode: an editable solid Primary color (wherever the design used the brand gradient)
//     plus an Accent color for secondary highlights.
//
// From the chosen main colors we auto-generate a readable background + font color for five UI
// components (primary button, accent button, active tab, selected item, badge). Each of those can
// be manually overridden (background and/or font independently); a manual override is kept until the
// user changes that specific value. The resolved theme is emitted as one <style> injected
// server-side in the app shell, so colors are correct before first paint (no flash) and everything
// flows through the one shared theme system — no per-page hardcoded styling.

export type ColorThemeMode = "gradient" | "single";

export const DEFAULT_PRIMARY = "#1B1B4E"; // Elite navy
export const DEFAULT_ACCENT = "#E87722"; // Elite orange
export const DEFAULT_GRADIENT_FROM = "#F5A25C"; // Elite gradient start (light orange)
export const DEFAULT_GRADIENT_TO = "#E87722"; // Elite gradient end (orange)
export const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;
export const INK = "#17173f";
export const CONTRAST_AA = 4.5; // WCAG AA for normal text

export const THEME_COMPONENTS = ["primaryButton", "accentButton", "activeTab", "selectedItem", "badge"] as const;
export type ThemeComponent = (typeof THEME_COMPONENTS)[number];
export type ComponentColor = { bg: string; fg: string };
// Manual overrides: any component may override bg and/or fg on its own.
export type ThemeOverrides = Partial<Record<ThemeComponent, { bg?: string; fg?: string }>>;

export type ThemeInput = {
  mode: ColorThemeMode;
  primaryColor: string;
  accentColor: string;
  gradientFrom: string;
  gradientTo: string;
  overrides?: ThemeOverrides | null;
};

export function isColorThemeMode(v: unknown): v is ColorThemeMode {
  return v === "gradient" || v === "single";
}

function safe(hex: string | null | undefined, fallback: string): string {
  return hex && HEX_COLOR.test(hex) ? hex : fallback;
}

// ---- color math -----------------------------------------------------------
function channels(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
}
function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}
function rgbHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function luminance(hex: string): number {
  const lin = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(safe(a, "#000000")), lb = luminance(safe(b, "#ffffff"));
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
// Mix two hex colors (t = 0..1 toward `b`).
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = channels(safe(a, "#000000"));
  const [r2, g2, b2] = channels(safe(b, "#ffffff"));
  return rgbHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
function darken(hex: string, t: number): string {
  return mixHex(hex, "#000000", t);
}

// Auto foreground: white on dark colors, dark ink on light colors — never unreadable button text.
export function readableForeground(hex: string): string {
  const bg = safe(hex, DEFAULT_PRIMARY);
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, INK) ? "#ffffff" : INK;
}
// Given a background, return a font color meeting AA — preferring the supplied `preferred` color,
// then progressively darkening it, then falling back to white/ink.
export function suggestReadableFg(bg: string, preferred?: string): string {
  const b = safe(bg, DEFAULT_PRIMARY);
  if (preferred && HEX_COLOR.test(preferred) && contrastRatio(preferred, b) >= CONTRAST_AA) return preferred;
  if (preferred && HEX_COLOR.test(preferred)) {
    for (let t = 0.15; t <= 0.85; t += 0.1) {
      const cand = darken(preferred, t);
      if (contrastRatio(cand, b) >= CONTRAST_AA) return cand;
    }
  }
  return readableForeground(b);
}
export function isReadable(fg: string, bg: string): boolean {
  return contrastRatio(safe(fg, INK), safe(bg, "#ffffff")) >= CONTRAST_AA;
}

// ---- generation -----------------------------------------------------------
function gradientCss(from: string, to: string): string {
  return `linear-gradient(135deg, ${from}, ${to})`;
}

// Auto-generate each component's background + readable font color from the main theme colors.
export function generateComponentColors(input: ThemeInput): Record<ThemeComponent, ComponentColor> {
  const single = input.mode === "single";
  const primary = safe(input.primaryColor, DEFAULT_PRIMARY);
  const accent = safe(input.accentColor, DEFAULT_ACCENT);
  const from = safe(input.gradientFrom, DEFAULT_GRADIENT_FROM);
  const to = safe(input.gradientTo, DEFAULT_GRADIENT_TO);

  // Representative solids used for contrast + for the flat components.
  const primarySolid = single ? primary : to;
  const accentSolid = single ? accent : from;

  const primaryButtonBg = single ? primary : gradientCss(from, to);
  const badgeBg = mixHex(accentSolid, "#ffffff", 0.86); // light accent tint
  return {
    primaryButton: { bg: primaryButtonBg, fg: readableForeground(primarySolid) },
    accentButton: { bg: accentSolid, fg: readableForeground(accentSolid) },
    activeTab: { bg: primarySolid, fg: readableForeground(primarySolid) },
    selectedItem: { bg: primarySolid, fg: readableForeground(primarySolid) },
    badge: { bg: badgeBg, fg: suggestReadableFg(badgeBg, accentSolid) },
  };
}

// Merge auto-generated colors with the org's manual overrides (bg/fg independently).
export function resolveComponentColors(input: ThemeInput): Record<ThemeComponent, ComponentColor> {
  const gen = generateComponentColors(input);
  const ov = input.overrides ?? {};
  const out = {} as Record<ThemeComponent, ComponentColor>;
  for (const c of THEME_COMPONENTS) {
    const o = ov[c] ?? {};
    out[c] = {
      bg: o.bg && HEX_COLOR.test(o.bg) ? o.bg : gen[c].bg,
      fg: o.fg && HEX_COLOR.test(o.fg) ? o.fg : gen[c].fg,
    };
  }
  return out;
}

// Is this the untouched default theme? (so we inject nothing and preserve the exact default look,
// including dark-mode's adjusted orange.)
export function isDefaultTheme(input: ThemeInput): boolean {
  const noOverrides = !input.overrides || Object.keys(input.overrides).length === 0;
  return (
    input.mode === "gradient" &&
    safe(input.gradientFrom, DEFAULT_GRADIENT_FROM).toLowerCase() === DEFAULT_GRADIENT_FROM.toLowerCase() &&
    safe(input.gradientTo, DEFAULT_GRADIENT_TO).toLowerCase() === DEFAULT_GRADIENT_TO.toLowerCase() &&
    noOverrides
  );
}

// Selector each component maps to in the real app (drives the whole app from the one stylesheet).
const COMPONENT_SELECTORS: Record<ThemeComponent, string> = {
  primaryButton: ".btn-primary",
  accentButton: ".btn-accent",
  activeTab: '[role="tab"][data-state="active"], .tab.active, .doc-tabbar button.active',
  selectedItem: ".nav-item.active",
  badge: ".badge-accent, .pill-accent",
};

// Build the injected stylesheet: base brand-var remap (broad coverage) + explicit per-component
// rules using the resolved (generated + overridden) colors.
export function buildThemeOverrideCss(input: ThemeInput): string {
  if (isDefaultTheme(input)) return "";
  const single = input.mode === "single";
  const primary = safe(input.primaryColor, DEFAULT_PRIMARY);
  const accent = safe(input.accentColor, DEFAULT_ACCENT);
  const from = safe(input.gradientFrom, DEFAULT_GRADIENT_FROM);
  const to = safe(input.gradientTo, DEFAULT_GRADIENT_TO);

  const brandOrange = single ? primary : to;
  const brandOrangeLight = single ? primary : from;
  const brandGradient = single ? primary : gradientCss(from, to);
  const accentSolid = single ? accent : from;

  const vars = `
    --brand-orange: ${brandOrange} !important;
    --brand-orange-light: ${brandOrangeLight} !important;
    --brand-gradient: ${brandGradient} !important;
    --brand-primary: ${brandOrange} !important;
    --brand-primary-foreground: ${readableForeground(brandOrange)} !important;
    --brand-accent: ${accentSolid} !important;
    --brand-accent-foreground: ${readableForeground(accentSolid)} !important;
    --sidebar-active-bg: ${brandOrange} !important;
    --accent-orange-bg: color-mix(in srgb, ${accentSolid} 14%, transparent) !important;
    --chart-navy: ${accentSolid} !important;
    --ring-orange: 0 0 0 3px color-mix(in srgb, ${brandOrange} 24%, transparent) !important;
  `;
  const baseBlock = `:root{${vars}} :root[data-theme="dark"]{${vars}} @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${vars}}}`;

  const resolved = resolveComponentColors(input);
  const compRules = THEME_COMPONENTS.map((c) => {
    const { bg, fg } = resolved[c];
    return `${COMPONENT_SELECTORS[c]}{background:${bg} !important;color:${fg} !important;}`;
  }).join("");

  return `${baseBlock}\n${compRules}`;
}
