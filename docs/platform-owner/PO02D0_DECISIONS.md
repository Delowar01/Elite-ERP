# Platform Owner PO-02D0 — Invitation onboarding: reconciliation, decisions and implementation readiness

> **Status: planning and documentation only.** PO-02D0 did not change application code, schema, migrations, `/register`,
> feature flags, production data or production configuration. It created no package, subscription, user or invitation
> outside disposable `*_test_only_*` databases, and it sent nothing to anyone.
>
> **Every recommendation in this document is PROVISIONAL.** Each is a proposal for owner review, not an owner-approved
> decision. Where a value is not given by the specifications (Trial seats, storage, module labels; all paid prices and
> seats), none is proposed.

| | |
|---|---|
| Repository / branch | `Delowar01/Elite-ERP` · `feat/platform-owner` |
| Starting head (approved PO-02C.1) | `2a6aca29d56b55e2daaee55f4de67b18218dab58` |
| Live ERP (`main`) | `621f156f7b129b9c2e289bc46d314ce7587beec2` |
| PR #11 | draft, unmerged; not opened, closed or edited by this phase |
| Specifications reconciled | the six Stage 2 documents of PR #11 at `357e93e`: `Plan.md`, `Schema.md`, `TRD.md`, `PRD.md`, `appflow.md`, `UI_spec.md` |
| Earlier phase reports reconciled | PO-00 (§F.4–F.6, §I.2), PO-02A (§5–6), PO-02B, PO-02C, PO-02C.1 (§10–11) |
| Artifacts of this phase | `po02d0/sql/`: read-only audit and drift SQL, plus fictional fixtures<br>`po02d0/evidence/`: their outputs on disposable DBs<br>`po02d0/proposal/`: unexecuted, guarded PO-02D1 SQL |

Decision identifiers used throughout:

- **T-** Trial package
- **P-** paid packages
- **O-** primary ownership
- **R-** registration
- **I-** invitation controls
- **A-** acceptance
- **U-** the `users` key
- **S-** settings

The owner's existing decisions keep their PO-00 numbers, **D-1 … D-10**.

---

## A. Completion and baseline verification

### A.1 Repository state (verified at the start of PO-02D0 and again before the push — §M)

| Check | Expected | Observed |
|---|---|---|
| `main` | `621f156` (accepted production baseline) | `621f156` ✓ |
| `feat/platform-owner`, local and remote | `2a6aca2` (approved PO-02C.1) | `2a6aca2` ✓ |
| PR #11 | draft, unmerged | draft, unmerged ✓ |
| Working tree before PO-02D0 | clean | clean ✓ |
| PO-02C.1 handover | read | §10 (PO-02D prerequisite gaps) and §11 (open decisions) are the starting point of this document ✓ |

### A.2 Regression on the unmodified `2a6aca2` tree

Run by the PO-02D0 runner against loopback `*_test_only_*` databases on a private cluster (127.0.0.1, disposable).

| Suite | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| ESLint (`src tests scripts verify`) | 28 pre-existing problems (7 errors, 21 warnings), the same count PO-02C.1 recorded |
| `verify:static`: 22 suites, every one passed | role-matrix 32<br>confirm-policy 62<br>dirty-form 66<br>skeletons 90<br>contrast 187<br>typography 43<br>status-registry 90<br>shell 87<br>controls 110<br>datatable 69<br>document-form 86<br>edit-action 59<br>store-model 69<br>provider-harness 302<br>backup-claims 26<br>money-precision 12<br>number-locale 29<br>date-timezone 38<br>business-dates 44<br>ledger-only-balances 8<br>page-archetypes 295<br>lcp-design 77 |
| ACC-01 finance regression | inventory costing 171 passed / 0 failed<br>project cost control 50/50 |
| Security | access-control 22/22<br>crypto-policy 18/18<br>platform boundary 104/104 |
| Platform server suites | proxy 59/59<br>schema 54/54<br>auth 136/136<br>bootstrap 54/54<br>console 108/108<br>containment 87/87<br>company-schema 107/107<br>migration-safety 91/91<br>companies 190/190<br>company-access 116/116 |
| `next build` | compiled; 70/70 static pages |
| Browser (Playwright Chromium) | platform-browser 138/138<br>companies-browser 111/111<br>company-access-browser 64/64 |
| PO-02C.1 concurrency | `verify:platform-login-race` 51/51 |
| UI guardrails | report-only (exit 0 by design): G1 24, G2 244, G3 8, G4 0, G5 22 call sites / 21 keys |

### A.3 Approved-delta and freeze baselines (preserved, not modified)

- **Containment §7.** These checks passed:
  - "no tenant session, authentication, app-route, layout or UI-component file differs from the live ERP (621f156) except
    by PO-02C's and PO-02C.1's recorded changes";
  - "src/proxy.ts differs from the live ERP only by the PO-01B edge-gate import and /platform delegation".
- **Layers.** The PO-02C.1 approved-delta layer (`verify/po02c1-approved-delta.mts`, 8 files, 36 hunks) is part of those
  checks. The PO-01B, PO-01B.1, PO-02A, PO-02B and PO-02C layers are unchanged.
- **No new layer.** PO-02D0 changes no frozen file, so it adds no approved-delta layer.
- **Stop conditions.** None was triggered: there was no unexpected source, schema or security change.

### A.4 What PO-02D0 delivered

| Step | Deliverable |
|---|---|
| 2 Baseline | §A |
| 3 Reconciliation | §B; exact structures in §C |
| 4 Decision matrix | §D; provisional defaults in §E |
| 5 Legacy audit | `po02d0/sql/01…`, `02…`, `03…`, evidence in `po02d0/evidence/`, plan in §F |
| 6 Proposed D1 SQL | `po02d0/proposal/` (5 SQL files + README), summary in §G |
| 7 D2 / D3 contracts | §H, §I (lock order compatible with PO-02C.1) |
| 8 What stays unchanged | §E.2 |
| 9 Test specifications | §J (none run, none claimed passing) |
| 10 This document | sections A–M |
| 11 Commit and push | `feat/platform-owner` only — §M |

**PO-02D0 is complete and stops here.** PO-02D1 needs explicit owner approval of the decisions in §D (at least the
subset listed in §L) and of the prompt in §L.

---

## B. Reconciliation of the six specifications with current code

### B.1 What the code provides today (facts, `2a6aca2`)

**Company records (PO-02A).**

- `organization_invitations` has 17 columns:
  - hashed token only (`token_hash` CHECK `^[0-9a-f]{64}$`);
  - lower-cased, trimmed e-mails;
  - expiry default `now() + 72 h`, at most 30 days;
  - terminal states mutually exclusive;
  - accepted ⇔ `accepted_org_id`, which is UNIQUE when set;
  - `accepted_at` must fall inside `[created_at, expires_at]`;
  - revocation attributed to an operator;
  - one "slot" per owner e-mail (partial unique index on *unaccepted and unrevoked*).

  `drizzle/platform/PO02A_company_foundation.sql:289-317`, `src/db/schema/platform-companies.ts:77-140`.
- `tenant_access_controls`: one row per company. A missing row means *active*, through the audited compatibility path.
  An `active` row may be unattributed: `changed_at` and `changed_by_platform_admin_id` both NULL.
  `PO02A_company_foundation.sql:253-260`.

**Platform audit and errors.**

- Platform audit: `recordPlatformAudit(input, executor)` accepts a transaction (`src/lib/platform/audit.ts:78`). The
  actor may be NULL with a required `actor_label`. Append-only triggers apply, and
  `assertPlatformAuditProtection()` fails closed.
- The typed operator errors INVITE_EXPIRED, INVITE_USED and EMAIL_CONFLICT already exist, with EN/AR messages
  (`src/lib/platform/errors.ts:30-32`).

**Permissions and step-up.**

- There are 5 platform permissions and none covers invitations (`src/lib/platform/guards.ts:22`).
- The PO-02C step-up runs in this order (`src/lib/platform/company-access-actions.ts:146-204`):
  1. durable throttle;
  2. password, checked outside the transaction;
  3. inside the transaction, `consumeTotpCode`. Its `UPDATE platform_admins` takes the row's FOR NO KEY UPDATE lock
     (`src/lib/platform/mfa.ts:63`). The recovery-code path selects the admin row FOR UPDATE instead (`mfa.ts:96`);
  4. target lock;
  5. change;
  6. audit.

**Live `/register`** (`src/app/(auth)/actions.ts:233-278`). In order:

1. Validates the required fields, the country (`COUNTRIES` names), the currency (`isValidCurrencyCode`) and
   `validatePassword(password, DEFAULT_POLICY)`.
2. Pre-checks `users.email` by exact match.
3. Hashes the password with bcrypt.
4. **One transaction:**
   - `orgs` insert (name, country, currency, `baseCurrencyConfirmedAt`);
   - owner `users` insert (`role: "owner"`);
   - `seedOrgDefaults(tx, orgId, country)`.
5. **After the commit,** `recordAudit('org.registered')` and `recordSecurityEvent('account.created')`.
6. `issueSession` → `/dashboard`.

It has no rate limit, enrols no MFA, and writes no platform row.

**Reusable pieces and gaps.**

- `seedOrgDefaults(tx, orgId, country)` is already transaction-scoped and reusable (`src/lib/seed-org.ts:27`).
- `recordAudit` has **no executor parameter**: it writes through the autocommit `db` (`src/lib/security/audit.ts:16`).
  `recordSecurityEvent` gained an optional executor in PO-02C.1.
- The customer login limiter is in memory, per process, at 5 attempts per 15 min per key (`src/lib/rate-limit.ts:11-12`).

**Routing.**

- `AUTH_ROUTES = ["/login", "/register"]` is prefix-matched (`src/proxy.ts:7,49,54`), so a page at `/register/accept`
  renders without a token and needs **no proxy change**.
- The `(auth)` layout redirects any usable customer session to `/dashboard` (`src/app/(auth)/layout.tsx:18-19`).

**Configuration and display.**

- No canonical public-origin setting exists. The only origin variable, `PDF_RENDER_ORIGIN`, falls back to the request
  origin (`src/app/api/document-pdf/[type]/[id]/route.ts:75`).
- The invitation display reference is `INV-` plus the first 8 hex digits of the uuid (`src/lib/platform/companies.ts:117-119`).
  That is a 32-bit display prefix: safe to show, never a lookup key.

**Owner fields and deletion.**

- `orgs` has optional `industry` and `email` columns, which `/register` leaves NULL.
- No org or user delete path was found in `src/`. Only test scripts delete their own fixture rows.

### B.2 Requirement-by-requirement reconciliation

| # | Requirement (source) | Code today | Gap → resolution (decision) |
|---|---|---|---|
| 1 | A pending invitation is not an `orgs` row; no org until acceptance (appflow §4; TRD §5) | `organization_invitations` holds metadata only | none — kept |
| 2 | Invitation carries initial package version and cycle (Schema §5.1) | the two columns were deferred by PO-02A | F8 `organization_invitation_terms` (**I-1**) |
| 3 | Raw tokens never stored; shown once; secure random; single use (TRD §5; Schema §12) | DB enforces hash shape; no issuance code | D2 contract §H.4 |
| 4 | 72 h default expiry (Schema §5.1; TRD §5; PRD P-04) | column default 72 h; CHECK ≤ 30 days | fixed 72 h in D2 (**I-4**) |
| 5 | One current usable invitation per owner e-mail (Schema §5.1) | partial unique index on *unaccepted and unrevoked*; an expired, unrevoked row keeps the slot | D2 revokes an expired slot holder in the same transaction and refuses an unexpired one (**I-5**) |
| 6 | Re-issue revokes the old token and inserts a new row (Schema §5.1; appflow §4) | no code | D2 contract §H.7 |
| 7 | Acceptance in ONE transaction: lock invitation, unique e-mail, org, owner, seed, primary owner, access row, initial subscription, accepted mark, audit (TRD §5) | `/register` transaction covers org + owner + seed only; its audit is written after commit | D3 contract §I (**A-4** for customer audit atomicity) |
| 8 | Reuse the register/seed service; no second inconsistent bootstrap (appflow §4) | seed shared; the two inserts are inline in `registerAction` | shared `bootstrapOrganization(tx, …)` (**R-4**) |
| 9 | Password chosen only by the recipient (TRD §5) | `/register` policy and bcrypt | reused (**A-1**) |
| 10 | "Complete MFA if required by existing customer policy" (appflow §4 J) | customers are never forced to enrol at sign-in; `mfa_required_for_privileged` only stops owners/admins disabling MFA | **A-2** |
| 11 | "Customer signs in to existing ERP" (appflow §4 M) | `/register` signs in automatically | **A-3** |
| 12 | Access row written atomically for a new company (Schema §4.1) | table exists | D3 inserts `active`, unattributed |
| 13 | One primary owner; composite FK; no guessed legacy owner (Schema §4.2; TRD §6) | no `tenant_primary_owners`; no `users(org_id, id)` key | F1 + F5 (**U-1**, **O-1 … O-5**) |
| 14 | Minimum Trial package/version and current-subscription schema in PO-02 (Plan PO-02) | none | F3, F4, F6, F7 + approval-gated seed (**T-1 … T-9**) |
| 15 | Events append-only; idempotent retries (Schema §7.2) | none | F7 with `platform_reject_mutation` and a unique request index |
| 16 | Settings singleton with locked Stage 2 values (Schema §9; PRD P-09) | none | F2 without `invite_only` (**R-3**); no default for trial days (**T-1**) |
| 17 | Subscription dates in the platform business timezone (TRD §7.2; Schema §7.1/§9) | none | Asia/Riyadh (**S-1**; conflict B.3-1) |
| 18 | Seat enforcement only after audit and grandfathering (TRD §6; PRD §2.2) | not enforced | seats are snapshotted only; enforcement is PO-03 |
| 19 | Typed errors without leaking account existence (TRD §10) | operator messages exist | public mapping §I.7 (**A-5**) |
| 20 | `/register` invite-only at the approved cutover (TRD §5; Schema §10, §11.8; appflow §4) | public | unchanged until **D-3** (**R-1**, **R-2**) |
| 21 | Copy-link delivery; no e-mail provider (PRD §6; TRD §5) | none | copy-link only (**I-8**) |
| 22 | Rate-limit invitations and critical mutations (TRD §10) | customer limiter in memory; platform step-up throttle durable | **I-6**, **A-6** |
| 23 | Audit with actor, reason, request id; no secrets (PRD P-08) | platform audit supports transactions | D2/D3 audit inside the transaction; tokens, hashes and links never audited |
| 24 | Acceptance route allow-listed in the proxy (PO-02A §6.4) | prefix match already passes `/register/accept` | no proxy change (**A-7**) |

