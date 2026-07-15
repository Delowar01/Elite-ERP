import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db, salesOrdersTable, customersTable, quotationsTable } from "@/db";
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
  confirmed: "info",
  fulfilled: "success",
  cancelled: "danger",
};

export default async function OrdersPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const rows = await db
    .select({
      id: salesOrdersTable.id,
      soNumber: salesOrdersTable.soNumber,
      customerName: customersTable.name,
      issueDate: salesOrdersTable.issueDate,
      total: salesOrdersTable.total,
      status: salesOrdersTable.status,
      sourceQuotationNumber: quotationsTable.quotationNumber,
    })
    .from(salesOrdersTable)
    .innerJoin(customersTable, eq(customersTable.id, salesOrdersTable.customerId))
    .leftJoin(quotationsTable, eq(quotationsTable.id, salesOrdersTable.sourceQuotationId))
    .where(eq(salesOrdersTable.orgId, session.orgId))
    .orderBy(desc(salesOrdersTable.id));

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Sales Orders")}</h3>
        <Button style={{ width: "auto" }} asChild>
          <Link href="/sales/orders/new">
            <Plus className="size-4" /> {t(locale, "New Sales Order")}
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted text-sm">{t(locale, "No sales orders yet. Create your first one to get started.")}</CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Number")}</TableHead>
              <TableHead>{t(locale, "Client")}</TableHead>
              <TableHead>{t(locale, "Converted From")}</TableHead>
              <TableHead>{t(locale, "Order Date")}</TableHead>
              <TableHead className="text-right">{t(locale, "Amount")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-semibold">
                  <Link href={`/sales/orders/${r.id}`} className="hover:text-brand-orange">
                    {r.soNumber}
                  </Link>
                </TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell className="text-ink-muted font-mono text-xs">{r.sourceQuotationNumber ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.issueDate}</TableCell>
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
