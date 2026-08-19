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

## DEPLOY RUNBOOK — the three undeployed changes, as ONE schema step

Covers the credit-/debit-note FX inheritance fix, payment reversal, and the two credit-note defects
(currency display and the paidAmount inflation). They deploy together. Production is Vercel + Neon.

### 1. Every schema change, in commit order

| # | Commit | Table | Column | Type | Null | Default |
|---|---|---|---|---|---|---|
| — | `e5f294e` `4e7ae24` `3cc676d` (note-FX) | — | **none** | — | — | — |
| 1 | `7c7dc47` | `payments` | `reversed_at` | `timestamp without time zone` | YES | — |
| 2 | `7c7dc47` | `payments` | `reversed_by_id` | `integer` → FK `users(id)` | YES | — |
| 3 | `6422235` | `sales_invoices` | `credited_amount` | `numeric(15,3)` | **NO** | `'0'::numeric` |
| 4 | `6422235` | `sales_invoices` | `base_credited_amount` | `numeric(15,3)` | YES | — |

**The note-FX change added no schema at all** — verified, not assumed:
`git diff --stat e5f294e~1..3cc676d -- src/db/ drizzle/` is empty. It is code-only, so it has no
schema precondition and could deploy alone.

`00bb976` touches `src/db/schema/accounting.ts` but adds **comments only** (the `payment_reversal`
note on `sourceType`). No DDL.

The FK on `reversed_by_id` is the only constraint added: `payments_reversed_by_id_users_id_fk`.

### ⚠ A FOURTH change may be in the same bucket — confirm before deploying

`5b65a04` (bank opening balances) added `bank_accounts.opening_date` (`date`, nullable) and
`bank_accounts.opening_contra_account_id` (`integer`, nullable, FK `accounts(id)`). It is **not** in
the three-change list above. If that work is already live, ignore this. If it is NOT, it goes out in
the same push and **its data step has a different ordering** — see the entry above: schema first as
usual, but its BACKFILL runs *after* the code deploy, not before. Check with the query in §2.

### 2. Has production got them? The repo carries no evidence either way

Nothing in this repository records what Neon has. `drizzle/` holds generated migrations only up to
`0004_wooden_christian_walker.sql` (11 Aug) and **none of these columns appear in any of them** —
this project has been on `drizzle-kit push` as its sole schema path since well before this work.

Run this against Neon. Every expected column is listed, so a MISSING one shows as a missing row
rather than having to be inferred from a short result:

```sql
select t.table_name, t.column_name,
       c.data_type, c.is_nullable, c.column_default
  from (values
        ('payments','reversed_at'),
        ('payments','reversed_by_id'),
        ('sales_invoices','credited_amount'),
        ('sales_invoices','base_credited_amount'),
        -- the possible fourth change; drop these two lines if bank opening balances are already live
        ('bank_accounts','opening_date'),
        ('bank_accounts','opening_contra_account_id')
       ) as t(table_name, column_name)
  left join information_schema.columns c
         on c.table_schema = 'public'
        and c.table_name = t.table_name
        and c.column_name = t.column_name
 order by t.table_name, t.column_name;
```

**Reading it:** six rows come back either way. A row whose `data_type` is NULL is a column that
**does not exist in Neon**. All six non-null ⇒ the schema is already applied and `db:push` will be a
no-op.

### 3. Deployment order — SCHEMA FIRST, and it is not a judgement call

| | Does the NEW code need the column to exist? | Does the OLD code break if it exists? |
|---|---|---|
| `payments.reversed_at` / `reversed_by_id` | **Yes.** The payment-history query selects `reversedAt`, and `reversePaymentAction` writes both. Missing ⇒ `column does not exist` on every invoice/PO/proforma detail page that renders payment history. | **No.** Nullable, and no old query names them. |
| `sales_invoices.credited_amount` / `base_credited_amount` | **Yes.** The invoice detail page, AR aging, the dashboard receivables sum, `recordPaymentAction`, `issueCreditNoteAction` and the advance path all select or write them. Missing ⇒ errors on the invoice page, the AR report and the dashboard. | **No.** `credited_amount` is `NOT NULL DEFAULT 0`, so old INSERTs that omit it still succeed; Drizzle emits explicit column lists, so old SELECTs never name either. |

