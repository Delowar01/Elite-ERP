"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import {
  db, salesInvoicesTable, proformaInvoicesTable, paymentsTable, accountsTable,
  journalEntriesTable, journalLinesTable, advanceApplicationsTable,
} from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { recordAudit } from "@/lib/security/audit";
import { moneyEpsilon, roundMoney } from "@/lib/currency/currencies";
import {
  lockAdvanceAndReadPot, planAllocations, availabilityOf,
  sameCustomerRefusal, sameCurrencyRefusal,
} from "@/lib/advance-allocations";

export type ActionResult = { error?: string };

/**
 * Apply an available customer advance to an EXISTING sales invoice (§3/§4).
 *
 * Conversion consumes the advances of its own proforma; this is the other half — an advance that
 * outlived its proforma, or was never fully drawn, settling a later invoice for the same customer.
 * It is the same engine (`planAllocations`) under the same lock, so both paths produce identical
 * accounting; what differs is that NOTHING holds by construction here. At conversion the invoice
 * IS the proforma, so same-customer and same-currency are free; here both must be enforced, and a
 * refusal has to explain itself rather than silently offering a shorter list.
 *
 * ## Permission gate
 *
 * `requireSession()` — the same gate as `recordPaymentAction`, deliberately. Applying an advance
 * is the settlement of an invoice against money already received; it moves no cash, creates no new
 * liability, and produces a journal of exactly the same significance as recording a payment, which
 * every role including staff may do. The restricted tier (owner/admin, per the role matrix) is for
 * REMOVING financial history — deleting a payment, refunding an advance — and this adds history
 * rather than removing it. Releasing an allocation, when that lands, belongs on the restricted
 * tier for the same reason.
 *
 * ## Double submit
 *
 * Two safeguards, and the server one is load-bearing. The confirm provider's `execute()` holds a
 * `running` ref and returns early while a call is in flight, so the dialog cannot fire twice — but
 * that is a UI guard and a replayed request ignores it. On the server the advance row is locked
 * and availability recomputed INSIDE the lock, so a second request either finds less available (and
 * applies only what is left) or finds none (and refuses). Multiple allocations from one advance to
 * one invoice are legitimate — 2,000 now, 3,000 later — so a duplicate cannot be rejected as such;
 * what is guaranteed is that two submissions can never over-apply the advance.
 */
