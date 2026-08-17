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

/**
 * ZATCA Phase 1 — the org's own RECORD that it operates under Phase 1.
 *
 * What the product actually does is print a Phase 1 QR code on tax invoice PDFs. It generates no
 * XML, no UUID, no cryptographic stamp; it acquires no CSID and talks to no ZATCA system. This
 * panel therefore claims none of those. It previously described "the connection this organization
 * uses to comply", showed Integration Status / CSID / Environment fields nothing ever writes, and
 * said the QR "comes from this integration" — which was wrong twice over, since the QR is produced
 * regardless of this flag and only on the print route.
 *
 * The flag itself is kept: it is an honest per-org record, audit-logged, and locked on for
 * organization users once set (only a backend administrator may turn it off). Making it GATE the QR
 * would remove QR codes from Saudi orgs that never enabled it — a behaviour change, filed with the
 * country-leak entry rather than smuggled in here.
 */
export function ZatcaPanel({ locale, org }: { locale: Locale; org: Org }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const enabled = org.zatcaPhase1Enabled;

  // Enabling is permanent for organization users, so it goes through the app-wide confirmation with
  // that consequence spelled out — rather than a dialog written only for this panel.
  function confirmEnable() {
    confirm({
      action: "settings.compliance",
      entityType: "ZATCA Phase 1",
      entityNumber: "",
      confirmLabel: "Enable ZATCA Phase 1",
      description:
        "This records ZATCA Phase 1 for your organization. After enabling, you will not be able to disable it yourself — only a backend administrator or the Elite Marcom Platform Owner can.",
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
      <h3 className="text-[17px] font-bold mb-1">{t(locale, "ZATCA Phase 1")}</h3>
      <p className="text-[12.5px] text-ink-muted mb-4">
        {t(locale, "Records that this organization operates under ZATCA Phase 1. A Phase 1 QR code is printed on tax invoice PDFs. There is no connection to ZATCA systems: no XML, no cryptographic stamping, no clearance or reporting.")}
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
              {t(locale, "ZATCA Phase 1 is recorded for this organization and cannot be turned off from here. Only a backend administrator or the Elite Marcom Platform Owner can turn it off.")}
            </p>
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
              {t(locale, "Record that this organization operates under ZATCA Phase 1. Enabling is permanent for organization users — once on, it can only be turned off by a backend administrator.")}
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
