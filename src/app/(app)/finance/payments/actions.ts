"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import {
  db,
  paymentsTable,
  salesInvoicesTable,
  purchaseOrdersTable,
  bankAccountsTable,
  accountsTable,
  journalEntriesTable,
  journalLinesTable,
} from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";

export type ActionResult = { error?: string };

const PATH = "/finance/payments";

// Mirrors sendInvoiceAction / receivePurchaseOrderAction's transactional shape: one journal
// entry posted alongside the paidAmount/status update, in the same transaction, so a failure
// partway through never leaves the payment recorded without its ledger impact (or vice versa).
export async function recordPaymentAction(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const direction = String(formData.get("direction") ?? "");
  const sourceId = Number(formData.get("sourceId"));
  const bankAccountId = Number(formData.get("bankAccountId"));
  const amount = Number(formData.get("amount"));
  const paymentDate = String(formData.get("paymentDate") ?? "");
  const method = String(formData.get("method") ?? "") || null;
  const reference = String(formData.get("reference") ?? "").trim() || null;

  if (direction !== "in" && direction !== "out") return { error: "Invalid payment direction." };
  if (!sourceId) return { error: direction === "in" ? "Choose an invoice." : "Choose a purchase order." };
  if (!bankAccountId) return { error: "Choose a bank account." };
  if (!paymentDate) return { error: "Payment date is required." };
  if (!amount || amount <= 0) return { error: "Amount must be greater than zero." };

  const [bankAccount] = await db
    .select()
    .from(bankAccountsTable)
    .where(and(eq(bankAccountsTable.id, bankAccountId), eq(bankAccountsTable.orgId, session.orgId)));
  if (!bankAccount) return { error: "Bank account not found." };

  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, session.orgId));
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  if (direction === "in") {
    const [invoice] = await db
      .select()
      .from(salesInvoicesTable)
      .where(and(eq(salesInvoicesTable.id, sourceId), eq(salesInvoicesTable.orgId, session.orgId)));
    if (!invoice) return { error: "Invoice not found." };
    if (invoice.status !== "sent" && invoice.status !== "partially_paid") {
      return { error: "Only sent or partially paid invoices can receive a payment." };
    }
    const balance = Number(invoice.total) - Number(invoice.paidAmount);
    if (amount > balance + 0.005) return { error: "Amount cannot exceed the remaining balance." };

    const ar = byCode.get("1100");
    if (!ar) return { error: "Chart of accounts is missing a required system account (1100)." };

    const newPaid = (Number(invoice.paidAmount) + amount).toFixed(2);
    const newStatus = Number(newPaid) >= Number(invoice.total) - 0.005 ? "paid" : "partially_paid";

    await db.transaction(async (tx) => {
      const [payment] = await tx
        .insert(paymentsTable)
        .values({
          orgId: session.orgId,
          direction: "in",
          bankAccountId,
          amount: amount.toFixed(2),
          paymentDate,
          method,
          reference,
          salesInvoiceId: invoice.id,
          createdById: session.userId,
        })
        .returning({ id: paymentsTable.id });

      const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          orgId: session.orgId,
          entryDate: paymentDate,
          memo: `Payment received for invoice ${invoice.invoiceNumber}`,
          sourceType: "payment",
          sourceId: payment.id,
          createdById: session.userId,
        })
        .returning({ id: journalEntriesTable.id });

      await tx.insert(journalLinesTable).values([
        { journalEntryId: entry.id, accountId: bankAccount.glAccountId, debit: amount.toFixed(2), credit: "0" },
        { journalEntryId: entry.id, accountId: ar.id, debit: "0", credit: amount.toFixed(2) },
      ]);

      await tx
        .update(salesInvoicesTable)
        .set({ paidAmount: newPaid, status: newStatus, updatedAt: new Date() })
        .where(eq(salesInvoicesTable.id, invoice.id));
    });

    await logActivity(session, {
      type: "payment.recorded",
      description: `Recorded a payment of ${amount.toFixed(2)} for invoice ${invoice.invoiceNumber}`,
      entityType: "payment",
      entityId: invoice.id,
    });
    revalidatePath(PATH);
    revalidatePath("/finance/bank-accounts");
    revalidatePath("/finance/chart-of-accounts");
    revalidatePath("/finance/ledger");
    revalidatePath("/finance/reports");
    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/invoices/${invoice.id}`);
    revalidatePath("/dashboard");
    return {};
  }

  const [po] = await db
    .select()
    .from(purchaseOrdersTable)
    .where(and(eq(purchaseOrdersTable.id, sourceId), eq(purchaseOrdersTable.orgId, session.orgId)));
  if (!po) return { error: "Purchase order not found." };
  if (po.status !== "received") return { error: "Only received purchase orders can be paid." };
  const balance = Number(po.total) - Number(po.paidAmount);
  if (amount > balance + 0.005) return { error: "Amount cannot exceed the remaining balance." };

  const ap = byCode.get("2000");
  if (!ap) return { error: "Chart of accounts is missing a required system account (2000)." };

  const newPaid = (Number(po.paidAmount) + amount).toFixed(2);

  await db.transaction(async (tx) => {
    const [payment] = await tx
      .insert(paymentsTable)
      .values({
        orgId: session.orgId,
        direction: "out",
        bankAccountId,
        amount: amount.toFixed(2),
        paymentDate,
        method,
        reference,
        purchaseOrderId: po.id,
        createdById: session.userId,
      })
      .returning({ id: paymentsTable.id });

    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        orgId: session.orgId,
        entryDate: paymentDate,
        memo: `Payment made for purchase order ${po.poNumber}`,
        sourceType: "payment",
        sourceId: payment.id,
        createdById: session.userId,
      })
      .returning({ id: journalEntriesTable.id });

    await tx.insert(journalLinesTable).values([
      { journalEntryId: entry.id, accountId: ap.id, debit: amount.toFixed(2), credit: "0" },
      { journalEntryId: entry.id, accountId: bankAccount.glAccountId, debit: "0", credit: amount.toFixed(2) },
    ]);

    await tx.update(purchaseOrdersTable).set({ paidAmount: newPaid, updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, po.id));
  });

  await logActivity(session, {
    type: "payment.recorded",
    description: `Recorded a payment of ${amount.toFixed(2)} for purchase order ${po.poNumber}`,
    entityType: "payment",
    entityId: po.id,
  });
  revalidatePath(PATH);
  revalidatePath("/finance/bank-accounts");
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/purchasing/orders");
  revalidatePath(`/purchasing/orders/${po.id}`);
  revalidatePath("/dashboard");
  return {};
}
