# Backlog — deferred decisions

Things deliberately not done, with the reasoning that led there. The point of this file is that
nobody has to re-derive the analysis when the item comes up again. An entry here is a decision that
was made and postponed, not an idea someone had.

---

## Expense categories: preset or free text? (decide before building Expenses)

**Status:** deferred. The preset UI is hidden (see the flag in
`src/app/(app)/settings/presets/actions.ts`); the table and its rows are kept.

This is **not** "build the Expenses module and the preset starts working". The two were never
connected: `expenses.category` is a free-text column, not a foreign key to `expense_categories`, and
`expensesTable` is referenced by nothing at all. Shipping an Expenses module as the schema currently
stands would store whatever someone typed and never read the preset list.

**So the decision comes first, and it is a real one:**

1. **Categories are a preset** — add `expenses.category_id` referencing `expense_categories`,
   validate on write, and the existing preset UI becomes meaningful again (unhide the tab, flip the
   flag). Consistent reporting, but users cannot type an ad-hoc category.
2. **Categories are free text** — keep `expenses.category` as-is and **drop** the preset table and
   its UI rather than leaving them hidden. Flexible, but expense reporting groups on whatever people
   typed, including typos.
3. **Both** — free text with the preset list as suggestions. Most forgiving, most work, and the
   reporting story needs deciding anyway.

Only after that is settled does building the module make sense. Whoever picks this up should treat
the hidden preset as evidence of an unmade decision, not as a half-built feature.

---

## Load testing at realistic volume — and re-tuning the loading placeholders against it

**Status:** deferred, not started. Blocks nothing today, but one shipped feature is currently
tuned against numbers that do not represent production.

Every route in the `(app)` group was measured with seeded data during the loading-placeholder work:
all 46 landed **under 150ms**, the dashboard slowest at 147ms. That is the entire empirical basis
for the placeholder system, and it is thin. Under those timings the placeholders essentially never
appear, which means **they are untested in the only conditions they exist for** — a remote
database, cold starts, and tenants with real volume. A skeleton tuned on 147ms data is a guess
about a three-second list.

**What to test:** seed 10k+ documents, clients, products and journal lines for one org and re-run
the route timings, ideally against a non-local database so network latency is included.

**What to re-check first, once those numbers exist:**

1. **The delay threshold.** `DELAY_MS` in `src/components/ui/skeleton.tsx` is 150ms. If real lists
   settle at one to three seconds, the threshold is doing nothing useful and should be reconsidered
   — and the ~134ms-visible flash measured for a response landing just after the threshold may look
   very different when responses cluster elsewhere.
2. **Whether the column shapes still hold.** The shape assertion compares the placeholder's column
   count to the list's `<TableHead>` count, which is volume-independent — but row height and the
   number of skeleton rows were chosen to look right against a short list.
3. **Whether delay-only is still the right rule.** A minimum visible duration is impossible for a
   route-level `loading.tsx` (React unmounts the fallback as soon as the payload arrives). If real
   timings make the tear-away flash common, the answer may be to move list loading into a client
   transition where a hold *is* possible — a real design change, not a tuning change.

---

## Remaining untranslated modules

**Status:** deferred, not started. Distinct from the chart-of-accounts naming work, which is scoped
to account names only.

The project convention is that every UI string ships with native Arabic from the outset. Three
areas predate or escaped that and are substantially English regardless of the selected locale:

| Module | Notes |
|---|---|
| Security Center | Flagged in the features audit as substantially English. |
| Compliance Center | Same. |
| Vendors | Every field label in `purchasing/vendors/vendor-form.tsx` is a raw string — "Name", "Email", "Address", "Notes" — and the list/page chrome around it follows. |

**Vendors has a wrinkle worth knowing before picking this up.** The in-document "Add New Vendor"
popup reuses the full-page `VendorForm`, so the popup's own chrome (title, buttons, discard
confirmation) is translated while the fields inside it are not. Translating the popup alone would
make that split worse, not better — the fix has to touch the full-page form, which is why it was
not folded into the in-document creation task. Doing it means adding a `locale` prop to
`VendorForm` and updating both call sites.

---

## Structured addresses for vendors

**Status:** deferred, not started. Not a blocker for anything currently shipped.

`customers` carries structured address fields — `countryCode`, `stateProvince`, `district`, `city`,
`buildingNumber`, `additionalNumber` (Saudi National Address secondary identifier), `postalCode`,
`streetAddress` — alongside a retained single-line `address`. `vendors` has only the single-line
`address`. So a vendor's address renders as one line on purchase orders, debit notes and their PDFs,
where a client's renders structured.

**Why it was not done as part of in-document vendor creation.** It is not required for it. The
in-document creation pattern is a dialog wrapping the module's own existing form plus an inline
action that returns the record; none of it touches the address shape. The shared party selector was
already built to accommodate the difference — `PartySelectCustomer` in
`src/app/(app)/sales/_shared/party-card.tsx` marks the structured fields optional with the comment
*"so vendors (which lack the structured address) still fit"* — and `PartyEditDialog` already runs
with `kind="vendor"`, passing the structured fields as empty strings.

**The shape it should take when it is done.** Follow what `customers` already did rather than
inventing something new: add the structured columns as nullable, and **keep** the existing
`address` column for rows that predate them. Do not attempt to parse existing values into
components — "Building 4, King Fahd Rd, Riyadh 12345" cannot be reliably decomposed, and a lossy
parse silently corrupts vendor records that nobody will re-check. `customers.address` carries the
comment *"Legacy single-line address kept for existing clients; the structured fields below are
preferred"*, which is the precedent. That makes this a dual-write period, not a migration, and the
read path has to handle both for as long as unmigrated rows exist.

**Scope when picked up:** schema columns, vendor form rework, the party card's vendor branch, the
PO/DN PDF address block, and a decision about whether existing vendors are ever backfilled by hand.

---

## `verify-vendor-inline` flaked once in a full browser-tier run

**Status:** observed once, not reproduced. Filed rather than ignored because an *intermittent* red
erodes a runner exactly as effectively as a permanent one — it teaches people to re-run and see,
which is the habit that makes a failing suite unreadable.

On the first full `npm run verify:browser` after the tier was repaired, this suite failed at 54s;
it passes in 23–24s alone and passed in the very next full run (23/23). Playwright's log names the
cause: a Radix dialog overlay —

```
<div data-state="open" aria-hidden="true" class="fixed inset-0 z-50 …"> intercepts pointer events
87 × waiting for element to be visible, enabled and stable
```

So a dialog's closing animation was still covering the page when the next click was attempted. The
suite waits with fixed `waitForTimeout` values, which is fine until the machine is busy — and a
full tier run is exactly when it is busy, which is why it only appeared there.

