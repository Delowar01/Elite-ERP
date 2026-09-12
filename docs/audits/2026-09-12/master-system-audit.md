# Elite ERP — Master System Audit

**Audit date:** 12 September 2026
**Repository:** `Delowar01/Elite-ERP`
**Revision audited:** `main` @ `04457ff29948111bd5d24eff3eaf4e75b90971cf` (working tree clean)
**Scope:** audit and reporting only — no application code, configuration, schema, migration, or data was changed.

Companion files: [`verification-evidence.md`](verification-evidence.md) (what was
run and what came back), [`feature-status-matrix.csv`](feature-status-matrix.csv)
(the full per-feature table), [`prioritized-roadmap.md`](prioritized-roadmap.md)
(batched remediation plan).

---

## 1. Executive assessment

Elite ERP is a **substantially built, unusually well-tested accounting product
with a small number of specific defects and one large unknown.**

The accounting core is the strongest part and it is genuinely strong. Double-entry
posting, multi-currency at stored posting-date rates, advance receipts held as
liabilities until allocated, credit and debit notes that inherit their source's
rate, payment reversal by mirroring stored ledger lines, and an append-only audit
trail enforced by database triggers — these are not sketched, they are implemented
and covered by roughly 860 server-tier assertions plus 36 browser suites, all of
which I ran and all of which pass. The codebase also shows an unusual discipline
about its own verification: `verify/README.md` catalogues the ways an assertion
can be vacuous, and several suites were demonstrably strengthened after being
caught proving nothing.

Against that, four things stand out.

**First, the product's own settlement model is not applied consistently.** A
change on 19 August split the settlement identity into three channels — paid,
credited, and the remainder — and updated most readers. It missed at least three.
The most consequential is payment reversal, which resets an invoice's status
using only `paid` and `total`, so reversing a payment on an invoice that also
carries a credit note reports the invoice as untouched. I reproduced this
numerically. The others overstate an outstanding balance on the screen where
someone decides how much money to collect, and mislabel a customer statement.

**Second, file storage has no access control.** The authenticated proxy in front
of uploads is carefully built, and it is not what protects the files. Objects are
written to Vercel Blob with `access: "public"` and random suffixes disabled, so
the proxy's session checks, tenant scoping and audit log are all bypassed by
anyone holding a URL. Today the application does not hand those URLs out, so this
is a latent design gap rather than an active leak — but the only thing standing
between a stored document and the public internet is 64 bits of filename entropy.

**Third, the pipeline has been red for its entire recent history, for a trivial
reason, and it is hiding more than it shows.** One stale file path in a security
test crashes the suite, which skips the production build — so **CI has never
verified that this application builds**, and eleven security assertions after the
crash point never execute. I ran the build directly: it succeeds. The blocker is
a string, not a broken product. Separately, CI runs **none** of the 71 verify
suites that constitute this project's real quality evidence.

**Fourth, and most important: nobody can say what is deployed.** No production
credentials exist in this environment and none were sought — the brief forbids
touching production, and writing to an unidentified database is exactly the thing
one must not do. Nothing in the repository records a deployment. Four to six
schema columns are committed but of unknown deployment status, the generated
migrations have been stale for 146 commits, and `db:migrate` would silently apply
nothing. **This is the largest open question in the audit and only the owner can
close it.**

On readiness, kept deliberately separate:

- **Implemented** — broad and deep across sales, purchasing, finance, inventory, projects, HR and settings.
- **Tested** — strong for accounting, weaker for HR and projects, and entirely dependent on manual execution.
- **Production-ready** — **not demonstrable today**, and the obstacles are largely procedural rather than architectural.

The gap between "this is well-built" and "this is safe to run" is smaller than it
looks. Most of it is one dependency bump, one corrected file path, one storage
setting, three reader fixes, and a deployment fact I cannot obtain.

---

## 2. Coverage register

What was examined, how, and what was not. This register exists so that no part of
this audit is read as more complete than it is.

### 2.1 Method legend

| Depth | Meaning |
|---|---|
| **Traced** | Read end to end and followed through its callers/callees |
| **Read** | Read directly, not exhaustively traced |
| **Executed** | Exercised by a verification suite I ran in this audit |
| **Sampled** | Inspected in part — enough to characterise, not to certify |
| **Not examined** | Stated plainly; conclusions about it are absent, not implied |

### 2.2 By area

| Area | Depth | Basis |
|---|---|---|
| Settlement model (`settlement.ts`, `base-amounts-sql.ts`) | **Traced + Executed** | Read; all readers enumerated; `verify:settlement` 29/29 |
| Payment reversal (`payment-reversal.ts` + action) | **Traced + Executed** | Read both; defect reproduced; `verify:payment-reversal` 55/55 |
| Note FX (`reversal-currency.ts`) | **Read + Executed** | `verify:note-fx` 40/40 |
| Advances / allocations / releases / refunds | **Read + Executed** | 6 suites, 95 assertions + `verify-advances.mjs` 172/172 |
| Bank opening balances | **Read + Executed** | `verify:bank-opening` 18/18, backfill 31/31 |
| Receivable/payable aging, finance reports | **Traced** | `finance-reports.ts` read; F-9 re-derived |
| Statements | **Traced + Executed** | Ledger-derivation confirmed; `verify:statements` 70/70 |
| Project costing | **Traced + Executed** | Cash query read line by line; `verify:project-costing` 41/41 |
| Document lifecycle / edit availability | **Read + Executed** | `verify:edit-action` 59/59 |
| Roles & permissions | **Read + Executed** | `role-matrix.ts` read; `verify:role-matrix` |
| Auth / session / cookies | **Read** | `auth.ts`, `session.ts` |
| File storage + upload proxy | **Traced** | Both files read in full; callers enumerated |
| Uploads security tests | **Traced** | Both test files read; CI crash reproduced from logs |
| CI workflow | **Traced** | Workflow read; API run/job/log evidence retrieved |
| Dependencies | **Executed** | `npm audit --json` parsed |
| Schema / migrations | **Executed** | Pushed to a fresh DB; `information_schema` queried |
| i18n dictionary | **Executed** | All 1,587 entries parsed programmatically |
| Build | **Executed** | `npm run build`, exit 0 |
| Sales documents (8 types) — UI flows | **Sampled + Executed** | Route inventory; browser tier |
| HR (employees, attendance, leave, payroll) | **Sampled** | Route + action inventory only |
| Inventory / products | **Sampled** | Route + action inventory only |
| Import / export | **Executed** | `verify:docs-import` 339/339, `verify:import`, `verify:client-import` |
| PDF generation | **Sampled** | Route read; browser tier covers print paths |
| Dashboard / search / notifications | **Sampled** | Query file read; not traced |

### 2.3 Explicitly NOT examined

These are stated rather than quietly omitted. **No conclusion in this audit
depends on them, and none should be read as endorsed.**

