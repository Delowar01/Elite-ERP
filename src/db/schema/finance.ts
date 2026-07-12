import { pgTable, serial, integer, text, numeric, date, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";
import { vendorsTable } from "./vendors";
import { accountsTable } from "./accounting";
import { salesInvoicesTable } from "./sales-invoices";
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
  glAccountId: integer("gl_account_id")
    .notNull()
    .references(() => accountsTable.id),
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull().default("0"),
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
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paymentDate: date("payment_date").notNull(),
  method: text("method"), // cash | bank_transfer | card | cheque
  reference: text("reference"),
  salesInvoiceId: integer("sales_invoice_id").references(() => salesInvoicesTable.id),
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
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
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
