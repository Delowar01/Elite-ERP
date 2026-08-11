"use server";

import { revalidatePath } from "next/cache";
import { sanitizeIfHtml } from "@/lib/sanitize-html";
import { normalizeDocumentTerms, type DocumentTerm } from "../_shared/document-terms";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, customersTable, proformaInvoicesTable, proformaInvoiceItemsTable, salesInvoicesTable, salesInvoiceItemsTable, deliveryChallansTable, deliveryChallanItemsTable, paymentsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { recordAudit } from "@/lib/security/audit";
import { nextDocumentNumber } from "@/lib/documents";
import { can } from "@/lib/document-lifecycle";
import { computeTotals, type LineItemInput } from "../_shared/totals";
import { persistDocumentAttachments, type AttachmentInput } from "../_shared/attachment-persist";
import { snapshotDocumentBankAccounts } from "@/lib/document-bank-data";
import { snapshotSealForDoc, applySealOverride } from "@/lib/doc-seal";
import { moneyEpsilon, normalizeDocCurrency, roundMoney } from "@/lib/currency/currencies";

export type ActionResult = { error?: string; id?: number };

const PATH = "/sales/proforma";
const VALID_STATUSES = ["draft", "sent"];

type LineInput = { productId: string; description: string; quantity: string; unitPrice: string; taxRatePercent: string; imageUrl?: string; unit?: string; customFields?: Record<string, string> };

export async function createProformaAction(
  input: {
    title: string;
    customerId: string;
    issueDate: string;
    discount: string;
    notes: string; terms?: DocumentTerm[];
    items: LineInput[];
    attachments?: AttachmentInput[];
    bankAccountIds?: number[];
    currency?: string;
    sealUrl?: string;
    signatureUrl?: string;
  },
  andSend = false,
): Promise<ActionResult> {
  const session = await requireSession();
  const customerId = Number(input.customerId);
  if (!customerId) return { error: "Choose a client." };
  const [customerOwned] = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.orgId, session.orgId)));
  if (!customerOwned) return { error: "Client not found." };
  if (!input.issueDate) return { error: "Issue date is required." };

  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };

  const currency = normalizeDocCurrency(input.currency) ?? session.orgCurrency;
  const totals = computeTotals(items as LineItemInput[], input.discount, currency);
  const bankAccounts = await snapshotDocumentBankAccounts(session.orgId, input.bankAccountIds);
  const seal = applySealOverride(await snapshotSealForDoc(db, session.orgId, "proforma_invoice"), { sealUrl: input.sealUrl, signatureUrl: input.signatureUrl });

  const id = await db.transaction(async (tx) => {
    const proformaNumber = await nextDocumentNumber(tx, session.orgId, "proforma_invoice");
    const [pf] = await tx
      .insert(proformaInvoicesTable)
      .values({
        orgId: session.orgId,
        proformaNumber,
        title: input.title.trim() || null,
        customerId,
        issueDate: input.issueDate,
        notes: sanitizeIfHtml(input.notes) || null,
        terms: normalizeDocumentTerms(input.terms),
        bankAccounts,
        currency: normalizeDocCurrency(input.currency),
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        sealUrl: seal.sealUrl,
        signatureUrl: seal.signatureUrl,
        createdById: session.userId,
      })
      .returning({ id: proformaInvoicesTable.id });

    await tx.insert(proformaInvoiceItemsTable).values(
      items.map((l) => ({
        proformaInvoiceId: pf.id,
        productId: l.productId ? Number(l.productId) : null,
        imageUrl: l.imageUrl || null,
        unit: l.unit || null,
        customFields: l.customFields ?? {},
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: roundMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), currency),
      })),
    );
    await persistDocumentAttachments(tx, session.orgId, session.userId, "proforma_invoice", pf.id, input.attachments);

    return pf.id;
  });

  await logActivity(session, { type: "proforma_invoice.created", description: "Created a proforma invoice", entityType: "proforma_invoice", entityId: id });
  if (andSend) {
    await updateProformaStatusAction(id, "sent");
  }
  revalidatePath(PATH);
  redirect(`/sales/proforma/${id}`);
}

