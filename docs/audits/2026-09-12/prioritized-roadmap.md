# Elite ERP — Prioritized Remediation Roadmap

**Audit date:** 12 September 2026 · **Revision:** `main` @ `04457ff`
Companion to [`master-system-audit.md`](master-system-audit.md). Findings are
referenced by the IDs used there (F-*, N-*, R-*, D-*).

**Effort is relative, not calendar time.** `S` = a focused sitting; `M` = a day
or two of work plus verification; `L` = multi-day with design decisions. Every
estimate assumes the existing verification tiers are run as the gate, and
assumes one engineer familiar with this codebase. **No estimate accounts for
review, deployment windows, or the owner decisions in §10 of the audit.**

Standing constraint on every batch that touches UI: **English and native Saudi
Arabic with correct RTL from the first commit**, not a later pass. This is in the
acceptance criteria wherever it applies.

---

## Part A — Repairs (defects found against intended behaviour)

### Batch 1 — Stop the bleeding — **recommended first batch**

| | |
|---|---|
| **Objective** | Remove the critical vulnerability, make the pipeline mean something, and fix the settlement readers that report wrong money — the smallest set that materially reduces risk |
| **Included findings** | R-1 (`next` critical), F-4/R-6 (CI crash), F-1/R-3 (reversal status), F-2/R-8 (project cash), N-1/R-9 (payments register), R-4 (production schema fact) |
| **Dependencies** | None. Item 6 is a query the owner runs, not code — it can proceed in parallel |
| **Effort** | **S–M.** Item 1 is a version bump; items 2–5 are each a few lines plus an assertion; item 6 is not engineering |
| **Acceptance criteria** | `next@16.3.5` installed and `npm audit --audit-level=high` reports no critical. `tests/security/access-control.test.mjs` runs to completion and **all 17 assertions pass** — not merely the file no longer crashing. Reversing a payment on an invoice carrying a credit note writes the status `settlementOf` computes, for both the part-credited and fully-credited cases. Project cash excludes reversed payments. The payments register balance is net of credit for invoices, unchanged for POs. The production `information_schema` result is recorded in `docs/backlog.md` |
| **Verification** | Per-defect failing assertion committed **before** the fix, with the failure output recorded. Then `verify:static`, `verify:server`, `verify:browser` all green; `tsc` clean; lint at baseline. For F-1 the assertion must sit **at the action layer** — the library-level suite passes 55/55 with the defect present, which is exactly why it survived |
| **Migration / deploy / rollback** | **No schema change.** `next` 16.2.10→16.3.5 is a patch-range bump within the stated dependency range. Rollback is a revert; no data migration to undo |

**Why these five and not more.** Each is local, independently testable, and
carries no design decision. Nothing here requires the owner's accounting
judgement, so the batch cannot stall. The one item that *is* a decision — the
production query — blocks deployment, not development, so it runs alongside.

---

### Batch 2 — Close the storage gap

| | |
|---|---|
| **Objective** | Make file access controlled by authorization rather than by filename entropy |
| **Included findings** | F-3 / R-2, D-1 (the misleading source comment) |
| **Dependencies** | Batch 1 (a green pipeline, so the change is actually gated) |
| **Effort** | **M.** The proxy already exists and already does the right checks — the change is how objects are stored and fetched, plus a migration for existing objects |
| **Acceptance criteria** | New uploads are written with private access. The proxy fetches them with a scoped token rather than an unauthenticated URL. A direct request to a blob URL without credentials is **refused**. Existing objects are migrated or explicitly accepted as legacy with that decision recorded. The `blob-storage.ts` header comment is corrected to describe what the storage actually guarantees. Dead `blobUrlFromStored()` removed or given a caller |
| **Verification** | A test that fetches a known object's blob URL **without** credentials and asserts refusal — the assertion must fail if access is reverted to public, so it is run both ways. Upload/download round-trip through the proxy still works for every one of the nine folders, plus signed-URL branding access |
| **Migration / deploy / rollback** | No schema change. **Existing blobs need a decision**: re-upload as private, or leave and accept. Rollback is a code revert; objects already made private stay private and remain readable through the proxy, so rollback is safe in one direction only — **note this before deploying** |

---

### Batch 3 — Make the ledger reconcile