**So: `npm run db:push` MUST complete before the Vercel deploy.** Both directions are settled by the
table — the new code cannot run without the columns, and the old code is indifferent to them. The
window between push and deploy is therefore safe in a way the advance and bank-opening windows were
not: nothing reads or writes these columns until the new code is live.

This is a *different reason* from the three orderings already in this document, and worth stating so
a fourth is not assumed by analogy:

- advance backfill — `schema → backfill → deploy` because the backfill CREATES rows the code reads;
- advance clear — `deploy → clear` because readers must move off the field before it goes null;
- bank opening — `schema → deploy → backfill` because backfill-first shows a believable wrong number;
- **this one — `schema → deploy`, because the columns are purely additive and nothing populates them
  retroactively.** There is no data step at all.

**Do not reach for `npm run db:migrate`.** The generated migrations are stale by months and contain
none of these columns; `db:migrate` would report success having applied nothing, and the deploy
would then fail against missing columns. `db:push` is the only path that works here.

### 4. Backfill — NOT required, and the reason is worth understanding

The obvious worry is that `credited_amount` defaults to 0 while legacy rows still carry the old
inflated `paidAmount`, leaving outstanding wrong until repaired. **It does not.** Measured against
190 existing invoices carrying issued credit notes:

```
invoices with an issued credit note                 190
outstanding identical under old and new formula     184   (every row where credited_amount = 0)
credited_amount still zero                          184
```

The arithmetic: the old identity was `outstanding = total − paidAmount`, where `paidAmount` already
absorbed the credit. The new one is `total − paidAmount − creditedAmount`. For a legacy row
`creditedAmount` is 0, so the two are **the same expression** and the figure does not move. Status,
the payment balance check and the release's over-settlement all follow the same reasoning and are
likewise unchanged for legacy rows.

**What legacy rows DO keep is the display defect**: "Paid" still shows payments-plus-credits and the
new "Credited" row shows nothing, until a credit note is issued against that invoice under the new
code. Nothing regresses; the old rows simply keep looking as they did.

Given production is pre-live test data with a reset planned, no repair is proposed. To size it there
first (read-only):

```sql
with pay as (select sales_invoice_id id, coalesce(sum(amount),0) paid
               from payments where sales_invoice_id is not null and reversed_at is null group by 1),
     cns as (select source_invoice_id id, coalesce(sum(total),0) credited
               from credit_notes where status='issued' group by 1)
select count(*) as invoices_with_issued_cn,
       count(*) filter (where abs(i.paid_amount - (coalesce(p.paid,0) + c.credited)) < 0.005)
         as paid_still_carries_credit_value,
       count(*) filter (where i.credited_amount > 0) as already_on_the_new_channel
  from sales_invoices i
  join cns c on c.id = i.id
  left join pay p on p.id = i.id;
```

A non-zero middle column is the population whose **Paid display** is inflated. It is not a
correctness problem for any balance, report or status — only for that one figure on screen.

### 5. What else runs

`npm run db:push` is `drizzle-kit push && npm run db:harden`, so the append-only audit triggers are
re-applied automatically. Correct output on an already-hardened database:

```
DB hardening: already present, re-applied cleanly (audit_logs_immutable, security_events_immutable).
```

Nothing else chains off it, and there is no migration script to run for this deploy.

### Sequence

1. Run the §2 query against Neon. Note which columns are missing.
2. `npm run db:push` against production (applies the columns, re-applies the audit triggers).
3. Re-run the §2 query — all six rows non-null.
4. Deploy to Vercel.
5. Spot-check: an invoice detail page, the AR aging report, the dashboard, and one payment history.
6. Only if the bank-opening change is also going out: run its backfill **after** the deploy, per its
   own entry above.

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

