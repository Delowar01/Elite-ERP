# Elite ERP × Lead Capture Pro design system — Phase 0 migration audit

Status: **Phase 0 complete** (audit only, no product code changed by this document).
Branch: `feat/erp-lcp-design-system`, created from `origin/main` = `83e8093276b36320754972f845c38f23fd28fa61`
(the ACC-01 squash merge; it matches the "known verified baseline" named by the design kit, so no newer
HEAD had to be reconciled).

The reference kit (`Elite-ERP-LCP-Design-System-Kit`, extracted from `Delowar01/Exhibition-Lead-Pro` @
`8baaa00364b677c702bb557ca13959ae04a5d824`) was read from outside the repository and is **not committed**.
Nothing from it is executed or copied verbatim into the app; its CSS uses HSL triplets that are
incompatible with this codebase (see §3).

## 1. Baseline gates (unmodified `83e8093`, TEST-only database)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit -p .` | exit 0 |
| Lint (CI scope) | `npx eslint src --max-warnings=0` | exit 0 |
| Lint (whole repo, informational) | `npx eslint` | 11 errors / 22 warnings, all pre-existing in `docs/audits/**`, `scripts/tests/**`, `verify/**` (outside the CI lint scope); the redesign must not add any |
| Static verifiers | `npm run verify:static` (21 suites, synthetic TEST DB `devui010_test_only_verify`) | exit 0 — contrast, typography 43/43, status-registry 88/88, shell 75/75, controls 110/110, datatable 69/69, document-form 78/78, edit-action 59/59, store-model 69/69, provider-harness 302/302, backup-claims 26/26, money-precision, number-locale, date-timezone, business-dates, ledger-only-balances, page-archetypes 253/253 |

No `.env` exists in the worktree; no production, Neon or VPS resource was contacted.

## 2. What the ERP is today

* Next.js App Router, React, TypeScript, Tailwind v4, lucide icons, Radix primitives (hand-built).
* **Design authority:** "Navy Command" (DEV-UI-01.1 … 01.7). `src/app/globals.css` declares every colour
  **once** as `light-dark(<light>, <dark>)`, registers each one as `@property … { syntax: "<color>" }`, and
  `src/lib/design-tokens.ts` mirrors the values; `verify:contrast` fails on any drift and measures 30
  pairs × 2 appearances against WCAG.
* **Appearance:** `theme` cookie → `data-theme` on `<html>` → `color-scheme`; no cookie = OS preference.
  One token block serves both modes, so there is no flash and no second dark block.
* **Per-organisation Color Theme** (`src/lib/brand-theme.ts`): stored primary / accent / legacy gradient
  stops / per-mode overrides → contrast-validated semantic tokens, injected server-side as one
  `:root{…light-dark()…}` block before paint. The untouched default org injects **nothing**.
* **Shell:** full-height navy sidebar (240 px / 66 px rail), white top bar with the contextual page
  title, mobile drawer < 1024 px (`src/components/layout/*`, `src/app/(app)/shell.css`).
* **Primitives:** `src/components/ui/*` (Button, Card, Input, Table, StatusBadge, Tabs, Dialog, Drawer…),
  page archetypes (`PageHeader`, `StatRow`, `ListEmptyState`), legacy class layer
  `src/app/(app)/mockup-parity.css` (cards, document editor, data table, dashboard, kanban).
* **Typography:** IBM Plex Sans (UI) + IBM Plex Sans Arabic (Arabic fallback in the same stack) +
  IBM Plex Mono (codes / IDs / hashes only); nine-step type scale; tabular figures by default.
* **Routes:** 72 `page.tsx` files (inventory in `ERP_LCP_ROUTE_MATRIX.md`).

## 3. Token collision (why LCP CSS cannot be pasted)

| LCP (`lcp-tokens.css`) | ERP | Consequence of pasting |
|---|---|---|
| `--primary: 24 100% 50%` (a bare HSL triplet, read as `hsl(var(--primary))`) | `@property --primary { syntax: "<color>" }` | A triplet is not a valid `<color>`: the declaration is **invalid at computed-value time** and the property falls back to its initial value `transparent` — every primary button would lose its fill |
| `--background`, `--border`, `--accent`, `--ring`, `--card`… | same names, registered `<color>`s with ERP meanings (`--accent` = the orange marker, `--background` = legacy canvas alias) | same failure, plus semantic clashes (`--accent` is a neutral hover fill in LCP, the brand marker in the ERP) |
| `.dark { … }` second block | one `light-dark()` block switched by `color-scheme` | a second block would drift and break `verify:contrast` ("ONE dark definition") |
| `--sidebar` = header **and** platform sidebar surface | `--sidebar-bg` = the navy rail | LCP's sidebar is light (`bg-card`); its `--sidebar` paints the header |

**Adapter decision (D-LCP-1).** The LCP web palette is *resolved* into HEX and written into the existing
canonical ERP tokens (`TOKENS` in `design-tokens.ts`, mirrored in `globals.css` as `light-dark()`), so every
existing consumer — Tailwind utilities, legacy CSS, the org-theme engine, charts — re-skins without a
second variable system. New shell surfaces get their own registered tokens (`--header-*`), and the LCP
reference values are recorded in `ERP_LCP_TOKEN_MAP.md`. No raw HSL triplet enters the app.

