"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import type { ActionState } from "./actions";

const STATUSES = ["planned", "active", "on_hold", "completed"] as const;

export function ProjectForm({
  locale,
  clients,
  action,
}: {
  locale: Locale;
  clients: { id: number; name: string }[];
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState("planned");

  return (
    <form action={formAction} className="flex flex-col gap-5 max-w-xl">
      {/* Radix Selects don't submit with FormData — mirror their state into hidden inputs. */}
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="status" value={status} />
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t(locale, "Project Name")} htmlFor="name" span={2}>
          <Input id="name" name="name" required placeholder="ERP Rollout — Aurora Fabrication" />
        </FormField>
        <FormField label={t(locale, "Client")} htmlFor="proj-client">
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger id="proj-client">
              <SelectValue placeholder={t(locale, "Select a client")} />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label={t(locale, "Status")} htmlFor="proj-status">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="proj-status">
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
        </FormField>
        <FormField label={t(locale, "Start Date")} htmlFor="startDate">
          <Input id="startDate" name="startDate" type="date" />
        </FormField>
        <FormField label={t(locale, "End Date")} htmlFor="endDate">
          <Input id="endDate" name="endDate" type="date" />
        </FormField>
        <FormField label={t(locale, "Budget")} htmlFor="budget">
          <Input id="budget" name="budget" type="number" step="0.01" min="0" placeholder="45000" />
        </FormField>
        <FormField label={t(locale, "Description")} htmlFor="description" span={2}>
          <Input id="description" name="description" />
        </FormField>
      </div>
      {state?.error && <p className="text-[12.5px] text-danger">{state.error}</p>}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t(locale, "Saving…") : t(locale, "Create Project")}
        </Button>
      </div>
    </form>
  );
}
