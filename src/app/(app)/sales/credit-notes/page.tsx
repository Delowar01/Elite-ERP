import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db, creditNotesTable, customersTable, salesInvoicesTable } from "@/db";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { fmt } from "../_shared/totals";

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral",
  issued: "success",
};

export default async function CreditNotesPage() {
  const session = await requireSession();
  const locale = await getLocale();

  const rows = await db
    .select({
      id: creditNotesTable.id,
      creditNoteNumber: creditNotesTable.creditNoteNumber,
      customerName: customersTable.name,
      issueDate: creditNotesTable.issueDate,
      total: creditNotesTable.total,
      status: creditNotesTable.status,
      sourceInvoiceNumber: salesInvoicesTable.invoiceNumber,
      sourceInvoiceId: creditNotesTable.sourceInvoiceId,
    })
    .from(creditNotesTable)
    .innerJoin(customersTable, eq(customersTable.id, creditNotesTable.customerId))
    .innerJoin(salesInvoicesTable, eq(salesInvoicesTable.id, creditNotesTable.sourceInvoiceId))
    .where(eq(creditNotesTable.orgId, session.orgId))
    .orderBy(desc(creditNotesTable.id));

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-[22px]">
        <h3 className="text-[19px] font-bold">{t(locale, "Credit Notes")}</h3>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-ink-muted text-sm">
            {t(locale, "No credit notes yet. Open a sent invoice to issue one against it.")}
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Number")}</TableHead>
              <TableHead>{t(locale, "Client")}</TableHead>
              <TableHead>{t(locale, "Against Invoice")}</TableHead>
              <TableHead>{t(locale, "Issue Date")}</TableHead>
              <TableHead className="text-right">{t(locale, "Amount")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-semibold">
                  <Link href={`/sales/credit-notes/${r.id}`} className="hover:text-brand-orange">
                    {r.creditNoteNumber}
                  </Link>
                </TableCell>
                <TableCell>{r.customerName}</TableCell>
                <TableCell className="text-ink-muted font-mono text-xs">
                  <Link href={`/sales/invoices/${r.sourceInvoiceId}`} className="hover:text-brand-orange">
                    {r.sourceInvoiceNumber}
                  </Link>
                </TableCell>
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
