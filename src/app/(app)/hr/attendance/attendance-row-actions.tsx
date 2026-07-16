"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";
import { checkInAction, checkOutAction } from "./actions";

export function AttendanceRowActions({
  locale,
  employeeId,
  canCheckIn,
  canCheckOut,
}: {
  locale: Locale;
  employeeId: number;
  canCheckIn: boolean;
  canCheckOut: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function run(kind: "in" | "out") {
    startTransition(async () => {
      const result = kind === "in" ? await checkInAction(employeeId) : await checkOutAction(employeeId);
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, kind === "in" ? "Checked in." : "Checked out."));
    });
  }

  if (!canCheckIn && !canCheckOut) return null;
  return (
    <div className="flex justify-end gap-2">
      {canCheckIn && (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => run("in")}>
          {t(locale, "Check-in")}
        </Button>
      )}
      {canCheckOut && (
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => run("out")}>
          {t(locale, "Check-out")}
        </Button>
      )}
    </div>
  );
}