- **Production Neon database** — no credentials, deliberately not sought (F-7).
- **Production Vercel deployment** — not reachable; no live-behaviour claims made.
- **Accessibility beyond colour contrast** — no screen-reader, keyboard-navigation, or ARIA audit was performed. `verify:contrast` covers contrast only.
- **Responsive layout at tablet/mobile widths** — the browser tier drives a desktop viewport. **No claim is made about phone or tablet rendering.**
- **Load, soak, and concurrency performance under realistic volume** — no measurements taken. All performance statements below are *suspected risks from query shape*, never measured results.
- **Backup and restore execution** — `docs/security/backup-dr.md` and `scripts/restore.sh` were not exercised.
- **Penetration testing** — none. No authenticated-attacker or fuzzing work.
- **HR payroll arithmetic correctness** — inventoried, not verified.
- **`scripts/` (39 files)** — inventoried; `scripts/tests` (26) not executed.
- **Third-party/generated** — `node_modules/`, `.next/`, `package-lock.json`, `drizzle/meta/` excluded from all counts and review.

### 2.4 Documentation treated as claims, not evidence

`docs/backlog.md` (1,522 lines), `docs/system-audit-report.md` (87),
`docs/security/*` (3 files) and `CLAUDE.md` were read **as assertions to test**.
Where they proved accurate that is recorded as a verified claim; where they
diverge from the code it is recorded in the discrepancy register (§7).
`docs/backlog.md` proved **unusually reliable** — its deploy runbook matched the
pushed schema exactly, and its open findings (F-8, F-9) were confirmed live.

---

## 3. System map

### 3.1 Architecture and boundaries

A **single Next.js 16.2.10 App Router application** (Turbopack), TypeScript
throughout, deployed as one unit. There is no separate API service, no client
SPA, and no message broker.

- **Rendering:** every one of the 72 routes builds as `ƒ (Dynamic) — server-rendered on demand`. **Nothing is statically prerendered**, so every page view is a server render with database access.
- **Mutations:** React Server Actions — 48 files carrying `"use server"`, roughly 220 exported actions. This is the entire write surface; there is no REST/GraphQL write path.
- **Reads:** server components query the database directly via Drizzle.
- **HTTP route handlers:** 7 only — document export, finance report export, statement export, document PDF, import template, auth cookie clear, and the uploads proxy.
- **No middleware file exists** (`src/middleware.ts` absent). Authorization is enforced inside pages and actions, not at an edge layer.

### 3.2 Data model and tenancy

66 physical tables across 32 schema files. **Tenancy is by `orgId` column on
every tenant-owned table** — a shared-schema, shared-database model with no
row-level security and no per-tenant connection.

Isolation rests on `src/lib/tenant.ts`'s `tenantScope`, which applies
`eq(table.orgId, orgId)` **and** a soft-delete default of
`ne(table.recordState, "deleted")`. This is a **convention enforced by discipline
and tests**, not by the database: a query that forgets `tenantScope` is a
cross-tenant read, and only a test stands between that and production.
`tests/security/access-control.test.mjs` asserts broad usage — though see §6.1
for how much of that file actually runs in CI.

Soft deletion (`deletedAt` / `recordState`) and archival (`archivedAt`) are
distinct states, with a Recycle Bin surface and lifecycle rules in
`src/lib/document-lifecycle.ts` covering all eight document types.

### 3.3 Authentication and authorization

- **Custom JWT-in-cookie**, signed with `jose`. `AUTH_SECRET` is required with **no insecure fallback** (asserted by a test — which in CI does not run, §6.1).
- **Cookie:** `__Host-elite_erp_session` in production — the `__Host-` prefix forces `Secure`, `Path=/`, and no `Domain`, closing subdomain and fixation attacks. A plain name is used in development because `__Host-` is rejected over http.
- **Revocation is real.** `src/lib/session.ts:89` re-checks the session server-side, so a cryptographically valid but revoked cookie is rejected and deleted at a response boundary — not merely allowed to expire.
- **MFA** exists (`users.mfaSecret`, `mfaRecoveryCodes`), encrypted at rest with AES-256-GCM under versioned keys (`FIELD_ENCRYPTION_KEYS`).
- **Roles: exactly three — `owner`, `admin`, `staff`.** There is **no permissions engine**. `src/lib/role-matrix.ts` states this outright and encodes the model as data so the Roles & Permissions panel cannot drift from the guards; `verify:role-matrix` asserts it in both directions. Access is decided by three idioms: `requireRole(...)`, inline `session.role === "staff"` checks, and the lifecycle matrix for permanent deletion.
- **A deliberate and significant design choice:** for *Sales & Purchasing* and *Finance*, all three roles including `staff` have `full` access — which the matrix explicitly notes "includes sending invoices, voiding them, issuing credit and debit notes, and receiving purchase orders — all of which post to the ledger." **Elite ERP has no segregation of duties.** This is documented and intentional, not an oversight, but it is a control a finance team will expect and should be an explicit owner decision (§10).

### 3.4 Storage

Uploads go to **Vercel Blob** under `organizations/{orgId}/{folder}/{file}` across
nine folders. Validation is genuinely careful: MIME allowlist, size caps (5 MB
images / 8 MB attachments), **magic-byte sniffing** so a spoofed content type is
caught, pixel-dimension limits, server-generated filenames preventing traversal
and overwrite, and SVG deliberately excluded for lack of a sanitizer.

The objects themselves are written **public with random suffixes disabled** — see
§6.2 and F-3. Downloads are proxied through an authenticated, org-scoped,
audit-logged route; that proxy is well built and is not what protects the data.

### 3.5 Integrations, background work, deployment dependencies

- **Exactly one external integration:** an exchange-rate feed, `https://open.er-api.com/v6`, overridable via `RATE_API_BASE`. Rates are fetched on demand and stored; `verify:rate-fetch` and `verify:exchange-rates` cover it.
- **PDF generation** is in-process (`pdf-lib`, plus `@sparticuz/chromium-min` and `puppeteer-core` for the serverless print path).
- **No background jobs, no cron, no queue, no worker.** Every operation is synchronous inside a request. This is a genuine simplification and a genuine constraint — see §6.4.
- **Required environment:** `DATABASE_URL`, `AUTH_SECRET`, `FIELD_ENCRYPTION_KEYS`, `BLOB_READ_WRITE_TOKEN`, `BASE_URL`, optionally `RATE_API_BASE`, `CHROMIUM_EXECUTABLE_PATH` / `CHROMIUM_PACK_URL`, `PDF_DEBUG_ERRORS`.
- **Schema deployment: `npm run db:push` only** (`drizzle-kit push && npm run db:harden`). The chained harden step installs the append-only audit triggers, so a fresh database cannot come up without them. Generated migrations are 146 commits stale and `db:migrate` is an active trap (F-6).

### 3.6 Principal data flows

**Sales:** Quotation → Sales Order → Proforma Invoice → Sales Invoice → Delivery
Challan, with Credit Notes against invoices. **Project attribution survives every
hop except the proforma**, which carries no `projectId` at all (F-8).

**Money:** a payment posts `Dr Bank / Cr 1100 (AR)` and updates
`paidAmount`/`basePaidAmount`. An advance receipt posts `Dr Bank / Cr 2300` —
**never AR**, because cash receipt is not revenue recognition — and stays a
liability until allocated. A credit note relieves AR and now moves
`creditedAmount` as its own channel. A reversal **mirrors the stored journal
lines** rather than recomputing them, keyed on `(sourceType, sourceId)`.

