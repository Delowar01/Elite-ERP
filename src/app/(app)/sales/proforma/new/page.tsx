import { asc, eq } from "drizzle-orm";
import { db, customersTable, productsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { previewNextDocumentNumber } from "@/lib/documents";
import { ProformaForm } from "../proforma-form";

export default async function NewProformaPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const [customers, products, [org], numberPreview] = await Promise.all([
    db.select().from(customersTable).where(tenantScope(session.orgId, customersTable)).orderBy(asc(customersTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    previewNextDocumentNumber(session.orgId, "proforma_invoice"),
  ]);

  return (
    <div className="max-w-5xl">
      <ProformaForm locale={locale} customers={customers} products={products} org={org} numberPreview={numberPreview} />
    </div>
  );
}
