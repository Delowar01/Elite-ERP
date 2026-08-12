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
  sourceType: text("source_type").notNull(), // sales_invoice | credit_note | purchase_order | debit_note | payment | payroll_run | expense | manual
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
