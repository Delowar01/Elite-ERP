"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
import { useDocumentDir } from "./use-document-dir";

// Radix Tabs need the direction passed in (no DirectionProvider): left to itself the root wrote
// dir="ltr" over the whole Settings page in Arabic. The Tabs contract (DEV-UI-01.4; DEV-UI-01.7 C5).
function SettingsNav({ dir, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const docDir = useDocumentDir();
  return <TabsPrimitive.Root dir={dir ?? docDir} {...props} />;
}

// Matches the mockup's .settings-nav/.settings-nav-group-label/.settings-nav-item exactly. D-7: full
// width above the panel below md (768px), the 14rem column beside it from md up.
function SettingsNavList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("settings-nav w-full md:w-56 shrink-0", className)} {...props} />;
}

function SettingsNavGroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="settings-nav-group-label">{children}</div>;
}

function SettingsNavItem({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  // Active fill is driven by the [data-state="active"] attribute Radix sets (see .settings-nav-item CSS).
  return <TabsPrimitive.Trigger className={cn("settings-nav-item text-start", className)} {...props} />;
}

function SettingsNavContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("w-full min-w-0 md:flex-1", className)} {...props} />;
}

export { SettingsNav, SettingsNavList, SettingsNavGroupLabel, SettingsNavItem, SettingsNavContent };
