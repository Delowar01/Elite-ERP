import { cookies } from "next/headers";
import { PLATFORM_SIDEBAR_COOKIE } from "@/components/platform/nav-config";
import { PlatformShell } from "@/components/platform/platform-shell";
import { getLocale } from "@/lib/i18n/server";
import { requirePlatformSession } from "@/lib/platform/guards";
import { getTheme } from "@/lib/theme";
// The production shell stylesheets, reused as-is (imported, not modified), then the console's own
// small layer, which only uses existing tokens.
import "@/app/(app)/mockup-parity.css";
import "@/app/(app)/shell.css";
import "@/app/(app)/lcp.css";
import "@/app/(platform)/platform.css";

// Every console page sits behind this layout: feature flag → live database session (not just a
// valid cookie) → PlatformShell. Each page ALSO calls requirePlatformSession() itself (React-cached,
// so it costs one check per request), because Next.js renders a layout and its page concurrently.
export default async function PlatformConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatformSession();
  const [locale, theme, store] = await Promise.all([getLocale(), getTheme(), cookies()]);
  return (
    <PlatformShell
      operator={{ name: session.displayName, email: session.email }}
      locale={locale}
      theme={theme}
      sidebarCollapsed={store.get(PLATFORM_SIDEBAR_COOKIE)?.value === "1"}
    >
      {children}
    </PlatformShell>
  );
}
