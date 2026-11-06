// Elite ERP × Lead Capture Pro design adoption. Run via `npm run verify:lcp-design` (static; no database).
//
// What it pins, so the LCP adoption cannot drift or quietly regress:
//   1. palette      — the LCP web values resolved to HEX in the canonical tokens (exact where AA allows, the
//                     documented adaptation where it does not); no HSL triplet and no hsl(var(--x)) in the app
//   2. typography   — Inter 400–700 via next/font for Latin, IBM Plex Sans Arabic kept for Arabic, Mono for codes;
//                     no font binary committed
//   3. layering     — the LCP presentation layer loads last; it holds no literal colour, no physical property, and
//                     `!important` only where a pinned primitive sets the property inline
//   4. surfaces     — the LCP recipes the layer renders (card, table, page header, status pill, overlays, buttons)
//   5. contrast     — every LCP pairing introduced here, light and dark
//   6. brand        — Elite ERP / organisation identity only: no Lead Capture Pro / Card Scanner Pro wording, no
//                     Expo orange, no LCP asset
//   7. org themes   — the default / preset / custom resolution and the display-only Color Theme panel
//   8. bilingual    — every string the adoption added has an Arabic entry

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { contrast } from "../src/lib/contrast";
import { TOKENS, LCP_ORANGE, type CoreTokens } from "../src/lib/design-tokens";
import {
  displayThemeFields, isDefaultTheme, buildThemeOverrideCss, resolveComponentColors, stockComponentColors,
  DEFAULT_PRIMARY, DEFAULT_ACCENT, PRESET_MODE, PRESET_PRIMARY, PRESET_ACCENT, type ThemeInput,
} from "../src/lib/brand-theme";
import { t } from "../src/lib/i18n/dict";

const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const globals = read("src/app/globals.css");
const lcpCss = read("src/app/(app)/lcp.css");
const shellCss = read("src/app/(app)/shell.css");
const authCss = read("src/app/(auth)/auth.css");
const appLayout = read("src/app/(app)/layout.tsx");
const rootLayout = read("src/app/layout.tsx");
function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = join(dir, f);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const SRC = walk("src");

// ---------- 1. palette ----------
// [token, light, dark] — the LCP web value, resolved from its HSL triplet (lcp-tokens.css), where it passes AA as is.
const EXACT: [keyof CoreTokens, string | null, string | null][] = [
  ["canvas", "#f9fafb", "#1a1a1a"], // --background 220 20% 98% / 0 0% 10%
  ["surface", "#ffffff", null], // --card 0 0% 100% (dark lifted, below)
  ["surfaceSubtle", "#f3f4f6", null], // --muted 220 14% 96%
  ["text", "#212121", "#f9fafb"], // --foreground 0 0% 13% / 220 20% 98%
  ["textMuted", "#676f7e", "#9da3af"], // --muted-foreground 220 10% 45% / 65%
  ["border", "#e2e4e9", null], // --border 220 14% 90%
  ["accentTint", "#fff0e5", "#3d220f"], // --primary-soft 24 100% 95% / 24 60% 15%
  ["success", "#157f3c", "#24c25e"], ["successTint", "#ebfaf0", "#153220"],
  ["warningTint", "#fef5dc", "#342714"], ["warning", null, "#fbbd23"],
  ["info", "#0a5adb", "#61a6fa"], ["infoTint", "#e6f1fe", "#152337"],
  ["dangerTint", "#feecec", "#371515"],
  ["primary", null, LCP_ORANGE], ["focus", null, LCP_ORANGE],
];
const exactBad = EXACT.flatMap(([k, l, d]) => [l !== null && TOKENS.light[k] !== l ? `light ${k}=${TOKENS.light[k]}≠${l}` : "", d !== null && TOKENS.dark[k] !== d ? `dark ${k}=${TOKENS.dark[k]}≠${d}` : ""]).filter(Boolean);
check(`the LCP web palette is in the canonical tokens where it passes AA as is (${EXACT.length} tokens)`, exactBad.length === 0, exactBad.join(" "));
// The documented adaptations (ERP_LCP_TOKEN_MAP.md §6), each with the reason it exists.
check("adaptation: light primary #F06000 because #FF6600 is below 3:1 on white", TOKENS.light.primary === "#f06000" && contrast(LCP_ORANGE, "#ffffff") < 3 && contrast(TOKENS.light.primary, "#ffffff") >= 3);
check("adaptation: INK on the orange because white on #FF6600 is 2.94:1", contrast("#ffffff", LCP_ORANGE) < 3 && TOKENS.light.primaryForeground === "#17173f" && TOKENS.dark.primaryForeground === "#17173f");
check("adaptation: light warning / danger darkened, dark danger lightened (LCP values fail 4.5)",
  contrast("#bd6705", "#ffffff") < 4.5 && contrast("#ef4343", "#ffffff") < 4.5 && contrast("#ef4343", TOKENS.dark.surface) < 4.5 &&
  contrast(TOKENS.light.warning, TOKENS.light.warningTint) >= 4.5 && contrast(TOKENS.light.danger, TOKENS.light.dangerTint) >= 4.5 && contrast(TOKENS.dark.danger, TOKENS.dark.surface) >= 4.5);