### One deliberate behaviour change worth knowing about — it changes a user-visible refusal

Anyone who documented "a credit note dated before your first exchange rate cannot be issued" should
update it. A note dated **before the org's first exchange-rate row used to block**. It no longer does: the rate
comes from the source document and the rate table is never consulted, so such a note now issues
correctly. That was an artefact of converting at the note's own date, and removing it is an
improvement rather than a regression. `verify-fx-posting` asserts the new behaviour explicitly.

`missingRate` — the structured seam behind the one-click rate-fetch affordance — is deliberately
**not** returned by these two paths any more, while four other posting paths still return it. There
is no rate for a note to fetch: the answer is on the source document or the operation is refused.

### PRE-DEPLOY PRODUCTION CHECK — six queries, each with a positive control

Run these in the Neon console before deploying. They are the exact statements that were run against
the development database, not a reconstruction — paste the whole block and read the ten rows it
returns.

**Why each zero-expecting query has a control beside it.** Four of the six expect zero. A zero from a
query whose join does not match anything is indistinguishable from a real zero, and that is not a
hypothetical here: this project has already shipped a check that compared 0 to 0 and reported
"unchanged" while every row it claimed to be watching was being rewritten. Each control uses the
**same joins and the same filters** with the condition inverted, so a non-zero control proves the
query reaches real rows and its zero is a result rather than an absence. **If a control returns 0,
stop — the query is not measuring anything and its neighbour's zero means nothing.**

```sql
-- Q1
select 'Q1  issued CNs on FOREIGN invoices                 (expect 0)' as check, count(*) as n
  from credit_notes cn
  join sales_invoices i on i.id = cn.source_invoice_id
  join orgs o on o.id = cn.org_id
 where cn.status = 'issued'
   and i.currency is not null and upper(i.currency) <> upper(o.currency)
union all
select 'Q1c CONTROL — same join, BASE-currency invoices    (expect > 0)', count(*)
  from credit_notes cn
  join sales_invoices i on i.id = cn.source_invoice_id
  join orgs o on o.id = cn.org_id
 where cn.status = 'issued'
   and (i.currency is null or upper(i.currency) = upper(o.currency))
union all
-- Q2
select 'Q2  issued DNs on FOREIGN purchase orders          (expect 0)', count(*)
  from debit_notes dn
  join purchase_orders po on po.id = dn.source_purchase_order_id
  join orgs o on o.id = dn.org_id
 where dn.status = 'issued'
   and po.currency is not null and upper(po.currency) <> upper(o.currency)
union all
select 'Q2c CONTROL — same join, BASE-currency POs         (expect > 0)', count(*)
  from debit_notes dn
  join purchase_orders po on po.id = dn.source_purchase_order_id
  join orgs o on o.id = dn.org_id
 where dn.status = 'issued'
   and (po.currency is null or upper(po.currency) = upper(o.currency))
union all
-- Q3
select 'Q3  issued CNs whose stored rate <> the invoice''s  (expect 0)', count(*)
  from credit_notes cn
  join sales_invoices i on i.id = cn.source_invoice_id
 where cn.status = 'issued'
   and cn.exchange_rate is not null and i.exchange_rate is not null
   and cn.exchange_rate <> i.exchange_rate
union all
select 'Q3c CONTROL — same join, rates EQUAL               (expect > 0)', count(*)
  from credit_notes cn
  join sales_invoices i on i.id = cn.source_invoice_id
 where cn.status = 'issued'
   and cn.exchange_rate is not null and i.exchange_rate is not null
   and cn.exchange_rate = i.exchange_rate
union all
-- Q4
select 'Q4  issued DNs whose stored rate <> the PO''s       (expect 0)', count(*)
  from debit_notes dn
  join purchase_orders po on po.id = dn.source_purchase_order_id
 where dn.status = 'issued'
   and dn.exchange_rate is not null and po.exchange_rate is not null
   and dn.exchange_rate <> po.exchange_rate
union all
select 'Q4c CONTROL — same join, rates EQUAL               (expect > 0)', count(*)
  from debit_notes dn
  join purchase_orders po on po.id = dn.source_purchase_order_id
 where dn.status = 'issued'
   and dn.exchange_rate is not null and po.exchange_rate is not null
   and dn.exchange_rate = po.exchange_rate
union all
-- Q5 / Q6
select 'Q5  issued CNs, ALL currencies                  (informational)', count(*) from credit_notes where status = 'issued'
union all
select 'Q6  issued DNs, ALL currencies                  (informational)', count(*) from debit_notes where status = 'issued'
order by 1;
```

