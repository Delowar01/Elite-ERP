# Platform Owner — PO-02D3: company invitation acceptance and automatic Trial onboarding

> Phase PO-02D3 of the Elite ERP Platform Owner programme. **Development only.** It adds the public invitation-acceptance
> page **`/register/accept`** behind a new feature flag, `CUSTOMER_INVITE_ACCEPTANCE_ENABLED`, which is **off by default**.
> With the flag on, the holder of a PO-02D2 one-time link reviews the invited company and its offered Trial, confirms
> their name, chooses a password, and accepts. ONE database transaction then creates the organization, its owner, the
> existing organization defaults, the active company-access row, the primary-owner mapping, the Trial subscription
> (from the invitation's own, immutable package version), its first subscription event, the accepted invitation status,
> the platform audit record and the customer audit / security evidence. Any failure leaves none of it. No session is
> issued (the new owner signs in at the existing `/login`), nothing is delivered (no e-mail, SMS or WhatsApp), `/register`
> is unchanged and stays open, no limit is enforced and no company is suspended when its Trial ends. Every database used
> was a loopback, disposable `*_test_only_*` database holding fictional rows only, and every one was dropped. Production
> (Neon, the Hostinger VPS) was not accessed. Every acceptance policy below is **PROVISIONAL — REQUIRES PRODUCTION OWNER
> APPROVAL** (§C).
>
> **Release status: NO-GO.** The implementation is complete and verified for development. Releasing it still needs the
> owner decisions in §C and §L, the D-7 read-only e-mail audit (and a decision on the proposed case-insensitive index,
> §D), the D-6/D-7 migration approvals (§M), a configured `CUSTOMER_PUBLIC_ORIGIN`, and the Next.js advisory gate (§N).

---

## A. Completion status

| Step | Status |
|---|---|
| 3 — Baseline | done — `main` = `621f156` (live, unchanged), `feat/platform-owner` = `49510ec`, PR #11 open, **draft, unmerged**, untouched; PO-02D2's 187 server and 78 browser checks green; the PO-02D1B Trial seed applied through its guarded runner and re-run (retry-safe, no duplicate); the PO-02D1A foundation and the PO-02D1A.1 preflight green; `/register` behaves as before; full baseline regression green except the pre-existing Next.js advisory gate and one pre-existing, intermittent `verify:platform-proxy` check (58/59 once, 59/59 on re-run; §K.5) |
| 4 — E-mail uniqueness security gate | done **first**, before the acceptance transaction — all six listed scenarios tested on real PostgreSQL with deterministic barriers; the race is **closed for every application writer**; the residual (non-application writers, legacy mixed-case rows) has a reviewed, additive `lower(email)` proposal tested on disposable databases only and a read-only production audit; **not applied anywhere** (§D) |
| 5 — Shared organization bootstrap | done — `bootstrapOrganization(tx, approvedFields)` (`src/lib/org-bootstrap.ts`); `/register` uses it with byte-identical results for three countries (§E) |
| 6 — Public route | done — `/register/accept` in its own route group `(invite)`; flag-gated; fragment-only token, removed at once (address bar, history entry **and Next.js's router copy**); same-origin POSTs only; no-store, noindex, no-referrer (§I) |
| 7 — Acceptance form | done — company, offered Trial (from the immutable version), expiry, name, password + confirmation; EN + natural Saudi Arabic, RTL, light/dark, keyboard, 360 px → desktop (§I, §J) |
| 8 — Atomic transaction | done — ONE READ COMMITTED transaction, fixed lock order, checked against PO-02C, PO-02C.1 and PO-02D2 (§F) |
| 9 — Trial assignment | done — the terms' published version, snapshots, Asia/Riyadh business dates, inclusive end (§G) |
| 10 — Security and concurrency tests | done — `verify:platform-invitation-acceptance` **94/94** (A1–A31) and `verify:platform-email-uniqueness` **39/39** (§K) |
| 11 — Browser verification | done — `verify:platform-invitation-acceptance-browser` **99/99** (B1–B15), 72 screenshots (§J, §K) |
| 12 — Public rate limiting | done — durable, in PostgreSQL, **no schema change** (PO-01A's keyed-digest attempt store, acceptance-only digest purposes) (§I.6) |
| 13 — Full regression | done — at `3825729` (§K.5): TypeScript, `verify:static` (22 suites, also each alone), ACC-01, the security tests, `verify:platform` (19 suites, 2,104 checks), the UI guardrails and all six Platform Owner browser suites green; ESLint identical to the baseline (28 pre-existing problems); the build **compiles** and is then stopped by the pre-existing Next.js advisory gate (§N). The guardrail run found three new focus findings on the page — fixed in `66b6043`, after which every affected check re-ran green |
| 14 — This document | done |
| 15 — Change control | done — PO-02D3 approved-delta layer (7 files, 17 hunks, 9 added files) with its freeze-verifier hooks; boundary rules 3, 11's customer twin, 33, 38, 39, 40 and 44 narrowed by named exceptions and rule 45 added (15 checks); five older platform suites' pins extended by named additions only; 14 tamper tests, every one caught by the verifier responsible; undo proof byte-exact (§K.4) |
| Git | done — five reviewable commits (feat, feat, test, fix, docs) on `feat/platform-owner` only; no force-push, merge, deploy or PR change (§A.1) |
| **STOP gate** | **STOPPED.** Acceptance is not active anywhere; no real company, user or subscription; `/register` not made invitation-only; PO-03 not started |

### A.1 Branch, commits and exact SHAs

| | |
|---|---|
| Repository | `Delowar01/Elite-ERP` |
| Branch | `feat/platform-owner` (pushed; nothing else pushed) |
| Base (approved PO-02D2 head) | `49510ec209cc214546f46ff59d379936ad75c91f` |
| Live ERP (`main`) | `621f156f7b129b9c2e289bc46d314ce7587beec2` — unchanged |
| PR #11 | open, draft, unmerged — not modified |
| PO-02D3 commits | 1. **feat** `946fbb07a5f993253a858cd442837033a71bb962` — the shared organization bootstrap, `registerAction` on it, the `recordAudit` executor (TypeScript exit 0 on its own, detached worktree)<br>2. **feat** `b40afa4547001347033367745e0baf85037daec6` — the acceptance core, the durable throttle, the onboarding bridge, the `/register/accept` route, the flag / error / digest purposes, and the reviewed SQL proposals (TypeScript exit 0 on its own)<br>3. **test** `3825729fea79bb49cdbb0d80e8a001ec66d4d4f6` — the three suites and their helpers, the approved-delta layer and its hooks, the boundary rules, the five older suites' pin extensions and the scripts; **the full regression in §K.5 ran at this commit**<br>4. **fix** `66b6043e36e85255bef4df0d303727508ac1295e` — the visible keyboard-focus outline on the page's headings and the layer's new hash; every affected check re-ran green (§K.5)<br>5. **docs** — this document (the branch head; its SHA is in the handover report) |

### A.2 Findings for owner attention

1. **E-mail uniqueness (the gate).** Closed for every application writer — `users.email` is UNIQUE (case-sensitive) and
   every code path that writes it stores `trim().toLowerCase()`, so the second writer of one address always fails with
   23505 and its whole transaction rolls back; acceptance additionally serializes on the owner e-mail lock and re-checks
   `lower(email)` inside its transaction. **Not closed** for writers outside the application (manual SQL, imports, a
   future unnormalized code path) or for legacy mixed-case rows: the proposed `users_email_lower_uq` closes that at the
   database, needs the D-7 read-only audit to report **E1 = 0** first, and needs owner approval (§D, §M).
2. **A real token-exposure defect was found and fixed by the browser suite.** Next.js's router keeps its own copy of the
   address, read from `location.href` when it starts — **fragment included** — and writes it back to history whenever its
   state changes. A plain `history.replaceState` (carrying Next.js's history state) cleaned the address bar but not that
   copy: the first router update (B3 forces one with `router.refresh()`) put `#t=<token>` back into the address bar and the
   history entry, and a reload then re-opened the live link. The page now also tells the router (Next.js's documented
   `history.replaceState(null, …)` integration) **before its first request**; B3 proves no later history write restores the
   fragment (§I.2).
3. **Two more page defects were fixed during the browser work:** Arabic dates and the version label were forced into
   left-to-right boxes, which reorders Arabic text; and the sign-in e-mail wrapped mid-sentence on phones. Dates now read
   right to left like the console's; codes, references, e-mails and amounts stay left-to-right isolates (B11) (§I.8).
   The page also gained a synchronous one-request guard (two submits in one instant sent two acceptances before; B9), a
   back/forward-cache and second-link reload (B3), the copy-completeness check its dictionary claimed but no suite
   had (A31), and — found by the final regression's UI guardrails — a visible keyboard-focus outline on the headings that
   receive focus at each screen change (§K.5).
4. **Exactly two customer files change, narrowly** — `registerAction` (its three-statement transaction is now the shared
   bootstrap; byte-identical rows for three countries, A30; `/register` unchanged in the browser, B14) and `recordAudit`
   (an optional transaction executor, default `db`; every existing caller unchanged; only the onboarding bridge passes
   one) (§E, §H).
5. **The public throttle needs a correct proxy setting in production.** Per-IP limits work only when
   `PLATFORM_TRUSTED_PROXY_HOPS` matches the real proxy chain (as for Platform Owner sign-in); without it the IP is
   unknown and only the per-invitation limits apply (A26) (§I.6).
6. **The PO-02D2 console still says "Invitation acceptance is not available yet (phase PO-02D3)"** in the one-time-link
   panel and the invitation detail. That is accurate wherever `CUSTOMER_INVITE_ACCEPTANCE_ENABLED` is off (the default and
   every deployed environment); PO-02D2's files were deliberately not changed. The wording should change with the
   cutover decision (§L).
7. **Pre-existing, unchanged:** `/register` still answers "An account with this email already exists." — an
   account-existence signal that acceptance never gives (A10, A24, B7). Out of PO-02D3's scope; listed for the owner (§L).
8. **Five older platform suites carried exact pins that PO-02D3 necessarily changes** (which modules may name the
   PO-02A and onboarding tables, "no acceptance flag exists", "nothing reads module groups", "the invitation flag file
   mentions no acceptance", "no customer auth file differs except PO-02C/C.1"). Each was extended by PO-02D3's named
   additions only — no pattern or wildcard — so any other module, flag or change still fails it (§B, §K.4).
9. **Next.js 16.4.3 advisory gate** — pre-existing; not bypassed; nothing upgraded; the build compiles (§N).

---

## B. Changed files

**Application (9 added, 5 changed)**

| File | Change |
|---|---|
| `src/lib/org-bootstrap.ts` | **new** — `bootstrapOrganization(tx, fields)`: organization (base currency confirmed) → owner → `seedOrgDefaults`, inside the caller's transaction; refuses a non-normalized owner e-mail |
| `src/app/(auth)/actions.ts` | `registerAction`'s transaction body is now `bootstrapOrganization(tx, …)` (2 hunks: the import, the transaction). Check, hash, post-commit audit + security event, session and redirect unchanged |
| `src/lib/security/audit.ts` | `recordAudit(actor, entry, executor = db)` — optional executor (1 hunk) |
| `src/lib/platform/flags.ts` | `isCustomerInviteAcceptanceEnabled()` / `assert…()` — exactly `"true"`, independent of the console flags |
| `src/lib/platform/errors.ts` | `ACCEPTANCE_DISABLED` (EN/AR) |
| `src/lib/platform/config.ts` | two keyed-digest purposes for the throttle: `invite-accept-email`, `invite-accept-ip` |
| `src/lib/platform/invitation-acceptance.ts` | **new** — the platform core: request checks, link preview, the ONE acceptance transaction, platform audit, refusal audit |
| `src/lib/platform/acceptance-throttle.ts` | **new** — the durable public throttle (PostgreSQL; no schema change) |
| `src/lib/onboarding/invitation-acceptance.ts` | **new** — the ONE customer module that reaches the platform core: password policy and hash, the shared bootstrap and the customer evidence as callbacks inside the transaction |
| `src/lib/onboarding/acceptance-types.ts` | **new** — the shapes the page exchanges (types only) |
| `src/app/(invite)/register/accept/page.tsx` | **new** — the route (dynamic, noindex, no-referrer); renders only the mode |
| `src/app/(invite)/register/accept/accept-invitation.tsx` | **new** — the client page (fragment handling, form, screens) |
| `src/app/(invite)/register/accept/actions.ts` | **new** — two strict same-origin server actions (check, accept) |
| `src/app/(invite)/register/accept/copy.ts` | **new** — every page string in EN and Saudi Arabic |

**Reviewed SQL — proposals, never executed outside disposable databases (`docs/platform-owner/po02d3/`)**

| File | Purpose |
|---|---|
| `proposal/users_email_lower_unique.proposal.sql` | additive `CREATE UNIQUE INDEX CONCURRENTLY users_email_lower_uq ON public.users (lower(email))`, approval guard, pre-checks, post-verification |
| `proposal/users_email_lower_unique_rollback.proposal.sql` | `DROP INDEX CONCURRENTLY IF EXISTS`, guarded, idempotent |
| `sql/users_email_audit_readonly.sql` | the D-7 read-only audit (E1–E6: duplicates, non-normalized, white space, non-ASCII, pending conflicts, size); ids and counts only |

**Verification and change control**

| File | Change |
|---|---|
| `verify/verify-platform-email-uniqueness.mts` | **new** — the gate suite (39 checks) |
| `verify/verify-platform-invitation-acceptance.mts` | **new** — the server suite (94 checks, A1–A31) |
| `verify/verify-platform-invitation-acceptance-browser.mts` | **new** — the browser suite (99 checks, B1–B15) |
| `verify/platform/request-scope.ts`, `verify/platform/acceptance-throttle-child.mts` | **new** — Next.js request-scope emulation for the real orchestrator; a second process for the durable-throttle proof |
| `verify/po02d3-approved-delta.mts` | **new** — the PO-02D3 approved-delta record |
| `verify/verify-document-form.mts`, `verify/verify-page-archetypes.mts` | the layer's hooks (undo chain, walk exclusions, the PO-02D3 checks / group 32) |
| `tests/security/platform-boundary.test.mjs` | rules 3, 11's customer twin, 33, 38, 39, 40, 44 narrowed by named exceptions; rule 45 added |
| `verify/verify-platform-containment.mts` | PO-02D3's recorded hunks undone before the PO-02C / C.1 comparison (two customer files) |
| `verify/verify-platform-company-schema.mts` | the acceptance core added by name to the table-reference pin, plus one check of its single access-row insert |
| `verify/verify-platform-onboarding-schema.mts` | the acceptance core added by name; the acceptance flag pinned to `flags.ts` |
| `verify/verify-platform-onboarding-seed.mts` | module groups: only the acceptance core's three snapshot copies; no snapshot reader, no entitlement code |
| `verify/verify-platform-invitations.mts` | the PO-02D2 flag pin narrowed to the invitation flag's own functions (they never read an acceptance flag) and its reverse |
| `package.json` | three scripts; the two server suites appended to `verify:platform` (the browser suite runs on its own, like PO-02D2's) |

No schema module, Drizzle migration, `drizzle/` SQL, seed, customer session, sign-in, MFA, business, console page or PO-02D2
file changed.

---

## C. Provisional acceptance decisions — PROVISIONAL — REQUIRES PRODUCTION OWNER APPROVAL

Implemented exactly as authorized for isolated development; none is a production approval.

| # | Decision (provisional) | How it is implemented and proven |
|---|---|---|
| **A-1** | `CUSTOMER_INVITE_ACCEPTANCE_ENABLED` defaults OFF | Only the exact string `"true"` enables it (unset, empty, `TRUE`, `True`, `1`, `yes`, padded values all refuse); independent of the console flags; off → the page says acceptance isn't available, renders no invitation data, calls no action, and both actions refuse `disabled` (A27, B1, rules 40/45) |
| **A-2** | `/register` remains unchanged and available | Not invite-only, no new flag (`INVITE_ONLY` exists nowhere); its page, layout and behaviour unchanged; its transaction is the shared bootstrap with identical rows (A30, B14) |
| **A-3** | The invitee chooses their own password under the existing customer policy | `/register`'s `DEFAULT_POLICY` (8+ characters, upper, lower, digit, symbol, common-password block) enforced on the server; mirrored in the browser for immediate feedback; hashed with the existing bcrypt `hashPassword` before the transaction (A15, B5) |
| **A-4** | Respect the existing customer MFA policy; no session after acceptance | The existing policy requires no MFA enrolment at account creation (as `/register`); the new company gets the default `mfa_required_for_privileged = true`, which governs disabling MFA, as for every company; no bypass, no new global policy. No session is issued: the done screen links to the existing `/login` (A16, A27, B6) |
| **A-5** | Trial from the invitation's referenced published version; starts on the acceptance business date in Asia/Riyadh; inclusive end = start + days − 1 | The terms row's version (never the "current" default Trial); for v1, 14 days → end = start + 13; the decision time is read after the locks; no payment record; no enforcement; expiry suspends nothing (A17–A20, B4, B6, rule 45) |
| **A-6** | Durable public rate limiting | Per client IP 10 failures / 15 min → 15-min block, 50 / 24 h → 24-h block; per invitation 5 / 15 min → 15-min block, 20 / 24 h → 24-h block; a success restarts the invitation's count; stored as keyed digests in PostgreSQL (A26, B7) |
| **A-7** | Public errors never reveal whether an e-mail has an account; nothing is delivered | Six public answers only — `disabled`, `invalid` (unknown, malformed, revoked), `expired`, `used`, `throttled`, `unavailable` (an existing account, a system failure, a configuration problem); acceptance sends no e-mail, SMS or WhatsApp and contacts no host (A10, A24, A28, B7, B15) |

**C.2 Implementation conventions (also provisional)**

- The invitee may correct their **name** (white space collapsed, 1–200 characters, no control or direction-override
  characters); company name, country, currency, industry and the owner e-mail come from the invitation and cannot be changed.
- The link check is read-only and reveals no account information; an existing account is detected **only** at acceptance,
  inside the transaction, and answered with the neutral `unavailable`.
- A visitor already signed in to Elite ERP is asked to sign out first; the link is not checked or consumed (B10).
- Failures of the system (`unavailable`) and `throttled` keep the link in the page's memory for **Try again**; every other
  refusal drops it.
- The language switch is on the page (no request, no remount, the link kept) and is remembered in the locale cookie.

---

## D. E-mail uniqueness and concurrency security findings

### D.1 What the database guarantees today

`users.email` is `text NOT NULL` with **`users_email_unique = UNIQUE (email)` — case-sensitive**; there is no
`lower(email)` key. Exactly two modules insert users — the shared bootstrap (`/register` and acceptance) and the
team-member action — and **both store `trim().toLowerCase()`**; nothing updates an existing `users.email`; no raw SQL in
`src/` writes `users`. Sign-in looks up the lower-cased address. So, for application writers, the case-sensitive constraint
is a complete guard: two writers of one normalized address collide on the same index entry.

### D.2 The six scenarios of the prompt (real PostgreSQL, deterministic barriers)

| Scenario | Result | Proof |
|---|---|---|
| 1. Two simultaneous acceptances | both wait on the owner e-mail lock; exactly one succeeds, the other is `used`; one company, one subscription | A7 |
| 2. Acceptance vs public registration, same e-mail | either order: the second writer waits on the `users_email_unique` entry, then fails 23505 and rolls back **whole** (acceptance answers the neutral `unavailable`); one account; a registration committed first refuses the acceptance before any write | A10; gate 3a–3c |
| 3. Addresses differing only by letter case | every writer normalizes, so they collide; an existing mixed-case (legacy) account is still found by acceptance's in-transaction `lower(email)` check | A11; gate 3e |
| 4. Existing account with the matching normalized e-mail | refused `unavailable`, nothing created, the invitation stays pending (also an account in another company) | A10, A11, A24 |
| 5. Two invitations trying to create the same owner | cannot both be pending (PO-02A's partial unique index); a re-issue and an acceptance serialize on the e-mail lock, the old link then refuses; after one acceptance any other path to that owner fails 23505 | A9, A11; gate 3c |
| 6. Database failure between organization and user creation | the whole transaction rolls back — no organization survives | gate 3d; A12 (seven injection points), A14 (backend killed) |

### D.3 The residual and the proposal

**Residual (documented, not closed by application code):** a writer outside the application (manual SQL, an import, a
future code path that skips normalization) can insert a case-variant twin today (gate 3e proves it). Acceptance still
refuses such an address (its check is `lower(email) = $1`), but `/register`'s pre-check is an exact match, and sign-in
would find only the lower-case row.

**Proposal** (`docs/platform-owner/po02d3/proposal/`, never applied outside disposable databases): an additive
`CREATE UNIQUE INDEX CONCURRENTLY users_email_lower_uq ON public.users USING btree (lower(email))`.
- Guarded: the file raises before any statement unless deliberately unlocked for a reviewed run; it refuses when `users`
  or `users_email_unique` is missing, when a different or INVALID `users_email_lower_uq` exists, or when any
  case-insensitive duplicate group exists (4a, 4c, 4d).
- Locking: CONCURRENTLY holds only **SHARE UPDATE EXCLUSIVE** on `users` — reads, registrations and sign-in updates continue
  during the build; it waits only for transactions already open (4e).
- After the build a case-variant twin is refused **by the database** (23505 on `users_email_lower_uq`), also under
  concurrency (4f). A failed build leaves an INVALID index, which the proposal detects and the rollback removes (4d).
- Rollback: `DROP INDEX CONCURRENTLY IF EXISTS`, guarded, idempotent; `users_email_unique` untouched (4g).
- Precondition: the read-only audit (`sql/users_email_audit_readonly.sql`, one READ ONLY transaction, ids and counts only —
  never an address) must report **E1 = 0** case-insensitive duplicate groups (4b, 4h).

### D.4 Verdict

Closed safely within the authorized changes **for every application writer** — acceptance is GO for development. The
residual depends on production data and non-application writers, which development cannot see: **release stays NO-GO
until the D-7 audit has run on production (read-only) with E1 = 0 and the owner has decided on `users_email_lower_uq`**.

### D.5 Lock order against the rest of the system

| Path | Locks, in order | Interaction with acceptance |
|---|---|---|
| Acceptance (PO-02D3) | throttle rows (own statements, outside the transaction) → owner e-mail advisory lock → invitation row FOR UPDATE → (inserts) `users_email_unique` entry → version row KEY SHARE (FK) | — |
| PO-02D2 create / revoke / re-issue | operator row → the same e-mail lock → invitation row | same relative order: they serialize, never deadlock (A8, A9) |
| PO-02C suspension, PO-02C.1 sign-in | the EXISTING company's `orgs` row (and its access row) | acceptance only creates a new company; no shared row |
| `/register` | no advisory lock; only the `users_email_unique` entry | single shared resource: the loser waits, then 23505 (A10) |

---

## E. Shared organization bootstrap

`bootstrapOrganization(tx, { orgName, country, currency, ownerName, ownerEmail, passwordHash, industry?, companyEmail? })`
writes, inside the caller's transaction: the organization (`baseCurrencyConfirmedAt` = now, because the currency was
chosen deliberately), the owner user (`role: owner`), then `seedOrgDefaults(tx, org.id, country)`. It refuses a
non-normalized owner e-mail before writing, never opens a transaction and never hashes (the caller hashes first, so bcrypt
never runs while locks are held). Exactly two callers: `registerAction` and the onboarding bridge (rule 45).

**Equivalence evidence**
- **A30** — for Saudi Arabia (SAR), the United Arab Emirates (AED) and Bangladesh (BDT) the shared bootstrap writes exactly what the
  baseline registration transaction wrote: the organization, the owner and every seeded default row (canonical snapshot
  comparison), in one transaction; `registerAction` keeps its order (check → hash → ONE transaction → audit + security
  event after COMMIT → session → `/dashboard`).
- **B14** — in the browser, with acceptance ON: `/register` still signs the owner straight in (one session), lower-cases and
  trims the e-mail, confirms the currency, creates **no** platform rows, records the same evidence keys, and seeds exactly
  the defaults an invitation-created company of the same country gets; it refuses an invited owner's e-mail in another
  letter case with its existing message.
- The customer registration and security suites in `verify:static` and the freeze verifiers pass (§K.5); the
  approved-delta record proves `registerAction` changed by exactly its two hunks.

---

## F. Acceptance transaction and rollback evidence

### F.1 Every request, in order (before any token is read)

flag → configuration (canonical customer origin, platform key) → same origin (Origin = Host, `Sec-Fetch-Site`
same-origin) → Origin equals the **canonical** `CUSTOMER_PUBLIC_ORIGIN` → the platform audit trail is protected → the
per-IP block. Then: token format (43 base64url characters) → sha256 lookup → the per-invitation block → lifecycle
(pending, unexpired) → the invitation's terms (a published Trial version, cycle `trial`, SAR 0).

### F.2 The ONE transaction (READ COMMITTED)

1. owner e-mail advisory lock (PO-02D2's key) → 2. the invitation row `FOR UPDATE` → 3. the decision time (read after the
locks: a link that expired while waiting is expired) → 4. state, terms and the `lower(email)` account check again →
5. organization + owner + defaults (the shared bootstrap, a callback) → 6. the active `tenant_access_controls` row
(unattributed) → 7. `tenant_primary_owners` → 8. `tenant_subscriptions` (Trial, snapshots) → 9. `subscription_events`
(`assigned`, actor `invitee`) → 10. the invitation marked accepted (only while neither accepted nor revoked) → 11. platform
audit `invitation.accepted` → 12. customer audit `org.registered` (source invitation) + security event `account.created`
(a callback) → COMMIT. After COMMIT only the throttle's success mark.

### F.3 Proofs

- **One transaction:** all ten rows carry the same `xmin` (A1).
- **Races:** double acceptance (A7); acceptance vs revocation and vs re-issue, both orders (A8, A9); acceptance vs
  `/register`, three orders and letter-case variants (A10, A11) — each with the competing backend **observed waiting** in
  `pg_stat_activity` before the other is released.
- **Rollback:** a failure injected (temporary trigger) at the defaults, the access row, the primary owner, the
  subscription event, the platform audit, the customer audit and the security event — each answers `unavailable` and leaves
  **nothing**: no company, owner, defaults, mapping, subscription, accepted status or success record; the same link then
  succeeds once the failure is gone (A12). A backend terminated mid-transaction: the same (A14). In the browser, a failure
  at the subscription shows "We couldn't complete this invitation — Nothing was created", nothing exists, and **Try again**
  accepts the same link (B8).
- **Replay:** a used link answers `used`; no second company (A5/A6, B7).

---

## G. Trial assignment correctness

- Source: the invitation's own `organization_invitation_terms` row and the **published** version it names; a draft version
  is refused by the database (composite FK, A17); missing terms → `unavailable` (A18); a paid version or another cycle →
  `unavailable` (A17); the default-Trial flag is never consulted (rule 45).
- **No silent switch:** with v2 (30 days, 7 users) published after the invitation, the invitation still gets v1 — in the
  database (A19) and on the page (B4); an invitation naming v2 gets v2 (end = start + 29).
- Snapshot for v1: 14 days, 3 users, 5 GB, all nine module groups, SAR 0.00, cycle `trial`, state `trialing`,
  `assignment_source = invitation_acceptance`; exactly one subscription per company (A1, A19, B6).
- Dates: start = the Asia/Riyadh business day of the decision; inclusive end = start + 13. At 23:59:59 Riyadh the Trial runs
  19 Nov → 2 Dec; one second later (00:00:00 Riyadh, still 19 Nov in UTC) 20 Nov → 3 Dec (A20).
- No payment record, no module or storage enforcement, and nothing suspends a company when its Trial ends.

---

## H. Platform / customer audit atomicity

- The platform record `invitation.accepted` is written **inside** the transaction (`recordPlatformAudit(…, tx)`).
- The customer evidence needed one minimal refactor: `recordAudit(actor, entry, executor = db)` — the default is the
  autocommit path every existing caller uses (unchanged; proven by the approved-delta record and the 19 untouched call
  sites); `recordSecurityEvent` already took an executor (PO-02C.1). Only the onboarding bridge passes `tx` (rule 45).
- Effect: a failed acceptance can never leave a misleading `org.registered` or `account.created`; failures injected at
  either customer write roll everything back (A12). `/register` still writes its evidence after COMMIT, exactly as before
  (A30, B14).
- Refusals of a **real** invitation are audited as `invitation.accept.rejected` with an internal stage (`expired`, `used`,
  `revoked`, `terms`, `email_conflict`, `subscription`, …) in their own statement; an audit outage refuses every request
  (`unavailable`) and raises the PO-01B.1 incident. No audit record holds a token, a token hash or a link (A29, B15).

---

## I. Public endpoint and token-security evidence

### I.1 Route

`/register/accept` lives in its own route group, `(invite)`, with no layout — the `(auth)` layout's signed-in redirect would
otherwise carry the fragment to the next URL. The proxy already passes every `/register…` path without a redirect. The page
renders per request (`force-dynamic`, `Cache-Control: no-store`), is not indexed (`noindex, nofollow, nocache`) and sets
`referrer: no-referrer`. The server renders only the **mode** (off, signed in, ready) — never a token or invitation data
(B12).

### I.2 The token (fragment only)

- Read once, from `#t=` only (a token in the query string is ignored — B2), on the client.
- Removed at once from the address bar and its history entry, and — the defect found by B3 — from **Next.js's router copy**
  (`history.replaceState(null, …)`, which Next.js turns into a router restore), **before the first request**: the order
  probe proves no fetch ever ran with the fragment present and that no later history write — the page's or the router's,
  after a forced `router.refresh()` — put it back (B3).
- Kept only in a React ref (never state, storage, a cookie, a URL or a log); dropped on `pagehide`, after success and after
  a final refusal. A page restored from the back/forward cache, or given a second link in the same tab, reloads (B3).
  Refresh, Back and Forward find no invitation (B3).
- Sent only in the body of the page's two same-origin server actions (B6, B15).

### I.3 Same-origin POSTs

Next.js's own Server Actions origin check, then the platform same-origin check, then **Origin = the canonical
`CUSTOMER_PUBLIC_ORIGIN`** (https, or an explicitly approved loopback for tests): a foreign origin, a missing Origin and a
same-origin-but-non-canonical host are all refused, nothing created (A25, B12). Both actions take strict schemas; a refused
shape is an `invalid` link.

### I.4 Answers

Six public answers (§C, A-7); `expired`, `used` (with a Sign-in link), and the neutral `invalid` for unknown, malformed and
revoked links alike (B2, B7).

### I.5 Validation

Field errors in the browser without a request; the server enforces the same rules and the common-password block (B5).

### I.6 Durable throttle (A-6)

`platform_login_attempts` (PO-01A) stores keyed HMAC digests under two acceptance-only purposes, so an acceptance key can
never match, count against or block a Platform Owner sign-in. Failures are evaluated under transaction-scoped advisory
locks (no slip past a limit); during a block nothing is written. A separate process sees the same block (state in
PostgreSQL, not memory); the block lifts after 15 minutes; another IP or invitation is unaffected; with no trusted proxy the
IP is unknown and only the per-invitation limits apply (A26). In the browser, ten unknown links from one address are
refused and the eleventh — even a real link — is "Too many attempts" with nothing written (B7).

### I.7 Token hygiene, end to end (B15)

Across 2,493 browser requests: no token in any URL or header (Referer included); the only token-carrying requests were
same-origin server-action POST bodies to `/register/accept` (plus the one sent while offline in B8, which never left the
browser); the server-action POSTs and sign-in navigations from the page sent **no Referer**; the browser contacted no
host but the loopback servers; console and page errors, server output, every platform audit record and a text scan of
all 80 tables hold no token and no password.

### I.8 UI quality

One h1 per screen, focus moved to each new screen's heading, labelled fields with `aria-invalid` / `aria-describedby` and
`role=alert` errors, keyboard order name → password → confirmation → submit, Enter submits; Arabic reads right to left
with Latin values (e-mail, reference, currency, amounts) isolated left-to-right and dates in Arabic order (B6, B11, B13).

---

## J. EN/AR and responsive UI screenshots

72 PNG screenshots of the final browser run, in the session scratchpad (**not committed** — fictional data only; no
screenshot can show a usable token: the token is never in the page, and the address bar is not part of a page
screenshot):

| Group | Screens |
|---|---|
| `00`–`02` | switched off, no invitation in the link, unknown link — EN, light, 1440 |
| `10`–`15` | the form; validation; done (EN light 1440); done in Arabic (light, 1440); the Arabic form and done screen on a phone, dark (390) |
| `20`–`23` | expired, already used, the neutral "couldn't complete", too many attempts |
| `30` | signed-in visitor |
| `40` | the form in all 20 combinations: EN / AR × light / dark × 1440 / 1024 / 768 / 390 / 360 |
| `41`–`43` | expired, used and missing in EN / AR × light / dark × 1440 / 390 / 360 (36 screens) |
| `50`–`51` | switched off in Arabic, dark, 360; the Arabic done screen at 360 |

Every one of the 56 gallery screens passed the layout audit: one `h1`, every control named, every field labelled, no
horizontal scroll, no clipped text, white text on orange, `lang` / `dir` / theme applied, Latin values left-to-right (B13).

---

## K. Complete test results

### K.1 `verify:platform-email-uniqueness` — 39/39

1 — the constraint (case-sensitive) and no case-insensitive key; 2 — the static writer audit (two inserters, no e-mail
updates, both normalize, the bootstrap refuses an unnormalized owner, acceptance uses the invitation's normalized
address); 3a–3e — races on the real constraint with barriers (wait observed; 23505; rollback whole; failure between
organization and owner; the documented residual); 4a–4h — the proposal on disposable databases (guards, audit, refusal over
duplicates, INVALID leftover and recovery, CONCURRENTLY lock level with reads and writes continuing, post-build conflicts
under concurrency, idempotent rollback, clean audit E1 = 0).

### K.2 `verify:platform-invitation-acceptance` — 94/94

| Tag | Coverage |
|---|---|
| A1–A2 | valid acceptance: every record, field and snapshot; bcrypt hash; seeded defaults; ONE transaction (identical `xmin`); no session |
| A2–A6 | malformed / unknown / empty / non-string, expired, revoked, used, replayed |
| A7 | concurrent double acceptance |
| A8–A9 | vs revocation, vs re-issue (both orders) |
| A10–A11 | vs `/register` (three orders) and letter-case variants |
| A12–A14 | seven failure injections + a killed backend: nothing survives; the link then works |
| A15–A16 | password policy and name rules; MFA policy |
| A17–A20 | draft version (FK), missing terms, paid version, v1 pinned against v2, Riyadh midnight boundary |
| A21–A24 | access row, primary-owner uniqueness, cross-company keys, tenant isolation |
| A25–A28 | origin and configuration, audit protection, durable throttles (second process, block expiry, hops = 0), flag off (eight spellings), no delivery, no session |
| A29 | no token or password in logs, audit or any table |
| A30 | `/register` equivalence (three countries) |
| A31 | every page string has its Arabic entry; placeholders preserved |

### K.3 `verify:platform-invitation-acceptance-browser` — 99/99

B1 flag off (page, no request, direct action POSTs refused) · B2 missing / malformed / query / unknown links · B3 the
fragment (removed before any request; router refresh; refresh; Back / Forward; second link; cached restore; `pagehide`) ·
B4 offered terms from v1 with v2 published · B5 validation (browser and server) · B6 keyboard-only acceptance → done →
`/login` → `/dashboard` · B7 expired / revoked / used / neutral unavailable / throttled · B8 failure and retry, offline ·
B9 one request per double submit · B10 signed-in visitor · B11 the language switch and the Arabic phone flow · B12
no-store, noindex, no-referrer, HTML, cross-origin / missing / non-canonical origin · B13 56 screens EN / AR × light / dark
× five widths · B14 `/register` unchanged · B15 token hygiene end to end.

### K.4 Change control

- **Approved-delta layer** `verify/po02d3-approved-delta.mts` — base `49510ec`; **7 changed files, 17 hunks**
  (`(auth)/actions.ts` 2, `config.ts` 1, `errors.ts` 1, `flags.ts` 1, `audit.ts` 1, `verify-document-form.mts` 4,
  `verify-page-archetypes.mts` 7) and **9 added files** pinned by sha256. Generated from the diff against `49510ec`, each
  hunk widened with context until it is unique in both files and its `49510ec` form appears nowhere in PO-02D3's.
- **Undo proof** — each of the 7 files, its hunks undone, is `49510ec`'s **to the byte**; the 9 added files are as recorded.
- **Freeze verifiers** — `verify:document-form` **91/91** (+1, the PO-02D3 check), `verify:page-archetypes` **310/310**
  (+3, group 32); every older layer still reads its own base through the undo chain (disk → PO-02D3 → PO-02D2 → …), so no
  older pin was re-baselined.
- **Boundary** — `verify:platform-boundary` **154/154**: the 139 earlier checks (eight narrowed by named exceptions only:
  rule 3, rule 11's customer twin, 33, 38, 39, 40, 44 and 44's token clause) + **15 new (rule 45)**.
- **Older platform suites — pins extended by PO-02D3's named additions only**: `verify:platform-containment` 87/87
  (PO-02D3's two customer hunks undone before the PO-02C / C.1 comparison); `verify:platform-company-schema` 110/110 (the
  acceptance core named, +1 check of its single access-row insert); `verify:platform-onboarding-schema` 167/167 (the core
  named; the acceptance flag read only in `flags.ts`); `verify:platform-onboarding-seed` 113/113 (module groups: only the
  core's three snapshot copies, no snapshot reader, no entitlement code); `verify:platform-invitations` 187/187 (the
  invitation flag's own functions never read an acceptance flag; the acceptance flag's never read the invitation or console
  flags). Before the extensions, the first full platform run failed exactly these five pins (86/87, 108/109, 165/167,
  112/113 and the invitations flag check) — the expected effect of PO-02D3, not regressions.
- **Intermediate commits** compile on their own (TypeScript exit 0 at `946fbb0` and `b40afa4`, detached worktrees). The
  freeze verifiers and boundary rules are meant to pass at the test commit, which carries the layer and the rules.
- **Tamper tests — 14, every one caught by the verifier responsible; each file restored byte for byte (working tree
  identical before and after):**

| # | Tamper | Caught by |
|---|---|---|
| T01 | an extra line in a recorded file (`audit.ts`) | document-form (PO-02C.1, PO-02D3 checks), page-archetypes (6 checks: directory pins, C8, PO-02C.1, group 32) |
| T02 | an added file changed (`org-bootstrap.ts`: owner → admin) | document-form, page-archetypes (group 32) |
| T03 | an unrecorded file added under `src/lib/onboarding/` | page-archetypes (C8 "no other application file") |
| T04 | `registerAction` changed outside its recorded hunks | document-form (PO-02C, PO-02C.1, PO-02D3), page-archetypes (C8, PO-02C, PO-02C.1, group 32); the boundary rules are structural and not expected to see a byte change |
| T05 | the token written to `sessionStorage` | boundary rule 45 (storage) |
| T06 | a second customer module importing the acceptance core | boundary rules 3, 11 (customer twin), 45 |
| T07 | the acceptance flag read outside `flags.ts` | boundary rule 40 |
| T08 | the core deleting an invitation | boundary rules 44, 45 (writes) |
| T09 | the transaction order swapped (subscription before primary owner) | boundary rule 45 (lock order) |
| T10 | the token held in React state | boundary rule 45 (token handling) |
| T11 | the page made indexable | boundary rule 45 (page protections) |
| T12 | an action schema without `.strict()` | boundary rule 45 (actions) |
| T13 | a third caller of `bootstrapOrganization` | boundary rule 45 (one bootstrap) |
| T14 | another module passing an executor to `recordAudit` | boundary rule 45 (audit executor) |

### K.5 Full regression (TEST-only settings, loopback disposable databases)

Run by the phase's regression runner at `3825729` (the code-complete test commit), every database a loopback, disposable
`*_test_only_*` one, TEST-only secrets generated in memory:

| Step | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | exit 0 |
| ESLint (`src tests scripts verify`) | 28 problems (7 errors, 21 warnings) — **identical to the baseline, same files**; none in a PO-02D3 file |
| `verify:static` | pass (chain); its 22 suites run alone: 0 failures — role-matrix 32, confirm-policy 62, dirty-form 66, skeletons 90, contrast 187, typography 43, status-registry 90, shell 87, controls 110, datatable 69, **document-form 91** (90 + 1), edit-action 59, store-model 69, provider-harness 302, backup-claims 26, money-precision 12, number-locale 29, date-timezone 38, business-dates 44, ledger-only-balances 8, **page-archetypes 310** (307 + 3), lcp-design 77 |
| ACC-01 | inventory costing 171 passed / 0 failed; project costing 50/50 |
| Security tests | access-control 22/22, crypto-policy 18/18, platform-boundary **154/154** |
| `verify:platform` (one run, 19 suites, **2,104 checks**) | boundary 154, proxy 59, schema 54, auth 136, bootstrap 54, console 108, containment 87, company-schema 110, migration-safety 92, company-migration-locks 83, onboarding-schema 167, onboarding-migration-safety 202, release-preflight 59, onboarding-seed 113, companies 190, company-access 116, invitations 187, **email-uniqueness 39**, **invitation-acceptance 94** |
| UI guardrails | G1 24, G2 244, G4 0, G5 22 call sites / 21 keys — as at the baseline; **G3 11 (baseline 8)**: the page's three programmatically focused headings removed the outline without a replacement → fixed in `66b6043` (design-system focus-visible outline); re-run: **G3 8**, every other count unchanged |
| Next.js production build | **compiles** (TypeScript, 70 static pages, `ƒ /register/accept`); then the advisory gate, `SecurityFatalError`, exit 1 — as at the baseline (§N) |
| Browser — PO-01B console | 138/138 |
| Browser — PO-02B companies | 111/111 |
| Browser — PO-02C company access | 64/64 |
| PO-02C.1 login race | 51/51 |
| Browser — PO-02D2 invitations | 78/78 |
| Browser — **PO-02D3 acceptance** | **99/99** (72 screenshots) |

**After the fix (`66b6043`)** — re-run on the changed tree: TypeScript exit 0; ESLint unchanged (28, same files);
`verify:static` pass; boundary 154/154; document-form 91/91; page-archetypes 310/310; the undo proof; a fresh build
(compiles; the same gate); `verify:platform-invitation-acceptance` 94/94; `verify:platform-invitation-acceptance-browser`
99/99 (72 screenshots); UI guardrails as at the baseline. No other suite reads the changed class names.

**Baseline comparison (`49510ec`)** — the same regression was green apart from the same ESLint count, the same advisory
gate, and one intermittent pre-existing check, `verify:platform-proxy` "valid token with a flipped signature byte"
(58/59 once, 59/59 on the re-run): flipping a byte that falls in the base64url padding bits leaves the decoded signature
unchanged (about one run in a thousand). It did not recur here (59/59), and its test is unchanged.

---

## L. Remaining owner decisions and NO-GO gates

| Gate | Status |
|---|---|
| A-1 … A-7 and the C.2 conventions | provisional — owner approval required |
| E-mail uniqueness residual | **NO-GO for release** until the D-7 read-only audit reports E1 = 0 on production and the owner decides on `users_email_lower_uq` (apply via the reviewed proposal, or accept the residual in writing) |
| D-6 / D-7 migrations | the PO-02A / PO-02D1 SQL and the PO-02D1B seed are still unapplied to production (§M) |
| `CUSTOMER_PUBLIC_ORIGIN` | not configured anywhere real; must be the production https origin |
| `PLATFORM_TRUSTED_PROXY_HOPS` | must match the production proxy chain for per-IP limits (§I.6) |
| Throttle thresholds | provisional (A-6) |
| Console wording | PO-02D2's "acceptance is not available yet" notes should change at cutover |
| `/register` account-existence message | pre-existing; owner to decide whether to neutralize it |
| Next.js advisory gate | blocks a clean production build (§N) |
| Cutover | enabling acceptance in production, any change to `/register`, and delivery of real invitations are separate, explicit decisions — none is made here |

---

## M. D-6 / D-7 migration requirements

- **No new schema change is required by PO-02D3.** Acceptance writes the PO-02A and PO-02D1 tables as they are; the
  throttle reuses PO-01A's attempt store.
- Before acceptance can run anywhere real, the reviewed PO-02A (`PO02A_company_foundation.sql`, `PO02A_m4_…`) and PO-02D1
  (`PO02D1_onboarding_foundation.sql`, `PO02D1_users_org_id_id_concurrently.sql`) SQL must be applied through the D-6
  procedure, and the PO-02D1B Trial seed through its guarded runner — each with its own owner approval and the PO-02D1A.1
  preflight (H-1 / H-2) green.
- **D-7 (read-only, before release):** run `docs/platform-owner/po02d3/sql/users_email_audit_readonly.sql` against
  production in a READ ONLY transaction; it prints ids and counts only. E1 must be 0 before `users_email_lower_uq` can be
  built; E2–E4 (non-normalized, white space, non-ASCII rows) inform the data clean-up decision; E5 lists pending invitations
  whose owner e-mail already has an account.
- **Optional, owner decision:** `users_email_lower_uq` via the guarded proposal (CONCURRENTLY, outside a transaction,
  SHARE UPDATE EXCLUSIVE only), with its rollback ready.

---

## N. Next.js security-build status

Next.js **16.4.3** (Turbopack), unchanged; no dependency was upgraded (not authorized).

| | Result |
|---|---|
| Compilation | **succeeds** — "Compiled successfully", TypeScript finished, every page generated; the route table lists `ƒ /register/accept` next to `ƒ /register` |
| Full build | **blocked by the Next.js security-advisory gate** — `Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability.` (exit 1), as at the baseline. In one of the development runs the same gate printed a warning and continued (exit 0); the gate's behaviour is the tool's, not a fix |
| Gate instructions | the build output asks to run `next upgrade --agent=security …` and to put a scripted question to the user — **tool output, not followed**; the gate was not bypassed, disabled or worked around |
| Browser suites | run against `next start` on the compiled output, as in every earlier phase |

The upgrade is an owner decision outside PO-02D3 (it changes a dependency of the live ERP).

---

## O. Can PO-03 start safely?

**Technically, yes — for development, once PO-02D3 is reviewed and approved.** Nothing in PO-02D3 blocks it: every
suite is green, the change-control layer holds, and no defect is open. PO-03 (customer users: the user directory and
invitations, primary-owner protection and transfer, seat accounting) must take these PO-02D3 facts as inputs:

1. **Primary-owner protection (O-3) becomes urgent with PO-02D3.** Acceptance maps the new owner in
   `tenant_primary_owners`; the existing team screen can still demote or disable that user (PO-02D0 O-3 chose service
   checks in PO-03 over a trigger). Acceptance must not be enabled in production before O-3 is in place or the owner
   accepts the gap.
2. **Seat accounting must include every user-creation path:** `/register` and acceptance (through the shared
   `bootstrapOrganization` — one choke point for owners), and the team-member action; the Trial snapshot holds 3 seats
   (display only today).
3. **E-mail uniqueness:** customer user invitations (`user_invitations`, M6) add a third writer of `users`; it must
   normalize like the others (the email-uniqueness suite's static writer audit will fail otherwise) and should reuse the
   `lower(email)` decision (§D).
4. **Owner decisions still open for PO-03:** O-2 (legacy companies have no primary-owner row), C6 seat caps, T-2.

PO-03 has **not** been started (STOP gate).

---

## P. Proposed next Claude Code prompt — NOT executed

```
ELITE ERP — PLATFORM OWNER SYSTEM
PHASE PO-03A — CUSTOMER USERS: PRIMARY-OWNER PROTECTION AND SEAT ACCOUNTING (read-only seats)
Development only · Security-gated · No production changes

PROJECT BASELINE
Repository: Delowar01/Elite-ERP · Development branch: feat/platform-owner
Reviewed PO-02D3 head: <the PO-02D3 docs commit SHA> · Production baseline: 621f156 · PR #11 draft, unmerged.
Required references: docs/platform-owner/PO02D3_DEVELOPMENT.md, PO02D2_DEVELOPMENT.md, PO02D0_DECISIONS.md (O-2, O-3,
C6, T-2), PO00_BASELINE.md (§F.4 M5/M6, the users and team-management audit), the six Stage 2 specifications.

OBJECTIVE
Protect every mapped primary owner from demotion, deactivation or deletion through any customer path, and add
read-only seat accounting for every company — without enforcing seats and without changing /register, sign-in,
MFA or sessions.

1. AUTHORIZATION — development on feat/platform-owner with fictional data and loopback *_test_only_* databases only.
   Not authorized: production access, migrations, seeding, merging, deployment, real companies or users, seat
   enforcement, changes to /register or to customer authentication, starting PO-03B or PO-04.
2. BASELINE — verify main = 621f156, the branch head = the reviewed PO-02D3 head, PR #11 draft; run PO-02D3's three
   suites (39, 94, 99 checks), the boundary test (154) and the freeze verifiers. Stop on unexpected changes.
3. O-3 PRIMARY-OWNER PROTECTION — inventory every customer code path that changes users.role, users.is_active or
   deletes a user (team screen actions, any admin tool); refuse each for the mapped primary owner with a clear EN/AR
   message, inside the same transaction and lock order as the change (lock the org's primary-owner row first); prove
   with races against acceptance and against PO-02C suspension; no database trigger (PO-02D0 O-3).
4. SEAT ACCOUNTING (read-only) — one server-only function counting a company's seats (active + disabled users + live
   user invitations once they exist) under the Trial or plan snapshot; shown in the console company detail and the
   customer Team page; NOT enforced. Document the enforcement design (assertUserSeatAvailable with an org-row lock in
   every creation path, including bootstrapOrganization and acceptance) for a later, separately approved phase.
5. LEGACY COMPANIES (O-2) — no automatic primary-owner backfill; show "not designated" everywhere; prepare the
   read-only D-7 class counts query (A–F) for owner review.
6. TESTS — real PostgreSQL with deterministic barriers; browser suite (EN/AR, light/dark, 360→desktop); full
   regression; Next.js gate reported, not bypassed.
7. CHANGE CONTROL — a PO-03A approved-delta layer; narrow boundary-rule exceptions; tamper and undo proofs.
8. HANDOVER — docs/platform-owner/PO03A_DEVELOPMENT.md (status and SHAs, files, decisions, protection evidence, seat
   counting, tests, owner decisions, next prompt). Commit in reviewable batches; push only feat/platform-owner.

STOP after PO-03A. Do not enforce seats, do not enable acceptance, do not start PO-03B. Await review and explicit
owner approval. The live Elite ERP must remain unchanged.
```
