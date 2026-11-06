# Elite ERP × Lead Capture Pro design system — final handover

**Status:** implemented on `feat/erp-lcp-design-system` and verified on TEST-only data. **Not merged, not
deployed.** Nothing touched `main`, the VPS, `elite-erp.service`, the hosted dev site, Neon or any
database outside the disposable `devui010_test_only_*` copies. Deployment needs a separate, explicit
instruction (§10).

Base: `main` @ `83e8093` (ACC-01). Reference: `Delowar01/Exhibition-Lead-Pro` @ `8baaa00` (the LCP web app).

## 1. What changed

| Layer | Change | Where |
|---|---|---|
| Tokens | LCP web palette resolved from its HSL triplets to HEX inside the existing registered `<color>` tokens (no second variable system, no LCP CSS pasted); light primary `#F06000` / dark `#FF6600` with the LCP white label (owner decision — below AA, §7); LCP neutrals, status tones, shadows, focus ring, motion | `globals.css`, `design-tokens.ts` (parity) |
| Type | Inter 400–700 (Latin UI, `next/font`, self-hosted, no binaries); IBM Plex Sans Arabic 400–600; IBM Plex Mono for codes; LCP sizes (body 14/20, title 18/28, display 30/36) | `layout.tsx`, `globals.css` |
| Org themes | stored defaults and the LCP preset (Single, `#FF6600`) both paint the stock palette; the Color Theme panel shows the preset for a default org (display only — no row is written until an owner saves); custom themes keep their colours with a guaranteed-AA generated pair — except the stock orange itself, which keeps the stock white label, so a preset theme with overrides never flips to INK | `brand-theme.ts`, `company-panels.tsx` |
| Shell | dark 56px header (org identity, search, language, utilities); light 256px grouped sidebar, 68px rail (forced at 768–1023px), solid selected item; sheet navigation below 768px, where the header shows the compact search entry and truncates the organization name so the row always fits; content max 1280px, padding 16/24/32 | `app-shell.tsx`, `sidebar.tsx`, `mobile-nav.tsx`, `brand-mark.tsx`, `shell.css` |
| Presentation layer | LCP recipes for page headers, cards, KPI tiles, tables, tabs, menus, form labels, settings navigation, legacy buttons, empty states, line-item headers, pills, accent avatars; the Dashboard grid keeps two tracks up to 1279px beside the expanded 256px sidebar (twelve from 1280px, or from 1101px beside the rail) — legacy stylesheet and pinned primitives byte-identical | `(app)/lcp.css` (loaded last) |
| Primitives | Button (LCP primary with its primary border, shadow-xs secondaries), dialog / drawer surfaces, one LCP overlay dim (`bg-black/80`, no blur) for dialogs, sheets, the command palette and record search, status pills with dots | `button.tsx`, `dialog.tsx`, `drawer.tsx`, `command-palette.tsx` / `record-search.tsx` (overlay class only), `globals.css` |
| Auth | LCP split: form column + Elite brand panel from 1024px | `(auth)/layout.tsx`, `auth.css`, login / register forms |
| Specimen | `/design-system` — tokens, type and shared components on one page; 404 in production unless `ELITE_DESIGN_SPECIMEN=1` | `(app)/design-system/page.tsx` |
| Behaviour fix | the item picker opens above its field when there is not room below (it could open off-screen near the viewport bottom) | `item-entry-cell.tsx` (placement only) |

Every value and deviation is sourced in `ERP_LCP_TOKEN_MAP.md` (§6: 11 deviations and the one accepted contrast exception — the white label on the orange).

## 2. Commits

