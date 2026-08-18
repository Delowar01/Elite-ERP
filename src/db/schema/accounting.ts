import { pgTable, serial, integer, text, numeric, boolean, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

export const accountsTable = pgTable("accounts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // asset | liability | equity | revenue | expense
  normalBalance: text("normal_balance").notNull(), // debit | credit
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAccountSchema = createInsertSchema(accountsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;

export const journalEntriesTable = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  entryDate: date("entry_date").notNull(),
  memo: text("memo").notNull(),
  /**
   * WHAT this entry came from. `sourceType` is HALF of the identity — never resolve `sourceId`
   * without it.
   *
   * Known values: sales_invoice | credit_note | purchase_order | debit_note | payment |
   * advance_application | advance_application_release | advance_application_release_reversal |
   * bank_opening | payment_reversal | payroll_run | expense | manual.
   *
   * `payment_reversal` keys off `payments.id` — the SAME id its original `payment` entry uses, under
   * a different type. That is deliberate and it is the whole idempotency key: a reversal exists iff
   * a `(payment_reversal, <payment id>)` entry exists, checked inside the transaction. It is also
   * the sharpest live example of why the pair matters — resolving that id without the type finds
   * the original payment entry and concludes the reversal is already posted, or vice versa.
   *
   * `bank_opening` keys off `bank_accounts.id`, and that pairing is the whole idempotency key of
   * the opening-balance backfill: an entry is posted only when no `(bank_opening, <id>)` entry
   * exists. Checking the id alone would collide with every other source type's sequence.
   *
   * ## The hazard for whoever adds the next source type
   *
   * `sourceId` is drawn from a DIFFERENT table for each source type, and those tables have
   * independent sequences. So the same integer is a valid id in several of them at once, and a
   * reader that resolves attribution by id while assuming the wrong table does not find nothing —
   * it finds an UNRELATED ROW and reports it confidently.
   *
   * This is not hypothetical. When advance-application entries were re-keyed from the payment to
   * the allocation, the statements reader kept resolving them as payment ids: most lines lost their
   * attribution and were dropped from the statement, and 70 of them landed on a stranger's party
   * because an allocation id happened to equal a payment id. Nothing errored.
   *
   * ## The canonical example, for anyone testing this hazard
   *
   * `payment_reversal` is the sharpest instance in the codebase and needs no contrived fixture: a
   * reversal is keyed `(payment_reversal, <payments.id>)` and the posting it reverses is keyed
   * `(payment, <the same payments.id>)`. The collision is GUARANTEED for every payment that has
   * ever posted, so an id-only existence check finds the payment's own original entry and concludes
   * the reversal is already there — writing nothing, erroring nothing. `verify-payment-reversal`
   * mutates exactly that check and shows it silently refusing. Every other test of this hazard in
   * the repo has to seed a decoy row; that one does not.
   *
   * So: a reader must branch on `sourceType` FIRST and look the id up in that type's own table, and
   * a re-key of any source type is a change to every reader of it. `verify-statements` asserts the
   * attribution of each type against the shape the app actually posts — seed fixtures from the
   * writing code path, never from a remembered shape.
   */
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id"),
  // Optional project tag for MANUAL entries, so a direct project cost posted straight to the ledger
  // can be attributed. Document-sourced entries leave this NULL — their project comes from the
  // source document, and counting both would double-count.
  projectId: integer("project_id").references(() => projectsTable.id),
  createdById: integer("created_by_id")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type JournalEntry = typeof journalEntriesTable.$inferSelect;

export const journalLinesTable = pgTable("journal_lines", {
  id: serial("id").primaryKey(),
  journalEntryId: integer("journal_entry_id")
    .notNull()
    .references(() => journalEntriesTable.id, { onDelete: "cascade" }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accountsTable.id),
  debit: numeric("debit", { precision: 15, scale: 3 }).notNull().default("0"),
  credit: numeric("credit", { precision: 15, scale: 3 }).notNull().default("0"),
  memo: text("memo"),
});

export type JournalLine = typeof journalLinesTable.$inferSelect;

// Seeded per-org at signup. Codes chosen to leave room for user-added accounts.
export const DEFAULT_CHART_OF_ACCOUNTS: Array<{
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  normalBalance: "debit" | "credit";
  isSystem: boolean;
}> = [
  { code: "1000", name: "Cash", type: "asset", normalBalance: "debit", isSystem: true },
  { code: "1100", name: "Accounts Receivable", type: "asset", normalBalance: "debit", isSystem: true },
  { code: "1200", name: "Inventory", type: "asset", normalBalance: "debit", isSystem: true },
  { code: "2000", name: "Accounts Payable", type: "liability", normalBalance: "credit", isSystem: true },
  { code: "2100", name: "VAT Payable", type: "liability", normalBalance: "credit", isSystem: true },
  { code: "2200", name: "Salaries Payable", type: "liability", normalBalance: "credit", isSystem: true },
  // Customer-advances model: money received against a proforma is a LIABILITY (the business owes
  // goods, not cash back) — never AR, never revenue. Advance receipts credit this account; the
  // advance application on conversion debits it against AR. Existing orgs get it via
  // scripts/migrations/2026-08-12-customer-advances-account.ts.
  { code: "2300", name: "Customer Advances", type: "liability", normalBalance: "credit", isSystem: true },
  { code: "3000", name: "Owner's Equity", type: "equity", normalBalance: "credit", isSystem: true },
  { code: "4000", name: "Sales Revenue", type: "revenue", normalBalance: "credit", isSystem: true },
  // FX-7: realized currency differences on payments. One account for both directions — gains
  // credit it, losses debit it — classified as revenue (credit-normal), so a net loss simply shows
  // negative in the revenue section rather than needing a paired expense account. Existing orgs
  // get it via scripts/migrations/2026-08-11-fx-gain-loss-account.ts.
  { code: "4900", name: "Exchange Gain/Loss", type: "revenue", normalBalance: "credit", isSystem: true },
  { code: "5000", name: "Cost of Goods Sold", type: "expense", normalBalance: "debit", isSystem: true },
  { code: "5100", name: "Operating Expenses", type: "expense", normalBalance: "debit", isSystem: true },
  { code: "5200", name: "Salary Expense", type: "expense", normalBalance: "debit", isSystem: true },
];
