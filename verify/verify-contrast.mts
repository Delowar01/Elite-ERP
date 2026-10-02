import {
  parseColor, blend, relativeLuminance, ratioOf, contrast, contrastOverGradient,
  gradientStops, isGradient, formatRatio, meets, CONTRAST_NORMAL_TEXT, CONTRAST_LARGE_TEXT,
} from "../src/lib/contrast";
import {
  auditTheme, componentContrast, auditedPair, AUDITED_COMPONENTS, THEME_COMPONENTS,
  contrastRatio, isReadable, NEUTRALS, resolveComponentColors, type ThemeInput,
  buildThemeOverrideCss, isDefaultTheme, generateComponentColors, DEFAULT_PRIMARY, DEFAULT_ACCENT,
} from "../src/lib/brand-theme";
import { TOKENS, TOKEN_CSS_NAME, type CoreTokens, type Appearance } from "../src/lib/design-tokens";
import { readFileSync } from "node:fs";
import { buttonVariants } from "../src/components/ui/button";
import { cn } from "../src/lib/utils";

const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const near = (a: number, b: number, eps = 0.02) => Math.abs(a - b) < eps;

// ---------- 1. parsing every supported notation ----------
check("parses 6-digit hex", JSON.stringify(parseColor("#1B1B4E")) === JSON.stringify({ r: 27, g: 27, b: 78, a: 1 }));
check("parses 3-digit hex", JSON.stringify(parseColor("#abc")) === JSON.stringify({ r: 170, g: 187, b: 204, a: 1 }));
check("parses 8-digit hex with alpha", near(parseColor("#00000080")!.a, 0.502, 0.01));
check("parses rgb()", JSON.stringify(parseColor("rgb(255, 0, 0)")) === JSON.stringify({ r: 255, g: 0, b: 0, a: 1 }));
check("parses rgba() with alpha", near(parseColor("rgba(0,0,0,0.5)")!.a, 0.5));
check("parses modern rgb with slash alpha", near(parseColor("rgb(0 0 0 / 40%)")!.a, 0.4));
const hsl = parseColor("hsl(210, 100%, 50%)")!;
check("parses hsl()", Math.round(hsl.r) === 0 && Math.round(hsl.g) === 128 && Math.round(hsl.b) === 255, `${hsl.r},${hsl.g},${hsl.b}`);
check("parses hsla() alpha", near(parseColor("hsla(0, 0%, 0%, 0.25)")!.a, 0.25));
check("parses named colors", JSON.stringify(parseColor("white")) === JSON.stringify({ r: 255, g: 255, b: 255, a: 1 }));
check("unparseable input returns null (never silently black)", parseColor("not-a-color") === null && parseColor("") === null);

// ---------- 2. CSS variable resolution ----------
const vars = { "--brand-primary": "#1B1B4E", "--nested": "var(--brand-primary)" };
check("resolves var(--token)", JSON.stringify(parseColor("var(--brand-primary)", vars)) === JSON.stringify({ r: 27, g: 27, b: 78, a: 1 }));
check("resolves nested var()", parseColor("var(--nested)", vars)?.b === 78);
check("uses the var() fallback when unknown", parseColor("var(--missing, #ffffff)", vars)?.r === 255);
check("contrast resolves variables before measuring",
  near(contrast("var(--white, #ffffff)", "var(--brand-primary)", { vars }), contrast("#ffffff", "#1B1B4E")), "");

