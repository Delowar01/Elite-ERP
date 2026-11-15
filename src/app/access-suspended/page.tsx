import { redirect } from "next/navigation";
import { Languages, LogOut, ShieldOff } from "lucide-react";
import { LogoLockup } from "@/components/brand/logo-lockup";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(app)/actions";
import { t } from "@/lib/i18n/dict";
import { getLocale } from "@/lib/i18n/server";
import { getSessionState } from "@/lib/session";
import "../(auth)/auth.css";

// PO-02C — the one customer screen for a company whose access is suspended (or, fail closed, cannot
// be confirmed). It shows no company data and no administrative note (the suspension reason stays
// with the Platform Owner): only what the state means and a safe sign-out. The state is re-checked
// on every load: an active session goes back to the dashboard; a signed-out, expired or (after
// reactivation) ended session goes to sign-in, where every user signs in again.
export default async function AccessSuspendedPage() {
  const state = await getSessionState();
  if (state.status === "active") redirect("/dashboard");
  if (state.status !== "suspended" && state.status !== "unavailable") redirect("/auth/clear?next=/login");

  const locale = await getLocale();
  const suspended = state.status === "suspended";
  return (
    <div className="auth-split">
      <div className="auth-form-col">
        <main className="auth-form w-full max-w-[440px] animate-fade-up">
          <div className="flex mb-10">
            <LogoLockup ink="var(--brand-ink)" size={30} />
          </div>
          <span className="mb-5 inline-flex size-12 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-muted" aria-hidden="true">
            <ShieldOff className="size-5" />
          </span>
          <h1 className="text-display font-bold tracking-tight">{t(locale, suspended ? "Company access suspended" : "Company access can't be confirmed")}</h1>
          <p className="text-ink-muted text-body-lg mt-2">
            {t(locale, suspended ? "Your company's access to Elite ERP is suspended, so its records can't be opened right now." : "Elite ERP can't confirm your company's access right now, so its records can't be opened. Try again later.")}
          </p>
          <ul className="mt-6 flex flex-col gap-3 text-body text-ink">
            <li>{t(locale, "Nothing has been deleted. Your company's records are kept unchanged.")}</li>
            <li>{t(locale, suspended ? "To restore access, contact your service provider. Once access is restored, sign in again." : "If this continues, contact your service provider.")}</li>
          </ul>
          <form action={logoutAction} className="mt-8">
            <Button type="submit" className="w-full">
              <LogOut aria-hidden />
              {t(locale, "Log out")}
            </Button>
          </form>
        </main>
      </div>
      <section className="auth-hero" aria-label={t(locale, "About Elite ERP")}>
        <div className="auth-hero-inner">
          <LogoLockup ink="#ffffff" size={34} />
          <h2 className="auth-hero-title">{t(locale, "Every part of your business, in one place.")}</h2>
          <p className="auth-hero-lead">{t(locale, "Sales, purchasing, inventory, finance and people — in English and Arabic.")}</p>
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
