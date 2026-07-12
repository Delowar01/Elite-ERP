import Link from "next/link";
import { and, eq, ilike, or } from "drizzle-orm";
import { db, vendorsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search } from "lucide-react";

export default async function VendorsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  const { q } = await searchParams;

  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.orgId, session.orgId),
        q ? or(ilike(vendorsTable.name, `%${q}%`), ilike(vendorsTable.email, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(vendorsTable.name);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Vendors"
        description="Suppliers used for purchase orders and debit notes."
        actions={
          <Button asChild>
            <Link href="/purchasing/vendors/new">
              <Plus className="size-4" /> New Vendor
            </Link>
          </Button>
        }
      />

      <form className="mb-4 max-w-xs">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-faint" />
          <Input name="q" defaultValue={q} placeholder="Search vendors…" className="pl-9" />
        </div>
      </form>

      {vendors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted text-sm">
            {q ? `No vendors match "${q}".` : "No vendors yet. Add your first vendor to get started."}
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendors.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-semibold">
                  <Link href={`/purchasing/vendors/${v.id}`} className="hover:text-brand-orange">
                    {v.name}
                  </Link>
                </TableCell>
                <TableCell className="text-ink-muted">{v.email ?? "—"}</TableCell>
                <TableCell className="text-ink-muted font-mono text-xs">{v.phone ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={v.isActive ? "success" : "neutral"}>{v.isActive ? "Active" : "Inactive"}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
