# DEV-UI-01.4 — Controls (implementation record)

The control family — Button, Input, Textarea, Select, SearchableSelect, Checkbox, Radio, Label, Tabs,
the Dialog close, the row-menu trigger and the legacy `.btn*` / `.doc-pill-btn` / `.tab` CSS — moved
onto one Navy Command foundation: control heights from `--control-height*` (36 / 32 / 40), the
4·6·8·12 radius family, the type scale, weights 400/500/600, and one keyboard-focus recipe (2px solid
`--focus`). **Presentation and control semantics only**: no business logic, validation, status
registry, permission, DB, accounting, inventory, payroll, lifecycle or org-theme engine change.

| File | Content |
|---|---|
| `c1-correction.md` | **C1** — DropdownMenu document direction + semantic destructive hover (`--danger-hover`), with verification and screenshot evidence. |
| `controls-audit.md` | The read-only audit (before state) + what implementation found beyond it. |
| `consumer-migrations.md` | Exact consumer lists: ghost classification, danger ghosts, icon buttons, dead widths, native → primitive, excluded structures. |
| `screenshot-change-report.json` | All 256 matrix states vs DEV-UI-01.3, with status, console, #418 and overflow before/after. |
| `controls-states-report.json` | The 112 control-gallery states (100 + 12 open-menu states added in C1) (definitions: `tests/ui-baseline/controls-states.mjs`). |
| `shell-regression-report.json` | The 44 DEV-UI-01.3 shell states recaptured on this code vs the 01.3 candidates (`c1`: C1 vs C0 — only the 4 Arabic open-menu states changed). |
| `guardrails-after.json` | Report-only guardrails after this batch. |
| `../../../tests/ui-baseline/candidates/dev-ui-01-4/` | Candidate screenshots (256 + `controls/` 112). Approved `baseline/` and the 01.1 / 01.2 / 01.3 candidates untouched. |

## Locked decisions, as implemented

