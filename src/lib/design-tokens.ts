// Elite ERP × Lead Capture Pro design tokens — the ONE source of the core palette.
//
// globals.css declares each colour token ONCE as `light-dark(<light>, <dark>)`, and these
// constants are what that declaration must contain: verify-contrast parses globals.css and fails if
// the two drift, then measures every pairing below against WCAG. brand-theme.ts reads NEUTRALS from
// here, so the per-org theme engine calculates against exactly what is painted.
//
// Direction (LCP design adoption, docs/design-system/ERP_LCP_TOKEN_MAP.md): the Lead Capture Pro WEB
// palette, resolved from its HSL triplets into HEX — cool-neutral light workspace (#F9FAFB canvas,
// white cards), charcoal dark mode, the LCP web orange (#FF6600) as the primary action, focus and
// active marker. Where an LCP value fails this codebase's WCAG checks it is moved along its own hue
// until it passes, and the deviation is recorded in the token map — with one owner-decided exception:
//   * primary fill: dark mode renders #FF6600 exactly; light mode renders #F06000, the org-theme
//     engine's own 3:1 adaptation of #FF6600 against white (#FF6600 itself is 2.94:1);
//   * text on the orange is WHITE, as the LCP design system specifies (--primary-foreground 0 0% 100%) —
//     the owner's decision. It measures 3.29:1 on the light #F06000 and 2.94:1 on #FF6600, below the
//     4.5:1 AA minimum for body-size text; verify-contrast measures and reports it rather than passing it;
//   * warning / danger / control borders darkened (light) or lightened (dark) until AA / 3:1;
//   * dark cards lifted from #212121 to #272727 so canvas and surface stay ≥ 1.15:1 apart.
// Supersedes the Navy Command palette (DEV-UI-01.1, owner decisions D-02…D-04) by the owner's LCP
// design direction; Elite navy stays a brand constant (BRAND_NAVY) for the logo and brand panels.

export type Appearance = "light" | "dark";

export type CoreTokens = {
  canvas: string;
  surface: string;
  surfaceSubtle: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  borderStrong: string;
  /** Boundary of form controls — 3:1 against the surfaces it sits on (WCAG 1.4.11). */
  borderControl: string;
  primary: string;
  primaryForeground: string;
  primaryHover: string;
  accent: string;
  accentForeground: string;
  /** Orange text that stays AA on light surfaces (raw LCP orange is 2.94:1 on white). */
  accentInk: string;
  accentTint: string;
  focus: string;
  link: string;
  success: string;
  successTint: string;
  warning: string;
  warningTint: string;
  danger: string;
  dangerTint: string;
  dangerForeground: string;
  /** Hover fill of the solid destructive button (DEV-UI-01.4-C1): --danger mixed 15% toward black in
   *  light, 15% toward white in dark — away from the foreground, so the label gains contrast. */
  dangerHover: string;
  info: string;
  infoTint: string;
  corrective: string;
  correctiveTint: string;
  neutral: string;
  neutralTint: string;
  disabledBackground: string;
  disabledText: string;
};

export const BRAND_NAVY = "#1b1b4e";
/** Legacy Elite orange — the stored default accent of every org row (orgs.accent_color default). */
export const BRAND_ORANGE = "#e87722";
/** The Lead Capture Pro web primary as rendered by the reference product (HSL 24 100% 50%). */
export const LCP_ORANGE = "#ff6600";
/** Text colour on the orange fills: white, as the LCP design system specifies (owner decision; token map D-LCP-2). */
export const ON_ORANGE = "#ffffff";
/** The org-theme engine's INK (brand-theme.ts): the dark label for light fills, e.g. the dark-mode danger. */
export const INK_LABEL = "#17173f";

