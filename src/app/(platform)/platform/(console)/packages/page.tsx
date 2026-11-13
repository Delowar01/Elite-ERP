import { Package, PackagePlus, TriangleAlert } from "lucide-react";
import { pt } from "@/components/platform/i18n";
import { ConsolePage, EmptyPanel, PreviewAction } from "@/components/platform/page-kit";
import { getLocale } from "@/lib/i18n/server";
import { requirePlatformSession } from "@/lib/platform/guards";

// The package catalog (PO-04). No package or price exists, and none is shown: prices need the
// owner's approval before any package can be offered.
export default async function PlatformPackagesPage() {
  await requirePlatformSession();
  const locale = await getLocale();
  return (
    <ConsolePage
      locale={locale}
      title={pt(locale, "nav.packages")}
      description={pt(locale, "packages.desc")}
      phase="PO-04"
      actions={<PreviewAction locale={locale} label={pt(locale, "action.createPackage")} icon={PackagePlus} phase="PO-04" />}
    >
      <p className="platform-callout" data-tone="warning">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <span>{pt(locale, "packages.pricesPending")}</span>
      </p>
      <p className="platform-callout" data-tone="neutral">
        <Package className="size-4 shrink-0" aria-hidden />
        <span>{pt(locale, "packages.disclosure")}</span>
      </p>
      <EmptyPanel icon={Package} message={pt(locale, "packages.empty")} hint={pt(locale, "packages.emptyHint")} />
    </ConsolePage>
  );
}
