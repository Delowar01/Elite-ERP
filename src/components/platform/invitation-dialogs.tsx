"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Copy, Info, Link2, RefreshCw, Trash2, TriangleAlert, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { currencyCodeForCountry, currencySelectOptions } from "@/lib/currency/currencies";
import { COUNTRIES } from "@/lib/geo/countries";
import type { Locale } from "@/lib/i18n/dict";
import {
  createInvitationAction,
  previewInvitationAction,
  readInvitationAction,
  reissueInvitationAction,
  revokeInvitationAction,
  type InvitationActionFailure,
  type InvitationLinkView,
  type InvitationPreviewView,
} from "@/app/(platform)/invitation-actions";
import { pt } from "./i18n";
import { PlatformDialog } from "./platform-dialog";
import { isRedirect } from "./utils";

// ---------------------------------------------------------------------------------------------
// Company invitation administration (PO-02D2): create, re-issue and revoke, with the one-time link.
// Nothing here is trusted for authorization — the server actions re-check both flags, same-origin, the
// live platform session, platform.companies.invite and the step-up on every call. This file only:
//  • collects the fields and runs a read-only check first, so a request that must fail never spends a
//    second-factor code (offered Trial, an e-mail already invited or in use, the hourly limit, a
//    company-name collision that needs explicit confirmation);
//  • sends one request at a time; password and code are cleared after every attempt;
//  • shows the link ONCE, in a panel that only an explicit "Done" closes: the link lives in this
//    component's state only — never in the URL, storage, a cookie or a log — and is gone when the panel
//    closes or the page is left. There is no way to show it again (re-issue instead);
//  • states plainly that acceptance does not exist yet (PO-02D3), so no link is mistaken for a working one.
// ---------------------------------------------------------------------------------------------

/** Kept equal to INVITATION_LIMITS in src/lib/platform/invitations.ts. */
const LIMITS = { companyName: 200, industry: 100, ownerName: 200, email: 320, reasonMin: 10, reasonMax: 500 };
const EMAIL_SHAPE = /^[\x21-\x7e]+$/;
const EMAIL_PARTS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** First-strong isolate: a Latin name, e-mail or reference keeps its own direction inside an Arabic sentence. */
const isolate = (value: string) => `\u2068${value}\u2069`;
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const emailOk = (value: string) => {
  const e = value.trim().toLowerCase();
  return e.length > 0 && e.length <= LIMITS.email && EMAIL_SHAPE.test(e) && EMAIL_PARTS.test(e);
};

type Fields = { companyName: string; industry: string; companyEmail: string; country: string; currency: string; ownerName: string; ownerEmail: string };
const EMPTY: Fields = { companyName: "", industry: "", companyEmail: "", country: "", currency: "", ownerName: "", ownerEmail: "" };
type FieldKey = keyof Fields;

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

/** The step-up fields. Revoke asks for the code only (I-3); create and re-issue for password and code. */
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

