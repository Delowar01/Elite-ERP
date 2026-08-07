"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { t, type Locale } from "@/lib/i18n/dict";
import type { Org } from "@/db";
import { enableZatcaPhase1Action } from "./actions";
import { useConfirm } from "../../_shared/confirm-provider";

// ZATCA E-Invoicing — Phase 1 only. Eligible Saudi orgs can enable Phase 1 after an explicit
// confirmation. Once enabled it is locked on for organization users (no disable control here); the
// panel shows a locked state explaining that only a backend administrator may turn it off.
export function ZatcaPanel({ locale, org }: { locale: Locale; org: Org }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const enabled = org.zatcaPhase1Enabled;
  const connected = Boolean(org.zatcaCsid);

  // Enabling is permanent for organization users, so it goes through the app-wide confirmation with
  // that consequence spelled out — rather than a dialog written only for this panel.
  function confirmEnable() {
    confirm({
      action: "settings.compliance",
      entityType: "ZATCA Phase 1",
      entityNumber: "",
      confirmLabel: "Enable ZATCA Phase 1",
      description:
        "This activates ZATCA Phase 1 e-invoicing for your organization. After enabling, you will not be able to disable it yourself — only a backend administrator or the Elite Marcom Platform Owner can.",
      onConfirm: () =>
        new Promise<{ error?: string } | void>((resolve) => {
          startTransition(async () => {
            const result = await enableZatcaPhase1Action();
            if (result.error) {
              resolve({ error: result.error });
              return;
            }
            toast.success(t(locale, "ZATCA Phase 1 enabled."));
            router.refresh();
            resolve();
          });
        }),
    });
  }

  return (
    <div className="max-w-xl">
      <h3 className="text-[17px] font-bold mb-1">{t(locale, "ZATCA E-Invoicing")}</h3>
      <p className="text-[12.5px] text-ink-muted mb-4">
        {t(locale, "ZATCA Phase 1 (Generation) e-invoicing for eligible Saudi organizations. The QR code and hash shown on every Tax Invoice come from this integration.")}
      </p>

      {enabled ? (
        <Card className="border-success/40">
          <CardContent className="p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold flex items-center gap-2">
                <ShieldCheck className="size-4 text-success" /> {t(locale, "ZATCA Phase 1")}
              </p>
              <Badge variant="success" className="flex items-center gap-1">
                <Lock className="size-3" /> {t(locale, "Enabled — Locked")}
              </Badge>
            </div>
            <p className="text-[12.5px] text-ink-muted">
              {t(locale, "ZATCA Phase 1 is enabled for this organization and cannot be turned off from here. To comply with Saudi e-invoicing regulations, only a backend administrator or the Elite Marcom Platform Owner can disable it.")}
            </p>
            <div className="flex flex-col gap-2 text-[12.5px] border-t border-line pt-3">
              <div className="flex justify-between border-b border-line pb-2">
                <span className="text-ink-faint">{t(locale, "Integration Status")}</span>
                <Badge variant={connected ? "success" : "neutral"}>{connected ? t(locale, "Connected") : t(locale, "Not Connected")}</Badge>
              </div>
              <div className="flex justify-between border-b border-line pb-2">
                <span className="text-ink-faint">CSID</span>
                <span className="font-mono text-xs">{org.zatcaCsid ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-faint">{t(locale, "Environment")}</span>
                <span>{org.zatcaEnvironment === "production" ? t(locale, "Production") : t(locale, "Sandbox")}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold">{t(locale, "ZATCA Phase 1")}</p>
              <Badge variant="neutral">{t(locale, "Not Enabled")}</Badge>
            </div>
            <p className="text-[12.5px] text-ink-muted">
              {t(locale, "Enable ZATCA Phase 1 to activate compliant e-invoicing for this organization. Enabling is permanent for organization users — once on, it can only be turned off by a backend administrator.")}
            </p>
            <div>
              <Button type="button" onClick={confirmEnable} disabled={pending}>
                {t(locale, "Enable ZATCA Phase 1")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
