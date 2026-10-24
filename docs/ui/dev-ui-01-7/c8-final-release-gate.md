# DEV-UI-01.7 C8 — final financial presentation and release gate

Parent: the approved C8 consolidated remediation `c47c65a3cbec35f8afe938ef8d928766d7f3ca3e` (tree
`6033b0bd433e179ad74f7c6bb8acf9ebaca6a5a5`), on C7 `004cd35`, C6 `20eff7d`, C5 `e8f629b`, C4 `a1dbc6e`, C3 `65e12d6`,
C2 `c060e8b`, C1 `8768cb2`, C0 `6ad311b`; main `1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50`. Branch
`claude/dev-ui-01-7-page-archetypes`; this is one commit on `c47c65a` (10 ahead / 0 behind main). Nothing is merged to
main and nothing is deployed. `c8-remediation.md` stays as the historical record of the remediation.

All browser and database work ran in isolated worktrees against `devui010_test_only_*` databases on 127.0.0.1, with no
repository `.env` (the browser tier's runner reads a temporary `.env` that points only at its own TEST-only database and
is deleted afterwards). Builds are normal, unmocked `next build`s. Nothing touched production; no package, environment,
schema, migration, configuration, security or permission setting changed.

**Passing this gate closes the DEV-UI-01.7 frontend modernization scope. It does not certify the ERP's accounting: Cost
of Sales and inventory valuation are not implemented (no COGS is ever posted), so the P&L's profit figures and the
Balance Sheet's current-period result are not trustworthy. That limitation stays open (below) and must stay visible in
the handoff and the accounting roadmap.**

## Product-owner decisions (authorized for this batch)

| Surface | Decision |
|---|---|
| P&L screen (`PnlView`) | No profit figure until Cost of Sales and inventory valuation are complete: the Net Profit card, the Operating Profit row and the Net Profit / (Loss) row go (the Gross Profit card and row already went in the remediation). Revenue is the one summary card. A restrained localized notice says why — on screen and in print. No invented or zero-valued replacement. |
| P&L exports (CSV / Excel / PDF) | The Gross Profit, Operating Profit and Net Profit / (Loss) rows go; every account line and Total Revenue stay; the notice goes in the exporter's existing header block (`exportResponse` meta). An explicit, narrow exception to the export route's former business pin. |
| Balance Sheet | Current-period Profit / (Loss) stays — line, amount, place in Equity, the balance identity — marked **Preliminary**, with a disclosure, on screen, in print and in the exports. It must not read as audited or certified. |
| Project detail | The section "Cost & Profitability" becomes **Project Revenue & Costs** (an h2); the remediation's four factual KPIs stay. |
| Dictionary | Only the new keys. |
| Accounting | No calculation, posting, schema or migration change; no COGS implementation (a separate accounting project). |

### The localized texts

| Key | English | Arabic |
|---|---|---|
| P&L notice | Profit figures are temporarily hidden because Cost of Sales and inventory valuation are not yet complete. | تم إخفاء مؤشرات الربح مؤقتًا لأن احتساب تكلفة المبيعات وتقييم المخزون لم يكتمل بعد. |
| Balance Sheet marker | Preliminary | مبدئي |
| Balance Sheet disclosure | Preliminary — Cost of Sales and inventory valuation are incomplete. The current-period result may change. | مبدئي — احتساب تكلفة المبيعات وتقييم المخزون غير مكتمل، وقد تتغير نتيجة الفترة الحالية. |
| Project section | Project Revenue & Costs | إيرادات وتكاليف المشروع |

The exports keep the export convention (English structural labels; the account names in the session's language). The
PDF exporter's WinAnsi encoding prints "—" as "-" and cannot print Arabic glyphs (an Arabic session's PDF drops the
Arabic account names, as it did before C8 final); its notes are English, like its other structural labels.

## Changed files