/** The one-time link: shown once, copyable, with the plain statement that acceptance does not exist yet. */
function LinkPanel({ locale, result, title, onDone }: { locale: Locale; result: InvitationLinkView; title: string; onDone: () => void }) {
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
    <div className="platform-link-panel" data-invitation-link-panel>
      <p className="platform-callout" data-tone="neutral" role="status">
        <CircleCheck className="size-4 shrink-0" aria-hidden />
        <span>
          {title} <bdi dir="ltr">{result.reference}</bdi>
          {result.replacedReference && (
            <>
              {" · "}
              {pt(locale, "link.replaced", { reference: isolate(result.replacedReference) })}
            </>
          )}
        </span>
      </p>
      <p className="platform-callout" data-tone="warning">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <span>{pt(locale, "link.notActive")}</span>
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invitation-link">{pt(locale, "link.label")}</Label>
        <div className="platform-link-row">
          <Input id="invitation-link" ref={fieldRef} readOnly dir="ltr" className="platform-link-field" value={result.link} onFocus={(e) => e.currentTarget.select()} aria-describedby="invitation-link-once invitation-link-expiry" spellCheck={false} />
          <Button type="button" variant="secondary" onClick={copyLink}>
            <Copy aria-hidden />
            {pt(locale, "link.copy")}
          </Button>
        </div>
        <p id="invitation-link-once" className="platform-fine-print">
          {pt(locale, "link.onceWarning")}
        </p>
        <p id="invitation-link-expiry" className="platform-fine-print">
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

// ---- create ----------------------------------------------------------------------------------------

type CreatePhase = { kind: "form" } | { kind: "review"; preview: InvitationPreviewView } | { kind: "done"; result: InvitationLinkView } | { kind: "discard"; back: "form" | "review" };

export function CreateInvitationControl({ locale }: { locale: Locale }) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<CreatePhase>({ kind: "form" });
  const [prior, setPrior] = useState<InvitationPreviewView | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [confirmName, setConfirmName] = useState(false);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldKey | "stepUp" | "name", string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const { pending, run } = useOneRequest(locale, setFailure);
  const currencies = useMemo(() => currencySelectOptions(), []);
  const dirty = JSON.stringify(fields) !== JSON.stringify(EMPTY);

  function reset() {
    setFields(EMPTY);
    setCurrencyTouched(false);
    setConfirmName(false);
    setPassword("");
    setTotp("");
    setErrors({});
    setFailure(null);
    setPrior(null);
    setPhase({ kind: "form" });
  }

  function openDialog() {
    reset();
    setOpen(true);
  }

  function finish() {
    const done = phase.kind === "done";
    setOpen(false);
    reset();
    if (done) router.refresh();
  }

  function requestClose() {
    if (pending) return;
    if (phase.kind === "done") return; // only "Done" closes the one-time link
    if (phase.kind === "discard") {
      // Escape / close on the discard prompt keeps the edits (only "Discard" throws them away).
      setPhase(phase.back === "review" && prior ? { kind: "review", preview: prior } : { kind: "form" });
      return;
    }
    if (dirty) {
      setPhase({ kind: "discard", back: phase.kind === "review" ? "review" : "form" });
      return;
    }
    finish();
  }

  function set(key: FieldKey, value: string) {
    setFields((f) => {
      const next = { ...f, [key]: value };
      if (key === "country" && !currencyTouched) {
        const code = COUNTRIES.find((c) => c.name === value)?.code;
        const currency = currencyCodeForCountry(code);
        if (currency) next.currency = currency;
      }
      return next;
    });
    if (key === "currency") setCurrencyTouched(true);
  }

  function validate(): boolean {
    const next: typeof errors = {};
    const name = clean(fields.companyName);
    if (!name || name.length > LIMITS.companyName) next.companyName = pt(locale, "invite.err.companyName", { max: LIMITS.companyName });
    if (clean(fields.industry).length > LIMITS.industry) next.industry = pt(locale, "invite.err.industry", { max: LIMITS.industry });
    if (!emailOk(fields.companyEmail)) next.companyEmail = pt(locale, "invite.err.email");
    if (!fields.country) next.country = pt(locale, "invite.err.country");
    if (!fields.currency) next.currency = pt(locale, "invite.err.currency");
    const owner = clean(fields.ownerName);
    if (!owner || owner.length > LIMITS.ownerName) next.ownerName = pt(locale, "invite.err.ownerName", { max: LIMITS.ownerName });
    if (!emailOk(fields.ownerEmail)) next.ownerEmail = pt(locale, "invite.err.email");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function check(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !validate()) return;
    setFailure(null);
    run(async () => {
      const r = await previewInvitationAction(fields);
      if (!r.ok) {
        setFailure(r.message);
        return;
      }
      setPrior(r);
      setConfirmName(false);
      setPhase({ kind: "review", preview: r });
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || phase.kind !== "review") return;
    const code = totp.replace(/\s/g, "");
    const next: typeof errors = {};
    const named = phase.preview.nameMatches.organizations + phase.preview.nameMatches.invitations > 0;
    if (named && !confirmName) next.name = pt(locale, "invite.nameConfirmRequired");
    if (!password || !/^\d{6}$/.test(code)) next.stepUp = pt(locale, "login.totpHint");
    setErrors(next);
    setFailure(null);
    if (next.name || next.stepUp) return;
    run(async () => {
      const r = await createInvitationAction({ ...fields, confirmDuplicateName: confirmName, password, totpCode: code });
      setPassword("");
      setTotp("");
      if (r.ok) {
        setPhase({ kind: "done", result: r });
        return;
      }
      if (r.code === "CONFLICT" && r.nameMatches) {
        setPhase({ kind: "review", preview: { ...phase.preview, nameMatches: r.nameMatches } });
        setErrors({ name: pt(locale, "invite.nameConfirmRequired") });
        return;
      }
      if (r.code === "CONFLICT" && r.pendingReference) {
        setPhase({ kind: "review", preview: { ...phase.preview, pendingReference: r.pendingReference } });
        return;
      }
      if (r.code === "MFA_INVALID" || r.code === "INVALID_CREDENTIALS") setErrors({ stepUp: r.message });
      else setFailure(r.message);
    });
  }

  const busy = pending;
  const preview = phase.kind === "review" ? phase.preview : null;
  const blocked = preview ? !preview.trial || !!preview.pendingReference || preview.emailInUse || preview.rateLimited : false;
  const field = (key: FieldKey, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`invite-${key}`}>{label}</Label>
      <Input
        id={`invite-${key}`}
        value={fields[key]}
        onChange={(e) => set(key, e.target.value)}
        disabled={busy}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `invite-${key}-error` : undefined}
        {...props}
      />
      {errors[key] && (
        <p id={`invite-${key}-error`} className="platform-field-error">
          {errors[key]}
        </p>
      )}
    </div>
  );

  return (
    <>
      <Button type="button" ref={triggerRef} onClick={openDialog} aria-haspopup="dialog">
        <UserPlus aria-hidden />
        {pt(locale, "action.inviteCompany")}
      </Button>
      <PlatformDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
        title={phase.kind === "done" ? pt(locale, "link.title") : pt(locale, "invite.title")}
        description={phase.kind === "done" ? undefined : pt(locale, "invite.desc")}
        closeLabel={pt(locale, "common.close")}
        dismissible={!busy && phase.kind !== "done"}
        sheet
        returnFocus={triggerRef}
      >
        {phase.kind === "done" ? (
          <LinkPanel locale={locale} result={phase.result} title={pt(locale, "link.created")} onDone={finish} />
        ) : phase.kind === "discard" ? (
          <div>
            <p className="platform-callout" data-tone="warning" role="alert">
              <CircleAlert className="size-4 shrink-0" aria-hidden />
              <span>
                <strong>{pt(locale, "discard.title")}</strong> {pt(locale, "discard.text")}
              </span>
            </p>
            <div className="platform-dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setPhase(phase.back === "review" && prior ? { kind: "review", preview: prior } : { kind: "form" })}>
                {pt(locale, "discard.keep")}
              </Button>
              <Button type="button" variant="destructive" onClick={finish}>
                {pt(locale, "discard.confirm")}
              </Button>
            </div>
          </div>
        ) : phase.kind === "form" ? (
          <form onSubmit={check} className="platform-access-form" noValidate aria-busy={busy || undefined}>
            <div className="platform-invite-grid">
              {field("companyName", pt(locale, "invite.companyName"), { dir: "auto", maxLength: LIMITS.companyName + 50, autoComplete: "off" })}
              {field("industry", pt(locale, "invite.industry"), { dir: "auto", maxLength: LIMITS.industry + 50, autoComplete: "off" })}
              {field("companyEmail", pt(locale, "invite.companyEmail"), { dir: "ltr", type: "email", inputMode: "email", maxLength: LIMITS.email, autoComplete: "off", spellCheck: false })}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-country">{pt(locale, "invite.country")}</Label>
                <select id="invite-country" className="platform-select" value={fields.country} onChange={(e) => set("country", e.target.value)} disabled={busy} aria-invalid={errors.country ? true : undefined} aria-describedby={errors.country ? "invite-country-error" : undefined}>
                  <option value="">{pt(locale, "invite.choose")}</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {errors.country && (
                  <p id="invite-country-error" className="platform-field-error">
                    {errors.country}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-currency">{pt(locale, "invite.currency")}</Label>
                <select id="invite-currency" className="platform-select" dir="ltr" value={fields.currency} onChange={(e) => set("currency", e.target.value)} disabled={busy} aria-invalid={errors.currency ? true : undefined} aria-describedby={errors.currency ? "invite-currency-error" : undefined}>
                  <option value="">{pt(locale, "invite.choose")}</option>
                  {currencies.map((c) => (
                    <option key={c.value} value={c.value}>
                      {`${c.label} — ${c.sublabel}`}
                    </option>
                  ))}
                </select>
                {errors.currency && (
                  <p id="invite-currency-error" className="platform-field-error">
                    {errors.currency}
                  </p>
                )}
              </div>
              {field("ownerName", pt(locale, "invite.ownerName"), { dir: "auto", maxLength: LIMITS.ownerName + 50, autoComplete: "off" })}
              {field("ownerEmail", pt(locale, "invite.ownerEmail"), { dir: "ltr", type: "email", inputMode: "email", maxLength: LIMITS.email, autoComplete: "off", spellCheck: false })}
            </div>
            <p className="platform-fine-print">{pt(locale, "invite.deliveryNote")}</p>
            {failure && (
              <p className="platform-form-error" role="alert">
                {failure}
              </p>
            )}
            <div className="platform-dialog-actions">
              <Button type="button" variant="secondary" onClick={requestClose} disabled={busy}>
                {pt(locale, "common.cancel")}
              </Button>
              <Button type="submit" loading={busy}>
                {busy ? pt(locale, "invite.checking") : pt(locale, "invite.continue")}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={submit} className="platform-access-form" noValidate aria-busy={busy || undefined}>
            <section aria-labelledby="invite-summary" className="flex flex-col gap-2">
              <h3 id="invite-summary" className="platform-access-heading">
                {pt(locale, "invite.review")}
              </h3>
              <dl className="platform-terms">
                <div>
                  <dt>{pt(locale, "invite.companyName")}</dt>
                  <dd dir="auto">{clean(fields.companyName)}</dd>
                </div>
                <div>
                  <dt>{pt(locale, "invite.ownerEmail")}</dt>
                  <dd>
                    <bdi dir="ltr">{fields.ownerEmail.trim().toLowerCase()}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>{pt(locale, "invite.country")}</dt>
                  <dd>{fields.country}</dd>
                </div>
                <div>
                  <dt>{pt(locale, "invite.currency")}</dt>
                  <dd>
                    <bdi dir="ltr">{fields.currency}</bdi>
                  </dd>
                </div>
              </dl>
            </section>
            {preview?.trial ? <TermsSummary locale={locale} trial={preview.trial} /> : null}
            <PreviewNotices locale={locale} preview={preview!} />
            {preview && preview.nameMatches.organizations + preview.nameMatches.invitations > 0 && !blocked && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-start gap-2">
                  <Checkbox id="invite-name-confirm" checked={confirmName} onCheckedChange={(v) => setConfirmName(v === true)} disabled={busy} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? "invite-name-error" : undefined} />
                  <Label htmlFor="invite-name-confirm">{pt(locale, "invite.nameConfirm")}</Label>
                </div>
                {errors.name && (
                  <p id="invite-name-error" className="platform-field-error">
                    {errors.name}
                  </p>
                )}
              </div>
            )}
            {!blocked && <StepUp locale={locale} idBase="invite" withPassword password={password} setPassword={setPassword} totp={totp} setTotp={setTotp} error={errors.stepUp} disabled={busy} />}
            <p className="platform-fine-print">{pt(locale, "invite.expiryNote")}</p>
            {failure && (
              <p className="platform-form-error" role="alert">
                {failure}
              </p>
            )}
            <div className="platform-dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setPhase({ kind: "form" })} disabled={busy}>
                {pt(locale, "invite.back")}
              </Button>
              {!blocked && (
                <Button type="submit" loading={busy}>
                  {busy ? pt(locale, "invite.submitting") : pt(locale, "invite.submit")}
                </Button>
              )}
            </div>
          </form>
        )}
      </PlatformDialog>
    </>
  );
}

