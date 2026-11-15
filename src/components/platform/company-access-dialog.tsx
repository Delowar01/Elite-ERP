"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/lib/i18n/dict";
import { changeCompanyAccessAction, readCompanyAccessAction } from "@/app/(platform)/company-access-actions";
import { pt } from "./i18n";
import { PlatformDialog } from "./platform-dialog";
import { isRedirect } from "./utils";

// ---------------------------------------------------------------------------------------------
// Suspend / reactivate one company (PO-02C). Nothing here is trusted for authorization: the server
// action re-checks flag → origin → live platform session → platform.companies.manage_access and the
// password + fresh TOTP step-up, and changes the access, ends the company's sessions and writes the
// audit record in one transaction. This component explains the consequences, collects the typed
// reference, the reason and the step-up, and reports every outcome:
//  • opening the dialog reads the CURRENT state first (loading → the form, or "changed since this
//    page loaded" with a refresh), so the operator never confirms a state the page only showed;
//  • one request at a time; password and code are cleared after every attempt;
//  • audit trail unavailable → "not applied" (nothing changed); a concurrent change → refresh;
//  • on success the page, the directory and the dashboard are refreshed from the server.
// ---------------------------------------------------------------------------------------------

/** Kept equal to ACCESS_REASON_MIN / ACCESS_REASON_MAX in src/lib/platform/company-access-actions.ts (boundary rule 30). */
const REASON_MIN = 10;
const REASON_MAX = 500;

type Status = "active" | "suspended";
type Phase = { kind: "checking" } | { kind: "form" } | { kind: "changed" } | { kind: "blocked"; message: string } | { kind: "done"; status: Status; sessionsEnded: number };
type FieldErrors = { reference?: string; reason?: string; stepUp?: string };

const normalizeReason = (value: string) => value.replace(/\s+/g, " ").trim();
/** First-strong isolate: a Latin company name or reference keeps its own direction inside an Arabic sentence. */
const isolate = (value: string) => `\u2068${value}\u2069`;

