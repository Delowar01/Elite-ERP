// App shell (DEV-UI-01.3; LCP shell — D-LCP-3/4/5). Run via `npm run verify:shell` — deliberately WITHOUT
// --conditions=react-server: it server-renders the real <NavList>, which needs the ordinary React build.
// The LCP adoption re-encodes the visual decisions it supersedes (navy rail → dark header + light sidebar,
// tint + bar → solid selected fill, 400–600 → 400–700, no shadows → the LCP shadow-sm only, the page title
// in the bar → the organization identity); every structural, role, ARIA, RTL and focus assertion is kept.
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
//   7. contrast      — the dark header and the light sidebar, the selected fill for the default AND sample
//                      org colours

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NAV_GROUPS, visibleNavGroups, shellTitleKey, isNavActive } from "../src/components/layout/nav-config";
import { NavList } from "../src/components/layout/nav-list";
import { t } from "../src/lib/i18n/dict";
import { contrast, parseColor } from "../src/lib/contrast";
import { TOKENS } from "../src/lib/design-tokens";
import { resolveComponentColors, buildSemanticTokens, type ThemeInput } from "../src/lib/brand-theme";

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
// LCP header: the organization identity (logo or Elite mark + name) where the page title used to be; the
// page's own <h1> names the page. No heading element at all in the bar.
const brandEl = shellEls.find((e) => /topbar-brand"/.test(e.attrs.className ?? "") && e.tag === "Link");
check("the header shows the organization identity: a link home with the mark and the name (not a heading)",
  !!brandEl && brandEl.attrs.href === '"/dashboard"' && /<BrandMark orgLogoUrl=\{orgLogoUrl\} \/>/.test(appShell) &&
  /<span className="topbar-brand-name" dir="auto">\{orgName\}<\/span>/.test(appShell) && !shellEls.some((e) => /^h[1-6]$/.test(e.tag)), brandEl?.attrs.href);
check("the organization mark is decorative beside the name (alt=\"\" / aria-hidden) — the name is the text",
  /alt=""/.test(read(L + "brand-mark.tsx")) && /aria-hidden="true"/.test(read(L + "brand-mark.tsx")));
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

// ---------- 4. contextual title (the Favorites label; no longer painted in the bar) ----------
const TITLES: [string, string][] = [["/recycle-bin", "Recycle Bin"], ["/clients/recycle-bin", "Clients"], ["/sales/invoices/6/edit", "Invoices"],
  ["/hr/employees/new", "Employees"], ["/dashboard", "Dashboard"], ["/settings/team", "Dashboard"], ["/finance/statements", "Client & Vendor Statements"]];
const badTitles = TITLES.filter(([p, k]) => shellTitleKey(p) !== k).map(([p]) => `${p}→${shellTitleKey(p)}`);
check("contextual title resolver (recycle bin, nested routes, fallback)", badTitles.length === 0, badTitles.join(" "));
check("Recycle Bin is NOT added to the sidebar", !navHrefs.includes("/recycle-bin"));
const keys = [...new Set([...NAV_GROUPS.flatMap((g) => [g.label ?? "", ...g.items.map((i) => i.label)]).filter(Boolean), "Recycle Bin",
  "Main navigation", "Skip to main content", "Open navigation", "Close navigation", "Language", "Collapse", "Expand", "Collapse sidebar", "Expand sidebar"])];
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
check("shell.css font weights are the LCP set 400 / 500 / 600 / 700", weights.length > 0 && weights.every((w) => ["400", "500", "600", "700"].includes(w)), [...new Set(weights)].join(","));
const boldRules = [...cssNoComments.matchAll(/([^{}]+)\{[^}]*font-weight:\s*700;[^}]*\}/g)].map((m) => m[1].trim());
check("700 only on the organization name and the avatar initials (LCP bold brand / initials)",
  boldRules.length === 2 && boldRules.every((r) => r === ".topbar-brand-name" || r === ".topbar-avatar"), boldRules.join(" | "));
