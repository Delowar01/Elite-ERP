<!-- The DEV-UI-01.4 read-only audit as delivered (before state, main 5232b53), followed by what
     implementation found that the audit did not. Reviewer verdict on §R: APPROVED WITH CONDITIONS
     (R1 a, R2 a, R3 a, R4 b, R5 i + ii) — see README.md. -->

# DEV-UI-01.4 — READ-ONLY CONTROLS AUDIT

**Summary:** the app has two button systems side by side: the token-based `<Button>` (36 px) and the older `.btn` CSS classes (42 px, used in about 73 places). The Select family is 40 px against the Input's 36 px. Its focus indicator is a faint 18%-alpha ring, and in Arabic the selected-option tick sits on the wrong side. The row-action menu button has no visible focus at all. Button and Input are already on the approved tokens. The proposed scope is in §P; five decisions in §R need a reviewer before implementation.

## A. Baseline
- local `main` = `origin/main` = `5232b53cbea97ce110c2b8572e3672487fc61cc9`; tree `6cb997baa25dc64d98be800bd8995b8f860336f9`.
- Working tree clean before and after. No `claude/dev-ui-01-4-controls` branch exists (nothing matches "01-4").
- **No files modified.** No branch, commit, push, screenshot change or deployment.
- **Evidence:**
  - AST inventory of all `.tsx` files.
  - A read-only Playwright probe against a build of the `main` tree, on a TEST-ONLY database copy (`devui010_test_only_verify`, cloned from the synthetic seed, dropped afterwards). It used explicit test-only environment values; the repository `.env` was not used.

## B. Control inventory (real primitives, measured at 1440 EN light)
| Primitive | File | Variants / sizes | Measured | Uses |
|---|---|---|---|---|
| **Button** | `ui/button.tsx` (CVA) | primary (default), secondary, glass (= secondary alias), ghost (**has a border**), destructive, link · default 36 / sm 32 / lg 40 / icon 36 | h36 r6 13/500; focus 2px `--focus` offset 2 | 148 in 65 files: default/primary 66, ghost 43, glass 19, secondary 17, destructive 3; size sm 27, icon 16, **lg 0** |
| **Input** | `ui/input.tsx` | (type passthrough) | h36 r6 13/400, border-control, `--input-background`; focus 2px `--focus`; `aria-invalid` red border; disabled tokens | 130 in 39 files (number 26, date 14, email 7, password 5) |
| **Textarea** | `ui/textarea.tsx` | — | min-h 96, r8, **13.5 px**, border line-strong, bg surface, **18% orange ring**, disabled opacity .5 | **1 consumer** (`note-templates-panel`); 3 raw textareas elsewhere |
| **Select** (Radix) | `ui/select.tsx` | Trigger / Content / Item | trigger **h40 r8 13.5 px**, `outline-none`, `focus:` ring 3px at **18%**; item `pl-8 pr-3`, tick at `left-2.5` | 58 Select in 35 files; 84 items; 21 triggers with `className` |
| **SearchableSelect** (combobox) | `ui/searchable-select.tsx` | Popover + filter input + option buttons | trigger h40 r8 13.5 px, same ring; options are plain buttons (no `role="option"`/listbox, no arrow keys) | 6 in 5 files (party card, address fields, register, currency pill, company panels) |
| **Checkbox** (Radix) | `ui/checkbox.tsx` | — | 16 px, **r5**, checked = orange fill + white tick, ring 3px at **30%**, **no disabled style** | 10 in 8 files |
| **Tabs** (Radix) | `ui/tabs.tsx` → `.tab-row` / `.tab` in `mockup-parity.css` | — | tab h34 **r999 (pill)** 12.5 px/600; row r16 + shadow; active colours org-themeable (`activeTab`); browser-default focus | 14 triggers in 1 file (settings) |
| **Label** | `ui/label.tsx` | — | **12.5 px**/500 | 26 in 12 files |
| **FormField** | `ui/form-field.tsx` | label + children + error | `error` prop renders `<p>`, **never used (0 callers pass `error`)**, not linked to the control | 136 in 26 files |
| DropdownMenu (Radix) | `ui/dropdown-menu.tsx` → `.row-menu*` CSS | — | items r8 12.5 px/500; `[data-highlighted]` visible | 11 files, **shared with the shell** |
| Popover / Dialog / Drawer | `ui/popover`, `ui/dialog`, `ui/drawer` | containers | dialog close button `right-4` (physical) | — |
| **Switch / RadioGroup** | **none** | — | `@radix-ui/react-switch` is installed but has 0 consumers; there is no radio-group package | — |

