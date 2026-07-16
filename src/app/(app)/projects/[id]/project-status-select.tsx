"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import { updateProjectStatusAction } from "../actions";

const STATUSES = ["planned", "active", "on_hold", "completed", "cancelled"] as const;

export function ProjectStatusSelect({ locale, projectId, status }: { locale: Locale; projectId: number; status: string }) {
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    if (next === status) return;
    startTransition(async () => {
      const result = await updateProjectStatusAction(projectId, next);
      if (result.error) toast.error(result.error);
    });
  }

  return (
    <Select value={status} onValueChange={change} disabled={pending}>
      <SelectTrigger className="w-[150px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {t(locale, s)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
