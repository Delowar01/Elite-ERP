import { asc, eq } from "drizzle-orm";
import { db, customersTable, productsTable, orgsTable } from "@/db";
import { getColumnConfig } from "@/lib/column-config-server";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { previewNextDocumentNumber } from "@/lib/documents";
import { getDocumentContentPresets } from "@/lib/document-presets";
import { ProformaForm } from "../proforma-form";

export default async function NewProformaPage() {
  const session = await requireSession();
  const columnConfig = await getColumnConfig(session.orgId, session.userId, "proforma_invoice");
  const locale = await getLocale();

  const [customers, products, [org], numberPreview, presets] = await Promise.all([
    db.select().from(customersTable).where(tenantScope(session.orgId, customersTable)).orderBy(asc(customersTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    previewNextDocumentNumber(session.orgId, "proforma_invoice"),
    getDocumentContentPresets(session.orgId, "proforma_invoice"),
  ]);

  return (
    <div className="max-w-5xl mx-auto">
      <ProformaForm locale={locale} customers={customers} products={products} org={org} numberPreview={numberPreview} noteTemplates={presets.noteTemplates} termsGroups={presets.termsGroups}
        columnConfig={columnConfig} />
    </div>
  );
}
