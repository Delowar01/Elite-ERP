import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db, deliveryChallansTable, customersTable, salesOrdersTable, salesInvoicesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Plus } from "lucide-react";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  dispatched: "warning",
  delivered: "success",
};

export default async function DeliveryChallansPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const rows = await db
    .select({
      id: deliveryChallansTable.id,
      dcNumber: deliveryChallansTable.dcNumber,
      customerName: customersTable.name,
      dispatchDate: deliveryChallansTable.dispatchDate,
      status: deliveryChallansTable.status,
      sourceSoNumber: salesOrdersTable.soNumber,
      sourceInvoiceNumber: salesInvoicesTable.invoiceNumber,
    })
    .from(deliveryChallansTable)
    .innerJoin(customersTable, eq(customersTable.id, deliveryChallansTable.customerId))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, deliveryChallansTable.sourceSalesOrderId))
    .leftJoin(salesInvoicesTable, eq(salesInvoicesTable.id, deliveryChallansTable.sourceInvoiceId))
    .where(eq(deliveryChallansTable.orgId, session.orgId))
    .orderBy(desc(deliveryChallansTable.id));

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Delivery Challans")}</h3>
        <Button style={{ width: "auto" }} asChild>
          <Link href="/sales/delivery-challans/new">
            <Plus className="size-4" /> {t(locale, "New Delivery Challan")}
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted text-sm">{t(locale, "No delivery challans yet. Create your first one to get started.")}</CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Number")}</TableHead>
              <TableHead>{t(locale, "Client")}</TableHead>
              <TableHead>{t(locale, "Converted From")}</TableHead>
              <TableHead>{t(locale, "Dispatch Date")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-semibold">
                  <Link href={`/sales/delivery-challans/${r.id}`} className="hover:text-brand-orange">
                    {r.dcNumber}
                  </Link>
                </TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell className="text-ink-muted font-mono text-xs">{r.sourceSoNumber ?? r.sourceInvoiceNumber ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.dispatchDate ?? "—"}</TableCell>
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
