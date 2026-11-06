# Elite ERP — Platform Owner Console (Stage 2)
## Product Requirements Document (PRD)

| Field | Value |
|---|---|
| Product | Elite ERP SaaS — Platform Owner Console |
| Specification | Stage 2 / Release Candidate v1.0 |
| Date | 2026-11-06 |
| Status | **Planning baseline — implementation and deployment not authorized by this document** |
| Repository | `Delowar01/Elite-ERP` |
| Primary reference | `Elite_ERP_Platform_Owner_Stage2_Interactive.html` (standalone simulated prototype) |
| Visual reference | Supplied Elite ERP × Lead Capture Pro design kit and master prompt |
| Related specifications | `appflow.md`, `UI_spec.md`, `TRD.md`, `Schema.md`, `Plan.md` |

## 1. Objective and positioning

Build a secure platform-operator control console **within the existing Elite ERP SaaS application**. Elite ERP already has customer organizations with `owner`, `admin`, and `staff` users. It does **not** have an implemented, separate SaaS Platform Owner identity or subscription system in the reviewed `main` snapshot (`83e8093`). Stage 2 adds management of organizations, their users, subscriptions, catalog packages, and manual payments without intruding into their ERP transactions.

**Product principle:** the platform operator controls SaaS access and commercial relationships; tenant organization users operate the ERP. These are separate trust domains.

### 1.1 Business goals

1. See a reliable cross-tenant view of organizations and subscription health.
2. Onboard new organizations through controlled invitations.
3. Inspect and control organization access without deleting business data.
4. Manage customer user invitations, status, roles, sessions, and primary ownership.
5. Create, version, assign, duplicate and archive commercial packages.
6. Extend or pause subscriptions and record payments manually.
7. Maintain an immutable, traceable record of platform actions.
8. Preserve existing ERP workflows, security, tenant isolation, financial accuracy and the ongoing visual-redesign branch.

### 1.2 Product users

| Persona | Access |
|---|---|
| Platform Owner | Initially **one** tightly privileged platform account with mandatory MFA, covering all seven console sections. Additional platform staff roles are deferred. |
| Company Owner | Existing `users.role = owner`, restricted to their own tenant ERP. Not a platform operator. |
| Company Admin / Staff | Existing tenant-scoped users and existing ERP permissions. |
| Invited company owner/user | A pending, limited-use invitation recipient; no authenticated ERP access until acceptance. |

### 1.3 Canonical words

- **Company / tenant / organization:** one row in existing `orgs` after successful registration.
- **Company invitation:** pending registration request; not yet an ERP organization. In the list it displays an `INV-…` reference, not a real organization ID.
- **Company access:** platform decision `active` or `suspended`, distinct from subscription lifecycle.
- **Customer user:** an existing ERP `users` row with one `orgId`; invitations are separate pending records.
- **Package:** a commercial catalog item; its **immutable published version** captures price and allowances.
- **Subscription:** a tenant's assigned package/version, cycle and term; subscription status never by itself grants platform power.
- **Manual payment:** an operator-entered receipt *record* for a subscription. It does not automatically mark a subscription paid, issue a tax invoice, or post to the customer's general ledger.
- **Estimated MRR:** normalization of assigned recurring package prices, **not** collected cash or accounting revenue.

## 2. Scope by release tier

### 2.1 Stage 2 operational release — included (Must)

| ID | Capability | Operator actions and outcomes |
|---|---|---|
| P-01 | Platform access | Isolated Platform Owner login, mandatory MFA, recovery, session revocation, server-side authorization and audit. |
| P-02 | Dashboard | Total organizations, active/suspended, invitations, trial subscriptions, assigned paid subscriptions, users, upcoming expiries, estimated MRR, registrations and package mix. |
| P-03 | Companies | Search/filter/export metadata; view details, notes, country, contact and owner; invite, edit permitted metadata, suspend/reactivate, inspect users/subscription/history. |
| P-04 | Users | Cross-company directory; invite company admin/staff, view role/status/last login, change role, disable/enable, revoke sessions, resend pending invitation, transfer primary ownership. |
| P-05 | Packages | Trial / Starter / Growth / Business sample tiers (names/prices **illustrative**), create, edit via **new version**, duplicate, archive when unassigned; monthly/annual price, seats, storage and module groups. |
| P-06 | Subscribers | Cross-tenant subscription table; assign/change package and billing cycle, set/extend term, pause/resume, inspect history and payment records. |
| P-07 | Manual payments | Amount, SAR currency, date, external reference, cycle/note, duplicate prevention, operator attribution; payment does not automatically extend a term. |
| P-08 | Activity Log | Immutable searchable operator activity; reason, actor, company, time, before/after metadata where safe, CSV export. |
| P-09 | Settings | Default trial 14 days, informational grace period default 0, invite-only onboarding, renewal alerts, manual billing, mandatory MFA fixed on. |
| P-10 | EN/AR and themes | Complete English LTR and native Saudi Arabic RTL; light/dark; desktop/tablet/mobile; LCP-derived design with white text on orange. |

### 2.2 Staged enforcement — included only when corresponding technical gate passes

