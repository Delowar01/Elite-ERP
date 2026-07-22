"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, ExternalLink } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { t, type Locale } from "@/lib/i18n/dict";
import type { NotificationItem } from "@/lib/notifications";
import { markNotificationRead, markAllNotificationsRead } from "@/app/(app)/notification-actions";

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

// Topbar notifications bell — real, backed by the org activity feed. Read state is per-user:
// each item can be marked read or opened (navigates to the related record and marks it read),
// and "Mark all as read" advances the user's watermark. Badge shows unread count.
export function NotificationsMenu({
  locale,
  notifications,
  unreadCount,
}: {
  locale: Locale;
  notifications: NotificationItem[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function markRead(id: number) {
    startTransition(async () => {
      await markNotificationRead(id);
      router.refresh();
    });
  }
  function markAll() {
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  }
  function open(n: NotificationItem) {
    startTransition(async () => {
      if (!n.read) await markNotificationRead(n.id);
      if (n.href) router.push(n.href);
      else router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="topbar-icon-btn outline-none" aria-label={t(locale, "Notifications")}>
        <Bell className="size-4" />
        {unreadCount > 0 && <span className="topbar-icon-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-line">
          <span className="text-[13px] font-semibold">{t(locale, "Notifications")}</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAll}
              disabled={pending}
              className="inline-flex items-center gap-1 text-[11.5px] text-brand-orange hover:underline disabled:opacity-50"
            >
              <CheckCheck className="size-3.5" /> {t(locale, "Mark all as read")}
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12.5px] text-ink-faint">{t(locale, "No activity yet.")}</div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto">
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`group flex items-start gap-2 px-3 py-2.5 border-b border-line last:border-0 ${n.read ? "" : "bg-accent-orange-bg/40"}`}
              >
                {!n.read && <span className="mt-1.5 size-1.5 rounded-full bg-brand-orange shrink-0" aria-hidden />}
                <button type="button" onClick={() => open(n)} disabled={pending} className="flex-1 text-start min-w-0">
                  <div className={`text-[12.5px] leading-snug ${n.read ? "text-ink-muted" : "font-medium"}`}>{n.description}</div>
                  <div className="text-[11px] text-ink-faint mt-0.5 flex items-center gap-1">
                    {n.userName ? `${n.userName} · ` : ""}
                    {timeAgo(n.createdAt, locale)}
                    {n.href && <ExternalLink className="size-3 opacity-0 group-hover:opacity-100" />}
                  </div>
                </button>
                {!n.read && (
                  <button
                    type="button"
                    onClick={() => markRead(n.id)}
                    disabled={pending}
                    className="p-1 text-ink-faint hover:text-brand-orange shrink-0"
                    title={t(locale, "Mark as read")}
                    aria-label={t(locale, "Mark as read")}
                  >
                    <Check className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
