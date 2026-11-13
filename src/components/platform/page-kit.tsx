import type { LucideIcon } from "lucide-react";
import { ChevronDown, Inbox, Info, Lock, Search, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Locale } from "@/lib/i18n/dict";
import { pt, type PlatformStringKey } from "./i18n";

// ---------------------------------------------------------------------------------------------
// Building blocks for the console's section pages (PO-01B). Server-compatible (no hooks).
//
// PREVIEW RULE (PO-01B §7): a section whose management features arrive in a later phase renders its
// real layout — header, filters, table columns, panels — but every control is visibly marked
// "Preview · Planned for PO-0x" and is a disabled element: nothing here can submit, navigate to an
// unbuilt route or call the server. No figure, price or record is invented: values read "—" with
// "No data yet".
// ---------------------------------------------------------------------------------------------

export function PreviewBadge({ locale, phase }: { locale: Locale; phase?: string }) {
  return (
    <Badge variant="neutral" className="platform-preview-badge">
      <Lock className="size-3" aria-hidden />
      {pt(locale, "common.preview")}
      {phase && (
        <>
          <span aria-hidden>·</span>
          <span>{pt(locale, "common.phase", { phase })}</span>
        </>
      )}
    </Badge>
  );
}

export function ConsolePage({
  locale,
  title,
  description,
  phase,
  actions,
  children,
}: {
  locale: Locale;
  title: string;
  description: string;
  /** Set for a later-phase section: adds the preview badge and the preview notice. */
  phase?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="platform-page">
      <PageHeader title={title} description={description} meta={phase ? <PreviewBadge locale={locale} phase={phase} /> : undefined} actions={actions} />
      {phase && (
        <p className="platform-callout" data-tone="info">
          <Info className="size-4 shrink-0" aria-hidden />
          <span>{pt(locale, "state.previewNotice")}</span>
        </p>
      )}
      {children}
    </div>
  );
}

/** A later-phase action: shown so the layout is complete, disabled so it can never run. */
export function PreviewAction({ locale, label, icon: Icon, phase }: { locale: Locale; label: string; icon: LucideIcon; phase: string }) {
  const note = pt(locale, "common.phase", { phase });
  return (
    <Button type="button" variant="secondary" disabled aria-disabled="true" title={note} aria-label={`${label} — ${note}`}>
      <Icon aria-hidden />
      {label}
    </Button>
  );
}

/** A KPI tile with no invented value: "—" and "No data yet" until the phase that supplies the data. */
export function StatTile({ locale, label, icon: Icon, note }: { locale: Locale; label: string; icon: LucideIcon; note?: string }) {
  return (
    <div className="card platform-stat">
      <span className="platform-stat-icon" aria-hidden>
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <div className="platform-stat-label">{label}</div>
        <div className="platform-stat-value" aria-label={pt(locale, "common.noData")}>
          —
        </div>
        <div className="platform-stat-note">{note ?? pt(locale, "common.noData")}</div>
      </div>
    </div>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="platform-stat-grid">{children}</div>;
}

/** Search and filters laid out as they will work, all disabled (preview). */
export function PreviewToolbar({ locale, search, filters }: { locale: Locale; search: string; filters: PlatformStringKey[] }) {
  return (
    <div className="platform-toolbar" role="group" aria-label={`${pt(locale, "common.preview")}: ${search}`}>
      <label className="platform-toolbar-search">
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="sr-only">{search}</span>
        <input type="search" placeholder={search} disabled aria-disabled="true" />
      </label>
      <div className="platform-toolbar-filters">
        {filters.map((f) => (
          <button key={f} type="button" className="platform-filter" disabled aria-disabled="true">
            {pt(locale, f)}
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

/** The section's real columns with an empty body: the layout is reviewable before any data exists. */
export function PreviewTable({ locale, columns, empty, hint }: { locale: Locale; columns: PlatformStringKey[]; empty: string; hint: string }) {
  return (
    <Table list>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c}>{pt(locale, c)}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        <tr data-empty-row="">
          <td colSpan={columns.length} data-wrap="">
            <EmptyPanel icon={Inbox} message={empty} hint={hint} />
          </td>
        </tr>
      </TableBody>
    </Table>
  );
}

export function EmptyPanel({ icon: Icon, message, hint, action }: { icon: LucideIcon; message: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="platform-empty">
      <span className="platform-empty-icon" aria-hidden>
        <Icon className="size-5" />
      </span>
      <p className="platform-empty-title">{message}</p>
      {hint && <p className="platform-empty-hint">{hint}</p>}
      {action && <div className="platform-empty-action">{action}</div>}
    </div>
  );
}

/** A dashboard / settings panel: a card with a real <h2> heading. */
export function Panel({ title, meta, children, id }: { title: string; meta?: React.ReactNode; children: React.ReactNode; id: string }) {
  return (
    <section className="card platform-panel" aria-labelledby={id}>
      <div className="platform-panel-head">
        <h2 id={id}>{title}</h2>
        {meta}
      </div>
      <div className="platform-panel-body">{children}</div>
    </section>
  );
}

/** Shown when the session is valid but lacks the permission a page needs. */
export function DeniedState({ locale }: { locale: Locale }) {
  return <EmptyPanel icon={ShieldAlert} message={pt(locale, "state.denied")} />;
}
