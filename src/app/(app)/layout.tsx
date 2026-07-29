import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { getTheme } from "@/lib/theme";
import { getSidebarPrefs } from "@/lib/sidebar-prefs";
import { getNotifications } from "@/lib/notifications";
import { getFavorites } from "@/lib/favorites";
import { AppShell } from "@/components/layout/app-shell";
import { CurrencyProvider } from "@/components/ui/currency-mark";
import { buildMoneyMark } from "@/lib/currency/currencies";
import "./mockup-parity.css";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const locale = await getLocale();
  const theme = await getTheme();
  const sidebarPrefs = await getSidebarPrefs();
  const notifications = await getNotifications(session.orgId, session.userId);
  const favorites = await getFavorites(session.orgId, session.userId);

  return (
    <AppShell
      user={{ name: session.name, email: session.email, role: session.role }}
      orgName={session.orgName}
      orgLogoUrl={session.orgLogoUrl}
      orgPrimaryColor={session.orgPrimaryColor}
      orgAccentColor={session.orgAccentColor}
      orgColorThemeMode={session.orgColorThemeMode}
      locale={locale}
      theme={theme}
      notifications={notifications.items}
      unreadCount={notifications.unreadCount}
      favorites={favorites}
      sidebarPrefs={sidebarPrefs}
    >
      <CurrencyProvider
        mark={buildMoneyMark({
          currencyCode: session.orgCurrency,
          customCurrencySymbol: session.orgCustomCurrencySymbol,
          digitGrouping: session.orgNumberDigitGrouping,
          decimalPlaces: session.orgNumberDecimalPlaces,
          roundQuantities: session.orgRoundQuantities,
          roundRates: session.orgRoundRates,
        })}
      >
        {children}
      </CurrencyProvider>
    </AppShell>
  );
}
