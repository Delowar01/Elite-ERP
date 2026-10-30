# ACC-01 — inventory valuation and cost of goods sold

Weighted-average inventory costing, COGS on the issue of stock, and a reconciliation of the stock ledger to the 1200
Inventory account. Base: main `9d5a6e8`. Everything below was implemented and verified against TEST-only databases on
127.0.0.1; nothing ran against the VPS or the Neon database.

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
| Credit note | revenue / VAT / AR only; no stock (unchanged by ACC-01, see §6) |
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
| Valuation method | **Perpetual weighted-average cost (WAC)**, per product per organization, in the base currency. No FIFO. |
| Recognition of COGS | **When stock is issued — the invoice posting** (send, or a proforma conversion born paid). This is the issue event the system already had: it is the only place stock left the books. A delivery challan still moves nothing, so a sale that passes through a sales order, an invoice and one or more delivery challans issues its stock exactly once. Moving the issue to the challan would be a lifecycle change (partial deliveries, challans from sales orders, invoices without challans) and is not made. |
| Stock vs service | New `products.item_type`: `stock` (existing rows and the default) or `service`. A service is never counted, valued, issued or received into stock. |
| Receipt cost | Each stock line's share of the order's **net** — after its document discount, before VAT — converted at the receipt's rate (FX-6, unchanged). |
| Purchase VAT | **Recoverable input VAT**, debited to 2100 VAT Payable (the net VAT position); never part of inventory cost (IAS 2.11). |
| Non-stock purchase lines | Free-text lines and services are **expensed to 5100 Operating Expenses** at receipt. |
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
| Debit note issue | Dr 2000 gross / Cr 1200 stock value · Cr 5100 non-stock · Cr 2100 VAT · ± 5000 variance — `(debit_note, <note id>)` | `purchase_return` per stock line |
| Debit note reverse | the issue entry mirrored | each `purchase_return` reversed exactly |
| Adjustment | Dr 1200 / Cr 5000 (up) or Dr 5000 / Cr 1200 (down) — `(inventory_adjustment, <movement id>)` | `adjustment` |

**Purchase returns.** A stock line leaves at the value the supplier credits for it — its share of the note's net, at
the purchase order's stored rate (unchanged FX rule) — which reverses the purchase being returned. Two guards keep the
pool sound and send the difference to 5000 as a purchase-price variance: a return that empties the pool relieves exactly
what is left, and a credit larger than the whole pool while units remain relieves the average instead.

**Idempotency and concurrency.** Posting stays idempotent by journal identity: `post` locks the invoice row, finds any
`(sales_invoice, id)` entry and does nothing — no second entry, no second issue. Every stock path locks the product rows
it touches `FOR UPDATE`, in ascending id order, so concurrent postings queue rather than deadlock and each reads the pool
the other committed; a shortfall found under the lock refuses and rolls the whole document back. Receive, void and
debit-note reverse now re-check their lifecycle status under the document's row lock, so a double click cannot receive,
void or reverse twice.

**Tenant isolation.** Every query in the engine is scoped by `org_id`; a document line naming another organization's
product is refused ("A line refers to a product that does not exist in this organization."), never skipped.

**Audit trail.** Movements are only ever inserted; a correction is a new `reversal` row pointing at the row it undoes. A
product with stock history cannot be permanently deleted (the owner's Recycle Bin action refuses with a message), and an
item type changes only while the product has no stock and no history.

## 4. Schema (Drizzle, `db:push`)

The repository changes its schema through `src/db/schema` and `npm run db:push` (the `drizzle/` history stops at 0004 —
AUD-08). ACC-01 adds only:

* `products.item_type` (`inventory_item_type`: stock | service, default stock), `products.valued_quantity` (integer,
  default 0) and `products.stock_value` (numeric(15,3), default 0) — the weighted-average pool;
* `inventory_movements` (enum `inventory_movement_kind`) — the stock ledger: org, product, date, kind, signed quantity,
  signed base cost (NULL = no cost basis), the source document and line, the journal entry, the movement it reverses,
  memo, creator. Foreign keys to orgs (cascade), products, journal entries, itself and users; indexed by
  (org, product) and (org, source).

Every change is additive, with defaults; no row is rewritten. Measured on a TEST-only copy of the seed:
`drizzle-kit push` printed exactly these statements, plus the drop-and-re-add of four long-named foreign keys that
**main's own schema produces on every push** (Postgres truncates their names to 63 bytes; the same four appear when
main `9d5a6e8` is pushed to the same seed — a pre-existing quirk, not an ACC-01 change).

