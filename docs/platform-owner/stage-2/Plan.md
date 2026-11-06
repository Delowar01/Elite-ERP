# Elite ERP Platform Owner — Implementation Plan
## Stage 2 · Delivery roadmap, dependencies, QA gates, release and handover

**Version:** 1.0 · **Date:** 2026-11-06  
**Status:** **Prepared for owner review and Claude Code implementation authorization.** This plan does not grant permission to merge, migrate, deploy, restart or touch production data.  
**Source artifacts:** `Elite_ERP_Platform_Owner_Stage2_Interactive.html` (fictional interactive prototype), LCP design-system kit, existing ERP `main` at `83e8093`, latest in-progress LCP visual-design feature branch.  
**Canonical requirements:** `PRD.md`; flows `appflow.md`; UI `UI_spec.md`; technical contract `TRD.md`; proposed database `Schema.md`.

## 1. Executive delivery strategy

Build the seven-section Platform Owner console in small, independently reviewable batches. **Security foundations and company access control precede commercial features**. Existing ERP financial and tenant operations must remain stable. The concurrent LCP redesign is UI-only; this project adds schema/auth/business functionality and therefore belongs on a **separate** branch after source/design synchronization.

**Locked seven pages:** Dashboard, Companies, Users, Subscribers, Packages, Activity Log, Settings.  
**Initial operator:** One Platform Owner account, MFA mandatory.  
**Business mode:** Invitation-only onboarding, manual subscriptions and SAR manual-payment records.  
**No automatic client lock:** expired/paused subscription does not suspend company; only explicit platform access control does.  
**No third-party billing subscription:** copy-link invites and manual bank/payment references suffice for MVP.

## 2. Delivery phases and dependencies

| Batch | Core deliverable | Dependencies | Mandatory completion evidence |
|---|---|---|---|
| **PO-00** | Read-only audit, scope freeze, design-system integration matrix, current Git/DB/security baseline | Existing main + LCP branch inspectable | `PLATFORM_OWNER_BASELINE.md`, migration risk matrix, owner-role anomalies, test baselines; **zero mutations** |
| **PO-01** | Separate platform admin identity, MFA/login/session/recovery/route boundary, audit/hardening foundation, shared shell | PO-00 approved | Platform-vs-tenant auth isolation, rate limit, MFA, session revocation, route 403/redirect, immutable audit tests |
| **PO-02** | Organization list/drawer, pending organization invitations, accept flow, tenant access controls, suspension/restoration | PO-01 | End-to-end invite→org+owner+seed; live-session suspension enforcement; no customer data access |
| **PO-03** | User directory, admin/staff invitations, disable/enable, session revoke, role change, primary-owner transfer, central seat check | PO-02 | Last-owner safeguard, concurrency, all tenant user-create paths covered, grandfathering tests |
| **PO-04** | Package catalog, immutable published versions, duplication, archive rules, trial default and module/storage labels | PO-01; PO-02 identity | Version snapshots immutable, pricing validation, archive safeguards, bilingual UI |
| **PO-05** | Subscribers view, package assignment, renew/extend, pause/resume, payment receipts/reversals, dashboard metrics | PO-04 + PO-03 seats | No auto ERP lock, no tenant GL postings, monetary precision, idempotency, correct MRR label and counts |
| **PO-06** | Activity Log, settings, metadata export, complete EN/AR RTL, light/dark, responsive polish and security/financial regressions | PO-01 through PO-05 | Full route matrix, screenshot and interaction evidence, cross-tenant and ACC-01 green |
| **PO-07** | Controlled launch readiness: production schema dry run, backup/restore, deployment plan, owner approvals, post-deploy smoke/rollback | PO-06 accepted | Exact approved SHA, isolated migration proof, signed checklist; **separate deployment authorization** |

**Parallel work:** PO-04 package frontend may be developed in parallel with PO-03 after PO-02 establishes the minimum Trial and company identity foundation, but no shared schema conflicts or mixed PRs. The central seat guard must be accepted before assigning enforceable packages to real tenants.

## 3. Detailed work packages

### PO-00 — Independent baseline and acceptance contract

