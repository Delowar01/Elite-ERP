import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db, salesInvoicesTable, customersTable, salesOrdersTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Plus } from "lucide-react";
import { fmt } from "../_shared/totals";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  sent: "info",
  partially_paid: "warning",
  paid: "success",
  void: "danger",
};

export default async function InvoicesPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const rows = await db
    .select({
      id: salesInvoicesTable.id,
      invoiceNumber: salesInvoicesTable.invoiceNumber,
      customerName: customersTable.name,
      issueDate: salesInvoicesTable.issueDate,
      dueDate: salesInvoicesTable.dueDate,
      total: salesInvoicesTable.total,
      status: salesInvoicesTable.status,
      sourceSoNumber: salesOrdersTable.soNumber,
    })
    .from(salesInvoicesTable)
    .innerJoin(customersTable, eq(customersTable.id, salesInvoicesTable.customerId))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, salesInvoicesTable.sourceSalesOrderId))
    .where(eq(salesInvoicesTable.orgId, session.orgId))
    .orderBy(desc(salesInvoicesTable.id));

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Invoices")}</h3>
        <Button style={{ width: "auto" }} asChild>
          <Link href="/sales/invoices/new">
            <Plus className="size-4" /> {t(locale, "New Invoice")}
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted text-sm">{t(locale, "No invoices yet. Create your first one to get started.")}</CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Number")}</TableHead>
              <TableHead>{t(locale, "Client")}</TableHead>
              <TableHead>{t(locale, "Converted From")}</TableHead>
              <TableHead>{t(locale, "Issue Date")}</TableHead>
              <TableHead>{t(locale, "Due Date")}</TableHead>
              <TableHead className="text-right">{t(locale, "Amount")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-semibold">
                  <Link href={`/sales/invoices/${r.id}`} className="hover:text-brand-orange">
                    {r.invoiceNumber}
                  </Link>
                </TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell className="text-ink-muted font-mono text-xs">{r.sourceSoNumber ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.issueDate}</TableCell>
                <TableCell className="font-mono text-xs">{r.dueDate ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{fmt(r.total)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.status] ?? "neutral"}>{t(locale, r.status)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
