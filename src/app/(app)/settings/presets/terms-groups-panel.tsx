"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import type { TermsConditionsGroup } from "@/db";
import { saveTermsGroupAction, deleteTermsGroupAction } from "./actions";

const DOC_TYPE_LABELS: Record<string, string> = {
  quotation: "Quotation",
  sales_order: "Sales Order",
  proforma_invoice: "Proforma Invoice",
  sales_invoice: "Invoice",
  delivery_challan: "Delivery Challan",
  purchase_order: "Purchase Order",
};

export function TermsGroupsPanel({ locale, groups }: { locale: Locale; groups: TermsConditionsGroup[] }) {
  const [editing, setEditing] = useState<TermsConditionsGroup | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  const [docType, setDocType] = useState<string>("none");
  const [isDefault, setIsDefault] = useState(false);

  function openEdit(group: TermsConditionsGroup | "new") {
    setEditing(group);
    setDocType(group !== "new" ? (group.documentType ?? "none") : "none");
    setIsDefault(group !== "new" ? group.isDefault : false);
  }

  function submit(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    const content = String(formData.get("content") ?? "");
    startTransition(async () => {
      const result = await saveTermsGroupAction({
        id: editing !== "new" && editing ? editing.id : undefined,
        name,
        documentType: docType === "none" ? null : docType,
        content,
        isDefault,
      });
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Saved"));
        setEditing(null);
      }
    });
  }

  function onDelete(id: number) {
    startTransition(async () => {
      const result = await deleteTermsGroupAction(id);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Deleted"));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-ink-muted text-sm">{t(locale, "No terms & conditions groups yet.")}</CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(locale, "Name")}</TableHead>
              <TableHead>{t(locale, "Document Type")}</TableHead>
              <TableHead>{t(locale, "Preview")}</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <TableRow key={group.id}>
                <TableCell className="font-medium">{group.name}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="info">
                      {group.documentType ? t(locale, DOC_TYPE_LABELS[group.documentType] ?? group.documentType) : t(locale, "Any")}
                    </Badge>
                    {group.isDefault && <Badge variant="success">{t(locale, "Default")}</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-ink-muted text-xs max-w-xs truncate">{group.content}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon" disabled={pending} onClick={() => openEdit(group)} aria-label={t(locale, "Edit")}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" disabled={pending} onClick={() => onDelete(group.id)} aria-label={t(locale, "Delete")} className="text-danger hover:text-danger">
                    <Trash2 className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="add-row-btn" onClick={() => openEdit("new")} role="button">
        <Plus className="size-3.5" /> {t(locale, "Add Terms Group")}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t(locale, "Add Terms Group") : t(locale, "Edit")}</DialogTitle>
          </DialogHeader>
          <form action={submit} className="flex flex-col gap-4">
            <FormField label={t(locale, "Name")} htmlFor="tg-name">
              <Input id="tg-name" name="name" required defaultValue={editing && editing !== "new" ? editing.name : ""} autoFocus />
            </FormField>
            <FormField label={t(locale, "Document Type")} htmlFor="tg-doctype">
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger id="tg-doctype">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t(locale, "Any document type")}</SelectItem>
                  {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {t(locale, label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={t(locale, "Content")} htmlFor="tg-content">
              <Textarea id="tg-content" name="content" required rows={5} defaultValue={editing && editing !== "new" ? editing.content : ""} />
            </FormField>
            <label className="flex items-center gap-2 text-[13px] text-ink-muted cursor-pointer">
              <Checkbox checked={isDefault} onCheckedChange={(checked) => setIsDefault(checked === true)} />
              {t(locale, "Use as default for this document type")}
            </label>
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
