"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { t, type Locale } from "@/lib/i18n/dict";
import { processPayrollAction } from "./actions";

export type PayrollLine = {
  employeeId: number;
  employeeName: string;
  basic: number;
  allowances: number;
  deductions: number;
  gross: number;
  net: number;
};

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PayrollClient({
  locale,
  lines,
  processed,
  periodMonth,
  periodYear,
}: {
  locale: Locale;
  lines: PayrollLine[];
  processed: boolean;
  periodMonth: number;
  periodYear: number;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(lines[0]?.employeeId ?? null);
  const [pending, startTransition] = useTransition();

  const selected = lines.find((l) => l.employeeId === selectedId) ?? lines[0] ?? null;

  function process() {
    startTransition(async () => {
      const result = await processPayrollAction(periodMonth, periodYear);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Payroll processed — posted to ledger."));
    });
  }

  return (
    <>
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Employee")}</TableHead>
              <TableHead className="text-right">{t(locale, "Basic")}</TableHead>
              <TableHead className="text-right">{t(locale, "Allowances")}</TableHead>
              <TableHead className="text-right">{t(locale, "Net pay")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow
                key={l.employeeId}
                onClick={() => setSelectedId(l.employeeId)}
                className="cursor-pointer"
                data-selected={l.employeeId === selected?.employeeId || undefined}
              >
                <TableCell className={l.employeeId === selected?.employeeId ? "font-semibold" : undefined}>{l.employeeName}</TableCell>
                <TableCell className="text-right font-mono">{fmt(l.basic)}</TableCell>
                <TableCell className="text-right font-mono">{fmt(l.allowances)}</TableCell>
                <TableCell className="text-right font-mono">{fmt(l.net)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {selected && (
          <div className="card" style={{ padding: "20px 22px", alignSelf: "start" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>
              {t(locale, "Payslip preview")} — {selected.employeeName}
            </div>
            <div className="payslip-line">
              <span>{t(locale, "Basic salary")}</span>
              <span className="mono">SAR {fmt(selected.basic)}</span>
            </div>
            <div className="payslip-line">
              <span>{t(locale, "Allowances")}</span>
              <span className="mono">SAR {fmt(selected.allowances)}</span>
            </div>
            <div className="payslip-line">
              <span>{t(locale, "Deductions")}</span>
              <span className="mono">− SAR {fmt(selected.deductions)}</span>
            </div>
            <div className="payslip-line final">
              <span>{t(locale, "Net pay")}</span>
              <span className="mono">SAR {fmt(selected.net)}</span>
            </div>
          </div>
        )}
      </div>

      {!processed && (
        <div style={{ marginTop: 18 }}>
          <Button onClick={process} disabled={pending || lines.length === 0} style={{ width: "auto", padding: "0 18px" }}>
            {pending ? t(locale, "Saving…") : t(locale, "Process payroll run")}
          </Button>
        </div>
      )}
    </>
  );
}
