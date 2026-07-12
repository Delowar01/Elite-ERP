import { requireSession } from "@/lib/session";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <AppShell
      user={{ name: session.name, email: session.email, role: session.role }}
      orgName={session.orgName}
    >
      {children}
    </AppShell>
  );
}
