"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Info, KeyRound, LockKeyhole, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { LogoLockup } from "@/components/brand/logo-lockup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/lib/i18n/dict";
import { platformSignInAction, type PlatformSignInResult } from "@/app/(platform)/auth-actions";
import { pt } from "./i18n";

// ---------------------------------------------------------------------------------------------
// Platform Owner sign-in (PO-01B): email + password → mandatory second factor (authenticator code,
// or a single-use recovery code) → session → dashboard.
//
//  • The password lives only in this component's state between the two steps (the server stores no
//    half-authenticated state); it is cleared on success, on "Back" and on a rejected password.
//    Nothing is written to localStorage, sessionStorage, the URL or analytics.
//  • The server sets the HttpOnly session cookie; the token never reaches this code.
//  • One request at a time (pending state + a re-entrancy guard); errors are announced (role=alert)
//    and tied to their field; a failed code keeps the user on the code step, a network failure keeps
//    everything as typed so the same step can be retried.
//  • The only navigation target is the constant dashboard path — no `next` / return-URL parameter.
// ---------------------------------------------------------------------------------------------

type Step = "credentials" | "second";
type Method = "totp" | "recovery";

export function PlatformSignInForm({
  locale,
  initialMethod = "totp",
  notice = null,
}: {
  locale: Locale;
  initialMethod?: Method;
  /** A fixed notice chosen by the page: the session ended, or a sign-out the audit trail could not record (PO-01B.1). */
  notice?: "ended" | "unaudited" | null;
}) {
  const router = useRouter();
  const ids = useId();
  const [step, setStep] = useState<Step>("credentials");
  const [method, setMethod] = useState<Method>(initialMethod);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<{ message: string; field: "email" | "password" | "code" | null } | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "second") codeRef.current?.focus();
  }, [step, method]);

  const busy = pending || done;
  const errorId = `${ids}-error`;

  function run(payload: { email: string; password: string; totpCode?: string; recoveryCode?: string }, onResult: (r: PlatformSignInResult) => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
        onResult(await platformSignInAction(payload));
      } catch {
        // The request never completed (offline, dropped connection): keep what was typed so the same
        // step can simply be retried.
        setError({ message: pt(locale, "login.network"), field: null });
      } finally {
        inFlight.current = false;
      }
    });
  }

  function succeed(r: Extract<PlatformSignInResult, { status: "authenticated" }>) {
    setDone(true);
    setPassword("");
    setCode("");
    if (r.method === "recovery_code" && r.remainingRecoveryCodes !== null) {
      toast.warning(pt(locale, "login.recoveryLow", { n: r.remainingRecoveryCodes }));
    }
    router.replace("/platform/dashboard");
  }

  function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() || !password) {
      setError({ message: pt(locale, "login.required"), field: !email.trim() ? "email" : "password" });
      return;
    }
    run({ email, password }, (r) => {
      if (r.status === "mfa_required") {
        setCode("");
        setStep("second");
      } else if (r.status === "authenticated") {
        succeed(r);
      } else {
        if (r.code === "INVALID_CREDENTIALS") {
          setPassword("");
          passwordRef.current?.focus();
        }
        setError({ message: r.message, field: r.code === "INVALID_CREDENTIALS" ? "password" : null });
      }
    });
  }

  function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const value = method === "totp" ? code.replace(/\s/g, "") : code.trim();
    if (!value || (method === "totp" && !/^\d{6}$/.test(value))) {
      setError({ message: pt(locale, method === "totp" ? "login.totpHint" : "login.codeRequired"), field: "code" });
      codeRef.current?.focus();
      return;
    }
    run(method === "totp" ? { email, password, totpCode: value } : { email, password, recoveryCode: value }, (r) => {
      if (r.status === "authenticated") return succeed(r);
      if (r.status === "error" && r.code === "INVALID_CREDENTIALS") {
        // The password stopped matching between the steps (changed or account disabled): start over.
        setPassword("");
        setCode("");
        setStep("credentials");
        setError({ message: r.message, field: "password" });
        return;
      }
      setCode("");
      codeRef.current?.focus();
      setError({ message: r.status === "error" ? r.message : pt(locale, "login.codeRequired"), field: "code" });
    });
  }

  function back() {
    setStep("credentials");
    setPassword("");
    setCode("");
    setError(null);
  }

  function switchMethod() {
    setMethod((m) => (m === "totp" ? "recovery" : "totp"));
    setCode("");
    setError(null);
  }

  const errorBlock = error && (
    <p id={errorId} role="alert" className="platform-form-error">
      {error.message}
    </p>
  );
  const described = (field: "email" | "password" | "code") => (error && (error.field === field || error.field === null) ? errorId : undefined);

  return (
    <div className="auth-form w-full max-w-[400px] animate-fade-up">
      <div className="flex mb-8">
        <LogoLockup ink="var(--brand-ink)" size={30} />
      </div>
      <span className="platform-auth-tag">
        <ShieldCheck className="size-3.5" aria-hidden />
        {pt(locale, "brand.console")}
      </span>

      {notice === "unaudited" && step === "credentials" && !error && (
        <p role="status" className="platform-form-notice" data-tone="warning">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          <span>{pt(locale, "login.signedOutUnaudited")}</span>
        </p>
      )}
      {notice === "ended" && step === "credentials" && !error && (
        <p role="status" className="platform-form-notice">
          <Info className="size-4 shrink-0" aria-hidden />
          <span>{pt(locale, "login.ended")}</span>
        </p>
      )}

      {step === "credentials" ? (
        <>
          <h1 className="text-display font-bold tracking-tight mt-4">{pt(locale, initialMethod === "recovery" ? "login.recoveryTitle" : "login.title")}</h1>
          <p className="text-ink-muted text-body-lg mt-2 mb-8">{pt(locale, "login.subtitle")}</p>
          <form onSubmit={submitCredentials} className="flex flex-col gap-4" noValidate aria-busy={busy || undefined}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-email`}>{pt(locale, "login.email")}</Label>
              <Input
                id={`${ids}-email`}
                name="email"
                type="email"
                dir="ltr"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={error?.field === "email" || undefined}
                aria-describedby={described("email")}
                disabled={busy}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-password`}>{pt(locale, "login.password")}</Label>
              <div className="platform-password-field">
                <Input
                  ref={passwordRef}
                  id={`${ids}-password`}
                  name="password"
                  type={showPassword ? "text" : "password"}
                  dir="ltr"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={error?.field === "password" || undefined}
                  aria-describedby={described("password")}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="platform-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                  aria-label={pt(locale, showPassword ? "login.hidePassword" : "login.showPassword")}
                  title={pt(locale, showPassword ? "login.hidePassword" : "login.showPassword")}
                  disabled={busy}
                >
                  {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              </div>
            </div>
            {errorBlock}
            <Button type="submit" size="lg" className="w-full mt-2" loading={busy}>
              {busy ? pt(locale, "login.signingIn") : pt(locale, "login.continue")}
              {!busy && <ArrowRight className="platform-dir-icon" aria-hidden />}
            </Button>
          </form>
          <p className="text-body-sm text-ink-muted mt-6">
            {initialMethod === "recovery" ? (
              <Link href="/platform/login" className="text-link font-semibold">
                {pt(locale, "login.backToSignIn")}
              </Link>
            ) : (
              <Link href="/platform/recover" className="text-link font-semibold">
                {pt(locale, "login.recoveryEntry")}
              </Link>
            )}
          </p>
        </>
      ) : (
        <>
          <div className="platform-step-icon mt-6" aria-hidden>
            {method === "totp" ? <LockKeyhole className="size-5" /> : <KeyRound className="size-5" />}
          </div>
          <h1 className="text-display font-bold tracking-tight mt-4">{pt(locale, method === "totp" ? "login.totpTitle" : "login.recoveryTitle")}</h1>
          <p className="text-ink-muted text-body-lg mt-2 mb-8">{pt(locale, method === "totp" ? "login.totpHint" : "login.recoveryHint")}</p>
          <form onSubmit={submitCode} className="flex flex-col gap-4" noValidate aria-busy={busy || undefined}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${ids}-code`}>{pt(locale, method === "totp" ? "login.totpLabel" : "login.recoveryLabel")}</Label>
              <Input
                ref={codeRef}
                id={`${ids}-code`}
                name={method === "totp" ? "totpCode" : "recoveryCode"}
                dir="ltr"
                className="platform-code-input"
                inputMode={method === "totp" ? "numeric" : "text"}
                pattern={method === "totp" ? "[0-9]*" : undefined}
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={method === "totp" ? 7 : 16}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={error?.field === "code" || undefined}
                aria-describedby={described("code")}
                disabled={busy}
              />
            </div>
            {errorBlock}
            <Button type="submit" size="lg" className="w-full mt-2" loading={busy}>
              {busy ? pt(locale, "login.verifying") : method === "totp" ? pt(locale, "login.verify") : pt(locale, "login.recoverySubmit")}
            </Button>
          </form>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-body-sm">
            <button type="button" className="platform-text-btn" onClick={back} disabled={busy}>
              <ArrowLeft className="size-3.5 platform-dir-icon" aria-hidden />
              {pt(locale, "login.back")}
            </button>
            <button type="button" className="platform-text-btn text-link font-semibold" onClick={switchMethod} disabled={busy}>
              {pt(locale, method === "totp" ? "login.useRecovery" : "login.useTotp")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
