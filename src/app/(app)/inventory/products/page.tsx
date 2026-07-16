import Link from "next/link";
import { and, ilike, or, lte, sql } from "drizzle-orm";
import { db, productsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
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
        title="Products"
        description="Inventory catalog used across quotations, orders, and invoices."
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link href="/inventory/products/recycle-bin">
                <Trash2 className="size-4" /> Recycle Bin
              </Link>
            </Button>
            <Button asChild>
              <Link href="/inventory/products/new">
                <Plus className="size-4" /> New Product
              </Link>
            </Button>
          </>
        }
      />

      <ProductsToolbar defaultQ={q} defaultLowStock={lowStock === "1"} defaultArchived={includeArchived} />

      {products.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted text-sm">
            {q || lowStock ? "No products match your filters." : "No products yet. Add your first product."}
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead className="text-right">Qty on hand</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
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
                  <TableCell className="text-right font-mono">{p.unitPrice}</TableCell>
                  <TableCell className="text-right font-mono">{p.quantityOnHand}</TableCell>
                  <TableCell className="flex items-center gap-1.5 flex-wrap">
                    {low ? (
                      <Badge variant="warning">Low stock</Badge>
                    ) : (
                      <Badge variant={p.isActive ? "success" : "neutral"}>{p.isActive ? "Active" : "Inactive"}</Badge>
                    )}
                    {p.recordState === "archived" && <Badge variant="neutral">Archived</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <ProductRecordActions product={p} />
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
