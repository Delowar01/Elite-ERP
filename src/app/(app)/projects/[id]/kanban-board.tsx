"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { createTaskAction, updateTaskAction } from "../actions";

export type TaskRow = {
  id: number;
  title: string;
  description: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  status: string;
  priority: string | null;
  dueDate: string | null;
};

export type EmployeeOption = { id: number; name: string };

const COLUMNS: { status: string; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "blocked", label: "Blocked" },
  { status: "done", label: "Done" },
];

const PRIORITY_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
const PRIORITY_STYLE: Record<string, React.CSSProperties> = {
  low: { background: "var(--surface)", color: "var(--ink-muted)", border: "1px solid var(--line)" },
  medium: { background: "var(--info-bg)", color: "var(--info)" },
  high: { background: "var(--danger-bg)", color: "var(--danger)" },
};

// Same fixed avatar gradient pool the mockup's kanban cards use — assigned per employee id
// so the same person always renders with the same color everywhere on the board.
const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#3A5AC9,#22235E)",
  "linear-gradient(135deg,var(--brand-orange-light),var(--brand-orange))",
  "linear-gradient(135deg,#5C5D82,#22235E)",
  "linear-gradient(135deg,#1E8E5A,#124A31)",
];

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

type DialogState = { mode: "new" } | { mode: "edit"; task: TaskRow } | null;

export function KanbanBoard({
  locale,
  projectId,
  tasks,
  employees,
}: {
  locale: Locale;
  projectId: number;
  tasks: TaskRow[];
  employees: EmployeeOption[];
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [status, setStatus] = useState("todo");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [pending, startTransition] = useTransition();

  function openNew() {
    setTitle("");
    setDescription("");
    setAssigneeId("");
    setStatus("todo");
    setPriority("medium");
    setDueDate("");
    setDialog({ mode: "new" });
  }

  function openEdit(task: TaskRow) {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setAssigneeId(task.assigneeId ? String(task.assigneeId) : "");
    setStatus(task.status);
    setPriority(task.priority ?? "medium");
    setDueDate(task.dueDate ?? "");
    setDialog({ mode: "edit", task });
  }

  function submit() {
    const formData = new FormData();
    formData.set("projectId", String(projectId));
    if (dialog?.mode === "edit") formData.set("taskId", String(dialog.task.id));
    formData.set("title", title);
    formData.set("description", description);
    formData.set("assigneeId", assigneeId);
    formData.set("status", status);
    formData.set("priority", priority);
    formData.set("dueDate", dueDate);
    startTransition(async () => {
      const result = dialog?.mode === "edit" ? await updateTaskAction(formData) : await createTaskAction(formData);
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Task saved."));
        setDialog(null);
      }
    });
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <div />
        <Button variant="secondary" onClick={openNew}>
          <Plus className="size-3.5" /> {t(locale, "Add Task")}
        </Button>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface shadow-elevated py-12 text-center text-ink-muted text-sm">
          {t(locale, "No tasks yet. Add the first task to this project.")}
        </div>
      ) : (
        <div className="kanban">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((task) => task.status === col.status);
            return (
              <div key={col.status} className="kanban-col">
                <div className="kanban-col-head">
                  <span>{t(locale, col.label)}</span>
                  <span>{colTasks.length}</span>
                </div>
                {colTasks.map((task) => {
                  const grad = task.assigneeId ? AVATAR_GRADIENTS[task.assigneeId % AVATAR_GRADIENTS.length] : null;
                  return (
                    <div key={task.id} className="kanban-card" onClick={() => openEdit(task)}>
                      <div className="t">{task.title}</div>
                      <div className="meta-row">
                        {col.status === "done" ? (
                          <span className="pill pill-success">{t(locale, "Done")}</span>
                        ) : (
                          <span className="pill" style={PRIORITY_STYLE[task.priority ?? "medium"]}>
                            {t(locale, PRIORITY_LABEL[task.priority ?? "medium"])}
                          </span>
                        )}
                        {task.assigneeName && grad ? (
                          <div className="kanban-avatar" style={{ background: grad }} title={task.assigneeName}>
                            {initials(task.assigneeName)}
                          </div>
                        ) : (
                          <span />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.mode === "edit" ? t(locale, "Edit Task") : t(locale, "New Task")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <FormField label={t(locale, "Task Title")} htmlFor="task-title">
              <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </FormField>
            <FormField label={t(locale, "Description")} htmlFor="task-desc">
              <Input id="task-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label={t(locale, "Status")} htmlFor="task-status">
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="task-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLUMNS.map((c) => (
                      <SelectItem key={c.status} value={c.status}>
                        {t(locale, c.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label={t(locale, "Priority")} htmlFor="task-priority">
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger id="task-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["low", "medium", "high"] as const).map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(locale, PRIORITY_LABEL[p])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label={t(locale, "Assignee")} htmlFor="task-assignee">
                <Select value={assigneeId} onValueChange={setAssigneeId} disabled={employees.length === 0}>
                  <SelectTrigger id="task-assignee">
                    <SelectValue placeholder={t(locale, "Unassigned")} />
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
              <FormField label={t(locale, "Due Date")} htmlFor="task-due">
                <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </FormField>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || !title.trim()}>
              {pending ? t(locale, "Saving…") : t(locale, "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
