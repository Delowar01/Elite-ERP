# Platform Owner PO-02B — Read-only Companies directory and company details

Status: development complete on `feat/platform-owner`, **not merged, not deployed**. Isolated development only:
no production database, VPS, customer data or customer authentication was touched. Builds on PO-02A
(`2a5674a`). Planning reference: draft PR #11 (PRD P-02/P-03, UI_spec UI-01/UI-02, appflow §1/§5, TRD §3.3, §8
`listCompanies`, §10) and `PO02A_DEVELOPMENT.md` §6.1–6.2.

## 1. Scope

| Delivered (read-only) | Not in PO-02B (disabled, phase named) |
|---|---|
| Permission `platform.companies.read` | Suspend / reactivate a company → **PO-02C** |
| Read model `src/lib/platform/companies.ts` | Create / resend / revoke / accept invitations → **PO-02D** |
| Companies directory with search, filters, sort, keyset pagination | Edit company metadata, CSV export → later phase |
| Pending-invitations view (no token material) | Customer user management → **PO-03** |
| Company detail: Overview, Access & controls, Users, Subscription (preview), Activity | Packages, subscriptions, payments → **PO-04 / PO-05** |
| Audited detail views (`company.viewed`) | Enforcing suspension at customer sign-in → **PO-02C** |
| Dashboard company figures, monthly registrations, newest companies | Activity Log viewer → **PO-06** |
| Guarded synthetic preview data (`platform:preview-companies`) | Any schema change (none made) |

The customer ERP is unchanged: no customer route, component, library, authentication, session, schema or migration
file is modified (the freeze verifiers `verify:document-form` and `verify:page-archetypes`, including the new PO-02B
group 25, and the static boundary test).

## 2. Read model (`src/lib/platform/companies.ts`)

Server-only; the **only** console module that reads the customer `orgs` and `users` tables (boundary rule 21; the
PO-02A compatibility module still reads `orgs.id` only, for existence).

### 2.1 Authorization (every exported operation, first statement)

