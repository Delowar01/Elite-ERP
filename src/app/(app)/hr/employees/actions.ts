"use server";

import { revalidatePath } from "next/cache";
import { validateUpload, storeBlob, deleteStoredBlob, IMAGE_MAX_BYTES } from "@/lib/storage/blob-storage";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, employeesTable, departmentsTable, salaryStructuresTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";

export type ActionState = { error?: string } | undefined;
export type ActionResult = { error?: string };

const EMPLOYMENT_TYPES = new Set(["full_time", "part_time", "contract"]);
const EMPLOYEE_STATUSES = new Set(["active", "inactive"]);

async function readEmployeeFields(orgId: number, formData: FormData): Promise<{ error?: string; fields?: {
  employeeCode: string;
  name: string;
  email: string | null;
  phone: string | null;
  departmentId: number | null;
  designation: string | null;
  employmentType: string;
  joinDate: string | null;
  status: string;
} }> {
  const employeeCode = String(formData.get("employeeCode") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!employeeCode) return { error: "Employee code is required." };
  if (!name) return { error: "Name is required." };

  const employmentType = String(formData.get("employmentType") ?? "full_time");
  if (!EMPLOYMENT_TYPES.has(employmentType)) return { error: "Invalid employment type." };
  const status = String(formData.get("status") ?? "active");
  if (!EMPLOYEE_STATUSES.has(status)) return { error: "Invalid employee status." };

  const departmentIdRaw = Number(formData.get("departmentId"));
  let departmentId: number | null = null;
  if (departmentIdRaw) {
    const [dept] = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, departmentIdRaw), eq(departmentsTable.orgId, orgId)));
    if (!dept) return { error: "Department not found." };
    departmentId = dept.id;
  }

  return {
    fields: {
      employeeCode,
      name,
      email: String(formData.get("email") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      departmentId,
      designation: String(formData.get("designation") ?? "").trim() || null,
      employmentType,
      joinDate: String(formData.get("joinDate") ?? "").trim() || null,
      status,
    },
  };
}

export async function createEmployeeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const parsed = await readEmployeeFields(session.orgId, formData);
  if (parsed.error || !parsed.fields) return { error: parsed.error };

  const [row] = await db
    .insert(employeesTable)
    .values({ orgId: session.orgId, ...parsed.fields })
    .returning({ id: employeesTable.id });

  await logActivity(session, {
    type: "employee.created",
    description: `Added employee "${parsed.fields.name}"`,
    entityType: "employee",
    entityId: row.id,
  });

  revalidatePath("/hr/employees");
  revalidatePath("/dashboard");
  redirect(`/hr/employees/${row.id}`);
}

export async function updateEmployeeAction(id: number, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const parsed = await readEmployeeFields(session.orgId, formData);
  if (parsed.error || !parsed.fields) return { error: parsed.error };

  const result = await db
    .update(employeesTable)
    .set({ ...parsed.fields, updatedAt: new Date() })
    .where(and(eq(employeesTable.id, id), eq(employeesTable.orgId, session.orgId)))
    .returning({ id: employeesTable.id });
  if (!result.length) return { error: "Employee not found." };

  await logActivity(session, {
    type: "employee.updated",
    description: `Updated employee "${parsed.fields.name}"`,
    entityType: "employee",
    entityId: id,
  });

  revalidatePath("/hr/employees");
  revalidatePath(`/hr/employees/${id}`);
  revalidatePath("/dashboard");
  return {};
}

// Each save inserts a new row rather than updating in place — salary history stays intact and
// the newest effective_from (then newest id) wins as the "current" structure payroll snapshots.
export async function saveSalaryStructureAction(employeeId: number, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();

  const [employee] = await db
    .select({ id: employeesTable.id, name: employeesTable.name })
    .from(employeesTable)
    .where(and(eq(employeesTable.id, employeeId), eq(employeesTable.orgId, session.orgId)));
  if (!employee) return { error: "Employee not found." };

  const basicSalary = Number(formData.get("basicSalary"));
  const allowances = Number(formData.get("allowances") || 0);
  const deductions = Number(formData.get("deductions") || 0);
  const effectiveFrom = String(formData.get("effectiveFrom") ?? "").trim();

  if (!basicSalary || Number.isNaN(basicSalary) || basicSalary <= 0) return { error: "Basic salary must be greater than zero." };
  if (Number.isNaN(allowances) || allowances < 0) return { error: "Allowances must be zero or more." };
  if (Number.isNaN(deductions) || deductions < 0) return { error: "Deductions must be zero or more." };
  if (!effectiveFrom) return { error: "Effective date is required." };

  await db.insert(salaryStructuresTable).values({
    orgId: session.orgId,
    employeeId,
    basicSalary: basicSalary.toFixed(2),
    allowances: allowances.toFixed(2),
    deductions: deductions.toFixed(2),
    effectiveFrom,
  });

  await logActivity(session, {
    type: "employee.salary_updated",
    description: `Updated salary structure for "${employee.name}"`,
    entityType: "employee",
    entityId: employeeId,
  });

  revalidatePath(`/hr/employees/${employeeId}`);
  revalidatePath("/hr/payroll");
  return {};
}

// Employee photo — cropped 1:1 (512×512) client-side, stored on Vercel Blob (tenant-scoped).
// Replace flow: validate ownership → validate image → upload new → update DB → delete old blob.
export async function uploadEmployeePhotoAction(employeeId: number, formData: FormData): Promise<{ error?: string }> {
  const session = await requireSession();
  const [emp] = await db.select({ id: employeesTable.id, photoUrl: employeesTable.photoUrl }).from(employeesTable).where(and(eq(employeesTable.id, employeeId), eq(employeesTable.orgId, session.orgId)));
  if (!emp) return { error: "Employee not found." };
  const v = await validateUpload(formData.get("photo"), { kind: "image", maxBytes: IMAGE_MAX_BYTES, exactDimensions: { width: 512, height: 512 } });
  if (v.error) return { error: v.error };
  const newUrl = await storeBlob(session.orgId, "employee-photos", v.bytes!, v.ext!, v.contentType!);
  await db.update(employeesTable).set({ photoUrl: newUrl }).where(and(eq(employeesTable.id, employeeId), eq(employeesTable.orgId, session.orgId)));
  await deleteStoredBlob(emp.photoUrl);
  await logActivity(session, { type: "employee.photo_updated", description: "Updated employee photo", entityType: "employee", entityId: employeeId });
  revalidatePath("/hr/employees");
  revalidatePath(`/hr/employees/${employeeId}`);
  return {};
}
