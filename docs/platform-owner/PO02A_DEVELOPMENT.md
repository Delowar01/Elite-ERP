# Platform Owner — PO-02A company database foundation

PO-02A adds the database foundation for company access control and company invitations. It also prepares
the plan for later phases, and does nothing more:

- **M2** `tenant_access_controls`
- **M3** `organization_invitations`
- **M4** a partial index on the existing customer `sessions` table
- an audit lookup index on `platform_audit_events`
- a migration-safety framework, the D-6 analysis, and the authorization contracts for PO-02B…D

What PO-02A does **not** do:

- No company is backfilled, suspended or modified.
- No invitation is created or sent.
- No customer authentication or session code changes.
- No production database is touched.

The console stays off unless `PLATFORM_CONSOLE_ENABLED=true`.

**Baseline:** `021ceb4` (PO-01B.1, accepted); live ERP `621f156`. **Specifications:** PR #11 (draft) `357e93e`:
Schema.md §4.1, §5.1, §10–12; TRD §3.3, §4, §5, §8, §9. **Earlier phases:**

- [`PO00_BASELINE.md`](./PO00_BASELINE.md) (§F: database impact and the D-6 finding)
- [`PO01A_DEVELOPMENT.md`](./PO01A_DEVELOPMENT.md)
- [`PO01B_DEVELOPMENT.md`](./PO01B_DEVELOPMENT.md)
- [`PO01B1_SECURITY_CORRECTIONS.md`](./PO01B1_SECURITY_CORRECTIONS.md)

## 1. Schema

The source of truth is `src/db/schema/platform-companies.ts` (M2, M3), plus one index each in
`src/db/schema/security.ts` (M4) and `src/db/schema/platform.ts` (the audit index). The reviewed SQL is catalog-equivalent
to them; that is proven on disposable databases (§4).

### M2 `tenant_access_controls`: the platform's access decision, one row per company

| Column | Type | Rule |
|---|---|---|
| `org_id` | `integer` | **PK**; FK → `orgs(id)` `ON DELETE RESTRICT` |
| `access_status` | `text` | `NOT NULL DEFAULT 'active'`; CHECK `IN ('active','suspended')` |
| `reason` | `text` | Reason for the latest platform change. Trimmed, 1–1000 characters. |
| `changed_by_platform_admin_id` | `uuid` | FK → `platform_admins(id)` `ON DELETE RESTRICT` |
| `changed_at` | `timestamptz` | Set together with `changed_by_platform_admin_id` |
| `created_at`, `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()`. `updated_at ≥ created_at`, and `changed_at ≥ created_at`. |

Integrity rules (all CHECK constraints):

- **Attribution.** A change records both who and when, or neither.
- **Reasons.** Every attributed change carries a reason. That applies to reactivation as well as suspension.
- **Suspension.** A `suspended` row cannot exist without a responsible platform administrator. No automated
  process — subscription expiry included — can suspend a company by writing a bare row, and no function or trigger
  references the table (tested).

Rows are created only by PO-02C actions, or at invitation acceptance (PO-02D). **Legacy companies have no row.**

### Compatibility rule — `src/lib/platform/company-access.ts`

This module is the only place the missing-row rule is written:

| Case | Result |
|---|---|
| No row (a pre-existing company) | `{ status: 'active', source: 'legacy_default' }` |
| A row with a known status | That status (`access_control`) |
| Any other stored value | **Fails closed**: `{ status: 'suspended', source: 'invalid_state' }` |

The same rule is exported as a SQL expression, `effectiveTenantAccessSql`, for queries that `LEFT JOIN` the table.
`getTenantAccess(orgId)` returns `null` for an unknown or malformed id, never `active`.

**Nothing imports the module yet.** PO-02C wires it into customer authentication, under separate approval.

### M3 `organization_invitations`: pending company invitations (metadata only)