**FX:** convert once at posting and store. Foreign documents carry base columns
captured at the posting date; reports sum stored base figures and never
re-convert. Documents with no stored conversion are **excluded and counted**, so
a report says it is short rather than quietly totalling wrong. Notes inherit their
source's rate and post no FX gain/loss line; a note that closes its source takes
the exact remainder rather than a fresh proportional conversion.


---

## 4. Feature inventory

The **complete per-feature matrix is `feature-status-matrix.csv`** (one row per
feature, with the columns the brief specifies: intended behaviour, actual
behaviour, implementation status, verification evidence, deployment status,
remaining work, source references). It is not reproduced here in full.

This section gives the domain rollup and then expands, in full, only the features
whose status is anything other than *complete and verified* — which is where the
value is.

### 4.1 Status vocabulary

**Implementation:** `complete` · `partial` · `missing` · `defective` ·
`deferred` (intentionally) · `excluded` (out of scope by decision) · `unknown`.

**Verification:** `automated` (a suite I ran) · `source` (inspection only) ·
`manual` (I exercised it) · `blocked` (could not verify).

**Deployment:** `unverified` for **every** feature. No production access existed,
so no feature in this product can be confirmed live. This is uniform and is not
repeated per row.

> A page existing does not establish that its workflow is complete, and code
> existing does not establish that it is tested or deployed. Rows marked
> `source` are exactly the rows where only the first of those is known.

### 4.2 Domain rollup

Generated from `feature-status-matrix.csv`; the two are the same data.

| Domain | Features | Complete | Partial | Defective | Missing | Deferred | Unknown | Excluded | Dominant verification |
|---|---|---|---|---|---|---|---|---|---|
| Accounting core | 14 | 13 | 1 | | | | | | automated |
| Payments | 12 | 8 | | 2 | 1 | 1 | | | automated |
| Advances | 8 | 7 | 1 | | | | | | automated |
| Credit / debit notes | 9 | 7 | 1 | | 1 | | | | automated |
| Sales documents | 16 | 15 | 1 | | | | | | automated |
| Purchasing | 7 | 5 | | | | | 2 | | automated |
| Financial reporting | 12 | 10 | 1 | 1 | | | | | automated |
| Projects & costing | 6 | 3 | 1 | 1 | 1 | | | | source |
| Inventory | 5 | 4 | 1 | | | | | | source |
| HR | 7 | 6 | 1 | | | | | | source |
| Master data & settings | 13 | 13 | | | | | | | automated |
| Localisation (EN + Saudi Arabic, RTL) | 8 | 7 | 1 | | | | | | automated |
| Security & audit | 15 | 12 | | 1 | 1 | 1 | | | source |
| Platform (build, CI, deploy, ops) | 13 | 4 | 2 | 2 | 3 | | 2 | | automated |
| Cross-cutting UX | 16 | 13 | | | | 1 | 2 | | automated |
| Scope exclusions | 2 | | | | | | | 2 | automated |
| **Total** | **163** | **127** | **11** | **7** | **7** | **3** | **6** | **2** | |

Verification split across the same 163 rows: **automated 104** (a suite I ran in
this audit), **source 53** (inspection only), **blocked 6** (could not verify).
**Deployment status is `unverified` for all 163** — see §4.1.

**On the numbers.** These are counts of features *as I decomposed them*, not a
completion percentage, and I am not offering one. The denominator is my own
enumeration — a finer or coarser cut would move every figure, and "complete"
here means *implemented as intended*, which is a different claim from *tested*
and a very different claim from *deployed*. What the table supports is a shape:
the large majority of features are built and most carry executed automated
evidence; a small, named minority is partial or defective; and **nothing at all
is confirmed in production**. It does not support "the product is 78% done."

### 4.3 Every feature that is not complete-and-verified

