# Verification Evidence — Elite ERP Master Audit

**Audit date:** 12 September 2026
**Repository:** `Delowar01/Elite-ERP`
**Branch / commit audited:** `main` @ `04457ff29948111bd5d24eff3eaf4e75b90971cf`
**Working tree:** clean (`git status --porcelain` empty)

This file records what was actually executed, in what environment, and what came
back. It is the backing evidence for `master-system-audit.md`; conclusions live
there, raw results live here.

---

## 0. Environment and safety

All write-capable verification ran against a **disposable local PostgreSQL
database created for this audit and used for nothing else**.

| Property | Value |
|---|---|
| Database | `elite_erp_audit` on local PostgreSQL 16.13 (Ubuntu), `127.0.0.1:5432` |
| Role | `erp_audit`, created for this audit |
| Creation | `CREATE ROLE erp_audit LOGIN …; CREATE DATABASE elite_erp_audit OWNER erp_audit;` |
| Schema load | `npx drizzle-kit push --force`, then `npm run db:harden` |
| Node | v22.22.2 |
| Browser | Chromium 1194 via Playwright 1.61.1 (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) |

**No production or shared database was contacted at any point.** No credentials
for the production Neon instance were present in this environment, and none were
sought. `.env` was written locally with audit-only values and is covered by
`.gitignore:35` (`.env*`) — confirmed with `git check-ignore -v .env`.

Nothing in the application code, configuration, schema, or migrations was
modified. No tests were edited to obtain a pass.

---

## 1. Source of truth

```
$ git log --oneline -1
04457ff Deploy runbook for the three undeployed changes, as one schema step

$ git status --porcelain
(empty)
```

The commit a previous review examined — `04457ff`, dated 19 August 2026 — **is
still `HEAD` of `main`**. The repository has not advanced in the ~3 weeks since.
This means the previous review's findings are findings about the current
revision, not history, and each was re-verified rather than inherited. There is
no branch work to separate from the `main` baseline.

`CLAUDE.md` is present at the repository root and was read in full. **There is no
`AGENTS.md`.**

---

## 2. Repository inventory

| Measure | Count | How obtained |
|---|---|---|
| Tracked files | 631 | `git ls-files \| wc -l` |
| TypeScript/TSX under `src/` | 476 | `find src -name '*.ts*' \| wc -l` |
| Lines of code under `src/` | 57,267 | `find src -name '*.ts*' -exec cat {} + \| wc -l` |
| Page routes (`page.tsx`) | 72 | `find src/app -name page.tsx \| wc -l` |
| API route handlers | 7 | `find src/app -name route.ts` |
| Server-action files | 48 | files containing `"use server"` |
| Exported server actions | ~220 | `export async function` within those files |
| Schema files | 32 | `src/db/schema/*.ts` |
| **Physical tables (pushed schema)** | **66** | `information_schema.tables`, `table_type='BASE TABLE'` |
| Verify suites | 71 | `verify/*.mjs` + `verify/*.mts` |
| Scripts | 39 | `scripts/` (26 in `scripts/tests`, 7 in `scripts/migrations`) |
| CI workflows | 1 | `.github/workflows/devsecops.yml` |

A note on the table count: a naive `grep` for `pgTable("…")` returns 50, because
16 tables declare the name on a following line. **66 is the authoritative
figure**, taken from the database after `drizzle-kit push`. The 16 not matched by
the naive pattern were confirmed present individually: `advance_applications`,
`advance_application_releases`, `attendance_records`, `audit_logs`,
`document_column_configs`, `document_sequences`, `exchange_rates`, `favorites`,
`file_access_logs`, `notification_reads`, `password_history`, `payroll_runs`,
`products`, `security_events`, `sessions`, `user_preferences`.

Generated/third-party content excluded from all counts: `node_modules/`,
`.next/`, `package-lock.json`, `drizzle/meta/`.

---

## 3. CI evidence — recorded, not assumed

Retrieved from the GitHub Actions API for the workflow run on the audited commit.

