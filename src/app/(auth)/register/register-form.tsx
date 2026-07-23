"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction } from "../actions";
import { LogoLockup } from "@/components/brand/logo-lockup";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@/lib/i18n/dict";

export function RegisterForm({ locale }: { locale: Locale }) {
  const [state, formAction, pending] = useActionState(registerAction, undefined);
  // Known validation messages translate via the dictionary; dynamic server text passes through.
  const errorText = state?.error ? t(locale, state.error) : null;

  return (
    <div className="w-full max-w-[420px] rounded-2xl border border-line bg-surface-glass p-9 shadow-glass backdrop-blur-xl animate-fade-up">
      <div className="flex justify-center mb-7">
        <LogoLockup ink="var(--brand-navy)" size={30} />
      </div>
      <h1 className="text-center text-xl font-bold">{t(locale, "Create your organization")}</h1>
      <p className="text-center text-ink-muted text-sm mt-1 mb-6">{t(locale, "Start your Elite ERP workspace")}</p>

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="orgName">{t(locale, "Organization name")}</Label>
          <Input id="orgName" name="orgName" required placeholder={t(locale, "Aurora Fabrication Co.")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">{t(locale, "Your name")}</Label>
          <Input id="name" name="name" required placeholder={t(locale, "Jane Doe")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t(locale, "Email")}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" placeholder={t(locale, "you@company.com")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t(locale, "Password")}</Label>
          <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
        </div>
        {errorText && <p className="text-[12.5px] text-danger">{errorText}</p>}
        <Button type="submit" className="w-full mt-1" disabled={pending}>
          {pending ? t(locale, "Creating…") : t(locale, "Create account")}
        </Button>
      </form>

      <p className="text-center text-[12.5px] text-ink-muted mt-5">
        {t(locale, "Already have an account?")}{" "}
        <Link href="/login" className="text-brand-orange font-semibold">
          {t(locale, "Sign in")}
        </Link>
      </p>
    </div>
  );
}