### How to read each result

| Query | Expected | If it is not that | Blocks deploy? |
|---|---|---|---|
| **Q1** issued credit notes on foreign invoices | **0** | Each row is a posted credit note converted at its own date against an invoice booked at a different one. It carries a phantom FX gain or loss **inside revenue** (GL 4000) and an uncleanable tail on AR (GL 1100). Run the drill-down below, then decide per row. | **No — but do not deploy without deciding.** The fix is correct going forward either way; these are historical postings it does not touch. |
| **Q2** issued debit notes on foreign POs | **0** | Same, on 2000/1200 instead of 1100/4000. | Same as Q1. |
| **Q1c / Q2c** the controls | **> 0** | **STOP.** A zero control means the join matched nothing at all, so Q1/Q2's zero is meaningless. Check that the org has any issued notes before believing anything in this table. | **Yes.** |
| **Q3** credit notes whose stored rate ≠ the invoice's | **0** | Direct evidence of the defect in stored data — a note that recorded a different rate than the document it reverses. Strictly narrower than Q1: see the coverage note. | No, but it is the strongest signal in the set. Investigate before deploying. |
| **Q4** debit notes whose stored rate ≠ the PO's | **0** | Same, purchasing side. | Same as Q3. |
| **Q3c / Q4c** the controls | **> 0** | **STOP**, as above. | **Yes.** |
| **Q5 / Q6** issued notes, all currencies | any | Informational — the denominator. If both are 0, the org has never issued a note and Q1–Q4 are trivially zero for a reason that has nothing to do with this fix. | No. |

**A non-zero Q1 or Q2 is a repair decision, not a migration.** Do not write a backfill on spec. The
right response depends on how many rows there are and whether the periods they fall in are still
open: a handful in an open period is cleanest corrected with adjusting journal entries; a large
population needs a plan of its own. Bring the drill-down output back before writing anything.

### Coverage caveat on Q3 and Q4 — read this before trusting their zeros

Q3 only sees rows where **both** the note and its source carry a stored rate. A note whose
`exchange_rate` is null — anything issued before FX-6 — is invisible to it, and so is its source.

**`Q3 + Q3c` is exactly the number of rows Q3 can see at all.** In the development database that is
21 out of 148 issued credit notes: the other 127 have no stored rate on either side. So a zero from
Q3 means "nothing disagrees *among the rows that have both figures*", not "nothing disagrees".
**Q1 is the broader check and Q3 is the sharper one; neither substitutes for the other.**

### Drill-down, if Q1 or Q2 returns a non-zero

A count cannot tell a real row from a test fixture, and cannot tell you how bad a row is. This lists
them with both rates, so the size of each discrepancy is visible:

```sql
select cn.id, cn.credit_note_number, o.name as org, i.invoice_number,
       i.currency as doc_currency, o.currency as base_currency,
       i.exchange_rate::text  as invoice_rate,
       cn.exchange_rate::text as note_rate,
       cn.total::text as note_total,
       cn.base_total::text as note_base_total,
       round(cn.total * i.exchange_rate, 3)::text as base_total_it_should_have_had
  from credit_notes cn
  join sales_invoices i on i.id = cn.source_invoice_id
  join orgs o on o.id = cn.org_id
 where cn.status = 'issued'
   and i.currency is not null and upper(i.currency) <> upper(o.currency)
 order by cn.org_id, cn.id;
```

