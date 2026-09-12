# Elite ERP — Master System Audit

**Original audit:** 12 September 2026 · **Correction and completion pass:** 12 September 2026
**Repository:** [Delowar01/Elite-ERP](https://github.com/Delowar01/Elite-ERP)
**Revision audited:** `main` @ [`04457ff`](https://github.com/Delowar01/Elite-ERP/commit/04457ff29948111bd5d24eff3eaf4e75b90971cf) (working tree clean)
**Scope:** audit and reporting only — no application code, configuration, schema, migration history, or data was changed.

Companion files: [`verification-evidence.md`](verification-evidence.md) ·
[`feature-status-matrix.csv`](feature-status-matrix.csv) ·
[`prioritized-roadmap.md`](prioritized-roadmap.md) · reproducible scripts and
logs in [`evidence/`](evidence/).

---

## 0. Correction log

This pass re-examined the first report's conclusions. **Fourteen changed** — C-1 to C-11 in the correction pass; **C-12** (migration column arithmetic) and **C-13** (evidence files silently untracked) in a final reconciliation pass; **C-14** (security-suite assertion count) established by the Batch 1 repair itself. Each is
listed with what it said, what is true, and how that was established.

| # | Earlier conclusion | Corrected conclusion | Why it changed |
|---|---|---|---|
| **C-1** | "Statements are not affected — amounts are ledger-derived, so both the original payment and its reversal appear." | **Wrong, and it concealed a high-severity defect.** Statements *silently drop* every payment reversal. Opening balance, closing balance, rows and exports are all understated. **New finding F-10.** | Reproduced end to end with the real `recordPaymentAction` and `reversePaymentAction` over the wire, then the real `getStatement`. 4 of 4 scenarios disagree with the ledger by exactly the payment amount. `evidence/repro-statements-*` |
| **C-2** | Fractional quantities: **complete**. | **Two different things were conflated.** Decimal *document* quantities are supported (`numeric(12,2)`) — pricing and the ledger are correct. **Fractional *stock* is not supported at all**: `quantity_on_hand` is `integer`, five posting sites `Math.trunc`, and `adjustStockAction` throws on any fraction. | Traced all five call sites and measured the behaviour against the database. `evidence/repro-fractional-stock.txt` |
| **C-3** | "25 server suites, ~860 assertions." | **24 server suites** (`package.json` chains 24). **957 counted assertions across 21 of them**; two more report 60 and 90 `PASS` lines without a total; one is a state gate with no count. | Recounted from the preserved run log. |
| **C-4** | Cited `verify-duedate` as automated evidence. | **`verify-duedate.mjs` is an orphan — no runner reaches it.** It is not browser-discoverable (no `localhost:3000`) and no npm script names it. I ran it manually for this pass: 9/9. | Suite-inventory reconciliation. |
| **C-5** | F-1 described as reproduced. | True, but the method was understated as if it were an end-to-end write. **It is a differential between two production library functions**, not an exercised action against the database. Labelled precisely now. | Self-review of method. |
| **C-6** | "verified against the **live database**". | Wording replaced everywhere with **"disposable local PostgreSQL database"**. Nothing in this audit ever touched a live system. | Wording that could mislead. |
| **C-7** | "CI has never verified that this application builds." | Overreach. **In the 10 most recent runs on `main` — the history actually inspected — the build step was never reached.** Runs 1–121 were not examined. | Restricting the claim to the evidence. |
| **C-8** | "No middleware file exists; authorization is not enforced at an edge layer." | **Wrong.** `src/proxy.ts` is Next 16's renamed middleware. It performs an edge-safe JWT signature/expiry check on protected routes, clears bad cookies and redirects. Revocation is deliberately left to `requireSession()`. | Reading `src/proxy.ts`. |
| **C-9** | Bilingual coverage "essentially complete — 1,587 entries, one placeholder." | **Measured the wrong thing.** The dictionary is internally complete; UI coverage is not. **27 keys are passed to `t()` but absent from the dictionary** (30 call sites, silently rendering English), and **~50 literal English strings sit in `title`/`label`/`placeholder` props**, never routed through `t()` at all — including three dashboard KPI titles and the print template's `SUPPLY FROM` / `DELIVERED TO`. | Static sweep of every `t()` key plus a 29-route Arabic browser sweep. |
| **C-10** | Responsive layout and accessibility: "blocked — could not verify." | **Not blocked; now measured.** Desktop 1440px: 0 of 29 routes overflow. **Tablet 768px: 29 of 29. Mobile 390px: 29 of 29.** Keyboard reachability and focus visibility are, by contrast, **good** (30/30 on every route probed). | A browser was available. `evidence/repro-ui-coverage.txt` |
| **C-11** | "`next@16.3.5` is non-breaking and clears the gate." | **Wrong twice.** `16.2.10 → 16.3.x` is a **minor** bump; `isSemVerMajor:false` means "not a major", not "compatible". And it does **not** clear `--audit-level=high`: **six high-severity packages remain**. Separately, **three of the four worst advisories do not apply to this deployment** — verified against primary sources. | GitHub Advisory Database + this app's actual configuration. |

| **C-12** | "a migrations-only database is **7 tables and 204 columns short**", and the `generate` prompt attributed to `openingBalance` → `openingBalanceLegacy`. | **The 204 is right but was stated ambiguously, and the prompt attribution was wrong.** 608 columns are shared, **204 must be added, 1 must be dropped** — so the *net* difference is **+203**, which is why `812 − 609` does not equal 204. The dropped column is `terms_conditions_groups.content` (`text`), replaced by `terms` (`jsonb`) in `15ef378`; that single add-and-drop pair is the **only** column conflict, and is what stops `drizzle-kit generate`. `openingBalance` → `openingBalanceLegacy` renamed only the **Drizzle field** — the SQL column is still `opening_balance` and is present in **both** databases, so it produces no diff and cannot prompt anything. | Set-difference on column identity **and** on full fingerprints, on two rebuilt disposable databases. §12 |
| **C-13** | The evidence outputs were cited in all four reports as committed artefacts. | **They were not committed.** `.gitignore:32` (`*.log`) silently excluded all five output files from commit `cefcb49`, so every citation pointed at a file absent from the repository — the scripts were tracked, their results were not. Renamed `.log` → `.txt` (rather than forcing past `.gitignore` or editing it, which would be a config change outside an audit's scope) and every reference updated. | `git ls-files` vs the directory listing; `git check-ignore -v` confirmed the cause. |
| **C-14** | "the suite has 17 assertions, of which 11 never execute" (F-4). | **Off by one, established by fixing it.** `tests/security/access-control.test.mjs` at `e8969a1` contains **16** `ok()` calls: 6 ran before the crash and **10** did not. The two security files hold **34** assertions, not 35. The Batch 1 repair adds a resolution guard, so the file now reports 17/17 — which is why the corrected figure matters: 17 is the count *after* the fix, not before it. | `git show e8969a1:tests/security/access-control.test.mjs \| grep -c '^ok('` → 16. |

Two earlier findings were re-tested and **stand unchanged**: F-1 (payment reversal
writes a wrong invoice status) and F-9 (credit notes on cash-paid invoices leave
GL 1100 and aging disagreeing). One risk description was corrected without
changing the finding — see R-8 in §7.4.

---

## 1. Executive assessment

Elite ERP is a **substantially built accounting product with an exceptional
verification culture, a small number of serious financial defects, and one large
unknown.** The correction pass did not change that shape. It made the defects
more specific, found one more, and replaced three "could not verify" answers with
measurements.

The accounting core remains the strongest part. Double-entry posting, multi-
currency at stored posting-date rates, advances held as liabilities until
allocated, notes inheriting their source's rate, reversal by mirroring stored
ledger lines, an append-only audit trail enforced by database trigger — all
implemented, and covered by 68 suites and roughly 2,470 assertions that I ran in
full, with zero failures.

**That zero-failure result is the finding, not the reassurance.** Every defect in
this report lives somewhere those suites do not reach. Three of them share one
cause: a change on 19 August split the settlement identity into three channels
and updated most readers, but not all. A fourth — the one found in this pass — is
the same shape one layer down: `payment_reversal` was added as a journal source
type in August, and `statements.ts` was never taught to recognise it.

**The three defects that move money or misreport it:**

1. **Statements silently drop payment reversals (new).** A customer or vendor
   statement shows the payment and not its reversal. The closing balance is
   understated by the payment amount, the opening balance too when the payment
   predates the period, and the exported CSV carries the same error. Reproduced
   through the real actions in four scenarios; every one disagreed with the
   ledger by exactly 400.00.
2. **Payment reversal writes a wrong invoice status** when a credit note is also
   present — a settled invoice reverts to "sent" and reappears in the collections
   worklist.
3. **Credit notes on cash-paid invoices** leave the AR control account and the
   aging subledger disagreeing — a reconciliation break any reviewer will raise.

**Two structural gaps.** File storage has no access control: objects are written
public with deterministic URLs, so the well-built upload proxy is not what
protects them. And **the product is desktop-only in practice** — every route
overflows horizontally at tablet width, not just mobile.

**One thing is genuinely better than the first report said.** The Next.js
advisory picture is far less alarming than "unauthenticated RCE" suggested: the
Windows RCE cannot affect a Vercel/Linux deployment, the middleware-bypass
requires an `i18n.locales` configuration this app does not have, and two SSRF
advisories need a custom server or rewrites that do not exist here. What remains
is real but ordinary, and the upgrade is a minor-version bump that needs
regression testing rather than a same-day emergency patch.

**And the largest gap is still not a defect at all: nobody can say what is
deployed.** No production credentials existed and none were sought. This pass
produced a read-only verification pack so the owner can close that question in
minutes — see §11 and [`evidence/production-verification.sql`](evidence/production-verification.sql).

On readiness, kept deliberately separate:

- **Implemented** — broad and deep across sales, purchasing, finance, inventory, projects, HR and settings.
- **Tested** — excellent for accounting, absent for HR payroll arithmetic, and entirely dependent on someone running it by hand.
- **Production-ready** — **not demonstrable today.** The obstacles are three financial defects, one storage decision, a desktop-only UI, and an unanswered deployment question.

---

## 2. Coverage register

### 2.1 Method legend

| Depth | Meaning |
|---|---|
| **Traced** | Read end to end and followed through callers/callees |
| **Read** | Read directly, not exhaustively traced |
| **Executed** | Exercised by a suite or reproduction I ran in this audit |
| **Measured** | A number was taken from a running system |
| **Sampled** | Inspected in part — enough to characterise, not to certify |
| **Not examined** | Stated plainly; no conclusion is drawn |

### 2.2 By area

| Area | Depth | Basis |
|---|---|---|
| Settlement model | Traced + Executed | All readers enumerated; `verify:settlement` 29/29 |
| Payment reversal (lib + action) | Traced + Executed | Defect differential; `verify:payment-reversal` 55/55 |
| **Statements** | **Traced + Executed (reproduction)** | **Real actions over the wire + real `getStatement`, 4 scenarios** |
| Note FX, advances, allocations, refunds | Read + Executed | 7 suites |
| Bank opening balances | Read + Executed | 18/18, backfill 31/31 |
| Aging, finance reports, VAT | Traced | F-9 re-derived; `getVatSummary` read |
| Project costing **incl. profit/margin formulas** | Traced + Executed | Cash query and `profit`/`marginPercent` traced line by line |
| Document lifecycle | Read + Executed | `verify:edit-action` 59/59 |
| Roles, auth, session, **`src/proxy.ts`** | Read | All four files read |
| File storage + upload proxy | Traced | Both files; callers enumerated |
| CI workflow + run history | Traced | Workflow read; 10 runs' job/log evidence |
| Dependencies **+ advisory applicability** | Executed + primary sources | `npm audit --json`; GitHub Advisory Database |
| Schema, migrations, **baseline behaviour** | **Executed (two disposable DBs)** | Migrations-only vs push-built, diffed |
| i18n **dictionary and UI coverage** | **Executed (static + browser)** | Every `t()` key; 29-route Arabic sweep |
| **Responsive layout (3 viewports)** | **Measured** | 29 routes × desktop/tablet/mobile |
| **Keyboard reachability + focus** | **Measured** | 4 routes, 30 tab stops each |
| **Payroll, attendance, leave** | **Traced (source)** | `processPayrollAction` read in full |
| **Inventory stock behaviour** | **Traced + Executed** | 5 truncation sites; DB behaviour measured |
| **Vendor bills, input VAT, bank rec, period controls** | **Traced (source)** | Targeted searches + `getVatSummary` |
| **Proforma revisions** | **Traced (source)** | Zero occurrences anywhere |
| **Backup / restore procedure** | **Read** | `backup.sh`, `restore.sh`, `backup-dr.md` |
| Build | Executed | `npm run build`, exit 0 |
| Import / export | Executed | 339 + 60 + 90 assertions |

### 2.3 Still not examined — and why

Materially shorter than the first pass, because six of its "blocked" items were
not blocked.

| Area | Status | Reason |
|---|---|---|
| **Production Neon database and Vercel deployment** | **Blocked — missing access** | No credentials were present and none were sought. The brief forbids touching production. **§11 provides read-only checks the owner can run.** |
| **Payroll arithmetic against a worked example** | **Not yet examined** | The formula was traced (§5.6) but no run was executed against expected figures. |
| **Restore drill** | **Not yet examined** | `restore.sh` was read, not run. A drill needs a real dump. |
| **Load / soak / concurrency performance** | **Not yet examined** | No measurement taken. Every performance statement below is a hypothesis from query shape, never a result. |
| **Screen-reader and full WCAG conformance** | **Not yet examined** | Keyboard reachability, focus visibility and contrast were measured; assistive-technology behaviour and semantic structure were not. |
| **Penetration testing** | **Not yet examined** | Out of scope. |
| **`scripts/tests/` (26 files)** | **Not yet examined** | Inventoried only. |

**"Not yet examined" means no one has looked. "Blocked" means access was
missing.** Only production is blocked.

Generated/third-party excluded throughout: `node_modules/`, `.next/`,
`package-lock.json`, `drizzle/meta/`.

### 2.4 Documentation treated as claims

`docs/backlog.md` (1,522 lines) proved **unusually reliable** — its deploy
runbook matched the pushed schema exactly, and its open findings (F-8, F-9) are
confirmed live. `README.md` and `docs/security/backup-dr.md` are **stale** with
respect to the move to Vercel Blob (§7.3, D-8 and D-10).

---

## 3. System map

### 3.1 Architecture

A **single Next.js 16.2.10 App Router application** (Turbopack), deployed as one
unit to Vercel with Neon Postgres. No separate API service, no client SPA, no
broker.

- **Rendering:** all 72 routes build as `ƒ (Dynamic) — server-rendered on demand`. **Nothing is statically prerendered.**
- **Mutations:** React Server Actions — 48 files, ~220 exported actions. This is the entire write surface.
- **HTTP route handlers:** 7 (three exports, document PDF, import template, auth clear, uploads proxy).
- **Edge layer — `src/proxy.ts`** *(corrected: C-8)*. Next 16 renames `middleware.ts` to `proxy.ts`, which is why the first pass missed it. On every non-static, non-auth route it performs an **edge-safe JWT signature and expiry check** with `jose`, clears a malformed cookie and redirects once to `/login`. It deliberately does **not** check revocation — that would put a database query on every request — leaving it to `requireSession()` server-side. `/login`, `/register`, `/auth/clear` and `/` always render, explicitly to avoid a redirect loop the file documents as "the B1 loop".

  This matters beyond accuracy: GHSA-6gpp's own mitigation advice is to *"move authorization logic to the page's server-side data path instead of relying solely on middleware"* — which is **exactly what this codebase already does**.

### 3.2 Data model and tenancy

66 physical tables, 32 schema files. **Tenancy is by `orgId` column** — shared
schema, shared database, no row-level security. Isolation rests on
`src/lib/tenant.ts`'s `tenantScope` (`eq(table.orgId, orgId)` plus a soft-delete
default). This is **a convention enforced by discipline and tests, not by the
database**: a query that forgets `tenantScope` is a cross-tenant read.

### 3.3 Authentication and authorization

Custom JWT-in-cookie signed with `jose`; `AUTH_SECRET` required with no
fallback. `__Host-elite_erp_session` in production (forces Secure, `Path=/`, no
Domain). **Revocation is real and server-side** (`src/lib/session.ts:89`). MFA
secrets encrypted AES-256-GCM under versioned keys. Password policy with
composition, common-password detection, history and expiry.

**Three roles — `owner`, `admin`, `staff` — and no permissions engine.**
`src/lib/role-matrix.ts` encodes the model as data; `verify:role-matrix` asserts
it against the real guards in both directions. For *Sales & Purchasing* and
*Finance* all three roles have `full`, which the matrix itself notes "includes
sending invoices, voiding them, issuing credit and debit notes, and receiving
purchase orders — all of which post to the ledger." **There is no segregation of
duties.** Documented and intentional; an explicit owner decision (§12).

### 3.4 Storage

Uploads go to **Vercel Blob** under `organizations/{orgId}/{folder}/{file}`.
Validation is careful: MIME allowlist, size caps, **magic-byte sniffing**,
dimension limits, server-generated filenames, SVG excluded for lack of a
sanitizer. The objects are written **public with random suffixes disabled**
(§6.1(a)). Downloads are proxied through an authenticated, org-scoped,
audit-logged route — which is not what protects the data.

### 3.5 Integrations, background work, deployment

- **One external integration:** an exchange-rate feed (`open.er-api.com`, overridable via `RATE_API_BASE`).
- **PDF generation** in-process (`pdf-lib`; `puppeteer-core` + `@sparticuz/chromium-min` for the serverless print path, kept out of the bundle via `serverExternalPackages`).
- **No background jobs, cron, queue or worker.** Every operation is synchronous inside a request.
- **Security headers** are set in `next.config.ts` for every response: a strict CSP (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `img-src 'self' data:` for the ZATCA QR), HSTS with preload, `X-Frame-Options: DENY`, `nosniff`, and a `Permissions-Policy`. `'unsafe-eval'` is dev-only. **No `remotePatterns` and no `rewrites` are configured** — which is why two of the Next advisories cannot apply (§6.3).
- **Required environment:** `DATABASE_URL`, `AUTH_SECRET`, `FIELD_ENCRYPTION_KEYS`, `BLOB_READ_WRITE_TOKEN`, `BASE_URL`; optionally `RATE_API_BASE`, `CHROMIUM_*`.
- **Schema deployment: `npm run db:push` only** — and the npm script matters, because it chains `db:harden`. A bare `drizzle-kit push` installs **no audit triggers** (measured: 0 of 2).

---

## 4. Feature inventory

The complete per-feature matrix is **[`feature-status-matrix.csv`](feature-status-matrix.csv)**
— 173 rows with the columns the brief specifies. It is not reproduced here; this
section gives the rollup and then expands only what is not complete-and-verified.

### 4.1 Status vocabulary

**Implementation:** `complete` · `partial` · `missing` · `defective` ·
`deferred` · `excluded` · `unknown`.
**Verification:** `automated` (a suite or reproduction I ran) · `measured` (a
number taken from a running system) · `source` (inspection only) · `manual` (I
exercised it by hand) · `blocked` (access missing).
**Deployment:** `unverified` for **171 of 173 rows** — no production access existed. The other two are the scope exclusions (Expenses, ZATCA Phase 2), marked `not applicable`.

### 4.2 Domain rollup

Generated from the CSV; the two are the same data.

| Domain | Features | Complete | Partial | Defective | Missing | Deferred | Unknown | Excluded |
|---|---|---|---|---|---|---|---|---|
| Accounting core | 15 | 13 | 1 | | 1 | | | |
| Payments | 12 | 8 | | 2 | 1 | 1 | | |
| Advances | 8 | 7 | 1 | | | | | |
| Credit / debit notes | 9 | 7 | 1 | | 1 | | | |
| Sales documents | 17 | 15 | 1 | | 1 | | | |
| Purchasing | 7 | 6 | | | 1 | | | |
| Financial reporting | 13 | 9 | 1 | 2 | 1 | | | |
| Projects & costing | 6 | 3 | 1 | 1 | 1 | | | |
| Inventory | 6 | 4 | 1 | | 1 | | | |
| HR | 7 | 3 | 4 | | | | | |
| Master data & settings | 13 | 13 | | | | | | |
| Localisation | 10 | 7 | 1 | 2 | | | | |
| Security & audit | 17 | 14 | | 1 | 1 | 1 | | |
| Platform | 15 | 4 | 2 | 3 | 3 | | 3 | |
| Cross-cutting UX | 16 | 13 | 1 | 1 | | 1 | | |
| Scope exclusions | 2 | | | | | | | 2 |
| **Total** | **173** | **126** | **15** | **12** | **12** | **3** | **3** | **2** |

Verification across the same 173 rows: **automated 109**, **measured 2**,
**manual 1**, **source 59**, **blocked 2**.

**On the numbers.** These are counts of features *as I decomposed them*, not a
completion percentage, and none is offered. The denominator is my own
enumeration; a finer or coarser cut moves every figure. `complete` means
*implemented as intended* — a different claim from *tested*, and a very different
one from *deployed*. The table supports a shape, not a score.

### 4.3 Everything not complete-and-verified

| Feature | Intended | Actual | Status | Evidence | Remaining work | Source |
|---|---|---|---|---|---|---|
| **Statements vs payment reversal** *(new — F-10)* | A statement reconciles to the control account | Every `payment_reversal` line is **silently dropped**: `idsOf("payment")` collects only `sourceType='payment'`, no attribution key is created for `payment_reversal`, and unattributed lines are filtered out. Opening balance, closing balance, rows, totals and exports are all understated | **defective** | `automated` — real actions + real `getStatement`, 4/4 scenarios off by exactly 400.00 | Create attribution for `payment_reversal` on both AR and AP sides, mirroring the existing `advance_application_release_reversal` handling | `statements.ts:227,359,284,393,461-462` |
| **Payment reversal — invoice status** *(F-1)* | Status restored across all settlement channels | Recomputed from `paid` and `total` only; `credited_amount` is not even selected. A part-credited invoice drops to `sent`; a fully-credited one reads `sent` instead of `paid` | **defective** | `automated` — **differential between two production library functions**, not an exercised write | Select `credited_amount`; route status through `settlementOf`; assert at the **action** layer | `finance/payments/actions.ts:966-989` |
| **Project cash received** *(F-2)* | Counts cash received and still standing | No `reversed_at is null` predicate; a reversed payment still counts as project cash | **defective** | `source` — every `payments` reader enumerated | Add the predicate | `project-costing.ts:237-253` |
| **Payments register balance** *(N-1)* | The picker shows what is genuinely owed | `total − paidAmount`, omitting `creditedAmount`, at the point of collection | **defective** | `source` | Subtract `creditedAmount`; the PO row is correct as-is | `finance/payments/page.tsx:94` |
| **Statement status label** *(N-2)* | Correct settlement label | `payStatus(total, paid)` omits credited | **defective** | `source` | Pass credited in | `statements.ts:198-202,259` |
| **Credit note on a cash-paid invoice** *(F-9)* | AR and aging agree | No allocation to release, so `Cr 1100` stands alone. Aging drops the row at `outstanding <= 0`; GL 1100 keeps the negative | **partial** | `source` — re-derived at HEAD | Decide the destination — **owner decision** | `backlog.md:533`; `finance-reports.ts:352-353` |
| **Fractional STOCK** *(C-2)* | `quantity_on_hand` holds 1.5 | Not supported. `integer` column; five sites `Math.trunc` (1.5→1, 0.5→0); `adjustStockAction` is **rejected by Postgres** for any fraction. Drift 0.5 per 1.5-unit movement | **missing** | `automated` — measured | Decide whether wanted; then `numeric(12,2)` + five call sites + the adjust path | 5 sites; `evidence/repro-fractional-stock.txt` |
| **Responsive layout** *(C-10)* | Usable below desktop | Desktop 0/29 overflow; **tablet 29/29; mobile 29/29** — `div.topbar-actions` is 653px against a 390px viewport | **defective** | `measured` — 29 routes × 3 viewports | Wrap/collapse the shell below ~1024px, then re-measure | `evidence/repro-ui-coverage.txt` |
| **i18n — keys missing from the dictionary** *(C-9)* | Every `t()` key has Arabic | **27 keys across 30 call sites** are passed to `t()` and absent from the dictionary; English is the key, so they render English silently | **defective** | `automated` — static sweep | Add the 27; add a static assertion so a missing key fails the gate | 13 files |
| **i18n — strings never routed through `t()`** *(C-9)* | No hardcoded user-visible English | **~50 literal strings** in `title`/`label`/`placeholder` props across 24 files, incl. three dashboard KPI titles and the print template's `SUPPLY FROM` / `DELIVERED TO` | **defective** | `automated` + browser sweep | Route through `t()`; exclude genuine placeholders deliberately | 24 files |
| **Backup covers uploaded files** | Backups include documents and branding | `backup.sh` tars a local `./uploads` that no longer exists; it prints "skipping" and **exits successfully**. `backup-dr.md` still describes `uploads/` | **defective** | `source` | Back up Blob explicitly, or document provider durability; correct the doc | `backup.sh:21,34-37` |
| **Payroll posting** | Payroll recorded in the ledger | `gross = basic + allowances`, `net = gross − deductions`; one journal `Dr 5200 / Cr 2200` **at the net total**. Deductions never reach the ledger — salary expense understated, no withholding liability. Documented as deliberate (no tax engine) | **partial** | `source` — traced in full | Decide whether gross posting + withholding is wanted; arithmetic still unverified against a worked example | `hr/payroll/actions.ts:50-100` |
| **Attendance / leave → pay** | Absence and overtime affect pay | **Zero references** to attendance or leave in `processPayrollAction`. Pay comes solely from the latest salary structure | **partial** | `source` | Decide whether they should drive pay | `hr/payroll/actions.ts` |
| **HR Departments** | CRUD | 41-line read-only page; the only HR module with no `actions.ts` | **partial** | `source` | Build CRUD, bilingual from the outset | `hr/departments/page.tsx` |
| **Vendor bills** | An AP document distinct from the PO | **No such entity.** The PO *is* the AP document | **missing** | `source` | Decide whether wanted — affects AP timing and input-VAT date | none exists |
| **Bank reconciliation** | Match ledger cash to a bank statement | **No such feature** | **missing** | `source` | Decide scope | none exists |
| **Period close / lock** | Posting into a closed period prevented | **No period control.** `fiscalYearStartMonth` drives report ranges only | **missing** | `source` | Decide whether wanted | `reports/page.tsx:23` |
| **Sent-proforma revisions** | A sent proforma can be revised and tracked | **Entirely absent** — zero occurrences of `revision` in `src/` or any schema file. No revision number, supersede link or history for **any** document type. Separate from the project-attribution gap | **missing** | `source` — exhaustive | A new feature, not an unfinished one | none exists |
| **Proforma project attribution** *(F-8)* | Proforma work attributed to its project | `proforma_invoices` has **no `projectId`**; conversion never sets one | **missing** | `source` | Column + conversion + **backfill decision** | `db/schema/proforma-invoices.ts` |
| **Blob object access control** *(F-3)* | Files reachable only by authorized users | Written `access:"public"` with `addRandomSuffix:false`; the proxy's auth, tenancy and audit are bypassed by URL possession. No caller currently emits an absolute blob URL | **defective** | `source` — traced, callers enumerated | Private blobs + token-scoped reads, as a **storage and read-path migration** | `blob-storage.ts:98` |
| **CI security suite** *(F-4)* | Every committed assertion runs | Crashes at 7 of **16** on a stale path; **10** assertions never execute; `db:push` and `build` skipped | **defective** | `automated` — CI logs | Fix the path, then confirm the remaining 11 pass | `access-control.test.mjs:51` |
| **CI coverage of the verify tiers** *(N-4)* | The real evidence runs automatically | CI runs **none** of the 68 runnable suites | **missing** | `automated` | Add `verify:static` + `verify:server` with a Postgres service | `devsecops.yml` |
| **Dependency currency** *(C-11)* | No known-vulnerable dependencies | 18 advisories, incl. `next` 16.2.10 with 11. **Three of the four worst do not apply here** (§6.3). Six high packages remain after the `next` bump | **defective** | `automated` + primary sources | Minor-version bump with regression testing; `npm audit fix`; a `puppeteer-core` decision | `package.json` |
| **Generated migrations** *(F-6)* | Schema reproducible from the repo | Stale since 22 July, 146 commits. **Measured:** a migrations-only database is short **7 tables and 204 columns**, and carries **1 column that must be dropped** (net +203) | **partial** | `automated` — two disposable DBs diffed | Add a delta/baseline migration; **do not delete history** | `drizzle/meta/_journal.json`; `evidence/repro-migration-baseline.txt` |
| **Accessibility** *(C-10)* | Keyboard and screen-reader usable | **Keyboard is good** — 30/30 reached with a visible focus indicator on every route probed. Contrast covered. Screen-reader and semantics not examined | **partial** | `measured` | Screen-reader pass | `evidence/repro-ui-coverage.txt` |
| **Health check / monitoring** | Operational visibility | None found | **missing** | `source` | `/api/health` + an error tracker | — |
| **Backup scheduling** | Backups run automatically | `backup-dr.md` schedules via cron/systemd; the target is Vercel, which has neither, and Neon's own backups are not mentioned | **unknown** | `source` | Confirm Neon's PITR tier and record it | `backup-dr.md:37` |
| **Restore drill** | Recovery proven | Never exercised | **unknown** | `blocked` | Perform a drill | `restore.sh` |
| **PO paid status / PO payment cap / debit-note cap** | — | Filed, unbuilt; PO status deliberately deferred at the code site | **deferred / missing** | `source` | Caps are small; PO status needs a decision | `backlog.md` |
| **Segregation of duties** | Ledger actions restricted | `staff` has `full` on Sales & Finance. Documented, intentional | **deferred** | `automated` | **Owner decision** | `role-matrix.ts` |
| **Customer PII encryption** | PII protected at rest | Plaintext; only MFA credentials encrypted | **missing** | `source` | Blind index or display column — **owner decision** | `backlog.md` |
| **Inventory valuation / COGS** | Stock valued, COGS posted | No mechanism found | **partial** | `source` | Confirm intent; design if wanted | — |
| **Performance** | Known under load | No measurement | **unknown** | `blocked` | Measure before engineering | — |

---

## 5. Business workflows and accounting integrity

### 5.1 Scenarios: expected vs observed

**executed** = run in this audit. **derived** = reasoned from traced source, not run.

| # | Scenario | Expected | Observed | Verdict |
|---|---|---|---|---|
| 1 | Client invoice 1,000; payment 400; **reverse**; statement over the reversal period | closing 1,000 (ledger) | **closing 600**, reversal line absent | **FAIL — executed** (F-10) |
| 2 | Vendor PO 1,000; payment 400; **reverse**; statement | closing 1,000 | **closing 600**, reversal absent | **FAIL — executed** (F-10) |
| 3 | Payment **before** the period, reversal **inside** it | opening 1,000, reversal row in period | **opening 600, zero rows** — the customer sees no activity and a wrong opening | **FAIL — executed** (F-10) |
| 4 | Vendor payment where the **PO is outside** the selected range | PO reflected in opening | **PO correctly in opening** — attribution crosses the range boundary properly; the 400 gap is entirely the reversal | **PASS — executed** (no separate defect) |
| 5 | Invoice 1,000; pay 400; credit 600; **reverse the payment** | `partially_paid` | **`sent`** | **FAIL — executed*** (F-1) |
| 6 | Fully-credited invoice; reverse its payment | `paid` | **`sent`** | **FAIL — executed*** (F-1) |
| 7 | Reversal mirrors stored journal lines, both document types | exact mirror | mirror confirmed | PASS — executed |
| 8 | Reversing a PO payment leaves the receipt posting untouched | 1200 unchanged | unchanged | PASS — executed |
| 9 | Double reversal refused; `kind === null` checked explicitly | refusal | refused | PASS — executed |
| 10 | Delete refused at the **server** for payments Reverse covers, with a working control | refusal + control succeeds | both | PASS — executed |
| 11 | 100% credit note on a foreign invoice returns base revenue to zero | 0.000 | 0.000 | PASS — executed |
| 12 | Closing note takes the exact remainder | 0 stranded fils | 0 stranded | PASS — executed |
| 13 | Advance stays a liability in 2300 until allocated | held | held | PASS — executed |
| 14 | Opening bank balance posts once, idempotent on re-run | one entry | one entry | PASS — executed |
| 15 | Displayed balances are a function of the ledger alone | no stored field added to an aggregate | holds, all consumers | PASS — executed |
| 16 | Rounding at the document's minor unit (incl. 3-decimal KWD) | per-currency epsilon | correct | PASS — executed |
| 17 | Document quantity 1.5 prices correctly | 300.000 at 200/unit | correct | PASS — executed |
| 18 | Stock movement for quantity 1.5 | stock moves 1.5 | **moves 1**; 0.5 moves **0**; adjustment **rejected** | **FAIL — executed** (C-2) |
| 19 | Invoice 10,000 cash-paid; credit note 2,000 | AR and aging agree | GL 1100 −2,000, aging 0 | **FAIL — derived** (F-9) |
| 20 | Reversed payment excluded from project cash | excluded | **included** | **FAIL — derived** (F-2) |
| 21 | Payments-register balance for a credited invoice | net of credit | **overstated** | **FAIL — derived** (N-1) |
| 22 | Invoice from a proforma carries its project | attributed | **no project** (no column) | **FAIL — derived** (F-8) |

\* **Scenarios 5 and 6 are a differential between two production library
functions** (`invoiceStatusAfter` vs `settlementOf`), fed the values the action
computes — **not an exercised server action writing to the database** *(C-5)*.
The action's SQL was read to confirm `credited_amount` is not selected. Scenarios
1–4, by contrast, drove the real `recordPaymentAction` and `reversePaymentAction`
over the wire with a genuine owner session.

### 5.2 The statements defect, in detail

`src/lib/statements.ts` resolves each control-account ledger line to a party by
walking `sourceType`/`sourceId` to the source document, then **discards any line
it could not attribute** (line 462). Attribution keys are created for
`sales_invoice`, `credit_note`, `payment`, `advance_application`,
`advance_application_release`, **`advance_application_release_reversal`**,
`purchase_order` and `debit_note`.

**`payment_reversal` is not among them.** `idsOf("payment")` matches only
`sourceType='payment'`, so the reversal's lines resolve to nothing and vanish.

Two things make this worse than a missing row. The dropped lines are excluded
from `opening` as well as the period, so **a statement whose period does not even
contain the reversal is still wrong** if the reversal happened before it. And the
same filtered set feeds `advancesHeld`, the currency list, the totals and the
CSV/Excel/PDF export — so the customer-facing artefact carries the error too.

The fix has a template in the same file: `advance_application_release_reversal`
is already handled, on the same line as its non-reversal sibling.

### 5.3 Money, precision and FX

**The most rigorous part of the system.** `numeric(15,3)`, strings through the
application, **per-currency** rounding epsilon rather than a fixed 0.005 (a fixed
threshold once marked a Kuwaiti invoice paid with four fils outstanding).

FX follows one rule consistently: convert once at posting, store, never
re-convert on read. Reversals mirror stored lines. Notes inherit their source's
rate and post no 4900 line. A missing rate refuses rather than guessing.
Unconverted rows are excluded **and counted**.

### 5.4 Postings, balance, idempotency

Entries balance; suites assert **exhaustive account sets** rather than the
absence of one wrong line. Idempotency is keyed on `(sourceType, sourceId)` —
`payment_reversal` is the canonical instance, keying off the same `payments.id`
as its original. `FOR UPDATE` locks with in-transaction status re-checks guard
retries and double clicks. Append-only enforcement on `audit_logs` and
`security_events` is **installed by trigger** and verified against the database.

### 5.5 Purchasing, VAT, reconciliation and period controls *(now assessed)*

- **Vendor bills do not exist.** The purchase order *is* the AP document: AP is credited at receipt and settled by payments against the PO.
- **Input VAT is implemented** — `getVatSummary` computes `outputVat = sales tax − credit-note tax` and `inputVat = PO tax − debit-note tax`, at stored base amounts, with unconverted rows excluded and counted. A consequence of having no bill entity: **input VAT is recognised at PO receipt, not at a bill date.**
- **Bank reconciliation does not exist.**
- **No period close or period lock exists.** `fiscalYearStartMonth` drives report date ranges only; nothing prevents posting into a past period.

For a product that is otherwise this careful about the ledger, the absence of a
period lock is the most surprising gap in this list.

### 5.6 Payroll *(now assessed)*

`gross = basicSalary + allowances`; `net = gross − deductions`. One summary
journal per run: **`Dr 5200 Salary Expense / Cr 2200 Salaries Payable` at the net
total.**

**Deductions therefore never reach the ledger.** Salary expense is understated by
the total deducted, and no liability is recorded for amounts withheld — which in
most jurisdictions are owed onward. The source documents this as deliberate
("deductions have no recovery account in this chart — same 'no tax engine'
boundary as the rest of the payroll scope"), so it is a known boundary rather
than a bug. It is still a real limitation of the financial statements.

Separately: **attendance and leave do not feed payroll at all** — zero references
in `processPayrollAction`. Absence, unpaid leave and overtime have no effect on
pay. The run is idempotent per period (a second run for the same month is
refused) and role-gated to owner/admin.

**The arithmetic itself was not verified against a worked example.** That remains
*not yet examined*.

---

## 6. Security, UX and operational readiness

### 6.1 Security

Genuinely strong: `AUTH_SECRET` with no fallback; `__Host-` cookie prefix;
**server-side revocation**; the **`src/proxy.ts` edge gate** *(C-8)*; a strict
CSP with HSTS preload and `frame-ancestors 'none'`; AES-256-GCM with versioned
rotation for MFA secrets; HMAC-signed URLs with `timingSafeEqual` and expiry;
magic-byte upload sniffing with SVG excluded; server-generated filenames;
append-only audit enforced by trigger; `tenantScope` with soft-delete defaults;
self-escalation prevented; gitleaks green.

**(a) File storage has no access control — F-3.** `access:"public"` with
`addRandomSuffix:false` makes every object world-readable at a URL fully
determined by `blobBaseUrl()` + the pathname. The proxy — path validation, org
match, filename allowlist, session **or** HMAC signature, append-only
`file_access_logs` — constrains nothing at the storage layer.

Stated carefully: filenames carry 64 bits of entropy, `blobUrlFromStored()` has
**no callers**, and the only absolute-URL construction is the server-side `fetch`
inside the proxy. **The application does not currently emit blob URLs.** So this
is a **defense-in-depth failure and a latent exposure, not a present leak** — one
`<img src>` away from becoming permanent, unauthenticated, unauditable and
unrevocable. The module's own header comment claims "blob URLs are never exposed
and cross-tenant access is denied"; the first half is true of the app as written,
the second is true of the proxy and false of the storage.

**(b) CI proves much less than it appears to — F-4.** The crash at assertion 7 of
17 means the upload-route checks, the signed-URL HMAC/constant-time/expiry
checks, the login rate-limit and MFA checks, `.env is gitignored` and **`no
insecure AUTH_SECRET fallback`** never execute. Those controls exist in the code
— I read them — but the automated guard keeping them there is silently absent.

**(c) `crypto-policy.test.mjs:56` tests the artefact, not the state.** Its "DB
trigger rejects UPDATE/DELETE" assertion reads the **SQL file's contents** and
would pass against a database with no triggers. `verify:db-hardening` does the
real check — and does not run in CI.

**Customer PII is plaintext.** Filed with a sound analysis of why it is not
simple: any encryption breaks client search, global search, name sorting, import
lookup and duplicate detection.

**No compliance determination is made by this audit.** Compliance cannot be
established from source code, and no authoritative regulatory source was
consulted. The product's own Compliance Center was previously corrected to say it
is a self-assessed checklist with no external audit, and `verify-compliance-claims`
keeps it honest.

### 6.2 Localisation and UX *(substantially corrected — C-9, C-10)*

**The dictionary is complete; the UI is not.** 1,587 entries, exactly one without
Arabic (a placeholder email). That measures the dictionary. Two separate gaps
sit above it:

- **27 keys across 30 call sites** are passed to `t(locale, "…")` but are **absent from the dictionary**. Because English *is* the dictionary key, these render English in Arabic with no error and no missing-key marker — the failure is invisible by design.
- **~50 literal English strings** sit in `title`/`label`/`placeholder`/`description` props across 24 files, never routed through `t()` at all: three dashboard KPI titles (`Total Sales`, `Total Invoices`, `Total Receivables`), vendor/product/employee form labels, and the **customer-facing print template's `SUPPLY FROM` / `DELIVERED TO`**. An upper bound — a few are deliberate example placeholders.

A 29-route browser sweep in Arabic confirmed both classes on real pages. `dir="rtl"`
is applied correctly at the root, and RTL structure itself looked sound.

This is the project's own recorded v25 failure recurring: a pass that translated
the shell and left detail screens English. The lesson the repo already drew —
*assert the exhaustive set* — applies here as a static check that a `t()` key
missing from the dictionary fails the gate.

**Responsive: the product is desktop-only in practice.** Measured across 29
routes: desktop 1440px **0 overflow**; tablet 768px **29 of 29**; mobile 390px
**29 of 29**, with `div.topbar-actions` rendering 653px against a 390px viewport.
Tablet failing as completely as mobile is the part worth noticing — this is not a
phone-polish gap.

**Keyboard accessibility is good.** On every route probed, 30 of 30 tab stops
were reachable and **all 30 had a visible focus indicator**. Screen-reader
behaviour and semantic structure remain *not yet examined*.

### 6.3 Dependencies — corrected with primary sources *(C-11)*

18 advisories (8 moderate, 9 high, 1 critical package). `next` 16.2.10 carries 11
of them. The first report called the fix "non-breaking" and said it cleared the
gate. **Both were wrong**, and the severity framing was alarmist.

**Applicability to *this* deployment**, checked against each advisory and this
app's actual configuration:

| Advisory | Sev | Applies here? |
|---|---|---|
| GHSA-p293-qw3h-jr36 — RCE on Windows-hosted servers (CVSS 9.0) | critical | **No.** Explicitly Windows-filesystem only; Linux unaffected. This deploys to Vercel |
| GHSA-2xp9-vwfh-vxw4 — RCE via AVIF in Image Optimization (CVSS 9.5) | critical | **Low, not nil.** Needs AVIF through image optimization. Uploads are magic-byte restricted to PNG/JPG/PDF and no `remotePatterns` is configured, so same-origin AVIF is not producible through the app — but this is an argument from configuration, not a guarantee |
| GHSA-6gpp-xcg3-4w24 — middleware/proxy bypass | high | **No.** Requires a single entry in `config.i18n.locales`; this app has **no `i18n` config** — locale is a cookie. Patched in 16.2.11, a patch-level bump |
| GHSA-89xv-2m56-2m9x — SSRF in Server Actions on custom servers | high | **No.** No custom server |
| GHSA-p9j2-gv94-2wf4 — SSRF in rewrites | high | **No.** No `rewrites` configured |
| GHSA-m99w-x7hq-7vfj — DoS in App Router Server Actions | high | **Yes** |
| GHSA-955p-x3mx-jcvp — unauthenticated disclosure of internal Server Function endpoints | moderate | **Yes** |
| cache confusion ×2, unbounded Edge payload, SVG image DoS | moderate | **Likely** |

**Version facts.** The two criticals are patched in **16.3.3**; npm suggests
**16.3.5** as the current patch of that line. `16.2.10 → 16.3.x` is a **minor**
version change. `isSemVerMajor:false` means only "not a major" — it is not a
compatibility guarantee, and this app uses Turbopack, Server Actions and a proxy
file whose API surface Next has been actively changing.

**The gate will still fail.** After the `next` bump, **six high-severity packages
remain**: `brace-expansion`, `browserslist`, `js-yaml`, `nanoid` (all fixable by
`npm audit fix` in place) and `@puppeteer/browsers`, `extract-zip`,
`puppeteer-core` (which need a **major** bump of `puppeteer-core` to 25.10.0).
Keeping `--audit-level=high` — which the roadmap does — means all of these must
be addressed or consciously accepted.

One genuinely reassuring note: GHSA-6gpp's own mitigation advice is to move
authorization out of middleware into the server-side data path. **That is already
this codebase's design.**

### 6.4 Performance — hypotheses, nothing measured

No measurement was taken; everything here is inferred from query shape.

- **Every route is dynamic.** No static prerendering anywhere.
- **No background work of any kind.** Imports, PDF generation and exports run synchronously inside a request. This is the structural risk most likely to surface first.
- **Aggregate reads scan.** Dashboard receivables/payables sum an expression across invoices and POs per request; index coverage was **not** checked.
- Transaction boundaries are correct where traced; earlier concurrency defects were fixed with locks rather than retries.

### 6.5 Operational readiness

| Capability | State |
|---|---|
| Production build | **Verified green here**; not reached in any of the 10 inspected CI runs |
| Health check | **None found** |
| Monitoring / error tracking | **None found** |
| Backups — database | `pg_dump` script exists; **scheduling assumes cron/systemd, which Vercel does not have**, and Neon's own PITR is not mentioned |
| Backups — **uploaded files** | **Not backed up.** `backup.sh` tars a local `./uploads` that no longer exists, prints "skipping", and **exits successfully** |
| Restore drill | **Never performed** |
| Migration safety | **`db:push` only.** A migrations-only database is short **7 tables and 204 columns** and carries **1 column to drop** — net +203 (measured) |
| Rollback | Not documented; the pending columns are additive, so code rollback is safe |
| Environment config | 6 required variables; `AUTH_SECRET` and `BLOB_READ_WRITE_TOKEN` throw rather than defaulting |

The backup finding deserves emphasis: a backup script that **reports success
while silently skipping the file half** is the same species this repository
already catalogues — a check satisfied by a clean exit for an unrelated reason.

---

## 7. Completed vs pending

### 7.1 Verified completed capabilities

Implementation **and** executed automated verification:

double-entry ledger with balanced idempotent postings · multi-currency at stored
posting-date rates with per-currency rounding · advances as 2300 liabilities
until allocated, with four distinct channels · notes inheriting their source's
rate, closing note taking the exact remainder (0 stranded fils, measured) ·
payment reversal by mirroring stored lines, with server-side delete refusal
proven by action replay against a working control · bank opening balances posted
once and idempotent · **ledger-only balances** enforced statically across all
consumers · append-only audit trail enforced by trigger and verified against the
database · document lifecycle across all eight types with refusals that name the
corrective path · **decimal document quantities** · import at 489 assertions ·
role model as data, asserted both directions · **the `src/proxy.ts` edge auth
gate** · **security response headers** · honest compliance labelling ·
**keyboard reachability and focus visibility** · production build green.

### 7.2 Not complete

**Defective (12):** statements drop payment reversals (F-10) · payment-reversal
status (F-1) · project cash (F-2) · payments-register balance (N-1) · statement
status label (N-2) · blob access control (F-3) · CI security suite (F-4) ·
dependency set (C-11) · responsive layout (C-10) · i18n keys missing from the
dictionary (C-9) · i18n strings never routed through `t()` (C-9) · backups not
covering uploaded files.

**Partial (15):** credit notes on cash-paid invoices (F-9) · aging dropping
non-positive rows · payroll posting net-only · attendance and leave not feeding
pay · leave · HR Departments · inventory valuation/COGS · generated migrations ·
rollback procedure · accessibility · unconverted-row reporting completeness ·
advances against proformas in project reporting · and three more in the CSV.

**Missing (12):** fractional stock · proforma `projectId` · **sent-proforma
revisions (and document revisions generally)** · vendor bills · bank
reconciliation · period close/lock · PO payment cap · debit-note cap · customer
PII encryption · health check · monitoring · CI coverage of the verify tiers.

**Deferred by decision (3):** PO paid statuses · segregation of duties ·
background work.

**Unknown (3):** backup scheduling on the actual target · restore drill ·
performance under load.

**Excluded (2):** Expenses as a separate application · ZATCA Phase 2.

**And, orthogonally: 171 of the 173 rows are `unverified` for deployment** — the other two are the scope exclusions.

### 7.3 Discrepancy register

| # | Claim | Source | Evidence | Verdict |
|---|---|---|---|---|
| D-1 | "blob URLs are never exposed and cross-tenant access is denied" | `blob-storage.ts:11-12` | First half true of the app as written; second true of the **proxy**, false of the **storage** | **Misleading** |
| D-2 | CI "runs … the security test suite. Any failure fails the pipeline" | `devsecops.yml:3-5` | Accurate about failing. But the suite **crashes at 7 of 16**, and CI runs **none** of the 68 runnable verify suites | **Overstated** |
| D-3 | Deploy runbook: four columns, exact types, no backfill needed, `db:migrate` is a trap | `backlog.md` | Confirmed exactly against a fresh push | **Accurate** |
| D-4 | "Credit notes on a CASH-paid invoice still drive AR negative" — unfixed | `backlog.md:533` | Re-derived at HEAD: still live | **Accurate** |
| D-5 | "proforma_invoices has no projectId column at all" | `backlog.md:853` | Confirmed | **Accurate** |
| D-6 | `6422235`'s message enumerates the readers updated for the three-channel model | git history | **Three were missed**: `reversePaymentAction`, `payments/page.tsx:94`, `statements.ts:259` | **Incomplete** |
| D-7 | "DB trigger rejects UPDATE/DELETE on audit tables" | `crypto-policy.test.mjs:56` | Reads the **SQL file**; passes with no triggers installed | **Tests the artefact, not the state** |
| D-8 | README: uploads "stored under a gitignored `uploads/` directory" | `README.md` | Storage is **Vercel Blob** | **Stale** |
| D-9 | Compliance Center is self-assessed, not certified | product UI | Asserted and passing | **Accurate** |
| **D-10** | `backup-dr.md`: "the database backup **is** the system backup, plus the `uploads/` directory" | `backup-dr.md:5,23,33` | `uploads/` no longer exists; the script skips it **and exits 0** | **Stale, and it hides a real gap** |
| **D-11** | Source comment: payroll's net-total posting is "the documented simplification" | `hr/payroll/actions.ts:83-85` | **Accurate** — correctly labelled as a boundary, not hidden | **Accurate** |

### 7.4 Risk register

| ID | Risk | Sev | Business impact | Evidence | Remediation |
|---|---|---|---|---|---|
| **R-21** | **Statements drop payment reversals** | **High** | Customer- and vendor-facing statements understate the balance by the reversed amount, in the rows, the opening balance, the closing balance and the export. A reversal is precisely the correction a disputing customer is being shown | F-10, **reproduced 4/4** | Attribute `payment_reversal` on both sides |
| **R-3** | Payment reversal writes a wrong invoice status when a credit note exists | **High** | Settled invoices reappear in the collections worklist; staff chase money already credited | F-1 | Route status through `settlementOf` |
| **R-5** | Credit note on a cash-paid invoice: GL 1100 and aging disagree | **High** | The control account does not reconcile to its subledger | F-9 | **Owner decision** on destination |
| **R-4** | **Deployment state unknown** | **High** | A deploy on wrong assumptions fails on missing columns; nobody can state what is live | F-7, F-6 | **§11 pack** |
| **R-2** | Blob objects public with deterministic URLs | **High** | Latent, permanent, unauditable, unrevocable exposure of customer documents if any URL ever leaks | F-3 | Storage + read-path migration |
| **R-6** | CI red throughout the inspected history; build never reached; 11 security assertions never run | **High** | Regressions ship unseen | F-4, F-5 | One-line path fix |
| **R-22** | **Uploaded files are not backed up, and the backup reports success** | **High** | Total loss of every document, logo, seal and signature in a recovery, discovered only during the recovery | `backup.sh:34-37` | Back up Blob, or document provider durability. **Status (Batch 1, branch `claude/batch-1-financial-reliability`): PARTIALLY addressed — the false report is gone and the restore guidance no longer contradicts it, but the blob bytes are still unprotected and provider recovery is still unverified. The remaining half is Batch 11.** This row describes the finding as it stood at `04457ff` and is not rewritten. |
| **R-23** | **The product is unusable below ~1024px** | **Medium–High** | Tablet as well as mobile; every route overflows. Field and warehouse use is not possible | **measured**, 29/29 | Wrap/collapse the shell |
| **R-24** | **Fractional stock is silently truncated** | **Medium** | Stock drifts 0.5 per 1.5-unit movement; a 0.5 movement does nothing; adjustment throws. Money is unaffected | **measured** | Decide, then `numeric` + 5 sites |
| **R-7** | CI runs none of the verify suites | **Medium** | The real evidence depends on someone remembering | N-4 | Add two tiers to CI |
| **R-8** | Reversed payments counted as **project cash** | **Medium** | **Corrected:** this overstates the *Received Payments* cash figure only. `profit = invoiced − totalCost` and `marginPercent = profit / invoiced` **do not read cash at all**, so profit and margin are *not* affected | F-2, formulas traced at `project-costing.ts:393-394,452` | Add `reversed_at is null` |
| **R-9** | Payments register overstates outstanding for credited invoices | **Medium** | Over-collection at the point of entry | N-1 | Subtract `creditedAmount` |
| **R-10** | Customer PII in plaintext | **Medium** | Breach exposes names, emails, phones, addresses | filed | **Owner decision** |
| **R-25** | **~50 hardcoded English strings + 27 missing dictionary keys** | **Medium** | The Arabic product is not fully Arabic, including a customer-facing print template. Fails the project's own standing requirement | **measured** | Add keys; route props through `t()`; add a static gate |
| **R-11** | Invoices from proformas carry no project | **Medium** | Project revenue under-reported | F-8 | Column + conversion + backfill decision |
| **R-26** | **No period close or lock** | **Medium** | Prior periods can be posted into after reporting; restated figures with no control | traced | Decide whether wanted |
| **R-27** | **Payroll posts net; deductions never reach the ledger** | **Medium** | Salary expense understated; no liability for withheld amounts | traced | Decide gross posting + withholding |
| **R-12** | No health check, monitoring or error tracking | **Medium** | Outages found by users | — | `/api/health` + tracker |
| **R-13** | Restore never drilled; backup scheduling unproven on Vercel | **Medium** | Recovery capability unproven | — | Drill; confirm Neon PITR |
| **R-1** | Vulnerable dependencies | **Medium** | **Corrected from Critical.** Three of the four worst advisories do not apply here (§6.3); what remains is a DoS and an endpoint-disclosure class | **primary sources** | Minor bump **with regression testing** + `npm audit fix` + a `puppeteer-core` decision |
| **R-14** | No background work; imports/PDFs synchronous | **Medium** | Large imports compete with request timeouts | — | **Measure first** |
| **R-15** | No segregation of duties | **Medium** | A single junior account can reverse revenue | `role-matrix.ts` | **Owner decision** |
| **R-16** | Statement status labels ignore credited | **Low** | Mislabels a settled invoice; **amounts are right** | N-2 | Pass credited in |
| **R-17** | Debit notes and PO payments uncapped | **Low** | Over-crediting or overpaying passes silently | filed | Mirror the credit-note cap |
| **R-28** | **No vendor bills; no bank reconciliation** | **Low–Medium** | Input VAT is recognised at PO receipt; cash cannot be tied to a bank statement | traced | Decide scope |
| **R-18** | HR Departments read-only | **Low** | Departments seeded outside the product | — | Build CRUD |
| **R-29** | **`verify-duedate.mjs` reachable by no runner** | **Low** | A suite that looks like coverage and is never executed | inventory | Wire it in |
| **R-20** | README and `backup-dr.md` describe local-filesystem uploads | **Low** | Misleads a new operator about where data lives | D-8, D-10 | Correct both |

### 7.5 Test coverage and confidence

| Tier | Suites | Assertions counted | Run here | Result | In CI |
|---|---|---|---|---|---|
| Static (`verify:static`) | 8 | **388** (6 suites report `N/N`; 2 report `N passed`) | yes | **PASS, 0 fail** | **no** |
| Server (`verify:server`) | **24** | **957** across 21, **+150** `PASS` lines in 2 more, 1 state gate | yes | **PASS, 0 fail** | **no** |
| Browser (`verify:browser`) | 36 | **972** across 26 of 36 | yes | **PASS, 36/36, 0 fail** | **no** |
| `tests/security/` | 2 files | **34** written, **24 reached** | via CI logs | **crashes at 7 of 16 in one file** | yes (partly) |
| **Orphaned** | **1** (`verify-duedate.mjs`) | 9 | **manually, this pass** | PASS 9/9 | **no runner at all** |
| `scripts/tests/` | 26 | unknown | no | not executed | no |

**Totals executed in this audit: 68 suites, 2,467 counted assertions, zero
failures** *(corrected — C-3)*.

**Suite inventory, three distinct numbers** *(C-3, C-4)*:

- **71 files** in `verify/` — the number the first report quoted as "suites".
- **3 are helpers** (`assert-fresh-build`, `register-org`, `run-browser-suites`), leaving **68 candidate suites**.
- **36 are browser-discovered** (`.mjs` containing `localhost:3000`) and all 36 ran; **32 are npm-wired** into `verify:static`/`verify:server` and all ran.
- **1 is reachable by neither** — `verify-duedate.mjs`, a database-only `.mjs` with no `localhost:3000` and no npm script naming it. It passed 9/9 when I ran it by hand.

**Confidence by area.** *High* — settlement, FX, advances, reversal mechanics,
notes, bank opening, lifecycle, ledger invariants, import, keyboard access.
*Medium* — statements, project costing, reporting: covered, with holes exactly
where the defects were found. *Low* — payroll arithmetic, inventory valuation,
screen-reader accessibility, performance, backup/restore. *None* — production.

**The structural weakness is not the suites; it is that nothing runs them, and
that they test libraries.** F-1 survived a 55/55 run of the suite named after it
because the defect is in the action's SQL. F-10 survived a 70/70
`verify:statements` run because that suite **hand-rolls journal inserts with its
own `post()` helper** and therefore never creates a `payment_reversal` entry at
all — it could not have caught this.

### 7.6 Deployment and database readiness

**Not ready to deploy, and the blocking item is an unknown rather than a defect.**

1. **Production schema state is unknown (R-4).** §11 answers it read-only.
2. **`db:migrate` must not be used.** **Measured:** migrations-only yields 59 tables / 609 columns against the current 66 / 812. The gap is **204 columns to add and 1 to drop** — a net +203, reconciled in §12 — plus 7 whole tables including `advance_applications`, `advance_application_releases`, `exchange_rates` and `document_attachments`.
3. **The pending columns are deploy-safe** — additive, nullable or defaulted, and Drizzle emits explicit column lists.
4. **`npm run db:push` and `drizzle-kit push` are not interchangeable.** Only the npm script chains `db:harden`; a bare push installs **0 of 2** audit triggers (measured).
5. **CI cannot gate a deploy** until R-6 is fixed.
6. **A bank-opening backfill, if undeployed, runs *after* the code deploy** — the opposite ordering to everything else.

---

## 8. Preserved scope decisions

Carried forward unchanged:

- **Expenses stays outside Elite ERP** as a separate application (`verify-expense-categories-hidden`, 16/16).
- **ZATCA Phase 2 is excluded** unless requested. Phase 1 QR on printed tax invoices is implemented and honestly labelled; the four unwired columns remain its natural home.
- **Lead Capture / Kapt Now consolidation, a unified shell/login/tenant, and Party + PartyRole are strategic context only** — assessed for prerequisites, assumed neither delivered nor approved. Prerequisites worth noting: the three-role model with no permissions engine, and `orgId` scoping enforced by convention rather than by the database. Both are adequate for one application and would need deliberate work for several.
- **New or revised UI must support English and native Saudi Arabic with correct RTL from the outset.** §6.2 shows this standard is currently **not** being met — which makes it a live constraint, not a formality.

---

## 9. Revised first remediation batch

Revised against the confirmed findings. **Statement reversal handling is now in
it**, and the dependency item is reshaped.

1. **Fix the CI security-test path** (`access-control.test.mjs:51`), then confirm the 10 assertions after it actually pass. One line; it unblocks everything else.
2. **F-10 — attribute `payment_reversal` in statements.** The highest-impact money defect confirmed in this pass, customer-facing, with a template already in the same file.
3. **F-1 — payment-reversal status**, asserted at the **action** layer.
4. **F-2 — `reversed_at is null` in project cash.**
5. **N-1 — subtract `creditedAmount` in the payments register.**
6. **Back up uploaded files** (or record that Blob durability is the provider's and correct `backup-dr.md`). Cheap, and today a recovery loses every document.
7. **Run the §11 production pack** and record the answers.

**Deliberately *not* in the first batch:** the `next` upgrade. It is a minor
version bump whose worst advisories do not apply here (§6.3); it needs its own
regression cycle, and putting it beside five one-line financial fixes would make
the batch impossible to bisect. It is Batch 2.

**This audit stops here. No implementation was performed and none is approved.**

---

## 10. Decisions only the owner can make

1. **Production database state** — run §11 and report. Nothing in the deployment plan can be finalised without it.
2. **Credit notes on cash-paid invoices: where does the credit go?** 2300 is the *consistent* answer given how advances are treated, **but this audit does not adopt it.** It changes non-advance credit-note behaviour and every test pinning it. Alternatives: leave AR negative and document it, or require a refund. An accounting-policy choice.
3. **Segregation of duties** — should `staff` keep the ability to void invoices, issue notes and receive POs? **No role change is proposed here.**
4. **Customer PII encryption** — blind index (exact and prefix survive; substring does not; equality leakage becomes deliberate) or a separate display column (simpler; concedes the name is unprotected). Both need a full backfill and a defined behaviour when `FIELD_ENCRYPTION_KEYS` is absent.
5. **Proforma project attribution** — backfill already-converted invoices, and from what source?
6. **Migration strategy** — see §12. **Not deletion.**
7. **`puppeteer-core` major upgrade** (→ 25.10.0) for the PDF path, or accept three high-severity advisories on a build/PDF-time dependency and document that acceptance.
8. **Fractional stock** — is it wanted at all? If not, the honest fix is to *reject* fractional quantities on stock-tracked items rather than truncate them silently.
9. **Payroll** — should deductions post gross with a withholding liability, and should attendance and leave affect pay?
10. **Period close/lock, vendor bills, bank reconciliation** — each absent; each a scope decision.
11. **Responsive support** — is tablet/mobile in scope? Today neither works.
12. **PO paid statuses**, and whether inventory valuation/COGS was ever intended.

---

## 11. Establishing what is deployed — without granting access

Prepared so this can be closed in minutes. **Read-only; nothing writes; no
credential needs to be shared.**

- **[`evidence/production-verification.sql`](evidence/production-verification.sql)** — six annotated `SELECT`s, **executed successfully against the disposable audit database** so they are known to parse and return what the comments say.
- **[`evidence/production-verification-README.md`](evidence/production-verification-README.md)** — how to find the deployed commit (Vercel dashboard → deployment → Source), and what each answer means.

| Query | Establishes |
|---|---|
| Q1 | whether the six pending columns exist |
| Q2 | whether the database was built by `db:push` (66/812) or by the stale migrations (59/609) |
| Q3 | whether the seven tables a migrations-only deploy lacks are present |
| Q4 | whether both append-only audit triggers are installed |
| Q5 | outstanding backfills — bank openings, credited amounts, unconverted foreign documents |
| Q6 | whether the reversal **code** is live, not merely its columns |

**Column presence alone does not establish deployment completeness.** Four things
are independently true or false — the columns exist; the code using them is
deployed; the controls that must accompany the schema are installed; any backfill
has run. Q1 answers only the first. Q6 gives *positive* evidence for the second
and **cannot** give negative proof — zero reversals may simply mean the feature
is unused.

---

## 12. Migration strategy — preserving history

**The first report offered "regenerate or delete" as equal options. Deleting
history is withdrawn.** `drizzle/0000`–`0004` and `_journal.json` stay exactly as
they are.

**What was measured** (`evidence/repro-migration-baseline.sh`, two disposable
databases, neither being production):

| | tables | columns |
|---|---|---|
| built from committed migrations `0000`–`0004` | **59** | **609** |
| built by `drizzle-kit push` from the current schema | **66** | **812** |
| **shared by both (identical)** | — | **608** |
| **only in `db_push` — a new migration must ADD** | **7 tables** | **204** |
| **only in `db_mig` — a new migration must DROP** | — | **1** |

The seven absent tables: `advance_applications`,
`advance_application_releases`, `document_attachments`,
`document_column_configs`, `exchange_rates`, `rate_fetch_attempts`,
`seal_signature_assets`.

**Reconciling 609 → 812.** The two figures that look inconsistent are both
correct, and this is written out so no future reader takes them for an
arithmetic error:

```
608 shared + 1 only-in-migrations  = 609   (db_mig)
608 shared + 204 only-in-push      = 812   (db_push)
net 812 − 609 = 203 = 204 added − 1 dropped
```

**204 is the set difference** — the columns a new migration must **add**. **203
is the net change** in total column count, because one column must also be
**dropped**. Comparing on full column *fingerprints* (identity + type +
nullability + default) returns **the same 1 and 204**, which establishes a
further fact: **no shared column differs in type, nullability or default.** The
gap is purely additive plus one drop.

**The one dropped column, and why `drizzle-kit generate` stops.** It is
`terms_conditions_groups.content` (`text NOT NULL`), replaced in commit `15ef378`
("Store master Terms Groups as structured, ordered terms") by
`terms_conditions_groups.terms` (`jsonb NOT NULL DEFAULT '[]'`).

`drizzle-kit generate` fails at `promptColumnsConflicts` with *"Interactive
prompts require a TTY"* because exactly one table has a deleted column **and**
gains one, so the tool cannot distinguish a rename from a drop-and-create and
must ask. **There is exactly one such decision** — the count is bounded, not
open-ended.

*(Corrected: an earlier draft attributed this prompt to `openingBalance` →
`openingBalanceLegacy`. That is wrong. That rename changed only the **Drizzle
field name**; the SQL column is still `opening_balance` (`finance.ts:48`) and is
present in **both** databases, so it produces no diff and cannot prompt anything.)*

Note that `content text` → `terms jsonb` is a **data-carrying** change. It
matters only for a database actually built from migrations; if production was
built by `db:push` it already has `terms` and never had `content`.

**Recommended approach** — detailed in the roadmap, Batch 8:

1. Keep `0000`–`0004` untouched.
2. Produce **one** `0005` delta, authored with a person answering the single column-conflict prompt (or hand-written from the diff above, which is already measured).
3. **Prove it on both database shapes**, which is the acceptance criterion: a **fresh** database built by migrations alone must fingerprint-match one built by `db:push`; and a database **already at `0004`** must reach the same fingerprint after applying only `0005`.
4. Note that **neither path installs the audit triggers** — measured, 0 of 2 on both. `db:harden` must stay in the deploy sequence regardless.
5. Remove `db:migrate` from `package.json` only once `0005` exists and is proven; until then it remains a trap, and the runbook must keep saying so.

---

## 13. How to read this audit

- §0 is the correction log. Where this pass contradicts the first, **§0 is authoritative**.
- "PASS/FAIL — executed" means run on 12 September 2026 against a **disposable local PostgreSQL database** created for the purpose and dropped afterwards. "derived" means reasoned from traced source. Scenarios 5–6 carry an explicit note that they are a **library differential**, not an exercised write.
- No completion percentage is offered. §4.2 discloses its denominator and describes a shape.
- "Implemented", "tested" and "production-ready" are kept apart. The product is strong on the first, good on the second, and **unproven on the third**.
- §2.3 separates **"not yet examined"** (nobody looked) from **"blocked"** (access missing). Only production is blocked.