| Column | Type | Rule |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` (displayed as `INV-…`) |
| `company_name`, `industry`, `company_email` | `text` | Name trimmed 1–200. Industry optional (trimmed 1–100). E-mail normalized (`lower(btrim())`, ≤ 320, shape). |
| `country_name`, `currency_code` | `text` | Country trimmed 2–100; currency `^[A-Z]{3}$`. Validated against the ERP catalogs at creation, as `/register` does. |
| `owner_name`, `owner_email_normalized` | `text` | Name trimmed 1–200; e-mail normalized as above |
| `token_hash` | `text` | **SHA-256 hex only** (`^[0-9a-f]{64}$`); UNIQUE. No plaintext token, link or URL column exists. |
| `expires_at` | `timestamptz` | `NOT NULL DEFAULT now() + 72 h`. Must be after `created_at`, with a 30-day ceiling. |
| `accepted_at`, `accepted_org_id` | `timestamptz`, `integer` | Set together. FK → `orgs(id)` RESTRICT, unique when set. Acceptance must fall within `[created_at, expires_at]`. |
| `revoked_at`, `revoked_by_platform_admin_id` | `timestamptz`, `uuid` | Set together. FK → `platform_admins(id)` RESTRICT. Not before `created_at`. |
| `invited_by_platform_admin_id` | `uuid` | `NOT NULL`; FK → `platform_admins(id)` RESTRICT |
| `created_at`, `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()`; `updated_at ≥ created_at` |

**Lifecycle.**

- An invitation moves from pending to accepted or to revoked. Those two terminal states are mutually exclusive.
- *Expired* is derived from time, so there is no state column.
- **One pending invitation per owner e-mail.** This is a partial unique index on unaccepted, unrevoked rows, so an
  expired-but-unrevoked invitation still holds the slot. A re-issue therefore revokes the previous invitation and inserts
  the new token row in one transaction (Schema.md §5.1).
- No `orgs` or `users` row exists until acceptance.

Indexes:

- `token_hash` UNIQUE;
- `accepted_org_id` UNIQUE (partial);
- the pending-email UNIQUE (partial);
- the pending-expiry index (partial).

**Deliberate deviations from Schema.md §5.1. Owner decision needed (§9):**

- **Package columns deferred.** `initial_package_version_id` and `initial_cycle` reference subscription packages, which
  PO-02A must not implement. Add them additively with the package schema, before PO-02D creates any invitation.
- **Revocation attribution added.** `revoked_by_platform_admin_id` and `updated_at` are additions, made for attribution
  and the audit trail.
- **Expiry ceiling added.** The 30-day ceiling is a sanity bound, so no token is effectively permanent.

### M4 `sessions_org_active_idx` on `sessions(org_id) WHERE revoked_at IS NULL`

This index lets PO-02C revoke an organization's live sessions without a sequential scan (probe P8 in PO-00). It is the
**only** change to a tenant object. `verify-page-archetypes` group 24 pins `src/db/schema/security.ts` line by line:

- one `sql` import;
- three existing index entries, reflowed;
- the comment and the new index.

Nothing else in the file may change.

### Audit lookup `platform_audit_events_entity_idx` on `(entity_type, entity_id, created_at DESC NULLS LAST)`

This serves PO-01B.1's late revocation recording and the per-entity histories (invitation, company, session). The leading
columns are the reviewed `(entity_type, entity_id)`. `created_at DESC` lets a timeline read in index order, matching the
other audit indexes. The append-only triggers and every existing index are untouched.

## 2. The reviewed SQL migration and recovery

| File | Purpose |
|---|---|
| `drizzle/platform/PO02A_company_foundation.sql` | The migration: one transaction, retry-safe, shape-checked |
| `drizzle/platform/PO02A_m4_sessions_index_concurrently.sql` | Production-runbook alternative for M4 (`CREATE INDEX CONCURRENTLY`), run before the migration |
| `drizzle/platform/PO02A_rollback.sql` | Removes exactly the PO-02A objects. Refuses while either table holds a row. |

All three are **outside the drizzle-kit journal**, like PO-01A. The historical migrations build 59 tables against the
schema's 67 tenant tables (PO-00 §F.2). Historical migrations and the journal are untouched.

`npm run platform:db:apply` applies `PO01` then `PO02A` to loopback `*_test_only_*` databases only (`local-db-guard`).

### How the migration stays retry-safe without hiding incompatibilities

Within one transaction, each object is built **from the exact DDL in the file** into a private scratch schema,
`po02a_reference`. Then:

| Object in `public` | Action | Step reports |
|---|---|---|
| Absent | Created from the same DDL | `created` |
| Present with exactly the reviewed shape | Left untouched | `verified` |
| Present with **any** difference | The migration aborts and changes nothing | — |

*Shape* covers relation kind, persistence and row-level security; every column (type, nullability, default, identity,
generated, collation); every constraint definition and validity; every index definition and validity; and every
user trigger. The error names each difference (`unexpected in public: …` / `missing in public: …`).

An index on an existing table (M4, the audit index) must have the identical definition and be **valid**. An INVALID
index — an interrupted concurrent build — is refused, and the error carries the exact recovery step.

Before anything is built, preconditions are checked:

- PostgreSQL ≥ 14;
- `orgs(id integer)` and `sessions(org_id, revoked_at)` with the reviewed types;
- PO-01A's `platform_admins(id uuid)` and audit columns;
- primary keys on the foreign-key targets.

Helper functions live in `pg_temp` and, like the scratch schema, are dropped before `COMMIT`. **The file leaves no
function, trigger, view or schema behind**, and creates no row.

### Recovery

| Situation | Behaviour / action |
|---|---|
| Any error (lock timeout, conflicting object, shape mismatch, precondition) | The whole transaction rolls back. Fix the cause and re-run; nothing partial exists. |
| Re-running after success, or on a `db:push`-built database | `verified` ×4; catalog and data unchanged |
| Interrupted concurrent M4 build (INVALID index) | `DROP INDEX CONCURRENTLY public.sessions_org_active_idx;` then re-run the concurrent file |
| Undo PO-02A (empty tables) | `PO02A_rollback.sql` restores the exact pre-PO-02A catalog (digest-equal, tested). In production, drop M4 first with `DROP INDEX CONCURRENTLY`. |
| Undo PO-02A with data present | Refused. A data-bearing rollback destroys access decisions or invitations and needs its own owner-approved, backed-up plan. |
| Application already reading the objects | Roll the application back **before** the schema |

## 3. Locking, and transactional vs concurrent index strategies

Measured on disposable databases (`verify:platform-migration-safety` §4 and §7).

| Step | Lock taken | Effect while held |
|---|---|---|
| FK creation (M2, M3) | `SHARE ROW EXCLUSIVE` on `orgs` and `platform_admins` until `COMMIT` | Writes to those tables wait (registration, org settings, operator changes). Reads continue. Duration is milliseconds. |
| **M4, transactional** (`CREATE INDEX` in the migration) | **`SHARE` on `sessions` for the build and until `COMMIT`** | **Sign-ins, sign-outs and revocations wait** (measured: a session `INSERT` timed out while it was held). Reads continue. |
| **M4, concurrent** (the runbook file) | **`SHARE UPDATE EXCLUSIVE` on `sessions`** | **Writes continue** (measured: a session `INSERT` succeeded mid-build). Slower; waits for in-flight write transactions. An interruption leaves an INVALID index (handled, see §2). |
| Audit index | `SHARE` on `platform_audit_events` | The table is small and platform-only |

`lock_timeout = 5s` bounds every wait. The tested failure mode is a lock timeout half-way through: everything rolls back.

**Production runbook recommendation:**

1. **Size the table.** Read the `sessions` row count under the D-7 read-only authorization.
2. **Build M4 concurrently.** Unless `sessions` is trivially small, run `PO02A_m4_sessions_index_concurrently.sql` first,
   in a quiet period. It runs statement by statement in autocommit (`psql -v ON_ERROR_STOP=1 -f …`), never inside
   `BEGIN` and never with `psql -1`.
3. **Run the migration.** Then run `PO02A_company_foundation.sql`: M4 reports `verified`, and the remaining locks last
   milliseconds.
4. **Check the result.** Verify it with `npm run platform:db:check`, or the equivalent read-only queries.

## 4. Proof: idempotency, compatibility and isolation (summary)

`verify:platform-company-schema` (106 checks) and `verify:platform-migration-safety` (91 checks) run on disposable
loopback databases.

**Equivalence**

- The reviewed SQL, applied to the pre-PO-02A (621f156) tenant shape, equals a full `drizzle-kit push` of the schema
  **object for object**. That covers the platform-owned and the tenant side, M4 included.
- The exact 28 constraint names and 8 index definitions are pinned.

**Isolation**

- **Single tenant change.** The tenant-schema difference before → after is exactly the M4 line.
- **Data unchanged.** The data of all 67 tenant tables and of the PO-01A tables is byte-identical (fixtures included).
- **New tables empty.** Both new tables are empty.
- **Audit trail intact.** The platform audit trail is still append-only (UPDATE, DELETE and TRUNCATE rejected).

**Application**

- **Repeat runs.** First run `created` ×4, second and third `verified` ×4, with digest and data unchanged.
- **Push-built databases.** On a `db:push`-built database the result is `verified` ×4.
- **Lock timeout mid-way.** A lock timeout at M4 rolls back the M2/M3 creations made earlier in the same transaction.
- **Conflict at the last step.** A conflicting object at the last step rolls back everything, and the conflicting object
  is untouched.
- **13 shape mismatches refused, nothing altered:**
  - a type change, a missing column, a weaker CHECK, an extra column, a missing FK, an extra trigger;
  - RLS enabled, a same-named view, a missing or weakened partial unique index;
  - a different or INVALID M4, a different audit index.
- **Two positive controls accepted.**

**Rollback and runbook**

- **Exact rollback.** The rollback script restores the exact pre-PO-02A catalog digest, and it refuses while either
  table holds data.
- **Concurrent runbook.** It is valid, re-run-safe and recovers from an INVALID leftover.

**Push and gate behaviour**

- **No PO-02A drift on re-push.** A later `drizzle-kit push` issues **no statement for any PO-02A or platform object**.
  The `expires_at` default is written in PostgreSQL's canonical form so push sees no difference.
- **`db:preflight` still refuses.** It still refuses `migrate` on the migrated database (INCONSISTENT, exit 20), so
  D-6 is unchanged.

## 5. D-6: production migration strategy, a recommendation, not a decision

PO-00 §F.2 and AUD-08.1 establish the following facts:

- **The committed journal is incomplete.** `0000`–`0004` build 59 tables; the schema has 67 tenant tables, and 73 with
  the platform-owned ones.
- **The historical gap is not purely additive.** AUD-08.1 measured 7 tables, 204 columns, 1 drop and 61 numeric
  widenings.
- **Production is push-shaped.** It is maintained by `db:push` (`drizzle-kit push && db:harden`).
- **`db:preflight` refuses `migrate`.** It refuses on such databases (INCONSISTENT), and the push reference has been
  stale since ACC-01.
- **`drizzle-kit push` cannot converge a migrations-built database.** It stops on TTY prompts and exits 0 having applied
  nothing (AUD-08 E19).
- **Every push re-creates long-named FKs (new measurement).** Each push on a push-built database drops and re-adds the
  8 customer foreign keys whose generated names exceed PostgreSQL's 63-character limit. Each re-add re-validates the
  FK, a full scan holding `SHARE ROW EXCLUSIVE` on both tables (`verify:platform-migration-safety` §9).

| | A. Full baseline reconciliation, then versioned migrations | B. Separately reviewed SQL migrations (PO-01A / PO-02A pattern) | C1. Guarded `db:push` on production | C2. New baseline from production (`drizzle-kit pull` → fresh journal + stamp) |
|---|---|---|---|---|
| What | AUD-08.2/08.3: a `0005` converging history to the schema, re-measured references, a stamp of production after digest proof, then `generate` + `migrate` behind `db:preflight` | Hand-written, reviewed, retry-safe, shape-checked SQL files with runbook and rollback, applied by a guarded runner | Today's `drizzle-kit push && db:harden` | Introspect production into a new baseline, start a new journal, stamp |
| Pros | One standard mechanism; journaled history; the existing gate enforces it; future changes generated | Available now. Exact control of locks (CIC), preconditions and rollback; self-verifying; tiny blast radius; independent of the historical gap; already tested end to end | Simple; matches how production is maintained | Fast to a journaled state |
| Cons / risks | Largest effort. Needs D-7 measurements and a production bookkeeping write (stamp). Schema changes freeze while it runs. Triggers and functions still need custom SQL. Partial indexes and defaults need care to avoid perpetual diffs. | A second mechanism beside the journal. No applied-file ledger yet: application is shape-detected, not recorded. Each file needs hand review. | Statements are not reviewable before execution. TTY and silent-no-op hazards; re-validates 8 FKs every run; no rollback; installs no triggers (platform protection fails closed). | Production is the source of truth, so its drift is canonized. Introspection vs schema perpetual diffs. Needs D-7. Discards the AUD-08 measurements. |
| Fit for platform objects | Good once complete | **Good now** | Poor (no triggers, no CIC, no rollback) | Unproven |

**Recommendation for the owner to decide:**

1. **Use B for Platform Owner objects** (PO-01A, PO-02A and later). Rehearse in this order:
   1. a disposable copy of the production schema — a restored backup on loopback, or a Neon branch under separate
      approval;
   2. a backup;
   3. the concurrent M4 file;
   4. the main migration;
   5. `platform:db:check`;
   6. smoke tests.

   Add a small applied-file ledger for platform SQL before the first production use. That is a PO-07 item and needs
   separate approval.
2. **Complete A** — the AUD-08.2/08.3 baseline reconciliation — as its own reviewed stage. Once the journal is
   reconciled, fold the platform SQL in as custom migrations (or recognise it in the reference digests), so one
   mechanism remains.
3. **Do not use C1 for platform objects**, and do not rely on it for any change that needs triggers, concurrent indexes
   or rollback.

**When D-6 reconciliation should happen.** Decide D-6, and run the D-7 read-only measurements, **before PO-02C is merged
or deployed**. PO-02C makes every customer request read `tenant_access_controls`, so from then on the PO-02A objects must
exist in production before the code that uses them.

- **Run alongside PO-02B.** Run reconciliation (A) as a separate stage in parallel with PO-02B. PO-02B is read-only and
  needs no production schema.
- **Hard deadline:** before PO-07 (release preparation).
- **Do not run it during PO-02B/PO-02C coding.** That would mix unrelated tenant-schema drift into Platform Owner
  reviews.

## 6. Authorization and implementation contracts for PO-02B … PO-02D (plan only)

### 6.1 Common rules (all phases)

- **Authorization path.** Every operation runs through the PO-01 console cores: feature flag → same-origin (mutations) →
  live platform session (DB) → permission. Platform sessions only; a customer token is refused everywhere (PO-01B).
- **Input.** Every `orgId` is validated as a positive safe integer. An unknown id is `NOT_FOUND`, indistinguishable from
  "not visible".
- **No arbitrary SQL.** Queries are fixed and allowlisted. There is no SQL, table browser or customer business data.
- **Mutations.** Every mutation:
  - requires a reason (trimmed, 1–1000 characters) and explicit confirmation in a dialog;
  - is idempotent by request key;
  - performs its state change and its `platform_audit_events` row in **one transaction**, under the PO-01B.1 audit
    atomicity and outage policy;
  - presents typed errors (`COMPANY_SUSPENDED`, `INVITE_EXPIRED`, `INVITE_USED`, `EMAIL_CONFLICT`, …) in EN and AR.
- **No impersonation.** No platform operator can sign in as, act as, or read the session of a customer user. There is
  no "view as company" and no shared session.

### 6.2 PO-02B — Companies directory and company detail (read-only)

**Read-model allowlist.** Only these fields are exposed:

| Source | Fields |
|---|---|
| `orgs` | `id`, `name`, `country`, `currency`, `industry`, `created_at`, logo presence (boolean, never the URL) |
| Effective access | `effectiveTenantAccessSql` plus the latest `reason`, `changed_at` and actor label |
| Users (aggregates) | Counts — total, active, owners |
| Primary owner | Name and e-mail of the owner-role user(s); the primary-owner mapping is PO-03 |
| Activity | Last activity: max `users.last_login_at` |

Never exposed: tax or VAT numbers, address, phone, branding internals, settings, finance, documents, files, passwords,
MFA data or session tokens.

**List.**

- Server-side pagination: keyset on `(created_at DESC, id)`, page size ≤ 50.
- Search: name, normalized e-mail or `INV-` reference; bounded `ILIKE` with escaped wildcards.
- Filters: access status, country.
- Sorting from an allowlist only.
- Counts in one aggregate query, with no N+1 queries.
- Pending invitations appear separately (an `INV-` reference, never an `orgId`).
- p95 target: < 2.5 s at 1,000 synthetic organizations (TRD §10), measured.

**Detail.** Tabs Overview / Access & controls (read-only) / Users (summary) / Activity, where Activity comes from the
`platform_audit_events` entity index. The detail views are audited; the list is not (avoids audit flooding).

**CSV export** is out of scope until the owner approves it.

### 6.3 PO-02C — Suspension, reactivation, org-wide revocation, and the customer-auth gate

**`setCompanyAccess(orgId, target, reason, requestKey)`** runs in one transaction:

1. `SELECT … FROM orgs WHERE id=$1 FOR UPDATE`, then lock or insert the `tenant_access_controls` row. Absent means
   active.
2. No-op if the status is unchanged (returns the current state; audited as `rejected` only when contradictory).
3. Write status, reason, `changed_by` and `changed_at`, and `updated_at`.
4. On suspend: `UPDATE sessions SET revoked_at=now(), revoked_reason='org_suspended' WHERE org_id=$1 AND revoked_at IS NULL`,
   using M4.
5. Write `platform_audit_events` (`company.suspended` / `company.reactivated`, `org_id`, before/after status, reason).
6. Commit.

**Revocation is not enough on its own.** The session check must also deny a suspended company, so a session missed by
the revoke, a legacy token or a race all still lose access.

**Customer-auth touch points.** These need a **separately approved** change in PO-02C. All of them are unchanged in
PO-02A; line numbers are at `021ceb4` = `621f156`.

| File:line | Today | PO-02C change |
|---|---|---|
| `src/lib/session.ts:39-78` `lookupSessionByToken` | JWT → `isSessionValid(jti)` → users ⋈ orgs → `isActive` | **The central gate.** `LEFT JOIN tenant_access_controls`; deny unless effective access is `active`. Reject jti-less legacy tokens (D-8). Optionally require `sessions.org_id = users.org_id` (PO-00 Q07). |
| `src/lib/session.ts:80-100` `getSession` / `requireSession` / `requireRole` | Used by **126** files: every page, server action, export, print, PDF and upload route | No change; it inherits the gate. A suspended company's open browser is redirected on its next request. |
| `src/app/(auth)/actions.ts:37-95` `loginAction` (user lookup `:52`, `isActive` `:53`, `issueSession` `:93`) | No org check (gap G-3) | Refuse sign-in for a suspended company before `issueSession`, with a security event. The message (generic vs `COMPANY_SUSPENDED`) is a product decision. |
| `src/app/(auth)/actions.ts:24-35` `issueSession` | Creates the session row and JWT | Defence in depth: re-check access inside. |
| `src/lib/security/session-store.ts:89` `revokeUserSessions` | Per-user revoke | Add `revokeOrgSessions(orgId, reason, tx)` (gap G-10), executed inside the PO-02C transaction |
| `src/lib/auth.ts:39-43` `verifySessionToken` | `jti` optional (legacy tokens) | D-8: treat a missing `jti` as invalid (expected impact nil: Stage 11 since 2026-07-18, 30-day expiry) |
| `src/app/uploads/[...path]/route.ts:58` | `getSession` or an HMAC-signed URL | Session path inherits the gate. Signed URLs need their own threat check (none minted today). |
| `src/proxy.ts:25` | Edge JWT signature check only | No change. It cannot read the DB; the gate is server-side. |
| `src/app/(app)/actions.ts:9-21` `logoutAction` | Revokes the current session | No change. Logout must keep working for a suspended company. |

**Gate (Plan.md).** A suspended company with an open browser cannot view or mutate anything: pages, server actions,
exports, print, PDF and files. Reactivation requires a fresh sign-in. No data is deleted or edited.

PO-02C needs a full tenant regression under suspension: ORG-03 / ORG-04, T11, G-1/G-2/G-3/G-10.

### 6.4 PO-02D — Safe invitation onboarding

**Create (platform action).**

- Validate country and currency against `COUNTRIES` and `isValidCurrencyCode`, as `/register` does.
- Normalize e-mails; check that `users.email` does not exist (case-variant collisions measured first: Q05/P7).
- Generate 32 random bytes (base64url). Store only `sha256` hex; return the link once.
- Revoke any pending row for the e-mail in the same transaction; audit `invitation.created`.
- Copy-link delivery only, with no e-mail provider.

**Accept** (public, token, rate-limited), in one transaction:

1. Hash the token and select the invitation `FOR UPDATE`. Require pending, unexpired and unrevoked; otherwise return the
   typed error.
2. Re-check e-mail uniqueness.
3. Create `orgs` and the owner `users` row, reusing the register transaction and `seedOrgDefaults`.
4. Create the active `tenant_access_controls` row and set `accepted_at` / `accepted_org_id`.
5. Write the audit row, then commit.

The database guarantees single use: the acceptance CHECKs and `accepted_org_id` UNIQUE. A double-click accept yields
exactly one org (ORG-01/02). The password is set only by the recipient. The acceptance route is allow-listed in the proxy
(tenant side), and the public `/register` cutover is D-3.

### 6.5 Cross-tenant and company-owner protection

- **Cross-tenant.** Platform reads go through the allowlisted read model only. The tenant `tenantScope()` is never
  bypassed and the customer session is never widened.
- **Company owner.** Owner identity and transfers are PO-03 (`tenant_primary_owners`, composite FK). Until then:
  - no platform action may change `users.role` or disable the last active owner;
  - suspension never deletes or alters users;
  - acceptance creates exactly one owner.

## 7. Verification

| Command | Covers |
|---|---|
| `npm run verify:platform-company-schema` | SQL ≡ Drizzle; the single tenant change; data unchanged; audit trail still append-only; index usage (planner); every M2 / M3 constraint (FK, uniqueness, normalization, invalid statuses, attribution, lifecycle, expiry); the compatibility rule incl. fail-closed on a drifted value; nothing references the new objects except their own two modules |
| `npm run verify:platform-migration-safety` | Preconditions; first / second / third application; db:push-built objects; injected failures (lock timeout mid-way, conflict at the end); 13 shape refusals + 2 positive controls; the concurrent runbook incl. an INVALID leftover; measured lock modes; rollback script; later `drizzle-kit push`; `db:preflight` |
| `npm run verify:platform-schema` (PO-01A) | Now builds S from the pre-PO-02A shape. The PO01 SQL alone still changes no tenant object. Full Drizzle ≡ pre-PO-02A shape + both files. Counts pinned (69 columns / 55 constraints / 21 indexes). |
| `npm run verify:platform` | boundary → proxy → schema → auth → bootstrap → console → containment → company-schema → migration-safety |

## 8. Change control

`verify/po02a-approved-delta.mts` records PO-02A in the same way as the earlier layers:

- the hunks in `src/db/schema/index.ts`, `src/db/schema/platform.ts` and `src/db/schema/security.ts`, plus the two freeze
  verifiers;
- the sha256 of each added file under `src/` and `drizzle/`.

**Undo order:** PO-02A → PO-01B.1 → PO-01B → PO-01A → LCP → ACC-01. Every older pin keeps reading its own bytes. Nothing
was re-baselined, and the older records are byte-identical.

`verify-page-archetypes` group 24 also proves:

- the scope of the change;
- the line-exact M4 change to `security.ts`.

## 9. Open owner decisions

- **D-6** (§5) and **D-7** (read-only production measurements). Both are needed before PO-02C is merged or deployed.
- **D-8**: reject legacy jti-less customer tokens. PO-02C needs this decision.
- **Package columns for invitations.** Choose one:
  - add `initial_package_version_id` / `initial_cycle` with the package schema before PO-02D;
  - or approve the Plan.md minimum Trial package schema as a PO-02D prerequisite.
- **Suspension sign-in message.** Generic, or an explicit "company suspended" (EN/AR)?
- **Invitation expiry ceiling.** 30 days is proposed; the default stays 72 h.
- **Applied-file ledger for platform SQL.** Proposed for PO-07.

## Appendix — proposed PO-02B prompt (NOT executed; for owner review)

~~~text
ELITE ERP — PLATFORM OWNER SYSTEM
PHASE PO-02B — READ-ONLY COMPANIES DIRECTORY & COMPANY DETAILS

PROJECT BASELINE
Repository: Delowar01/Elite-ERP · Development branch: feat/platform-owner
Approved PO-02A head: <the PO-02A commit the owner approves>
Live production baseline: 621f156f7b129b9c2e289bc46d314ce7587beec2
Planning reference: Draft PR #11 (357e93e) — PRD P-03, UI_spec Companies, appflow, TRD §3.3/§8 listCompanies/§10
Reference documents: docs/platform-owner/PO00_BASELINE.md, PO01A/PO01B/PO01B1 notes, PO02A_DEVELOPMENT.md (§6.1–6.2)

AUTHORIZATION
PO-01A … PO-02A are accepted. I authorize PO-02B only: a READ-ONLY Companies directory and company
details inside the existing Platform Owner console. Commit and push only to feat/platform-owner.
You must NOT: merge or deploy; open or close a PR; access production Neon/VPS or apply database changes
there; run unguarded db:push; change the database schema; modify customer authentication, sessions or
tenant code; implement suspension/reactivation, invitations (create/send/accept), company-metadata
editing, user administration, packages, subscriptions, payments or CSV export; start PO-02C/PO-02D.
Disposable loopback `_test_only_` PostgreSQL databases only.

STEP 1 — BASELINE: fetch GitHub; verify main = 621f156, feat/platform-owner = the approved PO-02A head,
PR #11 draft/unmerged; read the specifications; run verify:platform, verify:static and the security tests.
Stop if the approved source changed unexpectedly.

STEP 2 — READ MODEL (server-only, src/lib/platform/companies.ts)
- listCompanies({ query, status, country, cursor, pageSize ≤ 50, sort }) and getCompanyDetail(orgId),
  behind the console cores (flag → live platform session → new permission `platform.companies.read`).
- Allowlist exactly (PO02A_DEVELOPMENT.md §6.2): orgs id, name, country, currency, industry, created_at,
  logo presence (boolean); effective access via effectiveTenantAccessSql + latest reason/changed_at/actor
  label; user counts (total, active, owners) by aggregate; owner-role users' name + e-mail (max 3);
  last activity = max(users.last_login_at). Never select tax/VAT, address, phone, logo URL, branding or
  theme, settings, finance, documents, files, password/MFA data, sessions or token hashes.
- Pending invitations listed separately (INV-<8 hex>, company, owner e-mail, country, created, expires,
  expired as a derived state); token_hash is never selected.
- Keyset pagination (created_at DESC, id DESC); search by name (escaped ILIKE, ≤ 100 chars), exact
  normalized e-mail or INV- reference; filters: access status, country; sort from an allowlist; one page
  query + one aggregate (no N+1); measured p95 < 2.5 s at 1,000 synthetic organizations.
- Company detail views are audited ('company.viewed', entity organization/<orgId>) under the PO-01B.1
  audit policy (fail closed when the audit trail is unavailable); the list is not audited.

STEP 3 — UI (existing PlatformShell and the accepted design system; no redesign, no new tokens)
- Replace the Companies preview with the live directory: name, country, currency, access status badge,
  users, owner, created, last activity; search, filters, pagination; empty/loading/error states; a
  read-only pending-invitations list.
- Company detail (drawer or page): Overview · Access & controls (read-only status + history) · Users
  (summary) · Activity (audit timeline). Later actions (Suspend/Reactivate — PO-02C, Invite — PO-02D,
  Edit — later) visibly labelled and never operational.
- Native Arabic + RTL from the start; EN/AR × light/dark × 1440/1024/390; numbers/dates LTR; labelled
  controls, focus order, keyboard; screenshots of every new or changed screen.

STEP 4 — SECURITY: no tenant business table read; tenantScope untouched; no impersonation; orgId
validated (unknown → NOT_FOUND); the read model is the only console code reading orgs/users (boundary
rule); the selected column list is pinned by a static test; customer files untouched (freeze verifiers).

STEP 5 — TESTS: new suite verify:platform-companies (allowlist — no forbidden column ever selected;
keyset pagination; search escaping and injection attempts; filters; sort allowlist; invitations without
token_hash; legacy company without access row shows active; a fixture suspended row shows suspended;
unknown/malformed ids; flag/session/permission/cross-site guards; detail-view audit incl. outage; 1,000-org
performance; query count). Extend the browser suite (directory + detail, EN/AR, light/dark, 1440/1024/390,
keyboard). Rerun tsc, ESLint, verify:platform, verify:static, security tests, the browser suite and a
production build with test-only configuration. Report exact counts; never report an unexecuted test as passed.

STEP 6 — CHANGE CONTROL: a PO-02B approved-delta layer; no re-baseline; earlier layers intact.
STEP 7 — GIT: feat/platform-owner only; reviewable commits; no force-push, rebase, merge or deploy.
STEP 8 — HANDOVER: A status · B branch/SHA · C files · D read model + allowlist · E UI + screenshots ·
F security/authorization proof · G performance evidence · H test counts · I ERP and PO-01/PO-02A
regressions · J risks and owner decisions · K proposed PO-02C prompt.
STOP GATE: stop after the PO-02B handover. No production changes, suspensions, invitations, merges or
deployment.
~~~