// ---------- 3. WCAG figures against known values ----------
check("black on white is 21:1", near(contrastRatio("#000000", "#ffffff"), 21));
check("white on white is 1:1", near(contrastRatio("#ffffff", "#ffffff"), 1));
// #767676 on white is the canonical WCAG AA boundary for normal text (4.54:1)
check("#767676 on white is ~4.54:1 (known AA boundary)", near(contrastRatio("#767676", "#ffffff"), 4.54, 0.02), String(contrastRatio("#767676", "#ffffff").toFixed(3)));
check("#949494 on white is ~3.0:1 (known AA large boundary)", near(contrastRatio("#949494", "#ffffff"), 3.03, 0.02), String(contrastRatio("#949494", "#ffffff").toFixed(3)));
// the exact case that started this: white text on the brand orange
check("white on #E87722 is ~2.96:1 (a real failure, not a pass)", near(contrastRatio("#ffffff", "#E87722"), 2.96, 0.02), String(contrastRatio("#ffffff", "#E87722").toFixed(3)));
check("luminance of white = 1, black = 0",
  near(relativeLuminance(parseColor("#ffffff")!), 1) && near(relativeLuminance(parseColor("#000000")!), 0));
check("ratio is symmetric", near(contrastRatio("#123456", "#fedcba"), contrastRatio("#fedcba", "#123456")));

// ---------- 4. rgb/hsl inputs measure the SAME as their hex equivalent (the original bug) ----------
check("rgb() measures the same as its hex twin", near(contrast("rgb(255,255,255)", "rgb(232,119,34)"), contrastRatio("#ffffff", "#E87722")));
check("hsl() measures the same as its hex twin", near(contrast("#ffffff", "hsl(0, 0%, 0%)"), 21));
check("a non-hex background is no longer measured as black",
  contrast("#ffffff", "rgb(232,119,34)") < 3.1 && contrast("#ffffff", "rgb(232,119,34)") > 2.8, String(contrast("#ffffff", "rgb(232,119,34)").toFixed(2)));

// ---------- 5. alpha blending over the real surface ----------
const halfBlack = contrast("#ffffff", "rgba(0,0,0,0.5)", { surface: "#ffffff" });
check("translucent bg blends with the surface, not treated as opaque",
  halfBlack > 1.5 && halfBlack < contrastRatio("#ffffff", "#000000"), String(halfBlack.toFixed(2)));
check("the same translucent color over a dark surface gives a different ratio",
  !near(contrast("#ffffff", "rgba(0,0,0,0.5)", { surface: "#ffffff" }), contrast("#ffffff", "rgba(0,0,0,0.5)", { surface: "#111111" })), "");
check("fully transparent bg measures against the surface alone",
  near(contrast("#000000", "rgba(0,0,0,0)", { surface: "#ffffff" }), 21));
check("translucent TEXT is composited over its background",
  contrast("rgba(255,255,255,0.5)", "#000000") < contrastRatio("#ffffff", "#000000"), "");
check("blend() math: 50% black over white is mid grey", near(blend(parseColor("rgba(0,0,0,0.5)")!, parseColor("#ffffff")!).r, 127.5, 0.6));

// ---------- 6. gradients: sample start, middle and end; use the lowest ----------
const g = "linear-gradient(135deg, #1B1B4E, #E87722)";
check("gradient detected", isGradient(g) && !isGradient("#ffffff"));
check("gradient stops parsed, direction dropped", gradientStops(g).map((x) => x.toLowerCase()).join(",") === "#1b1b4e,#e87722", gradientStops(g).join(","));
const gc = contrastOverGradient("#ffffff", g);
const atStart = contrastRatio("#ffffff", "#1B1B4E"), atEnd = contrastRatio("#ffffff", "#E87722");
check("gradient samples include start, midpoint and end", gc.samples.length >= 3, `${gc.samples.length} samples`);
check("gradient result is the LOWEST sampled ratio", near(gc.ratio, Math.min(...gc.samples)) && near(gc.ratio, Math.min(atStart, atEnd), 0.3),
  `${gc.ratio.toFixed(2)} vs start ${atStart.toFixed(2)} / end ${atEnd.toFixed(2)}`);
check("checking only one gradient stop would have passed — the sweep does not",
  atStart >= CONTRAST_NORMAL_TEXT && gc.ratio < CONTRAST_NORMAL_TEXT,
  `start ${atStart.toFixed(2)} passes, worst ${gc.ratio.toFixed(2)} fails`);
