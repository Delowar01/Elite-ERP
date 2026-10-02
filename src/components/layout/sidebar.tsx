"use client";

import { usePathname } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { LogoMark } from "@/components/brand/logo-mark";
import { NavList } from "./nav-list";
import type { Role } from "./nav-config";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n/dict";
import { SIDEBAR_COLLAPSED_COOKIE, SIDEBAR_GROUPS_COOKIE } from "@/lib/sidebar-cookies";
import { useSidebarScroll } from "./use-sidebar-scroll";

// Breakpoint model (D-01.3-G): ≥1280 the user's expanded/compact preference; 1024–1279 always the
// compact 66px rail; <1024 no persistent rail (the mobile drawer takes over, see mobile-nav.tsx).
// shell.css enforces the geometry from the first paint; this query only switches the rendered
// content (labels → tooltips, group headers off) once the client knows the width.
const TABLET_RAIL_QUERY = "(min-width: 1024px) and (max-width: 1279.98px)";

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

  // The panel icon points at the sidebar's own edge — the inline-start edge: left in LTR, right in RTL.
  const rtl = locale === "ar";
  const ToggleIcon = collapsed ? (rtl ? PanelRightOpen : PanelLeftOpen) : rtl ? PanelRightClose : PanelLeftClose;

  return (
    <aside ref={navRef} className={cn("sidebar", collapsed && "collapsed")} data-rail={rail ? "true" : undefined}>
      <div className="sidebar-head">
        {orgLogoUrl ? (
          <div className="sidebar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={orgLogoUrl} alt={orgName} className="sidebar-logo-img" />
          </div>
        ) : (
          <div className="sidebar-brand">
            <LogoMark size={30} color="var(--accent)" />
            {!rail && (
              <div className="sidebar-brand-text">
                <div className="word1">ELITE</div>
                <div className="word2">INNOVATION SOLUTIONS</div>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggleSidebar}
          aria-label={t(locale, collapsed ? "Expand sidebar" : "Collapse sidebar")}
          title={t(locale, collapsed ? "Expand sidebar" : "Collapse sidebar")}
          aria-expanded={!collapsed}
        >
          <ToggleIcon className="size-4" aria-hidden />
        </button>
      </div>
      {!orgLogoUrl && !rail && <div className="sidebar-product">Elite ERP</div>}

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
    </aside>
  );
}
