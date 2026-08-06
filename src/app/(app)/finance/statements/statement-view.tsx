"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { Download, Loader2, Search, AlertTriangle, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { t, type Locale } from "@/lib/i18n/dict";
import { Money } from "../../sales/_shared/money";
import { getStatementAction } from "./actions";
import type {
  Statement, StatementDocType, StatementFilters, PartyKind, PresetKey, PartyOption,
} from "@/lib/statements";

// Client/Vendor statement of account. Filter changes re-run the statement through a server action
// and swap the table in place — no navigation, no full page reload. Renders loading, empty and error
// states, mirrors in RTL with the rest of the app, and uses the shared Money component so the
// organization's own number and currency format applies.

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "this_year", label: "This year" },
  { key: "custom", label: "Custom range" },
];

const CLIENT_TYPES: { key: StatementDocType; label: string }[] = [
  { key: "sales_invoice", label: "Invoice" },
  { key: "credit_note", label: "Credit Note" },
  { key: "payment_in", label: "Payment Received" },
  { key: "journal", label: "Journal Entry" },
];
const VENDOR_TYPES: { key: StatementDocType; label: string }[] = [
  { key: "purchase_order", label: "Purchase Order" },
  { key: "debit_note", label: "Debit Note" },
  { key: "payment_out", label: "Payment Made" },
  { key: "journal", label: "Journal Entry" },
];

const ALL = "__all__";
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function rangeFor(preset: PresetKey, ref = new Date()): { from: string; to: string } | null {
  const y = ref.getUTCFullYear(), m = ref.getUTCMonth();
  switch (preset) {
    case "this_month": return { from: ymd(new Date(Date.UTC(y, m, 1))), to: ymd(new Date(Date.UTC(y, m + 1, 0))) };
    case "last_month": return { from: ymd(new Date(Date.UTC(y, m - 1, 1))), to: ymd(new Date(Date.UTC(y, m, 0))) };
    case "this_quarter": {
      const q = Math.floor(m / 3);
      return { from: ymd(new Date(Date.UTC(y, q * 3, 1))), to: ymd(new Date(Date.UTC(y, q * 3 + 3, 0))) };
    }
    case "this_year": return { from: ymd(new Date(Date.UTC(y, 0, 1))), to: ymd(new Date(Date.UTC(y, 12, 0))) };
    default: return null;
  }
}

