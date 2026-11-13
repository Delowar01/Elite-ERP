# PLATFORM_OWNER_BASELINE.md
## Elite ERP — Platform Owner System — Phase PO-00: Final Baseline Audit & Implementation Readiness

> **Preservation note (PO-01A, 2026-11-13).** This is the complete PO-00 report delivered on 2026-11-13 (original SHA-256 `ece318f28fbcb022ef4be2a823fb3cf8b769182881704d8d5125d7284ca151f4`), stored in the repository at the owner's request.
>
> **Sanitization:** before committing it was reviewed for secrets, credentials, connection strings, real customer records and production infrastructure data, and none were found. Only local session-workspace paths were replaced by repository-relative references, and the three SQL files it references are preserved under `docs/platform-owner/po00/sql/`. Every technical finding, matrix, risk, decision and reference is otherwise unchanged.
>
> **Section J is historical.** On 2026-11-13 the owner split PO-01 into **PO-01A** (database + authentication foundation, no UI or proxy) and **PO-01B** (routes, UI and proxy). The owner's PO-01A authorization supersedes section J where they differ; for example, `.env.example` is not modified in PO-01A.
>
> PR #11 remains the canonical, draft and unmerged specification set and is not copied here.


| Item | Value |
|---|---|
| Report date | 2026-11-13 |
| Repository | `Delowar01/Elite-ERP` (read-only local clone, never pushed) |
| Audited commit | `main` = `621f156f7b129b9c2e289bc46d314ce7587beec2` (= production release) |
| Previous release | `83e8093276b36320754972f845c38f23fd28fa61` |
| Canonical planning baseline | PR #11, draft, head `357e93e332f9d5cc3d95643cf89d55dd23ca2f1b` (6 specs) |
| Authorization used | READ-ONLY analysis and planning. Nothing committed, pushed, merged, migrated or deployed. No production Neon, VPS, Nginx, systemd, secrets or live site accessed. |
| Local-only verification | Disposable PostgreSQL 16.15 cluster on `127.0.0.1:55432` with databases `po00_test_only_pushshape` and `po00_test_only_migshape`, fictional fixtures only. |

---

## A. Executive summary and GO / NO-GO

**PO-00 status: COMPLETED.** One limitation is documented: production database metadata was **not** inspected. That needs separate authorization. The exact read-only queries are in §F.6 and were validated only on a disposable database.

**Readiness for PO-01: CONDITIONAL GO.**

PO-01 is ready to be **developed** on a new, isolated branch against disposable test databases only. The platform console stays behind a feature flag that defaults to off, and nothing is deployed.

Any **production schema change or release** is **NO-GO** until the conditions in §A.3 are met.

### A.1 Key facts established (all with evidence below)

1. `main` HEAD is `621f156`, the production release.
   - It is the GitHub merge of PR #10, the LCP design system.
   - 14 commits sit on top of `83e8093`.
   - Between `83e8093` and `621f156`, auth, session, security, tenant, rate-limit, proxy and DB/schema/migration code is **byte-identical**. The only `(auth)` changes are visual. So the PR #11 code facts, written against `83e8093`, are still accurate.
2. PR #11 is still **open, draft and unmerged**.
   - It is docs-only: 6 files, +1,326 lines.
   - It is 6 commits ahead of and 14 behind `main`, and merges cleanly.
   - Its specs are adopted as the canonical baseline, with the conflicts listed in §C.2. Those conflicts are documented, not silently replaced.
3. No Platform Owner code exists today.
   - There are no `/platform` routes, platform tables or super-admin roles.
   - The only precursor is `disableZatcaPhase1Backend()` (`src/lib/zatca-admin.ts:17`), which has no callers. ZATCA is out of PO scope per `PRD.md:88`.
4. The customer authentication foundation is reusable: bcrypt, jose JWT with a server-side session row, TOTP, field encryption, append-only audit triggers and the request-context parser. It still has gaps the platform must not inherit and that suspension must fix:
   - No organization-suspension check exists in `getSession` or `loginAction`.
   - No org-wide session revoke exists.
   - Legacy tokens without a `jti` are still accepted.
   - The login throttle is in-memory and keyed per e-mail.
   - TOTP has no replay protection.
   - `touchSession()` has no callers, so there is no idle tracking.
   - The proxy has no `/platform` branch. Any `/platform/*` request is currently redirected to `/login`.
5. **Migration path finding (highest-impact).**
   - The committed Drizzle migrations (`0000`–`0004`, last changed 2026-08-17) build **59** tables. The `621f156` schema has **67**.
   - The repository's own read-only gate, `npm run db:preflight`, rates a database built the production way (`drizzle-kit push`) as **INCONSISTENT (exit 20)**, with *migrate REFUSED, stamp REFUSED*. The cause is `PUSH_REFERENCE_STALE`: the schema changed after the AUD-08.1 measurement.
   - So no automated, gate-approved path exists today for applying Platform Owner tables to production.
6. Design system:
   - The deployed tokens implement the owner's rule. Text on the orange is white: `--primary-foreground: #ffffff` in both modes (`src/app/globals.css:120-121`).
   - This is the owner-accepted contrast exception: 3.29:1 light `#F06000`, 2.94:1 dark `#FF6600`.
   - It **conflicts** with UI_spec/Plan guidance to use a darker `#C95000` fill. The deployed, accepted implementation governs. It is documented, not changed.
7. Local baseline quality on `621f156`:
   - `tsc --noEmit` passes.
   - The CI lint gate (`eslint src --max-warnings=0`) passes.
   - All 22 `verify:static` suites pass.
   - The committed security tests pass: crypto-policy 18/18 and access-control 22/22.
   - Proposed constraint designs passed 11/11 probes on a disposable database.

### A.2 Why CONDITIONAL GO rather than GO

PO-01 adds only platform-only tables (no foreign keys to tenant tables), a platform auth library, a proxy branch, `/platform/login` and the shell. All of it can be built and proven on disposable databases with fictional data.

The open items below block **release**, not development:
- the production migration mechanism;
- the bootstrap identity and channel;
- the measurement of legacy owner anomalies in production;
- package prices and the seat-cap policy.

### A.3 Conditions

| # | Condition | Needed before |
|---|---|---|
| C1 | Explicit owner authorization to start PO-01, including authorization to create and push the program branch (§H.1). | Starting PO-01 |
| C2 | PO-01 runs only on disposable `*_test_only_*` databases on `127.0.0.1`. No production DB, VPS or deploy. Feature flag `PLATFORM_CONSOLE_ENABLED` defaults to off. | All of PO-01 |
| C3 | Owner decides the production migration mechanism (D-6). The current preflight result is INCONSISTENT. | Any production schema change (PO-07); preferably before PO-02 |
| C4 | Owner authorizes the read-only production metadata queries (D-7, §F.6), or explicitly waives them under the CLAUDE.md test-data posture. | Final backfill design (PO-02/PO-03) |
| C5 | Owner designates the initial Platform Owner identity and bootstrap channel (PRD pending decision (b) = D-2). | First production bootstrap (PO-07) |
| C6 | Owner decides package prices and seats (PRD (a) = D-1) and the seat cap on existing tenants (PRD (e) = D-5). | Publishing paid package versions (PO-04/05) and seat enforcement (PO-03) |

---

## B. GitHub baseline

### B.1 Commands used (read-only)

~~~bash
git clone --depth 1 https://github.com/delowar01/elite-erp elite-erp
git fetch --unshallow origin main                 # full history for accurate counts
git ls-remote origin refs/heads/main refs/heads/feat/erp-lcp-design-system refs/heads/docs/platform-owner-stage2-specs-20261106
git ls-remote --heads origin | wc -l
git cat-file -p 621f156 | head -4
git merge-base --is-ancestor 621f156 origin/main
git rev-list --count origin/main ; git rev-list --count 83e8093..origin/main
git merge-base origin/main 357e93e ; git rev-list --left-right --count 357e93e...origin/main
git merge-tree --write-tree origin/main 357e93e    # exit 0 = clean
git diff --stat 83e8093 357e93e
git diff --name-only 83e8093 621f156 -- src/lib/auth.ts src/lib/session.ts src/lib/security src/lib/tenant.ts src/lib/rate-limit.ts 'src/app/(auth)/actions.ts' src/proxy.ts src/db
# GitHub MCP: list_pull_requests(state=open), list_branches (protection flags)
~~~

### B.2 Results

