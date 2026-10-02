"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { t, type Locale } from "@/lib/i18n/dict";
import { Money } from "../../sales/_shared/money";
import { formatMoneyNumber } from "@/lib/currency/currencies";
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

// Payroll is a summary/management context → 0 decimals (rounded).
function fmt(n: number): string {
  return formatMoneyNumber(n, "summary");
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
              <TableHead numeric>{t(locale, "Basic")}</TableHead>
              <TableHead numeric>{t(locale, "Allowances")}</TableHead>
              <TableHead numeric>{t(locale, "Net pay")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              // Selecting a row shows that employee's payslip. DEV-UI-01.5: keyboard-operable (Tab to a row,
              // Enter / Space selects), the state exposed as aria-selected and shown as a tint, not weight alone.
              <TableRow
                key={l.employeeId}
                onClick={() => setSelectedId(l.employeeId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(l.employeeId);
                  }
                }}
                tabIndex={0}
                aria-selected={l.employeeId === selected?.employeeId}
                className="cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                data-selected={l.employeeId === selected?.employeeId || undefined}
                data-payroll-row=""
              >
                <TableCell className={l.employeeId === selected?.employeeId ? "font-semibold" : undefined}>{l.employeeName}</TableCell>
                <TableCell numeric>{fmt(l.basic)}</TableCell>
                <TableCell numeric>{fmt(l.allowances)}</TableCell>
                <TableCell numeric>{fmt(l.net)}</TableCell>
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
              <span className="num-tabular"><Money amount={selected.basic} context="summary" /></span>
            </div>
            <div className="payslip-line">
              <span>{t(locale, "Allowances")}</span>
              <span className="num-tabular"><Money amount={selected.allowances} context="summary" /></span>
            </div>
            <div className="payslip-line">
              <span>{t(locale, "Deductions")}</span>
              <span className="num-tabular">− <Money amount={selected.deductions} context="summary" /></span>
            </div>
            <div className="payslip-line final">
              <span>{t(locale, "Net pay")}</span>
              <span className="num-tabular"><Money amount={selected.net} context="summary" /></span>
            </div>
          </div>
        )}
      </div>

      {!processed && (
        <div style={{ marginTop: 18 }}>
          <Button onClick={process} disabled={pending || lines.length === 0} style={{ padding: "0 18px" }}>
            {pending ? t(locale, "Saving…") : t(locale, "Process payroll run")}
          </Button>
        </div>
      )}
    </>
  );
}