The purchasing equivalent, written out rather than described — a swap done by hand at 2am is how a
query ends up joining the wrong column:

```sql
select dn.id, dn.debit_note_number, o.name as org, po.po_number,
       po.currency as doc_currency, o.currency as base_currency,
       po.exchange_rate::text as po_rate,
       dn.exchange_rate::text as note_rate,
       dn.total::text as note_total,
       dn.base_total::text as note_base_total,
       round(dn.total * po.exchange_rate, 3)::text as base_total_it_should_have_had
  from debit_notes dn
  join purchase_orders po on po.id = dn.source_purchase_order_id
  join orgs o on o.id = dn.org_id
 where dn.status = 'issued'
   and po.currency is not null and upper(po.currency) <> upper(o.currency)
 order by dn.org_id, dn.id;
```

In both drill-downs the last column is the figure the note **should** carry — the note's document
total at the *source's* rate. Where it equals `note_base_total`, that row is already correct and
needs nothing. Where it differs, the gap is the misstatement, in base currency, per note.

### What the development database returned — and why it is NOT a clean read

```
 Q1  issued CNs on FOREIGN invoices                 (expect 0)   |   4
 Q1c CONTROL — same join, BASE-currency invoices    (expect > 0) | 144
 Q2  issued DNs on FOREIGN purchase orders          (expect 0)   |   4
 Q2c CONTROL — same join, BASE-currency POs         (expect > 0) | 144
 Q3  issued CNs whose stored rate <> the invoice's  (expect 0)   |   0
 Q3c CONTROL — same join, rates EQUAL               (expect > 0) |  21
 Q4  issued DNs whose stored rate <> the PO's       (expect 0)   |   0
 Q4c CONTROL — same join, rates EQUAL               (expect > 0) |  21
 Q5  issued CNs, ALL currencies                  (informational) | 148
 Q6  issued DNs, ALL currencies                  (informational) | 148
```

**The four are verification fixtures, not data.** They are the `FXCNE-*` / `FXDNE-*` notes that
`verify-fx-posting` creates, in orgs named `FX Posting SAR`, and the drill-down shows their note
rate equal to their invoice rate (3.70 = 3.70) — which is the fix working, not the defect. Every
browser-tier run adds more of them, so **this number climbs on its own and a dev-database count is
not evidence of anything.** An earlier reading of the same queries returned 0/0 simply because the
suites had not been run yet.

Production has no such orgs, so its counts are real. This is recorded because a future reader
running these locally will get a non-zero and should not conclude the product is broken.

The useful signal from the dev run is the pair **Q3 = 0 with Q3c = 21**: among every note that
carries both figures, the stored rate matches its source's. Post-fix, that is what correct looks
like.

---

## Partial notes crediting a source in full stranded a minor unit — RESOLVED

**Status:** FIXED, both note types, in the same change. Found by `verify-note-fx`'s sweep (b) the
moment the FX inheritance fix made that sweep able to measure rounding rather than the FX defect.

### What it was

Once notes inherit the source rate, a FULL note nets its source to exactly zero. Several PARTIAL
notes that together reverse the same source did not: each rounded on its own, so their base amounts
summed to something other than the source's base total. Measured across 25 rate/amount pairs split
three ways — **17 stranded, every one by exactly ±0.01, in both directions:**

```
rate 3.75130000  total 333.33     3 partials sum to     1,250.430, whole is     1,250.420  (+0.010)
rate 0.26700000  total 333.33     3 partials sum to        89.010, whole is        89.000  (+0.010)
rate 17.94910000 total 99,999.99  3 partials sum to 1,794,909.810, whole is 1,794,909.820  (-0.010)
```

Uncleanable in the same way the FX residual was: no payment settles it, no allocation consumes it,
it sits on the control account permanently. One fil instead of a hundred, identical in kind.

