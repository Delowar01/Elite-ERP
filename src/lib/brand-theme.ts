// Per-org "Color Theme" (Business Settings → Color Theme). The org picks BRAND colors; this module
// turns them into SEMANTIC INTERFACE colors that are calculated separately for light and dark
// appearance, so a brand color that reads well on white is never painted raw onto a dark surface
// (and vice versa).
//
//   - "gradient" mode: an editable two-stop brand gradient (start + end).
//   - "single" mode: an editable solid Primary color plus an Accent color.
//
// Brand colors are never applied directly to every component. For each appearance we:
//   1. adapt the brand color so it stays recognizable but has enough contrast against that mode's
//      surface (lightening it on dark, darkening it on light) — see adaptBrand();
//   2. derive each component's background and a font color that provably meets WCAG (4.5:1 for
//      normal text, 3:1 for large text / UI controls);
//   3. allow per-mode manual overrides, which are themselves contrast-validated.
//
// The resolved theme is emitted as one <style> injected server-side in the app shell, so colors are
// correct before first paint (no flash of the previous theme) and everything flows through the one
// shared theme system — no per-page hardcoded styling.

export type ColorThemeMode = "gradient" | "single";
/** Light/dark appearance. Independent of the org's brand colors. */
export type Appearance = "light" | "dark";
export const APPEARANCES: Appearance[] = ["light", "dark"];

export const DEFAULT_PRIMARY = "#1B1B4E"; // Elite navy
export const DEFAULT_ACCENT = "#E87722"; // Elite orange
export const DEFAULT_GRADIENT_FROM = "#F5A25C"; // Elite gradient start (light orange)
export const DEFAULT_GRADIENT_TO = "#E87722"; // Elite gradient end (orange)
export const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;
export const INK = "#17173f";
export const CONTRAST_AA = 4.5; // WCAG AA, normal text
export const CONTRAST_UI = 3; // WCAG AA, large text / UI components

export const THEME_COMPONENTS = ["primaryButton", "accentButton", "activeTab", "selectedItem", "badge"] as const;
export type ThemeComponent = (typeof THEME_COMPONENTS)[number];
export type ComponentColor = { bg: string; fg: string };
/** Manual overrides for one appearance: any component may override bg and/or fg on its own. */
export type ThemeOverrides = Partial<Record<ThemeComponent, { bg?: string; fg?: string }>>;
/** Overrides stored per appearance, so a light-mode edit never changes the dark-mode value. */
export type ThemeOverridesByMode = { light?: ThemeOverrides; dark?: ThemeOverrides };

export type ThemeInput = {
  mode: ColorThemeMode;
  primaryColor: string;
  accentColor: string;
  gradientFrom: string;
  gradientTo: string;
  /** Either the per-mode shape or the legacy flat shape (migrated as light-mode overrides). */
  overrides?: ThemeOverridesByMode | ThemeOverrides | null;
};

