"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { BrandMark } from "@/components/layout/brand-mark";
import type { Locale } from "@/lib/i18n/dict";
import { pt } from "./i18n";
import { PlatformNavList } from "./platform-nav-list";

// Below 768px the console has no persistent rail: this drawer (the shared Radix Drawer — focus
// trap, Escape, focus return and the inert page come from Radix) carries the navigation and, below
// 640px, the header utilities. It opens from the inline-start edge (left in English, right in Arabic).
export function PlatformMobileNav({ locale, utilities }: { locale: Locale; utilities: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  // Any navigation closes the drawer (state derived during render, not in an effect).
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

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
        <button type="button" className="topbar-icon-btn topbar-menu-btn" aria-label={pt(locale, "shell.openNav")} title={pt(locale, "shell.openNav")}>
          <Menu className="size-4" aria-hidden />
        </button>
      </DrawerTrigger>
      <DrawerContent side="start" className="mobile-nav" closeLabel={pt(locale, "shell.closeNav")} aria-describedby={undefined}>
        <DrawerTitle className="sr-only">{pt(locale, "shell.mainNav")}</DrawerTitle>
        <div className="mobile-nav-head">
          <BrandMark orgLogoUrl={null} size="lg" />
          <div className="mobile-nav-org">
            <div className="mobile-nav-org-name">Elite ERP</div>
            <div className="mobile-nav-product">{pt(locale, "brand.product")}</div>
          </div>
        </div>
        <PlatformNavList locale={locale} pathname={pathname} collapsedGroups={collapsedGroups} onToggleGroup={toggleGroup} onNavigate={() => setOpen(false)} idPrefix="mobile" />
        <div className="mobile-nav-utilities">{utilities}</div>
      </DrawerContent>
    </Drawer>
  );
}
