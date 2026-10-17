# DEV-UI-01.7 C7 — document and app-state heading semantics

Parent: C6 `20eff7d6ec25845c2f3342fb1a25a9d5d32ab43e` (tree `c68d91fb4d17a86430a62c409805732542e40cf7`),
on C5 `e8f629b`, C4 `a1dbc6e`, C3 `65e12d6`, C2 `c060e8b`, C1 `8768cb2`, C0 `6ad311b`, main `1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50`.
Branch `claude/dev-ui-01-7-page-archetypes`; C7 is one commit on C6. Nothing is merged to main.
**DEV-UI-01.7 C8 has NOT started.**

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases on
127.0.0.1, with no repository `.env` (the browser tier's runner reads a temporary `.env` that points only
at its own TEST-only database and is deleted afterwards). Builds are normal, unmocked `next build`s.
Nothing touched production; nothing was deployed; no package, environment or configuration changed.

## Scope — D-3, tags only

C7 makes the document and app-state titles real headings. Every change is a tag; the pages must not move a
pixel — which is why C7 is tag-level and not a PageHeader migration (no `PageHeader` on any C7 surface).

| Surface | C6 | C7 |
|---|---|---|
| 8 document lists (quotations, sales orders, proforma invoices, invoices, delivery challans, credit notes, purchase orders, debit notes) | `<h3 className="text-[19px] font-bold">{t(locale, "<Family>")}</h3>` | `<h1 …>` — the same classes, wrapper and dictionary key |
| 8 document details | `<h3 className="mono">{<number>}</h3>`, first in `.inv-head`'s title column | `<h1 className="mono">` — `.inv-sub`, `.inv-head-actions`, the queries unchanged |
| 8 editors | `.doc-titlebar` `<h3>` holding the icon and `t(locale, isEdit ? "Edit …" : "Create …")` | `<h1>` — icon, keys, `.sub`, `DocTopActions` unchanged |
| the shared e-invoice panel (invoice detail, create, edit) | `<h4>` "Tax Invoice QR" / "Tax Invoice QR preview" | `<h2>` under the page's h1 |
| the error boundary (`(app)/error.tsx`) | `<h3 className="text-[19px] font-bold mb-2">Something went wrong</h3>` | `<h1 …>` — the copy still English (no translation, §42) |
| the not-found page (`(app)/not-found.tsx`) | `<h3 …>{t(locale, "Page not found")}</h3>` | `<h1 …>` |
| the document Recycle Bin (`/recycle-bin`) | `<h3 className="text-[19px] font-bold flex items-center gap-2">` Trash2 + `t("Recycle Bin")` | `<h1 …>` |
| `mockup-parity.css` | the h3 / h4 rules | the same rules, each followed by an exact twin for the new tag (four — below) |

Untouched, and guarded: every `actions.ts`, the document lifecycle and edit rules, posting, accounting,
settlement, conversion, totals, taxes, stock, payments, duplicate, import / export, PDF / print, currency, the
status registry, `src/db/**`, `drizzle/**`; `dict.ts` (byte-identical — no dictionary change); `PageHeader`;
the list workspace (toolbar, filters, saved views); the DataTable runtime suite; the Dashboard (C6) and every
C1–C5 file; `verify/verify-compliance-claims.mjs`; the P0 / P0.1 / P0.2 verifiers.

## Changed files

| File | Change |
|---|---|
| the 8 list clients (`sales/{quotations,orders,proforma,invoices,delivery-challans,credit-notes}/*-list-client.tsx`, `purchasing/{orders,debit-notes}/*-list-client.tsx`) | the title h3 → h1 (1 line each) |
| the 8 detail pages (`…/[id]/page.tsx`) | the document number h3.mono → h1.mono (1 line each) |
| the 8 editor forms (`quotation-form`, `order-form`, `proforma-form`, `invoice-form`, `dc-form`, `cn-form`, `po-form`, `dn-form`) | the `.doc-titlebar` title h3 → h1 (open and close tag, 2 lines each) |
| `sales/_shared/einvoice-preview-panel.tsx` | h4 → h2 (1 line) |
| `(app)/error.tsx`, `(app)/not-found.tsx` | h3 → h1 (1 line each) |
| `recycle-bin/recycle-bin-client.tsx` | h3 → h1 (open and close tag) |
| `(app)/mockup-parity.css` | four twins, each with a comment, straight after the rule it twins (+13 lines, nothing removed) |
| `verify/verify-typography.mts` | its two representative document-number CODE_SITES (invoice, PO) expect `h1.mono` |
| `verify/verify-document-form.mts` | the planned hand-off ("editor titles stay h3") replaced by the stronger C7 assertion, and a twin check |
| `verify/verify-page-archetypes.mts` | group 15 (C7, 14 checks); group 10 and the stylesheet pins undo C7's hunks before holding C1 / C6 bytes |
| `verify/verify-page-archetypes-runtime.mjs` | the C7 heading pass, `C7M`, the TEST-only draft fixtures, `--write-c7ref`, the C7 checks |
| `verify/page-archetype-runtime-baseline.json` | `c7ref` added (C6's own build, 140 states + the error boundary's 4 renders); the two app-state routes (`recycle-bin`, `nf-client`) re-recorded — their outline the h1 (h3 in C6); every other entry byte-identical |
| `tests/ui-baseline/archetype-states.mjs` | 108 C7 states, the `c7-draft` action, `writeC7Drafts` / `removeC7Drafts` |
| this document | |

29 source files, +50 / −37. `verify/page-archetype-pins.json` and `verify/page-archetype-actions.json` are
unchanged (§44 listed the pins as "likely": no route, consumer or data section changed, so no pin moved).

