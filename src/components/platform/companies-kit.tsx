import { Fragment } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight, ChevronsLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Locale } from "@/lib/i18n/dict";
import { pt } from "./i18n";

// ---------------------------------------------------------------------------------------------
// Company directory / detail building blocks (PO-02B). Server-compatible (no hooks, no state).
// They receive FINISHED view models — every date and number is already formatted on the server
// (src/lib/platform/display.ts) — so nothing here formats a date, reads a cookie or calls the
// server. Latin-only values (e-mails, ORG / INV references, currency codes, number ranges) are
// isolated left-to-right so they never reorder inside Arabic text; Arabic dates read naturally.
// Later-phase actions are disabled elements with their phase named (never operational).
// ---------------------------------------------------------------------------------------------

export type AccessView = { status: "active" | "suspended"; source: "legacy_default" | "access_control" | "invalid_state" };
export type OwnerView = { name: string; email: string };
export type CompanyRowView = {
  orgId: number;
  href: string;
  name: string;
  reference: string;
  country: string | null;
  currency: string;
  access: AccessView;
  owner: OwnerView | null;
  moreOwners: number;
  users: string;
  activeUsers: string;
  created: string;
  lastSignIn: string | null;
};
export type InvitationRowView = { reference: string; companyName: string; ownerEmail: string; country: string; created: string; expires: string; state: "pending" | "expired" };

/** A detail page: breadcrumbs above the page's one <h1> header (whose description may hold LTR islands). */
export function DetailPage({
  breadcrumbs,
  title,
  description,
  meta,
  actions,
  children,
}: {
  breadcrumbs: React.ReactNode;
  title: string;
  description: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="platform-page">
      {breadcrumbs}
      <PageHeader title={<span dir="auto">{title}</span>} description={description} meta={meta} actions={actions} />
      {children}
    </div>
  );
}

/** A whole-page state (not found, unavailable): the page's single <h1>, a hint and a way back. */
export function PageState({ icon: Icon, title, hint, action, tone }: { icon: LucideIcon; title: string; hint: string; action?: React.ReactNode; tone?: "danger" }) {
  return (
    <div className="platform-page">
      <div className="platform-empty platform-error" role={tone === "danger" ? "alert" : undefined}>
        <span className="platform-empty-icon" data-tone={tone} aria-hidden>
          <Icon className="size-5" />
        </span>
        <h1 className="platform-empty-title">{title}</h1>
        <p className="platform-empty-hint">{hint}</p>
        {action && <div className="platform-empty-action">{action}</div>}
      </div>
    </div>
  );
}

