import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { getLocale } from "@/lib/i18n/server";
import { and, ilike, or, lte, sql } from "drizzle-orm";
import { db, productsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { t } from "@/lib/i18n/dict";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import { ProductsToolbar } from "./products-toolbar";
import { ProductRecordActions } from "./product-record-actions";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lowStock?: string; archived?: string }>;
}) {
  const session = await requireSession();
  const locale = await getLocale();
  const { q, lowStock, archived } = await searchParams;
  const includeArchived = archived === "1";

  const products = await db
    .select()
    .from(productsTable)
    .where(
      and(
        tenantScope(session.orgId, productsTable, { includeArchived }),
        q ? or(ilike(productsTable.name, `%${q}%`), ilike(productsTable.sku, `%${q}%`)) : undefined,
        lowStock === "1" ? lte(productsTable.quantityOnHand, sql`${productsTable.reorderLevel}`) : undefined,
      ),
    )
    .orderBy(productsTable.name);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={t(locale, "Products")}
        description={t(locale, "Inventory catalog used across quotations, orders, and invoices.")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/inventory/products/recycle-bin">
                <Trash2 className="size-4" /> {t(locale, "Recycle Bin")}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/inventory/products/new">
                <Plus className="size-4" /> {t(locale, "New Product")}
              </Link>
            </Button>
          </>
        }
      />

      <ProductsToolbar locale={locale} defaultQ={q} defaultLowStock={lowStock === "1"} defaultArchived={includeArchived} />

      {products.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted text-sm">
            {q || lowStock ? t(locale, "No products match your filters.") : t(locale, "No products yet. Add your first product.")}
          </CardContent>
        </Card>
      ) : (
        <Table list>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "SKU")}</TableHead>
              <TableHead>{t(locale, "Name")}</TableHead>
              <TableHead numeric>{t(locale, "Unit price")}</TableHead>
              <TableHead numeric>{t(locale, "Qty on hand")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
              <TableHead action>{t(locale, "Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => {
              const low = p.quantityOnHand <= p.reorderLevel;
              return (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                  <TableCell className="font-semibold">
                    <Link href={`/inventory/products/${p.id}`} className="hover:text-brand-orange">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell numeric>{p.unitPrice}</TableCell>
                  <TableCell numeric>{p.quantityOnHand}</TableCell>
                  <TableCell>
                    {/* The cell stays a table cell; the badges sit in an inner flex row. */}
                    <span className="inline-flex items-center gap-1.5">
                      {low ? (
                        <StatusBadge domain="stock" status="low_stock" locale={locale} />
                      ) : (
                        <StatusBadge domain="active_flag" status={p.isActive ? "active" : "inactive"} locale={locale} />
                      )}
                      {p.recordState === "archived" && <StatusBadge domain="record_state" status="archived" locale={locale} />}
                    </span>
                  </TableCell>
                  <TableCell action>
                    <ProductRecordActions product={p} locale={locale} label={`${t(locale, "Actions for")} ${p.name}`} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