## 4. Contrast facts that force documented deviations (measured with `src/lib/contrast.ts`)

| Pair | Ratio | Rule it breaks |
|---|---|---|
| white on `#FF6600` (LCP primary button / active nav) | **2.94:1** | text ≥ 4.5 |
| `#FF6600` vs white surface (button boundary) | **2.94:1** | UI ≥ 3 (`verify:contrast` "primary boundary vs surface") |
| `#212121`-class ink on `#FF6600` | 5.48:1 | passes |
| LCP warning `#BD6705` on white / on its tint | 4.11 / 3.78 | text ≥ 4.5 |
| LCP destructive `#EF4343` on white; white on it; on dark card | 3.78 / 3.78 / 4.26 | text ≥ 4.5 |
| LCP `--input` border `#E2E4E9` vs white | 1.27 | control boundary ≥ 3 (WCAG 1.4.11) |
| LCP dark canvas `#1A1A1A` vs card `#212121` | 1.08 | ERP "dark canvas/surface distinguishable ≥ 1.15" |
| LCP sidebar group label `muted-foreground/70` | ≈ 2.8 | text ≥ 4.5 |

Resolution (details in the token map): the orange fill keeps its hue with a **dark INK foreground**
(`#17173f`, the same INK the org-theme engine already picks for light brand colours); the light-mode
fill is the engine's own 3:1 adaptation of `#FF6600` (`#F06000`), dark mode renders `#FF6600` exactly;
warning / danger / control borders are darkened (light) or lightened (dark) along their LCP hue until
they pass; the dark card is lifted to `#272727`. **No contrast check is lowered or removed.**

## 5. Owner-decision re-baseline (visual decisions superseded by the LCP direction)

The master prompt supersedes the Navy Command *visual* decisions. Each verifier assertion that encodes
one of them is **re-encoded to the new decision with the same strictness**, never deleted:

| Old decision (asserted by) | New decision (D-LCP-…) |
|---|---|
| D-03 navy primary + white text (`verify:contrast` §11/§12) | D-LCP-2: LCP orange primary, contrast-validated INK foreground |
| D-01.3-A navy sidebar in both modes (`verify:shell`) | D-LCP-3: dark 56 px header (LCP navy `#1A1C2E` light / card dark), light 256 px sidebar on the card surface, 68 px mini rail, drawer < 768 px |
| D-01.3-B selected = tint + indicator bar (`verify:shell`) | D-LCP-4: selected = solid selected-item fill (org colour, AA foreground) + LCP `shadow-sm` |
| weights 400/500/600 only; no shadows in the shell (`verify:shell`) | D-LCP-5: Inter 400/500/600/700; only the LCP-rendered Tailwind shadow scale |
| D-13 status = 4 px tag, no dot (`verify:status-registry`) | D-LCP-6: soft rounded-full pill with a dot (tone colours unchanged) |
| IBM Plex Sans UI face (`verify:typography`) | D-LCP-7: Inter (Latin UI) via `next/font`; IBM Plex Sans Arabic keeps Arabic glyphs; IBM Plex Mono keeps codes |

Assertions that protect **behaviour** (role filter, guards, ARIA, skip link, focus-visible, logical
properties / RTL, translations, money/number formatting, document-form behaviour, page-archetype business
pins, ACC-01 approved delta) stay exactly as they are.

## 6. Organisation themes (no database writes)

* DB column defaults are the legacy Elite pair (`#1B1B4E` / `#E87722`, gradient mode). An org that never
  customised stores exactly those values and keeps rendering the **stock** palette — which becomes LCP.
* The LCP system preset (`single`, `#FF6600` / `#FF6600`) is recognised as default as well, so saving the
  panel without changes still injects nothing.
* Any other stored value is a custom theme and keeps being generated by the unchanged engine, now over
  the LCP neutrals.
* The Color Theme panel shows the preset values for a default org (display-only normalisation); the
  database row changes only when an owner/admin presses Save.

## 7. Protected paths (must not appear in `git diff --name-only`)

`src/db/**`, `drizzle/**`, `src/lib/inventory-costing.ts`, `src/lib/inventory-valuation.ts`,
`src/lib/credit-note-returns.ts`, posting / journal / settlement / ledger services, `src/lib/zatca*`,
`src/app/api/**`, auth / session / MFA / CSRF / rate-limit internals, export / import / PDF / print
generators, `scripts/**` migration tooling, `.github/**`. Server actions are not edited; where a page
file must change, only presentation markup changes and the page-archetype business pins prove it.

## 8. Phase plan

| Phase | Scope |
|---|---|
| 1 | tokens + `design-tokens.ts` parity, header/sidebar tokens, Inter, org-theme preset, token map, dev-only specimen |
| 2 | shell (header / sidebar / drawer) + primitives (button, card, input, select, table, status pill, tabs, dialog, drawer, menus, empty state, page header, KPI cards) |
| 3–5 | route families: shared archetype CSS first (lists, documents, dashboard, finance, HR, settings, auth), then per-route fixes found by screenshots |
| 6 | screenshot matrix (EN/AR × light/dark × 1440/1280/1024/820/390/360), side-by-side with the kit, verifiers, browser tier, changed-file audit |
| 7 | handover, draft PR, CI — no merge, no deployment |