// a gradient whose ENDS are fine but whose middle is not
const gMid = "linear-gradient(90deg, #000000, #ffffff, #000000)";
const gm = contrastOverGradient("#767676", gMid);
check("a bad midpoint is caught even when both ends pass", gm.ratio < Math.max(...gm.samples), `${gm.ratio.toFixed(2)} min of ${gm.samples.length}`);
check("percentage stops parse", gradientStops("linear-gradient(90deg, #000000 0%, #ffffff 100%)").length === 2);
check("rgb stops inside a gradient parse", gradientStops("linear-gradient(90deg, rgb(0,0,0), rgba(255,255,255,0.5))").length === 2);

// ---------- 7. thresholds + formatting ----------
check("thresholds are the WCAG AA values", CONTRAST_NORMAL_TEXT === 4.5 && CONTRAST_LARGE_TEXT === 3);
check("meets() compares the true ratio", meets(4.5, 4.5) && !meets(4.49, 4.5));
check("formatRatio rounds DOWN so a shown value never overstates", formatRatio(4.549) === "4.5:1" && formatRatio(2.44) === "2.4:1", formatRatio(4.549));

// ---------- 8. theme audit: light and dark independently, overrides honoured ----------
const base: ThemeInput = {
  mode: "gradient", primaryColor: "#1B1B4E", accentColor: "#E87722",
  gradientFrom: "#1B1B4E", gradientTo: "#E87722",
};
const audit = auditTheme(base);
check("audit covers every component in both appearances", audit.length === AUDITED_COMPONENTS.length * 2, String(audit.length));
check("audit includes the sidebar active item", audit.some((a) => a.component === "sidebarActive"));
check("light and dark are measured separately",
  audit.filter((a) => a.appearance === "light").length === AUDITED_COMPONENTS.length &&
  audit.filter((a) => a.appearance === "dark").length === AUDITED_COMPONENTS.length);
const lightPrimary = componentContrast(base, "light", "primaryButton");
const darkPrimary = componentContrast(base, "dark", "primaryButton");
check("the same component can differ between modes", !near(lightPrimary.ratio, darkPrimary.ratio, 0.001) || lightPrimary.bg !== darkPrimary.bg,
  `${lightPrimary.ratio.toFixed(2)} vs ${darkPrimary.ratio.toFixed(2)}`);
// DEV-UI-01.1 / owner decision D-04 (SOLID-ONLY): this check used to assert that the primary button
// WAS a gradient and was sampled across it. The design now forbids a gradient primary in every mode,
// so the assertion is inverted rather than dropped. Gradient sampling itself stays covered by §6.
check("primary button is SOLID even in legacy gradient mode (D-04), measured as one sample",
  !lightPrimary.gradient && !darkPrimary.gradient && lightPrimary.samples.length === 1, `${lightPrimary.bg} / ${darkPrimary.bg}`);
check("every report states its own required minimum", audit.every((a) => a.required === CONTRAST_NORMAL_TEXT));
check("boundary check uses the 3:1 UI threshold", audit.every((a) => a.boundaryRequired === CONTRAST_LARGE_TEXT));
check("sidebar active mirrors the Selected item pair",
  JSON.stringify(auditedPair(base, "dark", "sidebarActive")) === JSON.stringify(resolveComponentColors(base, "dark").selectedItem));

// a deliberately low-contrast manual override in DARK ONLY
const lowDark: ThemeInput = { ...base, overrides: { dark: { accentButton: { bg: "#333333", fg: "#3a3a3a" } } } } as ThemeInput;
const lightAccent = componentContrast(lowDark, "light", "accentButton");
const darkAccent = componentContrast(lowDark, "dark", "accentButton");
check("manual override is measured, not the generated color", near(darkAccent.ratio, contrastRatio("#3a3a3a", "#333333"), 0.01), darkAccent.ratio.toFixed(2));
check("a low-contrast override is detected as failing", !darkAccent.passes && darkAccent.ratio < 1.2, formatRatio(darkAccent.ratio));
check("the other mode is unaffected by that override", lightAccent.passes || lightAccent.bg !== "#333333", `${lightAccent.bg}`);
check("generated colors are used where no override exists",
  componentContrast(lowDark, "dark", "badge").bg === resolveComponentColors(lowDark, "dark").badge.bg);

