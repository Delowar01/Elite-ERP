"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ShieldCheck, Download, UserX, FileCheck2, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { t, type Locale } from "@/lib/i18n/dict";
import { recordConsentAction, exportOrgDataAction, anonymizeCustomerAction, deleteConsentAction } from "./actions";

type ConsentRow = { id: number; subject: string; granted: boolean; version: string | null; createdAt: string };
type CustomerRow = { id: number; name: string; email: string | null; isActive: boolean };

// Control coverage shown to the operator — each maps to a feature actually shipped in the app.
const FRAMEWORKS: { name: string; controls: { label: string; done: boolean }[] }[] = [
  {
    name: "GDPR",
    controls: [
      { label: "Right to data portability (Art. 20) — JSON export", done: true },
      { label: "Right to erasure (Art. 17) — customer anonymisation", done: true },
      { label: "Consent records with audit trail", done: true },
      { label: "Encryption of personal data at rest (AES-256-GCM)", done: true },
    ],
  },
  {
    name: "ISO 27001",
    controls: [
      { label: "A.9 Access control — RBAC + MFA", done: true },
      { label: "A.12.4 Logging & monitoring — immutable audit log", done: true },
      { label: "A.10 Cryptography — field-level encryption + key rotation", done: true },
      { label: "A.16 Incident management — threat detection feed", done: true },
    ],
  },
  {
    name: "SOC 2",
    controls: [
      { label: "Security — signed URLs, security headers, rate limiting", done: true },
      { label: "Confidentiality — tenant isolation on every query", done: true },
      { label: "Availability — backup/DR runbook", done: true },
      { label: "Processing integrity — transactional ledger posting", done: true },
    ],
  },
];

const CONSENT_SUBJECTS = ["privacy_policy", "data_processing", "marketing_communications"];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function ComplianceCenterClient(props: { locale: Locale; consents: ConsentRow[]; customers: CustomerRow[] }) {
  const { locale } = props;
  const [pending, startTransition] = useTransition();

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
    startTransition(async () => {
      const res = await anonymizeCustomerAction(id);
      if (res.error) { toast.error(res.error); return; }
      setConfirmErase(false);
      setEraseId("");
      toast.success(t(locale, "Personal data erased."));
    });
  }

  function removeConsent(id: number) {
    startTransition(async () => {
      await deleteConsentAction(id);
    });
  }

  const eraseTarget = props.customers.find((c) => c.id === Number(eraseId));

  return (
    <div className="max-w-5xl mx-auto">
      <div className="main-head">
        <h3>{t(locale, "Compliance Center")}</h3>
        <span className="pill" style={{ background: "var(--good-bg)", color: "var(--good)", fontWeight: 700 }}>
          <ShieldCheck className="size-3.5" /> {t(locale, "Compliant")}
        </span>
      </div>

      {/* Framework posture */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {FRAMEWORKS.map((fw) => {
          const done = fw.controls.filter((c) => c.done).length;
          return (
            <div key={fw.name} className="card" style={{ padding: "18px 20px" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileCheck2 className="size-4" style={{ color: "var(--brand-orange)" }} />
                  <span className="text-[14px] font-bold">{fw.name}</span>
                </div>
                <Badge variant={done === fw.controls.length ? "success" : "warning"}>
                  {done}/{fw.controls.length}
                </Badge>
              </div>
              <ul className="flex flex-col gap-2">
                {fw.controls.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px] text-ink-muted">
                    {c.done ? <CheckCircle2 className="size-3.5 mt-0.5 shrink-0" style={{ color: "var(--good)" }} /> : <Circle className="size-3.5 mt-0.5 shrink-0" />}
                    <span>{t(locale, c.label)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
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
            <Button variant="destructive" onClick={() => (eraseId ? setConfirmErase(true) : toast.error(t(locale, "Select a customer.")))} disabled={pending}>
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
