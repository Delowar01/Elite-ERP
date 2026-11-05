# ACC-01 — inventory valuation and cost of goods sold

Weighted-average inventory costing, COGS on the issue of stock, supplier and customer returns, and a reconciliation of
the stock ledger to the 1200 Inventory account. Base: main `9d5a6e8`. Everything below was implemented and verified
against TEST-only databases on 127.0.0.1; nothing ran against the VPS or the Neon database.

## 1. What existed, what was missing, and why profit was wrong

| Area | Before ACC-01 |
|---|---|
| Products | `quantity_on_hand` (integer) and a user-entered `cost_price`; no item type — every product was counted |
| Opening stock | the product form wrote a bare quantity; no cost, no movement, no journal entry |
| Stock adjustments | quantity only; no cost, no journal entry |
| Purchase receipt | `ordered → received`: +quantity per product line (`Math.trunc`), and **Dr 1200 Inventory / Cr 2000 AP for the gross total** — VAT and non-stock lines included |
| Sales issue | invoice posting (send, or a proforma conversion born paid) decremented stock and posted **Dr AR / Cr Revenue / Cr VAT only — no COGS, Inventory never relieved**; negative stock allowed |
| Delivery challans | quantity-only documents; no stock, no ledger (they never issued stock) |
| Invoice void | restored quantity; mirrored the revenue entry |
| Debit note (purchase return) | −quantity; **Dr AP / Cr 1200 for the gross** |
| Credit note | revenue / VAT / AR only; goods a customer sent back could not come back into stock at all |
| Valuation | none — no cost layers, no average, no stock ledger |
| P&L | ledger-based; Cost of Sales = expense codes 5000–5099 — always empty |

**Root cause.** No posting ever reached 5000 Cost of Goods Sold, and 1200 Inventory only ever grew (by gross purchase
totals, VAT included) or fell by gross debit-note totals. So the P&L's gross, operating and net profit equalled revenue
minus operating costs with **no cost of the goods sold**, and the Balance Sheet carried an Inventory balance that was a
running sum of purchase invoices, not stock. C8 hid the profit figures and marked the current-period result Preliminary
for exactly this reason.

## 2. The policy implemented

| Decision | Implemented as |
|---|---|
| Valuation method | **Perpetual weighted-average cost (WAC)**, per product per organization, in the base currency. No FIFO. Inflows enter at their cost; **every outflow leaves at the average**, so an outflow never changes the average of the units that stay. The unit that empties the pool takes exactly what is left. |
| Recognition of COGS | **When stock is issued — the invoice posting** (send, or a proforma conversion born paid). This is the issue event the system already had: it is the only place stock left the books. A delivery challan still moves nothing, so a sale that passes through a sales order, an invoice and one or more delivery challans issues its stock exactly once. Moving the issue to the challan would be a lifecycle change (partial deliveries, challans from sales orders, invoices without challans) and is not made. |
| Stock vs service | New `products.item_type`: `stock` (existing rows and the default) or `service`. A service is never counted, valued, issued or received into stock. |
| Receipt cost | Each stock line's share of the order's **net** — after its document discount, before VAT — converted at the receipt's rate (FX-6, unchanged). |
| Purchase VAT | **Recoverable input VAT**, debited to 2100 VAT Payable (the net VAT position); never part of inventory cost (IAS 2.11). |
| Non-stock purchase lines | Free-text lines and services are **expensed to 5100 Operating Expenses** at receipt. |
| Supplier returns (debit notes) | The units leave **at the weighted average**, like every outflow. The supplier's credit is recorded at its actual value (AP for the whole note, at the purchase order's stored rate). The difference between the credit for the stock lines and the cost relieved is a **price variance in 5000 Cost of Goods Sold** (the chart has no separate purchase-price-variance account). |
| Customer returns (credit notes) | A credit note is **financial-only** unless goods are explicitly returned to stock against it. Returned units come back **at the cost their sale issued them at**, and that COGS is reversed. See §3. |
| Opening stock | Requires a quantity **and a unit cost**; Dr 1200 / Cr 3000 Owner's Equity — the offset a bank account's opening balance already uses. |
| Adjustments | An increase requires the unit cost of what is added (Dr 1200 / Cr 5000); a decrease leaves at the average (Dr 5000 / Cr 1200). |
| Negative stock | **Refused.** An issue, return or decrease larger than the quantity on hand never posts; the refusal names the product and both counts, in the session's language. |
| Fractional stock | **Refused** for stock items (stock is counted in whole units; the old code truncated 2.5 to 2 silently). Services and free-text lines are unaffected. |
| Unknown cost | Never zero. Units added from now on always carry a cost. Units that existed before ACC-01 have none (see §5). |