export async function applyAdvanceToInvoiceAction(
  invoiceId: number,
  advancePaymentId: number,
  requestedAmount: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!Number.isInteger(invoiceId) || !Number.isInteger(advancePaymentId)) return { error: "Invalid request." };
  const amount = Number(requestedAmount);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };

  const [invoice] = await db
    .select()
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.id, invoiceId), eq(salesInvoicesTable.orgId, session.orgId)));
  if (!invoice) return { error: "Invoice not found." };
  // Only a POSTED, unsettled invoice has AR to clear. A draft has not created a receivable, and a
  // void one's receivable was reversed.
  if (invoice.status !== "sent" && invoice.status !== "partially_paid") {
    return { error: "Only a sent or partially paid invoice can have an advance applied to it." };
  }

  const [receipt] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.id, advancePaymentId), eq(paymentsTable.orgId, session.orgId)));
  if (!receipt || receipt.kind !== "advance_receipt") return { error: "Customer advance not found." };
  const [pf] = receipt.proformaInvoiceId
    ? await db.select().from(proformaInvoicesTable).where(and(
        eq(proformaInvoicesTable.id, receipt.proformaInvoiceId), eq(proformaInvoicesTable.orgId, session.orgId)))
    : [];
  if (!pf) return { error: "This advance has no originating proforma, so its client cannot be established." };

  // §5 and the same-currency rule — the two invariants that are free at conversion and are not here.
  const party = sameCustomerRefusal(pf.customerId, invoice.customerId);
  if (party) return { error: party };
  const cur = sameCurrencyRefusal(receipt.currency, invoice.currency, session.orgCurrency);
  if (cur) return { error: cur };

  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, session.orgId));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  if (!byCode.get("2300")) return { error: "Chart of accounts is missing a required system account (2300 Customer Advances)." };
  if (!byCode.get("1100")) return { error: "Chart of accounts is missing a required system account (1100)." };

  const docCurrency = invoice.currency ?? session.orgCurrency;
  const eps = moneyEpsilon(docCurrency);
  const today = new Date().toISOString().slice(0, 10);

  const outcome = await db.transaction(async (tx) => {
    const locked = await lockAdvanceAndReadPot(tx, { orgId: session.orgId, advancePaymentId });
    if (!locked) {
      return { error: "This advance has no stored base-currency value (it was recorded before currency capture), so it cannot be applied. Delete and re-record it first." } as const;
    }
    // Availability is read INSIDE the lock — the whole point of holding it. Two requests racing for
    // the same 2,000 serialise here, and the loser sees what the winner left.
    const { availableAmount } = availabilityOf(locked.pot, session.orgCurrency);
    if (Number(availableAmount) <= eps) {
      return { error: "This advance has no available balance left to apply." } as const;
    }
    if (amount > Number(availableAmount) + eps) {
      return { error: `Only ${availableAmount} of this advance is still available.` } as const;
    }
    // Re-read the invoice under the same transaction: its paid figures may have moved since the
    // outer read, and over-applying an invoice is as wrong as over-drawing an advance.
    const [live] = await tx
      .select({
        total: salesInvoicesTable.total, paidAmount: salesInvoicesTable.paidAmount,
        basePaidAmount: salesInvoicesTable.basePaidAmount, baseTotal: salesInvoicesTable.baseTotal,
        exchangeRate: salesInvoicesTable.exchangeRate, currency: salesInvoicesTable.currency,
        invoiceNumber: salesInvoicesTable.invoiceNumber,
      })
      .from(salesInvoicesTable)
      .where(and(eq(salesInvoicesTable.id, invoiceId), eq(salesInvoicesTable.orgId, session.orgId)));
    const due = Number(live.total) - Number(live.paidAmount);
    if (due <= eps) return { error: "This invoice has nothing left outstanding." } as const;
    if (amount > due + eps) return { error: `Only ${roundMoney(due, docCurrency)} is still outstanding on this invoice.` } as const;

    // The requested figure is an explicit CAP on the plan. It must not be imposed by shrinking the
    // invoice total, because the total also decides whether this draw closes the invoice.
    const planned = planAllocations({
      pots: [{ paymentId: advancePaymentId, pot: locked.pot }],
      limitAmount: roundMoney(amount, docCurrency),
      invoice: {
        currency: live.currency, exchangeRate: live.exchangeRate, baseTotal: live.baseTotal,
        basePaidAmount: live.basePaidAmount, total: live.total, paidAmount: live.paidAmount,
      },
      baseCurrency: session.orgCurrency,
      advancesAccountId: byCode.get("2300")!.id,
      arAccountId: byCode.get("1100")!.id,
      fxAccountId: byCode.get("4900")?.id ?? null,
    });
    if (!planned.ok) return { error: planned.error } as const;
    if (planned.plan.length === 0) return { error: "Nothing could be applied." } as const;
    const step = planned.plan[0];

    const [alloc] = await tx
      .insert(advanceApplicationsTable)
      .values({
        orgId: session.orgId,
        advancePaymentId,
        salesInvoiceId: invoiceId,
        appliedAmount: step.appliedAmount,
        carriedBase: step.carriedBase,
        arCleared: step.arCleared,
        appliedDate: today,
        createdById: session.userId,
      })
      .returning({ id: advanceApplicationsTable.id });
    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        orgId: session.orgId,
        entryDate: today,
        memo: `Advance applied to invoice ${live.invoiceNumber} (received against proforma ${pf.proformaNumber})`,
        sourceType: "advance_application",
        sourceId: alloc.id,
        createdById: session.userId,
      })
      .returning({ id: journalEntriesTable.id });
    await tx.insert(journalLinesTable).values(step.lines.map((l) => ({ journalEntryId: entry.id, ...l })));

    const newPaid = roundMoney(Number(live.paidAmount) + Number(step.appliedAmount), docCurrency);
    const newBasePaid = live.basePaidAmount === null
      ? null
      : roundMoney(Number(live.basePaidAmount) + Number(step.arCleared), session.orgCurrency);
    const newStatus = Number(newPaid) >= Number(live.total) - eps ? "paid" : "partially_paid";
    await tx
      .update(salesInvoicesTable)
      .set({ paidAmount: newPaid, basePaidAmount: newBasePaid, status: newStatus, updatedAt: new Date() })
      .where(eq(salesInvoicesTable.id, invoiceId));

    return { applied: step.appliedAmount, carriedBase: step.carriedBase, arCleared: step.arCleared, allocationId: alloc.id, invoiceNumber: live.invoiceNumber } as const;
  });

  if ("error" in outcome) return { error: outcome.error };

  await logActivity(session, {
    type: "payment.recorded",
    description: `Applied a customer advance of ${outcome.applied} to invoice ${outcome.invoiceNumber}`,
    entityType: "sales_invoice",
    entityId: invoiceId,
  });
  await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
    action: "payment.transferred", entityType: "sales_invoice", entityId: invoiceId,
    newValue: {
      allocationId: outcome.allocationId, advancePaymentId,
      applied: outcome.applied, carriedBase: outcome.carriedBase, arCleared: outcome.arCleared,
    },
  });
  revalidatePath("/sales/invoices");
  revalidatePath(`/sales/invoices/${invoiceId}`);
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/dashboard");
  return {};
}