check("adaptation: dark card #272727 because LCP's #212121 is only 1.08:1 from its canvas", contrast("#212121", "#1a1a1a") < 1.15 && TOKENS.dark.surface === "#272727" && contrast(TOKENS.dark.surface, TOKENS.dark.canvas) >= 1.15);
check("adaptation: control borders reach 3:1 (the LCP input hairline is 1.27:1)", contrast("#e2e4e9", "#ffffff") < 3 && contrast(TOKENS.light.borderControl, TOKENS.light.surface) >= 3 && contrast(TOKENS.dark.borderControl, TOKENS.dark.surface) >= 3);
const triplets = noComments(globals).match(/--[a-z0-9-]+:\s*\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%\s*;/g) ?? [];
check("no bare HSL triplet token (the LCP `24 100% 50%` form is not a valid registered <color>)", triplets.length === 0, triplets.join(" "));
const hslVar = SRC.filter((f) => /\.(css|tsx?)$/.test(f) && /hsl\(var\(--/.test(read(f)));
check("no hsl(var(--token)) consumer anywhere in src (no LCP stylesheet was pasted)", hslVar.length === 0, hslVar.join(" "));
const REGISTERED = ["--header-bg", "--header-ink", "--header-border", "--header-accent", "--shadow-color-soft", "--brand-ink"];
check("the new shell / brand colour tokens are registered <color>s (computed values resolve per appearance)",
  REGISTERED.every((n) => new RegExp(`@property ${n} \\{ syntax: "<color>"`).test(globals)), REGISTERED.filter((n) => !new RegExp(`@property ${n} \\{`).test(globals)).join(" "));

// ---------- 2. typography ----------
check("Latin UI is Inter (next/font, self-hosted at build), weights 400 / 500 / 600 / 700, on --font-body-raw",
  /import \{ Inter, IBM_Plex_Sans_Arabic, IBM_Plex_Mono \} from "next\/font\/google";/.test(rootLayout) &&
  /const body = Inter\(\{\s*variable: "--font-body-raw",\s*subsets: \["latin"\],\s*weight: \["400", "500", "600", "700"\],\s*\}\);/.test(rootLayout));
check("Arabic keeps IBM Plex Sans Arabic after the Latin face (Inter ships no Arabic), now with 700 for bold titles",
  /const arabic = IBM_Plex_Sans_Arabic\(\{\s*variable: "--font-arabic-raw",\s*subsets: \["arabic"\],\s*weight: \["400", "500", "600", "700"\],/.test(rootLayout) &&
  /--font-ui: var\(--font-body-raw\), var\(--font-arabic-raw\)/.test(globals));
const fontBinaries = [...walk("public"), ...SRC].filter((f) => /\.(ttf|otf|woff2?)$/i.test(f));
check("no font binary is committed (the kit's Inter files are not bundled)", fontBinaries.length === 0, fontBinaries.join(" "));
check("type scale re-pointed to the LCP sizes: body / controls 14px, title 18/28, display 30/36",
  /--text-body: 14px;/.test(globals) && /--text-title--line-height: 28px;/.test(globals) && /--text-display--line-height: 36px;/.test(globals));

// ---------- 3. layering ----------
const order = ["./mockup-parity.css", "./shell.css", "./lcp.css"].map((f) => appLayout.indexOf(`import "${f}";`));
check("the (app) layout loads mockup-parity.css, then shell.css, then the LCP layer last", order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], order.join(","));
check("the authentication layout loads its own LCP stylesheet", /import "\.\/auth\.css";/.test(read("src/app/(auth)/layout.tsx")));
for (const [name, css] of [["lcp.css", lcpCss], ["auth.css", authCss], ["shell.css", shellCss]] as const) {
  const c = noComments(css);
  const literal = c.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) ?? [];
  check(`${name}: colours are tokens only (no hex / rgb / hsl literal)`, literal.length === 0, literal.join(" "));
  const physical = c.match(/(^|[\s;{])(margin|padding|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:|text-align:\s*(left|right)|float\s*:/g) ?? [];
  check(`${name}: logical properties only (mirrors in Arabic without [dir] rules)`, physical.length === 0, physical.join(" "));
}
const important = [...noComments(lcpCss).matchAll(/([^{}]+)\{[^}]*!important[^}]*\}/g)].map((m) => m[1].trim());
check("lcp.css: !important only where the pinned StatRow sets the property inline", important.length > 0 && important.every((sel) => /^\.stat-row-2\b/.test(sel)), important.join(" | "));
check("the legacy stylesheet and the pinned primitives are not edited by the LCP stage (the layer restyles them)",
  !/LCP/.test(read("src/app/(app)/mockup-parity.css")) && !/LCP/.test(read("src/components/ui/card.tsx")) && !/LCP/.test(read("src/app/(app)/sales/_shared/stat-row.tsx")));

// ---------- 4. surfaces (the LCP recipes) ----------
const rule = (css: string, sel: string) => noComments(css).match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
check("card: LCP rounded-xl (12px), the hairline and shadow-sm", /border-radius:\s*12px/.test(rule(lcpCss, ".card")) && /box-shadow:\s*var\(--shadow-sm\)/.test(rule(lcpCss, ".card")));
const th = rule(lcpCss, "table.data-table thead th");
check("data table header: LCP sentence case, 14px, medium, muted, on the card", /text-transform:\s*none/.test(th) && /font-size:\s*var\(--text-body\)/.test(th) && /font-weight:\s*500/.test(th) && /color:\s*var\(--ink-muted\)/.test(th), th.trim());
const ph = rule(lcpCss, '[data-slot="page-header"] h1');
check("page title: LCP 24px bold (display-sm, 700)", /font-size:\s*var\(--text-display-sm\)/.test(ph) && /font-weight:\s*700/.test(ph), ph.trim());
check("list-page header actions are LCP pills (rounded-full, 40px), icon buttons excluded", /\[data-slot="page-header-actions"\] \[data-slot="button"\]:not\(\[class\*="size-\("\]\) \{[^}]*border-radius:\s*9999px/.test(noComments(lcpCss)));
check("empty state: LCP dashed container on a half-card fill", /border-style:\s*dashed/.test(rule(lcpCss, '[data-slot="empty-state"]')));
check("document line items: the LCP muted table header replaces the orange gradient band", /background:\s*var\(--surface-subtle\)/.test(rule(lcpCss, "table.doc-items-table thead th")));
const dialog = read("src/components/ui/dialog.tsx"), drawer = read("src/components/ui/drawer.tsx");
check("dialog and sheet overlays: LCP bg-black/80, no blur", /bg-black\/80/.test(dialog) && /bg-black\/80/.test(drawer) && !/backdrop-blur/.test(dialog + drawer));
const button = read("src/components/ui/button.tsx");
check("button: the primary carries the LCP primary border; secondary / outline the LCP shadow-xs; 16px inline padding",
  /primary:\s*\n\s*"[^"]*border-\[color:var\(--primary-hover\)\]!/.test(button) && /secondary:\s*\n\s*"[^"]*shadow-xs/.test(button) && /outline: "[^"]*shadow-xs/.test(button) && /default: "h-\(--control-height\) px-4"/.test(button));

