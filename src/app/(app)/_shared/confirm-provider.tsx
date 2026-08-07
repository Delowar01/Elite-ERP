"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AlertTriangle, ShieldAlert, Wallet, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { t, type Locale } from "@/lib/i18n/dict";
import {
  buildConfirmContent,
  type ConfirmDetail,
  type ConfirmSeverity,
  type SensitiveActionKind,
} from "@/lib/confirm-policy";

/**
 * The one confirmation dialog for the whole app.
 *
 * Mounted once in the app layout; every sensitive action anywhere calls `confirmSensitiveAction`
 * from `useConfirm()` instead of building its own dialog (and never `window.confirm`). Wording and
 * severity come from the shared policy in `src/lib/confirm-policy.ts`, so the same kind of action
 * reads the same way in the list menu, the detail page and the preview.
 *
 * Duplicate-execution protection lives here rather than in each call site: while `onConfirm` runs,
 * both buttons are disabled and the confirm button shows a working label, so a double-click cannot
 * post two payments or create two documents. A failure keeps the dialog open, shows the server's own
 * message, and leaves the button usable so the user can retry; only success closes it.
 */

export type ConfirmRequest = {
  /** Policy key — decides severity, default wording and the confirm button's label. */
  action: SensitiveActionKind;
  /** i18n key for the record's type, e.g. "Sales Invoice". */
  entityType?: string;
  /** The record's human identifier (document number, client name). Never a database id. */
  entityNumber?: string;
  /** Override the policy's default sentence when this specific action needs a more precise one. */
  description?: string;
  /** Override the policy's verb (e.g. "Send Invoice" instead of the generic "Continue"). */
  confirmLabel?: string;
  /** Key figures shown as a small table: amount, currency, party, account, counts. */
  details?: ConfirmDetail[];
  /** Runs on confirm. Return `{ error }` (or throw) to keep the dialog open and show the message. */
  onConfirm: () => Promise<{ error?: string } | void> | void;
  /**
   * Set when the action navigates away on success (the page unmounts before we could close). The
   * dialog then stays in its working state instead of flashing back to idle.
   */
  navigatesOnSuccess?: boolean;
};

type ConfirmFn = (request: ConfirmRequest) => void;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return fn;
}

const SEVERITY_ICON = {
  standard: Info,
  warning: AlertTriangle,
  danger: ShieldAlert,
  financial: Wallet,
} as const;

// Severity drives emphasis only — never whether the action is allowed.
const SEVERITY_TONE: Record<ConfirmSeverity, string> = {
  standard: "var(--brand-orange)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  financial: "var(--accent-green)",
};

export function ConfirmProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards a second confirm slipping through between the click and the disabled re-render.
  const running = useRef(false);

  const confirm = useCallback<ConfirmFn>((next) => {
    running.current = false;
    setError(null);
    setBusy(false);
    setRequest(next);
  }, []);

  function close() {
    if (busy) return; // never yank the dialog out from under a running action
    running.current = false;
    setRequest(null);
    setError(null);
  }

  async function run() {
    if (!request || running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await request.onConfirm();
      if (result && "error" in result && result.error) {
        // Server refused (permissions, status, workflow, accounting rules) — stay open and retry-able.
        setError(result.error);
        running.current = false;
        setBusy(false);
        return;
      }
      if (request.navigatesOnSuccess) return; // page is leaving; keep the working state
      setRequest(null);
      setBusy(false);
      running.current = false;
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t(locale, "Something went wrong. Please try again."));
      running.current = false;
      setBusy(false);
    }
  }

  const content = useMemo(
    () =>
      request
        ? buildConfirmContent(locale, {
            kind: request.action,
            entityType: request.entityType,
            entityNumber: request.entityNumber,
            consequence: request.description,
            verb: request.confirmLabel,
          })
        : null,
    [request, locale],
  );

  const Icon = content ? SEVERITY_ICON[content.severity] : Info;
  const tone = content ? SEVERITY_TONE[content.severity] : undefined;
  const destructive = content?.severity === "danger";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-md" onEscapeKeyDown={(e) => busy && e.preventDefault()}>
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="shrink-0 grid place-items-center size-9 rounded-xl"
                style={{ background: "var(--canvas)", color: tone }}
              >
                <Icon className="size-[18px]" />
              </span>
              <div className="min-w-0">
                <DialogTitle>{content?.title}</DialogTitle>
                <DialogDescription className="mt-1.5">{content?.description}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {request?.details && request.details.length > 0 && (
            <dl className="rounded-xl border border-line px-3.5 py-2.5 text-[12.5px]" style={{ background: "var(--canvas)" }}>
              {request.details.map((d) => (
                <div key={d.label} className="flex items-baseline justify-between gap-4 py-1">
                  <dt className="text-ink-muted">{t(locale, d.label)}</dt>
                  <dd className="font-semibold text-ink text-end">{d.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {error && (
            <p role="alert" className="mt-3 text-[12.5px] rounded-xl px-3.5 py-2.5" style={{ background: "var(--danger-bg)", color: "var(--danger)" }}>
              {error}
            </p>
          )}

          <DialogFooter>
            {/* Cancel is first and takes initial focus: the safe option, never the destructive one. */}
            <Button variant="ghost" onClick={close} disabled={busy} autoFocus>
              {content?.cancelLabel ?? t(locale, "Cancel")}
            </Button>
            <Button variant={destructive ? "destructive" : "primary"} onClick={run} disabled={busy} aria-busy={busy}>
              {busy ? t(locale, "Working…") : content?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