## 3. Journal postings

All amounts in the base currency, rounded to its minor unit (`roundMoney`), every entry balanced by construction.

| Event | Entry | Stock movement |
|---|---|---|
| Opening stock | Dr 1200 / Cr 3000 — `(inventory_opening, <movement id>)` | `opening`, +qty, +cost |
| Purchase receipt | Dr 1200 stock net · Dr 5100 non-stock net · Dr 2100 VAT / Cr 2000 gross — `(purchase_order, <PO id>)` | `receipt` per stock line, +qty at its share |
| Invoice posting | Dr 1100 / Cr 4000 / Cr 2100 **+ Dr 5000 / Cr 1200 at average cost** — one entry, `(sales_invoice, <invoice id>)` | `issue` per stock line, −qty, −cost |
| Invoice void | the posting entry mirrored line for line (FX-6), COGS lines included | each `issue` reversed exactly (`reversal`, `reverses_movement_id`) |
| Debit note issue | Dr 2000 gross credit / Cr 1200 stock **at the average** · Cr 5100 non-stock · Cr 2100 VAT · ± 5000 price variance — `(debit_note, <note id>)` | `purchase_return` per stock line, at the average |
| Debit note reverse | the issue entry mirrored (variance included) | each `purchase_return` reversed exactly, at the cost it left at |
| Credit note issue | Dr 4000 / Dr 2100 / Cr 1100 — `(credit_note, <note id>)`, unchanged | none — a credit note is financial |
| Goods returned on a credit note | Dr 1200 / Cr 5000 at the cost the invoice issued them at — `(sales_return, <note id>)`, one entry per return | `sales_return`, +qty at the issue's cost (`reverses_movement_id` → the invoice's `issue` row) |
| Credit note reverse | the issue entry mirrored, unchanged; **plus**, when it had returned goods, Dr 5000 / Cr 1200 taking them back out — `(sales_return, <note id>)` | `reversal` of each `sales_return` |
| Adjustment | Dr 1200 / Cr 5000 (up) or Dr 5000 / Cr 1200 (down) — `(inventory_adjustment, <movement id>)` | `adjustment` |

**Supplier returns — worked example.** A product holds 20 units worth 460.00 (10 bought at 20.00, 10 at 26.00:
average 23.00). The supplier takes back 4 of the dearer units and credits 4 × 26.00 = 104.00 + VAT 15.60:

    Dr 2000 Accounts Payable     119.60    (the credit, at its actual value)
        Cr 1200 Inventory                92.00    (4 × 23.00 — the units leave at the average)
        Cr 2100 VAT                      15.60
        Cr 5000 Cost of Goods Sold       12.00    (the credit above the units' cost: price variance)

The 16 units left are worth 368.00, still 23.00 each. Under the earlier rule (relieve at the credited price) they
would have been worth 356.00 (22.25 each): the return would have re-priced the stock that stayed. A credit below the
average debits 5000 instead (2 units credited at 20.00 = 40.00 against 46.00 of cost: Dr 5000 6.00). A return that
empties the pool relieves exactly what is left, and the rest of the credit is variance. Reversing the debit note mirrors
the entry — the variance with it — and puts the units back at the exact cost they left at.

**Customer returns.** A credit note is financial-only by default: issuing it reverses revenue, VAT and AR exactly as
before and moves no stock — a price adjustment, an allowance, goods the customer kept or scrapped. Goods that physically
came back are recorded explicitly, against an **issued** note, with **Return goods to stock** on its detail page: whole
units per line, in as many parts as they arrive.

* **Cost.** Each unit comes back at the cost its sale issued it at, never at today's average, and exactly that COGS is
  reversed (Dr 1200 / Cr 5000). Within a product, units come back in the reverse of the order the sale took them out:
  units the sale issued with no cost basis come back first, still uncosted (a cost is never invented), then costed units
  at their own issue's unit cost; the last unit of an issue takes exactly what is left of it.
* **Link.** Each `sales_return` row points at the invoice's `issue` row it came back from, and carries the credit
  note and its line as its source; its entry is `(sales_return, <credit note id>)`, memo naming the note and the invoice.
* **Caps.** A line returns at most the whole units it credits (less what it has already returned), and a sale gives
  back at most what it issued, across every credit note against it (less returns that still stand). Both hold against
  the complete request: a request names each line once — a line named twice is refused, even when its parts would
  fit — and the lines of one product are added up before the sale's limit is checked. A return of a service or
  free-text line, against a draft or reversed note, or of a fraction is refused.
* **One submission, one return.** Each opening of the return dialog is one submission, with its own key; the return's
  movements carry it (`request_key`). The same key again — a double click, a retried request — is answered from the
  return already recorded and writes nothing; the same key with other quantities is refused. Duplicates sent at the
  same moment queue on the credit note's row lock, so the second finds the first. A later delivery opens the dialog
  again, under a new key, and is recorded. A request without a valid key is refused.
* **Reversal.** Reversing a credit note takes its returned goods back out. When no stock of the product has gone out
  since the return, they leave **exactly** — the same units at the same cost — so the pool is precisely what it would
  have been without the return. Once stock has gone out in between, the returned units are no longer separable from the
  rest and they leave **at the average**, like any outflow. If they are no longer on hand, the reversal is refused and
  nothing is written. A reversed return gives its units back to the invoice's issue, so another note can return them.
* **Invoices posted before ACC-01** have no issue rows: their units come back uncosted, up to the quantity they sold.
* **Void.** An invoice whose credit notes' returned goods are still in stock cannot be voided (the void would put the
  whole issue back on top of them); the notes are reversed first. Today only a zero-value note can reach this — an issued
  note settles part of the invoice, and a settled invoice cannot be voided.