export function CompanyAccessControl({ locale, orgId, reference, companyName, status, enforced, noteId }: { locale: Locale; orgId: number; reference: string; companyName: string; status: Status; enforced: boolean; noteId?: string }) {
  const router = useRouter();
  // The trigger follows the page; the dialog keeps the change it was opened for. (After a success the server action
  // refreshes the page, so `status` flips while the result is still on screen — the dialog must not flip with it.)
  const next: Status = status === "active" ? "suspended" : "active";
  const [target, setTarget] = useState<Status>(next);
  const suspending = target === "suspended";
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  const label = pt(locale, next === "suspended" ? "action.suspend" : "action.reactivate");
  const Icon = next === "suspended" ? ShieldOff : ShieldCheck;

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

  function reset() {
    setTyped("");
    setReason("");
    setPassword("");
    setTotp("");
    setErrors({});
    setFailure(null);
  }

  function openDialog() {
    reset();
    const shown = status;
    setTarget(next);
    setPhase({ kind: "checking" });
    setOpen(true);
    run(async () => {
      const r = await readCompanyAccessAction(String(orgId));
      if (!r.ok) setPhase({ kind: "blocked", message: r.message });
      else if (r.state.status !== shown) setPhase({ kind: "changed" });
      else if (next === "suspended" && !r.state.enforced) setPhase({ kind: "blocked", message: pt(locale, "access.enforcementOff") });
      else setPhase({ kind: "form" });
    });
  }

  function close() {
    setOpen(false);
    if (phase.kind === "done" || phase.kind === "changed") router.refresh();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || phase.kind !== "form") return;
    const code = totp.replace(/\s/g, "");
    const cleanReason = normalizeReason(reason);
    const next: FieldErrors = {};
    if (typed.trim() !== reference) next.reference = pt(locale, "accessDialog.referenceMismatch");
    if (cleanReason.length < REASON_MIN || cleanReason.length > REASON_MAX) next.reason = pt(locale, "accessDialog.reasonInvalid", { min: REASON_MIN, max: REASON_MAX });
    if (!password || !/^\d{6}$/.test(code)) next.stepUp = pt(locale, "login.totpHint");
    setErrors(next);
    setFailure(null);
    if (next.reference || next.reason || next.stepUp) return;
    run(async () => {
      const r = await changeCompanyAccessAction({ orgId: String(orgId), target, reference: typed.trim(), reason: cleanReason, password, totpCode: code });
      setPassword("");
      setTotp("");
      if (r.ok) setPhase({ kind: "done", status: r.status, sessionsEnded: r.sessionsEnded });
      else if (r.code === "CONFLICT") setPhase({ kind: "changed" });
      else setFailure(r.message);
    });
  }

  const reasonLength = normalizeReason(reason).length;
  const disabledNote = next === "suspended" && !enforced ? pt(locale, "access.enforcementOff") : null;

  return (
    <>
      {disabledNote ? (
        <Button type="button" variant="secondary" disabled aria-disabled="true" title={disabledNote} aria-label={`${label} — ${disabledNote}`} aria-describedby={noteId}>
          <Icon aria-hidden />
          {label}
        </Button>
      ) : (
        <Button type="button" variant="secondary" onClick={openDialog} aria-haspopup="dialog">
          <Icon aria-hidden />
          {label}
        </Button>
      )}

      <PlatformDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={pt(locale, suspending ? "accessDialog.suspendTitle" : "accessDialog.reactivateTitle", { company: isolate(companyName) })}
        description={pt(locale, suspending ? "accessDialog.suspendText" : "accessDialog.reactivateText")}
        closeLabel={pt(locale, "common.close")}
        dismissible={!pending}
        sheet
      >
        {phase.kind === "done" ? (
          <div className="platform-access-result" role="status">
            <p className="platform-callout" data-tone="neutral">
              <CircleCheck className="size-4 shrink-0" aria-hidden />
              <span>{phase.status === "suspended" ? pt(locale, "accessDialog.suspendedDone", { n: phase.sessionsEnded }) : pt(locale, "accessDialog.reactivatedDone")}</span>
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
              <span>{pt(locale, "accessDialog.changed")}</span>
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
            <section aria-labelledby="access-effects">
              <h3 id="access-effects" className="platform-access-heading">
                {pt(locale, "accessDialog.effects")}
              </h3>
              <ul className="platform-access-effects">
                {suspending ? (
                  <>
                    <li>{pt(locale, "accessDialog.suspendSignedOut")}</li>
                    <li>{pt(locale, "accessDialog.suspendNoSignIn")}</li>
                    <li>{pt(locale, "accessDialog.recordsKept")}</li>
                    <li>{pt(locale, "accessDialog.subscriptionUnchanged")}</li>
                    <li>{pt(locale, "accessDialog.freshSignIn")}</li>
                  </>
                ) : (
                  <>
                    <li>{pt(locale, "accessDialog.reactivateSignIn")}</li>
                    <li>{pt(locale, "accessDialog.recordsKept")}</li>
                    <li>{pt(locale, "accessDialog.subscriptionUnchanged")}</li>
                  </>
                )}
              </ul>
            </section>

            {phase.kind === "checking" && (
              <p className="platform-fine-print" role="status">
                {pt(locale, "accessDialog.checking")}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`access-ref-${orgId}`}>
                {pt(locale, "accessDialog.reference", { reference: isolate(reference) })}
              </Label>
              <Input
                id={`access-ref-${orgId}`}
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={pending || phase.kind === "checking"}
                aria-invalid={errors.reference ? true : undefined}
                aria-describedby={errors.reference ? `access-ref-error-${orgId}` : undefined}
              />
              {errors.reference && (
                <p id={`access-ref-error-${orgId}`} className="platform-field-error">
                  {errors.reference}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`access-reason-${orgId}`}>{pt(locale, "accessDialog.reason")}</Label>
              <Textarea
                id={`access-reason-${orgId}`}
                dir="auto"
                rows={3}
                maxLength={REASON_MAX + 100}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pending || phase.kind === "checking"}
                aria-invalid={errors.reason ? true : undefined}
                aria-describedby={`access-reason-hint-${orgId}${errors.reason ? ` access-reason-error-${orgId}` : ""}`}
              />
              <div className="platform-access-hint">
                <span id={`access-reason-hint-${orgId}`}>{pt(locale, "accessDialog.reasonHint", { min: REASON_MIN, max: REASON_MAX })}</span>
                <span className="platform-access-count" aria-hidden="true" data-over={reasonLength > REASON_MAX || undefined}>
                  {pt(locale, "accessDialog.reasonCount", { n: reasonLength, max: REASON_MAX })}
                </span>
              </div>
              {errors.reason && (
                <p id={`access-reason-error-${orgId}`} className="platform-field-error">
                  {errors.reason}
                </p>
              )}
            </div>

            <fieldset className="platform-access-stepup" disabled={pending || phase.kind === "checking"}>
              <legend className="platform-access-heading">{pt(locale, "accessDialog.stepUp")}</legend>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`access-password-${orgId}`}>{pt(locale, "login.password")}</Label>
                <Input
                  id={`access-password-${orgId}`}
                  type="password"
                  dir="ltr"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={errors.stepUp ? true : undefined}
                  aria-describedby={errors.stepUp ? `access-stepup-error-${orgId}` : undefined}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`access-totp-${orgId}`}>{pt(locale, "login.totpLabel")}</Label>
                <Input
                  id={`access-totp-${orgId}`}
                  dir="ltr"
                  className="platform-code-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  aria-invalid={errors.stepUp ? true : undefined}
                  aria-describedby={errors.stepUp ? `access-stepup-error-${orgId}` : undefined}
                />
              </div>
              {errors.stepUp && (
                <p id={`access-stepup-error-${orgId}`} className="platform-field-error">
                  {errors.stepUp}
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
              <Button type="submit" variant={suspending ? "destructive" : "primary"} loading={pending && phase.kind === "form"} disabled={phase.kind === "checking"}>
                {pending && phase.kind === "form" ? pt(locale, suspending ? "accessDialog.suspending" : "accessDialog.reactivating") : pt(locale, suspending ? "accessDialog.suspendSubmit" : "accessDialog.reactivateSubmit")}
              </Button>
            </div>
          </form>
        )}
      </PlatformDialog>
    </>
  );
}
