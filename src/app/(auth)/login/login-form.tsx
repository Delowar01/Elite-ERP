"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { loginAction } from "../actions";
import { LogoLockup } from "@/components/brand/logo-lockup";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";

export function LoginForm({ locale }: { locale: Locale }) {
  const [state, formAction, pending] = useActionState(loginAction, undefined);
  // Controlled so email + password + code survive the re-render into the MFA step.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");

  // Stage 11: the action returns MFA_REQUIRED once the password is accepted and MFA
  // is enabled; we then reveal the code field (email + password stay filled).
  const mfaStage = state?.error === "MFA_REQUIRED" || state?.error === "MFA_INVALID";
  // Known messages translate via the dictionary; any dynamic server text passes through.
  const errorText =
    state?.error === "MFA_REQUIRED"
      ? null
      : state?.error === "MFA_INVALID"
        ? t(locale, "That code didn't match. Try again.")
        : state?.error
          ? t(locale, state.error)
          : null;

  return (
    <div className="w-full max-w-[400px] rounded-2xl border border-line bg-surface-glass p-9 shadow-glass backdrop-blur-xl animate-fade-up">
      <div className="flex justify-center mb-7">
        <LogoLockup ink="var(--brand-navy)" size={30} />
      </div>
      <h1 className="text-center text-xl font-bold">{t(locale, "Welcome back")}</h1>
      <p className="text-center text-ink-muted text-sm mt-1 mb-6">
        {mfaStage ? t(locale, "Enter the code from your authenticator app") : t(locale, "Sign in to your organization")}
      </p>

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t(locale, "Email")}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" placeholder={t(locale, "you@company.com")} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t(locale, "Password")}</Label>
          <Input id="password" name="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {mfaStage && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mfaCode">{t(locale, "Authentication code")}</Label>
            <Input id="mfaCode" name="mfaCode" inputMode="numeric" autoComplete="one-time-code" placeholder={t(locale, "123456 or a recovery code")} autoFocus required value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
          </div>
        )}
        {errorText && <p className="text-[12.5px] text-danger">{errorText}</p>}
        <Button type="submit" className="w-full mt-1" disabled={pending}>
          {pending ? t(locale, "Signing in…") : mfaStage ? t(locale, "Verify") : t(locale, "Sign in")}
        </Button>
      </form>

      <p className="text-center text-[12.5px] text-ink-muted mt-5">
        {t(locale, "New organization?")}{" "}
        <Link href="/register" className="text-brand-orange font-semibold">
          {t(locale, "Create an account")}
        </Link>
      </p>
    </div>
  );
}
