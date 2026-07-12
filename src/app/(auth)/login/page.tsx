"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction } from "../actions";
import { LogoLockup } from "@/components/brand/logo-lockup";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <div className="w-full max-w-[400px] rounded-2xl border border-line bg-surface-glass p-9 shadow-glass backdrop-blur-xl animate-fade-up">
      <div className="flex justify-center mb-7">
        <LogoLockup ink="var(--brand-navy)" size={30} />
      </div>
      <h1 className="text-center text-xl font-bold">Welcome back</h1>
      <p className="text-center text-ink-muted text-sm mt-1 mb-6">Sign in to your organization</p>

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        {state?.error && <p className="text-[12.5px] text-danger">{state.error}</p>}
        <Button type="submit" className="w-full mt-1" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-center text-[12.5px] text-ink-muted mt-5">
        New organization?{" "}
        <Link href="/register" className="text-brand-orange font-semibold">
          Create an account
        </Link>
      </p>
    </div>
  );
}
