# DEV-UI-01.7 C1 — master data + entity detail

Parent: C0 `6ad311bb8372b62ac30bf9550f6bbe6f0fd066d7` (tree `e87017970efb7fb0d9cc2b00cfb4ca641b83a55e`),
itself on main `1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50` (tree `e6fce17b`; parents `c000a15`, `e9c07e7`).
Branch `claude/dev-ui-01-7-page-archetypes`; C1 is one commit on C0. C0 is not merged to main.
**DEV-UI-01.7 C2 has NOT started.**

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases on
127.0.0.1, with no repository `.env`. Nothing touched production; nothing was deployed.

## Scope — the 12 pages

| Page | File (`src/app/(app)/…`) | C1 change |
|---|---|---|
| Clients | `clients/page.tsx` | drops its `className="flex-wrap"` workaround (PageHeader wraps by itself) |
| Client detail | `clients/[id]/page.tsx` | meta / actions split; responsive grid; Details + Invoices `CardTitle as="h2"`; Statement of Account `SectionHeader level={2}`; copy through `t()` |
| New client | `clients/new/page.tsx` | submit label through `t()` |
| Clients recycle bin | `clients/recycle-bin/page.tsx` | title / description / Back through `t()`; Back arrow mirrors in RTL; `EmptyState` |
| Vendors | `purchasing/vendors/page.tsx` | none — changes only through the evolved PageHeader |
| Vendor detail | `purchasing/vendors/[id]/page.tsx` | as client detail (its one side card is Purchase Orders; it has no Details card) |
| New vendor | `purchasing/vendors/new/page.tsx` | title / description / submit through `t()` (+ `getLocale()`, see Data) |
| Vendors recycle bin | `purchasing/vendors/recycle-bin/page.tsx` | as the clients bin |
| Products | `inventory/products/page.tsx` | none — changes only through the evolved PageHeader |
| Product detail | `inventory/products/[id]/page.tsx` | meta / actions split; responsive grid; Stock `CardTitle as="h2"`; SKU / Stock / Quantity on hand / Reorder level / submit through `t()` |
| New product | `inventory/products/new/page.tsx` | title / description / submit through `t()` (+ `getLocale()`, see Data) |
| Products recycle bin | `inventory/products/recycle-bin/page.tsx` | as the clients bin |

Shared: `src/components/layout/page-header.tsx` (evolved in place), `src/lib/i18n/dict.ts` (18 entries).
Untouched: every other page (HR, projects, finance, settings, dashboard, document routes), the forms
(`client-form`, `vendor-form`, `product-form`, AddressFields), DataTable / filters / saved views / row
menus, StatementView, the stock dialog, server actions, queries, status registry, CSS.

## Changed files

| File | Change |
|---|---|
| `src/components/layout/page-header.tsx` | PageHeader evolved in place (below) |
| 10 of the 12 page files (all but the vendors and products lists) | as in the scope table |
| `src/lib/i18n/dict.ts` | 18 entries, one block |
| `verify/document-form-pins.json` | D-9: the layout directory pin → 13 file pins |
| `verify/verify-page-archetypes.mts` | group 9 (C1, 19 checks); the two C0 "no consumer yet" checks become what C1 migrated; PageHeader joins the primitives' route-awareness and props checks; `consumers.PageHeader` in the snapshot (77 → 97 checks) |
| `verify/page-archetype-pins.json` | re-baselined: two data entries, the consumer inventory |
| `verify/verify-page-archetypes-runtime.mjs` | C1 targets; per-state `c1Literals` / `pageHeader`; `--rebaseline=<ids>`; `--measure-out=<file>` (29 → 36 checks; 37 in a re-baseline run) |
| `verify/page-archetype-runtime-baseline.json`, `verify/page-archetype-actions.json` | the 12 C1 routes re-recorded; every other entry as C0 |
| `verify/verify-datatable.mts` | the one assertion PageHeader's evolution affects (below) |
| `tests/ui-baseline/archetype-states.mjs` | 36 C1 states and the long-name fixture (162 → 202 states) |
| this document | |

No form, CSS, layout file other than `page-header.tsx`, server action, query, schema, migration or
package change. The vendors and products list pages needed none: their header changes come through
PageHeader alone.

