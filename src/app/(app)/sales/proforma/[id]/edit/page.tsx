import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getColumnConfig } from "@/lib/column-config-server";
import { db, customersTable, productsTable, orgsTable, proformaInvoicesTable, proformaInvoiceItemsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { canEditDocument } from "@/lib/document-edit";
import { getDocumentBankData } from "@/lib/document-bank-data";
import { initialSelectedIds } from "@/lib/document-bank-accounts";
import type { LineItemDraft } from "../../../_shared/line-items-editor";
import { ProformaForm } from "../../proforma-form";

export default async function EditProformaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const columnConfig = await getColumnConfig(session.orgId, session.userId, "proforma_invoice");
  const locale = await getLocale();
  const pfId = Number((await params).id);
  if (!Number.isInteger(pfId)) notFound();

  const [pf] = await db.select().from(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.id, pfId), eq(proformaInvoicesTable.orgId, session.orgId)));
  if (!pf) notFound();
  // Server-side authorization for a direct edit URL: the SAME shared rule the list menu and
  // the Preview Edit action use — draft-only, and never a record sitting in the Recycle Bin.
  if (!canEditDocument("proforma_invoice", { status: pf.status, recordState: pf.deletedAt ? "deleted" : pf.archivedAt ? "archived" : "active" }))
    redirect(`/sales/proforma/${pfId}`);

  const [items, customers, products, [org], bankData] = await Promise.all([
    db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, pfId)),
    db.select().from(customersTable).where(tenantScope(session.orgId, customersTable)).orderBy(asc(customersTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    getDocumentBankData(session.orgId),
  ]);

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
    <div className="max-w-5xl mx-auto">
      <ProformaForm
        locale={locale}
        customers={customers}
        products={products}
        org={org}
        numberPreview={pf.proformaNumber}
        mode="edit"
        columnConfig={columnConfig}
        documentId={pfId}
        bankAccounts={bankData.bankAccounts}
        glAccounts={bankData.glAccounts}
        initial={{
          title: pf.title ?? "",
          customerId: String(pf.customerId),
          issueDate: pf.issueDate,
          discount: pf.discount,
          notes: pf.notes ?? "",
          terms: pf.terms ?? [],
          items: initialItems,
          bankAccountIds: initialSelectedIds(pf.bankAccounts, bankData.bankAccounts),
          currency: pf.currency ?? undefined,
        }}
      />
    </div>
  );
}
