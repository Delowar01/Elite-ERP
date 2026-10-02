# DEV-UI-01.3 — App shell (implementation record)

The persistent chrome around every authenticated page — sidebar, top bar, mobile navigation —
moved onto the Navy Command system. **Presentation and interaction only**: no route, permission,
search, notification, favorites, organisation-theme, status-registry or business logic changed.

| File | Content |
|---|---|
| `shell-audit.md` | The read-only audit (before state) and the reviewer's H1 correction. |
| `screenshot-change-report.json` | All 256 matrix states vs the merged DEV-UI-01.2 state, incl. overflow before/after. |
| `shell-states-report.json` | The 44 new shell-only states (definitions: `tests/ui-baseline/shell-states.mjs`). |
| `guardrails-after.json` | Report-only guardrails after this batch. |
| `../../../tests/ui-baseline/candidates/dev-ui-01-3/` | Candidate screenshots (256 + `shell/` 44). Approved `baseline/`, 01.1 and 01.2 candidates untouched. |

## Locked decisions, as implemented

| | Decision | Implementation |
|---|---|---|
| D-01.3-A | Navy sidebar, both appearances | `--sidebar-bg: light-dark(var(--brand-navy), var(--brand-navy-deep))`. Ink is the approved light text (white / `#eceef7`); muted ink, border, hover and selected tint are `color-mix` of approved colours — no new palette. Org logos sit on a white plate so a dark logo stays legible. |
| D-01.3-B | Tint + inline-start indicator, weight 600, no glow | `.nav-list .nav-item.active`: `--sidebar-selected-tint` background, `::before` 3px bar at `inset-inline-start`, `aria-current="page"`. Both tint and bar derive from `--selected-item-background`, so an org's Selected-item colour still drives the state (runtime-tested with an override; label contrast ≥ 4.5 asserted for very light → very dark org colours). The extra class + `!important` outrank the org engine's injected solid `.nav-item.active` fill — `brand-theme.ts` is unchanged. |
| D-01.3-C | Flatten one-item groups | `NavList`: a group with one visible item renders without a header (Projects, Inventory, Clients; for Staff also Administration → Security Center). Routes, labels, icons, permissions unchanged. |
| D-01.3-D | Settings gear owner/admin only | `SETTINGS_ROLES = ["owner", "admin"]`, asserted equal to `requireRole(...)` on `/settings/organization`. Server guard unchanged. |
| D-01.3-E | EN \| ع | `language-switcher.tsx`: two always-visible buttons (`aria-pressed`, own `lang`, endonym names), same cookie + `setLocaleAction`. No flags, no menu. In the top bar at every width. |
| D-01.3-F | Non-H1 title + resolver | Title stays the existing `<h3 class="topbar-title">` (no H1 added; `page-header.tsx` untouched). `shellTitleKey()` picks the most specific nav item or extra shell route — `/recycle-bin` → "Recycle Bin" (not added to the sidebar); nested `/new`, `/[id]`, `/…/recycle-bin` keep their parent. |
| D-01.3-G | ≥1280 rail per preference · 1024–1279 66px rail · <1024 drawer | CSS gives the geometry from the first paint (asserted with JavaScript off); `sidebar.tsx` switches content (tooltips, no group headers) after hydration. The expand toggle is hidden at 1024–1279; the `sidebar_collapsed` cookie still applies ≥1280. |

## What changed

* **One navigation layer** — `nav-config.ts` (the only item list) + `visibleNavGroups()` (the only
  role filter, also used by the command palette) + `isNavActive()` + `shellTitleKey()`;
  `nav-list.tsx` (the only renderer: `<nav aria-label>`, `aria-expanded` + `aria-controls`,
  `aria-current`), used by `sidebar.tsx` and the new `mobile-nav.tsx`.
* **Sidebar** — navy, logical CSS, RTL-mirrored panel icon, token type (400/500/600, the 9-step
  scale), 6px radius items, focus-visible inside the scrolling column. The `BUILT_ROUTES` prefetch
  allow-list was removed: every configured nav route has a page (asserted), so it was a no-op.
* **Mobile drawer** (`mobile-nav.tsx`, on the Radix `ui/drawer.tsx`) — opens from inline-start
  (left EN, right AR), same `NavList`, org context, closes on navigation and Escape; Radix provides
  the focus trap, focus return and inert background. Below 640px it also carries theme, favorites,
  notifications, settings and the account (top-bar space is kept for menu, title, search, ⌘K, EN | ع).
* **Drawer primitive** — logical `side="start" | "end"`, `start-0`/`end-0`, `border-e`/`border-s`,
  close at `end-4` with a translatable name; no blur. It had no other users.
* **Top bar** — sticky, title never collapses (min 6rem, ellipsis), actions shrink by breakpoint;
  search box ≥1024, compact search icon below; solid avatar (`--primary`); account menu keeps name,
  email, role, Log out; the badge uses `inset-inline-end`.
* **Command palette / record search** — now Radix dialogs (focus trap, inert page), focus returns to
  whatever opened them (`TopbarSearch`), radius 12, scale typography, no blur. Commands, search,
  grouping and the Ctrl/⌘+K shortcut are unchanged.
* **Theme toggle** — reads the live `<html data-theme>`, so the top-bar copy, the drawer copy and the
  palette's "Switch appearance" never disagree. Same cookie + action.
* **Icons** — Client & Vendor Statements `FileText → BookUser`; Compliance Center
  `FileCheck2 → ClipboardCheck` (labels/routes unchanged).
