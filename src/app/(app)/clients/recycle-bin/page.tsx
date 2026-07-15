import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, customersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { ClientRecycleBinActions } from "../recycle-bin-actions";

export default async function ClientRecycleBinPage() {
  const session = await requireSession();

  const deleted = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.orgId, session.orgId), eq(customersTable.recordState, "deleted")))
    .orderBy(customersTable.updatedAt);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Clients — Recycle Bin"
        description="Deleted clients live here until restored or permanently deleted."
        actions={
          <Button variant="ghost" asChild>
            <Link href="/clients">
              <ArrowLeft className="size-4" /> Back to Clients
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
            {deleted.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-semibold">{c.name}</TableCell>
                <TableCell className="text-ink-muted">{c.email ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <ClientRecycleBinActions id={c.id} name={c.name} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
