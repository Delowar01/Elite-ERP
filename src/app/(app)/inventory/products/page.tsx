import Link from "next/link";
import { and, eq, ilike, or, lte, sql } from "drizzle-orm";
import { db, productsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search } from "lucide-react";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lowStock?: string }>;
}) {
  const session = await requireSession();
  const { q, lowStock } = await searchParams;

  const products = await db
    .select()
    .from(productsTable)
    .where(
      and(
        eq(productsTable.orgId, session.orgId),
        q ? or(ilike(productsTable.name, `%${q}%`), ilike(productsTable.sku, `%${q}%`)) : undefined,
        lowStock === "1" ? lte(productsTable.quantityOnHand, sql`${productsTable.reorderLevel}`) : undefined,
      ),
    )
    .orderBy(productsTable.name);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Products"
        description="Inventory catalog used across quotations, orders, and invoices."
        actions={
          <Button asChild>
            <Link href="/inventory/products/new">
              <Plus className="size-4" /> New Product
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <form className="max-w-xs flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-faint" />
            <Input name="q" defaultValue={q} placeholder="Search products…" className="pl-9" />
            {lowStock === "1" && <input type="hidden" name="lowStock" value="1" />}
          </div>
        </form>
        <Link
          href={lowStock === "1" ? `/inventory/products${q ? `?q=${q}` : ""}` : `/inventory/products?lowStock=1${q ? `&q=${q}` : ""}`}
        >
          <Badge variant={lowStock === "1" ? "warning" : "neutral"} className="cursor-pointer">
            Low stock only
          </Badge>
        </Link>
      </div>

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
                  <TableCell>
                    {low ? (
                      <Badge variant="warning">Low stock</Badge>
                    ) : (
                      <Badge variant={p.isActive ? "success" : "neutral"}>{p.isActive ? "Active" : "Inactive"}</Badge>
                    )}
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
