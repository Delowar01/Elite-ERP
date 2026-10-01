# DEV-UI-01.0 — visual baseline & guardrails (measurement record)

**Zero intended UI pixels changed.** No file under `src/` or `drizzle/` is touched by this batch.
The harness lives in [`tests/ui-baseline/`](../../../tests/ui-baseline/README.md); this folder holds
the measured guardrail baseline and what the screenshot baseline showed.

| File | Content |
|---|---|
| `guardrails-baseline.json` | Report-only counts with file:line for every hit (G1–G5). Regenerate with `npm run ui:guardrails`. |
| `../../../tests/ui-baseline/baseline/` | 256 PNGs + `manifest.json` (per-state sha256, HTTP status, final path, `lang`/`dir`/`data-theme`, horizontal overflow, loaded fonts, console errors). |

## Screenshot matrix

16 routes × {en, ar} × {light, dark} × {1440×900, 1024×768, 768×1024, 390×844} = **256 states**,
full-page, frozen at `2026-06-15T09:00:00Z` (server and browser), synthetic seed only.

Reproducibility: two independent runs, **each with its own fresh `next build`** and its own fresh
copy of the TEST-ONLY database → **256 / 256 byte-identical PNGs**.

## What today's UI does (captured as-is, not fixed)

| Observation | Measured |
|---|---|
| HTTP status | 256 / 256 = 200; no redirects |
| `lang` / `dir` / `data-theme` | correct in 256 / 256 states |
| Horizontal page overflow at 1440 | 0 / 64 states |
| … at 1024 | 60 / 64 (every authenticated route; 16–21 px) |
| … at 768 | 60 / 64 (272–277 px) |
| … at 390 | 60 / 64 (549–577 px) — the sidebar never collapses into a mobile pattern |
| Only non-overflowing route | `/login` (all widths) |
| Arabic font | none loaded; Arabic renders in the system fallback (DejaVu Sans here) |
| React hydration error #418 | 40 states: Arabic, on `/dashboard`, `/clients/1`, `/projects`, `/projects/1`, `/finance/reports`. Reproduced **with the clock freeze disabled**, so not a harness artifact. With browser locale `ar-SA` the same five routes also fail in English — server and browser format text differently when they run under different default locales. Pre-existing; recorded, not fixed. |

## Static guardrails — baseline counts (REPORT-ONLY)

| | Guardrail | Count | Notes |
|---|---|---|---|
| G1 | Physical-direction styling | **204** in 57 files | 162 Tailwind (`text-right` 133), 38 CSS (`mockup-parity.css` 36), 4 inline styles |
| G2 | Font sizes off the 9-step scale (11·12·13·14·16·18·20·24·30) | **364** in 95 files | screen 344, print 20; commonest 12.5px (136), 11.5px (93), 10.5px (31) |
| G3 | `outline-none` without a `focus-visible` replacement | **57** | 2 class strings do provide one |
| G4 | Local status → variant/colour maps | **20** in 20 files | 19 page-local maps + the shared `status-badge.tsx` (0 callers) |
| G5 | `t()` keys missing from the dictionary | **30** call sites, 27 distinct keys | dictionary 1,599 keys; 1,997 literal calls checked; 219 dynamic calls not statically checkable |

Two consecutive runs produce byte-identical JSON. Counts are measurements of a pattern with
evidence per hit, not a claim that every hit is a visible defect.

## A harness defect found and fixed during this batch

The first full capture recorded HTTP 500 on `/finance/reports`, `/finance/statements` and
`/settings/organization`, plus React #419/#441 errors. Root cause was **the harness**, not the app:
Next.js re-wraps `globalThis.Date` by copying the constructor's *own* properties, and the first
version of `freeze-time.cjs` only *inherited* `Date.parse` / `Date.UTC`. The preload now copies
every static as an own property; all 256 states return 200 and the server log is error-free. That
first capture was discarded in full and re-taken; none of it is in the committed baseline.
