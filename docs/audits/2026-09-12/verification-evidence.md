# Verification Evidence — Elite ERP Master Audit

**Original pass:** 12 September 2026 · **Correction and completion pass:** 12 September 2026
**Repository:** [Delowar01/Elite-ERP](https://github.com/Delowar01/Elite-ERP)
**Revision:** `main` @ [`04457ff`](https://github.com/Delowar01/Elite-ERP/commit/04457ff29948111bd5d24eff3eaf4e75b90971cf) · working tree clean

What was actually executed, in what environment, and what came back. Conclusions
live in [`master-system-audit.md`](master-system-audit.md); its **§0 correction
log** lists the eleven conclusions this pass changed.

---

## 0. Environment and safety

All write-capable verification ran against a **disposable local PostgreSQL
database created for this audit and dropped afterwards**. *(Wording corrected —
C-6: the first report said "live database" in places. Nothing in this audit ever
touched a live system.)*

| Property | Value |
|---|---|
| Database | `elite_erp_audit` on local PostgreSQL 16.13, `127.0.0.1:5432` |
| Role | `erp_audit`, created for this audit |
| Schema load | `npx drizzle-kit push --force`, then `npm run db:harden` |
| Extra disposable DBs | `db_mig`, `db_push` — created and dropped by the migration trial |
| Node | v22.22.2 · **Browser** Chromium 1194 via Playwright 1.61.1 |
| App server | `npm start` on the production build of `04457ff`, localhost only |

**No production or shared system was contacted at any point.** No production
credentials were present and none were sought. `.env` held audit-only values and
is covered by `.gitignore:35` (verified with `git check-ignore -v .env`); it was
deleted afterwards.

**Nothing in the application, configuration, schema, or `drizzle/` migration
history was modified.** The migration trial wrote only into `evidence/` and never
into `drizzle/` — confirmed with `git status --porcelain drizzle/` returning
empty. No test was edited to obtain a pass.

---

## 1. Reproducible artefacts

Everything below is in [`evidence/`](evidence/) and re-runnable.

| File | What it does |
|---|---|
| `repro-statements-reversal.mjs` | Registers an org through the real form, then drives **`recordPaymentAction`** and **`reversePaymentAction`** over the wire with a genuine owner session; writes fixture ids |
| `repro-statements-compare.mts` | Calls the real **`getStatement`** and compares it with the ledger |
| `repro-statements-actions.txt`, `repro-statements-result.txt`, `repro-statements-fixture.json` | Outputs |
| `repro-fractional-stock.mjs` / `.txt` | Traces 1.5 through every stock path and measures the integer column's behaviour |
| `repro-ui-coverage.mjs` / `.txt` | 29 routes × 3 viewports; Arabic sweep; keyboard probe |
| `repro-migration-baseline.sh` / `.txt` | Builds two disposable databases — migrations-only vs `push` — and diffs them |
| `production-verification.sql` + `README.md` | Read-only production checks for the owner (§9) |

---

## 2. Source of truth

```
$ git log --oneline -1
04457ff Deploy runbook for the three undeployed changes, as one schema step
$ git status --porcelain
(empty)
```

`04457ff` — the commit a previous review examined on 19 August — **is still
`HEAD`**. `CLAUDE.md` is present; **there is no `AGENTS.md`**.

---

## 3. Repository inventory

| Measure | Count |
|---|---|
| Tracked files | 631 |
| TypeScript/TSX under `src/` | 476 · **57,267 LOC** |
| Page routes | 72 · **API route handlers** 7 |
| Server-action files | 48 · **exported actions** ~220 |
| **Physical tables (pushed schema)** | **66** (`information_schema`) |
| Files in `verify/` | 71 — **3 helpers, 68 candidate suites** |
| CI workflows | 1 |

---

## 4. Suite inventory — discovered vs runnable vs executed *(C-3, C-4)*

The first report collapsed three different numbers into "71 verify suites". They
are distinct:

| Category | Count | Definition |
|---|---|---|
| **Files** in `verify/` | **71** | `.mjs` + `.mts` |
| **Helpers** | **3** | `assert-fresh-build`, `register-org`, `run-browser-suites` — not suites |
| **Candidate suites** | **68** | files minus helpers |
| **Browser-discovered** | **36** | `.mjs` containing `localhost:3000`; the runner finds these by scanning |
| **npm-wired** | **32** | named by a script inside `verify:static` or `verify:server` |
| **Executed in this audit** | **68** | 8 static + 24 server + 36 browser |
| **Reachable by no runner** | **1** | **`verify-duedate.mjs`** |

**`verify-duedate.mjs` is an orphan.** It is a database-only `.mjs` with no
`localhost:3000`, so the browser runner skips it, and no npm script names it
(`grep -c verify-duedate package.json` → `0`). The first report cited it as
automated evidence for payment terms and due dates; **that citation was wrong.**
I ran it by hand for this pass:

```
$ npx tsx --env-file-if-exists=.env --conditions=react-server verify/verify-duedate.mjs
9/9 checks
DUE DATE VERIFICATION PASS
```

So it passes — but only because someone ran it deliberately. This is the
repository's own catalogued species ("a suite that never runs") at file level.

---

## 5. Assertion counts, reconciled *(C-3)*

The first report said "25 server suites, ~860 assertions". Both were wrong.

```
$ node -e 'console.log(require("./package.json").scripts["verify:server"].split("&&").length)'
24
```

| Tier | Suites | Reporting a count | Assertions counted | Result |
|---|---|---|---|---|
| **Static** | **8** | 6 as `N/N checks`, 2 as `N passed` | **388** | PASS, 0 fail |
| **Server** | **24** | 21 as `N/N checks` = **957**; `verify:client-import` 60 and `verify:import` 90 as `PASS` lines; `verify:db-hardening` is a state gate with no count | **1,107** | PASS, 0 fail |
| **Browser** | **36** | 26 of 36 | **972** | **36/36**, 0 fail |
| **Total executed** | **68** | | **2,467** | **0 failures** |

Static per suite: `role-matrix` 32 · `confirm-policy` 62 · `dirty-form` 66 ·
`skeletons` 89 · `contrast` 60 · `edit-action` 59 · `money-precision` 12 ·
`ledger-only-balances` 8.

Server, the 21 with counts: `statements` 70 · `project-costing` 41 ·
`docs-import` 339 · `exchange-rates` 57 · `registration-currency` 34 ·
`money-round-trip` 44 · `base-backfill` 21 · `rate-fetch` 27 · `fx-reporting` 16
· `advances-audit` 18 · `advance-allocations` 23 · `advance-backfill` 16 ·
`advance-release` 15 · `credit-note-release` 40 · `advance-refunds` 10 ·
`advance-clear` 13 · `note-fx` 40 · `settlement` 29 · `payment-reversal` 55 ·
`bank-opening` 18 · `bank-opening-backfill` 31 = **957**.

**Every suite with a runner passed.** That is the context for §6: every defect
below sits where these suites do not reach.

---

## 6. F-10 — Statements silently drop payment reversals *(NEW — corrects C-1)*

The first report concluded statements were unaffected by payment reversal because
their amounts are ledger-derived. **That was wrong.**

### 6.1 The mechanism

`src/lib/statements.ts` resolves each control-account line to a party by walking
`sourceType`/`sourceId` to the source document, then **discards any line it could
not attribute**:

```ts
// line 461-462
.map((r) => ({ r, a: r.sourceId != null ? attr.get(keyOf(r.sourceType, r.sourceId, r.account)) : undefined }))
.filter((x): x is { r: RawLine; a: Attribution } => !!x.a && x.a.partyId === partyId);
```

Attribution keys are created for `sales_invoice`, `credit_note`, `payment`,
`advance_application`, `advance_application_release`,
**`advance_application_release_reversal`**, `purchase_order` and `debit_note`.
**`payment_reversal` is not among them** — `idsOf("payment")` (lines 227 and 359)
matches only `sourceType='payment'`. The reversal's lines resolve to nothing and
vanish.

### 6.2 Method

Real production actions, no stubbing. `recordPaymentAction` takes `FormData`, so
it uses the **form-post protocol** (`$ACTION_ID_<id>` body field); the
`Next-Action` header variant returns 500 and writes nothing — both were tried
before settling. `reversePaymentAction` takes a number and uses the header
variant. The session is a genuine owner cookie from the real registration form.

```
Next-Action ids: recordPaymentAction=407773819e… reversePaymentAction=400cacd99e…
registered org, genuine OWNER cookie captured: true
   recordPaymentAction -> {"status":200,"wrote":true}
   reversePaymentAction -> {"status":200, ... "1:{}"}
```

The ledger afterwards — the source of truth:

```
2026-06-01 sales_invoice#8  1100 Dr 1000.000 Cr 0.000
2026-06-15 payment#10       1100 Dr 0.000    Cr 400.000
2026-07-01 purchase_order#3 2000 Dr 0.000    Cr 1000.000
2026-07-01 sales_invoice#7  1100 Dr 1000.000 Cr 0.000
2026-08-05 payment#8        1100 Dr 0.000    Cr 400.000
2026-08-05 payment#9        2000 Dr 400.000  Cr 0.000
2026-09-12 payment_reversal#8  1100 Dr 400.000 Cr 0.000
2026-09-12 payment_reversal#9  2000 Dr 0.000   Cr 400.000
2026-09-12 payment_reversal#10 1100 Dr 400.000 Cr 0.000
control balances: 1100=2000.000  2000=-1000.000
```

Reversals post at **today's date**, so the statement window was widened to
`2026-08-01 .. 2026-09-30` to put the reversal inside the period by date —
otherwise the test would have been confounded by a date filter rather than
testing attribution.

### 6.3 Result — `getStatement` vs the ledger

```
── Scenario A — client, payment 400 in period, reversal in period
   rows returned : 1     · 2026-08-05  payment_in  Dr 0  Cr 400  bal 600
   opening 1000 · closing 600 · LEDGER @2026-09-30: 1000
   DISAGREE (difference -400.000)   · reversal line present? NO · exported CSV rows: 1

── Scenario B — vendor PO, payment 400 in period, reversal in period
   opening 1000 · closing 600 · LEDGER: 1000
   DISAGREE (-400.000) · reversal present? NO

── Scenario C — payment BEFORE the period, reversal inside it
   rows returned : 0
   opening 600 · closing 600 · LEDGER: 1000
   DISAGREE (-400.000) · reversal present? NO

── Scenario D — vendor payment, PO dated OUTSIDE the selected range
   opening 1000 · closing 600 · LEDGER: 1000
   DISAGREE (-400.000) · reversal present? NO
```

**4 of 4 disagree with the ledger by exactly the payment amount.**

### 6.4 What each scenario adds

- **A and B** — the defect is symmetric across AR and AP.
- **C is the worst.** The payment precedes the period, so it lands in `opening`; its reversal is dropped from `opening` too. The customer receives a statement with **zero rows and a wrong opening balance** — no visible activity to question.
- **D answers a question that turned out to be a non-defect.** Vendor attribution where the PO lies outside the selected range **works correctly** — the PO is properly reflected in `opening`, because `controlAccountLines` fetches everything up to `to` and attribution walks to the source document regardless of date. The entire 400 gap is the reversal. **Recorded as "no defect found" rather than folded into the finding.**

The exported CSV carries the same error (1 row, no reversal), so the
customer-facing artefact is affected, not only the screen.

### 6.5 Why no suite caught it

`verify:statements` passes 70/70. It **hand-rolls journal inserts** with its own
`post(o, date, memo, sourceType, sourceId, lines)` helper rather than driving
actions, and never creates a `payment_reversal` entry. It could not have caught
this. The fix has a template in the same file: `advance_application_release_reversal`
is already handled beside its non-reversal sibling.

---

## 7. C-2 — Fractional quantities: two different things

| Column | Type |
|---|---|
| `products.quantity_on_hand` | **integer** |
| `sales_invoice_items.quantity`, `purchase_order_items.quantity` (+7 peers) | **numeric(12,2)** |

**Decimal document quantities work.** A 1.5 @ 200.000 line posts 300.000; tax and
the ledger follow. **Money is not affected.**

**Fractional stock does not exist.** Five sites truncate:

| Site | Direction |
|---|---|
| `src/lib/invoice-posting.ts:103` | − |
| `src/app/(app)/sales/invoices/actions.ts:374` | + |
| `src/app/(app)/purchasing/orders/actions.ts:278` | + |
| `src/app/(app)/purchasing/debit-notes/actions.ts:257` | − |
| `src/app/(app)/purchasing/debit-notes/actions.ts:326` | + |

```
document quantity 1.5  -> stock moves by 1
document quantity 0.5  -> stock moves by 0
document quantity 2.75 -> stock moves by 2
```

`adjustStockAction` computes `product.quantityOnHand + delta` with **no**
truncation and hands it to Drizzle, which binds it as a parameter:

```
delta 1.5: bound as a PARAMETER -> ERROR 22P02 invalid input syntax for type integer: "1.5"
          as an inline LITERAL cast  -> 2  (rounds half away from zero)
```

Drizzle binds parameters, so **the adjustment write fails outright** — the action
throws. The two paths therefore disagree: the same 1.5 moves stock by 1 through a
document and is rejected through an adjustment.

Drift on repeated document movements:

```
receipt 1: real 1.5 · on hand 1 · drift 0.5
receipt 4: real 6.0 · on hand 4 · drift 2.0
```

---

## 8. C-10 — Responsive, Arabic and keyboard, measured

Previously reported as "blocked". A browser was available, so they were measured:
29 routes, Chromium.

### 8.1 Horizontal overflow

| Viewport | Routes overflowing |
|---|---|
| desktop 1440×900 | **0 of 29** |
| **tablet 768×1024** | **29 of 29** |
| **mobile 390×844** | **29 of 29** |

Worst element on every mobile route: `div.topbar-actions` at **653px against a
390px viewport** (+555px). **Tablet failing as completely as mobile** is the
finding — this is not a phone-polish gap.

### 8.2 Arabic — two distinct classes *(C-9)*

`dir="rtl"` is applied correctly at the document root. Latin text nevertheless
appeared on all 29 routes. Separating signal from fixture data required going to
source, which produced two different defects:

**(a) Keys passed to `t()` but absent from the dictionary.** Every literal
`t(locale, "…")` key in `src/` was checked against `dict.ts`:

```
dictionary entries: 1587
t(locale,"…") literal call sites: 1997   distinct keys: 1126
KEYS USED BUT ABSENT FROM THE DICTIONARY: 27 -> 30 call sites
```

Because English **is** the dictionary key, these render English in Arabic with no
error and no missing-key marker. Concentrations: `settings/organization/reference-panels.tsx`
(6), `finance/_shared/refund-advance-button.tsx` (4), `settings/organization/page.tsx`
(4), across 13 files. Examples: `"Amount to refund"`, `"More than the available
balance of this advance."`, `"Search"`, `"Document type"`, `"No credit notes yet."`,
`"Departments are the filter tabs at the top of Employees…"`.

**(b) Strings never routed through `t()` at all.** ~50 literal English strings in
`title`/`label`/`placeholder`/`description` props across 24 files:

```
  8  purchasing/vendors/vendor-form.tsx   e.g. ["Logo","Upload Logo","Name"]
  7  inventory/products/product-form.tsx  e.g. ["SKU","Unit","Name"]
  4  dashboard/page.tsx                   e.g. ["Total Sales","Total Invoices","Total Receivables"]
  3  app/print/[type]/[id]/page.tsx       e.g. ["SUPPLY FROM","DELIVERED TO"]
```

An upper bound — a few (`"Layla Khan"`, `"Accountant"`) are deliberate example
placeholders. The dashboard KPI titles and the **customer-facing print
template** are not.

**Why the first report missed this:** it measured the dictionary's internal
completeness (1,587 entries, one placeholder without Arabic) and treated that as
UI coverage. It is not the same measurement.

### 8.3 Keyboard — good

| Route | Focusable | Reached by Tab (first 30) | With a visible focus indicator |
|---|---|---|---|
| `/dashboard` | 57 | 30 | **30** |
| `/sales/invoices` | 54 | 30 | **30** |
| `/sales/invoices/new` | 80 | 30 | **30** |
| `/clients` | 51 | 30 | **30** |

Screen-reader behaviour and semantic structure remain **not yet examined**.

---

## 9. Migration and baseline behaviour, measured

Two disposable databases, neither production; `drizzle/` untouched throughout.

| | tables | columns |
|---|---|---|
| `db_mig` — committed migrations `0000`–`0004` only | **59** | **609** |
| `db_push` — `drizzle-kit push` from the current schema | **66** | **812** |
| shared by both, **byte-identical** | — | **608** |
| only in `db_push` — must be **added** | **7 tables** | **204** |
| only in `db_mig` — must be **dropped** | — | **1** |

**Reconciling the two figures, because 812 − 609 = 203, not 204:**

```
608 shared + 1 only-in-migrations = 609   (db_mig)
608 shared + 204 only-in-push     = 812   (db_push)
net 812 − 609 = 203 = 204 added − 1 dropped
```

Both are correct. **204** is the set difference — columns a new migration must
**add**. **203** is the net change in column count, lower by exactly the one
column that must be **dropped**.

Comparing on full fingerprints (identity + `data_type` + `is_nullable` +
`column_default`) returns **the same 1 and 204**. That equality is itself a
result: **no shared column differs in type, nullability or default**, so the gap
is purely additive plus one drop, with no in-place modifications.

The one dropped column is `terms_conditions_groups.content` (`text NOT NULL`),
replaced in commit `15ef378` by `terms_conditions_groups.terms`
(`jsonb NOT NULL DEFAULT '[]'`):

```
db_mig  terms_conditions_groups: id, org_id, name, document_type, content text,  is_default
db_push terms_conditions_groups: id, org_id, name, document_type, terms jsonb,   is_default
```

Absent from a migrations-only database: `advance_applications`,
`advance_application_releases`, `document_attachments`,
`document_column_configs`, `exchange_rates`, `rate_fetch_attempts`,
`seal_signature_assets`.

**Two findings beyond the size of the gap:**

1. **`drizzle-kit generate` cannot run non-interactively here.** It fails at `promptColumnsConflicts` — *"Interactive prompts require a TTY"*. The cause is now identified exactly: **one** table (`terms_conditions_groups`) both loses a column and gains one, so the tool cannot tell a rename from a drop-and-create and must ask. **There is exactly one such decision**, so "regenerate the migrations" is not a mechanical step — but it is also not an open-ended one.

   *(Corrected: an earlier draft attributed this to `openingBalance` → `openingBalanceLegacy`. **That was wrong** — that rename changed only the Drizzle field name; the SQL column is still `opening_balance` (`src/db/schema/finance.ts:48`) and appears in **both** databases, so it produces no diff at all. The guess was never verified; this pass verified it and found it false.)*
2. **Neither path installs the audit triggers** — 0 of 2 on both `db_mig` and `db_push`. Only `npm run db:push` installs them, because the **npm script** chains `db:harden`; a bare `drizzle-kit push` does not. The deploy sequence must keep `db:harden` regardless of which schema path is used.

---

## 10. CI evidence *(C-7)*

Retrieved from the GitHub Actions API for the audited commit.
**Run 131 — `04457ff` — conclusion `failure`.**

| Job | Conclusion |
|---|---|
| Static analysis (lint + types) | **success** |
| Secret scanning (gitleaks) | **success** |
| Dependency vulnerability scan | **failure** |
| Security tests + production build | **failure** — crashed at step 6; steps 7 and 8 **skipped** |

```
PASS  found server-action files to audit        (…6 assertions pass…)
Error: ENOENT: no such file or directory, open
  '/home/runner/work/Elite-ERP/Elite-ERP/src/app/uploads/[folder]/[file]/route.ts'
    at tests/security/access-control.test.mjs:51:21
```

The route is at `src/app/uploads/[...path]/route.ts`. `readFileSync` throws, Node
exits 1, the job stops. **Ten assertions never execute** — the upload route's
session/signed-URL/org/audit checks, the signed-URL HMAC/`timingSafeEqual`/expiry
checks, the login rate-limit and MFA checks, `.env is gitignored`, and **`no
insecure AUTH_SECRET fallback`**. CI's security coverage is 6 assertions, not 16.

> **Corrected during Batch 1 (C-14).** This section previously said 17 assertions
> and 11 unreached. The file at `e8969a1` has **16** `ok()` calls — 6 reached,
> **10** not — and the two security files hold **34** between them, not 35. The
> Batch 1 repair adds a resolution guard, so the suite now reports 17/17; that 17
> is the count *after* the fix.

**Corrected claim.** The first report said "CI has never verified that this
application builds." The evidence supports only: **in the 10 most recent runs on
`main` — the history actually inspected — the build step was never reached**,
because the same crash preceded it each time. Runs 1–121 were not examined.

The build itself is green:

```
$ npm run build
▲ Next.js 16.2.10 (Turbopack)
✓ Compiled successfully in 17.5s
BUILD_EXIT=0
```

All 72 routes are `ƒ (Dynamic) — server-rendered on demand`.

---

## 11. Dependencies *(C-11)*

`npm ci` on the committed lockfile, 12 September 2026:
**18 vulnerabilities (8 moderate, 9 high, 1 critical package)** — up from 16 in
the 19 August CI run, with the code unchanged.

`next` 16.2.10 carries 11 advisories, **2 critical**: GHSA-p293-qw3h-jr36 (CVSS
9.0) and GHSA-2xp9-vwfh-vxw4 (CVSS 9.5); 4 high; 5 moderate.

**Applicability verified against primary sources** (GitHub Advisory Database)
and this app's actual configuration — see the audit §6.3 for the full table. In
short: the Windows RCE **cannot affect a Vercel/Linux deployment**; the
middleware-bypass requires a single-entry `config.i18n.locales` this app **does
not have** (no `i18n` block at all); two SSRF advisories require a **custom
server** or **`rewrites`**, neither of which exists. What genuinely applies is a
Server-Actions DoS and an endpoint-disclosure class.

**Version facts:** the criticals are patched in **16.3.3**; npm suggests
**16.3.5**. `16.2.10 → 16.3.x` is a **minor** bump — `isSemVerMajor:false` means
"not a major", not "compatible".

**After the `next` bump, six high packages remain**, so
`npm audit --audit-level=high` still fails:

| Package | Fix |
|---|---|
| `brace-expansion`, `browserslist`, `js-yaml`, `nanoid` | `npm audit fix`, in place |
| `@puppeteer/browsers`, `extract-zip`, `puppeteer-core` | `puppeteer-core@25.10.0` — **major** |

---

## 12. Correction to F-1's method *(C-5)*

F-1 stands as a defect. Its **method was overstated**. The reproduction is a
**differential between two production library functions** — `invoiceStatusAfter`
and `settlementOf` — fed the values the action computes. **It is not an exercised
server action writing to a database.**

```
Invoice total 1,000.00 SAR, payment 400.00, credit note 600.00. Reverse the payment.
paid after reversal : 0.00
status written      : sent
settlementOf says   : partially_paid | outstanding 400.00 | settled 600.00
DISAGREE

fully-credited invoice, payment reversed:
  status written: sent | settlementOf: paid
```

What *was* read directly is the action's SQL: the `SELECT … FOR UPDATE` at
`finance/payments/actions.ts:966-969` does not select `credited_amount`, so the
value is not available to the branch at line 985. Source inspection plus a
library differential — stated as such.

---

## 13. Findings that stand unchanged

**F-2** project cash omits `reversed_at is null` (`project-costing.ts:237-253`);
every `payments` reader enumerated, only two are reversal-aware. **Its risk
description was corrected**: `profit = invoiced − totalCost` and
`marginPercent = profit / invoiced` (lines 393-394, 452) **do not read cash**, so
the defect overstates the *Received Payments* figure only — **not profit or
margin**.

**F-3** blob objects public with `addRandomSuffix:false`; `blobUrlFromStored()`
has no callers, so no URL is currently emitted — a latent design gap, not a
present leak. **F-6** migrations stale — now quantified in §9. **F-8** proformas
have no `projectId`. **F-9** re-derived at HEAD: `agingFrom` line 353 still
`if (outstanding <= 0) continue`, so a cash-paid credited invoice is dropped from
aging while GL 1100 keeps the negative. **N-1**, **N-2**, **N-3**, **N-4** as
reported.

**New in this pass beyond F-10:** payroll posts **net**, so deductions never
reach the ledger (`hr/payroll/actions.ts:50-100`, documented in source as a
deliberate boundary); **attendance and leave do not feed payroll** (zero
references); **no vendor bills**, **no bank reconciliation**, **no period
lock**; **document revisions do not exist for any type** (zero occurrences of
`revision`); **`backup.sh` tars a local `./uploads` that no longer exists,
prints "skipping", and exits 0**; and **`src/proxy.ts`** is a real edge auth gate
the first report said did not exist.

---

## 14. Production verification pack

[`evidence/production-verification.sql`](evidence/production-verification.sql) —
six annotated read-only queries. **Executed successfully against the disposable
audit database**, so they are known to parse and return what their comments say:

```
$ psql … -f production-verification.sql
Q1: 6 of 6 columns present
Q3: all seven tables present = 1
Q4: audit_logs_immutable, security_events_immutable  (2 rows)
Q5: bank backfill 0 · invoices with notes but zero credited 0 · unconverted 8
Q6: payments_reversed 9 · reversal_entries 9 · last_reversal 2026-09-12
errors: 0
```

One query was **wrong on the first run** — it referenced `credit_notes.sales_invoice_id`,
which does not exist (the column is `source_invoice_id`). Caught by running it;
fixed and re-run clean. Shipping it unexecuted would have handed the owner a
broken query.

---

## 15. Reproducing this

```bash
git clone https://github.com/Delowar01/Elite-ERP && cd Elite-ERP && git checkout 04457ff
npm ci
createdb elite_erp_audit                       # disposable; never production
cat > .env <<EOF
DATABASE_URL=postgresql://…/elite_erp_audit
AUTH_SECRET=<32+ chars>
FIELD_ENCRYPTION_KEYS=1:<base64 32-byte key>
EOF
npx drizzle-kit push --force && npm run db:harden
npm run verify:static && npm run verify:server && npm run build
npm start &                                    # the browser tier and the reproductions need it
npm run verify:browser -- --skip-build
npx tsx --env-file-if-exists=.env --conditions=react-server verify/verify-duedate.mjs   # orphan
node --env-file-if-exists=.env docs/audits/2026-09-12/evidence/repro-statements-reversal.mjs
npx tsx --env-file-if-exists=.env --conditions=react-server docs/audits/2026-09-12/evidence/repro-statements-compare.mts
node --env-file-if-exists=.env docs/audits/2026-09-12/evidence/repro-fractional-stock.mjs
node --env-file-if-exists=.env docs/audits/2026-09-12/evidence/repro-ui-coverage.mjs
bash docs/audits/2026-09-12/evidence/repro-migration-baseline.sh
```

---

## 16. Limits of this evidence

- **No production system was contacted.** Every deployment claim is `unverified` (§14 is the remedy).
- **Five findings are `derived`, not executed** — F-2, F-9, N-1, N-2, F-8 were established by tracing source. F-10 and the fractional-stock behaviour were **reproduced**; F-1 is a **library differential** (§12).
- **The browser sweep is a sweep, not an audit.** Overflow is one metric; keyboard reachability is the first 30 tab stops on 4 routes; the Arabic sweep detects Latin text, not translation *quality*.
- **Screen-reader behaviour, payroll arithmetic against a worked example, a restore drill, load testing, penetration testing and `scripts/tests/` remain not yet examined** — §2.3 of the audit separates these from the one genuinely blocked area.
- **No regulatory or compliance determination is made.** None can be made from source code, and no authoritative regulatory source was consulted for that purpose.
