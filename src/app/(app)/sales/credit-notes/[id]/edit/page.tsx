import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db, creditNotesTable, creditNoteItemsTable, salesInvoicesTable, customersTable, productsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getDocumentContentPresets } from "@/lib/document-presets";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { canEditDocument } from "@/lib/document-edit";
import { getDocumentBankData } from "@/lib/document-bank-data";
import { initialSelectedIds } from "@/lib/document-bank-accounts";
import type { LineItemDraft } from "../../../_shared/line-items-editor";
import { CnForm } from "../../cn-form";

export default async function EditCreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const cnId = Number((await params).id);
  if (!Number.isInteger(cnId)) notFound();

  const [cn] = await db.select().from(creditNotesTable).where(and(eq(creditNotesTable.id, cnId), eq(creditNotesTable.orgId, session.orgId)));
  if (!cn) notFound();
  // Server-side authorization for a direct edit URL: the SAME shared rule the list menu and
  // the Preview Edit action use — draft-only, and never a record sitting in the Recycle Bin.
  if (!canEditDocument("credit_note", { status: cn.status, recordState: cn.deletedAt ? "deleted" : cn.archivedAt ? "archived" : "active" }))
    redirect(`/sales/credit-notes/${cnId}`);

  const [items, [sourceInvoice], products, [org]] = await Promise.all([
    db.select().from(creditNoteItemsTable).where(eq(creditNoteItemsTable.creditNoteId, cnId)),
    db
      .select({
        id: salesInvoicesTable.id,
        invoiceNumber: salesInvoicesTable.invoiceNumber,
        customerName: customersTable.name,
        customerAddress: customersTable.address,
        customerEmail: customersTable.email,
        customerPhone: customersTable.phone,
      })
      .from(salesInvoicesTable)
      .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
      .where(and(eq(salesInvoicesTable.id, cn.sourceInvoiceId), eq(salesInvoicesTable.orgId, session.orgId))),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
  ]);
  const [presets, bankData] = await Promise.all([getDocumentContentPresets(session.orgId, "credit_note"), getDocumentBankData(session.orgId)]);

  const initialItems: LineItemDraft[] = items.map((it) => ({
    productId: it.productId ? String(it.productId) : "",
    description: it.description ?? "",
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    taxRatePercent: it.taxRatePercent,
    imageUrl: it.imageUrl ?? "",
    unit: it.unit ?? "",
    customFields: (it.customFields as Record<string, string>) ?? {},
  }));

  return (
    <div className="max-w-4xl mx-auto">
      <CnForm
        termsGroups={presets.termsGroups}
        locale={locale}
        invoices={sourceInvoice ? [sourceInvoice] : []}
        products={products}
        org={org}
        numberPreview={cn.creditNoteNumber}
        mode="edit"
        documentId={cnId}
        bankAccounts={bankData.bankAccounts}
        glAccounts={bankData.glAccounts}
        initial={{
          sourceInvoiceId: String(cn.sourceInvoiceId),
          issueDate: cn.issueDate,
          reason: cn.reason ?? "",
          items: initialItems,
          terms: cn.terms ?? [],
          bankAccountIds: initialSelectedIds(cn.bankAccounts, bankData.bankAccounts),
        }}
      />
    </div>
  );
}