export type AvailableAdvance = {
  paymentId: number;
  proformaNumber: string;
  reference: string | null;
  paymentDate: string;
  currency: string | null;
  available: string;
  /** Null when this advance is eligible; otherwise why it cannot be applied to THIS invoice. */
  ineligibleReason: string | null;
};

/**
 * The customer's advances with a remaining balance, for the Apply dialog.
 *
 * Ineligible ones are RETURNED WITH THEIR REASON rather than filtered away: a user holding a USD
 * advance who opens a SAR invoice must be told why it is not offered, not shown an empty list and
 * left to guess. Cross-currency application is a known limitation — lifting it needs a rate policy
 * and a redefinition of what `paidAmount` means on a foreign invoice.
 */
export async function listAvailableAdvancesForInvoice(invoiceId: number): Promise<AvailableAdvance[]> {
  // Every export of a "use server" module is callable by anyone holding its action id, so the org
  // comes from the SESSION and never from an argument — taking it as a parameter would let a
  // crafted request read another tenant's advances.
  const session = await requireSession();
  const orgId = session.orgId;
  const baseCurrency = session.orgCurrency;
  const [invoice] = await db
    .select({ customerId: salesInvoicesTable.customerId, currency: salesInvoicesTable.currency })
    .from(salesInvoicesTable)
    .where(and(eq(salesInvoicesTable.id, invoiceId), eq(salesInvoicesTable.orgId, orgId)));
  if (!invoice) return [];

  const rows = await db
    .select({
      paymentId: paymentsTable.id,
      amount: paymentsTable.amount,
      currency: paymentsTable.currency,
      reference: paymentsTable.reference,
      paymentDate: paymentsTable.paymentDate,
      proformaNumber: proformaInvoicesTable.proformaNumber,
      customerId: proformaInvoicesTable.customerId,
      allocated: sql<string>`coalesce((
        select sum(a.applied_amount) from advance_applications a
         where a.org_id = ${orgId} and a.advance_payment_id = ${paymentsTable.id} and a.released_at is null), 0)::text`,
      refunded: sql<string>`coalesce((
        select sum(r.amount) from payments r
         where r.org_id = ${orgId} and r.refunds_payment_id = ${paymentsTable.id}), 0)::text`,
    })
    .from(paymentsTable)
    .innerJoin(proformaInvoicesTable, eq(proformaInvoicesTable.id, paymentsTable.proformaInvoiceId))
    .where(and(
      eq(paymentsTable.orgId, orgId),
      eq(paymentsTable.kind, "advance_receipt"),
      eq(proformaInvoicesTable.customerId, invoice.customerId),
    ))
    .orderBy(paymentsTable.paymentDate, paymentsTable.id);

  const out: AvailableAdvance[] = [];
  for (const r of rows) {
    const docCurrency = r.currency ?? baseCurrency;
    const available = roundMoney(Math.max(0, Number(r.amount) - Number(r.allocated) - Number(r.refunded)), docCurrency);
    if (Number(available) <= moneyEpsilon(docCurrency)) continue; // nothing left — not worth showing
    out.push({
      paymentId: r.paymentId,
      proformaNumber: r.proformaNumber,
      reference: r.reference,
      paymentDate: String(r.paymentDate).slice(0, 10),
      currency: r.currency,
      available,
      ineligibleReason: sameCurrencyRefusal(r.currency, invoice.currency, baseCurrency),
    });
  }
  return out;
}