## DataTable verifier — the one assertion changed

```
old  check("/clients: the frozen PageHeader wraps (className) instead of overflowing at 390px",
       /<PageHeader\s+className="flex-wrap"/.test(read(A + "clients/page.tsx")));
new  check("/clients: PageHeader wraps instead of overflowing at 390px (the shared header row is
       flex-wrap, no shrink-0 group; /clients does not opt out)",
       /<div data-slot="page-header" className=\{cn\("flex flex-wrap /.test(pageHeader) &&
       !/\bshrink-0\b|\bflex-nowrap\b/.test(pageHeader) &&
       /<PageHeader\b/.test(clientsPage) && !/\bshrink-0\b|\bflex-nowrap\b/.test(clientsPage));
```

Why: DEV-UI-01.5 could not touch the frozen PageHeader, so /clients patched the 390 px overflow
from the page (`className="flex-wrap"`), and the check pinned that patch. C1 evolves PageHeader to
wrap by itself, and /clients drops the patch. The new assertion is stronger: the wrap now holds for
every page, the `shrink-0` group that caused the overflow may not come back, and /clients may not opt
out — comments stripped, as elsewhere in the file. Mutations M03 (row loses `flex-wrap`), M15
(`shrink-0` group back) and M15b (/clients passes `flex-nowrap`) each fail it. DataTable 69/69.

## PageHeader — D-9, evolved in place

| | C0 (`6ad311b`, = 1bfdbbf) | C1 |
|---|---|---|
| Props | `{ title: string; description?: string; actions?: ReactNode; className? }` | `{ title: ReactNode; description?: ReactNode; meta?: ReactNode; actions?: ReactNode; className? }` — a superset; every C0 call site still compiles |
| Row | `flex items-start justify-between gap-4 mb-6` (no wrap) | `data-slot="page-header"` `flex flex-wrap items-start justify-between gap-x-4 gap-y-3 mb-6` |
| Title column | `<div>` | `<div class="min-w-0">` — may shrink, so a long name wraps inside it |
| Heading | `<h1 class="text-2xl font-extrabold">` (24 / 32 px; the unlayered `h1 { font-weight: 600 }` already won over `font-extrabold`) | `<h1 class="text-page font-semibold break-words">` — 20 / 28 px (Arabic line-height 32), 600, `overflow-wrap: break-word`; only the title inside it |
| Description | `<p class="text-ink-muted text-sm mt-1">` | `<p class="mt-1 text-body-lg text-ink-muted">` — the same 14 / 20 px on the type token (Arabic line-height 24) |
| Trailing group | `<div class="flex items-center gap-2 shrink-0">` — `shrink-0`: the 390 px overflow source (DEV-UI-01.5 audit) | `<div class="flex min-w-0 flex-wrap items-center gap-2">` holding `data-slot="page-header-meta"` (non-interactive status) **then** `data-slot="page-header-actions"`, each `flex flex-wrap items-center gap-2`, each only when given |

Logical layout only: gaps, no left / right, no fixed width, nothing positioned, so `dir="rtl"`
mirrors it — the title sits at the inline start, the group at the inline end of the title's line or,
when the row runs out of width, wrapped below the title at the inline start. It imports React and
`cn` only: no router, pathname, session, route strings or domain props. Empty slots (`false`, `""`,
`null`) render nothing.

Consumers: exactly the 12 C1 pages (it had no others), one header each; none passes a `className`.
`verify:page-archetypes` group 9 renders it (markup, one `<h1>` holding only the title, meta before
actions, empty slots), checks its source (typography, wrap, no physical direction / fixed width /
positioning / `shrink-0`), and pins its consumer set.

## D-9 — the layout pin, narrowed

`verify/document-form-pins.json` (DEV-UI-01.6) pinned the whole directory:

