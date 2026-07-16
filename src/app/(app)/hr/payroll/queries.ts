import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, salaryStructuresTable } from "@/db";

// Latest structure per employee: newest effective_from wins, newest id breaks ties.
export async function latestStructures(orgId: number) {
  const rows = await db
    .select({
      employeeId: salaryStructuresTable.employeeId,
      basicSalary: salaryStructuresTable.basicSalary,
      allowances: salaryStructuresTable.allowances,
      deductions: salaryStructuresTable.deductions,
      effectiveFrom: salaryStructuresTable.effectiveFrom,
      id: salaryStructuresTable.id,
    })
    .from(salaryStructuresTable)
    .where(eq(salaryStructuresTable.orgId, orgId))
    .orderBy(desc(salaryStructuresTable.effectiveFrom), desc(salaryStructuresTable.id));

  const byEmployee = new Map<number, (typeof rows)[number]>();
  for (const row of rows) if (!byEmployee.has(row.employeeId)) byEmployee.set(row.employeeId, row);
  return byEmployee;
}
