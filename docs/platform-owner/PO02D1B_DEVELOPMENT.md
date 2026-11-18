# Platform Owner — PO-02D1B: default Trial package and platform settings seed

> Phase PO-02D1B of the Elite ERP Platform Owner programme. **Development only.** It adds a reviewed, data-only,
> retry-safe seed for the singleton platform settings row, the default Trial package and its published version 1 with
> the owner-approved values, a guarded rollback for exactly that seed, and the guarded runner that executes either one
> only on a loopback `*_test_only_*` database after the release preflight has passed. No subscription, primary owner,
> invitation, invitation terms, subscription event or paid package was created; no customer company was created or
> modified; no feature flag, tenant-access enforcement, UI, route, permission, authentication, session or business logic
> was changed. Nothing ran against production: every database was a loopback, disposable `*_test_only_*` database holding
> fictional rows only, and every one was dropped. Decisions D-6 and D-7 remain open; `db:push` and the drizzle-kit
> migration journal are unchanged.

---

## A. Completion status

| Step | Status |
|---|---|
| 4 — Baseline | done — `main` = `621f156` (live), `feat/platform-owner` = `2416ca7`, PR #11 open, **draft, unmerged**, untouched; the PO-01A, corrected PO-02A and PO-02D1A SQL byte-identical to the approved files; full baseline regression green (§K) except the pre-existing Next.js advisory gate |
| 5 — Module-group reconciliation | done — the nine navigation groups, reconciled with the server-side role matrix and with every page and route under `src/app/(app)`; **no canonical entitlement registry exists** (§E) |
| 6 — Seed SQL | done — `drizzle/platform/PO02D1B_seed_trial_and_settings.sql`: one transaction, its own target guard, the full foundation and an enabled audit trail as preconditions, value validation, settings + Trial package + published Trial v1 + one audit event (§D, §F) |
| 7 — Retry safety and atomicity | done — absent → created; identical → verified, nothing written; different → refused, every difference named, nothing written; an audit failure or a terminated backend leaves nothing (§F, §G) |
| 8 — Migration safety | done — the runner requires `PUSH_SAFE` + `REVIEWED_SQL_COMPLETE` before it opens a write connection; H-1 and H-2 (named together on a pre-onboarding database with legacy users) and H-3 (O-06) stop it; no push is ever run by the seed; a gated push was tested only on a separate disposable database (§H) |
| 9 — Guarded rollback | done — `drizzle/platform/PO02D1B_seed_rollback.sql`: removes exactly the three seed records or refuses; keeps all audit evidence; suspends exactly one trigger for one statement (documented privilege limitation, §I) |
| 10 — Tests | done — `verify:platform-onboarding-seed` **113/113**, all 20 required categories, real PostgreSQL, deterministic barriers, no mocks (§J) |
| 11 — ERP regression | done (§K); the build **compiles** and generates every page, then stops at the pre-existing dependency-advisory gate (reported separately; not bypassed; nothing upgraded) |
| 12 — Change control | done — PO-02D1B approved-delta layer (`verify/po02d1b-approved-delta.mts`); boundary rule 41 narrowed and rule 43 added; 9 tamper tests, all caught (18 verifier runs; working tree restored byte-exactly); undo proof byte-exact (§J.3) |
| 13 — This document | done |
| 14 — Git | done — three commits on `feat/platform-owner` only (§B) |
| **STOP gate** | **STOPPED.** No invitation, no subscription outside isolated tests, no production change, no tenant-access enforcement, PO-02D2 not started |

**Findings for owner attention:**
1. **No canonical module-entitlement registry exists.** The Trial's `module_groups` is a display-only catalog snapshot:
   the nine navigation groups, in declaration order. Nothing reads it, grants it, hides or blocks anything with it.
   It is **not** a module-entitlement system (§E).
2. **A published version cannot be deleted — by design — so the seed rollback needs a privileged step.** The
   development rollback suspends exactly `subscription_package_versions_guard`, for the single DELETE of the verified
   seed row, under a lock, inside the transaction, and proves it enabled again before COMMIT. It requires the table
   owner. A production rollback is **not** authorized and would need its own separately reviewed procedure (§I.4).
3. **No convention conflicts with the schema or the accepted specifications** (§D.5). Two conventions are not encoded in
   any constraint and stay obligations of later phases: the inclusive Trial term (applied when a subscription is
   assigned, PO-02D3) and "an expiry never suspends a company".
4. **The Trial price is carried by the model's own fields** — `monthly_price` and `annual_price` = `0.00` (numeric(14,2)),
   `currency_code` = `SAR`, with the schema's Trial-terms CHECK requiring zero prices for Trial versions. No separate
   Trial-price column exists and none was added.
5. **System attribution.** The package and version carry no operator (`created_by_platform_admin_id` NULL — the schema
   allows that only for the default Trial / Trial versions); the audit event is actor-less with the label
   `migration PO-02D1B seed`.
6. **Next.js 16.4.3 advisory gate (pre-existing release blocker)** — unchanged, not bypassed, nothing upgraded (§L).

---

## B. Branch and commits

| | |
|---|---|
| Repository | `Delowar01/Elite-ERP` |
| Branch | `feat/platform-owner` (pushed; nothing else pushed) |
| Base (approved PO-02D1A.1 head) | `2416ca70d61f2810f7354023f1604bb2a6195aa3` |
| Live ERP (`main`) | `621f156f7b129b9c2e289bc46d314ce7587beec2` — unchanged |
| PR #11 | open, draft, unmerged — not modified |
| PO-02D1B commits | 1. **feat** `26c4ddbac90064e2aed7000f35e494143d95bfcd` — seed SQL, rollback SQL, guarded runner, `platform:db:seed` / `platform:db:seed-rollback`, the approved-delta layer and its freeze-verifier hooks, boundary rules 41/43 (`verify:static` and the boundary suite green at this commit)<br>2. **test** `37c9f930c0e15b2a69a74290c26174da6d411320` — `verify:platform-onboarding-seed` and its place in the `verify:platform` chain (`verify:platform` green from here)<br>3. **docs** — this document (the branch head; its SHA is in the handover report) |