**Idempotency and concurrency.** Posting stays idempotent by journal identity: `post` locks the invoice row, finds any
`(sales_invoice, id)` entry and does nothing — no second entry, no second issue. Every stock path locks the product rows
it touches `FOR UPDATE`, in ascending id order, so concurrent postings queue rather than deadlock and each reads the pool
the other committed; a shortfall found under the lock refuses and rolls the whole document back. Receive, void, debit-note
reverse and credit-note reverse re-check their lifecycle status under the document's row lock, so a double click cannot
receive, void or reverse twice. A goods return locks the credit note, then its invoice (the order issuing a credit note
takes), then the products: two returns against the same sale queue, and the second sees the first.

**Tenant isolation.** Every query in the engine is scoped by `org_id`; a document line naming another organization's
product is refused ("A line refers to a product that does not exist in this organization."), never skipped. A credit
note of another organization is not found.

**Audit trail.** Movements are only ever inserted; a correction is a new `reversal` row pointing at the row it undoes (a
row counts as reversed only when a `reversal` points at it). A product with stock history cannot be permanently deleted
(the owner's Recycle Bin action refuses with a message), and an item type changes only while the product has no stock
and no history. A service also stays a service while a sent invoice, a received purchase order or an issued debit note
names it: those documents moved no stock for it, so once it became a stock item, their void, a goods return against them
or their reversal would read them as pre-ACC-01 documents and move stock that never moved.

## 4. Schema (Drizzle, `db:push`)

The repository changes its schema through `src/db/schema` and `npm run db:push` (the `drizzle/` history stops at 0004 —
AUD-08). ACC-01 adds only:

* `products.item_type` (`inventory_item_type`: stock | service, default stock), `products.valued_quantity` (integer,
  default 0) and `products.stock_value` (numeric(15,3), default 0) — the weighted-average pool;
* `inventory_movements` (enum `inventory_movement_kind`: opening, receipt, issue, purchase_return, adjustment, reversal,
  sales_return) — the stock ledger: org, product, date, kind, signed quantity, signed base cost (NULL = no cost basis), the
  source document and line, the journal entry, the movement it reverses or returns from, a customer return's submission
  key (`request_key`, nullable), memo, creator. Foreign keys to
  orgs (cascade), products, journal entries, itself (named `inventory_movements_reverses_movement_fk`) and users;
  indexed by (org, product) and (org, source).

Every change is additive, with defaults; no row is rewritten. Measured with `drizzle-kit push --verbose` on TEST-only
copies:

* **main's seed → this branch:** 21 statements — 2 enums, 1 table, 3 columns, 5 foreign keys, 2 indexes, plus the drop and
  re-add of four long-named foreign keys that **main's own schema produces on every push** (Postgres truncates their
  names to 63 bytes; a pre-existing quirk, not an ACC-01 change).
