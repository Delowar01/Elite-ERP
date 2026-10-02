# DEV-UI-01.2 — Status Registry (implementation record)

One authoritative, translated, domain-aware status presentation. **No stored value, lifecycle
transition, settlement, inventory, payroll or permission logic changed.**

| File | Content |
|---|---|
| `status-matrix.md` | Every domain and value: tone, pulse, English label, i18n key, Arabic — generated from the registry. |
| `screenshot-change-report.json` | Every one of the 256 states vs. the merged DEV-UI-01.1 state. |
| `guardrails-after.json` | Report-only guardrails after this batch. |
| `../../../tests/ui-baseline/candidates/dev-ui-01-2/` | Candidate screenshots. The approved DEV-UI-01.0 `baseline/` and the 01.1 candidate are untouched. |

## Architecture

* **`src/lib/status-registry.ts`** — pure (no React, DB or I/O). 25 domains, 74 entries. Each entry
  separates the raw value (object key), English `label`, Arabic `i18nKey` (owned per entry, never
  derived from the raw value), `tone` and `pulse`. `resolveStatus()` never throws: an unknown value
  is neutral with a readable label (`on_credit_hold` → "On credit hold"). `statusLabel()` — English
  from the registry; Arabic via `t()` on the entry's key, falling back to the English label (never
  a raw snake_case value).
* **`<StatusBadge domain status locale />`** — the only status renderer. No `variant`, tone or pulse
  prop: the registry decides. Emits `data-status`, `data-status-domain`, `data-tone`. Optional
  presentational extras only: `className`, `icon` (ZATCA lock), `detail` (stale-rate age).
* **`.status-tag`** (globals.css) — 4px radius, logical padding (RTL), caption size, weight 500, no
  leading dot, no gradient / shadow / transform, tone via the approved DEV-UI-01.1 tokens. A small
  pulse indicator only for registry `pulse` states (leave pending, payroll period awaiting a run).
  **Generic `.pill` / `<Badge>` is not converted** (Default, document type, access level, role,
  payment direction, journal source, priority, billable stay as they were); `<Badge>` only gained a
  `corrective` variant on the existing `--corrective` tokens.
* **Dashboard invoice legend + donut** — colour and label from `invoice_settlement` in the registry;
  the page makes no colour decision of its own.

## Locked semantics (pinned by `verify:status-registry`)

Changes from the previously shipped presentation: credit/debit note `issued` danger/success
(inconsistent) → **corrective**; CN/DN `reversed` unmapped → **neutral**; DC `dispatched` warning →
**info**; employee-card `on_leave` warning → **info**; dashboard Partial purple → **warning**,
Pending orange → **info**; document detail tags no longer pulse (pulse only on leave pending and
payroll period draft). All other tones are unchanged.

## Translation

20 dedicated `status.*` keys added to `dict.ts` (additive; no existing entry changed): archived,
deleted, overdue, partial, invoice_pending, todo, in_progress, blocked, done, present, late,
on_leave, absent, severity_info / low / medium / high / critical, low_stock, in_stock. Existing
status-sense snake_case keys (`partially_paid`, `void`, `issued` …) are reused, so the Arabic shown on
document screens is unchanged. The ambiguous title-case keys (Unpaid, Received, Paid, Void, Pending,
To Do) are never used.

Visible text changes, intentional:

* **English** now shows labels instead of raw stored strings everywhere a status is shown
  (`partially_paid` → "Partially paid", `void` → "Void", `on_hold` → "On hold").
* **Arabic, dashboard legend only**: Paid المدفوع → مدفوع, Partial جزئي → مدفوع جزئيًا, Pending
  معلّق → بانتظار السداد, Overdue متأخر → متأخر السداد — the previous words came from ambiguous
  title-case keys (column-header sense; "معلّق" also means *on hold*; "متأخر" also means *late*).
* Clients / vendors / products "Active", "Inactive", "Archived", "Low stock", "In stock" and security
  severity were hard-coded English or raw; they are now translated.

## Migrated call sites

* The 19 G4 page-local maps: quotation, sales order, proforma, sales invoice, delivery challan,
  credit note, debit note and purchase order (list + detail each); attendance; leave; projects list.
