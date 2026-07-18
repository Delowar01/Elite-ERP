"use client";

import Link from "next/link";
import { Plus, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { RecordPaymentDialog, type OutstandingInvoice, type OutstandingPo, type BankAccountOption } from "../_shared/record-payment-dialog";
import { Money } from "../../sales/_shared/money";
import { t, type Locale } from "@/lib/i18n/dict";

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  card: "Card",
  cheque: "Cheque",
};

export type PaymentRow = {
  id: number;
  direction: string;
  paymentDate: string;
  method: string | null;
  reference: string | null;
  amount: string;
  bankAccountName: string;
  invoiceId: number | null;
  invoiceNumber: string | null;
  customerName: string | null;
  poId: number | null;
  poNumber: string | null;
  vendorName: string | null;
};

export function PaymentsListClient({
  locale,
  rows,
  bankAccounts,
  outstandingInvoices,
  outstandingPos,
}: {
  locale: Locale;
  rows: PaymentRow[];
  bankAccounts: BankAccountOption[];
  outstandingInvoices: OutstandingInvoice[];
  outstandingPos: OutstandingPo[];
}) {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head">
        <h3>{t(locale, "Payment Records")}</h3>
        <RecordPaymentDialog
          locale={locale}
          bankAccounts={bankAccounts}
          invoices={outstandingInvoices}
          purchaseOrders={outstandingPos}
          trigger={
            <Button style={{ width: "auto" }}>
              <Plus className="size-4" /> {t(locale, "Record Payment")}
            </Button>
          }
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-ink-muted text-sm">{t(locale, "No payment records yet.")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Date")}</TableHead>
              <TableHead>{t(locale, "Direction")}</TableHead>
              <TableHead>{t(locale, "Type")}</TableHead>
              <TableHead>{t(locale, "Reference")}</TableHead>
              <TableHead>{t(locale, "Party")}</TableHead>
              <TableHead>{t(locale, "Bank Account")}</TableHead>
              <TableHead>{t(locale, "Method")}</TableHead>
              <TableHead className="text-right">{t(locale, "Amount")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.paymentDate}</TableCell>
                <TableCell>
                  <Badge variant={p.direction === "in" ? "success" : "danger"}>{p.direction === "in" ? t(locale, "In") : t(locale, "Out")}</Badge>
                </TableCell>
                <TableCell>{p.invoiceId ? t(locale, "Invoice") : t(locale, "Purchase Order")}</TableCell>
                <TableCell className="font-mono text-xs">
                  {p.invoiceId ? (
                    <Link href={`/sales/invoices/${p.invoiceId}`} className="hover:text-brand-orange">
                      {p.invoiceNumber}
                    </Link>
                  ) : (
                    p.poId && (
                      <Link href={`/purchasing/orders/${p.poId}`} className="hover:text-brand-orange">
                        {p.poNumber}
                      </Link>
                    )
                  )}
                </TableCell>
                <TableCell>{p.customerName ?? p.vendorName}</TableCell>
                <TableCell>{p.bankAccountName}</TableCell>
                <TableCell className="text-[12.5px] text-ink-muted">{p.method ? t(locale, METHOD_LABELS[p.method] ?? p.method) : "—"}</TableCell>
                <TableCell className="text-right font-mono">
                  <Money amount={p.amount} />
                </TableCell>
                <TableCell>
                  <a
                    href={`/print/payment/${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink-faint hover:text-brand-orange inline-flex"
                    title={t(locale, "Payment Receipt")}
                  >
                    <Printer className="size-4" />
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
