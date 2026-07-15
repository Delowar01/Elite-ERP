import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const locale = await getLocale();

  return (
    <AppShell
      user={{ name: session.name, email: session.email, role: session.role }}
      orgName={session.orgName}
      orgLogoUrl={session.orgLogoUrl}
      orgPrimaryColor={session.orgPrimaryColor}
      orgAccentColor={session.orgAccentColor}
      locale={locale}
    >
      {children}
    </AppShell>
  );
}