// a known-good override must pass
const goodDark: ThemeInput = { ...base, overrides: { dark: { accentButton: { bg: "#000000", fg: "#ffffff" } } } } as ThemeInput;
check("a known high-contrast override passes", componentContrast(goodDark, "dark", "accentButton").passes);
check("displayed ratio equals the WCAG calculation",
  near(componentContrast(goodDark, "dark", "accentButton").ratio, 21), formatRatio(componentContrast(goodDark, "dark", "accentButton").ratio));

// ---------- 9. warning scope naming ----------
const bothModes: ThemeInput = { ...base, overrides: { light: { badge: { bg: "#eeeeee", fg: "#efefef" } }, dark: { badge: { bg: "#222222", fg: "#232323" } } } } as ThemeInput;
const badgeFails = auditTheme(bothModes).filter((a) => a.component === "badge" && !a.passes);
check("a failure present in both modes is reported for both", badgeFails.length === 2, badgeFails.map((f) => f.appearance).join(","));

// ---------- 10. isReadable now agrees with the gradient-aware measurement ----------
check("isReadable is gradient-aware", isReadable("#ffffff", g) === meets(gc.ratio, CONTRAST_NORMAL_TEXT));
check("isReadable accepts rgb()/hsl() inputs", isReadable("rgb(255,255,255)", "rgb(0,0,0)") === true);
check("ratioOf on identical colors is exactly 1", ratioOf(parseColor("#abcdef")!, parseColor("#abcdef")!) === 1);
check("NEUTRALS surfaces differ per appearance", NEUTRALS.light.surface !== NEUTRALS.dark.surface);
check("THEME_COMPONENTS remains the overridable set of 5", THEME_COMPONENTS.length === 5 && AUDITED_COMPONENTS.length === 6);

// ---------- 11. Navy Command token layer (DEV-UI-01.1) ----------
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const keys = Object.keys(TOKEN_CSS_NAME) as (keyof CoreTokens)[];
let drift = 0;
for (const k of keys) {
  const name = TOKEN_CSS_NAME[k];
  const decl = [...css.matchAll(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "gm"))];
  const want = `light-dark(${TOKENS.light[k]}, ${TOKENS.dark[k]})`;
  if (decl.length !== 1 || decl[0][1].trim() !== want) { drift++; check(`globals.css ${name} matches design-tokens.ts`, false, decl.map((d) => d[1]).join(" | ") || "missing"); }
}
check(`all ${keys.length} canonical tokens are declared exactly once, as light-dark(), matching design-tokens.ts`, drift === 0, `${drift} drifted`);
check("ONE dark definition: no prefers-color-scheme token block in globals.css", !/prefers-color-scheme/.test(css));
const darkBlock = css.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
check("the dark selector only switches color-scheme — it redefines no token",
  !!darkBlock && !/--[a-z]/.test(darkBlock[1]) && /color-scheme:\s*dark/.test(darkBlock[1]), darkBlock?.[1].trim() ?? "missing");
