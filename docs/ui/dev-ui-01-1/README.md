# DEV-UI-01.1 — tokens, typography & fonts (implementation record)

Navy Command foundation only (owner decisions D-01…D-18 locked). No shell, page, table, editor,
status-registry or settings redesign; no schema, migration or business-logic change.

| File | Content |
|---|---|
| `screenshot-change-report.json` | Per state: before/after sha256, % pixels changed (any channel > 8/255), height, horizontal overflow, React #418 counts, Arabic-font proof. |
| `typography-inventory.md` | DEV-UI-01.1-C1: every Mono usage classified — code/ID kept, numeric moved, ambiguous listed. |
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

## DEV-UI-01.1-C1 — typography semantics correction

**Root cause.** 1724131 moved money off IBM Plex Mono by redefining the *Mono alias itself*
(`--font-mono` and Tailwind `font-mono` → the UI face). That removed Mono from every legitimate
identifier as well — document numbers, SKUs, account codes, VAT/tax IDs.

**Rule after the correction.**

| Semantic | Face | How |
|---|---|---|
| UI, body, headings | IBM Plex Sans → IBM Plex Sans Arabic | `--font-ui` |
| Codes, IDs, hashes, document numbers, SKUs, account codes, VAT/tax IDs, numbering samples, hex colours | **IBM Plex Mono** | `font-mono`, `font-code`, `.mono`, `var(--font-mono)` (= `--font-code-family`) |
| Money, prices, rates, quantities, balances, percentages, payroll, counts, dates, times | UI face + `tabular-nums` | `num-tabular` utility / `var(--font-numeric)`; `Money` and `DocNum` apply it themselves |

The two semantics are independent tokens: nothing in the numeric style can reach the code face.
`verify:typography` (43 checks, part of `verify:static`) pins both sides and was mutation-tested
against the original mistake, a numeric style pointed at Mono, `Money` losing its class, and a call
site wrapping `Money` in Mono — each fails.

**Screenshots.** Two independent runs: 256/256 byte-identical. Against the 01.1 candidate: 164 states
differ, all text-only (0 image-size, 0 height and 0 overflow changes; max 2.1 % of pixels, median
0.17 %). The candidate in `tests/ui-baseline/candidates/dev-ui-01-1/` is the corrected one.

