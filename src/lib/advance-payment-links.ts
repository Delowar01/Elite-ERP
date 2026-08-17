import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, advanceApplicationsTable, salesInvoicesTable, customersTable } from "@/db";

/**
 * Which sales invoices an advance receipt has settled — from ALLOCATIONS, not from
 * `payments.salesInvoiceId`.
 *
 * That field could only ever say "all of this receipt went to that one invoice". A partial draw
 * never set it, and an advance split across two invoices could not be expressed at all, so every
 * reader that walked payment → invoice under-reported the moment partial allocation shipped — and
 * would report NOTHING once the field is cleared for advance receipts.
 *
 * Readers that only need something to NAME (a payments register column, a printed receipt's
 * "against Invoice X") take the representative link: the most recent allocation, plus how many
 * invoices this receipt has settled in total, so "and 2 more" can be said honestly rather than one
 * invoice being shown as though it were the whole story.
 */
export type AdvanceInvoiceLink = {
  invoiceId: number;
  invoiceNumber: string;
  customerId: number;
  customerName: string | null;
  /** How many distinct invoices this receipt currently settles. */
  invoiceCount: number;
};

export async function advanceInvoiceLinks(
  orgId: number,
  paymentIds: number[],
): Promise<Map<number, AdvanceInvoiceLink>> {
  const out = new Map<number, AdvanceInvoiceLink>();
  if (paymentIds.length === 0) return out;

  const rows = await db
    .select({
      allocationId: advanceApplicationsTable.id,
      paymentId: advanceApplicationsTable.advancePaymentId,
      invoiceId: salesInvoicesTable.id,
      invoiceNumber: salesInvoicesTable.invoiceNumber,
      customerId: salesInvoicesTable.customerId,
      customerName: customersTable.name,
    })
    .from(advanceApplicationsTable)
    .innerJoin(salesInvoicesTable, eq(salesInvoicesTable.id, advanceApplicationsTable.salesInvoiceId))
    .leftJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
    .where(and(
      eq(advanceApplicationsTable.orgId, orgId),
      inArray(advanceApplicationsTable.advancePaymentId, paymentIds),
      isNull(advanceApplicationsTable.releasedAt),
    ))
    .orderBy(advanceApplicationsTable.id);

  const seen = new Map<number, Set<number>>();
  for (const r of rows) {
    const invoices = seen.get(r.paymentId) ?? new Set<number>();
    invoices.add(r.invoiceId);
    seen.set(r.paymentId, invoices);
    // Later rows win, so the representative is the MOST RECENT allocation.
    out.set(r.paymentId, {
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      customerId: r.customerId,
      customerName: r.customerName,
      invoiceCount: invoices.size,
    });
  }
  for (const [paymentId, invoices] of seen) {
    const link = out.get(paymentId);
    if (link) out.set(paymentId, { ...link, invoiceCount: invoices.size });
  }
  return out;
}

/**
 * The payment ids that settle a given invoice through an active allocation — the inverse walk, for
 * a reader that starts at the invoice (its payment history).
 */
export async function advancePaymentIdsForInvoice(orgId: number, salesInvoiceId: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ paymentId: advanceApplicationsTable.advancePaymentId })
    .from(advanceApplicationsTable)
    .where(and(
      eq(advanceApplicationsTable.orgId, orgId),
      eq(advanceApplicationsTable.salesInvoiceId, salesInvoiceId),
      isNull(advanceApplicationsTable.releasedAt),
    ));
  return rows.map((r) => r.paymentId);
}

/**
 * Base-currency cash attributable to a project through applied advances.
 *
 * An allocation's `carriedBase` IS the base cash that was received and is now settling this
 * invoice, so project cash-in reads allocations rather than the receipt's own invoice link. The
 * ordinary-payment query alongside this one excludes `advance_receipt` explicitly, so the two never
 * double-count — before the clearing migration OR after it.
 */
export function projectAdvanceCashSql(orgId: number, projectId: number) {
  return sql`
    select a.id, p.reference, a.applied_date as date, a.carried_base::text as amount,
           i.invoice_number, c.name as party
      from advance_applications a
      join sales_invoices i on i.id = a.sales_invoice_id
      join payments p on p.id = a.advance_payment_id
      left join customers c on c.id = i.customer_id
     where a.org_id = ${orgId} and a.released_at is null and i.project_id = ${projectId}
       and i.archived_at is null and i.deleted_at is null`;
}