check("core tokens contain no gradient", !/--(primary|accent|surface|canvas|brand-gradient)[a-z-]*:\s*[^;]*gradient\(/.test(css));

type Pair = [string, keyof CoreTokens, keyof CoreTokens, number];
const PAIRS: Pair[] = [
  ["text on canvas", "text", "canvas", 4.5],
  ["text on surface", "text", "surface", 4.5],
  ["text on surface-subtle", "text", "surfaceSubtle", 4.5],
  ["muted text on canvas", "textMuted", "canvas", 4.5],
  ["muted text on surface", "textMuted", "surface", 4.5],
  ["faint text on surface", "textFaint", "surface", 4.5],
  ["primary-foreground on primary", "primaryForeground", "primary", 4.5],
  ["primary-foreground on primary-hover", "primaryForeground", "primaryHover", 4.5],
  ["primary boundary vs surface (UI 3:1)", "primary", "surface", 3],
  ["accent-foreground on accent", "accentForeground", "accent", 4.5],
  ["accent-ink text on surface", "accentInk", "surface", 4.5],
  ["accent-ink text on canvas", "accentInk", "canvas", 4.5],
  ["link on surface", "link", "surface", 4.5],
  ["focus indicator vs surface (3:1)", "focus", "surface", 3],
  ["focus indicator vs canvas (3:1)", "focus", "canvas", 3],
  ["control border vs surface (3:1)", "borderControl", "surface", 3],
  ["success text on its tint", "success", "successTint", 4.5],
  ["success text on surface", "success", "surface", 4.5],
  ["warning text on its tint", "warning", "warningTint", 4.5],
  ["warning text on surface", "warning", "surface", 4.5],
  ["danger text on its tint", "danger", "dangerTint", 4.5],
  ["danger text on surface", "danger", "surface", 4.5],
  ["danger-foreground on danger", "dangerForeground", "danger", 4.5],
  ["danger-foreground on danger-hover", "dangerForeground", "dangerHover", 4.5],
  ["info text on its tint", "info", "infoTint", 4.5],
  ["info text on surface", "info", "surface", 4.5],
  ["corrective text on its tint", "corrective", "correctiveTint", 4.5],
  ["corrective text on surface", "corrective", "surface", 4.5],
  ["neutral text on its tint", "neutral", "neutralTint", 4.5],
  ["neutral text on surface", "neutral", "surface", 4.5],
];
for (const ap of ["light", "dark"] as Appearance[]) {
  for (const [label, fg, bg, min] of PAIRS) {
    const r = contrastRatio(TOKENS[ap][fg], TOKENS[ap][bg]);
    check(`${ap}: ${label} ≥ ${min}:1`, meets(r, min), formatRatio(r));
  }
}
check("light: primary is Elite navy with white text (D-03)", TOKENS.light.primary === "#1b1b4e" && TOKENS.light.primaryForeground === "#ffffff");
check("light: orange is the accent, not the primary fill", TOKENS.light.accent === "#e87722" && TOKENS.light.primary !== TOKENS.light.accent);
check("dark: canvas and surface are distinguishable (≥ 1.15:1)", contrastRatio(TOKENS.dark.canvas, TOKENS.dark.surface) >= 1.15, contrastRatio(TOKENS.dark.canvas, TOKENS.dark.surface).toFixed(3));
check("brand-theme NEUTRALS mirror the token source", NEUTRALS.light.surface === TOKENS.light.surface && NEUTRALS.dark.background === TOKENS.dark.canvas);

// ---------- 12. organization overrides stay contrast-safe and solid ----------
const stock: ThemeInput = { mode: "gradient", primaryColor: DEFAULT_PRIMARY, accentColor: DEFAULT_ACCENT, gradientFrom: "#F5A25C", gradientTo: "#E87722" };
check("the stock org (gradient mode, default stops) is the default theme — nothing injected", isDefaultTheme(stock) && buildThemeOverrideCss(stock) === "");
check("generated stock primary is navy with white text", generateComponentColors(stock, "light").primaryButton.bg.toLowerCase() === "#1b1b4e" && generateComponentColors(stock, "light").primaryButton.fg === "#ffffff");
// A deliberately awkward brand: pale yellow primary, teal accent.
const yellow: ThemeInput = { mode: "single", primaryColor: "#F7D44A", accentColor: "#14B8A6", gradientFrom: "#F5A25C", gradientTo: "#E87722" };
for (const ap of ["light", "dark"] as Appearance[]) {
  for (const comp of AUDITED_COMPONENTS) {
    const c = componentContrast(yellow, ap, comp);
    check(`org override (pale-yellow primary) ${ap} ${comp}: generated text passes AA`, c.passes, formatRatio(c.ratio));
  }
}
const yellowCss = buildThemeOverrideCss(yellow);
check("org override CSS is emitted as ONE :root block", (yellowCss.match(/:root\{/g) ?? []).length === 1, String((yellowCss.match(/:root\{/g) ?? []).length));
check("org override CSS has no second dark block (light-dark() inside the one block)",
  !/prefers-color-scheme|data-theme/.test(yellowCss) && /light-dark\(/.test(yellowCss));
check("org override CSS paints no gradient anywhere (D-04)", !/gradient\(/.test(yellowCss));
const customGradient: ThemeInput = { ...stock, gradientFrom: "#22C55E", gradientTo: "#15803D" };
const cg = generateComponentColors(customGradient, "light");
check("a customised legacy gradient is NOT painted — its end stop becomes the solid accent",
  !/gradient\(/.test(buildThemeOverrideCss(customGradient)) && cg.accentButton.bg.toLowerCase() === "#15803d" && cg.primaryButton.bg.toLowerCase() === "#1b1b4e",
  `${cg.accentButton.bg} / ${cg.primaryButton.bg}`);
for (const ap of ["light", "dark"] as Appearance[]) {
  for (const comp of AUDITED_COMPONENTS) {
    const c = componentContrast(customGradient, ap, comp);
    check(`org override (custom green gradient) ${ap} ${comp}: passes AA`, c.passes, formatRatio(c.ratio));
  }
}

// ---------- 12b. every light-dark() colour token is a registered <color> ----------
// An unregistered custom property holding light-dark() computes to the unresolved string in BOTH
// appearances, so anything reading tokens from script (verify-dark-theme does) sees no difference
// between light and dark. Registration makes it compute to the real per-mode colour.
const registered = new Set([...css.matchAll(/@property\s+(--[a-z0-9-]+)\s*\{\s*syntax:\s*"<color>"/g)].map((m) => m[1]));
const ldInCss = [...css.matchAll(/^\s*(--[a-z0-9-]+):\s*light-dark\(/gm)].map((m) => m[1]);
const ldInjected = [yellowCss, buildThemeOverrideCss(customGradient)].flatMap((c) => [...c.matchAll(/(--[a-z0-9-]+):light-dark\(/g)].map((m) => m[1]));
const unregistered = [...new Set([...ldInCss, ...ldInjected])].filter((n) => !registered.has(n));
check("every light-dark() colour token (globals.css + org theme CSS) is registered as @property <color>", unregistered.length === 0, unregistered.join(" ") || `${registered.size} registered`);

// ---------- 13. the button's foreground colour survives class merging ----------
// Found by the DEV-UI-01.1 screenshot comparison: tailwind-merge took the new `text-body-sm` size for
// a colour and dropped the primary label colour, leaving navy text on a navy button. Every variant ×
// size must keep exactly the foreground colour class its variant declares.
const FG: Record<string, RegExp> = {
  primary: /(^| )text-\[color:var\(--primary-foreground\)\]( |$)/,
  secondary: /(^| )text-ink( |$)/,
  glass: /(^| )text-ink( |$)/,
  ghost: /(^| )text-ink-muted( |$)/,
  destructive: /(^| )text-danger-foreground( |$)/,
  link: /(^| )text-link( |$)/,
};
let lostFg = 0;
for (const v of Object.keys(FG) as (keyof typeof FG)[]) {
  for (const size of ["default", "sm", "lg", "icon"] as const) {
    const c = cn(buttonVariants({ variant: v as "primary", size })); // exactly what <Button> renders
    if (!FG[v].test(c)) { lostFg++; check(`button ${v}/${size} keeps its foreground colour`, false, c); }
  }
}
check("every button variant × size keeps its foreground colour after merging", lostFg === 0, `${lostFg} lost`);
check("type-scale sizes and text colours are not merged into each other", cn("text-ink text-body-sm") === "text-ink text-body-sm" && cn("text-body text-title") === "text-title");

let ok = true;
for (const [cond, name, extra] of results) { if (!cond) ok = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "CONTRAST VERIFICATION PASS" : "CONTRAST VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