* **an earlier ACC-01 schema → this branch:** whichever it lacks of `ALTER TYPE inventory_movement_kind ADD VALUE
  'sales_return'`, the self-reference renamed once to its short name (the generated name was longer than 63 bytes too;
  named explicitly, it no longer churns — a second push shows only main's four) and `ALTER TABLE inventory_movements
  ADD COLUMN request_key text`. From `ce65b59`'s schema that column is the only statement besides main's four.

Deployment (not performed): back up, `npm run db:push` against the target, deploy the build, then run the read-only
report below to see what the existing data carries. Nothing backfills: existing products become stock items with no
valued units, which is §5's explicit incomplete-data state — and §10's cutover.

## 5. Stock with no cost basis (data from before ACC-01)

`quantity_on_hand − valued_quantity` is stock the system has no cost for: quantities that existed before ACC-01, or that
were written outside the app. It is never valued at zero:

* issuing it is allowed — the sale happened — but writes an **uncosted** movement (`total_cost` NULL) and posts no COGS
  for those units; valued units always go first;
* a customer return brings those units back uncosted, first (§3); a supplier return takes them out uncosted, and their
  share of the supplier's credit relieves 1200, where the pre-ACC-01 receipt put their cost;
* the product's Stock card shows "Units without a recorded cost" with an explanation, in both languages;
* the valuation report lists it, and the reconciliation counts the uncosted issues (net of units that came back);
* voiding an invoice posted before ACC-01 restores its old decrement, unit for unit, with no cost; reversing a debit
  note issued before ACC-01 likewise.

The 1200 balance those pre-ACC-01 postings left (gross receipts, gross debit notes) is not touched; the reconciliation
isolates it (§6).

## 6. Valuation and reconciliation

`src/lib/inventory-valuation.ts` (read-only, org-scoped), printed per organization by
`npx tsx --env-file-if-exists=.env --conditions=react-server scripts/inventory-valuation-report.ts [--org <id>]`:

* **Valuation** — per stock item: on hand, valued quantity, quantity with no cost basis, stock value, average cost.
* **Reconciliation** — GL 1200 = valued stock + unattributed. Entry by entry, the 1200 lines are matched with the costed
  movements that belong to the entry; whatever is left (pre-ACC-01 receipts and debit notes, manual journals) is listed
  by source type. Integrity: each product's pool equals the sum of its costed movements; no costed movement lacks its
  entry. `integrityOk` and `reconciled` (no unattributed amount) are reported separately. Customer returns and their
  reversals reconcile like every other movement (their entries hold exactly their cost).

The product detail page's Stock card shows the item's average cost and stock value.

## 7. Verification

* **`verify:inventory-costing`** (new, in `verify:server`): 171 checks on fixture organizations, through the same
  posting functions the actions call — opening stock; receipt cost (discount, VAT, non-stock lines); WAC; receipts at
  different costs; partial and full issue (the last unit takes the exact remainder); COGS on the invoice entry;
  delivery challans moving nothing; repeated posting; purchase return and its reversal; void and its cost reversal;
  cancelled orders; reconciliation; P&L and Balance Sheet; services and the item-type guard; missing and invalid cost;
  stock with no cost basis; negative and fractional stock; SAR / USD / KWD rounding; concurrency; tenant isolation;
  role gates; mixed documents; legacy data; a tampered pool as a negative control; the permanent-delete guard; then
  **supplier returns credited above and below the average** (multiple purchase prices, partial and full returns, a
  minor-unit rounding case, USD, reversal, tenant isolation) and **customer returns** (a note without returned goods,
  partial and full returns, several notes against one invoice, duplicate and over-returns refused, exact and average
  reversals, a reversal refused when the goods are gone, uncosted and pre-ACC-01 stock, mixed lines, the void guard,
  USD and KWD rounding, two notes racing for the last unit, two submissions racing for a note's last unit, tenant
  isolation, role gates, reconciliation) and **return requests** (a line named twice, request-wide limits, the same
  submission replayed, the same key with other quantities, a missing key, concurrent duplicates, a later partial
  delivery, original cost and COGS, reconciliation, tenant isolation). Mutation runs are recorded in the PR.
* **`verify-fx-posting`** (browser): five expectations state the corrected postings — the receipt capitalises the net
  and debits VAT to 2100; a debit note's free-text line comes back out of 5100 and its VAT goes back to 2100, with no
  inventory line. The old expectations ("Dr Inventory 2300.000") were the defect: VAT carried into stock. Every FX
  assertion (rates, base figures, mirrored reversals) is unchanged.
* **DEV-UI-01.7 verifiers.** `verify-page-archetypes` and `verify-document-form` freeze the business files ACC-01 had to
  change. Following their rule for an approved change (no re-baseline), ACC-01's hunks are recorded byte for byte in
  `verify/acc01-approved-delta.mts`; the older checks read those files with the hunks undone (main's bytes), and new
  checks prove the hunks are each file's only change and pin the added files. Their pins are unchanged. The runtime
  verifier re-records nothing either: the product pages' owner and Staff action lists are compared with the record plus
  exactly ACC-01's change (Item type's two radios, in the page's language; the Arabic product page's Adjust stock trigger
  in Arabic), and every other measure as recorded, unnamed controls included. That is why Item type is the shared native
  RadioGroup (as Client Type): a Radix Select inside a form renders a hidden, unnamed native `<select>`. The goods return
  is an action on an **issued** note's page, so no recorded page (C7 opens a draft note) changes.

## 8. Decisions and limitations left open (flagged for the owner)

1. **Pre-ACC-01 stock** has no cost basis and its 1200 balance is a running sum of gross receipts — see §10. Until the
   cutover, sales of those units carry no COGS. **This is the one financially material gap left: keep the C8 notices.**
2. **Non-stock purchase lines** are expensed to 5100. If direct project purchases belong in cost of sales, a per-line or
   per-order expense account is needed.
3. **Input VAT** is debited to 2100 (net VAT). A separate recoverable-VAT asset account, and the treatment for an
   organization that is not VAT-registered (where VAT is part of cost), are owner decisions.
4. **Price variances** (supplier returns) go to 5000 Cost of Goods Sold; a separate purchase-price-variance account is
   an owner decision.
5. **Goods returns are a second step** after issuing the credit note. A mistaken return is corrected by reversing the
   note (which takes the goods back out) or by a stock adjustment; there is no separate "undo return".
6. **Delivery-based issue.** COGS is recognised at invoicing, which is when stock leaves today. Issuing on delivery
   instead is a lifecycle change.
7. **A valuation screen.** The report is a CLI script and the product Stock card; a Financial Reports page needs the
   DEV-UI-pinned report workspace.

## 9. The C8 interim disclosures

**Keep them.** Sales, purchases, supplier and customer returns, voids and reversals now post their cost correctly, and
those paths are verified; but pre-ACC-01 stock still sells without a cost and its legacy 1200 balance is not stock
(8.1). Retiring the P&L profit notice and the Balance Sheet's Preliminary marker is proposed only after the cutover
(§10) and when the reconciliation of the real data reports `integrityOk` and `reconciled` for every organization, with
the owner's decisions 8.2–8.4 recorded.

## 10. Cutover of pre-ACC-01 stock — recommendation

The existing ERP records are disposable development test data, so no historical migration is needed — and none should
be written: re-costing past invoices would rewrite posted history for data nobody keeps.

**Recommended: start the inventory clean at deployment.** In a maintenance window, on the target, after a backup:

1. `npm run db:push` (§4), then deploy the build.
2. Reset the test organizations' transactional data (documents, payments, journal entries, stock movements) and set every
   product's `quantity_on_hand` to 0 — master data (customers, vendors, products, chart of accounts, settings) stays.
   This is a reviewed, one-off SQL script, run first on a TEST copy of the target; it is not part of this PR.
3. Enter real opening stock through the product form or **Adjust stock**, each with its unit cost (Dr 1200 / Cr 3000).
4. Run `scripts/inventory-valuation-report.ts`: every organization must report `integrityOk` and `reconciled`, with no
   units without a cost basis. Only then is retiring the C8 notices on the table (§9).

**If the test data must be kept instead**, the minimal cutover is two entries per organization at a cutover date, with
no change to any past document or entry: (a) value the counted pre-ACC-01 units at a stated unit cost — an `opening`
movement for the uncosted units (quantity on hand unchanged), Dr 1200 / Cr 3000 — refusing any product without a cost;
and (b) reclassify the reconciliation's unattributed legacy 1200 balance to 3000. That needs a small, TEST-verified tool
that does not exist yet; with disposable data, the reset is simpler and leaves nothing unexplained.