### B.3 Conflicts between documents (each needs an owner ruling)

1. **Date basis.**
   - appflow §8.2: `new_end = max(existing_end, current UTC date) + …`.
   - TRD §7.2, Schema §7.1 and §9: dates are business dates in **Asia/Riyadh**.
   - Recommended: Asia/Riyadh (**S-1**). Between 21:00 and 24:00 UTC, the Riyadh date is already the next day.
2. **`invite_only` "on and locked".**
   - Schema §9 and PRD P-09 say it is on and locked.
   - `/register` stays public until D-3 (TRD §5; Schema §11.8: "Invite-only toggle is last, at cutover").
   - A stored `true` would be a false statement, so it is omitted until the cutover (**R-3**).
3. **Two trial lengths.** Settings `default_trial_days` (Schema §9) and Trial version `trial_days` (Schema §6.2) both
   exist. Recommended: the published version's value governs; the setting only pre-fills new Trial versions (**T-5**).
4. **Phase assignment.**
   - PO-00 §F.4 places M5 (`users` key + primary owners) in PO-03, M7 (packages) in PO-04, M8 (settings) in PO-04/06 and
     M9 (subscriptions) in PO-05.
   - Plan PO-02 requires "initial `tenant_primary_owners` mapping" and the "minimum Trial package/version and
     current-subscription schema" in PO-02.
   - PO-02D1 follows the Plan with minimum objects only. PO-03/04/05 add their operations to the same tables.
5. **Duplicate invitation.** PO-02A §6.4 says "revoke any pending row for the e-mail in the same transaction".
   Recommended here: refuse while an *unexpired* invitation is pending; the operator revokes or re-issues explicitly
   (**I-5**). The alternative silently kills a link that may be in use.
6. **Proxy.** PO-02A §6.4 expects an allow-list entry. The code shows none is needed for `/register/accept` (**A-7**).
7. **Column names.**
   - PO-00 §F.4 M9 uses `starts_on` / `ends_on`; Schema §7.1 uses `start_date` / `end_date`. The proposal uses Schema's.
   - Schema §7.2 `bigserial` → `bigint GENERATED ALWAYS AS IDENTITY`: the same type and range, but an id cannot be
     supplied by mistake.
8. **Attribution.** Schema §7.1/§7.2 give the creator / actor as an operator FK, but an acceptance has no operator in its
   transaction.
   - The proposal makes those FKs nullable.
   - It adds `tenant_subscriptions.assignment_source`. A CHECK requires an operator unless the source is
     `invitation_acceptance`.
   - It adds `subscription_events.actor_label` (as in `platform_audit_events`). A CHECK allows an actor-less event only
     for `assigned` / `invitee`.
   - Reason: the lock-order rule in §I.5.

---

## C. Missing schema objects and dependency order

Every object below is **proposed, not created**. The exact DDL is in
`po02d0/proposal/PO02D1_onboarding_foundation.proposal.sql`. All FKs are explicitly named (≤ 63 characters) and use
`ON DELETE RESTRICT`. Money is `numeric(14,2)` SAR. Business dates are `date`; timestamps are `timestamptz`.

### C.1 `users (org_id, id)` uniqueness — F1 `users_org_id_id_uq` (decision **U-1**)

- **What.** `CREATE UNIQUE INDEX users_org_id_id_uq ON public.users USING btree (org_id, id)`. This is the only change to
  an existing customer table.
- **Why.** PostgreSQL accepts a plain, non-partial unique index as an FK target, so no constraint and no ACCESS
  EXCLUSIVE `ALTER TABLE` is needed. `id` is the primary key, so the index can never reject a row (L13: 0 duplicates).
- **Migration risk.** A plain build holds SHARE on `users` and blocks every write (sign-in `last_login_at`,
  registration, team changes) for the whole build. Production therefore builds it with `CREATE UNIQUE INDEX
  CONCURRENTLY` first (SHARE UPDATE EXCLUSIVE; reads and writes continue). The foundation file then only *verifies* it.
  An interrupted concurrent build leaves an INVALID index; the runbook refuses to continue over it and prints the
  recovery.
- **Drizzle.** The index must be declared in `src/db/schema/users.ts` (a frozen file: an approved-delta hunk).
  Otherwise a later `drizzle-kit push` would try to drop an index that an FK depends on.

### C.2 `platform_settings` — F2 (Schema §9; PRD P-09)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | smallint | no | 1 |
| `default_trial_days` | integer | no | **none** (T-1) |
| `grace_days` | integer | no | 0 |
| `expiry_alerts_enabled` | boolean | no | true |
| `manual_billing` | boolean | no | true |
| `platform_mfa_required` | boolean | no | true |
| `platform_currency` | char(3) | no | `'SAR'` |
| `platform_timezone` | text | no | `'Asia/Riyadh'` |
| `updated_by_platform_admin_id` | uuid | yes | — |
| `updated_at` | timestamptz | no | `now()` |

- **Keys and FKs.** PK `id`; FK `updated_by → platform_admins`.
- **CHECKs.**
  - `id = 1` (singleton);
  - trial days 1–120;
  - grace 0–60;
  - `manual_billing AND platform_mfa_required` (locked true);
  - currency = `SAR`;
  - timezone = `Asia/Riyadh`.
- **Not created.** `invite_only` (R-3).
- **Risk.** None to existing data: a new table with no rows until the approved seed.

### C.3 `subscription_packages` — F3 (Schema §6.1)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `code` | text | no | — |
| `name` | text | no | — |
| `description` | text | yes | — |
| `status` | text | no | `'draft'` |
| `is_trial` | boolean | no | false |
| `is_default_trial` | boolean | no | false |
| `created_by_platform_admin_id` | uuid | yes | — |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |

- **Keys.** PK `id`. UNIQUE `(id, is_trial)` is the target that lets versions carry `is_trial` declaratively.
- **FKs.** `created_by → platform_admins`.
- **CHECKs.**
  - code `^[a-z][a-z0-9-]{1,39}$`;
  - name and description trimmed, with length limits;
  - status ∈ draft / active / archived;
  - a default trial is a trial and never archived;
  - an operator is required unless it is the default trial (system-seeded).
- **Indexes.**
  - unique `code`;
  - unique `lower(name)` (the case-folded name of Schema §6.1);
  - unique `(is_default_trial) WHERE is_default_trial` (at most one default Trial).
- **Risk.** None to existing data.

### C.4 `subscription_package_versions` — F4 (Schema §6.2)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `package_id` | uuid | no | — |
| `is_trial` | boolean | no | — |
| `version_number` | integer | no | — |
| `publish_state` | text | no | `'draft'` |
| `currency_code` | char(3) | no | `'SAR'` |
| `monthly_price`, `annual_price` | numeric(14,2) | no | — |
| `included_seats` | integer | no | — |
| `storage_allowance_gb` | integer | no | — |
| `module_groups` | jsonb | no | `'[]'` |
| `trial_days` | integer | no | 0 |
| `published_at` | timestamptz | yes | — |
| `created_by_platform_admin_id` | uuid | yes | — |
| `created_at` | timestamptz | no | `now()` |

- **Keys.**
  - PK `id`;
  - UNIQUE `(package_id, version_number)`;
  - UNIQUE `(id, publish_state, is_trial)`: the target that lets references require a *published* version.
- **FKs.** `(package_id, is_trial) → subscription_packages (id, is_trial)`; `created_by → platform_admins`.
- **CHECKs.**
  - version > 0;
  - state ∈ draft / published;
  - published ⇔ `published_at`;
  - currency = SAR;
  - prices ≥ 0;
  - seats ≥ 1;
  - storage ≥ 1;
  - `module_groups` is a JSON array of strings;
  - Trial ⇒ 1–120 days and both prices 0; paid ⇒ 0 days;
  - an operator is required unless it is a Trial version.
- **Triggers.**
  - `subscription_package_versions_guard` (BEFORE UPDATE OR DELETE): a published row cannot be updated or deleted;
    identity and provenance can never change; a draft may be edited or deleted.
  - `…_no_truncate`.
- **Risk.** None to existing data.

### C.5 `tenant_primary_owners` — F5 (Schema §4.2)

| Column | Type | Null | Default |
|---|---|---|---|
| `org_id` | integer | no | — |
| `user_id` | integer | no | — |
| `assigned_at` | timestamptz | no | `now()` |
| `assigned_by_platform_admin_id` | uuid | yes | — |

These are exactly the specification's columns.

- **Keys.** PK `org_id` (one per company); UNIQUE `user_id`.
- **FKs.**
  - `org_id → orgs`;
  - composite `(org_id, user_id) → users (org_id, id)` through F1, so a cross-company owner is impossible
    (PO-00 P2);
  - `assigned_by → platform_admins`.
- **Triggers.**
  - `tenant_primary_owners_guard` (BEFORE INSERT/UPDATE/DELETE): the user must be an **active `owner` of the same
    company**; DELETE is refused (a mapping is transferred, never deleted).
  - `…_no_truncate`.
- **Migration risk.**
  - Creating the composite FK takes SHARE ROW EXCLUSIVE on `users` until COMMIT (§G.7).
  - Keeping the mapped user from being demoted or disabled through the existing team screen is deferred (**O-3**).
  - Legacy companies get no row (**O-2**).
- **PO-02D1 review item.** The guard reads `users` without a row lock. A `FOR SHARE` lookup would also stop a
  concurrent disable during the mapping's own transaction. The post-commit gap is O-3 either way.

### C.6 `tenant_subscriptions` — F6 (Schema §7.1)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` |
| `org_id` | integer | no | — |
| `package_version_id` | uuid | no | — |
| `version_state` | text | no | `'published'` |
| `is_trial` | boolean | no | — |
| `cycle` | text | no | — |
| `lifecycle_state` | text | no | — |
| `start_date`, `end_date` | date | no | — |
| `superseded_at` | timestamptz | yes | — |
| `price_snapshot_sar` | numeric(14,2) | no | — |
| `seats_snapshot` | integer | no | — |
| `storage_snapshot_gb` | integer | no | — |
| `module_groups_snapshot` | jsonb | no | — |
| `manual_note` | text | yes | — |
| `assignment_source` | text | no | — |
| `created_by_platform_admin_id` | uuid | yes | — |
| `created_at`, `updated_at` | timestamptz | no | `now()` |

- **Keys.** PK `id`; UNIQUE `(id, org_id)`, the target for events.
- **FKs.**
  - `org_id → orgs`;
  - `(package_version_id, version_state, is_trial) → versions (id, publish_state, is_trial)`: published versions only,
    Trial-ness carried;
  - `created_by → platform_admins`.
- **CHECKs.**
  - `version_state = 'published'`;
  - cycle ∈ trial / monthly / annual;
  - Trial ⇔ `trial` cycle;
  - lifecycle ∈ trialing / active / paused / cancelled;
  - `trialing` only on a Trial; `active` only on a paid cycle;
  - `end_date ≥ start_date`;
  - Trial price 0;
  - seats and storage > 0;
  - modules is an array;
  - note trimmed;
  - source ∈ `invitation_acceptance` / `platform_assignment`;
  - an operator is required unless the source is `invitation_acceptance`.
