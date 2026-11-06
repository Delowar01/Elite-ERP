"use client";

import { usePathname } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { BrandMark } from "./brand-mark";
import { NavList } from "./nav-list";
import type { Role } from "./nav-config";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n/dict";
import { SIDEBAR_COLLAPSED_COOKIE, SIDEBAR_GROUPS_COOKIE } from "@/lib/sidebar-cookies";
import { useSidebarScroll } from "./use-sidebar-scroll";

// Breakpoint model (LCP shell): ≥1024 the user's expanded (256px) / mini (68px) preference; 768–1023
// always the 68px mini rail, so dense ERP tables keep their width on a tablet; <768 no persistent rail
// (the LCP navigation sheet takes over, see mobile-nav.tsx). shell.css enforces the geometry from the
// first paint; this query only switches the rendered content (labels → tooltips, group headers off)
// once the client knows the width.
const TABLET_RAIL_QUERY = "(min-width: 768px) and (max-width: 1023.98px)";

function useTabletRail(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(TABLET_RAIL_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(TABLET_RAIL_QUERY).matches,
    () => false, // server snapshot — the CSS rail already applies; content reconciles after hydration
  );
}

function writeCookie(name: string, value: string) {
  // Year-long, lax, root path — a durable UI preference the server layout reads on next load.
  document.cookie = `${name}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function Sidebar({
  role,
  locale,
  orgName,
  orgLogoUrl,
  initialCollapsed,
  initialCollapsedGroups,
}: {
  role: Role;
  locale: Locale;
  orgName: string;
  orgLogoUrl: string | null;
  initialCollapsed: boolean;
  initialCollapsedGroups: string[];
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(initialCollapsedGroups));
  const tabletRail = useTabletRail();
  const rail = collapsed || tabletRail;
  // The <aside> is the scrolling element (.sidebar has overflow-y: auto).
  const navRef = useRef<HTMLElement>(null);
  useSidebarScroll(navRef);

  function toggleSidebar() {
    setCollapsed((c) => {
      const next = !c;
      writeCookie(SIDEBAR_COLLAPSED_COOKIE, next ? "1" : "0");
      return next;
    });
  }

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      writeCookie(SIDEBAR_GROUPS_COOKIE, encodeURIComponent([...next].join(",")));
      return next;
    });
  }

  // The chevrons point toward the sidebar's own edge (collapse) or away from it (expand) — the inline-
  // start edge: left in LTR, right in RTL.
  const rtl = locale === "ar";
  const ToggleIcon = collapsed ? (rtl ? ChevronsLeft : ChevronsRight) : rtl ? ChevronsRight : ChevronsLeft;
  const toggleLabel = t(locale, collapsed ? "Expand sidebar" : "Collapse sidebar");

  return (
    <aside ref={navRef} className={cn("sidebar", collapsed && "collapsed")} data-rail={rail ? "true" : undefined}>
      <NavList
        role={role}
        locale={locale}
        pathname={pathname}
        rail={rail}
        collapsedGroups={collapsedGroups}
        onToggleGroup={toggleGroup}
        idPrefix="sidebar"
        label={t(locale, "Main navigation")}
      />
      {/* LCP SidebarFooter: the organization card and the collapse control. */}
      <div className="sidebar-footer">
        <div className="sidebar-org" title={rail ? orgName : undefined}>
          <BrandMark orgLogoUrl={orgLogoUrl} size="lg" />
          {!rail && (
            <div className="sidebar-org-text">
              <div className="sidebar-org-name" dir="auto">{orgName}</div>
              <div className="sidebar-org-product">Elite ERP</div>
            </div>
          )}
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={!collapsed}
        >
          <ToggleIcon className="size-4" aria-hidden />
          {!rail && <span className="sidebar-toggle-label">{t(locale, collapsed ? "Expand" : "Collapse")}</span>}
        </button>
      </div>
    </aside>
  );
}
