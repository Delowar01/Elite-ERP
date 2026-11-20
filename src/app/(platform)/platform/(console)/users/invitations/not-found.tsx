import Link from "next/link";
import { SearchX } from "lucide-react";
import { PageState } from "@/components/platform/companies-kit";
import { pt } from "@/components/platform/i18n";
import { getLocale } from "@/lib/i18n/server";

// The user-invitation list while PLATFORM_USER_INVITATIONS_ENABLED is not "true" (PO-03C): a plain "page not found"
// inside the console shell — never the customer app's 404, and nothing about whether the feature exists. Reached only
// after the page's own session check; it renders no data. (An invitation's own page has its own not-found.)
export default async function UserInvitationsNotFound() {
  const locale = await getLocale();
  return (
    <PageState
      icon={SearchX}
      title={pt(locale, "uinv.notFound")}
      hint={pt(locale, "uinv.notFoundHint")}
      action={
        <Link href="/platform/users" className="platform-inline-link">
          {pt(locale, "cu.back")}
        </Link>
      }
    />
  );
}