function TermsSummary({ locale, trial }: { locale: Locale; trial: NonNullable<InvitationPreviewView["trial"]> }) {
  return (
    <section aria-labelledby="invite-terms" className="flex flex-col gap-2">
      <h3 id="invite-terms" className="platform-access-heading">
        {pt(locale, "terms.title")}
      </h3>
      <dl className="platform-terms">
        <div>
          <dt>{pt(locale, "terms.package")}</dt>
          <dd>
            {pt(locale, "terms.packageTrial")} · {pt(locale, "terms.version", { n: trial.versionNumber })}
          </dd>
        </div>
        <div>
          <dt>{pt(locale, "terms.length")}</dt>
          <dd>{pt(locale, "terms.days", { n: trial.trialDays })}</dd>
        </div>
        <div>
          <dt>{pt(locale, "terms.users")}</dt>
          <dd>
            <bdi dir="ltr">{trial.includedSeats}</bdi>
          </dd>
        </div>
        <div>
          <dt>{pt(locale, "terms.storage")}</dt>
          <dd>{pt(locale, "terms.gb", { n: trial.storageGb })}</dd>
        </div>
        <div>
          <dt>{pt(locale, "terms.price")}</dt>
          <dd>
            <bdi dir="ltr">{trial.price}</bdi>
          </dd>
        </div>
        <div>
          <dt>{pt(locale, "terms.cycle")}</dt>
          <dd>{pt(locale, "terms.cycleTrial")}</dd>
        </div>
      </dl>
    </section>
  );
}

