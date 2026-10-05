// Controls (DEV-UI-01.4). Run via `npm run verify:controls` (part of verify:static).
//
// What it pins, so the control family cannot drift back:
//   1. geometry    — control heights from --control-height* (36 / 32 / 40), no h-10 / literal heights on
//                    the primitives, the 4·6·8·12 radius family, the type scale, weights 400/500/600 only
//   2. focus       — the 2px --focus outline on every primitive and legacy control; no low-alpha rings,
//                    no focus: (pointer) rings
//   3. states      — disabled, aria-invalid, read-only, loading (spinner + aria-busy + disabled), checked
//   4. RTL         — logical Select / SearchableSelect geometry; the Dialog close at inline-end
//   5. variants    — the final Button variant + size set; every ghost consumer classified; no hand-built
//                    danger ghosts left
//   6. radio       — NATIVE radios, no Radix radio dependency; ClientTypeSelect uses RadioGroup
//   7. combobox    — SearchableSelect listbox / option / activedescendant + Arrow / Enter keyboard
//   8. consumers   — no raw compliance <select>, no native reports checkbox, no dead width:auto on
//                    modern <Button>; DEV-UI-01.5 / 01.6 structures left on the old API

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const UI = "src/components/ui/";
const button = read(UI + "button.tsx");
const input = read(UI + "input.tsx");
const textarea = read(UI + "textarea.tsx");
const select = read(UI + "select.tsx");
const searchable = read(UI + "searchable-select.tsx");
const checkbox = read(UI + "checkbox.tsx");
const radio = read(UI + "radio-group.tsx");
const label = read(UI + "label.tsx");
const dialog = read(UI + "dialog.tsx");
const tabs = read(UI + "tabs.tsx");
const dropdown = read(UI + "dropdown-menu.tsx");
const globals = read("src/app/globals.css");
const legacyCss = read("src/app/(app)/mockup-parity.css").replace(/\/\*[\s\S]*?\*\//g, "");
const pkg = JSON.parse(read("package.json"));
const lock = read("package-lock.json");

const PRIMITIVES: [string, string][] = [["Button", button], ["Input", input], ["Textarea", textarea], ["Select", select],
  ["SearchableSelect", searchable], ["Checkbox", checkbox], ["Radio", radio], ["Label", label]];
/** Only the class strings (string literals) of a file — comments and prose excluded. */
function classText(text: string) {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(ts.createSourceFile("x.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return out.join(" ");
}
const cls = Object.fromEntries(PRIMITIVES.map(([n, s]) => [n, classText(s)]));

/** The declarations of every rule whose selector list contains `sel` exactly. */
function rules(css: string, sel: string) {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(",").map((s) => s.trim());
    if (sels.includes(sel)) out.push(m[2]);
  }
  return out.join(";");
}
const decl = (body: string, prop: string) => [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))].map((m) => m[1].trim());

// ---------- 1. geometry ----------
check("tokens: --control-height 36 / compact 32 / touch 40",
  /--control-height:\s*36px;/.test(globals) && /--control-height-compact:\s*32px;/.test(globals) && /--control-height-touch:\s*40px;/.test(globals));
