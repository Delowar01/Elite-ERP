"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/lib/i18n/dict";
import { readPrimaryOwnerTransferOptionsAction, transferPrimaryOwnerAction, type TransferCandidateView, type TransferOptionsView } from "@/app/(platform)/customer-user-role-actions";
import { pt } from "./i18n";
import { PlatformDialog } from "./platform-dialog";
import { isRedirect } from "./utils";

// ---------------------------------------------------------------------------------------------
// Transfer a company's primary ownership to another ACTIVE user of the SAME company (PO-03C). Nothing here is trusted
// for authorization: the server action re-checks flag → origin → live platform session → platform.users.manage_roles
// and a fresh TOTP code; the transfer core locks the company, both accounts and the mapping, re-checks every condition
// and applies the roles, the mapping, both accounts' session ends, their security evidence and the platform audit in
// one transaction. This component shows the current and the new primary owner and exactly what changes before any code
// is asked for:
//  • opening the dialog reads the company's CURRENT owners; a page that showed another primary owner ("changed since
//    this page loaded") offers a refresh, and both accounts' versions travel with the transfer;
//  • a company with no designated primary owner (a legacy company) is never transferred: nothing is inferred;
//  • one request at a time; the code is cleared after every attempt; on success the page is refreshed.
// ---------------------------------------------------------------------------------------------

/** Kept equal to USER_REASON_MIN / USER_REASON_MAX in src/lib/platform/customer-user-actions.ts (rule 47). */
const REASON_MIN = 10;
const REASON_MAX = 500;

type Designation = TransferOptionsView["designation"];
type Phase =
  | { kind: "checking" }
  | { kind: "form"; owner: TransferCandidateView; candidates: TransferCandidateView[]; truncated: boolean }
  | { kind: "changed" }
  | { kind: "blocked"; message: string }
  | { kind: "done"; message: string };
type FieldErrors = { target?: string; reason?: string; code?: string };

const ROLE_KEY = { owner: "role.owner", admin: "role.admin", staff: "role.staff" } as const;
const roleName = (locale: Locale, role: string) => (role === "owner" || role === "admin" || role === "staff" ? pt(locale, ROLE_KEY[role]) : role);
const normalizeReason = (value: string) => value.replace(/\s+/g, " ").trim();
/** First-strong isolate: a Latin name keeps its own direction inside an Arabic sentence. */
const isolate = (value: string) => `⁨${value}⁩`;

/** Why this company's primary ownership can't be transferred, or null (the server refuses the same cases). */
export function transferBlock(locale: Locale, designation: Designation): string | null {
  if (designation === "designated") return null;
  return pt(locale, designation === "not_designated" ? "transfer.notDesignated" : designation === "not_installed" ? "transfer.notInstalled" : "transfer.unavailable");
}