## Before / after — the outline (EN; Arabic the same words from the dictionary)

```
C6                                   C7
/sales/invoices        h3 Invoices                     h1 Invoices
/sales/invoices/3      h3 INV-0003  h4 Tax Invoice QR   h1 INV-0003  h2 Tax Invoice QR
/sales/invoices/new    h3 Create Invoice  h4 Tax Invoice QR preview    h1 Create Invoice  h2 Tax Invoice QR preview
/sales/invoices/6/edit h3 Edit Invoice    h4 Tax Invoice QR preview    h1 Edit Invoice    h2 Tax Invoice QR preview
(the other 7 families: list / detail / create / edit — h3 → h1, one heading each)
/recycle-bin           h3 Recycle Bin                  h1 Recycle Bin
/clients/999999        h3 Page not found               h1 Page not found
error boundary         h3 Something went wrong         h1 Something went wrong
```

Accessibility tree (Playwright's aria snapshot of `<main>`): every page title level 3 → 1, the Tax Invoice QR
heading level 4 → 2, every name unchanged. The shell's `topbar-title` stays an h3 outside `<main>` (D-01.3-F).

## The 8 × 3 document matrix

Measured on the final tree (final runtime run, EN / AR at 1440 and 390 — 4 states per cell), against `c7ref` (C6's
build). Every cell: HTTP 200 at its own path; **exactly one h1**, and it is the title (h3 in C6); the `<main>` text,
the action inventory, the title's computed style and box all identical to C6's.

| Family | List h1 (EN / AR) | Detail h1.mono | Create h1 (EN / AR) | Edit h1 (page) | Actions EN 1440 (list / detail / create / edit) |
|---|---|---|---|---|---|
| Quotations | Quotations / عروض الأسعار | QTN-0001 | Create Quotation / إنشاء عرض سعر | Edit Quotation (`/sales/quotations/3/edit`, seeded draft QTN-0003) | 16 / 3 / 26 / 26 |
| Sales Orders | Sales Orders / أوامر البيع | SO-0001 (TEST-only draft) | Create Sales Order / إنشاء أمر بيع | Edit Sales Order (`/sales/orders/1/edit`, TEST-only draft) | 8 / 4 / 26 / 26 |
| Proforma Invoices | Proforma Invoices / الفواتير المبدئية | PF-0001 (TEST-only draft) | Create Proforma Invoice / إنشاء فاتورة مبدئية | Edit Proforma Invoice (`/sales/proforma/1/edit`, TEST-only draft) | 8 / 4 / 24 / 24 |
| Invoices | Invoices / الفواتير | INV-0003 | Create Invoice / إنشاء فاتورة | Edit Invoice (`/sales/invoices/6/edit`, seeded draft INV-0006) | 22 / 4 / 26 / 26 |
| Delivery Challans | Delivery Challans / أذون التسليم | DC-0001 (TEST-only draft) | Create Delivery Challan / إنشاء إذن تسليم | Edit Delivery Challan (`/sales/delivery-challans/1/edit`, TEST-only draft) | 8 / 3 / 14 / 14 |
| Credit Notes | Credit Notes / إشعارات الدائن | CN-0001 (TEST-only draft) | Create Credit Note / إنشاء إشعار دائن | Edit Credit Note (`/sales/credit-notes/1/edit`, TEST-only draft) | 9 / 3 / 14 / 14 |
| Purchase Orders | Purchase Orders / أوامر الشراء | PO-0001 | Create Purchase Order / إنشاء أمر شراء | Edit Purchase Order (`/purchasing/orders/3/edit`, seeded draft PO-0003) | 12 / 3 / 26 / 26 |
| Debit Notes | Debit Notes / إشعارات المدين | DN-0001 (TEST-only draft) | Create Debit Note / إنشاء إشعار مدين | Edit Debit Note (`/purchasing/debit-notes/1/edit`, TEST-only draft) | 9 / 3 / 14 / 14 |

The invoice pages add the Tax Invoice QR panel — h2 "Tax Invoice QR" on the detail, h2 "Tax Invoice QR preview" on
create and edit (h4 in C6). App states: `/recycle-bin` h1 Recycle Bin / سلة المحذوفات; `/clients/999999` and
`/sales/invoices/999999` h1 Page not found / الصفحة غير موجودة — each the page's one heading, text, actions, style
and box as C6.

## Business, form and data invariants

* **Source**: each of the 28 files is C6's plus exactly its heading hunk(s) (group 15's hunk reversal — undone, each
  file hashes to its C6 bytes). So in the 8 editors `submit()`, the payload, `useDirtyForm`, initial values, line
  items, totals, tax, discounts, currency, project, payment terms, notes, attachments, column configuration, Save as
  Draft / Preview / Save Changes, error and focus handling, the dirty indicator and every server call are C6's; in
  the 8 details the server data / query section, action conditions, lifecycle / status logic, amounts,
  relationships and notes are C6's; in the 8 lists rows, filters, search, saved views, export / import, sort,
  archived behaviour, StatRow, statuses and row actions are C6's.
* **Form pins**: `verify-document-form`'s SUBMIT and DIRTY hashes (C6's, untouched) pass for all 8 forms — and
  mutations 22–23 prove they bite.
* **Nothing else changed**: no `actions.ts`, lifecycle, registry, route `page.tsx` other than the 8 detail pages'
  tag, layout, `src/lib/**`, `src/db/**`, `drizzle/**`, package, Next config or environment file is in the diff.
* **Runtime**: every C7 page's `<main>` text and action inventory equal C6's (140 states); the general runtime pass
  holds the owner (1,629) and Staff (1,050) action inventories, final paths, guards and Staff landings unchanged.
