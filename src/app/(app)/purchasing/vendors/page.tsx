import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { getLocale } from "@/lib/i18n/server";
import { and, ilike, or } from "drizzle-orm";
import { db, vendorsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { t } from "@/lib/i18n/dict";
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
  const locale = await getLocale();
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
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={t(locale, "Vendors")}
        description={t(locale, "Suppliers used for purchase orders and debit notes.")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/purchasing/vendors/recycle-bin">
                <Trash2 className="size-4" /> {t(locale, "Recycle Bin")}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/purchasing/vendors/new">
                <Plus className="size-4" /> {t(locale, "New Vendor")}
              </Link>
            </Button>
          </>
        }
      />

      <VendorsToolbar locale={locale} defaultQ={q} defaultArchived={includeArchived} />

      {vendors.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted text-sm">
            {q ? `${t(locale, "No vendors match")} “${q}”.` : t(locale, "No vendors yet. Add your first vendor to get started.")}
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
                  {/* The cell stays a table cell; the badges sit in an inner flex row. */}
                  <span className="inline-flex items-center gap-1.5">
                    <StatusBadge domain="active_flag" status={v.isActive ? "active" : "inactive"} locale={locale} />
                    {v.recordState === "archived" && <StatusBadge domain="record_state" status="archived" locale={locale} />}
                  </span>
                </TableCell>
                <TableCell action>
                  <VendorRecordActions vendor={v} locale={locale} label={`${t(locale, "Actions for")} ${v.name}`} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
