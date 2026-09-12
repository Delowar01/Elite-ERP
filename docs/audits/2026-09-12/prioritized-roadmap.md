# Elite ERP — Prioritized Remediation Roadmap

**Revised 12 September 2026** after the correction pass · **Revision:** `main` @ [`04457ff`](https://github.com/Delowar01/Elite-ERP/commit/04457ff29948111bd5d24eff3eaf4e75b90971cf)
Companion to [`master-system-audit.md`](master-system-audit.md). IDs as used there.

**What changed in this revision** (detail in the audit's §0 correction log):
Batch 1 is reordered around **F-10**, the statements defect confirmed by
reproduction. The `next` upgrade **moves out of Batch 1** — its worst advisories
do not apply to this deployment and it is a minor-version bump needing its own
regression cycle. **Deleting migration history is withdrawn.** Blob privacy is
restated as a **storage and read-path migration**, not a config flag. Three new
batches cover work the first pass had marked unexaminable.

**Effort is relative, not calendar time.** `S` = a focused sitting · `M` = a day
or two plus verification · `L` = multi-day with design decisions. Every estimate
assumes the existing tiers are the gate and one engineer familiar with the
codebase. None accounts for review, deploy windows, or the owner decisions.

**Standing constraint on every UI batch: English and native Saudi Arabic with
correct RTL from the first commit.** §6.2 of the audit shows this standard is not
currently met, so it is a live requirement rather than a formality.

---

## Part A — Repairs

### Batch 1 — Money that is reported wrong — **recommended first batch**

| | |
|---|---|
| **Objective** | Make the pipeline mean something again, and fix every confirmed defect that misreports money — without touching a dependency, a schema or a role |
| **Included** | F-4/R-6 (CI crash) · **F-10/R-21 (statements drop reversals)** · F-1/R-3 (reversal status) · F-2/R-8 (project cash) · N-1/R-9 (payments register) · R-22 (uploads not backed up) · R-4 (run the production pack) |
| **Dependencies** | None. Item 1 first because it unblocks the gate; item 7 is a query the owner runs and proceeds in parallel |
| **Effort** | **M.** Item 1 is one line. Items 2–5 are each small and local. Item 6 is a script and a doc correction |
| **Acceptance criteria** | `access-control.test.mjs` runs to completion and **all 17 assertions pass** — not merely "no longer crashes". A statement over a period containing a reversal **reconciles to the control-account balance** for both a client and a vendor, and for a payment dated before the period with its reversal inside it. Reversing a payment on a credited invoice writes the status `settlementOf` computes, for the part-credited and fully-credited cases. Project cash excludes reversed payments. The payments-register balance is net of credit for invoices and unchanged for POs. Uploaded files are covered by a backup, or `backup-dr.md` states that Blob durability is the provider's — and `backup.sh` no longer exits 0 while skipping a backup target. The §11 answers are recorded in `docs/backlog.md` |
| **Verification** | A failing assertion committed **before** each fix, with its output recorded. F-10's must drive the **real actions** and the **real `getStatement`** — `evidence/repro-statements-*.mjs` is a working starting point, and the existing `verify:statements` **cannot** catch it because it hand-rolls journal inserts and never creates a `payment_reversal` entry. F-1's must sit at the **action** layer: the library suite passes 55/55 with the defect live. Then all three tiers green; `tsc` clean; lint at baseline |
| **Migration / deploy / rollback** | **No schema change, no dependency change.** Every item is a revert away from its prior state |

**Why these seven.** Each is local, independently testable, and carries no design
decision, so the batch cannot stall waiting on an answer. Together they close
every confirmed *misreported money* defect. The one item that *is* a decision —
the production query — blocks deployment, not development.

---

### Batch 2 — Dependencies, done properly

| | |
|---|---|
| **Objective** | Reduce real exposure and get `npm audit --audit-level=high` green — or record a conscious, documented acceptance |
| **Included** | R-1 / C-11 |
| **Dependencies** | Batch 1 (a working gate, so the upgrade is actually regression-tested) |
| **Effort** | **M–L**, and the spread is the point: `npm audit fix` is minutes; the `next` minor bump needs a full regression cycle; `puppeteer-core` is a **major** bump of the PDF path |
| **Acceptance criteria** | Three parts, kept separate: **(a)** `npm audit fix` clears `brace-expansion`, `browserslist`, `js-yaml`, `nanoid` in place. **(b)** `next` 16.2.10 → the current 16.3.x (≥ **16.3.3**, which patches both criticals; npm suggests 16.3.5). **This is a MINOR version change** — `isSemVerMajor:false` means "not a major", not "compatible" — so it is accepted only when all three tiers, `tsc`, lint and a manual PDF/print pass are green on it, with particular attention to Turbopack, Server Actions and `src/proxy.ts`, whose APIs Next has been changing. **(c)** `puppeteer-core` → 25.10.0 is a **major** bump affecting PDF generation: either done with a PDF regression pass, or **consciously deferred with the three advisories written down as accepted risk**. `--audit-level=high` stays in CI either way |
| **Verification** | Tiers green on the upgraded tree; PDF output compared before and after; `npm audit --audit-level=high` exit code recorded |
| **Migration / deploy / rollback** | Lockfile only. Rollback is a lockfile revert — **provided the lockfile change is its own commit**, which it should be |

**What the first report got wrong, corrected here.** It called this Critical and
the fix non-breaking, and said it cleared the gate. Verified against the GitHub
Advisory Database and this app's configuration: the **Windows RCE cannot affect a
Vercel/Linux deployment**; the **middleware bypass needs a single-entry
`config.i18n.locales`** this app does not have; **two SSRF advisories need a
custom server or `rewrites`**, neither of which exists. What genuinely applies is
a DoS and an endpoint-disclosure class. And after the `next` bump **six high
packages remain**, so the gate does not go green on it alone.

---

### Batch 3 — Close the storage gap *(a migration, not a flag)*

| | |
|---|---|
| **Objective** | Make file access controlled by authorization rather than by filename entropy |
| **Included** | F-3 / R-2, D-1 |
| **Dependencies** | Batch 1 |
| **Effort** | **L.** The first report called this **M** by treating it as a `put()` option. It is a storage migration with a read path, existing objects, caching and a rollback asymmetry |
| **Scope, in the order it has to be done** | **(1) Write path** — `access: "private"` (or a private store) in `storeBlob`. **(2) Read path** — the proxy's `fetch(blobBaseUrl()/pathname)` is currently unauthenticated and works *because* objects are public; it must move to an authenticated/token-scoped read, which is a different call, not a different flag. **(3) Existing objects** — every already-stored file stays public until migrated; enumerate, re-upload or re-permission, and reconcile against the `/uploads/...` paths in the database. **(4) Signed branding access** — `BRANDING_FOLDERS` served by HMAC signature with no session must keep working, since PDFs and share links depend on it. **(5) Caching** — the proxy sets `Cache-Control: private, max-age=3600`; confirm no shared cache or CDN retained a public copy. **(6) Rollback asymmetry** — a code revert leaves already-privatised objects private; they remain readable through the proxy, but **rolling back is not symmetric** and must be stated in the runbook before deploy |
| **Acceptance criteria** | A direct request to a blob URL without credentials is **refused**, proven both ways (it must fail with the change reverted). Upload/download round-trips work through the proxy for all **nine** folders. Signed branding URLs still serve without a session. Every pre-existing object is migrated or explicitly accepted as legacy, with that decision recorded. The `blob-storage.ts` header comment is corrected; dead `blobUrlFromStored()` is removed or given a caller |
| **Migration / deploy / rollback** | No schema. **Data migration over existing blobs.** Sequence and rehearse; the rollback asymmetry is the part that bites |

---

### Batch 4 — Make the ledger reconcile

| | |
|---|---|
| **Objective** | Remove the AR control-account vs subledger divergence, and the last two-term settlement reader |
| **Included** | F-9 / R-5, N-2 / R-16 |
| **Dependencies** | **Owner decision 2.** Cannot start without it — and this roadmap does **not** presume 2300 |
| **Effort** | **L** — it changes non-advance credit-note behaviour and every test pinning it |
| **Acceptance criteria** | Whatever destination is chosen, a 10,000 cash-paid invoice with a 2,000 credit note leaves **GL 1100 and the aging subledger agreeing**. Advance-backed credit-note behaviour is unchanged. Statement labels reflect credited amounts; statement **amounts** stay ledger-derived |
| **Verification** | The reconciliation asserted directly — control total equals subledger total for the fixture org, before and after. Mutation: revert the posting rule and confirm failure. All note/advance/settlement suites re-run |
| **Migration / deploy / rollback** | A repair for existing rows may be needed — **measure against production first; do not write one on spec.** The rule and any repair deploy as separate steps, because a repair already applied does not roll back cleanly |

---

### Batch 5 — Make CI carry the evidence

| | |
|---|---|
| **Objective** | The verify tiers run automatically; the security suite tests state, not artefacts |
| **Included** | N-4 / R-7, D-2, D-7, R-29 |
| **Dependencies** | Batch 1 |
| **Effort** | **M** — the workflow already provisions Postgres for the build job |
| **Acceptance criteria** | `verify:static` and `verify:server` run on every push against a CI Postgres service and fail the pipeline on any failure. `crypto-policy.test.mjs`'s trigger assertion queries **`pg_trigger`**, not the SQL file. **`verify-duedate.mjs` is wired into a runner** or converted to a browser suite — today no runner reaches it. A deliberately broken assertion fails CI, **proven once**, then reverted |
| **Migration / deploy / rollback** | CI config only. The browser tier is likely too slow for every push — **propose nightly or pre-release explicitly**, rather than quietly omitting it |

---

### Batch 6 — The UI is desktop-only

| | |
|---|---|
| **Objective** | Make the product usable below 1024px |
| **Included** | R-23 / C-10 |
| **Dependencies** | None |
| **Effort** | **M–L** — one shared shell component causes most of it, but 29 routes must be re-measured |
| **Acceptance criteria** | **0 of 29 routes overflow horizontally at 768px and at 390px**, measured the same way as the audit (`documentElement.scrollWidth − clientWidth ≤ 2`). `div.topbar-actions` — 653px against a 390px viewport — wraps or collapses. Any new control added is bilingual EN/AR from the first commit |
| **Verification** | `evidence/repro-ui-coverage.mjs` re-run and committed as a browser suite so the measurement becomes a gate rather than a one-off |
| **Migration / deploy / rollback** | None. Pure UI |

---

### Batch 7 — Finish the bilingual requirement

| | |
|---|---|
| **Objective** | Meet the project's own standing rule, which is currently not met |
| **Included** | R-25 / C-9 |
| **Dependencies** | None |
| **Effort** | **M** |
| **Acceptance criteria** | The **27 keys** passed to `t()` but absent from the dictionary are added. The **~50 literal strings** in `title`/`label`/`placeholder` props are routed through `t()` — deliberately excluding genuine example placeholders, each exclusion noted. The customer-facing print template no longer renders `SUPPLY FROM` / `DELIVERED TO` in an Arabic document. **A static assertion fails the gate when a `t()` key is missing from the dictionary** — without it this recurs, as it already has once |
| **Verification** | The static key sweep from this audit, committed as a `verify:static` suite; plus the 29-route Arabic browser sweep |
| **Migration / deploy / rollback** | None |

---

## Part B — Previously agreed but unfinished

### Batch 8 — Migration baseline *(history preserved)*

| | |
|---|---|
| **Objective** | Disarm the `db:migrate` trap **without discarding migration history** |
| **Included** | F-6, part of R-4, owner decision 6 |
| **Dependencies** | Batch 1 item 7 (know what production has) |
| **Effort** | **M**, and **not mechanical** — see below |
| **Scope** | Keep `0000`–`0004` and `_journal.json` **untouched**. Author **one** `0005` delta carrying the measured gap: **7 tables, 204 columns to ADD and 1 to DROP** — a net +203, reconciled in the audit's §12. `drizzle-kit generate` **cannot produce it non-interactively**: it fails at `promptColumnsConflicts` ("Interactive prompts require a TTY") because `terms_conditions_groups` both loses `content` (`text`) and gains `terms` (`jsonb`, commit `15ef378`), so the tool cannot tell a rename from a drop-and-create. **That is the only such decision** — exactly one prompt, not an open-ended set. So either a person answers it once, or `0005` is hand-written from the diff the audit already measured. Note `content text` → `terms jsonb` is **data-carrying**, which matters only for a database genuinely built from migrations; a `db:push`-built production already has `terms` and never had `content` |
| **Acceptance criteria** | **Proven on both database shapes**, neither being production: a **fresh** database built by migrations alone fingerprint-matches one built by `db:push` (`information_schema.columns`); and a database **already at `0004`** reaches that same fingerprint after applying only `0005`. `db:harden` remains in the deploy sequence — **measured: neither path installs the audit triggers, 0 of 2 on both.** `db:migrate` is removed from `package.json` **only once `0005` exists and both proofs pass**; until then the runbook keeps warning about it |
| **Verification** | `evidence/repro-migration-baseline.sh` is the harness; extend it to apply `0005` and compare all three fingerprints |
| **Migration / deploy / rollback** | Tooling only; **no production schema change**. `0005` must be a no-op against a database already built by `db:push` — verify that explicitly before it goes near production |

### Batch 9 — Proforma project attribution

| | |
|---|---|
| **Objective** | Revenue arriving through a proforma is attributed to its project |
| **Included** | F-8 / R-11, and the related proforma-advance gap |
| **Dependencies** | **Owner decision 5** (backfill or not) |
| **Effort** | **M** without backfill, **L** with |
| **Acceptance criteria** | `proforma_invoices.project_id` exists; the form sets it; `convertProformaToInvoiceAction` carries it to the invoice; project costing includes that revenue. Backfill applied or explicitly declined, recorded either way |
| **Verification** | `verify:project-costing` extended with a proforma→invoice fixture; mutation: drop the carry-through, confirm failure |
| **Migration / deploy / rollback** | **Schema-first**, additive and nullable. Backfill, if chosen, runs **after** the code deploy. `db:push` only |

### Batch 10 — Caps, PO symmetry, Departments

| | |
|---|---|
| **Objective** | Close the small filed gaps |
| **Included** | R-17 (debit-note cap, PO payment cap), R-18 (HR Departments CRUD), optionally PO paid statuses (**owner decision 12**) |
| **Dependencies** | None for the caps and Departments |
| **Effort** | **S** for the caps · **S–M** for Departments · **M–L** for PO paid statuses |
| **Acceptance criteria** | A debit note cannot exceed its PO; a PO payment cannot exceed the order total; both refuse with a message naming the corrective path, **in both languages**. Departments gain CRUD with the same role gates, confirm policy, dirty-form guard and recycle-bin semantics as peer modules, bilingual from the first commit. If PO paid statuses are approved, `recordPaymentAction` and `reversePaymentAction` gain the recompute **together** — the comment at `finance/payments/actions.ts:1010` says so explicitly |
| **Verification** | Refusals proven by **server-side action replay with a working control**, per `verify-delete-refusal` — a refusal test that passes because nothing was there proves nothing |
| **Migration / deploy / rollback** | None for caps. PO paid statuses add a status value needing a decision for existing rows |

---

## Part C — New recommendations requiring approval

*Not previously agreed. Listed for a decision, not started.*

### Batch 11 — Operational visibility and provable recovery

| | |
|---|---|
| **Objective** | Know when the product is broken; know that it can be recovered |
| **Included** | R-12, R-13, and the scheduling half of R-22 |
| **Effort** | **M** |
| **Acceptance criteria** | `/api/health` reporting database reachability and schema presence without leaking detail to an unauthenticated caller. An error tracker receiving server-action and route failures. **A restore drill performed and documented** — the artefact is the drill record, not the script. **Backup scheduling confirmed on the actual target**: `backup-dr.md` assumes cron/systemd, which Vercel does not have; either Neon's PITR tier is recorded as the answer or a scheduled job is added |
| **Verification** | Health endpoint asserted healthy and database-down; restore evidenced by a recovered database |

### Batch 12 — Fractional stock, or an honest refusal

| | |
|---|---|
| **Objective** | Stop silently truncating stock movements |
| **Included** | R-24 / C-2, **owner decision 8** |
| **Effort** | **M** either way |
| **Acceptance criteria** | **Either** `quantity_on_hand` becomes `numeric(12,2)`, all **five** `Math.trunc` sites are removed, and `adjustStockAction` stops handing a float to an integer column (today Postgres rejects it, `22P02`) — **or** stock-tracked items *reject* fractional document quantities at validation time with a clear bilingual message. **What must not remain is the current behaviour**: 1.5 silently moving 1, 0.5 silently moving nothing, and the adjustment path throwing |
| **Verification** | The measured drift table in `evidence/repro-fractional-stock.txt` re-run and asserted to be zero (or the refusal asserted) |
| **Migration / deploy / rollback** | Column type change **with data** if the numeric route is taken — existing integers widen safely, but the change is not reversible once fractions are stored |

### Batch 13 — Accounting completeness decisions

| | |
|---|---|
| **Objective** | Decide on four absent controls a finance team will expect |
| **Included** | R-26 (period close/lock) · R-27 (payroll posts net) · R-28 (vendor bills, bank reconciliation) · inventory valuation/COGS |
| **Dependencies** | **Owner decisions 9, 10** |
| **Effort** | **L** each; these are features, not repairs |
| **Notes** | **Period lock** is the most surprising absence for a product this careful with the ledger — nothing prevents posting into a reported period. **Payroll** posts net, so deductions never reach the ledger: salary expense is understated and no withholding liability is recorded (documented in source as a deliberate boundary). **Vendor bills** do not exist — the PO is the AP document, which is coherent but means input VAT is recognised at PO receipt. **Bank reconciliation** does not exist |

### Batch 14 — Customer PII encryption

| | |
|---|---|
| **Objective** | Personal data protected at rest |
| **Included** | R-10 |
| **Dependencies** | **Owner decision 4** — the approach determines the whole shape |
| **Effort** | **L.** The encryption is the easy half; search, sorting, import lookup and duplicate detection are the hard half |
| **Acceptance criteria** | Client search, global search, name sorting, import lookup and duplicate detection all still work, with any narrowing documented as accepted. Every customer row backfilled. Defined behaviour when `FIELD_ENCRYPTION_KEYS` is absent. The GDPR portability export still emits plaintext |
| **Verification** | Round-trip crypto tests **plus an end-to-end assertion for each affected read path** — the risk is a silently broken search, not broken crypto |
| **Migration / deploy / rollback** | Schema + full backfill. **Rollback after backfill is not clean.** Sequence and rehearse |

### Batch 15 — Performance baseline

| | |
|---|---|
| **Objective** | Replace suspicion with measurement before engineering anything |
| **Included** | R-14 |
| **Effort** | **M** |
| **Acceptance criteria** | Measured timings for dashboard aggregates, aging, statements and a large import at realistic row counts; index coverage confirmed for tenant + status + date filters. **A decision on background work taken on evidence.** This roadmap deliberately does **not** recommend a queue, because nothing has been measured |
| **Migration / deploy / rollback** | Possibly indexes — additive and safe |

---

## Part D — Optional expansion

| Item | Note |
|---|---|
| Screen-reader / full WCAG programme | Keyboard, focus and contrast are **good and measured**; assistive-technology behaviour is unexamined |
| Document revisions (incl. sent proformas) | **Entirely absent** for every document type — a new feature, not an unfinished one |
| ZATCA Phase 2 | **Excluded** by standing decision; the four unwired columns remain its home |
| Segregation of duties | **Owner decision 3.** Would need a fourth role or per-action gates. **No role change is proposed here** |
| Unified shell / tenant, Party + PartyRole | Strategic context only. Prerequisites: the three-role model with no permissions engine, and `orgId` scoping by convention rather than by the database |

---

## Sequencing

```
Batch 1  ──┬── Batch 2  (dependencies — its own regression cycle)
           ├── Batch 3  (storage migration)
           ├── Batch 5  (CI)
           ├── Batch 6  (responsive)      ← no decisions needed
           ├── Batch 7  (bilingual)       ← no decisions needed
           ├── Batch 10 (caps, departments)
           └── Batch 8  (migration baseline ← needs Batch 1 item 7)

owner decision 2  ──► Batch 4  (ledger reconciliation)
owner decision 5  ──► Batch 9  (proforma project)
owner decision 4  ──► Batch 14 (PII)
owner decisions 8/9/10 ──► Batches 12, 13

Batches 11 (ops) and 15 (performance) are independent.
```

**Batch 1 first, and nothing in it waits on anybody.** Batches 4, 9, 12, 13 and
14 are each gated on a decision that is genuinely the owner's — sequenced that
way deliberately rather than started on an assumption.
