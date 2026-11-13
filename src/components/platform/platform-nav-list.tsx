"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/dict";
import { pt } from "./i18n";
import { isPlatformNavActive, PLATFORM_NAV } from "./nav-config";

// The console's one navigation renderer — the persistent sidebar and the mobile drawer both render
// it. It reuses the production shell's navigation classes (.nav-list / .nav-group / .nav-item …), so
// the console looks and behaves like the ERP shell without changing NavList or its stylesheet.
//  - `rail`: icon-only mini rail; labels stay for screen readers and as the native tooltip.
//  - every group shows its label; a group with more than one item can be collapsed (in memory).
//  - the group holding the active page is always expanded.
export function PlatformNavList({
  locale,
  pathname,
  rail = false,
  collapsedGroups,
  onToggleGroup,
  onNavigate,
  idPrefix,
}: {
  locale: Locale;
  pathname: string;
  rail?: boolean;
  collapsedGroups: ReadonlySet<string>;
  onToggleGroup: (label: string) => void;
  onNavigate?: () => void;
  idPrefix: string;
}) {
  return (
    <nav className="sidebar-nav nav-list platform-nav" aria-label={pt(locale, "shell.mainNav")}>
      {PLATFORM_NAV.map((group, gi) => {
        const activeGroup = group.items.some((it) => isPlatformNavActive(pathname, it.href));
        const collapsible = !rail && group.items.length > 1;
        const groupCollapsed = collapsible && collapsedGroups.has(group.label) && !activeGroup;
        const itemsId = `${idPrefix}-platform-nav-group-${gi}`;
        const groupLabel = pt(locale, group.label);
        return (
          <div key={group.label} className={cn("nav-group", groupCollapsed && "group-collapsed")}>
            {!rail &&
              (collapsible ? (
                <button type="button" className="nav-divider" onClick={() => onToggleGroup(group.label)} aria-expanded={!groupCollapsed} aria-controls={itemsId}>
                  <span>{groupLabel}</span>
                  <ChevronDown className={cn("nav-divider-chevron size-3.5", groupCollapsed && "is-collapsed")} aria-hidden />
                </button>
              ) : (
                <div className="nav-divider platform-nav-divider-static">
                  <span>{groupLabel}</span>
                </div>
              ))}
            <div id={itemsId} className="nav-group-items" hidden={groupCollapsed}>
              {!groupCollapsed &&
                group.items.map((item) => {
                  const active = isPlatformNavActive(pathname, item.href);
                  const Icon = item.icon;
                  const text = pt(locale, item.label);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn("nav-item", active && "active")}
                      aria-current={active ? "page" : undefined}
                      title={rail ? text : undefined}
                      onClick={onNavigate}
                    >
                      <Icon className="size-4" aria-hidden />
                      <span className="nav-item-label">{text}</span>
                    </Link>
                  );
                })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