Deployment (not performed): back up, `npm run db:push` against the target, deploy the build, then run the read-only
report below to see what the existing data carries. Nothing backfills: existing products become stock items with no
valued units, which is §5's explicit incomplete-data state.

## 5. Stock with no cost basis (data from before ACC-01)

`quantity_on_hand − valued_quantity` is stock the system has no cost for: quantities that existed before ACC-01, or that
were written outside the app. It is never valued at zero:

* issuing it is allowed — the sale happened — but writes an **uncosted** movement (`total_cost` NULL) and posts no COGS
  for those units; valued units always go first;
* the product's Stock card shows "Units without a recorded cost" with an explanation, in both languages;
* the valuation report lists it, and the reconciliation counts the uncosted issues;
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
  entry. `integrityOk` and `reconciled` (no unattributed amount) are reported separately.

The product detail page's Stock card shows the item's average cost and stock value.

## 7. Verification

* **`verify:inventory-costing`** (new, in `verify:server`): 95 checks on fixture organizations, through the same posting
  functions the actions call — opening stock; receipt cost (discount, VAT, non-stock lines); WAC; receipts at different
  costs; partial and full issue (the last unit takes the exact remainder); COGS on the invoice entry; delivery challans
  moving nothing; repeated posting; purchase return and its reversal; void and its cost reversal; cancelled orders;
  reconciliation; P&L (revenue, cost of sales, gross / operating / net profit) and Balance Sheet (Inventory = valuation,
  balanced, current-period result = net profit); services; missing and invalid cost; stock with no cost basis; negative
  and fractional stock; SAR / USD / KWD rounding and the PO-rate inheritance of returns; concurrent sales against the same
  stock (exactly the right number post); tenant isolation; the role gates of the product actions; mixed documents;
  legacy data; a tampered pool as a negative control; and the permanent-delete guard. Sixteen mutations of the posting
  code and the verifier record were run: fifteen fail their suite; the sixteenth (dropping the explicit "take what is
  left" branch) is equivalent — the running pool already gives the last unit the exact remainder — and its stronger
  variant (costing at a rounded unit cost) fails.
* **`verify-fx-posting`** (browser): five expectations now state the corrected postings — the receipt capitalises the
  net and debits VAT to 2100; a debit note's free-text line comes back out of 5100 and its VAT goes back to 2100, with no
  inventory line. The old expectations ("Dr Inventory 2300.000") were the defect: VAT carried into stock. Every FX
  assertion (rates, base figures, mirrored reversals) is unchanged.
* **DEV-UI-01.7 verifiers.** `verify-page-archetypes` and `verify-document-form` freeze the business files ACC-01 had to
  change. Following their rule for an approved change (no re-baseline), ACC-01's hunks are recorded byte for byte in
  `verify/acc01-approved-delta.mts`; the older checks read those files with the hunks undone (main's bytes), and new
  checks prove the hunks are each file's only change and pin the four added files. Their pins are unchanged.

## 8. Decisions this batch leaves open (flagged for the owner)

1. **Sales returns.** A credit note stays financial-only (revenue, VAT, AR), as before: it cannot tell a return of goods
   from a price adjustment. Smallest safe change: a "goods returned to stock" option on the credit note that reverses the
   source invoice's issue movements at their original cost. Until then, returned goods come back through a stock
   adjustment at the original unit cost. **This is a financially material gap: keep the C8 notices.**
2. **Pre-ACC-01 stock.** Value it (a cutover tool: count, cost, and clear the legacy 1200 balance against equity) or, as
   the data is disposable test data, reset it. Until then its sales carry no COGS.
3. **Non-stock purchase lines** are expensed to 5100. If direct project purchases belong in cost of sales, a per-line or
   per-order expense account is needed.
4. **Input VAT** is debited to 2100 (net VAT). A separate recoverable-VAT asset account, and the treatment for an
   organization that is not VAT-registered (where VAT is part of cost), are owner decisions.
5. **Delivery-based issue.** COGS is recognised at invoicing, which is when stock leaves today. Issuing on delivery
   instead is a lifecycle change.
6. **A valuation screen.** The report is a CLI script and the product Stock card; a Financial Reports page needs the
   DEV-UI-pinned report workspace.

## 9. The C8 interim disclosures

**Keep them.** The accounting now posts COGS, values stock and reconciles, and those paths are verified; but a sales
return still does not reverse its cost (8.1), and pre-ACC-01 stock still sells without one (8.2). Retiring the P&L
profit notice and the Balance Sheet's Preliminary marker is proposed only after both are closed and the reconciliation of
the real data reports `reconciled`.
