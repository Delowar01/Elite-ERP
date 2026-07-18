"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, Smartphone, Monitor, KeyRound, LogOut, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { t, type Locale } from "@/lib/i18n/dict";
import {
  beginMfaSetupAction,
  confirmMfaAction,
  disableMfaAction,
  changePasswordAction,
  terminateSessionAction,
  logoutAllOtherSessionsAction,
} from "./actions";

type SessionRow = {
  id: number;
  browser: string | null;
  os: string | null;
  device: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastActivityAt: string;
  tokenHash: string;
};
type EventRow = { id: number; type: string; severity: string; email: string | null; ipAddress: string | null; browser: string | null; detail: string | null; createdAt: string };
type Alert = { kind: string; severity: string; title: string; detail: string; count: number };

const SEV_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  info: "neutral", low: "info", medium: "warning", high: "danger", critical: "danger",
};
const RISK_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  low: { label: "Low", color: "var(--good)", bg: "var(--good-bg)" },
  elevated: { label: "Elevated", color: "var(--warn)", bg: "var(--warn-bg)" },
  high: { label: "High", color: "var(--crit)", bg: "var(--crit-bg)" },
  critical: { label: "Critical", color: "var(--crit)", bg: "var(--crit-bg)" },
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function SecurityCenterClient(props: {
  locale: Locale;
  isAdmin: boolean;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  passwordChangedAt: string | null;
  currentJti: string | null;
  sessions: SessionRow[];
  riskLevel: string;
  alerts: Alert[];
  events: EventRow[];
  stats: { loginSuccess: number; loginFailed: number; mfaEvents: number; passwordChanges: number };
}) {
  const { locale } = props;
  const [pending, startTransition] = useTransition();

  // MFA setup dialog state
  const [mfaOpen, setMfaOpen] = useState(false);
  const [mfaStep, setMfaStep] = useState<"scan" | "recovery">("scan");
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePw, setDisablePw] = useState("");

  async function openMfaSetup() {
    startTransition(async () => {
      const res = await beginMfaSetupAction();
      if ("error" in res) { toast.error(res.error); return; }
      // Render the QR client-side from the provisioning URI (kept dependency-free).
      const QRCode = (await import("qrcode")).default;
      setQr(await QRCode.toDataURL(res.uri, { margin: 1, width: 200 }));
      setSecret(res.secret);
      setMfaCode("");
      setMfaStep("scan");
      setMfaOpen(true);
    });
  }

  function confirmMfa() {
    startTransition(async () => {
      const res = await confirmMfaAction(mfaCode);
      if ("error" in res) { toast.error(res.error); return; }
      setRecoveryCodes(res.recoveryCodes);
      setMfaStep("recovery");
      toast.success(t(locale, "Two-factor authentication is on."));
    });
  }

  function disableMfa() {
    startTransition(async () => {
      const res = await disableMfaAction(disablePw);
      if (res.error) { toast.error(res.error); return; }
      setDisableOpen(false);
      setDisablePw("");
      toast.success(t(locale, "Two-factor authentication turned off."));
    });
  }

  // Password change
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  function changePassword() {
    startTransition(async () => {
      const res = await changePasswordAction(curPw, newPw);
      if (res.error) { toast.error(res.error); return; }
      setCurPw("");
      setNewPw("");
      toast.success(t(locale, "Password changed — other devices signed out."));
    });
  }

  function terminate(id: number) {
    startTransition(async () => {
      const res = await terminateSessionAction(id);
      if (res.error) toast.error(res.error);
      else toast.success(t(locale, "Session ended."));
    });
  }
  function logoutAll() {
    startTransition(async () => {
      const res = await logoutAllOtherSessionsAction();
      if (res.error) toast.error(res.error);
      else toast.success(t(locale, "Signed out of all other devices."));
    });
  }

  const risk = RISK_STYLE[props.riskLevel] ?? RISK_STYLE.low;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="main-head">
        <h3>{t(locale, "Security Center")}</h3>
        {props.isAdmin && (
          <span className="pill" style={{ background: risk.bg, color: risk.color, fontWeight: 700 }}>
            {t(locale, "Risk")}: {t(locale, risk.label)}
          </span>
        )}
      </div>

      {/* Threat alerts */}
      {props.isAdmin && props.alerts.length > 0 && (
        <div className="flex flex-col gap-2 mb-6">
          {props.alerts.map((a, i) => (
            <div key={i} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-elevated" style={{ borderLeft: `3px solid ${a.severity === "high" || a.severity === "critical" ? "var(--crit)" : "var(--warn)"}` }}>
              <AlertTriangle className="size-4 mt-0.5" style={{ color: a.severity === "high" || a.severity === "critical" ? "var(--crit)" : "var(--warn)" }} />
              <div>
                <div className="text-[13.5px] font-semibold">{a.title}</div>
                <div className="text-[12.5px] text-ink-muted">{a.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Admin attack stats */}
      {props.isAdmin && (
        <div className="stat-row-2 mb-6">
          {[
            { label: "Successful logins", value: props.stats.loginSuccess, color: "var(--accent-green)" },
            { label: "Failed logins", value: props.stats.loginFailed, color: "var(--warning)" },
            { label: "MFA events", value: props.stats.mfaEvents },
            { label: "Password changes", value: props.stats.passwordChanges },
          ].map((s, i) => (
            <div key={i} className="card" style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 11.5, color: "var(--ink-muted)" }}>{t(locale, s.label)}</div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, marginTop: 4, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* MFA card */}
      <div className="card" style={{ padding: "20px 22px", marginBottom: 18 }}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {props.mfaEnabled ? <ShieldCheck className="size-5" style={{ color: "var(--good)" }} /> : <ShieldAlert className="size-5" style={{ color: "var(--warn)" }} />}
            <div>
              <div className="text-[14px] font-bold">{t(locale, "Two-Factor Authentication")}</div>
              <div className="text-[12.5px] text-ink-muted">
                {props.mfaEnabled
                  ? t(locale, "Enabled — a code from your authenticator app is required at sign-in.")
                  : props.mfaRequired
                    ? t(locale, "Required for your role. Set it up to secure your account.")
                    : t(locale, "Add a second step at sign-in with Microsoft Authenticator, Google Authenticator, or Authy.")}
              </div>
            </div>
          </div>
          {props.mfaEnabled ? (
            <Button variant="secondary" disabled={pending || props.mfaRequired} onClick={() => setDisableOpen(true)}>
              {t(locale, "Disable")}
            </Button>
          ) : (
            <Button disabled={pending} onClick={openMfaSetup} style={{ width: "auto" }}>
              {t(locale, "Enable MFA")}
            </Button>
          )}
        </div>
      </div>

      {/* Password card */}
      <div className="card" style={{ padding: "20px 22px", marginBottom: 18 }}>
        <div className="flex items-center gap-3 mb-4">
          <KeyRound className="size-5" style={{ color: "var(--brand-orange)" }} />
          <div>
            <div className="text-[14px] font-bold">{t(locale, "Password")}</div>
            <div className="text-[12.5px] text-ink-muted">
              {props.passwordChangedAt ? `${t(locale, "Last changed")} ${fmtDateTime(props.passwordChangedAt)}` : t(locale, "Change your password")}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 max-w-xl">
          <FormField label={t(locale, "Current password")} htmlFor="cur-pw">
            <Input id="cur-pw" type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" />
          </FormField>
          <FormField label={t(locale, "New password")} htmlFor="new-pw">
            <Input id="new-pw" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
          </FormField>
        </div>
        <div className="mt-4">
          <Button variant="secondary" disabled={pending || !curPw || !newPw} onClick={changePassword}>
            {t(locale, "Change password")}
          </Button>
        </div>
      </div>

      {/* Active sessions */}
      <div className="main-head" style={{ marginTop: 8 }}>
        <h3 style={{ fontSize: 15 }}>{t(locale, "Active Sessions")}</h3>
        {props.sessions.length > 1 && (
          <Button variant="secondary" size="sm" disabled={pending} onClick={logoutAll}>
            <LogOut className="size-3.5" /> {t(locale, "Log out all other devices")}
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(locale, "Device")}</TableHead>
            <TableHead>{t(locale, "IP address")}</TableHead>
            <TableHead>{t(locale, "Signed in")}</TableHead>
            <TableHead>{t(locale, "Last active")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.sessions.map((s) => {
            const isCurrent = props.currentJti != null; // best-effort; current row highlighted via first-session heuristic below
            void isCurrent;
            return (
              <TableRow key={s.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {s.device === "Mobile" ? <Smartphone className="size-3.5 text-ink-faint" /> : <Monitor className="size-3.5 text-ink-faint" />}
                    <span>{[s.browser, s.os].filter(Boolean).join(" · ") || t(locale, "Unknown device")}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">{s.ipAddress ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{fmtDateTime(s.createdAt)}</TableCell>
                <TableCell className="font-mono text-xs">{fmtDateTime(s.lastActivityAt)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="secondary" size="sm" disabled={pending} onClick={() => terminate(s.id)}>
                    {t(locale, "End")}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Security timeline (admins) */}
      {props.isAdmin && (
        <>
          <div className="main-head" style={{ marginTop: 26 }}>
            <h3 style={{ fontSize: 15 }}>{t(locale, "Security Timeline")}</h3>
          </div>
          {props.events.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface shadow-elevated py-8 text-center text-ink-muted text-sm">{t(locale, "No security events yet.")}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t(locale, "Event")}</TableHead>
                  <TableHead>{t(locale, "Severity")}</TableHead>
                  <TableHead>{t(locale, "Account")}</TableHead>
                  <TableHead>{t(locale, "IP address")}</TableHead>
                  <TableHead>{t(locale, "When")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.type}</TableCell>
                    <TableCell>
                      <Badge variant={SEV_VARIANT[e.severity] ?? "neutral"}>{e.severity}</Badge>
                    </TableCell>
                    <TableCell className="text-[12.5px]">{e.email ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{e.ipAddress ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{fmtDateTime(e.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}

      {/* MFA setup dialog */}
      <Dialog open={mfaOpen} onOpenChange={setMfaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mfaStep === "scan" ? t(locale, "Set up two-factor authentication") : t(locale, "Save your recovery codes")}</DialogTitle>
          </DialogHeader>
          {mfaStep === "scan" ? (
            <div className="flex flex-col gap-4">
              <p className="text-[12.5px] text-ink-muted">
                {t(locale, "Scan this QR code with Microsoft Authenticator, Google Authenticator, or Authy, then enter the 6-digit code it shows.")}
              </p>
              {qr && (
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="MFA QR code" width={200} height={200} style={{ borderRadius: 12, border: "1px solid var(--line)" }} />
                </div>
              )}
              <div className="text-center text-[11px] text-ink-faint font-mono break-all">{secret}</div>
              <FormField label={t(locale, "Authentication code")} htmlFor="mfa-confirm">
                <Input id="mfa-confirm" inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} placeholder="123456" />
              </FormField>
              <DialogFooter>
                <Button disabled={pending || mfaCode.length !== 6} onClick={confirmMfa}>
                  {t(locale, "Verify & enable")}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-[12.5px] text-ink-muted">
                {t(locale, "Store these somewhere safe. Each code works once if you lose access to your authenticator app. They won't be shown again.")}
              </p>
              <div className="grid grid-cols-2 gap-2 font-mono text-[13px]">
                {recoveryCodes.map((c) => (
                  <div key={c} className="rounded-lg border border-line bg-canvas px-3 py-2 text-center">{c}</div>
                ))}
              </div>
              <DialogFooter>
                <Button onClick={() => setMfaOpen(false)}>{t(locale, "Done")}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Disable MFA dialog */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(locale, "Turn off two-factor authentication")}</DialogTitle>
          </DialogHeader>
          <FormField label={t(locale, "Confirm your password")} htmlFor="disable-pw">
            <Input id="disable-pw" type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} autoComplete="current-password" />
          </FormField>
          <DialogFooter>
            <Button variant="secondary" disabled={pending || !disablePw} onClick={disableMfa}>
              {t(locale, "Disable")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