| Control | Stage 2 policy |
|---|---|
| Company suspension | **Enforced from first live release** across authentication, pages, server actions, exports, print/file access, and existing sessions. No deletion. |
| User disable and session revoke | **Enforced from first live release**. No password access for platform operators. |
| One active primary company owner | **Enforced from first live release**, including atomic transfer and session invalidation. |
| Package user seat count | Enforce centrally on **all user creation/invitation paths** only after baseline audit and grandfathering tests; existing over-limit companies retain current users, but cannot add new ones until compliant or upgraded. This is a Stage 2 go-live gate, not a front-end-only visual restriction. |
| Package module groups | **Catalog / entitlement preview only** in Stage 2. No ERP feature is hidden or blocked from customers until a separate, tested module-entitlement rollout is approved. Display “Configured — not enforced yet.” |
| Package storage allowance | **Catalog / reporting only**. No quota enforcement, file deletion or upload blocking in Stage 2. Display “Configured — not enforced yet.” |
| Expiry / grace period | Display and alert only. **Never automatically suspend** an organization when a subscription expires; manual suspension is separate. |

### 2.3 Explicitly excluded

- Payment gateway, subscriptions to third-party billing services, automatic collection, automatic tax invoices, VAT treatment of platform revenue, refunds, finance-ledger posting, dunning automation.
- Platform support impersonation, opening customer invoices/files/HR/ledger, editing a customer's transactional data, cross-tenant business exports.
- Deleting tenants, databases, financial records or subscription payment history; bulk destructive actions.
- Automated module authorization, storage metering/quota enforcement, usage-based charges, per-feature billing, reseller management, multiple platform-operator roles.
- Native mobile app, AI, advanced analytics, multi-currency subscription pricing/FX, automated public self-signup.
- Changes to existing customer ERP domain workflows, financial posting, ZATCA, PDFs or tenant branding.

## 3. Functional requirements and acceptance

### P-01 Platform authentication

- Only bootstrapped, verified Platform Owner principals can sign in at `/platform/login`; tenant login cannot authorize `/platform/*`.
- Password + TOTP MFA is required on every platform login; recovery codes are one-time and hashed. Sessions are revocable, bounded and isolated from customer sessions.
- Account bootstrap is an audited deployment operation; do not expose a signup page or embed default credentials.
- Unauthorized calls return no tenant metadata. All state changes check platform authority on the server.

**Acceptance:** tenant owners and forged/cross-tenant tokens cannot read `/platform/companies`; locked or revoked platform sessions have no access; MFA bypass attempts fail.

### P-02 Dashboard

- KPI cards: total companies, active, suspended, invited, user count, trials, active paid assignments, expiring soon (default 20-day window), and estimated MRR in **SAR**.
- Registrations chart and package mix use real server-derived metadata, not fabricated time series.
- Estimated MRR = sum of active assigned monthly package prices + annual package prices / 12, with clearly labeled approximation; exclude expired/paused and unaccepted invitations; never label it invoiced or collected revenue.
- Cross-links open matching filtered Companies, Subscribers and Packages views.

**Acceptance:** KPI totals reconcile with underlying filtered counts and update after successful changes.

### P-03 Company management

- Show active organizations and pending company invitations together but distinguish `orgId` from `inviteId`.
- Filter by access state, country and package; search name, owner/contact email; paginate server-side; export **metadata only**.
- Company drawer tabs: Overview, Access & controls, Users, Subscription, Activity.
- Edit company **platform-managed metadata** and notes; do not silently overwrite the tenant-controlled legal/tax/base-currency fields. Where a shared field exists, show read-only or require an explicitly approved synchronization rule.
- Suspension requires typed/explicit confirmation and a reason. Automatically revoke all customer sessions; restored tenants reauthenticate. Preserve org and transactional data.
- No tenant-delete action.

**Acceptance:** suspended tenant cannot use a previously open session or invoke actions directly; after restore a fresh login works and historical records are intact.

### P-04 User management

- Search/filter by company, role and status; show confirmed account last-login timestamp, not inferred activity.
- Invitations are single-use, hashed, expiring (default 72 hours), with resend invalidating the previous token. Admin/staff are selectable for existing companies; new company creation reserves owner invitation separately.
- Customer users can be activated/disabled and have all sessions revoked. Role changes invalidate sessions immediately.
- Primary ownership transfer only to an **active user belonging to the same company**; old owner becomes admin and new owner becomes owner atomically. At least one primary owner remains.
- Existing `users.email` uniqueness across the full ERP is honored; multi-company user membership is deferred.

**Acceptance:** duplicate emails, cross-company transfer, last-owner disable/demotion, stale invitation replay, and unauthorized tenant changes are rejected server-side.

### P-05 Package catalog

- Editable name, description, status, currency SAR, monthly price, annual price, seats, storage GB, module group labels, optional trial days.
- New version rather than in-place retroactive mutation for a published package's commercial attributes; current subscriptions retain their assigned package version until explicitly reassigned.
- Duplicate creates a new draft/catalog item. Archive blocks **new assignment** and is refused when current live subscriptions still depend on the package, consistent with the prototype's safeguard.
- Built-in default Trial package cannot be archived. Prices in the prototype (SAR 149 / 349 / 799 etc.) are demo values, **not approved sell prices**.
- All module/storage badges explain that enforcement is deferred.