// ---------- 5. contrast (LCP pairings introduced by this stage) ----------
for (const ap of ["light", "dark"] as const) {
  const k = TOKENS[ap];
  const pairs: [string, string, string, number][] = [
    ["orange ink on its tint (badge, selected menu)", k.accentInk, k.accentTint, 4.5],
    ["orange ink on the canvas", k.accentInk, k.canvas, 4.5],
    ["table header (muted) on the card", k.textMuted, k.surface, 4.5],
    ["line-item header (muted) on the subtle fill", k.textMuted, k.surfaceSubtle, 4.5],
    ["raised surface text (menus, dialogs)", k.text, k.surfaceRaised, 4.5],
    ["muted text on raised surfaces", k.textMuted, k.surfaceRaised, 4.5],
    ["INK on the primary hover", k.primaryForeground, k.primaryHover, 4.5],
  ];
  for (const [label, fg, bg, min] of pairs) check(`${ap}: ${label} ≥ ${min}:1`, contrast(fg, bg) >= min, contrast(fg, bg).toFixed(2));
}
check("auth brand panel: header ink on the panel ≥ 4.5 in both appearances (#1a1c2e / #212121)", contrast("#f9fafb", "#1a1c2e") >= 4.5 && contrast("#f9fafb", "#212121") >= 4.5);
check("Elite lockup ink on the form surface ≥ 4.5 (navy on white; page ink on the dark card)", contrast("#1b1b4e", TOKENS.light.surface) >= 4.5 && contrast("#f9fafb", TOKENS.dark.surface) >= 4.5 &&
  /--brand-ink: light-dark\(#1b1b4e, #f9fafb\);/.test(globals));

// ---------- 6. brand ----------
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const lcpWording = SRC.filter((f) => /\.(tsx?|css)$/.test(f) && /Lead Capture|Card Scanner|CardScanner/i.test(code(f)));
check("no Lead Capture Pro / Card Scanner Pro wording in any user-facing source (comments excepted)", lcpWording.length === 0, lcpWording.join(" "));
const expo = SRC.filter((f) => /\.(tsx?|css)$/.test(f) && /#ff6b00/i.test(read(f)));
check("no Expo orange (#FF6B00) anywhere in src", expo.length === 0, expo.join(" "));
check("Elite ERP identity kept: the metadata title, the Elite mark in the brand slot, 'Elite ERP' in the sidebar footer, the Elite lockup on sign-in",
  /title: "Elite ERP"/.test(rootLayout) && /LogoMark/.test(read("src/components/layout/brand-mark.tsx")) && /Elite ERP/.test(read("src/components/layout/sidebar.tsx")) &&
  /<LogoLockup ink="var\(--brand-ink\)"/.test(read("src/app/(auth)/login/login-form.tsx")) && /<LogoLockup ink="#ffffff"/.test(read("src/app/(auth)/layout.tsx")));
check("no LCP asset in public/ (logo, favicon, screenshots)", !walk("public").some((f) => /lcp|lead-?capture|card-?scanner/i.test(f)));
check("the design kit is not in the repository", !existsSync(join(ROOT, "Elite-ERP-LCP-Design-System-Kit")) && !walk("docs").some((f) => /\.(webp|png)$/i.test(f) && /lcp/i.test(f)));

// ---------- 7. org themes ----------
const stored: ThemeInput = { mode: "gradient", primaryColor: DEFAULT_PRIMARY, accentColor: DEFAULT_ACCENT, gradientFrom: "#F5A25C", gradientTo: "#E87722" };
const custom: ThemeInput = { mode: "single", primaryColor: "#0E7C66", accentColor: "#7A1FA2", gradientFrom: "#F5A25C", gradientTo: "#E87722" };
check("the DB column defaults are untouched (#1B1B4E / #E87722 / gradient) — no data migration", /primaryColor: text\("primary_color"\)\.notNull\(\)\.default\("#1B1B4E"\)/.test(read("src/db/schema/orgs.ts")) &&
  /accentColor: text\("accent_color"\)\.notNull\(\)\.default\("#E87722"\)/.test(read("src/db/schema/orgs.ts")) && /colorThemeMode: text\("color_theme_mode"\)\.notNull\(\)\.default\("gradient"\)/.test(read("src/db/schema/orgs.ts")));
check("an untouched org shows the LCP preset in the panel (display only)", JSON.stringify(displayThemeFields(stored)) === JSON.stringify({ mode: PRESET_MODE, primaryColor: PRESET_PRIMARY, accentColor: PRESET_ACCENT }));
check("a customised org is shown exactly as stored", JSON.stringify(displayThemeFields(custom)) === JSON.stringify({ mode: "single", primaryColor: "#0E7C66", accentColor: "#7A1FA2" }));
check("the panel starts from displayThemeFields and writes only through its Save action",
  /displayThemeFields\(\{/.test(read("src/app/(app)/settings/organization/company-panels.tsx")) && (read("src/app/(app)/settings/organization/company-panels.tsx").match(/updateColorThemeAction\(/g) ?? []).length === 1);
check("default and preset inject nothing; a custom theme still injects its generated palette",
  isDefaultTheme(stored) && buildThemeOverrideCss(stored) === "" && buildThemeOverrideCss({ ...stored, mode: PRESET_MODE, primaryColor: PRESET_PRIMARY, accentColor: PRESET_ACCENT }) === "" &&
  /:root\{/.test(buildThemeOverrideCss(custom)));
check("custom themes keep AA on every component in both appearances (the engine guarantees it)",
  (["light", "dark"] as const).every((ap) => Object.values(resolveComponentColors(custom, ap)).every((c) => contrast(c.fg, c.bg) >= 4.5)));
check("default themes preview exactly the painted stock colours", JSON.stringify(resolveComponentColors(stored, "dark")) === JSON.stringify(stockComponentColors("dark")));

// ---------- 7b. the dev-only specimen route ----------
const specimen = read("src/app/(app)/design-system/page.tsx");
check("specimen: /design-system answers 404 in production unless ELITE_DESIGN_SPECIMEN=1 (development / review builds only)",
  /if \(process\.env\.NODE_ENV === "production" && process\.env\.ELITE_DESIGN_SPECIMEN !== "1"\) notFound\(\);/.test(specimen));
check("specimen: not in the navigation, reads and writes no data (no db, no server action, no fetch)",
  !read("src/components/layout/nav-config.ts").includes("/design-system") && !/@\/db|actions"|fetch\(|"use server"/.test(specimen));
check("specimen: renders the real shared components (Button, Card, Input, Tabs, Table, StatusBadge, EmptyState, StatRow) and the live tokens",
  ["Button", "Card", "Input", "Tabs", "Table", "StatusBadge", "EmptyState", "StatRow"].every((c) => new RegExp(`<${c}\\b`).test(specimen)) && /TOKEN_CSS_NAME/.test(specimen));

// ---------- 8. bilingual ----------
const specimenKeys = [...specimen.matchAll(/\bt\(locale, "((?:[^"\\]|\\.)+)"\)/g)].map((m) => m[1]);
const ADDED = ["Collapse", "Expand", "About Elite ERP", "Every part of your business, in one place.",
  "Sales, purchasing, inventory, finance and people — in English and Arabic.", "Bilingual from the first screen",
  "Every screen works in English and in Arabic, right to left.", ...specimenKeys];
const missing = ADDED.filter((k) => t("ar", k) === k || !/[؀-ۿ]/.test(t("ar", k)));
check("every string the LCP adoption added has a native Arabic entry", missing.length === 0, missing.join(" | "));

let ok = true;
for (const [cond, name, extra] of results) {
  if (!cond) ok = false;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "LCP DESIGN VERIFICATION PASS" : "LCP DESIGN VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