- Independently fetch `Delowar01/Elite-ERP` current `main`, `feat/erp-lcp-design-system` and open PR statuses. Record exact parent/base SHAs, diffs and pending mutations. Do not assume `83e8093` is still latest when execution starts.
- Inspect Next.js route group/proxy, `src/lib/auth.ts`, `session.ts`, `tenant.ts`, `security/session-store.ts`, `orgs.ts`, `users.ts`, existing user management, DB seed and `audit_logs` triggers.
- Read kit palette/token adapter from final LCP branch; prevent raw HSL property collisions. Validate mandatory white-on-orange rule using a tested darker text-bearing orange (`#C95000` passes ~4.53:1 with white; exact `#FF6600` does not).
- Audit every path where a user account or session is created, existing owner-role irregularities, public registration, public file/print/export endpoints, token lifetime, backups, tenant-suspended bypasses.
- Create the full route/permissions list, schema drift diff, rollback matrix and performance baseline on synthetic/test data.

**Gate:** Owner receives one read-only report and approves the implementation branch strategy. No migration is allowed in PO-00.

### PO-01 — Secure platform foundation

- Add proposed platform auth/session/audit infrastructure in **isolated test DB**.
- Bootstrap procedure for one administrative identity with MFA and recovery-code policy; never create default credentials in Git/seed.
- Implement separate `/platform/login`, guarded layout/actions and browser session handling. Maintain existing customer auth with a different cookie and claims domain.
- Implement privileged login throttling, CSRF/origin and session-revocation tests, immutable platform audit triggers.
- Build the platform header/sidebar/page primitive from the final LCP design-system tokens; EN/AR light/dark shells.

**Gate:** Tenant tokens cannot access Platform routes; Platform token cannot authorize tenant ERP actions; all platform auth/MFA tests green. Commit and stop for review.

### PO-02 — Companies + onboarding + suspension

- Add and test `organization_invitations`, `tenant_access_controls`, initial `tenant_primary_owners` mapping and company metadata read model. Provision the **minimum Trial package/version and current-subscription schema** as an internal prerequisite; full commercial package management arrives in PO-04. Until then, invitation onboarding can use Trial only.
- Reuse existing org+owner+seed transaction on acceptance; add initial trial/plan and primary owner records only after validated invitation acceptance.
- Build company list, filters, metadata CSV, company detail tabs and safe platform-owned contact notes. No customer transaction browser.
- Integrate access gate into **every** existing customer auth/session/server action/file/print/export path, as applicable; revoke sessions on suspend.
- Add explicit confirmation, reason and platform audit on suspension/restoration.

**Gate:** A suspended company with an already-open browser cannot view or mutate its ERP; restore requires fresh login; no data was deleted or edited; cross-tenant reads denied.

### PO-03 — User operations

- Create user invite accept/reissue with hashed tokens and duplicate email protection.
- Link company primary owner through canonical mapping; preflight and safely resolve legacy ambiguous owners with separate approval.
- Implement cross-tenant user list, role/status, disable/enable, revoke sessions and same-company active-owner transfer.
- Wire shared seat check to *every* account-creation/invitation path, including existing tenant user-management flows; transactional concurrency lock, disabled-users-count rule and legacy over-seat grandfathering.
- Add comprehensive acceptance and adversarial browser tests.

**Gate:** No bypass of seats; no role elevation by crafted requests; one valid primary owner retained; two concurrent transfers do not split state.

### PO-04 — Package catalog

- Add catalog and versioned commercial records; published prices/allowances immutable; draft/publish/edit-new-version workflow.
- Manage Trial plus configurable Starter/Growth/Business names as **catalog templates**, not the fictional HTML prices.
- Build create/edit/duplicate/archive cards and modals with monthly/annual SAR price, seats, storage, feature group labels, published version and subscriber count.
- Clearly mark modules and storage **not enforced**; verify new package version does not mutate a customer's current snapshot.

**Gate:** Version history intact, can’t archive default Trial or currently assigned package, invalid pricing refused, EN/AR and both themes checked.

### PO-05 — Subscription operations + manual payment notes

- Add one-current-per-tenant subscription model and immutable events, with cycle/term validation.
- Add assign/switch, extend/renew, pause/resume and a scoped subscriber drawer with history.
- Payment log: positive SAR amounts, external references, dated manual notes, idempotent request IDs and append-only reversal entries. No payment gateway and no tenant accounting writes.
- Calculate actual dashboard KPIs from server data; estimated MRR uses assigned current prices, not cash receipts.
- Expiry/grace alert only; do not automatically suspend customer ERP.