const sizes = button.match(/size:\s*\{([\s\S]*?)\n\s*\},/)?.[1] ?? "";
const sizeMap = Object.fromEntries([...sizes.matchAll(/^\s*"?([\w-]+)"?:\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
check("Button sizes are exactly default / sm / lg / icon / icon-sm", JSON.stringify(Object.keys(sizeMap).sort()) === JSON.stringify(["default", "icon", "icon-sm", "lg", "sm"]), Object.keys(sizeMap).join(","));
check("Button default = --control-height (36)", /\bh-\(--control-height\)/.test(sizeMap.default ?? ""));
check("Button sm = --control-height-compact (32)", /\bh-\(--control-height-compact\)/.test(sizeMap.sm ?? ""));
check("Button lg = --control-height-touch (40)", /\bh-\(--control-height-touch\)/.test(sizeMap.lg ?? ""));
check("Button icon = 36 square, icon-sm = 32 square", /\bsize-\(--control-height\)/.test(sizeMap.icon ?? "") && /\bsize-\(--control-height-compact\)/.test(sizeMap["icon-sm"] ?? ""));
for (const [n, re] of [["Input", input], ["Select", select], ["SearchableSelect", searchable]] as const)
  check(`${n} is --control-height tall`, /\bh-\(--control-height\)/.test(classText(re)));
const literalHeights = PRIMITIVES.flatMap(([n]) => (cls[n].match(/(?<![\w-])(?:h|size|min-h)-(?:\d+(?:\.5)?|\[\d+px\])(?![\w-])/g) ?? [])
  .filter((c) => !/^(size-(3|3\.5|4)|min-h-(6|24))$/.test(c)).map((c) => `${n}:${c}`));
check("no literal control heights (h-10, h-[30px]…) on the primitives (icon glyph sizes excepted)", literalHeights.length === 0, literalHeights.join(" "));
const radii = PRIMITIVES.flatMap(([n]) => (cls[n].match(/\brounded(-[\w[\]\/.]+)?/g) ?? []).filter((r) => !/^rounded-(sm|md|lg|xl|full)$/.test(r)).map((r) => `${n}:${r}`));
check("primitive radii only from the 4·6·8·12 family (rounded-sm/md/lg/xl, full for the radio)", radii.length === 0, radii.join(" "));
const textSizes = PRIMITIVES.flatMap(([n]) => (cls[n].match(/(?<![\w-])text-(\[\d[^\]]*\]|xs|sm|base|lg|xl|2xl)(?![\w-])/g) ?? []).map((t) => `${n}:${t}`));
check("primitive font sizes only from the type scale (no text-[13.5px], text-sm…)", textSizes.length === 0, textSizes.join(" "));
const weights = PRIMITIVES.flatMap(([n]) => (cls[n].match(/\bfont-(thin|extralight|light|bold|extrabold|black|\[\d+\])/g) ?? []).map((w) => `${n}:${w}`));
check("primitive weights only 400 / 500 / 600", weights.length === 0, weights.join(" "));
check("Button label: body size, weight 500", /\btext-body\b/.test(cls.Button) && /\bfont-medium\b/.test(cls.Button));
check("Label: body-sm, weight 500", /\btext-body-sm\b/.test(cls.Label) && /\bfont-medium\b/.test(cls.Label));
check("Textarea/Select/SearchableSelect/Input text is text-body", ["Input", "Textarea", "Select", "SearchableSelect"].every((n) => /\btext-body\b/.test(cls[n])));
check("Input/Textarea/Select/SearchableSelect trigger radius = 6 (rounded-md)", ["Input", "Textarea", "SearchableSelect"].every((n) => /\brounded-md\b/.test(cls[n])) && /h-\(--control-height\) w-full items-center[^"]*rounded-md/.test(cls.Select));
check("Checkbox radius 4 (rounded-sm)", /\brounded-sm\b/.test(cls.Checkbox));
check("Select / SearchableSelect popover radius 8 (rounded-lg)", /overflow-hidden rounded-lg/.test(cls.Select) && /rounded-lg p-0/.test(cls.SearchableSelect));
// Legacy controls (R1): restyled in CSS, not migrated.
const btn = rules(legacyCss, ".btn");
check(".btn: --control-height, 6px radius, body type, weight 500", decl(btn, "height").includes("var(--control-height)") && decl(btn, "border-radius").includes("6px") &&
  decl(btn, "font-size").includes("var(--text-body)") && decl(btn, "font-weight").includes("500"));
check(".btn-primary keeps width:100% (R1 — no width migration)", decl(rules(legacyCss, ".btn-primary"), "width").includes("100%"));
check(".btn-glass is kept", /\.btn-glass\s*\{/.test(legacyCss));
const accent = rules(legacyCss, ".btn-accent");
check(".btn-accent: --control-height, body type, weight 500", decl(accent, "height").includes("var(--control-height)") && decl(accent, "font-size").includes("var(--text-body)") && decl(accent, "font-weight").includes("500"));
const pill = rules(legacyCss, ".doc-pill-btn");
check(".doc-pill-btn: --control-height, body-sm, 500, 8px", decl(pill, "height").includes("var(--control-height)") && decl(pill, "font-size").includes("var(--text-body-sm)") &&
  decl(pill, "font-weight").includes("500") && decl(pill, "border-radius").includes("8px"));
const tab = rules(legacyCss, ".tab");
check(".tab: body-sm, 500, 6px; active 600", decl(tab, "font-size").includes("var(--text-body-sm)") && decl(tab, "font-weight").includes("500") && decl(tab, "border-radius").includes("6px") &&
  decl(rules(legacyCss, '.tab[data-state="active"]'), "font-weight").includes("600"));
const tabRow = rules(legacyCss, ".tab-row");
check(".tab-row: 8px, no shadow (no pill)", decl(tabRow, "border-radius").includes("8px") && decl(tabRow, "box-shadow").length === 0);
check(".tab active colours still come from the org-themeable vars", /var\(--active-tab-background\)/.test(rules(legacyCss, '.tab[data-state="active"]')));
check(".row-menu-item: body type, 500", decl(rules(legacyCss, ".row-menu-item"), "font-size").includes("var(--text-body)") && decl(rules(legacyCss, ".row-menu-item"), "font-weight").includes("500"));
check(".field label: body-sm, 500", decl(rules(legacyCss, ".field label"), "font-size").includes("var(--text-body-sm)") && decl(rules(legacyCss, ".field label"), "font-weight").includes("500"));
const LEGACY = [".btn", ".btn-primary", ".btn-glass", ".btn-accent", ".doc-pill-btn", ".doc-pill-btn .dpb-val", ".row-menu-btn", ".row-menu-item", ".tab-row", ".tab", ".tab.active", ".field label"];
const legacyWeights = LEGACY.flatMap((s) => decl(rules(legacyCss, s), "font-weight").filter((w) => !["400", "500", "600"].includes(w)).map((w) => `${s}:${w}`));
check("legacy control weights only 400 / 500 / 600", legacyWeights.length === 0, legacyWeights.join(" "));
const legacyRadii = LEGACY.flatMap((s) => decl(rules(legacyCss, s), "border-radius").filter((r) => !["4px", "6px", "8px", "12px"].includes(r)).map((r) => `${s}:${r}`));
check("legacy control radii only 4 / 6 / 8 / 12", legacyRadii.length === 0, legacyRadii.join(" "));
const legacySizes = LEGACY.flatMap((s) => decl(rules(legacyCss, s), "font-size").filter((f) => !/^var\(--text-[\w-]+\)$/.test(f)).map((f) => `${s}:${f}`));
check("legacy control font sizes only from the type scale vars", legacySizes.length === 0, legacySizes.join(" "));

// ---------- 2. focus ----------
const OUTLINE = /focus-visible:outline-2\b[\s\S]*focus-visible:outline-focus\b|focus-visible:outline-focus\b[\s\S]*focus-visible:outline-2\b/;
for (const n of ["Button", "Input", "Textarea", "Select", "SearchableSelect", "Checkbox", "Radio"])
  check(`${n}: 2px --focus outline on :focus-visible`, OUTLINE.test(cls[n]));
const lowAlpha = PRIMITIVES.flatMap(([n]) => (cls[n].match(/\bring-[\w-]+\/\d+|\bring-\[[^\]]*\]|(?<![\w-])focus:(?:ring|outline|border|shadow)[\w\-[\]\/:()!]*/g) ?? []).map((r) => `${n}:${r}`));
check("no low-alpha rings and no focus: (pointer) rings on the primitives", lowAlpha.length === 0, lowAlpha.join(" "));
check("Dialog close: --focus outline on focus-visible", /DialogPrimitive\.Close[\s\S]{0,400}focus-visible:outline-2[\s\S]{0,80}focus-visible:outline-focus/.test(dialog));
check("SearchableSelect Add New: --focus outline", /focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus/.test(cls.SearchableSelect));
for (const sel of [".btn", ".btn-accent", ".doc-pill-btn", ".row-menu-btn", ".tab"]) {
  const f = rules(legacyCss, `${sel}:focus-visible`);
  check(`${sel}:focus-visible → outline 2px solid var(--focus)`, decl(f, "outline").includes("2px solid var(--focus)"), f);
}
const legacyFocusRings = legacyCss.match(/\.(btn|tab|row-menu-btn|doc-pill-btn)[\w-]*:focus(?:-visible)?[^{]*\{[^}]*box-shadow[^}]*\}/g) ?? [];
check("no box-shadow focus rings on the legacy controls", legacyFocusRings.length === 0, legacyFocusRings.join(" "));

// ---------- 3. states ----------
for (const n of ["Input", "Textarea", "Select", "SearchableSelect"])
  check(`${n}: disabled recipe (disabled bg + text tokens, quiet border, not-allowed)`,
    /disabled:cursor-not-allowed/.test(cls[n]) && /disabled:bg-\[var\(--disabled-background\)\]/.test(cls[n]) && /disabled:text-\[var\(--disabled-text\)\]/.test(cls[n]) && /disabled:border-border!/.test(cls[n]));
check("Checkbox / Radio: disabled tokens", /disabled:bg-\[var\(--disabled-background\)\]/.test(cls.Checkbox) && /disabled:bg-\[var\(--disabled-background\)\]/.test(cls.Radio));
check("Button disabled: 50% + no pointer events", /disabled:pointer-events-none/.test(cls.Button) && /disabled:opacity-50/.test(cls.Button));
check(".btn / .doc-pill-btn disabled: opacity .5", decl(rules(legacyCss, ".btn:disabled"), "opacity").includes("0.5") && decl(rules(legacyCss, ".doc-pill-btn:disabled"), "opacity").includes("0.5"));
for (const n of ["Input", "Textarea", "Select", "SearchableSelect", "Checkbox"])
  check(`${n}: aria-invalid → danger border (important: beats the unlayered * border-color)`, /aria-invalid:border-danger!/.test(cls[n]));
check("Input: read-only treatment (subtle fill, quiet border, not on disabled)", /\[&:read-only:not\(:disabled\)\]:bg-canvas/.test(cls.Input) && /\[&:read-only:not\(:disabled\)\]:border-border!/.test(cls.Input));
check("control borders carry ! (the unlayered `* { border-color }` would otherwise win)",
  ["Input", "Textarea", "Select", "SearchableSelect", "Checkbox", "Radio"].every((n) => /\bborder-border-control!/.test(cls[n])) && /border-transparent!/.test(cls.Button));
check("Button loading: spinner, aria-busy, disabled while loading", /disabled=\{disabled \|\| loading\}/.test(button) && /aria-busy=\{loading \|\| undefined\}/.test(button) &&
  /\{loading && <Spinner \/>\}/.test(button) && /className="animate-spin" aria-hidden data-slot="button-spinner"/.test(button));
check("Button loading cannot be combined with asChild (type-level)", /\{ asChild: true; loading\?: never \}/.test(button));
check("Button loading keeps the label (only icon-only buttons swap glyph for spinner)", /\{loading && iconOnly \? null : children\}/.test(button));
check("reduced motion neutralises the spinner animation globally", /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*, \*::before, \*::after\s*\{\s*animation-duration: 0\.01ms !important;/.test(globals));
check("Checkbox checked = primary fill + primary-foreground tick", /data-\[state=checked\]:\[background:var\(--primary\)\]/.test(cls.Checkbox) && /data-\[state=checked\]:text-\[color:var\(--primary-foreground\)\]/.test(cls.Checkbox));
check("Radio checked = thick primary ring", /checked:border-\[5px\]/.test(cls.Radio) && /checked:border-\[color:var\(--primary\)\]!/.test(cls.Radio));
check("Select selected item = accent tint, 600, accent-ink tick", /data-\[state=checked\]:bg-accent-tint/.test(cls.Select) && /data-\[state=checked\]:font-semibold/.test(cls.Select) && /CheckIcon className="size-3\.5 text-accent-ink"/.test(select));

// ---------- 4. RTL ----------
const physical = (s: string) => s.match(/(?<![\w-])-?(?:pl|pr|ml|mr|left|right|border-l|border-r|rounded-l|rounded-r|text-left|text-right)-[\w[\].\/-]+/g) ?? [];
check("Select: no physical pl/pr/left/right (items ps-8 pe-3, tick at start-2.5)", physical(cls.Select).length === 0 && /\bps-8 pe-3\b/.test(cls.Select) && /\bstart-2\.5\b/.test(cls.Select), physical(cls.Select).join(" "));
check("SearchableSelect: no physical geometry", physical(cls.SearchableSelect).length === 0, physical(cls.SearchableSelect).join(" "));
const dialogPhysical = physical(classText(dialog)).filter((c) => c !== "left-1/2");
check("Dialog: close at end-4; only the centring left-1/2 is physical (allow-listed)", /absolute end-4 top-4/.test(dialog) && dialogPhysical.length === 0, dialogPhysical.join(" "));
// The one allowed [dir] rule: the C1 chevron glyph mirror, scoped to the Radix menu content's own dir.
const CHEVRON_MIRROR = '[data-radix-menu-content][dir="rtl"] .row-menu-item.has-submenu:not(.expanded) svg:last-child { transform: scaleX(-1); }';
check("row menu: RTL chevron mirrored via the menu content's dir (collapsed only; not :dir(), which compiles to :lang())",
  legacyCss.includes(CHEVRON_MIRROR) && !/:dir\(/.test(legacyCss));
check("row menu: logical submenu (no [dir=rtl] geometry overrides, margin-inline-start: auto)", !/\[dir="rtl"\]\s*\.row-menu/.test(legacyCss.replace(CHEVRON_MIRROR, "")) && /\.row-menu-item\.has-submenu svg:last-child\s*\{[^}]*margin-inline-start:\s*auto/.test(legacyCss) &&
  !/\.row-menu-submenu[^{]*\{[^}]*(?:padding|margin|border)-(?:left|right)/.test(legacyCss));

// ---------- 5. variants ----------
const variantBlock = button.match(/variant:\s*\{([\s\S]*?)\n\s*\},\n\s*size:/)?.[1] ?? "";
const variants = [...variantBlock.matchAll(/^\s*"?([\w-]+)"?:\s*$|^\s*"?([\w-]+)"?:\s*"/gm)].map((m) => m[1] ?? m[2]);
const FINAL = ["primary", "secondary", "glass", "outline", "ghost", "destructive", "destructive-ghost", "link"];
check("Button variants are exactly the final set (R2)", JSON.stringify([...variants].sort()) === JSON.stringify([...FINAL].sort()), variants.join(","));
const vClass = (v: string) => variantBlock.match(new RegExp(`(?:^|\\n)\\s*"?${v}"?:\\s*(?:\\n\\s*)?"([^"]*)"`))?.[1] ?? "";
check("glass is an alias of secondary", vClass("glass") === vClass("secondary") && vClass("glass") !== "");
check("outline is bordered, ghost is borderless", /border-border-strong!/.test(vClass("outline")) && /border-transparent!/.test(vClass("ghost")) && !/border-border/.test(vClass("ghost")));
check("destructive-ghost: danger text, no border, danger-bg hover", /\btext-danger\b/.test(vClass("destructive-ghost")) && /border-transparent!/.test(vClass("destructive-ghost")) && /hover:bg-danger-bg/.test(vClass("destructive-ghost")));
check("destructive is danger, never navy", /\bbg-danger\b/.test(vClass("destructive")) && !/primary/.test(vClass("destructive")));
check("destructive hover = the semantic --danger-hover fill (C1)", /\bhover:bg-danger-hover\b/.test(vClass("destructive")));
check("destructive: no brightness / filter / arbitrary hex / gradient / glow / lift", !/brightness|filter|#[0-9a-f]{3,8}|\[(?:#|rgb|hsl)|gradient|shadow|translate|scale/i.test(vClass("destructive")), vClass("destructive"));
check("--danger-hover token: light-dark() beside --danger, registered <color>, Tailwind alias",
  /--danger-hover:\s*light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\);/.test(globals) && /@property --danger-hover \{ syntax: "<color>"/.test(globals) && /--color-danger-hover:\s*var\(--danger-hover\);/.test(globals));

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = join(dir, f);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}
type El = { file: string; tag: string; attrs: Record<string, string>; line: number };
const els: El[] = [];
const sources: Record<string, string> = {};
for (const file of walk("src")) {
  const text = read(file);
  sources[file] = text;
  const sfile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const attrs: Record<string, string> = {};
      for (const a of n.attributes.properties) if (ts.isJsxAttribute(a)) attrs[a.name.getText()] = a.initializer?.getText() ?? "true";
      els.push({ file, tag: n.tagName.getText(), attrs, line: sfile.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
    }
    ts.forEachChild(n, visit);
  };
  visit(sfile);
}
const at = (e: El) => `${relative("src", e.file)}:${e.line}`;
const buttons = els.filter((e) => e.tag === "Button");
const ghosts = buttons.filter((e) => e.attrs.variant === '"ghost"');
const ghostNotIcon = ghosts.filter((e) => !/^"icon(-sm)?"$/.test(e.attrs.size ?? "") || !e.attrs["aria-label"]);
check("every <Button variant=\"ghost\"> is a labelled icon action (true ghost = icon / tertiary only)", ghostNotIcon.length === 0, ghostNotIcon.map(at).join(" "));
check("ghost consumers classified: ≥ 15 icon ghosts", ghosts.length >= 15, String(ghosts.length));
const handDanger = buttons.filter((e) => /\btext-danger\b/.test(e.attrs.className ?? "") && e.attrs.variant !== '"destructive-ghost"');
check("no hand-built danger ghost (Button + text-danger) left — destructive-ghost instead", handDanger.length === 0, handDanger.map(at).join(" "));
const DANGER_GHOST_FILES = ["clients/recycle-bin-actions.tsx", "inventory/products/recycle-bin-actions.tsx", "purchasing/vendors/recycle-bin-actions.tsx",
  "purchasing/debit-notes/dn-detail-actions.tsx", "sales/credit-notes/cn-detail-actions.tsx", "sales/invoices/invoice-detail-actions.tsx", "recycle-bin/recycle-bin-client.tsx",
  "settings/presets/bundles-panel.tsx", "settings/presets/note-templates-panel.tsx", "settings/presets/simple-preset-panel.tsx", "settings/presets/terms-groups-panel.tsx",
  "settings/presets/seal-signature-panel.tsx"];
const missingDanger = DANGER_GHOST_FILES.filter((f) => !buttons.some((e) => e.file.endsWith(f) && e.attrs.variant === '"destructive-ghost"'));
check("the 12 migrated danger ghosts use destructive-ghost", missingDanger.length === 0, missingDanger.join(" "));
const unknownVariant = buttons.filter((e) => e.attrs.variant && /^"/.test(e.attrs.variant) && !FINAL.includes(e.attrs.variant.slice(1, -1)));
check("no consumer uses a variant outside the final set", unknownVariant.length === 0, unknownVariant.map((e) => `${at(e)}=${e.attrs.variant}`).join(" "));
const unknownSize = buttons.filter((e) => e.attrs.size && /^"/.test(e.attrs.size) && !Object.keys(sizeMap).includes(e.attrs.size.slice(1, -1)));
check("no consumer uses a size outside the final set", unknownSize.length === 0, unknownSize.map((e) => `${at(e)}=${e.attrs.size}`).join(" "));

// ---------- 6. radio ----------
check("RadioGroup uses native <input type=\"radio\">, role=radiogroup", /type="radio"/.test(radio) && /role="radiogroup"/.test(radio));
check("no @radix-ui/react-radio-group dependency (package.json, lock, imports)", !pkg.dependencies?.["@radix-ui/react-radio-group"] && !pkg.devDependencies?.["@radix-ui/react-radio-group"] &&
  !/node_modules\/@radix-ui\/react-radio-group"/.test(lock) && !Object.values(sources).some((s) => /@radix-ui\/react-radio-group/.test(s)));
const cts = read("src/components/client/client-type-select.tsx");
check("ClientTypeSelect uses RadioGroup (no hand-rolled radio markup)", /<RadioGroup\b/.test(cts) && /<RadioGroupItem\b/.test(cts) && !/type="radio"/.test(cts) && !/role="radio"/.test(cts));
check("ClientTypeSelect: radio name never collides with the submitted clientType field", /name=\{`client-type-choice\$\{labelId\}`\}/.test(cts) &&
  /name="clientType"/.test(read("src/app/(app)/clients/client-form.tsx")));

// ---------- 7. combobox ----------
check("SearchableSelect: role=listbox with a useId id, role=option with aria-selected", /<div ref=\{listRef\} id=\{listboxId\} role="listbox"/.test(searchable) && /useId\(\)/.test(searchable) &&
  /id=\{optionId\(i\)\}\s+role="option"\s+aria-selected=\{isSelected\}/.test(searchable));
check("SearchableSelect: combobox filter with aria-controls + aria-activedescendant + aria-expanded", /role="combobox"/.test(searchable) && /aria-controls=\{listboxId\}/.test(searchable) &&
  /aria-activedescendant=\{/.test(searchable) && /aria-expanded=\{open\}/.test(searchable));
check("SearchableSelect: ArrowDown / ArrowUp / Enter (preventDefault) handled; Escape left to the popover",
  /e\.key === "ArrowDown"/.test(searchable) && /e\.key === "ArrowUp"/.test(searchable) && /e\.key === "Enter"[\s\S]{0,120}e\.preventDefault\(\)/.test(searchable) && !/e\.key === "Escape"/.test(searchable));
check("SearchableSelect: active option scrolled into view", /scrollIntoView\(\{ block: "nearest" \}\)/.test(searchable));
check("SearchableSelect: filter / onChange / Add New contract unchanged", /o\.label\.toLowerCase\(\)\.includes\(q\) \|\| \(o\.sublabel \?\? ""\)\.toLowerCase\(\)\.includes\(q\) \|\| \(o\.keywords \?\? ""\)\.toLowerCase\(\)\.includes\(q\)/.test(searchable) &&
  /onChange\(o\.value\)/.test(searchable) && /setOpen\(false\); onAddNew\(\);/.test(searchable));

// ---------- 8. consumers ----------
const compliance = els.filter((e) => e.file.endsWith("settings/compliance/compliance-client.tsx"));
check("compliance: no raw <select> (both use the Select primitive)", !compliance.some((e) => e.tag === "select") && compliance.filter((e) => e.tag === "SelectTrigger").length >= 2);
const reports = els.filter((e) => e.file.endsWith("finance/reports/reports-workspace.tsx"));
check("reports: compare toggle is <Checkbox>, no native checkbox", !reports.some((e) => e.tag === "input" && e.attrs.type === '"checkbox"') && reports.some((e) => e.tag === "Checkbox"));
const deadWidth = buttons.filter((e) => /width:\s*"auto"/.test(e.attrs.style ?? ""));
check("no dead style width:auto on the modern <Button>", deadWidth.length === 0, deadWidth.map(at).join(" "));
check("legacy .btn width overrides untouched (still present on legacy buttons)", els.some((e) => /\bbtn\b/.test(e.attrs.className ?? "") && /width/.test(e.attrs.style ?? "")));
// Structures not yet on the 01.4 API. The DEV-UI-01.5 list structures (list-toolbar, row-menu,
// list-workspace-toolbar, table) left this list when 01.5 migrated them (verify-datatable pins their
// state); the DEV-UI-01.6 document-editor structures (line-items-editor, item-entry-cell, rich-text-field,
// terms-editor, terms-block, party-card, totals-card, doc-field-box, configure-columns-dialog, form-field)
// left it when 01.6 migrated them (verify-document-form checks them). These three are still untouched.
const EXCLUDED = ["sales/_shared/line-item-cell.tsx", "sales/_shared/doc-pills-row.tsx", "sales/_shared/bank-accounts-field.tsx"];
const excludedFiles = Object.keys(sources).filter((f) => EXCLUDED.some((x) => f.endsWith(x)));
check("every excluded structure exists", excludedFiles.length === EXCLUDED.length, `${excludedFiles.length}/${EXCLUDED.length}`);
const newApi = excludedFiles.filter((f) => /variant="(outline|destructive-ghost)"|size="icon-sm"|\bloading=\{|<RadioGroup\b/.test(sources[f]));
check("excluded 01.5 / 01.6 structures not migrated to the 01.4 API", newApi.length === 0, newApi.join(" "));
check("card radios (company panels) and document-workspace radios left as they are", /type="radio"|role="radio"/.test(sources["src/app/(app)/settings/organization/company-panels.tsx"] ?? "") &&
  /type="radio"/.test(sources["src/app/(app)/documents/_workspace/import-v2-dialog.tsx"] ?? ""));
check("Tabs primitive still maps to .tab-row / .tab (org theme selectors unchanged)", /cn\("tab-row"/.test(tabs) && /cn\("tab"/.test(tabs));
// One direction invariant for every Radix root that lays out or navigates by direction (no DirectionProvider here).
const DIR_ROOTS: [string, string, string, string][] = [["Select", select, "SelectPrimitive", "select.tsx"], ["Tabs", tabs, "TabsPrimitive", "tabs.tsx"], ["DropdownMenu", dropdown, "DropdownMenuPrimitive", "dropdown-menu.tsx"]];
check("useDocumentDir reads <html dir>", /document\.documentElement\.dir === "rtl"/.test(read(UI + "use-document-dir.ts")));
for (const [name, src, prim, file] of DIR_ROOTS) {
  check(`${name} root follows the document direction: wrapper, shared useDocumentDir, dir={dir ?? docDir}, no raw Root alias`,
    /import \{ useDocumentDir \} from "\.\/use-document-dir";/.test(src) &&
    new RegExp(`function ${name}\\(\\{ dir, \\.\\.\\.props \\}`).test(src) &&
    new RegExp(`const docDir = useDocumentDir\\(\\);\\s*return <${prim}\\.Root dir=\\{dir \\?\\? docDir\\} \\{\\.\\.\\.props\\} />`).test(src) &&
    !new RegExp(`const ${name} = ${prim}\\.Root\\b`).test(src) && !new RegExp(`${prim}\\.Root as ${name}`).test(src), file);
}
const ownDirHooks = Object.keys(sources).filter((f) => !f.endsWith("use-document-dir.ts") && /documentElement\.dir\b/.test(sources[f]) && f.startsWith("src/components/ui/"));
check("no second direction hook in the primitives", ownDirHooks.length === 0, ownDirHooks.join(" "));

let ok = true;
for (const [cond, name, extra] of results) {
  if (!cond) ok = false;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "CONTROLS VERIFICATION PASS" : "CONTROLS VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
