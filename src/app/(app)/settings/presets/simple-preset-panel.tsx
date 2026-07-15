"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import type { ActionResult } from "./actions";

export type SimplePresetItem = { id: number; name: string; extra: string | number | null };

export function SimplePresetPanel({
  locale,
  items,
  extraLabel,
  extraType = "text",
  addLabel,
  emptyLabel,
  create,
  update,
  remove,
}: {
  locale: Locale;
  items: SimplePresetItem[];
  extraLabel: string | null;
  extraType?: "text" | "number";
  addLabel: string;
  emptyLabel: string;
  create: (name: string, extra: string) => Promise<ActionResult>;
  update: (id: number, name: string, extra: string) => Promise<ActionResult>;
  remove: (id: number) => Promise<ActionResult>;
}) {
  const [editing, setEditing] = useState<SimplePresetItem | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    const extra = String(formData.get("extra") ?? "");
    startTransition(async () => {
      const result = editing === "new" ? await create(name, extra) : await update((editing as SimplePresetItem).id, name, extra);
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Saved"));
        setEditing(null);
      }
    });
  }

  function onDelete(id: number) {
    startTransition(async () => {
      const result = await remove(id);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Deleted"));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-ink-muted text-sm">{emptyLabel}</CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Name")}</TableHead>
              {extraLabel && <TableHead className="text-right">{extraLabel}</TableHead>}
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.name}</TableCell>
                {extraLabel && <TableCell className="text-right font-mono text-xs">{item.extra ?? "—"}</TableCell>}
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon" disabled={pending} onClick={() => setEditing(item)} aria-label={t(locale, "Edit")}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    onClick={() => onDelete(item.id)}
                    aria-label={t(locale, "Delete")}
                    className="text-danger hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div>
        <Button variant="ghost" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> {addLabel}
        </Button>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? addLabel : t(locale, "Edit")}</DialogTitle>
          </DialogHeader>
          <form action={submit} className="flex flex-col gap-4">
            <FormField label={t(locale, "Name")} htmlFor="preset-name">
              <Input
                id="preset-name"
                name="name"
                required
                defaultValue={editing && editing !== "new" ? editing.name : ""}
                autoFocus
              />
            </FormField>
            {extraLabel && (
              <FormField label={extraLabel} htmlFor="preset-extra">
                <Input
                  id="preset-extra"
                  name="extra"
                  type={extraType === "number" ? "number" : "text"}
                  step={extraType === "number" ? "any" : undefined}
                  defaultValue={editing && editing !== "new" ? (editing.extra ?? "") : ""}
                />
              </FormField>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? t(locale, "Saving…") : t(locale, "Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