export const TOKENS: Record<Appearance, CoreTokens> = {
  light: {
    canvas: "#f9fafb",
    surface: "#ffffff",
    surfaceSubtle: "#f3f4f6",
    surfaceRaised: "#ffffff",
    text: "#212121",
    textMuted: "#676f7e",
    // LCP has one secondary text level; the faint step is kept as a name and given the same AA value.
    textFaint: "#676f7e",
    border: "#e2e4e9",
    borderStrong: "#cbcfd7",
    // LCP inputs use the 1.27:1 hairline; a control boundary must reach 3:1 (WCAG 1.4.11).
    borderControl: "#878e9b",
    primary: "#f06000",
    primaryForeground: ON_ORANGE,
    primaryHover: "#e65c00",
    accent: "#f06000",
    accentForeground: ON_ORANGE,
    accentInk: "#b84900",
    accentTint: "#fff0e5",
    focus: "#f06000",
    link: "#b84900",
    success: "#157f3c",
    successTint: "#ebfaf0",
    warning: "#9f5704",
    warningTint: "#fef5dc",
    danger: "#c52020",
    dangerTint: "#feecec",
    dangerForeground: "#ffffff",
    dangerHover: "#a71b1b",
    info: "#0a5adb",
    infoTint: "#e6f1fe",
    corrective: "#5b3fb8",
    correctiveTint: "#eeeafb",
    neutral: "#676f7e",
    neutralTint: "#f3f4f6",
    disabledBackground: "#f3f4f6",
    disabledText: "#7c8494",
  },
  dark: {
    canvas: "#1a1a1a",
    // LCP's #212121 card is 1.08:1 from its canvas; lifted until the two surfaces are ≥ 1.15:1 apart.
    surface: "#272727",
    surfaceSubtle: "#333333",
    surfaceRaised: "#2b2b2b",
    text: "#f9fafb",
    textMuted: "#9da3af",
    textFaint: "#9da3af",
    border: "#363636",
    borderStrong: "#454545",
    borderControl: "#7a7a7a",
    primary: LCP_ORANGE,
    primaryForeground: ON_ORANGE,
    primaryHover: "#ff7b24",
    accent: LCP_ORANGE,
    accentForeground: ON_ORANGE,
    accentInk: LCP_ORANGE,
    accentTint: "#3d220f",
    focus: LCP_ORANGE,
    link: LCP_ORANGE,
    success: "#24c25e",
    successTint: "#153220",
    warning: "#fbbd23",
    warningTint: "#342714",
    danger: "#f87171",
    dangerTint: "#371515",
    dangerForeground: INK_LABEL,
    dangerHover: "#f98686",
    info: "#61a6fa",
    infoTint: "#152337",
    corrective: "#b3a3f5",
    correctiveTint: "#251d45",
    neutral: "#9da3af",
    neutralTint: "#333333",
    disabledBackground: "#2e2e2e",
    disabledText: "#8c8c8c",
  },
};

/** CSS custom-property name for each token (the canonical ERP names, unchanged by the LCP adoption). */
export const TOKEN_CSS_NAME: Record<keyof CoreTokens, string> = {
  canvas: "--canvas",
  surface: "--surface",
  surfaceSubtle: "--surface-subtle",
  surfaceRaised: "--surface-raised",
  text: "--text",
  textMuted: "--text-muted",
  textFaint: "--text-faint",
  border: "--border",
  borderStrong: "--border-strong",
  borderControl: "--border-control",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  primaryHover: "--primary-hover",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  accentInk: "--accent-ink",
  accentTint: "--accent-tint",
  focus: "--focus",
  link: "--link",
  success: "--success",
  successTint: "--success-bg",
  warning: "--warning",
  warningTint: "--warning-bg",
  danger: "--danger",
  dangerTint: "--danger-bg",
  dangerForeground: "--danger-foreground",
  dangerHover: "--danger-hover",
  info: "--info",
  infoTint: "--info-bg",
  corrective: "--corrective",
  correctiveTint: "--corrective-bg",
  neutral: "--neutral",
  neutralTint: "--neutral-bg",
  disabledBackground: "--disabled-background",
  disabledText: "--disabled-text",
};

/** Nine-step type scale (DEV-UI-00 §7.1), re-pointed to the LCP / Tailwind sizes: body and controls
 *  are 14px (LCP text-sm), so `body` and `body-lg` now share a size. Line heights are Latin / Arabic. */
export const TYPE_SCALE = {
  caption: { size: 11, line: 16, lineAr: 18 },
  "body-sm": { size: 12, line: 16, lineAr: 20 },
  body: { size: 14, line: 20, lineAr: 24 },
  "body-lg": { size: 14, line: 20, lineAr: 24 },
  "title-sm": { size: 16, line: 24, lineAr: 26 },
  title: { size: 18, line: 28, lineAr: 30 },
  page: { size: 20, line: 28, lineAr: 32 },
  "display-sm": { size: 24, line: 32, lineAr: 36 },
  display: { size: 30, line: 36, lineAr: 44 },
} as const;

export const SPACING_PX = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;
export const RADIUS_PX = { sm: 4, md: 6, lg: 8, xl: 12 } as const;