const boldClasses = SHELL_TSX.filter(([, s]) => /\bfont-(bold|extrabold|black)\b/.test(s)).map(([f]) => f);
check("no bold / extrabold classes in shell components", boldClasses.length === 0, boldClasses.join(","));
const sizes = [...cssNoComments.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
check("shell.css font sizes come from the type scale", sizes.length > 0 && sizes.every((s) => /^var\(--text-[a-z-]+\)$/.test(s)), sizes.filter((s) => !/^var\(--text-/.test(s)).join(","));
const arbitrary = SHELL_TSX.filter(([, s]) => /\btext-\[\d/.test(s)).map(([f]) => f);
check("no arbitrary pixel font sizes in shell components", arbitrary.length === 0, arbitrary.join(","));
const radii = [...cssNoComments.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim());
check("shell.css radii are 4 / 6 / 8 / 12, or 9999px for the round count badge (LCP rounded-full)", radii.every((r) => ["0", "4px", "6px", "8px", "12px", "9999px"].includes(r)), [...new Set(radii)].join(","));
const shadows = [...cssNoComments.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
check("no glow: the only shadows in shell.css are the LCP-rendered shadow-sm token (selected item, brand mark)", shadows.length === 2 && shadows.every((s) => s === "var(--shadow-sm)"), shadows.join(" | "));
const activeRule = cssNoComments.match(/\.nav-list \.nav-item\.active \{([^}]*)\}/)?.[1] ?? "";
check("selected item (LCP bg-primary text-primary-foreground shadow-sm): the org Selected-item fill + its text, weight 600, shadow-sm",
  /background:\s*var\(--selected-item-background\)/.test(activeRule) && /color:\s*var\(--selected-item-text\)/.test(activeRule) && /font-weight:\s*600/.test(activeRule) && /box-shadow:\s*var\(--shadow-sm\)/.test(activeRule), activeRule.trim());
check("no indicator bar or tint remains (the selected state is the fill; nothing draws over it)", !/\.nav-item\.active::before/.test(cssNoComments) && !/--sidebar-(selected-tint|indicator)/.test(read("src/app/globals.css")));
const orgVars = buildSemanticTokens({ mode: "single", primaryColor: "#0E7C66", accentColor: "#7A1FA2", gradientFrom: "#F5A25C", gradientTo: "#E87722" }, "light");
check("the selected pair is exactly what the org theme engine writes (--selected-item-background / --selected-item-text), so org theming stays effective",
  !!orgVars["--selected-item-background"] && !!orgVars["--selected-item-text"]);
const G = read("src/app/globals.css");
check("LCP frame tokens: the light sidebar is the card surface in both appearances; the header is the LCP navy / charcoal",
  /--sidebar-bg:\s*var\(--surface\);/.test(G) && /--sidebar-ink:\s*var\(--text\);/.test(G) && /--sidebar-border:\s*var\(--border\);/.test(G) &&
  /--header-bg:\s*light-dark\(#1a1c2e, #212121\);/.test(G) && /--header-ink:\s*light-dark\(#f9fafb, #f9fafb\);/.test(G) && /--header-height:\s*56px;/.test(G));
const rule = (sel: string) => cssNoComments.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";
check("geometry: header 56px sticky on top; sidebar 256px, sticky under the header, its own scroller; mini rail 68px",
  /height:\s*var\(--header-height\)/.test(rule(".topbar")) && /position:\s*sticky/.test(rule(".topbar")) && /width:\s*256px/.test(rule(".sidebar")) &&
  /top:\s*var\(--header-height\)/.test(rule(".sidebar")) && /overflow-y:\s*auto/.test(rule(".sidebar")) && /\.sidebar:is\(\.collapsed, \[data-rail\]\) \{ width: 68px; \}/.test(cssNoComments));
check("content: LCP max-w-7xl (1280px) with 16 / 24 / 32px padding by breakpoint",
  /max-width:\s*1280px/.test(rule(".app-main-inner")) && /padding:\s*var\(--space-16\)/.test(rule(".app-main-inner")) &&
  /@media \(min-width: 640px\) \{\s*\.app-main-inner \{ padding: var\(--space-24\); \}/.test(cssNoComments) && /@media \(min-width: 1024px\) \{\s*\.app-main-inner \{ padding: var\(--space-32\); \}/.test(cssNoComments));
for (const sel of [".nav-list :is(.nav-item, .nav-divider):focus-visible", ".sidebar-toggle:focus-visible", ".topbar :is(.topbar-icon-btn, .topbar-search, .cmdk-trigger-pill, .topbar-lang-option, .topbar-profile, .topbar-brand):focus-visible", ".skip-link:focus-visible"]) {
  check(`focus-visible style: ${sel}`, cssNoComments.includes(sel));
}
const outlineNone = SHELL_TSX.filter(([, s]) => /\boutline-none\b/.test(s.replace(/outline-none focus-visible:ring-2/g, ""))).map(([f]) => f);
check("no outline-none without a focus-visible replacement in shell components", outlineNone.length === 0, outlineNone.join(","));
const media = (q: string) => cssNoComments.match(new RegExp(`@media \\(${q.replace(/[()]/g, "\\$&")}\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
const tablet = media("min-width: 768px) and (max-width: 1023.98px");
const mobile = media("max-width: 767.98px");
const narrow = media("max-width: 639.98px");
check("768–1023: the rail is always 68px and the expand toggle is hidden", /\.sidebar \{ width: 68px; \}/.test(tablet) && /\.sidebar \.sidebar-toggle,/.test(tablet));
check("<768: no persistent sidebar; the menu trigger appears (LCP md breakpoint)", /\.sidebar \{ display: none; \}/.test(mobile) && /\.topbar-menu-btn \{ display: flex; \}/.test(mobile));
// LCP: from 640 to 767px the menu button and the utilities leave the field no room (it was squeezed to nothing, its ⌘K
// hint over EN | ع, the account past the viewport): below 768 the compact search stands in for it, and the name gives way.
check("<768: the search box becomes the compact search (it and the command-menu pill keep their size) and the organization name alone gives way (truncates) — the row never passes the viewport or overlaps",
  /\.topbar \.topbar-search \{ display: none; \}/.test(mobile) && /\.topbar \.topbar-search-icon \{ display: flex; \}/.test(mobile) &&
  /\.topbar-brand \{[^}]*flex-shrink: 1;/.test(mobile) && /\.topbar-search-slot \{ flex: 0 0 auto; \}/.test(mobile));
check("<640: utilities move to the sheet; the name hides; menu, mark, search and EN | ع stay",
  /\.topbar-utilities \{ display: none; \}/.test(narrow) && /\.mobile-nav-utilities \{/.test(narrow) && /\.topbar-brand-name \{ display: none; \}/.test(narrow) &&
  !/\.(topbar-lang|topbar-menu-btn|topbar-brand|cmdk-trigger-pill|topbar-search-icon)[^{-]*\{[^}]*display: none/.test(narrow));
check("the organization name truncates (never widens the bar) and keeps its own direction",
  /max-width:\s*220px/.test(rule(".topbar-brand-name")) && /text-overflow:\s*ellipsis/.test(rule(".topbar-brand-name")) && /dir="auto"/.test(appShell));

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
check("search has a no-keyboard entry on narrow headers and Ctrl/⌘+K still opens the palette",
  /topbar-search-icon/.test(read(L + "topbar-search.tsx")) && /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key\.toLowerCase\(\) === "k"/.test(read(L + "topbar-search.tsx")));

// ---------- 7. contrast of the LCP frame: the dark header and the light sidebar ----------
const mix = (a: string, pct: number, b: string) => { const A = parseColor(a)!, Bc = parseColor(b)!; const f = pct / 100;
  return `rgb(${Math.round(A.r * f + Bc.r * (1 - f))}, ${Math.round(A.g * f + Bc.g * (1 - f))}, ${Math.round(A.b * f + Bc.b * (1 - f))})`; };
const HEADER = { light: { bg: "#1a1c2e", ink: "#f9fafb", accent: "#252841" }, dark: { bg: "#212121", ink: "#f9fafb", accent: "#333333" } };
check("globals.css keeps the Elite brand navy constants (logo, brand panels)", /--brand-navy:\s*#1b1b4e;/.test(G) && /--brand-navy-deep:\s*#100f32;/.test(G));
// The muted header ink is the header ink at 76% over the header, resolved to HEX (a registered <color>, so
// computed styles read rgb() like every other token); the declared pair must BE that mix, and it is what is measured.
const mutedDecl = /--header-ink-muted:\s*light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\);/.exec(G);
const MUTED = { light: mutedDecl?.[1] ?? "", dark: mutedDecl?.[2] ?? "" };
check("header-ink-muted is the header ink at 76% over the header, resolved to HEX per appearance and registered (the value measured below)",
  !!mutedDecl && (["light", "dark"] as const).every((ap) => mix(MUTED[ap], 100, "#000000") === mix(HEADER[ap].ink, 76, HEADER[ap].bg)) &&
  /@property --header-ink-muted \{ syntax: "<color>"/.test(G), JSON.stringify(MUTED));
for (const ap of ["light", "dark"] as const) {
  const h = HEADER[ap], tk = TOKENS[ap];
  const muted = MUTED[ap] || mix(h.ink, 76, h.bg);
  const searchBg = mix(h.accent, 50, h.bg);
  check(`${ap}: header text on the header ≥ 4.5`, contrast(h.ink, h.bg) >= 4.5, contrast(h.ink, h.bg).toFixed(2));
  check(`${ap}: muted header text (icons, search placeholder, role) on the header ≥ 4.5`, contrast(muted, h.bg) >= 4.5, contrast(muted, h.bg).toFixed(2));
  check(`${ap}: muted header text on the search field ≥ 4.5`, contrast(muted, searchBg) >= 4.5, contrast(muted, searchBg).toFixed(2));
  check(`${ap}: header text on the hover fill ≥ 4.5`, contrast(h.ink, h.accent) >= 4.5, contrast(h.ink, h.accent).toFixed(2));
  check(`${ap}: focus ring vs the header ≥ 3`, contrast(tk.focus, h.bg) >= 3, contrast(tk.focus, h.bg).toFixed(2));
  // Owner decision (2026-11-06): the label on the orange is the LCP white — measured and reported, below AA.
  check(`${ap}: pressed language / brand tile — the LCP white label on the primary (measured), the primary vs the header ≥ 3`,
    tk.primaryForeground === "#ffffff" && contrast(tk.primary, h.bg) >= 3, `${contrast(tk.primaryForeground, tk.primary).toFixed(2)} / ${contrast(tk.primary, h.bg).toFixed(2)}`);
  check(`${ap}: sidebar text / muted text on the card ≥ 4.5; on the hover fill ≥ 4.5`,
    contrast(tk.text, tk.surface) >= 4.5 && contrast(tk.textMuted, tk.surface) >= 4.5 && contrast(tk.text, tk.surfaceSubtle) >= 4.5 && contrast(tk.textMuted, tk.surfaceSubtle) >= 4.5,
    `${contrast(tk.textMuted, tk.surface).toFixed(2)} / ${contrast(tk.textMuted, tk.surfaceSubtle).toFixed(2)}`);
  check(`${ap}: selected item — the LCP white label on the default fill (measured); the fill vs the card ≥ 3; focus vs the card ≥ 3`,
    tk.accentForeground === "#ffffff" && contrast(tk.accent, tk.surface) >= 3 && contrast(tk.focus, tk.surface) >= 3,
    `${contrast(tk.accentForeground, tk.accent).toFixed(2)} / ${contrast(tk.accent, tk.surface).toFixed(2)}`);
  // Org Selected-item colours from very light to very dark: the engine's selected pair stays readable.
  const orgs = ["#ffffff", "#ffee00", "#00e5ff", "#e87722", "#7a1fa2", "#003366", "#000000", "#15803d"];
  const worst = orgs.map((c) => { const sel = resolveComponentColors({ mode: "single", primaryColor: "#0e7c66", accentColor: c, gradientFrom: "#F5A25C", gradientTo: "#E87722" } as ThemeInput, ap).selectedItem; return contrast(sel.fg, sel.bg); });
  check(`${ap}: selected label on the org fill ≥ 4.5 for any org selected-item colour`, Math.min(...worst) >= 4.5, worst.map((r) => r.toFixed(1)).join(","));
}

let ok = true;
for (const [cond, name, extra] of results) {
  if (!cond) ok = false;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "SHELL VERIFICATION PASS" : "SHELL VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
