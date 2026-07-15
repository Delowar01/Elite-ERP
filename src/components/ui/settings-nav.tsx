"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const SettingsNav = TabsPrimitive.Root;

function SettingsNavList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("flex flex-col gap-0.5 w-56 shrink-0", className)} {...props} />;
}

function SettingsNavGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-faint px-3 pt-3.5 pb-1 first:pt-1">
      {children}
    </div>
  );
}

function SettingsNavItem({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "text-left rtl:text-right px-3 py-2.5 rounded-[9px] text-[13px] font-medium text-ink-muted outline-none transition-colors",
        "hover:bg-canvas hover:text-ink",
        "data-[state=active]:bg-[var(--accent-orange-bg)] data-[state=active]:text-ink data-[state=active]:font-semibold",
        className,
      )}
      {...props}
    />
  );
}

function SettingsNavContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("flex-1 min-w-0", className)} {...props} />;
}

export { SettingsNav, SettingsNavList, SettingsNavGroupLabel, SettingsNavItem, SettingsNavContent };