| Check | Evidence |
|---|---|
| `main` HEAD | `621f156f7b129b9c2e289bc46d314ce7587beec2`, "Merge pull request #10 from Delowar01/feat/erp-lcp-design-system". Tree `cde60c211a6e64d9ee2bc24b127baa8b33bd54d6`. Parents `c9249b3599a01f2eb90c5beff773d6268c9a7f58` (main after PR #12) and `f98fd71080cd8131f52080b9dddb1443f91432bf` (LCP branch head). |
| Is 621f156 on main? | Yes. It **is** the tip (`merge-base --is-ancestor` true; `ls-remote` main = 621f156). |
| History | 303 commits on `main` (single root `363904d`). The earlier count of 135 was an artefact of the shallow clone and is corrected here. 14 commits are in `83e8093..main`: ten LCP commits (4f036d0, dbef9d4, dc0707c, 63b1c16, 2c64d9d, 326c29c, 42a47d9, 39f881b, 0a7696a, e9d7722), PR #12 follow-redirects 1.16.2 (041eb23, c9249b3), f98fd71, and merge 621f156. |
| What changed 83e8093→621f156 | 258 files in `tests/ui-baseline`, 12 in `src/app`, 9 in `src/components`, 3 in `src/lib` (brand-theme, design-tokens, i18n dict), 4 in `docs/design-system`, and verify scripts. **No changes** to `src/db`, `drizzle/`, `scripts/`, `src/lib/auth.ts`, `session.ts`, `security/*`, `tenant.ts`, `rate-limit.ts`, `(auth)/actions.ts` or `src/proxy.ts` (the diff name list is empty). `(auth)` changes are layout/CSS only: auth.css (new), layout.tsx, login-form.tsx and register-form.tsx are class/markup changes with no action or field changes. |
| Open PRs | **#11**: open, **draft**, not merged. Head `357e93e` on `docs/platform-owner-stage2-specs-20261106`, base sha `83e8093`, updated 2026-11-06T16:17:52Z. **#1**: open, not draft, "Add implementation plan for Elite ERP executive presentation". Head `4202b10`, base `32351c9` (2026-07-18). Stale and unrelated to PO. |
| PR #11 vs main | 6 commits (58d85e4, fc07c77, 91f027b, bdacb8b, bf23c39, 357e93e). Files: `docs/platform-owner/stage-2/{PRD,appflow,UI_spec,TRD,Schema,Plan}.md` = 203+250+205+201+275+192 = **+1,326 lines**, docs only. Merge-base `83e8093`, ahead 6 / behind 14, `merge-tree` exit 0 (no conflicts). `main` contains no `docs/platform-owner/`. **Left draft and unmerged.** |
| Branches | 28 remote heads. The GitHub branch listing shows `protected: false` for **all** of them, including `main`, so there is **no branch protection**. The LCP branch `feat/erp-lcp-design-system` = `f98fd71` is fully merged. |
| CI | `.github/workflows/devsecops.yml` runs on push and PR to main. Jobs: `tsc --noEmit`; `eslint src --max-warnings=0`; `npm audit --audit-level=high`; gitleaks; and `node tests/security/{crypto-policy,access-control}.test.mjs` + `npm run db:push` (ephemeral postgres:16) + `npm run build`. CI does **not** run `verify:static`, `verify:server` or the UI baseline. |
| Repo instructions | `CLAUDE.md` (owner-confirmed 2026-10-30): the system is in development with **no real customers or business data**, and the owner accepts loss of ERP test data. It also sets a bilingual EN/AR native-Arabic standing requirement. This lowers data-loss severity but does **not** relax this prompt's authorization boundaries. |

---

## C. Documentation review (PR #11, six specs, read in full)

### C.1 Per-document assessment against deployed `621f156`

| Doc (lines) | Purpose | Accuracy at 621f156 | Notes |
|---|---|---|---|
| `PRD.md` (203) | Personas, P-01..P-10, staged enforcement, exclusions, NFR-01..10, pending owner decisions (a)–(e) | **Accurate**, except references to the "ongoing visual-redesign branch" (line 30) | Pending decision (d), final LCP visual acceptance, is **now satisfied**: 621f156 deployed and accepted on 2026-11-13. (a), (b), (c), (e) remain open (§I). Exclusions include ZATCA (line 88), gateway, impersonation, tenant delete, self-signup. |
| `appflow.md` (250) | Routes, access matrix, invite/suspension/seat/owner-transfer flows, F-01..F-14 | **Accurate** | Routes match §E.5. Seat rule (users active + disabled + unexpired pending invites; disabling does not free a seat; grandfather over-cap tenants) is consistent with the schema (no seat columns exist today). |
| `UI_spec.md` (205) | Visual contract, component inventory, screens UI-01..07, QA matrix | **Partially stale** | Conflicts C-1, C-2, C-4 below. Geometry (56px header, 256/68 sidebar, Inter) **matches** the deployed shell (`globals.css:158` `--header-height: 56px`). |
| `TRD.md` (201) | Architecture, auth, proxy, isolation, invitations, seats, billing, server actions, errors, gates | **Accurate for logic.** Baseline SHA 83e8093 (line 5) is stale, but those files are byte-identical at 621f156. | §1 facts confirmed line-by-line in §E.1. Session lifetimes are marked "candidate … verify with owner/security review before release" (§3.1) and become decision D-9. |
| `Schema.md` (275) | Column-level proposal for 15 tables, touchpoints, migration sequence 1–9, threat notes | **Accurate**; key constraints proven feasible on a 621f156-shaped DB (§F.3) | Its "drizzle schema parity" step (line 259) runs into the AUD-08 state (C-5). |
| `Plan.md` (192) | PO-00..PO-07, dependencies, test IDs, git hygiene, release checklist | **Accurate structure**, partially stale inputs | Lines 6, 38, 40 and 158 reference 83e8093, an in-progress LCP branch and `#C95000` (C-1, C-3). |

### C.2 Conflicts and staleness (documented, not silently replaced)

| ID | Spec statement | Repository evidence at 621f156 | Resolution proposed (needs no new requirement) |
|---|---|---|---|
| **C-1** | `UI_spec.md:17` `brand.orange #FF6600` in both modes. `:19` `action.orangeAccessible #C95000` for white action text. `:30` "use a darker orange fill". `Plan.md:40,158` the same. | Deployed: `--primary: light-dark(#f06000, #ff6600)` and `--primary-foreground: light-dark(#ffffff, #ffffff)` (`globals.css:120-121`). Accepted exception: *"text on the orange is white … 3.29:1 on the light #F06000 and 2.94:1 on the dark #FF6600 (3.56 / 2.59:1 on hover)"* (`docs/design-system/ERP_LCP_FINAL_HANDOVER.md:208-214`, owner decision 2026-11-06). `verify:contrast` measures it as an owner decision: "PASS light/dark: the LCP white label on the primary … (owner decision — measured)". | The later explicit owner decision plus the PO-00 rule ("Preserve the accepted live design … Do not silently change the approved colors") govern. The platform console consumes `--primary`/`--primary-foreground`/`--accent-ink` as deployed and introduces **no** `#C95000` and no new hex colours. The trade-off is documented in §G.3. A future docs revision of PR #11 should annotate C-1 (needs approval to commit). |
| **C-2** | `UI_spec.md:11` "supersedes the previous Navy Command look for visuals only". | The LCP design system is now the deployed look. The org white-label DB defaults are untouched (`orgs.ts:36-41`; verify-lcp: "the DB column defaults are untouched"). | No conflict. Platform uses the stock LCP palette only. **Never** apply org white-label theming in the platform console. |
| **C-3** | Baseline `83e8093` in `TRD.md:5`, `Schema.md:5`, `Plan.md:6,38`. | 14 commits since. Logic files identical (§B.2). | Facts remain valid. Specs should cite `621f156` in a future docs revision. PO-01 must re-run the §B.1 diff check at start. |
| **C-4** | `PRD.md:30` "ongoing visual-redesign branch". `UI_spec.md:205` "import/consume the final approved tokens after its merge". | PR #10 merged into `621f156`, deployed and owner-accepted on Nov 13. | Precondition satisfied. Consume `src/app/globals.css` tokens + `src/lib/design-tokens.ts` (parity). |
| **C-5** | `Schema.md:259` "Re-run drizzle schema parity". `Plan.md` PO-07 "isolated migration proof". `Schema.md:266` "Production db:push/migration … separately authorized". | Committed migrations build 59 tables vs 67. `db:preflight` = INCONSISTENT on a push-shaped DB because the push reference is stale (§F.2). AUD-08 README finding 2: *"drizzle-kit push is not usable to converge an existing migrations-built database … exits 0 having applied nothing"*. Finding 3: *"verify:db-hardening is satisfied by decoy triggers"*. | Parity must be **re-established** before production (decision D-6). PO-01..06 validate on disposable DBs only. Do **not** run `drizzle-kit generate` into `drizzle/`: it would bundle the unrelated 8-table drift. |
| **C-6** | `TRD.md` §3.1 cookie `SameSite=Lax`. | Platform has no cross-site entry flow. Invitation acceptance is a tenant-side public route (appflow). | Keep **Lax as specified**. `Strict` is an optional hardening for the reviewer to consider, not adopted silently. |
| **C-7** | TRD/Plan: seat check on "all tenant user-create paths". | Exactly **two** `users` insert paths today: `src/app/(auth)/actions.ts:131` (register) and `src/app/(app)/settings/team/actions.ts:35-38` (add member). Invitation acceptance will be the third (PO-02/03). | The spec is correct. The concrete list is now pinned for USR-04. |
| **C-8** | Specs require MFA, idle timeout and throttling, but say nothing on TOTP step replay, login timing or idle tracking mechanics. | `totp.ts:70-78` accepts ±1 step and stores no last-used step. `loginAction` returns before bcrypt for unknown users (`(auth)/actions.ts:55`). `touchSession()` (`session-store.ts:52`) has **no callers** (grep). | Add as PO-01 acceptance criteria (refinement backed by evidence). Tenant behaviour is not changed in PO-01. |
| **C-9** | `Schema.md` §4.2 composite FK `(org_id,user_id)` needs `UNIQUE users(org_id,id)` or a trigger. | Proven feasible: probes P1/P2 (§F.3). | Use the composite FK (declarative, no trigger). |
| **C-10** | `PRD.md:88` excludes ZATCA changes. | `orgs.ts:101-104` and `zatca-admin.ts:7-16` anticipate "the future Elite Marcom Platform Owner" disabling ZATCA Phase 1. | No conflict. Stays **out of scope** for PO-01..07 unless the owner later adds it. |
| **C-11** | Asia/Riyadh date-only subscription dates (UI_spec/appflow). | `src/lib/date-only.ts:12` `addDays()` on the UTC calendar. `formatDisplayDate` uses `timeZone: "UTC"` (`src/lib/i18n/format-date.ts:30-37`). No "today in Asia/Riyadh" helper exists (grep of `src/lib`). | Reuse `addDays`. Add one `todayInRiyadh()` helper in PO-05 (or PO-01 shared util) with tests. |
| **C-12** | EN/AR everywhere. | `t(locale, en)` dictionary (`src/lib/i18n/dict.ts:2096`, 2,099 lines). verify-lcp check: "every string the LCP adoption added has a native Arabic entry". CLAUDE.md requires native Saudi-business Arabic from the first commit. | Reuse the pattern. Add a platform-specific "every platform string has an Arabic entry" check. |

---

## D. Architecture assessment — reusable vs new

### D.1 Placement

The console runs in the same Next.js 16.4.3 app and the same Neon database (TRD §2). It uses its own route group, `src/app/(platform)/platform/...`, its own library, `src/lib/platform/*`, its own schema file, `src/db/schema/platform.ts`, and its own components, `src/components/platform/*`.

### D.2 Reuse matrix

| Concern | Existing asset (path:line) | Decision | Notes |
|---|---|---|---|
| Password hashing | `src/lib/auth.ts:16-22` bcryptjs cost 10 | **Reuse library**, platform-specific wrapper | Platform password policy is stricter, via `validatePassword(password, policy)` (`src/lib/security/password-policy.ts:55`) with a platform constant. |
| Token signing | jose `SignJWT` (`auth.ts:30-35`) | **New function**, same library | Separate `PLATFORM_AUTH_SECRET`; claims `typ:"platform"`, `aud`, `jti`, `exp ≤ 12h`. The tenant token has no typ/aud (`auth.ts:31`) and needs numeric `userId`+`orgId`, so a platform token fails tenant verification. |
| Server session store | `src/lib/security/session-store.ts` (`sessions` table, FK NOT NULL to orgs/users, `security.ts:13-37`) | **Pattern reuse; new table** `platform_sessions` | Cannot reuse `sessions`: `org_id`/`user_id` are NOT NULL FKs to tenant tables. |
| TOTP | `src/lib/security/totp.ts:47-91` | **Reuse** generate/verify/recovery-code functions | Add a **replay guard** (last accepted step) in the platform layer only. Issuer string: platform-specific label. |
| Secret encryption | `src/lib/crypto/field-encryption.ts` AES-256-GCM, `FIELD_ENCRYPTION_KEYS` versioned, throws if unset | **Reuse** | Platform must **reject legacy plaintext** pass-through (Stage-11 report line 51 says plaintext passes through) for platform MFA secrets. |
| Login throttle | `src/lib/rate-limit.ts:9-37` in-memory `Map`, 5 per 15 min per key | **Do not reuse** | New DB-backed `platform_login_attempts` (per account + per IP; durable across restarts). |
| Audit immutability | `drizzle/immutable_audit.sql` `reject_mutation()` + triggers; installed by `scripts/apply-db-hardening.ts` | **Reuse function**; new table + trigger | Proven: P5 (§F.3). Verify by `tgrelid`, not `tgname` (AUD-08 finding 3). |
| Request context | `src/lib/security/request-context.ts:18,39` | **Reuse** | IP/UA/device for platform sessions and audit. |
| Tenant scoping | `src/lib/tenant.ts` `tenantScope` | **Not used by platform** | Platform reads **allowlisted metadata** cross-tenant with explicit column lists. Tenant code keeps `tenantScope` (TRD §3.3). |
| Org creation + seed | `(auth)/actions.ts:122-134` transaction + `seedOrgDefaults(tx, org.id, country)` | **Reuse** for invitation acceptance (PO-02) | Same validation (country, currency, password policy). |
| Session revoke | `revokeUserSessions(userId, reason, exceptJti?)` (`session-store.ts:89`) | **Reuse**; add **new** `revokeOrgSessions(orgId, reason)` | No org-wide helper exists. Index needed (§F.3 P8). |
| Suspension enforcement | `lookupSessionByToken` (`session.ts:39-77`), `loginAction` (`(auth)/actions.ts:37-95`) | **Modify (PO-02, high care)** | Add an org-access check. This changes customer auth and needs regression tests. |
| Proxy | `src/proxy.ts` (69 lines) | **Modify (PO-01)** | Add a `/platform` branch. Tenant behaviour must stay identical. |
| ZATCA backend hook | `src/lib/zatca-admin.ts:17` (no callers) | Leave untouched | Out of scope (`PRD.md:88`). |
| UI primitives | `src/components/ui/*` (button, card, dialog, drawer, table, list-search, filter-panel, status-badge, summary-card, empty-state, skeleton, sonner, tabs, form-field, input, select…) | **Reuse** | See §G. |
| App shell | `AppShell` (`src/components/layout/app-shell.tsx`), `Sidebar`, `NavList` (`nav-list.tsx:5` imports tenant `visibleNavGroups`), `(app)/layout.tsx` (calls `requireSession()` and loads org theme, notifications, favorites, currency) | **Do not reuse or modify**; compose a new `PlatformShell` from the same CSS classes and primitives | Shared shell components are tenant-coupled. Refactoring them would risk the accepted live UI (UI-baseline 256/256 proof). |
| Theme / locale | `setThemeAction` (`src/lib/theme-actions.ts`) and `setLocaleAction` (`src/lib/i18n/actions.ts`) need **no session** | **Reuse** (ThemeToggle, LanguageSwitcher) | Shared preference cookies are acceptable (non-sensitive). |
| Static guard test | `tests/security/access-control.test.mjs` walks **only** `src/app/(app)` (line 22) | **Extend with a sibling platform test** | Otherwise platform actions are not covered by CI. |

### D.3 Genuinely new components

- **Schema:** platform identity (4 tables), tenant access + primary owners (2), invitations (2), packages + versions (2), subscriptions + events (2), payments (1) and settings (1). Column detail is in `Schema.md` §3–9.
- **Library** (`src/lib/platform/`): `auth`, `session`, `guards` (`requirePlatformSession`, `requirePlatformPermission`), `mfa` (replay guard), `throttle`, `audit`, `companies`, `invitations`, `users`, `seats` (`assertUserSeatAvailable(orgId, tx)`), `packages`, `subscriptions`, `payments`, `metrics`, `errors` (typed error list per TRD), `flags`.
- **Tenant-side integration:** org-access check in session lookup and login; `revokeOrgSessions`; seat guard in the 2 (later 3) user-creation paths; invitation-acceptance public route (tenant side).
- **CLI:** one-time audited `platform:bootstrap` (no default credentials).
- **UI:** `PlatformShell`, platform sidebar and nav (Workspace / Tenants / Governance), and the 7 section pages. Platform-local wrappers are listed in §G.

---

## E. Authentication and security

### E.1 Current customer authentication (verified in source at 621f156)

| Area | Evidence | Assessment |
|---|---|---|
| Cookie | `src/lib/auth.ts:6`: `__Host-elite_erp_session` in production, `elite_erp_session` in dev. Set in `issueSession` (`(auth)/actions.ts:24-36`): httpOnly, secure in prod, `sameSite:"lax"`, path `/`, 30-day maxAge. | Sound. The platform must use a **different** cookie name. |
| Token | HS256 `SignJWT({userId, orgId})`, `setExpirationTime("30d")`, `jti` optional (`auth.ts:24-35`). Secret `AUTH_SECRET`, fail-fast (`auth.ts:8-12`). | No `typ`/`aud` claims. A separate secret for the platform is mandatory (TRD §3.1). |
| Session row | `createSession` stores sha256(jti) (`session-store.ts:21`). The only issuance path is `issueSession` (`(auth)/actions.ts:26`, grep of `signSessionToken(`), and it always sets a jti. | Good. |
| Validation | `lookupSessionByToken` (`session.ts:39`): `if (payload.jti && !(await isSessionValid(payload.jti))) return null` (`:45`). Inner-joins users→orgs (`:72`). `if (!row || !row.isActive) return null` (`:76`). | **Gap G-1: no org-suspension check.** **Gap G-2:** tokens without a jti skip revocation (`:44-45`; Stage-11 report line 36 "legacy JWTs without a jti still validate"). Stage 11 jti issuance landed 2026-07-18 (`94fae17`) and tokens expire after 30 d, so every jti-less token has most likely expired. Closing the branch should have no legitimate-user impact (deploy dates not verified). |
| Guards | `requireSession()` → `/auth/clear?next=/login` (`session.ts:87-93`). `requireRole(...roles)` → `/dashboard` (`:96-99`). | Fine for tenants. Platform needs its own guards. |
| Login | `loginAction` (`(auth)/actions.ts:37-95`): lowercase+trim e-mail (`:38`), `checkLoginRateLimit(email)` (`:46`), unknown/disabled user returns *before* bcrypt (`:55`), bcrypt (`:58`), MFA TOTP or recovery code (`:64-84`), `lastLoginAt` (`:90`), `issueSession` (`:93`). | **G-3:** no org-access check. **G-4:** timing difference allows account enumeration. **G-5:** throttle is per process and per e-mail only (`rate-limit.ts:9-12`). |
| MFA | TOTP ±1 step, `timingSafeEqual` (`totp.ts:70-78`). Recovery codes bcrypt-hashed and single use. Secrets field-encrypted. | **G-6:** no last-step replay guard. **G-7 (tenant, pre-existing):** `beginMfaSetupAction` overwrites `mfaSecret` even while MFA is enabled, without password or MFA re-auth (`settings/security/actions.ts:34-41`). A stolen tenant session could re-bind MFA. **G-8 (tenant, pre-existing):** `mfaRequiredForPrivileged` (default true, `orgs.ts:118`) only blocks *disabling* MFA (`security/actions.ts:71-74`); it is not enforced at login. |
| Idle tracking | `touchSession()` (`session-store.ts:52-58`) has **no callers** (grep). | **G-9:** `last_activity_at` never advances, so no idle timeout exists for tenants. The platform's 30-min idle timeout must actually update activity. |
| Revocation | Per session, all-but-current, on password and MFA change (`security/actions.ts:59,114,124,133`). | **G-10:** no org-wide revoke. User deactivation relies on the per-request `isActive` check (`team/actions.ts:87-91`; `session.ts:76`), which works, but session rows stay unrevoked. |
| Team management | `addTeamMemberAction` (`team/actions.ts:19-48`): owner/admin, `canAssignRole`, min length 8 only (does not use org password policy), `logActivity` (not `recordAudit`). `changeRoleAction` (`:50-69`) blocks self-change and higher roles. `toggleMemberActiveAction` keeps the last active owner (`:75-84`). | Seat guard and primary-owner protection integrate here (PO-03). Pre-existing items are recorded but not in PO scope. |
| Registration | `/register` is public. It creates org + owner + seed in one transaction (`(auth)/actions.ts:97-141`). | Invite-only cutover is owner decision D-3. |
| Proxy | `src/proxy.ts:5-8` cookie/routes. `AUTH_ROUTES ["/login","/register"]`, `ALWAYS_ALLOW ["/auth/clear"]`, `/` passes (`:53`). Every other path needs a valid tenant JWT or is redirected to `/login` (`:60`). | **G-11:** a `/platform/*` request is redirected to `/login` today. The proxy must branch before tenant logic. |
| Other tenant-data routes | `uploads/[...path]` (`getSession` or HMAC signed URL for branding folders only; `signFileUrl()` has no callers per the route comment), `api/document-pdf` (`requireSession`), `api/import-template` (`requireSession`), `print/[type]/[id]` (`requireSession` at `page.tsx:108`). | Fixing `lookupSessionByToken` (G-1) covers all of them automatically. Signed branding URLs are dormant. |
| Headers | `next.config.ts:12-32`: strict CSP (`frame-ancestors 'none'`, `form-action 'self'`, `img-src 'self' data:`), HSTS preload, nosniff, DENY. | Covers `/platform` automatically. `img-src data:` lets the TOTP QR render as a data URL. |

### E.2 Platform authentication design (TRD §3, refined only with the evidence above)

1. **Identity.** A separate `platform_admins` table (no fake `users` rows, no new tenant role; TRD §3.1). One active Platform Owner now. `requirePlatformPermission()` is a one-role allowlist that can grow later.
2. **Bootstrap.** A one-time, audited CLI. It refuses to run if an active admin exists and creates no default credentials. The operator enters the password interactively, and MFA is enrolled out of band (otpauth URI, a code typed back to confirm, then recovery codes shown once).
   - **In PO-01 the CLI refuses any non-local or non-`_test_only_` database.**
   - The production channel is decision D-2 (PO-07).
3. **Login (`/platform/login`).**
   - Generic error messages; a dummy bcrypt compare for unknown accounts (fixes G-4 for the platform).
   - Durable throttle per account **and** per IP (fixes G-5).
   - Mandatory TOTP **or** a single-use recovery code on **every** login.
   - TOTP replay rejected via the last accepted step (G-6).
   - MFA must be enrolled before any console access.
4. **Session.**
   - Cookie `__Host-elite_erp_platform` in production (non-prefixed name in dev, mirroring `auth.ts:6`): `HttpOnly; Secure; SameSite=Lax; Path=/`, no Domain (C-6).
   - Secret `PLATFORM_AUTH_SECRET`, at least 32 bytes, fail-fast.
   - JWT claims `typ:"platform"`, `aud:"elite-erp-platform"`, `jti`, `exp`.
   - `platform_sessions` row stores sha256(jti).
   - Lifetimes: **12 h absolute / 30 min idle**. These are TRD candidate defaults, confirmed under D-9 before release. Activity is updated with a throttle (fixes G-9 for the platform).
   - Revoked on logout, logout-all, password change, MFA change and admin disable.
5. **Guards.**
   - `requirePlatformSession()` checks: signature; `typ`, `aud`; live server row; not expired (absolute or idle); admin active; MFA-complete.
   - `requirePlatformPermission(perm)` runs **inside every page, server action and export**.
   - A tenant `requireRole('owner')` can never grant platform access, and vice versa.
6. **Proxy.**
   - `/platform/login` and `/platform/recover` always render.
   - Other `/platform/*` paths get an edge-safe signature check on the **platform** cookie only, otherwise a redirect to `/platform/login`.
   - The tenant cookie is never consulted for `/platform/*`, and the platform cookie never for tenant paths.
   - When the feature flag is off, `/platform/*` returns 404.
7. **CSRF.** Next.js server actions plus `SameSite`, `form-action 'self'`, and confirmation dialogs with a reason for destructive actions. Destructive actions are never exposed as GET (TRD §8).
8. **Privacy.**
   - Metadata allowlists only (TRD §3.3).
   - No impersonation and no tenant session minting.
   - No customer invoices, HR, files or GL.
   - Logs never contain tokens, passwords or MFA codes (TRD §8).
9. **No outbound messages.** Invitations are copy-link only (PRD). No e-mail or WhatsApp integration is added.

### E.3 Company, user and commercial controls (security view)

| Control | Requirement (spec) | Evidence-based design note | Phase |
|---|---|---|---|
| Company metadata | Safe fields only, audited (`updateCompanyMetadata`) | Allowlist from `orgs` (`orgs.ts`): name, country, currency, created_at, and logo presence only. **Never** finance, ZATCA or theme internals. | PO-02 |
| Invitation onboarding | Org created only at acceptance; hashed single-use 72 h token | Reuse the register transaction + `seedOrgDefaults`. E-mail normalized lowercase+trim (TRD §3.3). Case-variant collisions must be measured first (Q05; probe P7). | PO-02 |
| Suspension / reactivation | Deny new logins and live sessions, revoke all org sessions, fresh login after reactivation | G-1, G-3 and G-10 fixes. Missing `tenant_access_controls` row = active (compatibility). Legacy jti-less tokens rejected (D-8). | PO-02 |
| Tenant data protection | No impersonation, no business tables | Static test: no `(platform)` file imports tenant business schema beyond the allowlist. | PO-01..06 |
| Directory / invites / roles | Safe identity fields; single-org users | `users` fields: id, org_id, email, name, role, is_active, last_login_at, mfa_enabled. Never hashes or secrets. | PO-03 |
| Primary owner protection / transfer | Same-org active target; old owner → admin; revoke both users' sessions; row lock | Composite FK proven (P1/P2). `toggleMemberActiveAction` last-owner logic (`team/actions.ts:75-84`) is the tenant precedent. | PO-03 |
| Seat limits | users (active + disabled) + unexpired pending invites; grandfather | `assertUserSeatAvailable(orgId, tx)` with an org-row `FOR UPDATE` lock in all creation paths (C-7). | PO-03 |
| Package catalog / versions | Immutable published versions; SAR | Published version rows immutable (trigger or no-update policy). Prices only from D-1. | PO-04 |
| Manual subscriptions | One current per org; derived expired; no auto-suspension | Partial unique index proven (P3). Expiry never touches `tenant_access_controls`. | PO-05 |
| Manual SAR payments | Idempotent `request_id`, receipt reference unique, reversals, no tenant GL | Proven P4a–c. **No** writes to tenant `journal_*` / payments tables (ERP-01 regression). | PO-05 |
| Expiry alerts / renewals | Renew `max(end, today)` + N days; no payment implied | Needs `todayInRiyadh()` (C-11). Alerts are in-console only (no outbound). | PO-05 |

### E.4 Threat / risk matrix

| # | Threat | Existing control | Gap | Required control | Test | Sev. |
|---|---|---|---|---|---|---|
| T1 | Tenant token used on `/platform/*` | Proxy checks the tenant JWT only | No platform branch (G-11) | Separate cookie, secret and `typ`/`aud`; the platform guard ignores the tenant cookie | SEC-01 | High |
| T2 | Platform token used on tenant routes or actions | Tenant verify requires numeric userId/orgId + `AUTH_SECRET` | None today (no platform tokens yet) | Separate secret; tests in both directions | SEC-01 | High |
| T3 | Brute force / credential stuffing on platform login | In-memory per-e-mail limiter | Not durable, no per-IP limit (G-5) | DB-backed per-account + per-IP throttle with backoff; security events | SEC-02 | High |
| T4 | MFA bypass / TOTP replay / recovery replay | TOTP ±1, single-use recovery codes | No step replay guard (G-6) | Last-step guard; MFA on every login; enrollment mandatory | SEC-03 | High |
| T5 | Session theft / fixation / stale sessions | httpOnly, `__Host-`, server rows | No idle tracking (G-9) | 12 h / 30 min, fresh jti per login, revoke on credential changes | SEC-04 | High |
| T6 | CSRF / confused-deputy on platform actions | Server actions + Lax + CSP `form-action 'self'` | — | Guard inside every action; confirm + reason; no destructive GET | SEC-05 | Medium |
| T7 | Account enumeration | Generic message | Early return before bcrypt (G-4) | Dummy hash compare on the platform | SEC-02 | Medium |
| T8 | Escalation from tenant owner to platform | No platform roles exist | — | Separate identity tables; static test that no tenant role is checked in `(platform)` | SEC-01 | High |
| T9 | Cross-tenant data exposure via the platform | — | New surface | Column allowlists; no generic table browsing; tests assert selected columns | ORG-04 | High |
| T10 | Impersonation | None exists | — | No code path mints tenant sessions from the platform (static test) | SEC-05 | High |
| T11 | Suspension bypass (live session, legacy token, login, print/PDF/uploads) | `isActive` per user only | G-1, G-2, G-3, G-10 | Org check in lookup + login, org-wide revoke, reject jti-less tokens (D-8) | ORG-02 | **Critical** (for PO-02 correctness) |
| T12 | Last or primary-owner lockout; transfer races | Tenant last-owner check (`team/actions.ts:75-84`) | No primary-owner concept | `tenant_primary_owners` + row locks + guards in tenant actions too | USR-02/03 | High |
| T13 | Seat-limit races | None | No seat model | Central guard with `FOR UPDATE` in 3 paths | USR-04 | Medium |
| T14 | Invitation token theft / replay | — | New | sha256-hashed tokens, 72 h, single use, constant-time compare, bound to e-mail; never logged | ORG-03 | High |
| T15 | Payment duplication or tampering | — | New | `request_id` UNIQUE, receipt reference unique (lower), positive `numeric(14,2)`, SAR CHECK, reversal entries only (P4) | PAY-01/02 | Medium |
| T16 | Audit tampering | `reject_mutation()` triggers | `--check` is satisfied by decoy names (AUD-08 #3) | Platform audit trigger + `tgrelid`-bound check (Q08) | AUD-01 | Medium |
| T17 | Bootstrap abuse / default credentials | — | New | One-time CLI, refuses when an admin exists, local-only in PO-01, audited | SEC-04 | High |
| T18 | `PLATFORM_AUTH_SECRET` compromise | — | New | Separate secret; rotation runbook (revoke all platform sessions) | SEC-04 | Medium |
| T19 | Accidental outbound messages | No mailer exists | — | Copy-link invites; test that no outbound client is imported | ORG-03 | Low |
| T20 | Accounting contamination from subscription payments | ACC-01 ledger invariants (`verify:ledger-only-balances`) | — | Platform payments in their own tables only; ACC regression suite green | ERP-01 | High |
| T21 | Auto-suspension on expiry | — | — | Derived `expired` status only; access unaffected | SUB-02 | Medium |
| T22 | Migration damage to production | `db:preflight` gate (read-only) | Gate state INCONSISTENT; migrations stale (§F.2) | Disposable validation only; owner decision D-6; backup/restore in PO-07 | PO-07 | **Critical** (release) |
| T23 | Platform list DoS / slow queries | — | No `sessions(org_id)` index | Pagination, indexes (P8), NFR p95 < 2.5 s at 1,000 orgs (synthetic) | PO-06 perf | Medium |

### E.5 Route permission matrix

Permission keys such as `companies:read` are **proposed names**. TRD §3.1 allows a one-role allowlist now that can expand later; with a single Platform Owner, every key resolves to "active, MFA-complete platform admin".

| Route | Actor | Server guard | Proxy behaviour | Phase |
|---|---|---|---|---|
| `/platform/login` | Anonymous | Throttle; if a valid platform session exists → `/platform/dashboard` | Always render (flag on); 404 when the flag is off | PO-01 |
| `/platform/recover` | Anonymous | Recovery-code login path, throttled | Always render (flag on) | PO-01 |
| `/platform` | Platform Owner | `requirePlatformSession` → redirect `/platform/dashboard` | Platform cookie signature check | PO-01 |
| `/platform/dashboard` | Platform Owner | `requirePlatformSession` + `metrics:read` | as above | PO-01 shell, PO-05 data |
| `/platform/companies`, `/platform/companies/[orgId]` | Platform Owner | `companies:read`; actions `companies:invite`, `companies:access` (suspend/reactivate), `companies:sessions` | as above | PO-02 |
| `/platform/users` | Platform Owner | `users:read`; actions `users:invite`, `users:status`, `users:role`, `users:owner-transfer`, `users:sessions` | as above | PO-03 |
| `/platform/packages` | Platform Owner | `packages:read/write/publish/archive` | as above | PO-04 |
| `/platform/subscribers` | Platform Owner | `subscriptions:read/assign/extend/pause`, `payments:record/reverse` | as above | PO-05 |
| `/platform/activity` | Platform Owner | `audit:read` (read-only) | as above | PO-06 |
| `/platform/settings` | Platform Owner | Own security (sessions, recovery codes, logout-all) in PO-01; platform settings `settings:write` in PO-04/06 | as above | PO-01 / PO-06 |
| Invitation acceptance (tenant side, public, token) | Anonymous holder of a valid token | Token hash + expiry + single use + seat guard | Must be added to the proxy allow-list (tenant side) | PO-02/03 |
| `/(app)/*`, `/print/*`, `/api/document-pdf/*`, `/api/import-template/*`, `/uploads/*` | Tenant users | Existing `requireSession`/`getSession` + org-access check (PO-02) | Tenant cookie only; the platform cookie **never** accepted | unchanged / PO-02 |
| `/login`, `/register`, `/auth/clear` | Anonymous / tenant | Existing; `/register` cutover per D-3 | Unchanged | PO-06/07 (cutover) |

### E.6 Server-action matrix (TRD §8 logical names → guard and phase)

| Action | Guard | Audit | Idempotency | Phase |
|---|---|---|---|---|
| platform login / MFA verify / recover / logout / logout-all / revoke session / regenerate recovery codes | Throttle; then `requirePlatformSession` (re-auth for code regeneration) | `platform_audit_events` | session-scoped | PO-01 |
| `getPlatformDashboard` | `metrics:read` | read (no audit) | — | PO-01 shell / PO-05 |
| `listCompanies`, `updateCompanyMetadata`, `setCompanyAccess`, `createOrganizationInvite` | `companies:*` | yes, with reason for access changes | request key for `setCompanyAccess` and invites | PO-02 |
| `acceptOrganizationInvite` (public token endpoint) | Token validation | tenant `audit_logs` + platform event | single-use token | PO-02 |
| `listCustomerUsers`, `createUserInvite`/`acceptUserInvite`, `setUserStatus`/`setUserRole`, `transferPrimaryOwner` | `users:*` + seat guard + primary-owner guard | yes | request key | PO-03 |
| `createPackage`, `publishPackageVersion`, `archivePackage` | `packages:*` | yes | version conflict check | PO-04 |
| `assignSubscription`, `extendSubscription`, `pauseSubscription` | `subscriptions:*` | yes + `subscription_events` | request key | PO-05 |
| `recordManualPayment` (+ reversal) | `payments:*` | yes | `request_id` UNIQUE (P4b) | PO-05 |
| `exportPlatformMetadataCsv` | `export:metadata` | yes | request key | PO-06 |

---

## F. Database impact

### F.1 Current schema facts (621f156)

- **67 tables** across 33 schema files, from `perl -0777 … pgTable\(\s*"name"` over `src/db/schema/*.ts` (2,387 lines).
- `users`:
  - `email` is `UNIQUE(email)`. This is case-sensitive: constraint `users_email_unique` = `UNIQUE (email)` (Q11).
  - `org_id` is a NOT NULL FK with `ON DELETE CASCADE`.
  - `role` is free text with no CHECK (`users.ts:14`).
  - There is no `UNIQUE(org_id, id)`.
- `sessions`: `org_id` and `user_id` NOT NULL FKs with cascade. Indexes exist on `user_id` and on `token_hash` twice (`sessions_token_hash_unique` + a redundant `sessions_token_idx`). **There is no `org_id` index** (Q09).
- `audit_logs`: `org_id` and `user_id` are nullable FKs (`SET NULL`). `security_events`: `org_id` FK with cascade, `user_id` FK `SET NULL`. Both are append-only via triggers.
  - Consequence (probe P6): hard-deleting an org that has security events is **impossible**. The cascade DELETE hits `reject_mutation()`. This is consistent with the "no tenant delete" exclusion.
- `orgs` has no suspension or status column today.
- No `platform_*`, `tenant_*`, `subscription*` or `*invitation*` objects exist (Q10, zero rows), so there are no name collisions.

### F.2 Migration-mechanism finding

Commands, all against the disposable cluster only:

~~~bash
# push-shaped DB (how production is maintained: db:push = drizzle-kit push && db:harden)
DATABASE_URL=<local test-only URL> npx drizzle-kit push      # exit 0, "Changes applied"
DATABASE_URL=<local test-only URL> npm run db:harden          # installed audit_logs_immutable, security_events_immutable
DATABASE_URL=<local test-only URL> npm run verify:db-hardening # "both append-only triggers present"
# migrations-built DB
DATABASE_URL=<local test-only URL 2> npx drizzle-kit migrate  # exit 0, 0000..0004 applied
# repository read-only gate on both
DATABASE_URL=... npm run db:preflight
~~~

| Database | Tables | Columns | Triggers | `db:preflight` |
|---|---|---|---|---|
| `po00_test_only_pushshape` (from the 621f156 schema) | 67 | 831 | 2 | **STATE: INCONSISTENT, exit 20**. `[PUSH_REFERENCE_STALE] schema source changed since the push reference was measured (reference 8466be2a3289…, current 1a68e4ea4684…)` and `[SCHEMA_UNRECOGNISED]`. "migrate: REFUSED. stamp: REFUSED." |
| `po00_test_only_migshape` (from 0000–0004) | 59 | 609 | 0 | STATE: OK, exit 0 (`SCHEMA_MATCHES_PREFIX "4"`). This DB is **missing 8 tables** the app needs. |

- Tables missing from the migration history: `advance_application_releases`, `advance_applications`, `document_attachments`, `document_column_configs`, `exchange_rates`, `inventory_movements`, `rate_fetch_attempts`, `seal_signature_assets`.
- AUD-08.1 (2026-10-01, `docs/audits/aud-08/README.md`) had already measured a non-additive gap: 7 tables, 204 columns, 1 drop and 61 precision widenings. ACC-01 (`83e8093`, 2026-11-06) changed the schema after that measurement, which made the push reference stale.

**Implications:**
1. `drizzle-kit generate` would produce one migration mixing the platform tables with the unrelated historical drift. **Do not run it into `drizzle/`.**
2. `drizzle-kit migrate` against production would be refused by the gate. That is correct behaviour.
3. `db:push` against production would apply **all** schema differences at once and is subject to the AUD-08 TTY and silent-no-op hazards.

**This is owner decision D-6.**

### F.3 Feasibility probes of proposed constraints

Run on the disposable push-shaped DB inside one transaction, then rolled back. Afterwards 0 `po00_%` objects remained. File: `po00/sql/03_ddl_feasibility_probe.sql`.

| Probe | Result |
|---|---|
| P1 `ALTER TABLE users ADD UNIQUE (org_id, id)` | PASS (feasible on the push shape) |
| P2 `tenant_primary_owners` composite FK `(org_id,user_id) → users(org_id,id)` | PASS: cross-org owner rejected (`foreign_key_violation`) |
| P3 `tenant_subscriptions` partial unique `(org_id) WHERE superseded_at IS NULL` | PASS: second current subscription rejected |
| P4a receipt reference unique on `(org_id, lower(external_reference)) WHERE entry_type='receipt'` | PASS: case-variant duplicate rejected |
| P4b `request_id uuid UNIQUE` | PASS: replay rejected (idempotency) |
| P4c `currency CHECK (= 'SAR')` | PASS: USD rejected |
| P5a/b `platform_audit_events` + existing `reject_mutation()` | PASS: UPDATE and DELETE rejected |
| P6 delete of an org with security events | PASS: blocked by `security_events_immutable` |
| P7 `UNIQUE (lower(email))` while case-variant duplicates exist | PASS: refused (`unique_violation`), so the legacy pre-check is mandatory |
| P8 org-wide revoke `UPDATE sessions … WHERE org_id=$1 AND revoked_at IS NULL` | PASS: 0 unrevoked sessions remain. Without an index the plan is a `Seq Scan`. After `VACUUM`, a partial index `(org_id) WHERE revoked_at IS NULL` gives `Index Scan using po00_sessions_org_live_idx`. |

### F.4 Proposed new tables and dependency order

Columns follow `Schema.md` §3–9 and are not repeated here.

| Order | Tables | Depends on | FK / index notes | Phase |
|---|---|---|---|---|
| M1 | `platform_admins`, `platform_sessions`, `platform_login_attempts`, `platform_audit_events` (+ trigger `reject_mutation()`) | none (no tenant FKs) | `platform_sessions.token_hash` UNIQUE; index on `(admin_id) WHERE revoked_at IS NULL`; attempts indexed by `(account_key, created_at)` and `(ip, created_at)`; audit append-only | PO-01 |
| M2 | `tenant_access_controls` | `orgs` | PK `org_id` FK `ON DELETE RESTRICT`; missing row = active (compatibility) | PO-02 |
| M3 | `organization_invitations` | `platform_admins` | `token_hash` UNIQUE; partial unique on pending `lower(email)`; `expires_at` index | PO-02 |
| M4 | `sessions` index `(org_id) WHERE revoked_at IS NULL` (existing table, additive) | `sessions` | Proven by P8 | PO-02 |
| M5 | `users` `UNIQUE(org_id, id)` (additive) + `tenant_primary_owners` | `users`, `orgs` | Composite FK (P1/P2) | PO-03 |
| M6 | `user_invitations` | `orgs`, `platform_admins` | same token rules | PO-03 |
| M7 | `subscription_packages`, `subscription_package_versions` | `platform_admins` | at most one default trial (partial unique); published versions immutable | PO-04 |
| M8 | `platform_settings` (singleton id=1, CHECK ranges per Schema.md §9) | none | `CHECK (id = 1)` | PO-04 if the default trial needs `trial_days`; otherwise PO-06 (settings UI per Plan.md) |
| M9 | `tenant_subscriptions`, `subscription_events` | `orgs`, package versions | P3; date-only `starts_on`/`ends_on`, Asia/Riyadh semantics | PO-05 |
| M10 | `subscription_payments` | `tenant_subscriptions` | P4a–c; `numeric(14,2)` positive; reversal links | PO-05 |

Every table is **additive**. The only changes to existing tables are two additive indexes or constraints (M4, M5). No existing column is altered and nothing is dropped.

### F.5 Legacy primary-owner anomalies and compatibility

- **Classification.** Q04 classifies orgs as:
  - A: exactly one active owner. Eligible for backfill per `Schema.md:261`.
  - B: one active owner plus inactive owner(s). Eligible under a strict "one valid active owner" reading; report for confirmation.
  - C: multiple active owners.
  - D: only inactive owner(s).
  - E: no users.
  - F: no owner role.

  Classes C–F are reported for a **manual, authorized decision**, never chosen arbitrarily (`Schema.md:261`).

  Proof on fixtures: every one of the six fixture orgs landed in its intended class.
- **Non-canonical roles.** Q03 found a role value of `'Owner'`, which the role checks don't treat as `owner`. Production must be measured; normalizing role values needs separate authorization.
- **Case-variant e-mails.** Q05 found 1 group in the fixtures. These block a future `lower(email)` uniqueness constraint (P7) and confuse invitation e-mail checks.
- **Sessions.** Q07 found sessions whose `org_id` differs from their user's org (fixture: 1). This must be 0 before org-wide revoke is trusted.
- **Legacy orgs.** Remain *active and unsubscribed* (grandfathered, `Schema.md:264`). No retroactive suspension, and no automatic paid subscriptions.
- **Session/security migration risks.**
  - Adding the org-access check changes customer auth. That is PO-02 with dedicated regression tests.
  - Rejecting jti-less tokens (D-8) logs out only tokens older than Stage 11 (2026-07-18); expected impact is nil.
  - The proxy change in PO-01 must leave tenant routing byte-identical (tests).

### F.6 Read-only production queries — prepared, NOT executed (authorization requested: D-7)

The file `po00/sql/02_readonly_baseline_queries.sql` runs inside `BEGIN TRANSACTION READ ONLY` with `statement_timeout 15s` and `lock_timeout 2s`, then `ROLLBACK`. It outputs **aggregates and numeric ids only** (no e-mails, names, hashes or tokens).

| Query | Purpose | Result on the disposable fixture DB |
|---|---|---|
| Q01 | Server version, Drizzle bookkeeping presence | `160015`, `has_drizzle_bookkeeping = f` |
| Q02 | org/user counts (active/inactive) | 6 / 13 / 10 / 3 |
| Q03 | Role value distribution, non-canonical flag | `Owner` 1 (non-canonical), `admin` 3, `owner` 6, `staff` 3 |
| Q04 | Owner classification per org | A {9001}, B {9005}, C {9003}, D {9004}, E {9006}, F {9002} |
| Q05 | Case-insensitive e-mail collisions (ids) | 1 group {9104, 9303} |
| Q06 | Users per org distribution (seat baseline) | max 5, p50 2, p95 5 |
| Q07 | Live / expired-unrevoked / revoked sessions, org-user mismatch | 3 / 1 / 1 / 1 |
| Q08 | Append-only triggers bound to the right tables | both present on `audit_logs` / `security_events`, enabled `O` |
| Q09 | `sessions` indexes | pkey, token_hash unique, token_idx (redundant), user_idx; **no org index** |
| Q10 | Name collisions with proposed objects | 0 rows |
| Q11 | `users` unique/check constraints | `users_email_unique UNIQUE (email)` only |

The repository gate `npm run db:preflight` is itself read-only (its header: *"It NEVER writes … opens one read-only connection, runs SELECTs, and exits"*). It can also be run against production **only with the same authorization**. Expected outcome is INCONSISTENT or REFERENCE/PUSH_STALE.

### F.7 Rollback and restore approach (for later phases)

- **Additive objects.** Each phase ships a matching, reviewed `DROP … IF EXISTS` rollback script for its own new objects only. Dropping platform tables never touches tenant data, because platform tables reference tenant tables and not the reverse.
- **Platform audit tables.** Being append-only, rollback means `DROP TABLE`, which needs an explicit owner authorization because it destroys audit evidence.
- **Tenant-auth integration (PO-02).** Rolled back by code revert. Feature flag off restores tenant behaviour. Missing `tenant_access_controls` rows are treated as active.
- **Restore.** CLAUDE.md records the owner's acceptance of test-data loss. Backups are a convenience, not a gate. PO-07 still rehearses the restore on a disposable copy per `Plan.md` PO-07.

---

## G. Design-system mapping

### G.1 Tokens and global foundations (deployed, owner-accepted)

| Token / foundation | Deployed value (evidence) | Platform use |
|---|---|---|
| Primary (orange fill) | `--primary: light-dark(#f06000, #ff6600)` (`globals.css:120`) | Primary buttons, selected nav, active tabs |
| Text on orange | `--primary-foreground: light-dark(#ffffff, #ffffff)` (`:121`); `--accent-foreground` the same (`:124`) | **Owner rule satisfied: white text on every orange fill** |
| Hover | `--primary-hover: light-dark(#e65c00, #ff7b24)` (`:122`) | as deployed |
| Orange ink on surfaces | `--accent-ink: light-dark(#b84900, #ff6600)`; `--accent-tint: light-dark(#fff0e5, #3d220f)` (`:125-126`) | Badges, links; ≥4.5:1 (verify:contrast PASS) |
| Header | `--header-bg: light-dark(#1a1c2e, #212121)`, `--header-height: 56px` (`:150-158`) | Platform top bar |
| Fonts | Inter + IBM Plex Sans Arabic via `next/font` (`src/app/layout.tsx:2-41`) | Inherited by any route group |
| Direction | Root layout reads the locale (`layout.tsx:56`) and renders `<html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>` (`:60-62`) | RTL inherited |
| Parity | `src/lib/design-tokens.ts` mirrors `globals.css` | Use the tokens; no new hex values |

### G.2 Component mapping (UI_spec inventory → repository)

| UI_spec component | Existing asset | Approach |
|---|---|---|
| Header / sidebar / mobile nav | `(app)/shell.css` classes (`.app-frame`, `.topbar`, `.brand-mark`…), `(app)/lcp.css`, `BrandMark`, `ThemeToggle`, `LanguageSwitcher` | **New** `PlatformShell` / `PlatformSidebar` / platform nav (groups Workspace / Tenants / Governance), importing the same CSS. **Do not modify** `AppShell`, `Sidebar`, `NavList`, `nav-config.ts` or `mobile-nav.tsx` (tenant-coupled). No org white-label CSS (AppShell injects `buildThemeOverrideCss`, `app-shell.tsx:8`; the platform must not). |
| PlatformPageHeader | `src/components/layout/page-header.tsx` (`data-slot="page-header"`, styled by lcp.css) | Reuse |
| MetricCard | `src/components/ui/summary-card.tsx`; `(app)/dashboard/_shared/kpi-card.tsx` (`.kpi-card-v4` in lcp.css) | Reuse or compose |
| PlatformDataTable | `src/components/ui/table.tsx` (`table.data-table`, density; "no column engine", line 5) | Thin platform wrapper adding sort and server pagination. No shared pagination component or helper exists: grep finds only page-local logic in `finance/statements/page.tsx`, and the `utils.ts` "page" hit is a typography token. |
| SearchFilterToolbar | `list-search.tsx`, `filter-panel.tsx` | Reuse |
| StatusPill | `status-badge.tsx` + status registry (`verify:status-registry`) | Map platform statuses onto existing tones. Registry additions are checked by that suite. |
| PackageCard | `card.tsx` | Reuse |
| EntityDrawer | `drawer.tsx` | Reuse |
| ConfirmActionDialog | `dialog.tsx`; `(app)/_shared/confirm-provider.tsx` (tenant confirm policy) | Reuse the dialog primitive with a platform-local confirm policy (reason field) |
| InviteDialog | dialog + `form-field` + `input` + `select` | Reuse |
| Toast / InlineError | `sonner.tsx`, form-field error | Reuse |
| Empty / Loading / Error states | `empty-state.tsx`, `skeleton.tsx`; `verify:skeletons` | Reuse + per-route `error.tsx` |
| Charts (registrations, package mix) | `recharts` is a dependency but has **zero imports** in `src` (grep); dashboard uses KPI cards | PO-06 technical choice: first `recharts` use (bundle cost) vs CSS bars. Data must be real (`PRD.md:104`). |
| Dates | `formatDisplayDate` (UTC), `date-only.ts` | + `todayInRiyadh()` (C-11) |

### G.3 Accessibility and contrast trade-offs (documented, not changed)

- **White on orange.** 3.29:1 on light `#F06000` and 2.94:1 on dark `#FF6600` (hover 3.56 / 2.59:1). Both are below WCAG AA 4.5:1 for body text, and dark mode is also below the 3:1 large-text threshold.
  - This is accepted by the owner (handover §7, lines 208-214). The all-routes sweep reports 8,136 such elements as accepted rather than failed (handover line 180).
  - The platform console **inherits** this exception. It adds no new text-on-orange combinations other than white, and no darker-orange variant (C-1).
- **Pale orange tints.** These carry orange ink (≥4.5:1). That is the accepted live pattern; tints are not saturated orange fills.
- **QA.** The UI_spec QA matrix is 6 viewports × light/dark × EN/AR. The platform reuses `verify:contrast`-style measurement for its screens and keeps the "0 app text below AA except the accepted labels" result.

---

## H. Roadmap PO-01 → PO-07

### H.1 Branch strategy (not created; needs owner authorization)

- **One program branch** (`Plan.md` git hygiene rule 1): proposed name `feat/platform-owner`, created from `main@621f156f7b129b9c2e289bc46d314ce7587beec2`.
- Per-phase checkpoint commits. Corrections are new commits; no amend, no force-push, no rebase of reviewed history (`Plan.md` rule 4). If `main` moves, merge `main` into the branch with a merge commit, after re-running the §B.1 logic-diff check.
- Review via one **draft** PR `feat/platform-owner → main`, opened only when the owner authorizes. It is never merged without explicit authorization.
- PR #11 stays draft and unmerged. The program branch does **not** copy its docs; it references them by head SHA `357e93e`.
- `main` has no branch protection. Enabling it (required review + CI) is owner decision D-10.

### H.2 Phases

| Phase | Scope (refined) | Depends on | Est. Claude Code prompts | Test gate (IDs per Plan.md) |
|---|---|---|---|---|
| **PO-01** Secure foundation | M1 tables (TS schema + reviewed SQL, disposable DBs only); `src/lib/platform/{auth,session,guards,mfa,throttle,audit,errors,flags}`; bootstrap CLI (local-only); proxy `/platform` branch (tenant byte-identical); `/platform/login`, `/platform/recover`, guarded console layout, `PlatformShell` with 7 nav entries (placeholders); own-security settings (sessions, logout-all, recovery codes); EN/AR, light/dark | PO-00 + C1/C2 | **4–6** (01a schema+lib+CLI, review, 01b proxy+routes+shell, review, 1–2 corrections) | SEC-01..05, AUD-01, UI-01 (shell), ERP-01 (tsc, eslint src, verify:static, tests/security, tenant proxy regression) |
| **PO-02** Companies + onboarding + suspension | M2–M4; company list/drawer (metadata allowlist); organization invitations (copy link) + public acceptance (register transaction + seed); `setCompanyAccess`; org check in `lookupSessionByToken` + `loginAction`; `revokeOrgSessions`; reject jti-less tokens (D-8) | PO-01 accepted; D-7 recommended | **4–6** | ORG-01..04, SEC regression, full tenant login/print/PDF/uploads regression under suspension |
| **PO-03** User operations | M5–M6; directory; user invitations; status/role; primary-owner transfer; `assertUserSeatAvailable` in register, team add and invite acceptance; grandfathering | PO-02; D-5 for seat caps; owner-anomaly data | **4–6** | USR-01..05 (last-owner, concurrency, all 3 creation paths, grandfathering) |
| **PO-04** Package catalog | M7–M8; packages, immutable versions, duplicate/archive, default trial; module/storage labels "Configured — not enforced yet" | PO-01 (+ PO-02 identity); prices D-1 (drafts until approved) | **2–4** | PKG-01..02, bilingual UI |
| **PO-05** Subscriptions + manual payments | M9–M10; assign, renew `max(end,today)+N`, pause/resume, receipts/reversals (SAR, idempotent), dashboard metrics (estimated MRR label) | PO-04 + PO-03 seats | **4–6** | SUB-01..03, PAY-01..02, ERP-01 (ACC-01 ledger suites green; no tenant GL writes) |
| **PO-06** Activity, settings, polish | Activity log (platform audit), platform settings, metadata CSV export, full EN/AR RTL, light/dark, responsive, perf at 1,000 synthetic orgs | PO-01..05 | **3–5** | Full route matrix, UI QA matrix (6 viewports × 2 × 2), cross-tenant + ACC regression, NFR p95 |
| **PO-07** Release preparation | Re-established schema parity (D-6), migration dry run on a disposable copy of the production schema, backup/restore rehearsal, bootstrap runbook (D-2), cutover plan (D-3), smoke/rollback scripts; **deployment is a separate authorization** | PO-06 accepted; D-1..D-9 resolved | **2–4** (+2–4 if the AUD-08.2/08.3 reconciliation is chosen) | Exact approved SHA, isolated migration proof, signed checklist |
| **Total** | | | **≈ 23–37** (+2–4 optional AUD-08) | |

`Plan.md:32` allows PO-04 to run in parallel with PO-03 after PO-02.

### H.3 Per-phase acceptance rules (all phases)

1. **Tests.** Source-based evidence lists tests run vs not run, branch, SHA, diffs, screenshots and known gaps (`Plan.md` "Definition of complete").
2. **UI preview.** Screens are shown with **fictional data** on disposable `po0N_test_only_*` databases. Minimum per phase is EN + AR × light + dark at 1440 / 1024 / 390 px; the full matrix applies in PO-06.
3. **Review checkpoint.** After each sub-batch, an independent verdict: APPROVED / APPROVED WITH CONDITIONS / REJECTED (`Plan.md` rule 3).
4. **Existing gates stay green.**
   - `tsc --noEmit`;
   - `eslint src --max-warnings=0`;
   - `verify:static` (22 suites);
   - `tests/security/*`;
   - the relevant `verify:server` suites on a disposable DB;
   - the UI baseline for any shared CSS touch (expected: none).
5. **Platform static guard.** Every mutating server-action file in `src/app/(platform)` calls `requirePlatformSession`/`requirePlatformPermission`. No `(platform)` file imports tenant guards or business schemas beyond the allowlist. No `(app)` file imports platform guards.

---

## I. Risks, blockers and unresolved decisions

### I.1 Risks ranked by severity

| Rank | Risk | Severity | Blocks | Mitigation |
|---|---|---|---|---|
| 1 | No gate-approved production migration path: preflight INCONSISTENT, migrations stale by 8 tables, push reference stale (§F.2) | **Critical** | Any production schema change | Disposable-only development; D-6 before PO-07 |
| 2 | Suspension bypass via shared customer auth (G-1/G-2/G-3/G-10) | **Critical for PO-02** | PO-02 acceptance | Org check in lookup and login, org-wide revoke, reject jti-less tokens, full regression |
| 3 | Platform/tenant token confusion; proxy lacks a platform branch (G-11) | High | PO-01 | Separate cookie, secret and claims; tests in both directions |
| 4 | Non-durable throttle; TOTP replay; no idle tracking (G-5/G-6/G-9) | High | PO-01 | Platform-specific DB throttle, step guard, activity update |
| 5 | Unknown legacy owner, role and e-mail anomalies in production (Q03–Q07 unmeasured) | High | PO-02/03 backfill | D-7 read-only queries; manual decisions for classes C–F |
| 6 | Accidental change to the accepted live UI when building the shell | High | PO-01 | New `PlatformShell`; no shared-component edits; UI-baseline proof if any shared CSS is touched |
| 7 | Accounting contamination by subscription payments | High | PO-05 | Separate tables; ACC-01 regression suites |
| 8 | No branch protection on `main`; CI omits verify suites | Medium | Process | D-10; reviewer gate; run suites locally per phase |
| 9 | Seat-limit races across 3 creation paths | Medium | PO-03 | Central guard with org-row lock |
| 10 | Platform actions not covered by existing CI access test (walks `(app)` only) | Medium | PO-01 | Sibling platform static test |
| 11 | `verify:db-hardening` satisfied by decoy trigger names | Medium | PO-01 audit trigger | `tgrelid`-bound check (Q08 style) |
| 12 | Pre-existing tenant issues G-4, G-7, G-8 | Medium | — (not PO scope) | Record; separate authorized fix later. The platform must not copy these patterns. |
| 13 | Repo-wide `npm run lint` has 11 errors in non-src scripts (CI lints `src` only) | Low | — | Separate hygiene task |
| 14 | Redundant `sessions_token_idx` | Low | — | Optional later cleanup (authorized) |
| 15 | Dormant signed branding URLs bypass session and suspension if ever minted | Low | — | Re-check if `signFileUrl()` gains callers |

### I.2 Unresolved owner decisions (genuine, evidence-backed; no prices or requirements invented)

| ID | Decision | Source | Needed by |
|---|---|---|---|
| D-1 | Actual Starter/Growth/Business prices and default seats (SAR). Prototype prices are fictional and are **not** used. | PRD pending (a); `Schema.md:263` | PO-04 publish / PO-05 |
| D-2 | Initial Platform Owner identity and production bootstrap channel (e.g. CLI over SSH on the VPS) | PRD pending (b); TRD §3.1 | PO-07 |
| D-3 | Production registration policy cutover: public `/register` → invite-only, and when | PRD pending (c); `Schema.md:265` | PO-06/07 |
| D-4 | ~~Final LCP visual acceptance~~ **satisfied** 2026-11-13 (621f156 deployed and accepted) | PRD pending (d) | — |
| D-5 | Authorization for migration/merge/deploy, and the seat cap applied to existing tenants (grandfathering) | PRD pending (e) | PO-03 / PO-07 |
| D-6 | Production migration mechanism: (a) complete AUD-08.2/08.3 baseline reconciliation, then gate-approved migrations; or (b) a reviewed `db:push` on the development VPS under the CLAUDE.md test-data posture, with disposable rehearsal | §F.2 evidence | Before any production schema change |
| D-7 | Authorize running `po00/sql/02_readonly_baseline_queries.sql` (and optionally `db:preflight`) read-only against production Neon, or waive under the test-data posture | PO-00 §6 rule | PO-02/03 backfill |
| D-8 | Approve rejecting legacy jti-less customer tokens. This changes customer auth; expected impact is nil (Stage 11 since 2026-07-18, 30 d expiry). | §E.1 G-2 | PO-02 |
| D-9 | Confirm platform session lifetimes (12 h absolute / 30 min idle are TRD candidate defaults "verify with owner/security review before release") | TRD §3.1 | Before release |
| D-10 | Enable branch protection on `main` (required PR review + CI) | §B.2 evidence | Recommended before PO-02 |

---

## J. Complete PO-01 prompt (proposed, NOT executed)

> The prompt is reproduced in the final chat response as section 9, in one copyable block. The text below is identical.

ELITE ERP — PLATFORM OWNER SYSTEM — PHASE PO-01: SECURE PLATFORM FOUNDATION

AUTHORIZATION AND SCOPE
- This prompt authorizes PO-01 only:
  - implementation on ONE new branch named feat/platform-owner, created from main at 621f156f7b129b9c2e289bc46d314ce7587beec2;
  - local verification against disposable TEST-ONLY databases;
  - commits and a push of that branch only.
- It does NOT authorize any of the following:
  - merging; opening a non-draft PR; pushing to main;
  - any production access (Hostinger VPS, Neon, Nginx, systemd, environment secrets, live site);
  - migrations, db:push, backfills or seeds against any non-disposable database;
  - deployment or service restarts;
  - outbound e-mail or WhatsApp;
  - changes to the live design system;
  - starting PO-02.
- PR #11 must remain draft and unmerged. Do not copy its documents into the branch; reference them by head SHA 357e93e332f9d5cc3d95643cf89d55dd23ca2f1b.
- Canonical specs: PR #11 docs/platform-owner/stage-2/{PRD,appflow,UI_spec,TRD,Schema,Plan}.md, as amended by PLATFORM_OWNER_BASELINE.md (PO-00) sections C.2 and E.2. Where they conflict, the PO-00 report's documented resolutions apply (white text on the deployed orange; no #C95000; SameSite=Lax per TRD).

STEP 0 — BASELINE RE-VERIFICATION (stop and report if any check fails)
1. Fetch origin.
   - Record main HEAD, its parents and tree.
   - Confirm 621f156 is on main.
   - Confirm PR #11 is open, draft and unmerged at head 357e93e.
2. If main != 621f156, run:
   git diff --name-only 621f156 origin/main -- src/lib/auth.ts src/lib/session.ts src/lib/security src/lib/tenant.ts src/lib/rate-limit.ts 'src/app/(auth)/actions.ts' src/proxy.ts src/db drizzle scripts src/app/globals.css 'src/app/(app)/shell.css' 'src/app/(app)/lcp.css' src/components/layout
   If anything is listed, STOP and report before writing code.
3. Create feat/platform-owner from the verified main SHA. Never amend or force-push. Corrections are new commits.
4. Confirm grep finds no existing src/app/(platform), src/lib/platform or platform_* schema.

STEP 1 — DISPOSABLE DATABASES ONLY
- Start a local PostgreSQL cluster bound to 127.0.0.1. Every database name must contain "_test_only_" (e.g. po01_test_only_push).
- Build the baseline with drizzle-kit push from the branch schema, then npm run db:harden, against that local database only.
- Never print a database URL. Never connect to any non-local host.
- Do NOT run drizzle-kit generate into drizzle/. PO-00 proved it would bundle the unrelated 8-table historical drift.
- Do not modify:
  - drizzle/0000-0004, drizzle/meta, drizzle/immutable_audit.sql;
  - scripts/apply-db-hardening.ts, scripts/migration-preflight.ts;
  - docs/audits/aud-08 evidence.

STEP 2 — SCHEMA (additive, platform-only, no FKs to tenant tables)
1. Add src/db/schema/platform.ts with platform_admins, platform_sessions, platform_login_attempts and platform_audit_events, per Schema.md sections 3.1–3.4. Export it from src/db/schema/index.ts.
   - platform_admins: status, password hash, encrypted TOTP secret, hashed recovery codes, last accepted TOTP step, mfa_enrolled_at, timestamps. No default rows.
   - platform_sessions:
     - token_hash UNIQUE;
     - created_at, last_activity_at, absolute_expires_at;
     - revoked_at, revoked_reason, ip/ua/device;
     - index on (admin_id) WHERE revoked_at IS NULL.
   - platform_login_attempts: account key (normalized e-mail), ip, outcome, created_at. Indexes (account_key, created_at) and (ip, created_at).
   - platform_audit_events: actor admin id (nullable for anonymous login failures), action, target type/id, reason, metadata jsonb (never secrets), ip/ua, created_at.
2. Add a reviewed, idempotent SQL file drizzle/platform/PO01_platform_identity.sql. It creates the same objects plus:
   CREATE TRIGGER platform_audit_events_immutable BEFORE UPDATE OR DELETE … EXECUTE FUNCTION reject_mutation()
   (reusing the existing function).
3. Add scripts/platform-db-check.ts (read-only) to prove the trigger is bound to platform_audit_events by tgrelid, not by name.
4. Prove equivalence on two disposable DBs:
   (a) drizzle-kit push of the branch schema + PO01 SQL trigger;
   (b) push of the 621f156 schema + the PO01 SQL file.
   Compare the platform_* projection (columns, types, defaults, constraints, indexes, triggers) and report the diff (expected: none).
5. Report the npm run db:preflight state on the disposable push DB (expected INCONSISTENT / PUSH_REFERENCE_STALE, as in PO-00). Do NOT regenerate AUD-08 evidence.

STEP 3 — PLATFORM AUTH LIBRARY (src/lib/platform/, server-only)
- auth.ts:
  - bcryptjs hashing via the existing pattern;
  - platform password policy via validatePassword() with a stricter platform constant (proposed minimum 14 characters plus the common-password check; reviewer may adjust; list it as a deviation in the handover);
  - JWT HS256 via jose using PLATFORM_AUTH_SECRET (fail fast if missing or shorter than 32 bytes);
  - claims typ:"platform", aud:"elite-erp-platform", iss:"elite-erp", sub, jti, iat, exp ≤ 12h;
  - verification checks alg, typ, aud and iss.
- session.ts:
  - create, validate, touch (throttled ≤ 60 s) and revoke;
  - 12 h absolute and 30 min idle (single config constant, flagged in the handover for owner confirmation D-9);
  - store only sha256(jti).
- guards.ts:
  - requirePlatformSession() checks signature + typ/aud + live row + not expired (absolute/idle) + admin active + MFA-complete, and redirects to /platform/login otherwise;
  - requirePlatformPermission(perm) is a one-role allowlist for now.
  - Both are React cache()-deduplicated.
- mfa.ts:
  - reuse src/lib/security/totp.ts;
  - reject a TOTP step ≤ the stored last accepted step (replay guard);
  - recovery codes bcrypt-hashed and single use, with a regeneration flow requiring password + TOTP;
  - secrets via encryptField/decryptField. Refuse legacy plaintext for platform secrets.
- throttle.ts:
  - DB-backed, per account and per IP (e.g. 5 failures / 15 min with exponential backoff);
  - durable across process restarts;
  - generic user-facing message.
- audit.ts: append-only writer for platform_audit_events; no update/delete helpers.
- errors.ts: the TRD typed errors (UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, …).
- flags.ts: PLATFORM_CONSOLE_ENABLED, default false. When false, every /platform path returns 404.
- Unknown-account logins perform a dummy bcrypt compare (no timing enumeration). Never log passwords, codes, tokens or token links.
- Do NOT change tenant code paths in PO-01:
  - src/lib/auth.ts, src/lib/session.ts, src/lib/security/*, src/lib/rate-limit.ts and src/app/(auth)/actions.ts stay unchanged;
  - the only tenant-adjacent change allowed is the proxy branch in STEP 4.

STEP 4 — PROXY BOUNDARY (src/proxy.ts)
- For /platform paths, run before tenant logic:
  - flag off → 404;
  - /platform/login and /platform/recover always render;
  - other /platform/* paths need an edge-safe jwtVerify of the PLATFORM cookie (name __Host-elite_erp_platform in production, elite_erp_platform in dev; HttpOnly; Secure in production; SameSite=Lax; Path=/; no Domain) with typ/aud checks, else redirect to /platform/login and clear only the platform cookie.
- Never read the tenant cookie on /platform paths. Never read the platform cookie on tenant paths.
- Tenant behaviour for /, /login, /register, /auth/clear, protected tenant routes, static assets and the matcher must stay identical. Prove it with tests.

STEP 5 — ROUTES AND ACTIONS (src/app/(platform)/platform/...)
- /platform/login: e-mail + password, then a TOTP challenge. Recovery-code alternative at /platform/recover.
- (console) layout guarded by requirePlatformSession. /platform redirects to /platform/dashboard.
- The seven navigation sections exist as guarded pages:
  - Dashboard, Companies, Users, Subscribers, Subscription Packages, Activity Log, Settings;
  - all except Settings render an EmptyState "available in a later phase" (EN/AR) and show no data.
- /platform/settings (security tab):
  - active platform sessions with revoke and logout-all;
  - recovery-code regeneration (step-up: password + TOTP);
  - logout.
- Every server action calls requirePlatformSession/requirePlatformPermission inside the action. Validate input with zod. Audit every event: login success/failure/lockout, MFA failure, recovery-code use, logout, revoke, regeneration, bootstrap.
- No impersonation. No tenant session minting. No tenant business tables read.

STEP 6 — BOOTSTRAP CLI (scripts/platform-bootstrap.ts, npm script platform:bootstrap)
- Interactive, TTY only:
  - refuses if any active platform admin exists;
  - prompts for e-mail, name and a password (hidden input; policy enforced);
  - generates a TOTP secret, shows the otpauth URI, and requires a valid code typed back;
  - generates and prints 10 recovery codes once;
  - writes a platform_audit_events "platform.bootstrap" row.
- In PO-01 it MUST refuse unless DATABASE_URL's host is 127.0.0.1, localhost or ::1 AND the database name contains "_test_only_". The production channel is a separate PO-07 decision (D-2).
- No default credentials anywhere: not in code, seeds, tests, fixtures, CI or docs.
- Tests create admins through library helpers on disposable DBs with fictional identities only (e.g. owner@platform.test).

STEP 7 — UI SHELL (src/components/platform/)
- PlatformShell, PlatformSidebar and platform-nav.ts (groups Workspace / Tenants / Governance per UI_spec). Mobile drawer included.
- Built from the existing classes and imports: src/app/(app)/shell.css and src/app/(app)/lcp.css; BrandMark, ThemeToggle, LanguageSwitcher, PageHeader, Card, Button, Input, Dialog, Drawer, Table, EmptyState, Skeleton, Sonner.
- Do NOT modify:
  - AppShell, Sidebar, NavList, nav-config.ts, mobile-nav.tsx;
  - globals.css, design-tokens.ts, shell.css, lcp.css, mockup-parity.css;
  - any src/components/ui file.
- Use only existing tokens. Add no new hex colours and no #C95000.
- White text on every orange fill (--primary-foreground), as deployed. Inherit the owner-accepted contrast exception; do not change it.
- No org white-label theming in the platform console.
- Native Saudi-business Arabic for every new string, from the first commit, via the t(locale, en) dictionary pattern.
  - RTL correct; directional icons mirrored; numbers and dates LTR inside RTL.
  - Light and dark both supported.

STEP 8 — TESTS (all must pass; list tests run vs not run)
- SEC-01, token confusion:
  - tenant cookie on /platform/* → /platform/login;
  - platform cookie on tenant routes → /login, and on tenant server actions → rejected;
  - a tenant token placed in the platform cookie slot and vice versa → rejected.
- SEC-02, throttling:
  - durable throttle per account and per IP, still enforced after a simulated restart;
  - generic errors; dummy-hash timing path exercised.
- SEC-03, MFA:
  - MFA required on every login;
  - invalid TOTP denied; same-step TOTP replay denied;
  - recovery code single use; recovery replay denied;
  - all of the above audited.
- SEC-04, sessions:
  - absolute and idle expiry via an injectable clock;
  - single revoke and logout-all;
  - logout clears the cookie with identical attributes;
  - revoked session denied immediately;
  - password/MFA change revokes other sessions;
  - bootstrap refusals: an active admin already exists; non-local host; name without _test_only_.
- SEC-05, static guards:
  - add tests/security/platform-access.test.mjs. Every mutating server-action file under src/app/(platform) calls requirePlatformSession or requirePlatformPermission.
  - no (platform) file imports requireSession/requireRole/getSession or tenant business schemas;
  - no (app) file imports src/lib/platform guards;
  - flag off → 404 for /platform/*.
- AUD-01: on a disposable DB, UPDATE and DELETE on platform_audit_events are rejected; scripts/platform-db-check.ts passes, and fails on a decoy-named trigger.
- UI-01:
  - login, MFA challenge, shell, settings-security and an empty section page at 1440/1024/390 px × EN/AR × light/dark, with fictional data;
  - Arabic assertion regex [؀-ۿ] on new screens;
  - static check that platform components use only existing CSS variables.
- ERP-01 regression:
  - npx tsc --noEmit;
  - npx eslint src --max-warnings=0;
  - npm run verify:static (22 suites);
  - node tests/security/crypto-policy.test.mjs and access-control.test.mjs;
  - tenant proxy behaviour tests (/, /login, /register, /auth/clear, protected route, stale cookie);
  - npm run build with test-only env values.

STEP 9 — ENV AND SECRETS
- Add empty placeholders PLATFORM_AUTH_SECRET= and PLATFORM_CONSOLE_ENABLED= to .env.example only.
- Generate throwaway test values at runtime. Never commit, print or screenshot secrets, cookies, tokens, URLs with credentials, or real records.

STEP 10 — COMMITS, PUSH, HANDOVER, STOP
- Commit in two reviewable sub-batches:
  - PO-01a: schema + SQL + library + CLI + their tests;
  - PO-01b: proxy + routes + shell + UI tests.
- Commit trailers per the session instructions. Push only feat/platform-owner. Do not open a PR unless the owner explicitly authorizes a DRAFT PR.
- Deliver one copyable markdown handover:
  - scope; branch; SHAs; files changed;
  - schema projection diff;
  - tests run (with outputs) vs not run;
  - screenshots list (fictional data);
  - deviations from the specs, with evidence;
  - open decisions (D-2, D-6, D-9);
  - known gaps.
- STOP for independent review (APPROVED / APPROVED WITH CONDITIONS / REJECTED). Do not begin PO-02.

---

## Appendix — Tests completed vs not run (PO-00)

### Completed (local clone of 621f156; disposable TEST-only DBs; fictional data)

| Test | Command | Result |
|---|---|---|
| Dependency install | `npm ci --ignore-scripts --no-audit --no-fund` | exit 0 |
| Type check | `npx tsc --noEmit -p tsconfig.json` | exit 0 (18.6 s) |
| CI lint gate | `npx eslint src --max-warnings=0` | exit 0 |
| Repo-wide lint | `npm run lint` | exit 1: 33 problems (11 errors, 22 warnings), **all outside `src/`** (docs/audits evidence, scripts/tests, tests/security/crypto-policy.test.mjs, verify/*). Pre-existing. |
| Static verification | `npm run verify:static` (22 suites, incl. `verify:lcp-design` 77/77, `verify:contrast`) | exit 0 (45 s) |
| Security tests | `node tests/security/crypto-policy.test.mjs` / `access-control.test.mjs` | 18/18, 22/22 |
| Schema push (disposable) | `drizzle-kit push` → `db:harden` → `verify:db-hardening` | exit 0; 67 tables, 831 columns, 2 triggers |
| Migrations (disposable) | `drizzle-kit migrate` | exit 0; 59 tables, 609 columns, 0 triggers |
| Migration gate | `npm run db:preflight` on both | push shape INCONSISTENT (20); migration shape OK (0) |
| Read-only queries | `po00/sql/02_readonly_baseline_queries.sql` on fixtures | all 11 queries returned the expected values (§F.6) |
| Constraint probes | `po00/sql/03_ddl_feasibility_probe.sql` | 11/11 PASS, rolled back, 0 residual objects; partial-index plan verified |
| GitHub | `ls-remote`, `merge-tree`, MCP `list_pull_requests` | §B.2 |

### Not run (and why)

| Not run | Reason |
|---|---|
| Any query against production Neon | Not authorized (D-7). Queries prepared. |
| `npm run build` | Not needed for PO-00 (CI builds; production already runs 621f156). Required in PO-01. |
| `verify:server` (DB-mutating suites), `verify:browser`, `ui:baseline`, Playwright | Not needed for a read-only baseline. They run per phase on disposable DBs. |
| Live site / VPS / Nginx / systemd checks | Outside the PO-00 read-only repository scope. |
| PostgreSQL 17 parity | Local cluster is 16.15 (production Neon is 17). Probes use standard features; PO-07 must repeat on 17. |
| GitHub CI re-run | Nothing pushed. |

### Preserved files (repository-relative)

- `docs/platform-owner/PO00_BASELINE.md`: this report (originally delivered as `PLATFORM_OWNER_BASELINE.md`).
- `docs/platform-owner/po00/sql/01_fixtures_fictional.sql`: fictional fixtures for a disposable TEST-only database.
- `docs/platform-owner/po00/sql/02_readonly_baseline_queries.sql`: read-only queries, NOT run against production (D-7).
- `docs/platform-owner/po00/sql/03_ddl_feasibility_probe.sql`: rolled-back DDL feasibility probe (disposable DB only).
- Evidence logs (`readonly-queries-test.out`, `ddl-probe-test.out`, `preflight-*.log`, `verify-static.log`, `tsc.log`, `lint.log`, `eslint-src.log`, `sec-*.log`, `push.log`, `migrate.log`, `harden.log`) stayed in the local session workspace. **They are not committed**: logs are never committed to this repository.
