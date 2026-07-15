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
import { createAccountAction } from "./actions";

const TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
const TYPE_LABEL: Record<(typeof TYPES)[number], string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expenses",
};

export function AddAccountDialog({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>("asset");
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    formData.set("type", type);
    startTransition(async () => {
      const result = await createAccountAction(formData);
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Saved"));
        setOpen(false);
      }
    });
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="w-full" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> {t(locale, "Add Account")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(locale, "Add Account")}</DialogTitle>
          </DialogHeader>
          <form action={submit} className="flex flex-col gap-4">
            <FormField label={t(locale, "Code")} htmlFor="acc-code">
              <Input id="acc-code" name="code" required placeholder="e.g. 1300" className="font-mono" />
            </FormField>
            <FormField label={t(locale, "Name")} htmlFor="acc-name">
              <Input id="acc-name" name="name" required autoFocus />
            </FormField>
            <FormField label={t(locale, "Type")} htmlFor="acc-type">
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="acc-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((ty) => (
                    <SelectItem key={ty} value={ty}>
                      {t(locale, TYPE_LABEL[ty])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? t(locale, "Saving…") : t(locale, "Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
