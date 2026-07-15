import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db, quotationsTable, customersTable } from "@/db";
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
  accepted: "success",
  rejected: "danger",
  expired: "warning",
};

export default async function QuotationsPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const rows = await db
    .select({
      id: quotationsTable.id,
      quotationNumber: quotationsTable.quotationNumber,
      customerName: customersTable.name,
      issueDate: quotationsTable.issueDate,
      validUntil: quotationsTable.validUntil,
      total: quotationsTable.total,
      status: quotationsTable.status,
    })
    .from(quotationsTable)
    .innerJoin(customersTable, eq(customersTable.id, quotationsTable.customerId))
    .where(eq(quotationsTable.orgId, session.orgId))
    .orderBy(desc(quotationsTable.id));

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Quotations")}</h3>
        <Button style={{ width: "auto" }} asChild>
          <Link href="/sales/quotations/new">
            <Plus className="size-4" /> {t(locale, "New Quotation")}
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted text-sm">{t(locale, "No quotations yet. Create your first one to get started.")}</CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Number")}</TableHead>
              <TableHead>{t(locale, "Client")}</TableHead>
              <TableHead>{t(locale, "Issue Date")}</TableHead>
              <TableHead>{t(locale, "Valid Till")}</TableHead>
              <TableHead className="text-right">{t(locale, "Amount")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="cursor-pointer">
                <TableCell className="font-semibold">
                  <Link href={`/sales/quotations/${r.id}`} className="hover:text-brand-orange">
                    {r.quotationNumber}
                  </Link>
                </TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell className="font-mono text-xs">{r.issueDate}</TableCell>
                <TableCell className="font-mono text-xs">{r.validUntil ?? "—"}</TableCell>
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
