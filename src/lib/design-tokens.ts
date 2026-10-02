// Navy Command design tokens (DEV-UI-01.1) — the ONE source of the core palette.
//
// globals.css declares each colour token ONCE as `light-dark(<light>, <dark>)`, and these
// constants are what that declaration must contain: verify-contrast parses globals.css and fails if
// the two drift, then measures every pairing below against WCAG. brand-theme.ts reads NEUTRALS from
// here, so the per-org theme engine calculates against exactly what is painted.
//
// Direction (owner decisions D-02…D-04): dark navy structure, a light restrained work area, solid
// colours only, navy primary actions with white text, orange as accent / focus / active marker.

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
  /** Orange text that stays AA on light surfaces (raw brand orange is 2.96:1 on white). */
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
export const BRAND_ORANGE = "#e87722";

export const TOKENS: Record<Appearance, CoreTokens> = {
  light: {
    canvas: "#f5f6f8",
    surface: "#ffffff",
    surfaceSubtle: "#eef0f4",
    surfaceRaised: "#ffffff",
    text: "#17173f",
    textMuted: "#555a75",
    textFaint: "#646982",
    border: "#e2e5eb",
    borderStrong: "#c9ced8",
    borderControl: "#868ca3",
    primary: BRAND_NAVY,
    primaryForeground: "#ffffff",
    primaryHover: "#2b2c6e",
    accent: BRAND_ORANGE,
    accentForeground: "#17173f",
    accentInk: "#a9500c",
    accentTint: "#fdf0e6",
    focus: "#c55f0e",
    link: BRAND_NAVY,
    success: "#17734a",
    successTint: "#e3f2ea",
    warning: "#8a5a00",
    warningTint: "#fbf0d9",
    danger: "#b4322d",
    dangerTint: "#fbe6e4",
    dangerForeground: "#ffffff",
    dangerHover: "#992b26",
    info: "#2f4fb8",
    infoTint: "#e7ecfa",
    corrective: "#5b3fb8",
    correctiveTint: "#eeeafb",
    neutral: "#4f546e",
    neutralTint: "#eceef3",
    disabledBackground: "#eceef2",
    disabledText: "#6b6f86",
  },
  dark: {
    canvas: "#090b17",
    surface: "#171b31",
    surfaceSubtle: "#1e2239",
    surfaceRaised: "#20253f",
    text: "#eceef7",
    textMuted: "#a9aecb",
    textFaint: "#959bbb",
    border: "#2b3050",
    borderStrong: "#3c4268",
    borderControl: "#646b8f",
    // Navy itself vanishes on a navy-black canvas; this keeps the hue, carries white text at 5.15:1
    // and stands 3.30:1 off the surface.
    primary: "#5a60d6",
    primaryForeground: "#ffffff",
    primaryHover: "#4e54c8",
    accent: "#f0924a",
    accentForeground: "#17173f",
    accentInk: "#f5a868",
    accentTint: "#3a2615",
    focus: "#f0924a",
    link: "#a9b0ff",
    success: "#5fcf9a",
    successTint: "#13301f",
    warning: "#f0c060",
    warningTint: "#33270a",
    danger: "#f08a83",
    dangerTint: "#3a1716",
    dangerForeground: "#17173f",
    dangerHover: "#f29c96",
    info: "#93a6f0",
    infoTint: "#19203f",
    corrective: "#b3a3f5",
    correctiveTint: "#251d45",
    neutral: "#b3b7cf",
    neutralTint: "#232741",
    disabledBackground: "#1f2338",
    disabledText: "#9a9fbd",
  },
};

/** CSS custom-property name for each token (the canonical Navy Command names). */
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

/** Nine-step type scale (DEV-UI-00 §7.1). Line heights are Latin / Arabic. */
export const TYPE_SCALE = {
  caption: { size: 11, line: 16, lineAr: 18 },
  "body-sm": { size: 12, line: 16, lineAr: 20 },
  body: { size: 13, line: 20, lineAr: 22 },
  "body-lg": { size: 14, line: 20, lineAr: 24 },
  "title-sm": { size: 16, line: 24, lineAr: 26 },
  title: { size: 18, line: 26, lineAr: 28 },
  page: { size: 20, line: 28, lineAr: 32 },
  "display-sm": { size: 24, line: 32, lineAr: 36 },
  display: { size: 30, line: 38, lineAr: 44 },
} as const;

export const SPACING_PX = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;
export const RADIUS_PX = { sm: 4, md: 6, lg: 8, xl: 12 } as const;
