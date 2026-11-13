"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Copy, KeyRound, Laptop, LogOut, MonitorSmartphone, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/lib/i18n/dict";
import { platformSignOutAction } from "@/app/(platform)/auth-actions";
import { regenerateRecoveryCodesAction, revokePlatformSessionAction, signOutOtherPlatformSessionsAction } from "@/app/(platform)/security-actions";
import { pt } from "./i18n";
import { PlatformDialog } from "./platform-dialog";
import { isRedirect } from "./utils";

// ---------------------------------------------------------------------------------------------
// Security settings (PO-01B §8) — operational, on the PO-01A backend. Every button calls a server
// action that re-authorizes on its own (flag → origin → live session → permission), so nothing here
// is trusted for authorization; this component only renders and reports.
//  • session list: only the caller's own sessions are ever loaded or revocable;
//  • recovery-code regeneration: password + a fresh authenticator code (step-up), shown once, never
//    stored by the browser; a failed check rotates nothing (verified in verify-platform-console);
//  • one request at a time per control; every outcome is announced (toast / role=alert).
// ---------------------------------------------------------------------------------------------

export type SessionView = { id: string; createdAt: string; lastSeenAt: string; expiresAt: string; ip: string | null; device: string };
export type SecurityView = {
  mfaEnrolledAt: string | null;
  current: SessionView;
  others: SessionView[];
  recoveryCodesRemaining: number;
  policy: { absoluteHours: number; idleMinutes: number };
  timeZoneNote: string;
};

function useGuardedTransition(locale: Locale) {
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  function run(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
        await task();
      } catch (err) {
        if (!isRedirect(err)) toast.error(pt(locale, "login.network"));
      } finally {
        inFlight.current = false;
      }
    });
  }
  return { pending, run };
}

/** `ltr` isolates a value that is pure Latin (an IP address) so it never reorders inside Arabic text.
 *  Dates are NOT isolated: in Arabic they carry Arabic month names and follow the page direction. */
function Field({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="platform-field">
      <dt>{label}</dt>
      <dd>{ltr ? <bdi dir="ltr">{value}</bdi> : value}</dd>
    </div>
  );
}

