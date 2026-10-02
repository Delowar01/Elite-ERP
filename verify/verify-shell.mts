// App shell (DEV-UI-01.3). Run via `npm run verify:shell` — deliberately WITHOUT
// --conditions=react-server: it server-renders the real <NavList>, which needs the ordinary React build.
//
// What it pins, so the shell cannot drift back:
//   1. structure     — skip link, main#main-content, a labelled <nav> landmark, the shell title is not
//                      an <h1> (pages own their heading), the Settings gear is owner/admin only
//   2. navigation    — ONE configuration (NAV_GROUPS), ONE role filter, ONE renderer (NavList) shared by
//                      the sidebar and the drawer; single-item groups flattened; unique icons; aria
//   3. language      — EN | ع in the top bar itself, no flag emoji, pressed state
//   4. title         — the shell-title resolver (/recycle-bin and nested routes)
//   5. styling       — shell.css on tokens: logical properties, no gradient, 400/500/600 only, the type
//                      scale, the 4·6·8·12 radius family, no active glow, focus-visible, breakpoints
//   6. drawer        — logical start/end sides, close button at inline-end, no blur
//   7. contrast      — the navy frame, the selected tint for the default AND sample org colours

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NAV_GROUPS, visibleNavGroups, shellTitleKey, isNavActive } from "../src/components/layout/nav-config";
import { NavList } from "../src/components/layout/nav-list";
import { t } from "../src/lib/i18n/dict";
import { contrast, parseColor } from "../src/lib/contrast";
import { TOKENS, BRAND_NAVY } from "../src/lib/design-tokens";

const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const L = "src/components/layout/";
const shellCss = read("src/app/(app)/shell.css");
const appShell = read(L + "app-shell.tsx");
const sidebar = read(L + "sidebar.tsx");
const mobileNav = read(L + "mobile-nav.tsx");
const navList = read(L + "nav-list.tsx");
const lang = read(L + "language-switcher.tsx");
const drawer = read("src/components/ui/drawer.tsx");
const layout = read("src/app/(app)/layout.tsx");
const SHELL_TSX = ["app-shell.tsx", "sidebar.tsx", "nav-list.tsx", "mobile-nav.tsx", "language-switcher.tsx", "theme-toggle.tsx",
  "favorites-menu.tsx", "notifications-menu.tsx", "topbar-search.tsx", "command-palette.tsx", "record-search.tsx"].map((f) => [f, read(L + f)] as const);

const sf = (name: string, text: string) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
/** Every JSX element (opening or self-closing) in a file, with its attributes as name → raw text. */
function jsxElements(text: string) {
  const out: { tag: string; attrs: Record<string, string>; node: ts.Node }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const attrs: Record<string, string> = {};
      for (const a of n.attributes.properties) if (ts.isJsxAttribute(a)) attrs[a.name.getText()] = a.initializer?.getText() ?? "true";
      out.push({ tag: n.tagName.getText(), attrs, node: n });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf("x.tsx", text));
  return out;
}