| Batch | Commit | Subject |
|---|---|---|
| 0 — audit | `4f036d0` | docs(design-system): LCP migration audit and route matrix (phase 0) |
| 1 — phases 1–2 (+ route families on the shared layer) | `dbef9d4` | feat(design-system): LCP tokens, shell, presentation layer and theme preset (phases 1-2) |
| 2 — print freeze, labels, picker, suites | `dc0707c` | fix(design-system): freeze print/PDF output, LCP form labels, picker placement, runtime suites |
| 3 — sweep contrast fixes | `63b1c16` | fix(design-system): sweep contrast findings (header shortcut hint, neutral pill, accent avatars) |
| 4 — white label (owner decision), overlay dim | `2c64d9d` | feat(design-system): LCP white label on the orange; LCP overlay dim for the palette and record search |
| 5 — UI baseline replacement | `326c29c` | test(ui-baseline): LCP shell states and the reviewed baseline replacement |
| 6 — QA layout fixes, runtime verifier | `42a47d9` | fix(design-system): Dashboard grid and the 640-767px header beside the LCP shell; LCP stage record for the page-archetype runtime verifier |
| 7 — runtime record | `39f881b` | test(page-archetypes): LCP stage record and the Settings › Organization re-record |
| 8 — final docs | the commit carrying this file (PR head) | docs(design-system): final handover, route-matrix evidence |

Every commit is signed (SSH) and sits on `feat/erp-lcp-design-system`, branched from `83e8093`; nothing was pushed to `main`.

## 3. Protected areas — `git diff --name-only 83e8093..HEAD`

| Protected area | Paths checked | Files changed |
|---|---|---|
| Database schema / migrations / Drizzle | `src/db/*`, `drizzle/*`, `drizzle.config.ts`, `src/lib/seed-org.ts` | none |
| API routes | `src/app/api/*` | none |
| Server actions (every `*actions.ts`) | `*actions.ts` | none |
| Auth, MFA, sessions, roles, CSRF, headers, rate limits, tenant guards | `src/lib/auth.ts`, `src/lib/security/*`, `src/lib/session.ts`, `src/lib/role-matrix.ts`, `src/lib/rate-limit.ts`, `src/lib/tenant.ts`, `src/proxy.ts`, `next.config.ts` | none |
| Accounting, posting, journal / GL, inventory valuation / COGS, document lifecycle | `src/lib/accounting.ts`, `src/lib/*posting*.ts`, `src/lib/inventory-*.ts`, `src/lib/credit-note-returns.ts`, `src/lib/payment-reversal.ts`, `src/lib/settlement.ts`, `src/lib/document-lifecycle.ts`, `src/lib/statements.ts`, `src/lib/finance-reports.ts`, `src/lib/project-costing.ts`, `src/lib/advance-*.ts`, `src/lib/bank-*.ts` | none |
| ZATCA / tax / compliance | `src/lib/compliance/*` | none |
| Currency, exchange rates, rounding, dates | `src/lib/currency/*`, `src/lib/rates/*`, `src/lib/*currency*.ts`, `src/lib/exchange-rates.ts`, `src/lib/date-only.ts`, `src/lib/base-amounts-sql.ts` | none |
| File storage | `src/lib/storage/*` | none |
| PDF / print / document output, exports, imports | `src/app/print/*`, `src/lib/pdf/*`, `src/lib/doc-print.ts`, `src/lib/doc-seal.ts`, `src/lib/report-export.ts`, `src/lib/import/*` | none |
| Dependencies | `package-lock.json` | none |
| CI / deployment / scripts | `.github/*`, `scripts/*` | none |

`package.json`: only scripts — adds `verify:lcp-design` and appends it to `verify:static`; no dependency, version or other field changes.

All 302 changed paths:

