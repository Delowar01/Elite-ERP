# DEV-UI-01.7 C4 — Finance + reports

Parent: C3 `65e12d60a6572cccea3e31ca949a0c8ca5a30ec9` (tree `025f5b41182ddaaa144edb3fab5a64605a86a06f`),
on C2 `c060e8b`, C1 `8768cb2`, C0 `6ad311b`, main `1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50`.
Branch `claude/dev-ui-01-7-page-archetypes`; C4 is one commit on C3. Nothing is merged to main.
C4 first stopped uncommitted: the frozen P0 hydration suite could not open Record Payment through C4's
Payments `PageHeader`. After independent review the one-line selector maintenance was approved, made, and
every gate re-run green (see "P0 suite: the stale selector — blocker, approved maintenance, result").
**DEV-UI-01.7 C5 has NOT started.**

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases on
127.0.0.1, with no repository `.env` (the browser tier's runner reads a temporary `.env` that points only
at its own TEST-only database and is deleted afterwards). Builds are normal, unmocked `next build`s.
Nothing touched production; nothing was deployed; no package, environment or configuration changed.

## Scope — the finance / reports family

| Route | File(s) (`src/app/(app)/finance/…`) | C4 change |
|---|---|---|
| `/finance/reports` (pl, bs, cf, tb, gl, ar, ap, vat) | `reports/reports-workspace.tsx` | `.main-head.no-print > h3` → `PageHeader` "Financial Reports" in a `div.no-print`, CSV / Excel / PDF as its actions (same `exportUrl(…)` links, labels, styling); the eight picker buttons gain `aria-pressed={r.kind === report}`; the search gains `aria-label={t(locale, "Search…")}`; the report title → `SectionHeader level={2}` with the range as its description. Report bodies, presets, dates, compare, GL account select, drill-down, print styles untouched |
| `/finance/statements` (client / vendor, with and without a party) | `statements/page.tsx` | `.main-head h3` + paragraph → `PageHeader` (title + the full existing description); Client / Vendor stay `<a>` links with `aria-current={kind === … ? "page" : undefined}`. `StatementView` untouched |
| `/finance/ledger`, `/finance/chart-of-accounts` | `ledger/page.tsx`, `chart-of-accounts/page.tsx`, `_shared/account-ledger-view.tsx` | `.main-head h3` → `PageHeader`; the selected account → `SectionHeader level={2}` (code · name, monospace; normal-balance caption as description; Balance org-pill as meta); "Select an account to view its ledger." and "No transactions yet." → `EmptyState`; `.acct-grid` shrink-safe (below) |
| `/finance/payments` | `payments/payments-list-client.tsx` | `.main-head h3` → `PageHeader` "Payment Records" with Record Payment (same dialog, props, trigger) as its action; "No payment records yet." → `EmptyState` |
| `/finance/journal` | `journal/page.tsx` | `.main-head h3` + Manual pill → `PageHeader` (Manual as meta); "Recent journal entries" h3 → `SectionHeader level={2}`; "No journal entries yet." → `EmptyState`. `JournalForm` untouched |
| `/finance/bank-accounts` | `bank-accounts/page.tsx` | `.main-head h3` → `PageHeader` "Bank Accounts" with New Account (same dialog) as its action; "Recent payment records" h3 → `SectionHeader level={2}`; "No bank accounts yet." (mb-6 kept) and "No payment records yet." → `EmptyState`. Account cards (kpi-chip, weight 800, StatusBadge, edit dialog) untouched |