export function StatementView({
  locale, kind, partyId, parties, compact = false, initial = null,
}: {
  locale: Locale;
  kind: PartyKind;
  /** Fixed party (client/vendor detail page) or null for the central page's selector. */
  partyId: number | null;
  /** Selectable parties — empty when the party is fixed. */
  parties?: PartyOption[];
  /** Detail-page embed: drops the party selector and tightens the layout. */
  compact?: boolean;
  /** First statement, computed on the server so the page paints with data already in it. */
  initial?: Statement | null;
}) {
  const defaultRange = rangeFor("this_year")!;
  const [selected, setSelected] = useState<number | null>(partyId);
  const [preset, setPreset] = useState<PresetKey>("this_year");
  const [from, setFrom] = useState(initial?.from ?? defaultRange.from);
  const [to, setTo] = useState(initial?.to ?? defaultRange.to);
  const [types, setTypes] = useState<StatementDocType[]>([]);
  const [pay, setPay] = useState<"all" | "paid" | "unpaid" | "partial">("all");
  const [currency, setCurrency] = useState("");
  const [search, setSearch] = useState("");

  const [statement, setStatement] = useState<Statement | null>(initial);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const typeOptions = kind === "client" ? CLIENT_TYPES : VENDOR_TYPES;

  /**
   * Fetch the statement for the given party + filters and swap the table in place. Called from the
   * change handlers rather than an effect, so a filter change never cascades re-renders and the
   * first paint already has the server-rendered statement.
   */
  const run = useCallback((id: number | null, f: StatementFilters) => {
    if (id == null) { setStatement(null); setError(""); return; }
    start(async () => {
      const res = await getStatementAction(kind, id, f);
      if (res.error) { setError(res.error); setStatement(null); }
      else { setError(""); setStatement(res.statement ?? null); }
    });
  }, [kind]);

  /** Apply a filter change and refresh — one path for every control. */
  function apply(patch: Partial<StatementFilters & { party: number | null; preset: PresetKey }>) {
    const next: StatementFilters = {
      from: patch.from ?? from,
      to: patch.to ?? to,
      docTypes: patch.docTypes ?? types,
      paymentStatus: patch.paymentStatus ?? pay,
      currency: patch.currency ?? currency,
      search: patch.search ?? search,
    };
    const id = patch.party !== undefined ? patch.party : selected;
    if (patch.party !== undefined) setSelected(patch.party);
    if (patch.preset !== undefined) setPreset(patch.preset);
    if (patch.from !== undefined) setFrom(patch.from);
    if (patch.to !== undefined) setTo(patch.to);
    if (patch.docTypes !== undefined) setTypes(patch.docTypes);
    if (patch.paymentStatus !== undefined) setPay(patch.paymentStatus);
    if (patch.currency !== undefined) setCurrency(patch.currency);
    if (patch.search !== undefined) setSearch(patch.search);
    run(id, next);
  }

  function applyPreset(p: PresetKey) {
    const r = rangeFor(p);
    apply(r ? { preset: p, from: r.from, to: r.to } : { preset: p });
  }

  function toggleType(key: StatementDocType) {
    apply({ docTypes: types.includes(key) ? types.filter((k) => k !== key) : [...types, key] });
  }

  const exportHref = (format: "pdf" | "xlsx" | "csv") => {
    const p = new URLSearchParams({ kind, party: String(selected ?? ""), from, to, format, pay });
    if (types.length) p.set("types", types.join(","));
    if (currency) p.set("currency", currency);
    if (search) p.set("q", search);
    return `/finance/statements/export?${p}`;
  };

  const canDownload = selected != null && !!statement;

  return (
    <div className="flex flex-col gap-3">
      {/* ---------- filters ---------- */}
      <div className="rounded-[14px] border border-line p-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          {!compact && parties && (
            <label className="flex flex-col gap-1 min-w-[210px]">
              <span className="text-[11px] text-ink-faint uppercase tracking-wide">
                {t(locale, kind === "client" ? "Client" : "Vendor")}
              </span>
              <Select value={selected != null ? String(selected) : ""} onValueChange={(v) => apply({ party: Number(v) })}>
                <SelectTrigger className="h-9 text-[12.5px]">
                  <SelectValue placeholder={t(locale, kind === "client" ? "Select a client" : "Select a vendor")} />
                </SelectTrigger>
                <SelectContent>
                  {parties.map((p) => (<SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </label>
          )}

          <label className="flex flex-col gap-1 min-w-[150px]">
            <span className="text-[11px] text-ink-faint uppercase tracking-wide">{t(locale, "Period")}</span>
            <Select value={preset} onValueChange={(v) => applyPreset(v as PresetKey)}>
              <SelectTrigger className="h-9 text-[12.5px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (<SelectItem key={p.key} value={p.key}>{t(locale, p.label)}</SelectItem>))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-faint uppercase tracking-wide">{t(locale, "From")}</span>
            <Input type="date" value={from} className="h-9 w-[150px] text-[12.5px]"
              onChange={(e) => apply({ from: e.target.value, preset: "custom" })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-faint uppercase tracking-wide">{t(locale, "To")}</span>
            <Input type="date" value={to} className="h-9 w-[150px] text-[12.5px]"
              onChange={(e) => apply({ to: e.target.value, preset: "custom" })} />
          </label>

          <label className="flex flex-col gap-1 min-w-[140px]">
            <span className="text-[11px] text-ink-faint uppercase tracking-wide">{t(locale, "Payment status")}</span>
            <Select value={pay} onValueChange={(v) => apply({ paymentStatus: v as typeof pay })}>
              <SelectTrigger className="h-9 text-[12.5px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t(locale, "All")}</SelectItem>
                <SelectItem value="paid">{t(locale, "Paid")}</SelectItem>
                <SelectItem value="partial">{t(locale, "Partially paid")}</SelectItem>
                <SelectItem value="unpaid">{t(locale, "Unpaid")}</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1 min-w-[120px]">
            <span className="text-[11px] text-ink-faint uppercase tracking-wide">{t(locale, "Currency")}</span>
            <Select value={currency || ALL} onValueChange={(v) => apply({ currency: v === ALL ? "" : v })}>
              <SelectTrigger className="h-9 text-[12.5px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t(locale, "All")}</SelectItem>
                {(statement?.currencies ?? []).map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1 flex-1 min-w-[190px]">
            <span className="text-[11px] text-ink-faint uppercase tracking-wide">{t(locale, "Search")}</span>
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-3.5 text-ink-faint" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") apply({ search: (e.target as HTMLInputElement).value }); }} onBlur={(e) => apply({ search: e.target.value })} className="h-9 ps-9 text-[12.5px]"
                placeholder={t(locale, "Document number or reference")} />
            </div>
          </label>
        </div>

        {/* document types */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-faint uppercase tracking-wide me-1">{t(locale, "Document type")}</span>
          {typeOptions.map((o) => {
            const on = types.includes(o.key);
            return (
              <button key={o.key} type="button" onClick={() => toggleType(o.key)}
                className={`h-7 rounded-full border px-3 text-[11.5px] transition-colors ${on ? "border-brand-orange bg-brand-orange text-white" : "border-line text-ink-muted hover:bg-canvas"}`}>
                {t(locale, o.label)}
              </button>
            );
          })}
          {types.length > 0 && (
            <button type="button" className="text-[11.5px] text-ink-muted hover:text-brand-orange ms-1" onClick={() => apply({ docTypes: [] })}>
              {t(locale, "Clear")}
            </button>
          )}
        </div>

        {/* downloads — no print action anywhere; each uses the filters currently applied */}
        <div className="flex flex-wrap items-center gap-2">
          {(["pdf", "xlsx", "csv"] as const).map((f) => (
            <a key={f} className={`btn btn-glass ${canDownload ? "" : "pointer-events-none opacity-50"}`} style={{ width: "auto" }}
              href={canDownload ? exportHref(f) : undefined} aria-disabled={!canDownload}>
              <Download className="size-3.5" />
              {t(locale, f === "pdf" ? "Download PDF" : f === "xlsx" ? "Download Excel" : "Download CSV")}
            </a>
          ))}
          {pending && <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted"><Loader2 className="size-3.5 animate-spin" /> {t(locale, "Updating…")}</span>}
        </div>
      </div>

      {/* ---------- states ---------- */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-[12.5px] text-danger">
          <AlertTriangle className="size-4 shrink-0 mt-px" /> <span>{error}</span>
        </div>
      )}

      {!error && selected == null && (
        <div className="rounded-[14px] border border-line p-10 text-center text-ink-muted text-[13px]">
          <FileText className="size-6 mx-auto mb-2 text-ink-faint" />
          {t(locale, kind === "client" ? "Select a client to view their statement." : "Select a vendor to view their statement.")}
        </div>
      )}

      {!error && selected != null && !statement && (
        <div className="rounded-[14px] border border-line p-10 text-center text-ink-muted text-[13px]">
          <Loader2 className={`size-5 mx-auto mb-2 ${pending ? "animate-spin" : ""}`} /> {t(locale, "Loading statement…")}
        </div>
      )}

      {/* ---------- statement ---------- */}
      {!error && statement && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: "Opening balance", value: statement.opening },
              { label: "Total debit", value: statement.totalDebit },
              { label: "Total credit", value: statement.totalCredit },
              { label: "Closing balance", value: statement.closing, strong: true },
            ].map((k) => (
              <div key={k.label} className="rounded-xl border border-line p-2.5">
                <div className="text-[10.5px] text-ink-faint uppercase tracking-wide">{t(locale, k.label)}</div>
                <div className={`text-[16px] ${k.strong ? "font-bold" : "font-semibold"}`}><Money amount={k.value} /></div>
              </div>
            ))}
          </div>

          {statement.lines.length === 0 ? (
            <div className="rounded-[14px] border border-line p-10 text-center text-ink-muted text-[13px]">
              {t(locale, "No transactions in this period.")}
            </div>
          ) : (
            // Horizontal scroll keeps every column reachable on a phone instead of clipping them.
            <div className="overflow-x-auto rounded-[14px] border border-line">
              <table className="w-full min-w-[760px] text-[12.5px]">
                <thead className="bg-canvas">
                  <tr>
                    <th className="text-start p-2.5">{t(locale, "Date")}</th>
                    <th className="text-start p-2.5">{t(locale, "Document type")}</th>
                    <th className="text-start p-2.5">{t(locale, "Number")}</th>
                    <th className="text-start p-2.5">{t(locale, "Description")}</th>
                    <th className="text-end p-2.5">{t(locale, "Debit")}</th>
                    <th className="text-end p-2.5">{t(locale, "Credit")}</th>
                    <th className="text-end p-2.5">{t(locale, "Balance")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-line bg-canvas/50">
                    <td className="p-2.5 text-ink-muted" colSpan={6}>{t(locale, "Opening balance")}</td>
                    <td className="p-2.5 text-end font-semibold"><Money amount={statement.opening} /></td>
                  </tr>
                  {statement.lines.map((l, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="p-2.5 font-mono whitespace-nowrap">{l.date}</td>
                      <td className="p-2.5">{t(locale, l.docTypeLabel)}</td>
                      <td className="p-2.5 font-mono">
                        {l.href && l.number
                          ? <Link href={l.href} className="hover:text-brand-orange">{l.number}</Link>
                          : (l.number || "—")}
                      </td>
                      <td className="p-2.5 text-ink-muted">{l.reference || l.description}</td>
                      <td className="p-2.5 text-end">{l.debit ? <Money amount={l.debit} /> : "—"}</td>
                      <td className="p-2.5 text-end">{l.credit ? <Money amount={l.credit} /> : "—"}</td>
                      <td className="p-2.5 text-end font-semibold"><Money amount={l.running} /></td>
                    </tr>
                  ))}
                  <tr className="border-t border-line-strong bg-canvas/50">
                    <td className="p-2.5 font-bold" colSpan={4}>{t(locale, "Closing balance")}</td>
                    <td className="p-2.5 text-end font-semibold"><Money amount={statement.totalDebit} /></td>
                    <td className="p-2.5 text-end font-semibold"><Money amount={statement.totalCredit} /></td>
                    <td className="p-2.5 text-end font-bold"><Money amount={statement.closing} /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
