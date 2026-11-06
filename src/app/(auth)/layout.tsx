import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getSession } from "@/lib/session";
import { SESSION_COOKIE } from "@/lib/auth";
import { Languages } from "lucide-react";
import { LogoLockup } from "@/components/brand/logo-lockup";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import "./auth.css";

// Server Component. The edge middleware no longer redirects auth routes on cookie *presence*
// (that was the B1 loop), so the decision is made here with a FULL check that includes
// server-side revocation:
//   - genuinely usable session   -> go to /dashboard (preserves the "already logged in" UX)
//   - present-but-unusable cookie -> clear it via /auth/clear, then this page renders
//   - no cookie                  -> render the login/register form
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const store = await cookies();
  if (store.get(SESSION_COOKIE)) {
    const path = (await headers()).get("x-pathname");
    const next = path === "/register" ? "/register" : "/login";
    redirect(`/auth/clear?next=${next}`);
  }

  // LCP authentication layout: the form on the page surface, beside a dark brand panel (≥ 1024px).
  // Presentation only — the session checks above are unchanged.
  const locale = await getLocale();
  return (
    <div className="auth-split">
      <div className="auth-form-col">{children}</div>
      <section className="auth-hero" aria-label={t(locale, "About Elite ERP")}>
        <div className="auth-hero-inner">
          <LogoLockup ink="#ffffff" size={34} />
          <h2 className="auth-hero-title">{t(locale, "Every part of your business, in one place.")}</h2>
          <p className="auth-hero-lead">
            {t(locale, "Sales, purchasing, inventory, finance and people — in English and Arabic.")}
          </p>
          <div className="auth-hero-card">
            <span className="auth-hero-card-icon" aria-hidden="true">
              <Languages className="size-5" />
            </span>
            <div>
              <p className="auth-hero-card-title">{t(locale, "Bilingual from the first screen")}</p>
              <p className="auth-hero-card-text">{t(locale, "Every screen works in English and in Arabic, right to left.")}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
