"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { LogoMark } from "@/components/brand/logo-mark";
import { NAV_GROUPS } from "./nav-config";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/app/(app)/actions";

type SessionUser = {
  name: string;
  email: string;
  role: "owner" | "admin" | "staff";
};

export function AppShell({
  user,
  orgName,
  children,
}: {
  user: SessionUser;
  orgName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside
        className="w-60 shrink-0 flex flex-col gap-5 p-3.5 text-sidebar-ink overflow-y-auto"
        style={{ background: "var(--sidebar-grad)" }}
      >
        <div className="flex items-center gap-2.5 px-2 py-1">
          <LogoMark size={26} color="#FFFFFF" />
          <span className="font-display font-extrabold text-[15px] text-white tracking-tight">
            Elite ERP
          </span>
        </div>
        <nav className="flex flex-col gap-4">
          {NAV_GROUPS.map((group, gi) => {
            const items = group.items.filter((it) => !it.roles || it.roles.includes(user.role));
            if (items.length === 0) return null;
            return (
              <div key={gi} className="flex flex-col gap-0.5">
                {group.label && (
                  <div
                    className="px-3 pb-1 text-[10px] font-mono uppercase tracking-wider opacity-65"
                    style={{ color: "var(--sidebar-ink-muted)" }}
                  >
                    {group.label}
                  </div>
                )}
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                        active ? "text-white" : "hover:text-white",
                      )}
                      style={{
                        background: active ? "var(--sidebar-active-bg)" : undefined,
                        color: active ? "#fff" : "var(--sidebar-ink-muted)",
                        boxShadow: active ? "inset 2px 0 0 var(--brand-orange)" : undefined,
                      }}
                    >
                      <Icon className="size-4 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 flex items-center justify-between px-7 border-b border-line bg-surface/70 backdrop-blur-md sticky top-0 z-30">
          <span className="font-mono text-[11.5px] text-ink-muted border border-line rounded-full px-3 py-1.5 bg-surface shadow-sm">
            {orgName}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2.5 outline-none">
              <Avatar className="size-8">
                <AvatarFallback
                  className="text-[11px]"
                  style={{ background: "linear-gradient(135deg, var(--brand-orange-light), var(--brand-orange))" }}
                >
                  {initials}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
              <div className="px-3 pb-2 -mt-1 text-xs text-ink-faint">{user.email}</div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => logoutAction()} className="cursor-pointer">
                <LogOut className="size-3.5" /> Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 p-7 bg-canvas">{children}</main>
      </div>
    </div>
  );
}