// ---------- 1. structure ----------
const shellEls = jsxElements(appShell);
check("skip link to #main-content is rendered", shellEls.some((e) => e.tag === "a" && e.attrs.href === '"#main-content"' && /skip-link/.test(e.attrs.className ?? "")));
check("<main id=\"main-content\"> is the skip target", shellEls.some((e) => e.tag === "main" && e.attrs.id === '"main-content"'));
check("the shell renders no <h1> (page content owns the page heading)", !shellEls.some((e) => e.tag === "h1") && !/<h1\b/.test(navList + sidebar + mobileNav));
const titleEl = shellEls.find((e) => /topbar-title/.test(e.attrs.className ?? ""));
check("the shell title element is not an <h1>", !!titleEl && titleEl.tag !== "h1", titleEl?.tag);
check("app layout imports shell.css", /import "\.\/shell\.css";/.test(layout));
// Settings gear: rendered only behind the owner/admin guard, which must equal the page's own guard.
const guard = read("src/app/(app)/settings/organization/page.tsx").match(/requireRole\(([^)]*)\)/)?.[1].replace(/\s/g, "");
const shellRoles = appShell.match(/const SETTINGS_ROLES: readonly Role\[\] = \[([^\]]*)\]/)?.[1].replace(/\s/g, "");
check("Settings gear roles == the /settings/organization requireRole guard", !!guard && guard === shellRoles, `${guard} vs ${shellRoles}`);
check("Settings gear is rendered only when canOpenSettings", /\{canOpenSettings && \(\s*<Link href="\/settings\/organization"/.test(appShell) &&
  (appShell.match(/href="\/settings\/organization"/g) ?? []).length === 1);
check("account menu keeps name, email, role and Log out", /\{user\.email\}/.test(appShell) && /ROLE_LABELS\[user\.role\]/.test(appShell) && /logoutAction\(\)/.test(appShell) && /"Log out"/.test(appShell));
check("no organization switcher was invented", !/switch(Org|Organization)|org-switcher/i.test(appShell + mobileNav));

// ---------- 2. navigation ----------
const navHrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
check("NAV_GROUPS has no duplicate routes", new Set(navHrefs).size === navHrefs.length);
const icons = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.icon));
check("every nav item has a unique icon", new Set(icons).size === icons.length);
check("every nav route has a built page (so prefetch needs no allow-list)", navHrefs.every((h) => existsSync(join(ROOT, "src/app/(app)", h, "page.tsx"))),
  navHrefs.filter((h) => !existsSync(join(ROOT, "src/app/(app)", h, "page.tsx"))).join(","));
