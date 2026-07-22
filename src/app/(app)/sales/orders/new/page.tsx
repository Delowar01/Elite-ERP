import { asc, eq } from "drizzle-orm";
import { db, customersTable, productsTable, orgsTable, projectsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { previewNextDocumentNumber } from "@/lib/documents";
import { getDocumentContentPresets } from "@/lib/document-presets";
import { OrderForm } from "../order-form";

export default async function NewOrderPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const [customers, products, [org], numberPreview, projects, presets] = await Promise.all([
    db.select().from(customersTable).where(tenantScope(session.orgId, customersTable)).orderBy(asc(customersTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    previewNextDocumentNumber(session.orgId, "sales_order"),
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.orgId, session.orgId)).orderBy(asc(projectsTable.name)),
    getDocumentContentPresets(session.orgId, "sales_order"),
  ]);

  return (
    <div className="max-w-5xl mx-auto">
      <OrderForm locale={locale} customers={customers} products={products} org={org} numberPreview={numberPreview} projects={projects} noteTemplates={presets.noteTemplates} termsGroups={presets.termsGroups} />
    </div>
  );
}
