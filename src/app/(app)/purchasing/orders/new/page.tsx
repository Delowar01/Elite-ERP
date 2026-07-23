import { and, asc, eq } from "drizzle-orm";
import {
  db,
  vendorsTable,
  productsTable,
  orgsTable,
  quotationsTable,
  quotationItemsTable,
  salesOrdersTable,
  salesOrderItemsTable,
  proformaInvoicesTable,
  proformaInvoiceItemsTable,
  salesInvoicesTable,
  salesInvoiceItemsTable,
} from "@/db";
import { getColumnConfig } from "@/lib/column-config-server";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { previewNextDocumentNumber } from "@/lib/documents";
import { getDocumentContentPresets } from "@/lib/document-presets";
import type { LineItemDraft } from "../../../sales/_shared/line-items-editor";
import { PoForm } from "../po-form";

type SourceItem = { productId: number | null; description: string | null; quantity: string; unitPrice: string; taxRatePercent: string };

function toDrafts(items: SourceItem[]): LineItemDraft[] {
  return items.map((it) => ({
    productId: it.productId ? String(it.productId) : "",
    description: it.description ?? "",
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    taxRatePercent: it.taxRatePercent,
    imageUrl: "",
    unit: "",
    customFields: {},
  }));
}

// Convert-to-Purchase-Order can be initiated from a Quotation, Sales Order, or
// Invoice (per the row-menu's "Convert to… > Purchase Order" item): those are
// customer-facing documents with no vendor, so the PO is prefilled with the
// source document's title + line items but the vendor is left for the user to
// choose — the one field a sales document genuinely cannot supply.
export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ fromQuotation?: string; fromSalesOrder?: string; fromProforma?: string; fromInvoice?: string }>;
}) {
  const session = await requireSession();
  const columnConfig = await getColumnConfig(session.orgId, session.userId, "purchase_order");
  const locale = await getLocale();
  const { fromQuotation, fromSalesOrder, fromProforma, fromInvoice } = await searchParams;

  let initialTitle: string | undefined;
  let initialItems: LineItemDraft[] | undefined;

  if (fromQuotation) {
    const qid = Number(fromQuotation);
    const [quotation] = await db.select().from(quotationsTable).where(and(tenantScope(session.orgId, quotationsTable), eq(quotationsTable.id, qid)));
    if (quotation) {
      initialTitle = quotation.title ?? undefined;
      const items = await db.select().from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, qid));
      initialItems = toDrafts(items);
    }
  } else if (fromSalesOrder) {
    const soId = Number(fromSalesOrder);
    const [so] = await db.select().from(salesOrdersTable).where(and(tenantScope(session.orgId, salesOrdersTable), eq(salesOrdersTable.id, soId)));
    if (so) {
      initialTitle = so.title ?? undefined;
      const items = await db.select().from(salesOrderItemsTable).where(eq(salesOrderItemsTable.salesOrderId, soId));
      initialItems = toDrafts(items);
    }
  } else if (fromProforma) {
    const pfId = Number(fromProforma);
    const [pf] = await db.select().from(proformaInvoicesTable).where(and(tenantScope(session.orgId, proformaInvoicesTable), eq(proformaInvoicesTable.id, pfId)));
    if (pf) {
      initialTitle = pf.title ?? undefined;
      const items = await db.select().from(proformaInvoiceItemsTable).where(eq(proformaInvoiceItemsTable.proformaInvoiceId, pfId));
      initialItems = toDrafts(items);
    }
  } else if (fromInvoice) {
    const invId = Number(fromInvoice);
    const [inv] = await db.select().from(salesInvoicesTable).where(and(tenantScope(session.orgId, salesInvoicesTable), eq(salesInvoicesTable.id, invId)));
    if (inv) {
      initialTitle = inv.title ?? undefined;
      const items = await db.select().from(salesInvoiceItemsTable).where(eq(salesInvoiceItemsTable.invoiceId, invId));
      initialItems = toDrafts(items);
    }
  }

  const [vendors, products, [org], numberPreview, presets] = await Promise.all([
    db.select().from(vendorsTable).where(tenantScope(session.orgId, vendorsTable)).orderBy(asc(vendorsTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    previewNextDocumentNumber(session.orgId, "purchase_order"),
    getDocumentContentPresets(session.orgId, "purchase_order"),
  ]);

  return (
    <div className="max-w-5xl mx-auto">
      <PoForm
        locale={locale}
        vendors={vendors}
        products={products}
        org={org}
        numberPreview={numberPreview}
        initialTitle={initialTitle}
        initialItems={initialItems}
        sourceQuotationId={fromQuotation}
        sourceSalesOrderId={fromSalesOrder}
        sourceInvoiceId={fromInvoice}
        noteTemplates={presets.noteTemplates}
        termsGroups={presets.termsGroups}
        columnConfig={columnConfig}
      />
    </div>
  );
}
