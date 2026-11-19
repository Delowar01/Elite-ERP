import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Locale } from "@/lib/i18n/dict";
import { Interpolated, Ltr, PlatformStatusTag } from "./companies-kit";
import { pt } from "./i18n";

// ---------------------------------------------------------------------------------------------
// Invitation history building blocks (PO-02D2). Server-compatible (no hooks, no state): they receive
// FINISHED view models — every date is formatted on the server (src/lib/platform/display.ts) — so
// nothing here formats a date, reads a cookie or calls the server. No view model carries a token, its
// hash or a link: they do not exist outside the creating response. Latin-only values (e-mails, INV
// references) are isolated left-to-right so they never reorder inside Arabic text.
// ---------------------------------------------------------------------------------------------

export type InvitationLifecycleView = "pending" | "expired" | "revoked" | "accepted";
export type InvitationHistoryRowView = {
  id: string;
  href: string;
  reference: string;
  companyName: string;
  ownerEmail: string;
  country: string;
  state: InvitationLifecycleView;
  created: string;
  expires: string;
  ended: string | null;
};
export type InvitationEventView = { key: string; label: string; at: string; actor: string; reason: string | null; result: string; related: { text: string; reference: string; href: string } | null };

export function InvitationHistoryTable({ locale, rows, caption }: { locale: Locale; rows: InvitationHistoryRowView[]; caption: string }) {
  return (
    <div className="platform-company-table">
      <Table list>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{pt(locale, "col.company")}</TableHead>
            <TableHead>{pt(locale, "col.status")}</TableHead>
            <TableHead>{pt(locale, "col.ownerEmail")}</TableHead>
            <TableHead>{pt(locale, "col.country")}</TableHead>
            <TableHead>{pt(locale, "col.invited")}</TableHead>
            <TableHead>{pt(locale, "hist.endedOrExpires")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell wrap>
                <div className="platform-cell-company">
                  <Link href={row.href} className="platform-company-link" dir="auto">
                    {row.companyName}
                  </Link>
                  <div className="platform-cell-sub platform-invitation-ref">
                    <Ltr>{row.reference}</Ltr>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <PlatformStatusTag locale={locale} domain="invitation" value={row.state} />
              </TableCell>
              <TableCell>
                <Ltr>{row.ownerEmail}</Ltr>
              </TableCell>
              <TableCell>{row.country}</TableCell>
              <TableCell>{row.created}</TableCell>
              <TableCell>{row.ended ?? row.expires}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function InvitationHistoryCards({ locale, rows, label }: { locale: Locale; rows: InvitationHistoryRowView[]; label: string }) {
  return (
    <ul className="platform-record-cards" aria-label={label}>
      {rows.map((row) => (
        <li key={row.id} className="card platform-record-card">
          <div className="platform-record-head">
            <div className="min-w-0">
              <div className="platform-record-title">
                <Link href={row.href} className="platform-company-link" dir="auto">
                  {row.companyName}
                </Link>
              </div>
              <div className="platform-cell-sub">
                <Ltr>{row.reference}</Ltr>
              </div>
            </div>
            <PlatformStatusTag locale={locale} domain="invitation" value={row.state} />
          </div>
          <dl className="platform-record-fields">
            <div className="platform-record-wide">
              <dt>{pt(locale, "col.ownerEmail")}</dt>
              <dd>
                <Ltr>{row.ownerEmail}</Ltr>
              </dd>
            </div>
            <div>
              <dt>{pt(locale, "col.invited")}</dt>
              <dd>{row.created}</dd>
            </div>
            <div>
              <dt>{pt(locale, "hist.endedOrExpires")}</dt>
              <dd>{row.ended ?? row.expires}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

/** One invitation's lifecycle, oldest first: created / re-issued / revoked (with reasons and links), refusals. */
export function InvitationTimeline({ locale, events }: { locale: Locale; events: InvitationEventView[] }) {
  if (!events.length) return <p className="platform-fine-print">{pt(locale, "hist.noEvents")}</p>;
  return (
    <ol className="platform-timeline">
      {events.map((e) => (
        <li key={e.key} className="platform-timeline-item" data-result={e.result}>
          <div className="platform-timeline-head">
            <span className="platform-timeline-label">{e.label}</span>
            <PlatformStatusTag locale={locale} domain="audit_result" value={e.result} />
          </div>
          <div className="platform-cell-sub">
            {e.at} · <Interpolated template={pt(locale, "hist.by")} values={{ actor: <bdi dir="auto">{e.actor}</bdi> }} />
          </div>
          {e.related && (
            <div className="platform-cell-sub">
              {e.related.text}{" "}
              <Link href={e.related.href} className="platform-inline-link">
                <Ltr>{e.related.reference}</Ltr>
              </Link>
            </div>
          )}
          {e.reason && (
            <p className="platform-timeline-reason" dir="auto">
              {e.reason}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
