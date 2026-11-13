import { PlatformSignInForm } from "@/components/platform/sign-in-form";
import { getLocale } from "@/lib/i18n/server";

export default async function PlatformLoginPage({ searchParams }: { searchParams: Promise<{ ended?: string }> }) {
  const locale = await getLocale();
  // `ended=1` only selects a fixed notice; no value from the URL is rendered or followed.
  const ended = (await searchParams).ended === "1";
  return <PlatformSignInForm locale={locale} ended={ended} />;
}