---

## C. Changed files

**Added**

| File | Lines | sha256 (16) | Purpose |
|---|---|---|---|
| `drizzle/platform/PO02D1B_seed_trial_and_settings.sql` | 424 | `0bce59ca04e43b35` | the reviewed seed (§F) |
| `drizzle/platform/PO02D1B_seed_rollback.sql` | 332 | `026848ed4efd9a30` | the guarded rollback (§I) |
| `scripts/platform/trial-seed.ts` | 227 | `df211b31223f00ce` | the guarded runner, the mirrored approved values (`TRIAL_SEED`, `TRIAL_MODULE_GROUPS`) and the read-only `checkTrialSeed` |
| `verify/po02d1b-approved-delta.mts` | 91 | `8ffc2d99d19c1224` | the PO-02D1B approved-delta record (generated from the diff against 2416ca7) |
| `verify/verify-platform-onboarding-seed.mts` | 711 | `27e8f9260760e530` | the 113-check suite (§J.1) |
| `docs/platform-owner/PO02D1B_DEVELOPMENT.md` | — | — | this document |

**Modified** (against 2416ca7)

| File | Lines | Change |
|---|---|---|
| `package.json` | +4 −1 | `platform:db:seed`, `platform:db:seed-rollback`, `verify:platform-onboarding-seed`; the `verify:platform` chain runs the seed suite after `verify:platform-release-preflight`. `db:push` unchanged |
| `tests/security/platform-boundary.test.mjs` | +49 −4 | header note; rule 41 narrowed; rule 43 added (7 checks) |
| `verify/verify-document-form.mts` | +12 −4 | its 6 recorded hunks: the PO-02D1B layer read before PO-02D1A.1's, the two SQL files kept out of the directory pins, one new check |
| `verify/verify-page-archetypes.mts` | +24 −6 | its 7 recorded hunks: the same hooks and group 30 (2 new checks) |
| `verify/verify-platform-onboarding-schema.mts` | +1 −1 | one check label clarified; its condition is unchanged |

**Not changed:** anything under `src/` (application, schema modules, UI, routes, permissions, authentication, sessions,
customer business logic); the PO-01A, PO-02A (with its approved locking fix) and PO-02D1A SQL files; the drizzle-kit
journal (`drizzle/meta`); `scripts/platform/release-preflight.ts` and `scripts/platform/local-db-guard.ts` (the preflight is
consumed, not weakened); the `db:push` script; every accepted UI file and every earlier approved-delta record.

---

## D. Exact seeded values

### D.1 `platform_settings` — the singleton row

| Column | Seeded value | Source |
|---|---|---|
| `id` | `1` | schema singleton (`CHECK (id = 1)`) |
| `default_trial_days` | `14` | **owner**: Trial duration 14 days |
| `grace_days` | `0` | **owner**: grace period 0 days |
| `expiry_alerts_enabled` | `true` | **owner**: expiry alerts enabled |
| `manual_billing` | `true` | convention: manual billing mandatory (locked by `platform_settings_locked_chk`) |
| `platform_mfa_required` | `true` | convention: Platform Owner MFA mandatory (same locked CHECK) |
| `platform_currency` | `SAR` | convention (`CHECK (platform_currency = 'SAR')`) |
| `platform_timezone` | `Asia/Riyadh` | convention (`CHECK (platform_timezone = 'Asia/Riyadh')`) |
| `updated_by_platform_admin_id` | `NULL` | system seed; never saved by an operator |
| `updated_at` | transaction time | column default |

### D.2 `subscription_packages` — the default Trial

| Column | Seeded value | Source |
|---|---|---|
| `id` | generated (`gen_random_uuid()`) | — |
| `code` | `trial` | convention |
| `name` | `Trial` | convention: stored English name; the UI shows the Arabic label from the dictionary |
| `description` | `NULL` | none specified — none invented |
| `status` | `active` | the default Trial is the package an invitation names; the schema forbids archiving it |
| `is_trial` / `is_default_trial` | `true` / `true` | the single default Trial (unique partial index) |
| `created_by_platform_admin_id` | `NULL` | system-seeded (`attribution_chk` permits NULL only for the default Trial) |

### D.3 `subscription_package_versions` — Trial version 1

| Column | Seeded value | Source |
|---|---|---|
| `version_number` | `1` | — |
| `publish_state` / `published_at` | `published` / transaction time | immutable from then on (guard trigger) |
| `is_trial` | `true` | — |
| `currency_code` | `SAR` | convention |
| `monthly_price` / `annual_price` | `0.00` / `0.00` (numeric(14,2), scale 2) | **owner**: price SAR 0.00 |
| `included_seats` | `3` | **owner**: 3 users |
| `storage_allowance_gb` | `5` | **owner**: 5 GB |
| `trial_days` | `14` | **owner** 14 days; convention: the published version governs the Trial length |
| `module_groups` | `["Dashboard", "Projects", "Sales", "Purchasing", "Inventory", "Clients", "Finance", "People", "Administration"]` | **owner**: all existing ERP modules (snapshot and source: §E) |
| `created_by_platform_admin_id` | `NULL` | system-seeded (`attribution_chk` permits NULL for Trial versions) |

### D.4 `platform_audit_events`

One append-only record, written only when something was created (§G.1).

### D.5 Specification-derived conventions — recorded separately from the owner's values

| Convention | How it is honoured | Conflict with schema or specifications |
|---|---|---|
| Package code `trial` | `code = 'trial'` | none (`code_chk` regex accepts it) |
| Stored English name `Trial` | `name = 'Trial'`; Arabic from the dictionary | none |
| Business time zone Asia/Riyadh | `platform_timezone`, CHECK-locked | none |
| The published Trial version governs `trial_days` | Trial v1 carries `trial_days = 14`; settings `default_trial_days = 14` only pre-fills (decision T-5) | none |
| Inclusive Trial term: end = start + 14 − 1 | **not applicable to a seed** — no subscription is created. `tenant_subscriptions` stores `start_date` / `end_date` with only `end_date >= start_date`, so the inclusive rule is applied (and must be tested) by the code that assigns a subscription (PO-02D3) | none |
| Default Trial price SAR 0.00 | both prices `0.00`, SAR; `trial_terms_chk` requires zero prices for Trial versions | none |
| Manual billing mandatory | `manual_billing = true` (locked CHECK) | none |
| Platform Owner MFA mandatory | `platform_mfa_required = true` (locked CHECK) | none |
| Expiry never suspends | the seed writes no access, subscription or job row; no application code reads `tenant_subscriptions` (only its schema declaration does), and company access changes only through the Platform Owner's explicit PO-02C control | none — an obligation on every later expiry or alert feature |

