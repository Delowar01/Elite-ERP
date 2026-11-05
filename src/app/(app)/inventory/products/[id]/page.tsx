import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { and, eq } from "drizzle-orm";
import { db, productsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductForm } from "../product-form";
import { updateProductAction } from "../actions";
import { AdjustStockDialog } from "../adjust-stock-dialog";
import { ProductRecordActions } from "../product-record-actions";
import { Money } from "../../../sales/_shared/money";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId)) notFound();

  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, productId), tenantScope(session.orgId, productsTable, { includeArchived: true })))
    .limit(1);

  if (!product) notFound();

  const low = product.quantityOnHand <= product.reorderLevel;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={product.name}
        description={`${t(locale, "SKU")} ${product.sku}`}
        meta={
          <>
            <StatusBadge domain="stock" status={low ? "low_stock" : "in_stock"} locale={locale} />
            {product.recordState === "archived" && <StatusBadge domain="record_state" status="archived" locale={locale} />}
          </>
        }
        actions={<ProductRecordActions product={product} locale={locale} />}
      />

      {/* One column up to lg; from lg the form takes two thirds and the Stock card one. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <ProductForm product={product} action={updateProductAction.bind(null, product.id)} submitLabel={t(locale, "Save changes")} locale={locale} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t(locale, "Stock")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <div className="text-[11px] text-ink-faint uppercase tracking-wide">{t(locale, "Quantity on hand")}</div>
              <div className="font-display font-extrabold text-2xl mt-1">{product.quantityOnHand}</div>
              <div className="text-xs text-ink-faint mt-0.5">{t(locale, "Reorder level")}: {product.reorderLevel}</div>
            </div>
            {/* ACC-01: the weighted-average pool, from the product's own running state. */}
            {product.itemType === "service" ? (
              <p className="text-xs text-ink-faint">{t(locale, "A service carries no stock.")}</p>
            ) : (
              <>
                <dl className="flex flex-wrap gap-x-6 gap-y-3">
                  <div className="min-w-0">
                    <dt className="text-[11px] text-ink-faint uppercase tracking-wide">{t(locale, "Average cost")}</dt>
                    <dd className="mt-0.5 font-semibold">
                      {product.valuedQuantity > 0 ? <Money amount={Number(product.stockValue) / product.valuedQuantity} /> : "—"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11px] text-ink-faint uppercase tracking-wide">{t(locale, "Stock value")}</dt>
                    <dd className="mt-0.5 font-semibold"><Money amount={product.stockValue} /></dd>
                  </div>
                </dl>
                {product.quantityOnHand !== product.valuedQuantity && (
                  <p role="note" className="text-xs text-warning">
                    {t(locale, "Units without a recorded cost")}: <span className="num">{product.quantityOnHand - product.valuedQuantity}</span>.{" "}
                    {t(locale, "They predate inventory valuation; selling them posts no cost of goods sold.")}
                  </p>
                )}
                <AdjustStockDialog productId={product.id} currentQty={product.quantityOnHand} locale={locale} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