* **Routes and permissions**: same final URL (every C7 page at its own path), same guards and Staff behaviour (the
  runtime's permission checks, the browser tier's Staff suites), same lifecycle eligibility — edit pages open only
  on drafts (seeded or TEST-only), `canEditDocument` untouched.

## The CSS twins — and the cascade

`globals.css` has `h1, h2, h3, h4, h5, h6 { font-family: var(--font-ui); font-weight: 600; text-wrap: balance; }`
**unlayered**; Tailwind's utilities live in `@layer utilities`, and an unlayered rule outranks any layered one.
So in C6 the list titles' `font-bold` never applied: seven list titles, Not Found and Error compute **600**. Two
titles sit in `.main-head` — the Quotations list and the Recycle Bin — where the unlayered `.main-head h3
{ font-size: 19px; font-weight: 700; }` applies: they compute **700**. (Measured on C6's build, `c7ref`.)

The global rule treats h1 and h3 alike, so the seven lists, Not Found and Error need no twin. But `.main-head h3`
does not match an h1: without a twin the Quotations and Recycle Bin titles would fall from 700 to 600 — a visible
change. So C7 has a **fourth twin**, beyond the brief's three:

```css
.main-head h1 { font-size: 19px; font-weight: 700; }          /* twin of .main-head h3 */
.inv-head h1 { font-size: 22px; font-weight: 700; }           /* twin of .inv-head h3 */
.einvoice-panel h2 { font-size: 13.5px; font-weight: 700; }   /* twin of .einvoice-panel h4 */
.doc-titlebar h1 { font-size: 22px; font-weight: 700; display: flex; align-items: center; gap: 10px; }  /* twin of .doc-titlebar h3 */
```

Each is placed straight after the rule it twins, with exactly its declarations; the h3 / h4 rules stay
byte-identical. Static group 15 holds them (each once, adjacent, equal declarations; with the four undone the
stylesheet is C6's to the character, `2d06b07ba2e73e3d`); `verify-document-form` checks the three document
twins' declarations against their rules. The UA stylesheet's h1 sizes and margins never reach these elements
(Preflight's `font-size: inherit; margin: 0` in `@layer base` applies to every heading level alike) — the runtime
proves it on the computed style and box of every title.

## Mono

The 8 detail h1s keep `className="mono"`. `.mono { font-family: var(--font-mono); font-variant-numeric:
tabular-nums; }` is unlayered with specificity (0,1,0) — above the global heading rule's (0,0,1) — so the number
stays in IBM Plex Mono, as in C6; the money on those pages stays IBM Plex Sans. Static: all 8 detail h1s
`className="mono"`, the `.mono` rule C6's. Runtime: all 8 detail pages (EN / AR, 1440 / 390) — the h1's computed
family the code face in C6 and C7, the first `.num-tabular` amount not.

## The e-invoice subsection

`sales/_shared/einvoice-preview-panel.tsx` — the panel's title, first in `.eh`:

```tsx
// C6
<h4>{variant === "create" ? t(locale, "Tax Invoice QR preview") : t(locale, "Tax Invoice QR")}</h4>
// C7
<h2>{variant === "create" ? t(locale, "Tax Invoice QR preview") : t(locale, "Tax Invoice QR")}</h2>
```

A subsection under the page's h1 (invoice detail: "Tax Invoice QR"; invoice create and edit: "Tax Invoice QR
preview"). The variant expression, the QR, the badge, the description, the ZATCA logic and the card structure are
C6's (hunk reversal); no other heading added. `.einvoice-panel h2 { font-size: 13.5px; font-weight: 700; }` twins
`.einvoice-panel h4` (kept). Runtime: aria level 4 → 2, the name unchanged; computed style and box identical to C6's
on all 12 invoice detail / create / edit states (e.g. detail EN 1440: 700 · 13.5 px · IBM Plex Sans, box
[1000.06, 180, 92.94, 20] in both); screenshots byte-identical.

## App states

* **Recycle Bin** (`/recycle-bin`) and **not-found** (`/clients/999999`, `/sales/invoices/999999` — deterministic:
  no such client or invoice in the seed): one h1 each, in the runtime heading matrix (EN / AR, 1440 / 390); the two
  baseline routes (`recycle-bin`, `nf-client`) re-recorded — their outline the h1 alone. The streamed not-found
  answers HTTP 200 at its own path (as in C6 — the HTTP fix is out of scope, §42 / §54).
* **Error boundary** (`(app)/error.tsx`): no route raises it and no existing deterministic fixture does; no route
  was added to force it (§25). Method — three layers:
  1. **static**: group 15 holds the source (`<h1 className="text-[19px] font-bold mb-2">Something went wrong</h1>`,
     the file's only heading, the file C6's but for that tag);
  2. **isolated component render**: the static verifier imports the real component and renders it with
     `react-dom/server` (`renderToStaticMarkup`) — exactly one heading, `<h1 class="text-[19px] font-bold mb-2">Something
     went wrong</h1>`, the copy, Try again and Back to Dashboard as C6;
  3. **in-stylesheet render** (runtime): the boundary's exact markup rendered into `<main>` of the real app shell of
     the built app, at 1440 and 390, once with the C6 tag (h3) and once with C7's (h1) — computed style and box
     identical, and the screenshots of `<main>` pixel-identical (png sha `f216a4ca08d2088f` at 1440,
     `b03c16f08674d628` at 390), equal to the same renders on C6's own build (`c7ref`). A warm-up render precedes
     them: the first render into `<main>` differs by 16 px at the icon's edge from every later one (a first-paint
     artifact, measured on both builds, independent of the tag).

## TEST-only fixtures for the edit pages

The seed has quotations, invoices and purchase orders — QTN-0003, INV-0006 and PO-0003 are drafts, so their edit
pages open on seeded records — but no sales orders, proforma invoices, delivery challans, credit notes or debit
notes. For those five families the runtime pass and the harness write one **TEST-only draft each** (id 1:
SO-0001, PF-0001, DC-0001, CN-0001 against INV-0003, DN-0001 against PO-0002's vendor and line; issue date
2026-06-10) into the run's TEST-only copy, in a transaction, only when the database name is `devui010_test_only_*`
and the copy holds none of those families; they are removed straight after the pass (exactly one row each) and the
five numbering sequences restored. Their detail and edit pages are therefore real drafts — eligible under the
unchanged lifecycle (`canEditDocument`: drafts only). No lifecycle rule changed.

## Verifier updates

* `verify-typography` (43/43): `["sales/invoices/[id]/page.tsx", /<h1 className="mono">\{invoice\.invoiceNumber\}<\/h1>/,
  "invoice number heading"]` and `["purchasing/orders/[id]/page.tsx", /<h1 className="mono">\{po\.poNumber\}<\/h1>/, "PO
  number heading"]` (h3 in C6); nothing else. Undone, the file is C6's to the byte (`02b422d53822fc4a`).
* `verify-document-form` (77/77, C6 76): `check("document headings left for DEV-UI-01.7 (editor titles stay h3)", …)`
  — the planned hand-off — replaced by: every editor's title is a real h1 first in `.doc-titlebar`, its icon and
  Create / Edit key inside, exactly one h1 and no h2–h6 in the form, no h3 title left; and the twins'
  declarations equal to the h3 / h4 rules', which stay. The SUBMIT / DIRTY hash pins and every other check
  unchanged — and green, which is §35's proof. Undone, the file is C6's to the byte (`0321011771832fc1`); the C7
  block itself is pinned too (`31abd69fc9ff1552`, see "Mutations").
* `verify-page-archetypes` (226/226, C6 212): group 15 (14 checks) —
  1. hunk reversal: each of the 28 files is C6's plus exactly its heading hunk(s) (`C7_EDITS`), undone C6's bytes;
  2. lists; 3. details (`.inv-head > div > h1.mono` before `.inv-sub`, the actions group); 4. editors; 5. the
     e-invoice h2; 6. the app states; 7. the error boundary's isolated render; 8. the four twins; 9. Mono;
  10. no PageHeader on any C7 surface (the 28 files and `recycle-bin/page.tsx`); 11. the typography update
     pinned; 12. the document-form update pinned; 13. C6 and the list workspace frozen (dict, the four Dashboard
     files, the compliance suite, P0 / P0.1 / P0.2, the DataTable suite, the list toolbar / filters / saved views,
     PageHeader); 14. no blanket heading replacement (every other `.tsx`'s headings as C6's, 11 files, `8f201e6e6c7a0ed9`).
  Group 10 (C1's list bytes) and the stylesheet pins of groups 11 / 12 / 14 undo C7's hunks before holding their
  older bytes, so they stay exactly as strict.
* `verify-page-archetypes-runtime`: the C7 heading pass and checks (below); `c7ref` recorded with
  `--write-c7ref` on exact C6 (`20eff7d`, src clean, build `XX9YkWWhZDomMblSJAVJ5`, Chromium 141.0.7390.37).
* `tests/ui-baseline/archetype-states.mjs`: 108 C7 states — the 8 families' detail, create and edit pages, the
  Recycle Bin and two not-found pages, EN / AR at 1440 and 390 (40 of them on the TEST-only drafts).

## Action inventory (C6 → C7)

**0 action changes.** `verify/page-archetype-actions.json` is byte-identical; the runtime's "nothing else moved"
check compares every C7 page's action inventory (140 states) with C6's build's — identical.

## Runtime (C6 → C7)

`verify/verify-page-archetypes-runtime.mjs`, its own fresh normal build, a fresh TEST-only copy, loopback only, the
clock frozen at 2026-06-15T09:00:00Z, pinned Chromium 141.0.7390.37:

* **The reference, `c7ref`**: recorded with `--write-c7ref` on **exact C6** (`20eff7d`, src clean, build
  `XX9YkWWhZDomMblSJAVJ5`) — 35 pages × EN / AR × 1440 / 390 = 140 states (each page's outline, aria headings,
  title and QR facts — 30 computed properties and the box — text, action inventory, overflow, errors) and the
  error boundary's four renders. The record refuses a failing run, a missing state or drafts left behind.
* **The rebaseline run** (`--rebaseline=recycle-bin,nf-client`, build `EtHuJ79OhzXlFg-7fI-Bo`): **152/152**;
  re-recorded the two app-state routes — 16 owner states (outline `h3` → `h1`, h1 count 0 → 1, and the two fields
  later stages record, absent → empty / null, as C6's Dashboard re-record), their 4 Staff and 4 sweep entries and 10
  action lists **identical**; every other entry, `d6`, `c3ref`, `c4ref`, `c6ref` and `c7ref` byte-identical;
  `page-archetype-actions.json` byte-identical.
* **The final run** (the final tree `88dc446011660c72`, no rebaseline, build `GtnM7XlCMFNWD0FE1l626`): **151/151**
  — C6's 139 checks (C0 / shared 42, C1 7, C2 14, C3 20, C4 17, C5 17, C6 22) and C7's 12; the same 151 check lines
  as the run before the null-safe print (`c8acc520563949d1`, build `_Mznudw0KA-anoA-5wu5O`, 151/151); the baseline
  untouched by either:

| C7 check | Result |
|---|---|
| record: `c7ref` covers 140 states + 4 error renders, measured on 20eff7d, src clean | PASS |
| fixtures: SO-0001, PF-0001, DC-0001, CN-0001, DN-0001 written for the pass and removed, sequences restored | PASS |
| heading matrix: the 8 families' list / detail / create / edit, `/recycle-bin`, `/clients/999999`, `/sales/invoices/999999` — 200 at their own path, exactly one h1, its words the dictionary's (EN / AR, 1440 / 390) | PASS |
| levels: the 8 lists skip no level; no C7 page skips more than in C6 | PASS |
| outline against C6: same headings, same order, same words — the title h3 → h1, the Tax Invoice QR h4 → h2, nothing else | PASS |
| accessibility tree (Playwright aria snapshot of `<main>`): title level 3 → 1, QR level 4 → 2, names unchanged | PASS |
| computed style and box: every title and QR heading — 30 properties (family, size, weight, line height, letter spacing, colour, alignment, wrapping, margins, padding, display, alignment, gaps, width, height…) and x / y / width / height — identical to C6's | PASS |
| Mono: the 8 numbers in the code face (C6 and C7), the money not | PASS |
| nothing else moved: each page's `<main>` text and action inventory identical to C6's; overflow as C6 | PASS |
| zero console errors, page errors and React #418 | PASS |
| error boundary: h3 vs h1 render — identical style and box, pixel-identical, equal to C6's build's | PASS |
| app states in the baseline: `recycle-bin`, `nf-client` — the outline the h1 alone, every width, EN / AR | PASS |

Representative titles (EN 1440 unless noted; C6 → C7, both measured):

| Heading | Tag | Weight · size · family | Line height · margins · padding | Display · gap | Box [x, y, w, h] |
|---|---|---|---|---|---|
| Invoices list title | h3 → h1 | 600 · 19 px · IBM Plex Sans | 20 px · 0 · 0 | block | [264, 91, 74.52, 20] → same |
| Quotations list title (`.main-head`) | h3 → h1 | 700 · 19 px · IBM Plex Sans | 20 px · 0 · 0 | block | [264, 91, 96.66, 20] → same |
| INV-0003 (detail) | h3 → h1 | 700 · 22 px · IBM Plex Mono | 20 px · 0 · 0 | block | [264, 91, 314.78, 20] → same |
| INV-0003, AR 390 | h3 → h1 | 700 · 22 px · IBM Plex Mono | 24 px · 0 · 0 | block | [41.22, 87, 336.78, 24] → same |
| Create Invoice (editor) | h3 → h1 | 700 · 22 px · IBM Plex Sans | 20 px · 0 · 0 | flex · center · 10 px | [264, 91, 401.7, 20] → same |
| Edit Invoice (editor) | h3 → h1 | 700 · 22 px · IBM Plex Sans | 20 px · 0 · 0 | flex · center · 10 px | [264, 91, 150.95, 20] → same |
| Tax Invoice QR (detail) | h4 → h2 | 700 · 13.5 px · IBM Plex Sans | 20 px · 0 · 0 | block | [1000.06, 180, 92.94, 20] → same |
| Tax Invoice QR preview (create, AR 390) | h4 → h2 | 700 · 13.5 px · IBM Plex Sans | 24 px · 0 · 0 | block | [197.42, 2117.25, 161.58, 24] → same |
| Recycle Bin | h3 → h1 | 700 · 19 px | — | — | [264, 91, 129.92, 20] → same |
| Page not found | h3 → h1 | 600 · 19 px | — | — | [616, 247, 448, 20] → same |

(The Invoices list title's 600 is C6's too: its `font-bold` never applied — see the cascade above. Recorded, not
changed: changing it would move pixels.)

## Screenshots — zero pixel difference

Same harness, frozen clock, seed, TEST-only database and pinned Chromium as every earlier stage; no masking, no
injected CSS; normal builds. Both sides captured fresh, with the same harness (`archetype-states.mjs`
`e539837f1e40b655`, `run.mjs` `030bd93ff4ce2ce8`):

* **before** — exactly C6 (`20eff7d`, `src` clean, build `XX9YkWWhZDomMblSJAVJ5`, C7's harness module copied in);
  it reproduces C6's own approved final captures **byte for byte — all 1,000 states** (256 / 44 / 210 / 134 / 356);
* **after** — the C7 tree (`src` `a0acada222cb295a`, the final `src`; build `EtHuJ79OhzXlFg-7fI-Bo`).

| Set | States | Byte-identical C6 → C7 | Different |
|---|---|---|---|
| 256-state matrix (incl. the invoices and quotations lists and invoice new / edit / detail, light and dark, 4 widths) | 256 | **256** | 0 |
| shell | 44 | **44** | 0 |
| lists | 210 | **210** | 0 |
| documents | 134 | **134** | 0 |
| archetypes — C6's states | 356 | **356** | 0 |
| **all C6 states** | **1,000** | **1,000 / 1,000** | **0** |
| archetypes — the new C7 states (before / after pairs) | 108 | **108 / 108** | 0 |

The 108 new states (`arch-c7-*`): each of the 8 families' detail, create and edit page, the Recycle Bin, a missing
client and a missing invoice — EN / AR at 1440 and 390 (40 of them on the TEST-only drafts) — each captured on C6
(before) and C7 (after): byte-identical pairs. The harness compare's own classes: every state IDENTICAL (png bytes
equal) — none pixel-identical, none anti-aliasing noise, none different.

The first C6 capture attempt stopped in the archetype set at the first TEST-only draft edit page: the harness's
`c7-draft` assertion looked for a `<form>` the editors do not have (they save from DocTopActions' buttons). The
assertion was corrected (the page at its own path and the titlebar with its actions — tag-agnostic, so the same on
C6 and C7) and both sides re-captured with the corrected harness. The first attempt's four complete sets are kept,
not overwritten: they equal the re-capture byte for byte (the correction reaches only `c7-draft` states).

## Mutations

**Static** (a mutation worktree synced to the final tree, each edit applied alone, every listed verifier run, the
file restored; caught = every listed verifier exits non-zero): **50/50 caught** on the final tree — the brief's 28
(§46, in its order; 28 split into P0, P0.1 and P0.2: 30 mutations) and 20 extra; the worktree back to exactly the
C7 change set afterwards. The first run was 49/50 — M21 missed (see "Corrections" 1); with the C7 block pinned, it
is caught.

| # | Mutation | Caught by |
|---|---|---|
| 1–2 | the Quotations / Invoices list h1 back to h3 | page-archetypes (group 15 hunk reversal + lists) |
| 3–4 | the invoice / PO detail h1 back to h3 | page-archetypes (hunk reversal, details) and typography (its two CODE_SITES) |
| 5 | a detail h1 (Sales Order) loses `mono` | page-archetypes (hunk reversal, details, Mono) |
| 6–7 | the invoice / Delivery Challan editor h1 back to h3 | page-archetypes (hunk reversal, editors) and document-form (the C7 heading assertion) |
| 8 | `.inv-head h1` twin removed | page-archetypes (the stylesheet: four twins) and document-form (twins) |
| 9 | `.inv-head h1` 22 px → 23 px | page-archetypes (the stylesheet pins of groups 11–15) and document-form (twins) |
| 10 | `.doc-titlebar h1` twin removed | page-archetypes and document-form |
| 11 | `.doc-titlebar h1` weight 700 → 600 | page-archetypes and document-form |
| 12 | the e-invoice h2 back to h4 | page-archetypes (hunk reversal, e-invoice) |
| 13 | `.einvoice-panel h2` twin removed | page-archetypes and document-form |
| 14–16 | the error / not-found / Recycle Bin h1 back to h3 | page-archetypes (hunk reversal, app states) |
| 17 | a document title string changed ("Invoices" → "Sales Invoices") | page-archetypes (group 10's C1 bytes, hunk reversal, lists) |
| 18–19 | PageHeader introduced into a document list / an editor | page-archetypes (group 9's PageHeader consumers, no PageHeader on a C7 surface, hunk reversal) |
| 20 | typography's representatives back to expecting h3 | typography itself (both sites fail on the h1 source) and page-archetypes (its pin) |
| 21 | document-form's C7 assertion widened to `h1 | h3` (still permits an h3 title) | page-archetypes (the C7 block pinned byte for byte) |
| 22 | the invoice submit body drops `terms` | document-form (SUBMIT pin) and page-archetypes (hunk reversal) |
| 23 | the invoice dirty snapshot drops `notes` | document-form (DIRTY pin) and page-archetypes (hunk reversal) |
| 24 | the invoice detail's line query gains `.limit(50)` | page-archetypes (hunk reversal) |
| 25 | `use-list-filters.ts`: archived rows shown in the active view | page-archetypes (C7 frozen list workspace) |
| 26 | a Dashboard widget h2 back to h4 | page-archetypes (group 14, C7 frozen C6) |
| 27 | the compliance suite's D-4 check loosened | page-archetypes (C6's approved-maintenance pin, C7 frozen) |
| 28a–c | P0 (its selector), P0.1 and P0.2 (their #418 check dropped) | page-archetypes (the P0 hash pins, C7 frozen) |
| X01–X20 | `dict.ts` changed; the `.main-head h1` twin removed; the original `.inv-head h3` rule removed (twin kept); a duplicate second h1; the editor icon out of the h1; the old "editor titles stay h3" hand-off restored; "Create Invoice" → "New Invoice"; the invoice h1 loses `mono`; a heading outside the 28 files changed; PageHeader in `recycle-bin/page.tsx`; the error copy changed; the DataTable suite's settle time raised (absorbing the race); the list toolbar's Radix focus hand-off flipped; saved-view validation changed; not-found loses `mb-2`; the `.mono` rule changed; PageHeader touched; the e-invoice title text changed; a twin gains a declaration; the Quotations title loses `.main-head` | each by its check (page-archetypes; document-form / typography where they apply) |

**Runtime** (`--only=c7`: the C7 heading pass alone; the mutation worktree rebuilt normally for each, the edit
restored after; caught = the run exits non-zero **and** every named check fails): **7/7 caught**. The unmutated
control (RT0) passes **151/151** (build `FGVJVH7LCJ0ZFWs4TfpJK`), so every failure below is the mutation's. The
worktree back to exactly the C7 change set afterwards.

| Mutation (§48) | Build | Result | Failing checks |
|---|---|---|---|
| RT1 — invoice list h1 → h3 | `KlQl5H88Wy3vv7l939ifz` | 148/151 | heading matrix, outline, accessibility tree |
| RT2 — invoice detail h1 → h3 | `Xs_aiWV6KSeHTyAGxPMmX` | 148/151 | heading matrix, outline, accessibility tree |
| RT3 — invoice editor h1 → h3 (create and edit: 8 states) | `RIojgMf-tO3pqgCCEZqFn` | 148/151 | heading matrix, outline, accessibility tree |
| RT4 — a duplicate second h1 (the invoice number twice) | `6_6fv-U3p6-7oL-H8dCGn` | 146/151 | heading matrix, outline, accessibility tree, computed style and box, nothing else moved |
| RT5 — the e-invoice h2 → h4 (12 states) | `yIPw30zgY9x13JpSj036E` | 148/151 | levels (h1 → h4 skips two), outline, accessibility tree |
| RT6 — the Recycle Bin h1 removed (a div) | `rcJ0xyXS2hBHO7_qvcN0B` | 147/151 | heading matrix, outline, accessibility tree, computed style and box |
| RT7 — an injected console error (the invoices list) | `YpeYysMYjDrBhbESz_alQ` | 150/151 | zero console errors |

RT6's first run (build `lFYS7IFJ2Uh6XUlQnoY5z`) exited 1 by a **crash**, not by its checks: the C7 summary print
read `title.tag` of a page with no heading left. A crash is not a catch, so the print was made null-safe (it prints
the same lines when the titles exist) and RT6 re-run: caught by four checks. The final runtime run is on the tree
with that fix.

**Visual** (§47 — "zero diff" measured, not assumed): each twin mutated in the mutation worktree, rebuilt, the
runtime C7 pass run, then the affected harness states captured on that same mutated build and compared with exact
C6's captures of the same states; restored straight after (the worktree back to the C7 change set):

| Mutation | Build | Runtime | Screenshots vs C6 |
|---|---|---|---|
| V1 — `.inv-head h1 { font-size: 23px; … }` | `ANqES6cBnBnHNt_2PLrSs` | 150/151 — computed style and box fails on all 32 detail states (8 families × EN / AR × 1440 / 390: font size 22 → 23 px) | `arch-c7-inv-detail` 4/4 **DIFFERENT** — 1,287–1,351 px differ, max channel delta 223/255 |
| V2 — `.doc-titlebar h1` removed | `S344cLztI7R6jE1PghcEz` | 150/151 — computed style and box fails on all 64 editor states (16 pages × 4: weight 700 → 600 and the box 20 → 40 px tall — the icon and title no longer one flex row) | `arch-c7-inv-new` 4/4 **DIFFERENT** — every page 20 px taller (e.g. 1440 × 1996 → 1440 × 2016) |

Both caught by the computed-style gate and by the screenshots.

## Previous gates

On the final tree (`git diff` of everything but this document identical in the main checkout and every worktree
used: `88dc446011660c72`, `src` `a0acada222cb295a`):

* `verify:page-archetypes` **226/226** — C0's groups 1–8, C1 19/19, C2 13/13, C3 26/26, C4 28/28 (the P0 pin
  `a226b47188ddf478` unchanged), C5 24/24, C6 24/24, **C7 14/14**.
* `verify:static` exit 0 — role matrix 32/32, confirmation policy 62/62, dirty form 66/66, skeletons 89/89,
  contrast 161/161, **typography 43/43**, status registry 88/88, shell 75/75, controls 110/110, DataTable 69/69,
  **document form 77/77** (C6 76: the hand-off check replaced, the twin check added), edit-action 59/59, store model
  69/69, provider harness 302/302, backup claims 26/26, money precision 12/12, **number-locale (P0) 29/29,
  date-timezone (P0.1) 38/38, business-dates (P0.2) 44/44**, ledger-only balances 8/8, page archetypes 226/226.
* `verify:server` exit 0 (a fresh TEST-only database, no `.env`) — the same 23 suites as C6, each green (statements
  70/70, project costing 50/50, docs import 339/339, client import, quotation import, exchange rates 57/57,
  registration currency 34/34, money round-trip 44/44, base backfill 21/21, rate fetch 27/27, FX reporting 16/16,
  advances audit 18/18, advance allocations 23/23, advance backfill 16/16, advance release 15/15, credit-note release
  40/40, advance refunds 10/10, advance clear 13/13, note FX 40/40, settlement 29/29, payment reversal 55/55, bank
  opening 18/18, bank opening backfill 31/31) and DB hardening (both append-only triggers present); its log differs
  from C6's only in random identifiers and timestamps.
* `tsc --noEmit` exit 0; ESLint `--max-warnings=0` on the 33 changed code files (the 28 sources, the harness states
  and the four verifiers): 0 errors, 0 warnings; dictionary 1,751 keys, no duplicate (unchanged).
* Runtime: **151/151** on the final tree (above); C1–C6's runtime targets green in it.
* C6 and earlier frozen: `dict.ts` `ad171858a8128535`, the four Dashboard files, `verify-compliance-claims.mjs`
  `98bd1c9f967d9fa3`, P0 `a226b47188ddf478`, P0.1 `a43b9d9f7b521da6`, P0.2 `02ef92b957d4d719`, the DataTable suite
  `7dd991ed407faf91`, `list-workspace-toolbar.tsx` `2bd2a430e47a76f5`, `use-list-filters.ts` `e9bc8477a32c2877`,
  `saved-view-actions.ts` `4e2a260f754684b0`, `page-header.tsx` `f54789d9a9de8073` — each C6's (group 15).
* **Browser tier: 49/49 suites passed** (`exit 0`) — the complete `verify/run-browser-suites.mjs`, alone, on a
  fresh normal build of the final tree (`u6ruFYMnH6dU66f2vz_Zj`), a fresh TEST-only database, a temporary `.env`
  pointing only at it (removed afterwards), no repository `.env`; one run, none omitted: account Arabic 34/34,
  advances 172/172, **P0 Arabic-locale hydration 169/169**, bank GL 21/21, bank opening ✓, **P0.2 business-date
  hydration 108/108**, colour theme ✓, compliance claims ✓, confirm e2e 34/34, **controls 302/302**, currency lock
  13/13, dark theme ✓, **DataTable 130/130**, DC without bank 21/21, delete refusal 16/16, dirty core 72/72, dirty UI
  8/8, document attachments 14/14, **document form 188/188**, **draft buttons ✓**, draft func ✓, duplicate 40/40,
  **edit e2e 218/218**, edit ✓, expense categories hidden 16/16, favorites 20/20, FX dashboard 6/6, FX posting
  108/108, note currency 19/19, payment dialog 28/28, payment FX 66/66, PDF branding 15/15, preset ZATCA ✓, print
  apply ✓, private storage 22/22, proforma payments ✓, rate one-click 28/28, rate screen 13/13, register outstanding
  5/5, registration currency 20/20, reversal status 16/16, **P0.1 settings time-zone hydration 85/85**, **shell
  341/341**, sidebar scroll 14/14, skeleton 11/11, Staff replay 9/9, **Staff runtime 20/20**, statement reversal
  25/25, vendor inline 31/31 (✓ = the suite's verdict line; those suites print no count). Every count equals C6's
  gate run.

## The DataTable saved-view focus race (§38 / §39)

**It did not appear in C7.** The DataTable runtime suite ran normally inside the full tier and passed **130/130**;
no other run of it was made, and nothing was re-tried. C7 changes none of its inputs: the suite
(`verify/verify-datatable-runtime.mjs` `7dd991ed407faf91`), `list-workspace-toolbar.tsx` (`2bd2a430e47a76f5`, the
Views menu and its Radix focus hand-off), `use-list-filters.ts` (`e9bc8477a32c2877`) and `saved-view-actions.ts`
(`4e2a260f754684b0`) are byte-identical to C6 — held by group 15 (mutations 25, X12–X14 prove the hold) and hashed
at the tier's start. The eight list titles' tag is the only change on the list pages, and the list screenshots
are C6's to the byte.

**Carried to C8 (§39), unresolved:** the race is pre-existing (C6 reproduced it on exact C5), intermittent, and not
deterministic; one green tier does not close it. C8 may not formally close DEV-UI-01.7 while it remains
unresolved or unclassified as deterministic — C8 must bring either a separately reviewed synchronization
correction or a stronger deterministic final-tier protocol approved in C8's review. C7 did not touch it.

## Build

Normal unmocked `next build` (Next.js 16.3.5, Turbopack); every build fresh, from its own tree; no font mocks, no
`NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, no package, Next config, environment, server or deployment change.

| Build | Tree | Used for |
|---|---|---|
| `XX9YkWWhZDomMblSJAVJ5` | exact C6 `20eff7d` (`src` clean) | the lock gate (runtime 139/139), the `c7ref` record, every C6 screenshot |
| `EtHuJ79OhzXlFg-7fI-Bo` | C7 (`src` `a0acada222cb295a` — the final `src`) | the rebaseline run (152/152), every C7 screenshot |
| `_BFLG-59f771w47xNFReN` | C7 | a final runtime run, stopped before its checks to include the harness correction |
| `_Mznudw0KA-anoA-5wu5O` | C7 (`c8acc520563949d1`) | the final runtime run before the null-safe print, 151/151 |
| `GtnM7XlCMFNWD0FE1l626` | **the final tree** (`88dc446011660c72`) | the final runtime run, **151/151** |
| `u6ruFYMnH6dU66f2vz_Zj` | **the final tree** | the full browser tier, **49/49** |
| `FGVJVH7LCJ0ZFWs4TfpJK` … `S344cLztI7R6jE1PghcEz` | the mutation worktree | one per runtime / visual mutation (RT0–RT7, RT6's crashed first run `lFYS7IFJ2Uh6XUlQnoY5z`, V1, V2) |

The final tree differs from the C7 screenshot build's tree only in `verify/` and the harness (`src` identical), and
from the `c8acc…` tree only in the runtime verifier's summary print.

## Decisions where the brief's premise did not hold

1. **A fourth CSS twin, `.main-head h1`.** The brief's premise — the list titles keep their look from their classes
   — holds for seven lists but not for the Quotations list and the Recycle Bin, whose 700 comes from the unlayered
   `.main-head h3` rule, not `font-bold` (outranked by the unlayered global heading rule). Without the twin both
   titles would drop to 600. The twin is exact (same declarations, straight after its rule), and the runtime and
   screenshots prove it: 700 / 19 px, the same box, byte-identical pixels.
2. **The error boundary has no runtime route** — proven statically, by an isolated component render, and by
   rendering its exact markup into the built app's `<main>` (h3 vs h1 pixel-identical, equal to C6's build's).
3. **Five families have no seeded record** — TEST-only drafts in the run's copy (above); no lifecycle change.

## Corrections made during C7's own verification

Each found by C7's own gates, each in C7's new verification code, each a strengthening or a fix — never a
relaxation of a check:

1. **The static pin on the document-form verifier** missed mutation M21 in the first static run (the C7 assertion
   widened to accept `h1 | h3`): the pin undid the whole C7 block before hashing, so a change *inside* the block was
   invisible. The C7 block is now pinned byte for byte too (`31abd69fc9ff1552`); M21 is caught.
2. **The harness's `c7-draft` assertion** required a `<form>` the editors do not have, and stopped the first C6
   capture at the first draft edit page. It now requires the page at its own path and the titlebar with its
   DocTopActions (tag-agnostic); both sides were re-captured with it (see "Screenshots").
3. **The runtime verifier's C7 summary print** crashed when a page had no title heading (RT6's first run). It is
   null-safe now and prints the same lines when the titles exist; RT6 is caught by its checks, and the final runtime
   run is on that tree.

## Deferred (not C7)

* The DataTable saved-view focus race (C5 / C6, pre-existing): carried to C8 — C8 may not close DEV-UI-01.7 while
  it is unresolved; it must bring either a separately reviewed synchronization fix or an approved deterministic
  final-tier protocol (§39). C7 does not touch the suite, the toolbar, saved views or Radix focus.
* The error screen's translation, other app-state wording, the streamed not-found's HTTP status and loading
  boundaries (§42).
* From C5 / C6, unchanged: `--warn` / `--crit` / `--good` defined in no stylesheet (Security's alert stripe).
