"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Copy, Info, RefreshCw, Trash2, TriangleAlert, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/lib/i18n/dict";
import {
  createUserInvitationAction,
  previewUserInvitationAction,
  readUserInvitationAction,
  reissueUserInvitationAction,
  revokeUserInvitationAction,
  type UserInvitationLinkView,
  type UserInvitationPreviewView,
} from "@/app/(platform)/user-invitation-actions";
import { pt } from "./i18n";
import { PlatformDialog } from "./platform-dialog";
import { isRedirect } from "./utils";

// ---------------------------------------------------------------------------------------------
// Customer-user invitation administration (PO-03C, sub-batch C): invite a NEW user into an EXISTING company (admin or
// staff), revoke and re-issue, with the one-time link. Nothing here is trusted for authorization — the server actions
// re-check both flags, same-origin, the live platform session, platform.users.invite, the staged table and the step-up
// on every call. This file only:
//  • collects the fields and runs a read-only check first, so a request that must fail never spends a second-factor
//    code (an e-mail already invited or in use, a pending company invitation, a suspended company, the hourly limit) —
//    and shows the company's seats after the invitation (display only: nothing is refused because of seats);
//  • sends one request at a time; password and code are cleared after every attempt;
//  • shows the link ONCE, in a panel that only an explicit "Done" closes: the link lives in this component's state
//    only — never in the URL, storage, a cookie or a log — and is gone when the panel closes. Re-issue to get a new one;
//  • states plainly that the link can't be used yet (acceptance is the next phase) and that nothing is sent.
// ---------------------------------------------------------------------------------------------

/** Kept equal to USER_INVITATION_LIMITS in src/lib/platform/user-invitations.ts. */
const LIMITS = { name: 200, email: 320, reasonMin: 10, reasonMax: 500 };
const EMAIL_SHAPE = /^[\x21-\x7e]+$/;
const EMAIL_PARTS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
type Role = "admin" | "staff";

/** First-strong isolate: a Latin name, e-mail or reference keeps its own direction inside an Arabic sentence. */
const isolate = (value: string) => `⁨${value}⁩`;
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const emailOk = (value: string) => {
  const e = value.trim().toLowerCase();
  return e.length > 0 && e.length <= LIMITS.email && EMAIL_SHAPE.test(e) && EMAIL_PARTS.test(e);
};

function useOneRequest(locale: Locale, setFailure: (message: string | null) => void) {
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
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
  return { pending, run };
}