- **Indexes.**
  - unique `(org_id) WHERE superseded_at IS NULL`: one current subscription per company;
  - `(end_date, lifecycle_state) WHERE superseded_at IS NULL`: alerts;
  - `(package_version_id, superseded_at)`.
- **Triggers.**
  - `tenant_subscriptions_guard`: DELETE is refused; a superseded row is frozen; snapshots, identity, source and
    provenance are immutable; only `end_date`, `lifecycle_state`, `superseded_at`, `manual_note` and `updated_at` may
    change.
  - `…_no_truncate`.
- **Not stored.** "Expired" is derived from the dates (Schema §7.1). No column or trigger ties subscription state to
  `tenant_access_controls`: there is no automatic suspension.

### C.7 `subscription_events` — F7 (Schema §7.2)

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | no | `GENERATED ALWAYS AS IDENTITY` |
| `tenant_subscription_id` | uuid | no | — |
| `org_id` | integer | no | — |
| `event_type` | text | no | — |
| `actor_platform_admin_id` | uuid | yes | — |
| `actor_label` | text | no | — |
| `before_safe`, `after_safe` | jsonb | yes | — |
| `reason` | text | yes | — |
| `request_id` | uuid | yes | — |
| `created_at` | timestamptz | no | `now()` |

- **FKs.**
  - `(tenant_subscription_id, org_id) → tenant_subscriptions (id, org_id)`: an event can only belong to its
    subscription's company;
  - `org_id → orgs`;
  - `actor → platform_admins`.
- **CHECKs.**
  - type ∈ assigned / renewed / paused / resumed / superseded / cancelled / terms_updated;
  - actor label 1–200 characters, and an operator is required unless the event is `assigned` with label `invitee`;
  - snapshots are JSON objects;
  - reason trimmed.
- **Indexes.**
  - unique `(tenant_subscription_id, request_id, event_type) WHERE request_id IS NOT NULL` (idempotent retries);
  - `(tenant_subscription_id, created_at DESC)`;
  - `(org_id, created_at DESC)`.
- **Triggers.** `subscription_events_immutable` (UPDATE/DELETE) and `…_no_truncate`, both through PO-01A's
  `platform_reject_mutation()`.

### C.8 The deferred invitation package version and cycle — F8 `organization_invitation_terms` (decision **I-1**)

| Column | Type | Null | Default |
|---|---|---|---|
| `invitation_id` | uuid | no | — |
| `initial_package_version_id` | uuid | no | — |
| `initial_version_state` | text | no | `'published'` |
| `initial_is_trial` | boolean | no | — |
| `initial_cycle` | text | no | — |
| `created_at` | timestamptz | no | `now()` |

- **Keys and FKs.**
  - PK and FK `invitation_id → organization_invitations` (1:1);
  - `(initial_package_version_id, initial_version_state, initial_is_trial) → versions (id, publish_state, is_trial)`.
- **CHECKs.** State = published; cycle ∈ trial / monthly / annual and consistent with Trial-ness.
- **Index.** `(initial_package_version_id)`.
- **Triggers.** Immutable and no-truncate (`platform_reject_mutation`).
- **Why a table rather than two columns on `organization_invitations`.** PO-02A's table and its retry-safe shape check
  stay exactly as reviewed, so `PO02A_company_foundation.sql` stays re-runnable. No frozen PO-02A schema file changes,
  and no `ALTER TABLE` is needed on a table that may already hold rows.
- **The alternative (I-1 option b).** `ALTER TABLE organization_invitations ADD COLUMN …`. It needs an empty-table guard
  or a NOT NULL backfill rule, an update of PO-02A's expected shape, and an approved-delta hunk in
  `platform-companies.ts`.
- **Consequence for D3.** An invitation without terms (none can exist after D2) is refused.

### C.9 Dependency order (creation; rollback is the exact reverse)

~~~text
existing:  orgs · users · platform_admins · platform_reject_mutation()      (tenant / PO-01A)
           organization_invitations · tenant_access_controls · platform_audit_events  (PO-02A / PO-01A)

F1  users_org_id_id_uq                ← users                 (production: CONCURRENTLY, before the transaction)
fn  subscription_package_version_guard()                      (no dependency)
fn  tenant_primary_owner_guard()      ← reads public.users
fn  tenant_subscription_guard()                               (no dependency)
F2  platform_settings                 ← platform_admins
F3  subscription_packages             ← platform_admins
F4  subscription_package_versions     ← F3 · platform_admins · fn version guard · platform_reject_mutation
F5  tenant_primary_owners             ← orgs · users(F1) · platform_admins · fn owner guard · platform_reject_mutation
F6  tenant_subscriptions              ← orgs · F4 · platform_admins · fn subscription guard · platform_reject_mutation
F7  subscription_events               ← F6 · orgs · platform_admins · platform_reject_mutation
F8  organization_invitation_terms     ← organization_invitations · F4 · platform_reject_mutation
seed (approval-gated)                 ← F2 · F3 · F4 · platform_audit_events
~~~

### C.10 Deliberately not in PO-02D1

| Object | Phase |
|---|---|
| `user_invitations` | PO-03 |
| `subscription_payments` | PO-05 |
| `invite_only` | D-3 cutover |
| Users-side primary-owner protection | PO-03 (O-3) |
| A `lower(email)` unique index on `users` | a later decision after D-7 (I-7) |
| Any paid package, version or subscription | D-1 |
| Any row for a legacy company | O-2, R-2 |

---

## D. Product decisions requiring owner approval

Every **Recommended** entry below is **PROVISIONAL**: a proposal, not an approval. "Approval" names who decides and
what it gates.

### D.1 Trial package (T)

| ID | Decision | Options | Recommended (provisional) | Consequences | Approval |
|---|---|---|---|---|---|
| T-1 | Trial length, in days: Trial v1 `trial_days` and settings `default_trial_days` | (a) **14**, the specifications' *proposal* (PRD §2.1 P-09, Schema §9)<br>(b) another value from 1 to 120 | none by default; the owner states the value. 14 is only the specification's proposal. The DB column has **no default** and the seed is invalid SQL until a value is approved | fixes every Trial created through invitations until a new published version; never changes an existing subscription | owner, before PO-02D1 seeds |
| T-2 | Trial included seats | an integer ≥ 1 (Schema CHECK) | **no proposed value** (none in any specification) | snapshotted at acceptance; *displayed* until PO-03 enforces seats; a small value later limits invitation-created companies only | owner, before the seed |
| T-3 | Trial storage allowance (GB) | an integer ≥ 1 | **no proposed value** | display only: "Configured — not enforced yet" (PRD §2.2) | owner, before the seed |
| T-4 | Trial module-group labels | (a) an explicit list of existing ERP groups<br>(b) the empty list, shown as "no restriction configured" | **no proposed value** | display only; never hides an ERP feature (PRD §2.2) | owner, before the seed |
| T-5 | Which value governs a trial's length | (a) the **published Trial version's `trial_days`**<br>(b) settings `default_trial_days` read at acceptance | (a); the setting only pre-fills new Trial versions (PO-04/06) | published terms stay immutable and reproducible; a settings change never alters a pending invitation or a current subscription (Schema §9) | owner |
| T-6 | Trial price snapshot | SAR 0.00 monthly and annual; `price_snapshot_sar = 0` | confirm (Schema §7.1: "Trial = 0") | no money is implied; MRR excludes Trials | owner (confirmation) |
| T-7 | Auto-assign the Trial at onboarding | (a) every accepted invitation creates the Trial named in its terms<br>(b) no subscription at acceptance | (a), per Plan PO-02 and TRD §5. **Never** for legacy or `/register` companies (Schema §11.7) | each invitation-created company has exactly one current subscription from its first day | owner |
| T-8 | End-date convention | (a) **inclusive**: `end = start + days − 1`<br>(b) exclusive: `end = start + days` | (a). Expired is derived when `end_date < platform today`. A 14-day Trial then covers 14 business dates | customer-visible term length; drift check R06 encodes it | owner |
| T-9 | Trial identity | code `trial`, stored name `Trial`, localized by the UI (Arabic label from the dictionary) | as stated | one canonical, never-archived Trial (Schema §6.1) | owner (confirmation) |

### D.2 Paid packages (P)

| ID | Decision | Options | Recommended (provisional) | Consequences | Approval |
|---|---|---|---|---|---|
| P-1 | Starter / Growth / Business | create now vs in PO-04 | **not created in PO-02D1–D3**; PO-04 creates operator drafts on the same tables | the names are kept available: `code`/`name` unique, no seeds | owner |
| P-2 | Prices | D-1 | **no values**. The prototype's SAR 149 / 349 / 799 are fictional and never used | paid versions remain unpublished drafts | owner (D-1) |
| P-3 | Paid seats, storage and modules | D-1 | **no values** | as P-2 | owner (D-1) |
| P-4 | Payable subscriptions | allow vs forbid until D-1 | **forbid**: no code path in PO-02D creates a paid subscription; F8 terms can only name a *published* version, and none exists | no invoices, payments or MRR from onboarding | owner (D-1) |
| P-5 | Initial package offered by an invitation | Trial only vs Trial or paid | **Trial only** until a paid version is published under D-1; the schema already allows monthly / annual | no schema change needed later | owner |
| P-6 | Allowed module-group label catalogue | PO-04 | defer; D1 validates only "array of strings" | labels are not enforced anywhere | owner (PO-04) |

### D.3 Primary ownership (O)

| ID | Decision | Options | Recommended (provisional) | Consequences | Approval |
|---|---|---|---|---|---|
| O-1 | Exactly one primary owner per *invitation-created* company | DB-enforced vs service only | **DB-enforced**: F5 (PK `org_id`, UNIQUE `user_id`, composite FK via F1, guard trigger) | a cross-company or inactive primary owner cannot be written | owner (with U-1) |
| O-2 | Legacy companies (PO-00 classes A–F)<br>A: exactly one active owner<br>B: one active owner plus disabled ones, a candidate only under a strict reading (PO-00 §F.5)<br>C–F: several or none | (a) **no mapping for any class** until an owner-approved PO-03 process per class<br>(b) automatic class-A (and B) backfill after D-7 | (a). Never auto-select; any A/B backfill would be its own approved step, with D-7 counts in hand | legacy companies have no primary-owner row; the platform UI must show "not designated" | owner (D-7, then PO-03) |
| O-3 | Protect the mapped owner from demotion or disable via the existing team screen | (a) PO-03 service checks + messages<br>(b) a `users` trigger now | (a). A trigger now would turn the existing team action into a 500 | until PO-03, drift check R02 detects a mapped owner who is no longer an active owner | owner |
| O-4 | `/register` companies during the transition | mapping vs none | **none** (with R-2) | as legacy | owner |
| O-5 | Non-canonical role values (e.g. `Owner`; L02) | normalize vs report | **report only**; never treated as owner | no customer row is edited | owner |

### D.4 Registration (R) — development behaviour vs production activation

| ID | Decision | Options | Recommended (provisional) | Consequences | Approval |
|---|---|---|---|---|---|
| R-1 | `/register` until cutover | keep public vs restrict now | **keep public and unchanged** until D-3 | no customer-visible change | owner (D-3) |
| R-2 | Foundation rows for transition-period `/register` companies | (a) **none**: legacy-shaped<br>(b) `/register` also writes access, owner and Trial rows<br>(c) a later backfill | (a). (b) changes `/register` and would invent a Trial for self-registration | they stay "no subscription / not designated" (grandfathered: Schema §11.7); access resolves active through the compatibility rule | owner |
| R-3 | `invite_only` setting | (a) **omit until cutover**<br>(b) store `false`<br>(c) store `true` (spec) | (a). The column arrives with the cutover change that enforces it | no stored claim contradicts behaviour | owner (D-3) |
| R-4 | Shared bootstrap (appflow §4) | (a) extract `bootstrapOrganization(tx, …)` and switch `registerAction` to it (one behaviour-preserving approved-delta hunk)<br>(b) D3 duplicates the inserts<br>(c) extract and leave `/register` unchanged, with an equivalence test | (a) if the owner approves that hunk, else (c); never (b) | (a) gives one bootstrap path, proven by the registration regression; (c) temporarily gives two code paths held equal by a test | owner (it touches `/register` code) |
| R-5 | Activation | flags default off vs on | D2 and D3 behind **default-off** flags (`PLATFORM_INVITATIONS_ENABLED`, `CUSTOMER_INVITE_ACCEPTANCE_ENABLED`); enabled only on loopback test DBs during development | deploying code ≠ activating onboarding; production activation is a separate decision after D-6 | owner |

