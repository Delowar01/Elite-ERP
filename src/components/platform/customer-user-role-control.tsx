"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, RefreshCw, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/lib/i18n/dict";
import { changeCustomerUserRoleAction, readCustomerUserRoleStateAction } from "@/app/(platform)/customer-user-role-actions";
import { pt } from "./i18n";
import { PlatformDialog } from "./platform-dialog";
import { isRedirect } from "./utils";

// ---------------------------------------------------------------------------------------------
// Change one customer user's role (PO-03C): owner, admin or staff — the ERP's three roles, never a custom one. Nothing
// here is trusted for authorization: the server action re-checks flag → origin → live platform session →
// platform.users.manage_roles and a fresh TOTP code, and the shared customer-user service applies the lock order, the
// owner rules (the primary owner keeps the owner role; the last active owner is never demoted), the session end and the
// audit in one transaction. This component explains the consequences, collects the role, the reason and the code, and
// reports every outcome:
//  • opening the dialog reads the account's CURRENT role state first; a page older than it ("changed since this page
//    loaded") offers a refresh, and the company and version it confirmed against travel with the change;
//  • a change the owner rules refuse is refused before any code is asked for (the server refuses it anyway);
//  • one request at a time; the code is cleared after every attempt; on success the page is refreshed.
// ---------------------------------------------------------------------------------------------

/** Kept equal to USER_REASON_MIN / USER_REASON_MAX in src/lib/platform/customer-user-actions.ts (rule 47). */
const REASON_MIN = 10;
const REASON_MAX = 500;

type Role = "owner" | "admin" | "staff";
const ROLES: readonly Role[] = ["owner", "admin", "staff"];
const ROLE_KEY = { owner: "role.owner", admin: "role.admin", staff: "role.staff" } as const;
type PrimaryFlag = "yes" | "no" | "not_installed" | "unavailable";
type Phase = { kind: "checking" } | { kind: "form" } | { kind: "changed" } | { kind: "blocked"; message: string } | { kind: "done"; message: string };
type FieldErrors = { role?: string; reason?: string; code?: string };

const normalizeReason = (value: string) => value.replace(/\s+/g, " ").trim();
/** First-strong isolate: a Latin name keeps its own direction inside an Arabic sentence. */
const isolate = (value: string) => `⁨${value}⁩`;
const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);
const roleName = (locale: Locale, role: string) => (isRole(role) ? pt(locale, ROLE_KEY[role]) : role);

/** Why no role change is possible for this account right now, or null (the server applies the same rules). */
export function roleChangeBlock(locale: Locale, s: { role: string; isActive: boolean; primaryOwner: PrimaryFlag; lastActiveOwner: boolean }): string | null {
  if (s.primaryOwner === "unavailable") return pt(locale, "cu.roleProtectionUnknown");
  if (s.role !== "owner") return null;
  if (s.primaryOwner === "yes") return pt(locale, "cu.roleProtectedPrimary");
  if (s.isActive && s.lastActiveOwner) return pt(locale, "cu.roleProtectedLast");
  return null;
}

