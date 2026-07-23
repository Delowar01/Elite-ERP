"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const SettingsNav = TabsPrimitive.Root;

// Matches the mockup's .settings-nav/.settings-nav-group-label/.settings-nav-item exactly.
function SettingsNavList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("settings-nav w-56 shrink-0", className)} {...props} />;
}

function SettingsNavGroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="settings-nav-group-label">{children}</div>;
}

function SettingsNavItem({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  // Active fill is driven by the [data-state="active"] attribute Radix sets (see .settings-nav-item CSS).
  return <TabsPrimitive.Trigger className={cn("settings-nav-item text-left rtl:text-right", className)} {...props} />;
}

function SettingsNavContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("flex-1 min-w-0", className)} {...props} />;
}

export { SettingsNav, SettingsNavList, SettingsNavGroupLabel, SettingsNavItem, SettingsNavContent };
