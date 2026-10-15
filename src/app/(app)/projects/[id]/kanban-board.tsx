"use client";

import { useRef, useState, useTransition } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import { statusLabel } from "@/lib/status-registry";
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

// Column order is the workflow order; labels come from the `task` status registry domain.
const COLUMNS: { status: string }[] = [{ status: "todo" }, { status: "in_progress" }, { status: "blocked" }, { status: "done" }];

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

// How a task card's accessible name joins its parts, per language.
const LIST_SEPARATOR: Record<Locale, string> = { en: ", ", ar: "، " };

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
  // The control that opened the dialog (a task card or Add Task): focus goes back to it on close.
  const opener = useRef<HTMLElement | null>(null);

  function openNew(trigger: HTMLElement) {
    opener.current = trigger;
    setTitle("");
    setDescription("");
    setAssigneeId("");
    setStatus("todo");
    setPriority("medium");
    setDueDate("");
    setDialog({ mode: "new" });
  }

  function openEdit(task: TaskRow, trigger: HTMLElement) {
    opener.current = trigger;
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

  // A task card's accessible name says what the card shows, in full: title, status, priority, assignee.
  const taskName = (task: TaskRow) =>
    [
      task.title,
      statusLabel(locale, "task", task.status),
      `${t(locale, "Priority")}: ${t(locale, PRIORITY_LABEL[task.priority ?? "medium"])}`,
      `${t(locale, "Assignee")}: ${task.assigneeName ?? t(locale, "Unassigned")}`,
    ].join(LIST_SEPARATOR[locale]);

  return (
    <>
      <SectionHeader
        level={2}
        title={t(locale, "Tasks")}
        actions={
          <Button variant="secondary" onClick={(e) => openNew(e.currentTarget)}>
            <Plus className="size-3.5" /> {t(locale, "Add Task")}
          </Button>
        }
        className="mb-3"
      />

      {tasks.length === 0 ? (
        <EmptyState message={t(locale, "No tasks yet. Add the first task to this project.")} />
      ) : (
        <div className="kanban">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((task) => task.status === col.status);
            return (
              <div key={col.status} className="kanban-col">
                <div className="kanban-col-head">
                  <h3>{statusLabel(locale, "task", col.status)}</h3>
                  <span>{colTasks.length}</span>
                </div>
                {colTasks.map((task) => {
                  const grad = task.assigneeId ? AVATAR_GRADIENTS[task.assigneeId % AVATAR_GRADIENTS.length] : null;
                  return (
                    // A real button: Tab reaches it and Enter / Space open the task — the browser's own keys.
                    <button
                      key={task.id}
                      type="button"
                      className="kanban-card block w-full text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      aria-label={taskName(task)}
                      data-task-id={task.id}
                      onClick={(e) => openEdit(task, e.currentTarget)}
                    >
                      <span className="t block">{task.title}</span>
                      <span className="meta-row">
                        {col.status === "done" ? (
                          <StatusBadge domain="task" status="done" locale={locale} />
                        ) : (
                          <span className="pill" style={PRIORITY_STYLE[task.priority ?? "medium"]}>
                            {t(locale, PRIORITY_LABEL[task.priority ?? "medium"])}
                          </span>
                        )}
                        {task.assigneeName && grad ? (
                          <span className="kanban-avatar" style={{ background: grad }} title={task.assigneeName}>
                            {initials(task.assigneeName)}
                          </span>
                        ) : (
                          <span />
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent
          onCloseAutoFocus={(e) => {
            // Back to the card (or Add Task) that opened the dialog. If a save re-rendered the board, the
            // same task's card, found by its id.
            e.preventDefault();
            const el = opener.current;
            const id = el?.dataset.taskId;
            (el?.isConnected ? el : id ? document.querySelector<HTMLElement>(`.kanban-card[data-task-id="${id}"]`) : null)?.focus();
          }}
        >
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
                        {statusLabel(locale, "task", c.status)}
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