* **Accessibility** — skip link → `main#main-content`, labelled nav landmarks, labelled drawer,
  focus-visible on every shell control, `aria-controls`, `aria-current`, indicator beyond colour,
  reduced motion (global rule) verified.
* **CSS** — the shell block left `mockup-parity.css` for the new `src/app/(app)/shell.css` (logical
  properties; one `[dir]` rule for a rotation that has no logical form). `.topbar-search` (shared
  with list toolbars) and `.cmdk-kbd` (asserted by `verify:typography`) stay in `mockup-parity.css`.
* **Dictionary** — 4 additive keys: Main navigation, Skip to main content, Open navigation, Close
  navigation (Language already existed).

## Responsive acceptance (verify-shell-runtime, every cell EN/AR × light/dark, /dashboard and /sales/invoices)

| Width | Rail | Shell overflow | Title | EN \| ع | Navigation | Search | Account / Log out |
|---|---|---|---|---|---|---|---|
| 1440 | 240 (or 66 by preference) | 0 | visible | top bar | sidebar | box | top bar |
| 1024 | 66 (always) | 0 | visible | top bar | rail | box | top bar (avatar) |
| 768 | none | 0 | visible | top bar | drawer | icon | top bar (avatar) |
| 390 | none | 0 | visible | top bar | drawer | icon | drawer |

Rail on the inline-start side in both directions; drawer from inline-start; no visible shell control
outside the viewport in any cell.

### Page-level overflow (whole page, from the 256-state capture)

| Width | Before (01.2) | After | Note |
|---|---|---|---|
| 1440 | 0 / 60 | 0 / 60 | |
| 1024 | 60 / 60, max 21px | **0 / 60** | the shell was the cause |
| 768 | 60 / 60, max 277px | **0 / 60** | the shell was the cause |
| 390 | 60 / 60, max 558px | 24 / 60, max 302px | remaining is page content (not this batch) |

Known remaining page-level overflow at 390 (out of scope — page headers, tables, document editor):
invoice detail 298–302px, invoice editor new/edit 109–157px, settings/organization (EN) 92px, client
detail 54–65px, clients list 30–37px (page header actions don't wrap), employees 1px (EN). No state
overflows more than before.

## Verification

* **verify:shell** (new, in `verify:static`): 75 checks — landmark, skip link, main id, no H1, the
  settings guard equals the page guard, one nav source / filter / renderer, flattening (owner and
  staff), aria-controls / aria-current, unique icons, every nav route built, EN | ع placement and no
  flags, title resolver + Arabic for every shell string, logical CSS, no gradient, 400/500/600, type
  scale, radius family, no glow, indicator + org-driven tint, focus-visible, breakpoints, drawer
  logic, no blur, contrast of the navy frame for default and sample org colours. Mutation-tested: 29
  mutations, each fails it.
* **verify-shell-runtime** (new, browser tier): 341 checks — the responsive matrix above, first paint
  with JavaScript off, drawer (side, trap, Escape, focus return, inert, closes on navigation),
  palette / record search (trap + focus return at 1440 and 390, Ctrl+K), aria-current on nested
  routes, focus-visible, skip link, collapsed cookie, /recycle-bin, EN | ع switching, org
  Selected-item override, reduced motion, Staff shell + server guard. Mutation-tested (drawer side,
  focus return, 240px tablet rail, hidden language control — each fails it).
* Screenshots: 256-state matrix twice → 256/256 byte-identical; 240 changed vs DEV-UI-01.2 (every
  authenticated state — the shell is on every page), login identical. Shell states twice → 44/44
  byte-identical. 0 non-200, 0 new console errors; React #418 40 → 40 (pre-existing, Arabic
  dashboard/projects/reports/client detail; the shell states hit it only where they load the Arabic
  dashboard).

### One existing suite adapted (no assertion changed)

`verify-dirty-ui` navigated away at 390px by clicking the sidebar's Dashboard link — which only
existed there because the 240px desktop rail leaked into mobile (the defect D-01.3-G removes). It now
reaches the same link through the navigation drawer below 1024px; all 8 assertions are unchanged.
Running it exposed a real interaction bug, fixed in `mobile-nav.tsx`: the unsaved-changes guard
stops link clicks in the document capture phase, so the drawer stayed open under the confirmation
and Radix then pulled focus back to the menu button. The drawer now closes in the window capture
phase (before the guard) and skips its focus return when a link closed it, so focus stays on
"Keep Editing" and remains trapped in the confirmation.

### Test-environment note

Twelve browser suites read `DATABASE_URL` straight from the repository `.env` file. During this
batch two of them (`verify-color-theme`, `verify-dark-theme`) were once started from the main
checkout, where that file points to a LOCAL development database (127.0.0.1, not production); each
ran one read-only `select … where email = $1`, matched nothing and exited — no writes. From then on
every browser suite ran only in an isolated git worktree whose temporary `.env` named a fresh
TEST-ONLY copy of the synthetic seed (removed after each run).

## Exclusions (deliberately not touched)

`page-header.tsx` and page headings; DataTable, controls, tables, document shell / editor /
breadcrumbs, page archetypes; status registry; lifecycle; DB, `src/db`, `drizzle`, migrations;
accounting, inventory, payroll; permission rules and routes; search, notification, favorites and
organisation-theme logic; multi-org (none exists, none invented); page-level overflow; hydration
#418; gradients and 800 weights outside the shell; Vercel / production configuration.

Notes: stored notification descriptions remain untranslated (data, not UI). Generic `<Avatar>` still
has `font-bold` in its primitive; the shell overrides it to 600 rather than changing a shared
component used by pages.
