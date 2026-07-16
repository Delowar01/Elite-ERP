"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { logTimeAction } from "../actions";

export function LogTimeDialog({
  locale,
  tasks,
  employees,
}: {
  locale: Locale;
  tasks: { id: number; title: string }[];
  employees: { id: number; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState("");
  const [billable, setBillable] = useState("true");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const formData = new FormData();
    formData.set("taskId", taskId);
    formData.set("employeeId", employeeId);
    formData.set("date", date);
    formData.set("hours", hours);
    formData.set("billable", billable);
    formData.set("notes", notes);
    startTransition(async () => {
      const result = await logTimeAction(formData);
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Time logged."));
        setHours("");
        setNotes("");
        setOpen(false);
      }
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Clock className="size-3.5" /> {t(locale, "Log Time")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(locale, "Log Time")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <FormField label={t(locale, "Task")} htmlFor="log-task">
              <Select value={taskId} onValueChange={setTaskId}>
                <SelectTrigger id="log-task">
                  <SelectValue placeholder={t(locale, "Select a task")} />
                </SelectTrigger>
                <SelectContent>
                  {tasks.map((task) => (
                    <SelectItem key={task.id} value={String(task.id)}>
                      {task.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={t(locale, "Employee")} htmlFor="log-employee">
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger id="log-employee">
                  <SelectValue placeholder={t(locale, "Select an employee")} />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label={t(locale, "Date")} htmlFor="log-date">
                <Input id="log-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </FormField>
              <FormField label={t(locale, "Hours")} htmlFor="log-hours">
                <Input id="log-hours" type="number" step="0.25" min="0.25" value={hours} onChange={(e) => setHours(e.target.value)} />
              </FormField>
              <FormField label={t(locale, "Billable")} htmlFor="log-billable">
                <Select value={billable} onValueChange={setBillable}>
                  <SelectTrigger id="log-billable">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">{t(locale, "Yes")}</SelectItem>
                    <SelectItem value="false">{t(locale, "No")}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label={t(locale, "Notes")} htmlFor="log-notes">
                <Input id="log-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </FormField>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !taskId || !employeeId || !hours}>
              {pending ? t(locale, "Saving…") : t(locale, "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
