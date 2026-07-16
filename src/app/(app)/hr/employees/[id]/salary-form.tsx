"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { t, type Locale } from "@/lib/i18n/dict";
import type { SalaryStructure } from "@/db";
import { saveSalaryStructureAction } from "../actions";

export function SalaryForm({ locale, employeeId, current }: { locale: Locale; employeeId: number; current: SalaryStructure | null }) {
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await saveSalaryStructureAction(employeeId, formData);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Salary structure saved."));
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t(locale, "Basic salary")} htmlFor="basicSalary">
          <Input id="basicSalary" name="basicSalary" type="number" step="0.01" min="0.01" required defaultValue={current?.basicSalary ?? ""} />
        </FormField>
        <FormField label={t(locale, "Allowances")} htmlFor="allowances">
          <Input id="allowances" name="allowances" type="number" step="0.01" min="0" defaultValue={current?.allowances ?? "0"} />
        </FormField>
        <FormField label={t(locale, "Deductions")} htmlFor="deductions">
          <Input id="deductions" name="deductions" type="number" step="0.01" min="0" defaultValue={current?.deductions ?? "0"} />
        </FormField>
        <FormField label={t(locale, "Effective From")} htmlFor="effectiveFrom">
          <Input id="effectiveFrom" name="effectiveFrom" type="date" required defaultValue={current?.effectiveFrom ?? ""} />
        </FormField>
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? t(locale, "Saving…") : t(locale, "Save")}
        </Button>
      </div>
    </form>
  );
}