```
before  "src/components/layout/**": "6e6e449192ed4b1f (14 files)"
after   13 byte pins — every layout file except page-header.tsx:
  app-shell.tsx 1615e39838780248 · command-palette.tsx d5dabe4406913cdb · favorites-menu.tsx 2d07c473bc67b2d6
  language-switcher.tsx fa5c5fbebc55da34 · mobile-nav.tsx 60e361855cf3e123 · nav-config.ts c8e180f52a29a478
  nav-list.tsx 865ea2da19d3d939 · notifications-menu.tsx c64964412e00780a · record-search.tsx d1cbcb3a7c5125dc
  sidebar.tsx 3824e6dc6f3ba3c8 · theme-toggle.tsx b67b9f793778f02b · topbar-search.tsx 1f65f732e7e0baa4
  use-sidebar-scroll.ts eaae9548e7d8f3c0
```

- The 13 hashes are the C0 bytes (`git show 6ad311b:<file>`), and the old directory hash recomputed
  on the C0 tree is `6e6e449192ed4b1f` — the pin was exact before it was split.
- A change to any of the 13 still fails `verify:document-form` (its file-pin check reads every entry).
- A directory pin also failed on an **added or removed** file; file pins alone would not, so
  `verify:page-archetypes` group 9 requires the pinned set to equal every file in
  `src/components/layout/` except `page-header.tsx`, and re-checks each hash. Nothing in AppShell,
  Sidebar, nav config, mobile nav or the other shell modules lost protection.
- `page-header.tsx` alone is free, held by group 9's contract instead.

## Arabic page copy

The page-level strings of the 12 pages go through `t(locale, …)`; no inline `locale === "ar"`. 18
entries were added to `src/lib/i18n/dict.ts` (one block, "DEV-UI-01.7 C1"); the other C1 strings
already had entries (`Save changes`, `Create Client`, `No invoices yet.`, `Purchase Orders`,
`No purchase orders yet.`, `New Vendor`, `New Product`, `SKU`, `Recycle Bin is empty.` …).

| English (key) | Arabic | Used by |
|---|---|---|
| Client profile | ملف العميل | client detail (description) |
| Vendor profile | ملف المورّد | vendor detail (description) |
| Stock | المخزون | product detail (side card h2) |
| Quantity on hand | الكمية المتوفرة | product detail (Stock card) |
| Reorder level | حد إعادة الطلب | product detail (Stock card: `Reorder level: 5`) |
| Add a vendor to order and receive against. | أضف مورّدًا لإصدار أوامر الشراء واستلام البضائع منه. | new vendor |
| Create Vendor | إنشاء مورّد | new vendor (submit label) |
| Add a product to your inventory catalog. | أضف منتجًا إلى كتالوج المخزون. | new product |
| Create Product | إنشاء منتج | new product (submit label) |
| Clients — Recycle Bin | العملاء — سلة المحذوفات | clients bin |
| Vendors — Recycle Bin | الموردون — سلة المحذوفات | vendors bin |
| Products — Recycle Bin | المنتجات — سلة المحذوفات | products bin |
| Deleted clients live here until restored or permanently deleted. | يبقى العملاء المحذوفون هنا إلى أن تتم استعادتهم أو حذفهم نهائيًا. | clients bin |
| Deleted vendors live here until restored or permanently deleted. | يبقى الموردون المحذوفون هنا إلى أن تتم استعادتهم أو حذفهم نهائيًا. | vendors bin |
| Deleted products live here until restored or permanently deleted. | تبقى المنتجات المحذوفة هنا إلى أن تتم استعادتها أو حذفها نهائيًا. | products bin |
| Back to Clients | العودة إلى العملاء | clients bin |
| Back to Vendors | العودة إلى الموردين | vendors bin |
| Back to Products | العودة إلى المنتجات | products bin |