* Also: employee cards (today's attendance + inactive) and employee detail; payroll period and run;
  kanban Done; clients, vendors, products (list + detail: active flag, archived, stock); bank
  accounts and team (active flag); payment-history Reversed (English stays exactly "Reversed");
  recycle bin; security severity; project health; compliance consent; ZATCA; exchange-rate stale;
  project detail meta pill and linked-document statuses; cost-control drill statuses.
* Labels only (values and transitions unchanged): quotation, sales order and delivery challan status
  `Select`s; the list-workspace status filter.
* Three server pages now read the locale (`getLocale()`) to translate their tags: vendors list,
  product list, product detail.

## Guardrails

| | Before (DEV-UI-01.1) | After |
|---|---|---|
| G1 | 204 | 204 |
| G2 | 358 | 358 |
| G3 | 56 | 56 |
| G4 | 20 | **0** |
| G5 | 30 | 30 |

G4: the detector now knows the full vocabulary (incl. `dispatched`, which it missed) and excludes
exactly one file, `src/lib/status-registry.ts` — the canonical registry is a status→tone map by
design. Generic priority words (low / medium / high) are not in the vocabulary, so the kanban
priority attribute map is not mistaken for a status map. `verify:status-registry` independently
fails on any local status map, status-driven `<Badge>` variant, raw `pill-<tone>` class or raw
`t(locale, x.status)` label.

## Explicit exclusions (not fixed here)

* Security risk `RISK_STYLE` references undefined `--good / --warn / --crit` — pre-existing, tracked
  separately, unchanged.
* Products toolbar "Low stock ×" filter chip — a filter control, not a status tag; still English.
* Cost-control payment / journal drill rows show pseudo-states (received / paid / posted) that are
  not registry statuses; they keep their plain translated text.
* List exports (CSV / Excel / PDF) still write the raw stored status — data export, not UI.
* Categorical attributes outside the registry: payment direction, team role, access level, journal
  source type, document type, priority, Default, billable.

## Verification summary

* `verify:static` 13/13 suites (incl. `verify:status-registry` 53/53, contrast 159/159, typography
  43/43), on a disposable TEST-ONLY database. The new suite was mutation-tested (local map
  reintroduced, tone changed, Arabic key removed, tag radius 999px, pulse added to `paid`,
  status-driven `<Badge>` variant) — each fails it.
* Screenshots: two independent captures (fresh build + DB copy each) 256/256 byte-identical. vs the
  merged DEV-UI-01.1 state: 114 changed, 4 anti-aliasing noise only, 138 identical; 0 overflow
  changes, 0 non-200, 0 new console errors, React #418 40 → 40.
* Browser tier (42 suites, isolated worktree, TEST-ONLY database, Chromium path set): 41/42 in the
  full run; the failure was `verify-proforma-payments` ("Invoice detail shows payment history").
  Re-runs: branch 17 pass / 2 fail of 19, approved main 17 / 0 of 17. The suite reads the invoice
  page immediately after a client-side `waitForURL`, which races the render: a probe measured the
  identical navigation-to-render time on both builds (median ≈ 390 ms) and found the content absent at
  that instant in 14–15 of 15 navigations on BOTH. Pre-existing timing race in the suite, not a
  DEV-UI-01.2 change; the suite was not modified.

---

## DEV-UI-01.2-C1 — complete status label and tone centralization (correction)

Review of `dd728ee` found status labels and tones still decided outside the registry: list-page KPI
stat rows (`t(locale, "draft")` labels showing the raw English value, `dispatched` hand-coloured
warning, credit/debit `issued` hand-coloured success), status selectors / forms using
`t(locale, s)`, and the task kanban labels. C1 closes all of them. **Registry semantics are
unchanged** (same 25 domains / 74 entries / tones / pulse / keys; `status-matrix.md` is unchanged).

### One tone → text-class map

`STATUS_TONE_TEXT_CLASS` in `status-registry.ts` — the only tone → text-class mapping, static class
names (`text-neutral` … `text-corrective`, all existing `@theme inline` colours). Helpers:
`statusTextClass(domain, raw)` and `statusStat(locale, domain, raw, count)` (registry label + tone +
class, plus `data-status-domain` / `data-status` / `data-tone` on the rendered `StatRow` card).
Neutral renders as `text-neutral` (a stat no longer silently inherits ink while its tag is neutral).

### Corrected stat rows (label via `statusLabel`, tone via the registry)

| Page | Stats | Visible change |
|---|---|---|
| Quotations | accepted · sent · draft | EN `accepted/sent/draft` → `Accepted/Sent/Draft`; draft count neutral |
| Sales orders | confirmed · fulfilled · draft | EN capitalised; draft neutral |
| Proforma | sent · draft | EN capitalised; draft neutral |
| Sales invoices | paid · sent · draft | EN capitalised; draft neutral |
| Delivery challans | delivered · dispatched · draft | `dispatched` warning → **info**; EN capitalised; draft neutral |
| Purchase orders | received · ordered · draft | EN capitalised; draft neutral |
| Credit notes | issued · draft | `issued` success → **corrective**; EN capitalised; draft neutral |
| Debit notes | issued · draft | `issued` success → **corrective**; EN capitalised; draft neutral |
| Projects | active · completed · planned | EN capitalised; planned neutral |
| Dashboard · HR snapshot | present · on_leave · absent | On leave warning → **info**; Absent danger → **neutral** (registry); EN "On Leave" → "On leave" |
| Dashboard · project overview | completed · active · on_hold · planned | now registry labels + tones: "In Progress" → "Active" (قيد التنفيذ → نشط), "On Hold" → "On hold", "Not Started" → "Planned" (لم يبدأ → مخطط); previously uncoloured |
| Employees · KPI cards | present today · on leave | On leave warning → **info**; colours via the map (Present unchanged: `--accent-green` = `--success`) |

Non-status stats (Total …, This Month, Headcount, Departments, payroll totals) are unchanged.

### Corrected selectors, forms, filters and labels

* Project status select (`projects/[id]/project-status-select.tsx`) and project form — `statusLabel(locale, "project", s)` (EN was raw `on_hold`).
* Employee form Active / Inactive — `statusLabel(locale, "employee", …)` (EN was raw `active` / `inactive`). Option values unchanged.
* Proforma detail status select **and** its confirmation detail — `statusLabel(locale, "proforma_invoice", …)`.
* Quotation, sales-order and delivery-challan status-change confirmation details (the selects were done in `dd728ee`; the confirmation dialog still printed the raw value).
* List-workspace status filter — the `t(locale, s)` fallback is gone; `module` is typed `DocumentType`, every one of which is a registry domain.
* Task kanban column headers and the task status select — `statusLabel(locale, "task", …)` ("To Do" → "To do", "In Progress" → "In progress"; Arabic "To Do" قيد الانتظار → للتنفيذ, the registry's unambiguous key). Column order, drag/drop, workflow and priority presentation unchanged.

### Exhaustive sweep (every `.tsx`)

An AST pass listed every `t()` call whose key is not a literal (146 before C1, 136 after) plus literal
raw-status keys, status arrays, KPI rows, Select / `<option>` lists, legends and hard-coded English.
Every status bypass is fixed above. Remaining dynamic keys were reviewed and are outside the
registry by design: priority, role, access level, payment method / direction, document / source
type, journal source badge, leave type, Default, billable, report / range / bucket names, form field
labels, compliance control *implementation* notes (`STATE_LABEL`: implemented / verified — not a
record status), the list "Archived" filter phrases ("Active only" / "Archived only" — filter modes,
not status labels), the totals-strip "Paid" amount rows (money, not a status), security risk pill
(`RISK_STYLE`, excluded earlier), and the cost-control pseudo-state fallback documented above.

### `verify:status-registry` hardening (53 → 88 checks)

Reusable AST rules over every `.tsx`:
**R1** an array of registry values (strings or objects carrying them) mapped through raw `t()` on the
callback parameter; **R2** a raw stored value used as a `t()` key (`t(locale, "dispatched")`);
**R3** a status label paired with a hand-picked semantic colour (object `label`+`colorClass/color`,
or a JSX element with a semantic `style.color` around a status label); **R4** any `StatRow` item with
a hand-written `colorClass`; plus "no second tone → text-class map". Explicit coverage: project
status select, project form, employee form, proforma / quotation / sales-order / DC detail selects
and confirmations, list workspace filter, task kanban labels + select + column order, dashboard HR
and project rows, employee KPI cards, and all nine list stat rows (domain, statuses, order).
Mutation-tested: reverting each of the 11 corrected files to `dd728ee` fails the suite, as do 7
synthetic mutations (new status array via `t()`, object option list, coloured status stat, second
tone map, coloured `StatRow` item, tone-map edit, `dispatched` tone edit).

### C1 verification

* TypeScript 0 errors; ESLint clean on `src/` and every changed file (the repo-wide 11 errors /
  22 warnings are in untouched legacy test / verify scripts).
* `verify:static` 13/13 suites on a disposable TEST-ONLY database (status registry 88/88, contrast
  159/159, typography 43/43). `npm run build` passes with TEST-ONLY environment values (11
  pre-existing Turbopack tracing warnings, all in untouched `src/lib/storage/*` code).
* Guardrails: G1 204, G2 358, G3 56, **G4 0**, G5 30 — unchanged (`guardrails-after.json`).
* Screenshots: two fresh captures 256/256 byte-identical. vs `dd728ee`: 96 changed (dashboard,
  employees, project detail, projects list, invoices list, quotations list — 16 states each), 160
  identical; 0 height or overflow changes, 0 non-200, 0 other console errors, React #418 40 → 40.
  `screenshot-change-report.json` now carries a per-state `c1VsDd728ee` block. The kanban column
  headers are CSS-uppercased, so the English case change ("To Do" → "To do") is not visible; the
  Arabic header change is.
* Browser tier (isolated worktree, TEST-ONLY database, Chromium path set): 42/42 suites passed in
  one full run, `verify-proforma-payments` included (a single run; it remains a known pre-existing
  timing race and was not modified).

### Vercel preview failure (read-only investigation)

No authenticated Vercel CLI or token is available, so deployment logs could not be read. Commit
statuses (public GitHub API) show every preview-branch commit failing and every `main` commit
succeeding — including commits whose trees are byte-identical: `7954f75` (preview, failed) and
`f785c13` (main, succeeded) share tree `6085f3b`; `192c6b5` (preview, failed) and `a9d6b60` (main,
succeeded) share tree `46aae63`. Identical code fails only as a preview, so the cause is the Vercel
preview environment / configuration (most likely preview-scoped environment variables), not
DEV-UI-01.2 code; the local production build passes. Nothing was deployed or changed in Vercel.
