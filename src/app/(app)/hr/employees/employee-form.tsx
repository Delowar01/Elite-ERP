"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RecordImageUpload } from "@/components/upload/record-image-upload";
import { CROP_EMPLOYEE_PHOTO } from "@/components/upload/crop-configs";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Employee } from "@/db";
import { type ActionState, uploadEmployeePhotoAction } from "./actions";

const EMPLOYMENT_TYPES: { value: string; label: string }[] = [
  { value: "full_time", label: "Full Time" },
  { value: "part_time", label: "Part Time" },
  { value: "contract", label: "Contract" },
];

export function EmployeeForm({
  locale,
  employee,
  departments,
  codeSuggestion,
  action,
  submitLabel,
}: {
  locale: Locale;
  employee?: Employee;
  departments: { id: number; name: string }[];
  codeSuggestion?: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [departmentId, setDepartmentId] = useState(employee?.departmentId ? String(employee.departmentId) : "");
  const [employmentType, setEmploymentType] = useState(employee?.employmentType ?? "full_time");
  const [status, setStatus] = useState(employee?.status ?? "active");

  return (
    <form action={formAction} className="flex flex-col gap-5 max-w-xl">
      <input type="hidden" name="departmentId" value={departmentId} />
      <input type="hidden" name="employmentType" value={employmentType} />
      <input type="hidden" name="status" value={status} />
      {employee && (
        <div>
          <FormField label={t(locale, "Photo")} htmlFor="photo">
            <RecordImageUpload
              locale={locale}
              currentUrl={employee.photoUrl}
              config={CROP_EMPLOYEE_PHOTO}
              fieldName="photo"
              label="Upload Photo"
              round
              action={uploadEmployeePhotoAction.bind(null, employee.id)}
            />
          </FormField>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t(locale, "Employee Code")} htmlFor="employeeCode">
          <Input id="employeeCode" name="employeeCode" required defaultValue={employee?.employeeCode ?? codeSuggestion} />
        </FormField>
        <FormField label={t(locale, "Name")} htmlFor="name">
          <Input id="name" name="name" required defaultValue={employee?.name} placeholder="Layla Khan" />
        </FormField>
        <FormField label={t(locale, "Email")} htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={employee?.email ?? ""} />
        </FormField>
        <FormField label={t(locale, "Phone")} htmlFor="phone">
          <Input id="phone" name="phone" defaultValue={employee?.phone ?? ""} />
        </FormField>
        <FormField label={t(locale, "Department")} htmlFor="emp-department">
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger id="emp-department">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label={t(locale, "Designation")} htmlFor="designation">
          <Input id="designation" name="designation" defaultValue={employee?.designation ?? ""} placeholder="Accountant" />
        </FormField>
        <FormField label={t(locale, "Employment Type")} htmlFor="emp-type">
          <Select value={employmentType} onValueChange={setEmploymentType}>
            <SelectTrigger id="emp-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYMENT_TYPES.map((et) => (
                <SelectItem key={et.value} value={et.value}>
                  {t(locale, et.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label={t(locale, "Join Date")} htmlFor="joinDate">
          <Input id="joinDate" name="joinDate" type="date" defaultValue={employee?.joinDate ?? ""} />
        </FormField>
        {employee && (
          <FormField label={t(locale, "Status")} htmlFor="emp-status">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="emp-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t(locale, "active")}</SelectItem>
                <SelectItem value="inactive">{t(locale, "inactive")}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        )}
      </div>
      {state?.error && <p className="text-[12.5px] text-danger">{state.error}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t(locale, "Saving…") : submitLabel}
        </Button>
      </div>
    </form>
  );
}
