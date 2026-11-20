import Link from "next/link";
import { SearchX } from "lucide-react";
import { PageState } from "@/components/platform/companies-kit";
import { pt } from "@/components/platform/i18n";
import { getLocale } from "@/lib/i18n/server";

// An unknown or malformed user-invitation id — or any id while PLATFORM_USER_INVITATIONS_ENABLED is not "true"
// (PO-03C): the same page inside the console shell, so nothing about whether some other record exists, or whether the
// feature is enabled, is revealed. Reached only after the page's own session check; it renders no data.
export default async function UserInvitationNotFound() {
  const locale = await getLocale();
  return (
    <PageState
      icon={SearchX}
      title={pt(locale, "inv.notFound")}
      hint={pt(locale, "inv.notFoundHint")}
      action={
        <Link href="/platform/users" className="platform-inline-link">
          {pt(locale, "cu.back")}
        </Link>
      }
    />
  );
}
