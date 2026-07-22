import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { getTheme } from "@/lib/theme";
import { getNotifications } from "@/lib/notifications";
import { getFavorites } from "@/lib/favorites";
import { AppShell } from "@/components/layout/app-shell";
import "./mockup-parity.css";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const locale = await getLocale();
  const theme = await getTheme();
  const notifications = await getNotifications(session.orgId, session.userId);
  const favorites = await getFavorites(session.orgId, session.userId);

  return (
    <AppShell
      user={{ name: session.name, email: session.email, role: session.role }}
      orgName={session.orgName}
      orgLogoUrl={session.orgLogoUrl}
      orgPrimaryColor={session.orgPrimaryColor}
      orgAccentColor={session.orgAccentColor}
      locale={locale}
      theme={theme}
      notifications={notifications.items}
      unreadCount={notifications.unreadCount}
      favorites={favorites}
    >
      {children}
    </AppShell>
  );
}
