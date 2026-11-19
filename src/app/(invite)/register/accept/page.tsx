import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/server";
import { invitationAcceptanceAvailable } from "@/lib/onboarding/invitation-acceptance";
import { getSession } from "@/lib/session";
import { AcceptInvitation } from "./accept-invitation";
import "../../../(auth)/auth.css";

// PO-02D3 — /register/accept, the public invitation-acceptance page (a route group of its own, so the (auth)
// layout's signed-in redirect never runs before the fragment is removed: a server redirect would carry #t=… to the
// next URL). The server renders NO token and NO invitation data — only the mode: switched off
// (CUSTOMER_INVITE_ACCEPTANCE_ENABLED is not exactly "true"), a customer already signed in, or ready. Everything else
// happens in the client component, through the page's own same-origin server actions. Not indexed; no referrer.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accept invitation · Elite ERP",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function AcceptInvitationPage() {
  const locale = await getLocale();
  if (!invitationAcceptanceAvailable()) return <AcceptInvitation initialLocale={locale} mode="disabled" />;
  const signedIn = Boolean(await getSession());
  return <AcceptInvitation initialLocale={locale} mode={signedIn ? "signed-in" : "ready"} />;
}
