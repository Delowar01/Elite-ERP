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

## Customer advances post to Accounts Receivable, and the subledger cannot be reconciled

**Status:** open, blocked on an accountant. **Sequenced between FX-6 and FX-7** — deliberately not
part of FX-7. Do not fold it in.

Recording a payment against a proforma invoice posts **`Dr 1000 Cash / Cr 1100 Accounts
Receivable`** (`finance/payments/actions.ts`, the `sourceType === "proforma"` branch). The entry
balances, and the mechanism works correctly — this was confirmed by driving the flow by hand. The
problem is which account it lands in.

**Why AR is the wrong account.** A proforma never created a receivable: no invoice was posted, so
nothing ever debited AR for that customer. Crediting AR on the advance therefore drives that
customer's receivable **negative** for something that was never a receivable. A customer advance is
a liability — the business owes goods, not money — and conventionally belongs in Customer Deposits
or Unearned Revenue.

**The reconciliation gap, which is the proof rather than the opinion.** `getReceivableAging`
(`src/lib/finance-reports.ts`) reads **`sales_invoices` only** — proformas appear in it at no
status. So GL account 1100 and the AR aging subledger disagree by the total of all proforma
advances, and nothing in the app can explain the difference. That is a subledger that cannot be
reconciled to its control account, which is a defect rather than a stylistic preference.

**Two things to establish before anyone writes code:**

1. **Get it confirmed by an accountant.** The account structure and the reclassification-on-
   conversion mechanics deserve a professional eye; nobody on this side is one.
2. **Ask about the Saudi VAT treatment of advance payments, explicitly.** Receiving an advance may
   trigger a tax point in KSA — meaning output VAT could be due **on receipt**, not on the later
   invoice. If so, a proforma advance is not only a liability posting but also needs a VAT entry,
   which changes the design materially. Ask the question directly rather than deriving an answer
   from this codebase.

**Why it sits between FX-6 and FX-7 rather than inside FX-7:**

- Fixing account placement *after* payments store base amounts means re-posting entries that carry
  conversion data. Getting the account right first, then adding currency to a correct posting, is
  cheaper.
- FX-7 is a currency question with a clean answer once decided. This is an accounting-design
  question with a VAT dependency and an outside party in the loop. Bundling them makes the currency
  work wait on an accountant.
- Production has essentially no data — one posted journal entry and no known proforma advances. The
  migration cost is zero today and non-zero the moment a customer records an advance. Same
  free-hand argument as the base-currency lock: spend it while it is free.

**Scope when picked up:** the account (likely a new `2300 Customer Advances` liability), the
reclassification when a proforma converts to an invoice — the conversion-transfer path in
`recordPaymentAction` moves with it — whatever the VAT answer requires, and a decision about
whether advances should appear in any aging report at all.

---

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

**Status:** open, found while making rounding currency-aware (FX-0). Not fixed there, because it is
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

**Status:** open, found while making rounding currency-aware (FX-0). In scope for FX-7.

A payment row records an amount with no statement of what currency it is in. The amount is
implicitly in the source document's currency, and the journal lines post it to the ledger
**unconverted** — so a payment against a foreign invoice writes a foreign number into a
base-currency ledger.

FX-0 rounded the two sides correctly for what they are (the document's currency for `paidAmount`,
the base currency for the journal lines) and left the missing conversion alone: converting at
payment time is exactly the FX-7 question, and the answer determines whether the column stores the
payment's own currency plus a rate, or only a base amount.

---

## ZATCA QR encodes document-currency figures on foreign invoices

**Status:** open, found during FX-6 (posting-time capture). Reported rather than fixed, because the
TLV is persisted on first print and a change here alters an existing compliance artefact.

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
