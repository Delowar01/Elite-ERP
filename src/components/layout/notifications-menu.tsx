"use client";

import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import type { NotificationItem } from "@/lib/notifications";

function timeAgo(iso: string, locale: Locale): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t(locale, "just now");
  if (mins < 60) return `${mins}${t(locale, "m ago")}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}${t(locale, "h ago")}`;
  const days = Math.floor(hrs / 24);
  return `${days}${t(locale, "d ago")}`;
}

// Topbar notifications bell — real, backed by the org activity feed (was decorative
// with a hardcoded "4" badge before). Badge shows the count of recent items.
export function NotificationsMenu({ locale, notifications }: { locale: Locale; notifications: NotificationItem[] }) {
  const count = notifications.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="topbar-icon-btn outline-none" aria-label={t(locale, "Notifications")}>
        <Bell className="size-4" />
        {count > 0 && <span className="topbar-icon-badge">{count > 9 ? "9+" : count}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[320px]">
        <DropdownMenuLabel>{t(locale, "Notifications")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {count === 0 ? (
          <div className="px-3 py-6 text-center text-[12.5px] text-ink-faint">{t(locale, "No activity yet.")}</div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            {notifications.map((n) => (
              <div key={n.id} className="px-3 py-2.5 border-b border-line last:border-0">
                <div className="text-[12.5px] leading-snug">{n.description}</div>
                <div className="text-[11px] text-ink-faint mt-0.5">
                  {n.userName ? `${n.userName} · ` : ""}
                  {timeAgo(n.createdAt, locale)}
                </div>
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