check("sidebar and drawer both render the shared NavList", /<NavList\b/.test(sidebar) && /<NavList\b/.test(mobileNav));
check("sidebar and drawer do not read NAV_GROUPS or filter roles themselves",
  ![sidebar, mobileNav].some((s) => /NAV_GROUPS|visibleNavGroups|roles\.includes|isNavActive|startsWith\(/.test(s)));
check("NavList takes items from the one role filter (visibleNavGroups) and the one active rule (isNavActive)",
  /visibleNavGroups\(role\)/.test(navList) && /isNavActive\(pathname, it(em)?\.href\)/.test(navList) && !/roles\.includes/.test(navList));
const roleFilters = SHELL_TSX.filter(([, s]) => /roles\.includes\(/.test(s)).map(([f]) => f);
check("no shell component re-implements the role filter", roleFilters.length === 0, roleFilters.join(","));
const navArrays = SHELL_TSX.filter(([, s]) => /\{\s*label:\s*"[^"]+",\s*href:\s*"\/[^"]*",\s*icon:/.test(s)).map(([f]) => f);
check("nav items are configured only in nav-config.ts", navArrays.length === 0, navArrays.join(","));

const html = (role: "owner" | "admin" | "staff", pathname: string, rail = false) =>
  renderToStaticMarkup(createElement(NavList, { role, locale: "en", pathname, rail, collapsedGroups: new Set<string>(), onToggleGroup: () => {}, idPrefix: "t", label: "Main navigation" }));
const owner = html("owner", "/sales/invoices/6/edit");
check("NavList is a labelled <nav> landmark", /^<nav class="[^"]*nav-list[^"]*" aria-label="Main navigation">/.test(owner), owner.slice(0, 120));
const multi = visibleNavGroups("owner").filter((g) => g.label && g.items.length > 1).length;
const headers = (owner.match(/class="nav-divider"/g) ?? []).length;
check(`one-item groups are flattened: owner sees ${multi} group headers (Projects / Inventory / Clients have none)`, headers === multi && !/>Inventory</.test(owner) && multi === 5, `${headers}`);
const staff = html("staff", "/dashboard");
check("staff: the one-item Administration group renders without a header", !/>Administration</.test(staff) && /href="\/settings\/security"/.test(staff));
check("staff: owner/admin-only items are absent", !/\/hr\/payroll|\/settings\/presets|\/settings\/organization|\/settings\/compliance/.test(staff));
const toggles = [...owner.matchAll(/aria-expanded="(true|false)" aria-controls="([^"]+)"/g)];
check("every group toggle has aria-expanded + aria-controls pointing at its item list",
  toggles.length === multi && toggles.every((m) => owner.includes(`id="${m[2]}"`)));
check("the active item carries aria-current=\"page\" and the active class (nested route → parent)",
  /<a class="nav-item active" aria-current="page" href="\/sales\/invoices">/.test(owner) && (owner.match(/aria-current="page"/g) ?? []).length === 1);
const rail = html("owner", "/dashboard", true);
check("rail: no group headers, labels kept for assistive tech + native tooltip", !/nav-divider/.test(rail) && /title="Quotations"/.test(rail) && /nav-item-label">Quotations</.test(rail));
check("prefix rule does not over-match", isNavActive("/clients/recycle-bin", "/clients") && !isNavActive("/clientsx", "/clients"));

// ---------- 3. language ----------
check("EN | ع: both options rendered directly (no menu)", /short: "EN"/.test(lang) && /short: "ع"/.test(lang) && !/DropdownMenu/.test(lang));
check("language options expose the pressed state and their own lang", /aria-pressed=\{current\}/.test(lang) && /lang=\{o\.locale\}/.test(lang));
check("no flag emoji in the language control", !/[\u{1F1E6}-\u{1F1FF}]/u.test(lang));
check("language control sits in the top bar itself, not in the utilities that move to the drawer",
  /<div className="topbar-actions">[\s\S]*<LanguageSwitcher[\s\S]*<div className="topbar-utilities">/.test(appShell) &&
  !(appShell.match(/const utilities = \(([\s\S]*?)\n  \);/)?.[1] ?? "LanguageSwitcher").includes("LanguageSwitcher"));
check("the locale is still set through the existing server action", /setLocaleAction\(o\.locale\)/.test(lang));

// ---------- 4. title ----------
const TITLES: [string, string][] = [["/recycle-bin", "Recycle Bin"], ["/clients/recycle-bin", "Clients"], ["/sales/invoices/6/edit", "Invoices"],
  ["/hr/employees/new", "Employees"], ["/dashboard", "Dashboard"], ["/settings/team", "Dashboard"], ["/finance/statements", "Client & Vendor Statements"]];
const badTitles = TITLES.filter(([p, k]) => shellTitleKey(p) !== k).map(([p]) => `${p}→${shellTitleKey(p)}`);
check("shell title resolver (recycle bin, nested routes, fallback)", badTitles.length === 0, badTitles.join(" "));
check("Recycle Bin is NOT added to the sidebar", !navHrefs.includes("/recycle-bin"));
const keys = [...new Set([...NAV_GROUPS.flatMap((g) => [g.label ?? "", ...g.items.map((i) => i.label)]).filter(Boolean), "Recycle Bin",
  "Main navigation", "Skip to main content", "Open navigation", "Close navigation", "Language"])];
const untranslated = keys.filter((k) => t("ar", k) === k);
check("every shell string has an Arabic translation", untranslated.length === 0, untranslated.join(","));

// ---------- 5. shell.css ----------
const cssNoComments = shellCss.replace(/\/\*[\s\S]*?\*\//g, "");
const physical = cssNoComments.match(/(^|[\s;{])(margin|padding|border)-(left|right)\b|(^|[\s;{])(left|right)\s*:|text-align:\s*(left|right)|float\s*:/g) ?? [];
check("shell.css uses logical properties only", physical.length === 0, physical.join(" "));
const dirHacks = cssNoComments.match(/\[dir=/g) ?? [];
check("shell.css has exactly one [dir] rule (the chevron rotation, which has no logical form)", dirHacks.length === 1, String(dirHacks.length));
check("no gradient in the shell (CSS or components)", !/gradient\(/.test(cssNoComments) && !SHELL_TSX.some(([, s]) => /gradient\(/.test(s)));
const weights = [...cssNoComments.matchAll(/font-weight:\s*([^;]+);/g)].map((m) => m[1].trim());
check("shell.css font weights are 400 / 500 / 600 only", weights.length > 0 && weights.every((w) => ["400", "500", "600"].includes(w)), [...new Set(weights)].join(","));
const boldClasses = SHELL_TSX.filter(([, s]) => /\bfont-(bold|extrabold|black)\b/.test(s)).map(([f]) => f);
check("no bold / extrabold classes in shell components", boldClasses.length === 0, boldClasses.join(","));
const sizes = [...cssNoComments.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
check("shell.css font sizes come from the type scale", sizes.length > 0 && sizes.every((s) => /^var\(--text-[a-z-]+\)$/.test(s)), sizes.filter((s) => !/^var\(--text-/.test(s)).join(","));
const arbitrary = SHELL_TSX.filter(([, s]) => /\btext-\[\d/.test(s)).map(([f]) => f);
check("no arbitrary pixel font sizes in shell components", arbitrary.length === 0, arbitrary.join(","));
const radii = [...cssNoComments.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim());
check("shell.css radii are 4 / 6 / 8 / 12 (or 0)", radii.every((r) => ["0", "4px", "6px", "8px", "12px"].includes(r)), [...new Set(radii)].join(","));
const shadows = [...cssNoComments.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
check("no glow: the only box-shadow in shell.css is `none`", shadows.every((s) => s === "none"), shadows.join(" | "));
const activeRule = cssNoComments.match(/\.nav-list \.nav-item\.active \{([^}]*)\}/)?.[1] ?? "";
const indicator = cssNoComments.match(/\.nav-list \.nav-item\.active::before \{([^}]*)\}/)?.[1] ?? "";
check("selected item: tint background, weight 600, no shadow", /background:\s*var\(--sidebar-selected-tint\)/.test(activeRule) && /font-weight:\s*600/.test(activeRule) && /box-shadow:\s*none/.test(activeRule), activeRule.trim());
check("selected item: inline-start indicator bar in the org's selected-item colour", /inset-inline-start:\s*0/.test(indicator) && /background:\s*var\(--sidebar-indicator\)/.test(indicator));
check("the tint and indicator derive from --selected-item-background (org theming stays effective)",
  /--sidebar-selected-tint:\s*color-mix\(in srgb, var\(--selected-item-background\)/.test(read("src/app/globals.css")) && /--sidebar-indicator:\s*var\(--selected-item-background\)/.test(read("src/app/globals.css")));
check("navy sidebar in both appearances on the approved navy tokens", /--sidebar-bg:\s*light-dark\(var\(--brand-navy\), var\(--brand-navy-deep\)\)/.test(read("src/app/globals.css")));
for (const sel of [".nav-list :is(.nav-item, .nav-divider):focus-visible", ".sidebar-toggle:focus-visible", ".topbar :is(.topbar-icon-btn, .topbar-search, .cmdk-trigger-pill, .topbar-lang-option, .topbar-profile):focus-visible", ".skip-link:focus-visible"]) {
  check(`focus-visible style: ${sel}`, cssNoComments.includes(sel));
}
const outlineNone = SHELL_TSX.filter(([, s]) => /\boutline-none\b/.test(s.replace(/outline-none focus-visible:ring-2/g, ""))).map(([f]) => f);
check("no outline-none without a focus-visible replacement in shell components", outlineNone.length === 0, outlineNone.join(","));
const media = (q: string) => cssNoComments.match(new RegExp(`@media \\(${q.replace(/[()]/g, "\\$&")}\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
const tablet = media("min-width: 1024px) and (max-width: 1279.98px");
const mobile = media("max-width: 1023.98px");
const narrow = media("max-width: 639.98px");
check("1024–1279: the rail is always 66px and the expand toggle is hidden", /\.sidebar \{ width: 66px;/.test(tablet) && /\.sidebar \.sidebar-toggle,/.test(tablet));
check("<1024: no persistent sidebar; the menu trigger and compact search appear", /\.sidebar \{ display: none; \}/.test(mobile) && /\.topbar-menu-btn \{ display: flex; \}/.test(mobile) && /\.topbar-search-icon \{ display: flex; \}/.test(mobile));
check("<640: utilities move to the drawer; menu, title, search and EN | ع stay",
  /\.topbar-utilities \{ display: none; \}/.test(narrow) && /\.mobile-nav-utilities \{/.test(narrow) &&
  !/\.(topbar-lang|topbar-search-icon|topbar-menu-btn|topbar-greeting|topbar-title|cmdk-trigger-pill)[^{]*\{[^}]*display: none/.test(narrow));
check("the shell title never collapses to zero width", /\.topbar-greeting \{ flex: 1 1 auto; min-width: 6rem; \}/.test(cssNoComments));

// ---------- 6. drawer ----------
check("Drawer sides are logical (start-0 / end-0, border-e / border-s)", /side === "start" \? "start-0 border-e" : "end-0 border-s"/.test(drawer) && !/\b(left-0|right-0|border-l|border-r|right-4|left-4)\b/.test(drawer));
check("Drawer close button sits at inline-end with a translatable name", /absolute end-4 top-4/.test(drawer) && /\{closeLabel\}/.test(drawer));
check("Drawer overlay has no blur", !/backdrop-blur/.test(drawer));
check("mobile nav opens from inline-start, is titled, and closes on navigation (also when the unsaved-changes guard intercepts)",
  /<DrawerContent\s+side="start"/.test(mobileNav) && /<DrawerTitle/.test(mobileNav) && /onNavigate=\{\(\) => \{[^}]*setOpen\(false\);/.test(mobileNav) &&
  /window\.addEventListener\("click", onClick, true\)/.test(mobileNav));
check("mobile nav shows the organization context", /\{orgName\}/.test(mobileNav));
check("palette and record search: Radix dialog (trap + focus return), no blur",
  ["command-palette.tsx", "record-search.tsx"].every((f) => { const s = SHELL_TSX.find(([n]) => n === f)![1]; return /DialogPrimitive\.Root/.test(s) && /DialogPrimitive\.Title/.test(s) && !/backdrop-blur/.test(s); }));
check("search has a no-keyboard entry below 1024 and Ctrl/⌘+K still opens the palette",
  /topbar-search-icon/.test(read(L + "topbar-search.tsx")) && /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key\.toLowerCase\(\) === "k"/.test(read(L + "topbar-search.tsx")));

// ---------- 7. contrast of the navy frame ----------
const mix = (a: string, pct: number, b: string) => { const A = parseColor(a)!, Bc = parseColor(b)!; const f = pct / 100;
  return `rgb(${Math.round(A.r * f + Bc.r * (1 - f))}, ${Math.round(A.g * f + Bc.g * (1 - f))}, ${Math.round(A.b * f + Bc.b * (1 - f))})`; };
const FRAME = { light: { bg: BRAND_NAVY, ink: "#ffffff", accent: TOKENS.light.accent, focus: TOKENS.light.focus }, dark: { bg: "#100f32", ink: "#eceef7", accent: TOKENS.dark.accent, focus: TOKENS.dark.focus } };
check("globals.css navy tokens are the approved values", /--brand-navy:\s*#1b1b4e;/.test(read("src/app/globals.css")) && /--brand-navy-deep:\s*#100f32;/.test(read("src/app/globals.css")));
for (const [ap, f] of Object.entries(FRAME)) {
  const muted = mix(f.ink, 72, f.bg);
  check(`${ap}: sidebar text on navy ≥ 4.5`, contrast(f.ink, f.bg) >= 4.5, contrast(f.ink, f.bg).toFixed(2));
  check(`${ap}: muted sidebar text on navy ≥ 4.5`, contrast(muted, f.bg) >= 4.5, contrast(muted, f.bg).toFixed(2));
  check(`${ap}: muted text on the hover tint ≥ 4.5`, contrast(f.ink, mix(f.ink, 9, f.bg)) >= 4.5);
  check(`${ap}: indicator (default accent) vs navy ≥ 3 (non-text)`, contrast(f.accent, f.bg) >= 3, contrast(f.accent, f.bg).toFixed(2));
  check(`${ap}: focus ring vs navy ≥ 3`, contrast(f.focus, f.bg) >= 3, contrast(f.focus, f.bg).toFixed(2));
  // Org Selected-item colours, from very light to very dark: the label on the tint must stay readable.
  const worst = ["#ffffff", "#ffee00", "#00e5ff", f.accent, "#7a1fa2", "#003366", "#000000"].map((c) => contrast(f.ink, mix(c, 22, f.bg)));
  check(`${ap}: selected label on the tint ≥ 4.5 for any org selected-item colour`, Math.min(...worst) >= 4.5, worst.map((r) => r.toFixed(1)).join(","));
}

let ok = true;
for (const [cond, name, extra] of results) {
  if (!cond) ok = false;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "SHELL VERIFICATION PASS" : "SHELL VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
