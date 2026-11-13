import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ClipboardList, Fingerprint, Layers } from "lucide-react";
import { LogoLockup } from "@/components/brand/logo-lockup";
import { pt } from "@/components/platform/i18n";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE } from "@/lib/platform/config";
import { isPlatformConsoleEnabled } from "@/lib/platform/flags";
import { authorizePlatformToken } from "@/lib/platform/guards";
import "@/app/(auth)/auth.css";
import "@/app/(platform)/platform.css";

// Public Platform Owner pages (sign-in and recovery-code sign-in). They exist only while the console
// flag is on (the proxy already answers 404 otherwise; this is the second, server-side check).
// A visitor whose platform session is genuinely usable goes straight to the dashboard. A present
// but unusable cookie is simply ignored here — never redirected on — so no redirect loop can form;
// signing in replaces it, and the proxy clears it on any protected path.
// The customer session cookie plays no part on these pages.
export default async function PlatformPublicLayout({ children }: { children: React.ReactNode }) {
  if (!isPlatformConsoleEnabled()) notFound();
  const token = (await cookies()).get(PLATFORM_SESSION_COOKIE)?.value;
  if (token && (await authorizePlatformToken(token).then(() => true, () => false))) redirect("/platform/dashboard");

  const locale = await getLocale();
  const points = [
    { icon: Fingerprint, text: pt(locale, "hero.mfa") },
    { icon: ClipboardList, text: pt(locale, "hero.audit") },
    { icon: Layers, text: pt(locale, "hero.separate") },
  ];
  return (
    <div className="auth-split">
      <div className="auth-form-col">{children}</div>
      <section className="auth-hero" aria-label={pt(locale, "brand.console")}>
        <div className="auth-hero-inner">
          <LogoLockup ink="#ffffff" size={34} />
          <h2 className="auth-hero-title">{pt(locale, "hero.title")}</h2>
          <p className="auth-hero-lead">{pt(locale, "hero.lead")}</p>
          <ul className="platform-hero-points">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="auth-hero-card">
                <span className="auth-hero-card-icon" aria-hidden="true">
                  <Icon className="size-5" />
                </span>
                <p className="auth-hero-card-title">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