* `docs/design-system` (4): `ERP_LCP_FINAL_HANDOVER.md`, `ERP_LCP_MIGRATION_AUDIT.md`, `ERP_LCP_ROUTE_MATRIX.md`, `ERP_LCP_TOKEN_MAP.md`
* `package.json` (1): `package.json`
* `src/app` (12): `(app)/design-system/page.tsx`, `(app)/layout.tsx`, `(app)/lcp.css`, `(app)/sales/_shared/item-entry-cell.tsx`, `(app)/settings/organization/company-panels.tsx`, `(app)/shell.css`, `(auth)/auth.css`, `(auth)/layout.tsx`, `(auth)/login/login-form.tsx`, `(auth)/register/register-form.tsx`, `globals.css`, `layout.tsx`
* `src/components` (9): `layout/app-shell.tsx`, `layout/brand-mark.tsx`, `layout/command-palette.tsx`, `layout/mobile-nav.tsx`, `layout/record-search.tsx`, `layout/sidebar.tsx`, `ui/button.tsx`, `ui/dialog.tsx`, `ui/drawer.tsx`
* `src/lib` (3): `brand-theme.ts`, `design-tokens.ts`, `i18n/dict.ts`
* `tests/ui-baseline` (1): `shell-states.mjs`
* `tests/ui-baseline/baseline/* (replaced UI baseline, §8)` (257)
* `verify` (15): `lcp-approved-delta.mts`, `page-archetype-actions.json`, `page-archetype-runtime-baseline.json`, `verify-color-theme.mjs`, `verify-contrast.mts`, `verify-controls-runtime.mjs`, `verify-dark-theme.mjs`, `verify-document-form.mts`, `verify-lcp-design.mts`, `verify-page-archetypes-runtime.mjs`, `verify-page-archetypes.mts`, `verify-shell-runtime.mjs`, `verify-shell.mts`, `verify-skeletons.mts`, `verify-status-registry.mts`

**Result: no protected path is touched.** `company-panels.tsx` changes only how the Color Theme panel *displays* a default org (the save action `theme-actions.ts` is unchanged); `item-entry-cell.tsx` changes only where the picker list is placed; `dict.ts` only adds Arabic strings for new UI text.

## 4. Print / PDF output — unchanged, proven