**Gate:** Payment creation does not renew and does not modify tenant GL; renewal does not pretend to collect money; role/status separation proven.

### PO-06 — Complete UI + product QA

- Implement Activity Log and Settings; safe CSV columns and formula-injection mitigation; every export audited.
- Verify seven-screen UX at 1440×900, 1280×800, 1024×768, 820×1180, 390×844 and 360×800; EN/AR + light/dark.
- Ensure exact LCP-derived visual language; header 56px, light sidebar 256px/68px collapsed, Inter; **white text on orange** with verified action-fill contrast.
- Complete keyboard navigation, focus trap, reduced motion, accessible errors, loading/empty states; no page-level overflow.
- Re-run current ERP suites incl. `verify:contrast`, `verify:shell`, `verify:controls`, `verify:datatable`, `verify:page-archetypes`, `verify:role-matrix`, ACC-01 costing/accounting and customer workflows as applicable, against isolated DB.
- Load test with 1,000 fictional orgs and representative users/subscriptions; optimize only measured bottlenecks.

**Gate:** Approved screenshot matrix and verification report; no unresolved P0/P1 issues; production route map has no unauthenticated access to platform data.

### PO-07 — Release preparation and guarded deployment

- Prepare migration diff, dry run, exact review SHA, environment variable list, database/asset backups, restoration and rollback evidence.
- Confirm existing tenants remain active and unsubscribed until deliberately assigned, no auto migration to payable plan.
- Confirm invite-only cutover timing, package prices, operator MFA bootstrap/recovery, owner consent for any active-tenant seat cap.
- Open release approval gate. **Do not merge or deploy without approval.** After explicit signoff, use the existing versioned deployment process and separately inspect health, auth, tenant access, package changes, subscriber payments and other hosted apps.

**Gate:** Independent post-deploy verification before declaring production-ready. Backups cannot be deleted as part of this project.

## 4. Test matrix — minimum evidence

| ID | Test | Expected |
|---|---|---|
| SEC-01 | Customer `owner` cookie on `/platform/*` | Denied; no metadata leak |
| SEC-02 | Platform cookie on customer action | Denied; no tenant execution |
| SEC-03 | Missing/invalid MFA + recovery-code replay | Denied and logged |
| SEC-04 | Platform session revoked mid-request | No state mutation |
| SEC-05 | Cross-tenant org/user ID substitution | Denied |
| ORG-01 | Company invitation accepted once | One org, one owner, one seed, one subscription |
| ORG-02 | Two simultaneous invite accepts | Only one completes; no orphan data |
| ORG-03 | Company suspension with live customer session | Existing session, actions, exports and protected files blocked |
| ORG-04 | Restore suspended company | Data preserved; fresh sign-in required |
| USR-01 | Duplicate email or wrong-company invite | Rejected |
| USR-02 | User disabled, role changed or session revoked | Stale tokens denied |
| USR-03 | Disable/demote primary owner | Rejected until valid transfer |
| USR-04 | Concurrent primary-owner transfer | Exactly one canonical primary; atomic roles |
| USR-05 | Seat cap at all invite/create paths | Cannot overbook; grandfathered users retain access |
| PKG-01 | Published package edited | New version; old assignments unchanged |
| PKG-02 | Archive active/default Trial package | Rejected with explanation |
| SUB-01 | Trial → paid package assignment | Correct cycle and term; no simulated collection |
| SUB-02 | Extend from future/expired date | Correct computed end date |
| SUB-03 | Expired or paused subscription | Alert/status changes; tenant access unchanged |
| PAY-01 | Record payment once/twice | One record, idempotent; no tenant GL writes |
| PAY-02 | Reverse payment record | New linked reversal, preserved original |
| AUD-01 | Every sensitive action and export | Immutable audit with actor/target/reason |
| UI-01 | Seven modules across viewport/theme/language | Fully functional, no clipped actions, white-on-orange rule |
| ERP-01 | ACC-01 and document/tenant regressions | Existing behavior and accounting unchanged |

