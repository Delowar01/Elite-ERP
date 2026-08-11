"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw, AlertTriangle } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { t, type Locale } from "@/lib/i18n/dict";
import { saveManualRateAction, fetchRatesNowAction } from "./exchange-rates-actions";

// The Exchange Rates preset panel. What users check is "what rate is in force for this pair now",
// so the latest rate per pair leads; the full dated history sits below it with the source visible
// on every row — a figure that feeds the ledger is only trustworthy if you can see where it came
// from. Manual entry goes through the same validation as fetched rates and always wins over them.

export type LatestRate = {
  fromCurrency: string;
  rate: string;
  effectiveDate: string;
  source: string;
  /** True when this pair's newest rate is older than STALE_AFTER_DAYS. */
  stale: boolean;
};
export type RateHistoryRow = { id: number; fromCurrency: string; rate: string; effectiveDate: string; source: string };

export function ExchangeRatesPanel({
  locale,
  baseCurrency,
  latest,
  history,
  attribution,
  lastError,
  staleAfterDays,
}: {
  locale: Locale;
  baseCurrency: string;
  latest: LatestRate[];
  history: RateHistoryRow[];
  /** The active provider's attribution, shown wherever fetched rates display (its terms require it). */
  attribution: { text: string; href: string } | null;
  /** Why the last automatic fetch failed, when it did — staleness with a reason beats a bare badge. */
  lastError: string | null;
  staleAfterDays: number;
}) {
  const [adding, setAdding] = useState(false);
  const [prefill, setPrefill] = useState<{ currency: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const hasFetchedRows = latest.some((r) => r.source !== "manual") || history.some((r) => r.source !== "manual");

  function fetchNow(only?: string[]) {
    startTransition(async () => {
      const { outcome } = await fetchRatesNowAction(only);
      if (outcome.status === "fetched") {
        const parts = [`${outcome.written} ${t(locale, "rates updated")}`];
        if (outcome.skippedManual > 0) parts.push(`${outcome.skippedManual} ${t(locale, "manual rates kept")}`);
        if (outcome.unavailable.length > 0) parts.push(`${t(locale, "unavailable:")} ${outcome.unavailable.join(", ")}`);
        toast.success(parts.join(" · "));
      } else if (outcome.status === "no-pairs") {
        toast.info(t(locale, "No foreign currencies in use yet — nothing to fetch."));
      } else if (outcome.status === "failed") {
        toast.error(`${t(locale, "Rate fetch failed — existing rates remain in force.")} (${outcome.error})`);
      }
    });
  }

  function submitManual(formData: FormData) {
    const fromCurrency = String(formData.get("currency") ?? "").trim();
    const rate = String(formData.get("rate") ?? "").trim();
    const effectiveDate = String(formData.get("date") ?? "").trim();
    startTransition(async () => {
      const result = await saveManualRateAction({ fromCurrency, rate, effectiveDate });
      if (result.error) toast.error(result.error);
      else {
        toast.success(t(locale, "Saved"));
        setAdding(false);
        setPrefill(null);
      }
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13.5px] font-semibold">{t(locale, "Current Rates")}</div>
            <div className="text-[12px] text-ink-muted">
              {t(locale, "Units of")} {baseCurrency} {t(locale, "per one unit of each currency. Posting always uses the rate dated on or before the document's own date.")}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="glass" disabled={pending} onClick={() => fetchNow()}>
              <RefreshCw className="size-3.5" />
              {t(locale, "Fetch All Now")}
            </Button>
            <Button disabled={pending} onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              {t(locale, "Add Manual Rate")}
            </Button>
          </div>
        </div>

        {lastError ? (
          <div className="flex items-center gap-2 rounded-[10px] border border-warning/40 bg-warning-bg px-3 py-2 text-[12.5px]">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              {t(locale, "The last automatic fetch failed — existing rates remain in force.")} ({lastError})
            </span>
          </div>
        ) : null}

        {latest.length === 0 ? (
          <div className="text-[13px] text-ink-muted">{t(locale, "No exchange rates yet. Rates appear here once a foreign-currency document exists or a rate is added manually.")}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t(locale, "Currency")}</TableHead>
                <TableHead className="num">{t(locale, "Rate")}</TableHead>
                <TableHead>{t(locale, "As Of")}</TableHead>
                <TableHead>{t(locale, "Source")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {latest.map((r) => (
                <TableRow key={r.fromCurrency}>
                  <TableCell className="font-mono font-semibold">{r.fromCurrency} → {baseCurrency}</TableCell>
                  <TableCell className="num font-mono">{Number(r.rate)}</TableCell>
                  <TableCell>
                    {r.effectiveDate}
                    {r.stale ? (
                      <Badge variant="warning" className="ms-2">
                        {t(locale, "Stale")} (&gt;{staleAfterDays} {t(locale, "days")})
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-[12px] text-ink-muted">{r.source === "manual" ? t(locale, "Manual") : r.source}</TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="glass" disabled={pending} onClick={() => fetchNow([r.fromCurrency])}>
                        {t(locale, "Fetch")}
                      </Button>
                      <Button size="sm" variant="glass" disabled={pending} onClick={() => { setPrefill({ currency: r.fromCurrency }); setAdding(true); }}>
                        {t(locale, "Set Manually")}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div>
          <div className="text-[13.5px] font-semibold mb-2">{t(locale, "Rate History")}</div>
          {history.length === 0 ? (
            <div className="text-[13px] text-ink-muted">{t(locale, "No rate history yet.")}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t(locale, "Date")}</TableHead>
                  <TableHead>{t(locale, "Currency")}</TableHead>
                  <TableHead className="num">{t(locale, "Rate")}</TableHead>
                  <TableHead>{t(locale, "Source")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.effectiveDate}</TableCell>
                    <TableCell className="font-mono">{r.fromCurrency} → {baseCurrency}</TableCell>
                    <TableCell className="num font-mono">{Number(r.rate)}</TableCell>
                    <TableCell className="text-[12px] text-ink-muted">{r.source === "manual" ? t(locale, "Manual") : r.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Attribution: the general provider's terms are attribution-based, so wherever its rates
            display, this line displays with them — visibly, not just in the source column. */}
        {hasFetchedRows && attribution ? (
          <div className="text-[11.5px] text-ink-faint">
            <a href={attribution.href} target="_blank" rel="noopener noreferrer" className="underline">
              {attribution.text}
            </a>
          </div>
        ) : null}

        <Dialog open={adding} onOpenChange={(o) => { if (!o) { setAdding(false); setPrefill(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t(locale, "Add Manual Rate")}</DialogTitle>
            </DialogHeader>
            <form action={submitManual} className="flex flex-col gap-4">
              <FormField label={t(locale, "Currency Code")} htmlFor="rate-currency">
                <Input id="rate-currency" name="currency" defaultValue={prefill?.currency ?? ""} placeholder="USD" maxLength={3} required />
              </FormField>
              <FormField label={`${t(locale, "Rate")} (${baseCurrency} ${t(locale, "per unit")})`} htmlFor="rate-value">
                <Input id="rate-value" name="rate" type="number" step="0.00000001" min="0.00000001" required />
              </FormField>
              <FormField label={t(locale, "Effective Date")} htmlFor="rate-date">
                <Input id="rate-date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
              </FormField>
              <div className="text-[12px] text-ink-muted">
                {t(locale, "A manual rate replaces any fetched rate for the same currency and date, and automatic fetches never overwrite it.")}
              </div>
              <DialogFooter>
                <Button type="button" variant="glass" onClick={() => { setAdding(false); setPrefill(null); }}>
                  {t(locale, "Cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {t(locale, "Save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
