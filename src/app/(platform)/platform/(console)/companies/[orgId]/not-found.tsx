import Link from "next/link";
import { SearchX } from "lucide-react";
import { PageState } from "@/components/platform/companies-kit";
import { pt } from "@/components/platform/i18n";
import { getLocale } from "@/lib/i18n/server";

// A malformed or unknown organization id (PO-02B): a 404 inside the console shell, with the same
// text for both — nothing about whether some other record exists is revealed. It is reached only
// from the company page, after that page's own session check, and renders no data.
export default async function CompanyNotFound() {
  const locale = await getLocale();
  return (
    <PageState
      icon={SearchX}
      title={pt(locale, "company.notFound")}
      hint={pt(locale, "company.notFoundHint")}
      action={
        <Link href="/platform/companies" className="platform-inline-link">
          {pt(locale, "company.back")}
        </Link>
      }
    />
  );
}
