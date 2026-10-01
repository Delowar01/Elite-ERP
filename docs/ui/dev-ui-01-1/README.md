# DEV-UI-01.1 — tokens, typography & fonts (implementation record)

Navy Command foundation only (owner decisions D-01…D-18 locked). No shell, page, table, editor,
status-registry or settings redesign; no schema, migration or business-logic change.

| File | Content |
|---|---|
| `screenshot-change-report.json` | Per state: before/after sha256, % pixels changed (any channel > 8/255), height, horizontal overflow, React #418 counts, Arabic-font proof. |
| `guardrails-after.json` | Report-only guardrail counts after this batch (DEV-UI-01.0 baseline: `../dev-ui-01-0/guardrails-baseline.json`). |
| `../../../tests/ui-baseline/candidates/dev-ui-01-1/` | The 256 candidate screenshots + manifest. **The approved DEV-UI-01.0 `baseline/` is untouched**; promoting the candidate is the reviewer's decision. |

## What changed

* **One token source.** `src/lib/design-tokens.ts` holds the light and dark palette; `globals.css`
  declares each colour once as `light-dark(<light>, <dark>)`, switched by `color-scheme`
  (`data-theme` cookie, else the OS). The two duplicated dark blocks (explicit toggle + OS media
  query) are gone. Every `light-dark()` colour is registered with `@property … syntax: "<color>"`,
  so script and `getComputedStyle` read the resolved per-mode colour.
* **Legacy names are aliases** (`--ink`, `--line`, `--primary-background`, `--brand-orange`, …) that
  point at the canonical tokens — untouched screens inherit the palette instead of breaking.
* **Primary action = navy + white (D-03); orange = accent / focus / active marker.**
* **SOLID-ONLY (D-04).** `--brand-gradient` resolves to a solid colour; the org theme engine never
  paints a gradient on a core control. Legacy gradient stops are still stored and editable; the
  end stop becomes the org's solid accent (default end stop = Elite orange).
* **Typography.** IBM Plex Sans (Latin) → IBM Plex Sans Arabic (Arabic glyphs) in one stack; IBM
  Plex Mono only for codes/keys/hashes; Plus Jakarta Sans retired; nine-step scale as `text-caption …
  text-display` with taller Arabic line heights; body 14px, tabular figures; no uppercase or tracking
  in Arabic; headings 600; fonts loaded 400/500/600 only.
* **Primitives.** Button (36/32/40px, flat, 6px), Input (36px, 6px, 3:1 control border, focus
  outline, `aria-invalid`), Card (8px, border-led, no shadow, no lift). Legacy `.btn` / `.card`
  rules follow the same styling with their heights unchanged.

## Verification

| | Result |
|---|---|
| Screenshot matrix | 256/256 captured, all HTTP 200, 0 new console errors, server log clean |
| Reproducibility | two independent runs (fresh build + DB copy each): 256/256 byte-identical |
| vs DEV-UI-01.0 baseline | 256/256 changed (canvas colour + fonts are global); median 67% of pixels |
| Arabic font | loaded in 128/128 Arabic states (was 0/128); Plus Jakarta loaded in 0/256 |
| React #418 | 40 → 40 (unchanged; pre-existing) |
| Overflow | unchanged counts (60/64 at 1024, 768, 390); max at 390 fell 577 → 558 px (invoice detail) |
| Browser tier (42 suites) | approved main and this branch, each in its own worktree on a TEST-ONLY database: identical 41/42; the one failure (`verify-pdf-branding`) is environmental and identical on both, and passes 15/15 on both with `CHROMIUM_EXECUTABLE_PATH` set |

### A regression this batch introduced and then fixed

The first candidate capture showed several small (`size="sm"`) buttons with **invisible labels**
(navy on navy) — on 7 routes, including login. Cause: `cn()` uses tailwind-merge, which did not
know the new `text-body-sm` utility was a font size and removed the button's text-colour class.
Fixed in `src/lib/utils.ts` by registering the type scale with tailwind-merge; `verify-contrast`
now asserts every Button variant × size keeps its foreground colour through `cn()` (mutation-tested:
it fails on all six `sm` variants without the fix).

## Remaining legacy gradients (not core tokens; owned by later stages)

| Where | Owner stage |
|---|---|
| `mockup-parity.css` `table.doc-items-table thead th` (document editor items header) | DEV-UI-01.6 |
| `mockup-parity.css` `.doc-brand-panel` (subtle surface gradient) | DEV-UI-01.6 |
| `app-shell.tsx` avatar fallback | DEV-UI-01.3 |
| kanban / employee avatar fallbacks | DEV-UI-01.7 |
| Settings → Color Theme "Gradient Color" option and its sample swatch | settings stage — the option still saves, but is no longer painted on core controls |