| | |
|---|---|
| **Objective** | Remove the AR control-account vs subledger divergence, and the remaining two-term settlement reader |
| **Included findings** | F-9 / R-5, N-2 / R-16 |
| **Dependencies** | **Owner decision 2** (where the credit goes). Cannot start without it |
| **Effort** | **L.** Not because the posting is hard, but because it changes non-advance credit-note behaviour and every test pinning it |
| **Acceptance criteria** | A 10,000 cash-paid invoice with a 2,000 credit note leaves GL 1100 and the aging subledger **agreeing**. Existing credit-note behaviour for the advance-backed path is unchanged. Statement labels reflect credited amounts; statement **amounts** remain ledger-derived and unchanged |
| **Verification** | The reconciliation asserted directly — control account total equals subledger total for the fixture org, before and after. Mutation: revert the posting change and confirm the assertion fails. `verify:credit-note-release`, `verify:note-fx`, `verify:settlement`, `verify:advances` all re-run and green |
| **Migration / deploy / rollback** | Possibly a repair for existing affected rows — **to be measured against production first, not written on spec**. Rollback of the posting rule is clean; a repair already applied is not, so they deploy as separate steps |

---

### Batch 4 — Make CI carry the evidence

| | |
|---|---|
| **Objective** | The 71 verify suites run automatically, and the security suite tests state rather than artefacts |
| **Included findings** | N-4 / R-7, D-2, D-7 |
| **Dependencies** | Batch 1 (the suite must pass before it can gate) |
| **Effort** | **M.** The workflow already provisions Postgres for the build job; the tiers need a job and a runtime budget |
| **Acceptance criteria** | `verify:static` and `verify:server` run on every push against a CI Postgres service and fail the pipeline on any failure. `crypto-policy.test.mjs`'s trigger assertion checks **`pg_trigger`**, not the SQL file. A deliberately broken assertion fails CI — proven once, not assumed |
| **Verification** | One pull request that intentionally breaks one assertion and shows CI red; then reverted |
| **Migration / deploy / rollback** | CI configuration only. The browser tier is likely too slow for every push — **propose nightly or pre-release, and say so explicitly rather than quietly omitting it** |

---

## Part B — Previously agreed but unfinished

### Batch 5 — Proforma project attribution

| | |
|---|---|
| **Objective** | Revenue arriving through a proforma is attributed to its project |
| **Included findings** | F-8 / R-11, and the related proforma-advance gap |
| **Dependencies** | **Owner decision 5** (backfill or not) |
| **Effort** | **M** without backfill, **L** with |
| **Acceptance criteria** | `proforma_invoices.project_id` exists; the proforma form sets it; `convertProformaToInvoiceAction` carries it to the invoice; project costing includes that revenue. Backfill applied or explicitly declined, with the decision recorded |
| **Verification** | Extend `verify:project-costing` with a proforma→invoice fixture and assert the project total moves. Mutation: drop the carry-through and confirm failure |
| **Migration / deploy / rollback** | **Schema-first**, additive and nullable — same shape as the four columns in the existing runbook. Backfill, if chosen, runs **after** code deploy. `db:push` only |

### Batch 6 — Caps and purchase-order symmetry

| | |
|---|---|
| **Objective** | Close the two remaining asymmetries between the sales and purchasing paths |
| **Included findings** | R-17 (debit-note cap, PO payment cap), and optionally PO paid statuses (**owner decision 8**) |
| **Dependencies** | None for the caps. PO paid statuses need the decision and carry a wider blast radius |
| **Effort** | **S** for the two caps; **M–L** for paid statuses |
| **Acceptance criteria** | A debit note cannot exceed its purchase order; a PO payment cannot exceed the order total. Both refuse with a message naming the corrective path, in both languages. If paid statuses are approved, `recordPaymentAction` and `reversePaymentAction` gain the recompute **together** — the code comment at `finance/payments/actions.ts:1010` names this requirement |
| **Verification** | Refusal proven by **server-side action replay with a working control**, per the pattern already established by `verify-delete-refusal` — a refusal test that passes because nothing was there proves nothing |
| **Migration / deploy / rollback** | No schema for the caps. Paid statuses add a status value — needs a data decision for existing rows |

### Batch 7 — HR Departments CRUD

| | |
|---|---|
| **Objective** | Departments manageable in the product |
| **Included findings** | N-3 / R-18 |
| **Dependencies** | None |
| **Effort** | **S** |
| **Acceptance criteria** | Create, edit and remove departments with the same role gates, confirm policy, dirty-form guard and recycle-bin semantics as peer modules. **Bilingual EN + Arabic with correct RTL from the first commit** |
| **Verification** | `verify:confirm-policy` and `verify:role-matrix` extended — both fail loudly on a missing Arabic string or an undeclared role gate, which is the coverage that matters here |
| **Migration / deploy / rollback** | None if the table exists; otherwise additive |

---

## Part C — New recommendations requiring approval

*Not previously agreed. Listed for a decision, not started.*

### Batch 8 — Operational visibility