### The rule, which already existed everywhere else

**The note that CLOSES its source takes the exact remainder** — `source.baseTotal − Σ base of prior
active notes` — rather than another proportional conversion. Not a new rule: a closing PAYMENT
already posts `baseTotal − basePaidAmount`, and `releaseShareOf`'s `full` branch does the same for
advances. Notes were the one path that stayed proportional all the way through.

It stands down in three cases, each for a stated reason rather than for convenience: the note does
not close the source; the source carries no stored base figures; or a prior note predates conversion
so the sum already consumed is unknown — subtracting an incomplete total would produce a confident
wrong remainder, which is worse than a fil.

That last guard is load-bearing and easy to get wrong: `sum()` skips nulls **silently**, so a legacy
note shrinks the prior total and makes the remainder too large. The action counts unconverted
siblings with `count(*) filter (...)` alongside the sums, and `verify-note-fx` asserts that SQL
against real rows — a short sum plus a flag that says "do not trust it".

### The debit-note half — scoped before it was built, as asked

The gap named when this was filed ("no cap, no sibling aggregate, no paid-amount tracking") conflated
three things. The closing rule needs only **one** of them:

- a **sibling aggregate** — one SELECT over `debit_notes`, the exact mirror of the credit note's;
- a **`for update` lock on the purchase order** — not for the rate, which is immutable once received,
  but so two concurrent notes cannot both read the same prior total and both take the whole remainder.

It needs **neither the cap nor paid-amount tracking**. Those are separate features the debit note
still lacks. Net cost: the debit note's pre-transaction read moved inside a locked transaction, plus
the aggregate — a small mirror, which is why both types landed together as instructed.

### Still open, and NOT fixed here

**A debit note can exceed its purchase order.** Credit notes are capped against the invoice; debit
notes have no equivalent, so cumulative returns can pass the PO's value. The closing rule declines
to act when the cumulative total *overshoots* rather than lands, so it neither helps nor worsens
this — but it is a real gap and it is now the only asymmetry left between the two note paths.

### Sweep (b) after the fix

`0 strand(s)` across all 25 pairs, issued in sequence so each note sees what the ones before it
consumed. Passing NO_PRIOR to all three would have hidden the closing rule entirely and measured a
situation the product cannot produce.

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

---

## Payment reversal — what the investigation found before it was built

Recorded because three of these findings contradict what everyone (including the brief) believed,
and two of them constrain what the feature can assert.

### `deletePaymentAction` was never hidden — it has a button, on the screen in question

The premise going in was that delete is a server action with no rendered caller: reachable by anyone
who can craft the request, invisible to users and reviewers. **That is not the case.**

`DeletePaymentButton` is rendered by `finance/_shared/payment-history.tsx` whenever `canDelete` is
true, and both callers pass it:

```
sales/invoices/[id]/page.tsx:121   (role owner|admin) && invoice.status !== "void"
sales/proforma/[id]/page.tsx:129   (role owner|admin) && pf.convertedInvoiceId == null
```

It reads as absent because it is a bare `Trash2` icon in an **unlabelled 8-px column**
(`<th className="w-8" />`) with no header text — `aria-label="Delete"` and nothing else.

It is not merely present but **exercised end-to-end by a passing suite**: `verify-payment-fx.mjs`
navigates to `/sales/invoices/{id}`, clicks `getByLabel("Delete")` in a payment row, confirms
"Delete Payment", and asserts the invoice un-pays from stored figures (4312.50 → 2812.50, status
`partially_paid`, journal entry gone).

**So the problem was never a missing undo. It was that the undo destroys history** — `delete`
already un-pays correctly from stored figures and restores status, then hard-deletes the payment row
and its journal entry and lines. Reversal replaces those semantics rather than filling a gap.

The lesson worth keeping: *"there is no UI for X"* is a claim about rendering, and rendering is
conditional. Grep for the component, not just the action.

### Three payment populations, and what each one's undo is