### D.5 Invitation controls (I)

| ID | Decision | Options | Recommended (provisional) | Consequences | Approval |
|---|---|---|---|---|---|
| I-1 | Where the initial terms live | (a) **F8 1:1 table**<br>(b) two columns on `organization_invitations` | (a) (§C.8) | PO-02A untouched | owner |
| I-2 | Permission | (a) new `platform.companies.invite`<br>(b) reuse `manage_access` | (a) | separate audit meaning; ready for future roles (PRD excludes multiple roles today) | owner |
| I-3 | Step-up | password + fresh TOTP (as PO-02C) for create and re-issue; fresh TOTP + reason for revoke | as stated | a stolen console session alone cannot mint a link | owner |
| I-4 | Expiry | fixed 72 h vs operator-chosen | **fixed 72 h** (spec default; DB allows ≤ 30 days) | an expired link needs a re-issue | owner |
| I-5 | Duplicate pending invitation for an e-mail | (a) **refuse while unexpired**, naming the pending `INV-…`<br>(b) silently replace | (a); an *expired* slot holder is revoked in the same transaction, attributed and audited | no link dies without an explicit operator action | owner |
| I-6 | Rate limits / anti-abuse | values | provisional **20 creates or re-issues per operator per hour**, plus the existing durable step-up throttle | bounds damage from a compromised session | owner |
| I-7 | E-mail handling | exact vs case-insensitive | normalize `lower(btrim())`; refuse when **any** user matches `lower(email)` (covers legacy case variants, L08). A `lower(email)` unique index is a separate later decision once D-7 shows L08 = 0 | no second account differing only by case | owner (index: D-7) |
| I-8 | Delivery | copy link vs e-mail | **copy link shown once**; no e-mail, SMS or notification | the operator delivers it out of band | owner |
| I-9 | Link origin | request Host vs configured | new `CUSTOMER_PUBLIC_ORIGIN` (https in production); create refuses when it is unset or invalid; never derived from the request | the console host may differ from the customer host; there is no Host-header injection | owner |
| I-10 | Company-name collision with an existing org (L09) | warn vs block | **warn** (`orgs.name` is not unique) | the operator confirms | owner |
| I-11 | Display reference | keep `INV-` + 8 hex vs longer | keep for display; never a lookup key | collisions only affect display | owner |

### D.6 Acceptance (A)