| File | c47c65a → final (sha256, 16) | Change |
|---|---|---|
| `src/app/(app)/finance/reports/reports-workspace.tsx` | `f3eff79b5f4a060c` → `594433d3755b3335` | `PnlView`: the Net Profit card, the Operating Profit and Net Profit / (Loss) rows removed, the notice added; `BsView`: the current-period line marked Preliminary, the disclosure added; `ReportNote` and `PreliminaryMark` (new, local); the print styles show the report area again (8 hunks) |
| `src/app/(app)/finance/reports/export/route.ts` | `1533168860eddde6` → `8ecc9dd0fea8b3bc` | the `pl` branch without its three profit rows and with its note; the `bs` branch's current-period row marked "(Preliminary)" and its disclosure; `meta` handed to `exportResponse` (5 hunks) |
| `src/app/(app)/projects/[id]/cost-control.tsx` | `4c7a9c36d184733f` → `2d5373f8ef1044fd` | the section title and the file's header comment (2 hunks) |
| `src/lib/i18n/dict.ts` | `ad171858a8128535` → `9d5fd4a38b228616` | four entries appended (1 hunk; 1751 → 1755 keys) |
| `verify/verify-page-archetypes.mts` | `81fe5a67a1b53ae4` → `4eca8bdac07966c3` | the undo layer (`FIN_EDITS`) and group 17 (233 → 250 checks) |
| `verify/verify-page-archetypes-runtime.mjs` | `ed6f31321756a435` → `600fc45c74642af9` | the P&L / Balance Sheet derivations, the print pass, the export pass (`c8ref`), the tenant probe and their checks (151 → 157) |
| `verify/page-archetype-runtime-baseline.json` | `e171c1110e5c43da` → `9a36acba2236ece6` | `c8ref` added (the exports and the export URL's answers, recorded on c47c65a); every older record unchanged |
| `tests/ui-baseline/archetype-states.mjs` | `e539837f1e40b655` → `d97f67b5273c7bc9` | 26 C8 final capture states (464 → 490) |
| this document | — | |

Byte-identical to c47c65a, held by the verifiers: `src/lib/project-costing.ts` (`decae2db39a19061`),
`src/lib/finance-reports.ts` (`ec765dd2ce69b9e2` — `grossProfit`, `operatingProfit`, `netProfit` still computed),
`src/lib/accounting.ts` (`3ea7bea0f5056272`), `src/lib/settlement.ts` (`8d46dc950a011d77`), `src/lib/status-registry.ts`
(`d30d22a93f40d71f`), the shared exporter `src/lib/report-export.ts` (`1ba18d6c15f0739e`), the list toolbar
(`2bd2a430e47a76f5`), `verify/verify-datatable-runtime.mjs` (`a1f6efb9eb734f7c`), `verify/page-archetype-pins.json`
(`efc3d70a2d585a04`), `verify/page-archetype-actions.json` (`bffd5367d932b4b6`) — and every other file under `src/`
(495 files, `c05dcaf4283af501`): the posting, inventory, purchase, payroll, Dashboard, document-lifecycle and
session / tenant / role code, `src/db`, the schema and the migrations.

## What the screen, the print and the exports show now

### Profit & Loss (`/finance/reports`, the default report, and `?report=pl`)

| | c47c65a (approved remediation) | C8 final |
|---|---|---|
| Summary cards | Revenue 87,001 · Net Profit 5,926 (against the previous period with ▲ deltas) | **Revenue 87,001** — the one card (its delta kept) |
| Notice | — | the P&L notice, right after the card, inside the report (a `<p role="note">`, ink on surface-subtle, an `aria-hidden` Info icon) |
| Body | 4000 Sales Revenue 87,000.75 · Total Revenue 87,000.75 · Cost of Sales (no lines in the seed) · 5200 Salary Expense 81,075.00 · **Operating Profit 5,925.75** · Other Income & Expenses (when any) · **Net Profit / (Loss) 5,925.75** | the same without Operating Profit and Net Profit / (Loss) |
| Unchanged | | the account lines and their drill-downs, search, the date presets and fields, compare, the picker, the CSV / Excel / PDF links |

### Balance Sheet (`?report=bs`)

| | c47c65a | C8 final |
|---|---|---|
| Current-period line | Current-period Profit / (Loss) 5,925.75 | Current-period Profit / (Loss) **[Preliminary]** 5,925.75 — the word in a warning-tinted pill beside the label (text, not colour alone) |
| Disclosure | — | after Total Liabilities + Equity: the Balance Sheet disclosure (`role="note"`) |
| Every figure | Total Assets 268,155.87 · Total Liabilities 12,230.12 · 3000 Owner's Equity 250,000.00 · Retained Earnings 0.00 · Current-period 5,925.75 · Total Equity 255,925.75 · Total Liabilities + Equity 268,155.87 · cards 268,156 / 12,230 / 255,926 / 268,156 ✓ Balanced | **identical** |

### Print

Before C8 final a printed report was blank: the shell's preview print rule (`mockup-parity.css`,
`body * { visibility: hidden !important }`) hid it, the reports' own print styles never showed it again (pre-existing,
measured on c47c65a: Chromium's print-to-PDF of the P&L carried no text). The reports' print styles now add
`.reports-print-area, .reports-print-area * { visibility: visible !important; }`: the printed P&L and Balance Sheet carry
their title, range, every line, the notice or the marker and disclosure, and nothing of the app shell or the workspace
controls (`mockup-parity.css` unchanged).

### Exports

