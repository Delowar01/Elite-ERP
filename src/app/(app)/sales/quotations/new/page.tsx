import { asc } from "drizzle-orm";
import { db, customersTable, productsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { tenantScope } from "@/lib/tenant";
import { QuotationForm } from "../quotation-form";

export default async function NewQuotationPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const [customers, products] = await Promise.all([
    db.select().from(customersTable).where(tenantScope(session.orgId, customersTable)).orderBy(asc(customersTable.name)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "New Quotation")}</h3>
      </div>
      <QuotationForm locale={locale} customers={customers} products={products} />
    </div>
  );
}
