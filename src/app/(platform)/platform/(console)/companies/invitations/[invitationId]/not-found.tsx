import Link from "next/link";
import { SearchX } from "lucide-react";
import { PageState } from "@/components/platform/companies-kit";
import { pt } from "@/components/platform/i18n";
import { getLocale } from "@/lib/i18n/server";

// An unknown or malformed invitation id — or any id while PLATFORM_INVITATIONS_ENABLED is not "true" (PO-02D2):
// the same page inside the console shell, so nothing about whether some other record exists, or whether the feature
// is enabled, is revealed. Reached only after the page's own session check; it renders no data.
export default async function InvitationNotFound() {
  const locale = await getLocale();
  return (
    <PageState
      icon={SearchX}
      title={pt(locale, "inv.notFound")}
      hint={pt(locale, "inv.notFoundHint")}
      action={
        <Link href="/platform/companies?view=invitations" className="platform-inline-link">
          {pt(locale, "inv.back")}
        </Link>
      }
    />
  );
}