export function PlatformSecurityPanel({ locale, view }: { locale: Locale; view: SecurityView }) {
  const signOutThis = useGuardedTransition(locale);
  const othersAction = useGuardedTransition(locale);
  const [revoking, setRevoking] = useState<string | null>(null);
  const revokeAction = useGuardedTransition(locale);
  const [confirmOthers, setConfirmOthers] = useState(false);

  const notRecorded = pt(locale, "common.notRecorded");

  return (
    <div className="platform-settings-stack">
      {/* Two-step verification — mandatory, not switchable. */}
      <section className="card platform-panel" aria-labelledby="sec-mfa">
        <div className="platform-panel-head">
          <h2 id="sec-mfa">
            <ShieldCheck className="size-4" aria-hidden /> {pt(locale, "sec.mfa")}
          </h2>
          <Badge variant="success">{pt(locale, "common.required")}</Badge>
        </div>
        <div className="platform-panel-body">
          <p className="text-body text-ink-muted">{pt(locale, "sec.mfaText")}</p>
          <dl className="platform-fields mt-4">
            <Field label={pt(locale, "sec.enrolled")} value={view.mfaEnrolledAt ?? notRecorded} />
          </dl>
        </div>
      </section>

      {/* This session. */}
      <section className="card platform-panel" aria-labelledby="sec-current">
        <div className="platform-panel-head">
          <h2 id="sec-current">
            <Laptop className="size-4" aria-hidden /> {pt(locale, "sec.thisSession")}
          </h2>
          <Badge variant="info">{pt(locale, "sec.thisDevice")}</Badge>
        </div>
        <div className="platform-panel-body">
          <dl className="platform-fields">
            <Field label={pt(locale, "sec.device")} value={view.current.device} />
            <Field label={pt(locale, "sec.ip")} value={view.current.ip ?? notRecorded} ltr={Boolean(view.current.ip)} />
            <Field label={pt(locale, "sec.signedIn")} value={view.current.createdAt} />
            <Field label={pt(locale, "sec.lastActivity")} value={view.current.lastSeenAt} />
            <Field label={pt(locale, "sec.expires")} value={view.current.expiresAt} />
          </dl>
          <p className="platform-fine-print mt-3">{view.timeZoneNote}</p>
          <p className="platform-callout mt-4" data-tone="neutral">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            <span>
              {pt(locale, "sec.policy", { h: view.policy.absoluteHours, m: view.policy.idleMinutes })} {pt(locale, "sec.policyProvisional")}
            </span>
          </p>
          <div className="mt-4">
            <Button
              type="button"
              variant="secondary"
              loading={signOutThis.pending}
              onClick={() =>
                signOutThis.run(async () => {
                  const r = await platformSignOutAction();
                  if (r?.status === "error") toast.error(r.message);
                })
              }
            >
              {!signOutThis.pending && <LogOut aria-hidden />}
              {signOutThis.pending ? pt(locale, "shell.signingOut") : pt(locale, "sec.signOutThis")}
            </Button>
          </div>
        </div>
      </section>

      {/* Other active sessions. */}
      <section className="card platform-panel" aria-labelledby="sec-sessions">
        <div className="platform-panel-head">
          <h2 id="sec-sessions">
            <MonitorSmartphone className="size-4" aria-hidden /> {pt(locale, "sec.sessions")}
          </h2>
          <Button type="button" variant="outline" size="sm" disabled={view.others.length === 0 || othersAction.pending} loading={othersAction.pending} onClick={() => setConfirmOthers(true)}>
            {pt(locale, "sec.signOutOthers")}
          </Button>
        </div>
        <div className="platform-panel-body">
          <p className="text-body-sm text-ink-muted mb-3">{pt(locale, "sec.sessionsHint")}</p>
          <ul className="platform-session-list">
            <li className="platform-session" data-current="">
              <div className="min-w-0">
                <p className="platform-session-title">
                  {view.current.device} <Badge variant="info">{pt(locale, "sec.thisDevice")}</Badge>
                </p>
                <p className="platform-session-meta">
                  {view.current.ip ? <bdi dir="ltr">{view.current.ip}</bdi> : notRecorded} · {pt(locale, "sec.lastActivity")}: {view.current.lastSeenAt}
                </p>
              </div>
            </li>
            {view.others.map((s) => (
              <li key={s.id} className="platform-session">
                <div className="min-w-0">
                  <p className="platform-session-title">{s.device}</p>
                  <p className="platform-session-meta">
                    {s.ip ? <bdi dir="ltr">{s.ip}</bdi> : notRecorded} · {pt(locale, "sec.signedIn")}: {s.createdAt} · {pt(locale, "sec.lastActivity")}: {s.lastSeenAt}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive-ghost"
                  size="sm"
                  loading={revokeAction.pending && revoking === s.id}
                  disabled={revokeAction.pending}
                  aria-label={`${pt(locale, "sec.revoke")}: ${s.device}`}
                  onClick={() => {
                    setRevoking(s.id);
                    revokeAction.run(async () => {
                      const r = await revokePlatformSessionAction(s.id);
                      setRevoking(null);
                      if (r.ok) toast.success(pt(locale, "sec.revoked"));
                      else toast.error(r.message);
                    });
                  }}
                >
                  {revokeAction.pending && revoking === s.id ? pt(locale, "sec.revoking") : pt(locale, "sec.revoke")}
                </Button>
              </li>
            ))}
          </ul>
          {view.others.length === 0 && <p className="platform-fine-print mt-3">{pt(locale, "sec.noOthers")}</p>}
        </div>
      </section>

      <PlatformDialog open={confirmOthers} onOpenChange={setConfirmOthers} title={pt(locale, "sec.signOutOthersTitle")} description={pt(locale, "sec.signOutOthersText")} closeLabel={pt(locale, "common.close")}>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setConfirmOthers(false)} disabled={othersAction.pending}>
            {pt(locale, "common.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={othersAction.pending}
            onClick={() =>
              othersAction.run(async () => {
                const r = await signOutOtherPlatformSessionsAction();
                setConfirmOthers(false);
                if (r.ok) toast.success(pt(locale, "sec.signedOutOthers", { n: r.count }));
                else toast.error(r.message);
              })
            }
          >
            {pt(locale, "sec.signOutOthers")}
          </Button>
        </div>
      </PlatformDialog>

      <RecoveryCodesCard locale={locale} remaining={view.recoveryCodesRemaining} />

      {/* Password change: later phase (visibly non-operational). */}
      <section className="card platform-panel" aria-labelledby="sec-password">
        <div className="platform-panel-head">
          <h2 id="sec-password">
            <KeyRound className="size-4" aria-hidden /> {pt(locale, "sec.password")}
          </h2>
          <Badge variant="neutral">{pt(locale, "common.later")}</Badge>
        </div>
        <div className="platform-panel-body">
          <p className="text-body text-ink-muted">{pt(locale, "sec.passwordChangeText")}</p>
          <Button type="button" variant="secondary" className="mt-4" disabled aria-disabled="true">
            {pt(locale, "sec.passwordChange")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function RecoveryCodesCard({ locale, remaining }: { locale: Locale; remaining: number }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const action = useGuardedTransition(locale);

  function reset() {
    setPassword("");
    setTotp("");
    setError(null);
    setCodes(null);
    setCopied(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (action.pending) return;
    const code = totp.replace(/\s/g, "");
    if (!password || !/^\d{6}$/.test(code)) {
      setError(pt(locale, "login.totpHint"));
      return;
    }
    setError(null);
    action.run(async () => {
      const r = await regenerateRecoveryCodesAction({ password, totpCode: code });
      setPassword("");
      setTotp("");
      if (r.ok) setCodes(r.codes);
      else setError(r.message);
    });
  }

  async function copy() {
    if (!codes) return;
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="card platform-panel" aria-labelledby="sec-recovery">
      <div className="platform-panel-head">
        <h2 id="sec-recovery">
          <KeyRound className="size-4" aria-hidden /> {pt(locale, "sec.recovery")}
        </h2>
        <Badge variant={remaining <= 3 ? "warning" : "neutral"}>{pt(locale, "sec.remaining", { n: remaining })}</Badge>
      </div>
      <div className="platform-panel-body">
        <p className="text-body text-ink-muted">{pt(locale, "sec.recoveryText")}</p>
        <Button
          type="button"
          className="mt-4"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          {pt(locale, "sec.generate")}
        </Button>
      </div>

      <PlatformDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
        title={pt(locale, codes ? "sec.newCodesTitle" : "sec.generateTitle")}
        description={pt(locale, codes ? "sec.newCodesText" : "sec.generateText")}
        closeLabel={pt(locale, "common.close")}
        dismissible={!codes && !action.pending}
      >
        {codes ? (
          <div>
            <ol className="platform-codes" dir="ltr" aria-label={pt(locale, "sec.recovery")}>
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={copy}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? pt(locale, "common.copied") : pt(locale, "common.copy")}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                {pt(locale, "sec.savedCodes")}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate aria-busy={action.pending || undefined}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="regen-password">{pt(locale, "login.password")}</Label>
              <Input id="regen-password" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={action.pending} aria-describedby={error ? "regen-error" : undefined} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="regen-totp">{pt(locale, "login.totpLabel")}</Label>
              <Input
                id="regen-totp"
                dir="ltr"
                className="platform-code-input"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                maxLength={7}
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                disabled={action.pending}
                aria-describedby={error ? "regen-error" : undefined}
                aria-invalid={error ? true : undefined}
              />
            </div>
            {error && (
              <p id="regen-error" role="alert" className="platform-form-error">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2 mt-1">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={action.pending}>
                {pt(locale, "common.cancel")}
              </Button>
              <Button type="submit" loading={action.pending}>
                {action.pending ? pt(locale, "sec.generating") : pt(locale, "sec.generateSubmit")}
              </Button>
            </div>
          </form>
        )}
      </PlatformDialog>
    </section>
  );
}
