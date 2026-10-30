# DEV-UI-01.7 C6 — the Dashboard

Parent: C5 `e8f629b66162143c40eceb78c0d7f56fa5c207ef` (tree `db767eceb59774994c3fb582b0e029f9281082cb`),
on C4 `a1dbc6e`, C3 `65e12d6`, C2 `c060e8b`, C1 `8768cb2`, C0 `6ad311b`, main `1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50`.
Branch `claude/dev-ui-01-7-page-archetypes`; C6 is one commit on C5. Nothing is merged to main.
**DEV-UI-01.7 C7 has NOT started.**

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases on
127.0.0.1, with no repository `.env` (the browser tier's runner reads a temporary `.env` that points only
at its own TEST-only database and is deleted afterwards). Builds are normal, unmocked `next build`s.
Nothing touched production; nothing was deployed; no package, environment or configuration changed.

## Scope — `/dashboard`

| Area | C5 | C6 |
|---|---|---|
| Header | no title, no h1 — `DashboardToolbar` (range selector at the start, Customize Layout pushed to the end by `.toolbar-actions-right`) above the grid | `PageHeader title={t(locale, "Dashboard")}` (the existing dictionary word) with the `DashboardToolbar` as its `actions`: the h1 at the inline start, the range selector and Customize Layout side by side at the end of the title's line, wrapping below it when narrow |
| Widget titles | seven `h4`s under no h1 | the same seven as `h2`s (CSS twins carry the h4 rules' declarations) |
| Financial Overview | a 1.9fr / 1.1fr split: "Total Profit · <range>" (= total sales), a Revenue / Expenses legend, the ComboChart with a zero expense series, a Profit Margin donut (100 % whenever there are sales), Total Revenue / Total Expenses (0) / Total Profit rows | one column: the h2, the range pill, "Total Revenue · <range>" over `kpis.totalSalesThisMonth` (the KPI's own figure, as C5's Total Revenue row showed it), the revenue chart alone |
| KPI cards | four, each with a trend and a sparkline — Receivables / Payables a hard-coded "0%", Invoices / Receivables borrowing the revenue series, Payables a flat `[0, 0]` | Sales: its query trend and the revenue series; Invoices: its query trend; Receivables and Payables: neither |
| Cash Flow | three figures and a "sparkline" through inflow, outflow and net (not a time series) | the three figures |
| Recent Activities | `a.time.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")` on the server — Arabic-Indic digits, the server's zone | `formatDisplayDate(a.time, locale, "dateTime")` — Gregorian, Western digits, UTC |
| Feature strip | ZATCA Phase 1 QR (where the profile enables it) + Secure & Reliable, Real-time Insights, Automated Processes, CRM Integration · Coming Soon | ZATCA Phase 1 QR alone, rendered only when the `feature_strip` widget is shown **and** the profile enables ZATCA Phase 1 — no strip otherwise |
| Grid | `repeat(12, 1fr)` × 86 px rows at every width; spans as inline `gridColumn` / `gridRow` | `repeat(12, minmax(0, 1fr))` × 86 px above 1100 px; two shrink-safe tracks with natural rows at ≤1100 px (Financial Overview across both); one at ≤640 px; spans as `--dash-span` / `--dash-rows` |

Untouched, and guarded: the queries (`_shared/queries.ts`), the layout registry (`src/lib/dashboard-layout.ts` —
the twelve keys, `feature_strip` among them, its "Feature Highlights" label), the ranges
(`src/lib/dashboard-range.ts`), the preference store (`src/lib/user-prefs.ts`) and its two actions
(`dashboard-prefs-actions.ts`), Customize Layout (`customize-layout-dialog.tsx`), the status registry, the
base-currency notice and its action, the loading boundary, `PageHeader`, the country profiles and `Money`.

## Changed files

| File | Change |
|---|---|
| `src/app/(app)/dashboard/page.tsx` | the header, the seven h2s, D-1, D-4, D-5, the activity formatter, `DashWidget`'s size as custom properties (`wide` on Financial Overview), the chevrons' `rtl:rotate-180` — 25 hunks |
| `src/app/(app)/dashboard/dashboard-toolbar.tsx` | the `.toolbar-actions-right` wrapper removed — Customize Layout sits next to the range selector in `.dash-toolbar` (1 hunk; `pick()`, the menu and the dialog unchanged) |
| `src/app/(app)/dashboard/_shared/kpi-card.tsx` | `trendPct`, `trendUp`, `sparkValues` optional; each part rendered only when real (2 hunks) |
| `src/app/(app)/dashboard/_shared/charts.tsx` | `ComboChart`'s `expenses` optional — no expense line or points without it (6 hunks); still no chart library |
| `src/app/(app)/mockup-parity.css` | Dashboard selectors only, 14 hunks (below) |
| `src/lib/i18n/dict.ts` | the Arabic of "Last 7 Days" / "Last 30 Days" with Western digits — `آخر 7 أيام`, `آخر 30 يوماً` (C5 `آخر ٧ أيام`, `آخر ٣٠ يوماً`); 1,751 keys, no duplicate; approved in the independent review (see "Approvals") |
| `verify/verify-compliance-claims.mjs` | **the approved compliance-verifier maintenance (D-4 only):** its one Dashboard check that required the Secure & Reliable card's subtitle replaced by the approved check that the card's title and subtitle are gone — 5 lines in, 1 out; every other byte C5's (see "The compliance-claims suite — blocker, approval, maintenance") |
| `verify/verify-page-archetypes.mts` | group 14 (C6, 24 checks — the 24th pins the compliance suite's one approved edit); groups 6 / 9 / 11 / 12 / 13 adjusted to C6's consumers and its CSS / dictionary hunks (below) |
| `verify/page-archetype-pins.json` | the consumer inventory (+1 `PageHeader`, +1 `formatDisplayDate`) and the Dashboard's data section (4 statements out, `revenueSpark` in) — nothing else |
| `verify/verify-page-archetypes-runtime.mjs` | the C6 measures (`DASH_FACTS`, `DASH_VALUES`), the value pass, the C6 targets and probes (with the natural-rows assertion added after RT2's first miss — approved, see "Approvals"), `--write-c6ref` |
| `verify/page-archetype-runtime-baseline.json` | `c6ref` added (C5's Dashboard values: 12 states, recorded on C5's build); the Dashboard's 8 owner states re-recorded on C6's build — outline, h1 (0 → 1), the PageHeader facts, the C1 literal scan's field (absent → empty) and, in Arabic, Arabic-Indic digits 4 → 0 — nothing else in them; the Dashboard's Staff and sweep entries re-recorded identical; every other entry, `d6`, `c3ref` and `c4ref` byte-identical |
| `tests/ui-baseline/archetype-states.mjs` | one C6 state, two C6 fixtures and two C6 interactions |
| this document | |

`verify/page-archetype-actions.json` is unchanged: the Dashboard's five lists (owner EN / AR at 1440, EN at 390;
Staff EN / AR at 1440), re-recorded on C6's build, are C5's to the byte (below).

Not changed (guarded — group 14 byte-pins them to C5): `dashboard/_shared/queries.ts`,
`src/lib/dashboard-layout.ts`, `src/lib/dashboard-range.ts`, `src/lib/user-prefs.ts`,
`dashboard/dashboard-prefs-actions.ts`, `dashboard/customize-layout-dialog.tsx`, `src/lib/status-registry.ts`,
`dashboard/base-currency-notice.tsx`, `dashboard/actions.ts`, `dashboard/loading.tsx`,
`src/components/layout/page-header.tsx`, `src/lib/geo/country-profiles.ts`, `src/lib/base-currency.ts`,
`sales/_shared/money.tsx`, `src/lib/i18n/format-date.ts` (frozen since C0), every Settings file (C5's 15 byte-pinned),
`src/db/**`, `drizzle/**`, and every P0 / P0.1 / P0.2 verifier — including `verify/verify-ar-locale-hydration.mjs`
with C4's approved selector (`a226b47188ddf478`) — and every other browser-tier suite but the compliance-claims
suite's one approved check.

## Before / after — the outline

```
C5                                        C6
(no h1)                                   h1 Dashboard            [This Month ▾] [Customize Layout]
h4 Financial Overview                     h2 Financial Overview
h4 Quick Actions                          h2 Quick Actions
h4 Recent Activities                      h2 Recent Activities
h4 Cash Flow · This Month                 h2 Cash Flow · This Month
h4 Invoices Overview                      h2 Invoices Overview
h4 Project Overview                       h2 Project Overview
h4 HR Snapshot                            h2 HR Snapshot
```

Arabic: `h1 لوحة التحكم`, then `نظرة مالية عامة`, `إجراءات سريعة`, `الأنشطة الأخيرة`, `التدفق النقدي · هذا الشهر`,
`نظرة عامة على الفواتير`, `نظرة عامة على المشاريع`, `لمحة الموارد البشرية` — the dictionary's existing words (no
new key). The KPI labels stay labels (not headings), as in every earlier stage.

## PageHeader and the toolbar

```tsx
// C5
<DashboardToolbar locale={locale} range={rangeKey} layout={prefs.layout} />
//   <div className="dash-toolbar">  <DropdownMenu …/>  <div className="toolbar-actions-right"><CustomizeLayoutDialog …/></div>  </div>

// C6
<PageHeader title={t(locale, "Dashboard")} actions={<DashboardToolbar locale={locale} range={rangeKey} layout={prefs.layout} />} />
//   <div className="dash-toolbar">  <DropdownMenu …/>  <CustomizeLayoutDialog …/>  </div>
```

The PageHeader (C1's primitive, unchanged) gives the h1 at the inline start and its `actions` group at the end of
the title's line — or, when there is no room, wrapped below it at the start; it never overlaps the title. The
toolbar keeps its `.dash-toolbar` (flex, `gap: 10px`, wrapping; its `margin-bottom` went — PageHeader's own
spacing separates header and grid) so Customize Layout keeps its `.dash-toolbar .btn` sizing.
`.toolbar-actions-right` (`margin-inline-start: auto`) is gone from the Dashboard only (the two document toolbars
still use it). The BaseCurrencyNotice and the FX-8 data-quality banner stay above the header, as they were
above the toolbar. `pick()` (`setDashboardRangeAction`, then `router.push("/dashboard?range=<key>")`, then
`refresh()`), the seven `DASHBOARD_RANGES` items with the current one checked, and `CustomizeLayoutDialog` are
unchanged.

## D-1 — Financial Overview: revenue only

Removed (not hidden): `expenseSeries` (a zero series), `totalProfit` (= total sales), `profitMarginPct` (100 %
whenever there were sales), the "Total Profit · <range>" figure, the Revenue / Expenses legend, the zero expense
line and points, the Profit Margin donut, the Total Revenue / Total Expenses (0) / Total Profit rows and the
1.9fr / 1.1fr split with its physical `borderLeft` / `paddingLeft`. The dashboard has no expense data; all of
it was presentation of numbers that did not exist.

```tsx
<DashWidget col={8} row={5} wide>
  <div className="card fin-card">
    <div className="fin-head"><h2 …>{t(locale, "Financial Overview")}</h2><div className="select-pill" …>{rangeLabel}</div></div>
    <div className="fin-total-label">{t(locale, "Total Revenue")} · {rangeLabel}</div>
    <div className="fin-total-value"><Money amount={kpis.totalSalesThisMonth} context="summary" /></div>
    {revenueSpark && <div style={{ marginTop: 14 }}><ComboChart revenue={revenueSpark} labels={revenueLabels} /></div>}
  </div>
</DashWidget>
```

The widget key is still `financial_overview`. "Total Revenue · <range>" is the figure C5 showed as its Total
Revenue row (`kpis.totalSalesThisMonth`, the selected range's sales — the same as the Total Sales KPI); the
chart is the selected range's revenue buckets (`getRevenueSeries`, unchanged; every range has at least three
buckets, so it always draws). `ComboChart` takes `expenses?: number[]`: without it there is no expense line, no
expense points, and the scale is the revenue's — for non-negative revenue exactly C5's, whose zero series never
raised the maximum: the runtime proves the chart's `viewBox`, every bar, the line and every point identical to
C5's to the attribute, for this month, the last 30 days and this year, EN and AR at 1440 and 390. With
`expenses` passed the chart draws both series as before (no consumer passes it now). Still no chart library.
`.fin-profit-label` / `.fin-profit-value` are renamed `.fin-total-label` / `.fin-total-value` (same
declarations; the P0 suite's figure scan still reaches the figure through `Money`'s `.num-tabular`).

## D-4 — the feature strip

Removed: Secure & Reliable (Encrypted connection, encrypted credentials), Real-time Insights (Data driven
decisions), Automated Processes (Save time, work smarter), CRM Integration · Coming Soon (We will connect our
existing CRM), their Lock / TrendingUp / RefreshCw / Link2 icons, and the now consumer-less
`.feature-card.highlight`, `.feature-card.highlight .f-icon` and `.coming-soon-pill` rules. Kept: the factual
card — Shield, "ZATCA Phase 1 QR", "On printed tax invoices" (Phase 1 is a QR printed on tax invoices: not a
certification, not a ZATCA connection).

```tsx
{featureStripVisible && showZatca && (
  <div className="feature-strip"><div className="feature-card">…Shield · ZATCA Phase 1 QR · On printed tax invoices…</div></div>
)}
```

`featureStripVisible` (the `feature_strip` layout entry) and `showZatca` (`profileHasFeature(…, "zatca_phase1")`
— Saudi Arabia's profile) are computed exactly as in C5 (data pins). The strip is a single-card wrapping row
(`display: flex; flex-wrap: wrap`; C5's five-column grid had nothing left to lay out). For an org whose profile
has no ZATCA Phase 1 there is nothing to render, so nothing renders — no `.feature-strip`, no empty shell — and
its `feature_strip` preference is untouched: still in the registry, still listed (as "Feature Highlights") and
ticked in Customize Layout, simply with no factual card behind it.

## D-5 — trends and sparklines: the KpiCard contract

```tsx
// C5: trendPct: string; trendUp: boolean; sparkValues: number[]  — always rendered
// C6:
trendPct?: string; trendUp?: boolean; sparkValues?: number[];
{trendPct !== undefined && trendUp !== undefined && (<div className={`kpi-trend ${trendUp ? "up" : "down"}`}>…{trendPct} vs prev. period</div>)}
{sparkValues && sparkValues.length > 1 && (<div className="kpi-spark"><Sparkline values={sparkValues} color={accent} /></div>)}
```

| Card | C5 | C6 |
|---|---|---|
| Total Sales | `kpis.totalSalesTrend` + the revenue series | the same — both real (`revenueSpark` = the range's revenue buckets) |
| Total Invoices | `kpis.totalInvoicesTrend` + the **revenue** series (borrowed) | the trend only |
| Total Receivables | a literal `"0%"` up + the **revenue** series (borrowed) | neither — no period comparison exists for a balance |
| Total Payables | a literal `"0%"` down + a flat `[0, 0]` | neither |
| Cash Flow | three figures + a "sparkline" through inflow, outflow and \|net\| (each `|| 1`) | the three figures |

No placeholder takes their place and no blank box is kept: the parts are not rendered. (On desktop the
KPI cells keep their 2-row grid height, so a card without a trend is as tall as its neighbours.) The
invoice-status Donut is factual and stays.

## Recent Activities — `formatDisplayDate`

`a.time.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")` → `formatDisplayDate(a.time, locale, "dateTime")`,
the third planned consumer of C0's helper (`format-date.ts` frozen). `a.time`, the order, the range, the labels
and the invoice / quotation classification are untouched (`getRecentActivity` byte-identical). The Dashboard is
a server component, so the string is the server's — now explicit: en-US / `ar-SA-u-ca-gregory-nu-latn`, UTC.

| | C5 | C6 |
|---|---|---|
| EN | `6/12/2026, 12:00:00 PM` | `Jun 12, 2026, 12:00 PM` |
| AR | `١٢‏/٦‏/٢٠٢٦، ١٢:٠٠:٠٠ م` | `12 يونيو 2026، 12:00 م` |

The chevron after each activity, and after View All Invoices / Go to Projects / Go to HRM, now turns in Arabic
(`rtl:rotate-180`).

## The range labels' digits — C6's one dictionary edit

`"Last 7 Days": "آخر ٧ أيام"` → `"آخر 7 أيام"`, `"Last 30 Days": "آخر ٣٠ يوماً"` → `"آخر 30 يوماً"` — the words
unchanged, the number in Western digits. These two labels are the Dashboard's own (`RANGE_LABELS`'s only
consumers are the Dashboard page and its toolbar): they appear in the range menu on every Arabic Dashboard and,
when chosen, in the header, Financial Overview's pill and total and the Cash Flow title. C6's blocking runtime
target is Western digits on every Dashboard state, and §42 / §51 require the alternate-range states, so the
labels had to change; the dictionary is otherwise untouched (no key added, 1,751 keys, no duplicate). The only
other Arabic-Indic digits in the dictionary — the import dialog's "max ١٠ ميجابايت" — are not on the Dashboard
and are left for the translation work (deferred). See "Decisions".

## Responsive grid

```css
/* C5 */
.dash-grid { … grid-template-columns: repeat(12, 1fr); grid-auto-rows: 86px; … }
/* + inline style={{ gridColumn: `span ${col}`, gridRow: `span ${row}` }} on every widget, at every width */

/* C6 */
.dash-grid   { … grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-rows: 86px; … }
.dash-widget { … grid-column: span var(--dash-span); grid-row: span var(--dash-rows); }
@media (max-width: 1100px) {
  .dash-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: auto; }
  .dash-widget { grid-column: auto; grid-row: auto; }
  .dash-widget[data-wide] { grid-column: 1 / -1; }
  .dash-widget > *:not(.dash-widget-chrome):not(.dash-resize-handle) { overflow: visible; }
}
@media (max-width: 640px) { .dash-grid { grid-template-columns: minmax(0, 1fr); } }
```

`DashWidget` writes its desktop size as data — `style={{ "--dash-span": col, "--dash-rows": row }}` and
`data-wide` when `wide` — and no inline `grid-column` / `grid-row`, so the media rules can override it. Every
widget's `col` / `row` is C5's (KPIs 3×2, Financial Overview 8×5, Quick Actions 4×4, Recent Activities 4×5, Cash
Flow 3×3, Invoices Overview 3×4, Project Overview 3×4, HR Snapshot 3×3), so above 1100 px the 12-column
arrangement, the 86 px rows and the dense packing are C5's (shrink-safe tracks now). At ≤1100 px: two equal
tracks, Financial Overview (the one `wide` widget) across both, every other widget one track, rows as tall as
their content, and the cards show all of it (no internal scroll); at ≤640 px one track. The saved order still
drives the DOM order and the grid still auto-places it. `.kpi-grid-v4` / `.fin-overview-grid`'s ≤1100 px rule
keeps its two selectors (unused by the page; not cleaned, out of scope); `.feature-strip` left that rule.

Measured (runtime, the seeded org, EN / AR; widths in CSS px, "clipped" = a widget whose card's content is
larger than its box, across or down):

| Width | C5: tracks · clipped widgets · narrowest widget | C6: tracks · clipped · widget widths |
|---|---|---|
| 1440 | 12 · 0 / 0 (EN / AR) · 276 | 12 · 0 · KPIs 276, Financial Overview 762.7, Quick Actions / Recent Activities 373.3, the cards 276 (C5's to the pixel) |
| 1101 | — | 12 · 0 (EN / AR) |
| 1100 | — | 2 · 0 (EN / AR) |
| 1024 | 12 · 0 / 1 (Recent Activities, down — AR) · 215.5 | 2 · 0 · every widget 447, Financial Overview 910 |
| 768 | 12 · 2 / 6 (EN: Quick Actions across, Recent Activities down; AR: the four KPIs, Recent Activities, HR Snapshot down) · 172 | 2 · 0 · every widget 360, Financial Overview 736 |
| 641 | — | 2 · 0 (EN / AR) |
| 640 | — | 1 · 0 (EN / AR) |
| 390 | 12 · **11 of 11** (EN and AR) · **79.5** (KPIs and the four cards; Quick Actions / Recent Activities 111.3; Financial Overview 238.7) | 1 · 0 · every widget 366 (the content width) |

(C5's page-wide overflow read 0 at 390 — the twelve squeezed tracks fit the page; the content was cut off inside
each widget, which C0's page measure could not see and C6's measure of each card does.) The runtime also reads the
row sizing as computed: above 1100 px `grid-auto-rows: 86px` and each widget `grid-row: span <rows>`; at ≤1100 px
`grid-auto-rows: auto` and every widget's `grid-row` auto — natural rows, as §22 asks, not merely rows tall
enough for today's seed (RT2, below). Heights at ≤1100 px are the content's (e.g. at 390 EN: Total Sales 156,
Total Invoices 98, Receivables / Payables 70, Financial Overview 383.3, Recent Activities 397).

## RTL / logical

No physical left / right remains in the four Dashboard files (C5's Financial Overview split had `borderLeft` /
`paddingLeft`). The Dashboard CSS C6 touched is logical: `.kpi-spark` `margin-inline-start: -4px` (was
`margin-left`), the legend dots `margin-inline-end` (were `margin-right`). The PageHeader puts the h1 at the
inline start and the actions at the inline end in either direction (measured on every state). The chart's time
axis stays left-to-right in Arabic: the SVG geometry is absolute and the labels are centred
(`text-anchor="middle"`), so the Arabic chart is the English one bar for bar and point for point (measured).

## Customization — preserved

`DashboardWidgetKey`, the twelve keys (`feature_strip` among them — the marketing content left the widget, not
the key), `DASHBOARD_WIDGETS` and its labels, `DEFAULT_DASHBOARD_LAYOUT`, `normalizeLayout`, the Customize
Layout dialog, `saveDashboardLayoutAction` / `setDashboardRangeAction`, `getDashboardPrefs` and the
`user_preferences` storage are byte-identical to C5. No preference is migrated. The runtime E2E proves the
dialog end to end (below).

## Queries, values, permissions — invariants

The queries are byte-identical, the server data section is C5's minus the four D-1 / D-5 statements
(`expenseSeries`, `totalProfit`, `profitMarginPct`, `spark`) plus `revenueSpark`
(`revenueSeries.length > 1 ? revenueSeries : undefined` — C5's `spark` without the `[0, 0]` fallback, which no
range ever reached), the guards (`requireSession()`, `getBaseCurrencyConfirmation(session.orgId, session.role)`)
and the static action inventory are the pinned ones. What the page shows was recorded on C5's build
(`--write-c6ref`: e8f629b, build `7j1TYqOtqJSLURxPsuuPe`, src clean; 12 states — this month, the last 30 days
and this year × EN / AR × 1440 / 390) and every C6 run holds the same 12 states to it, value for value:

| Seeded org (Saudi Arabia), EN | This Month | Last 30 Days | This Year |
|---|---|---|---|
| Total Sales (trend) | 13,271 (68.9 %) | 27,095 (6.1 %) | 100,051 (100 %) |
| Total Invoices (trend) | 2 (33.3 %) | 3 (50.0 %) | 7 (100 %) |
| Total Receivables / Payables | 35,131 / 0 | 35,131 / 0 | 35,131 / 0 |
| Financial Overview total (C5: its Total Revenue row) | 13,271 | 27,095 | 100,051 |
| Revenue buckets (chart bars / labels) | 30 days, Jun 1 – Jun 30 | 30 days, May 17 – Jun 15 | 12 months, Jan – Dec |
| Cash inflow / outflow / net | 10,143 / 0 / 10,143 | 21,680 / 81,075 / −59,395 | 314,920 / 99,935 / 214,985 |
| Invoices paid / partial / pending / overdue (total) | 1 / 0 / 1 / 0 (2) | 1 / 0 / 2 / 0 (3) | 2 / 1 / 2 / 1 (6) |
| Projects completed / active / on hold / planned | 1 / 1 / 0 / 1 | the same | the same |
| HR present / on leave / absent (total) | 0 / 0 / 6 (6) | the same | the same |
| Recent activities | INV-0006, INV-0005, QTN-0003, INV-0004 | the same | the same |
| Links in `<main>` / data-quality notice / ZATCA card | 9 / none / 1 | the same | the same |

Identical in C6, EN and AR, at 1440 and 390: the four KPI figures, Total Sales' trend and sparkline path, Total
Invoices' trend, the chart (`viewBox`, every bar's x / y / width / height, the revenue line's path, every point,
every label), the total, the range label (in Arabic now with Western digits — the one intended text change),
Cash Flow's title and figures, the invoice statuses / counts / donut, Project Overview and HR Snapshot (figures
and rows), the activity labels, every link (href and text), the notice and the ZATCA card. Removed, and proven
present in C5's record first: Total Invoices' borrowed sparkline, Receivables' and Payables' "0%" trends and
their borrowed / flat sparklines. The activity times are the one intended value-format change (above).
Permissions: Staff still land on the Dashboard and see the same page; no guard, role or action changed.

## Static verifier — `verify:page-archetypes` group 14 (C6)

24 checks (212 in all; groups 1–13 unchanged in strength):

* **Hunk reversal.** Each of the four Dashboard files is C5's code plus exactly C6's 34 hunks (`[C5 code, C6
  code]` pairs, compared without comments or whitespace): undo them and every file hashes to its C5 flat hash —
  page 25, toolbar 1, KPI card 2, charts 6. A query call, range, preference, action, link, figure, status colour,
  widget key or size cannot change unseen; Quick Actions, Invoices Overview, Project Overview, HR Snapshot and
  the base-currency notice are C5's.
* **Stylesheet.** C6's 14 CSS hunks each appear once; undone, `mockup-parity.css` is C5's (= C4's) to the
  character — no rule outside the Dashboard's moved (`.stat-row-2`, `.two-col`, `.acct-grid`,
  `.cost-breakdown-grid`, `.kanban`, Settings, documents, print).
* **Dictionary.** C6's one edit (the two range labels' digits); undone, `dict.ts` is C5's to the byte; no range
  label with an Arabic-Indic digit; English unchanged.
* **Header / toolbar.** One PageHeader — title `t(locale, "Dashboard")`, the toolbar as `actions`, nothing else —
  after the notice and the banner, before the grid; the toolbar rendered once; `.dash-toolbar` holding the
  dropdown and Customize Layout, no `.toolbar-actions-right`; `pick()` and the seven menu items as in C5.
* **Headings.** No h1 in the page (PageHeader's), no h3–h6; the seven h2s with their words; the two CSS twins
  with the h4 rules' declarations and no h4 rule left.
* **D-1.** No `expenseSeries` / `totalProfit` / `profitMarginPct`, no Total Profit / Profit Margin / Total
  Expenses / Expenses / the legend, nothing named profit or expense in the code; Financial Overview's content
  exactly as above, one `ComboChart` with no `expenses`, no donut in it, no 1.9fr; `ComboChart`'s contract.
* **D-4.** No marketing title, subtitle, icon, `.highlight` or `.coming-soon-pill`; the strip exactly the ZATCA
  card under `featureStripVisible && showZatca`; both conditions computed as in C5; the CSS rules removed and
  `.feature-card` unchanged.
* **D-5.** The four `KpiCard` calls' trend / sparkline attributes exactly as the matrix above; no `"0%"`, no
  `[0, 0]`, no `Sparkline` in the page; `KpiCard`'s optional props and conditional rendering.
* **Dates.** `formatDisplayDate(a.time, locale, "dateTime")` once; no `toLocale*String` / `Intl.DateTimeFormat`
  in the four files; `format-date.ts` C5's.
* **Grid.** `DashWidget`'s custom properties and `data-wide`, no inline grid placement anywhere in the page,
  every widget's `col` / `row` C5's, Financial Overview the only wide one; the `.dash-grid` and `.dash-widget`
  rules exactly C6's.
* **Logical direction.** No physical left / right in the four files; the four chevrons `rtl:rotate-180`; the
  touched CSS logical.
* **Everything else.** 14 files byte-pinned to C5 (queries, layout registry, ranges, preferences and their
  actions, Customize Layout, the status registry, the notice and its action, the loading boundary, PageHeader,
  country profiles, base currency, Money) and every Dashboard file accounted for; the Dashboard's guards, data
  section (the pin's only change as above) and static actions; the 15 Settings files byte-identical to C5 and
  the P0 suite's hash; no Dashboard abstraction.
* **The approved verifier maintenance.** `verify/verify-compliance-claims.mjs` holds the approved D-4 check
  exactly once and the old positive check nowhere, its "Your data is encrypted" check unchanged, and — with the old
  line put back in place of the new block — hashes to C5's `d6a11364db596383`: any other edit to that suite (a
  Compliance Center check, the fixture, the locales, the exit) fails `verify:page-archetypes`.

Earlier groups, adjusted to C6 without loosening: group 6's `formatDisplayDate` consumers 2 → 3 (the Dashboard);
group 9's PageHeader consumers 33 → 34 (the Dashboard); groups 11 and 12 hold the stylesheet at C3's / C4's with
C6's CSS hunks undone first (group 14 proves they are its only ones); groups 12 and 13 hold `dict.ts` at C4's
with C6's range-label edit undone first. `verify/page-archetype-pins.json` changed in exactly the consumer
inventory (+1 PageHeader, +1 formatDisplayDate) and the Dashboard's data section (−4 statements, +1).

## Action inventory (C5 → C6)

Measured — every link, button, tab, menu trigger and toggle in `<main>`: kind, visible name, target, type,
disabled, selected / pressed / current / expanded — for the owner (EN and AR at 1440, EN at 390) and for Staff (EN
and AR at 1440), C5's build against C6's: **identical, list for list** (5 lists of 11 actions — the range
trigger "This Month" / "هذا الشهر" (`popup=menu`), Customize Layout (`popup=dialog`), the six Quick Actions, View
All Invoices, Go to Projects, Go to HRM; 0 renamed, 0 added, 0 removed, 0 state changes — `--rebaseline`
re-recorded them byte-identical, so `page-archetype-actions.json` is unchanged). Staff see the same 11. The seven
range menu items (outside `<main>`, in Radix's portal) are read by the range E2E: the seven ranges in
`DASHBOARD_RANGES` order, the current one checked. Removed content had no actions (the marketing cards, the
profit donut, the fake legend and sparklines were not interactive).
Unexplained delta: **0**.

## Runtime (C5 → C6)

`verify/verify-page-archetypes-runtime.mjs`, its own TEST-only database, production builds:

1. **C5's build** (wt at exactly e8f629b, build `7j1TYqOtqJSLURxPsuuPe` — the lock gate's own fresh build, which
   passed C5's 117/117 there), C6's verifier, `--write-c6ref`: the value pass's 12 states recorded as `c6ref`
   (src clean). The same build, measured with C6's Dashboard facts (C6's probes off — they look for C6's
   controls): every C6 target fails there, as it must — no h1, h4 titles, twelve tracks at every width (11 of
   11 widgets clipped at 390, 2 / 6 at 768), the D-1 / D-4 phrases present, Receivables' and Payables' "0%".
2. **C6's build** (`h8WLXg2Steyw9kpk6hLIX`), `--rebaseline=dashboard`: 8 owner states, 2 Staff, 2 sweep and 5
   action lists re-recorded; **140/140** — every never-worse measure held against C5's record, route behaviour
   and direction the same, the outline changes listed for review (exactly the intended h1 + seven h2s, EN / AR,
   every width), the five action lists byte-identical (0 renamed, 0 added, 0 state changes).
3. **The final tree** (`wt-final`, with the approved compliance maintenance; its own fresh normal build
   `4VFiq4gJoILI--cJUQR77`): **139/139** — 54 routes, 432 owner states, 108 Staff, 108 sweep, every baseline
   state measured; route behaviour, direction and outlines as the baseline; every never-worse measure held; zero
   React #418 across all 648 measured states; the owner (1,629) and Staff (1,050) action inventories unchanged;
   the 29 route-wide checks and the C1 (7), C2 (14), C3 (20), C4 (17), D-2 (3), D-6 (10), C5 (17) and C6 (22)
   targets all green. Every C6 measure of this run (grid, breakpoints, values, ranges, the range and Customize
   E2Es, the org without ZATCA, the activity times under every zone) is identical, value for value, to the
   pre-approval final run's (`KmnFyDLzO5c2mdPFvjE6Y`, 139/139; and before it `rNml-8R3dBiih7UZ6husn`, 139/139,
   run before the natural-rows assertion and a lint-only edit).

C5 → C6 on `/dashboard` × EN / AR × 1440 / 1024 / 768 / 390 (h1 / skips / overflow px / offenders / tables past
the viewport / unnamed / pointer-only / errors / Arabic-Indic digits): C5 `0/0/0/0/0/0/0/0/0` (EN) and
`0/0/0/0/0/0/0/0/4` (AR) → C6 `1/0/0/0/0/0/0/0/0` on all eight. Nothing grew. Staff land on `/dashboard` as
before (EN / AR) with the same 11 actions.

C6's targets (all green on the final run): the Dashboard measured (8 states; the seeded org Saudi Arabia);
200 at `/dashboard`; one PageHeader holding the only h1 (title "Dashboard" / "لوحة التحكم", no meta, the range
selector reading This Month and Customize Layout in its actions — at the end of the title's line at 1440 /
1024 / 768, wrapped below it at 390 — neither control anywhere else, nothing overlapping the title); the
outline exact, no skip; no overflow, nothing past the viewport; zero console errors, page errors and #418;
Western digits; the grid at every width and its geometry (the table above); D-1, D-4 and D-5 on every state;
the three value cases' states (the outline with Cash Flow · <range>, the header's range, Financial Overview's
label and pill, the grid, D-1 / D-4 / D-5); the `c6ref` record and every factual value; the removals present
in C5; the chart LTR in Arabic; the four breakpoints (1101 / 1100 / 641 / 640 px — 12 / 2 / 2 / 1 tracks, nothing
clipped, no overflow); the range selector E2E (the menu's seven ranges in Western digits; Last Month: URL
`?range=last_month`, preference saved, header / outline / Financial Overview / every value equal to a direct
load of that range and not this month's chart; This Month again: `?range=this_month`, saved back); Customize
Layout E2E (an org registered through the UI, Saudi Arabia: the twelve labels; Feature Highlights and Quick
Actions hidden and HR Snapshot moved up → the page re-rendered so, the preference stored as twelve
`{key, visible}` in that order; Reset to default → every widget back, the ZATCA card back, the default stored);
an org without ZATCA Phase 1 (the United Arab Emirates, registered through the UI: no `.feature-strip`, no card,
no ZATCA text, the outline and grid as above, Feature Highlights still listed and ticked); the recent-activity
times (one quotation given 23:30Z on the 14th in the TEST-only copy and restored; under New York / Riyadh,
Pago Pago and Kiritimati every time equals `formatDisplayDate` of the database value — EN `Jun 14, 2026, 11:30
PM` for the deterministic one — identical in every zone, no #418).

## Screenshots

Same harness, frozen clock, seed, TEST-only database and pinned Chromium as every earlier stage; no masking,
no injected CSS. The before reference is a fresh capture of exactly e8f629b (its own build `7j1TYqOtqJSLURxPsuuPe`)
with C6's harness; it reproduces C5's own approved final captures **byte for byte — all 980 states they share**
(the 20 C6 states are new). The final C6 captures reuse the final runtime run's build `4VFiq4gJoILI--cJUQR77`
(the tree with the approved compliance maintenance); they are **byte-identical, all 1,000 states, to the first C6
captures** (build `rNml-8R3dBiih7UZ6husn`, before the maintenance) — the verifier maintenance added no visual
delta.

C6 adds to the archetype set (`tests/ui-baseline/archetype-states.mjs`): the alternate range — Last 30 Days, EN +
AR at 1440 and 390, full page (4); two fixtures, full page (8), each made in the run's TEST-only copy for that
state and restored straight after — an org without ZATCA Phase 1 (the owner's org's country set to the United
Arab Emirates; the Shield card must be gone) and a customized layout (the owner's saved layout: Quick Actions
and the strip hidden, HR Snapshot above Project Overview; the page must render it so); and two interactions,
viewport screenshots (8) — the range selector by keyboard (Tab, Enter: the menu open on seven ranges, the
current one marked, the focus inside, the trigger expanded) and Customize Layout by keyboard (Tab, Enter: the
dialog on twelve widgets, all shown, Feature Highlights ticked). Each asserts what C5 and C6 share (so C5's
build captures them too — the before / after pairs); C6-only behaviour is the runtime verifier's.

| Set | States | Byte-identical to C5 | Different | Which |
|---|---|---|---|---|
| 256-state matrix | 256 | 240 | 16 | `dashboard` (its 16 states) |
| shell | 44 | 4 | 40 | the 40 shell states captured on `/dashboard` (collapsed rail, drawer, command palette, record search, account menu, language focus, notifications, Staff shell and drawer, focus nav / top bar); the 4 Recycle Bin title states identical |
| lists | 210 | 210 | 0 | — |
| documents | 134 | 134 | 0 | — |
| archetypes | 356 | 326 | 30 | Dashboard (10), the alternate range (4), the no-ZATCA (4) and customized (4) fixtures, the two interactions (8) |
| **all** | **1,000** | **914** | **86** | every one a state of `/dashboard` (classified by each manifest's route and final path); **every non-Dashboard state byte-identical** |

(Final captures, C5 reference → final C6; the same counts as the first C6 captures, which they equal byte for
byte.) The two dictionary values are rendered only through `RANGE_LABELS`, whose only consumers are the Dashboard
page and its toolbar, so the dictionary edit can reach no other page. Its own footprint, isolated: the C6 tree with
only those two values put back to C5's (that `dict.ts` hashes to C5's, `0728e58762d9648b`), its own fresh build
`QJ2qHbXvA90T-Jgh71Wtl`, the 30 Dashboard archetype states captured and compared with the final C6 captures —
**26 byte-identical, 4 different, exactly the intended Arabic alternate-range states**: the Arabic Last 30 Days page
(1440, 390 — the header's range, Financial Overview's label and pill, the Cash Flow title) and the Arabic range
menu (1440, 390 — "آخر 7 أيام" / "آخر 30 يوماً" against "آخر ٧ أيام" / "آخر ٣٠ يوماً"). The tree was restored
straight after.

What the Dashboard differences show: the h1 and its two actions at the end of the line (wrapping below at 390); the
seven titles as h2s, looking as they did; Financial Overview one column — "Total Revenue · <range>", its figure and
the revenue chart (C5: the profit figure, the fake legend, the zero expense line, the 100 % donut and its three
rows); the KPI cards without the fake trends and borrowed lines; Cash Flow without its sparkline; the strip the
ZATCA card alone (C5: five cards); the activity times; and the grid — two columns from 1100 px down, one from
640 px, every widget's whole content visible (C5 at 390: twelve 79.5 px tracks, every widget cut off). At 1440
the widget boxes are C5's to the pixel. Two consequences of keeping the desktop row sizes (§22) are visible
there: removed content leaves white space inside the Financial Overview, Cash Flow and the two bare KPI cards; and
the revenue chart's 30 day labels overlap (as in C5, where the column was narrower) — both recorded, not changed.

## Mutations

**C6 product mutations — static** (`verify:page-archetypes`, a mutation worktree synced to the final tree, each
edit applied alone and restored): **62/62 caught** on the final tree — the brief's 38 (§55 / §56, in its order),
22 extra (X21 / X22 guard the approved compliance maintenance), 2 P0 pins; the worktree back to exactly the C6
change set afterwards (a first run, before the approved maintenance and its pin, was 60/60):

| # | Mutation | Caught by |
|---|---|---|
| 1–3 | Total Profit / Profit Margin / Total Expenses reintroduced | C6 D-1 + Financial Overview checks, hunk reversal |
| 4–5 | `expenseSeries`; a hard-coded 100 % margin | C0's server-data pins, C6's data-section check, D-1, hunk reversal |
| 6 | the expense line back (`expenses={…}` passed) | D-1 (one ComboChart, no `expenses`), hunk reversal |
| 7–11 | Secure & Reliable / Real-time Insights / Automated Processes / CRM Integration / Coming Soon back | C6 D-4, hunk reversal |
| 12–13 | ZATCA gating removed; an empty strip for non-ZATCA orgs (`showZatca` moved inside the strip) | C6 D-4 (the exact strip), hunk reversal |
| 14–17 | Receivables / Payables "0%"; Payables `[0, 0]`; Invoices borrowing the revenue spark | C6 D-5 matrix, hunk reversal |
| 18 | Cash Flow's pseudo-spark back | C6 D-5 Cash Flow, hunk reversal |
| 19–21 | Sales' trend / Sales' spark / Invoices' trend removed | C6 D-5 matrix, hunk reversal |
| 22–23 | the Dashboard h1 removed; back to a div / h4 | group 9's PageHeader consumers, C6 header, hunk reversal |
| 24 | a widget h2 back to h4 | C6 headings, hunk reversal |
| 25 | the activity time back to `toLocaleString("ar-SA")` | C6 dates, hunk reversal |
| 26–27 | inline `gridColumn` / `gridRow` back | C6 grid (source), hunk reversal |
| 28 | the desktop grid loses `minmax` | C6 stylesheet + grid (CSS) |
| 29–30 | the tablet / phone rules removed | groups 11–12 (the undo no longer matches), C6 stylesheet + grid (CSS) |
| 31 | Financial Overview not `wide` | C6 grid (source), Financial Overview check, hunk reversal |
| 32 | fixed 86 px rows below 1100 px | groups 11–12, C6 stylesheet + grid (CSS) |
| 33 | a C5 Settings file touched | C6's Settings byte pins |
| 34–37 | `queries.ts`, `dashboard-layout.ts`, `dashboard-range.ts`, the preference action changed | C0's business pins (57 files), C6's untouched-files check |
| 38 | the C4 P0 suite's selector changed | the P0 hash pins (groups 12, 13, 14) |
| X01–X20 | a range label back to Arabic-Indic digits; another dictionary entry; a heading style; the wide rule; internal scroll below 1100 px; a placeholder sparkline in KpiCard; the expense line unconditional; `.toolbar-actions-right` back; a chevron's RTL turn; a className on the PageHeader; Customize Layout touched; the status registry touched; a `DashboardSection` abstraction; a physical margin in `.kpi-spark`; `user-prefs.ts` touched; the range navigation changed; `formatDisplayDate` changed; the ZATCA card's Shield; the Financial Overview total on another figure; the base-currency notice touched | each by its check |
| X21 | the compliance suite's old positive Dashboard assertion restored | C6's approved-maintenance pin |
| X22 | another compliance-suite assertion changed (the "SOC 2" claim dropped from its banned list) | C6's approved-maintenance pin |
| P01–P02 | the P0.1 / P0.2 suites touched | the P0 hash pins |

**C6 product mutations — runtime** (`--only=dashboard`, the mutation worktree rebuilt normally for each, each
edit restored after; caught = the run exits non-zero and every named check fails): **8/8 caught on the final
tree** — RT2 on the first try there, by the strengthened natural-rows check; in the first mutation run RT2 was
**missed** (history below). The worktree back to exactly the C6 change set afterwards (`ad84489c1587ae33`).

| Mutation (§56) | First run: build · result | Final run: build · result | Caught by (final run) |
|---|---|---|---|
| RT1 — the phone grid back to twelve columns (≤640 px `repeat(12, minmax(0, 1fr))`) | `6RZjli6y0dmpt2R-J5UyO` · 132/139 | `wKF5tPpyYR7dY3F3ACFm2` · 132/139 | C6 grid, ranges, breakpoints, no-ZATCA, C6 headings; the outline and the owner action inventory (content cut off at 390) |
| RT2 — the ≤1100 px auto-row fix removed (`grid-auto-rows: auto`, `grid-row: auto`) | `u2xGx9z0qXKuQIQT4lGbB` · **139/139 — missed** → strengthened → `_dieZAC1GmK1AfiGB2Oqh` · 136/139 | `pS8yLwCzeketZzak2_7B-` · **136/139** | C6 grid (at 1024 / 768 / 390 `grid-auto-rows: 86px` and the desktop row spans), C6 ranges, C6 breakpoints |
| RT3 — Total Profit injected (Financial Overview's label) | `5rLk0UZDAVhAJh2BBooxH` · 132/139 | `ztzhhnYo6xKm_n2nQsApX` · 132/139 | C6 D-1, D-4 (the gone list), ranges, breakpoints, range E2E, Customize E2E, no-ZATCA |
| RT4 — a fake "0%" trend (Receivables) | `-olxhF1MHJ_zvw_LDtwY8` · 136/139 | `peo9WHHXdBUP16b33pxOk` · 136/139 | C6 D-5, ranges, the values / removals check |
| RT5 — the activity formatter reverted (`toLocaleString("ar-SA")`) | `0Erlbgab8Iu0NY1vYqKA_` · 135/139 | `4uMOnsqIiMfX0hfUEz8CM` · 135/139 | Arabic-Indic digits never more (C0), C6 Western digits, ranges, recent activity |
| RT6 — a marketing card restored (Secure & Reliable) | `ZSdWc1yT2n4WJHT-Uyh2r` · 134/139 | `xXGttgC6T8AR34wFgVxx2` · 134/139 | C6 D-1 / D-4 (the gone list), ranges, breakpoints, Customize E2E |
| RT7 — a second h1 (Quick Actions) | `XYS7Q6Pu_JWoN3BMTlLbx` · 132/139 | `ULxbd81NEKEMPQqyr5e1m` · 132/139 | outlines, one h1 per page (C0), C6 header / headings, ranges, range E2E, no-ZATCA |
| RT8 — an injected console error (the toolbar) | `7qvG26MBD4Vq_069hYSsA` · 130/139 | `YpLZwO815wQZs6CVo5ENs` · 130/139 | console errors never more, the Pago Pago sweep, C6 errors and every C6 probe |

RT2's history, as approved: the first mutation run removed the ≤1100 px auto-row rule and the verifier still
passed 139/139 — two tracks give this seed's widgets enough width that their desktop row spans (86 px × 2–5)
still hold the content, so nothing clipped. §22 asks for natural rows below 1100 px, not merely no clipping for
today's seed, so the grid and breakpoint checks were strengthened to read it from the computed styles (above
1100 px `grid-auto-rows: 86px` and each widget `span <rows>`; at ≤1100 px `auto` and every widget's `grid-row`
auto); the re-run caught it, and the final run catches it on the first try. The independent review approved the
strengthening ("an increase in verifier strength … Do not revert it").

**Compliance-maintenance mutations** (distinct from the product set): the Secure & Reliable card restored on the
C6 Dashboard → `verify-compliance-claims.mjs` fails (25/26, the D-4 check; build `7aaFu-t4lmYp9RFVeJTAr`); the
suite reverted to its old positive assertion on C6 → fails (25/26, the old check); statically, X21 / X22 (above).
See "The compliance-claims suite".

## Previous gates

On the final tree (`git diff` of everything but this document identical in the main checkout and every worktree
used: `ad84489c1587ae33`; before the approved maintenance it was `d6a10dc0ef29f5f4` — the difference is the
compliance suite's one edit and its group-14 pin):

* `verify:page-archetypes` **212/212** — C0's groups 1–8 (routes 4, guards 6, server data 2, business 2, P0 /
  P0.1 / P0.2 contracts 15, primitives 44, abstraction creep 3, static action inventory 2), C1 19/19, C2 13/13,
  C3 26/26, C4 28/28 (its P0 pin `a226b47188ddf478` unchanged), C5 24/24, C6 24/24 (211 before the approved
  maintenance's pin).
* `verify:static` exit 0 — role matrix 32/32, confirmation policy 62/62, dirty form 66/66, skeletons 89/89,
  contrast 161/161, typography 43/43, status registry 88/88, shell 75/75, controls 110/110, DataTable 69/69,
  document form 76/76, edit-action 59/59, store model 69/69, provider harness 302/302, backup claims 26/26,
  money precision 12/12, **number-locale (P0) 29/29, date-timezone (P0.1) 38/38, business-dates (P0.2) 44/44**,
  ledger-only balances 8/8, page archetypes 212/212.
* `verify:server` exit 0 (a fresh TEST-only database, no `.env`) — the 23 suites (statements 70/70, project
  costing 50/50, docs import 339/339, client import, quotation import, exchange rates 57/57, registration currency
  34/34, money round-trip 44/44, base backfill 21/21, rate fetch 27/27, FX reporting 16/16, advances audit 18/18,
  advance allocations 23/23, advance backfill 16/16, advance release 15/15, credit-note release 40/40, advance
  refunds 10/10, advance clear 13/13, note FX 40/40, settlement 29/29, payment reversal 55/55, bank opening 18/18,
  bank opening backfill 31/31) and DB hardening (both append-only triggers present).
* `tsc --noEmit` exit 0; ESLint `--max-warnings=0` on the 9 changed code files (the four Dashboard files,
  `dict.ts`, the harness states, the compliance suite and the two page-archetype verifiers): clean; dictionary
  1,751 keys, no duplicate.
* Runtime: **139/139** on the final tree, its own fresh normal build `4VFiq4gJoILI--cJUQR77` (above).
* Browser tier: **49/49** on the final tree (its third full run, alone, fresh build `VcD1oeCmT7I5QPqvR1Dv7`); runs
  1 and 2 were 48/49 on the DataTable saved-view check, reproduced on exact C5 — see "The final browser tier" (in
  the compliance-claims section).
* C1–C5: their runtime targets are green in the final runtime run; no C1–C5 source file changed (group 14's file
  accounting, groups 9–13's pins).
* The C4 P0 selector maintenance is untouched: `verify/verify-ar-locale-hydration.mjs` is byte-identical to C4
  (`a226b47188ddf478`); P0 169/169, P0.1 85/85, P0.2 108/108 in the tier and directly.

## The compliance-claims suite — blocker, approval, maintenance

### 1. The original blocker (history, as first reported)

`verify/verify-compliance-claims.mjs` (browser tier; last changed in `0a8552f`, "Compliance Center: an honest
readiness checklist, not a compliance claim") ends with two Dashboard checks. The legacy assertions, exactly as
in C5:

```js
ok("dashboard does NOT claim 'Your data is encrypted'", !dash.includes("Your data is encrypted"));
ok("dashboard says what is actually encrypted", dash.includes("Encrypted connection, encrypted credentials"));
```

"Encrypted connection, encrypted credentials" is the subtitle of the Secure & Reliable marketing card, which D-4
removes (§11–13; §45 asserts it absent; §55.7 must catch its return). On C6's first full browser tier (build
`vrfXxis19W9_KaIsE2V8j`) the first check passed and the second failed — the only failing check of the suite
(25/26: every Compliance Center check passed, EN and AR) and the only failing suite of the tier (48/49). C6
could not satisfy both the brief and that check, and "no previous verifier may be weakened", so the suite was
not edited, nothing was committed, and C6 was reported **BLOCKED**, with a proposed replacement: keep the first
check; replace the second with a negative check on the card's title and subtitle (its proposed wording, "the
dashboard makes no security marketing claim at all", was broader than what the check governs).

### 2. The independent approval

The blocker was independently reviewed — "APPROVED NARROW VERIFIER MAINTENANCE + FINALIZATION": replace only the
old positive assertion, with exactly the authorized form below; keep the first Dashboard assertion unchanged; keep
every other byte of the suite as in C5 (the registration fixture, the Compliance route, the English and Arabic
claims, the certification-denial, readiness, encryption-control, backup, state and full-marks assertions, locale
switching, browser and DB setup, exit semantics); not the broader wording, because the assertion governs this one
retired Dashboard card only. C6 was still not approved by it: it authorized this maintenance and the single
commit once every blocking gate is green.

### 3. Before / after — applied verbatim

```diff
 ok("dashboard does NOT claim 'Your data is encrypted'", !dash.includes("Your data is encrypted"));
-ok("dashboard says what is actually encrypted", dash.includes("Encrypted connection, encrypted credentials"));
+ok(
+  "dashboard removes the Secure & Reliable security marketing copy (DEV-UI-01.7 C6, D-4)",
+  !dash.includes("Secure & Reliable") &&
+    !dash.includes("Encrypted connection, encrypted credentials"),
+);
```

The whole diff of the file: one hunk, 5 lines in, 1 out (C5 line 99 → C6 lines 99–103; 103 → 107 lines). C5's
lines 1–98 are C6's 1–98 and C5's 100–103 are C6's 104–107; put the old line back in place of the new block and
the file is C5's to the byte (`d6a11364db596383`; C6 `98bd1c9f967d9fa3`). The first check is C5's line,
unchanged. Static group 14 pins exactly this (above), so no other line of the suite can change unseen.

### 4. Why the guard is stricter for the C6 product contract

The old check was written when the Dashboard deliberately showed this card in place of the false "Your data is
encrypted", so it required the card's subtitle to be **present**. D-4 removes the whole card; the product contract
is now its absence, and the new check requires **both** the title "Secure & Reliable" and the subtitle
"Encrypted connection, encrypted credentials" to be absent (either one back fails it). The "Your data is
encrypted" check is unchanged, every Compliance Center check is unchanged, and the suite still runs 26 checks.
Nothing else in the tier was touched.

### 5. Proof — old C5 fails, C6 passes, the mutations fail

Each run on its own fresh normal build, a fresh TEST-only database and no repository `.env`; through the tier's
runner (`--only=compliance-claims`) and directly (every check printed):

| Tree | Build | Result |
|---|---|---|
| **C6** (the final tree), the corrected suite | `wFpcqmv3YfXjrc-w-m6Pa` (the browser tier's) | **26/26, ALL PASSED** — the 17 Compliance Center checks, the 7 Arabic ones, "dashboard does NOT claim 'Your data is encrypted'" and "dashboard removes the Secure & Reliable security marketing copy (DEV-UI-01.7 C6, D-4)" |
| **exact C5** (`e8f629b`, clean) + the corrected suite copied in | `VDgDlFqhy3EGqGM-lO5d3` | **fails as expected — 25/26**: only the D-4 check (C5 still shows Secure & Reliable and its subtitle); every Compliance Center and Arabic check passes. Not broadened to pass on both. |
| C6 + the suite's **old positive assertion** put back (verifier reverted) | `wFpcqmv3YfXjrc-w-m6Pa` | **fails — 25/26**: only "dashboard says what is actually encrypted" |
| C6 + the **Secure & Reliable card restored** on the Dashboard (title and subtitle — the compliance-maintenance mutation) | `7aaFu-t4lmYp9RFVeJTAr` | **fails — 25/26**: only the D-4 check |

Every temporary edit was restored straight after its run: the worktrees were back to exactly the C6 change set
(`ad84489c1587ae33`) and exact C5 (clean), and no mutation is committed. The check is a conjunction of two
absences, so either string alone back on the Dashboard fails it; the static pin (X21 / X22 in "Mutations")
catches the verifier side. The suite reads the Dashboard in English (it sets the `locale` cookie back to `en`
after its Arabic section), so C5's failure also shows the new check reads the real page — an absence check on a
page that could not contain the words would pass everywhere.

### 6. The final browser tier

Every full run of `verify/run-browser-suites.mjs` on the final tree (each a fresh normal build, a fresh TEST-only
database, no repository `.env`), in order — none omitted:

| Run | Build | Conditions | Result |
|---|---|---|---|
| 1 | `wFpcqmv3YfXjrc-w-m6Pa` | beside the runtime verifier and the captures (other lanes) | 48/49 — compliance-claims **PASS**; `verify-datatable-runtime.mjs` 129/130: "save handoff" (the name typed in full and the input focused, but the focus log shows the Dialog input blurring to a button outside it and taking focus back) |
| 2 | `s_uBhOvbievaVTj-ESD4A` | alone | 48/49 — compliance-claims **PASS**; `verify-datatable-runtime.mjs` 120/121: "saved-view flow ran to completion" (Enter on the focused Views trigger did not open the menu within 30 s, so the rest of that block was skipped) |
| 3 | `VcD1oeCmT7I5QPqvR1Dv7` | alone | **49/49 PASS** — the gate run (below) |

The DataTable failures are not C6's. The suite and the code it drives are untouched since C5 (suite
`7dd991ed407faf91` = C5's; the saved-view menu is DEV-UI-01.5's `list-workspace-toolbar.tsx`, not in C6's change
set; C6's CSS hunks reach no list page — the 210 list and 134 document screenshots are C5's to the byte). On run
2's build the suite ran directly three times, each on its own fresh database: 130/130 each. To test the tier's
conditions, its first 13 suites (its exact order through the DataTable suite) were replayed on one server and one
fresh database, alternating exact C5 (`e8f629b`, clean, build `VDgDlFqhy3EGqGM-lO5d3`) and C6: C5 130/130 then
**129/130 — the same "save handoff" failure, the same focus-log signature** (`out:dialog:save>button`); C6
130/130 twice; every other replayed suite exit 0. The saved-view focus checks are timing-sensitive on C5 itself;
the suite was not edited, re-tried inside, or weakened (deferred, below).

Direct runs on the final tree's builds: compliance-claims **26/26** (`wFpcqmv3YfXjrc-w-m6Pa` and
`s_uBhOvbievaVTj-ESD4A`), P0 `verify-ar-locale-hydration.mjs` **169/169**, P0.1
`verify-settings-timezone-hydration.mjs` **85/85**, P0.2 `verify-business-date-hydration.mjs` **108/108**.

Run 3 — **49/49 suites passed** (`exit 0`), every suite of the tier, none skipped: account Arabic 34/34,
advances 172/172, **P0 Arabic-locale hydration 169/169**, bank GL 21/21, bank opening ✓, **P0.2 business-date
hydration 108/108**, colour theme ✓, **compliance claims ✓ (26/26)**, confirm e2e 34/34, controls 302/302, currency
lock 13/13, dark theme ✓, **DataTable 130/130**, DC without bank 21/21, delete refusal 16/16, dirty core 72/72,
dirty UI 8/8, document attachments 14/14, document form 188/188, draft buttons ✓, draft func ✓, duplicate 40/40,
**edit e2e 218/218**, edit ✓, expense categories hidden 16/16, favorites 20/20, **FX dashboard 6/6**, FX posting
108/108, note currency 19/19, payment dialog 28/28, payment FX 66/66, PDF branding 15/15, **preset ZATCA ✓**, print
apply ✓, private storage 22/22, proforma payments ✓, rate one-click 28/28, rate screen 13/13, register outstanding
5/5, registration currency 20/20, reversal status 16/16, **P0.1 settings time-zone hydration 85/85**, **shell
341/341**, sidebar scroll 14/14, skeleton 11/11, Staff replay 9/9, **Staff runtime 20/20**, statement reversal
25/25, vendor inline 31/31 (✓ = the suite's verdict line; those suites print no count).

## Approvals (the independent review of the blocker)

* **The compliance-verifier maintenance** — approved in exactly the form above (section "The compliance-claims
  suite"), D-4 only.
* **The Western-digit range labels** — approved: "Keep the C6 dictionary corrections … Do not revert these two
  corrections. Do not change any other dictionary entry. Do not add new keys." `dict.ts`'s C6 delta is exactly
  the two digit-only values (`آخر ٧ أيام` → `آخر 7 أيام`, `آخر ٣٠ يوماً` → `آخر 30 يوماً`); groups 12–14 pin
  them; the import dialog's `max ١٠ ميجابايت` stays deferred (not the Dashboard's).
* **The RT2 strengthening** — approved as an increase in verifier strength ("Do not revert it"): the runtime grid
  and breakpoint checks read, from computed styles, that at ≤1100 px `grid-auto-rows` is auto and every widget's
  `grid-row` is auto (no desktop row span kept), so the 768 px state meets §22 even when the seed happens not to
  clip. The original RT2 mutation was **missed** by the first runtime mutation run (139/139) and is **caught** by
  the strengthened check (see "Mutations").

## Build

Normal unmocked `next build` (Next.js 16.3.5, Turbopack); every build fresh, from its own tree. The final C6
tree (`src` diff `c16838c45371d196`, whole diff `ad84489c1587ae33`): `4VFiq4gJoILI--cJUQR77` (the final runtime
run and every final screenshot), `wFpcqmv3YfXjrc-w-m6Pa` (the first full browser tier, the direct compliance /
P0 / P0.1 / P0.2 runs and the old-assertion proof), `s_uBhOvbievaVTj-ESD4A` (the second, alone, and the direct
DataTable / compliance runs), `VcD1oeCmT7I5QPqvR1Dv7` (the third — the gate run, 49/49). Proof and mutation
builds: `VDgDlFqhy3EGqGM-lO5d3` (exact C5 + the corrected suite; then, clean, the C5 side of the DataTable
replay), `7aaFu-t4lmYp9RFVeJTAr` (C6 + the card restored), `QJ2qHbXvA90T-Jgh71Wtl` (C6 with the dictionary edit
undone), one per runtime mutation (above). Before the approval, from the same `src`: `KmnFyDLzO5c2mdPFvjE6Y`,
`rNml-8R3dBiih7UZ6husn`, `vrfXxis19W9_KaIsE2V8j`, `h8WLXg2Steyw9kpk6hLIX` (the Dashboard re-record). The C5
reference build `7j1TYqOtqJSLURxPsuuPe` (exact e8f629b — the lock gate's) recorded `c6ref`, the C5 Dashboard
facts and the C5 screenshots. No font mocks, no `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, no package, Next config,
environment, server or deployment change.

## Decisions where the brief's premise did not hold

1. **The range labels' digits (§43, §60).** §19 names the activity time as "the remaining Arabic-Indic Dashboard
   date/time surface"; measuring every Dashboard state found one more Arabic-Indic surface — not a date: the
   dictionary's Arabic for "Last 7 Days" / "Last 30 Days", shown in the range menu on every Arabic Dashboard
   and, when chosen, in the header, Financial Overview and the Cash Flow title. "Western digits" is a blocking
   target on every Dashboard state (§43) and the alternate range is a required state (§42, §51); §3 allows
   `dict.ts` "only if required", while §60's wording names missing translations. C6 changed the two values'
   digits only (`آخر 7 أيام`, `آخر 30 يوماً`) — Dashboard-only strings, no key added — rather than measure around
   them; group 14 pins the edit and groups 12 / 13 hold the rest of the file. (The pre-commit report offered to
   revert the two lines if the review preferred the dictionary untouched; the independent review **approved**
   them instead — see "Approvals".)
2. **The deterministic activity (§47).** The seed already gives every document a fixed creation instant (11:00Z
   / 12:00Z); the runtime probe also gives one quotation a date-crossing instant — 23:30Z on the 14th, already
   the 15th in Riyadh and on Kiritimati — in its TEST-ONLY copy, restores it, and proves every time equals
   `formatDisplayDate` of the database's value under four browser zones.
3. **The desktop grid at 1101–1440 px.** §22 allows the 86 px rows above 1100 px; measured, no widget clips there
   (1440 and 1101, EN / AR) — C6 kept them.

## Deferred (not C6)

* **Carried from C5, unchanged:** `RISK_STYLE` migration — and with it the undefined `--warn` / `--crit` /
  `--good` (+ `-bg`) colour tokens, which leave Security's risk pill uncoloured and the alerts' severity stripe
  unpainted (declared on `border-inline-start` since C5, invalid at computed-value time). Security is not
  modified (DEV-UI-01.8).
* The import dialog's Arabic "max ١٠ ميجابايت" — the dictionary's last Arabic-Indic digits, not on the
  Dashboard (generic translation work).
* Dashboard CSS no markup uses any more — `.kpi-grid-v4`, `.fin-overview-grid` (and their ≤1100 px rule),
  `.fin-legend` and `.donut-legend-row` with their `.dot` rules (C6 made those two logical in place);
  `.dash-widget-chrome` / `.dash-resize-handle` were already unused in C5 — left, not swept.
* The revenue chart's bucket labels overlap when a range has many buckets (30 days) — at every width, as in C5
  (where the chart's column was narrower); label thinning is chart work, not C6's.
* On desktop (above 1100 px) the widgets keep C5's row spans (§22), so the content C6 removed leaves white space
  inside Financial Overview, Cash Flow and the two KPI cards without a trend; re-sizing the desktop spans is
  a layout decision for a later stage.
* The `feature_strip` preference's label "Feature Highlights" now names a strip of one factual card (the
  registry is frozen).
* KPI value weight 800 (`.kpi-value`, `.fin-total-value`, `.bc-bignum`) — the generic weight-800 sweep.
* `verify-datatable-runtime.mjs`'s saved-view focus checks (DEV-UI-01.5's menu → Dialog handoff) fail
  intermittently — reproduced on exact C5 ("save handoff", the Dialog input briefly blurring to a button outside
  it) and seen twice in C6's tier (that, and the Views menu not opening on Enter within 30 s); 130/130 on every
  direct run. Not C6's (no list code changed); the timing race in the list workspace (or the suite's
  synchronization with Radix's deferred focus restoration) needs its own fix — the assertions stay as they are.
* Every C5 deferral stands (Settings gradient wording, unnamed colour inputs, Presets' pointer-only Add,
  title / navigation mismatches, translation debt, URL tab sync, input bidi, consent raw keys, C4's physical
  utilities, `.settings-nav-item` focus style).
* C7 (document headings) has not started.
