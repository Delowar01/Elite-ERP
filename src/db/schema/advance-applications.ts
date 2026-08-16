import { pgTable, serial, integer, text, numeric, date, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";
import { paymentsTable } from "./finance";
import { salesInvoicesTable } from "./sales-invoices";

/**
 * Partial advance allocation: one row per "this much of that advance settles this invoice".
 *
 * ## Why a table rather than `payments.salesInvoiceId`
 *
 * The whole-payment model could only express "this advance was applied to that invoice" — one
 * advance, one invoice, all of it. A receipt of 10,000 against an invoice of 8,000 therefore had
 * nowhere to put the remaining 2,000, and an advance could never be split across two invoices or
 * partly refunded. Overloading `salesInvoiceId` harder ("the first of several applications") is
 * exactly the field-ambiguity the advances model exists to remove, so allocations get their own
 * rows and `salesInvoiceId` goes back to meaning one thing: the invoice an ORDINARY payment
 * settled. The receipt itself stays immutable — it is the bank fact, and the bank fact never
 * changes because the money was later spent differently.
 *
 * ## The pot
 *
 * A receipt is a pot with two figures: its document amount and its carried base value (the payment
 * row's `amount` and `baseAppliedAmount` — for an advance those are the received figures, since a
 * proforma has no booked rate to clear against). Allocations and refunds are its only consumers:
 *
 *   available_doc     = amount           − Σ(active allocations.appliedAmount) − Σ(refunds.amount)
 *   available_carried = baseAppliedAmount − Σ(active allocations.carriedBase)  − Σ(refunds.baseAppliedAmount)
 *
 * A released allocation stops counting, so releasing restores availability with no compensating
 * write anywhere.
 *
 * ## Why the two base figures are STORED
 *
 * `carriedBase` (what left 2300) and `arCleared` (what settled 1100) are what the allocation's
 * journal posted, and they are kept here for the same reason payments keep their base columns
 * (FX-7): a reversal must mirror what was posted rather than recompute it, and the "GL 2300 = sum
 * of remaining available advances" invariant has to be answerable from documents as well as from
 * the ledger. Their difference is the allocation's realized FX, posted to 4900.
 */
export const advanceApplicationsTable = pgTable(
  "advance_applications",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    /** The advance receipt this allocation draws from. Never mutated by the allocation. */
    advancePaymentId: integer("advance_payment_id")
      .notNull()
      .references(() => paymentsTable.id),
    /** The invoice this allocation settles. */
    salesInvoiceId: integer("sales_invoice_id")
      .notNull()
      .references(() => salesInvoicesTable.id),
    /** Amount drawn from the advance, in the ADVANCE's document currency (= the invoice's). */
    appliedAmount: numeric("applied_amount", { precision: 15, scale: 3 }).notNull(),
    /** Base value released from 2300 — the Dr line. Apportioned, or the exact residual when this allocation empties the advance. */
    carriedBase: numeric("carried_base", { precision: 15, scale: 3 }).notNull(),
    /** Base value cleared from 1100 — the Cr line. At the invoice's booked rate, or the exact residual when this allocation closes the invoice. */
    arCleared: numeric("ar_cleared", { precision: 15, scale: 3 }).notNull(),
    /** The allocation journal's entry date. */
    appliedDate: date("applied_date").notNull(),
    /** NULL = active. Set when the allocation is released (invoice voided, or credit note issued). */
    releasedAt: timestamp("released_at"),
    /** Why it was released: "invoice_void" | "credit_note". Null while active. */
    releaseReason: text("release_reason"),
    createdById: integer("created_by_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("advance_applications_advance_idx").on(t.orgId, t.advancePaymentId),
    index("advance_applications_invoice_idx").on(t.orgId, t.salesInvoiceId),
  ],
);

// Deliberately NO unique constraint on (advancePaymentId, salesInvoiceId): applying an advance to
// the same invoice twice — 2,000 now, 3,000 after a later payment falls through — is legitimate,
// and each application is its own journal.

export const insertAdvanceApplicationSchema = createInsertSchema(advanceApplicationsTable).omit({ id: true, createdAt: true });
export type InsertAdvanceApplication = z.infer<typeof insertAdvanceApplicationSchema>;
export type AdvanceApplication = typeof advanceApplicationsTable.$inferSelect;