Every owner value was used exactly as approved. The approved values live **once** per SQL file, in
`pg_temp.po02d1b_approved()`, byte-identical in the seed and the rollback and mirrored by `TRIAL_SEED` in the runner;
three verifiers prove the three agree (§J).

---

## E. Module snapshot and its source

**Source:** `NAV_GROUPS` in `src/components/layout/nav-config.ts`, in declaration order, read with the TypeScript AST (no
React import). The unlabelled first group (`label: null`) is named by its only item, `Dashboard`. Each label is an existing
dictionary key with a native Saudi Arabic translation.

| # | Snapshot label | Arabic (UI) | Navigation items (routes) | Role matrix (`src/lib/role-matrix.ts`, owner / admin / staff) |
|---|---|---|---|---|
| 1 | Dashboard | لوحة التحكم | `/dashboard` | no row — not role-gated; every role sees it |
| 2 | Projects | المشاريع | `/projects` | Projects — full / full / full |
| 3 | Sales | المبيعات | quotations, orders, proforma, invoices, delivery challans, credit notes (`/sales/…`) | Sales & Purchasing — full / full / full |
| 4 | Purchasing | المشتريات | purchase orders, debit notes, vendors (`/purchasing/…`) | Sales & Purchasing; Clients & Vendors — full / full / full |
| 5 | Inventory | المخزون | `/inventory/products` | Inventory — full / full / full |
| 6 | Clients | العملاء | `/clients` | Clients & Vendors — full / full / full |
| 7 | Finance | المالية | bank accounts, journal, chart of accounts, ledger, reports, payments, statements (`/finance/…`) | Finance — full / full / full |
| 8 | People | الموارد البشرية | employees, departments, payroll, attendance, leave (`/hr/…`) | Employees & Attendance — full / full / full; Payroll — full / full / none |
| 9 | Administration | الإدارة | presets, organization, security, compliance (`/settings/…`; the Team page `/settings/team` is in the same segment) | Configuration — full / full / none; Security Center — full / full / full (self-service) |

**Reconciliation:**
- Every one of the role matrix's nine access modules maps onto snapshot groups, and every snapshot group except
  Dashboard is covered by a role-matrix module.
- Every one of the 72 page and route files under `src/app/(app)` belongs to a snapshot group by its first path segment
  (`hr` → People, `settings` → Administration, …) or to a documented exclusion. The exclusions are:
  - `recycle-bin` — the cross-module Recycle Bin, a utility;
  - `design-system` — the development-only design specimen, 404 in production;
  - `documents` — cross-module list export and import endpoints.
- Every snapshot group has at least one real page.

**No canonical entitlement registry exists.** The role matrix documents role access; it grants no package entitlement.
No code under `src/` reads `module_groups` or any module list to grant, hide or block anything; the verifier proves it.
Permissions, route guards and the owner/admin/staff role behaviour are unchanged (nothing under `src/` changed).

**Determinism:** the snapshot is derived twice and compared, and no label may be duplicated or empty. Three copies must be
equal:
- the AST-derived list;
- `TRIAL_MODULE_GROUPS` in the runner;
- the list in the SQL's approved block.

A new or renamed navigation group fails the suite (tamper T9, §J.3); nothing is silently omitted.

---

## F. Seed transaction and idempotency evidence

### F.1 The runner (`npm run platform:db:seed`, `scripts/platform/trial-seed.ts`)

Each gate refuses before anything is written, in this order:

1. **local-db-guard.** The target must be a loopback-only `*_test_only_*` database, checked before any connection opens.
   Otherwise: exit 2.
2. **Release preflight (read-only).** It must report `PUSH_SAFE` and `REVIEWED_SQL_COMPLETE`. Otherwise: exit 3, with
   every blocking finding listed.
3. **The reviewed SQL** (§F.2). A refusal (P0001 or 23xxx) exits 4 and names every reason.
4. **Read-only post-check** (`checkTrialSeed`). The database must hold exactly the seed: `complete`, or `absent` after a
   rollback. Otherwise: exit 1.

The runner never pushes, never migrates and never prints `DATABASE_URL`. `--json` prints one JSON document.

### F.2 The SQL — one transaction

| Order | Part | What it does |
|---|---|---|
| 1 | `BEGIN`, `lock_timeout 5s`, `statement_timeout 120s` | the whole file is one transaction |
| 2 | `$target$` | refuses a non-`*_test_only_*` name, a non-loopback server address, or a server that listens beyond loopback (mirrors `local-db-guard`) |
| 3 | `$pre$` | the complete foundation (preconditions below) |
| 4 | `LOCK TABLE` the three catalog tables `IN SHARE ROW EXCLUSIVE MODE` | serializes concurrent seeds; reads continue; no customer table is locked |
| 5 | `po02d1b_approved()` / `po02d1b_diff()` / `$values$` | the approved values, checked against the Stage 2 rules before any write: trial days 1–120 and equal in settings and version; grace 0–60; manual billing and MFA on; SAR; Asia/Riyadh; both prices `0.00`; seats and storage ≥ 1; code and name format; module groups a non-empty list of distinct labels |
| 6 | S1 settings, S2 package, S3 version | each **created** when absent, **verified** when identical, **refused** when different |
| 7 | S4 audit | one record, only when something was created |
| 8 | `$post$` | exactly one settings row, one default Trial, Trial v1 published with the approved values |
| 9 | drop the `pg_temp` helpers, `COMMIT` | — |

