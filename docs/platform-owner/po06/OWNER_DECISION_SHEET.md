# PO-06 — Owner decision sheet

**Read this first.** The behaviour built in development is a **default, not an authorization**. Nothing below has been
decided on the owner's behalf. Each decision says what approving it means for the first **test-only staging**
deployment (fictional data, no production resource) and, separately, for **production**.

Approval wording for each decision:
- **"approve for staging"** = the owner allows the development default to run on the isolated staging environment, for
  testing only;
- **"approve for production"** = the final decision.

Columns: **St** = blocks the first staging deployment? **Pr** = blocks production? **Rev** = reversible after it is in
effect?

## 1. Migration, data and schema decisions

| # | Question (plain English) | Recommended | Reason · risk | Today (development) | St | Pr | Rev | Approval required |
|---|---|---|---|---|---|---|---|---|
| D-6 | How do the Platform Owner tables reach a database? | the PO-06 manifest: one reviewed file per step, guarded, pinned, verified, with the reviewed rollbacks; `--concurrent-indexes` always; never unrestricted push | rehearsed A–O with zero customer-data change · risk: production needs a production mode the tool deliberately lacks | the manifest tool, disposable databases only | **yes** | **yes** | partly — R08…R03 yes; PO-01A has no rollback (D6-F3) | "approve the D-6 manifest for the staging database"; production separately, after D-7 and a production-mode design |
| D-7 | May the read-only measurement bundle run against production (or a Neon branch of it)? | yes, on a Neon branch created for it and deleted afterwards, under a read-only role, per `D7_AUDIT_PROCEDURE.md` | validated read-only, bounded and secret-free on fictional data · risk: creating the branch and the role are production-account operations | never run against production | no | **yes** | yes (read-only; the branch is deleted) | written approval naming target, operator, window, file SHA-256 and output location |
| E-1 | Add `users_email_lower_uq` (case-insensitive e-mail uniqueness on `users`)? | staging: yes, after E1 = 0 (trivially true on fresh fictional data). Production: decide after D-7 E1 | closes the case-variant twin residual; CONCURRENTLY, no blocking lock · risk: E1 > 0 needs per-account remediation; `/register` then shows an unhandled error for that case (EI-1) | not installed anywhere | no | **yes** (release NO-GO until decided — PO-02D3 §D.4) | yes (`DROP INDEX CONCURRENTLY`) | "approve the index for staging"; for production: E1 = 0 and the D-6 runbook; EI-1 decided |
| L-3 | Approve the staged `user_invitations` table (72-hour window, 30-day cap, one open invitation per address, immutable terms, no deletion, guarded rollback)? | approve for staging | needed for user invitations and `/join/accept` · risk: while it is staged outside `src/db/schema`, a push would drop it (D6-F1) | staged in `src/db/staged`, disposable databases only | only for F5/F6 | **yes** | yes while empty (R08 refuses with rows) | "approve L-3 for staging" — then S08 runs |
| T | The Trial values (14 days, 3 seats, 5 GB, all modules, 0 grace days, alerts on, SAR 0.00) | confirm for staging | supplied for development in PO-02D1B · risk: the seed refuses later changes; a different value needs a reviewed change | seeded on disposable databases | **yes** (S07) | **yes** | yes (R07 while unreferenced) | "confirm the Trial values for staging" |
| R-1 | Release the Team-field security fix and the Next.js 16.4.6 update to **production** separately from this programme? | yes, first, as its own reviewed release (the hotfix branch + PO-05's three-file update), before any Platform Owner release | production still runs 16.4.3 (seven advisories) and lacks the Team-field fix · risk: delaying it keeps both exposures live | `fix/team-sensitive-fields-exposure` at `94f936e`, unmerged; `main` at 16.4.3 | no | **yes** | yes (a normal release rollback) | "approve the production security release (R-1)", with N-2's ordering |

## 2. PO-03C decisions L-1 … L-10 (L-3 above)

| # | Question | Recommended | Reason · risk | Today | St | Pr | Rev | Approval |
|---|---|---|---|---|---|---|---|---|
| L-1 | After a primary-owner transfer, what does the previous primary owner become? | admin | keeps access without ownership · risk: the owner may prefer staff | admin | no (staging default) | **yes** | yes | "approve L-1 = admin" (staging and/or production) |
| L-2 | Grant `platform.users.manage_roles` and `platform.users.invite` to the single Platform Owner role? | yes | one operator role in Stage 2 · risk: no separation of duties | both granted | no | **yes** | yes | "approve L-2" |
| L-4 | Where and when may `PLATFORM_USER_INVITATIONS_ENABLED` be on? | staging after L-3 (step F5); production later | needs the table · risk: none while off | off everywhere | only for F5 | **yes** | yes (switch) | "approve F5 on staging" |
| L-5 | D-6 and D-7 | see §1 | — | open | yes (D-6) | yes | — | — |
| L-6 | Customer copy: pending invitations occupy seats | approve the built wording | built in PO-03D · risk: wording only | built, development | no | yes | yes | "approve the L-6 copy" |
| L-7 | `/join/accept` and `CUSTOMER_PUBLIC_ORIGIN` for user invitations | the staging customer origin on staging | links must point at staging · risk: a wrong origin sends testers elsewhere | built, switch off | only for F6 | **yes** | yes | "approve F6 on staging with `CUSTOMER_PUBLIC_ORIGIN` = staging" |
| L-8 | Release review of the Team session correction (PO-03C B), separate from the hotfix | review before production | changes when Team edits end sessions · risk: unexpected sign-outs | development only | no | **yes** | yes | "approve L-8 after review" |
| L-9 | Do pending invitations occupy seats while the switch is off but the table exists? | yes (data decides) | consistent counting · risk: none | yes | no | yes | yes | "approve L-9" |
| L-10 | 20 user invitations per operator per hour | keep 20 | anti-abuse · risk: a large onboarding may need more | 20 | no | yes | yes | "approve L-10" |

## 3. PO-03D policies P-1 … P-10

| # | Question | Recommended | Reason · risk | Today | St | Pr | Rev | Approval |
|---|---|---|---|---|---|---|---|---|
| P-1 | Trial = 3 users; active **and** disabled users occupy seats; open unexpired invitations reserve one | approve for staging | simple, abuse-resistant · risk: disabled users counting may surprise customers | built | only for F7 | **yes** | yes | "approve P-1" |
| P-2 | An accepted invitation becomes the user without a second seat | yes | no double counting | built | no | yes | yes | "approve P-2" |
| P-3 | A company above its allowance keeps its users but gets no new seat (grandfathering) | yes | never locks out existing users (D7-07 counts them) | built | only for F7 | **yes** | yes | "approve P-3" |
| P-4 | No current subscription: the Team adds as before (legacy); Platform Owner invitations are refused | yes for now | existing customers unaffected until a subscription is assigned · risk: legacy companies stay unlimited | built | no | **yes** | yes | "approve P-4" |
| P-5 | Missing or malformed foundation: every allocation refused ("can't be checked") | yes | fail closed | built | no | yes | yes | "approve P-5" |
| P-6 | No session after acceptance; the invitee signs in at `/login` | yes | no token-to-session shortcut | built | no | yes | yes | "approve P-6" |
| P-7 | Invited users are admin or staff only, never owner; they choose the password | yes | ownership transfers have their own flow | built | no | yes | yes | "approve P-7" |
| P-8 | `CUSTOMER_SEAT_ENFORCEMENT_ENABLED` covers all four paths, off by default | yes; turn on last (F7), with consent | the Plan requires consent for any seat cap on active tenants | built, off | only for F7 | **yes** | yes (switch) | "approve F7 on staging"; production needs consent for active tenants |
| P-9 | A Team add of an address with an open user invitation is allowed; the invitation then cannot be accepted | yes | Team behaviour unchanged | built | no | yes | yes | "approve P-9" |
| P-10 | Team add does not re-check company access inside its transaction; a member added during a suspension cannot sign in while it lasts | accept | sign-in is the enforcement point | built | no | yes | yes | "approve P-10" |

## 4. PO-05 decisions N-1 … N-7

| # | Question | Recommended | Reason · risk | Today | St | Pr | Rev | Approval |
|---|---|---|---|---|---|---|---|---|
| N-1 | Approve Next.js 16.4.6 | yes | fixes the seven advisories; builds clean | on `feat/platform-owner` | **yes** (the staging build) | yes | yes | "approve N-1" |
| N-2 | How the update reaches `main`: with, before or after the Team-field hotfix | one separate three-file commit, released with or right after R-1 | `main` is exposed today | not done | no | **yes** | yes | "approve N-2 ordering" |
| N-3 | The 13 moderate audit findings (`uuid` via `exceljs` reaches production) | a separate dependency task; never npm's downgrade "fixes" | moderate · risk: unassessed reachability | open | no | review | yes | "schedule N-3" |
| N-4 | Registry signatures and provenance where Sigstore is reachable | run `npm audit signatures` in CI or on the staging host | supply-chain assurance | blocked here by network policy | no | recommended | — | "approve N-4 in CI" |
| N-5 | Harden the two timing-sensitive checks (A.1-14), test-only | yes, when convenient | flaky tests hide regressions | re-run and report both results | no | no | yes | "approve N-5" |
| N-6 | Read the official Next.js notice before staging | yes | context | not read here | no | no | — | owner reads it |
| N-7 | Keep or remove `nextjs.org` in the session's network allowlist | remove after PO-05 | least privilege | allowed | no | no | yes | environment setting |

## 5. Staging architecture and activation (new in PO-06)

| # | Question | Recommended | Reason · risk | Today | St | Pr | Rev | Approval |
|---|---|---|---|---|---|---|---|---|
| S-1 | The staging host | a NEW VM in a separate account; 2 vCPU / 4 GB / 40 GB; Ubuntu 24.04 LTS; never the Hostinger production VPS | isolation · risk: cost; shared-account mistakes | none | **yes** | — | yes (destroy it) | name the provider, account and size |
| S-2 | The staging database | PostgreSQL 16 on the staging host, 127.0.0.1 only, named `*_test_only_*`, least-privilege roles | every guarded tool works unchanged; unreachable from the network · risk: not identical to Neon | none | **yes** | — | yes | "approve S-2" |
| S-3 | Domain and host names | a staging-only registrable domain; `<customer>` and `<console>` host names; optional basic authentication | no cookie, HSTS or DNS link to production · risk: a production sub-name would couple certificates and DNS | none | **yes** | — | yes | name the domain |
| S-4 | External services | none: deny-all outbound, copy-link invitations, no payment or messaging provider, an exchange-rate stub | no live side effects · risk: features needing them are untested | — | **yes** | — | yes | "approve S-4" |
| S-5 | File storage | the test driver (`STORAGE_DRIVER=fake`) on the host | no external store, no real token · risk: the Blob path stays untested on staging | — | **yes** | — | yes | "approve S-5 = fake driver", or name a dedicated staging store |
| S-6 | Logs and monitoring | host-local journald with retention; no shipping | nothing leaves the host · risk: less visibility | — | no | — | yes | "approve S-6" |
| S-7 | The staging activation policy | F0 → F7 exactly as `SECURITY_AND_FLAG_MATRIX.md` §2: one switch per restart, each checked; F5/F6 only after L-3; F7 only with P-8 consent; only the named operator changes switches | each switch proven before the next · risk: none | all off | **yes** | separate | yes (switches) | "approve the S-7 activation policy and the operator" |
| S-8 | Staging backups | daily `scripts/backup.sh`, gpg to an offline-held key, retention 14 days, an off-host copy; a restore drill before go-live | proven cycle (§R) · risk: RB-1/RB-4/RB-6/RB-7 handled by the runbook until the scripts are fixed | — | **yes** | — | yes | "approve S-8", name the off-host location and the key custodian |
| D-8 | `CUSTOMER_LEGACY_TOKENS=reject` | leave unset on the first staging | a fresh database has no legacy tokens | unset | no | review | yes | optional |

## 6. What must be signed before Prompt 7 starts (the short list)

**For the staging deployment:** D-6 (staging), T, N-1, S-1, S-2, S-3, S-4, S-5, S-7, S-8.

**For specific switches:**
- L-3, L-4, L-7 — the user-invitation switches;
- P-1, P-3, P-8 — seat enforcement;
- E-1 — the index on staging.

Everything else is needed before **production**, not before staging. R-1 (the production security release) is
recommended to go **first**, independently of this programme.
