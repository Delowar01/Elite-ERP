import { asc, eq } from "drizzle-orm";
import { db, customersTable, productsTable, orgsTable, projectsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { previewNextDocumentNumber } from "@/lib/documents";
import { InvoiceForm } from "../invoice-form";

export default async function NewInvoicePage() {
  const session = await requireSession();
  const locale = await getLocale();

  const [customers, products, [org], numberPreview, projects] = await Promise.all([
    db.select().from(customersTable).where(tenantScope(session.orgId, customersTable)).orderBy(asc(customersTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    previewNextDocumentNumber(session.orgId, "sales_invoice"),
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.orgId, session.orgId)).orderBy(asc(projectsTable.name)),
  ]);

  return (
    <div className="max-w-6xl mx-auto">
      <InvoiceForm locale={locale} customers={customers} products={products} org={org} numberPreview={numberPreview} projects={projects} />
    </div>
  );
}
