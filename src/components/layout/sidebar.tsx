"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { LogoMark } from "@/components/brand/logo-mark";
import { NAV_GROUPS } from "./nav-config";
import { cn } from "@/lib/utils";
import { t, type Locale } from "@/lib/i18n/dict";
import { SIDEBAR_COLLAPSED_COOKIE, SIDEBAR_GROUPS_COOKIE } from "@/lib/sidebar-cookies";
import { useSidebarScroll } from "./use-sidebar-scroll";

// Routes with a built page — the rest are planned nav items for sections not yet implemented.
// Keeping prefetch off for those avoids prefetching 404s on every render.
const BUILT_ROUTES = new Set([
  "/dashboard",
  "/clients",
  "/purchasing/vendors",
  "/inventory/products",
  "/settings/presets",
  "/settings/organization",
  "/finance/bank-accounts",
  "/finance/journal",
  "/finance/chart-of-accounts",
  "/finance/ledger",
  "/finance/reports",
  "/sales/quotations",
  "/sales/orders",
  "/sales/proforma",
  "/sales/invoices",
  "/sales/delivery-challans",
  "/sales/credit-notes",
  "/purchasing/orders",
  "/purchasing/debit-notes",
  "/finance/payments",
  "/finance/statements",
  "/projects",
  "/hr/employees",
  "/hr/departments",
  "/hr/attendance",
  "/hr/leave",
  "/hr/payroll",
  "/settings/security",
  "/settings/compliance",
  "/recycle-bin",
]);

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
  role: "owner" | "admin" | "staff";
  locale: Locale;
  orgName: string;
  orgLogoUrl: string | null;
  initialCollapsed: boolean;
  initialCollapsedGroups: string[];
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(initialCollapsedGroups));
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

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside ref={navRef} className={cn("sidebar", collapsed && "collapsed")}>
      <div className="sidebar-head">
        {orgLogoUrl ? (
          <div className="sidebar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={orgLogoUrl} alt={orgName} className="sidebar-logo-img" />
          </div>
        ) : (
          <div className="sidebar-brand">
            <LogoMark size={30} color="var(--brand-orange)" />
            {!collapsed && (
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
          <ToggleIcon className="size-4" />
        </button>
      </div>
      {!orgLogoUrl && !collapsed && <div className="sidebar-product">Elite ERP</div>}

      <div className="sidebar-nav">
        {NAV_GROUPS.map((group, gi) => {
          const items = group.items.filter((it) => !it.roles || it.roles.includes(role));
          if (items.length === 0) return null;
          const activeGroup = items.some((it) => isActive(it.href));
          // The active group is always shown expanded (it stays open after navigation / on refresh);
          // any other labelled group collapses when the user clicks its header. When the whole
          // sidebar is collapsed to icons, group toggling is disabled and every item shows.
          const groupCollapsed = !collapsed && !!group.label && collapsedGroups.has(group.label) && !activeGroup;

          return (
            <div key={gi} className={cn("nav-group", groupCollapsed && "group-collapsed")}>
              {group.label && !collapsed && (
                <button
                  type="button"
                  className="nav-divider"
                  onClick={() => toggleGroup(group.label!)}
                  aria-expanded={!groupCollapsed}
                >
                  <span>{t(locale, group.label)}</span>
                  <ChevronDown className={cn("nav-divider-chevron size-3.5", groupCollapsed && "is-collapsed")} />
                </button>
              )}
              {!groupCollapsed && (
                <div className="nav-group-items">
                  {items.map((item) => {
                    const active = isActive(item.href);
                    const Icon = item.icon;
                    const label = t(locale, item.label);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        prefetch={BUILT_ROUTES.has(item.href) ? undefined : false}
                        className={cn("nav-item", active && "active")}
                        aria-current={active ? "page" : undefined}
                        title={label}
                      >
                        <Icon className="size-4" />
                        <span className="nav-item-label">{label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