| Payment | Posts | Reversal covers | Delete after this change |
|---|---|---|---|
| Ordinary sales-invoice payment (`kind IS NULL`, `salesInvoiceId`) | Dr Bank / Cr AR / ±4900 | **yes** | **refused server-side** |
| Ordinary purchase-order payment (`kind IS NULL`, `purchaseOrderId`) | Dr AP / Cr Bank / ±4900 | **yes** | **refused server-side** |
| Proforma advance receipt (`kind = 'advance_receipt'`) | Dr Bank / Cr 2300 | no | **kept, unchanged** |

Delete stays for proforma advance receipts deliberately. `refundAdvanceAction` is **not** a
substitute for deleting a mistyped receipt: a refund means money left the bank, so "record a receipt
that never happened, then refund it" books two false cash movements instead of correcting one. That
stranding is real and stays open — see the entry below.

### Purchase orders have no paid status, and this is where that bites

`purchase_orders.paidAmount` and `.basePaidAmount` exist and are byte-identical in type to the
invoice's, and the closing-payment derivation (`baseTotal − basePaidAmount`) is the same
construction. **The status set is not symmetric:**

```
sales_invoices.status   draft | sent | partially_paid | paid | void
purchase_orders.status  draft | ordered | received | cancelled
```

`recordPaymentAction`'s PO branch confirms it behaviourally — it sets `paidAmount`,
`basePaidAmount`, `updatedAt` and nothing else. **Paying a PO in full leaves it `received`.**

So a spec line reading "reversing the payment leaves the PO partially paid" cannot be met: that is
not a state the product can express. Reversal mirrors the write path — it changes no PO status —
and the suite asserts `received` *before and after*, so the absence is pinned rather than merely
unobserved. There is a comment at the exact site in the action where the status recompute would go.

### DEFERRED — give purchase orders paid statuses

**Status:** open, wanted, not done. The spec line above is legitimate and currently unmeetable.

Adding `partially_paid` / `paid` to purchase orders is not a column change; it is a lifecycle
change, and the blast radius is:

- `document-lifecycle.ts` `RULES.purchase_order` — new states, and a decision about which actions
  each permits. `received` currently allows `duplicate` and `reverse`; a paid PO probably should not
  allow `reverse`, mirroring the invoice rule that a settled document is corrected by a note.
- `recordPaymentAction`'s PO branch and `reversePaymentAction`'s PO branch — both start recomputing
  status, with the document's own epsilon.
- Status badges, list filters, saved views, and any status-keyed column config.
- `verify-role-matrix` and `verify-confirm-policy` drift checks, plus every suite asserting a PO
  status string.
- A backfill decision for existing rows: a fully-paid `received` PO would need moving to `paid`, or
  the new states apply only going forward and the two populations disagree.

Whoever picks it up should decide the `reverse`/`void` permission question **first** — it is the
part that changes behaviour rather than presentation.

### The base-currency column, and the ambiguity it would have shipped

The PO history was asked to show a base-currency amount. The invoice history showed none, so the
column was added to the **shared** component instead — rendered only when the document's currency
differs from base, so base-currency organizations see no change.

A payment carries **two** base figures that differ by exactly the realized FX gain or loss:

- `baseAmount` — the cash that actually moved through the bank;
- `baseAppliedAmount` — what cleared AR or AP, at the document's booked rate.

For payment 1 on the INV-0008 fixture those are **1,140.00** and **1,125.00**. A single column
labelled "SAR" would be read as whichever the reader assumed, and both readings are defensible.

Resolved as: show the **cash** figure, because a payment history answers "what moved through the
bank", and label it by DIRECTION — `Received (SAR)` on a sales-invoice history, `Paid (SAR)` on a
purchase-order one. One shared label cannot be correct for both directions, and the component
already knows which it is rendering. `baseAppliedAmount` is deliberately not shown beside it: a
second number reintroduces the same ambiguity in reverse, and the clearing figure's proper home is
the ledger, where the 4900 line explains the difference.