function PreviewNotices({ locale, preview }: { locale: Locale; preview: InvitationPreviewView }) {
  const notes: { tone: "warning" | "info"; text: string }[] = [];
  if (!preview.trial) notes.push({ tone: "warning", text: pt(locale, "invite.noTrial") });
  if (preview.rateLimited) notes.push({ tone: "warning", text: pt(locale, "invite.rateLimited", { n: 20 }) });
  if (preview.pendingReference) notes.push({ tone: "warning", text: pt(locale, "invite.pendingExists", { reference: isolate(preview.pendingReference) }) });
  if (preview.emailInUse) notes.push({ tone: "warning", text: pt(locale, "invite.emailInUse") });
  if (preview.expiredReference) notes.push({ tone: "info", text: pt(locale, "invite.expiredReplaced", { reference: isolate(preview.expiredReference) }) });
  const { organizations, invitations } = preview.nameMatches;
  if (organizations + invitations > 0) notes.push({ tone: "warning", text: pt(locale, "invite.nameWarning", { orgs: organizations, invites: invitations }) });
  if (!notes.length) return null;
  return (
    <div className="flex flex-col gap-2" role={notes.some((n) => n.tone === "warning") ? "alert" : undefined}>
      {notes.map((n) => (
        <p key={n.text} className="platform-callout" data-tone={n.tone}>
          {n.tone === "warning" ? <CircleAlert className="size-4 shrink-0" aria-hidden /> : <Info className="size-4 shrink-0" aria-hidden />}
          <span>{n.text}</span>
        </p>
      ))}
    </div>
  );
}

