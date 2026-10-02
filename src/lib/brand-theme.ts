// Per-org "Color Theme" (Business Settings → Color Theme). The org picks BRAND colors; this module
// turns them into SEMANTIC INTERFACE colors that are calculated separately for light and dark
// appearance, so a brand color that reads well on white is never painted raw onto a dark surface
// (and vice versa).
//
// Navy Command (DEV-UI-01.1, owner decisions D-03 / D-04) — the core UI is SOLID-ONLY:
//   - the primary action is always the org's solid Primary colour (Elite navy by default) with a
//     contrast-checked foreground — never a gradient, in either mode;
//   - "single" mode: Accent is the org's Accent colour;
//   - "gradient" mode (legacy): the two stops are still stored and still editable, but no core
//     control paints a gradient any more. The gradient's END stop is used as the solid Accent, so an
//     org that customised its gradient keeps its brand hue (the default end stop is Elite orange).
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
import { TOKENS } from "./design-tokens";
import {
  contrast, contrastOverGradient, parseColor, relativeLuminance, meets, isGradient,
  CONTRAST_NORMAL_TEXT, CONTRAST_LARGE_TEXT, formatRatio,
} from "./contrast";

export const CONTRAST_AA = CONTRAST_NORMAL_TEXT; // WCAG AA, normal text
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
/** Relative luminance of a hex colour (kept for the internal generators). */
function luminance(hex: string): number {
  const c = parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  return relativeLuminance(c);
}
/**
 * WCAG contrast between two colours. Delegates to the shared utility, so HEX, rgb(a), hsl(a) and
 * `var(--token)` all measure the colour actually rendered rather than falling back to black.
 */
export function contrastRatio(a: string, b: string): number {
  return contrast(a, b);
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
// Base neutrals, read from the single token source (design-tokens.ts, mirrored by globals.css and
// checked by verify-contrast) so calculations here match what is actually painted.
type Neutrals = {
  background: string; surface: string; surfaceElevated: string;
  textPrimary: string; textSecondary: string; textMuted: string;
  border: string; inputBackground: string; disabledBackground: string; disabledText: string;
};
function neutralsFor(a: Appearance): Neutrals {
  const t = TOKENS[a];
  return {
    background: t.canvas, surface: t.surface, surfaceElevated: t.surfaceRaised,
    textPrimary: t.text, textSecondary: t.textMuted, textMuted: t.textMuted,
    border: t.border, inputBackground: a === "dark" ? t.surfaceSubtle : t.surface,
    disabledBackground: t.disabledBackground, disabledText: t.disabledText,
  };
}
export const NEUTRALS: Record<Appearance, Neutrals> = { light: neutralsFor("light"), dark: neutralsFor("dark") };

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
  // Gradients are judged by their worst sample — see contrastOverGradient.
  return meets(contrastOverGradient(fg, bg).ratio, target);
}

// ---- generation -----------------------------------------------------------
/**
 * The brand colors adapted to one appearance (still recognizably the org's colors). SOLID-ONLY:
 * `gradient` is kept as a field for compatibility but is always a solid colour now (D-04).
 */
export function brandForAppearance(input: ThemeInput, appearance: Appearance) {
  const single = input.mode === "single";
  const primary = adaptBrand(safe(input.primaryColor, DEFAULT_PRIMARY), appearance);
  // Gradient mode keeps the org's brand hue by using the gradient's end stop as the solid accent.
  const accentSource = single ? safe(input.accentColor, DEFAULT_ACCENT) : safe(input.gradientTo, DEFAULT_GRADIENT_TO);
  const accent = adaptBrand(accentSource, appearance);
  const from = adaptBrand(safe(input.gradientFrom, DEFAULT_GRADIENT_FROM), appearance);
  const to = adaptBrand(safe(input.gradientTo, DEFAULT_GRADIENT_TO), appearance);
  return {
    single,
    primary,
    accent,
    /** Legacy gradient stops — stored and adapted, but not painted on any core control. */
    from,
    to,
    primarySolid: primary,
    accentSolid: accent,
    gradient: primary,
  };
}

/**
 * Auto-generate each component's background + a readable font color, for ONE appearance. Component
 * text is UI text on a solid fill, so it targets AA (4.5:1) — comfortably above the 3:1 UI floor.
 * Primary action = primary colour (navy); active tab / selected item = accent (orange marker).
 */
