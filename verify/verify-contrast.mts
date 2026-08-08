import {
  parseColor, blend, relativeLuminance, ratioOf, contrast, contrastOverGradient,
  gradientStops, isGradient, formatRatio, meets, CONTRAST_NORMAL_TEXT, CONTRAST_LARGE_TEXT,
} from "../src/lib/contrast";
import {
  auditTheme, componentContrast, auditedPair, AUDITED_COMPONENTS, THEME_COMPONENTS,
  contrastRatio, isReadable, NEUTRALS, resolveComponentColors, type ThemeInput,
} from "../src/lib/brand-theme";

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
check("primary button gradient is sampled, not reduced to one stop",
  lightPrimary.gradient && lightPrimary.samples.length >= 3, `${lightPrimary.samples.length} samples`);
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

let ok = true;
for (const [cond, name, extra] of results) { if (!cond) ok = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "CONTRAST VERIFICATION PASS" : "CONTRAST VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