**Acceptance:** historic subscription price/limits remain unchanged after a package edit; archived packages are unavailable for new assignments but visible in history.

### P-06 Subscriptions and subscribers

- Subscribers are tenant companies with actual assigned subscriptions; pending invitations may appear separately as “planned package,” not as subscribers.
- Assign active package version and cycle (`trial`, `monthly`, `annual`), start/end dates, notes and source; validate Trial only uses trial cycle.
- Manual extension from later of current expiry or today; permissible preset periods 14/30/90/365 days, with custom controlled date if required.
- Pause/resume changes subscription state, not company access. Record reason and audit. Expired is determined by dates; expiry does not trigger suspension.
- Version and price snapshots ensure reproducible history.

**Acceptance:** renewal at/after expiry behaves predictably; no hidden money collection; company access and subscription states remain independent.

### P-07 Payment ledger (operator notes)

- Operators may record positive amount in SAR, payment date, reference, subscription, cycle and note.
- Reject duplicate submission using request-idempotency and external reference checks; append-only financial evidence, no silent edits or deletion. Corrections use a clearly audited reversal/void record rather than overwrite.
- Recording payment **never** posts to tenant accounts, issues legal tax documentation or renews the subscription automatically.

**Acceptance:** repeated submit creates at most one record; subscription term is unchanged until Renew action is separately approved.

### P-08 Audit and exports

- All security-sensitive operations record actor, timestamp UTC, target, before/after summary (safely redacted), reason, result and request ID. Keep append-only database protection.
- Scoped metadata CSV exports: companies, users, subscriptions, audit only. Never export password hashes, MFA keys, invitations' token values, customer business data or private files.
- Search and pagination; any export itself is an audited event.

### P-09 Settings

- Configure default trial 1–120 days (initial 14), informational grace 0–60 days (initial 0), expiry alerts on/off, invitation-only onboarding (on and locked for Stage 2), mandatory MFA (on and locked), manual billing (on and locked).
- Changes do not retroactively change current subscriptions/invitations. Security values fail closed.

## 4. Nonfunctional requirements

| Code | Requirement |
|---|---|
| NFR-01 | Every read/action is authorized server-side with a dedicated platform principal. No customer ERP super-admin bypass. |
| NFR-02 | Existing `orgId` isolation remains intact. Platform queries are explicitly allowlisted **metadata-only** queries. |
| NFR-03 | Sensitive state changes are transactional, idempotent where retries are possible, and auditable. |
| NFR-04 | Multi-device session invalidation and concurrent transfer/invite/renewal tests pass. |
| NFR-05 | English and Arabic labels, errors, confirmations, date/currency display; RTL controls work. |
| NFR-06 | 360px through wide desktop usable; dense tables scroll **internally**. |
| NFR-07 | Lighthouse/axe and browser visual checks; reduced motion, keyboard focus, safe dialogs, contrast checks. |
| NFR-08 | No sensitive logs, test customer secrets, DB dumps, tokens or backups in the repository. |
| NFR-09 | Initial test goal: p95 platform list response under 2.5s on a seeded 1,000-org test dataset, subject to measured VPS/Neon baselines. |
| NFR-10 | Additive migrations, verified DB/storage backups, restore and rollback plan; no production changes without owner approval. |

## 5. KPIs and product success

- 100% of platform-only routes reject customer credentials.
- 100% of suspension/disable/role-transfer tests show immediate server-enforced denial of stale sessions.
- 100% of package changes retain old subscription price/version history.
- 100% of critical mutations emit immutable audit records.
- Zero cross-tenant data exposure in security tests.
- No regression in ACC-01, document lifecycle, PDFs, customer MFA and tenant isolation.
- Owner can complete company invite → acceptance → plan assignment and user invite → acceptance without database/manual SQL intervention.

## 6. Decisions and remaining explicit approval gates

**Product decisions recorded in this specification:** seven Stage 2 console sections; invite-only onboarding; separate platform auth; manual billing; company/user access controls; immutable package versions; subscription/access independence; no customer data access; tenant data preservation; non-enforced module/storage labels; centrally enforced seats after acceptance testing.

**Still requires owner action before live execution:** (a) confirm actual Starter/Growth/Business price list and default seats, (b) designate the initial Platform Owner identity and secure bootstrap channel, (c) approve production registration policy cutover, (d) accept the final LCP visual implementation branch, (e) separately authorize migration/merge/deployment and any seat-cap behavior on existing tenants. No email-sending service is required for the initial copy-link invitation workflow.

## 7. Reference fidelity / interpretation notes

The prototype demonstrates the **seven-section layout and simulated actions**, not actual API contracts, security, data structures, payment logic or live status enforcement. Its local `localStorage` state, generated invitation links, fixed demo date (2026-11-06), fictional companies, and sample prices are not production specifications. The rules above convert that concept into a safe proposed production behavior. The six documents together define the intended implementation; any divergence must be documented and approved through the existing independent-review gate.