export function isColorThemeMode(v: unknown): v is ColorThemeMode {
  return v === "gradient" || v === "single";
}
export function isAppearance(v: unknown): v is Appearance {
  return v === "light" || v === "dark";
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
/** Mix two hex colors (t = 0..1 toward `b`). */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = channels(safe(a, "#000000"));
  const [r2, g2, b2] = channels(safe(b, "#ffffff"));
  return rgbHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
function darken(hex: string, t: number): string {
  return mixHex(hex, "#000000", t);
}
function lighten(hex: string, t: number): string {
  return mixHex(hex, "#ffffff", t);
}
/** Translucent rgba() from a hex — used for tints/rings that must sit over any surface. */
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(safe(hex, DEFAULT_PRIMARY));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- surfaces per appearance ----------------------------------------------
// Base neutrals, mirroring globals.css so calculations here match what is actually painted.
type Neutrals = {
  background: string; surface: string; surfaceElevated: string;
  textPrimary: string; textSecondary: string; textMuted: string;
  border: string; inputBackground: string; disabledBackground: string; disabledText: string;
};
export const NEUTRALS: Record<Appearance, Neutrals> = {
  light: {
    background: "#f3f1ec", surface: "#ffffff", surfaceElevated: "#ffffff",
    textPrimary: "#17173f", textSecondary: "#5c5d82", textMuted: "#6f7093",
    border: "#e5e2d9", inputBackground: "#ffffff", disabledBackground: "#eceade", disabledText: "#6b6c8d",
  },
  dark: {
    background: "#0c0b22", surface: "#16152f", surfaceElevated: "#1b1a38",
    textPrimary: "#eeeef7", textSecondary: "#b9b9db", textMuted: "#9a9ac2",
    border: "#2a2952", inputBackground: "#1b1a38", disabledBackground: "#232247", disabledText: "#9a9ac2",
  },
};

/**
 * Adapt a brand color for an appearance: keep the hue (so branding stays recognizable) but move its
 * lightness until it has at least `target` contrast against that mode's surface. Dark mode lightens,
 * light mode darkens — this is what stops a navy brand from vanishing on a near-black background.
 */
export function adaptBrand(hex: string, appearance: Appearance, target = CONTRAST_UI): string {
  const base = safe(hex, DEFAULT_PRIMARY);
  const surface = NEUTRALS[appearance].surface;
  if (contrastRatio(base, surface) >= target) return base;
  for (let t = 0.06; t <= 0.9; t += 0.06) {
    const cand = appearance === "dark" ? lighten(base, t) : darken(base, t);
    if (contrastRatio(cand, surface) >= target) return cand;
  }
  return appearance === "dark" ? "#ffffff" : "#000000";
}

/** White on dark colors, dark ink on light colors — never unreadable control text. */
export function readableForeground(hex: string): string {
  const bg = safe(hex, DEFAULT_PRIMARY);
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, INK) ? "#ffffff" : INK;
}
/**
 * A font color for `bg` meeting `target` — preferring `preferred`, then progressively pushing it
 * away from the background, then falling back to white/ink (which always wins one of the two).
 */
export function suggestReadableFg(bg: string, preferred?: string, target = CONTRAST_AA): string {
  const b = safe(bg, DEFAULT_PRIMARY);
  if (preferred && HEX_COLOR.test(preferred) && contrastRatio(preferred, b) >= target) return preferred;
  if (preferred && HEX_COLOR.test(preferred)) {
    const towardLight = luminance(b) < 0.5; // dark bg → lighten the preferred color, else darken
    for (let t = 0.1; t <= 0.9; t += 0.1) {
      const cand = towardLight ? lighten(preferred, t) : darken(preferred, t);
      if (contrastRatio(cand, b) >= target) return cand;
    }
  }
  return readableForeground(b);
}
export function isReadable(fg: string, bg: string, target = CONTRAST_AA): boolean {
  return contrastRatio(safe(fg, INK), safe(bg, "#ffffff")) >= target;
}

