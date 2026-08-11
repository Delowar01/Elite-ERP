import { pgTable, serial, integer, text, numeric, date, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";
import { vendorsTable } from "./vendors";
import { accountsTable } from "./accounting";
import { salesInvoicesTable } from "./sales-invoices";
import { proformaInvoicesTable } from "./proforma-invoices";
import { purchaseOrdersTable } from "./purchase-orders";
import { projectsTable } from "./projects";

export const bankAccountsTable = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  bankName: text("bank_name"),
  accountNumberMasked: text("account_number_masked"),
  // Payment-instruction details shown on documents (all optional; empty fields are never displayed).
  accountHolder: text("account_holder"),
  iban: text("iban"),
  swift: text("swift"),
  currency: text("currency"),
  branch: text("branch"),
  glAccountId: integer("gl_account_id")
    .notNull()
    .references(() => accountsTable.id),
  openingBalance: numeric("opening_balance", { precision: 15, scale: 3 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertBankAccountSchema = createInsertSchema(bankAccountsTable).omit({ id: true, createdAt: true });
export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;
export type BankAccount = typeof bankAccountsTable.$inferSelect;

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // in | out
  bankAccountId: integer("bank_account_id")
    .notNull()
    .references(() => bankAccountsTable.id),
  amount: numeric("amount", { precision: 15, scale: 3 }).notNull(),
  // ---- FX-7: currency capture at payment time. All nullable; null = recorded before FX-7 (or a
  // base-currency payment's currency). Semantics differ from the document tables' base columns
  // because a payment has TWO base figures — what the bank received and what the document is
  // credited with — and the difference between them is the realized FX gain/loss line.
  /** The payment's currency (the source document's); null = org base currency, matching the document tables. */
  currency: text("currency"),
  /**
   * Effective units of base per one unit of `currency`, derived as baseAmount / amount. When the
   * user overrides the received base amount, THIS is the override's rate — the bank statement is
   * ground truth and the rate follows it, never the other way around.
   */
  exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 }),
  /** What the bank truly received/paid, in base currency — the Bank journal line's figure. */
  baseAmount: numeric("base_amount", { precision: 15, scale: 3 }),
  /**
   * What the source document is credited with, in base currency — amount × the document's BOOKED
   * rate, the AR/AP journal line's figure and the increment to the document's basePaidAmount.
   * baseAmount − baseAppliedAmount is the realized FX gain(+)/loss(−). For proforma advances (no
   * booked rate exists) this equals baseAmount and no FX line is posted.
   */
  baseAppliedAmount: numeric("base_applied_amount", { precision: 15, scale: 3 }),
  /**
   * Where the effective rate came from: the resolved rate row's source when the pre-fill was
   * accepted untouched, or "derived-from-received" when the user typed the base amount themselves.
   */
  rateSource: text("rate_source"),
  paymentDate: date("payment_date").notNull(),
  method: text("method"), // cash | bank_transfer | card | cheque
  reference: text("reference"),
  salesInvoiceId: integer("sales_invoice_id").references(() => salesInvoicesTable.id),
  // A payment can be recorded against a Proforma Invoice (Issue #14). On conversion to a Sales
  // Invoice the payment is re-pointed (salesInvoiceId set) while this stays set as the origin
  // reference — the same payment row, keeping its single journal posting.
  proformaInvoiceId: integer("proforma_invoice_id").references(() => proformaInvoicesTable.id),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id),
  notes: text("notes"),
  createdById: integer("created_by_id")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  vendorId: integer("vendor_id").references(() => vendorsTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  description: text("description"),
  amount: numeric("amount", { precision: 15, scale: 3 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 3 }).notNull().default("0"),
  expenseDate: date("expense_date").notNull(),
  paymentMethod: text("payment_method"),
  receiptUrl: text("receipt_url"),
  createdById: integer("created_by_id")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const insertExpenseSchema = createInsertSchema(expensesTable).omit({ id: true, createdAt: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;