| Feature | Intended behavior | Actual behavior | Impl. status | Verification evidence | Remaining work | Source references |
|---|---|---|---|---|---|---|
| **Payment reversal — invoice status** | Reversing a payment restores the document's prior status, accounting for all settlement channels | Status recomputed from `paid` and `total` only; `credited_amount` is neither selected nor used. A part-credited invoice drops to `sent`; a fully-credited one reads `sent` instead of `paid` | **defective** | `automated` — reproduced numerically against the production modules (evidence §6, F-1). `verify:payment-reversal` 55/55 does **not** catch it: it tests the library, the defect is in the action's SQL | Select `credited_amount` in the `FOR UPDATE` query; route status through `settlementOf`; add an assertion at the action layer | `finance/payments/actions.ts:966-989`; `lib/payment-reversal.ts:109`; `lib/settlement.ts` |
| **Project cash received** | Project "Received Payments" counts cash actually received and still standing | No `reversed_at is null` predicate; a reversed payment still counts as project cash | **defective** | `source` — query read line by line; every `payments` reader enumerated (§6, F-2). `verify:project-costing` 41/41 does not cover reversal | Add the predicate; extend the suite with a reversed-payment fixture | `lib/project-costing.ts:237-253` |
| **Payments register — outstanding balance** | The "Record a payment" picker shows what is genuinely owed | `total − paidAmount`, omitting `creditedAmount`; balance overstated for any credited invoice, at the point of collection | **defective** | `source` (§7, N-1) | Select and subtract `creditedAmount`; PO row at line 101 is correct as-is | `finance/payments/page.tsx:45-59, 94` |
| **Statement payment-status label** | Statement lines label an invoice's settlement state correctly | `payStatus(total, paid)` omits credited; a fully-credited invoice reads `unpaid`/`partial`. **Amounts are correct** (ledger-derived) | **defective** | `source` (§7, N-2) | Pass credited into `payStatus` for sales invoices | `lib/statements.ts:198-202, 259` |
| **Credit note on a cash-paid invoice** | Credit given against a settled invoice lands somewhere coherent | No allocation exists to release, so `Cr 1100` stands alone and drives the customer receivable negative. Aging drops the row (`outstanding <= 0`); GL 1100 keeps the negative. **Control account and subledger disagree** | **partial** (known, filed) | `source` — re-derived at HEAD after the settlement change; symptom softened, cause unchanged (§6, F-9) | Decide the destination (2300 liability is the consistent answer); changes non-advance note behaviour and its tests | `docs/backlog.md:533`; `lib/finance-reports.ts:352-353` |
| **Proforma project attribution** | Work quoted through a proforma is attributed to its project | `proforma_invoices` has **no `projectId` column**; conversion never sets one, so every invoice born from a proforma belongs to no project | **missing** | `source` — schema grep + backlog corroboration (§6, F-8) | Add column, carry through conversion, decide backfill for existing converted invoices | `db/schema/proforma-invoices.ts`; `docs/backlog.md:853` |
| **Advances held against a proforma — project view** | Advance cash visible in project reporting | Cannot be attributed to a project at all (advances live on proformas, which carry no project) | **partial** | `source` | Follows the proforma `projectId` decision | `docs/backlog.md:886` |
| **Purchase order paid status** | A fully-paid PO reflects it | POs have statuses `draft/ordered/received/cancelled` and **no paid state**; paying in full leaves `received`. Reversal deliberately mirrors this | **deferred** (explicit, documented at the code site) | `source` — the absence is asserted by `verify:payment-reversal` | Decision + full blast radius per backlog | `finance/payments/actions.ts:1010-1017`; `docs/backlog.md` |
| **Purchase order payment cap** | Payments cannot exceed the order total | No cap | **missing** (filed) | `source` | Add cap mirroring the credit-note cap | `docs/backlog.md` |
| **Debit note cap** | A debit note cannot exceed its purchase order | Credit notes are capped; **debit notes are not**. The only remaining asymmetry between the two note paths | **missing** (filed) | `source` | Mirror the credit-note cap | `docs/backlog.md` |
| **HR Departments** | Create, edit, remove departments | 41-line **read-only** page; the only HR module with no `actions.ts` | **partial** | `source` (§7, N-3) | Build CRUD, bilingual from the outset | `hr/departments/page.tsx` |
| **HR payroll / attendance / leave correctness** | Correct payroll arithmetic, attendance and leave accrual | Implemented; **arithmetic not verified by this audit and not covered by any suite I ran** | **unknown** | `blocked` — inventoried only | Build verification before relying on the figures | `hr/payroll/*`, `hr/attendance/*`, `hr/leave/*` |
| **Inventory valuation / COGS** | Inventory valued and cost of goods sold posted | Stock adjustment exists; **no COGS or valuation method is evidenced in the accounting layer** | **partial** | `source` | Confirm whether intended; if so, design | `inventory/products/actions.ts` |
| **Customer PII encryption** | Personal data protected at rest | `customers.name/email/phone/address` stored **plaintext**. Only `users.mfaSecret` and `mfaRecoveryCodes` are encrypted | **missing** (filed, with analysis) | `source` | Blind index or separate display column; breaks search/sort/import-dedupe either way | `docs/backlog.md` (plaintext PII entry) |
| **Blob object access control** | Uploaded files reachable only by authorized users of the owning org | Objects written **public, no random suffix**; the proxy's auth, tenancy and audit are bypassed by URL possession | **defective** | `source` — both files traced; callers enumerated (§6, F-3) | Private blobs + token-scoped reads, or accept and document obscurity-based confidentiality | `lib/storage/blob-storage.ts:98`; `app/uploads/[...path]/route.ts` |
| **CI security test suite** | Every committed security assertion runs on every push | Crashes at assertion 7 of 17 on a stale path; **11 assertions never execute**, and `db:push` + `build` are skipped | **defective** | `automated` — CI logs retrieved (§6, F-4) | One-line path fix; then verify the remaining 11 actually pass | `tests/security/access-control.test.mjs:51` |
| **CI coverage of the verify tiers** | The project's real test evidence runs automatically | CI runs **none** of the 71 verify suites | **missing** | `automated` — workflow read (§7, N-4) | Add at least `verify:static` + `verify:server` to CI with a Postgres service | `.github/workflows/devsecops.yml` |
| **Generated migrations** | Schema history reproducible from the repository | Stale since 22 July, **146 commits**; `db:migrate` applies nothing and would leave the deploy broken | **partial** | `automated` — journal read; fresh push verified (§6, F-6) | Either regenerate migrations or delete them and document `db:push` as the only path | `drizzle/meta/_journal.json` |
| **Dependency currency** | No known-vulnerable dependencies | 18 advisories incl. **1 critical** (`next` 16.2.10, 11 advisories, unauthenticated RCE among them) | **defective** | `automated` — `npm audit` (§6, F-5 / evidence §4) | `next@16.3.5` (non-breaking) clears critical + 2 high; `puppeteer-core` needs a major-version decision | `package.json:next@16.2.10` |
| **Monitoring / health checks** | Operational visibility | **No health-check endpoint, no monitoring integration, no error tracking** found | **missing** | `source` | Add `/api/health`; choose an error tracker | — |
| **Backup / restore** | Recoverable | `docs/security/backup-dr.md` and `scripts/restore.sh` exist; **never exercised in this audit** | **unknown** | `blocked` | Perform and document a restore drill | `docs/security/backup-dr.md` |
| **Segregation of duties** | Ledger-posting actions restricted | `staff` has `full` on Sales & Finance incl. voiding invoices and issuing notes. Documented and intentional | **deferred** (by design) | `automated` — `verify:role-matrix` | Owner decision (§10) | `lib/role-matrix.ts` |
| **Responsive / tablet / mobile** | Usable on small screens | Not assessed | **unknown** | `blocked` — desktop viewport only | Run the browser tier at mobile widths | — |
| **Accessibility beyond contrast** | Keyboard and screen-reader usable | Contrast covered by `verify:contrast`; nothing else assessed | **unknown** | `blocked` | Dedicated a11y pass | `verify/verify-contrast.mts` |
| **ZATCA Phase 2** | — | Deliberately **excluded** per standing scope decision. Phase 1 QR on printed tax invoices is implemented and honestly labelled | **excluded** | `automated` — `verify-preset-zatca` | None unless requested | — |
| **Expenses module** | — | **Excluded** — remains a separate application per standing scope decision | **excluded** | `automated` — `verify-expense-categories-hidden` | None | — |

Everything not listed above is `complete`, and the great majority carries
`automated` verification — see the CSV for the per-feature detail.

---

## 5. Business workflows and accounting integrity

### 5.1 The document lifecycle, traced

