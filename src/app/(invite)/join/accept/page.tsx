import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/server";
import { userInvitationAcceptanceAvailable } from "@/lib/onboarding/user-invitation-acceptance";
import { getSession } from "@/lib/session";
import { JoinInvitation } from "./join-invitation";
import "../../../(auth)/auth.css";

// PO-03D — /join/accept, the public USER-invitation acceptance page (in the (invite) route group, which has no layout, so
// the (auth) layout's signed-in redirect never runs before the fragment is removed: a server redirect would carry #t=… to
// the next URL). The server renders NO token and NO invitation data — only the mode: switched off
// (CUSTOMER_USER_INVITE_ACCEPTANCE_ENABLED is not exactly "true"), a customer already signed in, or ready. Everything
// else happens in the client component, through the page's own same-origin server actions. Not indexed; no referrer.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join your team · Elite ERP",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function JoinInvitationPage() {
  const locale = await getLocale();
  if (!userInvitationAcceptanceAvailable()) return <JoinInvitation initialLocale={locale} mode="disabled" />;
  const signedIn = Boolean(await getSession());
  return <JoinInvitation initialLocale={locale} mode={signedIn ? "signed-in" : "ready"} />;
}
