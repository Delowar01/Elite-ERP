import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { and, ilike, or } from "drizzle-orm";
import { db, customersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { t } from "@/lib/i18n/dict";
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
      {/* flex-wrap: at 390px the three header actions move below the heading instead of pushing the page
          wider than the viewport (PageHeader itself is frozen; it already takes a className). */}
      <PageHeader
        className="flex-wrap"
        title={t(locale, "Clients")}
        description={t(locale, "Customer directory used across quotations, orders, and invoices.")}
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
            <Button variant="outline" asChild>
              <Link href="/clients/recycle-bin">
                <Trash2 className="size-4" /> {t(locale, "Recycle Bin")}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/clients/new">
                <Plus className="size-4" /> {t(locale, "New Client")}
              </Link>
            </Button>
          </>
        }
      />

      <ClientsToolbar locale={locale} defaultQ={q} defaultArchived={includeArchived} />

      {clients.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted text-sm">
            {q ? `${t(locale, "No clients match")} “${q}”.` : t(locale, "No clients yet. Add your first client to get started.")}
          </CardContent>
        </Card>
      ) : (
        <Table list>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Name")}</TableHead>
              <TableHead>{t(locale, "Email")}</TableHead>
              <TableHead>{t(locale, "Phone")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
              <TableHead action>{t(locale, "Actions")}</TableHead>
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
                <TableCell>
                  {/* The cell stays a table cell; the badges sit in an inner flex row. */}
                  <span className="inline-flex items-center gap-1.5">
                    <StatusBadge domain="active_flag" status={c.isActive ? "active" : "inactive"} locale={locale} />
                    {c.recordState === "archived" && <StatusBadge domain="record_state" status="archived" locale={locale} />}
                  </span>
                </TableCell>
                <TableCell action>
                  <ClientRecordActions client={c} locale={locale} label={`${t(locale, "Actions for")} ${c.name}`} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
