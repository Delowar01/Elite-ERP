"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Clock, Languages, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import { logoutAction } from "@/app/(app)/actions";
import { LogoLockup } from "@/components/brand/logo-lockup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LOCALE_COOKIE, t, type Locale } from "@/lib/i18n/dict";
import type { AcceptField, InvitationPreviewView, LinkCheck, PublicRefusalReason } from "@/lib/onboarding/acceptance-types";
import { acceptInvitationAction, checkInvitationLinkAction } from "./actions";
import { copy, fill } from "./copy";

// PO-02D3 — the public invitation-acceptance page. The token arrives in the URL FRAGMENT (#t=…), which the browser
// never sends to a server. It is read once, on the client, and removed from the address bar, from this history entry
// and from Next.js's router's copy of the address (history.replaceState) — before any request is made — so a
// refresh, a router update, a back/forward step or a shared screenshot cannot carry it. It lives only in this
// component's memory (a ref): never in state that renders, a cookie, localStorage, sessionStorage, a URL or a log,
// and it travels only in the body of the page's same-origin server actions; leaving the page drops it. The language
// switches here, on the client, so nothing re-mounts and the token is never lost while the page is in use.

type Mode = "ready" | "disabled" | "signed-in";
type View =
  | { kind: "reading" }
  | { kind: "missing" }
  | { kind: "disabled" }
  | { kind: "signed-in" }
  | { kind: "checking" }
  | { kind: "refused"; reason: PublicRefusalReason; canRetry: boolean }
  | { kind: "form"; invitation: InvitationPreviewView }
  | { kind: "done"; ownerEmail: string; start: { en: string; ar: string }; end: { en: string; ar: string } };

const TOKEN_FRAGMENT = /^#t=([A-Za-z0-9_-]{1,200})$/;
const RETRYABLE: ReadonlySet<PublicRefusalReason> = new Set(["throttled", "unavailable"]);

/** The /register password policy, mirrored for immediate feedback; the server's check is the one that counts. */
function passwordProblem(password: string): string | null {
  if (password.length === 0) return "Enter a password.";
  if (password.length > 200) return "Use at most 200 characters.";
  if (password.length < 8) return "Must be at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Must include an uppercase letter.";
  if (!/[a-z]/.test(password)) return "Must include a lowercase letter.";
  if (!/[0-9]/.test(password)) return "Must include a number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Must include a special character.";
  return null;
}

/** Ask the server about the held link (no React state here; the caller applies the answer once it settles). */
async function validateLink(held: string | null): Promise<LinkCheck | { ok: false; reason: "missing" }> {
  if (!held) return { ok: false, reason: "missing" };
  return checkInvitationLinkAction({ token: held }).catch(() => ({ ok: false as const, reason: "unavailable" as const }));
}

const REFUSALS: Record<PublicRefusalReason, { title: string; body: string }> = {
  invalid: { title: "This invitation link can't be used", body: "The link is incomplete, has been withdrawn or isn't valid. Ask your Elite ERP contact for a new invitation." },
  expired: { title: "This invitation has expired", body: "Invitations are valid for 72 hours. Ask your Elite ERP contact to send you a new one." },
  used: { title: "This invitation has already been used", body: "If you accepted it, sign in with your e-mail and password." },
  throttled: { title: "Too many attempts", body: "For your security, wait a few minutes and try again." },
  unavailable: { title: "We couldn't complete this invitation", body: "Nothing was created. Try again later, or contact your Elite ERP contact." },
  disabled: { title: "Invitation acceptance isn't available", body: "This service isn't switched on yet. Contact your Elite ERP contact." },
};

