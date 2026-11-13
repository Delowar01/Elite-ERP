"use client";

import Link from "next/link";
import { useRef, useTransition } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Locale } from "@/lib/i18n/dict";
import { platformSignOutAction } from "@/app/(platform)/auth-actions";
import { pt } from "./i18n";
import { initialsOf, isRedirect } from "./utils";

/** The operator's account menu: identity, a shortcut to security settings, and sign-out. */
export function PlatformAccountMenu({ operator, locale }: { operator: { name: string; email: string }; locale: Locale }) {
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  function signOut() {
    if (busy.current) return; // one sign-out request at a time
    busy.current = true;
    startTransition(async () => {
      try {
        // On success the action clears the cookie and redirects to sign-in; it only returns on failure.
        const result = await platformSignOutAction();
        if (result?.status === "error") toast.error(result.message);
      } catch (err) {
        // A redirect is delivered as a navigation; anything else thrown here is a network failure.
        if (!isRedirect(err)) toast.error(pt(locale, "login.network"));
      } finally {
        busy.current = false;
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="topbar-profile" aria-label={`${pt(locale, "shell.account")}: ${operator.name}`}>
        <span className="topbar-profile-text">
          <span className="topbar-profile-name" dir="auto">{operator.name}</span>
          <span className="topbar-profile-role">{pt(locale, "brand.product")}</span>
        </span>
        <Avatar className="size-8 font-semibold">
          <AvatarFallback className="topbar-avatar">{initialsOf(operator.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuLabel>
          <span className="block text-caption font-normal text-ink-faint">{pt(locale, "shell.signedInAs")}</span>
          <span className="block" dir="auto">{operator.name}</span>
        </DropdownMenuLabel>
        <div className="px-3 pb-2 -mt-1 text-xs text-ink-faint">
          <bdi dir="ltr">{operator.email}</bdi>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer">
          <Link href="/platform/settings">
            <ShieldCheck className="size-3.5" aria-hidden /> {pt(locale, "shell.securitySettings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer"
          disabled={pending}
          onSelect={(e) => {
            e.preventDefault();
            signOut();
          }}
        >
          <LogOut className="size-3.5" aria-hidden /> {pending ? pt(locale, "shell.signingOut") : pt(locale, "shell.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