**Fix when picked up:** replace the fixed waits around dialog open/close in this suite with a wait
on the overlay actually detaching (`locator('[data-state="open"]').waitFor({ state: "detached" })`
or Playwright's auto-waiting on the target rather than a sleep). Worth auditing the other
dialog-driving suites for the same pattern while there — `verify-confirm-e2e`, `verify-dirty-core`
and `verify-proforma-payments` all click through dialogs on fixed timeouts.

---

## Customer advances — RESOLVED, and the Saudi advance-VAT question is now answered too

**Status:** the accounting-placement defect and the conversion revenue bug are **fixed and
verified** (the seven "Advances (n/7)" commits), and **partial allocation** replaced the
whole-payment model on top of them (the nine "Allocations (n/9)" commits — see the section below).
The Saudi advance-VAT questions are now **answered**, and the work they unlock is **blocked on
Phase 2 e-invoicing** rather than on an accountant.

**What was implemented:**

- **`2300 Customer Advances`** (liability, credit-normal, system) — «دفعات مقدَّمة من العملاء» —
  in `DEFAULT_CHART_OF_ACCOUNTS` for new orgs and seeded into existing ones by
  `scripts/migrations/2026-08-12-customer-advances-account.ts` (idempotent; never touches a
  user-created 2300).
- **Advance receipts post `Dr Bank / Cr 2300`** — never AR (a proforma never created a
  receivable), never revenue (cash receipt is not revenue recognition). `payments.kind`
  discriminates `advance_receipt` / `advance_refund` from ordinary payments.
- **The conversion revenue bug is fixed:** an invoice born partially_paid/paid from a proforma
  with advances never passed through Send, so its revenue/AR/VAT never posted and its stock never
  decremented. Conversion now posts the shared invoice journal (`prepareInvoicePosting`)
  transactionally for any invoice born non-draft, idempotent by the `(sales_invoice, id)` journal
  identity; a foreign proforma with no usable rate refuses to convert (FX-6 rule, one-click fetch
  seam). Advance-free conversions still post at Send — one posting moment per path.
- **Advance application:** one journal per applied payment, `(advance_application, payment.id)` —
  `Dr 2300` at the advance's carried base value, `Cr 1100` at the invoice's booked rate, the
  difference derived to `4900` (FX-7's construction; no second FX model), the closing application
  derived so a fully-advanced invoice lands at `basePaidAmount === baseTotal` exactly. §10 cap in
  document currency; a payment that does not fit stays unapplied (`salesInvoiceId` null) as the
  customer's available advance.
- **Refunds:** `refundAdvanceAction` (owner/admin) posts `Dr 2300 / Cr Bank` at the carried value
  for one available receipt in full, linked by `payments.refundsPaymentId` (double-refund
  structurally impossible).
- **Statements** read 1100 AND 2300 with one sign rule (the balance column is the customer's net
  position), distinct line types (advance receipt / application / refund) and an
  "Advance available" figure; AR Aging remains invoice-only, so advances can never show as
  negative receivables. Balance Sheet / P&L pick 2300 up through the normal account machinery.
- **Historical audit** (`scripts/migrations/2026-08-12-customer-advances-audit.ts`): read-only by
  default, reports **two populations separately** — (A) converted invoices missing their revenue
  journal, (B) unapplied advance receipts credited to 1100 that belong in 2300 — and `--apply`
  repairs only rows with a provable, unambiguous journal shape (everything else to a printed
  manual-review list; idempotent, transactional, never duplicates cash/revenue/VAT, never touches
  stock). **Run the dry run against production before and after deploying**, and run the 2300 seed
  migration first.

---

### RESOLVED — Saudi advance VAT: both questions answered YES, and the work is BLOCKED ON PHASE 2

Both questions are answered. Nothing in the code changes yet, and `advance_vat_on_receipt` stays
**OFF for every profile including Saudi Arabia** (pinned by `verify-registration-currency`) —
because the implementation cannot be built to spec ahead of Phase 2 e-invoicing. See the dependency
below.

**1. Does receiving a customer advance create the VAT tax point in Saudi Arabia? — YES.** VAT
becomes due at the earliest of the supply date, the tax-invoice date, or **receipt of
consideration**, and then only to the extent of the amount received (Article 23, GCC VAT Agreement
as adopted by KSA). An advance against a taxable supply cannot sit VAT-free in 2300 until final
invoicing.

**2. Must a VAT-bearing tax document be issued when the advance is received? — YES.** A Tax Invoice
is required for the advance for standard-invoice customers; a Simplified Tax Invoice at the earlier
of supply date or receipt for simplified-invoice customers (Article 53, VAT Implementing
Regulations).

**The accounting shape** for a VAT-inclusive SAR 10,000 advance at 15% (VAT = 10,000 × 15/115):

```text
Dr Bank                      10,000.00
Cr Customer Advances (2300)   8,695.65
Cr VAT Payable (2100)         1,304.35
```

**§9's invariant CHANGES.** Today GL 2300 equals the base-currency carried value of all remaining
available advances. Under advance VAT, 2300 would hold the **net** advance liability — the VAT
portion is already owed to ZATCA and lives in 2100. Every assertion of the §9 invariant
(`verify-advances` invariant L, `verify-credit-note-release`, `verify-advance-clear`) is written
against the current definition and would have to be restated, not merely re-run.

**Open design questions for that phase — not for this one:**

- **Scope condition.** This applies only where the money is genuinely consideration in advance for
  a **taxable supply**. A refundable security deposit may need different treatment; exempt and
  out-of-scope supplies differ.
- **Rate selection.** Which rate to extract when a proforma carries mixed or zero-rated lines.
- **Refunds.** A refunded advance needs a credit note against the advance tax invoice, reversing
  VAT already recognised.
- **VAT return.** Advance tax invoices must appear without double-counting the final invoice.
- **Customer type.** Standard versus simplified decides the document, so the customer record needs
  that distinction.
- **The offsetting mechanism is already specified, not to be designed.** Pre-Paid amount (BT-113)
  equals the sum of Prepayment VAT Category Taxable Amount (KSA-31) and Prepayment VAT Category Tax
  Amount (KSA-32), with advance-adjustment amounts rounded to two decimals. It is implemented to
  spec.

**DEPENDENCY — advance VAT depends on Phase 2 e-invoicing.** Those fields live in the invoice XML,
so the offsetting mechanism cannot be built to spec before Phase 2 exists. Sequence it after, not
alongside.

Until then the code keeps behaving exactly as the non-VAT model — and does: advances post no VAT
anywhere, and the future posting's location is documented in `recordPaymentAction`'s proforma branch
(a `Cr 2100` line carved out of the receipt entry, gated by `profileHasFeature`).

## Partial advance allocation — SHIPPED (Allocations 1/9 … 9/9)

**Status:** shipped and verified. `advance_applications` is the record of what an advance settles;
`advance_application_releases` records partial releases of those allocations. `payments.salesInvoiceId`
is no longer the applied-marker for advance receipts.

**§11 — the cancellation lifecycle, documented explicitly because it is not obvious.**

Cancelling or deleting a proforma touches **neither the pot nor its allocations**. An advance that
outlives its proforma stays in 2300 as a liability — neither erased nor recognised as revenue —
and remains:

- **refundable**, in whole or in part, through the payment-history Refund dialog (owner/admin), and
- **applicable** to any other invoice for the **same customer** in the **same currency**.

The reasoning: cancellation is a *document* event, the money is a *ledger* fact. The customer paid;
until that money is returned or consumed, the business owes them goods or cash, and 2300 is where
that obligation lives. A converted proforma is read-only history, and refunds stay available on it
precisely because a §10 excess advance lives there. `verify-advances` asserts the excess refunds
cleanly from a converted proforma.

**Deletion rules that follow from it:** an advance receipt with any ACTIVE allocation refuses
deletion (it stands behind a posted invoice's `basePaidAmount`); a refunded receipt refuses deletion
while its refund exists (delete the refund first, which restores the advance); a released allocation
never disappears — `releasedAt` marks it and the release row records what went back, to whom and
why.

---

## DEPLOY RUNBOOK — the two advance migrations, whose orderings are OPPOSITE

Both migrations ship in the same phase and **their deploy orders are mirror images**. Getting either
backwards is silent, and one of them is a one-way door. Read both rows before running either.

| | `2026-08-16-advance-applications-backfill.ts` | `2026-08-17-clear-advance-sales-invoice-id.ts` |
|---|---|---|
| **Order** | schema → **backfill** → deploy code | deploy code → **clear** |
| **Why that order** | The backfill CREATES the allocation rows the new code reads. Run it *after* the code is live and every already-applied advance reads as **fully available** until the backfill catches up — a **double-spend window**: the same money can be applied twice. | The readers must ALREADY be reading allocations before the field goes null. Clear first and deployed code reads `salesInvoiceId`, finds nothing, and reports **advance-applied 0**, a payment history missing rows, project costing missing advance cash — wrong figures, silently. |
| **Failure mode** | double-spend (loud in the ledger, eventually) | wrong figures (silent) |
| **Reversible?** | yes — allocation rows can be deleted and re-derived from the journals | **NO. One-way door.** The field's value is not recoverable once null. |
| **Guard** | rows with ≠1 application entry go to a printed manual-review list, no mutation | REFUSES while any advance receipt has the field set and **no allocation row** — see below |

**The clear's refusal, and what to do about it.** An advance receipt with `salesInvoiceId` set and
no allocation row records its applied-ness in exactly one place: the field about to be erased.
Clearing it destroys the fact with no record anywhere. So the script counts that population first,
**refuses and reports if it is non-zero, and exits 2**.

> A non-zero count means **run the backfill first**. It does not mean force the clear. There is no
> force flag, deliberately.

**Recommended sequence, end to end:**

1. `npx tsx … 2026-08-12-customer-advances-account.ts` — seed 2300 if this org predates it.
2. `npx tsx … 2026-08-12-customer-advances-audit.ts` — read-only; repair only what it calls
   repairable, review the rest.
3. `npm run db:push` — `advance_applications` + `advance_application_releases` (additive).
4. `npx tsx … 2026-08-16-advance-applications-backfill.ts` — dry run, then `--apply`.
5. **Deploy the application code.**
6. `npx tsx … 2026-08-17-clear-advance-sales-invoice-id.ts` — dry run (expect a zero refusal count
   after step 4), then `--apply`. `--org N` rolls it out one tenant at a time.
7. **`npm run db:harden`** — install the append-only triggers on `audit_logs` and `security_events`.
   In a browser SQL console instead, paste `drizzle/immutable_audit.sql` whole.

Steps 4, 6 and 7 are all idempotent; re-running any of them finds nothing to do.

**Step 7 in the same terms as the two migrations:**

| | |
|---|---|
| **What it does** | Creates `reject_mutation()` and two BEFORE UPDATE/DELETE triggers that raise an exception, so `audit_logs` and `security_events` become append-only **at the database level** — a compromised application account, or anyone holding app-DB credentials, can no longer rewrite history. |
| **Reversible?** | Yes — `DROP TRIGGER audit_logs_immutable ON audit_logs;` (and the same for `security_events_immutable`). Nothing about the data changes, so there is no one-way door here. |
| **Correct output** | `DB hardening: installed audit_logs_immutable, security_events_immutable.` On a second run: `already present, re-applied cleanly`. |
| **Verification** | `select tgname from pg_trigger where tgname in ('audit_logs_immutable','security_events_immutable');` must return **two rows**. The stronger check is the effect: `update audit_logs set action='x' where id = (select id from audit_logs limit 1);` must fail with `Table audit_logs is append-only; UPDATE is not permitted`. |
| **Where in the order** | **Last — after the code deploy AND after the clear.** Not because it depends on them, but so the three cannot be confused: if the deploy or the clear goes wrong, the failure is theirs and the trigger is not yet in the picture. It is also the only step that can be run at any later time with no sequencing consequence. |
| **Why it is a step at all** | It was a checklist line in `docs/security/infrastructure.md` and had been ticked nowhere: **production was checked and neither trigger existed**. `npm run db:push` now chains `db:harden`, so a fresh database cannot come up without it, and `verify:db-hardening` fails the standard gate when they are absent. |

**Deploy the phase WHOLE — steps 5 is not divisible.** The switch to allocation-keyed application
journals happens in Allocations 3/9; the statements reader that resolves them is fixed in 8/9.
Deploying 1–7 without 8 puts production in the one configuration that breaks client statements:
new applications write allocation-keyed entries while attribution still resolves them as payment
ids, so those lines vanish from statements — or, where an allocation id collides with a payment id,
land on an unrelated party. There is no partial-deploy story here; ship 1–9 together.

**Why step 5 sits between them safely:** every migrated reader produces the SAME figure before and
after the clear — advance receipts are excluded from the `salesInvoiceId` path and read through
allocations instead — so the window between deploy and clear is not a degraded state.
`verify-advance-clear` asserts statement, project-costing and payment-history figures across the
clear rather than trusting the ordering.

### A THIRD migration, whose ordering is the mirror image again — and read this before running it

`scripts/migrations/2026-08-18-bank-opening-balance-journals.ts` posts the opening-balance journal
entry for bank accounts created before opening balances were journalized.

| | `2026-08-16-advance-applications-backfill.ts` | `2026-08-18-bank-opening-balance-journals.ts` |
|---|---|---|
| **Order** | schema → **backfill** → deploy code | **deploy code** → backfill |
| **Why that order** | The backfill CREATES the rows the new code reads. Code first ⇒ every applied advance reads as fully available until it catches up ⇒ **double-spend**. | The code REMOVES a render-time addition. Backfill first ⇒ for the window between them the entry exists AND the page still adds the column ⇒ the bank page shows **double** the true figure. |
| **What the window looks like** | correct figures, wrong availability | 60,000 on a 30,000 account |
| **What the other order's window looks like** | double-spend | **0** on a 30,000 account |

**Why the zero is the better window, which is the whole reason the orders differ.** 60,000 is a
plausible number. Someone can read it, believe it, and act on it — pay a supplier, sign off a
reconciliation — and nothing about the screen says it is mid-migration. 0 on an account that
obviously holds money is self-evidently broken: nobody acts on it, and the person who sees it asks.
**Understated and obviously broken beats overstated and believable.** For a single account on a
single tenant this is a couple of minutes of a zero.

Three migrations in this project now have deploy orders chosen for three different reasons. There is
no house rule to memorise, and that is the point: the order follows from what the intermediate state
looks like to a user, and you have to work it out each time. If you are reading this tired, the
question to ask is *"what does the screen say in between, and would somebody believe it?"*

| | |
|---|---|
| **Detection** | non-zero `bank_accounts.opening_balance` AND no `(source_type='bank_opening', source_id=<bank account id>)` entry. The second condition IS the idempotency key — a re-run after a successful apply matches nothing. |
| **Why the PAIR** | `source_id` comes from a different table per source type, each with its own sequence, so the same integer is a live id in several at once. An id-only check finds an unrelated `payment` entry and skips a real posting. `verify-bank-opening-backfill` seeds that exact collision. |
| **Date** | `opening_date` when set, otherwise the account's `created_at` date — printed as "inferred" in the output when it had to fall back. |
| **Contra** | `3000 Owner's Equity` by default; `--equity-account <code>` to override. |
| **Reversible?** | Yes. Delete the `bank_opening` entries and their lines; the column they were derived from is untouched. |
| **Refusals (all exit non-zero, nothing written)** | a GL account missing, inactive or not an asset; a contra account that does not exist or is not equity/liability; a foreign-currency bank account (the ledger is base-only and the script will not guess a rate); and — the important one — a `bank_opening` entry that already exists carrying a **different** amount than the column says. That last one means the column was changed after the entry was posted: a **changed** fact rather than a missing one, and picking a winner between two figures is a human's job. |
| **Correct output** | dry run prints each entry it would post, both sides named, and writes nothing. `--apply` prints a ledger bracket per posting — the account's balance and the org's Dr/Cr totals before and after — then `Remaining candidates: 0`. A second `--apply` prints `Nothing to do.` |

**Sequence:** `npm run db:push` (adds `opening_date`, `opening_contra_account_id`) → **deploy the
application code** → dry run → `--apply` → confirm the bank page, Trial Balance and Balance Sheet
agree for the account.

---

## Credit notes on a CASH-paid invoice still drive AR negative (high priority)

**Status:** unfixed, deliberately out of scope for the allocation phase. This is the same defect
class 2300 exists to eliminate, reached through a door the credit-note release rule does not open.

A credit note releases advance allocations back to 2300, capped at the over-settlement AND at the
active allocations behind the invoice. Where an invoice was settled in **cash**, there is no
allocation to release, so the note's `Cr 1100` stands alone:

```text
invoice 10,000 paid in cash, credit note 2,000
  → GL 1100 = −2,000 for that customer, while they genuinely hold 2,000 of value
  → getReceivableAging computes total − paid = −2,000, hits `if (outstanding <= 0) continue`,
    and DROPS the invoice from aging entirely
  → control account says −2,000, aging subledger says 0
```

**The consistent answer is 2300**: value the customer holds with us is a liability regardless of
whether it arrived as an advance or as an over-credit. Adopting it changes **non-advance**
credit-note behaviour and the tests that pin it, which is why it is its own decision rather than
something smuggled into the allocation phase.

The credit-note **cap** (Σ active notes ≤ invoice total, shipped in Allocations 6/9) bounds the
damage but cannot reach this: a 2,000 note on a fully cash-paid 10,000 invoice is entirely within
the cap.

---

## A credit note converted at ITS OWN date's rate — RESOLVED, and it uncovered the next item

**Status:** FIXED. Both the credit note and its debit-note twin now inherit the source document's
stored `exchangeRate` and post no 4900 line. `src/lib/reversal-currency.ts` holds the rule for both;
`verify-note-fx` asserts it.

### What it was

`issueCreditNoteAction` converted through `captureBaseAmounts({ date: cn.issueDate })`. But a credit
note **moves no cash**: it reverses part of an invoice whose AR *and revenue* were both booked at
that invoice's stored rate, so clearing them at a different rate invented a difference that never
happened. `purchasing/debit-notes/actions.ts` had the identical construction against its PO.

The AR tail was a control-account residual — the document-currency balance reached zero while GL
1100 kept a base-currency remainder, and ledger and subledger agreed because both were wrong
together, which is why no invariant caught it. **The revenue tail was the serious half:** crediting
100% of a foreign invoice did not return base revenue to zero, leaving a phantom FX gain inside
4000 where no FX account could explain it.

Measured, against a USD invoice booked at 3.80 and credited in full at 3.90 — the failing suite was
committed first so the numbers exist in the history:

```
4000  -3,800.000 → +100.000     (residual 100.000, inside revenue)
1100  +4,370.000 → -115.000     (residual -115.000, uncleanable)
1200  +3,040.000 →  -80.000     (the debit-note twin)
```

After the fix all three go to exactly `0.000`.

### One deliberate behaviour change worth knowing about

A note dated **before the org's first exchange-rate row used to block**. It no longer does: the rate
comes from the source document and the rate table is never consulted, so such a note now issues
correctly. That was an artefact of converting at the note's own date, and removing it is an
improvement rather than a regression. `verify-fx-posting` asserts the new behaviour explicitly.

`missingRate` — the structured seam behind the one-click rate-fetch affordance — is deliberately
**not** returned by these two paths any more, while four other posting paths still return it. There
is no rate for a note to fetch: the answer is on the source document or the operation is refused.

### Population

Dev database at the time of the fix: **0** issued credit notes on foreign invoices, **0** issued
debit notes on foreign purchase orders (126 of each exist, all base currency, where the old and new
paths produce identical figures). So the fix was forward-only with no migration.

**Production is a separate question.** Run these before deploy; a non-zero result means posted
history carries a phantom revenue residual and needs a repair decision, not a migration written on
spec:

```sql
select count(*) from credit_notes cn join sales_invoices i on i.id = cn.source_invoice_id
 where cn.status='issued' and i.currency is not null
   and upper(i.currency) <> upper((select currency from orgs o where o.id = cn.org_id));

select count(*) from debit_notes dn join purchase_orders po on po.id = dn.source_purchase_order_id
 where dn.status='issued' and po.currency is not null
   and upper(po.currency) <> upper((select currency from orgs o where o.id = dn.org_id));

select count(*) from credit_notes cn join sales_invoices i on i.id = cn.source_invoice_id
 where cn.status='issued' and cn.exchange_rate is not null and i.exchange_rate is not null
   and cn.exchange_rate <> i.exchange_rate;
```

---

## Partial notes crediting an invoice in full strand a minor unit (found by the note-FX sweep)

**Status:** open, out of scope for the note-FX fix by decision. **Real, and in shipped posting
math** — not a test artefact and not something to tune away.

Once notes inherit the source rate, a FULL note nets its invoice to exactly zero. Several PARTIAL
notes that together credit the same invoice do not: each is rounded on its own, so their base
amounts can sum to something other than the invoice's base total.

Measured by `verify-note-fx`'s sweep (b) — 25 rate/amount pairs, each split three ways:
**17 strand, every one by exactly ±0.01.** Both directions. Examples:

```
rate 3.75130000  total 333.33     3 partials sum to 1,250.430, whole is 1,250.420   (+0.010)
rate 0.26700000  total 333.33     3 partials sum to    89.010, whole is    89.000   (+0.010)
rate 17.94910000 total 99,999.99  3 partials sum to 1,794,909.810, whole is 1,794,909.820 (-0.010)
```

The consequence is the same *kind* of uncleanable AR residual the FX defect produced, one fil
instead of a hundred: an invoice credited in full across three notes ends at ±0.01 in GL 1100.

**The codebase already has the discipline for the analogous case and it is simply missing here.**
A closing PAYMENT uses `baseTotal − basePaidAmount` — the exact remainder — rather than a fresh
proportional conversion, and `releaseShareOf`'s `full` branch does the same for advances. The note
path has no equivalent: every note converts proportionally, including the one that closes the
invoice out.

**The fix, when it is picked up:** on the note that CLOSES the source document — cumulative
document-currency credits reaching the total — the base amount is the exact remainder
(`source.baseTotal − Σ base of prior active notes`) rather than a fresh conversion.

**Why it was not done in the same change.** The credit note already computes `alreadyCredited`
inside its lock for the cap, so the sibling aggregate is nearly free there. The debit note has no
cap, no sibling aggregate and no paid-amount tracking against the PO, so it would need that
machinery built — and the rule must land on both types together, exactly as the FX fix did, or the
next person finds one half fixed and the other not. That is a design decision with its own edges
(reversed notes, interaction with the cap), not a rounding tweak.

**Do not relax `verify-note-fx`'s sweep (b) to make the gate green.** It is measuring the defect
correctly. It fails on purpose until the closing-note rule lands.

---

## Project costing omits an entire revenue path: proformas have no `projectId` (high priority)

**Status:** unfixed, pre-existing, and silently wrong in production today.

`proforma_invoices` has **no `projectId` column at all**, and `convertProformaToInvoiceAction` never
sets one on the invoice it creates. So **every invoice born from a proforma belongs to no project**,
and project cost control under-reports revenue for any project whose work came through a proforma —
which, for a business that quotes and takes advances, is the normal path rather than the exception.

This is not a rounding difference or a display gap: it is a **cost-control report that omits an
entire revenue path**, the kind of thing discovered by someone quietly not trusting a number.

The allocation work is careful not to make it worse: project cash-in now reads applied advances
through allocations (Allocations 8/9), which counts a manually applied advance against a real
project invoice correctly. Converted invoices are unchanged — still no project — because the gap is
upstream of anything allocations can see.

**The fix needs a decision, not just a column:** add `projectId` to proformas and carry it through
conversion, and decide whether existing converted invoices are backfilled (from what? the proforma
has no project either) or left as history. Treat the backfill question as part of the task.

### Underneath it: the revenue line has no stated definition

Worth settling in the same task, because the column alone will not answer it. The report's revenue
block reads quoted → confirmed → invoiced → **received** → outstandingReceivable, and the two
possible meanings of "received" diverge exactly where advances live:

- **cash collected against this project's INVOICES** — what the arithmetic commits to, since
  `outstandingReceivable = invoiced − received` is only coherent under this reading; or
- **cash received FOR this project** — what the label "Received Payments" suggests, and what a
  business owner reading a cost-control screen is likely to assume.

They differ by the **unapplied advance balance**: money in the bank for this project's work, which
the report cannot attribute to a project at all, because it lives on a proforma and proformas carry
no project. Allocations 8/9 made the figure match the first definition for the first time (see the
numbers in that commit's report); it did not, and could not, give the report the second.

**Recommendation when this is picked up:** the arithmetic is the binding definition — rename the
line to say "collected against invoices", or add a separate advances-held figure once proformas
carry a project. What should not survive is a label that implies one definition over arithmetic that
implements the other.

## Two Saudi-shaped defaults in `seedOrgDefaults` (pre-existing, not fallout)

**Status:** deferred, not started. Both predate the multi-currency work and are unchanged by it.

Registration now asks for a country and the seeded tax preset follows it (15% Saudi Arabia, 5% UAE,
0% "Standard Tax" for the Global profile). That fix was in scope because asking the question is what
made the hardcoded rate visible. These two were audited at the same time, found to be the same
shape, and deliberately left alone — **they were already wrong before the change and are wrong in
exactly the same way after it.** Whoever picks this up is fixing an old defect, not cleaning up.

**1. `2100 VAT Payable` is seeded for every org.** `DEFAULT_CHART_OF_ACCOUNTS` gives every new
organization a VAT Payable liability account, including one whose country profile has
`taxSystem: "None"`. Harmless — nothing posts to it unless tax is charged — but confusing: an
account named for a tax the org does not levy sits in its chart of accounts forever, and it is a
system account, so it cannot be removed. Fixing it means making the seeded chart depend on the
profile, which is a larger change than the tax preset was: the chart is referenced by code
(`eq(accountsTable.code, "2100")`) in the posting paths, so an org without the account needs those
paths to handle its absence rather than assume it.

**2. Leave types seed Saudi Labor Law minimums.** `Annual 21` and `Sick 10` are the statutory
minimums in Saudi Arabia, seeded for every org in every country. This is the more consequential of
the two: it is a **compliance-shaped default in a module nobody has audited**, so a UAE or German
org starts with entitlement numbers that look authoritative and are not theirs. Unlike the VAT
account, this one is directly visible to whoever configures HR, and being silently wrong about
statutory leave is worse than being obviously absent.

**The decision when picked up:** either make leave types country-dependent (which needs leave
entitlement data per country — real research, not a lookup we already have), or seed nothing and
require the org to enter its own, which is honest but adds setup friction. Seeding one country's
statutory minimums globally is the option that should not survive contact with the question.

---

## ESLint does not pass, and a third of the failures are now tracked code

**Status:** deferred, not started. Not urgent; the point is that it stops being ignorable.

`npm run lint` reports **118 problems (76 errors, 42 warnings)**, none of them in `src/`. By
directory: `scratchpad/` 49, `verify/` 10, `scripts/` 5, `tests/` 2, the remainder warnings.

What changed is `verify/`. Until commit `6890e16` the suites lived in a gitignored folder, so their
lint failures were nobody's problem. They are tracked code now, and a tracked file that does not
lint is a different thing from a scratch file that does not.

**Why this matters more than the count suggests.** A lint run nobody can pass clean is a signal
people learn to ignore, and once it is ignored it stops catching what it exists for. The project's
standing rule is that ESLint must pass; today the honest version of that rule is "ESLint must not
get *worse*" — which is a rule no one can check mechanically.

**The decision, and it is a real one:**

1. **Fix them** — the `verify/` ten are mostly unused variables and a few `any`s, and the
   `scripts/`/`tests/` seven are similar. Then `npm run lint` is a gate again.
2. **Scope the config** — add `scratchpad/` (already gitignored) to `eslint.config.mjs`'s ignores,
   and decide deliberately whether `verify/` is held to `src/`'s standard or a looser one. A test
   suite is allowed to be scrappier than production code; that is a defensible position, but it
   should be written down rather than emerging from nobody looking.

Option 2 alone leaves tracked code unlinted. Option 1 alone leaves the run permanently dirty from
`scratchpad/`. The likely answer is both, in that order.

---

## Two verification suites report a verdict with no check count

**Status:** deferred, not started. Small, and worth doing before the suite count grows further.

`verify-client-import.mts` and `verify-import.mts` end with `CLIENT IMPORT VERIFICATION PASS` /
`QUOTATION IMPORT VERIFICATION PASS` and no `N/N checks` line. Every other suite prints a count.

**Why a word is worse than a number.** A count is comparable across runs: 339/339 becoming 338/339
is visible, and so is 339 becoming 12 because half the file stopped executing. A verdict compares
to nothing — it reads identically whether the suite ran forty assertions or four. This project has
already lost a work cycle to suites that reported nothing and were taken as passing, and to numbers
recalled instead of run; a suite whose output cannot be diffed against its own last run is a smaller
version of the same blind spot.

**Scope when picked up:** give both suites the `results` array and tail block the other ten already
use, so `verify:all` prints twelve comparable numbers instead of ten and two words. No assertion
changes — this is about what the run reports, not what it checks.

---

## Per-module and custom role permissions

**Status:** deferred, not started. This is a known gap, currently documented in the product rather
than fixed.

Access is decided by three idioms and there is no permissions engine: `requireRole(...)`, an inline
`if (session.role === "staff")`, and the document lifecycle rule matrix. Roles are fixed —
owner, admin, staff — and cannot be edited or extended.

**The consequence, stated plainly because it is a sales objection and not an accident.** Sales and
Finance have no role checks at all below the module level. Staff can void invoices, issue credit and
debit notes, receive purchase orders, record payments, and post manual journal entries — all of
which post to the ledger. The Roles & Permissions panel now says so directly rather than implying a
restriction that does not exist (`src/lib/role-matrix.ts`, rendered by
`settings/organization/reference-panels.tsx`).

**Why it was not narrowed as part of correcting that panel.** Deciding which of those capabilities a
staff member should lose is a product design question with real consequences for existing customers'
workflows, and it needs a permissions model to express the answer. Tightening a few individual
actions inside a copy fix would have produced an arbitrary line nobody had agreed to.

**What protects the current state meanwhile:** `scratchpad/verify-role-matrix.mts` asserts the
declared matrix against the guards in the code in both directions, so a gate added or removed
without updating the matrix fails the check.

---

## Credit and debit notes do not inherit their source document's currency

**Status: RESOLVED** in the FX-4 currency-inheritance audit (commit cbfab25): all ten conversion
actions and the PO prefill now carry the source currency, CN/DN inherit their source document's
currency in create/update/forms, and verify-fx-posting exercises foreign CN/DN issue at stored
rates. Kept for the trail.

**Sequel, still open:** the note inherits the source document's CURRENCY but not its **rate** — it
converts at its own issue date, which invents an FX difference on a reversal that moves no cash. See
"A credit note converts at ITS OWN date's rate" above; same two files, and the fix is the same
shape (inherit the stored figure rather than re-deriving it). Originally: open, found while making rounding currency-aware (FX-0). Not fixed there, because it is
a behaviour change to what a document *is*, not a rounding fix.

`credit_notes` and `debit_notes` both carry a `currency` column, and nothing ever writes it. The
forms display `org.currency` and the actions round at `session.orgCurrency`, so a credit note is
always treated as being in the organization's base currency.

**The consequence:** a credit note raised against a USD invoice is recorded as though it were in the
base currency. The number is copied across unchanged, so the credit is wrong by the exchange rate —
not by a rounding step. Today every document is effectively base-currency so nothing is visibly
broken, but this becomes a real defect the moment FX-6 posts a foreign invoice.

**The fix** is that a note inherits the currency of the document it reverses — an invoice's for a
credit note, a purchase order's for a debit note — and that the inherited value is not editable,
since a reversal in a different currency from the thing it reverses is not meaningful. Belongs with
FX-1b (locking currency once a base amount is stored), which is where the same "this field is now
fixed" machinery lands.

---

## `payments` has no currency column

**Status: RESOLVED** by FX-7 (commits 8519736..62c1311): payments carry currency, exchangeRate,
baseAmount, baseAppliedAmount and rateSource, written at posting, with realized FX to 4900 and
basePaidAmount maintained everywhere. Kept for the trail. Originally: **Status:** open, found while making rounding currency-aware (FX-0). In scope for FX-7.

A payment row records an amount with no statement of what currency it is in. The amount is
implicitly in the source document's currency, and the journal lines post it to the ledger
**unconverted** — so a payment against a foreign invoice writes a foreign number into a
base-currency ledger.

FX-0 rounded the two sides correctly for what they are (the document's currency for `paidAmount`,
the base currency for the journal lines) and left the missing conversion alone: converting at
payment time is exactly the FX-7 question, and the answer determines whether the column stores the
payment's own currency plus a rate, or only a base amount.

---

## ZATCA output sits in the GENERIC invoice path with no country condition (high priority)

**Status:** open. The UI half was corrected in the claims-cleanup commit; the OUTPUT half was not,
deliberately, because closing it changes behaviour.

**The leak.** `print/[type]/[id]/page.tsx` computes the TLV, persists `qrCodeData` + `invoiceHash`
and renders the QR for **any non-draft sales invoice**, with no country condition and no check of
`orgs.zatcaPhase1Enabled`. `sales_invoices` carries four ZATCA columns (`invoiceType`,
`qrCodeData`, `invoiceHash`, `previousInvoiceHash`) for every org in every country.

**The gate exists but guards the wrong thing.** `enableZatcaPhase1Action` is properly country-gated
(`profileHasFeature(profile, "zatca_phase1")`, Saudi only) — it just controls a flag that no invoice
code reads. So the country condition protects a record, while the actual Saudi-specific output is
ungated.

**AFTER THE CLEANUP COMMIT THE LEAK IS ASYMMETRIC — read this before starting.** The dashboard card
and the invoice e-invoice panel are now gated on the country profile, so a non-Saudi org sees
nothing about ZATCA in the interface. Its printed invoice PDFs still carry a ZATCA QR. That is the
better direction to be wrong in (nothing is claimed to the user), but it means the UI has already
moved and only the output is left. Do not assume the two are still in the same state.

**What closing it means.** Put the QR behind the same gate: country profile, and probably
`zatcaPhase1Enabled` too. Note the consequence that made it a separate task — **a Saudi org that
never enabled the flag would lose the QR it prints today**, which is a behaviour change needing a
decision (backfill-enable existing Saudi orgs? gate on country only?). 4 of 818 orgs here have the
flag set; 4 invoices carry a QR.

**Then the same treatment per country.** UAE, Bahrain and Oman are each moving on e-invoicing at
their own pace, and each will want its own module behind its own profile feature. Whether Phase 2
is "one country's module" or "a fork of the invoice engine" is decided by whether this leak is
closed first — with it open, every country's rules accumulate in one print route.

**Phase 2, described correctly.** ZATCA Phase 2 (Integration) is **wave-based**: ZATCA notifies
taxpayers individually, in waves defined by taxpayer-specific revenue thresholds, each with its own
integration date. There is **no single blanket deadline** by which all VAT-registered businesses
above one revenue figure became mandatory — do not write one into this file, a screen, or a commit
message. A product asserting a blanket legal deadline is the same class of error as a product
asserting compliance it does not have.

---

## Customer PII is stored in plaintext (high priority)

**Status:** open. Surfaced by the compliance-claims cleanup, which removed a screen that said
otherwise. Removing the false label did not close the gap.

**What is encrypted today:** exactly two columns, `users.mfaSecret` and `users.mfaRecoveryCodes`,
via `encryptField` (AES-256-GCM, versioned key ring, rotation-capable). That is the whole of
application-layer encryption.

**What is not:** every customer record — `customers.name`, `email`, `phone`, `address`, plus vendor
and employee equivalents. They sit in plaintext in the database, so anyone with a database dump or
app-DB credentials reads them directly. Transport is encrypted and disk-level encryption may exist
at the infrastructure layer, but neither is what "encryption at rest" is usually taken to mean by
someone reading a security page.

**Why this is not a one-liner — start here rather than rediscovering it.** An encrypted column
cannot be searched. Client search, the global search bar, sorting by name, `LIKE`-based lookups in
imports, and duplicate detection all query these columns directly. Encrypting them naively breaks
every one of those. The two known routes:

1. **Deterministic blind index.** Store a keyed HMAC of a normalised form alongside the ciphertext
   and query the index for equality (and prefix, with careful tokenisation). Exact and prefix lookup
   keep working; substring search does not, without a token index. Deterministic values leak
   equality — two customers with the same email are visibly the same — which is usually acceptable
   for this data and must be a conscious decision, not an accident.
2. **A separate unencrypted display/search column.** Keep a reduced form (display name only, no
   contact detail) in plaintext for listing and search, encrypt the rest. Simpler, and it concedes
   that the name itself is not protected — which may be the honest trade, since a customer list is
   visible throughout the product anyway.

**Also to decide:** what happens to existing rows (a backfill that re-writes every customer row),
what happens when `FIELD_ENCRYPTION_KEYS` is absent in a dev environment (today `encryptField`
throws — `encryptionConfigured()` exists precisely so callers can degrade), and whether exports and
the GDPR portability JSON emit plaintext (they must, which means the export path decrypts).

**Do not start this as a labelling fix.** It is a data-model change with a search redesign attached.

---

## The append-only audit trigger was written and never installed (security gap)

**Status:** open. Found while adding a live check to the readiness screen. This is a real security
gap, not a labelling one — filed separately from the claims cleanup that surfaced it.

`drizzle/immutable_audit.sql` creates BEFORE UPDATE/DELETE triggers on `audit_logs` and
`security_events` that raise an exception, so even a compromised application account cannot rewrite
history. **In the development database, neither trigger exists** — `pg_trigger` returns no
non-internal triggers at all. The protection is written and unapplied.

**What installs it, and what does not:**

| path | installs the trigger? |
|---|---|
| `npm run db:push` (drizzle) | **No.** Drizzle pushes the schema; this file is separate SQL. |
| `scripts/restore.sh:50` | **Yes** — a restored database gets it automatically. |
| Fresh deploy | **A human checklist item only**: `docs/security/infrastructure.md:84` lists "`drizzle/immutable_audit.sql` applied; `UPDATE audit_logs` is rejected" as a manual box to tick. |
| `tests/security/crypto-policy.test.mjs:55` | Reads the FILE and asserts its contents — it does not check whether the trigger is installed anywhere. A test pinning the artefact, not the state. |

**PRODUCTION WAS CHECKED: the triggers are ABSENT.** The query below returned **no rows** against
production — neither `audit_logs` nor `security_events` carries an immutability trigger. The control
was written, committed, reviewed, covered by a test that reads the file, and installed in no
environment that matters. A confirmed absence is a stronger fact than an unknown, and it is the
whole argument for putting the install in the deploy path rather than in a document:

```sql
select tgname from pg_trigger where tgname in ('audit_logs_immutable','security_events_immutable');
```

**Installing it against an existing database is safe**, on the evidence available: the script is
idempotent (`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` before each `CREATE TRIGGER`), it
only adds triggers, and a grep across `src/` and `scripts/` finds **no UPDATE or DELETE anywhere**
against `audit_logs` or `security_events` — so nothing in the application would start failing. The
one thing to confirm before running it in production is that no retention or pruning job deletes
audit rows on a schedule; none exists in this repository.

**RESOLVED IN THE TOOLING, still to be run against production.** `npm run db:push` now chains
`npm run db:harden` (`scripts/apply-db-hardening.ts`), so a fresh database cannot come up without
the triggers, and `verify:db-hardening` — part of the standard `verify:server` gate — fails when
they are missing. The script is Node + `pg` rather than a `psql` invocation on purpose: `psql` is not
installed on every machine or CI image that can run this app, and a hardening step that silently
no-ops where the client binary is missing would reproduce the original failure in a new costume.
The allocation phase's runbook carries it as step 7. **What remains is running it against
production**, which the runbook now sequences.

**The original direction, kept because the reasoning is the point: the install belongs in the DEPLOY
PATH, not on a checklist.** A control that depends on
someone remembering to tick a box is not a control, it is a hope — and the evidence here is that the
box went unticked. Make it run with the schema push (or immediately after it) so a fresh database
cannot come up without it, and have the
readiness screen keep asking (it now does — the control reads `pg_trigger` live and shows "Not
detected in this deployment" when the trigger is absent, which is how this was found).

---

## Compliance Center asserted certifications the product does not hold — RESOLVED

**Status: RESOLVED** in the compliance-claims cleanup. Kept for the trail, because the shape recurs.
Originally: found during the ZATCA audit, out of that commit's scope — a **stronger** claim than any
of the ZATCA wording.

**What shipped:** the screen is now "Security & Compliance Readiness", an internal checklist that
states plainly it is not a certification. The blanket "Compliant" pill is gone; the SOC 2 card is
gone (its four controls were real, the trust-services mapping was not — they are listed under
"Platform security", unmapped); ISO 27001 is labelled **roadmap**, with no "in progress" or
"pursuing certification" wording, since no programme and no external audit has started. **No control
is hardcoded satisfied**: each is `implemented` (present in this codebase), `live` (the deployment
was actually asked — field encryption and the audit trigger), or `informational` (the product cannot
see the state, e.g. backup execution). Both languages, and `verify-compliance-claims` asserts the
claims absent — including the structural check that no group renders a full-marks badge, which is
how the claim could return through a data change rather than a wording change.

**The finding that mattered most:** "Encryption of personal data at rest (AES-256-GCM)" covered
exactly two columns — `users.mfaSecret` and `users.mfaRecoveryCodes`. Customer names, emails,
addresses and phone numbers are stored in **plaintext**. That was a false statement about a security
property, not an overstated capability. The label is fixed; **the gap it described is not**, and it
has its own entry: see "Customer PII is stored in plaintext" above. It is filed separately on
purpose — a resolved entry reads as done and nobody opens it.

`settings/compliance/compliance-client.tsx` shows a green **"Compliant"** pill and three framework
cards — **GDPR**, **ISO 27001**, **SOC 2** — with twelve controls between them.

**Two distinct problems, and the second is the serious one:**

1. **All twelve controls are hardcoded `done: true`.** The list is a literal in the component; no
   control is evaluated against the deployment. The screen therefore **cannot ever show anything
   but compliant**, whatever the actual state of the installation — the same "a screen asserting a
   posture the code does not check" shape as the ZATCA panel.

2. **Two of the three are CERTIFICATIONS, not self-assessments.** GDPR is a regulation an
   organization can reasonably assess itself against, and the four controls listed under it do map
   to shipped features. **ISO 27001 and SOC 2 are issued by accredited auditors after a formal
   audit.** Displaying them as satisfied is not overstating a capability — it is asserting a
   credential that does not exist. That is a materially different claim from "our QR is ZATCA
   Phase 1 shaped".

**Direction when picked up:** keep the control inventory (it is a genuinely useful map of shipped
security features), drop the framework branding and the blanket pill, or re-title it as an internal
readiness checklist that names what is implemented without claiming an external standard is met.

---

## ZATCA Phase 1 QR carries a FABRICATED timestamp

**Status:** open, found in the ZATCA audit. Sibling of the currency defect below — same three lines
of code, same persisted-artefact problem, deliberately filed as two bugs because the fixes differ.

`src/app/print/[type]/[id]/page.tsx` builds tag 3 (timestamp) as:

```ts
timestamp: `${inv.issueDate}T00:00:00Z`
```

That is a DATE at midnight UTC, not the invoice's issue date-time. Two consequences:

- It states a time the invoice was not issued at — every invoice claims 00:00:00Z.
- For a KSA seller (UTC+3) it lands on the **wrong day** at the boundary: an invoice issued on the
  5th at 01:00 local is 4 August 22:00 UTC, and this encodes `2026-08-05T00:00:00Z` regardless.

`sales_invoices` stores `issueDate` as a DATE, so the fix needs a source for the time — either a
posting timestamp (`createdAt` is the closest existing field) or a new column — plus the same
decision the currency defect needs about invoices whose TLV is already persisted.

---

## ZATCA QR encodes document-currency figures on foreign invoices

**Status:** open, found during FX-6 (posting-time capture), re-confirmed live in the ZATCA audit.
Reported rather than fixed, because the TLV is persisted on first print and a change here alters an
existing compliance artefact. **Sibling of the fabricated-timestamp defect above** — both are in the
same TLV construction, and whichever is fixed first should settle the regenerate-or-leave question
for the other.

The QR's tag 4 (total) and tag 5 (VAT amount) are built in `src/app/print/[type]/[id]/page.tsx`
from `inv.total` / `inv.taxTotal` rounded at the DOCUMENT's currency. For a USD invoice in a KSA
org, the QR therefore encodes USD figures where ZATCA expects SAR. The correct inputs now exist —
`baseTotal` and `baseTaxAmount`, captured at posting — but two things make this a deliberate fix,
not a one-liner:

- The TLV and its hash are **persisted on first print** so reprints stay stable. Any foreign
  invoice printed before the fix keeps a wrong-currency QR permanently; the fix needs a decision
  about whether to regenerate those.
- A foreign invoice printed while still DRAFT has no base amounts at all (they are captured at
  send), so the print path needs a rule for that state.

Base-currency invoices — every production document today — are unaffected: their base figures equal
their document figures.

---

## SAMA as the KSA rate provider — fill the slot once its API doc is readable

**Status:** deferred behind the provider interface. `providerForCountry` in
`src/lib/rates/provider.ts` carries a commented-out `case "Saudi Arabia"` — that line is the whole
integration surface. Filling it is a new `RateProvider` implementation; nothing else in the fetch
engine, screen, or one-click path changes.

**Why it's deferred rather than built:** SAMA (the Saudi Central Bank) is the right source for a
KSA org that wants ZATCA-exact figures, and it visibly runs an open-data operation — but this
development environment cannot inspect it. The egress proxy returns CONNECT 403 for sama.gov.sa
(as it does for every rate API), and no public documentation seen from here proves a
machine-readable daily FX feed with a stable shape. Building a provider against an endpoint nobody
has inspected would be guesswork wearing a class definition, in the code path that feeds the
ledger.

**What was found (the trail for whoever picks this up):**

- [SAMA Open Data Portal — statistics summary](https://www.sama.gov.sa/en-US/Statistics/pages/summary.aspx) —
  the portal exists and publishes exchange-rate statistics.
- [SAMA API service document](https://www.sama.gov.sa/en-US/EconomicReports/Pages/ServiceDocument.aspx) —
  SAMA documents an API service for its published data. This is the page to actually read; it was
  unreachable from the sandbox.
- [Fluentax "SAMA exchange rates API"](https://www.fluentax.com/products/exchange-rates-api/banks/saudi-central-bank-sama) —
  a commercial vendor reselling "SAMA daily rates", which is decent evidence a consumable daily
  feed exists in some form.

**The unblock:** open the SAMA portal and the API service document from an unblocked network and
check whether it serves dated daily FX rates in a stable machine-readable shape. Delowar can open
the SAMA portal from his own machine when it matters — that is the unblock, not any code change
here. If the answer is yes, implement `samaProvider` against the documented shape (store rates
under SAMA's own bulletin date, attribution per its terms if any) and uncomment the case.

**Why nothing is waiting on this:** Saudi orgs currently use the general provider
(open.er-api.com) for convenience, and manual entry always wins over fetched rates — so an org
that needs ZATCA-exact SAMA figures today enters them by hand and no automatic fetch will ever
overwrite them. The gap costs convenience, not correctness.

---

## Payment fees: the reference dialog's "transaction charge" field — deliberately not built

**Status:** open question, deferred out of FX-7 by decision. The Refrens reference screenshot that
shaped the two-field Record Payment dialog also shows a transaction-charge field (bank fees taken
out of the received amount). FX-7 shipped without it.

Building it is an accounting decision before it is a UI one: a fee means the bank credited LESS
than the customer paid, so the entry needs a fee-expense line (Dr Bank net / Dr Bank Charges fee /
Cr AR gross) and a decision about which figure the payment row's `amount` means — gross or net —
which ripples into `paidAmount`, balances, and receipts. There is also no bank-charges expense
account in the seeded chart yet.

Meanwhile nothing is blocked: the received-amount-first design already absorbs the common case
honestly — the user types what the bank statement shows (net of FX spread), and any true FEE can
be recorded as what it is once an Expenses flow exists. Whoever picks this up should decide the
gross-vs-net question first, then the account, then the field.

---

## Bank opening balances were never journalized — the repair, and the two pieces deferred out of it

**Status:** the repair is in progress (see the commits touching `bank_accounts` opening balances).
This entry records the two decisions deliberately postponed and the sweep that bounded the work.

### What the defect was

`bank_accounts.opening_balance` was written at account creation and **no journal entry was posted**.
`finance/bank-accounts/page.tsx` rendered `Number(ba.openingBalance) + <ledger balance>`. Nothing
else in the product read the column. The Balance Sheet balanced and the Trial Balance balanced
*because the figure never entered either one* — nothing compensated for it. The general form of the
rule this violated is recorded in `verify/README.md`, under the product-invariants section: **no
display path may add a stored scalar to a ledger-derived figure.**

### The sweep — is this a class or an instance?

Run before any code was written, because a second instance would have changed a repair into a class.
**Result: one instance.** `finance/bank-accounts/page.tsx:77` is the only place in the product where
a stored master-record scalar is added to a ledger- or aggregate-derived figure.

What was searched: every `numeric` / `integer` column on a master-data table (customers, vendors,
products, projects, employees, bank accounts, orgs), every consumer of `getAccountBalances` (three:
chart of accounts, ledger, bank accounts — the first two read the ledger alone), every `+` between a
`Number(<stored field>)` and an aggregate in `src/app`, and every reader of `bankAccountsTable`
outside its own folder.

Two candidates ruled out, with the reasoning, so nobody re-opens them:

- **`products.quantity_on_hand`** — a *materialised running total*, incremented and decremented in
  the same transaction as each posting (invoice, GRN, debit note) and displayed on its own. It is
  never added to a movement-derived quantity. It has its own risk (drift between the counter and the
  movements that fed it) but it is not this one.
- **`projects.budget`** — a target displayed beside costing figures and compared against them, never
  summed into them.
- **Customers and vendors carry no numeric columns at all** — no credit limit, no stored outstanding
  balance. There was nothing to find there.

The distinguishing question, for whoever runs this sweep again after new features land, is not "is a
number stored on a master record" but **"does a render path add it to something derived"**.

### Deferred 1 — dropping `bank_accounts.opening_balance`

The column is **kept**, renamed in the Drizzle layer to `openingBalanceLegacy` (the SQL column name
is unchanged), removed from every read path, and still written at creation as an audit copy of what
the user typed. Two reasons not to drop it in the same change: it is the only surviving evidence of
what was entered before the repair, useful if a backfilled entry is ever disputed; and dropping a
`NOT NULL` column in the same change that introduces new posting logic makes rollback harder than it
needs to be.

The rename is the durable half — `ba.openingBalance` no longer exists as an identifier, so the
natural way to write the old bug does not compile — and a static assertion keeps `openingBalanceLegacy`
from appearing anywhere outside the schema file.

**The actual drop is deferred**, and it is a small reversible change once the repair has run in
production for a while: remove the field, `alter table bank_accounts drop column opening_balance`.
Do it on its own, not bundled.

### Deferred 2 — `3100 Opening Balance Equity`

**Not added.** For the production case the money is real owner capital and `3000 Owner's Equity` is
the correct and complete answer; routing it through a suspense account would misstate the books to
serve a migration concern that does not apply.

The general case is different and will want it. When an org migrates from another system, opening
balances for *many* accounts are entered together and the credits are not capital — they are the
arithmetic residue of whatever the old system's balance sheet said. `3100` exists to hold that
residue **visibly**, so that a non-zero balance in it is a signal that migration is incomplete and a
zero balance is proof the opening trial balance balanced. That netting check is the whole point of
the account.

So: **add `3100` as part of the opening-balance-import feature, together with the check that gives
it meaning** — not before. Added now it would be an account with no writer, no reader and no
invariant, plus a defaulting choice between two equity accounts that nobody could answer correctly.
