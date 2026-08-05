import Link from "next/link";
import { and, ilike, or } from "drizzle-orm";
import { db, customersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";
import { getLocale } from "@/lib/i18n/server";
import { CLIENT_IMPORT_SPEC } from "@/lib/import/spec";
import { ImportV2Dialog } from "../documents/_workspace/import-v2-dialog";
import { ClientsToolbar } from "./clients-toolbar";
import { ClientRecordActions } from "./client-record-actions";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const session = await requireSession();
  const locale = await getLocale();
  const { q, archived } = await searchParams;
  const includeArchived = archived === "1";

  const clients = await db
    .select()
    .from(customersTable)
    .where(
      and(
        tenantScope(session.orgId, customersTable, { includeArchived }),
        q ? or(ilike(customersTable.name, `%${q}%`), ilike(customersTable.email, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(customersTable.name);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Clients"
        description="Customer directory used across quotations, orders, and invoices."
        actions={
          <>
            {/* Batch client upload — same Import v2 modal (template / mapping / preview / confirm)
                the document modules use, in its record mode. */}
            <ImportV2Dialog
              locale={locale}
              module={CLIENT_IMPORT_SPEC.module}
              moduleLabel={CLIENT_IMPORT_SPEC.label}
              fields={CLIENT_IMPORT_SPEC.fields}
              entity={CLIENT_IMPORT_SPEC.entity}
              duplicateHandling={CLIENT_IMPORT_SPEC.duplicateHandling}
            />
            <Button variant="ghost" asChild>
              <Link href="/clients/recycle-bin">
                <Trash2 className="size-4" /> Recycle Bin
              </Link>
            </Button>
            <Button asChild>
              <Link href="/clients/new">
                <Plus className="size-4" /> New Client
              </Link>
            </Button>
          </>
        }
      />

      <ClientsToolbar defaultQ={q} defaultArchived={includeArchived} />

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
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-semibold">
                  <Link href={`/clients/${c.id}`} className="hover:text-brand-orange">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="text-ink-muted">{c.email ?? "—"}</TableCell>
                <TableCell className="text-ink-muted font-mono text-xs">{c.phone ?? "—"}</TableCell>
                <TableCell className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant={c.isActive ? "success" : "neutral"}>{c.isActive ? "Active" : "Inactive"}</Badge>
                  {c.recordState === "archived" && <Badge variant="neutral">Archived</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <ClientRecordActions client={c} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
