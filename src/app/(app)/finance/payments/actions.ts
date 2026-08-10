"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import {
  db,
  paymentsTable,
  salesInvoicesTable,
  proformaInvoicesTable,
  purchaseOrdersTable,
  bankAccountsTable,
  accountsTable,
  journalEntriesTable,
  journalLinesTable,
} from "@/db";
import { requireSession, requireRole } from "@/lib/session";
import { moneyEpsilon, roundMoney } from "@/lib/currency/currencies";
import { logActivity } from "@/lib/activity";
import { recordAudit } from "@/lib/security/audit";

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
  const notes = String(formData.get("notes") ?? "").trim() || null;
  // "invoice" | "proforma" | "po". Defaulted from direction for backward compatibility.
  const sourceType = String(formData.get("sourceType") ?? "") || (direction === "in" ? "invoice" : "po");

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

  // Payment against a Proforma Invoice (Issue #14) — same accounting shape as an invoice payment
  // (Dr bank / Cr Accounts Receivable), a single journal entry, updating the proforma's paidAmount.
  if (direction === "in" && sourceType === "proforma") {
    const [pf] = await db
      .select()
      .from(proformaInvoicesTable)
      .where(and(eq(proformaInvoicesTable.id, sourceId), eq(proformaInvoicesTable.orgId, session.orgId)));
    if (!pf) return { error: "Proforma invoice not found." };
    if (pf.convertedInvoiceId) return { error: "This proforma has been converted — record payments on the sales invoice instead." };
    if (pf.status !== "sent") return { error: "Only sent proforma invoices can receive a payment." };
    // Rounding and tolerance follow the DOCUMENT's currency; the journal lines below follow the
    // organization's base currency, because the general ledger only ever holds base amounts.
    const docCurrency = pf.currency ?? session.orgCurrency;
    const eps = moneyEpsilon(docCurrency);
    const balance = Number(pf.total) - Number(pf.paidAmount);
    if (amount > balance + eps) return { error: "Amount cannot exceed the remaining balance." };

    const ar = byCode.get("1100");
    if (!ar) return { error: "Chart of accounts is missing a required system account (1100)." };

    const newPaid = roundMoney(Number(pf.paidAmount) + amount, docCurrency);
    const paymentId = await db.transaction(async (tx) => {
      const [payment] = await tx
        .insert(paymentsTable)
        .values({
          orgId: session.orgId,
          direction: "in",
          bankAccountId,
          amount: roundMoney(amount, docCurrency),
          paymentDate,
          method,
          reference,
          notes,
          proformaInvoiceId: pf.id,
          createdById: session.userId,
        })
        .returning({ id: paymentsTable.id });

      const [entry] = await tx
        .insert(journalEntriesTable)
        .values({
          orgId: session.orgId,
          entryDate: paymentDate,
          memo: `Payment received for proforma ${pf.proformaNumber}`,
          sourceType: "payment",
          sourceId: payment.id,
          createdById: session.userId,
        })
        .returning({ id: journalEntriesTable.id });

      await tx.insert(journalLinesTable).values([
        // The ledger holds BASE currency only, so these two round at the base minor unit. Converting a
        // foreign payment to base is FX-6/FX-7's job and is not done here — today the amount is
        // posted as-is, exactly as it was before this change.
        { journalEntryId: entry.id, accountId: bankAccount.glAccountId, debit: roundMoney(amount, session.orgCurrency), credit: "0" },
        { journalEntryId: entry.id, accountId: ar.id, debit: "0", credit: roundMoney(amount, session.orgCurrency) },
      ]);

      await tx.update(proformaInvoicesTable).set({ paidAmount: newPaid, updatedAt: new Date() }).where(eq(proformaInvoicesTable.id, pf.id));
      return payment.id;
    });

    await logActivity(session, { type: "payment.recorded", description: `Recorded a payment of ${roundMoney(amount, docCurrency)} for proforma ${pf.proformaNumber}`, entityType: "payment", entityId: paymentId });
    await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
      action: "payment.created", entityType: "payment", entityId: paymentId,
      newValue: { amount: roundMoney(amount, docCurrency), proformaInvoiceId: pf.id, bankAccountId, method },
    });
    revalidatePath(PATH);
    revalidatePath("/finance/bank-accounts");
    revalidatePath("/finance/chart-of-accounts");
    revalidatePath("/finance/ledger");
    revalidatePath("/finance/reports");
    revalidatePath("/sales/proforma");
    revalidatePath(`/sales/proforma/${pf.id}`);
    revalidatePath("/dashboard");
    return {};
  }

  if (direction === "in") {
    const [invoice] = await db
      .select()
      .from(salesInvoicesTable)
      .where(and(eq(salesInvoicesTable.id, sourceId), eq(salesInvoicesTable.orgId, session.orgId)));
    if (!invoice) return { error: "Invoice not found." };
    if (invoice.status !== "sent" && invoice.status !== "partially_paid") {
      return { error: "Only sent or partially paid invoices can receive a payment." };
    }
    const docCurrency = invoice.currency ?? session.orgCurrency;
    const eps = moneyEpsilon(docCurrency);
    const balance = Number(invoice.total) - Number(invoice.paidAmount);
    if (amount > balance + eps) return { error: "Amount cannot exceed the remaining balance." };

    const ar = byCode.get("1100");
    if (!ar) return { error: "Chart of accounts is missing a required system account (1100)." };

    const newPaid = roundMoney(Number(invoice.paidAmount) + amount, docCurrency);
    const newStatus = Number(newPaid) >= Number(invoice.total) - eps ? "paid" : "partially_paid";

    const invPaymentId = await db.transaction(async (tx) => {
      const [payment] = await tx
        .insert(paymentsTable)
        .values({
          orgId: session.orgId,
          direction: "in",
          bankAccountId,
          amount: roundMoney(amount, docCurrency),
          paymentDate,
          method,
          reference,
          notes,
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
        // The ledger holds BASE currency only, so these two round at the base minor unit. Converting
        // a foreign payment to base is FX-6/FX-7's job and is not done here — today the amount is
        // posted as-is, exactly as it was before this change.
        { journalEntryId: entry.id, accountId: bankAccount.glAccountId, debit: roundMoney(amount, session.orgCurrency), credit: "0" },
        { journalEntryId: entry.id, accountId: ar.id, debit: "0", credit: roundMoney(amount, session.orgCurrency) },
      ]);

      await tx
        .update(salesInvoicesTable)
        .set({ paidAmount: newPaid, status: newStatus, updatedAt: new Date() })
        .where(eq(salesInvoicesTable.id, invoice.id));
      return payment.id;
    });

    await logActivity(session, {
      type: "payment.recorded",
      description: `Recorded a payment of ${roundMoney(amount, docCurrency)} for invoice ${invoice.invoiceNumber}`,
      entityType: "payment",
      entityId: invPaymentId,
    });
    await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
      action: "payment.created", entityType: "payment", entityId: invPaymentId,
      newValue: { amount: roundMoney(amount, docCurrency), salesInvoiceId: invoice.id, bankAccountId, method },
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
  const poCurrency = po.currency ?? session.orgCurrency;
  const poEps = moneyEpsilon(poCurrency);
  const balance = Number(po.total) - Number(po.paidAmount);
  if (amount > balance + poEps) return { error: "Amount cannot exceed the remaining balance." };

  const ap = byCode.get("2000");
  if (!ap) return { error: "Chart of accounts is missing a required system account (2000)." };

  const newPaid = roundMoney(Number(po.paidAmount) + amount, poCurrency);

  const poPaymentId = await db.transaction(async (tx) => {
    const [payment] = await tx
      .insert(paymentsTable)
      .values({
        orgId: session.orgId,
        direction: "out",
        bankAccountId,
        amount: roundMoney(amount, poCurrency),
        paymentDate,
        method,
        reference,
        notes,
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
      // The ledger holds BASE currency only, so these two round at the base minor unit. Converting
      // a foreign payment to base is FX-6/FX-7's job and is not done here — today the amount is
      // posted as-is, exactly as it was before this change.
      { journalEntryId: entry.id, accountId: ap.id, debit: roundMoney(amount, session.orgCurrency), credit: "0" },
      { journalEntryId: entry.id, accountId: bankAccount.glAccountId, debit: "0", credit: roundMoney(amount, session.orgCurrency) },
    ]);

    await tx.update(purchaseOrdersTable).set({ paidAmount: newPaid, updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, po.id));
    return payment.id;
  });

  await logActivity(session, {
    type: "payment.recorded",
    description: `Recorded a payment of ${roundMoney(amount, poCurrency)} for purchase order ${po.poNumber}`,
    entityType: "payment",
    entityId: poPaymentId,
  });
  await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
    action: "payment.created", entityType: "payment", entityId: poPaymentId,
    newValue: { amount: roundMoney(amount, poCurrency), purchaseOrderId: po.id, bankAccountId, method },
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

// Delete a payment and reverse its accounting in one transaction: remove the payment's journal
// entry + lines, decrement the source document's paidAmount (recomputing an invoice's status), then
// delete the payment. Gated to owner/admin (deleting financial records) and audit-logged.
export async function deletePaymentAction(paymentId: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.orgId, session.orgId)));
  if (!payment) return { error: "Payment not found." };

  const amt = Number(payment.amount);

  await db.transaction(async (tx) => {
    // Remove the single journal posting for this payment.
    const entries = await tx
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.orgId, session.orgId), eq(journalEntriesTable.sourceType, "payment"), eq(journalEntriesTable.sourceId, payment.id)));
    for (const e of entries) {
      await tx.delete(journalLinesTable).where(eq(journalLinesTable.journalEntryId, e.id));
      await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, e.id));
    }

    if (payment.salesInvoiceId) {
      const [inv] = await tx.select().from(salesInvoicesTable).where(eq(salesInvoicesTable.id, payment.salesInvoiceId));
      if (inv) {
        // Each document is un-paid in ITS OWN currency, so both the rounding and the two status
        // thresholds come from that document rather than from a fixed half-cent.
        const c = inv.currency ?? session.orgCurrency;
        const e = moneyEpsilon(c);
        const newPaid = roundMoney(Math.max(0, Number(inv.paidAmount) - amt), c);
        const newStatus = Number(newPaid) <= e ? "sent" : Number(newPaid) >= Number(inv.total) - e ? "paid" : "partially_paid";
        await tx.update(salesInvoicesTable).set({ paidAmount: newPaid, status: newStatus, updatedAt: new Date() }).where(eq(salesInvoicesTable.id, inv.id));
      }
    } else if (payment.proformaInvoiceId) {
      const [pf] = await tx.select().from(proformaInvoicesTable).where(eq(proformaInvoicesTable.id, payment.proformaInvoiceId));
      if (pf) {
        const newPaid = roundMoney(Math.max(0, Number(pf.paidAmount) - amt), pf.currency ?? session.orgCurrency);
        await tx.update(proformaInvoicesTable).set({ paidAmount: newPaid, updatedAt: new Date() }).where(eq(proformaInvoicesTable.id, pf.id));
      }
    } else if (payment.purchaseOrderId) {
      const [po] = await tx.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, payment.purchaseOrderId));
      if (po) {
        const newPaid = roundMoney(Math.max(0, Number(po.paidAmount) - amt), po.currency ?? session.orgCurrency);
        await tx.update(purchaseOrdersTable).set({ paidAmount: newPaid, updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, po.id));
      }
    }

    await tx.delete(paymentsTable).where(eq(paymentsTable.id, payment.id));
  });

  await logActivity(session, { type: "payment.deleted", description: `Deleted a payment of ${roundMoney(amt, session.orgCurrency)}`, entityType: "payment", entityId: payment.id });
  await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
    action: "payment.deleted", entityType: "payment", entityId: payment.id,
    previousValue: { amount: payment.amount, salesInvoiceId: payment.salesInvoiceId, proformaInvoiceId: payment.proformaInvoiceId, purchaseOrderId: payment.purchaseOrderId },
  });
  revalidatePath(PATH);
  revalidatePath("/finance/bank-accounts");
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/sales/invoices");
  revalidatePath("/sales/proforma");
  revalidatePath("/purchasing/orders");
  revalidatePath("/dashboard");
  return {};
}
