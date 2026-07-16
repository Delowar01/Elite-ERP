import { asc, eq } from "drizzle-orm";
import { db, vendorsTable, productsTable, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { tenantScope } from "@/lib/tenant";
import { previewNextDocumentNumber } from "@/lib/documents";
import { PoForm } from "../po-form";

export default async function NewPurchaseOrderPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const [vendors, products, [org], numberPreview] = await Promise.all([
    db.select().from(vendorsTable).where(tenantScope(session.orgId, vendorsTable)).orderBy(asc(vendorsTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
    db.select().from(orgsTable).where(eq(orgsTable.id, session.orgId)),
    previewNextDocumentNumber(session.orgId, "purchase_order"),
  ]);

  return (
    <div className="max-w-5xl mx-auto">
      <PoForm locale={locale} vendors={vendors} products={products} org={org} numberPreview={numberPreview} />
    </div>
  );
}
