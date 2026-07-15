"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, MoreVertical } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import type { User, Role } from "@/db";
import { addTeamMemberAction, changeRoleAction, toggleMemberActiveAction } from "./actions";

const ROLE_LABELS: Record<Role, string> = { owner: "Owner", admin: "Admin", staff: "Staff" };

export function TeamPanel({
  locale,
  members,
  currentUserId,
  currentUserRole,
}: {
  locale: Locale;
  members: User[];
  currentUserId: number;
  currentUserRole: Role;
}) {
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<Role>("staff");
  const [pending, startTransition] = useTransition();

  const assignableRoles: Role[] = currentUserRole === "owner" ? ["owner", "admin", "staff"] : ["admin", "staff"];

  function submitAdd(formData: FormData) {
    formData.set("role", role);
    startTransition(async () => {
      const result = await addTeamMemberAction(formData);
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Saved"));
        setAdding(false);
      }
    });
  }

  function run(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
      else toast.success(t(locale, "Saved"));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-[17px] font-bold">{t(locale, "Team")}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Name")}</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>{t(locale, "Role")}</TableHead>
            <TableHead>{t(locale, "Status")}</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.id}>
              <TableCell className="font-medium">{member.name}</TableCell>
              <TableCell className="text-ink-muted font-mono text-xs">{member.email}</TableCell>
              <TableCell>
                <Badge variant={member.role === "owner" ? "info" : "neutral"}>{t(locale, ROLE_LABELS[member.role as Role])}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={member.isActive ? "success" : "neutral"}>{member.isActive ? t(locale, "Active") : t(locale, "Inactive")}</Badge>
              </TableCell>
              <TableCell className="text-right">
                {member.id !== currentUserId && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" disabled={pending} aria-label={t(locale, "Member actions")}>
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {assignableRoles
                        .filter((r) => r !== member.role)
                        .map((r) => (
                          <DropdownMenuItem key={r} className="cursor-pointer" onSelect={() => run(() => changeRoleAction(member.id, r))}>
                            {t(locale, "Make")} {t(locale, ROLE_LABELS[r])}
                          </DropdownMenuItem>
                        ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onSelect={() => run(() => toggleMemberActiveAction(member.id, !member.isActive))}
                      >
                        {member.isActive ? t(locale, "Deactivate") : t(locale, "Activate")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" /> {t(locale, "Add Team Member")}
        </Button>
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(locale, "Add Team Member")}</DialogTitle>
          </DialogHeader>
          <form action={submitAdd} className="flex flex-col gap-4">
            <FormField label={t(locale, "Name")} htmlFor="member-name">
              <Input id="member-name" name="name" required autoFocus />
            </FormField>
            <FormField label="Email" htmlFor="member-email">
              <Input id="member-email" name="email" type="email" required />
            </FormField>
            <FormField label={t(locale, "Role")} htmlFor="member-role">
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="member-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(locale, ROLE_LABELS[r])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={t(locale, "Temporary Password")} htmlFor="member-password">
              <Input id="member-password" name="password" type="text" minLength={8} required />
              <p className="text-[11px] text-ink-faint mt-1.5">
                {t(locale, "No email invites are sent yet — share this password with the new member directly.")}
              </p>
            </FormField>
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