**Definition of complete:** passing source-based test evidence, not a developer's narrative assertion. Each phase report must list tests run, tests not run, diffs, exact branch/SHA, screenshots, known gaps and reviewer verdict.

## 5. Risks, mitigations and decision owners

| Risk | Mitigation / release gate |
|---|---|
| LCP theme branch changes same shell files | Finish/approve visual migration first, then build on its actual merged tree; keep platform work separate. |
| Platform role accidentally inherits tenant privileges | Separate principal/cookie/session/guard and adversarial token tests. |
| Suspension misses an existing endpoint | Enumerate pages, actions, file/print/export/public links and test direct access under suspension. |
| Existing organizations have multiple/no valid owners | Report; controlled manual selection; no guessed backfill. |
| Existing user-management path bypasses seats | Shared guard used by platform and tenant path; block go-live if not complete. |
| Package edits alter current client terms | Immutable published versions + subscription snapshots and explicit reassign only. |
| Manual payment mistaken for actual collection or VAT invoice | “Manually recorded” label, required external reference; no GL/invoice/tax side effects. |
| CSS `--primary` HSL collision | Consume final namespaced/resolved-color LCP adapter and run computed token tests. |
| Orange+white contrast failure | Verified darker orange fill for text-bearing buttons; keep `#FF6600` decorative primary. |
| Insufficient rollback/backup | Mandatory isolated restore drill, additive migration approach and exact-SHA deploy. |

## 6. Review, approval and Git hygiene

1. **One dedicated branch** for the Platform Owner program, with reviewable sub-batch commits/PRs as appropriate; never push directly to `main` without approved workflow.
2. Claude Code can write/test on an authorized isolated branch and disposable test DB; it must not touch Hostinger production, Neon production, Nginx/systemd, unrelated sites or the UI conversion branch.
3. After each batch, Claude supplies a handover (scope, changed files, SHA, test proof, screenshots, backend protection, blockers). Independent reviewer issues **APPROVED**, **APPROVED WITH CONDITIONS**, or **REJECTED**, then provides correction/merge instructions as appropriate.
4. Corrections use new commits; no amend/force-push. Verify merge commit, parents and tree. Deployment is a **separate** owner-authorized action.
5. Production package prices, first platform operator security bootstrap, invite-only cutover and legacy-owner repairs require explicit owner decisions. They must not be inferred from HTML dummy data.

## 7. Release checklist (sign-off template)

- [ ] PO-00 audit closed; current main + LCP UI branch state reverified.
- [ ] Platform security threat model, MFA, separate auth/session and immutable audit accepted.
- [ ] Company suspension applies to all customer entry points and existing sessions.
- [ ] User roles, last owner, transfers, invitation tokens and seat guard tested end to end.
- [ ] Package prices explicitly approved; published versions and snapshots verified.
- [ ] Subscription/expiry/manual payment semantics accepted; zero tenant GL changes.
- [ ] Real dashboard and audit match source records, no fake production chart data.
- [ ] EN/AR RTL, light/dark, mobile QA and contrast evidence completed.
- [ ] All relevant ERP regression suites green; no ACC-01/finance/print regressions.
- [ ] Performance and security tests recorded at representative volume.
- [ ] Migration plan/backup/restore/rollback, environment config and secret-handling reviewed.
- [ ] Owner explicitly approves merge, database changes and deployment in separate gates.
- [ ] Live production smoke tests passed and other Hostinger apps unaffected.

## 8. Final expected handover artifacts

- Six reviewed specification files (`PRD.md`, `appflow.md`, `UI_spec.md`, `TRD.md`, `Schema.md`, `Plan.md`).
- Approved Platform Owner feature branch, complete seven-page route/permission matrix and immutable schema migration set.
- Complete test evidence, security/adversarial results, visual comparison/screenshot index, performance baseline, owner-role migration report and safe data-cutover checklist.
- Staging preview with non-sensitive synthetic data and explicit owner-facing production deployment authorization request.

**End state:** a secure, practical seven-module Stage 2 control console ready for the SaaS launch decision, not an overbuilt billing/analytics platform. Advanced billing gateway, storage enforcement, module access policy, reseller and multi-operator roles stay after production launch unless explicitly reprioritized.