| | |
|---|---|
| **Objective** | Know when the product is broken without a user reporting it |
| **Included findings** | R-12 (no health check, no monitoring, no error tracking), R-13 (backup never restored) |
| **Dependencies** | None |
| **Effort** | **M** |
| **Acceptance criteria** | A `/api/health` endpoint reporting database reachability and schema presence without leaking detail to an unauthenticated caller. An error tracker receiving server-action and route failures. **A restore drill performed and documented** — the artefact is the drill record, not the script |
| **Verification** | Health endpoint asserted for both healthy and database-down cases. Restore drill evidenced by a recovered database, not by the script's existence |
| **Migration / deploy / rollback** | New env config for the error tracker. No schema |

### Batch 9 — Customer PII encryption

| | |
|---|---|
| **Objective** | Personal data protected at rest |
| **Included findings** | R-10 |
| **Dependencies** | **Owner decision 4** — the approach determines the whole shape |
| **Effort** | **L.** The encryption is the easy half; search, sorting, import lookup and duplicate detection are the hard half |
| **Acceptance criteria** | Chosen approach implemented; client search, global search, name sorting, import lookup and duplicate detection all still work, with any narrowing (substring search lost, say) documented as an accepted consequence. Every customer row backfilled. Defined behaviour when `FIELD_ENCRYPTION_KEYS` is absent. GDPR portability export still emits plaintext |
| **Verification** | Round-trip encryption tests plus an end-to-end assertion for **each** affected read path — the risk is a silently broken search, not broken crypto |
| **Migration / deploy / rollback** | Schema + full backfill. **Rollback after backfill is not clean** — sequence and rehearse it |

### Batch 10 — Migration hygiene

| | |
|---|---|
| **Objective** | Disarm the `db:migrate` trap permanently |
| **Included findings** | F-6, R-4 (partly), **owner decision 6** |
| **Dependencies** | Batch 1 item 6 (know what production has) |
| **Effort** | **S** to delete and document; **M** to re-baseline |
| **Acceptance criteria** | Either the generated migrations reproduce the current schema from empty, or they are removed and `db:push` is documented as the only path — **with `db:migrate` removed from `package.json` either way**, so it cannot be run by habit |
| **Verification** | If re-baselined: a fresh database built by migrations alone matches one built by `db:push`, compared via `information_schema` |
| **Migration / deploy / rollback** | Tooling only; no production schema change |

### Batch 11 — Performance baseline

| | |
|---|---|
| **Objective** | Replace suspicion with measurement before engineering anything |
| **Included findings** | R-14, §6.3 |
| **Dependencies** | None |
| **Effort** | **M** |
| **Acceptance criteria** | Measured timings for dashboard aggregates, aging, statements and a large import at realistic row counts; index coverage confirmed for tenant + status + date filters. **A decision on background work taken on evidence** — the audit deliberately does not recommend a queue, because nothing has been measured |
| **Verification** | Recorded measurements, method stated, repeatable |
| **Migration / deploy / rollback** | Possibly indexes — additive and safe |

---

## Part D — Optional expansion

Only if the owner wants them; none is implied by any finding.

| Item | Note |
|---|---|
| Responsive + accessibility programme | Both currently unverified (R-19). Scope needs deciding before any claim is made about either |
| Inventory valuation and COGS | No mechanism found. **Owner decision 9** — design task, not a repair |
| Period close / period lock | No such control found. Standard in mature accounting products; absent here |
| Vendor bills and input VAT verification | Not traced by this audit; not confirmed absent either |
| ZATCA Phase 2 | **Excluded** by standing decision. The four unwired columns remain its natural home |
| Segregation of duties | **Owner decision 3.** Would need a fourth role or per-action gates |
| Unified shell / tenant, Party + PartyRole | Strategic context only. Prerequisites to weigh: the three-role model with no permissions engine, and `orgId` scoping enforced by convention rather than by the database |

---

## Sequencing

```
Batch 1  ──┬── Batch 2 (storage)
           ├── Batch 4 (CI)
           ├── Batch 6 (caps)        ← no decisions needed
           ├── Batch 7 (departments) ← no decisions needed
           └── Batch 10 (migrations) ← needs Batch 1 item 6

owner decision 2 ──► Batch 3 (reconciliation)
owner decision 5 ──► Batch 5 (proforma project)
owner decision 4 ──► Batch 9 (PII)

Batch 8 (ops) and Batch 11 (perf) are independent — schedule on appetite.
```

**Batch 1 first, and nothing in it waits on anybody.** Batches 3, 5 and 9 are
each gated on a decision that is genuinely the owner's — they are sequenced that
way deliberately rather than started on an assumption.
