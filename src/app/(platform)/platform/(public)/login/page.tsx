import { PlatformSignInForm } from "@/components/platform/sign-in-form";
import { getLocale } from "@/lib/i18n/server";

export default async function PlatformLoginPage({ searchParams }: { searchParams: Promise<{ ended?: string }> }) {
  const locale = await getLocale();
  // `ended` only selects one of two fixed notices; no value from the URL is rendered or followed.
  const ended = (await searchParams).ended;
  const notice = ended === "1" ? "ended" : ended === "unaudited" ? "unaudited" : null;
  return <PlatformSignInForm locale={locale} notice={notice} />;
}