/** A left-to-right island for Latin-only values inside either language. */
export function Ltr({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

/** Fill a translated template ("Showing {range} of {total}") with nodes, e.g. LTR islands. */
export function Interpolated({ template, values }: { template: string; values: Record<string, React.ReactNode> }) {
  return (
    <>
      {template.split(/(\{[a-z]+\})/g).map((part, i) => {
        const key = /^\{([a-z]+)\}$/.exec(part)?.[1];
        return <Fragment key={i}>{key && key in values ? values[key] : part}</Fragment>;
      })}
    </>
  );
}

/** Effective company access: a text label (never colour alone) plus the compatibility source when it matters. */
export function AccessPill({ locale, access }: { locale: Locale; access: AccessView }) {
  const note = access.source === "legacy_default" ? pt(locale, "access.legacy") : access.source === "invalid_state" ? pt(locale, "access.invalid") : null;
  return (
    <span className="platform-access">
      <Badge variant={access.status === "active" ? "success" : "danger"}>{pt(locale, access.status === "active" ? "access.active" : "access.suspended")}</Badge>
      {note && <span className="platform-access-note">{note}</span>}
    </span>
  );
}

/** A KPI tile with a real, server-derived value; optionally a link into the matching filtered list. */
export function MetricTile({ label, value, icon: Icon, note, href, current }: { label: string; value: string; icon: LucideIcon; note?: string; href?: string; current?: boolean }) {
  const body = (
    <>
      <span className="platform-stat-icon" aria-hidden>
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <div className="platform-stat-label">{label}</div>
        <div className="platform-stat-value platform-stat-live">{value}</div>
        {note && <div className="platform-stat-note">{note}</div>}
      </div>
    </>
  );
  if (!href) return <div className="card platform-stat">{body}</div>;
  return (
    <Link href={href} className="card platform-stat platform-stat-link" aria-current={current ? "page" : undefined}>
      {body}
    </Link>
  );
}

/** A later-phase action: visible so the layout is complete, disabled so it can never run. */
export function DisabledAction({ locale, label, icon: Icon, phase }: { locale: Locale; label: string; icon: LucideIcon; phase?: string }) {
  const note = phase ? pt(locale, "common.phase", { phase }) : pt(locale, "common.later");
  return (
    <Button type="button" variant="secondary" disabled aria-disabled="true" title={note} aria-label={`${label} — ${note}`}>
      <Icon aria-hidden />
      {label}
    </Button>
  );
}

export function FieldGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="platform-fields">
      {items.map((item) => (
        <div key={item.label} className="platform-field">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Breadcrumbs({ locale, items }: { locale: Locale; items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label={pt(locale, "company.breadcrumb")} className="platform-breadcrumbs">
      <ol>
        {items.map((item, i) => (
          <li key={`${i}-${item.label}`}>
            {item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
            {i < items.length - 1 && <ChevronRight className="size-3.5 platform-dir-icon" aria-hidden />}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The Registered / Pending invitations switch: real links, the current one marked for assistive tech. */
export function ViewSegments({ label, items }: { label: string; items: { label: string; href: string; current: boolean; count: string }[] }) {
  return (
    <nav aria-label={label} className="platform-segments">
      {items.map((item) => (
        <Link key={item.href} href={item.href} className="platform-segment" aria-current={item.current ? "page" : undefined}>
          {item.label}
          <span className="platform-segment-count">
            <Ltr>{item.count}</Ltr>
          </span>
        </Link>
      ))}
    </nav>
  );
}

/** Keyset pagination: first / previous / next as plain links (each a fixed /platform path built on the server). */
export function Pager({ locale, summary, firstHref, prevHref, nextHref }: { locale: Locale; summary: React.ReactNode; firstHref: string | null; prevHref: string | null; nextHref: string | null }) {
  return (
    <nav className="platform-pager" aria-label={pt(locale, "pager.label")}>
      <p className="platform-pager-summary">{summary}</p>
      <div className="platform-pager-links">
        {firstHref && (
          <Link className="platform-pager-link" href={firstHref}>
            <ChevronsLeft className="size-4 platform-dir-icon" aria-hidden />
            {pt(locale, "pager.first")}
          </Link>
        )}
        {prevHref ? (
          <Link className="platform-pager-link" href={prevHref} rel="prev">
            <ChevronLeft className="size-4 platform-dir-icon" aria-hidden />
            {pt(locale, "pager.prev")}
          </Link>
        ) : (
          <span className="platform-pager-link" aria-disabled="true">
            <ChevronLeft className="size-4 platform-dir-icon" aria-hidden />
            {pt(locale, "pager.prev")}
          </span>
        )}
        {nextHref ? (
          <Link className="platform-pager-link" href={nextHref} rel="next">
            {pt(locale, "pager.next")}
            <ChevronRight className="size-4 platform-dir-icon" aria-hidden />
          </Link>
        ) : (
          <span className="platform-pager-link" aria-disabled="true">
            {pt(locale, "pager.next")}
            <ChevronRight className="size-4 platform-dir-icon" aria-hidden />
          </span>
        )}
      </div>
    </nav>
  );
}

function OwnerCell({ locale, owner, more }: { locale: Locale; owner: OwnerView | null; more: number }) {
  if (!owner) return <span className="platform-cell-sub">{pt(locale, "companies.noOwner")}</span>;
  return (
    <div className="platform-cell-owner">
      <div dir="auto">{owner.name}</div>
      <div className="platform-cell-sub platform-email">
        <Ltr>{owner.email}</Ltr>
      </div>
      {more > 0 && <div className="platform-cell-sub">{pt(locale, "companies.moreOwners", { n: more })}</div>}
    </div>
  );
}

/** Wide screens: the directory as a table (it scrolls inside its own frame when narrower than its columns). */
export function CompanyTable({ locale, rows, caption }: { locale: Locale; rows: CompanyRowView[]; caption: string }) {
  return (
    <div className="platform-company-table">
      <Table list>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{pt(locale, "col.company")}</TableHead>
            <TableHead>{pt(locale, "col.countryCurrency")}</TableHead>
            <TableHead>{pt(locale, "col.access")}</TableHead>
            <TableHead>{pt(locale, "col.owner")}</TableHead>
            <TableHead numeric>{pt(locale, "col.users")}</TableHead>
            <TableHead>{pt(locale, "col.created")}</TableHead>
            <TableHead>{pt(locale, "col.lastUserSignIn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.orgId}>
              <TableCell wrap>
                <div className="platform-cell-company">
                  <Link href={row.href} className="platform-company-link" dir="auto">
                    {row.name}
                  </Link>
                  <div className="platform-cell-sub">
                    <Ltr>{row.reference}</Ltr>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div>{row.country ?? "—"}</div>
                <div className="platform-cell-sub">
                  <Ltr>{row.currency}</Ltr>
                </div>
              </TableCell>
              <TableCell>
                <AccessPill locale={locale} access={row.access} />
              </TableCell>
              <TableCell wrap>
                <OwnerCell locale={locale} owner={row.owner} more={row.moreOwners} />
              </TableCell>
              <TableCell numeric>
                <div>{row.users}</div>
                <div className="platform-cell-sub">{pt(locale, "companies.usersActive", { n: row.activeUsers })}</div>
              </TableCell>
              <TableCell>{row.created}</TableCell>
              <TableCell>{row.lastSignIn ?? <span className="platform-cell-sub">{pt(locale, "companies.noSignIn")}</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Phones: one record card per company with every field of the table row (not a squeezed table). */
export function CompanyCards({ locale, rows, label }: { locale: Locale; rows: CompanyRowView[]; label: string }) {
  return (
    <ul className="platform-record-cards" aria-label={label}>
      {rows.map((row) => (
        <li key={row.orgId} className="card platform-record-card">
          <div className="platform-record-head">
            <div className="min-w-0">
              <Link href={row.href} className="platform-company-link" dir="auto">
                {row.name}
              </Link>
              <div className="platform-cell-sub">
                <Ltr>{row.reference}</Ltr>
              </div>
            </div>
            <AccessPill locale={locale} access={row.access} />
          </div>
          <dl className="platform-record-fields">
            <div className="platform-record-wide">
              <dt>{pt(locale, "col.owner")}</dt>
              <dd>
                <OwnerCell locale={locale} owner={row.owner} more={row.moreOwners} />
              </dd>
            </div>
            <div>
              <dt>{pt(locale, "col.country")}</dt>
              <dd>{row.country ?? "—"}</dd>
            </div>
            <div>
              <dt>{pt(locale, "col.currency")}</dt>
              <dd>
                <Ltr>{row.currency}</Ltr>
              </dd>
            </div>
            <div>
              <dt>{pt(locale, "col.users")}</dt>
              <dd>
                {row.users} <span className="platform-cell-sub">{pt(locale, "companies.usersActive", { n: row.activeUsers })}</span>
              </dd>
            </div>
            <div>
              <dt>{pt(locale, "col.created")}</dt>
              <dd>{row.created}</dd>
            </div>
            <div>
              <dt>{pt(locale, "col.lastUserSignIn")}</dt>
              <dd>{row.lastSignIn ?? <span className="platform-cell-sub">{pt(locale, "companies.noSignIn")}</span>}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function InvitationState({ locale, state }: { locale: Locale; state: InvitationRowView["state"] }) {
  return <Badge variant={state === "pending" ? "info" : "warning"}>{pt(locale, state === "pending" ? "inv.statePending" : "inv.stateExpired")}</Badge>;
}

export function InvitationTable({ locale, rows, caption }: { locale: Locale; rows: InvitationRowView[]; caption: string }) {
  return (
    <div className="platform-company-table">
      <Table list>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{pt(locale, "col.reference")}</TableHead>
            <TableHead>{pt(locale, "col.company")}</TableHead>
            <TableHead>{pt(locale, "col.ownerEmail")}</TableHead>
            <TableHead>{pt(locale, "col.country")}</TableHead>
            <TableHead>{pt(locale, "col.invited")}</TableHead>
            <TableHead>{pt(locale, "col.expires")}</TableHead>
            <TableHead>{pt(locale, "col.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.reference + row.created}>
              <TableCell>
                <Ltr>{row.reference}</Ltr>
              </TableCell>
              <TableCell wrap>
                <div className="platform-cell-company" dir="auto">
                  {row.companyName}
                </div>
              </TableCell>
              <TableCell>
                <Ltr>{row.ownerEmail}</Ltr>
              </TableCell>
              <TableCell>{row.country}</TableCell>
              <TableCell>{row.created}</TableCell>
              <TableCell>{row.expires}</TableCell>
              <TableCell>
                <InvitationState locale={locale} state={row.state} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function InvitationCards({ locale, rows, label }: { locale: Locale; rows: InvitationRowView[]; label: string }) {
  return (
    <ul className="platform-record-cards" aria-label={label}>
      {rows.map((row) => (
        <li key={row.reference + row.created} className="card platform-record-card">
          <div className="platform-record-head">
            <div className="min-w-0">
              <div className="platform-record-title" dir="auto">
                {row.companyName}
              </div>
              <div className="platform-cell-sub">
                <Ltr>{row.reference}</Ltr>
              </div>
            </div>
            <InvitationState locale={locale} state={row.state} />
          </div>
          <dl className="platform-record-fields">
            <div className="platform-record-wide">
              <dt>{pt(locale, "col.ownerEmail")}</dt>
              <dd>
                <Ltr>{row.ownerEmail}</Ltr>
              </dd>
            </div>
            <div>
              <dt>{pt(locale, "col.country")}</dt>
              <dd>{row.country}</dd>
            </div>
            <div>
              <dt>{pt(locale, "col.invited")}</dt>
              <dd>{row.created}</dd>
            </div>
            <div>
              <dt>{pt(locale, "col.expires")}</dt>
              <dd>{row.expires}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

/**
 * Monthly registrations: one series, so one colour and no legend box (the panel title names it).
 * Columns ≤ 24 px with a 4 px rounded end on a single baseline; every month's count is printed as
 * text on its column and the whole chart is an ordered list a screen reader reads as "month: count"
 * (the table-view twin), so no value is colour- or hover-only.
 */
export function RegistrationsChart({ months, label }: { months: { key: string; label: string; count: number; countText: string; description: string }[]; label: string }) {
  const max = Math.max(1, ...months.map((m) => m.count));
  return (
    <ol className="platform-bars" aria-label={label}>
      {months.map((m) => (
        <li key={m.key} className="platform-bar-item">
          <span className="sr-only">{m.description}</span>
          <span className="platform-bar-value" aria-hidden>
            {m.countText}
          </span>
          <span className="platform-bar-track" aria-hidden>
            <span className="platform-bar" style={{ blockSize: `${Math.round((m.count / max) * 100)}%` }} data-zero={m.count === 0 ? "" : undefined} />
          </span>
          <span className="platform-bar-label" aria-hidden>
            {m.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
