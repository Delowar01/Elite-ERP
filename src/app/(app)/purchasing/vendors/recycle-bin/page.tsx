import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, vendorsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { VendorRecycleBinActions } from "../recycle-bin-actions";

export default async function VendorRecycleBinPage() {
  const session = await requireSession();

  const deleted = await db
    .select()
    .from(vendorsTable)
    .where(and(eq(vendorsTable.orgId, session.orgId), eq(vendorsTable.recordState, "deleted")))
    .orderBy(vendorsTable.updatedAt);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Vendors — Recycle Bin"
        description="Deleted vendors live here until restored or permanently deleted."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/purchasing/vendors">
              <ArrowLeft className="size-4" /> Back to Vendors
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
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deleted.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-semibold">{v.name}</TableCell>
                <TableCell className="text-ink-muted">{v.email ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <VendorRecycleBinActions id={v.id} name={v.name} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
