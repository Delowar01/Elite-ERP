import { and, asc, eq, ne } from "drizzle-orm";
import { db, salesInvoicesTable, customersTable, productsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { tenantScope } from "@/lib/tenant";
import { CnForm } from "../cn-form";

export default async function NewCreditNotePage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { invoice } = await searchParams;

  const [invoices, products] = await Promise.all([
    db
      .select({
        id: salesInvoicesTable.id,
        invoiceNumber: salesInvoicesTable.invoiceNumber,
        customerName: customersTable.name,
      })
      .from(salesInvoicesTable)
      .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
      .where(and(eq(salesInvoicesTable.orgId, session.orgId), ne(salesInvoicesTable.status, "draft"), ne(salesInvoicesTable.status, "void")))
      .orderBy(asc(salesInvoicesTable.invoiceNumber)),
    db.select().from(productsTable).where(tenantScope(session.orgId, productsTable)).orderBy(asc(productsTable.name)),
  ]);

  return (
    <div className="max-w-4xl">
      <div className="mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "New Credit Note")}</h3>
      </div>
      <CnForm locale={locale} invoices={invoices} products={products} defaultInvoiceId={invoice} />
    </div>
  );
}
