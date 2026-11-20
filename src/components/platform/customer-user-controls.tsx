"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, LogOut, RefreshCw, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/lib/i18n/dict";
import { changeCustomerUserStatusAction, readCustomerUserStateAction, revokeCustomerUserSessionsAction } from "@/app/(platform)/customer-user-actions";
import { pt } from "./i18n";
import { PlatformDialog } from "./platform-dialog";
import { isRedirect } from "./utils";

// ---------------------------------------------------------------------------------------------
// Disable / enable one customer user, and sign one customer user out everywhere (PO-03B). Nothing here is trusted
// for authorization: each server action re-checks flag → origin → live platform session → platform.users.manage and
// a fresh TOTP code, and the shared customer-user service applies the lock order, the owner rules and the audit in
// one transaction. This component explains the consequences, collects the reason and the code, and reports every
// outcome:
//  • opening a dialog reads the account's CURRENT state first (loading → the form, or "changed since this page
//    loaded" with a refresh), and the version it confirmed against travels with the change, so a stale page never
//    overwrites a newer decision;
//  • the primary owner and the company's last active owner are refused before any code is asked for (the server
//    refuses them anyway);
//  • one request at a time; the code is cleared after every attempt; on success the page is refreshed.
// ---------------------------------------------------------------------------------------------

/** Kept equal to USER_REASON_MIN / USER_REASON_MAX in src/lib/platform/customer-user-actions.ts (rule 47). */
const REASON_MIN = 10;
const REASON_MAX = 500;

type Mode = "status" | "revoke";
type Phase =
  | { kind: "checking" }
  | { kind: "form"; liveSessions: number }
  | { kind: "changed" }
  | { kind: "blocked"; message: string }
  | { kind: "done"; message: string };
type FieldErrors = { reason?: string; code?: string };
type Protection = { primaryOwner: "yes" | "no" | "not_installed" | "unavailable"; lastActiveOwner: boolean };

const normalizeReason = (value: string) => value.replace(/\s+/g, " ").trim();
/** First-strong isolate: a Latin name keeps its own direction inside an Arabic sentence. */
const isolate = (value: string) => `⁨${value}⁩`;

function protectionMessage(locale: Locale, p: Protection): string | null {
  if (p.primaryOwner === "yes") return pt(locale, "cu.protectedPrimary");
  if (p.lastActiveOwner) return pt(locale, "cu.protectedLast");
  return null;
}

