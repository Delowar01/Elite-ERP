"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  CornerDownLeft,
  FilePlus2,
  UserPlus,
  Building2,
  PackagePlus,
  FolderPlus,
  UserRoundPlus,
  Languages,
  SunMoon,
} from "lucide-react";
import { NAV_GROUPS } from "./nav-config";
import { t, type Locale } from "@/lib/i18n/dict";
import { setLocaleAction } from "@/lib/i18n/actions";
import { setThemeAction } from "@/lib/theme-actions";
import type { Theme } from "@/lib/theme";

type Role = "owner" | "admin" | "staff";

type Command = {
  id: string;
  label: string;
  group: string;
  Icon: React.ComponentType<{ className?: string }>;
  href?: string;
  run?: () => void;
};

// ⌘K / Ctrl+K command palette — navigation and quick actions ONLY. It never shows ERP record-search
// results (those live in the Main Search panel). Jump to any page, start a new document, add a
// client/vendor, or switch language / appearance.
// Mounted only while open (the coordinator conditionally renders it), so each open is a fresh mount
// and state starts clean without a reset-in-effect.
export function CommandPalettePanel({ locale, role, onClose }: { locale: Locale; role: Role; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input on mount (DOM only — no setState in the effect body).
  useEffect(() => {
    const h = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(h);
  }, []);

  function toggleAppearance() {
    const attr = document.documentElement.getAttribute("data-theme");
    const current: Theme = attr === "dark" || attr === "light" ? (attr as Theme) : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const next: Theme = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    startTransition(() => setThemeAction(next));
  }

  const commands = useMemo<Command[]>(() => {
    const pagesLabel = t(locale, "Pages");
    const actionsLabel = t(locale, "Quick Actions");

    // Navigation — every sidebar page the current role can see.
    const pages: Command[] = NAV_GROUPS.flatMap((g) =>
      g.items
        .filter((it) => !it.roles || it.roles.includes(role))
        .map((it) => ({ id: `nav:${it.href}`, label: t(locale, it.label), group: pagesLabel, Icon: it.icon, href: it.href })),
    );

    // Quick actions — create documents / master records and toggle language / appearance.
    const actions: Command[] = [
      { id: "new:quotation", label: t(locale, "Create Quotation"), group: actionsLabel, Icon: FilePlus2, href: "/sales/quotations/new" },
      { id: "new:sales-order", label: t(locale, "Create Sales Order"), group: actionsLabel, Icon: FilePlus2, href: "/sales/orders/new" },
      { id: "new:proforma", label: t(locale, "Create Proforma Invoice"), group: actionsLabel, Icon: FilePlus2, href: "/sales/proforma/new" },
      { id: "new:invoice", label: t(locale, "Create Invoice"), group: actionsLabel, Icon: FilePlus2, href: "/sales/invoices/new" },
      { id: "new:dc", label: t(locale, "Create Delivery Challan"), group: actionsLabel, Icon: FilePlus2, href: "/sales/delivery-challans/new" },
      { id: "new:credit-note", label: t(locale, "Create Credit Note"), group: actionsLabel, Icon: FilePlus2, href: "/sales/credit-notes/new" },
      { id: "new:po", label: t(locale, "Create Purchase Order"), group: actionsLabel, Icon: FilePlus2, href: "/purchasing/orders/new" },
      { id: "new:debit-note", label: t(locale, "Create Debit Note"), group: actionsLabel, Icon: FilePlus2, href: "/purchasing/debit-notes/new" },
      { id: "new:client", label: t(locale, "Add Client"), group: actionsLabel, Icon: UserPlus, href: "/clients/new" },
      { id: "new:vendor", label: t(locale, "Add Vendor"), group: actionsLabel, Icon: Building2, href: "/purchasing/vendors/new" },
      { id: "new:product", label: t(locale, "Add Product"), group: actionsLabel, Icon: PackagePlus, href: "/inventory/products/new" },
      { id: "new:project", label: t(locale, "Add Project"), group: actionsLabel, Icon: FolderPlus, href: "/projects/new" },
      { id: "new:employee", label: t(locale, "Add Employee"), group: actionsLabel, Icon: UserRoundPlus, href: "/hr/employees/new" },
      {
        id: "switch:language",
        label: locale === "en" ? t(locale, "Switch language to Arabic") : t(locale, "Switch language to English"),
        group: actionsLabel,
        Icon: Languages,
        run: () => startTransition(() => setLocaleAction(locale === "en" ? "ar" : "en")),
      },
      { id: "switch:appearance", label: t(locale, "Switch appearance"), group: actionsLabel, Icon: SunMoon, run: toggleAppearance },
    ];

    return [...pages, ...actions];
  }, [locale, role]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  }, [commands, query]);

  const activeIdx = filtered.length ? Math.min(active, filtered.length - 1) : 0;

  // Group consecutive commands by section for headers (Pages then Quick Actions).
  const grouped = useMemo(() => {
    const out: { group: string; items: { c: Command; index: number }[] }[] = [];
    filtered.forEach((c, index) => {
      const last = out[out.length - 1];
      if (last && last.group === c.group) last.items.push({ c, index });
      else out.push({ group: c.group, items: [{ c, index }] });
    });
    return out;
  }, [filtered]);

  function run(c: Command) {
    onClose();
    if (c.href) router.push(c.href);
    else c.run?.();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[12vh] px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t(locale, "Command menu")}
    >
      <div
        className="w-full max-w-[520px] rounded-2xl border border-line bg-surface shadow-glass overflow-hidden animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-3 pb-2 border-b border-line">
          <div className="text-[13px] font-semibold text-ink">{t(locale, "Command menu")}</div>
          <div className="text-[11px] text-ink-faint">{t(locale, "Jump to a page or run a quick action")}</div>
        </div>
        <div className="flex items-center gap-2 px-4 border-b border-line">
          <Search className="size-4 text-ink-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive(Math.min(activeIdx + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(Math.max(activeIdx - 1, 0));
              } else if (e.key === "Enter" && filtered[activeIdx]) {
                e.preventDefault();
                run(filtered[activeIdx]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder={t(locale, "Type a command or search a page…")}
            className="flex-1 h-12 bg-transparent outline-none text-[14px]"
          />
        </div>
        <div className="max-h-[380px] overflow-y-auto py-2">
          {filtered.length === 0 && <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">{t(locale, "No matches.")}</div>}
          {grouped.map((group) => (
            <Fragment key={group.group}>
              <div className="px-4 pt-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">{group.group}</div>
              {group.items.map(({ c, index }) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(c)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-start text-[13px] ${index === activeIdx ? "bg-canvas" : ""}`}
                >
                  <c.Icon className="size-4 text-ink-muted shrink-0" />
                  <span className="flex-1 min-w-0 truncate">{c.label}</span>
                  {index === activeIdx && <CornerDownLeft className="size-3.5 text-ink-faint shrink-0" />}
                </button>
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