| ID | Decision | Options | Recommended (provisional) | Consequences | Approval |
|---|---|---|---|---|---|
| A-1 | Password | `/register` policy | chosen by the recipient; `validatePassword(…, DEFAULT_POLICY)`; hashed **before** the transaction | the platform never sees or sends it | owner (confirmation) |
| A-2 | MFA for the new owner | (a) **as `/register`**: no forced enrolment; MFA can be enabled later in the ERP<br>(b) mandatory enrolment before the first session | (a), consistent with "if required by existing customer policy" (appflow §4). (b) is a new customer flow for a later phase | L11 measures real MFA enrolment among active owners under D-7 (the fixture run only proves the query); (b) raises assurance at a UX cost | owner |
| A-3 | After commit | (a) **redirect to `/login`** with a success notice<br>(b) automatic sign-in via PO-02C.1 `issueSession` | (a): one session path, which keeps throttle, access gate and MFA | (a) adds one sign-in; (b) issues a session only after commit | owner |
| A-4 | Customer audit atomicity | (a) `recordAudit` gains an optional executor (additive, same pattern as PO-02C.1's `recordSecurityEvent`; approved-delta hunk)<br>(b) write after commit, as `/register` does | (a) | the platform audit is in the transaction either way; (a) makes `org.registered` and `account.created` atomic too | owner |
| A-5 | Public error disclosure | (a) expired distinct; everything else neutral<br>(b) all neutral | (a) | no account-existence signal (§I.7) | owner |
| A-6 | Public rate limit | values | provisional **10 attempts per client IP per 15 min**, checked before any hashing; in memory, like customer login (multi-instance caveat documented) | protects bcrypt CPU and the database | owner |
| A-7 | Page placement | (a) `/register/accept` inside `(auth)`<br>(b) its own route group | (a): no proxy change. A visitor with a live customer session is redirected to `/dashboard` by the layout | to accept, a signed-in customer signs out first | owner |
| A-8 | What the invitee may change | (a) **password only**; company, country, currency, owner name and e-mail come from the invitation, and industry and company e-mail are carried into `orgs.industry` / `orgs.email`<br>(b) also edit company metadata | (a). Everything else is editable later inside the ERP; the platform never overwrites tenant fields afterwards | the operator-validated metadata is what gets created | owner |

### D.7 Users key (U) and settings (S)

| ID | Decision | Options | Recommended (provisional) | Consequences | Approval |
|---|---|---|---|---|---|
| U-1 | Additive unique index `users(org_id, id)` on a customer table | (a) **index**, built CONCURRENTLY in production, declared in `users.ts`<br>(b) trigger-only tenant match | (a) (Schema §4.2: "a simple single-column FK alone is insufficient") | no row, column or code path of `users` changes | owner (customer table) |
| S-1 | Business-date basis | **Asia/Riyadh** vs UTC (conflict B.3-1) | Asia/Riyadh | dates near midnight UTC differ by one day | owner |
| S-2 | `grace_days` initial value | spec: 0 | 0 (confirm) | alerts only | owner |
| S-3 | `expiry_alerts_enabled` initial value | spec: true | true (confirm) | no automatic suspension either way | owner |
| S-4 | Seed `platform_settings` in D1 | (a) with approved T-1/S-2/S-3 values<br>(b) defer to PO-06 | (a): D1 needs no setting at runtime, but one consistent row avoids later drift | the settings UI arrives in PO-06 | owner |

---

## E. Recommended defaults — PROVISIONAL, not approved

### E.1 Defaults

| Area | Provisional default | If not approved |
|---|---|---|
| Trial length | owner value; **14 days is only the specification's proposal** | the seed cannot run (deliberately invalid SQL) |
| Trial seats / storage / modules | **none proposed** | the seed cannot run |
| Trial price | SAR 0.00 / 0.00 | — |
| Trial governance | the published version's `trial_days`; inclusive end date; Asia/Riyadh | — |
| Paid packages | none; drafts only after D-1 | onboarding stays Trial-only |
| Primary owner | DB-enforced for new companies; legacy untouched | no `tenant_primary_owners` table; D3 cannot meet Schema §4.2 |
| `users(org_id, id)` | concurrent unique index | composite FK impossible; a weaker trigger-only design |
| `/register` | unchanged and public until D-3; its companies stay legacy-shaped | — |
| `invite_only` | not stored until cutover | — |
| Invitation | `platform.companies.invite`; password + TOTP; 72 h; refuse duplicate unexpired; copy link once; canonical origin | D2 not implementable |
| Acceptance | password only; MFA as `/register`; redirect to sign-in; one transaction including audits; neutral errors except "expired" | — |
| Activation | flags default off; production activation separate | — |
| Rate limits | 20/h per operator; 10 per 15 min per IP | — |

### E.2 Must stay unchanged through PO-02D1–D3 (constraints, not decisions)

- **Customer sign-in and registration.** Live customer login and `/register` (except R-4(a), if separately approved:
  a behaviour-identical refactor).
- **Customer ERP domains.** Accounting and the ledger; sales and purchasing; inventory; HR and payroll; invoices, PDFs,
  print and exports.
- **Sessions.** Customer sessions, their tokens and their validation (PO-02C/PO-02C.1 paths untouched; D3 issues
  sessions only through them).
- **Existing data.** Every existing `orgs` and `users` row, including role, status, MFA and `last_login_at`. No legacy
  company gets an access, owner or subscription row without its own approval.
- **Platform Owner visual design** (PO-01B/PO-02B/PO-02C components and tokens).
- **Production.** Environment configuration, Neon, VPS and feature flags.
- **Not authorized here.** The future invitation-only cutover of `/register` (D-3); any automatic suspension from
  subscription expiry; any automatic change to existing customer pricing or financial records.

---

## F. Legacy company audit plan

### F.1 Files

| File | Role | Writes? |
|---|---|---|
| `po02d0/sql/01_legacy_audit_fixtures_fictional.sql` | fictional fixtures: orgs 9101–9110, users 9201–9215, sessions, audit rows, one inactive fixture operator, access rows, 7 invitations | **only** into a database whose name contains `_test_only_`; otherwise prints `REFUSED` and quits |
| `po02d0/sql/02_legacy_onboarding_audit_readonly.sql` | the audit, L00–L14 | never: `BEGIN TRANSACTION READ ONLY` … `ROLLBACK`; refuses unless `transaction_read_only = on`; `statement_timeout` 15 s, `lock_timeout` 2 s |
| `po02d0/sql/03_post_acceptance_drift_readonly.sql` | post-D1/D3 invariants, R01–R06; skips with a note until the D1 objects exist | never (read-only transaction) |
| `po02d0/evidence/*.out` | outputs on the two disposable shapes | — |

The audit extends PO-00's `po00/sql/02_readonly_baseline_queries.sql`, which remains the D-7 baseline set. It outputs
only counts, numeric ids, role values and `INV-…` references: no e-mail, name, hash, token or reason text.

### F.2 What each query measures, and the decision it feeds

| Query | Measures | Feeds |
|---|---|---|
| L00 | server version; which Platform Owner objects exist | shape, D-6 |
| L01 | orgs, users, active / inactive users | sizing |
| L02 | role values, flagging non-canonical ones (`users.role` is free text) | O-5 |
| L03 | PO-00 owner classes A–F per org. The query labels only A as a backfill candidate; B qualifies only under a strict reading and needs confirmation (PO-00 §F.5) | O-2 |
| L04 | disabled owner accounts; orgs whose only owners are disabled | O-2 |
| L05 | inconsistent org / user relationships: sessions (all and live), security events and audit rows whose org differs from their user's org | O-2, isolation |
| L06 | orgs without an access row, explicit active, suspended, invalid (skipped with a note if the table is absent) | R-2, D3 |
| L07 | orgs registered through public `/register` (`audit_logs` `org.registered`), and per month | R-1, R-2, D-3 |
| L08 | case-insensitive e-mail collision groups among users | I-7 |
| L09 | invitation states (pending, expired-holding-slot, revoked, accepted); owner e-mails already used by a user; company names equal to an org; accepted invitations without an active owner (skipped if absent) | I-5, I-7, I-10 |
| L10 | users per org (max, p50, p95, active + disabled) | T-2 input, not a value |
| L11 | MFA enrolment among active canonical owners | A-2 |
| L12 | name collisions with the proposed D1 objects (expect 0) | D1 preconditions |
| L13 | `users(org_id, id)` duplicates (expect 0) and `users` size | U-1, CIC sizing |
| L14 | PO-02A prerequisite indexes present and valid | D1 preconditions |

### F.3 Proof on fictional fixtures (both shapes; outputs committed under `po02d0/evidence/`)

**Branch shape** (PO-01A + PO-02A installed). Every result equals what the fixtures were built to contain:

| Query | Result |
|---|---|
| L01 | 10 orgs / 15 users / 13 active / 2 inactive |
| L02 | `Owner` 1 (non-canonical), `admin` 2, `owner` 9, `staff` 3 |
| L03 | A {9101, 9108, 9109, 9110} · B {9102} · C {9103} · D {9104} · E {9105} · F {9106, 9107} (9107 holds the non-canonical `Owner`) |
| L04 | 2 disabled owner accounts in {9102, 9104}; only-disabled {9104} |
| L05 | 1 / 1 / 1 / 1 (the deliberate mismatches) |
| L06 | 8 without a row, 1 explicit active, 1 suspended, 0 invalid |
| L07 | 3 registered, 7 without a record; 2026-11: 3 |
| L08 | 1 group {9214, 9215} (`Dup.Case@…` / `dup.case@…`) |
| L09 | pending 4, expired-holding-slot 1, revoked 1, accepted 1<br>owner e-mail already a user: 2 {INV-B0D00002, INV-B0D00003}<br>company name equals an org: 1 {INV-B0D00006}<br>accepted without an active owner: 0 |
| L10 | 10 orgs; max 3, p50 1, p95 3 |
| L11 | 7 active canonical owners, 1 with MFA |
| L12 | 0 rows |
| L13 | 15 rows, 0 duplicate pairs, 48 kB |
| L14 | the 4 PO-02A indexes valid |

**Production-like shape** (the 621f156 tenant schema; no Platform Owner objects):

- L00: every Platform Owner object reports `f`.
- L06: "not installed: every organization is a legacy row-less company, active by the compatibility rule" (10).
- L09: "not installed: no invitation exists".
- L12 and L14: 0 rows.
- The tenant queries report the same counts as on the branch shape.

**Safety evidence.**

- **Data unchanged.** Whole-database data checksums (every public table, rows ordered) were equal before and after
  the audit and drift runs: full `cc2de2df307725fc2281823844f7f67c`, production-like `5bd92aaa7f87141287cc98b715aaa481`.
- **Fixture refusal.** Loaded into a database *without* `_test_only_` in its name, the fixture file printed 1
  `REFUSED` line and created 0 tables.
- **Drift script.** Both shapes report "(PO-02D1 objects are not installed: nothing to check yet)".
- **Clean-up.** All the databases were dropped after the run.

### F.4 How a later, owner-approved D-7 measurement can validate these conditions without changing data

**Not executed. Production Neon was not accessed in PO-02D0.**

1. **Authorization names everything.** It names:
   - the target;
   - the operator and the time window;
   - the exact files, by commit SHA: `po00/sql/02_readonly_baseline_queries.sql` and
     `po02d0/sql/02_legacy_onboarding_audit_readonly.sql`;
   - where the output goes.

   **Never** the fixtures file (it refuses anyway) and **never** the proposal files.
2. **Preferred target: a Neon branch created from production for the measurement and deleted afterwards.** It is
   copy-on-write, isolated from production traffic, and its results equal production at branch time. Creating the
   branch is itself an operation in the production account and belongs in the same approval. The alternative is the
   production database through a read-only credential.
3. **Read-only by the server, not only by the script.**
   - Use a role with `default_transaction_read_only = on` and SELECT-only grants on the tables read: `orgs`, `users`,
     `sessions`, `audit_logs`, `security_events`, and the platform tables where they exist.
   - Creating such a role is a production change and is part of the approval. If it is not approved, an existing
     read-only credential plus `PGOPTIONS='-c default_transaction_read_only=on'` is the minimum.
   - The script then *proves* the mode: it refuses unless `transaction_read_only = on`.
4. **Bounded impact.**
   - `statement_timeout` 15 s and `lock_timeout` 2 s: the script never waits behind application locks; on a timeout
     it simply ends.
   - Plain SELECTs take only ACCESS SHARE.
   - Run outside business hours.
   - `psql -X -v ON_ERROR_STOP=1 -f …`, with the connection string from a service file or `PGPASSFILE`, never on the
     command line or in shell history.
5. **Output handling.**
   - Results contain production ids and counts. They stay **out of git** and in an owner-controlled location.
   - The handover reports aggregates only.
   - Raw output is deleted once the decisions are made.
6. **No corrective action.**
   - The results inform O-2 (classes), O-5 (role values), I-7 (L08 = 0 before any `lower(email)` index), U-1 (L13
     size, and whether the concurrent build is needed) and R-2 (L07 rate).
   - Any backfill or repair is a separate, owner-approved phase with its own backup.

### F.5 After D1 / D3: drift detection (`03_post_acceptance_drift_readonly.sql`)

| Check | Expect | Meaning of a row |
|---|---|---|
| R01 | 0 each | an accepted invitation whose company lacks an active access row, primary owner, current subscription or `assigned` event |
| R02 | 0 | a primary owner who is no longer an active canonical `owner` of the company (the O-3 gap) |
| R03 | 0 | a current subscription whose snapshot differs from its published version |
| R04 | 0 | an invitation without terms |
| R05 | 0 | an accepted company without its seeded chart of accounts |
| R06 | 0 | a Trial whose `end_date ≠ start_date + trial_days − 1` (T-8) |

PO-02D1 folds R01–R06 and the verification checks V01–V06 into `npm run platform:db:check` (read-only, the PO-01A /
PO-02A convention).

---

## G. Proposed PO-02D1 schema and SQL summary

### G.1 Files (`po02d0/proposal/`; guarded; outside `drizzle/`, `drizzle/platform/` and the drizzle-kit journal)

| File | Proposed role |
|---|---|
| `PO02D1_users_org_id_id_concurrently.proposal.sql` | production runbook for F1: `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS`, autocommit, statement by statement; pre-checks (table, PK, no INVALID or different index) and post-checks (valid, ready, unique, exact definition) |
| `PO02D1_onboarding_foundation.proposal.sql` | F1 (verify or create), three guard functions, F2–F8: ONE transaction, retry-safe and shape-checked |
| `PO02D1_seed_trial_and_settings.proposal.sql` | template: the settings row, the default Trial package and its version 1 (published, SAR 0/0), and one platform audit record. Invalid SQL until the `<<APPROVED:…>>` tokens are replaced |
| `PO02D1_verify_readonly.proposal.sql` | read-only V01–V06: objects exist; F1 exact; 10 triggers enabled; 3 functions; seed facts; PO-02A's invitations table still 17 columns |
| `PO02D1_rollback.proposal.sql` | removes only the D1 objects; refuses while any onboarding row exists |

### G.2 Migration order (production runbook, after D-6 and D-7; proposal only)

1. Application release that does **not** use the D1 objects (or keeps them behind default-off flags).
2. Backup, with restore evidence (PO-07).
3. `PO02D1_users_org_id_id_concurrently.sql`, autocommit.
4. `PO02D1_onboarding_foundation.sql`. It verifies F1 and creates the rest in one transaction.
5. `PO02D1_seed.sql`, with the owner-approved values.
6. `platform:db:check` (V01–V06, R01–R06).
7. Smoke tests.
8. Record the applied files in the applied-file ledger (PO-07, needs approval).

On disposable databases, step 3 may be skipped: the foundation builds F1 with a plain `CREATE UNIQUE INDEX` (fast on
tiny tables).

### G.3 Foreign-key dependencies

See §C.9.

- **Inbound references.** No existing table gains an FK to a new table.
- **Outbound.** New tables reference `orgs`, `users` (composite, through F1), `platform_admins` and
  `organization_invitations`, all `ON DELETE RESTRICT`.
- **Consequence.** A plain `DELETE FROM orgs` of a company with onboarding rows is refused. This is intended
  (Schema §12). The ERP has no org-delete path, and the test scripts that delete their own fixture orgs create no
  onboarding rows.

### G.4 Transactions

| Unit | Transaction |
|---|---|
| Foundation | ONE transaction (`BEGIN` … `COMMIT`); any failure leaves nothing behind |
| Concurrent index | autocommit (it cannot run in a transaction block) |
| Seed | one transaction |
| Rollback | one transaction (its F1 drop is replaced by `DROP INDEX CONCURRENTLY` in production) |

The guard `RAISE` sits *inside* each writing file's transaction, under `\set ON_ERROR_STOP on`. Even a client that
ignores errors is left in an aborted transaction, and the final COMMIT rolls back.

### G.5 Constraints and immutability

| Enforced by the database | Enforced by services (D2/D3/PO-04+) |
|---|---|
| single default Trial; Trial never archived; Trial terms (free, 1–120 days) | which published version an invitation may name (Trial only until D-1: P-5) |
| published version immutable and undeletable (guard trigger) | publishing workflow, version numbering (PO-04) |
| references only to *published* versions (constant-column composite FKs) | seat enforcement (PO-03) |
| one current subscription per company; snapshots immutable; history frozen; no delete | renewal and supersede logic (PO-05) |
| primary owner = active `owner` of the same company at every write; no delete | protection against demotion or disable via the team screen (PO-03: O-3) |
| events, terms and seeding records append-only; TRUNCATE refused on every new table | — |
| settings singleton with locked values | settings UI (PO-06) |

Services must also **assert at start-up** that the guard and append-only triggers exist and are enabled, failing closed
as `assertPlatformAuditProtection()` does. A missing trigger must never mean a silently weaker invariant.

### G.6 Additive changes to customer tables

- **Only F1:** one index on `users`. No column, constraint, trigger, row or default of any existing table is added,
  changed or removed.
- `orgs`, `users` and `organization_invitations` gain only *referencing* FKs from new tables.
- No tenant business table (accounting, sales, purchasing, inventory, HR, documents) is touched.

### G.7 Locking and rewrites

- **No table rewrite.** There is no `ALTER TABLE` on any existing table.
- **New foreign keys take SHARE ROW EXCLUSIVE** on `orgs`, `users`, `platform_admins` and `organization_invitations`
  until COMMIT.
  - Writes to those tables wait for the migration's milliseconds. Examples: a sign-in's `users.last_login_at` update,
    a registration, team changes, an operator step-up.
  - Reads and row locks (`FOR SHARE` / `FOR NO KEY UPDATE` from sign-ins and suspensions, KEY SHARE from FK checks) do
    not conflict.
  - Even a *verify-only* re-run takes these locks, because the scratch reference schema creates the same FKs, so
    re-runs belong in the same window.
  - `lock_timeout` 5 s and `statement_timeout` 120 s bound the queueing behind a long transaction: the run aborts and
    nothing changes.
- **F1 build.**
  - `CONCURRENTLY` takes SHARE UPDATE EXCLUSIVE: reads and writes continue. There are two table scans and the build
    waits for older transactions.
  - A plain build takes SHARE and blocks writes for the duration. Disposable databases only.
- **Production timing** is measured under D-7 / PO-07 (L13 gives the size).

### G.8 Compatibility with the existing migration mismatch

- **The facts (PO-00 §F.2, PO-02A §5).**
  - The committed journal (0000–0004) builds 59 tables against the schema's 67 tenant tables.
  - Production is push-shaped.
  - `db:preflight` reports INCONSISTENT.
  - `drizzle-kit push` re-creates 8 long-named customer FKs on every run and installs no triggers.
- **PO-02D1 therefore:**
  - keeps its SQL outside the journal (mechanism B, as PO-01A and PO-02A) in `drizzle/platform/PO02D1_*.sql`, applied
    by `platform:db:apply`, which refuses every target that is not a loopback `*_test_only_*` database;
  - never runs `drizzle-kit generate`, which would bundle the unrelated drift, or `drizzle-kit migrate`;
  - adds Drizzle declarations for F2–F8 in a new `src/db/schema/platform-onboarding.ts`, exported from `index.ts`, and
    the F1 index in `users.ts`, so a later push sees no difference for them. Trigger functions and triggers are
    invisible to drizzle-kit, so push leaves them in place.

  PO-02D1 must **prove** this on a push-built disposable database: apply D1, run push, and show that no statement
  touches a D1 object and that every trigger is still present and enabled.
- All D1 FK names are explicit and ≤ 63 characters, so push never re-creates them.
- `db:harden` is unaffected.
- `db:preflight` stays INCONSISTENT (pre-existing). The baseline reconciliation (D-6 option A) remains its own stage.

### G.9 Rollback and recovery

1. **Application first.** No running release may read the D1 objects.
2. **Then the rollback file.** It refuses, changing nothing, while `tenant_primary_owners`, `tenant_subscriptions`,
   `subscription_events` or `organization_invitation_terms` holds a row. It also refuses while the catalog holds
   anything beyond the seeded Trial v1.
3. **What it removes and keeps.**
   - It writes one audit record (`package.trial_seed_rolled_back`).
   - It drops the tables in reverse dependency order, then the three functions, then F1. In production F1 is dropped
     `CONCURRENTLY`, after the transaction.
   - The append-only seeding and rollback audit records remain as evidence.
4. **Data-bearing rollback** (onboarding history exists) is never routine. It needs its own owner-approved plan with a
   backup, typically a restore.
5. **Failures.**
   - A failed foundation leaves nothing (one transaction). Fix the cause and re-run.
   - An interrupted concurrent build leaves an INVALID index. The runbook prints `DROP INDEX CONCURRENTLY` and the
     re-run.
   - A failed seed leaves nothing.

### G.10 Idempotency and drift detection

- **Foundation.** Each object is built from the exact DDL into a private scratch schema (`po02d1_reference`) and
  compared:
  - absent → **created** from the same DDL;
  - same shape → **verified**, untouched;
  - any difference → **abort**, naming every difference.

  Functions are compared by language, result type, volatility, security, configuration and source.
- **Seed.** Absent → inserted. Equal to the approved values → verified. Different → abort. A published version is
  immutable in any case.
- **Drift.** The verify file (V01–V06) checks catalog drift: missing objects, F1 definition, disabled triggers. The
  drift file (R01–R06) checks data invariants.

### G.11 Isolated test requirements (for PO-02D1)

- **Databases.** A loopback cluster only. Names contain `_test_only_`. Fictional data only. No network.
- **Shapes.**
  - an empty database;
  - the branch shape;
  - the production-like 621f156 tenant shape plus PO-01A/PO-02A;
  - a push-built shape.
- **Every run records:**
  - whole-database checksums of pre-existing tables, before and after;
  - lock observations with concurrent sessions;
  - refusal probes.
- The test list is §J (D1-01 … D1-21).

### G.12 Validation status of the proposal SQL (stated plainly)

- **The four writing files were never executed.** Their guards would refuse anyway.
- **No SQL parser validated them.**
  - Schema execution was not authorized in PO-02D0.
  - Installing a parser (`pip install pglast`) was refused by this environment's permission policy.
  - No parser exists in `node_modules`.
- **The read-only verify file ran once.** It ran on a disposable branch-shape database, created and dropped for the
  purpose: V01 listed all 8 objects as `f`, V02–V05 were skipped, and V06 was `ok t` (17 columns), ending in ROLLBACK.
- **The proposal may contain syntax or semantic errors.** PO-02D1's first task is to prove every file on disposable
  databases (D1-01 … D1-04) before anything depends on it.

---

## H. PO-02D2 invitation administration contract (proposal; not implemented)

### H.1 Scope

**In scope:** platform-side **create, revoke and re-issue** of company invitations, the one-time copy link, and the
audit, in the Companies section.

**Out of scope:**

- the public acceptance endpoint (D3);
- e-mail, SMS or any notification;
- any `orgs` or `users` row;
- any change to `/register`.

### H.2 Authorization chain (the PO-02C order)

1. Feature flags: `PLATFORM_CONSOLE_ENABLED` and the new `PLATFORM_INVITATIONS_ENABLED`, both exactly `"true"`, default
   off (R-5).
2. Configuration: the platform secrets and the new `CUSTOMER_PUBLIC_ORIGIN`. If the origin is missing, not https in
   production, or carries a path or query → `CONFIG_ERROR`, and nothing is written (I-9).
3. A live platform session from the platform cookie only. A customer token is never read.
4. Permission `platform.companies.invite` (I-2).
5. The PO-01B console-action core: trusted client IP and same-origin check.
6. Step-up (I-3):
   - durable throttle, then password, both outside the transaction;
   - then the TOTP code, consumed inside the transaction (replay-safe).

   Revoke needs a fresh TOTP and a reason; create and re-issue need password + TOTP.

### H.3 Validation (server-side; the DB CHECKs are the backstop)

- **Company.** Name 1–200 characters, trimmed. Industry optional, 1–100 characters.
- **E-mails.** Company e-mail and owner e-mail are each normalized to `lower(btrim())`, ≤ 320 characters, with the
  PO-02A shape.
- **Locale fields.**
  - Country ∈ `COUNTRIES` names, exactly as `/register` stores them.
  - Currency passes `isValidCurrencyCode` and `^[A-Z]{3}$`.
- **Owner name.** 1–200 characters.
- **Package.** The initial package version is the published default Trial version (P-5). The cycle is `trial`.

### H.4 Token and link

- **Token.** `crypto.randomBytes(32)`, base64url-encoded (43 characters, 256 bits).
- **Stored.** Only `sha256(token)` as 64 lower-case hex (`token_hash`).
- **Never.** The token, its hash or the link is never logged, audited, cached, returned by any read model, or shown a
  second time.
- **Link.** `${CUSTOMER_PUBLIC_ORIGIN}/register/accept#t=${token}`. The token travels in the **fragment**: browsers do
  not send it in requests, so it reaches no access log, proxy or `Referer`.
- **Acceptance page.**
  - It moves the token into the POST body of its form and removes it from the address bar (`history.replaceState`).
  - It sends `Referrer-Policy: no-referrer`.

### H.5 Create (one transaction, READ COMMITTED explicitly)

1. `consumeTotpCode(tx, adminId, code, now)` — UPDATE of the operator's row (its FOR NO KEY UPDATE lock); replay → MFA
   failure, rollback.
2. `SELECT … FROM organization_invitations WHERE owner_email_normalized = $1 AND accepted_at IS NULL AND revoked_at IS
   NULL FOR UPDATE`. This finds the slot holder; there is at most one, by the partial unique index.
   - **Unexpired** (`expires_at > now()`) → refuse `CONFLICT` with its `INV-…` reference (I-5). Nothing is written.
   - **Expired** → set `revoked_at = now()`, `revoked_by_platform_admin_id = admin`, `updated_at = now()`, and audit
     `invitation.revoked` with the reason "expired; superseded".
3. `SELECT 1 FROM users WHERE lower(email) = $1 LIMIT 1` → `EMAIL_CONFLICT` (operator-facing; I-7). This is a
   sequential scan of `users`, negligible at the measured size.
4. `INSERT organization_invitations (…, token_hash, invited_by_platform_admin_id)`. `expires_at` comes from the column
   default (`now() + 72 h`).
   - A 23505 on the pending-e-mail index (a concurrent create) → `CONFLICT`.
   - A 23505 on the token index → internal error and rollback (astronomically unlikely).
5. `INSERT organization_invitation_terms (invitation_id, initial_package_version_id, initial_is_trial, initial_cycle)`.
   The FK proves the version is published and of matching Trial-ness.
6. `recordPlatformAudit({ action: 'invitation.created', entityType: 'organization_invitation', entityId: id, … }, tx)`.
   The audit holds only allow-listed metadata: reference, company name, country, currency, owner e-mail, package code
   and version, cycle, expiry.
7. COMMIT. Then return `{ reference, link }` **once**.

A double-click yields one invitation: the second request finds the first one's slot and is refused with its
reference. A failure at any step means nothing was written; an audit outage means `AUDIT_UNAVAILABLE` and nothing was
applied.

### H.6 Revoke (one transaction)

1. TOTP consume.
2. `SELECT … WHERE id = $1 FOR UPDATE`.
3. Check the state:
   - accepted → refuse (`INVITE_USED`, operator-facing);
   - already revoked → refuse, with no second audit;
   - otherwise (pending or expired) continue.
4. Set `revoked_at` and `revoked_by`.
5. Audit `invitation.revoked`, with the reason.
6. COMMIT.

### H.7 Re-issue (one transaction)

1. TOTP consume.
2. Lock the old row FOR UPDATE. It must be unaccepted and unrevoked (expired allowed).
3. Revoke it, with the audit reason "re-issued as INV-…".
4. Re-check the e-mail against `users`.
5. Insert the new invitation with the same metadata and a new token, plus its terms.
6. Audit `invitation.reissued` with `{ from, to }`.
7. COMMIT, then return the new link once.

The new row takes the slot that the revocation freed earlier in the same transaction. The old token can never be
accepted afterwards.

### H.8 One-time copy link (UI)

- **Where.** A success panel in the dialog, with a copy button and the text "Shown once — copy it now".
- **Lifetime.** Closing the dialog discards the link from memory. There is no "show again" action; re-issue instead.
- **Elsewhere.** The pending-invitations list (PO-02B read model) shows the reference, company, owner e-mail, expiry
  and state. It never shows the link or token.
- **Presentation.** EN LTR and native Saudi Arabic RTL; numbers and dates LTR; light and dark; mobile sheet.

### H.9 What D2 must never do

- send e-mail, SMS or notifications;
- store, log or audit a plaintext token or link;
- derive the origin from the request;
- create `orgs` or `users` rows;
- change `/register`;
- show a link twice;
- create a paid-package invitation before D-1.

### H.10 Lock order (D2)

`platform_admins` row (TOTP UPDATE) → `organization_invitations` row(s) FOR UPDATE → inserts.

The inserts take KEY SHARE through FKs: on the version row, and on the operator's own row, which the transaction
already holds.

---

## I. PO-02D3 acceptance transaction contract (proposal; not implemented)

### I.1 Placement

| Piece | Location |
|---|---|
| Page | `src/app/(auth)/register/accept/page.tsx` + form component |
| Server action | `src/app/(auth)/register/accept/actions.ts` (a `"use server"` file exporting async functions only) |
| Service | `src/lib/onboarding/accept-invitation.ts` |
| Shared bootstrap | `src/lib/onboarding/bootstrap-organization.ts` (R-4) |

- **Proxy.** `/register/accept` is covered by the existing `AUTH_ROUTES` prefix, so the proxy needs no change (A-7).
- **Flag.** `CUSTOMER_INVITE_ACCEPTANCE_ENABLED`, default off. When off, the page renders "not available" and the action
  refuses before any database access.

### I.2 Before the transaction (no writes, no locks)

1. Flag check.
2. Rate limit per trusted client IP (A-6), **before** any hashing → `RATE_LIMITED`, worded neutrally.
3. Token shape: base64url, 43 characters. Otherwise → the neutral "not valid" response.
4. Password: `validatePassword(password, DEFAULT_POLICY)` and confirmation match → field errors. These concern the
   password only, not account existence.
5. `tokenHash = sha256(token)`; `passwordHash = await hashPassword(password)`. bcrypt runs outside the transaction, so
   no lock is held while it works.
6. Assert that the D1 guard/append-only triggers and the platform audit protection are present (cached) → fail closed
   with "temporarily unavailable".

### I.3 The transaction

ONE transaction, READ COMMITTED explicitly, with a local `lock_timeout` (provisional 5 s).

| # | Statement | Locks / guarantees |
|---|---|---|
| 1 | `SELECT i.* FROM organization_invitations i WHERE i.token_hash = $1 FOR UPDATE` | **the only pre-existing row this transaction locks.** Concurrent acceptances, revokes and re-issues of the same invitation serialize here |
| 2 | Validate: `accepted_at IS NULL` (else INVITE_USED), `revoked_at IS NULL` (else revoked), `expires_at > now()` (else INVITE_EXPIRED) | `now()` is the transaction timestamp, the same value written as `accepted_at` in #12, so `acceptance_window_chk` holds |
| 3 | Load `organization_invitation_terms` and the published version | missing terms → refuse (internal) |
| 4 | `SELECT 1 FROM users WHERE lower(email) = owner_email_normalized LIMIT 1` | → EMAIL_CONFLICT (internal). A sequential scan of `users`, negligible at the measured size; an expression index belongs to decision I-7 |
| 5 | `bootstrapOrganization(tx, …)`: `INSERT orgs` (name, country, currency, `base_currency_confirmed_at = now()`, plus industry and company e-mail: A-8) | new row |
| 6 | … `INSERT users` (org, owner e-mail, password hash, owner name, `role = 'owner'`) | 23505 on `users_email_unique` (a concurrent registration) → EMAIL_CONFLICT |
| 7 | … `seedOrgDefaults(tx, orgId, country)` | the same seed as `/register` |
| 8 | `INSERT tenant_access_controls (org_id, access_status = 'active')` — unattributed | allowed by the PO-02A CHECKs |
| 9 | `INSERT tenant_primary_owners (org_id, user_id)` | guard: active owner of the same org; composite FK through F1 |
| 10 | `INSERT tenant_subscriptions … SELECT … FROM subscription_package_versions v WHERE v.id = $terms`:<br>`is_trial`, cycle `trial`, `trialing`<br>`start_date = (now() AT TIME ZONE 'Asia/Riyadh')::date`<br>`end_date = start_date + v.trial_days − 1`<br>price 0; seats, storage and modules from `v`<br>`assignment_source = 'invitation_acceptance'`, no operator | snapshot taken atomically from the published row (KEY SHARE); dates use the DB clock only (S-1, T-8) |
| 11 | `INSERT subscription_events ('assigned', actor NULL, actor_label 'invitee', after_safe {…}, request_id = invitation id)` | append-only; the unique request index makes it idempotent |
| 12 | `UPDATE organization_invitations SET accepted_at = now(), accepted_org_id = $org, updated_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL` | must affect 1 row, else abort. DB backstops: terminal CHECK, acceptance CHECK, `accepted_org_uq` |
| 13 | `recordPlatformAudit({ actorAdminId: null, actorLabel: 'invitee', action: 'invitation.accepted', entityType: 'organization_invitation', entityId, after: { reference, orgId, package, version, cycle, start, end } }, tx)` | in the transaction |
| 14 | `recordAudit({ orgId, userId, userName }, { action: 'org.registered', newValue: { …, source: 'invitation', invitation: 'INV-…' } }, tx)` and `recordSecurityEvent({ type: 'account.created', detail: 'organization owner (invitation)' }, tx)` | needs A-4(a). The same action names as `/register`, so tenant activity views stay uniform |
| 15 | COMMIT | — |

### I.4 After commit

- **A-3(a), recommended.** Redirect to `/login` with a success notice; the owner signs in through the normal
  `loginAction` (throttle, access gate, MFA if enabled).
- **A-3(b).** Call the PO-02C.1 `issueSession(userId, orgId)` (enforcement-on: org FOR SHARE, separate access read,
  `createSession(tx)`), then `setSessionCookie`.

Either way, a customer session exists **only after a successful commit**. A failure after commit (redirect, cookie)
leaves a complete company: the owner signs in normally.

### I.5 Lock order and compatibility with PO-02C.1

| Operation | Lock sequence |
|---|---|
| Customer sign-in, enforcement on (PO-02C.1) | existing `orgs` row FOR SHARE → access read → existing `users` row FOR NO KEY UPDATE → `sessions` insert (FK KEY SHARE) |
| Suspension / reactivation (PO-02C) | operator row (TOTP UPDATE) → existing `orgs` row FOR NO KEY UPDATE → access row FOR UPDATE → session revocation |
| D2 create / revoke / re-issue | operator row (TOTP UPDATE) → invitation row(s) FOR UPDATE → inserts |
| **D3 acceptance** | invitation row FOR UPDATE → **new** rows only (inserts take KEY SHARE on the new org and user and on the published version) → invitation UPDATE → audit inserts |

**Why this is deadlock-free and compatible:**

- **D3 never locks an existing `orgs` or `users` row.** It is disjoint from sign-ins and suspensions of other companies.
  The new company becomes visible to them only after commit.
- **D3 never locks a `platform_admins` row.** Every operator FK it writes is NULL.
  - D2 takes operator → invitation; D3 takes invitation and never the operator, so no cycle can form.
  - A TOTP step-up's UPDATE (FOR NO KEY UPDATE) would not block an FK's KEY SHARE anyway, but the recovery-code path
    takes FOR UPDATE (`mfa.ts:96`). The rule keeps the order acyclic by construction, not by lock strength.
- **The only row D2 and D3 share is the invitation row.** Both take FOR UPDATE: they serialize, with no deadlock.
- **Package versions receive KEY SHARE only.** PO-04's publish touches drafts, which nothing references.
- **D3 vs `/register` on the same e-mail.** The unique index makes the second insert wait for the first commit, then
  fail with 23505. D3 maps that to EMAIL_CONFLICT; `/register` keeps its current behaviour.
- **Proof.** PO-02D3 must re-run `verify:platform-login-race` (51 checks) and add acceptance races (§J D3-03, D3-05,
  D3-15).

### I.6 Safeguards

| Case | Guarantee |
|---|---|
| Double acceptance (double-click, two tabs, replay) | #1 serializes; the second sees `accepted_at` → neutral response; DB backstops (#12) |
| Acceptance vs revoke | whichever locks first wins. Revoke after accept → refused to the operator; accept after revoke → neutral |
| Acceptance vs re-issue | re-issue is atomic. The old token after it → neutral. If acceptance commits first, re-issue waits on the row lock, then refuses (the company exists) |
| E-mail collision | #4 pre-check plus the 23505 mapping; nothing is created; the invitation stays pending for the operator to resolve |
| Audit failure | platform audit inside the transaction → rollback, nothing created → "could not complete; nothing was created". Triggers are asserted before the transaction |
| Any statement failure | whole-transaction rollback; the invitation is unchanged (pending if unexpired); a retry is possible |
| Interrupted acceptance (disconnect, crash, timeout) | atomic: either committed (a retry gets the neutral response, then sign-in) or not (a retry works). No idle-in-transaction session remains |
| Partially completed request | impossible inside the database. After commit, only the redirect or cookie can fail |
| Concurrent registration | see the e-mail collision row and §I.5 |
| Expiry while waiting for #1 | validity uses the transaction timestamp. Waiting is bounded by `lock_timeout` (provisional 5 s); a timeout returns the "could not complete; nothing was created" response (§I.7) |
| Clock | database time only, never the JavaScript or browser clock (appflow §10) |
| New company suspended right after acceptance | normal PO-02C path; the org exists after commit |

### I.7 Errors: internal reason → public response (A-5)

Precise reasons go to the platform audit only. A rejection is recorded *after* the rollback, in its own short
autocommit insert with result `rejected` (best effort: the response never depends on it). Malformed or unknown tokens
are counted as a metric, not one audit row each (no audit flooding).

| Internal | Public (EN) | Public (AR) |
|---|---|---|
| unknown / malformed token, INVITE_USED, revoked, EMAIL_CONFLICT, missing terms | "This invitation link can't be used. If you have already completed registration, sign in. Otherwise, ask for a new invitation." | «لا يمكن استخدام رابط الدعوة هذا. إذا كنت قد أكملت التسجيل مسبقًا فسجّل الدخول، وإلا فاطلب دعوة جديدة.» |
| INVITE_EXPIRED | "This invitation has expired. Ask for a new invitation." | «انتهت صلاحية هذه الدعوة. اطلب دعوة جديدة.» |
| RATE_LIMITED | "Too many attempts. Please wait and try again." | «عدد المحاولات كبير. يُرجى الانتظار ثم المحاولة مرة أخرى.» |
| audit / trigger unavailable, timeout, internal | "We couldn't complete your registration and nothing was created. Please try again later." | «تعذّر إكمال التسجيل ولم يُنشأ أي شيء. يُرجى المحاولة لاحقًا.» |

The neutral responses for used, revoked, unknown and e-mail-conflict cases are **identical**: same status, body and
headers. Each path performs the same bcrypt work (step I.2-5) before the database is consulted.

---

## J. Race, security and rollback test plan (specifications only — none of these has been run or passed)

**"Disposable"** = a loopback `*_test_only_*` database with fictional data, runnable during development.

**"Gate"** = needs the additional **production-readiness gate**: owner-approved D-6/D-7, a production-shaped rehearsal
copy, backup and restore. Production itself is never a test target.

### J.1 PO-02D1 (schema)

| ID | Specification | Runs on |
|---|---|---|
| D1-01 | Apply the reviewed SQL to an empty DB, and push the Drizzle schema to another: F1–F8 catalogs are identical (columns, defaults, constraints, indexes); functions and triggers come from SQL | disposable |
| D1-02 | Re-apply: every object reports `verified`; the catalog checksum is unchanged | disposable |
| D1-03 | Pre-create each object with one difference (type, missing CHECK, extra index, other function body, disabled trigger): the apply aborts naming it and creates nothing | disposable |
| D1-04 | Precondition refusals: PO-02A objects missing, `platform_reject_mutation` missing, PG < 14 | disposable |
| D1-05 | Trial immutability: UPDATE or DELETE of a published version → `restrict_violation`; draft edit allowed; identity change refused; TRUNCATE refused | disposable |
| D1-06 | Version CHECKs: Trial with a price; `trial_days` 0 or 121 on a Trial; paid with days; non-SAR; 0 seats; 0 storage; modules not an array of strings | disposable |
| D1-07 | Second default Trial → unique violation; archive the default Trial → CHECK; duplicate name by case → unique | disposable |
| D1-08 | Primary owner refusals:<br>user of another org → composite FK<br>admin or inactive user → guard<br>second mapping for the same org → PK<br>same user for two orgs → unique<br>DELETE and TRUNCATE → refused | disposable |
| D1-09 | Subscriptions:<br>second current row → unique<br>superseded row update → refused<br>snapshot change → refused<br>`end_date` change → allowed<br>draft version → FK<br>Trial with `monthly` → CHECK<br>`trialing` on paid → CHECK<br>reversed dates → CHECK<br>DELETE → refused | disposable |
| D1-10 | Events: UPDATE, DELETE, TRUNCATE refused; actor-less event other than `assigned`/`invitee` → CHECK; event org ≠ subscription org → FK; duplicate `(sub, request, type)` → unique | disposable |
| D1-11 | Terms: draft version → FK; cycle / Trial mismatch → CHECK; UPDATE or DELETE → refused | disposable |
| D1-12 | Settings: second row; trial days 0 or 121; grace 61; `manual_billing` or MFA false; non-SAR; non-Riyadh → refused | disposable |
| D1-13 | Seed with fictional *test* values: inserts plus one audit row; a re-run verifies; a differing value aborts | disposable |
| D1-14 | Rollback: empty → drops exactly the D1 objects; any onboarding row or operator package → refuses, nothing changed | disposable |
| D1-15 | F1 `CONCURRENTLY` during concurrent sign-in and registration writes: no write blocked beyond the expected waits (measured); an interrupted build is detected as INVALID and the recovery is printed | disposable; **gate** for production timing |
| D1-16 | Foundation apply against a held sign-in transaction (org FOR SHARE + `users` UPDATE) and a long reader: the waits are bounded by `lock_timeout`; readers are never blocked | disposable; **gate** for production sizing |
| D1-17 | On a push-built DB with D1 applied, `drizzle-kit push` (and `db:push`) proposes no statement touching D1 objects; every trigger is still present and enabled | disposable |
| D1-18 | With a D1 trigger dropped or disabled, the service-level assertion refuses (fail closed) | disposable |
| D1-19 | Verify file: healthy → all ok; injected drift → the specific check is `f` | disposable |
| D1-20 | Whole-DB checksum of every pre-existing table is identical before and after apply, seed and rollback | disposable |
| D1-21 | The legacy audit (02) and drift (03) files still run read-only on all shapes | disposable |

### J.2 PO-02D2 (issuance)

| ID | Specification | Runs on |
|---|---|---|
| D2-01 | Token entropy: 1,000 tokens, each 43-character base64url decoding to 32 bytes, all distinct; the source uses `crypto.randomBytes` (static rule) | disposable |
| D2-02 | Hash-only storage: the row holds `sha256(token)` only. A full-database text search for the token and the link finds nothing; server output and audit rows contain neither | disposable |
| D2-03 | The link appears only in the creating response; no read model, list, detail or CSV returns the token, hash or link | disposable |
| D2-04 | Origin: the link uses `CUSTOMER_PUBLIC_ORIGIN`. Missing or invalid origin → refused, nothing inserted. A spoofed Host header has no effect | disposable |
| D2-05 | Authorization: no session, customer cookie, missing permission or flag off → refused, nothing inserted | disposable |
| D2-06 | Step-up: wrong password → refused before the transaction; wrong or replayed TOTP → rollback; the throttle engages | disposable |
| D2-07 | Duplicates: same e-mail while unexpired → CONFLICT with the reference; 20 concurrent creates → exactly 1 row; an expired holder is revoked (audited) and the new row created in one transaction | disposable |
| D2-08 | E-mail already a user, exact or case-variant → EMAIL_CONFLICT, nothing inserted | disposable |
| D2-09 | Field validation, with the DB CHECKs as backstop | disposable |
| D2-10 | Revoke: pending → revoked and audited; accepted or already revoked → refused (no second audit); two concurrent revokes → one | disposable |
| D2-11 | Re-issue: old row revoked, new row pending; the old token is never accepted; a fault after the revoke → nothing changed | disposable |
| D2-12 | Audit: exactly one success record per change, in the same transaction; audit outage → AUDIT_UNAVAILABLE, nothing applied | disposable |
| D2-13 | Per-operator rate limit (I-6) | disposable |
| D2-14 | UI, EN/AR: RTL, numbers and dates LTR; light and dark; 1440/1280/1024/820/390/360 (desktop, tablet, mobile); link shown once and gone from the DOM after close; no clipped actions; keyboard and focus | disposable (browser) |
| D2-15 | No e-mail or notification: no mail module (static) and no outbound call (server output) | disposable |

### J.3 PO-02D3 (acceptance)

| ID | Specification | Runs on |
|---|---|---|
| D3-01 | Happy path: one transaction creates the org, owner, seed, active access row, primary owner, Trial (correct snapshot and dates), `assigned` event, accepted mark, platform and customer audits, and security event; sign-in then works (A-3) | disposable |
| D3-02 | Seed equivalence: an org from D3 and one from `/register` (same country) have identical seeded rows, normalized (ids, org ids and timestamps excluded) | disposable |
| D3-03 | Single use: 20 concurrent acceptances (barrier) → exactly 1 org, 1 user, 1 subscription; the rest neutral; no deadlock; no idle-in-transaction | disposable |
| D3-04 | Expiry: expired → INVITE_EXPIRED, nothing created; near-boundary cases with `expires_at` set relative to DB time | disposable |
| D3-05 | Revoked or re-issued old token → neutral. Accept vs revoke and accept vs re-issue races (barriers) → exactly one consistent outcome | disposable |
| D3-06 | E-mail collision: a user created after issuance (exact or case-variant) → neutral publicly, EMAIL_CONFLICT in the audit, nothing created. D3 vs `/register` with the same e-mail at once → exactly one account | disposable |
| D3-07 | Rollback injection: a fault after each of statements #5–#14 → whole-DB checksum unchanged and the invitation still pending | disposable |
| D3-08 | Platform audit outage → nothing created; missing guard trigger → refused before the transaction | disposable |
| D3-09 | Interruption: kill the connection mid-transaction → rollback, and a retry succeeds. Commit then drop the connection → the retry is neutral and sign-in works | disposable |
| D3-10 | Non-leakage: used, revoked, unknown and e-mail-conflict responses are byte-identical (status, headers, body) | disposable |
| D3-11 | Rate limit per IP, checked before any hashing | disposable |
| D3-12 | Token transport: never in server logs; POST body only; `Referrer-Policy: no-referrer`; fragment cleared | disposable (browser) |
| D3-13 | Session: with A-3(a), acceptance creates no session; with A-3(b), a session exists only after commit, through `issueSession` | disposable |
| D3-14 | Isolation: the new owner cannot read another org; other orgs' data checksums are unchanged; the platform read model shows the new company as active with its Trial | disposable |
| D3-15 | PO-02C.1 compatibility: `verify:platform-login-race` 51/51. Also: suspension of the new company right after acceptance; other companies' sign-ins during acceptances; lock waits measured | disposable |
| D3-16 | Registration regression: `/register` works exactly as before (server and browser) and creates no foundation rows (R-2); the access gate resolves active by compatibility | disposable |
| D3-17 | EN/AR journeys: acceptance page EN LTR and AR RTL; numbers and dates LTR; light and dark; 1440/1280/1024/820/390/360; keyboard, focus and contrast | disposable (browser) |
| D3-18 | Drift: after acceptances R01–R06 return 0; an injected demotion appears in R02 | disposable |
| D3-19 | Flag off: page "not available"; the action refuses before any DB access | disposable |
| D3-20 | A visitor with a live customer session is redirected by the `(auth)` layout (A-7) | disposable (browser) |

### J.4 Production-readiness gate (not runnable during development)

| ID | Specification |
|---|---|
| PG-01 | D-7 measurements reviewed: L03 classes, L08 = 0 (or a decision), L13 size, L07 rate |
| PG-02 | D-6 decided. Rehearsal on a production-shaped copy (a restored backup on loopback, or an approved Neon branch): backup → concurrent F1 → foundation → seed → verify → `platform:db:check` → smoke; then rollback rehearsal and a restore drill |
| PG-03 | Lock and timing measurements at production size: F1 build time; FK SHARE ROW EXCLUSIVE stall; sign-in latency during the migration |
| PG-04 | The applied-file ledger (PO-07) records the D1 files |
| PG-05 | Full regression and CI green on the exact release commit; D-5 merge/deploy authorization |
| PG-06 | Flags remain off after deploy until a separately approved activation (R-5) |
| PG-07 | Observability: no secrets in logs or audit; invitation and acceptance outcomes counted with correlation ids |

---

## K. Production migration blockers D-6 through D-9

| ID | Decision (PO-00 §I.2) | Status | What it blocks in PO-02D | Recommended next step (provisional) |
|---|---|---|---|---|
| **D-6** | Production migration mechanism | **open**. PO-02A recommended: mechanism **B** (reviewed, retry-safe SQL outside the journal) for Platform Owner objects; an applied-file ledger before first production use (PO-07); baseline reconciliation (**A**) as its own stage; never C1 (guarded push) for platform objects | any production application of PO-01A, PO-02A and PO-02D1 SQL. Deploying PO-02C/PO-02D code also needs the objects to exist in production first | decide before merging anything that reads these objects; rehearse as in PG-02 |
| **D-7** | Read-only production measurements | **open**. Prepared: the PO-00 set plus `po02d0/sql/02_legacy_onboarding_audit_readonly.sql` | O-2 (legacy owner classes); O-5; I-7 (`lower(email)` index needs L08 = 0); U-1 sizing (concurrent build); R-2 (registration rate) | authorize per §F.4: preferably a Neon branch, a read-only role, outputs kept out of git |
| **D-8** | Reject legacy jti-less customer tokens | **open** | not an onboarding prerequisite: every session created after a D3 acceptance carries a jti. It is part of the complete suspension guarantee of the release that activates PO-02C | decide together with PO-02C activation |
| **D-9** | Platform session lifetimes (12 h absolute / 30 min idle) | **open** | the operator sessions that issue invitations (D2). Not a schema blocker | confirm before release |

**Other open decisions that bound PO-02D:**

| Decision | Bounds |
|---|---|
| D-1 | paid prices and seats (P-2, P-3) |
| D-2 | bootstrap identity, PO-07 |
| D-3 | registration cutover (R-1, R-3) |
| D-5 | merge/deploy authorization and seat grandfathering |
| D-10 | branch protection |

**None of D-1 … D-10 is decided by this document.**

---

## L. Complete recommended PO-02D1 implementation prompt (NOT executed)

~~~text
ELITE ERP — PLATFORM OWNER — PHASE PO-02D1
ONBOARDING DATABASE FOUNDATION (TRIAL ONLY) — NO ISSUANCE, NO ACCEPTANCE

BASELINE
- Repository Delowar01/Elite-ERP, branch feat/platform-owner.
- Approved PO-02D0 head: <the SHA recorded in the PO-02D0 handover>.
- Live ERP main: 621f156f7b129b9c2e289bc46d314ce7587beec2 (must be unchanged).
- PR #11: draft, unmerged.
- Design input: docs/platform-owner/PO02D0_DECISIONS.md (§C, §G, §J.1) and docs/platform-owner/po02d0/proposal/.

OWNER DECISIONS IMPLEMENTED BY THIS PHASE
Fill every blank before starting. If any blank remains, STOP and ask.
Where an answer differs from the PO-02D0 recommendation, implement the answer and record it.
- T-1 Trial length in days (1–120): ____   (14 is only the specifications' proposal)
- T-2 Trial included seats (≥ 1): ____
- T-3 Trial storage allowance in GB (≥ 1): ____
- T-4 Trial module-group labels (JSON array of strings; [] allowed): ____
- T-5 The published Trial version's trial_days governs: yes / no
- T-6 Trial price SAR 0.00 monthly and annual: confirmed / not
- T-8 End date: inclusive (start + days − 1) / exclusive
- T-9 Trial identity: code 'trial', stored name 'Trial', UI-localized: confirmed / not
- S-1 Business dates: Asia/Riyadh / UTC
- S-2 grace_days: ____ (spec 0)
- S-3 expiry_alerts_enabled: ____ (spec true)
- S-4 Seed platform_settings in this phase: yes / no
- U-1 Additive unique index users(org_id, id), declared in src/db/schema/users.ts: approved / not
- O-1 DB-enforced single primary owner for new companies: approved / not
- O-2 No primary-owner row for any legacy company: confirmed / not
- O-3 Users-side protection deferred to PO-03: confirmed / not
- I-1 organization_invitation_terms 1:1 table, PO-02A table untouched: approved / ALTER alternative
- R-3 invite_only not stored until the D-3 cutover: confirmed / not

AUTHORIZED
- Code and documentation on feat/platform-owner only:
  · a new src/db/schema/platform-onboarding.ts, exported from src/db/schema/index.ts;
  · the users_org_id_id_uq declaration in src/db/schema/users.ts (one approved-delta hunk);
  · drizzle/platform/PO02D1_onboarding_foundation.sql, PO02D1_users_org_id_id_concurrently.sql (runbook),
    PO02D1_seed.sql (approved values) and PO02D1_rollback.sql, derived from the PO-02D0 proposals with their
    guards removed and their tokens replaced;
  · scripts/platform catalog, platform:db:apply and platform:db:check support;
  · a fail-closed assertion helper for the new guard and append-only triggers (not yet called by any feature);
  · verifiers, tests, approved-delta records and docs.
- Schema execution ONLY on disposable loopback PostgreSQL databases whose names contain _test_only_, with
  fictional data.
- Reviewable commits pushed only to feat/platform-owner.

NOT AUTHORIZED
- PO-02D2 or PO-02D3 code: no invitation issuance, revocation, re-issue or acceptance; no route, page, server
  action, permission, flag or UI for them.
- Any change to /register, customer login, customer sessions or customer audit behaviour.
- Production Neon or VPS access; production migration (D-6 open); D-7 measurements.
- Creating packages, versions, subscriptions, primary owners, users or invitations outside disposable databases.
- Paid packages, prices or seats; any payable subscription.
- Rows for legacy companies; any backfill.
- Feature-flag activation, merging, deploying, opening or closing a PR.
- E-mail or notifications of any kind.

STEPS
1. Baseline.
   - Verify main = 621f156, the branch head = the approved PO-02D0 head, and PR #11 is a draft.
   - Read PO02D0_DECISIONS.md.
   - Run the PO-02D0 regression set: tsc; ESLint (28 pre-existing problems); verify:static; ACC-01; security;
     platform suites; next build; the three browser suites; verify:platform-login-race.
   - Stop on any unexpected source, schema or security change. Preserve every approved-delta and freeze baseline.
2. Prove the proposal SQL BEFORE writing application code, on disposable databases: empty, branch,
   production-like 621f156 + PO-01A/PO-02A, and push-built.
   - Execute a guard-free copy to find syntax and semantic errors.
   - Run D1-01 (catalog equivalence), D1-02 (idempotency), D1-03 (shape refusals), D1-04 (preconditions) and D1-20
     (pre-existing data untouched).
   - Record every defect found and fixed.
3. Drizzle declarations.
   - platform-onboarding.ts must match the SQL exactly: explicit FK names ≤ 63 characters, CHECKs, partial and
     expression indexes, the identity column, char(3), jsonb defaults.
   - Add the F1 index in users.ts.
   - Prove D1-01, and D1-17: drizzle-kit push on a push-built database touches no D1 object and leaves every
     trigger present and enabled.
   - Never run drizzle-kit generate or migrate.
4. Install path.
   - Add the four drizzle/platform/PO02D1_* files.
   - Extend the platform SQL catalog, platform:db:apply and platform:db:check (V01–V06, R01–R06).
   - The runner keeps refusing any target that is not a loopback _test_only_ database.
   - The seed contains only the approved values and is retry-safe (insert / verify / abort).
5. Fail-closed helper: asserts the 10 guard and append-only triggers exist and are enabled (D1-18). No feature
   calls it yet.
6. Tests on disposable databases:
   - verify:platform-onboarding-schema — D1-05 … D1-14, D1-19, D1-21;
   - verify:platform-onboarding-migration-safety — D1-15, D1-16, D1-17, D1-20, with concurrent sign-in and
     registration sessions for lock observations;
   - platform-boundary rules: only the schema index imports the new module; no D2/D3 code, route, permission or
     flag exists; /register and customer auth files are unchanged.
7. Change control.
   - Add an approved-delta layer for users.ts (one index hunk) and the schema index export.
   - Every other freeze check stays green: containment §7, proxy, customer auth.
8. Full regression: the step 1 set plus the new suites. Report exact counts; do not claim untested results.
9. Docs: docs/platform-owner/PO02D1_DEVELOPMENT.md covering:
   - objects created and the decisions implemented;
   - proofs, locks and timings on disposable data;
   - D-6 / D-7 notes, rollback, and known limitations (O-3 gap, R02 drift check).
10. Commit (reviewable commits) and push feat/platform-owner only, with retries on network errors. No force-push,
    no main, no PR changes.
11. Handover A–L in one copyable block. Then STOP.

STOP GATE
After PO-02D1, STOP. Do not begin PO-02D2. Do not issue, revoke or accept any invitation. Do not apply anything
to production. Await explicit owner approval before invitation administration (PO-02D2).
~~~

---

## M. Evidence of unchanged application code and production state

### M.1 What this phase changed

| Path | Change |
|---|---|
| `docs/platform-owner/PO02D0_DECISIONS.md` | new (this document) |
| `docs/platform-owner/po02d0/sql/` (3 files) | new: read-only audit, read-only drift, fictional fixtures |
| `docs/platform-owner/po02d0/evidence/` (4 files) | new: outputs on disposable databases |
| `docs/platform-owner/po02d0/proposal/` (5 SQL + README) | new: guarded, unexecuted proposals |

`git diff --stat 2a6aca2..HEAD` lists only these paths. No file changed under any of:

- `src/`;
- `drizzle/`, including `drizzle/platform/` and the journal;
- `scripts/`, `verify/`, `tests/`;
- `package.json` or the lockfile;
- `.github/`;
- configuration.

No approved-delta layer or freeze baseline was added or modified.

### M.2 Production state

- **No production access.** Production Neon and the VPS were not connected to.
- **Disposable databases only.** No command used a non-loopback `DATABASE_URL`. Every database used was named
  `*_test_only_*` on a private 127.0.0.1 cluster. One refusal probe used a scratch database without that marker, to
  prove the fixture file refuses it.
- **Repository and GitHub.** `main` was not touched. PR #11 is still a draft and unmerged. No PR was opened or closed.
  Nothing was merged or deployed.
- **Flags.** No production feature flag was read or changed.
- **Nothing sent, nothing created outside the disposable databases.**
  - No invitation, notification or e-mail was sent or created.
  - No package, version, subscription, primary owner or user exists outside the disposable databases.
  - Fixtures existed only in those databases, which were dropped. Teardown of the disposable cluster is recorded in
    the PO-02D0 handover.
- **Not done, deliberately.** Migrations were not applied; the Trial was not created; `/register` was not changed.

### M.3 Checks re-run on the final PO-02D0 tree

See the PO-02D0 handover for the exact outputs: tsc, ESLint, `verify:static`, platform boundary, and the
documentation-only diff check. Because PO-02D0 changes only documentation, every §A.2 result applies unchanged to
application code.