**Preconditions checked in `$pre$`:**
- all 13 Platform Owner tables;
- PO-01A's append-only audit trail **enabled**: the decoy-resistant row and TRUNCATE trigger rule, with the reviewed
  `platform_reject_mutation` body;
- PO-02A's two indexes, valid;
- F1 `users_org_id_id_uq`, validated, with a valid index;
- the three guard functions: not SECURITY DEFINER, `search_path=pg_catalog`;
- the ten PO-02D1A triggers, each enabled, matching its reviewed definition.

### F.3 Evidence (`verify:platform-onboarding-seed`)

| Case | Result |
|---|---|
| First seed (runner) | exit 0; preflight passed; `created ×3` + `S4 platform_audit_events: recorded`; the database holds exactly §D.1–D.3 (#1, #2, #5, #7) |
| Identical second seed | exit 0; `verified ×3` + `S4 … none (everything verified; nothing created)`; the three rows' `xmin` unchanged; no duplicate; the audit trail did not grow (#3) |
| Differing values: settings with 30 trial days; settings with alerts off and grace 5; a `trial` package with another name; another package already the default Trial; Trial v1 as a draft with 5 seats | each refused (exit 4), the difference named; catalog and every row identical; no audit record (#4) |
| An audit write that fails (55P03 on a held lock), after settings, package and version were written | the whole seed rolled back; a retry seeds everything (#10, #11) |
| `pg_terminate_backend` with all four steps done, before COMMIT | nothing survives (no row, no audit record, no `pg_temp` helper); a retry seeds everything (#11) |
| Two concurrent seeds (barrier: the second observed waiting on the catalog lock) | the first commits, the second verifies and writes nothing; exactly one row each and one audit record. If the first rolls back instead, the waiting one creates everything (#20) |
| Customer data | no subscription, primary-owner mapping, invitation terms or subscription event; every table outside the three catalog tables and the audit trail byte-identical; the catalog projection unchanged; every customer foreign key present (#12–#15) |
| Legacy companies, while a seed is in flight and after it | strong locks only on the three catalog tables. Customer sign-in (enforcement off and on), Platform Owner sign-in, registration, and customer reads and writes all complete. Every legacy company still has no subscription, owner mapping or access row (#16) |

---

## G. Audit and immutability evidence

### G.1 The audit record

The seed writes one append-only `platform_audit_events` row, in the same transaction:

| Field | Value |
|---|---|
| `action` | `seed.trial_and_settings_created` |
| `actor_platform_admin_id` | `NULL` |
| `actor_label` | `migration PO-02D1B seed` |
| `entity_type` / `entity_id` | `seed` / `PO02D1B` |
| `result` | `success` |
| `after_safe` | the step outcomes, the package and version ids, the approved values |

The record holds no secret, token, URL or customer data. It is written only when at least one record was created; a
verify-only re-run writes nothing. The rollback appends `seed.trial_and_settings_removed`; the seed's record is never
removed.

**Audit protection checks:**
- **Required enabled.** The SQL refuses by itself when the audit trail's trigger is disabled, and the preflight refuses
  first with P1-01 (#17).
- **Atomic.** An audit failure undoes the settings, package and version (#10).
- **Never weakened.** No file disables, alters or bypasses the audit trail's protection (boundary rule 43).

### G.2 Published-version immutability and catalog invariants

Each case leaves the Trial exactly as seeded (#5, #6, #9):

| Statement | Result |
|---|---|
| UPDATE of the published Trial's `monthly_price`, `annual_price`, `included_seats`, `storage_allowance_gb`, `trial_days`, `module_groups` or `publish_state` (7 cases) | refused, 23001 |
| DELETE of the published Trial version | refused, 23001 |
| TRUNCATE of the versions | refused (append-only guard) |
| A second default Trial package | refused, 23505 (unique default-Trial index) |
| Archiving the default Trial | refused, 23514 |
| A second settings row / a duplicate id 1 | refused, 23514 (singleton CHECK) / 23505 (primary key) |
| MFA or manual billing switched off | refused, 23514 (locked CHECK) |

---

## H. Preflight

- **Before seeding:** the release preflight reports `PUSH_SAFE` / `REVIEWED_SQL_COMPLETE` (exit 0). After seeding it
  still does — the seed is data-only (#17).
- **The runner enforces it.** The preflight runs before the runner opens its write connection. Any blocking finding stops
  the seed with exit 3 and the findings listed. Each case was proven on its own database, with nothing written:

| Unsafe state | Refusal |
|---|---|
| Pre-onboarding schema with legacy users (PO-01A + PO-02A; no F1, no PO-02D1A) — PO-02D1A.1's push-before-SQL state | `BLOCKED` / `REVIEWED_SQL_NOT_APPLIED`, naming **D1-00**, **H-1** (users has rows and push would add a unique key: the TRUNCATE prompt) and **H-2** (push would create the onboarding tables outside the reviewed SQL); every table and the catalog unchanged. The SQL run directly refuses too (#17) |
| A disabled onboarding trigger | **D1-02**; the SQL refuses by itself as well, naming the trigger (#17) |
| A disabled audit-trail trigger | **P1-01**; the SQL refuses by itself (#17) |
| A dropped long-named customer foreign key — the H-3 signature of an interrupted push | **O-06**; restored with its exact definition, the same database seeds (#18) |
| A target without `_test_only_` | refused before any connection (exit 2) |

- **No push during seeding.** Neither the runner nor the SQL runs `drizzle-kit push` or a migration (boundary rule 43
  pins the runner).
- **Push compatibility.** A gated push (`preflight && push`) ran only on a **separately created** seeded disposable
  database:
  - the preflight was `PUSH_SAFE` first;
  - push issued only the known benign foreign-key re-creations;
  - the full catalog projection was identical afterwards and every customer foreign key present;
  - the seed rows were not rewritten (`xmin` unchanged).
- **Unchanged.** `db:push` (boundary rule 42) and the historical migration journal.

---

## I. Rollback results

### I.1 Procedure (`npm run platform:db:seed-rollback`)

The runner applies the same guard, preflight and post-check (expected `absent`). The SQL then runs these steps:

1. **Guards.** Its own target guard, and the audit-trail and guard-trigger preconditions.
2. **Locks.** SHARE ROW EXCLUSIVE on the three catalog tables; SHARE on `tenant_subscriptions`,
   `subscription_events` and `organization_invitation_terms`.
3. **Verify everything** before removing anything.
4. **Remove, in reverse order:** R1 version, R2 package, R3 settings. Each DELETE targets exactly one row by verified
   identity and must remove exactly one.
5. **Audit.** R4: one `seed.trial_and_settings_removed` record.
6. **Postcondition.** Every protection trigger is enabled exactly as reviewed.
7. **COMMIT.**

A record that is absent is skipped, so a repeated rollback changes and records nothing.

### I.2 Refusals — nothing removed, every reason named

The rollback refuses when any of these holds:
- a subscription, a subscription event or an invitation-terms row exists — the platform has acquired data that depends
  on the catalog;
- Trial v1 is referenced by a subscription or by invitation terms;
- the settings differ from the seed, or were saved by an operator (`updated_by` set);
- the Trial package differs from the seed, or has another version;
- Trial v1 differs from the seed;
- another package is the default Trial.

### I.3 Evidence

| Case | Result |
|---|---|
| Rollback through the runner | exit 0; `removed ×3` and one rollback audit record. The seed's own audit record is kept. No schema object was removed: the catalog projection is identical to before the seed, and the onboarding and PO-01A checks pass. No customer record was touched. The immutability guard and the audit triggers are enabled exactly as before (#19) |
| Repeated rollback | `absent ×3`, nothing recorded (#19) |
| Seed again after a rollback | `created ×3`, a second creation record (#19) |
| Refusals (6 cases): Trial v1 referenced by a fictional isolated subscription; by fictional isolated invitation terms; settings saved by an operator; settings changed to 21 days; a later draft Trial v2; the package renamed | each refused (exit 4) with every reason named; catalog, every row and the protection triggers unchanged (#19) |
| A concurrent writer of **another** published version during a rollback | it waits on the rollback's lock. After COMMIT it is refused by the guard (23001): the guard was never off for any other session (#19) |
| A rollback whose audit write fails (55P03) | undone entirely: the Trial and settings are still there, and the guard is **enabled**, because the suspension rolled back too (#19) |

### I.4 The immutability guard — mechanism and limitation

`subscription_package_versions_guard` refuses to delete a published version. That is the security property, and it was
not weakened. The rollback suspends it under strict limits:

- **Scope.** That one trigger, on that one table, for one statement: the DELETE of the single verified seed row, by `id`
  and `version_number = 1`.
- **Isolation.** It runs inside the transaction while SHARE ROW EXCLUSIVE is held, so no other session can write any
  version meanwhile. `ALTER TABLE … DISABLE TRIGGER` takes that same lock.
- **Re-enable.** The trigger is re-enabled immediately, and before COMMIT the rollback asserts that every protection
  trigger is enabled as reviewed.
- **Failure.** DDL is transactional, so any failure also undoes the suspension.
- **Never touched.** The rollback never sets `session_replication_role`, never uses `DISABLE TRIGGER ALL/USER` and never
  touches the audit trail's protection. Boundary rule 43 pins this as the **only** trigger bypass in the reviewed SQL.

**Limitation:** `ALTER TABLE … DISABLE TRIGGER` requires the table owner. This is a privileged, development-only mechanism
on disposable databases. A production rollback of a published version is **not authorized**. It would need a separately
reviewed privileged procedure (§L) — for example, a one-off reviewed script run by the database owner under the
D-6 mechanism, with its own tests. No broad bypass was implemented.

---

## J. Test counts

### J.1 `verify:platform-onboarding-seed` — 113/113

| # | Required category | Checks (tagged) | Suite section |
|---|---|---|---|
| 1 | Correct approved settings | 3 | §0, §1 |
| 2 | First seed | 2 | §1 |
| 3 | Identical second seed | 2 | §2 |
| 4 | Differing values refused | 11 | §4 |
| 5 | Exactly one default Trial | 3 | §1, §3 |
| 6 | Published Trial immutability | 10 | §3 |
| 7 | SAR 0.00 precision | 1 | §1 |
| 8 | All module labels present | 9 | §0 |
| 9 | Settings singleton enforcement | 3 | §3 |
| 10 | Audit-event atomicity | 4 | §1, §5 |
| 11 | Failed transaction rollback | 4 | §5 |
| 12–14 | No subscription / primary-owner mapping / invitation terms | 1 (one check covers all three) | §1 |
| 15 | No existing company modified | 1 | §1 |
| 16 | Legacy customer-company compatibility | 9 | §7 |
| 17 | Preflight rejection of incomplete schemas | 7 | §1, §8 |
| 18 | Missing customer foreign-key detection | 2 | §9 |
| 19 | Rollback safety | 24 | §10–§12 |
| 20 | Concurrent seed attempts | 4 | §6 |
| — | Supporting checks (identical approved blocks, the SQL's module list, catalog and preflight after seeding, `--json`, the unsafe-target refusal, gated push compatibility, follow-ups) | 13 | §0–§13 |

All checks run against real PostgreSQL 16 — constraints, triggers, locks and transactions, with no mocks. Concurrency is
deterministic: a backend is observed waiting on a heavyweight lock (`pg_stat_activity`, `pg_blocking_pids`) before the
next step. Every case runs on a fresh `CREATE DATABASE … TEMPLATE` copy of one reviewed-chain base (621f156 tenant shape
→ PO-01A → fictional rows → corrected PO-02A → PO-02D1A), and every database is dropped.

### J.2 Change-control suites

| Suite | Baseline (2416ca7) | Now | Change |
|---|---|---|---|
| `tests/security/platform-boundary.test.mjs` | 121 | **128** | rule 41 narrowed; rule 43 added (7 checks) |
| `verify:document-form` | 88 | **89** | + the PO-02D1B approved-delta check |
| `verify:page-archetypes` | 302 | **304** | + group 30 (2 checks) |
| `verify:platform-onboarding-schema` | 167 | **167** | one label clarified; no condition changed |

**Rule 41, narrowed.** "No seed file" in `drizzle/platform` now admits exactly
`PO02D1B_seed_rollback.sql` and `PO02D1B_seed_trial_and_settings.sql`.

**Rule 43, new (7 checks):**
1. Both files are marked NOT AUTHORIZED FOR PRODUCTION EXECUTION, each is ONE transaction, and each guards its target
   itself.
2. The seed's writes are exactly INSERTs into the three catalog tables and the audit trail: no DDL, no trigger bypass.
3. The rollback's writes are exactly DELETEs on the three catalog tables and one audit INSERT, with exactly two
   `ALTER TABLE` statements.
4. That DISABLE/ENABLE pair is the only trigger bypass in all of `drizzle/platform`:
   - never ALL or USER;
   - never `session_replication_role`;
   - never the audit table.
5. The approved block is identical in both files and carries the owner's values.
6. The runner applies both guards and runs the preflight before `new Client(`; it never pushes or migrates.
7. Nothing in `src/` references the seed.

### J.3 Approved-delta, undo proof and tamper tests

- **Layer** — `verify/po02d1b-approved-delta.mts`, base `2416ca7`. It records:
  - `verify/verify-document-form.mts`: 6 hunks (base sha16 `7ff3b3760a2afbe5`);
  - `verify/verify-page-archetypes.mts`: 7 hunks (base sha16 `83de54e2d25e4d5d`);
  - the two new SQL files: `PO02D1B_seed_trial_and_settings.sql` `0bce59ca04e43b35` and `PO02D1B_seed_rollback.sql`
    `026848ed4efd9a30`.

  Both freeze verifiers undo the PO-02D1B hunks **before** the PO-02D1A.1 layer, so every older pin still reads the
  approved 2416ca7 bytes. Nothing was rebaselined.
- **Undo proof:** after their recorded hunks are undone, both edited verifiers are byte-identical to 2416ca7
  (`7ff3b3760a2afbe5`, `83de54e2d25e4d5d`); both SQL files are absent at 2416ca7 and hash exactly as recorded.
- **Tamper tests** (each applied alone, then restored):

Verifiers: `docform` = `verify:document-form`; `archetypes` = `verify:page-archetypes`; `boundary` =
`tests/security/platform-boundary.test.mjs`; `seed-suite` = `verify:platform-onboarding-seed`.

| # | Tamper | Caught by (exit code) |
|---|---|---|
| T1 | an approved value changed (seats 3 → 4) | `docform` (1); `boundary` (1); `seed-suite` (1) |
| T2 | the seed's disposable-target guard removed | `boundary` (1); `archetypes` (1) |
| T3 | the seed writes a customer table | `boundary` (1); `docform` (1) |
| T4 | the rollback disables ALL triggers | `boundary` (1); `docform` (1) |
| T5 | session_replication_role = replica in the rollback | `boundary` (1) |
| T6 | the runner ignores a blocking preflight | `boundary` (1); `seed-suite` (1) |
| T7 | an unrecorded seed file under drizzle/platform | `boundary` (1); `docform` (1) |
| T8 | the PO-02D1B delta record altered | `docform` (1); `archetypes` (1) |
| T9 | a new navigation group (snapshot no longer complete) | `seed-suite` (1); `docform` (1) |

**9 tampers, 18 verifier runs, none missed.** The working-tree fingerprint was `dd4c0dec31e3ed8c` before and after
the run, so every file was restored byte-exactly. Afterwards docform, archetypes and boundary all exit 0.

The tamper run was started twice before this one and stopped deliberately, so that the evidence above is for the final
bytes:
1. The first stop corrected the runner name in both SQL headers (`seed-trial.ts` → `trial-seed.ts`), which changed the
   two recorded hashes.
2. The second stop made the pre-onboarding case name H-1 and H-2 explicitly.

Each interrupted run's files were restored to their recorded hashes and its disposable databases were dropped.

---

## K. ERP regression

Both runs used test-only settings on a loopback disposable cluster:
- **Baseline:** the unmodified `2416ca7` tree.
- **Final:** the complete PO-02D1B tree, this document included (before its results were filled in; that edit is
  text-only).

| Check | Baseline (2416ca7) | Final (PO-02D1B) | Result |
|---|---|---|---|
| TypeScript (`tsc --noEmit -p .`) | exit 0 | exit 0 | unchanged |
| ESLint (`src tests scripts verify`) | 28 problems (7 errors, 21 warnings), pre-existing | the same 28, finding for finding | unchanged. The PO-02D1B files have 0 problems (scoped run on the 7 changed or added code files) |
| `verify:static` (the chain) | pass | pass | — |
| The 22 `verify:static` suites, each run alone | all pass | all pass | `verify:document-form` 88 → **89** and `verify:page-archetypes` 302 → **304** (the PO-02D1B checks); the other 20 suites have identical counts |
| ACC-01 inventory costing / project costing | 171 / 50 | 171 / 50 | unchanged |
| Customer access-control / crypto-policy tests | 22 / 18 | 22 / 18 | unchanged |
| Platform boundary | 121 | **128** | rule 41 narrowed, rule 43 added |
| `verify:platform` (full chain) | 15 suites, pass (547 s) | **16 suites**, pass (735 s) | + `verify:platform-onboarding-seed` 113 |
| UI guardrails report | — | byte-identical to the baseline run's report | unchanged (report only) |
| Platform Owner browsers PO-01B / PO-02B / PO-02C | 138 / 111 / 64 | 138 / 111 / 64 | unchanged |
| PO-02C.1 login race | 51 | 51 | unchanged |
| Next.js production build: compile | compiled; 70/70 pages generated | compiled; 70/70 pages generated | unchanged |
| Next.js production build: completion | stopped by `SecurityFatalError` (the dependency-advisory gate), exit 1 | the same | the pre-existing release blocker. **Not bypassed; nothing upgraded** |

**The `verify:platform` suites, one by one:**

| Suite | Baseline | Final |
|---|---|---|
| `verify:platform-boundary` | 121 | **128** |
| `verify:platform-proxy` | 59 | 59 |
| `verify:platform-schema` | 54 | 54 |
| `verify:platform-auth` | 136 | 136 |
| `verify:platform-bootstrap` | 54 | 54 |
| `verify:platform-console` | 108 | 108 |
| `verify:platform-containment` | 87 | 87 |
| `verify:platform-company-schema` | 108 | 108 |
| `verify:platform-migration-safety` | 92 | 92 |
| `verify:platform-company-migration-locks` (the PO-02A lock suite) | 83 | 83 |
| `verify:platform-onboarding-schema` (PO-02D1A) | 167 | 167 |
| `verify:platform-onboarding-migration-safety` (PO-02D1A) | 202 | 202 |
| `verify:platform-release-preflight` (PO-02D1A.1) | 59 | 59 |
| `verify:platform-onboarding-seed` (**new**, PO-02D1B) | — | **113** |
| `verify:platform-companies` (PO-02B) | 190 | 190 |
| `verify:platform-company-access` (PO-02C) | 116 | 116 |

Every count is "all passed". No test was rebaselined. The only count changes are the PO-02D1B checks recorded in
§J.2.

**Unchanged by PO-02D1B** (`git diff 2416ca7`):
- everything under `src/`;
- the PO-02A SQL with its approved locking fix;
- the PO-01A and PO-02D1A SQL;
- the release preflight and the local-db-guard;
- `db:push`;
- the migration journal.

Screenshots and evidence from the browser suites stayed in the session's scratch area. None was committed.

---

## L. Remaining blockers and owner decisions

| # | Item | Status / what it gates |
|---|---|---|
| 1 | **Next.js 16.4.3 advisory gate** (GHSA-mfr8-8qww-v76h, GHSA-vc7v-qv4w-wrv8 — moderate, `'use cache'` / `unstable_cache` area, which the app does not use; npm reports a fix in 16.4.6) | pre-existing **release blocker**; the build compiles and generates every page, then the gate stops it. Not bypassed; no upgrade authorized |
| 2 | **D-6** — production migration mechanism | open; no production schema or data change, including this seed |
| 3 | **D-7** — read-only production measurements | open; legacy-owner classes, the `lower(email)` index, sizing |
| 4 | **Production Trial seed** | **not authorized**. It needs D-6, an owner-approved production procedure (read-only preflight on the production shape, backup) and the values re-confirmed. The runner and the SQL refuse every non-loopback, non-`*_test_only_*` target today |
| 5 | **Production rollback of the seed** | needs a separately reviewed privileged mechanism (§I.4); not implemented, by instruction |
| 6 | **Module entitlement** | no registry exists; `module_groups` is display-only. The allowed-label catalogue (P-6) is deferred to PO-04; any enforcement is its own phase and approval |
| 7 | Trial package `description` | left NULL (not specified); an EN/AR description can come with package management (PO-04) |
| 8 | Conventions owed by later phases | inclusive end date (T-8) and the version's `trial_days` (T-5) at assignment (PO-02D3); "expiry never suspends" for every expiry or alert feature |
| 9 | **PO-02D2 decisions** | I-2 … I-11 and R-5 are still **provisional** (PO-02D0 §D.5) and must be approved before PO-02D2 starts (§M) |
| 10 | `db:push` gating against H-1 / H-2 / H-3 | still the owner decision from PO-02D1A.1 §F.7; `db:push` unchanged |
| 11 | Merge / deploy | `feat/platform-owner` is merged nowhere; PR #11 (the Stage 2 specification documents) stays draft and unmerged; no merge, deploy or production activation without explicit owner authorization (D-5) |

---

## M. Proposed PO-02D2 invitation-administration prompt — NOT executed

The prompt below is a proposal for owner review. It was **not** run; nothing in it has been implemented. It assumes the
PO-02D2 contract in `docs/platform-owner/PO02D0_DECISIONS.md` (§H there) and its test plan (§J.2 there); every
provisional decision it relies on is listed for approval first.

~~~text
# ELITE ERP — PLATFORM OWNER SYSTEM
## PHASE PO-02D2 — INVITATION ADMINISTRATION (CREATE · REVOKE · RE-ISSUE · ONE-TIME COPY LINK)

### PROJECT BASELINE
Repository: Delowar01/Elite-ERP. Development branch: feat/platform-owner.
Approved PO-02D1B head: <SHA of the PO-02D1B docs commit>. Production: 621f156f7b129b9c2e289bc46d314ce7587beec2.
PR #11: draft, unmerged — do not change it.

### 1. OWNER DECISIONS REQUIRED BEFORE ANY CODE (PO02D0_DECISIONS.md §D.5 / §D.4 — provisional until approved)
Confirm or replace each; if any is not approved, STOP and report:
- I-2 permission `platform.companies.invite` (new; not `manage_access`).
- I-3 step-up: password + fresh TOTP for create and re-issue; fresh TOTP + reason for revoke.
- I-4 expiry: fixed 72 hours.
- I-5 duplicate pending invitation for an e-mail: refuse while unexpired, naming the pending INV- reference; an expired
  slot holder is revoked in the same transaction, attributed and audited.
- I-6 rate limit: 20 creates or re-issues per operator per hour, plus the existing durable step-up throttle.
- I-7 e-mail: normalize lower(btrim()); refuse when ANY user matches lower(email).
- I-8 delivery: copy link shown once; no e-mail, SMS or notification.
- I-9 link origin: new CUSTOMER_PUBLIC_ORIGIN (https in production); create refuses when unset or invalid; never
  derived from the request.
- I-10 company-name collision: warn, operator confirms. I-11 display reference INV- + 8 hex, display only.
- R-5 activation: new flag PLATFORM_INVITATIONS_ENABLED, default off; enabled only on loopback test databases.
- P-5 initial package: the published default Trial version only (PO-02D1B seed); cycle `trial`.

### 2. AUTHORIZATION
Permitted: development on feat/platform-owner; disposable loopback *_test_only_* databases seeded through
`npm run platform:db:seed`; fictional data; tests; commits and push to the development branch only.
Prohibited: production Neon or Hostinger VPS access; any production database change, migration, db:push or seed;
merge, deployment or PR changes; the public acceptance endpoint or page (PO-02D3); any orgs or users row; any change
to /register, customer login, MFA or sessions; e-mail, SMS or notifications; paid packages or prices; subscription
assignment; tenant-access enforcement changes; enabling any flag outside disposable test runs; dependency upgrades;
starting PO-02D3.

### 3. BASELINE VERIFICATION
GitHub state (main, branch head, PR #11 draft). Re-run verify:static, verify:platform (16 suites, including
verify:platform-onboarding-seed), the browser suites and the login-race suite on the unmodified head.
Confirm the PO-02D1B seed applies (created ×3) and re-applies (verified ×3) on a disposable database.

### 4. SCOPE
Platform-side create, revoke and re-issue of company invitations in the Companies section, the one-time copy link,
and their audit. The PO-02B pending-invitations read model stays the list (never a link or token).

### 5. AUTHORIZATION CHAIN (the PO-02C order)
Flags (PLATFORM_CONSOLE_ENABLED and PLATFORM_INVITATIONS_ENABLED exactly "true") → configuration (platform secrets,
CUSTOMER_PUBLIC_ORIGIN; otherwise CONFIG_ERROR, nothing written) → live platform session from the platform cookie only
→ permission platform.companies.invite → PO-01B console-action core (trusted client IP, same origin) → step-up
(throttle and password outside the transaction; TOTP consumed inside it, replay-safe).

### 6. VALIDATION (server-side; DB CHECKs are the backstop)
Company name 1–200 trimmed; industry optional 1–100; company and owner e-mails lower(btrim()), ≤ 320, PO-02A shape;
country from COUNTRIES exactly as /register stores it; currency passes isValidCurrencyCode and ^[A-Z]{3}$; owner name
1–200; package = the published default Trial version, cycle trial.

### 7. TOKEN AND LINK
crypto.randomBytes(32), base64url (43 chars). Store only sha256(token) as 64 lower-case hex. Never log, audit, cache,
return from a read model or show twice the token, its hash or the link.
Link: ${CUSTOMER_PUBLIC_ORIGIN}/register/accept#t=${token} (fragment only).

### 8. TRANSACTIONS (READ COMMITTED, explicit; lock order: platform_admins row → invitation row(s) FOR UPDATE → inserts)
Create: consume TOTP → lock the e-mail's pending slot (unexpired → CONFLICT with its reference; expired → revoke +
audit "expired; superseded") → refuse EMAIL_CONFLICT if any user matches → insert the invitation (72 h default) →
insert organization_invitation_terms naming the published Trial version → audit invitation.created (allow-listed
metadata only) → COMMIT → return { reference, link } once.
Revoke: consume TOTP → lock the row → accepted → refuse; already revoked → refuse with no second audit → set revoked_at /
revoked_by → audit invitation.revoked with the reason → COMMIT.
Re-issue: consume TOTP → lock the old row (unaccepted, unrevoked; expired allowed) → revoke it ("re-issued as INV-…")
→ re-check users → insert the new invitation and its terms → audit invitation.reissued { from, to } → COMMIT → link once.
Any failure leaves nothing; an audit outage returns AUDIT_UNAVAILABLE with nothing applied.

### 9. UI (accepted Platform Owner design system only)
Create, revoke and re-issue dialogs in the Companies section; success panel "Shown once — copy it now" with a copy
button; closing discards the link from memory; no "show again". EN LTR and native Saudi Arabic RTL; numbers and dates
LTR; light and dark; 1440/1280/1024/820/390/360; keyboard and focus; no clipped actions.

### 10. TESTS — implement verify:platform-invitations (+ a browser suite)
D2-01 … D2-15 of PO02D0_DECISIONS.md §J.2 (implement against the contract in its §H):
- token entropy;
- hash-only storage (full-database text search finds neither token nor link);
- link only in the creating response;
- origin rules and Host-spoofing;
- authorization refusals;
- step-up and throttle;
- duplicates, including 20 concurrent creates → exactly 1;
- EMAIL_CONFLICT, exact and case-variant;
- field validation;
- revoke, including concurrent revokes → one;
- re-issue: the old token is never valid; a fault after the revoke → nothing changed;
- audit atomicity and outage;
- the per-operator rate limit;
- UI in EN and AR, the link gone from the DOM after close;
- no e-mail or outbound call.
Real PostgreSQL, deterministic barriers, no mocks for constraints or transactions.

### 11. REGRESSION
TypeScript; scoped ESLint vs baseline; verify:static (22 suites); full verify:platform; the PO-02A lock, PO-02D1A,
release-preflight, onboarding-seed, PO-02C and PO-02C.1 login-race suites; all Platform Owner browser suites;
customer access-control and crypto tests; ACC-01; approved-delta and tamper verifiers; Next.js build with test-only
settings (report compile and gate separately; never bypass the gate; no upgrade).

### 12. CHANGE CONTROL
A PO-02D2 approved-delta layer for any frozen file; no silent rebaselining; the PO-02D1B seed, the PO-02A fix and the
preflight untouched; no customer authentication, session or business change.

### 13. HANDOVER
docs/platform-owner/PO02D2_DEVELOPMENT.md: completion; branch and SHA; changed files; decisions applied; authorization
chain; token/link evidence; transaction and race evidence; audit evidence; UI evidence (EN/AR, light/dark, viewports);
test counts; ERP regression; blockers and decisions; a proposed PO-02D3 acceptance prompt, not executed.

### 14. GIT
Reviewable batches; push only feat/platform-owner; no force-push, merge, deployment or PR changes.

### STOP GATE
STOP after PO-02D2. Do not implement acceptance. Do not send any invitation outside disposable tests. Do not create
customer companies or users. Do not modify production. Do not enable flags outside disposable test runs. Await explicit
owner review. The live Elite ERP must remain unchanged.
~~~
