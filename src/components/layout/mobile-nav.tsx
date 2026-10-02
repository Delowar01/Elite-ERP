"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Drawer, DrawerTrigger, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { LogoMark } from "@/components/brand/logo-mark";
import { NavList } from "./nav-list";
import type { Role } from "./nav-config";
import { t, type Locale } from "@/lib/i18n/dict";

// Below 1024px there is no persistent rail (D-01.3-G); this drawer carries the navigation instead.
// It is the Radix Dialog drawer, so the focus trap, focus return to the trigger, Escape and the inert
// page behind come from Radix — no hand-written focus management. It opens from the inline-start edge
// (left in English, right in Arabic) and renders the same NavList as the sidebar. Below 640px it also
// carries the top-bar utilities the narrow header has no room for (`utilities`).
export function MobileNav({
  role,
  locale,
  orgName,
  orgLogoUrl,
  utilities,
}: {
  role: Role;
  locale: Locale;
  orgName: string;
  orgLogoUrl: string | null;
  utilities: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Drawer-local: every group starts expanded; the desktop group preference is not touched.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  // Any navigation closes the drawer — nav links close it on click; this also covers routes reached
  // from inside it another way (a notification or favorite). State derived during render, not in an
  // effect.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  // Set when a link closed the drawer: focus then belongs to the destination (or to the guard's
  // confirmation), so Radix must not pull it back to the menu button.
  const closedByLink = useRef(false);
  // Activating any link in the drawer closes it at once — in the window CAPTURE phase, i.e. before the
  // unsaved-changes guard (a document capture listener) can stop the click. The guard then decides
  // whether navigation happens, with its confirmation on the page instead of stacked over the drawer.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (e.target instanceof Element && e.target.closest(".mobile-nav a[href]")) {
        closedByLink.current = true;
        setOpen(false);
      }
    }
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [open]);

  function toggleGroup(label: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button type="button" className="topbar-icon-btn topbar-menu-btn" aria-label={t(locale, "Open navigation")} title={t(locale, "Open navigation")}>
          <Menu className="size-4" aria-hidden />
        </button>
      </DrawerTrigger>
      <DrawerContent
        side="start"
        className="mobile-nav"
        closeLabel={t(locale, "Close navigation")}
        aria-describedby={undefined}
        onCloseAutoFocus={(e) => {
          if (closedByLink.current) e.preventDefault();
          closedByLink.current = false;
        }}
      >
        <DrawerTitle className="sr-only">{t(locale, "Main navigation")}</DrawerTitle>
        <div className="mobile-nav-head">
          {orgLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={orgLogoUrl} alt="" className="sidebar-logo-img" />
          ) : (
            <LogoMark size={28} color="var(--accent)" />
          )}
          <div className="mobile-nav-org">
            <div className="mobile-nav-org-name">{orgName}</div>
            <div className="mobile-nav-product">Elite ERP</div>
          </div>
        </div>
        <NavList
          role={role}
          locale={locale}
          pathname={pathname}
          collapsedGroups={collapsedGroups}
          onToggleGroup={toggleGroup}
          onNavigate={() => {
            closedByLink.current = true;
            setOpen(false);
          }}
          idPrefix="mobile"
          label={t(locale, "Main navigation")}
        />
        <div className="mobile-nav-utilities">{utilities}</div>
      </DrawerContent>
    </Drawer>
  );
}
