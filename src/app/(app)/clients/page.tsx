import Link from "next/link";
import { and, eq, ilike, or } from "drizzle-orm";
import { db, customersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search } from "lucide-react";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireSession();
  const { q } = await searchParams;

  const clients = await db
    .select()
    .from(customersTable)
    .where(
      and(
        eq(customersTable.orgId, session.orgId),
        q ? or(ilike(customersTable.name, `%${q}%`), ilike(customersTable.email, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(customersTable.name);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Clients"
        description="Customer directory used across quotations, orders, and invoices."
        actions={
          <Button asChild>
            <Link href="/clients/new">
              <Plus className="size-4" /> New Client
            </Link>
          </Button>
        }
      />

      <form className="mb-4 max-w-xs">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-faint" />
          <Input name="q" defaultValue={q} placeholder="Search clients…" className="pl-9" />
        </div>
      </form>

      {clients.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted text-sm">
            {q ? `No clients match "${q}".` : "No clients yet. Add your first client to get started."}
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
            {clients.map((c) => (
              <TableRow key={c.id} className="cursor-pointer">
                <TableCell className="font-semibold">
                  <Link href={`/clients/${c.id}`} className="hover:text-brand-orange">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="text-ink-muted">{c.email ?? "—"}</TableCell>
                <TableCell className="text-ink-muted font-mono text-xs">{c.phone ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={c.isActive ? "success" : "neutral"}>{c.isActive ? "Active" : "Inactive"}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