**Older parallel control CSS (`mockup-parity.css`):**

| Class | Values | Uses |
|---|---|---|
| `.btn` | h42 r6 13/**600**, disabled opacity .55 | 69 |
| `.btn-glass` | (with `.btn`) | 45 |
| `.btn-primary` | **width:100%** | 22 |
| `.doc-pill-btn` | h36 **r9** 12/500, browser-default focus | 22 |
| `.row-menu-btn` | 30 px, **no visible focus at all** | 1 component, every list row |
| `.tab` (raw) | — | 7 |
| `.input` (raw) | only background + transition | 36 |
| `.btn-accent` | h40, org-themed | 0 TSX uses; referenced by `brand-theme.ts` |
| `.field .input` | h42 r10 | document headers |
| `.add-row-btn`, `.select-pill` | — | 5 / 1 |

## C. Raw control and bypass inventory (248 raw elements)
| Group | Count | Where | Class |
|---|---|---|---|
| `<button class="btn btn-glass/primary">` + `.btn` on `<Link>`/`<a>`/`<label>` | 58 + 15 | dialogs (customize layout, column config, date/number/validity/party settings, client/vendor create, crop upload), doc action bar, list toolbar, error / not-found pages | **2 → migrate** (or restyle the class onto tokens; see R1) |
| `style={{ width: "auto" }}` on `<Button>` | 38 | 17 files | **2** — has no effect; it only overrides the old `.btn-primary` width, which `<Button>` never had |
| `<Button variant="ghost" className="text-danger …">` | 6 | delete/remove actions | **2/3** — hand-built "danger ghost"; needs a variant |
| Bare icon `<button class="p-1 text-ink-faint hover:text-…">` | ~20 | bank-accounts field, customize layout, payments, journal, delete/reverse/refund, seal/signature, notices | **3 → needs a compact icon-button size**. All have names; hit targets are about 22 px |
| Small text-link buttons (`text-[11–12px] … hover:text-brand-orange`) | ~10 | import-v2, company panels, statements, compliance | **2** → Button `link` (small) |
| Raw `<select>` in compliance | 2 | `compliance-client.tsx` | **2** → Select (h42 r10, browser-default focus) |
| Native `<input type=checkbox>` | 1 | finance reports "compare" | **2** → Checkbox |
| Hand-built radios: `client-type-select` (`role=radio`), company-panels mode cards, import-v2 native radio, print-layout cards | 4 groups | | **3** → RadioGroup primitive (R4); the card radios are justified composites |
| Hand-built tabs (`button.tab`, `role=tab`) | reports, company-panels edit mode, terms-block | | reports/company → **2** (Tabs); terms-block → **4** (DEV-UI-01.6) |
| Statement filter chips (`h-7 rounded-full`) | 1 group | statement-view | **4** (page archetype) |
| Document header fields (`.doc-field` raw date/select/input), `doc-gear-btn`, line items (`.item-cell-input`, 11), `item-entry-cell`, rich-text toolbar, terms editor/block, party card edit buttons, totals-card number | ~60 | document editors | **4** (DEV-UI-01.6) |
| List-workspace filter popover (`select/date.input.plain`, 6), list/recycle search inputs, configure-columns dialog (`.input` ×9), `row-menu-btn` | ~18 | | **4** (DEV-UI-01.5 DataTable); the `row-menu-btn` focus fix is R5 |
| Shell: palette/search inputs and rows, notifications/favorites inline buttons, nav, topbar | ~15 | `components/layout` | **4** (DEV-UI-01.3, approved; do not touch) |
| Hidden inputs (16), file inputs (4, visually hidden / triggered), colour inputs (2) | 22 | | **1 justified** |

## D. Button findings
- **The primitive is on tokens:** 36/32/40 heights from `--control-height*`, radius 6, body 13/500, a correct 2px `--focus` outline, navy primary and danger destructive.
  - The outline fades in over 150 ms. My first probe read it mid-transition and saw `currentColor`; the settled measurement is the correct orange in both themes.
- **Two button systems side by side:** the older `.btn` is **42 px / weight 600** next to 36 px / 500 primitives (for example the list toolbar and document action bars). The DEV-UI-01.1 comment explicitly deferred these heights to this batch.
- **Ghost has a border** (`border-border-strong`), so it is really an "outline" variant. There is no true borderless ghost and no `outline` name.
- `secondary` and `glass` are identical.
- **No danger-ghost variant:** 6 call sites build one by hand. Destructive hover uses a `brightness-95` filter instead of a token.
- **No loading/pending state.** 33 call sites swap the label to "Saving…"; there is no spinner and no `aria-busy`.
- **Disabled opacity is inconsistent:** primitive 0.5, `.btn` 0.55.
- **Icon-only:** `size="icon"` is 36 px; the bare icon actions are about 22 px (see L).
- **Dead consumer code:** 38 × `style={{ width: "auto" }}`.

## E. Input / Textarea findings
- **Input is compliant:** 36, r6, 13 px, control border, input background, `--focus` outline, `aria-invalid` red border, disabled tokens.
- **Input gaps:**
  - no read-only styling (one `readOnly` use);
  - no prefix/suffix API (search fields build their own wrappers);
  - `aria-invalid` is used in only one place (address fields).
- **Textarea does not match Input:**
  - radius 8 (Input 6);
  - 13.5 px, off the type scale;
  - `line-strong` border instead of the control border;
  - `surface` background instead of the input background;
  - 18%-alpha ring instead of the `--focus` outline;
  - disabled state uses opacity, not the tokens;
  - no `aria-invalid` styling.
- **Numeric fields:** tabular figures are inherited from `body`; no alignment rule. The document-editor numeric cells are DEV-UI-01.6.

## F. Select / Combobox findings
- **Trigger:**
  - **40 px against Input's 36**, so mixed form rows misalign;
  - radius 8 (Input 6), 13.5 px off-scale;
  - `outline-none` plus a `focus:` (not `focus-visible`) 3px ring at 18% orange, roughly 1.3:1 against white, below the 3:1 needed for a focus indicator;
  - no disabled or invalid styling;
  - `bg-surface` against Input's `--input-background`, which differs slightly in dark mode.
- **Item:** physical `pl-8 pr-3` and the tick at `left-2.5`. **In Arabic the tick sits on the far side from the text.**
  - 13.5 px off-scale.
  - Selected state is a `brand-orange/12` tint plus weight 600, with an orange tick (about 2.96:1 on white).
- **Content:** radius 12, `shadow-glass`, `min-w-8rem`. Radix keyboard support (arrows, typeahead, Escape) is correct.
- **SearchableSelect:**
  - trigger has the same issues as Select;
  - option list has no listbox/option semantics, no `aria-selected` and no arrow-key navigation (Tab only);
  - inner search input 13.5 px;
  - selected state is a tint plus an orange tick.
- **Page-specific, not primitives:** the 21 `SelectTrigger className` overrides are mostly widths for field layout. The document-header raw selects are DEV-UI-01.6.

## G. Checkbox / Radio / Switch findings
- **Checkbox:**
  - radius 5 (off the family);
  - checked = orange fill with a white tick, about 2.96:1, just below 3:1 (R3);
  - focus ring at 30% alpha, not the `--focus` outline;
  - **no disabled style**;
  - labels come from wrapping `<label>` elements in consumers, so alignment varies.
- **Radio:** no primitive. `client-type-select` builds `role="radiogroup"`/`radio` with `aria-checked`. Its 20 px tall hit area is acceptable only through the spacing exception. Focus is the browser default.
- **Switch:** none in the UI; the package is unused. No one-off switches found. The "compare" toggle in reports is a native checkbox.
- **Shared tokens:** these controls share none — sizing, focus and checked colour differ for each one.

## H. Token and style deviations (controls only)
| Deviation | Where |
|---|---|
| Hard-coded heights | Select/SearchableSelect `h-10` (40); `.btn` 42; `.btn-accent` 40; `.doc-pill-btn` 36 literal; `.field .input` 42 |
| Off-scale sizes | 13.5 px (Select trigger/item, SearchableSelect, Textarea); 12.5 px (Label, `.tab`, `.row-menu-item`, `.field label`) |
| Weights 600 where the primitive uses 500 | `.btn` 600, `.tab` 600, `.doc-pill-btn .dpb-val` **700** |
| Radii off 4/6/8/12 | Checkbox 5; `.doc-pill-btn` 9; `.tab` 999; `.tab-row` 16; compliance select 10 |
| Focus | Button/Input/`.btn` use `outline 2px --focus` (correct); Select/SearchableSelect/Textarea/Checkbox use translucent `ring` (18–30%); Tabs/doc-pill/raw controls use the browser default; `.row-menu-btn` has **none** |
| Disabled | 0.5 / 0.55 / tokens / none |
| Colours | Selected states use `brand-orange/10–12` tints and orange ticks (low contrast) rather than `--accent-tint` + `--accent-ink` |

Gradients and glows: none in the control primitives.

**Guardrail hits that belong to controls:**
- **G1 (6):** `ui/select.tsx:64` `pl-8`/`pr-3`, `:69` `left-2.5`; `ui/dialog.tsx:34` `left-1/2` (centering, justified), `:40` `right-4`; `mockup-parity.css:418` `.row-menu-item.has-submenu` margin (has an RTL override).
- **G2:** primitives 9 (`searchable-select` 3, `select` 2, `textarea` 1, `label` 1, `dropdown-menu` 1, `filter-panel` 1) plus 5 control rules in `mockup-parity.css` (12.5/13.5 px).
- **G3 (11):** `checkbox:12`, `dialog:34,40`, `dropdown-menu:30,57`, `popover:23`, `searchable-select:71,87`, `select:20,64`, `textarea:9`.
- **G4 / G5:** no control hits.

## I. State matrix (✓ present · ~ inconsistent · ✗ missing)
| Control | Default | Hover | Focus-visible | Pressed | Disabled | Invalid | Read-only | Loading | Selected | Dark | AR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Button | ✓ | ✓ | ✓ | ~ (secondary only) | ✓ (.5) | n/a | n/a | **✗** | n/a | ✓ | ✓ |
| `.btn` legacy | ~ 42 px | ✓ | ✓ | ~ | ~ (.55) | n/a | n/a | ✗ | n/a | ✓ | ✓ |
| Input | ✓ | ✓ | ✓ | n/a | ✓ | ✓ | **✗** | n/a | n/a | ✓ | ✓ |
| Textarea | ~ | **✗** | ~ (ring) | n/a | ~ (opacity) | **✗** | ✗ | n/a | n/a | ✓ | ✓ |
| SelectTrigger | ~ 40 px | **✗** | ~ (18% ring, also on click) | n/a | **✗** | **✗** | n/a | n/a | n/a | ~ bg | ~ item tick side |
| SearchableSelect | ~ | ✗ | ~ | n/a | ~ | ✗ | n/a | n/a | ~ | ✓ | ✓ |
| Checkbox | ~ r5 | ✗ | ~ (30% ring) | n/a | **✗** | ✗ | n/a | n/a | ~ (2.96:1) | ✓ | ✓ |
| Radio (custom) | ~ | ~ | browser | n/a | ✗ | ✗ | n/a | n/a | ✓ aria-checked | ✓ | ✓ |
| Tabs | ~ pill | ✓ | browser | n/a | ✗ | n/a | n/a | n/a | ✓ (org-themed) | ✓ | ✓ |
| `.doc-pill-btn` | ~ r9 | ✓ | browser | ✓ (open) | ✓ | n/a | n/a | n/a | n/a | ✓ | ✓ |
| `.row-menu-btn` | ✓ | ✓ | **✗ none** | ✓ (open) | n/a | n/a | n/a | n/a | n/a | ✓ | ✓ |

## J. RTL findings (control-local only)
- **SelectItem:** physical padding and the tick at `left-2.5`, so in Arabic the tick sits opposite the text. Fix with `ps-8 pe-3 start-2.5`.
- **Dialog close button:** `right-4`. Fix with `end-4` (the drawer was already fixed in DEV-UI-01.3).
- **`.row-menu-item.has-submenu`:** `margin-left: auto` plus a separate `[dir=rtl]` override. Fix with `margin-inline-start: auto`.
- **SearchableSelect:** uses `text-start` and flex. Correct.
- **Chevrons in triggers:** flex order. Correct.
- **Checkbox/label order:** follows DOM and flex. Correct.

## K. Accessibility findings (control level)
- **Focus indicators:** below 3:1 on Select, SearchableSelect, Textarea and Checkbox; absent on `.row-menu-btn` (every list row's actions button).
- **SearchableSelect:** missing listbox/option semantics, `aria-selected` and arrow-key operation.
- **Errors:** `aria-invalid` is used only in address fields. `FormField` has an `error` slot but no id or `aria-describedby`, and no caller uses it.
  - The primitive can support this.
  - Wiring per-field errors into forms is form architecture (DEV-UI-01.6).
- **Pending buttons:** label swap only, no `aria-busy`.
- **Names and labels:**
  - all bare icon buttons and `size="icon"` Buttons have names;
  - the probe flagged six address inputs and some search inputs as label-less (placeholder only);
  - the address-field labelling belongs to form architecture.
- **Disabled semantics:** native `disabled` is used (correct). The Radix Checkbox has no visual disabled state.

## L. Responsive / touch (1440 / 1024 / 768 / 390)
- **Comfortable controls:** primitives are 36 px; touch size (`--control-height-touch` 40, Button `lg`) exists but is unused.
- **Small targets:** bare icon actions about 22 px; `.row-menu-btn` 30; client-type radios 93×20 (passes only through spacing); 16 px checkboxes (wrapping labels enlarge the target).
- **Viewport clipping:**
  - Select and dropdown content stays within the viewport (Radix collision handling);
  - long Arabic option labels wrap inside items;
  - SearchableSelect content uses the trigger width.
- **Wrapping:** older `.btn` toolbars wrap at 390 px (page-level layout, DEV-UI-01.5/01.7). There was no control-local overflow at 1024/768.

## M. Shell and shared-primitive dependencies (DEV-UI-01.3 must not regress)
| Shared item | Shell use | Rule |
|---|---|---|
| `ui/dropdown-menu.tsx` + `.row-menu*` CSS | Account, favorites and notifications menus | Item changes must keep shell menu sizing; covered by the shell S5/S7 screenshots and `verify-shell-runtime` |
| `.topbar-search` base rule | List toolbars **and** the shell search box | `shell.css` overrides height, radius and font for the shell. Do not change the base rule without re-capturing the shell states |
| `.cmdk-kbd` | Shell | Asserted by `verify:typography`; leave as is |
| `ui/drawer.tsx`, Avatar, Radix dialogs in palette/search | Shell | Out of scope; do not touch |

- The shell does **not** use Button, Input, Select, Textarea, Checkbox or Tabs. `.topbar-icon-btn`, `.topbar-lang-option` and the shell focus rules are shell-owned and excluded.
- The EN | ع control is a segmented control. If a `SegmentedControl` primitive is added, the shell should **not** be migrated to it in this batch.

## N. Screenshot plan
**Existing 256 states that already exercise controls:**
- login (Input, Button);
- settings-organization (Tabs, Input, SearchableSelect, colour inputs);
- sales-invoice-new/edit (`.btn`, doc-pill, Select, Input; document fields excluded);
- the 4 lists (`.btn-glass`, doc-pill, `row-menu-btn`, Checkbox toolbar);
- hr-employees (Button);
- finance-reports (raw tabs/date/checkbox);
- finance-statements.

Expect changes wherever `.btn`, Select or Tabs are restyled.

**Proposed additive `capture-controls` mode, deterministic, TEST-ONLY:**
1. **Primitive gallery** (about 32 states).
   - The real primitives are server-rendered into one page using the build's compiled CSS and fonts, so no app route is added.
   - Content: Button (6 variants × 4 sizes + disabled + loading), Input (default, placeholder, disabled, read-only, invalid), Textarea, SelectTrigger (placeholder, value, disabled, invalid), SearchableSelect trigger, Checkbox (unchecked, checked, disabled), Tabs, FormField with error.
   - Captured at EN/AR × light/dark × 1440/390, plus a keyboard-focus pass (Tab through, screenshot each focused group).
2. **In-app interaction states** (about 16).
   - Select open (`/hr/employees/new`, EN/AR);
   - SearchableSelect open (register or settings);
   - Checkbox checked (customize-layout dialog);
   - invalid (address-fields postal code, typed);
   - legacy dialog buttons (date-settings dialog);
   - list toolbar at 390.

Total about 48 states. Each set is captured twice for byte-reproducibility. The approved baseline and the 01.1/01.2/01.3 candidates stay untouched.

## O. Verification plan
**`verify/verify-controls.mts`** (static plus server-render, added to `verify:static`):
- **Sizing and type:** every primitive's height comes from `--control-height*` (no `h-10`/`h-[42px]` literals in `ui/*` or the control CSS); type-scale classes only; weights 400/500/600; radii 4/6/8/12.
- **Focus:** one focus recipe (`focus-visible:outline-2 … outline-focus`, or `outline: 2px solid var(--focus)` in CSS) on Button, Input, Textarea, SelectTrigger, SearchableSelect trigger, Checkbox, Tabs, `.btn`, `.doc-pill-btn`, `.row-menu-btn`; no `focus:ring-*/NN` alpha rings; no `outline-none` without a focus-visible replacement in `ui/*`.
- **States:** shared disabled recipe; `aria-invalid` styling on Input/Textarea/SelectTrigger/Checkbox.
- **RTL:** no physical `pl-/pr-/left-/right-` in control primitives (dialog centring allow-listed).
- **Button:** variant set, sizes and `loading` → `aria-busy` + `disabled`, server-rendered.
- **SearchableSelect:** `role=listbox`/`option` + `aria-selected`, server-rendered.
- **Consumers:** no `style={{ width: "auto" }}` on `<Button>`; no hand-built danger ghost; no raw `<select>` outside an explicit allow-list (DEV-UI-01.6 document fields, DEV-UI-01.5 DataTable/filters); the old `.btn` rule uses the control tokens.
- **Mutation targets:** Select back to `h-10`; restore the 18% ring; `rounded-[5px]`; `font-bold`; physical `pl-8`; drop `aria-invalid` styling; reintroduce `width: auto`; add a raw `<select>` to a page; `.btn` back to 42 px; remove `.row-menu-btn` focus.

**`verify/verify-controls-runtime.mjs`** (browser tier): **needed**, because some checks only work at runtime:
- the settled computed focus colour after the 150 ms transition, on each control, in light and dark;
- Arabic SelectItem tick side;
- Select and SearchableSelect open within the 390 px viewport with Arabic labels;
- SearchableSelect arrow keys and Enter;
- Checkbox keyboard toggle;
- hit-target sizes at 390;
- no regression of shell menus.

## P. Proposed DEV-UI-01.4 implementation scope
**A. Primitives (`src/components/ui/`)**
- `button.tsx`:
  - ghost/outline per R2;
  - `destructive-ghost` variant (the 6 hand-built sites);
  - destructive hover via token;
  - `icon-sm` size (32 px) for compact actions;
  - optional `loading` (spinner + `aria-busy`), per R6;
  - `secondary`/`glass` kept as one recipe.
- `input.tsx`: read-only style; otherwise unchanged.
- `textarea.tsx`: match Input (control border, input background, r6, `text-body`, `--focus` outline, disabled tokens, `aria-invalid`).
- `select.tsx`:
  - trigger to `--control-height`, r6, `text-body`, `focus-visible` outline, disabled and invalid states, `--input-background`;
  - items made logical (`ps-8 pe-3 start-2.5`);
  - selected state via `--accent-tint` / `--accent-ink`;
  - content r8.
- `searchable-select.tsx`: same trigger recipe; listbox/option semantics and `aria-selected`; arrow keys and Enter. Filtering logic and the add-new behaviour stay unchanged.
- `checkbox.tsx`: r4, checked colour per R3, `--focus` outline, disabled and invalid states.
- `label.tsx`: `text-body-sm`.
- `form-field.tsx`: give the error an id and expose it for `aria-describedby` (optional prop). No form changes.
- `tabs.tsx` + the `.tab-row`/`.tab` CSS: radius family, weight 500/600, `--focus` outline. Org-themed active colours stay.
- New `radio-group.tsx` only if R4 approves.
- `dialog.tsx`: close button at `end-4` (control-local G1).

**B. Older control CSS (`mockup-parity.css`, control rules only)**
- `.btn` / `.btn-glass` / `.btn-primary`: `--control-height`, weight 500, shared disabled recipe; `.btn-primary` width rule handled per R1.
- `.doc-pill-btn`: r8 and `--focus` outline.
- `.row-menu-btn`: `--focus` outline (R5).
- `.btn-accent`: `--control-height`.
- `.row-menu-item`: logical submenu margin, `text-body-sm`. Shell menus must stay pixel-stable apart from the deliberate change.
- `.field label`: type scale.

**C. Directly necessary consumers**
- Remove the 38 dead `style={{ width: "auto" }}`.
- The 6 danger-ghost sites move to the new variant.
- Compliance's 2 raw selects → Select.
- Reports' native checkbox → Checkbox.
- About 20 bare icon actions → `Button size="icon-sm" variant="ghost"` (presentation only; handlers unchanged).
- `client-type-select` → RadioGroup (if R4).
- Migrating the 58 `.btn` sites to `<Button>` only if R1 chooses migration.

**D. Verification:** `verify/verify-controls.mts` (+ `package.json`), `verify/verify-controls-runtime.mjs`, `tests/ui-baseline/run.mjs` `capture-controls` mode plus a gallery renderer under `tests/ui-baseline/`.

**E. Documentation:** `docs/ui/dev-ui-01-4/` (README, controls-audit, screenshot reports, guardrails).

**Expected guardrails:** G1 −3 to −5 (select, dialog, row-menu); G2 −10 to −14; G3 −8 to −11. G4 stays 0; G5 unchanged.

## Q. Explicit exclusions
- **DEV-UI-01.6:** document header fields (`.doc-field`, `doc-gear-btn`), line items (`.item-cell-*`, `item-entry-cell`), rich-text toolbar, terms block/editor tabs, totals card, party-card edit buttons.
- **DEV-UI-01.5:** list-workspace filter popover and toolbars, configure-columns dialog, row-menu content beyond the button's focus.
- **Shell (DEV-UI-01.3):** `components/layout/*`, `shell.css`, the EN | ع control, palette and search inputs, `.topbar-*`.
- **Not touched at all:**
  - status registry;
  - form layouts, page error summaries, validation rules;
  - org-theme engine (`brand-theme.ts` selectors `.btn-accent`, `.nav-item.active`, active tab);
  - business logic, DB, migrations, lifecycle, accounting, inventory, payroll, permissions;
  - page-level overflow;
  - unrelated G1/G2/G3/G5 debt;
  - production and Vercel configuration.

## R. Reviewer decisions needed
1. **R1 — Older `.btn` buttons (73 sites).**
   - (a) Restyle the `.btn*` CSS onto the control tokens (36 px, weight 500): one rule, no markup churn.
   - (b) Migrate every site to `<Button>`.
   - **Recommendation: (a).** Optionally migrate dialogs touched for other reasons. Either way about 30 screens get a 6 px shorter button row.
2. **R2 — Ghost has a border (43 uses).**
   - (a) Keep today's look and rename it `outline`, then add a true borderless `ghost` for icon and tertiary actions.
   - (b) Make `ghost` borderless now, which visibly changes 43 sites.
   - **Recommendation: (a).**
3. **R3 — Checkbox checked colour.** Orange plus white tick is about 2.96:1, below the 3:1 graphical minimum.
   - (a) Navy primary fill (Navy Command primary).
   - (b) Darker accent (`--accent-ink`).
   - **Recommendation: (a)**, with orange kept for focus only.
4. **R4 — Radio primitive.** Adding `@radix-ui/react-radio-group` is a **new dependency**.
   - (a) Add it and build `RadioGroup`.
   - (b) Build `RadioGroup` on native radios with no new dependency.
   - (c) No radio primitive; only restyle the existing ones.
   - **Recommendation: (b).**
5. **R5 — Scope edges.**
   - (i) Fix `.row-menu-btn`'s missing focus in DEV-UI-01.4 (one CSS rule; it is the DataTable row action). Recommended: yes.
   - (ii) Add a `loading` prop to Button without migrating the 33 "Saving…" sites. Recommended: add it, migrate none.

**(Audit ended here — read-only; implementation followed the reviewer verdict.)**

## Addendum — found during implementation (not in the audit above)

1. **Unlayered `* { border-color: var(--border) }` in `globals.css`.** Unlayered CSS outranks every
   layered Tailwind utility, so `border-border-control`, `border-border-strong`,
   `border-transparent` and `focus-visible:border-focus` never applied anywhere: Inputs rendered
   the pale `--border` (not the 3:1 control border the audit's §B reported from the class list),
   and the navy primary Button carried a grey 1px border. Fixed **inside the control primitives**
   with Tailwind's important suffix (`border-border-control!`…); the global rule is left in place
   (it is the app-wide default for every bordered element) and recorded as known debt.
2. **Radix direction.** The app sets `<html dir>` but mounts no Radix `DirectionProvider`, so every
   Radix primitive assumes LTR in Arabic. The audit's "tick on the wrong side" was only partly
   physical padding: Radix Select wrote `dir="ltr"` onto its portalled list, laying the options out
   left-to-right, and Radix Tabs ran ArrowLeft / ArrowRight backwards. Both primitives now take the
   document direction (`use-document-dir.ts`). DropdownMenu has the same defect but is shared with
   the frozen shell's menus — recorded as debt, not changed.
3. **SearchableSelect options were `<button>`s.** Becoming `role="option"` (listbox semantics) changed
   the selector six existing browser suites used to pick a country / client; updated (selector only,
   no assertion changed).
4. **Dark read-only.** `--surface-subtle` equals the dark `--input-background` (#1e2239), so a
   subtle-fill read-only state was invisible in dark mode; read-only uses `--canvas` instead.
