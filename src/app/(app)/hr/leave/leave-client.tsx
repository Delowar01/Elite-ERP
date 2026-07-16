"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { t, type Locale } from "@/lib/i18n/dict";
import { requestLeaveAction, approveLeaveAction, rejectLeaveAction } from "./actions";

export type LeaveRow = {
  id: number;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
};

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
};

const TYPE_LABEL: Record<string, string> = { annual: "Annual", sick: "Sick", unpaid: "Unpaid", other: "Other" };

export function LeaveClient({
  locale,
  rows,
  employees,
  canDecide,
}: {
  locale: Locale;
  rows: LeaveRow[];
  employees: { id: number; name: string }[];
  canDecide: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const formData = new FormData();
    formData.set("employeeId", employeeId);
    formData.set("type", type);
    formData.set("startDate", startDate);
    formData.set("endDate", endDate);
    formData.set("reason", reason);
    startTransition(async () => {
      const result = await requestLeaveAction(formData);
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Leave request submitted."));
        setOpen(false);
        setEmployeeId("");
        setStartDate("");
        setEndDate("");
        setReason("");
      }
    });
  }

  function decide(id: number, kind: "approve" | "reject") {
    startTransition(async () => {
      const result = kind === "approve" ? await approveLeaveAction(id) : await rejectLeaveAction(id);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, kind === "approve" ? "Leave approved — attendance synced." : "Leave request rejected."));
    });
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head">
        <h3>{t(locale, "Leave Requests")}</h3>
        <Button onClick={() => setOpen(true)} disabled={employees.length === 0} style={{ width: "auto", padding: "0 18px" }}>
          <Plus className="size-3.5" /> {t(locale, "Request Leave")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 text-center text-ink-muted text-sm">
          {t(locale, "No leave requests yet.")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Employee")}</TableHead>
              <TableHead>{t(locale, "Type")}</TableHead>
              <TableHead>{t(locale, "Dates")}</TableHead>
              <TableHead>{t(locale, "Reason")}</TableHead>
              <TableHead>{t(locale, "Status")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.employeeName}</TableCell>
                <TableCell>{t(locale, TYPE_LABEL[r.type] ?? r.type)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {r.startDate}
                  {r.endDate !== r.startDate ? ` – ${r.endDate}` : ""}
                </TableCell>
                <TableCell className="max-w-[180px] truncate text-ink-muted" title={r.reason ?? undefined}>
                  {r.reason ?? <span className="text-ink-faint">—</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.status] ?? "neutral"} live={r.status === "pending"}>
                    {t(locale, r.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {canDecide && r.status === "pending" && (
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => decide(r.id, "reject")}>
                        {t(locale, "Reject")}
                      </Button>
                      <Button size="sm" disabled={pending} onClick={() => decide(r.id, "approve")}>
                        {t(locale, "Approve")}
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(locale, "Request Leave")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <FormField label={t(locale, "Employee")} htmlFor="leave-employee">
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger id="leave-employee">
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
              <FormField label={t(locale, "Type")} htmlFor="leave-type">
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="leave-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABEL).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {t(locale, label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label={t(locale, "Reason")} htmlFor="leave-reason">
                <Input id="leave-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </FormField>
              <FormField label={t(locale, "Start Date")} htmlFor="leave-start">
                <Input id="leave-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </FormField>
              <FormField label={t(locale, "End Date")} htmlFor="leave-end">
                <Input id="leave-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </FormField>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !employeeId || !startDate || !endDate}>
              {pending ? t(locale, "Saving…") : t(locale, "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