export function CustomerUserControls({
  locale,
  userId,
  name,
  isActive,
  version,
  protection,
  noteId,
}: {
  locale: Locale;
  userId: number;
  name: string;
  isActive: boolean;
  version: string;
  protection: Protection;
  noteId?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("status");
  // The change the status dialog was opened for (the page refreshes after a success; the dialog must not flip).
  const [target, setTarget] = useState<"disabled" | "active">(isActive ? "disabled" : "active");
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const statusButton = useRef<HTMLButtonElement>(null);
  const revokeButton = useRef<HTMLButtonElement>(null);

  const disabling = mode === "status" && target === "disabled";
  const blockedHere = isActive ? protectionMessage(locale, protection) : null;

  function run(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
        await task();
      } catch (err) {
        if (!isRedirect(err)) setFailure(pt(locale, "login.network"));
      } finally {
        inFlight.current = false;
      }
    });
  }

  function openDialog(next: Mode) {
    setReason("");
    setCode("");
    setErrors({});
    setFailure(null);
    setMode(next);
    const nextTarget = isActive ? "disabled" : "active";
    setTarget(nextTarget);
    setPhase({ kind: "checking" });
    setOpen(true);
    run(async () => {
      const r = await readCustomerUserStateAction(String(userId));
      if (!r.ok) return setPhase({ kind: "blocked", message: r.message });
      if (next === "status") {
        if (r.state.version !== version || r.state.isActive !== isActive) return setPhase({ kind: "changed" });
        const refusal = nextTarget === "disabled" ? protectionMessage(locale, r.state) : null;
        if (refusal) return setPhase({ kind: "blocked", message: refusal });
      }
      setPhase({ kind: "form", liveSessions: r.state.liveSessions });
    });
  }

  function close() {
    setOpen(false);
    if (phase.kind === "done" || phase.kind === "changed") router.refresh();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || phase.kind !== "form") return;
    const totpCode = code.replace(/\s/g, "");
    const cleanReason = normalizeReason(reason);
    const next: FieldErrors = {};
    if (cleanReason.length < REASON_MIN || cleanReason.length > REASON_MAX) next.reason = pt(locale, "accessDialog.reasonInvalid", { min: REASON_MIN, max: REASON_MAX });
    if (!/^\d{6}$/.test(totpCode)) next.code = pt(locale, "login.totpHint");
    setErrors(next);
    setFailure(null);
    if (next.reason || next.code) return;
    run(async () => {
      if (mode === "status") {
        const r = await changeCustomerUserStatusAction({ userId: String(userId), target, reason: cleanReason, totpCode, version });
        setCode("");
        if (r.ok) setPhase({ kind: "done", message: r.status === "disabled" ? pt(locale, "cuDialog.disabledDone", { n: r.sessionsEnded }) : pt(locale, "cuDialog.enabledDone") });
        else if (r.code === "CONFLICT" || r.code === "VERSION_CONFLICT") setPhase({ kind: "changed" });
        else if (r.code === "LAST_PRIMARY_OWNER") setPhase({ kind: "blocked", message: pt(locale, "cu.protectedPrimary") });
        else if (r.code === "LAST_ACTIVE_OWNER") setPhase({ kind: "blocked", message: pt(locale, "cu.protectedLast") });
        else setFailure(r.message);
      } else {
        const r = await revokeCustomerUserSessionsAction({ userId: String(userId), reason: cleanReason, totpCode });
        setCode("");
        if (r.ok) setPhase({ kind: "done", message: pt(locale, "cuDialog.revokedDone", { n: r.sessionsEnded }) });
        else setFailure(r.message);
      }
    });
  }

  const reasonLength = normalizeReason(reason).length;
  const statusLabel = pt(locale, isActive ? "cu.disable" : "cu.enable");
  const StatusIcon = isActive ? UserX : UserCheck;
  const title =
    mode === "revoke"
      ? pt(locale, "cuDialog.revokeTitle", { name: isolate(name) })
      : pt(locale, target === "disabled" ? "cuDialog.disableTitle" : "cuDialog.enableTitle", { name: isolate(name) });
  const description = pt(locale, mode === "revoke" ? "cuDialog.revokeText" : target === "disabled" ? "cuDialog.disableText" : "cuDialog.enableText");
  const submitLabel =
    mode === "revoke"
      ? pt(locale, pending && phase.kind === "form" ? "cuDialog.revoking" : "cuDialog.revokeSubmit")
      : target === "disabled"
        ? pt(locale, pending && phase.kind === "form" ? "cuDialog.disabling" : "cuDialog.disableSubmit")
        : pt(locale, pending && phase.kind === "form" ? "cuDialog.enabling" : "cuDialog.enableSubmit");

  return (
    <>
      <div className="platform-user-controls">
        {blockedHere ? (
          <Button type="button" variant="secondary" disabled aria-disabled="true" title={blockedHere} aria-label={`${statusLabel} — ${blockedHere}`} aria-describedby={noteId} data-testid="user-status-control">
            <StatusIcon aria-hidden />
            {statusLabel}
          </Button>
        ) : (
          <Button ref={statusButton} type="button" variant="secondary" onClick={() => openDialog("status")} aria-haspopup="dialog" data-testid="user-status-control">
            <StatusIcon aria-hidden />
            {statusLabel}
          </Button>
        )}
        <Button ref={revokeButton} type="button" variant="secondary" onClick={() => openDialog("revoke")} aria-haspopup="dialog" data-testid="user-revoke-control">
          <LogOut aria-hidden />
          {pt(locale, "cu.revoke")}
        </Button>
      </div>

      <PlatformDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={title}
        description={description}
        closeLabel={pt(locale, "common.close")}
        dismissible={!pending}
        returnFocus={mode === "revoke" ? revokeButton : statusButton}
        sheet
      >
        {phase.kind === "done" ? (
          <div className="platform-access-result" role="status">
            <p className="platform-callout" data-tone="neutral">
              <CircleCheck className="size-4 shrink-0" aria-hidden />
              <span>{phase.message}</span>
            </p>
            <div className="platform-dialog-actions">
              <Button type="button" onClick={close}>
                {pt(locale, "accessDialog.done")}
              </Button>
            </div>
          </div>
        ) : phase.kind === "changed" ? (
          <div>
            <p className="platform-callout" data-tone="neutral" role="alert">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              <span>{pt(locale, "cuDialog.changed")}</span>
            </p>
            <div className="platform-dialog-actions">
              <Button type="button" onClick={close}>
                <RefreshCw aria-hidden />
                {pt(locale, "accessDialog.refresh")}
              </Button>
            </div>
          </div>
        ) : phase.kind === "blocked" ? (
          <div>
            <p className="platform-form-error" role="alert">
              {phase.message}
            </p>
            <div className="platform-dialog-actions">
              <Button type="button" variant="secondary" onClick={close}>
                {pt(locale, "common.close")}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="platform-access-form" noValidate aria-busy={pending || phase.kind === "checking" || undefined}>
            <section aria-labelledby={`user-effects-${userId}`}>
              <h3 id={`user-effects-${userId}`} className="platform-access-heading">
                {pt(locale, "accessDialog.effects")}
              </h3>
              <ul className="platform-access-effects">
                {mode === "revoke" ? (
                  <>
                    {phase.kind === "form" && <li>{pt(locale, "cuDialog.sessionsNow", { n: phase.liveSessions })}</li>}
                    <li>{pt(locale, "cuDialog.revokeSignIn")}</li>
                    <li>{pt(locale, "cuDialog.dataKept")}</li>
                  </>
                ) : disabling ? (
                  <>
                    <li>{pt(locale, "cuDialog.disableEnds")}</li>
                    {phase.kind === "form" && <li>{pt(locale, "cuDialog.sessionsNow", { n: phase.liveSessions })}</li>}
                    <li>{pt(locale, "cuDialog.disableNoSignIn")}</li>
                    <li>{pt(locale, "cuDialog.dataKept")}</li>
                    <li>{pt(locale, "cuDialog.seatsUnchanged")}</li>
                  </>
                ) : (
                  <>
                    <li>{pt(locale, "cuDialog.enableEnds")}</li>
                    <li>{pt(locale, "cuDialog.dataKept")}</li>
                  </>
                )}
                <li>{pt(locale, "cuDialog.recorded")}</li>
              </ul>
            </section>

            {phase.kind === "checking" && (
              <p className="platform-fine-print" role="status">
                {pt(locale, "cuDialog.checking")}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`user-reason-${userId}`}>{pt(locale, "accessDialog.reason")}</Label>
              <Textarea
                id={`user-reason-${userId}`}
                dir="auto"
                rows={3}
                maxLength={REASON_MAX + 100}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pending || phase.kind === "checking"}
                aria-invalid={errors.reason ? true : undefined}
                aria-describedby={`user-reason-hint-${userId}${errors.reason ? ` user-reason-error-${userId}` : ""}`}
              />
              <div className="platform-access-hint">
                <span id={`user-reason-hint-${userId}`}>{pt(locale, "accessDialog.reasonHint", { min: REASON_MIN, max: REASON_MAX })}</span>
                <span className="platform-access-count" aria-hidden="true" data-over={reasonLength > REASON_MAX || undefined}>
                  {pt(locale, "accessDialog.reasonCount", { n: reasonLength, max: REASON_MAX })}
                </span>
              </div>
              {errors.reason && (
                <p id={`user-reason-error-${userId}`} className="platform-field-error">
                  {errors.reason}
                </p>
              )}
            </div>

            <fieldset className="platform-access-stepup" disabled={pending || phase.kind === "checking"}>
              <legend className="platform-access-heading">{pt(locale, "accessDialog.stepUp")}</legend>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`user-totp-${userId}`}>{pt(locale, "login.totpLabel")}</Label>
                <Input
                  id={`user-totp-${userId}`}
                  dir="ltr"
                  className="platform-code-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  aria-invalid={errors.code ? true : undefined}
                  aria-describedby={errors.code ? `user-totp-error-${userId}` : undefined}
                />
              </div>
              {errors.code && (
                <p id={`user-totp-error-${userId}`} className="platform-field-error">
                  {errors.code}
                </p>
              )}
            </fieldset>

            {failure && (
              <p className="platform-form-error" role="alert">
                {failure}
              </p>
            )}

            <div className="platform-dialog-actions">
              <Button type="button" variant="secondary" onClick={close} disabled={pending}>
                {pt(locale, "common.cancel")}
              </Button>
              <Button type="submit" variant={disabling ? "destructive" : "primary"} loading={pending && phase.kind === "form"} disabled={phase.kind === "checking"}>
                {submitLabel}
              </Button>
            </div>
          </form>
        )}
      </PlatformDialog>
    </>
  );
}
