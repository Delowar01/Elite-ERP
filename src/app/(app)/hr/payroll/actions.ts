"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import {
  db,
  employeesTable,
  payrollRunsTable,
  payslipsTable,
  accountsTable,
  journalEntriesTable,
  journalLinesTable,
} from "@/db";
import { requireRole } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { latestStructures } from "./queries";

export type ActionResult = { error?: string };

export async function processPayrollAction(periodMonth: number, periodYear: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");

  if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) return { error: "Invalid period month." };
  if (!Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 2100) return { error: "Invalid period year." };

  const [existing] = await db
    .select({ id: payrollRunsTable.id })
    .from(payrollRunsTable)
    .where(
      and(eq(payrollRunsTable.orgId, session.orgId), eq(payrollRunsTable.periodMonth, periodMonth), eq(payrollRunsTable.periodYear, periodYear)),
    );
  if (existing) return { error: "Payroll for this period has already been processed." };

  const employees = await db
    .select({ id: employeesTable.id, name: employeesTable.name })
    .from(employeesTable)
    .where(and(eq(employeesTable.orgId, session.orgId), eq(employeesTable.status, "active")));

  const structures = await latestStructures(session.orgId);
  const payable = employees.filter((e) => structures.has(e.id));
  if (payable.length === 0) return { error: "No active employees with a salary structure — set one on each employee's profile first." };

  const accounts = await db.select().from(accountsTable).where(eq(accountsTable.orgId, session.orgId));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const salaryExpense = byCode.get("5200");
  const salariesPayable = byCode.get("2200");
  if (!salaryExpense || !salariesPayable) return { error: "Chart of accounts is missing a required system account (5200/2200)." };

  let netTotal = 0;
  const slips = payable.map((e) => {
    const s = structures.get(e.id)!;
    const gross = Number(s.basicSalary) + Number(s.allowances);
    const net = gross - Number(s.deductions);
    netTotal += net;
    return {
      employeeId: e.id,
      basicSalary: Number(s.basicSalary).toFixed(2),
      allowances: Number(s.allowances).toFixed(2),
      deductions: Number(s.deductions).toFixed(2),
      grossPay: gross.toFixed(2),
      netPay: net.toFixed(2),
    };
  });

  const entryDate = `${periodYear}-${String(periodMonth).padStart(2, "0")}-28`;

  await db.transaction(async (tx) => {
    const [run] = await tx
      .insert(payrollRunsTable)
      .values({
        orgId: session.orgId,
        periodMonth,
        periodYear,
        status: "processed",
        processedAt: new Date(),
        createdById: session.userId,
      })
      .returning({ id: payrollRunsTable.id });

    await tx.insert(payslipsTable).values(slips.map((s) => ({ payrollRunId: run.id, ...s })));

    // One summary entry per run (master plan): Dr Salary Expense / Cr Salaries Payable, at the
    // net-pay total — the documented simplification, since deductions have no recovery account
    // in this chart (same "no tax engine" boundary as the rest of the payroll scope).
    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        orgId: session.orgId,
        entryDate,
        memo: `Payroll ${periodYear}-${String(periodMonth).padStart(2, "0")}`,
        sourceType: "payroll",
        sourceId: run.id,
        createdById: session.userId,
      })
      .returning({ id: journalEntriesTable.id });

    await tx.insert(journalLinesTable).values([
      { journalEntryId: entry.id, accountId: salaryExpense.id, debit: netTotal.toFixed(2), credit: "0" },
      { journalEntryId: entry.id, accountId: salariesPayable.id, debit: "0", credit: netTotal.toFixed(2) },
    ]);
  });

  await logActivity(session, {
    type: "payroll.processed",
    description: `Processed payroll for ${periodYear}-${String(periodMonth).padStart(2, "0")} (${payable.length} employees)`,
    entityType: "payroll_run",
    entityId: periodMonth,
  });

  revalidatePath("/hr/payroll");
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  revalidatePath("/finance/journal");
  return {};
}