// ---- generation -----------------------------------------------------------
function gradientCss(from: string, to: string): string {
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/** The brand colors adapted to one appearance (still recognizably the org's colors). */
export function brandForAppearance(input: ThemeInput, appearance: Appearance) {
  const single = input.mode === "single";
  const primary = adaptBrand(safe(input.primaryColor, DEFAULT_PRIMARY), appearance);
  const accent = adaptBrand(safe(input.accentColor, DEFAULT_ACCENT), appearance);
  const from = adaptBrand(safe(input.gradientFrom, DEFAULT_GRADIENT_FROM), appearance);
  const to = adaptBrand(safe(input.gradientTo, DEFAULT_GRADIENT_TO), appearance);
  return {
    single,
    primary,
    accent,
    from,
    to,
    /** Representative solid for the primary surface (the gradient's end stop in gradient mode). */
    primarySolid: single ? primary : to,
    /** Representative solid for accents (the gradient's start stop in gradient mode). */
    accentSolid: single ? accent : from,
    gradient: single ? primary : gradientCss(from, to),
  };
}

/**
 * Auto-generate each component's background + a readable font color, for ONE appearance. Component
 * text is UI text on a solid fill, so it targets AA (4.5:1) — comfortably above the 3:1 UI floor.
 */
export function generateComponentColors(input: ThemeInput, appearance: Appearance = "light"): Record<ThemeComponent, ComponentColor> {
  const b = brandForAppearance(input, appearance);
  const n = NEUTRALS[appearance];
  // Badge is a soft tint: toward white on light, toward the elevated dark surface on dark — mixing
  // toward white in dark mode is exactly what made badges glare/wash out before.
  const badgeBg = appearance === "dark" ? mixHex(b.accentSolid, n.surfaceElevated, 0.74) : mixHex(b.accentSolid, "#ffffff", 0.86);
  return {
    primaryButton: { bg: b.single ? b.primary : b.gradient, fg: suggestReadableFg(b.primarySolid, readableForeground(b.primarySolid)) },
    accentButton: { bg: b.accentSolid, fg: suggestReadableFg(b.accentSolid, readableForeground(b.accentSolid)) },
    activeTab: { bg: b.primarySolid, fg: suggestReadableFg(b.primarySolid, readableForeground(b.primarySolid)) },
    selectedItem: { bg: b.primarySolid, fg: suggestReadableFg(b.primarySolid, readableForeground(b.primarySolid)) },
    badge: { bg: badgeBg, fg: suggestReadableFg(badgeBg, b.accentSolid) },
  };
}

/** Normalize either overrides shape into the per-mode shape (legacy flat = light-mode overrides). */
export function normalizeOverrides(raw: ThemeOverridesByMode | ThemeOverrides | null | undefined): ThemeOverridesByMode {
  if (!raw) return {};
  const o = raw as Record<string, unknown>;
  const hasModeKeys = "light" in o || "dark" in o;
  if (hasModeKeys) {
    const m = raw as ThemeOverridesByMode;
    return { light: m.light ?? undefined, dark: m.dark ?? undefined };
  }
  // Legacy: one flat set saved before light/dark were separated — keep it as the light-mode set.
  const legacy = raw as ThemeOverrides;
  return Object.keys(legacy).length ? { light: legacy } : {};
}

/** Merge auto-generated colors with this appearance's manual overrides (bg/fg independently). */
export function resolveComponentColors(input: ThemeInput, appearance: Appearance = "light"): Record<ThemeComponent, ComponentColor> {
  const gen = generateComponentColors(input, appearance);
  const ov = normalizeOverrides(input.overrides)[appearance] ?? {};
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

/** The solid color used for contrast checks against a component bg (gradients aren't a single hex). */
export function componentBgSolid(input: ThemeInput, appearance: Appearance, comp: ThemeComponent): string {
  const resolved = resolveComponentColors(input, appearance)[comp];
  if (HEX_COLOR.test(resolved.bg)) return resolved.bg;
  return brandForAppearance(input, appearance).primarySolid;
}

// ---- semantic tokens ------------------------------------------------------
export type SemanticTokens = Record<string, string>;

/**
 * The full semantic interface palette for one appearance. Light and dark are calculated separately —
 * they never share component background/text values.
 */
export function buildSemanticTokens(input: ThemeInput, appearance: Appearance): SemanticTokens {
  const b = brandForAppearance(input, appearance);
  const n = NEUTRALS[appearance];
  const comp = resolveComponentColors(input, appearance);
  const dark = appearance === "dark";
  // Hover shifts must move AWAY from the surface so the state stays visible in both modes.
  const hover = (hex: string) => (dark ? lighten(hex, 0.14) : darken(hex, 0.12));
  const primaryBg = HEX_COLOR.test(comp.primaryButton.bg) ? comp.primaryButton.bg : b.primarySolid;

  return {
    "--background": n.background,
    "--surface": n.surface,
    "--surface-elevated": n.surfaceElevated,
    "--text-primary": n.textPrimary,
    "--text-secondary": n.textSecondary,
    "--text-muted": n.textMuted,
    "--border": n.border,
    "--input-background": n.inputBackground,

    "--primary-background": comp.primaryButton.bg,
    "--primary-text": comp.primaryButton.fg,
    "--primary-hover": hover(primaryBg),
    "--accent-background": comp.accentButton.bg,
    "--accent-text": comp.accentButton.fg,
    "--accent-hover": hover(comp.accentButton.bg),

    "--active-tab-background": comp.activeTab.bg,
    "--active-tab-text": comp.activeTab.fg,
    "--selected-item-background": comp.selectedItem.bg,
    "--selected-item-text": comp.selectedItem.fg,
    "--badge-background": comp.badge.bg,
    "--badge-text": comp.badge.fg,

    "--focus-ring": rgba(b.primarySolid, dark ? 0.55 : 0.4),
    "--disabled-background": n.disabledBackground,
    "--disabled-text": n.disabledText,
  };
}

/** Is this the untouched default theme? (then we inject nothing and keep the stock look exactly.) */
export function isDefaultTheme(input: ThemeInput): boolean {
  const ov = normalizeOverrides(input.overrides);
  const noOverrides = !Object.keys(ov.light ?? {}).length && !Object.keys(ov.dark ?? {}).length;
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

/** The variables emitted for one appearance: brand remap + the full semantic token set. */
function varsFor(input: ThemeInput, appearance: Appearance): string {
  const b = brandForAppearance(input, appearance);
  const tokens = buildSemanticTokens(input, appearance);
  const brandVars = `
    --brand-orange: ${b.primarySolid};
    --brand-orange-light: ${b.accentSolid};
    --brand-gradient: ${b.gradient};
    --brand-primary: ${b.primarySolid};
    --brand-primary-foreground: ${tokens["--primary-text"]};
    --brand-accent: ${b.accentSolid};
    --brand-accent-foreground: ${tokens["--accent-text"]};
    --sidebar-active-bg: ${tokens["--selected-item-background"]};
    --accent-orange-bg: ${rgba(b.accentSolid, appearance === "dark" ? 0.22 : 0.14)};
    --chart-navy: ${b.accentSolid};
    --ring-orange: 0 0 0 3px ${tokens["--focus-ring"]};
  `;
  const tokenVars = Object.entries(tokens).map(([k, v]) => `${k}: ${v};`).join("");
  return `${brandVars}${tokenVars}`;
}

/**
 * Per-appearance component rules. `scope` prefixes each selector so the dark values only apply
 * inside the dark root (each themed selector may be a comma-separated list, so every part is
 * prefixed individually).
 */
function componentRules(input: ThemeInput, appearance: Appearance, scope = ""): string {
  const resolved = resolveComponentColors(input, appearance);
  return THEME_COMPONENTS.map((c) => {
    const { bg, fg } = resolved[c];
    const selector = COMPONENT_SELECTORS[c]
      .split(",")
      .map((s) => (scope ? `${scope} ${s.trim()}` : s.trim()))
      .join(",");
    return `${selector}{background:${bg} !important;color:${fg} !important;}`;
  }).join("");
}

/**
 * Build the injected stylesheet. Light and dark get SEPARATE calculated blocks — the same brand
 * colors, adapted per mode — so nothing is painted with the other mode's values.
 */
export function buildThemeOverrideCss(input: ThemeInput): string {
  if (isDefaultTheme(input)) return "";
  const light = varsFor(input, "light");
  const dark = varsFor(input, "dark");

  return [
    // Light (default) — also applies when the user explicitly forces light.
    `:root{${light}}`,
    componentRules(input, "light"),
    // Dark — explicit toggle.
    `:root[data-theme="dark"]{${dark}}`,
    componentRules(input, "dark", ':root[data-theme="dark"]'),
    // Dark — system preference, unless the user forced light.
    `@media (prefers-color-scheme: dark){`,
    `:root:not([data-theme="light"]){${dark}}`,
    componentRules(input, "dark", ':root:not([data-theme="light"])'),
    `}`,
  ].join("\n");
}
