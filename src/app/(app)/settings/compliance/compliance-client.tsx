"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, UserX, FileCheck2, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { t, type Locale } from "@/lib/i18n/dict";
import { useConfirm } from "../../_shared/confirm-provider";
import { recordConsentAction, exportOrgDataAction, anonymizeCustomerAction, deleteConsentAction } from "./actions";

type ConsentRow = { id: number; subject: string; granted: boolean; version: string | null; createdAt: string };
type CustomerRow = { id: number; name: string; email: string | null; isActive: boolean };

/**
 * An internal READINESS CHECKLIST — not a compliance certification, and not a claim about any
 * external standard.
 *
 * What this screen used to do: show a green "Compliant" pill over twelve controls hardcoded
 * `done: true`, under GDPR / ISO 27001 / SOC 2 headings. It therefore could not display anything
 * but compliant, whatever the deployment's real state — and two of those three are CERTIFICATIONS
 * issued by accredited auditors after a formal audit, not self-assessments. No certification is
 * held. ISO 27001 is a roadmap item: no certification programme and no external audit engagement
 * has started.
 *
 * The rules this list now follows:
 *
 *  - **No control is ever hardcoded satisfied.** `implemented` means the feature is present in this
 *    codebase and can be pointed at; `live` means the deployment was actually asked (see
 *    `liveState`); `informational` means the product cannot see the state and says so.
 *  - **A control that maps to nothing real is dropped, not dressed.** The four SOC 2 controls were
 *    real features under a trust-services mapping that was not; they are listed under "Platform
 *    security", unmapped.
 *  - **A control names what it actually covers.** "Encryption of personal data at rest" covered
 *    `users.mfaSecret` and `users.mfaRecoveryCodes` only — customer names, emails, addresses and
 *    phone numbers are stored in plaintext — so it now says what is encrypted and has left GDPR.
 */
type ControlState = "implemented" | "live-yes" | "live-no" | "informational";
type Control = { label: string; state: ControlState };
type Group = { name: string; note: string; controls: Control[] };

function groupsFor(live: { fieldEncryption: boolean; auditTrigger: boolean }): Group[] {
  return [
    {
      name: "GDPR",
      note: "Internal privacy framework — self-assessed, not certified.",
      controls: [
        { label: "Right to data portability (Art. 20) — JSON export", state: "implemented" },
        { label: "Right to erasure (Art. 17) — customer anonymisation", state: "implemented" },
        { label: "Consent records with audit trail", state: "implemented" },
      ],
    },
    {
      name: "ISO 27001 — roadmap",
      note: "Readiness only. No certification is held and no external audit has been engaged.",
      controls: [
        { label: "A.9 Access control — RBAC + MFA", state: "implemented" },
        {
          label: "A.12.4 Logging & monitoring — append-only audit log (application-level)",
          state: "implemented",
        },
        {
          // The one control whose state genuinely varies per deployment, so it is asked rather than
          // asserted: drizzle/immutable_audit.sql has to be applied by hand after db:push.
          label: "A.12.4 Database-level immutability trigger installed",
          state: live.auditTrigger ? "live-yes" : "live-no",
        },
        { label: "A.10 Cryptography — field-level encryption with versioned keys (rotation-capable)", state: live.fieldEncryption ? "live-yes" : "live-no" },
        { label: "A.16 Security event feed (detection only — no incident-response process)", state: "informational" },
      ],
    },
    {
      name: "Platform security",
      note: "Security features shipped in this build. Not mapped to any external framework.",
      controls: [
        { label: "Signed URLs, security headers, rate limiting", state: "implemented" },
        { label: "Tenant isolation on every query", state: "implemented" },
        { label: "MFA secrets and recovery codes encrypted at rest (AES-256-GCM)", state: live.fieldEncryption ? "live-yes" : "live-no" },
        { label: "Transactional ledger posting", state: "implemented" },
        { label: "Backup/DR runbook documented — backup execution is not verified by the product", state: "informational" },
      ],
    },
  ];
}

