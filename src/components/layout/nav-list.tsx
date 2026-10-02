"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { visibleNavGroups, isNavActive, type Role } from "./nav-config";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n/dict";

// The one navigation renderer (DEV-UI-01.3). The persistent sidebar and the mobile drawer both render
// this, so role filtering, active-state detection, translation and group/item markup live here once;
// the items themselves come only from NAV_GROUPS (nav-config.ts).
//
//  - `rail`       icon-only compact rail: no group headers, every item shown, labels kept for screen
//                 readers and as the native tooltip.
//  - a group with ONE visible item renders without a header (D-01.3-C) — nothing to collapse.
//  - the group holding the active page is always expanded.
export function NavList({
  role,
  locale,
  pathname,
  rail = false,
  collapsedGroups,
  onToggleGroup,
  onNavigate,
  idPrefix,
  label,
}: {
  role: Role;
  locale: Locale;
  pathname: string;
  rail?: boolean;
  collapsedGroups: ReadonlySet<string>;
  onToggleGroup: (label: string) => void;
  onNavigate?: () => void;
  /** Distinguishes the sidebar's and the drawer's element ids (aria-controls targets). */
  idPrefix: string;
  /** Accessible name of the navigation landmark. */
  label: string;
}) {
  return (
    <nav className="sidebar-nav nav-list" aria-label={label}>
      {visibleNavGroups(role).map((group, gi) => {
        const items = group.items;
        const activeGroup = items.some((it) => isNavActive(pathname, it.href));
        const collapsible = !rail && !!group.label && items.length > 1;
        const groupCollapsed = collapsible && collapsedGroups.has(group.label!) && !activeGroup;
        const itemsId = `${idPrefix}-nav-group-${gi}`;

        return (
          <div key={group.label ?? gi} className={cn("nav-group", groupCollapsed && "group-collapsed")}>
            {collapsible && (
              <button
                type="button"
                className="nav-divider"
                onClick={() => onToggleGroup(group.label!)}
                aria-expanded={!groupCollapsed}
                aria-controls={itemsId}
              >
                <span>{t(locale, group.label!)}</span>
                <ChevronDown className={cn("nav-divider-chevron size-3.5", groupCollapsed && "is-collapsed")} aria-hidden />
              </button>
            )}
            <div id={itemsId} className="nav-group-items" hidden={groupCollapsed}>
              {!groupCollapsed &&
                items.map((item) => {
                  const active = isNavActive(pathname, item.href);
                  const Icon = item.icon;
                  const text = t(locale, item.label);
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