`authorizeCompanyRead(req)` = feature flag `PLATFORM_CONSOLE_ENABLED=true` → configuration → **live** platform session
row (the platform cookie's token only — the page passes it; the module never reads cookies or headers) →
permission `platform.companies.read`. A customer session token, a forged, revoked, idle or expired platform session,
or the flag off are refused (`UNAUTHORIZED`, `SESSION_EXPIRED`, `CONSOLE_DISABLED`); a permission outside the
allowlist is `FORBIDDEN`. Internal failures surface as `CONFIG_ERROR` without detail.

| Operation | Returns | Queries (measured) |
|---|---|---|
| `listCompanies(req, input)` | one directory page, total, offset, next/prev cursors | session + 4 (first page) / + 6 (with a cursor) |
| `listCompanyCountries(req)` | distinct country names (≤ 300) | session + 1 |
| `listPendingInvitations(req, input)` | one page of slot-holding invitations | session + 2 (+2 with a cursor) |
| `companyMetrics(req)` | counts, monthly registrations, newest five | session + 5 |
| `getCompanyDetail(req, orgId, {activity})` | one organization + activity page; **audited** | session + 6 (incl. the audit insert) |

### 2.2 Field allowlist (exact)

| Source | Fields read | Never read |
|---|---|---|
| `orgs` | id, name, country, currency, industry, created_at; logo **presence** (`logo_url is not null and <> ''` → boolean) | tax/VAT ids, address, phone, company e-mail, branding/theme, seal/signature, print/document settings, bank, ZATCA, any other column; the logo URL itself |
| `tenant_access_controls` | org_id (row presence), access_status → effective access via `effectiveTenantAccessSql` / `resolveTenantAccess` / `getTenantAccess`; reason, changed_at, changed_by → operator **display name** | — |
| `platform_admins` | display_name (responsible operator label) | credentials, MFA material |
| `users` | counts (total, active, owners), `max(last_login_at)`; owner-role **name and e-mail** (list: the first owner; detail: at most three, oldest first) | password hashes, MFA secrets/recovery codes, password dates, sessions, staff/admin identities |
| `organization_invitations` | id (→ `INV-XXXXXXXX` reference and cursor), company_name, owner_email_normalized, country_name, created_at, expires_at | **token_hash**, company_email, owner_name, industry, currency_code, invited/revoked-by, accepted org |
| `platform_audit_events` | id, created_at, actor_label, action, result, reason (≤ 200 chars) — by exact `org_id` | before/after snapshots, IP, user agent, request id |

No `select *`, no whole ORM rows, no relational query API, no `sql.raw`, no dynamic identifiers (boundary rule 22;
verify:platform-companies §2–§3 capture every statement actually sent and scan every output for 13 sensitive markers).

### 2.3 Company access (PO-02A compatibility rule, reused)

| Stored state | Shown as |
|---|---|
| no `tenant_access_controls` row | **Active**, marked *Default* (legacy compatibility) |
| `active` / `suspended` | as stored, from the access record (reason, time, operator) |
| any other value (drift) | **Suspended**, *Invalid record* — fails closed |

Subscription state does not exist yet and never enters the decision. PO-02B shows access; it does **not** enforce
suspension at customer sign-in (PO-02C) — the UI says so wherever suspension appears.

### 2.4 Search, filters, sort, pagination

* Search (≤ 100 characters after trimming; control characters and repeated parameters refused): company name,
  **owner** e-mail (staff/admin addresses never match) and `ORG-<id>` references; `ILIKE … ESCAPE '\'` with `%`, `_`
  and `\` escaped; every value a bound parameter. `INV-` references are searched in the invitations view (the
  registered view points there).
* Filters: effective access (`active` / `suspended`), exact country; invitations: `pending` / `expired`.
* Sort allowlist: `newest` (created_at desc, id desc), `oldest`, `name` (lower(name), id). Anything else →
  `VALIDATION_FAILED`.
* Page size 1–50 (default 25). Keyset cursors `<anchor id>.<fingerprint>`: the anchor's sort key is read **in the
  database** (exact microseconds, same collation), and the fingerprint binds the cursor to its search/filters/sort, so
  a changed query restarts instead of continuing from a foreign position. Previous / next / first page; the page's
  position (offset) is counted for the "Showing 26–50 of N" summary.
* Malformed or unknown organization ids → `NOT_FOUND` (no audit record).

### 2.5 Audited detail view (PO-01B.1 policy)

`getCompanyDetail`: authorize → validate id → `assertPlatformAuditProtection()` (append-only triggers must be in force,
else `CONFIG_ERROR`, shown as the console's generic error state with a retry) → read → write **`company.viewed`**
(entity `organization` / decimal id, `org_id`, operator, result `success`, trusted client IP, user agent ≤ 512
characters, request id) → return. If the record cannot be written the call throws `AUDIT_UNAVAILABLE`, an incident
line is logged (`audit_write_failed`, `company.viewed`) and **no company data** is returned; the page shows "Company
details are unavailable". Tab switches are client-side and write nothing; list, invitation, metric and country
reads are not audited. The Activity tab never shows IP addresses, user agents or snapshots.

## 3. Pages and UI

* `/platform/companies` — four figure tiles (registered, active access, suspended, pending invitations; each a link
  into the filtered list), the Registered / Pending invitations switch, a GET search-and-filter form (the URL keeps
  the query; the form remounts with every query), a table on wide screens and one record card per company on phones,
  keyset pager, notes on enforcement (PO-02C) and on deferred package/subscription columns (PO-04/05). Invite
  (PO-02D), Export CSV (later) and the Package filter (PO-04) are disabled controls naming their phase.
* `/platform/companies?view=invitations` — company (INV reference beneath), state (Pending / Expired), owner e-mail,
  country, expiry (invited date beneath); the same fields as record cards on phones. Expired invitations still hold
  their e-mail slot (PO-02A unique index), as the view explains.
* `/platform/companies/[orgId]` — breadcrumbs, access pill, disabled Suspend/Reactivate (PO-02C) and Edit details;
  tabs Overview · Access & controls · Users · Subscription (preview, PO-05) · Activity (Platform Owner events about this
  company, 20 per page). `?tab=` deep links. Unknown ids render "Company not found" inside the console (HTTP 200: the
  console streams behind its loading boundary, so the status cannot change after the first byte; nothing is revealed).
* `/platform/dashboard` — total companies, active access, suspended and customer users are real; paid plans, trials,
  expiring soon and estimated MRR stay "—" with their phase; monthly registrations (six Riyadh months, one series,
  every value printed, an ordered list for screen readers) and the five newest companies; package mix, expirations
  and recent events stay labelled previews.

Design: the existing PlatformShell, tokens, cards, tables, buttons and typography; orange fills carry white text;
the chart uses `--accent` (light) and `--accent` stepped 15 % toward the surface (dark) — both validated (lightness
band, chroma, ≥ 3:1). Native Arabic for every string (bilingual dictionary, additive), RTL mirroring (sidebar,
breadcrumbs, pager chevrons, tab arrow keys, chart order), Latin values (e-mails, ORG/INV references, currency codes,
ranges) isolated LTR, Arabic dates with Gregorian months and Western digits, Riyadh time.

States (company access, invitation state, audit result) are the design system's status tag (`status-tag`) in its
**neutral** tone, told apart by label and icon, never by colour. In this design system only the canonical registry
(`src/lib/status-registry.ts`, DEV-UI-01.2) may assign a status colour — `verify:status-registry` and the
`ui:guardrails` G4 scan report any other status→tone map — and that registry holds customer states labelled from the
customer dictionary, so extending it is a customer design-system change outside PO-02B. One table holds the labels
and icons (`PLATFORM_STATES` / `PlatformStatusTag` in `companies-kit.tsx`); pages pass only the domain and the value.

| Domain | Value → label · icon (all neutral) |
|---|---|
| company access | active → Active · shield-check; suspended → Suspended · shield-off |
| invitation | pending → Pending · clock; expired → Expired · calendar-x |
| audit result | success → Success · circle-check; rejected → Rejected · circle-minus; failed → Failed · circle-x |

## 4. Security controls (tests/security/platform-boundary.test.mjs)

Rule 18 now covers the four sections that are still previews (Users, Subscribers, Packages, Activity) and also forbids
them the read model. New rules 21–28: only the read model touches `orgs`/`users`; the exact column allowlist; logo
presence only; no secret/contact/tax/branding identifier; no whole-row or raw SQL; every exported read authorizes
first with `platform.companies.read`; no cookie/header access in the read model; the detail view's audit order and
fail-closed handling; every console page at any depth awaits `requirePlatformSession()`; company pages read data
only through the read model; no server action or POST form on company pages, later-phase actions disabled; no
platform code references the customer session API or cookie (no token minting, no impersonation); the invitation
selection is exact and the read model writes nothing but its audit record. Rule 29: the label-and-icon table is pinned
exactly (no tone in it), the tag's tone is the literal neutral, no company page or kit component chooses a badge
variant or tone from a value, and platform code does not reach into the customer status registry.

## 5. Performance (synthetic, isolated, measured)

1,014 organizations and 4,526 users (`scripts/platform/company-fixtures.ts`, plus edge cases) on PostgreSQL 16.15;
figures from the final regression run on the committed tree (5 warm-up runs, then 60 measured runs per scenario).

| Read model, in-process (60 runs each) | p50 ms | p95 ms | max ms | queries |
|---|---:|---:|---:|---:|
| list: first page (25) | 5.6 | 6.7 | 36.0 | 5 |
| list: first page (50) | 5.7 | 7.6 | 8.6 | 5 |
| list: page 10 via cursor | 6.0 | 8.5 | 15.0 | 7 |
| list: search "Trading" | 6.7 | 7.8 | 9.9 | 5 |
| list: owner e-mail domain | 6.6 | 7.7 | 8.4 | 5 |
| list: suspended filter | 4.6 | 5.8 | 10.7 | 5 |
| list: country + name sort | 5.1 | 6.0 | 7.4 | 5 |
| invitations | 2.0 | 2.6 | 3.3 | 3 |
| metrics | 3.5 | 4.4 | 5.5 | 6 |
| countries | 2.0 | 3.6 | 4.7 | 2 |
| detail (audited) | 4.4 | 7.4 | 11.9 | 7 |

HTTP (production build, `next start`, full server render, 3 warm-up + 30 measured requests each, 1,002 organizations):
directory first page p95 59.8 ms, page 10 p95 51.5 ms, search p95 51.5 ms, invitations p95 48.5 ms, detail p95
26.5 ms, dashboard p95 23.8 ms. All far below the 2.5 s target (NFR-09). Query counts are independent of page size
(10/25/50 → 5): no N+1; the detail view always costs 7 queries.

Plans at this size are sequential scans (the four captured plans execute in 0.4–1.7 ms). **Index recommendations — not applied (no schema change
in PO-02B); for review with D-6/D-7 measurements:** `users (org_id)` (per-page user summaries; also helps tenant code),
`orgs (created_at desc, id desc)` (newest/oldest keyset without sorting all organizations), `orgs (lower(name), id)`
(name sort), and only if volumes grow by orders of magnitude, trigram (`pg_trgm`) indexes for substring search on
`orgs.name` and owner e-mails.

## 6. Verification

| Suite | Checks |
|---|---|
| `verify:platform-companies` (new, in `verify:platform`) | 190 |
| `verify:platform-companies-browser` (new; needs `next build`) | 111 (48 language × theme × width audits + screenshots) |
| `verify:platform-boundary` | 78 (52 → 78; rule 18 narrowed to the four previews; rules 21–29 new) |
| `verify:platform-company-schema` (PO-02A) | 107 (section 8 allow-lists the read model; import resolver + self-test) |
| `verify:platform-browser` (PO-01B) | 138 (two checks restated for the operational pages) |
| `verify:document-form` / `verify:page-archetypes` | 84 / 274 (PO-02B layer and group 25) |
| `verify:static` (22 customer/design-system suites), security tests, `ui:guardrails` | all at baseline (see the handover) |

Approved-delta tamper tests (scratch): an unrecorded guards edit, the read model selecting the company e-mail, an
unrecorded module reading `users`, a customer file edit, a recorded rewrite of an existing translation and a recorded
extra permission — all six caught; files restored byte-exactly. Rule 29 tamper tests: a state-derived callout tone, a
re-toned table entry and a local `<Badge variant={…}>` — all three caught.

### 6.1 Corrections found by the final regression

The full regression on the committed tree (run before pushing) found four defects. Each was fixed in separate
commits, and every fix was followed by a complete rerun:

1. `verify:status-registry` 89/90 — a `<Badge>` variant chosen from the access status. Fixed by presenting states
   through one table (`71a9ea6`), then made colour-free when (2) showed the table itself is a local status→tone map.
2. `ui:guardrails` G4 0 → 2 (report-only, not a gate) — the tone table. Fixed: neutral tags, label + icon (`2b9f51b`).
3. `verify:money-precision` 11/12 — a `maximumFractionDigits: 0` literal in the count formatter; hidden at first
   because the `verify:static` chain stops at its first failure (`8834352`).
4. `verify:platform-company-schema` 105/106 — the PO-02A import check matched only `…/platform/company-access`
   spellings, so the read model's relative import was invisible (the PO-02A version had the same blind spot); now
   resolved properly with a self-test (`7933763`).

Screenshot review then moved the invitations table's state next to the company (it sat off-screen at 1440 px) and
start-aligned Arabic names in English tables (`cfcf992`).

## 7. Change control

`verify/po02b-approved-delta.mts` records PO-02B against `2a5674a`: 35 hunks in 7 files (guards, strings, stylesheet,
Companies and Dashboard pages, the two freeze verifiers) and 6 added files. Undone, every file is PO-02A's to the
byte, so every older pin (ACC-01, LCP, PO-01A, PO-01B, PO-01B.1, PO-02A) keeps its strength; nothing was
re-baselined. Group 25 pins the guards delta (one permission appended), and that the strings and stylesheet deltas
are purely additive.

## 8. Local preview (owner inspection; loopback `_test_only_` databases only)

```
PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> npm run platform:preview-db
export DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<the printed *_test_only_* name>
npm run platform:bootstrap               # fictional Platform Owner + authenticator enrolment
npm run platform:preview-companies 120   # synthetic companies, users, access rows and invitations
npx next build && PLATFORM_CONSOLE_ENABLED=true npx next start -p 3000 -H 127.0.0.1
# open http://localhost:3000/platform/login → Companies, a company, Pending invitations, Dashboard
```

`platform:preview-companies` refuses any non-loopback or non-`_test_only_` target, a server listening beyond loopback,
and a database that already holds organizations.

## 9. Limitations and open decisions

* Suspension is displayed, not enforced, until PO-02C. Global header search remains a preview.
* Unknown company ids return the not-found state with HTTP 200 (streaming); the read model returns `NOT_FOUND`.
* Detail views write one audit record per page load (by design); a high-traffic future may want sampling — owner call.
* Owner e-mails are visible in the (unaudited) list for the first owner of each company; the full owner list (≤ 3)
  only in the audited detail. Owner decision whether list views should also be audited or masked.
* Package / subscription / renewal columns are deferred (PO-04/05), not shown as placeholders in rows.
* Index recommendations above are not applied (schema frozen in PO-02B).
* The detail view reads the effective access (`getTenantAccess`) and the access record's reason, time and operator in
  two statements. Nothing writes access records before PO-02C, so they cannot disagree today; PO-02C must read status
  and reason in one statement (or one snapshot) once suspension writes exist.
* `INV-` references are searched in the Pending invitations view; typing one in the Registered view shows a pointer
  there (an invitation is not yet a company).
* A detail view writes an audit row with `org_id` (`ON DELETE RESTRICT`, Schema.md §3.4), so a viewed organization
  can no longer be hard-deleted. No application path deletes organizations (three customer test scripts delete their
  own fixture organizations on disposable databases). Consistent with the no-deletion rule; owner to confirm.
* Platform Owner states are neutral status tags (§3): Suspended is told apart by label and icon, not by a danger
  colour. Owner decision: keep them neutral, or approve a design-system change that adds platform domains (and their
  Arabic labels) to the canonical status registry so access, invitation and result states get status colours —
  best decided with PO-02C, which makes suspension operational.
* Earlier open decisions remain: D-6 migration mechanism, D-7 production measurements, D-8 legacy jti-less tokens,
  invitation package fields, suspension sign-in message, 30-day invitation ceiling, applied-file ledger.

## Appendix — proposed PO-02C prompt (NOT executed; for owner review)

~~~text
ELITE ERP — PLATFORM OWNER SYSTEM
PHASE PO-02C — COMPANY SUSPENSION, REACTIVATION & CUSTOMER ACCESS ENFORCEMENT

PROJECT BASELINE
Repository: Delowar01/Elite-ERP · Development branch: feat/platform-owner
Approved PO-02B head: <the PO-02B commit the owner approves>
Live production baseline: 621f156f7b129b9c2e289bc46d314ce7587beec2 (must remain untouched)
Planning reference: Draft PR #11 (357e93e) — PRD P-03 and the "Company suspension" rule, Plan.md PO-02
gate + ORG-03/ORG-04, appflow §1/§4/§10, TRD §3.3 "Mandatory integration" + §8 setCompanyAccess,
Schema.md tenant_access_controls / sessions
Reference documents: PO00_BASELINE.md (G-1/G-2/G-3/G-10, D-8), PO01B1_SECURITY_CORRECTIONS.md (audit
atomicity), PO02A_DEVELOPMENT.md §6.3 (contract + customer-auth touch points), PO02B_DEVELOPMENT.md

OWNER DECISIONS FIXED BY THIS APPROVAL (amend before approving)
- D-8: the central customer session gate rejects legacy jti-less tokens (expected impact nil: every
  token since 2026-07-18 carries a jti; 30-day expiry).
- Sign-in message: until the password (and the customer second factor, where enrolled) is verified,
  every failure stays generic; after successful verification a suspended company's user sees a neutral
  EN/AR "Your company's access is suspended. Contact your service provider." and no session is issued.
- Step-up: suspend and reactivate require the Platform Owner's password + authenticator code (the
  PO-01B step-up), the typed company reference (ORG-xxxxxx) and a reason of 10–500 characters.
- Reactivation never restores revoked sessions: every user signs in again.
- Status colour: Platform Owner states stay neutral status tags (as in PO-02B). Alternative, if chosen:
  add platform domains to the canonical status registry (src/lib/status-registry.ts + Arabic labels in
  the customer dictionary) as the only customer design-system change of this phase, recorded in the delta.

AUTHORIZATION
PO-01A … PO-02B are accepted. I authorize PO-02C only: (1) suspend and reactivate a registered company
from the Platform Owner console; (2) a narrowly scoped change to customer authentication and session
validation so that a suspended company can neither sign in nor use an existing session, page, server
action, export, print, PDF or protected file. Commit and push only to feat/platform-owner.
You must NOT: merge or deploy; open or close a PR; access production Neon/VPS or customer databases;
run production migrations or db:push (D-6 stays open); change the database schema; change customer
business logic (accounting, invoices, documents, HR, inventory, posting), tenant roles or permissions;
edit or delete customer data; suspend automatically on any subscription state; implement invitations
(PO-02D), company-metadata editing, user management (PO-03), packages/subscriptions (PO-04/05), CSV
export or outbound notifications; add impersonation; start PO-02D or later phases.
Disposable loopback `_test_only_` PostgreSQL databases and synthetic fixtures only.

STEP 1 — BASELINE: fetch GitHub; verify main = 621f156, feat/platform-owner = the approved PO-02B head,
PR #11 draft/unmerged; rerun verify:platform (incl. verify:platform-companies), verify:static, the
security tests, both platform browser suites and the freeze verifiers. Re-read every touch point in
PO02A_DEVELOPMENT.md §6.3 and ENUMERATE all customer entry points (pages, layouts, server actions, route
handlers, export/print/PDF/upload/file routes, public links, signed URLs) with their current guard.
Stop and report if the approved source or the touch points differ unexpectedly.

STEP 2 — PLATFORM ACTION setCompanyAccess (server-only console core)
- New permission `platform.companies.manage_access` (narrow PLATFORM_PERMISSIONS extension, tested);
  reading stays `platform.companies.read`.
- Order: flag → origin/CSRF (PO-01B) → live platform session → permission → step-up (throttled) →
  validation (orgId, target active|suspended, reason, typed reference, request key) → ONE transaction:
  1. SELECT … FROM orgs WHERE id = $1 FOR UPDATE (unknown → NOT_FOUND); lock or insert the
     tenant_access_controls row (absent = active, legacy).
  2. Unchanged target → no-op returning the current state (no second success audit).
  3. Write status, reason, changed_by_platform_admin_id, changed_at, updated_at (PO-02A CHECKs hold).
  4. On suspend: revokeOrgSessions(orgId, 'org_suspended', tx) — UPDATE sessions SET revoked_at = now(),
     revoked_reason = 'org_suspended' WHERE org_id = $1 AND revoked_at IS NULL (M4 index); count them.
  5. Append platform_audit_events (company.suspended / company.reactivated, entity organization/<id>,
     org_id, before/after status, reason, revoked-session count) INSIDE the transaction: an audit
     failure rolls everything back, returns AUDIT_UNAVAILABLE and logs an incident (PO-01B.1).
  6. Commit. A platform logout or expiry while the dialog is open rejects the action, no partial update.
- Concurrent double-submits serialize on the org row lock: exactly one change and one success audit.

STEP 3 — CUSTOMER ACCESS GATE (the only customer-auth changes allowed; each recorded in the delta)
- src/lib/session.ts lookupSessionByToken: the central gate — LEFT JOIN tenant_access_controls; deny
  unless the effective access (effectiveTenantAccessSql) is active (no row → active; invalid value →
  denied); reject jti-less tokens (D-8); measure and report sessions.org_id = users.org_id (PO-00 Q07)
  before enforcing it. getSession / requireSession / requireRole inherit the gate unchanged.
- src/app/(auth)/actions.ts loginAction: after credential (and customer MFA) verification and before
  issueSession, refuse a suspended company with the decided message and a customer security event; no
  session row is created and a refused sign-in consumes no recovery code. issueSession re-checks access
  inside (defence in depth; registerAction keeps working for new companies).
- src/lib/security/session-store.ts: add revokeOrgSessions(orgId, reason, tx) only.
- src/app/uploads/[...path]/route.ts: the session path inherits the gate; prove HMAC-signed URLs are not
  minted today, or deny them for a suspended org — report which.
- Exports, print, PDF and any handler not using getSession: close every gap found in STEP 1 with the
  same central check (no business-logic edits).
- Denied requests reach one bilingual "access suspended" screen (EN/AR, RTL, light/dark, responsive);
  logout keeps working; nothing is deleted or edited. The Edge proxy is unchanged.
- Deployment-order risk: this gate needs the PO-02A tables. A missing table must fail closed with an
  incident log, and the PO-07 runbook must apply and verify the PO-02A migration (D-6) before this code
  ships. Document it.

STEP 4 — UI (existing PlatformShell and PO-02B components; no redesign)
- Enable Suspend / Reactivate on the company detail (Access & controls tab and header) — the only newly
  enabled control. Dialog: consequences (all users signed out, no sign-in, data preserved, subscription
  unaffected), reason, typed ORG reference, step-up password + code, confirm; pending / success /
  failure / audit-unavailable states; focus trap, Escape, focus return; a full-height sheet on mobile.
- Afterwards the access pill, reason, time, operator, Activity tab and directory/dashboard counts update.
- The detail view reads access status and reason in ONE statement (PO-02B note).
- States keep the decided status-colour policy; verify:status-registry and ui:guardrails G4 stay at baseline.
- Invite, Edit, Export, Manage users and package/subscription controls stay disabled.
- Native Arabic + RTL; EN/AR × light/dark × 1440/1024/390; keyboard and focus; screenshots.

STEP 5 — SECURITY: boundary rules — only the action core writes tenant_access_controls; only
revokeOrgSessions bulk-revokes customer sessions; one central gate; no customer token minting; no
impersonation; platform and customer sessions never accepted by each other; reasons bounded, stored as
text, rendered escaped; no customer business table read or written; origin check and rate limit on the action.

STEP 6 — TESTS: new suite verify:platform-company-access plus extensions:
- Action: authorization matrix (flag, session, permission, origin, step-up failure + throttle),
  validation, idempotent repeat, concurrent double-submit, audit-failure rollback (state unchanged,
  sessions not revoked), revoked-session counts, reactivation without session restoration.
- Gate (ORG-03/ORG-04, T11, G-1/G-2/G-3/G-10): with a live customer session, after suspension every
  page, direct server-action POST, export, print/PDF and protected file is denied; sign-in is refused
  with the decided message; a session missed by the revoke is still denied; a jti-less token is denied;
  a suspension racing a concurrent server action; after reactivation a fresh sign-in works and business
  rows are byte-identical (checksums before/after).
- Unaffected companies: the customer regressions stay green (verify:static, ACC-01 suites, document and
  finance smoke); companies without an access row keep working.
- Performance: customer session lookup p95 before/after on 1,000 synthetic organizations.
- Browser: dialogs and the "access suspended" screen across languages, themes and widths.
- Rerun everything in STEP 1, tsc, ESLint, ui:guardrails (G1–G5 against baseline) and the build; run each
  verify:static suite on its own as well, so one failure cannot hide the next; report exact counts,
  failures, corrections and skipped tests; never report an unexecuted test as passed.

STEP 7 — CHANGE CONTROL: a PO-02C approved-delta layer recording every customer file touched hunk by
hunk; all other customer pins unchanged; ACC-01, LCP, PO-01A, PO-01B, PO-01B.1, PO-02A and PO-02B layers
preserved; no silent re-baseline; no weakened test.
STEP 8 — GIT: feat/platform-owner only; reviewable commits; no force-push, rebase, merge or deploy.
STEP 9 — HANDOVER: A status · B branch/SHA · C files · D action + transaction design · E customer gate:
every entry point with its proof · F UI + screenshots · G authorization, audit and atomicity evidence ·
H concurrency and race evidence · I test counts · J ERP regression proof (unaffected tenants, data
preserved) · K deployment-order risks, limitations and owner decisions · L proposed PO-02D prompt.
STOP GATE: stop after the PO-02C handover. No production change, no real company suspended, no
invitations, no merge, no deployment; 621f156 stays untouched.
~~~