export function generateComponentColors(input: ThemeInput, appearance: Appearance = "light"): Record<ThemeComponent, ComponentColor> {
  const b = brandForAppearance(input, appearance);
  const n = NEUTRALS[appearance];
  // Badge is a soft tint: toward white on light, toward the elevated dark surface on dark — mixing
  // toward white in dark mode is exactly what made badges glare/wash out before.
  const badgeBg = appearance === "dark" ? mixHex(b.accentSolid, n.surfaceElevated, 0.74) : mixHex(b.accentSolid, "#ffffff", 0.86);
  const onPrimary = suggestReadableFg(b.primarySolid, readableForeground(b.primarySolid));
  const onAccent = suggestReadableFg(b.accentSolid, readableForeground(b.accentSolid));
  return {
    primaryButton: { bg: b.primarySolid, fg: onPrimary },
    accentButton: { bg: b.accentSolid, fg: onAccent },
    activeTab: { bg: b.accentSolid, fg: onAccent },
    selectedItem: { bg: b.accentSolid, fg: onAccent },
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

  const accentBg = HEX_COLOR.test(comp.accentButton.bg) ? comp.accentButton.bg : b.accentSolid;

  return {
    "--background": n.background,
    "--surface": n.surface,
    "--surface-elevated": n.surfaceElevated,
    "--text-primary": n.textPrimary,
    "--text-secondary": n.textSecondary,
    "--text-muted": n.textMuted,
    "--border": n.border,
    "--input-background": n.inputBackground,

    // Canonical Navy Command names; the legacy names below are kept for existing consumers.
    "--primary": primaryBg,
    "--primary-foreground": comp.primaryButton.fg,
    "--accent": accentBg,
    "--accent-foreground": comp.accentButton.fg,
    "--focus": dark ? lighten(b.accentSolid, 0.1) : darken(b.accentSolid, 0.15),

    "--primary-background": comp.primaryButton.bg,
    "--primary-text": comp.primaryButton.fg,
    "--primary-hover": hover(primaryBg),
    "--accent-background": comp.accentButton.bg,
    "--accent-text": comp.accentButton.fg,
    "--accent-hover": hover(accentBg),

    "--active-tab-background": comp.activeTab.bg,
    "--active-tab-text": comp.activeTab.fg,
    "--selected-item-background": comp.selectedItem.bg,
    "--selected-item-text": comp.selectedItem.fg,
    "--badge-background": comp.badge.bg,
    "--badge-text": comp.badge.fg,

    "--focus-ring": rgba(b.accentSolid, dark ? 0.5 : 0.35),
    "--disabled-background": n.disabledBackground,
    "--disabled-text": n.disabledText,
  };
}

/**
 * Is this the untouched default theme? (then we inject nothing and globals.css paints the stock Navy
 * Command palette exactly.) Judged on the EFFECTIVE solid colours, so a gradient-mode org with the
 * default stops and a single-mode org on Elite navy/orange are both default.
 */
export function isDefaultTheme(input: ThemeInput): boolean {
  const ov = normalizeOverrides(input.overrides);
  const noOverrides = !Object.keys(ov.light ?? {}).length && !Object.keys(ov.dark ?? {}).length;
  const single = input.mode === "single";
  const primary = safe(input.primaryColor, DEFAULT_PRIMARY).toLowerCase();
  const accent = (single ? safe(input.accentColor, DEFAULT_ACCENT) : safe(input.gradientTo, DEFAULT_GRADIENT_TO)).toLowerCase();
  return noOverrides && primary === DEFAULT_PRIMARY.toLowerCase() && accent === DEFAULT_ACCENT.toLowerCase();
}

// Selector each component maps to in the real app (drives the whole app from the one stylesheet).
const COMPONENT_SELECTORS: Record<ThemeComponent, string> = {
  primaryButton: ".btn-primary",
  accentButton: ".btn-accent",
  activeTab: '[role="tab"][data-state="active"], .tab.active, .doc-tabbar button.active',
  selectedItem: ".nav-item.active",
  badge: ".badge-accent, .pill-accent",
};

/** The brand + semantic variables for one appearance, as a name → value map. */
function varMap(input: ThemeInput, appearance: Appearance): Record<string, string> {
  const b = brandForAppearance(input, appearance);
  const tokens = buildSemanticTokens(input, appearance);
  return {
    "--brand-orange": b.accentSolid,
    "--brand-orange-light": lighten(b.accentSolid, 0.25),
    "--brand-gradient": b.accentSolid, // legacy token, solid (D-04)
    "--brand-primary": b.primarySolid,
    "--brand-primary-foreground": tokens["--primary-text"],
    "--brand-accent": b.accentSolid,
    "--brand-accent-foreground": tokens["--accent-text"],
    "--sidebar-active-bg": tokens["--selected-item-background"],
    "--accent-orange-bg": rgba(b.accentSolid, appearance === "dark" ? 0.22 : 0.14),
    "--accent-tint": rgba(b.accentSolid, appearance === "dark" ? 0.22 : 0.14),
    "--chart-navy": appearance === "dark" ? b.accentSolid : b.primarySolid,
    ...tokens,
  };
}

/**
 * Build the injected stylesheet: ONE :root block in which every variable is `light-dark(light,
 * dark)`, exactly like globals.css, so the org theme follows the same color-scheme switch and there
 * is no second (or third) dark block to drift. Light and dark values are still calculated
 * separately. Component rules use the same form; every value is a solid colour (D-04).
 */
export function buildThemeOverrideCss(input: ThemeInput): string {
  if (isDefaultTheme(input)) return "";
  const light = varMap(input, "light");
  const dark = varMap(input, "dark");
  const vars = Object.keys(light).map((k) => (light[k] === dark[k] ? `${k}:${light[k]};` : `${k}:light-dark(${light[k]}, ${dark[k]});`)).join("");

  const rl = resolveComponentColors(input, "light");
  const rd = resolveComponentColors(input, "dark");
  const pair = (l: string, d: string) => (l === d ? l : `light-dark(${l}, ${d})`);
  const rules = THEME_COMPONENTS.map(
    (c) => `${COMPONENT_SELECTORS[c]}{background:${pair(rl[c].bg, rd[c].bg)} !important;color:${pair(rl[c].fg, rd[c].fg)} !important;}`,
  ).join("");

  return `:root{${vars}}\n${rules}`;
}

// ---- contrast audit -------------------------------------------------------
// What the Color Theme panel shows. Every figure is measured from the colours the preview actually
// paints: manual overrides where the org set them, generated values everywhere else, gradients
// sampled across their sweep, and light/dark evaluated independently.

/** Everything audited in one appearance. `sidebarActive` mirrors the sidebar's real token pair. */
export const AUDITED_COMPONENTS = [...THEME_COMPONENTS, "sidebarActive"] as const;
export type AuditedComponent = (typeof AUDITED_COMPONENTS)[number];

export type ComponentContrast = {
  component: AuditedComponent;
  appearance: Appearance;
  /** Background as declared — may be a gradient. */
  bg: string;
  fg: string;
  /** Lowest ratio across the background (all gradient samples). */
  ratio: number;
  /** Every sampled ratio, start → end. One entry for a solid background. */
  samples: number[];
  /** Minimum this pair must reach (4.5 normal text). */
  required: number;
  passes: boolean;
  /** Component background against the page surface — WCAG 1.4.11 non-text contrast, 3:1. */
  boundaryRatio: number;
  boundaryRequired: number;
  boundaryPasses: boolean;
  /** True when the background is a gradient and was sampled across its stops. */
  gradient: boolean;
};

/** The declared background/foreground of one audited component in one appearance. */
export function auditedPair(input: ThemeInput, appearance: Appearance, comp: AuditedComponent): ComponentColor {
  if (comp === "sidebarActive") {
    // The sidebar's active pill is painted from the Selected item tokens — audit what it renders.
    const sel = resolveComponentColors(input, appearance).selectedItem;
    return { bg: sel.bg, fg: sel.fg };
  }
  return resolveComponentColors(input, appearance)[comp];
}

/** Measure one component in one appearance. */
export function componentContrast(input: ThemeInput, appearance: Appearance, comp: AuditedComponent): ComponentContrast {
  const { bg, fg } = auditedPair(input, appearance, comp);
  const surface = NEUTRALS[appearance].surface;
  // Translucent component backgrounds are composited over the page surface before measuring.
  const g = contrastOverGradient(fg, bg, { surface });
  const boundary = contrastOverGradient(bg, surface, { surface });
  return {
    component: comp,
    appearance,
    bg,
    fg,
    ratio: g.ratio,
    samples: g.samples,
    required: CONTRAST_NORMAL_TEXT,
    passes: meets(g.ratio, CONTRAST_NORMAL_TEXT),
    boundaryRatio: boundary.ratio,
    boundaryRequired: CONTRAST_LARGE_TEXT,
    boundaryPasses: meets(boundary.ratio, CONTRAST_LARGE_TEXT),
    gradient: isGradient(bg),
  };
}

/** Every component in both appearances — light and dark are computed independently. */
export function auditTheme(input: ThemeInput): ComponentContrast[] {
  return APPEARANCES.flatMap((ap) => AUDITED_COMPONENTS.map((c) => componentContrast(input, ap, c)));
}

/** Ratio formatted the way the warning shows it ("2.4:1"). */
export { formatRatio };