`src/lib/document-lifecycle.ts` encodes one rule matrix across all eight types
(`quotation`, `sales_order`, `proforma_invoice`, `sales_invoice`,
`delivery_challan`, `credit_note`, `debit_note`, `purchase_order`) covering
editability, deletion, archival, and downstream-reference blocking.
`verify:edit-action` exercises it at 59/59, including soft-deleted drafts,
archived drafts, and unknown statuses — and the refusal messages name the
corrective path (*"void an unpaid invoice, or issue a Credit Note against a
settled one"*) rather than merely refusing.

**Draft → issue → convert → settle → cancel/void → reverse → archive → restore is
implemented end to end and covered.** The gaps found are not in the lifecycle
skeleton; they are in three specific arithmetic readers and one destination
decision.

### 5.2 Scenarios: expected vs observed

Scenarios marked **executed** were run in this audit. Scenarios marked
**derived** were worked out from traced source without execution — and are
labelled so rather than presented as results.

| # | Scenario | Expected | Observed | Verdict |
|---|---|---|---|---|
| 1 | Invoice 1,000 SAR; pay 400; credit 600; **reverse the payment** | status `partially_paid` (600 of 1,000 settled) | status written **`sent`** | **FAIL — executed** (F-1) |
| 2 | Invoice fully credited; reverse its payment | `paid` | **`sent`** | **FAIL — executed** (F-1) |
| 3 | Payment reversal mirrors stored journal lines, both document types | exact mirror, no recompute | mirror confirmed | PASS — executed (`verify:payment-reversal` 55/55) |
| 4 | Reversing a PO payment leaves the receipt posting untouched | 1200 unchanged | unchanged | PASS — executed |
| 5 | Double reversal refused; `kind === null` checked explicitly | refusal | refused | PASS — executed |
| 6 | Delete refused for payments Reverse covers, **at the server** | refusal by replay, with a working control | refused; control succeeded | PASS — executed (`verify-delete-refusal` 16/16) |
| 7 | 100% credit note on a foreign invoice returns base revenue to exactly zero | 0.000 | 0.000 | PASS — executed (`verify:note-fx` 40/40) |
| 8 | Closing note takes the exact remainder, not a fresh proportional conversion | 0 stranded fils | 0 stranded | PASS — executed |
| 9 | Advance stays a liability in 2300 until allocated | never AR before allocation | held | PASS — executed (`verify-advances` 172/172) |
| 10 | Allocation, release, refund and credit note remain distinct channels | four distinct paths | distinct | PASS — executed |
| 11 | Opening bank balance posts exactly once and is idempotent on re-run | one entry | one entry | PASS — executed (18/18 + 31/31) |
| 12 | Displayed balances are a function of the ledger and nothing else | no stored field added to a ledger aggregate | holds across all three consumers | PASS — executed (`verify:ledger-only-balances`) |
| 13 | Journal identity `(sourceType, sourceId)` cannot collide across types | no collision | holds | PASS — executed |
| 14 | Invoice 10,000 cash-paid; credit note 2,000 | AR and aging agree | GL 1100 **−2,000**, aging **0** — row dropped at `outstanding <= 0` | **FAIL — derived** (F-9) |
| 15 | Reversed payment excluded from project cash | excluded | **included** | **FAIL — derived** (F-2) |
| 16 | Payments register balance for a credited invoice | net of credit | **overstated** | **FAIL — derived** (N-1) |
| 17 | Invoice born from a proforma carries its project | attributed | **no project** (no column exists) | **FAIL — derived** (F-8) |
| 18 | Concurrent Issue on a debit note cannot double-post | one posting | status re-checked under lock | PASS — executed |
| 19 | Foreign document with no stored rate is excluded **and counted** | reported short, not silently wrong | excluded + counted | PASS — executed (`verify:fx-reporting`) |
| 20 | Rounding at the document's minor unit (incl. 3-decimal KWD/BHD) | no fixed 0.005 | per-currency epsilon | PASS — executed (`verify:money-precision`, `money-round-trip` 44/44) |

### 5.3 Money, precision and FX — assessment

**This is the most rigorous part of the system.** Amounts are `numeric(15,3)` in
the database and handled as strings through the application, avoiding float drift.
Rounding uses a **per-currency** epsilon rather than a fixed 0.005 — a fixed
threshold had previously marked a Kuwaiti invoice paid while four fils were
outstanding, and the fix is asserted. Minor units for 3-decimal currencies are
handled correctly.

FX follows one rule consistently: **convert once at posting, store the result,
and never re-convert when reading.** Realized FX differences land in `4900`.
Reversals mirror stored lines. Notes inherit their source's rate and post no 4900
line, because a note moves no cash and cannot create an FX difference. A missing
rate refuses the operation rather than guessing.

Two limitations, both acknowledged in source rather than hidden:

- `noteBaseAmounts()` is deliberately synchronous and carries no `missingRate` handling, unlike the four other posting paths — an asymmetry documented at the code site.
- Pre-FX legacy rows carry no stored base figures. They are excluded from base-currency reporting **and counted**, which is the right behaviour, but it means historical reporting completeness depends on how many such rows production holds — a number only a production query can give.

### 5.4 Postings, balance and idempotency

Journal entries balance, and the suites assert **exhaustive account sets** rather
than the absence of one wrong line — a distinction the project learned the hard
way and recorded. Idempotency is keyed on `(sourceType, sourceId)`, and the
`payment_reversal` case is the canonical instance: it keys off the same
`payments.id` as its original `payment` entry, so resolving without the type
would find an unrelated row. Retries and concurrent clicks are guarded by
`FOR UPDATE` locks with status re-checks **inside** the transaction.

Append-only enforcement on `audit_logs` and `security_events` is **installed in
the database by trigger**, chained into `db:push` so a fresh database cannot come
up without it, and verified against the live database (not a file) by
`verify:db-hardening`.

### 5.5 What is not assessed here

**Vendor bills, input VAT, COGS and inventory valuation, bank reconciliation, and
period controls were not verified.** Purchase orders and debit notes carry the
purchasing side, and VAT reporting exists, but I did not trace input-VAT
treatment or find a COGS/valuation mechanism in the accounting layer. There is no
evidence of a period-close or period-lock control. **These are gaps in this audit
as much as they may be gaps in the product**, and they should not be read as
either confirmed present or confirmed absent — except inventory valuation/COGS,
where a targeted search found nothing.

---

## 6. Security, UX and operational readiness

### 6.1 Security posture

**Strong, with two exceptions and one caveat about what CI proves.**

Genuinely good: `AUTH_SECRET` with no fallback; `__Host-` cookie prefix in
production; **server-side session revocation** rather than expiry-only;
AES-256-GCM with versioned key rotation for MFA secrets; password policy with
composition, common-password detection, history and expiry; HMAC-signed URLs with
`timingSafeEqual` and expiry; magic-byte upload sniffing with SVG excluded;
server-generated filenames; append-only audit trail enforced by database trigger;
`tenantScope` as a single source of org scoping with soft-delete defaults;
self-escalation prevented in role assignment; gitleaks in CI, passing.

**Three findings.**

**(a) File storage has no access control — F-3.** Covered in §1 and the evidence
file. The proxy is not the protection; the objects are public with deterministic
URLs. Practical exposure today is limited by 64-bit filename entropy and by the
fact that the application does not currently emit absolute blob URLs
(`blobUrlFromStored()` has no callers). It is a **defense-in-depth failure and a
latent exposure**, not a present leak — and it is one careless `<img src>` away
from becoming one, permanently and unrevocably.

**(b) CI proves much less security than it appears to — F-4.** The crash at
assertion 7 of 17 means the upload-route checks, the signed-URL HMAC/constant-time/
expiry checks, the login rate-limit and MFA checks, `.env is gitignored`, and
**`no insecure AUTH_SECRET fallback`** never execute in CI. Those controls are
present in the code — I read them — but the automated guard that is supposed to
keep them present is silently absent.

**(c) `crypto-policy.test.mjs:56` tests the artefact, not the state.** Its "DB
trigger rejects UPDATE/DELETE on audit tables" assertion reads
`drizzle/immutable_audit.sql` and asserts its *contents*. It would pass in a
database with no triggers at all. The repository already catalogues this species,
and `verify:db-hardening` does the real check — but that suite **does not run in
CI**, so CI's version of this control remains the file-reading one.

**Customer PII is stored in plaintext** (`customers.name/email/phone/address`).
This is filed with a well-reasoned analysis of why it is not a simple fix — any
encryption breaks client search, global search, name sorting, import lookups and
duplicate detection.

**No compliance claim is made or supported by this audit.** The product's own
Compliance Center was previously corrected to say it is a self-assessed readiness
checklist, not a certification, and that no external audit has been carried out —
`verify-compliance-claims` asserts those claims stay absent, and it passes. That
is honest labelling, and **this audit does not add a compliance conclusion**:
regulatory compliance cannot be determined from source code. No authoritative
regulatory source was consulted for this audit, so every regulatory question is
**unassessed**, not passed.

### 6.2 Localisation and UX

**The bilingual requirement is met to an unusually high standard.** I parsed all
**1,587** dictionary entries programmatically: exactly **one** has no Arabic
script, and it is the placeholder `you@company.com`, correctly left as-is.
English is the dictionary key, so a call site that forgets a translation still
renders correct English rather than breaking.

RTL is handled at the document root (`layout.tsx:42`, `dir={locale === "ar" ? "rtl" : "ltr"}`),
with the convention — recorded in `CLAUDE.md` — that numbers, dates and currency
are forced `direction: ltr` inside RTL pages. Browser suites assert Arabic
rendering on real pages (`verify-account-arabic` 34/34), confirm-dialog copy in
both languages, and currency-mark rendering in both the inline-SVG (app) and
`<img>` (PDF) forms.

**What this does and does not establish.** The dictionary is complete and the
tested pages render Arabic. It does **not** establish that every one of the 72
routes is fully translated — the project's own history records a v25 audit that
found six document detail screens still English after a pass that had declared
success. The honest statement is: coverage is high and systematically enforced,
with spot verification on a subset of pages.

**UX verification is desktop-only.** The browser tier drives a desktop viewport.
**No conclusion is offered about tablet or mobile rendering**, and accessibility
beyond colour contrast was not assessed.

Loading states, dirty-form guards, confirm policies and theme handling are all
covered by dedicated suites, all passing.

### 6.3 Performance and data access — suspected risks, nothing measured

**No performance measurement was taken.** Everything here is inferred from query
shape and must be read as a hypothesis, not a result.

- **Every route is dynamic.** With no static prerendering anywhere, each page view is a server render plus queries. At low tenant counts this is fine; it is the first thing to bite under load.
- **No background work of any kind.** Imports, PDF generation and exports run synchronously inside a request. `verify:docs-import` covers correctness at 339/339, but a large import competes with a user's request timeout. This is the structural performance risk most likely to surface first in production.
- **Aggregate reads scan.** Dashboard receivables/payables sum `baseOutstandingExpr` across invoices and POs per request. Whether indexes support the tenant + status + date filters was **not checked**.
- Transaction boundaries are correct where I traced them (`FOR UPDATE` with in-transaction re-checks), and concurrency defects found earlier in the project's history were fixed with locks rather than retries.

### 6.4 Operational readiness

| Capability | State |
|---|---|
| Production build | **Verified green** here; **never verified by CI** |
| Health check endpoint | **None found** |
| Monitoring / error tracking | **None found** |
| Structured logging | Security events and audit logs to database; no application log aggregation found |
| Backups | Documented (`docs/security/backup-dr.md`); **never exercised** |
| Restore drill | `scripts/restore.sh` exists; **never run** |
| Migration safety | **`db:push` only**; `db:migrate` is a trap (F-6) |
| Rollback | No documented application rollback procedure; the four pending columns are additive and nullable-or-defaulted, so a code rollback over them is safe |
| Storage portability | Vercel Blob specific; `blobBaseUrl()` derives the host from the token — moving providers touches one module |
| Environment config | 6 required variables; failures are explicit (`AUTH_SECRET` and `BLOB_READ_WRITE_TOKEN` throw rather than defaulting) |

The deploy runbooks in `docs/backlog.md` are a real asset — four of them, each
stating ordering **and the reason for that ordering**, including one pair whose
orderings are deliberately opposite. I verified the newest against the pushed
schema and it is accurate in every particular.

---

## 7. Completed vs pending

### 7.1 Verified completed capabilities

These are the capabilities where implementation **and** automated verification
both exist and the verification was executed in this audit. They are the
product's load-bearing strengths.

- **Double-entry ledger with balanced, idempotent postings** keyed on `(sourceType, sourceId)`, with retry and concurrency guards.
- **Multi-currency at stored posting-date rates** — convert once, store, never re-convert; per-currency rounding; unconverted rows excluded *and counted*.
- **Advance receipts as liabilities** in 2300 until allocated, with allocation, release, refund and credit-note release as four distinct channels.
- **Credit and debit notes** inheriting their source's rate, posting no FX line, with the closing note taking the exact remainder (0 stranded fils, measured).
- **Payment reversal by mirroring stored journal lines**, across invoices and purchase orders, with server-side delete refusal proven by raw action replay against a working control.
- **Bank opening balances** posted exactly once, idempotent on re-run, with a backfill proven safe on second run.
- **Ledger-only balances** — no stored field is ever added to a ledger aggregate, enforced statically across all consumers by import discovery rather than by name.
- **Append-only audit trail** enforced by database trigger, installed by the deploy path, verified against the live database.
- **Document lifecycle** across all eight types, including soft-delete, archive, recycle bin, and downstream-reference blocking, with refusals that name the corrective path.
- **Statements** derived from ledger lines, correctly attributing parties by walking `sourceType`/`sourceId` to the source document.
- **Import** at 339 assertions across document and client paths.
- **Bilingual EN + Saudi Arabic** with 1,587 dictionary entries, one placeholder aside, and RTL handling with LTR-forced numerics.
- **Role model as data**, asserted against real guards in both directions.
- **Honest compliance labelling**, asserted to stay honest.
- **Production build green** at HEAD.

### 7.2 Partial, missing, defective or unverified

Summarised here; detail in §4.3.

**Defective (7)** — payment-reversal status (F-1); project cash including
reversed payments (F-2); payments-register balance (N-1); statement status label
(N-2); blob object access control (F-3); the CI security-suite crash (F-4); the
dependency set (F-5/R-1).

**Partial (11)** — headlined by credit-note-on-a-cash-paid-invoice (the AR
control-account vs subledger divergence, F-9), receivable aging dropping
non-positive rows, advances against proformas in project reporting, inventory
valuation/COGS, HR Departments, generated migrations, rollback procedure, and
unconverted-row reporting completeness.

**Missing (7)** — proforma `projectId` (F-8); PO payment cap; debit-note cap;
customer PII encryption; health-check endpoint; monitoring/error tracking; CI
coverage of the verify tiers (N-4).

**Deferred by decision (3)** — PO paid statuses; segregation of duties;
background work for long operations.

**Unknown / could not verify (6)** — vendor bills; input VAT treatment; backup
and restore; performance under load; responsive layout; accessibility beyond
contrast.

**Excluded by standing decision (2)** — Expenses as a separate application;
ZATCA Phase 2.

**And, orthogonal to all of the above: every one of the 163 features is
`unverified` for deployment.** That is not a status among others — it applies
uniformly and is the single largest gap in this audit (F-7 / R-4).

### 7.3 Discrepancy register — documentation claims vs evidence

| # | Claim | Source | Evidence | Verdict |
|---|---|---|---|---|
| D-1 | "blob URLs are never exposed and cross-tenant access is denied" | `lib/storage/blob-storage.ts:11-12` | First half true of the app as written (`blobUrlFromStored` has no callers). Second half true of the **proxy**, false of the **storage** — objects are public | **Misleading** — the comment describes a property of one layer as though it were a property of the system |
| D-2 | CI "runs static analysis, dependency & secret scanning, and the security test suite. Any failure fails the pipeline" | `.github/workflows/devsecops.yml:3-5` | Accurate about failing the pipeline. But the security suite **crashes at 7 of 17**, and the workflow runs **none** of the 71 verify suites | **Overstated** |
| D-3 | Deploy runbook: four columns, exact types/nullability/defaults, no backfill needed, `db:migrate` is a trap | `docs/backlog.md` (runbook, `04457ff`) | Confirmed exactly against a fresh `db:push` (evidence §6, F-6) | **Accurate** |
| D-4 | "Credit notes on a CASH-paid invoice still drive AR negative" — status unfixed | `docs/backlog.md:533` | Re-derived at HEAD after the settlement change: still live; symptom softened by the `GREATEST(0,…)` floor, cause unchanged | **Accurate** (and correctly still open) |
| D-5 | "proforma_invoices has no projectId column at all" | `docs/backlog.md:853` | Confirmed by schema inspection | **Accurate** |
| D-6 | `6422235`'s commit message enumerates the readers updated for the three-channel settlement model | git history | Three readers were **missed**: `reversePaymentAction`, `finance/payments/page.tsx:94`, `statements.ts:259` | **Incomplete** — the list is presented as exhaustive and is not |
| D-7 | `crypto-policy.test.mjs` — "DB trigger rejects UPDATE/DELETE on audit tables" | `tests/security/crypto-policy.test.mjs:56` | Reads the **SQL file's contents**; passes with no triggers installed anywhere | **Tests the artefact, not the state** — already catalogued by the project, still live in CI |
| D-8 | README: uploads "stored under a gitignored `uploads/` directory served through an authenticated org-scoped route" | `README.md` | Storage is **Vercel Blob**, not a local directory. The route is accurate | **Stale** |
| D-9 | Compliance Center is a self-assessed readiness checklist, not a certification | product UI | Asserted by `verify-compliance-claims`, passing | **Accurate** |

### 7.4 Risk register

Severity reflects business impact at the audited revision, not exploit
likelihood alone.

| ID | Risk | Sev | Business impact | Workflows affected | Evidence | Remediation |
|---|---|---|---|---|---|---|
| **R-1** | `next` 16.2.10 carries 11 advisories incl. unauthenticated RCE | **Critical** | Full application compromise if reachable; the Image Optimization AVIF and Server Function endpoint advisories need no credentials | All | evidence §4 | `next@16.3.5` — **non-breaking**; clears critical + postcss + sharp |
| **R-2** | Blob objects public with deterministic URLs; proxy auth bypassed by URL possession | **High** | Permanent, unauditable, unrevocable exposure of customer documents if any URL leaks; tenant isolation for file content is entropy, not authorization | Attachments, logos, seals, signatures, employee photos | F-3 | Private blobs + token-scoped reads |
| **R-3** | Payment reversal writes a wrong invoice status when a credit note exists | **High** | Settled invoices reappear as unsettled in the collections worklist and aging; staff chase money already credited | Reversal, collections, aging, dashboard | F-1, reproduced | Route status through `settlementOf` |
| **R-4** | **Deployment state unknown** — no production access, stale migrations, `db:migrate` a trap | **High** | A deploy performed on wrong assumptions fails on missing columns; nobody can state what is live | All | F-7, F-6 | Owner runs the runbook's `information_schema` query |
| **R-5** | Credit note on a cash-paid invoice: GL 1100 and aging disagree | **High** | Control account does not reconcile to its subledger — a finding any reviewer or auditor will raise | Credit notes, AR, aging, reconciliation | F-9, re-derived | Decide the destination (2300 is consistent) |
| **R-6** | CI red throughout recent history; build never verified; 11 security assertions never run | **High** | Regressions ship unseen; the guard on `AUTH_SECRET` fallback and signed-URL integrity is absent in automation | All | F-4, F-5 | One-line path fix, then `npm audit` policy |
| **R-7** | CI runs none of the 71 verify suites | **Medium** | The project's real quality evidence depends on someone remembering | All | N-4 | Add `verify:static` + `verify:server` to CI |
| **R-8** | Reversed payments counted as project cash | **Medium** | Project profitability overstated; decisions made on wrong margins | Project costing | F-2 | Add `reversed_at is null` |
| **R-9** | Payments register overstates outstanding for credited invoices | **Medium** | Over-collection at the point of entry, then an unwind | Payment entry | N-1 | Subtract `creditedAmount` |
| **R-10** | Customer PII in plaintext | **Medium** | Breach exposes names, emails, phones, addresses directly; a data-protection question in most jurisdictions | Clients, search, import | filed | Blind index or display column — needs design |
| **R-11** | Invoices from proformas carry no project | **Medium** | Project revenue under-reported wherever work came via proforma | Proforma conversion, costing | F-8 | Add column + conversion + backfill decision |
| **R-12** | No health check, no monitoring, no error tracking | **Medium** | Outages and errors discovered by users | Operations | §6.4 | `/api/health` + error tracker |
| **R-13** | Backup never restored in a drill | **Medium** | Recovery capability unproven | Operations | §6.4 | Perform a drill |
| **R-14** | No background work; imports/PDFs synchronous | **Medium** | Large imports compete with request timeouts | Import, PDF, export | §6.3 | Measure before engineering |
| **R-15** | No segregation of duties — `staff` may void invoices and issue notes | **Medium** | A single junior account can reverse revenue | Sales, Finance | `role-matrix.ts` | Owner decision (§10) |
| **R-16** | Statement status labels ignore credited | **Low** | Customer-facing statement mislabels a settled invoice; **amounts are right** | Statements | N-2 | Pass credited to `payStatus` |
| **R-17** | Debit notes uncapped; PO payments uncapped | **Low** | Over-crediting a vendor or overpaying an order passes silently | Purchasing | filed | Mirror the credit-note cap |
| **R-18** | HR Departments read-only | **Low** | Departments must be seeded outside the product | HR | N-3 | Build CRUD, bilingual |
| **R-19** | Responsive/a11y unverified | **Low–Unknown** | Unknown usability on tablet/mobile and for assistive tech | All UI | §2.3 | Assess before claiming |
| **R-20** | README describes local-filesystem uploads | **Low** | Misleads a new operator about where data lives | Onboarding | D-8 | Correct the paragraph |

### 7.5 Test coverage and confidence

| Tier | Suites | Assertions (approx.) | Run here | Result | Runs in CI |
|---|---|---|---|---|---|
| Static (`verify:static`) | 8 | ~200 | yes | **PASS, 0 fail** | **no** |
| Server (`verify:server`) | 25 | ~860 | yes | **PASS, 0 fail** | **no** |
| Browser (`verify:browser`) | 36 | 972 counted | yes | **PASS, 36/36, 0 fail** | **no** |
| `tests/security/` | 2 files, 35 assertions | 35 | via CI logs | **crashes at 7 of 17 in one file** | yes (partially) |
| `scripts/tests/` | 26 | unknown | **no** | not executed | no |

**Every suite in this repository that has a runner passed — 69 suites, roughly
2,030 assertions, zero failures, all executed in this audit on 12 September 2026
against a database created for the purpose.** That is a genuinely strong result
and it should be read as such.

It is also the reason the coverage finding matters. **Every defect in §7.2 sits
somewhere these suites do not reach.** That is a statement about the *shape* of
the coverage, not its quality: the server tier tests libraries, so a defect in a
server action's SQL escapes it. F-1 is the proof — `verify:payment-reversal`
passes 55/55 with the defect live.

**Confidence by area.**

- **High** — settlement, FX, advances, reversal, notes, bank opening, lifecycle, ledger invariants, import, i18n dictionary. Executed, fresh, on a clean database, with suites that import production modules and assert against rows read back.
- **Medium** — statements, project costing, reporting. Covered, but the coverage demonstrably has holes in exactly the places the defects were found (reversal-awareness, credited-awareness).
- **Low** — HR payroll arithmetic, inventory valuation, responsive layout, accessibility, performance, backup/restore.
- **None** — production behaviour.

**The structural weakness is not the suites; it is that nothing runs them.** The
server tier tests libraries, so a defect in an action's SQL escapes it — which is
precisely how F-1 survived a 55/55 run of the suite named after it. Both
observations are already species in the project's own `verify/README.md`
catalogue.

### 7.6 Deployment and database readiness

**Not ready to deploy today, and the blocking item is an unknown rather than a
defect.**

1. **Production schema state is unknown (R-4).** Four to six additive columns are committed with unknown deployment status. The runbook's `information_schema` query answers it in seconds — but only the owner can run it.
2. **`db:migrate` must not be used.** Generated migrations stop 146 commits back. It would report success, apply nothing, and leave the deploy broken on missing columns. `db:push` is the only correct path.
3. **The columns themselves are deploy-safe.** All additive; nullable or NOT NULL with a default; Drizzle emits explicit column lists so old queries never name them. Schema-first ordering is correct and no backfill is required — verified in the runbook against 190 existing invoices.
4. **A bank-opening backfill, if that change is also undeployed, runs *after* the code deploy** — the opposite ordering from everything else, and the runbook says so.
5. **CI cannot gate a deploy** until R-6 is fixed; today a green build is only ever observed locally.
6. **No rollback procedure is documented**, though the additive schema makes code rollback safe.

---

## 8. Preserved scope decisions

Carried forward unchanged and assumed in the roadmap:

- **Expenses stays outside Elite ERP** as a separate application. `verify-expense-categories-hidden` (16/16) asserts it stays hidden.
- **ZATCA Phase 2 is excluded** unless explicitly requested. Phase 1 QR on printed tax invoices is implemented and honestly labelled; the four unwired Phase 2 columns are retained as the natural home for it.
- **Lead Capture / Kapt Now consolidation, a unified shell/login/tenant, and Party + PartyRole are strategic context only.** This audit assesses prerequisites where relevant and treats none of them as delivered or approved. Prerequisite note: the three-role model with no permissions engine, and `orgId` scoping by convention, are the two things a unified tenant would have to absorb — both are currently adequate for one application and would need deliberate work for several.
- **Any new or revised UI must support English and native Saudi Arabic with correct RTL from the outset**, not as a later translation pass. Every roadmap item below that touches UI carries this in its acceptance criteria.

---

## 9. Recommended first batch

**Batch 1 — "Stop the bleeding"** (see `prioritized-roadmap.md` for the full
table). The smallest set that removes the critical vulnerability, makes the
pipeline meaningful, and fixes the money defect that is reproducible today:

1. `next` → 16.3.5 (non-breaking; clears the critical and two high advisories).
2. Fix `tests/security/access-control.test.mjs:51` — then confirm the 11 assertions after it actually pass.
3. Fix the payment-reversal status recompute (F-1), with an action-layer assertion.
4. Add `reversed_at is null` to project cash (F-2).
5. Subtract `creditedAmount` in the payments register (N-1).
6. Run the runbook's `information_schema` query against production and record the answer.

Items 2–5 are small, local, and independently testable. Item 1 is a version bump.
Item 6 is not code at all — it is the fact everything else depends on.

**This audit stops here. No implementation was performed and none should be
inferred as approved.**

---

## 10. Decisions only the owner can make

Everything else in the roadmap can proceed on engineering judgement. These
cannot.

1. **Production database state.** Run the runbook's `information_schema` query against production Neon and report which of the six columns exist, and what commit is currently deployed. **Nothing else in the deployment plan can be finalised without this.**
2. **Credit notes on cash-paid invoices — where does the credit go?** The consistent answer is 2300 (value the customer holds is a liability however it arrived). Adopting it changes non-advance credit-note behaviour and the tests that pin it. Alternatives: leave AR negative and document it, or require a refund. **This is an accounting-policy choice, not a technical one.**
3. **Segregation of duties.** Should `staff` retain the ability to void invoices, issue credit and debit notes, and receive purchase orders? Today they can, by design. Changing it means a fourth role or per-action gates.
4. **Customer PII encryption, and which trade-off.** Deterministic blind index (exact and prefix search survive, substring does not, equality leakage becomes a conscious decision) or a separate unencrypted display column (simpler, concedes the name is unprotected). Both require backfilling every customer row and a decision about behaviour when `FIELD_ENCRYPTION_KEYS` is absent. The GDPR portability export must emit plaintext and therefore must decrypt.
5. **Proforma project attribution — backfill or not.** Adding `projectId` and carrying it through conversion is straightforward. Whether already-converted invoices are backfilled, and from what source, is a data decision with no technically correct answer.
6. **Generated migrations — regenerate or delete.** Either re-baseline them so the repository carries reproducible schema history, or delete them and document `db:push` as the only path. **Leaving them stale is the one option that keeps the trap armed.**
7. **`puppeteer-core` major-version upgrade** (19.x/24.x → 25.10.0) for the PDF path, or accept the high-severity `extract-zip` advisories on a build/PDF-time dependency.
8. **Purchase-order paid statuses.** Filed with its blast radius. Worth building, or is the absence acceptable?
9. **Inventory valuation and COGS.** Was this ever intended? No mechanism was found. If intended, it is a design task, not a fix.
10. **Whether a responsive/accessibility pass is in scope.** Both are currently unverified and this audit makes no claim about either.

---

## 11. How to read this audit

- Every "PASS" in §5.2 marked *executed* was run on 12 September 2026 against a disposable database created for the purpose. Every "FAIL" marked *derived* was reasoned from traced source and is labelled so.
- No completion percentage is offered. The counts in §4.2 disclose their denominator and are a shape, not a score.
- "Implemented", "tested" and "production-ready" are kept apart throughout, and the product is strong on the first, good on the second, and **unproven on the third**.
- Where I could not verify something, it says so. §2.3 lists what was not examined, and nothing in this document depends on those areas.
