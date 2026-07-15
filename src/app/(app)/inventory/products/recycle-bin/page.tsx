import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, productsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { ProductRecycleBinActions } from "../recycle-bin-actions";

export default async function ProductRecycleBinPage() {
  const session = await requireSession();

  const deleted = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.orgId, session.orgId), eq(productsTable.recordState, "deleted")))
    .orderBy(productsTable.updatedAt);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Products — Recycle Bin"
        description="Deleted products live here until restored or permanently deleted."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/inventory/products">
              <ArrowLeft className="size-4" /> Back to Products
            </Link>
          </Button>
        }
      />

      {deleted.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted text-sm">Recycle Bin is empty.</CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deleted.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                <TableCell className="font-semibold">{p.name}</TableCell>
                <TableCell className="text-right">
                  <ProductRecycleBinActions id={p.id} name={p.name} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
