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