export function PrimaryOwnerTransfer({
  locale,
  orgId,
  companyName,
  designation,
  primaryEmail,
  noteId,
}: {
  locale: Locale;
  orgId: number;
  companyName: string;
  designation: Designation;
  /** The primary owner's e-mail as this page showed it (null when none is designated) — a page older than the dialog's read is stale. */
  primaryEmail: string | null;
  noteId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const button = useRef<HTMLButtonElement>(null);

  const blockedHere = transferBlock(locale, designation);
  /** A field's error goes as soon as that field changes (the others stay until the next attempt). */
  const clearError = (key: keyof FieldErrors) => setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

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

  function openDialog() {
    setToUserId("");
    setReason("");
    setCode("");
    setErrors({});
    setFailure(null);
    setPhase({ kind: "checking" });
    setOpen(true);
    run(async () => {
      const r = await readPrimaryOwnerTransferOptionsAction(String(orgId));
      if (!r.ok) return setPhase({ kind: "blocked", message: r.message });
      const o = r.options;
      const refusal = transferBlock(locale, o.designation);
      if (refusal) return setPhase({ kind: "blocked", message: refusal });
      if (!o.primaryOwner) return setPhase({ kind: "blocked", message: pt(locale, "transfer.unavailable") });
      if (o.primaryOwner.email !== primaryEmail) return setPhase({ kind: "changed" });
      if (o.candidates.length === 0) return setPhase({ kind: "blocked", message: pt(locale, "transfer.noCandidates") });
      setPhase({ kind: "form", owner: o.primaryOwner, candidates: o.candidates, truncated: o.truncated });
    });
  }

  function close() {
    setOpen(false);
    if (phase.kind === "done" || phase.kind === "changed") router.refresh();
  }

  const chosen = phase.kind === "form" ? (phase.candidates.find((c) => String(c.userId) === toUserId) ?? null) : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || phase.kind !== "form") return;
    const totpCode = code.replace(/\s/g, "");
    const cleanReason = normalizeReason(reason);
    const fieldErrors: FieldErrors = {};
    if (!chosen) fieldErrors.target = pt(locale, "transfer.chooseError");
    if (cleanReason.length < REASON_MIN || cleanReason.length > REASON_MAX) fieldErrors.reason = pt(locale, "accessDialog.reasonInvalid", { min: REASON_MIN, max: REASON_MAX });
    if (!/^\d{6}$/.test(totpCode)) fieldErrors.code = pt(locale, "login.totpHint");
    setErrors(fieldErrors);
    setFailure(null);
    if (fieldErrors.target || fieldErrors.reason || fieldErrors.code || !chosen) return;
    const from = phase.owner;
    const to = chosen;
    run(async () => {
      const r = await transferPrimaryOwnerAction({
        orgId: String(orgId),
        fromUserId: String(from.userId),
        toUserId: String(to.userId),
        fromVersion: from.version,
        toVersion: to.version,
        reason: cleanReason,
        totpCode,
      });
      setCode("");
      if (r.ok) setPhase({ kind: "done", message: pt(locale, "transfer.done", { name: isolate(to.name), n: r.sessionsEnded }) });
      else if (r.code === "VERSION_CONFLICT" || r.code === "CONFLICT" || r.code === "NOT_FOUND") setPhase({ kind: "changed" });
      else if (r.code === "OWNER_NOT_DESIGNATED") setPhase({ kind: "blocked", message: pt(locale, "transfer.notDesignated") });
      else setFailure(r.message);
    });
  }

  const reasonLength = normalizeReason(reason).length;
  const busy = pending || phase.kind === "checking";
  const label = pt(locale, "transfer.action");

  return (
    <>
      {blockedHere ? (
        <Button type="button" variant="secondary" disabled aria-disabled="true" title={blockedHere} aria-label={`${label} — ${blockedHere}`} aria-describedby={noteId} data-testid="company-transfer-control">
          <ArrowRightLeft aria-hidden />
          {label}
        </Button>
      ) : (
        <Button ref={button} type="button" variant="secondary" onClick={openDialog} aria-haspopup="dialog" data-testid="company-transfer-control">
          <ArrowRightLeft aria-hidden />
          {label}
        </Button>
      )}

      <PlatformDialog
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
        title={pt(locale, "transfer.title", { company: isolate(companyName) })}
        description={pt(locale, "transfer.text")}
        closeLabel={pt(locale, "common.close")}
        dismissible={!pending}
        returnFocus={button}
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
              <span>{pt(locale, "transfer.changed")}</span>
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
          <form onSubmit={submit} className="platform-access-form" noValidate aria-busy={busy || undefined}>
            {phase.kind === "checking" ? (
              <p className="platform-fine-print" role="status">
                {pt(locale, "transfer.checking")}
              </p>
            ) : (
              <>
                <section aria-labelledby={`transfer-current-${orgId}`} data-testid="transfer-current-owner">
                  <h3 id={`transfer-current-${orgId}`} className="platform-access-heading">
                    {pt(locale, "transfer.current")}
                  </h3>
                  <p className="platform-transfer-person">
                    <span className="platform-owner-name" dir="auto">
                      {phase.owner.name}
                    </span>
                    <span className="platform-cell-sub">
                      <bdi dir="ltr">{phase.owner.email}</bdi> · {roleName(locale, phase.owner.role)}
                    </span>
                  </p>
                </section>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`transfer-target-${orgId}`}>{pt(locale, "transfer.new")}</Label>
                  <select
                    id={`transfer-target-${orgId}`}
                    className="platform-select"
                    value={toUserId}
                    onChange={(e) => {
                      setToUserId(e.target.value);
                      clearError("target");
                    }}
                    disabled={busy}
                    aria-invalid={errors.target ? true : undefined}
                    aria-describedby={errors.target ? `transfer-target-error-${orgId}` : undefined}
                    data-testid="transfer-target"
                  >
                    <option value="">{pt(locale, "transfer.choose")}</option>
                    {phase.candidates.map((c) => (
                      <option key={c.userId} value={String(c.userId)}>
                        {`${isolate(c.name)} · ${isolate(c.email)} · ${roleName(locale, c.role)}`}
                      </option>
                    ))}
                  </select>
                  {phase.truncated && <p className="platform-fine-print">{pt(locale, "transfer.truncated", { n: phase.candidates.length })}</p>}
                  {errors.target && (
                    <p id={`transfer-target-error-${orgId}`} className="platform-field-error">
                      {errors.target}
                    </p>
                  )}
                </div>

                <section aria-labelledby={`transfer-effects-${orgId}`}>
                  <h3 id={`transfer-effects-${orgId}`} className="platform-access-heading">
                    {pt(locale, "accessDialog.effects")}
                  </h3>
                  <ul className="platform-access-effects" aria-live="polite" data-testid="transfer-effects">
                    {chosen ? (
                      <>
                        <li>{pt(locale, "transfer.newOwner", { name: isolate(chosen.name) })}</li>
                        <li>{pt(locale, "transfer.oldAdmin", { name: isolate(phase.owner.name) })}</li>
                      </>
                    ) : (
                      <li>{pt(locale, "transfer.pickFirst")}</li>
                    )}
                    <li>{pt(locale, "transfer.bothSignIn")}</li>
                    <li>{pt(locale, "transfer.othersUnchanged")}</li>
                    <li>{pt(locale, "transfer.recorded")}</li>
                  </ul>
                </section>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`transfer-reason-${orgId}`}>{pt(locale, "accessDialog.reason")}</Label>
              <Textarea
                id={`transfer-reason-${orgId}`}
                dir="auto"
                rows={3}
                maxLength={REASON_MAX + 100}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  clearError("reason");
                }}
                disabled={busy}
                aria-invalid={errors.reason ? true : undefined}
                aria-describedby={`transfer-reason-hint-${orgId}${errors.reason ? ` transfer-reason-error-${orgId}` : ""}`}
              />
              <div className="platform-access-hint">
                <span id={`transfer-reason-hint-${orgId}`}>{pt(locale, "accessDialog.reasonHint", { min: REASON_MIN, max: REASON_MAX })}</span>
                <span className="platform-access-count" aria-hidden="true" data-over={reasonLength > REASON_MAX || undefined}>
                  {pt(locale, "accessDialog.reasonCount", { n: reasonLength, max: REASON_MAX })}
                </span>
              </div>
              {errors.reason && (
                <p id={`transfer-reason-error-${orgId}`} className="platform-field-error">
                  {errors.reason}
                </p>
              )}
            </div>

            <fieldset className="platform-access-stepup" disabled={busy}>
              <legend className="platform-access-heading">{pt(locale, "accessDialog.stepUp")}</legend>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`transfer-totp-${orgId}`}>{pt(locale, "login.totpLabel")}</Label>
                <Input
                  id={`transfer-totp-${orgId}`}
                  dir="ltr"
                  className="platform-code-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    clearError("code");
                  }}
                  aria-invalid={errors.code ? true : undefined}
                  aria-describedby={errors.code ? `transfer-totp-error-${orgId}` : undefined}
                />
              </div>
              {errors.code && (
                <p id={`transfer-totp-error-${orgId}`} className="platform-field-error">
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
              <Button type="submit" variant="primary" loading={pending && phase.kind === "form"} disabled={phase.kind === "checking"}>
                {pt(locale, pending && phase.kind === "form" ? "transfer.submitting" : "transfer.submit")}
              </Button>
            </div>
          </form>
        )}
      </PlatformDialog>
    </>
  );
}