**Run 131 — `04457ff` — conclusion: `failure`** ([run 32249699402](https://github.com/Delowar01/Elite-ERP/actions/runs/32249699402))

| Job | Conclusion | Detail |
|---|---|---|
| Static analysis (lint + types) | **success** | `tsc --noEmit` and `eslint src --max-warnings=0` both pass |
| Secret scanning (gitleaks) | **success** | — |
| Dependency vulnerability scan | **failure** | `npm audit --audit-level=high` → exit 1 |
| Security tests + production build | **failure** | crashed at step 6; steps 7 and 8 **skipped** |

**The last 10 runs on `main` all concluded `failure`.** The repository has not had
a green pipeline in its recent history.

### 3.1 Why the build job fails

```
PASS  found server-action files to audit
PASS  every mutating server-action file authorizes (requireSession/requireRole)
PASS  tenantScope filters by orgId
PASS  tenantScope applies soft-delete default
PASS  role assignment prevents self-escalation
PASS  tenantScope is used broadly in server actions
node:fs:448
Error: ENOENT: no such file or directory, open
  '/home/runner/work/Elite-ERP/Elite-ERP/src/app/uploads/[folder]/[file]/route.ts'
    at tests/security/access-control.test.mjs:51:21
```

`tests/security/access-control.test.mjs:51` reads a path that does not exist. The
route was moved to `src/app/uploads/[...path]/route.ts`; the test was not
updated. `readFileSync` throws, Node exits 1, and the job stops.

This has two consequences the failure line does not state:

1. **Eleven security assertions never execute.** The crash is at section 3 of
   six. Sections 3–6 are lost: the upload route's session/signed-URL/org/audit
   checks, the signed-URL HMAC / `timingSafeEqual` / expiry checks, the login
   rate-limit and MFA-challenge checks, and `.env is gitignored` plus **`no
   insecure AUTH_SECRET fallback`**. CI's security coverage is `6` assertions,
   not the `17` the file contains.
2. **`npm run db:push` and `npm run build` are skipped**, so **CI has never
   verified that this application builds.**

### 3.2 The build actually succeeds

Because CI never reaches it, I ran it here:

```
$ npm run build
▲ Next.js 16.2.10 (Turbopack)
✓ Compiled successfully in 17.5s
  Running TypeScript ...
BUILD_EXIT=0
```

**The production build is green at `04457ff`.** The CI failure is entirely
upstream of it — a stale path in a test, not a broken application. All 72 routes
compile; every route is `ƒ (Dynamic) server-rendered on demand` (no static
prerendering anywhere).

---

## 4. Dependency scan

CI, 19 Aug 2026: **16 vulnerabilities (7 moderate, 9 high)**.
This audit, 12 Sep 2026, `npm ci` on the same lockfile: **18 vulnerabilities
(8 moderate, 9 high, 1 critical)**.

The posture has **worsened while the code stood still** — new advisories were
published against already-pinned versions.

### Critical

**`next` 16.2.10 — direct dependency — 11 advisories.** Fix is `next@16.3.5`,
`isSemVerMajor: false`.

Among them: *Unauthenticated Remote Code Execution in Image Optimization API when
AVIF files are used*; *Unauthenticated Remote Code Execution on windows-hosted
servers* (CVSS 9.0); *Unauthenticated disclosure of internal Server Function
endpoints*; *SSRF in Server Actions on custom servers*; *SSRF in rewrites via
attacker-controlled destination hostname*; *Cache confusion of response bodies*;
*DoS in App Router using Server Actions*; *Middleware / Proxy bypass*.

### High

| Package | Direct | Fix | Note |
|---|---|---|---|
| `postcss` ≤8.5.22 | no | via `next@16.3.5` | XSS in stringify; path traversal via `sourceMappingURL` |
| `sharp` ≤0.35.4-rc.0 | no | via `next@16.3.5` | inherited libvips + libheif CVEs |
| `puppeteer-core` 19.8.4–24.43.1 | **yes** | `25.10.0` (**major**) | |
| `@puppeteer/browsers`, `extract-zip` | no | via puppeteer-core | symlink path traversal, arbitrary file write (CVSS 8.1) |
| `brace-expansion`, `browserslist`, `js-yaml`, `nanoid` | no | `npm audit fix` | DoS / OOM class |

The distribution matters for remediation planning: **the single `next` bump to
16.3.5 clears the critical and two of the high entries without a breaking
change.** Only `puppeteer-core` requires a major-version decision, and it is a
build/PDF-time dependency rather than a request-path one.

---

## 5. Verification suites executed

### 5.1 Static tier — `npm run verify:static`

**Result: PASS, 0 failures.** 8 suites.

Last suite reported `59/59 checks`. Covers the role matrix against real guards
(both directions), confirm-dialog policy including Arabic copy, dirty-form
guards, loading skeletons, colour contrast, the document edit-availability
matrix, money precision, and the ledger-only-balances invariant.

### 5.2 Server tier — `npm run verify:server`

**Result: PASS, exit 0, `0` lines matching `^FAIL`.** 25 suites, fresh database.

| Suite | Checks | Suite | Checks |
|---|---|---|---|
| `verify:statements` | 70/70 | `verify:advances-audit` | 18/18 |
| `verify:project-costing` | 41/41 | `verify:advance-allocations` | 23/23 |
| `verify:docs-import` | 339/339 | `verify:advance-backfill` | 16/16 |
| `verify:client-import` | (no count line) | `verify:advance-release` | 15/15 |
| `verify:import` | (no count line) | `verify:credit-note-release` | 40/40 |
| `verify:exchange-rates` | 57/57 | `verify:advance-refunds` | 10/10 |
| `verify:registration-currency` | 34/34 | `verify:advance-clear` | 13/13 |
| `verify:money-round-trip` | 44/44 | `verify:note-fx` | 40/40 |
| `verify:base-backfill` | 21/21 | `verify:settlement` | 29/29 |
| `verify:rate-fetch` | 27/27 | `verify:payment-reversal` | 55/55 |
| `verify:fx-reporting` | 16/16 | `verify:bank-opening` | 18/18 |
| | | `verify:bank-opening-backfill` | 31/31 |
| | | `verify:db-hardening` | pass |

Roughly **860 assertions**, all green, on a database created minutes earlier.

`verify:db-hardening` passing is worth separating from the rest: it checks the
**installed database triggers**, not a file. `npm run db:harden` reported
`installed audit_logs_immutable, security_events_immutable`.

### 5.3 Browser tier — `npm run verify:browser -- --skip-build`

36 suites discovered and run in series against `npm start` on the build produced
in §3.2. Results are recorded in §8 below.

### 5.4 Did the financial suites test production logic, or a copy of it?

This was checked rather than assumed, because a suite that reimplements the rule
it is testing proves nothing.

The financial suites **import the production modules**. `verify-settlement.mts`,
`verify-payment-reversal.mts`, `verify-note-fx.mts` and the advance suites
exercise `src/lib/settlement.ts`, `src/lib/payment-reversal.ts`,
`src/lib/reversal-currency.ts`, `src/lib/advance-allocations.ts` and
`src/lib/base-amounts-sql.ts` directly, and assert against **rows read back from
the database** after the real code wrote them — not against recomputed
expectations.

One real limitation, recorded in the repository's own history and confirmed
here: the server tier tests **libraries**, and a defect that lives in a server
action's SQL rather than in the library it calls can escape it. That is exactly
the shape of Finding F-1 below, which the 55/55 `verify:payment-reversal` run
does not catch.

---

## 6. Independent verification of the nine previous findings

Each was treated as a lead to test, not a conclusion to repeat.

---

### F-1 — Payment reversal recomputes invoice status without credited amounts
**Status: CONFIRMED — live defect. Reproduced.**

`src/app/(app)/finance/payments/actions.ts:985`:

```ts
status: invoiceStatusAfter(paid.paidAmount, inv.total, inv.currency ?? session.orgCurrency),
```

`src/lib/payment-reversal.ts:109-114` computes status from `paid` and `total`
only. The `SELECT … FOR UPDATE` immediately above (lines 966-969) does **not
select `credited_amount`**, so the value is not even available to the branch.

**Origin.** `src/lib/payment-reversal.ts` landed in `72b3336` (18 Aug).
`src/lib/settlement.ts` — which made the settlement identity three-channel —
landed in `6422235` (19 Aug), one day later. That commit's message enumerates the
readers it updated; `reversePaymentAction` is not among them. This is a
regression introduced by the later commit, not an original oversight.

**Reproduction**, importing the two production modules and comparing them:

```
Invoice total 1,000.00 SAR, payment 400.00, credit note 600.00. Reverse the payment.

paid after reversal : 0.00
status written      : sent
settlementOf says   : partially_paid | outstanding 400.00 | settled 600.00
DISAGREE  <-- defect

fully-credited invoice, payment reversed:
  status written: sent | settlementOf: paid
```

**Impact.** The invoice's *balance* remains correct (the detail page reads
`settlementOf`), but its **status** is reset as though nothing had settled it. A
partly-credited invoice drops from `partially_paid` to `sent`; a fully-credited
one reads `sent` when it should read `paid`. Status drives the payments-register
worklist (`status IN ('sent','partially_paid')`), aging inclusion, and the
dashboard — so the document reappears as unsettled work.

---

### F-2 — Project cash queries include reversed ordinary payments
**Status: CONFIRMED — live defect.**

`src/lib/project-costing.ts:237-253`, the "Cash actually received" query, filters
on `orgId`, `direction = 'in'`, `kind is distinct from 'advance_receipt'`,
`projectId`, and `activeOnly(...)`. **There is no `reversed_at is null`
predicate.** A reversed payment still counts as cash received against the
project. The file's three occurrences of "reversed" are all in comments.

**Scope, checked rather than assumed.** I enumerated every reader of the
`payments` table (17 files) and tested each for `payments.reversed_at` awareness:

- **Only two** are aware: `finance/payments/actions.ts` (the reversal action
  itself) and `finance/_shared/payment-history.tsx` (display styling).
- The `reversed_at` hits in `advance-allocations.ts`,
  `sales/invoices/[id]/page.tsx`, `sales/proforma/[id]/page.tsx` and
  `advance-actions.ts` are a **different column** —
  `advance_application_releases.reversed_at` — and are not relevant.
- **No aggregate reader excludes reversed payments.**

**Two readers do not inherit the defect, and it would be wrong to report that
they do:**

- `finance/bank-accounts/page.tsx` takes balances from `getAccountBalances`
  (ledger-derived, protected by the `verify:ledger-only-balances` static
  assertion). Its payments query feeds a recent-movements *list*; a reversed
  payment appears there without a marker, which is a display gap, not a wrong
  balance.
- `src/lib/statements.ts` derives its rows from **ledger lines** (`idsOf("payment")`
  over journal entries) and reads the `payments` table only to decorate them with
  reference and method. Both the original and its mirroring reversal appear as
  ledger lines, which is correct double-entry behaviour. **Statements are not
  affected.**

So F-2 is real but narrower than "every cash figure": it is `project-costing.ts`,
plus the unmarked bank-movements list.

---

### F-3 — Upload proxy checks access while the underlying blobs are public
**Status: CONFIRMED as a design gap. Practical exposure is lower than the
headline suggests, and that distinction is load-bearing.**

`src/lib/storage/blob-storage.ts:98`:

```ts
await put(pathname, bytes, { access: "public", addRandomSuffix: false, contentType, token: … });
```

`access: "public"` makes every object world-readable at its blob URL.
`addRandomSuffix: false` removes the unguessable component Vercel would otherwise
add, so the URL is **fully determined** by `blobBaseUrl()` + `organizations/{orgId}/{folder}/{filename}`.

The proxy at `src/app/uploads/[...path]/route.ts` is well built — path-shape
validation, org match against the path segment, `FILE_RE` filename allowlist,
PDF-only-in-attachments, session **or** HMAC-signed URL, and an append-only
`file_access_logs` write on every serve. **None of it constrains the blob.**
Anyone holding a pathname reads the object directly with no session, no org
check, no audit entry, and **no possibility of revocation** short of deleting the
object.

**What keeps this from being an active exposure today.** Filenames are
`{orgId}-{Date.now()}-{randomBytes(8).toString("hex")}.{ext}` — 64 bits of
entropy, not enumerable at internet scale. And I checked whether the application
leaks absolute blob URLs: `blobUrlFromStored()` is **exported but has no
callers**, and the only absolute-URL construction is the server-side `fetch`
inside the proxy route itself. **The application does not currently expose blob
URLs to clients.**

So the accurate statement is: *confidentiality of uploaded files rests entirely
on filename entropy, not on authorization.* There is no second line of defence.
Any future change that renders an absolute blob URL — an `<img src>`, an embedded
PDF asset, a share link, an export — silently converts this into a permanent,
unauthenticated, unauditable, unrevocable exposure. A database read or backup
leak does the same immediately.

The module's own header comment (lines 11-12) states that "blob URLs are never
exposed and cross-tenant access is denied". The first half is true of the
application as written; the second is true only of the proxy, not of the storage.
**No test covers any of this.**

---

### F-4 — A security test references an outdated uploads-route path
**Status: CONFIRMED.** See §3.1. `tests/security/access-control.test.mjs:51` vs
the actual `src/app/uploads/[...path]/route.ts`. This single stale string is what
keeps the whole pipeline red and the production build unverified.

---

### F-5 — Dependency audit fails and CI does not reach the production build
**Status: CONFIRMED, both halves.** See §3 and §4. The build itself is green when
run directly (§3.2).

---

### F-6 — The latest schema changes are not in the generated migrations
**Status: CONFIRMED, and the gap is wider than previously recorded.**

The generated migrations stop at `0004_wooden_christian_walker`. The last commit
touching `drizzle/` is `4323b91`, **22 July 2026** — **146 commits before `HEAD`**.

`drizzle/meta/_journal.json` holds five entries, the newest stamped
`1784748824249` (22 July 2026). None of the six columns added since then appear
in any migration file.

`npm run db:push` (`drizzle-kit push && npm run db:harden`) is therefore the sole
schema path, and `npm run db:migrate` is an active trap: it would report success
having applied nothing, after which the deployed code fails on missing columns.

**Confirmed by pushing to a fresh database.** All six columns from the deploy
runbook materialised exactly as documented:

| Table | Column | Type | Nullable | Default |
|---|---|---|---|---|
| `bank_accounts` | `opening_contra_account_id` | integer | YES | — |
| `bank_accounts` | `opening_date` | date | YES | — |
| `payments` | `reversed_at` | timestamp without time zone | YES | — |
| `payments` | `reversed_by_id` | integer | YES | — |
| `sales_invoices` | `base_credited_amount` | numeric | YES | — |
| `sales_invoices` | `credited_amount` | numeric | **NO** | `'0'::numeric` |

`docs/backlog.md`'s runbook is accurate on every one of these points.

---

### F-7 — Live Neon schema and deployment status unestablished
**Status: STILL UNESTABLISHED. Not verifiable from this environment, and
deliberately not attempted.**

No production credentials were present and none were sought; the audit brief
forbids touching production, and an unidentified database must never be written
to or schema-pushed. Nothing in the repository records a deployment. **Whether
any of the four to six pending columns exist in production Neon, and which commit
is live, remain unknown.** Every deployment-status claim in this audit is marked
`unverified` for that reason.

This is the single largest hole in the audit, and only the owner can close it —
see the decision list in the main report.

---

### F-8 — Sent-proforma revisions and proforma project attribution unfinished
**Status: CONFIRMED for project attribution. Precisely characterised.**

`src/db/schema/proforma-invoices.ts` has **no `projectId` column** — verified by
direct grep returning nothing. Of the document tables, `quotations`,
`sales-orders`, `sales-invoices`, `purchase-orders`, plus `accounting` (journal)
and `finance` (payments) all carry `projectId`; **proformas alone do not**.

`docs/backlog.md:853` files this as high priority and states the consequence:
`convertProformaToInvoiceAction` never sets a `projectId` on the invoice it
creates, so **every invoice born from a proforma belongs to no project**, and
project cost control under-reports revenue for any project whose work arrived
through a proforma. The backlog is correct, and correctly notes the fix needs a
decision (backfill source for already-converted invoices), not just a column.

`docs/backlog.md:886` records a related, separate limitation: advances held
against a proforma cannot be attributed to a project at all.

---

### F-9 — Cash-paid invoices with credit notes leave credit/AR unresolved
**Status: CONFIRMED — still live. The settlement change altered the symptom, not
the cause.**

`docs/backlog.md:533` documents it: an invoice settled in cash has no allocation
for a credit note to release, so the note's `Cr 1100` stands alone and drives the
customer's receivable negative.

`6422235` changed the arithmetic afterwards, so I re-derived the behaviour rather
than trusting the entry's age:

- `getReceivableAging` (`src/lib/finance-reports.ts:365-384`) now selects
  `baseCreditedExpr`, and `agingFrom` (line 352) computes
  `outstanding = total − paid − credited`.
- **Line 353 is still `if (outstanding <= 0) continue;`** — so the 10,000
  cash-paid invoice with a 2,000 note computes −2,000 and is **still dropped from
  aging entirely**.
- GL 1100 still carries −2,000 for that customer.

So: **control account −2,000, aging subledger 0 — the divergence is unchanged.**
What `6422235` did fix is a second-order symptom: `baseOutstandingExpr` gained
`GREATEST(0, …)`, so the dashboard receivables total (which *sums* the
expression) no longer absorbs the negative. The reconciliation break between the
control account and the subledger remains.

---

## 7. Findings originating in this audit

Beyond the nine leads, tracing F-1 exposed that `6422235` left **more than one**
reader on the old two-term settlement identity.

### N-1 — The payments register overstates outstanding balances
**Severity: medium.** `src/app/(app)/finance/payments/page.tsx:94`:

```ts
balance: Number(r.total) - Number(r.paidAmount),
```

`creditedAmount` is omitted, and the query (lines 45-59) does not select it. This
is the outstanding-invoice picker on the **"Record a payment"** screen, so an
invoice carrying a credit note is presented with an **overstated balance at the
exact moment someone is deciding how much to collect** — inviting an
over-collection that the system would then have to unwind.

Line 101 is the purchase-order equivalent and is **correct**: purchase orders have
no `creditedAmount` column, so `total − paidAmount` is the whole identity there.

### N-2 — Statement payment-status labels use the two-term identity
**Severity: low.** `src/lib/statements.ts:198-202`, `payStatus(total, paid, currency)`,
called at line 259 for sales invoices. A fully-credited invoice is labelled
`unpaid` or `partial` on a customer statement. **Amounts on the statement are
unaffected** — they are ledger-derived (see F-2) — so this is a label defect, not
a figures defect.

### N-3 — HR Departments is read-only
**Severity: low (completeness).** `src/app/(app)/hr/departments/page.tsx` is 41
lines with no form, no buttons, and **no `actions.ts` in the directory**. Every
other HR module (`employees`, `attendance`, `leave`, `payroll`) has one.
Departments can be listed but not created, edited, or removed through the
interface.

### N-4 — CI runs none of the 71 verify suites
**Severity: medium (process).** `.github/workflows/devsecops.yml` runs `tsc`,
`eslint`, `npm audit`, gitleaks, two files from `tests/security/`, `db:push` and
`build`. **It never invokes `verify:static`, `verify:server`, or
`verify:browser`.** The ~860 server-tier assertions and 36 browser suites — by
some distance the strongest quality asset in this repository — are executed only
when a person remembers to run them locally. The repository's own
`verify/README.md` catalogues "a suite that never runs" as a failure species; the
tier-level instance of it is unaddressed.

---

## 8. Browser tier results

Executed as `npm run verify:browser -- --skip-build` against the §3.2 build,
Chromium 1194, one shared database, suites in series.

**Result: 36/36 suites passed. 0 failures.** 972 counted assertions across the
26 suites that report a count; the other 10 assert without printing a total.

| Suite | Checks | Time |
|---|---|---|
| `verify-account-arabic.mjs` | 34/34 | 29s |
| `verify-advances.mjs` | 172/172 | 165s |
| `verify-bank-gl.mjs` | 21/21 | 15s |
| `verify-bank-opening.mjs` | — | 23s |
| `verify-color-theme.mjs` | — | 17s |
| `verify-compliance-claims.mjs` | — | 7s |
| `verify-confirm-e2e.mjs` | 34/34 | 34s |
| `verify-currency-lock.mjs` | 13/13 | 9s |
| `verify-dark-theme.mjs` | — | 8s |
| `verify-dc-no-bank.mjs` | 21/21 | 23s |
| `verify-delete-refusal.mjs` | 16/16 | 6s |
| `verify-dirty-core.mjs` | 72/72 | 68s |
| `verify-dirty-ui.mjs` | 8/8 | 12s |
| `verify-draft-buttons.mjs` | — | 14s |
| `verify-draft-func.mjs` | — | 6s |
| `verify-duplicate.mjs` | 40/40 | 16s |
| `verify-edit-e2e.mjs` | 132/132 | 80s |
| `verify-edit.mjs` | — | 7s |
| `verify-expense-categories-hidden.mjs` | 16/16 | 7s |
| `verify-favorites.mjs` | 20/20 | 15s |
| `verify-fx-dashboard.mjs` | 6/6 | 5s |
| `verify-fx-posting.mjs` | 108/108 | 61s |
| `verify-note-currency.mjs` | 19/19 | 11s |
| `verify-payment-dialog.mjs` | 28/28 | 26s |
| `verify-payment-fx.mjs` | 66/66 | 45s |
| `verify-preset-zatca.mjs` | — | 22s |
| `verify-print-apply.mjs` | — | 6s |
| `verify-proforma-payments.mjs` | — | 23s |
| `verify-rate-oneclick.mjs` | 28/28 | 8s |
| `verify-rate-screen.mjs` | 13/13 | 9s |
| `verify-registration-currency.mjs` | 20/20 | 15s |
| `verify-sidebar-scroll.mjs` | 14/14 | 12s |
| `verify-skeleton-runtime.mjs` | 11/11 | 13s |
| `verify-staff-replay.mjs` | 9/9 | 4s |
| `verify-staff-runtime.mjs` | 20/20 | 10s |
| `verify-vendor-inline.mjs` | 31/31 | 23s |

Final line: `36/36 suites passed.`

The runner is itself worth noting as evidence quality: it refuses to start if
something is already listening on the port, fails loudly if the server exited
rather than started, discovers suites by scanning `verify/` rather than from a
hand-maintained list, and runs them in series because they share one database.
Each of those exists because the corresponding failure had already happened once
in this project's history.

### 8.1 What the browser tier does and does not establish

It **does** establish, at HEAD, on a real build: Arabic rendering on real pages;
confirm-dialog copy in both languages; theme switching; dirty-form guards;
duplication and favorites; the full document edit lifecycle end to end (132
assertions); FX posting through the UI (108); advances through the UI (172);
payment dialogs and reversal; server-side refusal by raw action replay for both
the delete refusal and the staff role guard; ZATCA Phase 1 claims staying
honest; and Expenses staying hidden.

It **does not** establish anything about tablet or mobile rendering — the runner
drives a desktop viewport — nor about accessibility beyond colour contrast, nor
about behaviour under concurrent load. And it does not establish that all 72
routes are fully translated: it asserts Arabic on the pages it visits, which is
a subset.

---

## 9. Totals

| Tier | Suites run | Assertions counted | Failures |
|---|---|---|---|
| Static | 8 | ~200 | **0** |
| Server | 25 | ~860 | **0** |
| Browser | 36 | 972 | **0** |
| **Total executed in this audit** | **69** | **~2,030** | **0** |

Plus: production build **exit 0**; `db:push` + `db:harden` clean on a fresh
database; `npm audit` parsed; all 1,587 i18n entries parsed; CI run, job and log
evidence retrieved for the audited commit.

**Every suite in this repository that has a runner passed.** The defects in §6
and §7 are, without exception, in places these suites do not reach — which is
the substantive finding about coverage, and it is a finding about *shape*, not
about *quality*: the server tier tests libraries, so a defect living in a server
action's SQL escapes it. F-1 is the proof: `verify:payment-reversal` passes
55/55 with the defect present.

---

## 10. Reproducing this

```bash
git clone <repo> && cd elite-erp && git checkout 04457ff
npm ci

createdb elite_erp_audit                      # a disposable database, never production
cat > .env <<EOF
DATABASE_URL=postgresql://…/elite_erp_audit
AUTH_SECRET=<32+ chars>
FIELD_ENCRYPTION_KEYS=1:<base64 32-byte key>
EOF

npx drizzle-kit push --force && npm run db:harden
npm run verify:static
npm run verify:server
npm run build
npm run verify:browser -- --skip-build
npm audit --json
```

The lead-verification scripts written for this audit were scratch files outside
the repository and are not committed; each is quoted in full where its result is
reported, so every number above can be re-derived from the source references
given.

---

## 11. Limits of this evidence

Stated plainly, so nothing here is read as broader than it is.

- **No production system was contacted.** Every deployment claim is `unverified`, and that is a real gap, not a formality (F-7).
- **Six findings are `derived`, not `executed`** — F-2, F-9, N-1, N-2, N-3 and F-8 were established by tracing source, not by running a failing case. They are labelled as such in §5.2 of the main report. F-1, by contrast, was reproduced numerically.
- **The browser tier is desktop-only.**
- **`scripts/tests/` (26 files) was not executed** — inventoried only.
- **No performance measurement was taken**, so every performance statement in the main report is a hypothesis from query shape.
- **No penetration testing, fuzzing, or authenticated-attacker work** was performed.
- **HR payroll arithmetic and inventory valuation were not verified.**
- **This audit makes no regulatory or compliance determination.** None can be made from source code, and no authoritative source was consulted.