| Export | c47c65a | C8 final |
|---|---|---|
| P&L CSV | `Section,Account,Amount` · Revenue lines · Total Revenue · `,Gross Profit,87000.75` · Operating Expenses lines · `,Operating Profit,5925.75` · `,Net Profit / (Loss),5925.75` | `Note,<the P&L notice>` · blank line · the same table without the three rows |
| P&L Excel | the table under the title | a Note row (bold label) above the table; the three rows gone |
| P&L PDF | the table | `Note: <the P&L notice>` as one header line (439.6 pt of 523.3 pt at 9 pt — not wrapped, not clipped); the three rows gone |
| Balance Sheet CSV / Excel / PDF | `Equity,Current-period Profit / (Loss),5925.75` | `Equity,Current-period Profit / (Loss) (Preliminary),5925.75` (149.3 pt of the PDF column's 168.4 pt — not clipped) and the disclosure as the header note (PDF: "Preliminary - …", WinAnsi) |
| Cash Flow, Trial Balance, General Ledger, AR / AP Aging, VAT Summary | — | **identical** — CSV and Excel to the byte, PDF to the text; every status, content type and file name identical (48 / 48 responses) |
| Without a session; another tenant | 307 → `/login` (the proxy's) | 307 → `/login`; Staff 200, as before; a second org's exports carry none of the seeded org's figures |

`report-export.ts` is unchanged: the notes use its existing header block (`meta`), which every format already renders.

### Project detail (`/projects/[id]`)

The h2 reads **Project Revenue & Costs** (إيرادات وتكاليف المشروع); Revenue and Costs stay its h3s. The remediation's
D-2 stays: one `StatRow columns={4}` — Sales Value, Invoiced, Collected, Total Cost — four across above 640 px and two
at ≤ 640 px; no Actual Profit, Profit Margin or `project_health` badge. `/projects/1`: Budget 185,000 · Tasks 8 —
Sales Value 0 · Invoiced 53,383 · Collected 53,383 · Total Cost 0; `/projects/2`: Budget 92,000 · Tasks 0 — 0 · 28,842 ·
11,537 · 0 (identical to c47c65a).

## Verifier contracts — the approved remediation's and C8 final's

The rule throughout: no blanket re-baseline. Every C0 – C7 and remediation pin keeps running against exactly the bytes it
pinned; the new policy gets its own positive and negative checks; the approved hunks are the only accepted change.

### `verify/verify-page-archetypes.mts` (233 → 250 checks)

| | c47c65a | C8 final |
|---|---|---|
| The four changed files | read as they are; the export route a business pin (`1533168860eddde6`, group 4); the reports workspace, the cost control and `dict.ts` held by the C3 / C4 hunks and body hashes and by group 16 (each the C7 bytes plus D-2's seven hunks) | `FIN_EDITS` holds C8 final's 16 hunks byte for byte (`[c47c65a text, final text]`: the reports workspace 8, the cost control 2, the export route 5, `dict.ts` 1). Groups 1 – 16 read the four files through `undoFin`, i.e. as c47c65a's exact bytes, so every older pin — C3's 39 and C4's 32 hunks, the report-body hashes, the SectionHeader inventory, the export route's and the dictionary's business pins, D-2's group 16 — runs unchanged |
| The delta | — | group 17: each hunk occurs once and its c47c65a form nowhere; undone, each file is c47c65a's to the byte (`f3eff79b5f4a060c`, `4c7a9c36d184733f`, `1533168860eddde6`, `ad171858a8128535`); every other `src` file is c47c65a's (495 files, `c05dcaf4283af501`); the engines, the registry and the shared exporter are their business pins |
| P&L | the cards are exactly Revenue and Net Profit; Operating Profit and Net Profit / (Loss) rows present (D-2) | Revenue the one card; `PnlView` reads no `grossProfit` / `operatingProfit` / `netProfit` and names none of them; the notice once, after the card, before the first group, with its Arabic; the factual groups, lines, drill-downs and Total Revenue present (the only rows) |
| Balance Sheet | — | the current-period row: its label + `PreliminaryMark`, its value `d.currentPeriodProfit`, after Retained Earnings, before Total Equity; the disclosure once, after Total Liabilities + Equity; the Arabic of both |
| Note / marker | — | `<p role="note">`, text-ink on surface-subtle (14.9:1 light, 13.5:1 dark), an `aria-hidden` icon; the marker the word itself, text-warning on its tint (5.2:1 / 8.6:1), a logical margin (`ms-1.5`, no `ml` / `mr`), no handler |
| Print | — | the reports' print styles keep hiding the chrome and the controls and show the report area again; `mockup-parity.css`'s rule unchanged |
| Project section | h2 "Cost & Profitability", four KPIs (group 11) | h2 "Project Revenue & Costs" with its Arabic, Revenue / Costs h3s, "Cost & Profitability" in no application code; still `StatRow columns={4}` with the four items; no profit, margin, health, `statusTextClass` or `StatusBadge` |
| Export route | a business pin; D-2's sweep names it as the one file still writing Gross Profit | **an authorized-delta guard instead of a new whole-file hash:** the 5 hunks exactly (undone: the business pin); the P&L rows exactly the account lines and Total Revenue, its note; the Balance Sheet's marked row with `money(d.currentPeriodProfit)` in Equity, its disclosure, the same number of rows; `requireSession()` first and once, `session.orgId` on all 9 queries, the report-kind guard, the eight branches, `moneyFor(session.orgCurrency)`, `meta` set only by the P&L and the Balance Sheet and handed to `exportResponse` |
| Exporter fit | — | with `report-export.ts` unchanged: each note one 9 pt PDF header line (439.6 / 442.7 pt ≤ 523.3 pt), the marked line inside its 8 pt column (149.3 ≤ 168.4 pt) |
| Dictionary | unchanged (`ad171858a8128535`) | exactly four new entries with their approved Arabic, no digit (Western or Arabic-Indic), no duplicate key (1755 keys) |
| Sweep | nothing outside `src/lib` names what D-2 hides — the export route the one exception | nothing outside `src/lib` names or reads any profitability metric — no exception left; Current-period Profit / (Loss) the one labelled result, marked Preliminary |

### `verify/verify-page-archetypes-runtime.mjs` (151 → 157 checks)

| | c47c65a | C8 final |
|---|---|---|
| P&L states (default, `?report=pl`, against the previous period, searched — EN / AR, 1440 / 390) | `c4ref` without the Gross Profit card and row (`withoutGrossProfit`) | `c4ref` without the Gross Profit and Net Profit cards and the Gross Profit, Operating Profit and Net Profit / (Loss) rows, with the notice after the one card (`withoutProfit`) — derived from the record, never re-recorded; the figures re-read from what is left |
| "D-2 applied (C8)" — Revenue and Net Profit | 14 states | replaced by **C8 final P&L**: Revenue the one card, no Gross / Operating / Net Profit card, row or word, the notice once in the page's language (14 states) |
| Balance Sheet states (`?report=bs`, against the previous period) | `c4ref` as recorded | `c4ref` with the current-period line + " Preliminary" and the disclosure last (`preliminary`) — and **C8 final Balance Sheet**: the line and its amount, the cards (Balanced), every figure and the row count as recorded (8 states) |
| Print | — | **C8 final print**: in print media (after the media switch's transitions finish) the report area shows, its title, every line the screen shows, the note shown in the page's language, nothing of the shell or the controls (EN / AR) |
| Exports | — | **C8 final exports**: the eight kinds × CSV / Excel / PDF × an EN and an AR session against `c8ref` (recorded on c47c65a, src clean): the P&L and the Balance Sheet with exactly the policy's changes (`c8Export`), every other kind identical; every status, content type and file name — 48 / 48 |
| PDF | — | **C8 final PDF exports readable and whole**: every PDF loads and nothing runs past the margin; nothing in the P&L or the Balance Sheet is clipped (the exporter's own clipping of long names in the wider reports is held to `c8ref`) |
| Authorization | — | **C8 final export authorization unchanged**: no session → 307 to `/login`; Staff as recorded |
| Tenant scope | — | **C8 final export tenant scope**: an org registered in the run (its TEST-only copy) asks for the eight CSV exports; each answers 200 and carries none of the seeded org's non-zero amounts (compared on the seven kinds that have one — the seed's AP Aging has no open payable at the range's end). Added after runtime mutation RF13 showed why it is needed: `src/proxy.ts` turns away a request without a valid session before the route runs, so only a second tenant shows that the route itself scopes its queries |
| Project outline | "Cost & Profitability (h2)" (`c3ref`) | the same outline with that one h2 renamed (`renamedOutline`); everything else of `c3ref` as recorded |
| Records | `d6`, `c3ref`, `c4ref`, `c6ref`, `c7ref` | unchanged; `c8ref` added (`--write-c8ref`, refused unless every export answered and every PDF parsed) |

Historical check descriptions keep their wording (for instance "C3 Cost & Profitability, C8's D-2 applied: exactly four
cards" — the section's name when that check was written); their assertions are unchanged.

### `tests/ui-baseline/archetype-states.mjs` (464 → 490 states)

The P&L against the previous period and searched ("4000"); the Balance Sheet at every width and dark, and against the
previous period; the P&L and the Balance Sheet in print media — 26 states, each failing the capture if the page is not
that report in that state. They assert only what c47c65a and C8 final share, so the approved build captures them too
(the before / after pairs); the policy itself is the runtime verifier's.

## Financial amounts preserved

Measured by the page-archetype runtime verifier itself (`--measure-out`) on the approved remediation's build (c47c65a,
`src` clean) and on the final candidate's — twice: `eqVD933_6_kX4m-55wjYa` (156/156, before the tenant probe was added)
and `kUFUuB8Va8xGStxtQyW-z` (157/157, the final tree) — same TEST-only seed, then
compared field by field (`values-cmp`): the final's P&L states must be c47c65a's with exactly the Net Profit card and the
Operating Profit and Net Profit / (Loss) rows taken out and the notice put in; its Balance Sheet states c47c65a's with
the current-period line marked and the disclosure appended; every other state identical in every field. **104 / 104
comparisons hold on both runs, 0 differ:** 16 project states (two projects × EN / AR × 1440 / 1024 / 768 / 390 — Budget, Tasks, the
four cost cards, no badge, the breakdowns) and 88 report / statement states and interactions — 14 P&L, 8 Balance Sheet,
and 66 identical: Cash Flow (and against the previous period), Trial Balance (default, Q2 custom range, searched,
drill-down), General Ledger (all accounts and an account), AR / AP Aging, VAT Summary (and against the previous period),
the client and vendor statements with and without a party and after the from-date filter, the P&L account drill-down.

| Figure (2026, the seed) | c47c65a | Final |
|---|---|---|
| P&L Revenue card · 4000 Sales Revenue · Total Revenue | 87,001 · 87,000.75 · 87,000.75 | identical |
| P&L Cost of Sales lines · Operating Expenses (5200 Salary Expense) | none in the seed · 81,075.00 | identical |
| P&L Net Profit card · Operating Profit · Net Profit / (Loss) | 5,926 · 5,925.75 · 5,925.75 | not shown (still computed by `finance-reports.ts`) |
| Balance Sheet: Total Assets · Total Liabilities · Owner's Equity · Retained Earnings | 268,155.87 · 12,230.12 · 250,000.00 · 0.00 | identical |
| Balance Sheet: Current-period Profit / (Loss) · Total Equity · Total Liabilities + Equity · check | 5,925.75 · 255,925.75 · 268,155.87 · Balanced | identical (the line marked Preliminary) |
| Projects: `/projects/1` · `/projects/2` | Sales Value 0 · Invoiced 53,383 · Collected 53,383 · Total Cost 0 · 0 · 28,842 · 11,537 · 0 | identical |
| Cash Flow, Trial Balance, General Ledger, Aging, VAT, statements | every figure | identical (11 / 35 / 250 / 61 + 13 / 11 figures on the EN 1440 states, and the rest) |
| Exports | — | the other six kinds identical to the byte (CSV, Excel) and to the text (PDF); the P&L and Balance Sheet amounts identical (`c8ref`) |

The hidden profitability figures are still computed — `finance-reports.ts` (`grossProfit`, `operatingProfit`,
`netProfit`) and `project-costing.ts` (`profit`, `marginPercent`, `health`) are byte-identical, and `verify:server`'s
project-costing suite (50/50) still tests them — but no screen or export shows them.

## DataTable — 10 / 10 / 3

The approved synchronization is unchanged: `closeFiltersByEscape()` in `verify/verify-datatable-runtime.mjs`
(`a1f6efb9eb734f7c`, byte-identical to c47c65a) waits for the Filters popover to close **and** keyboard focus to return
to the Filters trigger at both Filters → Views transitions; the pointer `openViews()` retry is unchanged;
`list-workspace-toolbar.tsx` is unchanged (`2bd2a430e47a76f5`). Every run below is the unmodified suite, a fresh
TEST-only database, no retries; each outcome as it came. The isolated runs and the replays ran on the frozen candidate
(diff `f48fddcab708`), the tiers on the final tree (`863c7704aaa4`); the two differ only in
`verify-page-archetypes-runtime.mjs` (the tenant probe), which no browser suite loads.

### 10 independent DataTable-only runs — 10 / 10 PASS

The unmodified tier runner (`verify/run-browser-suites.mjs --only=datatable`), each run on a fresh TEST-only database
copy of the seed, a fresh `npm start` and browser; the first run built (normal, unmocked), the rest reused that build
(`dCBTeGwCvGkrUIQ1PJhPW`). Two other lanes (screenshots, static mutation suites) ran beside them (load 4.3 – 6.7).

| Run | Time | Load | Result |
|---|---|---|---|
| dt1 | 04:04:58 | 4.68 | PASS 132/132 (134 s) |
| dt2 | 04:07:15 | 5.43 | PASS 132/132 (135 s) |
| dt3 | 04:09:32 | 6.05 | PASS 132/132 (136 s) |
| dt4 | 04:11:50 | 5.21 | PASS 132/132 (135 s) |
| dt5 | 04:14:04 | 4.52 | PASS 132/132 (133 s) |
| dt6 | 04:16:20 | 5.35 | PASS 132/132 (134 s) |
| dt7 | 04:18:37 | 5.84 | PASS 132/132 (135 s) |
| dt8 | 04:20:55 | 4.31 | PASS 132/132 (136 s) |
| dt9 | 04:23:10 | 6.23 | PASS 132/132 (134 s) |
| dt10 | 04:25:25 | 6.69 | PASS 132/132 (133 s) |

Every one includes the two focus-return checks ("Filters popover (status Sent chosen, before Save current view) … focus
is back on the Filters trigger", and the same before applying the saved view). Not counted, for the record: a first
launch of this lane, stopped by the operator at 04:01 to relaunch every lane detached from the session's 2-hour
background limit, had completed one run (PASS 132/132, build `pP05UX1frcwFuyTWj8_na`) and was interrupted in its
second — no failure was observed.

### 10 tier-prefix replays — DataTable 10 / 10 PASS

The tier's first 13 suites through DataTable, in its order, on one server and one fresh TEST-only database per replay
(the condition that reproduced the historical failure on exact C5), the same build:

| Replay | End | Load | DataTable | The other 12 suites |
|---|---|---|---|---|
| 1 | 04:37:48 | 5.09 | 132/132 | 11 exit 0; **`verify-controls-runtime.mjs` exit 1** — its first `page.goto('/__verify-controls/buttons', { waitUntil: "networkidle" })` timed out (60 s) before any check ran |
| 2 | 04:51:16 | 2.49 | 132/132 | all exit 0 |
| 3 | 05:03:42 | 3.52 | 132/132 | all exit 0 |
| 4 | 05:15:54 | 3.02 | 132/132 | all exit 0 |
| 5 | 05:28:03 | 2.12 | 132/132 | all exit 0 |
| 6 | 05:40:02 | 2.68 | 132/132 | all exit 0 |
| 7 | 05:52:20 | 2.23 | 132/132 | all exit 0 |
| 8 | 06:04:34 | 3.17 | 132/132 | all exit 0 |
| 9 | 06:17:03 | 2.51 | 132/132 | all exit 0 |
| 10 | 06:29:23 | 1.86 | 132/132 | all exit 0 |

Counts in every replay: account Arabic 34/34, advances 172/172, P0 Arabic-locale hydration 169/169, bank GL 21/21, bank
opening ✓, P0.2 business-date hydration 108/108, colour theme ✓, compliance claims ✓, confirm e2e 34/34, controls
302/302 (replays 2 – 10), currency lock 13/13, dark theme ✓, DataTable 132/132.

**The controls-suite timeout (replay 1) is a pre-existing, intermittent harness signature, not a C8 final regression.**
The identical failure — same suite, same first gallery navigation, same 60 s `networkidle` timeout — was recorded in C8
Stage 1 on exact C7 (replay round 2), before any C8 change, and classified there as a separate non-DataTable signature.
C8 final changes no control, primitive or gallery code (`src/components/ui`, the gallery and the suite are
byte-identical). Investigated without retrying the replay: (a) a probe of the suite's gallery navigation (route-fulfilled
HTML with the app's stylesheets and the esbuild bundle) on its own server, 28 navigations at load ~5 — median 628 ms,
maximum 763 ms, none late; (b) a port-shifted copy of the suite with request logging, run 12 times end to end on its own
server and database — **12 / 12 PASS 302/302**, the first gallery navigation 0.64 – 0.83 s, no timeout. The signature is
rare and timing-dependent (2 of 26 recorded runs of this suite — C8 Stage 1: 1 of 9; the remediation: 0 of 4; C8 final:
1 of 13 — both the first gallery navigation right after registering an org); the suite waits for `networkidle`, which Playwright documents as unreliable
for readiness. It is recorded as test debt (below). The suite was not modified — that is outside this batch's
authorized test scope — and every full tier below ran it green.

### Three complete 49-suite browser tiers

The complete `verify/run-browser-suites.mjs`, run alone on the final tree (`863c7704aaa4`), each with its own fresh
normal unmocked build (the runner's), a fresh TEST-only database and a temporary `.env` pointing only at it (removed
afterwards); no retries, none omitted.

| Tier | Started | Build | Duration | Result | DataTable |
|---|---|---|---|---|---|
| 1 | 06:47:34 | `S0ihz1jOYXBwSbgWJNlof` | 1,634 s | **49/49 suites passed**, exit 0 | 132/132 |
| 2 | 07:14:48 | `NqMUtvXivYAIryZNVPZ6U` | 1,585 s | **49/49 suites passed**, exit 0 | 132/132 |
| 3 | 07:41:13 | `yCsjL9J5DHERagJsFqYuw` | 1,606 s | **49/49 suites passed**, exit 0 | 132/132 |

Every suite's verdict and count is identical across the three tiers (listed under "Browser suites").

### The delayed-focus mutation (M3) — retained

The Filters popover's focus return delayed by ~150 ms on a mutation build: the final suite stays green (132/132) because it
waits for the actual return; the C7 suite on the same build (the control, the old synchronization) fails 129/130 with
the historical save-handoff signature (`out:dialog:save>button`). Details under "Mutation results".

## Final screenshot evidence

Same harness (`run.mjs` `030bd93ff4ce2ce8`, `archetype-states.mjs` `d97f67b5273c7bc9`), frozen clock, TEST-only seed,
pinned Chromium 141.0.7390.37, EN / AR, light / dark, 1440 / 1024 / 768 / 390, no masking. Each capture its own fresh
normal build. The final captures ran on the frozen candidate (`f48fddcab708`), whose application, harness and baseline
are the final tree's — it differs only in the runtime verifier, which the harness does not load.

| Capture | Build | States |
|---|---|---|
| final A | `P9-djXFnuDnfGAhUyDzMe` | 256 + shell 44 + lists 210 + documents 134 + archetypes 490 = 1,134 |
| final B | `gUvdNkKK8X_wzgk9LgxkO` | 1,134 |
| approved remediation c47c65a (`src` clean, the same harness) | `EZ81CmvvSfutKzPT3utJc` | 1,134 |

**Final A → final B: 1,134 / 1,134 byte-identical** (256 256/256, shell 44/44, lists 210/210, documents 134/134,
archetypes 490/490).

**c47c65a → final: 1,050 / 1,134 byte-identical; 84 differ, every one on an authorized surface; 0 differ anywhere
else; 0 missing.**

| Set | Differ | State IDs |
|---|---|---|
| 256 | 32 | `project-detail` (`/projects/1`) × 16 — EN / AR × light / dark × 1440 / 1024 / 768 / 390: the h2 renamed (page heights unchanged); `finance-reports` (the P&L) × 16 — the Net Profit card, Operating Profit and Net Profit / (Loss) gone, the notice (EN 1024: 824 → 788 px tall, 390: 1102 → 1028; AR 1024: 918 → 878, 390: 1102 → 1000; 1440 / 768 fit the viewport) |
| archetypes | 52 | `a09-project-kanban` × 10 and `a10-project-kanban-empty` × 10 (the h2); `i08-kanban-empty` 1440 × 2; `c4-profit-loss` × 4; `c8-pl-compare` × 4; `c8-pl-search` × 4; `c8-balance-sheet` × 10 (EN 1440: 1121 → 1185 px, the marker and the disclosure); `c8-bs-compare` × 4; `c8-pl-print` × 2; `c8-bs-print` × 2 |
| shell, lists, documents | 0 | — |

102 captured states are on an authorized surface; 84 changed and 18 did not — viewport screenshots whose visible area
holds nothing that changed: the kanban interactions `i03` × 4, `i06` × 4, `i07` × 4 (scrolled to the board or the
dialog), `i08` at 390 × 2, and the report picker by keyboard `i09` × 4 (it ends on Trial Balance).

**Print and export evidence** (`look-c8f.mjs`, `exports-c8f.mjs`; every PDF rendered with `pdftoppm` at 100 dpi; 80
files hashed per run): final A → final B **80 / 80 identical**. c47c65a → final: 42 differ — the P&L and Balance Sheet
exports (CSV, Excel, PDF render × EN / AR: 12) and the P&L / Balance Sheet / project screenshots and print renders (30);
**38 identical — every Cash Flow, Trial Balance, General Ledger, AR / AP Aging and VAT Summary CSV, Excel and PDF
render**. Chromium's print-to-PDF of c47c65a's P&L and Balance Sheet carries no text (blank); the final's carries the
report with its notice / marker and disclosure, in English and Arabic.

## Mutation results

Every mutation is applied in an isolated worktree, its verifiers run (each must fail), and the files are restored byte
for byte (each suite ends on the diff it started from, the frozen candidate `f48fddcab708`).

### C8 final static suite — 63 / 63 caught (`verify-page-archetypes.mts` must fail)

| Category | Caught | Mutations |
|---|---|---|
| Profit on the P&L screen, or the notice lost | 11 / 11 | the Net Profit card, the Operating Profit row, the Net Profit / (Loss) row, the Gross Profit card, the Gross Profit row back; a profit recomputed under a neutral label; a zero-valued Net Profit placeholder; the notice removed, reworded, moved below the statement; the print rule dropped (the printed report blank again) |
| Exports | 17 / 17 | the Gross Profit, Operating Profit and Net Profit / (Loss) rows back; a profit under a neutral label; the P&L note removed; the Balance Sheet marker or disclosure removed; its current-period amount changed; another kind changed (Cash Flow's title) or given a note (VAT); a Trial Balance amount column changed; **authorization weakened** (no session — the org from the query string); **tenant scope weakened** (one query on a fixed org); rounding changed; the fiscal-year start ignored; a P&L account group or Total Revenue deleted |
| Balance Sheet | 8 / 8 | the marker or the disclosure removed; the current-period amount changed or its line removed; the marker a colour only (its word gone); the disclosure claiming "Audited"; Total Equity removed; **the balance identity broken** (`finance-reports.ts`: equity without the current-period result) |
| Project section | 8 / 8 | the heading reverted to "Cost & Profitability", demoted to an h3, renamed otherwise; Actual Profit, Profit Margin or the `project_health` badge restored; Total Cost removed; `columns={3}` |
| Factual P&L content deleted | 6 / 6 | Cost of Sales lines, Operating Expenses lines, the Revenue card, Total Revenue, the account drill-down, Other Income lines |
| Finance and shared libraries | 6 / 6 | `finance-reports.ts`, `project-costing.ts`, `accounting.ts`, `settlement.ts`, `status-registry.ts`, `report-export.ts` |
| RTL / digits / translation | 7 / 7 | the Arabic notice with Arabic-Indic or Western digits; the Arabic "Preliminary" removed; the marker's margin physical (`ml-1.5`); the Arabic project heading changed; a duplicate dictionary key; the note a live region |

### Runtime — 15 / 15 caught (`verify-page-archetypes-runtime.mjs` must fail)

Each in its own worktree with a fresh normal build, scoped with `--only` to the P&L route (whose run also does the value
pass, the exports, the print pass and, in the final verifier, the tenant probe) or the two project routes; the counts
are out of 144 checks (the verifier before the tenant probe) except RF13's re-run (145): RF1 the Net Profit card (141/144),
RF2 the Operating Profit row (141/144), RF3 the notice removed (140/144), RF4 the export's Net Profit / (Loss) row
(143/144), RF5 the Preliminary marker removed (142/144), RF6 the current-period amount changed (142/144), RF7 the
export's disclosure removed (143/144), RF8 the balance identity broken in `finance-reports.ts` (141/144), RF9 the
project heading reverted (142/144), RF10 Actual Profit restored (140/144), RF11 the Operating Expenses lines deleted
(140/144), RF12 Cash Flow's export changed (143/144), RF14 the print rule dropped (143/144), RF15 the Arabic notice with
Arabic-Indic digits (142/144) — and **RF13, authorization weakened** (`requireSession()` replaced by an org taken from
the query string): the first run **missed it** (144/144), because `src/proxy.ts` answers a request without a valid
session with 307 → `/login` before the route runs, so the anonymous and Staff answers on the one-org seed did not
change (the static guard caught it). The runtime verifier now also observes tenant scope — an org registered in the run
asks for the eight CSV exports and none may carry the seeded org's amounts — and RF13 is **caught** (144/145).

### DataTable, app-side (each its own worktree, one mutation of `list-workspace-toolbar.tsx`, a fresh build)

* **M1** the Filters popover's focus return removed — caught, 120/122 (the focus-return check; the flow stops).
* **M2** the menu → Dialog handoff suppression removed — caught, 130/132 (save and manage handoffs).
* **M3** the focus return delayed by ~150 ms (still made) — **the final suite stays green, 132/132**, because it waits
  for the actual return; **the C7 suite on the same build (the control) fails, 129/130**, with the historical
  `out:dialog:save>button` save-handoff signature. The wait, not timing luck, is what holds.
* **M4** saved-view typing broken (8 characters kept) — caught, 125/128 ("Sent vie").
* **M4b** saved-view focus broken (the name field never focused) — caught, 121/122.

The DataTable suite's own synchronization and assertions (test-side) are guarded statically: the C8 remediation's T1–T8
(the focus-return condition dropped, either transition back to a bare Escape, a missing return ignored, a sleep instead
of the condition, the excursion rule weakened, `openViews()` refactored, typing delayed) — 8 / 8 caught again on the
final tree.

### Historical suites on the final tree

| Suite | Caught | Not applicable — why |
|---|---|---|
| C1 | 27 / 27 | — |
| C2 | 46 / 47 | X09 (`.acct-grid`): C4 itself made that change (pre-existing since C4) |
| C3 | 49 / 58 | X11 (`.acct-grid`, as C2 X09); M32 / M33 / M34, D03 / D04 obsolete by D-2 (their mutated state is what D-2 requires); M06, M24, M27 anchored on D-2's lines (re-expressed in the remediation: caught) |
| C4 | 61 / 66 | M10, D01 obsolete by D-2; D02, D03 re-expressed in the remediation (H6, H7: caught); **M09** (a reversed delta) was anchored on the Net Profit card C8 final removed — re-expressed on the Revenue card's delta (R1: caught) |
| C5 | 68 / 68 | — |
| C6 | 62 / 62 | — |
| C7 | 50 / 50 | — |
| C8 remediation | 29 / 34 | D3, D4 (the badge, anchored on the old title) re-expressed on the renamed section (J6, R3: caught); X2 (the title decided silently) re-expressed (J1, J3: caught); **F10** (Operating Profit removed) and **P3** (the export's Gross Profit removed) are superseded by design — their mutated state is now the approved policy; their inverses, P2 and E1, are caught |
| C8 remediation, re-expressed historical | 6 / 7 | H1 (C3 M06, the old title back to an h3) re-expressed on the renamed section (R2: caught) |
| C8 final, re-expressed | 3 / 3 | R1 (C4 M09), R2 (C3 M06 / remediation H1), R3 (remediation D4) |

**Totals:** static 464 caught, 0 missed, 21 not applicable — every one accounted for above (re-expressed and caught, or
superseded by the approved policy with its inverse caught); runtime 15 / 15 (RF13 after the tenant-scope check);
DataTable app-side 5 / 5 (M3 by design green on the final suite and red on the C7 control). Every suite restored its
worktree byte for byte.

## Browser suites

The three tiers above, each 49/49, every count identical to the approved remediation's tier: account Arabic 34/34,
advances 172/172, **P0 Arabic-locale hydration 169/169**, bank GL 21/21, bank opening ✓, **P0.2 business-date hydration
108/108**, colour theme ✓, compliance claims ✓, confirm e2e 34/34, **controls 302/302**, currency lock 13/13, dark theme
✓, **DataTable 132/132**, DC without bank 21/21, delete refusal 16/16, dirty core 72/72, dirty UI 8/8, document
attachments 14/14, **document form 188/188**, draft buttons ✓, draft func ✓, duplicate 40/40, **edit e2e 218/218**, edit
✓, expense categories hidden 16/16, favorites 20/20, FX dashboard 6/6, FX posting 108/108, note currency 19/19, payment
dialog 28/28, payment FX 66/66, PDF branding 15/15, preset ZATCA ✓, print apply ✓, private storage 22/22, proforma
payments ✓, rate one-click 28/28, rate screen 13/13, register outstanding 5/5, registration currency 20/20, reversal
status 16/16, **P0.1 settings time-zone hydration 85/85**, **shell 341/341**, sidebar scroll 14/14, skeleton 11/11,
**Staff replay 9/9, Staff runtime 20/20**, statement reversal 25/25, vendor inline 31/31. (✓: the suite's verdict line,
for suites that print no count.)

The other gates, on the final tree:

* `verify:page-archetypes` **250/250** (groups 1 – 16: 233, unchanged; group 17: 17).
* `verify:page-archetypes-runtime` **157/157** (build `kUFUuB8Va8xGStxtQyW-z`).
* `verify:static` exit 0 — role matrix 32/32, confirmation policy 62/62, dirty form 66/66, skeletons 89/89, contrast
  161/161, typography 43/43, status registry 88/88, shell 75/75, controls 110/110, DataTable 69/69, document form 77/77,
  edit-action 59/59, store model 69/69, provider harness 302/302, backup claims 26/26, money precision 12/12,
  number-locale (P0) 29/29, date-timezone (P0.1) 38/38, business-dates (P0.2) 44/44, ledger-only balances 8/8, page
  archetypes 250/250 — every count the approved remediation's but the last.
* `verify:server` exit 0 (fresh TEST-only database, no `.env`) — statements 70/70, project costing 50/50 (the engine's
  profit, margin and health still computed and tested), docs import 339/339, client import ✓, quotation import ✓,
  exchange rates 57/57, registration currency 34/34, money round-trip 44/44, base backfill 21/21, rate fetch 27/27, FX
  reporting 16/16, advances audit 18/18, allocations 23/23, backfill 16/16, release 15/15, credit-note release 40/40,
  refunds 10/10, clear 13/13, note FX 40/40, settlement 29/29, payment reversal 55/55, bank opening 18/18, bank opening
  backfill 31/31, DB hardening (both append-only triggers).
* `tsc --noEmit` exit 0; ESLint `--max-warnings=0` on the seven changed code files: 0 errors, 0 warnings.
* Normal, unmocked `next build` (Next.js 16.3.5, Turbopack) for every build used — no font mocks, no
  `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`, no package, configuration or environment change.

## Security, permissions and actions

From the final full runtime run (157/157, build `kUFUuB8Va8xGStxtQyW-z`, the final tree): 432 owner states (54 routes ×
EN / AR × 4 widths), 108 Staff and 108 time-zone sweep states.

* **Permissions:** where Staff land on every route is the baseline's (Staff are sent to `/dashboard` from Payroll,
  Business Settings, Presets and Compliance; they open every other 01.7 route); the export URL answers 307 → `/login`
  without a session and 200 for Staff, as recorded on c47c65a; a second tenant gets only its own figures. No
  permission, role, session or proxy code changed (`src/proxy.ts`, `src/lib/session*`, the role matrix — byte-identical).
* **Actions:** the owner inventory unchanged — 1629 actions (EN + AR at 1440, EN at 390: name, target, type, disabled) —
  and Staff's 1050 (`page-archetype-actions.json` unchanged). C8 final added no control and removed none: the notices
  and the marker are text, the cards and rows it removed were figures.
* **Never worse:** page overflow 0, overflowing elements 0, heading-level skips 0, tables past the viewport 0,
  Arabic-Indic digits 0; unnamed controls 64, pointer-only clickables 16, unprompted "unsaved changes" prompts 48 — as
  before; console errors and page errors never more; **zero React #418 across all 648 measured states**.
* **Headings:** one h1 per page, the outlines exact — a project's is its name (h1), Project Revenue & Costs (h2) ›
  Revenue, Costs (h3), Tasks (h2) …; the reports' h2 the report's name.
* **Disclosures:** the P&L notice and the Balance Sheet disclosure are `role="note"` paragraphs inside the report, read
  in place (not a live region), in the page's language; the marker is the word Preliminary / مبدئي beside the label it
  qualifies, not a colour alone; text contrast 14.9:1 (light) / 13.5:1 (dark) for the notes and 5.2:1 / 8.6:1 for the
  marker; no digit in any new string; the Arabic page reads right to left with the marker on the label's inline end
  (logical `ms-1.5`).

## Deferred UI debt (recorded, not fixed here)

* Carried from C5 / C6 / C7, unchanged: the `RISK_STYLE` migration and the undefined `--warn` / `--crit` / `--good`
  (+ `-bg`) tokens (Security's risk pill and alert stripe); the import dialog's Arabic "max ١٠ ميجابايت" (the
  dictionary's last Arabic-Indic digits); Dashboard CSS no markup uses; the revenue chart's crowded bucket labels at 30
  days; desktop widget spans; "Feature Highlights" naming one card; KPI weight 800; Settings gradient wording, unnamed
  colour inputs, Presets' pointer-only Add, title / navigation mismatches, translation debt, URL tab sync, input bidi,
  consent raw keys, C4's physical utilities, the `.settings-nav-item` focus style; the error screen's translation,
  app-state wording, the streamed not-found's HTTP status and loading boundaries.
* The runtime "never more" counters stay where they were — unnamed controls 64, pointer-only clickables 16, unprompted
  "unsaved changes" prompts 48 — recorded, not declared fixed.
* Test debt: the DataTable suite's pointer `openViews()` retry (unchanged, as approved); the controls suite's first
  gallery navigation waits for `networkidle`, which intermittently never comes (see the DataTable section).
* Found in C8 final, pre-existing and out of scope (the shared exporter is frozen): an Arabic session's PDF export drops
  the Arabic account names (WinAnsi); the exporter clips long cells in the eight-column Trial Balance / General Ledger
  and the AR Aging PDF ("..."); its PDF header rule is drawn through the first row's top. On screen, Revenue — now the
  P&L's one card — spans the card row (the existing `Cards` auto-fit).

## Outstanding accounting limitation — COGS and inventory valuation

No Cost of Sales is ever posted (no inventory valuation / COGS mechanism), so the ledger's revenue-minus-expenses
results overstate profit: the seed's Gross Profit equals its revenue (87,000.75) and its Net Profit (5,925.75) carries
no cost of goods. C8 final hides the P&L's profit figures and marks the Balance Sheet's current-period result
Preliminary; it does not fix the accounting. `finance-reports.ts` still computes `grossProfit`, `operatingProfit` and
`netProfit`, `project-costing.ts` still computes `profit`, `marginPercent` and `health` (tested by `verify:server`),
and the Balance Sheet still balances with the current-period result in Equity. Implementing inventory valuation and
COGS posting is a separate accounting project; until it ships, no financial statement from this system should be
released as final, and the notices must stay.

## Git and branch identity

* Repository `Delowar01/Elite-ERP`, branch `claude/dev-ui-01-7-page-archetypes`.
* Parent (verified before any edit, local = remote): `c47c65a3cbec35f8afe938ef8d928766d7f3ca3e`, tree
  `6033b0bd433e179ad74f7c6bb8acf9ebaca6a5a5`; main `1bfdbbf2fe6bf10f02490dd1b292b0211e39fe50`; 9 ahead / 0 behind;
  clean worktree.
* This change: exactly one commit on that parent — the four application files, the two verifiers, the runtime baseline
  (`c8ref` added), the capture harness and this document — pushed normally (fast-forward); expected 10 ahead / 0 behind
  main. No rebase, merge, reset, amend, stash or force-push; nothing merged to main; nothing deployed.

## Release-readiness assessment

**Ready for independent review as the DEV-UI-01.7 frontend modernization's final C8 candidate.** Every authorized
financial surface shows the product owner's policy on screen, in print and in all three export formats; every surviving
figure equals the approved remediation's; the accounting engines, posting, schema, security and permissions are
untouched; the historical C0 – C7 and remediation guards run unchanged against the approved bytes, with new positive and
negative guards for the policy; the DataTable budget (10 / 10 / 3) is met; the screenshot inventory is byte-stable (A = B)
and differs from the approved remediation only on the authorized surfaces.

What it is not: it does not certify the ERP's accounting, and it does not make the P&L or the Balance Sheet releasable as
final financial statements — Cost of Sales and inventory valuation remain unimplemented (above). Open items carried
forward: that accounting project; the deferred UI debt listed above; the controls suite's intermittent first-navigation
timeout (test debt, pre-existing).