// ---- re-issue / revoke -------------------------------------------------------------------------------

export type InvitationTarget = { id: string; reference: string; companyName: string; ownerEmail: string; state: "pending" | "expired" | "revoked" | "accepted" };
type ChangePhase = { kind: "checking" } | { kind: "form" } | { kind: "changed" } | { kind: "blocked"; message: string } | { kind: "revoked" } | { kind: "reissued"; result: InvitationLinkView };

/**
 * The row / detail actions for one invitation — while it is pending or expired — Re-issue and Revoke (its
 * history is its detail page, linked from the company name). Opening a dialog reads the invitation's CURRENT
 * state first, so the operator never confirms a state the page only showed (a change since it loaded → "refresh").
 */
export function InvitationRowActions({ locale, target }: { locale: Locale; target: InvitationTarget }) {
  const router = useRouter();
  const reissueRef = useRef<HTMLButtonElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"reissue" | "revoke">("reissue");
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<ChangePhase>({ kind: "checking" });
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [errors, setErrors] = useState<{ reason?: string; stepUp?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const { pending, run } = useOneRequest(locale, setFailure);
  const actionable = target.state === "pending" || target.state === "expired";
  const reissue = mode === "reissue";
  const idBase = `${mode}-${target.id}`;

  function reset() {
    setReason("");
    setPassword("");
    setTotp("");
    setErrors({});
    setFailure(null);
  }

  function openDialog(next: "reissue" | "revoke") {
    reset();
    setMode(next);
    setPhase({ kind: "checking" });
    setOpen(true);
    run(async () => {
      const r = await readInvitationAction(target.id);
      if (!r.ok) setPhase({ kind: "blocked", message: r.message });
      else if (r.state !== target.state || (r.state !== "pending" && r.state !== "expired")) setPhase({ kind: "changed" });
      else setPhase({ kind: "form" });
    });
  }

  function finish(changed: boolean) {
    setOpen(false);
    reset();
    if (changed) router.refresh();
  }

  function requestClose() {
    if (pending) return;
    if (phase.kind === "reissued") return; // only "Done" closes the one-time link
    finish(phase.kind === "revoked" || phase.kind === "changed");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || phase.kind !== "form") return;
    const code = totp.replace(/\s/g, "");
    const next: typeof errors = {};
    const cleanReason = clean(reason);
    if (!reissue && (cleanReason.length < LIMITS.reasonMin || cleanReason.length > LIMITS.reasonMax)) next.reason = pt(locale, "accessDialog.reasonInvalid", { min: LIMITS.reasonMin, max: LIMITS.reasonMax });
    if ((reissue && !password) || !/^\d{6}$/.test(code)) next.stepUp = pt(locale, "login.totpHint");
    setErrors(next);
    setFailure(null);
    if (next.reason || next.stepUp) return;
    const refused = (r: InvitationActionFailure) => {
      if (r.code === "CONFLICT" || r.code === "INVITE_USED" || r.code === "NOT_FOUND") setPhase({ kind: "changed" });
      else if (r.code === "MFA_INVALID" || r.code === "INVALID_CREDENTIALS") setErrors({ stepUp: r.message });
      else setFailure(r.message);
    };
    run(async () => {
      if (reissue) {
        const r = await reissueInvitationAction({ invitationId: target.id, password, totpCode: code });
        setPassword("");
        setTotp("");
        if (r.ok) setPhase({ kind: "reissued", result: r });
        else refused(r);
        return;
      }
      const r = await revokeInvitationAction({ invitationId: target.id, reason: cleanReason, totpCode: code });
      setPassword("");
      setTotp("");
      if (r.ok) setPhase({ kind: "revoked" });
      else refused(r);
    });
  }

  const reasonLength = clean(reason).length;
  return (
    <div className="platform-invite-actions">
      {actionable && (
        <>
          <Button type="button" ref={reissueRef} size="sm" variant="secondary" onClick={() => openDialog("reissue")} aria-haspopup="dialog" aria-label={pt(locale, "reissue.actionFor", { reference: target.reference })}>
            <Link2 aria-hidden />
            {pt(locale, "reissue.action")}
          </Button>
          <Button type="button" ref={revokeRef} size="sm" variant="secondary" onClick={() => openDialog("revoke")} aria-haspopup="dialog" aria-label={pt(locale, "revoke.actionFor", { reference: target.reference })}>
            <Trash2 aria-hidden />
            {pt(locale, "revoke.action")}
          </Button>
          <PlatformDialog
            open={open}
            onOpenChange={(next) => {
              if (!next) requestClose();
            }}
            title={phase.kind === "reissued" ? pt(locale, "link.reissuedTitle") : pt(locale, reissue ? "reissue.title" : "revoke.title", { reference: isolate(target.reference) })}
            description={phase.kind === "reissued" ? undefined : pt(locale, reissue ? "reissue.text" : "revoke.text")}
            closeLabel={pt(locale, "common.close")}
            dismissible={!pending && phase.kind !== "reissued"}
            sheet
            returnFocus={reissue ? reissueRef : revokeRef}
          >
            {phase.kind === "reissued" ? (
              <LinkPanel locale={locale} result={phase.result} title={pt(locale, "link.reissued")} onDone={() => finish(true)} />
            ) : phase.kind === "revoked" ? (
              <div role="status">
                <p className="platform-callout" data-tone="neutral">
                  <CircleCheck className="size-4 shrink-0" aria-hidden />
                  <span>{pt(locale, "revoke.done", { reference: isolate(target.reference) })}</span>
                </p>
                <div className="platform-dialog-actions">
                  <Button type="button" onClick={() => finish(true)}>
                    {pt(locale, "accessDialog.done")}
                  </Button>
                </div>
              </div>
            ) : phase.kind === "changed" ? (
              <div>
                <p className="platform-callout" data-tone="neutral" role="alert">
                  <CircleAlert className="size-4 shrink-0" aria-hidden />
                  <span>{pt(locale, "inv.changed")}</span>
                </p>
                <div className="platform-dialog-actions">
                  <Button type="button" onClick={() => finish(true)}>
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
                  <Button type="button" variant="secondary" onClick={() => finish(false)}>
                    {pt(locale, "common.close")}
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="platform-access-form" noValidate aria-busy={pending || phase.kind === "checking" || undefined}>
                <dl className="platform-terms">
                  <div>
                    <dt>{pt(locale, "invite.companyName")}</dt>
                    <dd dir="auto">{target.companyName}</dd>
                  </div>
                  <div>
                    <dt>{pt(locale, "invite.ownerEmail")}</dt>
                    <dd>
                      <bdi dir="ltr">{target.ownerEmail}</bdi>
                    </dd>
                  </div>
                </dl>
                <section aria-labelledby={`${idBase}-effects`}>
                  <h3 id={`${idBase}-effects`} className="platform-access-heading">
                    {pt(locale, "accessDialog.effects")}
                  </h3>
                  <ul className="platform-access-effects">
                    {reissue ? (
                      <>
                        <li>{pt(locale, "reissue.effectOld")}</li>
                        <li>{pt(locale, "reissue.effectNew")}</li>
                        <li>{pt(locale, "reissue.effectTerms")}</li>
                        <li>{pt(locale, "invite.deliveryNote")}</li>
                      </>
                    ) : (
                      <>
                        <li>{pt(locale, "revoke.effectLink")}</li>
                        <li>{pt(locale, "revoke.effectSlot")}</li>
                        <li>{pt(locale, "revoke.effectAudit")}</li>
                      </>
                    )}
                  </ul>
                </section>
                {phase.kind === "checking" && (
                  <p className="platform-fine-print" role="status">
                    {pt(locale, "accessDialog.checking")}
                  </p>
                )}
                {!reissue && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`${idBase}-reason`}>{pt(locale, "revoke.reason")}</Label>
                    <Textarea
                      id={`${idBase}-reason`}
                      dir="auto"
                      rows={3}
                      maxLength={LIMITS.reasonMax + 100}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      disabled={pending || phase.kind === "checking"}
                      aria-invalid={errors.reason ? true : undefined}
                      aria-describedby={`${idBase}-reason-hint${errors.reason ? ` ${idBase}-reason-error` : ""}`}
                    />
                    <div className="platform-access-hint">
                      <span id={`${idBase}-reason-hint`}>{pt(locale, "accessDialog.reasonHint", { min: LIMITS.reasonMin, max: LIMITS.reasonMax })}</span>
                      <span className="platform-access-count" aria-hidden="true" data-over={reasonLength > LIMITS.reasonMax || undefined}>
                        {pt(locale, "accessDialog.reasonCount", { n: reasonLength, max: LIMITS.reasonMax })}
                      </span>
                    </div>
                    {errors.reason && (
                      <p id={`${idBase}-reason-error`} className="platform-field-error">
                        {errors.reason}
                      </p>
                    )}
                  </div>
                )}
                <StepUp locale={locale} idBase={idBase} withPassword={reissue} password={password} setPassword={setPassword} totp={totp} setTotp={setTotp} error={errors.stepUp} disabled={pending || phase.kind === "checking"} />
                {failure && (
                  <p className="platform-form-error" role="alert">
                    {failure}
                  </p>
                )}
                <div className="platform-dialog-actions">
                  <Button type="button" variant="secondary" onClick={requestClose} disabled={pending}>
                    {pt(locale, "common.cancel")}
                  </Button>
                  <Button type="submit" variant={reissue ? "primary" : "destructive"} loading={pending && phase.kind === "form"} disabled={phase.kind === "checking"}>
                    {pending && phase.kind === "form" ? pt(locale, reissue ? "reissue.submitting" : "revoke.submitting") : pt(locale, reissue ? "reissue.submit" : "revoke.submit")}
                  </Button>
                </div>
              </form>
            )}
          </PlatformDialog>
        </>
      )}
    </div>
  );
}
