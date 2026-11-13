"use client";

import { Lock } from "lucide-react";
import { SettingsNav, SettingsNavContent, SettingsNavItem, SettingsNavList } from "@/components/ui/settings-nav";
import type { Locale } from "@/lib/i18n/dict";
import { pt } from "./i18n";

// Settings sections (PR #11 UI spec): Security is operational in PO-01B; Onboarding and Billing are
// locked previews. Radix Tabs (via the shared SettingsNav) gives the keyboard model and RTL arrows.
export function PlatformSettingsTabs({
  locale,
  security,
  onboarding,
  billing,
}: {
  locale: Locale;
  security: React.ReactNode;
  onboarding: React.ReactNode;
  billing: React.ReactNode;
}) {
  return (
    <SettingsNav defaultValue="security" orientation="vertical" className="flex flex-col md:flex-row gap-8 items-start">
      <SettingsNavList aria-label={pt(locale, "settings.sections")}>
        <SettingsNavItem value="security">{pt(locale, "settings.security")}</SettingsNavItem>
        <SettingsNavItem value="onboarding">
          <span className="platform-tab-label">
            {pt(locale, "settings.onboarding")}
            <Lock className="size-3" aria-label={pt(locale, "common.locked")} />
          </span>
        </SettingsNavItem>
        <SettingsNavItem value="billing">
          <span className="platform-tab-label">
            {pt(locale, "settings.billing")}
            <Lock className="size-3" aria-label={pt(locale, "common.locked")} />
          </span>
        </SettingsNavItem>
      </SettingsNavList>
      <SettingsNavContent value="security">{security}</SettingsNavContent>
      <SettingsNavContent value="onboarding">{onboarding}</SettingsNavContent>
      <SettingsNavContent value="billing">{billing}</SettingsNavContent>
    </SettingsNav>
  );
}