/** The step-up fields. Revoke asks for the code only; invite and re-issue for password and code. */
function StepUp({ locale, idBase, withPassword, password, setPassword, totp, setTotp, error, disabled }: { locale: Locale; idBase: string; withPassword: boolean; password: string; setPassword: (v: string) => void; totp: string; setTotp: (v: string) => void; error?: string; disabled: boolean }) {
  const errorId = `${idBase}-stepup-error`;
  return (
    <fieldset className="platform-access-stepup" disabled={disabled}>
      <legend className="platform-access-heading">{pt(locale, "accessDialog.stepUp")}</legend>
      {withPassword && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idBase}-password`}>{pt(locale, "login.password")}</Label>
          <Input id={`${idBase}-password`} type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idBase}-totp`}>{pt(locale, "login.totpLabel")}</Label>
        <Input id={`${idBase}-totp`} dir="ltr" className="platform-code-input" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={7} value={totp} onChange={(e) => setTotp(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} />
      </div>
      {error && (
        <p id={errorId} className="platform-field-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** The one-time link: shown once, copyable, with the plain statements that it can't be used yet and was not sent. */
function LinkPanel({ locale, result, title, onDone }: { locale: Locale; result: UserInvitationLinkView; title: string; onDone: () => void }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const fieldRef = useRef<HTMLInputElement>(null);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(result.link);
      setCopy("copied");
    } catch {
      setCopy("failed");
      fieldRef.current?.select();
    }
  }
  return (
    <div className="platform-link-panel" data-user-invitation-link-panel>
      <p className="platform-callout" data-tone="neutral" role="status">
        <CircleCheck className="size-4 shrink-0" aria-hidden />
        <span>
          {title} <bdi dir="ltr">{result.reference}</bdi>
          {result.replacedReference && (
            <>
              {" · "}
              {pt(locale, "uinv.replaced", { reference: isolate(result.replacedReference) })}
            </>
          )}
        </span>
      </p>
      <p className="platform-callout" data-tone={result.acceptanceOpen ? "info" : "warning"}>
        {result.acceptanceOpen ? <Info className="size-4 shrink-0" aria-hidden /> : <TriangleAlert className="size-4 shrink-0" aria-hidden />}
        <span>{pt(locale, result.acceptanceOpen ? "uinv.linkActive" : "uinv.notActive")}</span>
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-invitation-link">{pt(locale, "link.label")}</Label>
        <div className="platform-link-row">
          <Input id="user-invitation-link" ref={fieldRef} readOnly dir="ltr" className="platform-link-field" value={result.link} onFocus={(e) => e.currentTarget.select()} aria-describedby="user-invitation-link-once user-invitation-link-expiry" spellCheck={false} />
          <Button type="button" variant="secondary" onClick={copyLink}>
            <Copy aria-hidden />
            {pt(locale, "link.copy")}
          </Button>
        </div>
        <p id="user-invitation-link-once" className="platform-fine-print">
          {pt(locale, "uinv.onceWarning")}
        </p>
        <p className="platform-fine-print">{pt(locale, "uinv.notSent")}</p>
        <p id="user-invitation-link-expiry" className="platform-fine-print">
          {pt(locale, "link.expires", { date: result.expires })}
        </p>
        <p className="platform-fine-print" aria-live="polite">
          {copy === "copied" ? pt(locale, "link.copied") : copy === "failed" ? pt(locale, "link.copyFailed") : ""}
        </p>
      </div>
      <div className="platform-dialog-actions">
        <Button type="button" onClick={onDone}>
          {pt(locale, "link.done")}
        </Button>
      </div>
    </div>
  );
}

// ---- invite ----------------------------------------------------------------------------------------

type InvitePhase = { kind: "form" } | { kind: "review"; preview: UserInvitationPreviewView } | { kind: "done"; result: UserInvitationLinkView };
type InviteErrors = { name?: string; email?: string; role?: string; stepUp?: string };

/** Notices from the read-only check; returns whether the invitation can be created as entered. */
function previewBlocks(p: UserInvitationPreviewView): boolean {
  return p.company.access !== "active" || !!p.pendingReference || p.emailInUse || !!p.companyInvitationReference || p.rateLimited;
}

export function InviteUserControl({ locale, orgId, companyName }: { locale: Locale; orgId: number; companyName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<InvitePhase>({ kind: "form" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [errors, setErrors] = useState<InviteErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const { pending, run } = useOneRequest(locale, setFailure);
  const button = useRef<HTMLButtonElement>(null);
  const clearError = (key: keyof InviteErrors) => setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

  function openDialog() {
    setName("");
    setEmail("");
    setRole("");
    setPassword("");
    setTotp("");
    setErrors({});
    setFailure(null);
    setPhase({ kind: "form" });
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setPassword("");
    setTotp("");
    if (phase.kind === "done") router.refresh();
  }
  function fieldsOrErrors(): { orgId: string; name: string; email: string; role: Role } | null {
    const next: InviteErrors = {};
    const n = clean(name);
    if (!n || n.length > LIMITS.name) next.name = pt(locale, "uinv.nameInvalid", { max: LIMITS.name });
    if (!emailOk(email)) next.email = pt(locale, "uinv.emailInvalid");
    if (role !== "admin" && role !== "staff") next.role = pt(locale, "uinv.rolePick");
    setErrors(next);
    if (next.name || next.email || next.role || (role !== "admin" && role !== "staff")) return null;
    return { orgId: String(orgId), name: n, email: email.trim().toLowerCase(), role };
  }
  function check(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setFailure(null);
    const f = fieldsOrErrors();
    if (!f) return;
    run(async () => {
      const r = await previewUserInvitationAction(f);
      if (!r.ok) return setFailure(r.message);
      setPhase({ kind: "review", preview: r });
    });
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || phase.kind !== "review") return;
    const f = fieldsOrErrors();
    if (!f) return;
    const code = totp.replace(/\s/g, "");
    if (!password || !/^\d{6}$/.test(code)) {
      setErrors((x) => ({ ...x, stepUp: pt(locale, "uinv.stepUpRequired") }));
      return;
    }
    setFailure(null);
    run(async () => {
      const r = await createUserInvitationAction({ ...f, password, totpCode: code });
      setPassword("");
      setTotp("");
      if (r.ok) return setPhase({ kind: "done", result: r });
      if (r.code === "CONFLICT" || r.code === "EMAIL_CONFLICT" || r.code === "COMPANY_SUSPENDED" || r.code === "RATE_LIMITED") {
        const again = await previewUserInvitationAction(f);
        if (again.ok) setPhase({ kind: "review", preview: again });
      }
      setFailure(r.message);
    });
  }

  const busy = pending;
  const p = phase.kind === "review" ? phase.preview : null;

  return (
    <>
      <Button ref={button} type="button" onClick={openDialog} aria-haspopup="dialog" data-testid="invite-user-control">
        <UserPlus aria-hidden />
        {pt(locale, "uinv.invite")}
      </Button>
      <PlatformDialog
        open={open}
        onOpenChange={(value) => {
          if (!value && phase.kind !== "done") close();
        }}
        title={pt(locale, "uinv.inviteTitle", { company: isolate(companyName) })}
        description={pt(locale, "uinv.inviteText")}
        closeLabel={pt(locale, "common.close")}
        dismissible={!busy && phase.kind !== "done"}
        returnFocus={button}
        sheet
      >
        {phase.kind === "done" ? (
          <LinkPanel locale={locale} result={phase.result} title={pt(locale, "uinv.created")} onDone={close} />
        ) : (
          <form onSubmit={phase.kind === "review" ? submit : check} className="platform-access-form" noValidate aria-busy={busy || undefined}>
            <p className="platform-callout" data-tone="neutral">
              <Info className="size-4 shrink-0" aria-hidden />
              <span>{pt(locale, "uinv.copyOnly")}</span>
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="uinv-name">{pt(locale, "uinv.name")}</Label>
              <Input id="uinv-name" dir="auto" autoComplete="off" maxLength={LIMITS.name + 50} value={name} disabled={busy || phase.kind === "review"} onChange={(e) => (setName(e.target.value), clearError("name"))} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? "uinv-name-error" : undefined} />
              {errors.name && (
                <p id="uinv-name-error" className="platform-field-error">
                  {errors.name}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="uinv-email">{pt(locale, "uinv.email")}</Label>
              <Input id="uinv-email" type="email" dir="ltr" autoComplete="off" maxLength={LIMITS.email + 50} value={email} disabled={busy || phase.kind === "review"} onChange={(e) => (setEmail(e.target.value), clearError("email"))} aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? "uinv-email-error" : undefined} />
              {errors.email && (
                <p id="uinv-email-error" className="platform-field-error">
                  {errors.email}
                </p>
              )}
            </div>
            <fieldset className="platform-role-picker" disabled={busy || phase.kind === "review"}>
              <legend id="uinv-role-legend" className="platform-access-heading">
                {pt(locale, "uinv.role")}
              </legend>
              <RadioGroup name="platform-invite-role" value={role} onValueChange={(v) => (setRole(v === "admin" || v === "staff" ? v : ""), clearError("role"))} aria-labelledby="uinv-role-legend" aria-describedby={errors.role ? "uinv-role-error" : "uinv-role-note"} className="flex-col items-start gap-3" data-testid="invite-role-options">
                <RadioGroupItem value="admin">{pt(locale, "role.admin")}</RadioGroupItem>
                <RadioGroupItem value="staff">{pt(locale, "role.staff")}</RadioGroupItem>
              </RadioGroup>
              <p id="uinv-role-note" className="platform-fine-print">
                {pt(locale, "uinv.noOwner")}
              </p>
              {errors.role && (
                <p id="uinv-role-error" className="platform-field-error">
                  {errors.role}
                </p>
              )}
            </fieldset>

            {p && (
              <section aria-labelledby="uinv-review" data-testid="invite-review">
                <h3 id="uinv-review" className="platform-access-heading">
                  {pt(locale, "accessDialog.effects")}
                </h3>
                <ul className="platform-access-effects">
                  <li>{pt(locale, "uinv.effectLink", { company: isolate(p.company.name) })}</li>
                  <li>{pt(locale, "uinv.effectExpiry")}</li>
                  {p.seats && (
                    <li data-testid="invite-seats">
                      {p.seats.seats === null
                        ? pt(locale, "uinv.seatsNoAllowance", { now: p.seats.occupied, after: p.seats.after.occupied })
                        : pt(locale, "uinv.seatsAfter", { now: p.seats.occupied, after: p.seats.after.occupied, seats: p.seats.seats })}
                      {p.seats.after.overBy > 0 && ` ${pt(locale, "uinv.seatsOver", { n: p.seats.after.overBy })}`}
                    </li>
                  )}
                  <li>{pt(locale, "uinv.effectRecorded")}</li>
                </ul>
                {previewBlocks(p) && (
                  <ul className="platform-preview-notices" data-testid="invite-blocked">
                    {p.company.access !== "active" && <li className="platform-form-error">{pt(locale, "uinv.blockSuspended")}</li>}
                    {p.pendingReference && <li className="platform-form-error">{pt(locale, "uinv.blockPending", { reference: isolate(p.pendingReference) })}</li>}
                    {p.emailInUse && <li className="platform-form-error">{pt(locale, "uinv.blockEmailInUse")}</li>}
                    {p.companyInvitationReference && <li className="platform-form-error">{pt(locale, "uinv.blockCompanyInvitation", { reference: isolate(p.companyInvitationReference) })}</li>}
                    {p.rateLimited && <li className="platform-form-error">{pt(locale, "uinv.blockRate")}</li>}
                  </ul>
                )}
                {p.expiredReference && !previewBlocks(p) && (
                  <p className="platform-callout" data-tone="neutral">
                    <Info className="size-4 shrink-0" aria-hidden />
                    <span>{pt(locale, "uinv.expiredReplaced", { reference: isolate(p.expiredReference) })}</span>
                  </p>
                )}
              </section>
            )}

            {p && !previewBlocks(p) && (
              <StepUp locale={locale} idBase="uinv" withPassword password={password} setPassword={(v) => (setPassword(v), clearError("stepUp"))} totp={totp} setTotp={(v) => (setTotp(v), clearError("stepUp"))} error={errors.stepUp} disabled={busy} />
            )}

            {failure && (
              <p className="platform-form-error" role="alert">
                {failure}
              </p>
            )}

            <div className="platform-dialog-actions">
              {phase.kind === "review" ? (
                <Button type="button" variant="secondary" onClick={() => (setPhase({ kind: "form" }), setFailure(null), setPassword(""), setTotp(""))} disabled={busy}>
                  {pt(locale, "uinv.edit")}
                </Button>
              ) : (
                <Button type="button" variant="secondary" onClick={close} disabled={busy}>
                  {pt(locale, "common.cancel")}
                </Button>
              )}
              {phase.kind === "review" ? (
                <Button type="submit" loading={busy} disabled={!!p && previewBlocks(p)}>
                  {pt(locale, busy ? "uinv.creating" : "uinv.create")}
                </Button>
              ) : (
                <Button type="submit" loading={busy}>
                  {pt(locale, "uinv.check")}
                </Button>
              )}
            </div>
          </form>
        )}
      </PlatformDialog>
    </>
  );
}

// ---- revoke and re-issue -----------------------------------------------------------------------------------

export type UserInvitationTarget = { id: string; reference: string; email: string; state: "pending" | "expired" | "revoked" | "accepted" };
type RowPhase = { kind: "checking" } | { kind: "form" } | { kind: "changed" } | { kind: "blocked"; message: string } | { kind: "revoked" } | { kind: "reissued"; result: UserInvitationLinkView };

/** Revoke (pending or expired) and Re-issue (pending, expired or revoked) for one invitation; nothing for an accepted one. */
export function UserInvitationRowActions({ locale, target }: { locale: Locale; target: UserInvitationTarget }) {
  const router = useRouter();
  const [mode, setMode] = useState<"revoke" | "reissue">("revoke");
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<RowPhase>({ kind: "checking" });
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [errors, setErrors] = useState<{ reason?: string; stepUp?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const { pending, run } = useOneRequest(locale, setFailure);
  const revokeButton = useRef<HTMLButtonElement>(null);
  const reissueButton = useRef<HTMLButtonElement>(null);
  const canRevoke = target.state === "pending" || target.state === "expired";
  const canReissue = target.state !== "accepted";

  function openDialog(next: "revoke" | "reissue") {
    setMode(next);
    setReason("");
    setPassword("");
    setTotp("");
    setErrors({});
    setFailure(null);
    setPhase({ kind: "checking" });
    setOpen(true);
    run(async () => {
      const r = await readUserInvitationAction(target.id);
      if (!r.ok) return setPhase({ kind: "blocked", message: r.message });
      if (r.state !== target.state) return setPhase({ kind: "changed" });
      setPhase({ kind: "form" });
    });
  }
  function close() {
    setOpen(false);
    setPassword("");
    setTotp("");
    if (phase.kind === "revoked" || phase.kind === "reissued" || phase.kind === "changed") router.refresh();
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || phase.kind !== "form") return;
    const code = totp.replace(/\s/g, "");
    const next: { reason?: string; stepUp?: string } = {};
    const cleanReason = clean(reason);
    if (mode === "revoke" && (cleanReason.length < LIMITS.reasonMin || cleanReason.length > LIMITS.reasonMax)) next.reason = pt(locale, "accessDialog.reasonInvalid", { min: LIMITS.reasonMin, max: LIMITS.reasonMax });
    if (!/^\d{6}$/.test(code) || (mode === "reissue" && !password)) next.stepUp = pt(locale, mode === "reissue" ? "uinv.stepUpRequired" : "login.totpHint");
    setErrors(next);
    setFailure(null);
    if (next.reason || next.stepUp) return;
    run(async () => {
      if (mode === "revoke") {
        const r = await revokeUserInvitationAction({ invitationId: target.id, reason: cleanReason, totpCode: code });
        setTotp("");
        if (r.ok) return setPhase({ kind: "revoked" });
        if (r.code === "CONFLICT" || r.code === "INVITE_USED") return setPhase({ kind: "changed" });
        setFailure(r.message);
      } else {
        const r = await reissueUserInvitationAction({ invitationId: target.id, password, totpCode: code });
        setPassword("");
        setTotp("");
        if (r.ok) return setPhase({ kind: "reissued", result: r });
        if (r.code === "INVITE_USED") return setPhase({ kind: "changed" });
        setFailure(r.message);
      }
    });
  }

  if (!canRevoke && !canReissue) return null;
  const title = pt(locale, mode === "revoke" ? "uinv.revokeTitle" : "uinv.reissueTitle", { reference: isolate(target.reference) });
  return (
    <>
      <div className="platform-user-controls" data-testid={`uinv-actions-${target.id}`}>
        {canReissue && (
          <Button ref={reissueButton} type="button" variant="secondary" onClick={() => openDialog("reissue")} aria-haspopup="dialog" data-testid="uinv-reissue">
            <RefreshCw aria-hidden />
            {pt(locale, "uinv.reissue")}
          </Button>
        )}
        {canRevoke && (
          <Button ref={revokeButton} type="button" variant="secondary" onClick={() => openDialog("revoke")} aria-haspopup="dialog" data-testid="uinv-revoke">
            <Trash2 aria-hidden />
            {pt(locale, "uinv.revoke")}
          </Button>
        )}
      </div>
      <PlatformDialog
        open={open}
        onOpenChange={(value) => {
          if (!value && phase.kind !== "reissued") close();
        }}
        title={title}
        description={pt(locale, mode === "revoke" ? "uinv.revokeText" : "uinv.reissueText", { email: isolate(target.email) })}
        closeLabel={pt(locale, "common.close")}
        dismissible={!pending && phase.kind !== "reissued"}
        returnFocus={mode === "revoke" ? revokeButton : reissueButton}
        sheet
      >
        {phase.kind === "reissued" ? (
          <LinkPanel locale={locale} result={phase.result} title={pt(locale, "uinv.reissued")} onDone={close} />
        ) : phase.kind === "revoked" ? (
          <div className="platform-access-result" role="status">
            <p className="platform-callout" data-tone="neutral">
              <CircleCheck className="size-4 shrink-0" aria-hidden />
              <span>{pt(locale, "uinv.revokedDone", { reference: isolate(target.reference) })}</span>
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
              <span>{pt(locale, "uinv.changed")}</span>
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
            <ul className="platform-access-effects">
              {mode === "revoke" ? (
                <>
                  <li>{pt(locale, "uinv.revokeEffect")}</li>
                  <li>{pt(locale, "uinv.revokeSeat")}</li>
                </>
              ) : (
                <>
                  <li>{pt(locale, "uinv.reissueEffect")}</li>
                  <li>{pt(locale, "uinv.effectExpiry")}</li>
                </>
              )}
              <li>{pt(locale, "uinv.effectRecorded")}</li>
            </ul>
            {phase.kind === "checking" && (
              <p className="platform-fine-print" role="status">
                {pt(locale, "uinv.checking")}
              </p>
            )}
            {mode === "revoke" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`uinv-reason-${target.id}`}>{pt(locale, "accessDialog.reason")}</Label>
                <Textarea id={`uinv-reason-${target.id}`} dir="auto" rows={3} maxLength={LIMITS.reasonMax + 100} value={reason} disabled={pending || phase.kind === "checking"} onChange={(e) => (setReason(e.target.value), setErrors((x) => (x.reason ? { ...x, reason: undefined } : x)))} aria-invalid={errors.reason ? true : undefined} aria-describedby={errors.reason ? `uinv-reason-error-${target.id}` : `uinv-reason-hint-${target.id}`} />
                <p id={`uinv-reason-hint-${target.id}`} className="platform-fine-print">
                  {pt(locale, "accessDialog.reasonHint", { min: LIMITS.reasonMin, max: LIMITS.reasonMax })}
                </p>
                {errors.reason && (
                  <p id={`uinv-reason-error-${target.id}`} className="platform-field-error">
                    {errors.reason}
                  </p>
                )}
              </div>
            )}
            <StepUp
              locale={locale}
              idBase={`uinv-${mode}-${target.id}`}
              withPassword={mode === "reissue"}
              password={password}
              setPassword={(v) => (setPassword(v), setErrors((x) => (x.stepUp ? { ...x, stepUp: undefined } : x)))}
              totp={totp}
              setTotp={(v) => (setTotp(v), setErrors((x) => (x.stepUp ? { ...x, stepUp: undefined } : x)))}
              error={errors.stepUp}
              disabled={pending || phase.kind === "checking"}
            />
            {failure && (
              <p className="platform-form-error" role="alert">
                {failure}
              </p>
            )}
            <div className="platform-dialog-actions">
              <Button type="button" variant="secondary" onClick={close} disabled={pending}>
                {pt(locale, "common.cancel")}
              </Button>
              <Button type="submit" variant={mode === "revoke" ? "destructive" : "primary"} loading={pending && phase.kind === "form"} disabled={phase.kind === "checking"}>
                {pt(locale, mode === "revoke" ? "uinv.revoke" : "uinv.reissue")}
              </Button>
            </div>
          </form>
        )}
      </PlatformDialog>
    </>
  );
}