The master prompt freezes output documents. The Inter swap initially reached `/print/[type]/[id]` (the PDF
generator's source) through `var(--font-body)`; this was found and fixed before review:

* the type families are declared once on `:root, .print-root`; `.print-root` re-binds `--font-body-raw` to
  IBM Plex Sans 400–600 (`--font-print-raw`, not preloaded on app pages);
* Arabic stays at 400–600 (a 700 face would reach PDF Arabic text — `next/font` family names are global);
* the print route keeps the pre-LCP page canvas (`#f5f6f8` / `#090b17`) — Chromium paints the canvas into
  the PDF where the A4 page does not cover it (measured: a 1px strip, Δ4 light / Δ17 dark).

**Proof** — 48 print states (16 documents covering all nine types: quotation, sales order, proforma,
invoice ×5 incl. paid / partially paid / QR / draft / void, purchase order ×2, delivery challan, credit
note, debit note, payment ×2; EN light, AR light, EN dark) captured on an `83e8093` build and on the final
build `Eg3N0EAzVszXzSLoWQEae`: **48/48 identical** (screen pixels, print-media pixels, rasterized PDF pages, PDF page counts, A4 text, computed font families). `src/app/print/**` is byte-identical to `83e8093` (page-archetypes business pin).

## 5. Verification

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 — no type errors |
| `npx eslint src --max-warnings=0` (the CI scope) | exit 0 — 0 errors, 0 warnings |
| `npm run verify:static` (every static suite) | **22/22 suites, 1,834 checks, 0 failures** — role-matrix 32, confirm-policy 62, dirty-form 66, skeletons 90, contrast 187, typography 43, status-registry 90, shell 87, controls 110, datatable 69, document-form 79, edit-action 59, store-model 69, provider-harness 302, backup-claims 26, money-precision 12, number-locale 29, date-timezone 38, business-dates 44, ledger-only-balances 8, page-archetypes 255, lcp-design 77 |
| Mutation run (25 deliberate regressions: 21 owned by `verify:lcp-design`, 4 by `verify:shell`) | **25/25 caught** (every file restored byte for byte after each run) |
| Browser tier (`verify/run-browser-suites.mjs`, 49 suites, TEST-only DB) | **49/49 suites passed** on the final build `Eg3N0EAzVszXzSLoWQEae` (2,672 counted checks) |
| Print / PDF vs `83e8093` | **48/48 identical** (screen pixels, print-media pixels, rasterized PDF pages, PDF page counts, A4 text, computed font families) on the final build `Eg3N0EAzVszXzSLoWQEae` |
| All-routes sweep | **1,824 / 1,824 states pass every check**, 137,120 text elements: **0 app text below AA** apart from the owner-accepted white-on-orange labels (8,136 elements in 1,800 states, reported); 432 on the frozen print page |
| UI-baseline harness | replaced baseline vs the final build: **256/256 byte-identical** (0 pixel-identical, 0 AA-noise); the baseline itself = two separate captures on build `59wJnlv2SOEKWnWB8-OWc` (before the QA layout fixes, which touch no captured width), 256/256 byte-identical; shell set 44/44 captured on the final build, 44/44 byte-identical to that build's |
| Page-archetype runtime verifier (`verify/verify-page-archetypes-runtime.mjs`, outside the tier) | **165/165** on the final build `Eg3N0EAzVszXzSLoWQEae`: the 158 DEV-UI-01.7 checks (all pass, as on `83e8093` — 158/158 there) plus the 7 LCP record cross-checks. The record run (`--write-lcpref --rebaseline=settings-org`) passed 166/166; it was made twice from the same pinned files and wrote byte-identical records. |
| Layout probe — Dashboard grid (QA fix 1) | 1101–1440px × sidebar expanded / 68px rail × EN / AR, 44 states: **nothing clipped**. Two tracks up to 1279px beside the expanded sidebar and twelve from 1280px; twelve from 1101px beside the rail. Before the fix: clipping at 1101–1260px. |
| Layout probe — header (QA fix 2) | 360–820px × four pages × EN / AR, 128 states: **no page overflow**. 640–767px: no header controls overlapping, and the organization name truncates (65px at 640, 192px at 767). Before the fix: up to 32px overflow at 640–671px, and the Ctrl+K hint over EN \| ع up to 767px. |
| Clip scan (every route at 1101 / 1180 / 1279px beside the 256px sidebar, EN / AR) | 438 states: **no cut-off content**, not counting screen-reader-only labels and inputs scrolling their own text. Wide tables scroll inside their cards by design, as at 1024px. |

**Runtime suites re-encoded for intended LCP decisions** (thresholds unchanged except the owner-decided white label, each with the kit source):
`verify-color-theme` (default org opens on the preset; opening writes nothing — new checks),
`verify-controls-runtime` (LCP `text-sm` sizes, primary border; its `transparent()` helper no longer reads
`rgb(230, 92, 0)` as transparent; the checked tick is the white primary label, ratio reported, floor 2.5:1), `verify-dark-theme` / `verify-shell-runtime` (header identity replaces
the old header title; the 68px tablet rail at 768 replaces "no rail" — that first-paint check loads the page at 768
rather than resizing from 1024, because the rail's `width` transition made a resize-then-measure race, seen once as
256px in the final tier). Static verifiers re-encoded in batch 1 (contrast D-LCP-2, shell D-LCP-3/4/5, status
pills D-LCP-6); for the white label (owner decision) `verify-contrast`, `verify-lcp-design` and `verify-shell` assert the
white-on-orange pairs exactly and report their ratios instead of passing them at 4.5:1 — every other pair keeps its AA
threshold. Every pinned file's LCP hunks are recorded in `verify/lcp-approved-delta.mts`, which the
freeze verifiers undo before their pins, so the DEV-UI-01.7 / ACC-01 pins keep full strength.

**The page-archetype runtime verifier** (`verify/verify-page-archetypes-runtime.mjs`, not part of the 49-suite tier) was
run for the LCP stage late in QA: 148/158 on the build before the fixes below (`59wJnlv2SOEKWnWB8-OWc`), 158/158 on
`83e8093` (the base passes all). The ten failing checks, each traced against the base build's own measurement:

* the C6 breakpoint check — two real layout defects, now fixed (§7): the Dashboard clipping between 1101 and 1260px,
  and the 640–671px header overflow (its 641 / 640px probes);
* the owner action inventory — the four new Color Theme suggestion buttons on Settings › Organization (§7);
* eight checks holding the pre-LCP presentation: the C3 kanban, two C4 (report values, picker), two D-6 (colours,
  geometry) and three C7 (title style, page text, error boundary).

Those records are deliberately anchored to the build before each DEV-UI-01.7 stage — C6's h3 titles, C2's health
badge, C3's profit rows — so re-recording them on the LCP build would break the checks that rely on them. Instead:

* **a new record, `lcpref`**, measured on the final LCP build (`--write-lcpref`, src clean) and holding only what the
  LCP restyle changes by design:
  * the C7 titles' style and box, and the page text;
  * the report values;
  * the kanban cards' themed properties;
  * the D-6 card and badge colours, and row geometry.

  Each run is held to `lcpref` exactly.
* **`lcpref` held to the older records** except for exactly that change, by new cross-checks:
  * text and report values may differ in letter case only — each difference an upper-case letter now lower-case (the
    LCP table headers are no longer upper-cased), measured as 15 report states and 32 page states;
  * the C7 titles keep C6's words and classes;
  * the kanban keeps C2's cards and words;
  * the D-6 rows keep C1's labels, values, tones and tables;
  * the error boundary's h1 and h3 renders differ by exactly the LCP page-title rule (700, -0.015em).
* **Settings › Organization re-recorded** (`--rebaseline`): its only new actions are the four "Use suggested text
  color" buttons of the white-label decision (§7). Nothing is removed, and the Staff lists are identical.
* **The C6 breakpoints re-encoded**: twelve tracks from 1280px beside the expanded sidebar and from 1101px beside the
  rail. Against the pre-fix build this check fails on exactly the two defects.

`verify-shell-runtime` gains a 700 and a 640px state and a check that no two header controls are drawn over each
other; its search expectation is "box from 768px".


### 5.1 All-routes sweep

Every `page.tsx` (73) plus report / tab variants — 76 URLs — × EN / AR × light / dark × 1440,
1280, 1024, 820, 390, 360 on a TEST-only copy of the synthetic seed (with the harness's five TEST-only
document drafts so every document family has a detail and an edit page), frozen clock. Per state: HTTP
status / redirect, console and page errors, page overflow, any element escaping the viewport, lang / dir,
LCP canvas, 56px header, sidebar 256 / 68 / drawer by width, exactly one visible h1, fonts, and a WCAG AA
audit of every visible text element against its composed background.

| Check | Passed |
|---|---|
| HTTP 200 (or the expected redirect) | 1,824 / 1,824 |
| no console or page error | 1,824 / 1,824 |
| no horizontal page overflow | 1,824 / 1,824 |
| no element escapes the viewport | 1,824 / 1,824 |
| `lang` / `dir` (EN ltr, AR rtl) | 1,824 / 1,824 |
| LCP canvas `#F9FAFB` / `#1A1A1A` (app and auth pages) | 1,800 / 1,800 |
| fonts: Inter on app pages, + IBM Plex Sans Arabic in Arabic; print page IBM Plex Sans, never Inter | 1,824 / 1,824 |
| 56px header (app pages) | 1,752 / 1,752 |
| sidebar 256 ≥1024 / 68 at 768–1023 / sheet below 768 | 1,752 / 1,752 |
| exactly one visible h1 (app pages) | 1,752 / 1,752 |
| WCAG AA text contrast (every visible text element against its composed background) | 137,120 elements: **0 app failures** other than the accepted white-on-orange labels; 432 on the frozen print page (white on `#E87722` 2.96:1 and other pre-LCP document colours, unchanged by design); 960 over gradients / images (avatars, auth hero, brand panel) checked by eye |
| Owner-accepted exception: LCP white label on the orange (buttons, selected nav, active tabs, avatars) | 8,136 elements in 1,800 states, 2.94–3.29:1 — reported, not counted as failures (§7) |

Swept on the final build `Eg3N0EAzVszXzSLoWQEae` (every measure as on `59wJnlv2SOEKWnWB8-OWc`, the build before the QA layout fixes).

Same states on `83e8093` vs this branch (EN light + AR dark at 1440 and 390, 304 states):

| Measure | `83e8093` | this branch |
|---|---|---|
| non-200 responses | 4 | 0 |
| console / page errors | 4 | 0 |
| page overflow | 0 | 0 |
| elements escaping the viewport | 0 | 0 |
| text below AA — app (excluding the white-on-orange labels) | 190 | 0 |
| white-on-orange labels (owner decision) | 0 | 1260 |
| text below AA — print page (frozen) | 72 | 72 |

The four base non-200s / console errors are `/design-system`, which does not exist on `83e8093`.

Every route's screenshots were reviewed as contact sheets (EN light 1440, AR dark 1440, EN light 390), and
the LCP reference screens were compared side by side (dashboard light / dark, contacts ↔ clients, new
contact ↔ new client, contact overview ↔ client profile, settings, login).

## 6. Route coverage

`ERP_LCP_ROUTE_MATRIX.md` carries one row per page with its evidence: **73 / 73 routes Verified** (24 states each, screenshots reviewed) and **13 / 13 shared overlays Verified**.

## 7. Known limitations and deliberate differences

* **Accepted contrast exception (owner decision, 2026-11-06):** text on the orange is white, exactly as the LCP design
  system specifies. It measures 3.29:1 on the light `#F06000` and 2.94:1 on the dark `#FF6600` (3.56 / 2.59:1 on hover),
  below the WCAG AA 4.5:1 minimum for body-size text — primary buttons, the selected nav item, active tabs, the pressed
  language toggle, the header avatar and orange-gradient avatar initials. The verifiers assert the pair and report its
  ratio instead of passing it; the sweep counts these labels separately (§5.1); the Color Theme panel's live audit shows
  them as low-contrast warnings for the default theme, each with a "Use suggested text color" button (four on the default
  theme; a warning only — saving is never blocked). Custom org colours keep the engine's AA label. If AA is required later,
  the alternative is a deeper orange under the white label.
* **Found during QA and fixed (LCP-caused, both layout only):**
  * the Dashboard's twelve-track desktop grid was sized beside the pre-LCP 66px rail; beside the LCP's 256px sidebar its
    widgets clipped between 1101 and 1260px (measured; clean from 1270px — Arabic's Recent Activities the tightest, English
    only at 1101px). It now keeps two tracks up to 1279px while the sidebar is expanded; beside the 68px rail it is
    twelve from 1101px as before (measured: 1101–1440px, both sidebar states, EN / AR — nothing clipped);
  * from 640 to 671px the header row was 672px wide (every page scrolled sideways by up to 32px, the account button past
    the viewport) and up to 767px the search field was squeezed to nothing, its Ctrl+K hint over EN | ع. Below 768px the
    compact search entry now stands in for the field and the organization name truncates (measured: 360–820px, four
    pages, EN / AR — no overflow, no overlapping header controls).
  Neither width band was in the sweep's six viewports; the page-archetype runtime verifier found the first, and its
  641 / 640px probe the second. Both are now pinned statically and at runtime (§5).
* LCP header quick-create (`+`) is not added — the ERP has no quick-create flow to call.
* **Found during QA, not changed (pre-existing on `83e8093`, protected area):** in a production build the image uploader
  (`crop-image-upload.tsx`: company logo, seal / signature, item and record images) cannot open its crop dialog — it
  previews the chosen file through a `blob:` URL, which the security headers' CSP (`img-src 'self' data:`, `next.config.ts`)
  refuses, so the user sees "Could not read the image.". Security headers are out of scope here; the fix (either allow
  `blob:` for images or preview through a `data:` URL) is left for a separate, reviewed change. The crop dialog's LCP styling
  was captured with CSP bypassed in the test browser only.
* Arabic page titles / KPI values render with the 600 face (deviation 11 — protects PDF Arabic text).
* Document editors keep their compact in-box field labels (11px caption); long forms use the LCP 14px label.
* `/finance/journal` at 390px keeps the three-field entry row compressed exactly as on `83e8093`
  (pre-existing layout; usable, not a regression).
* The A4 print document keeps its pre-LCP design (frozen output), including white on `#E87722` (2.96:1),
  which the sweep's contrast audit reports — unchanged by design.
* Charts keep their structure and data; their colours follow the tokens (LCP chart navy / orange).
* Observed, not changed (pre-existing on `83e8093`, test data only): the UI-baseline seed (`tests/ui-baseline/seed.mts`)
  gives four fictional clients `client_type = 'business'`, which the client form accepts only as `individual` /
  `company`, so saving one of those seeded clients unchanged reports a validation error. Changing the seed would move
  baseline pixels, so it is left for a separate change; the overlay probe used the non-destructive active / inactive
  toggle for its toast evidence instead.
* The UI-baseline `baseline/` images were replaced for this redesign stage together with the reviewed list
  in §8 (the harness README's rule).

## 8. UI baseline replacement (reviewed list)

The committed `baseline/` dates from DEV-UI-01.0 (`7954f75`) and was never replaced by the later stages, so on `83e8093` it no longer
matched the app. Three captures separate the two causes: the old baseline, the same 256 states on `83e8093` (build `H2aZ1n0…`),
and on this branch (build `59wJnlv2SOEKWnWB8-OWc`, before the QA layout fixes of §7 — they touch no captured width — and re-verified
256/256 byte-identical on the final build `Eg3N0EAzVszXzSLoWQEae`).

* old baseline → `83e8093`: 256 states: 0 byte-identical, 0 pixel-identical, 0 anti-aliasing noise only (every pixel within ±8/255, ≤500 px), 256 different/missing
* `83e8093` → this branch: 256 states: 0 byte-identical, 0 pixel-identical, 0 anti-aliasing noise only (every pixel within ±8/255, ≤500 px), 256 different/missing

| Page state (×16: EN/AR × light/dark × 1440/1024/768/390) | Route | Differs, old baseline → `83e8093` (earlier stages) | Differs, `83e8093` → branch | Intended LCP change reviewed |
|---|---|---|---|---|
| `client-detail` | `/clients/1` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas) | 16/16 | shell; profile form with LCP 14px labels and inputs, segmented client-type control, cards, Active pill with dot |
| `clients-list` | `/clients` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas); page header | 16/16 | shell; LCP table (header row, row height, borders), status pills with dots, primary New Client (orange, white label), outline secondaries |
| `dashboard` | `/dashboard` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas); Profit Margin card removed, dashboard convergence | 16/16 | shell; LCP KPI tiles and cards, chart colours from the tokens (navy / orange), quick-action tiles |
| `finance-reports` | `/finance/reports` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas); profit figures hidden behind the preliminary notice | 16/16 | shell; report tabs and period chips, cards, KPI tile, the existing preliminary notice restyled |
| `finance-statements` | `/finance/statements` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas) | 16/16 | shell; Client / Vendor segmented control, filter fields with LCP labels, empty state |
| `hr-employees` | `/hr/employees` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas) | 16/16 | shell; department tabs, stat tiles, employee cards; orange-gradient avatars with white initials |
| `inventory-products` | `/inventory/products` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas) | 16/16 | shell; LCP table, Active / Low-stock pills, primary and outline buttons |
| `login` | `/login` | 16/16 — navy Sign in button | 16/16 | LCP split layout: form column + Elite brand panel from 1024px, single column below (no shell) |
| `project-detail` | `/projects/1` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas); "Cost & Profitability" renamed "Project Revenue & Costs", task board | 16/16 | shell; header pills, KPI tiles, revenue / cost cards, task board |
| `projects-list` | `/projects` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas); legacy toolbar replaced | 16/16 | shell; KPI tiles, LCP table, status pills with dots |
| `sales-invoice-detail` | `/sales/invoices/1` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas) | 16/16 | shell; document cards, status pill, totals, QR panel, action buttons |
| `sales-invoice-edit` | `/sales/invoices/6/edit` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas) | 16/16 | shell; neutral LCP line-item header (was the orange bar; Arabic without letter-spacing), LCP inputs; compact in-box captions kept |
| `sales-invoice-new` | `/sales/invoices/new` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas) | 16/16 | shell; neutral LCP line-item header, LCP inputs; compact in-box captions kept |
| `sales-invoices-list` | `/sales/invoices` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas); list workspace toolbar | 16/16 | shell; KPI tiles, LCP table, status pills with dots |
| `sales-quotations-list` | `/sales/quotations` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas); list workspace toolbar | 16/16 | shell; KPI tiles, LCP table, status pills with dots |
| `settings-organization` | `/settings/organization` | 16/16 — Navy Command palette (DEV-UI-01.1: navy sidebar and primary, cool canvas); Color Theme panel rework | 16/16 | shell; LCP settings navigation; the Color Theme panel opens on the LCP preset (Single Color #FF6600) — display only, nothing saved |

Common to every state: dark 56px header with the org identity, light grouped sidebar (256px at 1440 / 1024, 68px rail at 768,
sheet navigation at 390), LCP canvas, Inter with the LCP type scale, LCP palette and controls. Every state was reviewed as an
old / new contact sheet; no difference outside these intended changes was found. The replacement was captured twice on the final
build, each on its own fresh TEST-only database copy (256/256 byte-identical; the second capture checks the first, §5).

## 9. Evidence (outside the repository — synthetic TEST data only)

Screenshots, sweep results, print captures and contact sheets live in the session scratchpad, not in the
repository: `lcp/sweep-final4/` (the final build's 1,824 states + `results.json` + `report.txt`; `lcp/sweep-white/` is the
same sweep on the build before the QA layout fixes — every state measures the same but for which web fonts had loaded on seven
English login / register states), `lcp/sweep-base/` (the `83e8093` comparison), `lcp/print-base/` and `lcp/print-final4/` (48
states each: screen, print media, PDF), `lcp/final/final3-256a`, `final3-256b` (the replaced baseline's two captures),
`final4-256` and `final4-shell` (the final build's), `base-256` (harness capture sets and their comparisons),
`lcp/probe-out/overlays/` (26 overlay states), `lcp/probe-out/header/` and `lcp/dash-threshold-*.txt` (the two QA layout
fixes, before and after), `lcp/probe-out/clipscan-final.json` (every route at 1101 / 1180 / 1279px), `lcp/arch-runtime-*.log`
(the page-archetype runtime runs, base and LCP), `lcp/review/white/` (final contact sheets), `lcp/side/` (LCP reference vs ERP).
The LCP kit was read in place outside the repository; none of its screenshots or files are committed.

## 10. Deployment (not performed)

Nothing is deployed. When the owner authorizes it: merge the PR into `main`, then on the VPS follow the
existing deployment runbook (build, restart `elite-erp.service`) — no database step exists for this change
(no schema, migration or data change). Rollback is reverting the merge commit and redeploying; no data
needs restoring. Recommended acceptance after deployment: log in, open the dashboard, an invoice detail and
its PDF, the Color Theme panel (preset shown, nothing saved), and Arabic + dark mode once each.