Shared: `src/app/(app)/mockup-parity.css` — the two `.acct-grid` rules only. `src/lib/i18n/dict.ts` did
not change: every C4-visible key already had Arabic (the report search uses the existing "Search…" →
"بحث…"; adding "Search" would have translated StatementView's deferred label, which C4 must not do).

## Changed files

| File | Change |
|---|---|
| the eight finance files above | markup only — the static verifier proves each is C3's code plus exactly C4's 32 hunks |
| `src/app/(app)/mockup-parity.css` | the two `.acct-grid` rules (desktop and ≤1100px) on `minmax(0, 1fr)` |
| `verify/verify-page-archetypes.mts` | C4 group 12 (28 checks; its P0 pin moved `6eec53fc9d09c6d6` → `a226b47188ddf478` with the approved selector); groups 6 / 9 / 10 / 11 adjusted to C4's consumers and the `.acct-grid` move |
| `verify/verify-ar-locale-hydration.mjs` | **approved P0 maintenance** — exactly one line: the Record Payment trigger selector `.main-head button` → `[data-slot="page-header-actions"] button` (see the P0 section below) |
| `verify/page-archetype-pins.json` | consumer inventory only (+17 lines) |
| `verify/verify-page-archetypes-runtime.mjs` | three new finance routes (47 routes), `--only` lists, `--rebaseline` adding a named new route, C4 targets, the ledger / chart gate, the value pass and its `c4ref` record (`--write-c4ref`), the report-picker / statement-link / empty-state probes, `aria-current` in the action states, C4's intended action states |
| `verify/page-archetype-runtime-baseline.json` | the 14 finance routes' 112 owner states re-recorded (24 of them new), the new routes' 6 Staff / 6 sweep entries, `c4ref` added (measured on C3's build); every other entry, `d6` and `c3ref` unchanged |
| `verify/page-archetype-actions.json` | 30 existing lists (18 owner + 12 Staff) gain only the new states — each picker button `pressed=true` / `false`, the shown statement link `current=page`; 15 lists added for the three new routes (9 owner + 6 Staff; recorded on C3's build, then with the same states); 190 lists untouched |
| `tests/ui-baseline/archetype-states.mjs` | four C4 states (P&L, vendor statement, Chart of Accounts, ledger with no account) and two C4 interactions |
| this document | |

Not changed (guarded): `src/lib/finance-reports.ts`, `statements.ts`, `accounting.ts`, `settlement.ts`,
`src/lib/currency/**`, `src/db/**`, `drizzle/**`, both export routes, every finance server action,
`statement-view.tsx`, `journal-form.tsx`, `add-account-dialog.tsx`, `record-payment-dialog.tsx`,
`bank-account-form-dialog.tsx`, `src/lib/i18n/dict.ts` (1,746 keys, no duplicate), the P0 number-locale,
P0.1 and P0.2 verifiers. `verify/verify-ar-locale-hydration.mjs` is C3's approved reconstruction plus only
the approved one-line selector — its streamed-segment reconstruction and every assertion untouched.

## Heading hierarchy

```
/finance/reports[?report=…]        h1 Financial Reports
                                     h2 Profit & Loss | Balance Sheet | Cash Flow | Trial Balance | General Ledger | AR Aging | AP Aging | VAT Summary
/finance/statements[?kind=…&party=…] h1 Client & Vendor Statements
/finance/ledger                    h1 Account Ledger
                                     h2 1000 · Cash        (the selected account: code · name; absent when none is selected)
/finance/chart-of-accounts         h1 Chart of Accounts
                                     h2 1000 · Cash
/finance/payments                  h1 Payment Records
/finance/journal                   h1 New Journal Entry
                                     h2 Recent journal entries
/finance/bank-accounts             h1 Bank Accounts
                                     h2 Recent payment records
```

Arabic: التقارير المالية › الأرباح والخسائر … / كشوف حساب العملاء والموردين / دفتر الأستاذ › 1000 · النقد /
دليل الحسابات › 1000 · النقد / سجلات الدفع / قيد يومية جديد › أحدث قيود اليومية / الحسابات البنكية › أحدث سجلات الدفع.
C3 had every one of these titles as an h3 (no h1), and the selected account as a styled `div`. No h3 was
added inside a report body; the shell's "Account Reporting" title is not the page's h1 (deferred mismatch).

## Reports

* **PageHeader.** `<div className="no-print"><PageHeader title={t(locale, "Financial Reports")} actions={…} /></div>`.
  `PageHeader` takes no `className` from a consumer (C1's guard), so the old `.main-head.no-print` class
  sits on a wrapper holding only the header: print hides it exactly as before (`@media print { .no-print
  { display: none } }`, unchanged in `PrintStyles`). The actions are the three existing anchors —
  `exportUrl("csv" | "xlsx" | "pdf")`, labels CSV / Excel / PDF, `doc-pill-btn` styling — in their
  `doc-pill-btn-group`; `exportUrl` (report, from, to, format, account) is unchanged.
* **Picker.** `<button key={r.kind} type="button" className={r.kind === report ? "tab active" : "tab"}
  aria-pressed={r.kind === report} onClick={() => setParams({ report: r.kind, account: undefined })}>` —
  `aria-pressed` is the `.active` condition itself, so exactly one is pressed. Order, labels and query
  values (`REPORTS`) unchanged; still buttons (no Tabs), same routing.
* **Search.** `aria-label={t(locale, "Search…")}` — the placeholder's own words ("Search…" / "بحث…");
  value, onChange and filtering unchanged.
* **Report h2.** `` <SectionHeader level={2} title={title} description={`${range.from} → ${range.to}`} className="mb-3" /> ``
  — outside every `.no-print`, so the title and range still print.
* **Unchanged (pinned):** `REPORTS`, `exportUrl`, `title`, `ymd`, `fyRange`, `monthRange`, `quarterRange`, the
  six presets, `BUCKET_LABELS`, `PnlView`, `BsView`, `CfView`, `TbView`, `GlView`, `AgingView`, `VatView`,
  `Cards`, `Row`, `Num`, `GroupLabel`, `ExcludedNote`, `sourceLabel`, `DrillDrawer`, `PrintStyles`,
  `inSearch`, `cell`, `setParams`, `openDrill` — each C3's to the canonical character.

## D-2 — held, not decided

The P&L still shows Gross Profit — its summary card (`d.grossProfit`, delta against the previous period)
and its final row between Cost of Sales and Operating Expenses — as `finance-reports.ts` computes it
(`const grossProfit = revenueTotal - costOfSalesTotal;`, byte-pinned). No arithmetic was added to the
workspace; every report body is C3's. COGS, Gross Profit and Project Profit / Margin are not reinterpreted.

## Statements

`PageHeader` title "Client & Vendor Statements", description the full existing sentence. The Client /
Vendor links keep `href="/finance/statements?kind=client"` / `"?kind=vendor"`, `.tab` / `.active`, and gain
`aria-current={kind === "client" | "vendor" ? "page" : undefined}` — the same condition as `.active`; the
inactive link has no `aria-current`. `StatementView` gets the same props and is byte-identical (its
"Search" / "Document type" Arabic gaps stay deferred).

## Ledger / Chart of Accounts — `.acct-grid`

Before (C3):

```css
.acct-grid { display: grid; grid-template-columns: 280px 1fr; gap: 16px; }
@media (max-width: 1100px) { … .acct-grid { grid-template-columns: 1fr; } }
```

After (C4):

```css
.acct-grid { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; }
@media (max-width: 1100px) { … .acct-grid { grid-template-columns: minmax(0, 1fr); } }
```

`1fr` keeps an automatic minimum of its content's min-content width, so the ledger table (≈473px at
390) widened the single track and the page with it. `minmax(0, 1fr)` lets the track shrink to the
viewport; the table then scrolls inside its own `.data-table-wrap` (`overflow-x: auto`). The 280px
account list on desktop is kept; `.two-col`, `.stat-row-2`, `.cost-breakdown-grid`, dashboard, Settings,
document and print CSS are untouched (the stylesheet is C3's plus exactly these two edits).

## Account ledger view

* Selected account: `SectionHeader level={2}` — title `<span className="mono">{code} · {accountName(locale, account)}</span>`,
  description the normal-balance caption (`NORMAL_BALANCE_CAPTION[type]` through `t()`), meta the Balance
  org-pill (`<Money amount={balances.get(id) ?? 0} context="summary" />`), outside the h2.
* No account selected (`?account=` an id no account has, or an org without accounts): `EmptyState`
  "Select an account to view its ledger."; an account without transactions: `EmptyState` "No transactions
  yet." — the same messages, no hint, no action.
* Unchanged: the account list (groups, rows, `<basePath>?account=<id>` links, balances formatted with
  `DISPLAY_NUMBER_LOCALE`), Add Account in the list card, the ledger table (Date, Memo, Source badge,
  Debit, Credit, running Balance via `formatMoneyNumber`), `TYPE_ORDER`, `TYPE_LABEL`,
  `NORMAL_BALANCE_CAPTION`, `SOURCE_BADGE`, both pages' data sections (session, account list, balances,
  selected account, `getAccountLedger`).

## Payments, Journal, Bank Accounts

* Payments: `PageHeader` "Payment Records", actions = `RecordPaymentDialog` (locale, currency, base
  currency, bank accounts, outstanding invoices / POs, the same Button trigger). Empty: `EmptyState` "No
  payment records yet.". Table, links, receipt download, loading boundary unchanged; dialog byte-identical.
* Journal: `PageHeader` "New Journal Entry", meta = the Manual org-pill. "Recent journal entries" →
  `SectionHeader level={2}` (`mt-10 mb-[22px]`, the old 40px top). Empty: `EmptyState` "No journal entries
  yet." `JournalForm` byte-identical — its `div[role=button]` Add line and six unnamed line inputs stay
  for DEV-UI-01.8.
* Bank Accounts: `PageHeader` "Bank Accounts", actions = `BankAccountFormDialog` (New Account). "Recent
  payment records" → `SectionHeader level={2}` (`mt-1 mb-[22px]`). Empty: `EmptyState` "No bank accounts
  yet." (`className="mb-6"`, the old spacing) and "No payment records yet.". Cards — kpi-chip, balance at
  weight 800 (sweep deferred), active_flag StatusBadge, per-card edit dialog — and the dialog unchanged.

`EmptyState` boundary: no `TableEmptyRow`, report zero rows, `ReportBodySkeleton`, filtered no-match row
or `ListEmptyState` was replaced; no CTA invented.

## Report value equality (§47) and statement equality (§48)

The reference was measured on C3's own build — the exact 65e12d6 tree in its own worktree (build
`Gt4KJ5YigdnmoqtnTsRgE`, src clean) — with `--write-c4ref`, before C4's re-record, and stored as the
baseline's `c4ref` record (88 entries; a trial recording minutes earlier was identical, entry for entry).
Every C4 run reads the same cases and compares them field by field:

* the default route and the eight reports (pl, bs, cf, tb, gl, ar, ap, vat); P&L, Balance Sheet, Cash Flow
  and VAT with `compare=1`; the General Ledger of the Cash account (`account=1`); a custom-range Trial
  Balance (`2026-04-01` → `2026-06-30`) — EN / AR at 1440 and 390: the picker (labels, the active one), the
  presets (the active one), the From / To values, the compare toggle, the title and range, every line of
  the body, every figure, the row counts (P&L / BS / CF / VAT lines, table rows, tables), every summary
  card (value, ▲/▼ delta, Balanced badge), every drill target (its row's label and amount), the CSV /
  Excel / PDF links;
* a search by account code (P&L `4000`, Trial Balance `1100`) and the first drill-down (a P&L figure, a
  Trial Balance row — the drawer's title and every transaction line);
* the client and vendor statements with a party (client 1, vendor 1) and without — the Client / Vendor
  links, the party, every line, filter, date and table row (opening balance, transactions, debit / credit,
  running balance, closing) — and after a from-date filter (`2026-04-01`, through StatementView's server
  action).

Result: **0 differences** in every C4 run (the re-record and the final run). The picker probe holds the
switched reports to the same record; the statement-link probe holds the no-party pages to it.

## Action inventory (C3 → C4)

No action added, removed, renamed or retargeted. The only deltas are the two intended states:

* report picker: each of the eight buttons now says `pressed=true` (the report shown) or `pressed=false` —
  25 lists (reports-pl / tb / ar / gl / vat × owner EN 1440, EN 390, AR 1440 + Staff EN / AR; reports-vat's
  five new);
* statement links: the shown kind's link says `current=page` — 20 lists (statements, statement-client1,
  statements-vendor, statement-vendor1 × the same five; the two vendor routes' ten new).

With the state field set aside, the 30 changed lists are C3's entry for entry (0 other differences); the
re-record's equivalence check held all 45 to the lists it replaced (the 15 new ones as recorded on C3's
build) — "C4's intended states only". C3's own states (`hr-employees`, 20 actions) are unchanged.
Ledger, Chart of Accounts, Payments, Journal and Bank Accounts: identical lists. Export links, preset
buttons, the compare checkbox, Record Payment, New Account, Add Account, party / filter selects,
statement downloads: unchanged targets, types and states. Staff land where they did on every route.

## Static verifier — `verify:page-archetypes` group 12 (C4)

164/164 (group 12: 28). What group 12 holds:

* **Nothing moved but C4's hunks.** Each of the eight finance files is C3's code (65e12d6, comments and
  whitespace aside) plus exactly C4's 32 hunks — undo them and its flat hash is C3's (reports-workspace
  `9946c303e75623c5`, statements `7ef5a6c85d73cdd8`, ledger `79071e80c15da606`, chart `6211116fd0b433c2`,
  account-ledger-view `1d1018174ed5a9e0`, payments client `3c011f016799cc8e`, journal `defe59b72f776bbb`,
  bank `ffe227e2e1e2b32f`). `mockup-parity.css` is C3's plus exactly the two `.acct-grid` edits.
* **Byte pins:** the other 14 finance files at their C3 hashes (StatementView, JournalForm, the account /
  payment / bank-account dialogs, payment history and its three buttons, reports and payments pages, three
  loading boundaries); every finance file is one of the eight, one of these, or a business pin. The P0 /
  P0.1 / P0.2 verifiers — `verify-ar-locale-hydration.mjs` `a226b47188ddf478` (C3's approved
  reconstruction plus the approved one-line selector; it was `6eec53fc9d09c6d6`; any further byte fails
  it), the settings-time-zone and business-date hydration suites, number-locale, date-timezone,
  business-dates at their C3 hashes — and `dict.ts` `796829703fc96bf4`.
* **Business / data:** `finance-reports.ts`, `statements.ts`, `accounting.ts`, `settlement.ts`,
  `src/lib/currency/**`, `src/db/**`, `drizzle/**`, the six finance server-action modules and both export
  routes still their business pins; the seven finance pages' data sections, guards and static action
  inventories the pinned ones (no presentation statement moved out of the markup).
* **Reports:** `REPORTS`, `exportUrl`, `title`, `BUCKET_LABELS`, `ymd` canonical; `fyRange` / `monthRange` /
  `quarterRange` / presets and every report body and helper canonical-hash identical; the PageHeader
  slots exact and its `div.no-print` wrapper; the picker's `aria-pressed` is the `.active` condition, with
  nothing else on the buttons; the search's `aria-label` its placeholder's `t(locale, "Search…")`; one
  `SectionHeader` h2, outside every `.no-print`; D-2 (the Gross Profit card and row, `grossProfit =
  revenueTotal - costOfSalesTotal` in the pinned library).
* **Statements:** PageHeader title + the full description; two `<a>` links, hrefs unchanged,
  `aria-current` = the `.active` condition; StatementView's element unchanged.
* **Ledger / chart:** exactly the two `.acct-grid` rules (280px + `minmax(0, 1fr)`; `minmax(0, 1fr)` at
  ≤1100px), the grid element with `className="acct-grid"` and nothing inline, the only inline grids in a C4
  file the report Cards' own; the selected-account `SectionHeader` slots; `TYPE_ORDER`, `TYPE_LABEL`,
  `NORMAL_BALANCE_CAPTION`, `SOURCE_BADGE` and the account links unchanged.
* **Payments / journal / bank:** PageHeader slots (Record Payment / Manual / New Account), the two h2
  `SectionHeader`s with their spacing, the six `EmptyState`s (exact messages; the bank one's `mb-6`), the
  old muted `<p>` / card recipes gone, `ReportBodySkeleton` kept, `JournalForm` element unchanged, the bank
  cards' kpi-chip and weight 800 kept, the one active_flag `StatusBadge`.
* **Copy / direction / creep:** every `t()` key in the eight files (and every label shown through a map:
  report names, presets, aging buckets, account groups and captions, payment methods) has Arabic — the
  ledger's "Expense" source badge excepted (C3's, for a source type nothing posts); no physical left / right;
  no FinancePageLayout / FinanceLayout / FinanceShell / ReportLayout / ReportHeader / AccountPageShell, no
  finance layout or template.

Groups 6 / 9 / 10 / 11 adjusted to C4's consumers — nothing loosened: group 6 SectionHeader / EmptyState
consumers include C4's four / six; group 9 PageHeader consumers are 29 (12 + 7 + 3 + 7); group 10's
`.acct-grid` assertion moved to group 12 with C4's values (`.two-col` still exactly held); group 11's
"stylesheet is C2's plus C3's additions" undoes C4's two `.acct-grid` edits first (group 12 proves they are
its only edits). `verify/page-archetype-pins.json`: consumer inventory only (+17 lines: 4 SectionHeader,
6 EmptyState, 7 PageHeader).

## Runtime (C3 → C4)

`npm run verify:page-archetypes-runtime` (`node verify/verify-page-archetypes-runtime.mjs`) on C4's final
tree — the approved P0 selector included — on its own fresh normal build `4l5NxGDk6eX4WWbO1OHy6`:
**100/100 PASS** (exit 0), as on the pre-maintenance tree (`YSa_GKdPLYzknMkl1CcON`, 100/100) — 47 routes,
376 owner states (EN / AR × 1440 / 1024 / 768 / 390), 94 Staff, 94 Pacific/Pago_Pago sweep; zero React #418
in all 564; owner action inventory 1,371 and Staff 896 actions unchanged against the C4 baseline; C1 (7),
C2 HR (14), D-6 (10) and C3 Projects / kanban (20) checks green. No rebaseline after the maintenance. The
baseline's finance entries were re-recorded with
`--rebaseline=<the 14 finance routes>` on its own fresh build (101/101 — the extra check is the
re-record's action-equivalence check), after the three new routes had been recorded on C3's build
(`--rebaseline=reports-vat,statements-vendor,statement-vendor1` on the exact 65e12d6 build). Two C4
builds (`jgaxgdS84KZQC6sz6pS_k`, `YSa_GKdPLYzknMkl1CcON`) measured identically — every finance state,
ledger fact and value-pass entry. Every other route, Staff, sweep, `d6` and `c3ref`: unchanged.

| measure (owner, EN / AR × 4 widths) | C3 | C4 |
|---|---|---|
| h1 on the 14 finance routes | 0 (titles were h3) | 1 |
| h2 | 0 | selected report / selected account / Recent journal entries / Recent payment records |
| heading skips | 0 | 0 |
| overflow · elements past · tables beyond, Ledger / Chart at 390 | 139 px · 2 · 1 (EN), 122 px · 2 · 1 (AR) | 0 · 0 · 0 |
| overflow on every other finance state | 0 | 0 |
| unnamed controls, reports (5 routes) | 1 (the search) | 0 |
| unnamed / pointer-only, New Journal Entry | 6 / 1 (JournalForm) | 6 / 1 (JournalForm, deferred) |
| console / page errors, React #418, Arabic-Indic digits | 0 | 0 |
| Staff (14 routes) | 200 where they are | 200 where they are |

### Ledger / Chart of Accounts gate (measured tracks)

| width | C3 tracks · panes · Add Account | C4 tracks · panes · Add Account | overflow C3 → C4 |
|---|---|---|---|
| 1440 | 280px + 812px · side by side, both in · in, hit | 280px + 812px · side by side, both in · in, hit | 0 → 0 |
| 1024 | 910px · stacked, both in · in | 910px · stacked, both in · in | 0 → 0 |
| 768 | 736px · stacked, both in · in | 736px · stacked, both in · in | 0 → 0 |
| 390 EN | **517px** · stacked, both **past the viewport** · **out of view** | 366px · stacked, both in · in, hit | **139 → 0** |
| 390 AR | **500px** · stacked, both **past the viewport** · **out of view** | 366px · stacked, both in · in, hit | **122 → 0** |

(Ledger and Chart of Accounts identical; AR mirrored.) At 390 the ledger table (473px EN / 456px AR)
scrolls inside its 322px `.data-table-wrap`, its last column reachable; the first account (1000 · Cash /
النقد) stays selected and usable.

### Probes (EN / AR at 1440 and 390)

* **Report picker by keyboard:** Tab ×49 (1440) / ×10 (390) reaches Profit & Loss (pressed); Tab ×3 + Enter
  → `?report=tb`, Trial Balance pressed, h2 Trial Balance; Tab ×4 + Space → `?report=vat`; Shift+Tab ×7 +
  Enter → `?report=pl`. Every step: exactly one of eight pressed, `aria-pressed` = `.active`, focus kept on
  the activated toggle (focus-visible), the exports switched to that report with the same range, and the
  report body equal to C3's record. The search box: `aria-label` "Search…" / "بحث…" = its placeholder;
  one textbox with that accessible name.
* **Statement links:** loaded on `?kind=client` — Client `aria-current="page"`, Vendor none; Tab ×47 / ×8
  to Vendor, Enter → `?kind=vendor`, Vendor current, Client not; Tab to Client, Enter → back; h1
  unchanged; the statement equal to C3's record at each step.
* **Empty states (28 states):** `?account=999999` on Ledger and Chart of Accounts → "Select an account to
  view its ledger." under the h1, no h2; an org registered through the UI in the run's TEST-only copy (one
  starter bank account, 0 payments, 0 journal entries) → its ledger's first account "1000 · Cash" (h2)
  with "No transactions yet."; Payments "No payment records yet."; Journal "No journal entries yet." under
  its h2; Bank Accounts "No payment records yet." under its h2; its bank account deleted (1 row) → "No
  bank accounts yet." under the h1 and "No payment records yet." under the h2. Each visible, inside the
  viewport, no control inside it (no invented CTA); Add Account / Record Payment / New Account still
  there; no overflow, no error.

## Screenshots

Byte comparison, C3 (the exact 65e12d6 build `Gt4KJ5YigdnmoqtnTsRgE`; C4's harness minus the two
interactions C3 cannot perform) vs C4, same frozen clock, seed, TEST-only database and Chromium; no
masking. Control: today's C3 captures are byte-identical to the C3 build's own captures from the C3 stage
(256 / 44 / 210 / 134 / 282 shared states — 0 differences), so the environment is deterministic. Re-run on
the final tree (the approved P0 selector included; build `4l5NxGDk6eX4WWbO1OHy6`): byte-identical to the
pre-maintenance C4 captures (build `YSa_GKdPLYzknMkl1CcON`) in every set — 256 / 44 / 210 / 134 / 306 of
950 states, 0 differences, so the selector change moved no pixel — and against C3 the same states differ
as below, entry for entry.

| set | states | identical | differ | differences |
|---|---|---|---|---|
| 256-state matrix | 256 | 224 | 32 | `finance-reports` 16, `finance-statements` 16 |
| shell | 44 | 44 | 0 | — |
| lists | 210 | 194 | 16 | `list-payments` 8, `list-journal` 8 |
| documents | 134 | 134 | 0 | — |
| archetypes | 306 (C3: 298) | 240 | 58 | `a11-trial-balance` 10, `a12-statement-party` 10, `a13-ledger` 10, `c2-bank-accounts` 8, `c4-profit-loss` 4, `c4-statement-vendor` 4, `c4-chart-of-accounts` 4, `c4-ledger-no-account` 4, `i02-report-picker-focus` 4 — plus 8 new: `i09-report-picker-keyboard`, `i10-statement-vendor-link` |

Every differing state is a finance state; every non-finance state is byte-identical to C3. Classified (all
expected, none unexpected):

* **h1 / h2 type** — the page titles take PageHeader's `text-page` / 600 h1 (the old h3 was smaller), the
  report title / selected account / journal and bank secondaries SectionHeader's h2; content below moves
  2–6 px. Report bodies, tables, figures, pickers, presets, exports, cards: pixel-for-pixel the same
  content.
* **Statements** — the description is the PageHeader's (under the h1, `text-body-lg`) instead of a separate
  12.5px paragraph further down.
* **Ledger / Chart of Accounts at 390** — C3's page was 529px (EN) / 512px (AR) wide, the list and ledger
  cards past the viewport; C4's is 390px, both cards inside it, the ledger table scrolling in its card.
  The selected account's heading is the h2 (same code · name, caption and Balance pill).
* **EmptyState** — the ledger with no account selected shows the EmptyState surface (rounded-xl, py-12)
  instead of the old `card p-8` box (C4-only state).
* **Interactions** — `i02` (focus on the active report): the same focus ring, the page behind it with the
  new headings; `i09` Trial Balance pressed by keyboard with its focus ring and h2; `i10` the vendor page
  reached by keyboard, Vendor current.

Inspected by eye: Reports (P&L, TB) EN / AR at 1440 and 390, light and dark; statements client / vendor;
Ledger / Chart of Accounts at 1440 / 1024 / 768 / 390 EN / AR; Payments; Journal; Bank Accounts (AR: header
mirrored, New Account at the inline end); the three interactions.

## Mutations

Static (`verify:page-archetypes`; each mutation alone in an isolated worktree, restored after; the
worktree is exactly the C4 change set afterwards), re-run on the final tree: **66/66 caught** — the P0 pin
4/4 (P01–P04, see the P0 section; M40 still caught too), the brief's §50 list 42/42, D-2
4/4 (Gross Profit card removed, Gross Profit recomputed in the page, relabelled, COGS folded into
operating expenses in `finance-reports.ts`), extra 16/16 (a preset's range, `fyRange`, compare semantics,
the GL account select, a dictionary entry for StatementView's deferred "Search", `.two-col` touched, the
report header out of `no-print`, the report h2 into `no-print`, the ledger running balance re-formatted,
Add Account removed, the statement description shortened, Record Payment moved to meta, a statement link
given `role="button"`, a FinancePageLayout, a finance server action touched, the bank card's weight 800
swept).

Runtime (`verify-page-archetypes-runtime.mjs` on the finance routes, each mutation alone on its own fresh
normal build in the isolated worktree, restored after; the worktree is exactly the C4 change set
afterwards): **6/6 caught** — before the maintenance and again on the final tree, with the same failing
checks and counts —

* `.acct-grid` back to `1fr` at ≤1100px → page overflow, overflowing elements and tables beyond (Ledger /
  Chart of Accounts at 390: 0 → 139 px EN, 0 → 122 px AR), the C4 no-overflow check and the ledger / chart
  gate fail (95/100);
* the picker's `aria-pressed` pinned to P&L → the owner and Staff action inventories and the picker probe
  fail (97/100);
* the search's `aria-label` removed → unnamed controls (40 report states, 0 → 1), the C4 named-controls
  check and the picker probe fail (97/100);
* Vendor's `aria-current` removed → the owner and Staff action inventories and the statement-link probe
  fail (97/100);
* a report figure changed (the P&L Gross Profit row + 1) → report value equality and the picker probe fail
  (98/100);
* a console error injected on Payments → console errors (8 states and the sweep), the C4 zero-errors check
  and the empty-state probe fail (96/100).

Browser (the real P0 suite on the final C4 build `7M3Op-tEdcYCM1JU8jn6m`, outside the committed tree,
restored after): the corrected selector put back to `.main-head button` → **FAIL** — `TimeoutError` waiting
for `.main-head button` — so the suite cannot pass on C4 with the legacy selector.

## Previous gates

All re-run on the final tree — the approved P0 selector included — after the maintenance:

* `verify:page-archetypes` 164/164 (C0–C3 groups unchanged and green; group 12 28/28 with the new P0 pin).
* `verify:static` exit 0 — role matrix 32/32, confirmation policy 62/62, dirty form 66/66, skeletons 89/89,
  contrast 161/161, typography 43/43, status registry 88/88, shell 75/75, controls 110/110, DataTable 69/69,
  document form 76/76, edit-action 59/59, store model 69/69, provider harness 302/302, backup claims 26/26,
  money precision 12/12, **number-locale (P0) 29/29, date-timezone (P0.1) 38/38, business-dates (P0.2)
  44/44**, ledger-only balances 8/8, page archetypes 164/164.
* `verify:server` exit 0 (TEST-only database, no `.env`) — 23 suites: statements 70/70, project costing
  50/50, docs import 339/339, client and quotation import, exchange rates 57/57, registration currency
  34/34, money round trip 44/44, base backfill 21/21, rate fetch 27/27, FX reporting 16/16, advances audit
  18/18, advance allocations 23/23, advance backfill 16/16, advance release 15/15, credit note release
  40/40, advance refunds 10/10, advance clear 13/13, note FX 40/40, settlement 29/29, payment reversal
  55/55, bank opening 18/18, bank opening backfill 31/31 — and DB hardening (both append-only triggers).
* `tsc --noEmit` and ESLint (`--max-warnings=0`) on the 12 changed code files: clean. Dictionary: 1,746
  keys, no duplicate.
* Browser tier (`verify/run-browser-suites.mjs`, its own fresh normal build `7M3Op-tEdcYCM1JU8jn6m`, a
  TEST-only database, no repository `.env`): **49/49** — P0 `verify-ar-locale-hydration.mjs` 169/169, P0.1
  `verify-settings-timezone-hydration.mjs` 85/85, P0.2 `verify-business-date-hydration.mjs` 108/108, shell
  341/341, controls 302/302, DataTable 130/130, document form 188/188, edit e2e 218/218, advances 172/172,
  FX posting 108/108, staff 20/20 and every other suite. The runner discovers every `verify/*.mjs` that
  drives `localhost:3000` (49 of 57); the other eight are its three named helpers, three modules the suites
  import (`action-id`, `fake-probe`, `sign-file-url`), the standalone `verify-duedate.mjs` (no server) and
  the runtime archetype verifier (its own server, run above). Nothing skipped. (Before the maintenance the
  same tier on build `mxNUz4hbU3faivP08t3Bt` was 48/49 — the P0 suite; see below.)
* C2 HR and C3 kanban: their runtime checks (C2 14, D-6 10, C3 20 — department filters, payroll rows,
  kanban by keyboard / pointer, the empty board) are green in the runtime run above.

## P0 suite: the stale selector — blocker, approved maintenance, result

**The blocker (audit history).** The first full browser tier on C4 (build `mxNUz4hbU3faivP08t3Bt`) passed
48/49. The frozen P0 suite `verify/verify-ar-locale-hydration.mjs` — C3's approved reconstruction,
`6eec53fc9d09c6d6` — opened Payments after the thirteen routes of its first combination (browser ar-SA,
app ar) and clicked `page.locator(".main-head button").first()` (line 245): the Record Payment trigger,
found through the page's old `.main-head` title row, which C4 §22 replaces with `PageHeader` (and which
group 12 holds is gone from every C4 page). The locator never resolved — `TimeoutError` after 45 s — and the
script exited before printing a check (72 s; no count). Reproduced on its own; on C3's tree the suite passed
169/169. Not an application defect: Record Payment sits in the header (`button|Record Payment` /
`تسجيل دفعة` in the action inventories, unchanged C3 → C4) and the dialog is byte-identical. Under §5 the
suite was not modified; C4 stopped uncommitted and the defect was reported separately (a diagnostic copy
kept outside the repository, its selector alone changed, passed 169/169 on the same build).

**Authorization.** Independently reviewed and approved: exactly one behavioral edit — the Payments trigger
selector, to `PageHeader`'s dedicated actions slot (the tighter structural successor of `.main-head
button`; not the broader `[data-slot="page-header"] button`). Nothing else in the suite changes — the stale
Payroll exemption on line 180 (`.main-head h3`, matching nothing since C2) stays as it is.

**The change** — `verify/verify-ar-locale-hydration.mjs`, line 245, 1 insertion and 1 deletion:

```diff
-  await page.locator(".main-head button").first().click();
+  await page.locator('[data-slot="page-header-actions"] button').first().click();
```

| | sha256 | group 12 pin |
|---|---|---|
| C3's approved reconstruction | `6eec53fc9d09c6d69696dd1d23d4c57e3a36dff4c40e7fe8da921099187a60e6` | `6eec53fc9d09c6d6` |
| with the approved selector | `a226b47188ddf4783775fe1b1b2ba640cd6a680e0692b82b376a3e0f99732723` | `a226b47188ddf478` |

The pin is still a byte hash of the whole file: any further change fails group 12 — mutation M40 (the
C3 stream reconstruction narrowed) and P01–P04 (the selector reverted to `.main-head button`, broadened to
the whole `PageHeader`, the Payroll exemption cleaned up, a comment touched) are each caught.

**Why the assertion strength is unchanged.** The line only finds the button that opens Record Payment; it
asserts nothing. ROUTES, COMBOS, FIGURES, the streamed-segment reconstruction (C3's table-form widening),
the Western-digit scan, the server-vs-hydrated equality, the browser-locale probe, the app-language
cookie, the error capture, the fixture, the Record Payment balance and placeholder assertions, the check
count (169) and every timeout are byte-identical. On Payments the actions slot holds one button — Record
Payment — so the step opens the same dialog and its two assertions run as before.

**Result.**

| run | tree / build | result |
|---|---|---|
| P0 alone (runner), fresh normal build | C4 / `4aFZBTOPK9XoqAPosM0Hw` | **169/169 PASS** |
| P0 alone, direct (every check printed), same build | C4 / `4aFZBTOPK9XoqAPosM0Hw` | **169/169**, `AR LOCALE HYDRATION PASS` |
| full browser tier, fresh normal build | C4 / `7M3Op-tEdcYCM1JU8jn6m` | **49/49** (P0 169/169) |
| selector regression: back to `.main-head button` | C4 / `7M3Op-tEdcYCM1JU8jn6m` | **FAIL** — `TimeoutError` waiting for `.main-head button` (restored) |
| C3's original suite | C3 / `Gt4KJ5YigdnmoqtnTsRgE` | 169/169 PASS |
| the corrected suite | C3 / `Gt4KJ5YigdnmoqtnTsRgE` | FAIL — `TimeoutError` waiting for the actions slot (expected) |

The 169: 1 fixture check; 4 browser-locale probes (ar-SA really writes `١٬٢٣٤٫٥`, en-US `1,234.5`); 13
routes (dashboard, client detail, vendor detail, bank accounts, chart of accounts, ledger, journal,
reports · profit & loss / trial balance / AR aging, payroll, projects, project detail) × 4 browser-locale ×
app-language combinations (ar-SA · ar, ar-SA · en, en-US · ar, en-US · en) × 3 — no page or console error
(no #418), Western digits only, hydrated figures exactly the server-rendered ones — 156; and per combination
Record Payment's open-invoice balance and amount placeholder reading `8,271.33` in Western digits — 8.

**Version coupling.** On C3's tree Payments still has its `.main-head` row, so the corrected suite cannot
open Record Payment there; by decision the selector was not broadened to accept both structures. The
suite's one structural selector is coupled to C4's approved `PageHeader` migration; its hydration and money
assertions are C3's, unchanged — C3's original suite passes 169/169 on C3's build, the corrected one
169/169 on C4's.

## Build

Normal unmocked `next build` (Next.js 16.3.5, Turbopack). On the final tree (the approved P0 selector
included): `4aFZBTOPK9XoqAPosM0Hw` (P0 alone), `7M3Op-tEdcYCM1JU8jn6m` (browser tier) and
`4l5NxGDk6eX4WWbO1OHy6` (runtime run and screenshots), each fresh, plus one per runtime mutation. Before the
maintenance: `jgaxgdS84KZQC6sz6pS_k` (re-record), `YSa_GKdPLYzknMkl1CcON` (runtime run, screenshots),
`mxNUz4hbU3faivP08t3Bt` (browser tier). The C3 reference build `Gt4KJ5YigdnmoqtnTsRgE` (exact 65e12d6).
No font mocks, no `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, no package, environment, server or configuration
change.

## Deferred (not C4)

* D-2 (Gross Profit / COGS presentation; Project Profit / Margin) — a product decision; held as it is.
* The shell's nav label "Account Reporting" vs the page title "Financial Reports".
* StatementView's untranslated "Search" / "Document type" (and its own empty prompt) — DEV-UI-01.8 /
  translation debt; `statement-view.tsx` byte-identical.
* JournalForm's `div[role=button]` Add line (pointer-only) and six unnamed line inputs — DEV-UI-01.8.
* The weight-800 sweep (bank card balance, KPI values), residual gradients, inline-style cleanup.
* The ledger's "Expense" source badge has no Arabic (C3's; no code path posts that source type).
* The Trial Balance's drill-down rows are clickable `tr`s with no keyboard path (C3's, unchanged: the
  report bodies are frozen by §13; `table.data-table tbody tr { cursor: default }` gives them the default
  cursor, so the pointer-only measure does not count them) — keyboard drill-down for the Trial Balance
  belongs to a later report-body stage. The P&L / Balance Sheet drill targets are real buttons.
* Loading boundaries, streamed not-found status, Settings (C5), Dashboard (C6), document / app-state
  headings (C7), DB / migration, AUD-08.3, Blob / VPS, deployment.