export function CustomerUserRoleControl({
  locale,
  userId,
  orgId,
  name,
  role,
  isActive,
  version,
  protection,
  noteId,
}: {
  locale: Locale;
  userId: number;
  orgId: number;
  name: string;
  role: string;
  isActive: boolean;
  version: string;
  protection: { primaryOwner: PrimaryFlag; lastActiveOwner: boolean };
  noteId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [next, setNext] = useState<Role | "">("");
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const button = useRef<HTMLButtonElement>(null);

  const blockedHere = roleChangeBlock(locale, { role, isActive, ...protection });
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
    setNext("");
    setReason("");
    setCode("");
    setErrors({});
    setFailure(null);
    setPhase({ kind: "checking" });
    setOpen(true);
    run(async () => {
      const r = await readCustomerUserRoleStateAction(String(userId));
      if (!r.ok) return setPhase({ kind: "blocked", message: r.message });
      const s = r.state;
      if (s.version !== version || s.role !== role || s.orgId !== orgId || s.isActive !== isActive) return setPhase({ kind: "changed" });
      const refusal = roleChangeBlock(locale, s);
      if (refusal) return setPhase({ kind: "blocked", message: refusal });
      setPhase({ kind: "form" });
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
    const fieldErrors: FieldErrors = {};
    if (next === "" || next === role) fieldErrors.role = pt(locale, "roleDialog.pick");
    if (cleanReason.length < REASON_MIN || cleanReason.length > REASON_MAX) fieldErrors.reason = pt(locale, "accessDialog.reasonInvalid", { min: REASON_MIN, max: REASON_MAX });
    if (!/^\d{6}$/.test(totpCode)) fieldErrors.code = pt(locale, "login.totpHint");
    setErrors(fieldErrors);
    setFailure(null);
    if (fieldErrors.role || fieldErrors.reason || fieldErrors.code || next === "") return;
    const target = next;
    run(async () => {
      const r = await changeCustomerUserRoleAction({ userId: String(userId), orgId: String(orgId), role: target, reason: cleanReason, totpCode, version });
      setCode("");
      if (r.ok) setPhase({ kind: "done", message: pt(locale, "roleDialog.done", { role: roleName(locale, r.role), n: r.sessionsEnded }) });
      else if (r.code === "CONFLICT" || r.code === "VERSION_CONFLICT" || r.code === "NOT_FOUND") setPhase({ kind: "changed" });
      else if (r.code === "LAST_PRIMARY_OWNER") setPhase({ kind: "blocked", message: pt(locale, "cu.roleProtectedPrimary") });
      else if (r.code === "LAST_ACTIVE_OWNER") setPhase({ kind: "blocked", message: pt(locale, "cu.roleProtectedLast") });
      else setFailure(r.message);
    });
  }

  const reasonLength = normalizeReason(reason).length;
  const busy = pending || phase.kind === "checking";
  const label = pt(locale, "cu.changeRole");

  return (
    <>
      {blockedHere ? (
        <Button type="button" variant="secondary" disabled aria-disabled="true" title={blockedHere} aria-label={`${label} — ${blockedHere}`} aria-describedby={noteId} data-testid="user-role-control">
          <UserCog aria-hidden />
          {label}
        </Button>
      ) : (
        <Button ref={button} type="button" variant="secondary" onClick={openDialog} aria-haspopup="dialog" data-testid="user-role-control">
          <UserCog aria-hidden />
          {label}
        </Button>
      )}

      <PlatformDialog
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
        title={pt(locale, "roleDialog.title", { name: isolate(name) })}
        description={pt(locale, "roleDialog.text")}
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
          <form onSubmit={submit} className="platform-access-form" noValidate aria-busy={busy || undefined}>
            <fieldset className="platform-role-picker" disabled={busy}>
              <legend id={`role-legend-${userId}`} className="platform-access-heading">
                {pt(locale, "roleDialog.newRole")}
              </legend>
              <RadioGroup
                name={`platform-role-${userId}`}
                value={next}
                onValueChange={(value) => {
                  setNext(isRole(value) ? value : "");
                  clearError("role");
                }}
                disabled={busy}
                aria-labelledby={`role-legend-${userId}`}
                aria-describedby={errors.role ? `role-error-${userId}` : undefined}
                aria-invalid={errors.role ? true : undefined}
                className="flex-col items-start gap-3"
                data-testid="user-role-options"
              >
                {ROLES.map((r) => (
                  <RadioGroupItem key={r} value={r} disabled={r === role}>
                    {r === role ? pt(locale, "roleDialog.current", { role: roleName(locale, r) }) : roleName(locale, r)}
                  </RadioGroupItem>
                ))}
              </RadioGroup>
              {errors.role && (
                <p id={`role-error-${userId}`} className="platform-field-error">
                  {errors.role}
                </p>
              )}
            </fieldset>

            <section aria-labelledby={`role-effects-${userId}`}>
              <h3 id={`role-effects-${userId}`} className="platform-access-heading">
                {pt(locale, "accessDialog.effects")}
              </h3>
              <ul className="platform-access-effects" aria-live="polite">
                {next !== "" && next !== role ? (
                  <li>{pt(locale, "roleDialog.changes", { from: roleName(locale, role), to: roleName(locale, next) })}</li>
                ) : (
                  <li>{pt(locale, "roleDialog.pickFirst")}</li>
                )}
                <li>{pt(locale, "roleDialog.sessionsEnd")}</li>
                <li>{pt(locale, "roleDialog.primaryUnchanged")}</li>
                <li>{pt(locale, "cuDialog.dataKept")}</li>
                <li>{pt(locale, "cuDialog.recorded")}</li>
              </ul>
            </section>

            {phase.kind === "checking" && (
              <p className="platform-fine-print" role="status">
                {pt(locale, "cuDialog.checking")}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`role-reason-${userId}`}>{pt(locale, "accessDialog.reason")}</Label>
              <Textarea
                id={`role-reason-${userId}`}
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
                aria-describedby={`role-reason-hint-${userId}${errors.reason ? ` role-reason-error-${userId}` : ""}`}
              />
              <div className="platform-access-hint">
                <span id={`role-reason-hint-${userId}`}>{pt(locale, "accessDialog.reasonHint", { min: REASON_MIN, max: REASON_MAX })}</span>
                <span className="platform-access-count" aria-hidden="true" data-over={reasonLength > REASON_MAX || undefined}>
                  {pt(locale, "accessDialog.reasonCount", { n: reasonLength, max: REASON_MAX })}
                </span>
              </div>
              {errors.reason && (
                <p id={`role-reason-error-${userId}`} className="platform-field-error">
                  {errors.reason}
                </p>
              )}
            </div>

            <fieldset className="platform-access-stepup" disabled={busy}>
              <legend className="platform-access-heading">{pt(locale, "accessDialog.stepUp")}</legend>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`role-totp-${userId}`}>{pt(locale, "login.totpLabel")}</Label>
                <Input
                  id={`role-totp-${userId}`}
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
                  aria-describedby={errors.code ? `role-totp-error-${userId}` : undefined}
                />
              </div>
              {errors.code && (
                <p id={`role-totp-error-${userId}`} className="platform-field-error">
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
                {pt(locale, pending && phase.kind === "form" ? "roleDialog.submitting" : "roleDialog.submit")}
              </Button>
            </div>
          </form>
        )}
      </PlatformDialog>
    </>
  );
}