No other call site passes any of the 18 keys through `t()` (ProductForm's own "Reorder level" field
label is a raw string, untouched), so the additions reach only the 12 pages. Business values are
never translated: `SKU BTH-3X3` becomes `رمز الصنف BTH-3X3` — the label only; the SKU, invoice /
PO numbers, amounts and quantities are rendered as before. The Back links' `ArrowLeft` gains
`rtl:rotate-180` (the app's existing convention for directional icons), so "back" points to the
inline start in Arabic.

Out of C1 (deferred, unchanged): labels inside ClientForm / VendorForm / ProductForm (e.g.
ProductForm's "Reorder level"), the statement component's own copy, and AddressFields.

## Recycle bins — EmptyState

The three master-data bins' empty branch, `<Card><CardContent className="py-12 text-center
text-ink-muted text-sm">Recycle Bin is empty.</CardContent></Card>`, is now
`<EmptyState message={t(locale, "Recycle Bin is empty.")} />` — the same message on the
DEV-UI-01.5 list-card surface. The old empty state had no action and none was added; the Back link
stays in the header. The non-empty branch (table, Restore, owner-only Delete Permanently through
`isOwner={session.role === "owner"}`) is unchanged. The document `/recycle-bin`, `ListEmptyState`
and `TableEmptyRow` are untouched.

## Data invariants

- **Business pins**: `verify:page-archetypes` groups 1, 2, 4, 5 and 8 unchanged from C0 — routes,
  guards (incl. role expressions such as `isOwner`), business / query / permission / export files and
  the 01.7 server actions byte-identical, P0 / P0.1 / P0.2 contracts, and the static action inventory
  (197 entries, 67 of them on the 12 pages). StatementView, country / tax profiles and the stock
  dialog are not in the diff.
- **`getLocale()` additions (2)** — UI-locale retrieval only, for the copy now going through `t()`:
  `purchasing/vendors/new` and `inventory/products/new` (which had no locale). Their data sections
  gained exactly `const locale = await getLocale();`; with that entry removed each is the C0 list,
  entry for entry and in order (statements are compared as canonical AST prints + hash):

  | Page | C0 data section | C1 |
  |---|---|---|
  | New vendor | `(params) ()`, `requireSession()`, the org query, `resolveTaxLabels(…)` | + `getLocale()` after `requireSession()` (index 2) |
  | New product | `(params) ()` | + `getLocale()` (index 1); the page function became `async` |

  The other 34 pages' data sections are identical. New Product still has no session call of its own
  (the (app) layout's `requireSession()` covers it, as the guard check already records).
- **Pins re-baselined** (`verify/page-archetype-pins.json`): those two data entries, and the
  consumer inventory — CardTitle `as` on the four detail side cards, SectionHeader (client / vendor
  Statement of Account), EmptyState (three bins), PageHeader (the 12 pages, a new key). Nothing else.

## Environment note — fonts in this container (TEST-only, no repository change)

C1 ran in a new container (Node 22.22.0, ICU 77.1; Chromium 141.0.7390.37 as pinned). Here, a
production build of **C0 itself** fails in `next/font/google` (Turbopack, Next 16.3.5) on IBM Plex
Sans: "next/font/google queries have exactly one entry", 18 errors — one per `src` line of that
family's stylesheet; IBM Plex Sans Arabic and IBM Plex Mono build. So it is the environment, not C1.
Google now serves IBM Plex Sans as a variable font. Served through Next's own stylesheet hook
(`NEXT_FONT_GOOGLE_MOCKED_RESPONSES`), the same family's real Google CSS builds — both as static
instances and as the variable-font CSS fetched with Turbopack's user agent — so the failure lies in
what Turbopack's own fetch receives here, which this run did not inspect further.

Every build here therefore ran with that hook pointing at a scratch module holding the real Google
CSS for the three families — IBM Plex Sans as Google's static instances (`font-stretch: normal`),
the other two exactly as served to Turbopack's user agent. The font files themselves are still
downloaded from fonts.gstatic.com and self-hosted by the build as usual. No repository file,
configuration or deployment setting changed.

Consequences, measured:
- The C0 runtime baseline, recorded in the previous container, reproduces here: C0 (`6ad311b`)
  against it, **29/29** — route behaviour, outline, actions exact; overflow (65 / 54 px at 390 on
  client detail), offenders, skips, unnamed controls, prompts never worse; zero #418.
- Glyph rasterisation is not the old container's: this container's C0 login screen differs from
  the committed DEV-UI-01.5 capture by 3,201 px of text anti-aliasing, layout identical. So every
  screenshot comparison below is **C0 vs C1, both captured in this container**, which is the gate
  the brief sets (before reference: C0 `6ad311b`).

## Responsive entity detail

All three detail pages had `grid grid-cols-3` with the form `col-span-2` — three columns at every
width. Now `grid grid-cols-1 lg:grid-cols-3` with the form `lg:col-span-2`: one column below the
`lg` breakpoint (1024 px), and from 1024 px the form two thirds, side cards one third (so 1440 and
1024 keep the C0 arrangement; 768 and 390 stack).

| Page overflow (`scrollWidth − clientWidth`) | EN 1440 / 1024 / 768 / 390 | AR 1440 / 1024 / 768 / 390 |
|---|---|---|
| client detail, C0 | 0 / 0 / 0 / **65 px** (1 element) | 0 / 0 / 0 / **54 px** (1 element) |
| client detail, C1 | 0 / 0 / 0 / **0** | 0 / 0 / 0 / **0** |
| vendor, product detail, C0 → C1 | 0 → 0 at every width | 0 → 0 at every width |

All 12 pages, EN and AR at the four widths (96 states): no overflow, no element past the viewport.

## Heading hierarchy

| Page | C0 outline (`<main>`) | C1 outline |
|---|---|---|
| Client detail | h1 Al Noor Contracting (Fictional) · **h3** Statement of Account (skip) | h1 Al Noor Contracting (Fictional) · h2 Details · h2 Invoices · h2 Statement of Account |
| Vendor detail | h1 Gulf Paper Supply (Fictional) · **h3** Statement of Account (skip) | h1 Gulf Paper Supply (Fictional) · h2 Purchase Orders · h2 Statement of Account |
| Product detail | h1 Exhibition booth 3x3 m | h1 Exhibition booth 3x3 m · h2 Stock |
| Lists, New pages, bins | one h1 | one h1 (Arabic titles now Arabic: العملاء — سلة المحذوفات, مورّد جديد, منتج جديد …) |

Side-card titles are `CardTitle as="h2"` (same slot and classes, now a real heading); Statement of
Account is `SectionHeader level={2}` (`text-title-sm` / 600, replacing the `.main-head h3` 19 px /
700 recipe; `mb-4` below it). StatementView itself is unchanged. Heading-level skips: 16 states → 0;
every C1 page has exactly one h1 in `<main>`, inside PageHeader.

## Runtime — before / after (`verify:page-archetypes-runtime`, 528 states)

C1 extends the runtime verifier (C1 targets below; `--rebaseline=<ids>` to re-record named routes
only; `--measure-out=<file>`), then re-recorded its 12 routes with `--rebaseline`. That run still
compared those routes with the C0 baseline they replace — route behaviour, direction, Staff landing,
every never-worse measure — and listed their outline and action changes; **37/37**. In the files,
every entry of the other 32 routes (544 owner / Staff / sweep states and action lists) is
byte-identical to C0's; only the 12 routes' entries changed (with two new per-state fields,
`c1Literals` and `pageHeader`).

| Measure (12 C1 routes × EN/AR × 4 widths) | C0 | C1 |
|---|---|---|
| Page overflow | 2 states (client detail 390: 65 / 54 px) | 0 |
| Elements past the viewport | 2 states | 0 |
| Exactly one h1 | 96 / 96 | 96 / 96 |
| Heading-level skips | 16 states (client, vendor detail) | 0 |
| One PageHeader holding the only h1, meta before actions, title at the inline start, group at the inline end or wrapped below, no overlap | — (no such header) | 96 / 96 |
| C1 page copy in English in Arabic | 32 states (8 pages) | 0 |
| Unnamed controls | 16 states × 6 (client detail / new: AddressFields) | the same — deferred |
| "Unsaved changes" prompt leaving an untouched form | 48 states (detail / new × 3) | the same — out of scope, not worse |
| Console / page errors, React #418 | 0 | 0 |

C0 numbers come from the C1 verifier run against the C0 tree (`6ad311b`): every C0 check passed
there and exactly the C1 targets failed — PageHeader (96), one h1 / no skip (16), detail outlines
(24), overflow (2), English copy in Arabic (32).

The English copy found in Arabic at C0, per page: client detail "Client profile"; vendor detail
"Vendor profile", "Purchase Orders", "Save changes"; product detail "SKU BTH-3X3", "Stock",
"Quantity on hand", "Reorder level:", "Save changes"; New Vendor / New Product their title,
description and submit label; the three bins their title, description and "Back to …". (Client
detail's and New Client's submit labels were already Arabic: ClientForm translates its label.)

The "unsaved changes" prompt is unchanged, as expected: C1 changed no form, no form initialisation
and no DirtyFormProvider; passing a translated `submitLabel` does not mark a form dirty.

## Actions — equivalent

- **Static** (`verify:page-archetypes` group 8): link targets and server actions of the 36 pages,
  through page-local imports — 197 entries, unchanged; on the 12 pages 67, e.g. New Client
  `/clients/new`, Back `/clients`, `/purchasing/vendors`, `/inventory/products`, PO links
  `/purchasing/orders/${}`, statement export `/finance/statements/export?${}`, and the actions
  `updateClientAction` / `updateVendorAction` / `updateProductAction`, `create…Action`, `archive…`,
  `unarchive…`, `delete…`, `toggle…Active…`, `restore…` / `permanentlyDelete…`, `adjustStockAction`,
  `getStatementAction`, `upload…LogoAction`, the client import actions.
- **Runtime** (owner EN + AR at 1440 and EN at 390; Staff EN + AR at 1440): every action in `<main>`
  — kind, name, target, type, disabled / popup state. On the re-recorded routes the C1 run checked
  equivalence with C0: the same kinds, targets, types and states; English names identical; an Arabic
  name changed only from C1 page copy still in English to Arabic. 14 action lists changed, owner and
  Staff alike: "Back to Clients / Vendors / Products" → العودة إلى العملاء / الموردين / المنتجات,
  "Save changes" (vendor, product detail) → حفظ التغييرات, "Create Vendor" → إنشاء مورّد, "Create
  Product" → إنشاء منتج. Owner 1212 and Staff 790 actions; the other routes' lists unchanged.
- Permissions: where Staff land on each route — unchanged (session pages open; Payroll, Business
  Settings, Presets, Compliance → /dashboard). The bins' owner-only Delete Permanently keeps
  `isOwner={session.role === "owner"}` (a pinned role expression).

## Mutations

Static — each edits one file in a scratch worktree, runs the verifiers that must catch it, and
restores the file (the worktree ends as the C1 change set):

| # | Mutation | Caught by |
|---|---|---|
| M01 | PageHeader renders no `<h1>` (h1 → p) | page-archetypes (markup, one h1, empty slots) |
| M02 | PageHeader: empty `<h1>`, title in a `<div>` beside it | page-archetypes (markup, h1 holds the title) |
| M02b | New Client renders its own title `<div>` instead of PageHeader | page-archetypes (consumers 11 ≠ 12) |
| M03 | PageHeader row loses `flex-wrap` | page-archetypes (markup) + DataTable (/clients wraps) |
| M04 | `ml-auto` on the PageHeader group | page-archetypes (physical direction) |
| M05 | actions before meta | page-archetypes (markup, order) |
| M06 | `sidebar.tsx` changes | document-form (file pins) + page-archetypes (D-9) |
| M06b | a new file in `src/components/layout/` | page-archetypes (D-9 set) |
| M07 | client detail back to `grid-cols-3` / `col-span-2` | page-archetypes (grid) |
| M08 | Invoices side-card title back to a div | page-archetypes (CardTitle h2; consumer pins) |
| M09 | Statement of Account `SectionHeader level={3}` | page-archetypes (level 2) |
| M09b | Statement of Account back to `.main-head h3` | page-archetypes (no hand-written headings; SectionHeader) |
| M10 | `description="Vendor profile"` hard-coded | page-archetypes (English outside `t()`) |
| M10b | `locale === "ar" ? … : "Back to Products"` | page-archetypes (English, locale ternary, `t()` key) |
| M10c | the "Back to Vendors" dictionary entry removed | page-archetypes (every key has Arabic) |
| M11 | Back to Clients → `/dashboard` | page-archetypes (action inventory) |
| M12 | client detail query `includeArchived: false` | page-archetypes (data section) |
| M12b | vendor bin `isOwner={session.role !== "staff"}` | page-archetypes (guards / role expressions) |
| M13 | a bin back to the Card `py-12` recipe | page-archetypes (EmptyState; consumer pins) |
| M14 | `STATUS_TONE = { active: "text-success", … }` on /clients | page-archetypes (tone map; data section) |
| M14b | product detail StatusBadge `in_stock` → `active` | page-archetypes (C0 badges) |
| M14c | `STATUS_VARIANT = { active: "success", … }` on /inventory/products | page-archetypes + DataTable (G4) |
| M15 | PageHeader group back to `shrink-0`, no wrap | page-archetypes + DataTable |
| M15b | /clients passes `className="flex-nowrap"` | page-archetypes (no className) + DataTable |
| M16 | title back to `text-2xl font-extrabold` | page-archetypes (markup, typography) |
| M17 | description inside the `<h1>` | page-archetypes (markup, h1 holds only the title) |
| M18 | PageHeader imports `usePathname` | page-archetypes (route awareness, imports) |

**27 / 27 caught.** (A first run listed the DataTable verifier for M14 too; its G4 check covers
status → variant-name maps only, so M14c was added for that form and M14 now names the verifier that
owns class maps.)

## Screenshots — C0 vs C1

Reference: C0 `6ad311b` in a detached worktree; C1: the C1 tree. Both captured in this container
(fresh build each, the TEST-only font hook, fresh run copy of the TEST template per capture, frozen
clock, UTC, pinned Chromium, reduced motion, scale 1; no masking). `run.mjs compare` classes:
IDENTICAL (bytes) / PIXEL-IDENTICAL / AA-NOISE / DIFFERENT.

| Set | States | Byte-identical | Different | The different ones |
|---|---|---|---|---|
| 256 matrix (`capture`) | 256 | 208 | 48 | clients list, client detail, products list — 16 each (EN / AR × light / dark × 4 widths). All C1 |
| Lists (`capture-lists`, DEV-UI-01.5) | 210 | 138 | 72 | clients / products / vendors × normal, filter panel, record menu — 8 each. All C1 (PageHeader); every document-list state identical |
| Shell (`capture-shell`, DEV-UI-01.3) | 44 | 44 | 0 | — |
| Archetypes (`capture-archetypes`, C1 harness) | 202 | 132 | 70 | clients list, client detail, empty clients bin — 10 each (all widths, light + dark 1440); the nine new C1 pages — 4 each; the long-name fixture — 4. All C1; dashboard, HR, projects, finance, settings and the 12 interactions identical |

Intentional differences, all in the C1 family: PageHeader typography (24 px → 20 px `text-page`) and
row (the group wraps below the title at narrow widths instead of squeezing the title column — e.g.
the vendors list at 390, whose description ran over four lines beside the buttons); translated
Arabic copy; the one-column detail grid below 1024 px; h2 section headings (side cards unchanged in
style — the same classes on an `<h2>`; Statement of Account 19 px / 700 → 16 px / 600 with `mb-4`);
EmptyState in the bins. No screenshot outside the C1 family changed. Not captured: the documents
(DEV-UI-01.6) and controls (DEV-UI-01.4) sets — no page or component they render is in C1's change
set (PageHeader's consumers are exactly the 12 pages, and the 18 new dictionary keys reach only them).

The archetype harness (`tests/ui-baseline/archetype-states.mjs`) gains the 36 C1 states and the
long-name fixture: client 1 renamed in the run's TEST-ONLY copy to a 104-character name with one
44-character word, the page reloaded, measured and captured, the name restored (inside `finally`).
The fixture fails the capture unless the header holds: no page overflow, the h1 inside the header
and not overflowing its own box, the title at the inline start, meta / actions at the inline end of
the title's line or wrapped below at the start, no overlap, the header inside the viewport, and at
390 a wrapped (multi-line) title. The C0 reference capture ran the same harness with that assertion
logged instead of thrown (C0's header has no `data-slot`; at 390 its long word runs off the screen
and the badges and menu are pushed out of view).

## PageHeader visual check

| State | Result |
|---|---|
| Short title + description + actions (lists, 1440) | one row; actions at the inline end |
| Short title + many actions (clients list, 390) | actions wrap below the title at the inline start; no overflow |
| Description only, no actions (New pages) | title and description; no trailing group rendered |
| Status meta + record menu (detail pages) | meta (badges) then the menu, at the inline end (1440 / 1024 / 768) or below (390) |
| Long name, 1440 EN / AR | the h1 on one line; meta and menu at the inline end of the same line; no overlap |
| Long name, 390 EN / AR | h1 over 3 lines (the 44-character word breaks), group below at the start; overflow 0 |
| Arabic (RTL) | title at the right (inline start), group at the left or below at the right; the bins' Back arrow points to the inline start |

Measured, not eyeballed: the runtime verifier's `pageHeader` facts on all 96 C1 states (one header,
its h1 the page's only h1, meta before actions, title at the inline start, the group at the end or
wrapped below at the start, no overlap) and the fixture's facts above; screenshots inspected for
client detail EN / AR 390, the clients and vendors lists AR 390, the vendors bin AR 390, the long
name EN 1440 and AR 390.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| ESLint, the 16 changed code files | clean |
| `npm run verify:static` (21 suites) | exit 0 — role matrix 32/32, confirm policy 62/62, dirty form 66/66, skeletons 89/89, contrast 161/161, typography 43/43, **status registry 88/88**, shell 75/75, **controls 110/110**, **DataTable 69/69**, **document form 76/76**, edit action 59/59, store model 69/69, provider harness 302/302, backup claims 26/26, money precision 12/12, **number-locale (P0) 29/29**, **date-timezone (P0.1) 38/38**, **business-dates (P0.2) 44/44**, ledger-only balances 8/8, **page-archetypes 97/97** |
| `npm run verify:server` (24 suites) | exit 0, no failing check |
| `verify:page-archetypes-runtime` | C1 `--rebaseline` run **37/37**; then against the committed baseline **36/36** (two independent C1 measurements identical in all 748 entries); C0 tree with the C1 verifier: every C0 check passes, the 5 C1 targets fail (as above) |
| `verify:browser`, full tier | **49/49 suites** — incl. **AR locale hydration (P0) 169/169**, **settings time-zone hydration (P0.1) 85/85**, **business-date hydration (P0.2) 108/108**, shell runtime 341/341, controls runtime 302/302, DataTable runtime 130/130, document-form runtime 188/188, edit e2e 218/218 |
| React #418 | zero in all 528 runtime states (owner, Staff, Pago_Pago sweep) and in the browser tier |
| Screenshots | above — only C1-family states differ |
| Static mutations | **27 / 27** caught |
| Runtime mutations | **3 / 3** caught: client detail back to `grid-cols-3` (overflow never-worse 0 → 65 / 54 px, offenders, C1 overflow target); PageHeader actions before meta (C1 PageHeader target, 8 states); `description="Vendor profile"` hard-coded (C1 Arabic-copy target, 4 states) |

`verify:static`'s `verify:page-archetypes` against the C0 tree (with the C1 verifier and C0's pins):
78/97 — groups 1–5, 7 and 8 pass; the 19 failures are the two group-6 consumer checks C1 rewrote
(CardTitle `as`, SectionHeader / EmptyState) and 17 of group 9's 19 checks (the two that pass, no
physical direction and status only through StatusBadge, already held at C0).

## Deferred — recorded, not C1's

- **Form internals still English in Arabic**: labels and states inside ClientForm / VendorForm /
  ProductForm that the forms render themselves (e.g. ProductForm's "Reorder level" field, the
  vendor / product "Saving…" state). C1 translated only what the pages hand the forms (`submitLabel`).
- **StatementView copy**: its own "Search" and "Document type" labels render in English in Arabic on
  the client and vendor detail statements. StatementView is outside C1 (unchanged by brief).
- **Unnamed controls**: AddressFields on client detail / New Client (6 per state) — a11y debt, not
  touched (brief: do not fix AddressFields).
- **"Unsaved changes" prompt** on leaving an untouched client / vendor / product detail or New form
  (48 states): DirtyFormProvider / form initialisation, out of scope; C1 did not change it.
- **Unknown id → not-found with HTTP 200** (`/clients/999999`, streamed) and the loading boundaries:
  unchanged, as instructed.
- **`verify:document-form` labels**: its directory check still names "layout" among the protected
  directories, though layout is now pinned file by file. The check reads whatever the pins file
  holds, so behaviour is right (mutation M06); only the wording is stale. The file is not in C1's
  change set.
- Every later-stage defect (C2–C7) stays at its C0 baseline: HR / payroll / attendance, projects,
  finance, settings and dashboard pages are untouched and their runtime entries byte-identical.