// Batch A2 — draft-only edit. Preserves number/org/status/source links; recomputes totals server-side.
export async function updateProformaAction(
  id: number,
  input: { title: string; customerId: string; issueDate: string; discount: string; notes: string; terms?: DocumentTerm[]; items: LineInput[]; attachments?: AttachmentInput[]; bankAccountIds?: number[]; currency?: string; sealUrl?: string; signatureUrl?: string },
): Promise<ActionResult> {
  const session = await requireSession();
  const [existing] = await db.select().from(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.orgId, session.orgId)));
  if (!existing) return { error: "Proforma invoice not found." };
  if (!can("proforma_invoice", existing.status, "edit")) return { error: "Only draft proforma invoices can be edited." };

  const customerId = Number(input.customerId);
  if (!customerId) return { error: "Choose a client." };
  const [customerOwned] = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.id, customerId), eq(customersTable.orgId, session.orgId)));
  if (!customerOwned) return { error: "Client not found." };
  if (!input.issueDate) return { error: "Issue date is required." };
  const items = input.items.filter((l) => l.description.trim() && Number(l.quantity) > 0);
  if (items.length === 0) return { error: "Add at least one line item." };
  const currency = normalizeDocCurrency(input.currency) ?? session.orgCurrency;
  const totals = computeTotals(items as LineItemInput[], input.discount, currency);
  const bankAccounts = await snapshotDocumentBankAccounts(session.orgId, input.bankAccountIds);
  const seal = applySealOverride(await snapshotSealForDoc(db, session.orgId, "proforma_invoice"), { sealUrl: input.sealUrl, signatureUrl: input.signatureUrl });

  await db.transaction(async (tx) => {
    await tx
      .update(proformaInvoicesTable)
      .set({
        title: input.title.trim() || null,
        customerId,
        issueDate: input.issueDate,
        notes: sanitizeIfHtml(input.notes) || null,
        terms: normalizeDocumentTerms(input.terms),
        bankAccounts,
        currency: normalizeDocCurrency(input.currency),
        subtotal: totals.subtotal,
        discount: totals.discount,
        taxTotal: totals.taxTotal,
        total: totals.total,
        sealUrl: seal.sealUrl,
        signatureUrl: seal.signatureUrl,
        updatedAt: new Date(),
      })
      .where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.orgId, session.orgId)));
    await tx.delete(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, id));
    await tx.insert(proformaInvoiceItemsTable).values(
      items.map((l) => ({
        proformaInvoiceId: id,
        productId: l.productId ? Number(l.productId) : null,
        imageUrl: l.imageUrl || null,
        unit: l.unit || null,
        customFields: l.customFields ?? {},
        description: sanitizeIfHtml(l.description),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxRatePercent: l.taxRatePercent,
        lineTotal: roundMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), currency),
      })),
    );
    await persistDocumentAttachments(tx, session.orgId, session.userId, "proforma_invoice", id, input.attachments);
  });

  await logActivity(session, { type: "proforma_invoice.updated", description: `Edited draft proforma ${existing.proformaNumber}`, entityType: "proforma_invoice", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/proforma/${id}`);
  redirect(`/sales/proforma/${id}`);
}

export async function updateProformaStatusAction(id: number, status: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!VALID_STATUSES.includes(status)) return { error: "Invalid status." };

  const result = await db
    .update(proformaInvoicesTable)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(proformaInvoicesTable.id, id), eq(proformaInvoicesTable.orgId, session.orgId)))
    .returning({ id: proformaInvoicesTable.id });
  if (!result.length) return { error: "Proforma invoice not found." };

  await logActivity(session, { type: "proforma_invoice.status_changed", description: `Marked proforma as ${status}`, entityType: "proforma_invoice", entityId: id });
  revalidatePath(PATH);
  revalidatePath(`/sales/proforma/${id}`);
  return {};
}

export async function convertProformaToInvoiceAction(proformaId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [pf] = await db.select().from(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.id, proformaId), eq(proformaInvoicesTable.orgId, session.orgId)));
  if (!pf) return { error: "Proforma invoice not found." };
  if (pf.convertedInvoiceId) return { error: "This proforma has already been converted to a sales invoice." };
  const items = await db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, proformaId));

  // Payments recorded against the proforma, to be transferred to the new invoice (Issue #14).
  const proformaPayments = await db.select().from(paymentsTable).where(and(eq(paymentsTable.orgId, session.orgId), eq(paymentsTable.proformaInvoiceId, proformaId)));
  const transferredTotal = proformaPayments.reduce((s, p) => s + Number(p.amount), 0);
  // The final Sales Invoice total drives the remaining balance. Transferred payments may not exceed
  // it (the payment system doesn't allow overpayments), so block conversion if they somehow would.
  // Tolerance and rounding follow the proforma's own currency: half a fils is 0.0005, not 0.005,
  // so the fixed half-cent both allowed a larger overpayment through and could mark a Kuwaiti
  // invoice fully paid while four fils were still outstanding.
  const convCurrency = pf.currency ?? session.orgCurrency;
  const convEps = moneyEpsilon(convCurrency);
  if (transferredTotal > Number(pf.total) + convEps) {
    return { error: "Transferred payments exceed the sales invoice total. Conversion blocked." };
  }
  const paidStr = roundMoney(transferredTotal, convCurrency);
  // Reflect the transferred payments' status immediately (no payments → normal draft, unchanged).
  const invoiceStatus = transferredTotal <= convEps ? "draft" : transferredTotal >= Number(pf.total) - convEps ? "paid" : "partially_paid";
  // FX-7: an invoice born with transferred advances never passes through send (it starts
  // partially_paid/paid), so its basePaidAmount must be set HERE, from the transferred payments'
  // STORED baseAppliedAmount — never a fresh conversion. Base-currency documents keep the
  // paidAmount identity; a transferred payment without a stored base figure (pre-FX-7) poisons
  // the sum to null, honestly unknown rather than plausibly wrong. Advance-free conversions stay
  // null, exactly like any other draft — send initializes them.
  let basePaidStr: string | null = null;
  if (transferredTotal > convEps) {
    if (!pf.currency || pf.currency.toUpperCase() === session.orgCurrency.toUpperCase()) {
      basePaidStr = paidStr;
    } else {
      basePaidStr = proformaPayments.some((p) => p.baseAppliedAmount === null)
        ? null
        : roundMoney(proformaPayments.reduce((s, p) => s + Number(p.baseAppliedAmount), 0), session.orgCurrency);
    }
  }

  const id = await db.transaction(async (tx) => {
    const invoiceNumber = await nextDocumentNumber(tx, session.orgId, "sales_invoice");
    const [inv] = await tx
      .insert(salesInvoicesTable)
      .values({
        orgId: session.orgId,
        invoiceNumber,
        title: pf.title,
        customerId: pf.customerId,
        sourceSalesOrderId: pf.sourceSalesOrderId,
        status: invoiceStatus,
        issueDate: new Date().toISOString().slice(0, 10),
        // The totals below are copied verbatim, so the currency that qualifies them must
        // travel with them — dropping it re-denominates the amounts in the base currency.
        currency: pf.currency,
        subtotal: pf.subtotal,
        discount: pf.discount,
        taxTotal: pf.taxTotal,
        total: pf.total,
        paidAmount: paidStr,
        basePaidAmount: basePaidStr,
        notes: pf.notes,
        createdById: session.userId,
      })
      .returning({ id: salesInvoicesTable.id });

    if (items.length > 0) {
      await tx.insert(salesInvoiceItemsTable).values(
        items.map((it) => ({
          invoiceId: inv.id,
          productId: it.productId,
          imageUrl: it.imageUrl,
          unit: it.unit,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          taxRatePercent: it.taxRatePercent,
          lineTotal: it.lineTotal,
        })),
      );
    }

    // Transfer the payments: re-point each to the new invoice while keeping proformaInvoiceId as
    // the origin reference. No new payment rows and no new journal entries are created — each
    // payment keeps its single existing accounting posting.
    if (proformaPayments.length > 0) {
      await tx
        .update(paymentsTable)
        .set({ salesInvoiceId: inv.id })
        .where(and(eq(paymentsTable.orgId, session.orgId), eq(paymentsTable.proformaInvoiceId, proformaId)));
    }

    // Link the proforma to the invoice; its payment history stays visible read-only.
    await tx.update(proformaInvoicesTable).set({ convertedInvoiceId: inv.id, updatedAt: new Date() }).where(eq(proformaInvoicesTable.id, proformaId));
    return inv.id;
  });

  await logActivity(session, { type: "sales_invoice.created", description: `Converted from proforma ${pf.proformaNumber}`, entityType: "sales_invoice", entityId: id });
  if (proformaPayments.length > 0) {
    await recordAudit({ orgId: session.orgId, userId: session.userId, userName: session.name }, {
      action: "payment.transferred", entityType: "sales_invoice", entityId: id,
      previousValue: { proformaInvoiceId: proformaId, paymentIds: proformaPayments.map((p) => p.id) },
      newValue: { salesInvoiceId: id, transferredTotal: paidStr },
    });
  }
  revalidatePath("/sales/invoices");
  revalidatePath("/sales/proforma");
  revalidatePath(`/sales/proforma/${proformaId}`);
  redirect(`/sales/invoices/${id}`);
}

export async function convertProformaToDeliveryChallanAction(proformaId: number): Promise<ActionResult> {
  const session = await requireSession();
  const [pf] = await db.select().from(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.id, proformaId), eq(proformaInvoicesTable.orgId, session.orgId)));
  if (!pf) return { error: "Proforma invoice not found." };
  const items = await db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, proformaId));

  const id = await db.transaction(async (tx) => {
    const dcNumber = await nextDocumentNumber(tx, session.orgId, "delivery_challan");
    const [dc] = await tx
      // No currency here, deliberately: a delivery challan is quantity-only and carries no
      // money, so there is nothing for a currency to qualify.
      .insert(deliveryChallansTable)
      .values({
        orgId: session.orgId,
        dcNumber,
        title: pf.title,
        customerId: pf.customerId,
        sourceProformaId: pf.id,
        createdById: session.userId,
      })
      .returning({ id: deliveryChallansTable.id });

    await tx.insert(deliveryChallanItemsTable).values(
      items.map((it) => ({
        deliveryChallanId: dc.id,
        productId: it.productId,
        imageUrl: it.imageUrl,
        unit: it.unit,
        description: it.description,
        quantity: it.quantity,
      })),
    );
    return dc.id;
  });

  await logActivity(session, { type: "delivery_challan.created", description: `Converted from proforma ${pf.proformaNumber}`, entityType: "delivery_challan", entityId: id });
  revalidatePath("/sales/delivery-challans");
  redirect(`/sales/delivery-challans/${id}`);
}