| | Decision | Implementation |
|---|---|---|
| R1 (a) | Restyle legacy `.btn`, no mass migration | `mockup-parity.css`: `.btn` → `height: var(--control-height)` (36), radius 6, `--text-body`, weight 500, `:focus-visible` 2px `--focus`, disabled opacity .5; `.btn-accent` same foundation + focus; `.btn-glass` kept; **`.btn-primary { width: 100% }` kept**; no `.btn` markup or width override touched. Dead `style={{ width: "auto" }}` removed only from the modern `<Button>` (39 sites, `consumer-migrations.md` §3). |
| R2 (a) | Final Button variant set | `primary`, `secondary`, `glass` (exact alias of secondary), `outline` (the old bordered ghost), `ghost` (truly borderless), `destructive`, `destructive-ghost`, `link`. The 43 old ghost sites: 20 text/cancel → `outline`, 12 icon-only → `ghost`, 11 hand-built danger ghosts → `destructive-ghost`. |
| sizes | No 22–30px primitives | `sm` 32 (`--control-height-compact`), `default` 36, `lg` 40 (`--control-height-touch`), `icon` 36², `icon-sm` 32². |
| R5 (ii) | `loading`, no migration | `loading?: boolean`: inline spinner (lucide loader-circle path, `aria-hidden`), `aria-busy`, disabled while loading, label kept (icon-only buttons swap glyph for spinner, accessible name stays), reduced motion via the global rule; the type forbids `loading` with `asChild`. 0 "Saving…" consumers migrated. |
| R3 (a) | Checkbox checked = navy | `--primary` fill + border, `--primary-foreground` tick (≥ 4.5:1, runtime-measured in both themes; orange was 2.96:1); r4, control border, focus outline, disabled, `aria-invalid`. |
| R4 (b) | Native RadioGroup, no dependency | `src/components/ui/radio-group.tsx` on `<input type="radio">` (browser keyboard model: one Tab stop, arrows, disabled skipped). **No `@radix-ui/react-radio-group`: no dependency change (`package.json` only gains the `verify:controls` script; `package-lock.json` unchanged).** `ClientTypeSelect` migrated; card radios and document-workspace radios untouched. |
| R5 (i) | Row-menu focus now | `.row-menu-btn:focus-visible` 2px `--focus` (an unlayered rule, so it beats the trigger's `outline-none`). Row-menu content / workflow untouched. |
| FormField | Deferred to 01.6 | `form-field.tsx` not modified. |
| Shell | Frozen | `components/layout/*` and `shell.css` not modified (0 changed pixels in the top bar and sidebar across all 44 shell states). |

## Primitive changes

* **Button** — variants / sizes / `loading` above; base: `rounded-md`, `text-body` 500, 2px `--focus`
  outline offset 2 on `:focus-visible`, disabled 50% + no pointer events. Border colours carry `!`
  (see Known debt 1) — before this the primary button showed a grey 1px border and "transparent"
  borders were not transparent.
* **Input** — read-only treatment only: `--canvas` fill + quiet `--border`, not on disabled, text at
  full contrast (distinct from the input fill in light and dark). Borders `!` so the 3:1 control
  border actually renders.
* **Textarea** — rebuilt on the Input foundation: `text-body`, r6, control border, input background,
  hover, 2px focus, disabled tokens, `aria-invalid`, `min-h-24`.
* **Select** — trigger 36px / r6 / `text-body` / control border / input background / hover /
  `:focus-visible` 2px (was `h-10`, 13.5px, an 18%-alpha `focus:` ring); content r8; items logical
  `ps-8 pe-3`, tick at `start-2.5` in `--accent-ink`, selected `--accent-tint` + 600. **Root takes the
  document direction** (Radix wrote `dir="ltr"` onto the Arabic list).
* **SearchableSelect** — same trigger foundation; listbox semantics: the filter is the
  `role="combobox"` (`aria-controls`, `aria-activedescendant`, `aria-expanded`,
  `aria-autocomplete="list"`), a `role="listbox"` (useId id) of `role="option"` (`aria-selected`);
  ArrowDown / ArrowUp move the active option (scrolled into view), Enter selects (never submits a
  form), Escape closes via the popover and returns focus. Filter, options, `onChange`, Add New
  unchanged.
* **Checkbox / RadioGroup** — above. **Label** — `text-body-sm` 500.
* **Tabs** — `.tab-row` r8, no shadow (no pill); `.tab` `text-body-sm` 500 / active 600, r6,
  `:focus-visible` 2px `--focus`; active colours still the org-themeable `--active-tab-*` vars
  (`brand-theme.ts` unchanged). **Root takes the document direction** (arrow keys ran backwards in
  Arabic).
* **Dialog** — close button `right-4` → `end-4` + focus-visible outline (`left-1/2` centring kept).
* **Menus** — `.row-menu-item` 12.5px → `--text-body` 13px (**the one shell-visible change**: the
  account menu's "Log out" item, the only `.row-menu-item` in a shell menu); submenu geometry logical
  (`margin-inline-start: auto`, `border-inline-start`, `padding-inline-start`), the two
  `[dir="rtl"]` overrides removed; submenu items `--text-body-sm`.
* **Legacy CSS** — only `.btn`, `.btn-primary` (unchanged width), `.btn-glass`, `.btn-accent`,
  `.doc-pill-btn` (control height, `--text-body-sm`, r8, focus-visible, value 600), `.row-menu-btn`,
  `.row-menu-item`, `.tab-row`, `.tab`, `.field label` (`--text-body-sm`).
* **New** `use-document-dir.ts` — the `<html dir>` read on the client (hydration-safe
  `useSyncExternalStore`), passed to the Radix Select, Tabs and (C1) DropdownMenu roots.
* **C1** — `DropdownMenu` root wrapper (`dir={dir ?? docDir}`; Arabic menus now RTL, `align="end"`
  logical, Radix submenus open and key by direction; row-menu chevron mirrored in RTL); solid
  `destructive` hover `hover:brightness-95` → `hover:bg-danger-hover` (new semantic token
  `--danger-hover`). See `c1-correction.md`.

## Verification

All on the final code, in isolated git worktrees with **no repository `.env`**: database suites ran
against fresh TEST-ONLY copies of the synthetic seed (`devui010_test_only_*`, host 127.0.0.1); the
browser tier's temporary `.env` named only such a copy and was deleted after each run.

* **TypeScript** clean. **ESLint** on all 60 changed source files: 0 errors (1 pre-existing warning in
  an untouched line of `verify-dirty-core.mjs`).
* **verify:static** — exit 0: role-matrix 32/32, confirm-policy 62/62, dirty-form 66/66, skeletons
  89/89, contrast 159/159, typography 43/43, status-registry 88/88, shell 75/75, **controls 102/102**
  (new, wired into `verify:static`), edit-action, store-model, provider-harness, backup-claims,
  money-precision, ledger-only-balances.
* **verify:controls** (new, `verify/verify-controls.mts`) — geometry (control heights from
  `--control-height*`, no literal heights, radius family, type scale, 400/500/600 on primitives and
  legacy CSS), the focus recipe on Button / Input / Textarea / SelectTrigger / SearchableSelect /
  Checkbox / Radio / Dialog close / `.btn` / `.btn-accent` / `.doc-pill-btn` / `.row-menu-btn` /
  `.tab`, no low-alpha or `focus:` rings, disabled / invalid / read-only / loading / checked states,
  RTL (no physical Select / SearchableSelect geometry; Dialog `left-1/2` allow-listed; logical
  submenu), document direction on Select / Tabs, the exact variant + size sets, every ghost consumer
  classified, no hand-built danger ghost, native radio + no Radix radio dependency, SearchableSelect
  ARIA + keyboard code, consumer boundaries (no raw compliance select, no native reports checkbox, no
  dead `width:auto` on `<Button>`, legacy `.btn` widths kept, 17 excluded 01.5 / 01.6 structures not
  on the 01.4 API). **Mutation-tested: 48 mutations, 48 caught.**
* **verify-controls-runtime** (new, browser tier, refuses a non-test database) — **226/226**. Real
  primitives (gallery bundle, no app route) EN / AR × light / dark: Button sizes 32/36/40/36²/32² for
  every variant, 13px / 500 / r6, transparent vs bordered variants, `destructive-ghost` = `--danger`,
  `glass` ≡ `secondary`, loading → disabled + `aria-busy` + spinner with label / accessible name kept,
  disabled 50%; computed keyboard focus (settled after the transition) 2px solid `--focus` on Button,
  `.btn`, `.doc-pill-btn`, Input, Textarea, SelectTrigger, SearchableSelect, Checkbox, Radio, Tab and
  `.row-menu-btn`; Input control border, Input / Textarea invalid + disabled tokens, read-only distinct;
  Select 36px and top-aligned with Input, list in the document direction, tick at the inline start
  (right in Arabic), selected tint + 600, ArrowDown + Enter; Select and SearchableSelect contained at
  390px; SearchableSelect combobox → listbox, `aria-activedescendant` on the selected option,
  ArrowDown, Enter selects and closes, filter, Escape returns focus; Checkbox Space + tick/fill ≥ 4.5 +
  `--primary` fill; native radio arrows skip the disabled option, one Tab stop; Tabs arrows move and
  activate (mirrored in Arabic), 12px / 600; row menu opens from the keyboard, items 13px, Escape
  returns focus. Real app: Compliance Selects (36px combobox with `label for`, keyboard choice,
  placeholder → choice), Reports compare Checkbox ↔ `compare=1`, Client Type radios drive the hidden
  `clientType`, the shell's account / favorites / notifications menus open in the viewport and return
  focus on Escape (EN / AR × light / dark), no shell or page overflow at 1440 / 390. **Mutation-tested
  (each with a fresh build): loading `aria-busy`, Select direction, Tabs direction, SearchableSelect
  ArrowDown, row-menu focus, checkbox fill, dark read-only, ghost border — 8 / 8 caught** (one
  further mutant was equivalent: the base class already makes borders transparent).
* **Full browser tier — 44 / 44 suites pass**, incl. shell-runtime 341/341, controls-runtime 226/226,
  color-theme, dark-theme, staff-runtime, staff-replay, dirty-core 72/72, dirty-ui 8/8, confirm-e2e,
  vendor-inline, registration-currency.
* **Guardrails** (report-only) — entry G1 189 / G2 336 / G3 49 / G4 0 / G5 30 sites · 27 keys →
  **176 / 326 / 44 / 0 / 30 · 27**. Every decrease is control-local (`mockup-parity.css` control rules,
  `select.tsx`, `dialog.tsx`, `label.tsx`, `textarea.tsx`, `searchable-select.tsx`, `checkbox.tsx`);
  no file increased.

### Existing suites adapted — selector only, no assertion changed

`SearchableSelect` options became `role="option"` (they were plain `<button>`s), so the ten places
that picked a country or client by `getByRole("button", …)` now use `getByRole("option", …)`:
`verify/register-org.mjs` (shared `pickCountry`), `verify-registration-currency.mjs`,
`verify-reversal-status.mjs`, `verify-register-outstanding.mjs`, `verify-statement-reversal.mjs`,
`verify-dirty-core.mjs` (`[data-radix-popper-content-wrapper] [role="option"]` — the old `button`
selector would now hit "Add New"), `verify-draft-func.mjs`, `verify-edit.mjs`,
`verify-preset-zatca.mjs`, `verify-print-apply.mjs`. Comments describing the old markup updated.

### Screenshots

* **256-state matrix**, twice on the final code, each from a fresh build → **256 / 256
  byte-identical**. Versus DEV-UI-01.3: 256 changed (every page carries at least one restyled control —
  `.btn` rows 42 → 36px, Select / Tabs / ghost restyles — and login's Sign in button); 0 non-200;
  React #418 40 → 40 (pre-existing); 0 other console errors; overflow 24 → 24 states, none
  increased, two decreased (clients list AR 390: 30 → 29px); no page grew taller; **0 changed pixels in
  the top bar and sidebar / rail across all 256**. Per-state detail: `screenshot-change-report.json`.
* **Control gallery** (`capture-controls`, new) — **100 states**: buttons, fields, selects,
  searchables, checks, tabs + row menu × EN / AR × light / dark × 1440 / 390 (48); Select open and
  SearchableSelect open, all axes (16); SearchableSelect filtered and keyboard-active, EN / AR light ×
  1440 / 390 (8); keyboard focus on Button, Input, SelectTrigger, Checkbox, Radio, Tab, row-menu
  button, EN / AR × light / dark @1440 (28). Twice → 100 / 100 byte-identical; 0 non-200, 0 console
  errors, 0 overflow; IBM Plex Sans + IBM Plex Sans Arabic loaded. `controls-states-report.json`.
* **Shell regression** — the 44 DEV-UI-01.3 shell states recaptured twice (44 / 44 byte-identical):
  4 identical, 40 changed, **0 changed pixels in the top bar and sidebar in every state**; the only
  change inside an open shell surface is the account menu's "Log out" item (13px, documented); the
  notifications menu, drawer (390 / 768), command-palette and record-search panels were inspected
  pixel-unchanged; the rest is page content behind / through the overlays. (No shell state opens
  the favorites menu; it is covered by verify-controls-runtime and verify-favorites instead.) `shell-regression-report.json` (recaptures are evidence, not committed
  as candidates).

## Known remaining debt

1. **Unlayered `* { border-color: var(--border) }` in `globals.css`** outranks every layered Tailwind
   border-colour utility app-wide (`border-line-strong`, `border-danger`… on non-primitive markup
   silently render `--border`). The control primitives work around it with `!`; the global rule
   should move into `@layer base` in a dedicated batch (it changes every bordered element).
2. **No Radix `DirectionProvider`.** Select, Tabs and — since C1 — DropdownMenu pass the document
   direction explicitly; an app-wide provider remains a later option. `DropdownMenuSubContent` (no
   consumer) has no panel styling (see `c1-correction.md`).
3. `.row-menu-btn` stays 30px (row action inside tables — DEV-UI-01.5 owns its size).
4. Dark `--disabled-background` (#1f2338) is almost the dark `--input-background` (#1e2239);
   disabled fields rely on the disabled text colour in dark mode.
5. 33 "Saving…" buttons not migrated to `loading` (R5-ii); ≈73 `.btn` sites restyled, not migrated (R1).
6. Remaining G3 items in the primitives: the SearchableSelect filter input and the Select / Dialog
   inner `outline-none` (focus is shown by the open popover / item highlight).
7. FormField error association, doc-header fields, line items, rich text, terms, party / totals
   cards (DEV-UI-01.6); DataTable, list-workspace filter popover, toolbars, configure-columns,
   row-menu content (DEV-UI-01.5).
8. The visual-baseline seed stores `client_type = 'business'` for companies (the app uses
   `company`), so neither Client Type radio is checked on that synthetic client — data, not a control
   defect (identical in the DEV-UI-01.3 candidates).