export function AcceptInvitation({ initialLocale, mode }: { initialLocale: Locale; mode: Mode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [view, setView] = useState<View>(() => (mode === "disabled" ? { kind: "disabled" } : mode === "signed-in" ? { kind: "signed-in" } : { kind: "reading" }));
  const [ownerName, setOwnerName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Partial<Record<AcceptField, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const token = useRef<string | null>(null);
  const started = useRef(false);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const c = (en: string) => copy(locale, en);

  /** Show the server's answer about the held link. */
  function applyCheck(result: Awaited<ReturnType<typeof validateLink>>) {
    if (result.ok) {
      setOwnerName(result.invitation.ownerName);
      setView({ kind: "form", invitation: result.invitation });
    } else if (result.reason === "missing") {
      setView({ kind: "missing" });
    } else {
      const canRetry = RETRYABLE.has(result.reason);
      if (!canRetry) token.current = null;
      setView({ kind: "refused", reason: result.reason, canRetry });
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const match = TOKEN_FRAGMENT.exec(window.location.hash);
    const clean = window.location.pathname;
    // At once: the address bar and this history entry lose the fragment (Next.js's own state for the entry is kept).
    if (window.location.hash || window.location.search) window.history.replaceState(window.history.state, "", clean);
    token.current = mode === "ready" && match ? match[1] : null;
    // Then Next.js's router is told as well. It keeps its own copy of the address — read from location.href when it
    // started, fragment included — and writes that copy back to history whenever its state changes (found by
    // verify:platform-invitation-acceptance-browser B3). Its history patch, installed by an effect that runs after
    // this one, updates the copy when replaceState is called without its internal marker (state null). Only then is
    // the link checked, so no request is ever made while any copy of the address still holds it.
    window.setTimeout(() => {
      window.history.replaceState(null, "", clean);
      if (mode === "ready") void validateLink(token.current).then(applyCheck);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once: the fragment is read a single time
  }, []);

  function retryCheck() {
    setView({ kind: "checking" });
    void validateLink(token.current).then(applyCheck);
  }

  // Leaving the page drops the link from memory, and a page the browser restores from its back/forward cache reloads
  // (its address holds no fragment, so it finds no invitation): Back can never bring a live form and its link back.
  // A second link opened in this tab changes only the fragment, so the browser does not load the page again: it
  // reloads, and the new page reads that link once and removes it, exactly like the first.
  useEffect(() => {
    const onHide = () => {
      token.current = null;
    };
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    const onHash = () => {
      if (window.location.hash.startsWith("#t=")) window.location.reload();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  // The chosen language applies to the whole document (and to the next page, e.g. /login) without a server round trip.
  useEffect(() => {
    const root = document.documentElement;
    if (root.lang === locale) return;
    root.lang = locale;
    root.dir = locale === "ar" ? "rtl" : "ltr";
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, [locale]);

  // Each new screen announces itself: focus moves to its heading (keyboard and screen-reader users land on it).
  useEffect(() => {
    if (view.kind !== "reading") heading.current?.focus();
  }, [view.kind]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // One request at a time, even for two submits in the same instant (a double Enter): the ref is set synchronously.
    if (inFlight.current || submitting || view.kind !== "form") return;
    const next: Partial<Record<AcceptField, string>> = {};
    const name = ownerName.replace(/\s+/g, " ").trim();
    if (name.length < 1 || name.length > 200) next.ownerName = "Enter your name (up to 200 characters).";
    const problem = passwordProblem(password);
    if (problem) next.password = problem;
    else if (confirm !== password) next.confirm = "The passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    inFlight.current = true;
    setSubmitting(true);
    const result = await acceptInvitationAction({ token: token.current ?? "", ownerName: name, password, confirm }).catch(() => ({ ok: false as const, reason: "unavailable" as const }));
    inFlight.current = false;
    setSubmitting(false);
    if (result.ok) {
      token.current = null;
      setPassword("");
      setConfirm("");
      setView({ kind: "done", ownerEmail: result.ownerEmail, start: result.startDateText, end: result.endDateText });
    } else if (result.reason === "validation") {
      setErrors({ [result.field]: result.message });
    } else {
      setPassword("");
      setConfirm("");
      const canRetry = RETRYABLE.has(result.reason);
      if (!canRetry) token.current = null;
      setView({ kind: "refused", reason: result.reason, canRetry });
    }
  }

  const fieldProps = (field: AcceptField) =>
    errors[field] ? { "aria-invalid": true as const, "aria-describedby": `${field}-error` } : { "aria-describedby": field === "password" ? "password-hint" : undefined };
  const fieldError = (field: AcceptField) =>
    errors[field] ? (
      <p id={`${field}-error`} className="text-caption text-danger" role="alert">
        {c(errors[field] as string)}
      </p>
    ) : null;

  return (
    <div className="auth-split">
      <div className="auth-form-col">
        <main className="auth-form w-full max-w-[480px] animate-fade-up" aria-busy={view.kind === "checking" || submitting}>
          <div className="flex items-center justify-between gap-4 mb-10">
            <LogoLockup ink="var(--brand-ink)" size={30} />
            <div className="topbar-lang" role="group" aria-label={c("Language")}>
              {(["en", "ar"] as const).map((l) => (
                <button key={l} type="button" lang={l} className="topbar-lang-option" aria-pressed={l === locale} aria-label={l === "en" ? "English" : "العربية"} onClick={() => setLocale(l)}>
                  {l === "en" ? "EN" : "ع"}
                </button>
              ))}
            </div>
          </div>

          {(view.kind === "reading" || view.kind === "checking") && (
            <div className="flex flex-col gap-3">
              <h1 ref={heading} tabIndex={-1} className="text-display font-bold tracking-tight outline-none">{c("Accept your invitation")}</h1>
              <p className="flex items-center gap-2 text-ink-muted text-body-lg" role="status">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                {c("Checking your invitation…")}
              </p>
            </div>
          )}

          {view.kind === "missing" && <Notice heading={heading} icon="alert" title={c("No invitation found in this link")} body={c("Open the complete link you received, exactly as it was sent to you.")} />}
          {view.kind === "disabled" && <Notice heading={heading} icon="alert" title={c(REFUSALS.disabled.title)} body={c(REFUSALS.disabled.body)} />}
          {view.kind === "signed-in" && (
            <Notice heading={heading} icon="alert" title={c("You're signed in to Elite ERP")} body={c("To accept an invitation for a new company, sign out first, then open your invitation link again.")}>
              <form action={logoutAction} className="mt-8">
                <Button type="submit" className="w-full">
                  <LogOut aria-hidden />
                  {c("Sign out")}
                </Button>
              </form>
            </Notice>
          )}
          {view.kind === "refused" && (
            <Notice heading={heading} icon={view.reason === "expired" ? "clock" : "alert"} title={c(REFUSALS[view.reason].title)} body={c(REFUSALS[view.reason].body)}>
              {view.reason === "used" && (
                <Button asChild className="mt-8 w-full">
                  <a href="/login">{c("Sign in")}</a>
                </Button>
              )}
              {view.canRetry && (
                <Button type="button" variant="secondary" className="mt-8 w-full" onClick={retryCheck}>
                  {c("Try again")}
                </Button>
              )}
            </Notice>
          )}

          {view.kind === "done" && (
            <Notice heading={heading} icon="done" title={c("Your company is ready")} body={c("Sign in with this e-mail and the password you just chose:")}>
              <p className="mt-2 text-body-lg font-semibold text-ink break-all">
                <bdi dir="ltr">{view.ownerEmail}</bdi>
              </p>
              <p className="mt-3 text-body text-ink">{fill(locale, "Your free Trial runs from {start} to {end}.", { start: view.start[locale], end: view.end[locale] })}</p>
              <Button asChild className="mt-8 w-full">
                <a href="/login">{c("Sign in")}</a>
              </Button>
            </Notice>
          )}

          {view.kind === "form" && (
            <div className="flex flex-col">
              <h1 ref={heading} tabIndex={-1} className="text-display font-bold tracking-tight outline-none">{c("Accept your invitation")}</h1>
              <p className="text-ink-muted text-body-lg mt-2 mb-6">{c("You've been invited to set up your company on Elite ERP.")}</p>

              <section aria-labelledby="company-heading" className="rounded-lg border border-line bg-surface-raised p-4">
                <h2 id="company-heading" className="text-title font-semibold">{view.invitation.companyName}</h2>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
                  <dt className="text-ink-muted">{c("Country")}</dt>
                  <dd>{view.invitation.countryName}</dd>
                  <dt className="text-ink-muted">{c("Base currency")}</dt>
                  <dd><span className="num" dir="ltr">{view.invitation.currencyCode}</span></dd>
                  <dt className="text-ink-muted">{c("Your e-mail")}</dt>
                  <dd className="min-w-0 break-all"><span dir="ltr">{view.invitation.ownerEmail}</span></dd>
                  <dt className="text-ink-muted">{c("Invitation reference")}</dt>
                  <dd><span className="num" dir="ltr">{view.invitation.reference}</span></dd>
                  <dt className="text-ink-muted">{c("Valid until")}</dt>
                  <dd>{view.invitation.expiresAtText[locale]}</dd>
                </dl>
                <p className="mt-3 text-caption text-ink-muted">{c("Company details come from your invitation. If anything is wrong, contact your Elite ERP contact before you accept.")}</p>
              </section>

              <section aria-labelledby="trial-heading" className="mt-4 rounded-lg border border-line bg-surface-raised p-4">
                <h2 id="trial-heading" className="flex items-center gap-2 text-title font-semibold">
                  <ShieldCheck className="size-5 text-ink-muted" aria-hidden />
                  {c("Your free Trial")}
                </h2>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
                  <dt className="text-ink-muted">{c("Package")}</dt>
                  <dd>
                    <bdi>{view.invitation.trial.packageName}</bdi> · {fill(locale, "Version {n}", { n: view.invitation.trial.versionNumber })}
                  </dd>
                  <dt className="text-ink-muted">{c("Length")}</dt>
                  <dd>{fill(locale, "{n} days", { n: view.invitation.trial.trialDays })}</dd>
                  <dt className="text-ink-muted">{c("Users included")}</dt>
                  <dd><span className="num" dir="ltr">{view.invitation.trial.seats}</span></dd>
                  <dt className="text-ink-muted">{c("Storage")}</dt>
                  <dd>{fill(locale, "{n} GB", { n: view.invitation.trial.storageGb })}</dd>
                  <dt className="text-ink-muted">{c("Modules")}</dt>
                  <dd>{fill(locale, "All {n} module groups", { n: view.invitation.trial.modules.length })}</dd>
                  <dt className="text-ink-muted">{c("Price")}</dt>
                  <dd>
                    <span className="num" dir="ltr">{view.invitation.trial.currency} {view.invitation.trial.price}</span> · {c("Free — no payment required")}
                  </dd>
                </dl>
                <p className="mt-3 text-caption text-ink-muted">{c("The Trial starts on the day you accept. Users, storage and modules are shown for information; nothing is restricted during the Trial.")}</p>
              </section>

              <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4" aria-labelledby="account-heading">
                <h2 id="account-heading" className="text-title font-semibold">{c("Your account")}</h2>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ownerName">{c("Your name")}</Label>
                  <Input id="ownerName" name="ownerName" autoComplete="name" maxLength={200} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} disabled={submitting} {...fieldProps("ownerName")} />
                  {fieldError("ownerName")}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="password">{c("Password")}</Label>
                  <Input id="password" name="password" type="password" autoComplete="new-password" maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting} {...fieldProps("password")} />
                  <p id="password-hint" className="text-caption text-ink-muted">{c("At least 8 characters, with an uppercase letter, a lowercase letter, a number and a symbol.")}</p>
                  {fieldError("password")}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="confirm">{c("Confirm password")}</Label>
                  <Input id="confirm" name="confirm" type="password" autoComplete="new-password" maxLength={200} value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={submitting} {...fieldProps("confirm")} />
                  {fieldError("confirm")}
                </div>
                <Button type="submit" className="mt-2 w-full" loading={submitting} disabled={submitting}>
                  {submitting ? c("Creating your company…") : c("Accept and create company")}
                </Button>
              </form>
            </div>
          )}
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

function Notice({ heading, icon, title, body, children }: { heading: React.RefObject<HTMLHeadingElement | null>; icon: "alert" | "clock" | "done"; title: string; body: string; children?: React.ReactNode }) {
  const Icon = icon === "done" ? CircleCheck : icon === "clock" ? Clock : CircleAlert;
  return (
    <div className="flex flex-col">
      <span className="mb-5 inline-flex size-12 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-muted" aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <h1 ref={heading} tabIndex={-1} className="text-display font-bold tracking-tight outline-none">{title}</h1>
      <p className="text-ink-muted text-body-lg mt-2">{body}</p>
      {children}
    </div>
  );
}