const STATE_LABEL: Record<ControlState, string> = {
  implemented: "Implemented",
  "live-yes": "Verified in this deployment",
  "live-no": "Not detected in this deployment",
  informational: "Informational",
};


const CONSENT_SUBJECTS = ["privacy_policy", "data_processing", "marketing_communications"];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function ComplianceCenterClient(props: {
  liveState: { fieldEncryption: boolean; auditTrigger: boolean };
  locale: Locale; consents: ConsentRow[]; customers: CustomerRow[] }) {
  const { locale } = props;
  const groups = groupsFor(props.liveState);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const [consentSubject, setConsentSubject] = useState(CONSENT_SUBJECTS[0]);
  const [eraseId, setEraseId] = useState<string>("");
  const [confirmErase, setConfirmErase] = useState(false);

  function exportData() {
    startTransition(async () => {
      const res = await exportOrgDataAction();
      if ("error" in res) { toast.error(res.error); return; }
      const blob = new Blob([res.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t(locale, "Data export ready."));
    });
  }

  function recordConsent(granted: boolean) {
    startTransition(async () => {
      const res = await recordConsentAction(consentSubject, granted);
      if (res.error) { toast.error(res.error); return; }
      toast.success(granted ? t(locale, "Consent recorded.") : t(locale, "Consent withdrawn."));
    });
  }

  function anonymize() {
    const id = Number(eraseId);
    if (!id) { toast.error(t(locale, "Select a customer.")); return; }
    const target = props.customers.find((c) => c.id === id);
    confirm({
      action: "record.permanentDelete",
      entityType: "Personal Data",
      entityNumber: target?.name ?? "",
      confirmLabel: "Erase",
      description: "The customer's personal details will be irreversibly anonymized to satisfy a right-to-erasure request.",
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          startTransition(async () => {
            const res = await anonymizeCustomerAction(id);
            if (res.error) {
              resolve({ error: res.error });
              return;
            }
            setConfirmErase(false);
            setEraseId("");
            toast.success(t(locale, "Personal data erased."));
            resolve();
          });
        }),
    });
  }

  function removeConsent(id: number) {
    confirm({
      action: "settings.compliance",
      entityType: "Consent Record",
      entityNumber: "",
      confirmLabel: "Remove",
      description: "The consent record will be removed from the organization's compliance log.",
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          startTransition(async () => {
            await deleteConsentAction(id);
            resolve();
          });
        }),
    });
  }

  const eraseTarget = props.customers.find((c) => c.id === Number(eraseId));

  return (
    <div className="max-w-5xl mx-auto">
      <div className="main-head">
        <h3>{t(locale, "Security & Compliance Readiness")}</h3>
      </div>

      {/* Readiness groups. Deliberately NO "n/n" success badge: a full-marks badge is the visual
          claim that drifted into certification theatre, and it can come back through a data change
          rather than a wording change. Each control carries its own honest state instead. */}
      <p className="text-[12.5px] text-ink-muted mb-4">
        {t(locale, "An internal checklist of what this build implements. It is not a certification: no external audit has been carried out, and no framework compliance is claimed.")}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {groups.map((g) => (
          <div key={g.name} className="card" style={{ padding: "18px 20px" }}>
            <div className="flex items-center gap-2 mb-1">
              <FileCheck2 className="size-4" style={{ color: "var(--brand-orange)" }} />
              <span className="text-[14px] font-bold">{t(locale, g.name)}</span>
            </div>
            <p className="text-[11.5px] text-ink-faint mb-3">{t(locale, g.note)}</p>
            <ul className="flex flex-col gap-2">
              {g.controls.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] text-ink-muted">
                  {c.state === "implemented" || c.state === "live-yes" ? (
                    <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" style={{ color: "var(--good)" }} />
                  ) : (
                    <Circle className="size-3.5 mt-0.5 shrink-0" />
                  )}
                  <span>
                    {t(locale, c.label)}
                    <span className="ms-1 text-[11px] text-ink-faint">— {t(locale, STATE_LABEL[c.state])}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* GDPR data subject rights */}
      <div className="card" style={{ padding: "20px 22px", marginBottom: 18 }}>
        <div className="text-[14px] font-bold mb-1">{t(locale, "Data Subject Rights")}</div>
        <p className="text-[12.5px] text-ink-muted mb-4">
          {t(locale, "Export all personal data held by your organization, or erase an individual's personal data on request.")}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <div>
            <Button variant="secondary" onClick={exportData} disabled={pending}>
              <Download className="size-4" /> {t(locale, "Export organization data")}
            </Button>
          </div>
          <div className="flex-1" />
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-ink-muted">{t(locale, "Erase customer data")}</label>
              <select
                id="erase-customer"
                className="h-[42px] rounded-[10px] border border-line bg-surface px-3 text-[13px] min-w-[220px]"
                value={eraseId}
                onChange={(e) => setEraseId(e.target.value)}
              >
                <option value="">{t(locale, "Select a customer")}</option>
                {props.customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ""}</option>
                ))}
              </select>
            </div>
            <Button variant="destructive" onClick={anonymize} disabled={pending}>
              <UserX className="size-4" /> {t(locale, "Erase")}
            </Button>
          </div>
        </div>
      </div>

      {/* Consent management */}
      <div className="card" style={{ padding: "20px 22px", marginBottom: 18 }}>
        <div className="text-[14px] font-bold mb-1">{t(locale, "Consent Management")}</div>
        <p className="text-[12.5px] text-ink-muted mb-4">{t(locale, "Record and track data-processing consent for this account.")}</p>
        <div className="flex items-end gap-2 mb-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-medium text-ink-muted">{t(locale, "Subject")}</label>
            <select
              id="consent-subject"
              className="h-[42px] rounded-[10px] border border-line bg-surface px-3 text-[13px] min-w-[220px]"
              value={consentSubject}
              onChange={(e) => setConsentSubject(e.target.value)}
            >
              {CONSENT_SUBJECTS.map((s) => (
                <option key={s} value={s}>{t(locale, s)}</option>
              ))}
            </select>
          </div>
          <Button variant="secondary" onClick={() => recordConsent(true)} disabled={pending}>{t(locale, "Grant")}</Button>
          <Button variant="ghost" onClick={() => recordConsent(false)} disabled={pending}>{t(locale, "Withdraw")}</Button>
        </div>

        {props.consents.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(locale, "Subject")}</TableHead>
                <TableHead>{t(locale, "Status")}</TableHead>
                <TableHead>{t(locale, "Version")}</TableHead>
                <TableHead>{t(locale, "Date")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.consents.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{t(locale, c.subject)}</TableCell>
                  <TableCell><Badge variant={c.granted ? "success" : "neutral"}>{c.granted ? t(locale, "Granted") : t(locale, "Withdrawn")}</Badge></TableCell>
                  <TableCell className="text-ink-muted">{c.version ?? "—"}</TableCell>
                  <TableCell className="text-ink-muted">{fmtDate(c.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <button className="text-[12px] text-ink-faint hover:text-danger" onClick={() => removeConsent(c.id)} disabled={pending}>{t(locale, "Remove")}</button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-[12.5px] text-ink-faint">{t(locale, "No consent records yet.")}</p>
        )}
      </div>

      {/* Erasure confirm */}
      <Dialog open={confirmErase} onOpenChange={setConfirmErase}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(locale, "Erase personal data")}</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-ink-muted">
            {t(locale, "This permanently scrubs the customer's name, contact details and notes. Financial documents referencing them are retained for tax-law compliance. This cannot be undone.")}
          </p>
          {eraseTarget && <p className="text-[13px] font-semibold mt-2">{eraseTarget.name}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmErase(false)} disabled={pending}>{t(locale, "Cancel")}</Button>
            <Button variant="destructive" onClick={anonymize} disabled={pending}>{t(locale, "Erase")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
