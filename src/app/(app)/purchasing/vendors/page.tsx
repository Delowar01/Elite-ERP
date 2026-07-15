import Link from "next/link";
import { and, ilike, or } from "drizzle-orm";
import { db, vendorsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import { VendorsToolbar } from "./vendors-toolbar";
import { VendorRecordActions } from "./vendor-record-actions";

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const session = await requireSession();
  const { q, archived } = await searchParams;
  const includeArchived = archived === "1";

  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(
      and(
        tenantScope(session.orgId, vendorsTable, { includeArchived }),
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
          <>
            <Button variant="ghost" asChild>
              <Link href="/purchasing/vendors/recycle-bin">
                <Trash2 className="size-4" /> Recycle Bin
              </Link>
            </Button>
            <Button asChild>
              <Link href="/purchasing/vendors/new">
                <Plus className="size-4" /> New Vendor
              </Link>
            </Button>
          </>
        }
      />

      <VendorsToolbar defaultQ={q} defaultArchived={includeArchived} />

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
              <TableHead className="w-12" />
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
                <TableCell className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant={v.isActive ? "success" : "neutral"}>{v.isActive ? "Active" : "Inactive"}</Badge>
                  {v.recordState === "archived" && <Badge variant="neutral">Archived</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <VendorRecordActions vendor={v} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
