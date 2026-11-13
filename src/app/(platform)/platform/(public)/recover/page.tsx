import { PlatformSignInForm } from "@/components/platform/sign-in-form";
import { getLocale } from "@/lib/i18n/server";

/** Sign-in with a single-use recovery code instead of the authenticator app. */
export default async function PlatformRecoverPage() {
  const locale = await getLocale();
  return <PlatformSignInForm locale={locale} initialMethod="recovery" />;
}
