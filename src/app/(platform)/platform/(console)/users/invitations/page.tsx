import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Database, Info, MailPlus, SearchX } from "lucide-react";
import { Interpolated, Ltr, Pager, PlatformStatusTag } from "@/components/platform/companies-kit";
import { pt } from "@/components/platform/i18n";
import { ConsolePage, DeniedState, EmptyPanel } from "@/components/platform/page-kit";
import { InviteUserControl, UserInvitationRowActions } from "@/components/platform/user-invitation-dialogs";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Locale } from "@/lib/i18n/dict";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE } from "@/lib/platform/config";
import { formatPlatformCount, formatPlatformDateTime } from "@/lib/platform/display";
import { isPlatformError } from "@/lib/platform/errors";
import { isCustomerUserInviteAcceptanceEnabled, isPlatformUserInvitationsEnabled } from "@/lib/platform/flags";
import { requirePlatformSession } from "@/lib/platform/guards";
import { listUserInvitations, USER_INVITATION_STATES, type UserInvitationPage, type UserInvitationRow } from "@/lib/platform/user-invitations";

// User invitations (PO-03C, sub-batch C): every invitation of a NEW user into an EXISTING company — of one company
// (?org=) or all — newest first, with status, search and pages as plain GET links and forms. The whole page is a 404
// while PLATFORM_USER_INVITATIONS_ENABLED is not "true"; where the staged table is not installed it says so. Rows come
// from the allow-listed read model (never a token, its hash or a link). The invite dialog's server action re-authorizes
// and steps up on its own.

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => v;
const ROLE_KEY = { admin: "role.admin", staff: "role.staff" } as const;
const STATE_LABEL = { pending: "inv.statePending", expired: "inv.stateExpired", revoked: "inv.stateRevoked", accepted: "inv.stateAccepted" } as const;

function href(base: { q?: string | null; state?: string | null; org?: number | null; after?: string | null }) {
  const p = new URLSearchParams();
  if (base.q) p.set("q", base.q);
  if (base.state) p.set("state", base.state);
  if (base.org) p.set("org", String(base.org));
  if (base.after) p.set("after", base.after);
  const s = p.toString();
  return s ? `/platform/users/invitations?${s}` : "/platform/users/invitations";
}

const targetOf = (r: UserInvitationRow) => ({ id: r.id, reference: r.reference, email: r.email, state: r.state });

function InvitationRows({ locale, rows }: { locale: Locale; rows: UserInvitationRow[] }) {
  const withActions = rows.some((r) => r.state !== "accepted");
  return (
    <>
      <div className="platform-company-table">
        <Table list>
          <caption className="sr-only">{pt(locale, "uinv.title")}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>{pt(locale, "uinv.colInvitee")}</TableHead>
              <TableHead>{pt(locale, "col.company")}</TableHead>
              <TableHead>{pt(locale, "col.role")}</TableHead>
              <TableHead>{pt(locale, "col.status")}</TableHead>
              <TableHead>{pt(locale, "col.invited")}</TableHead>
              <TableHead>{pt(locale, "hist.endedOrExpires")}</TableHead>
              {withActions && <TableHead>{pt(locale, "inv.actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} data-testid={`uinv-row-${r.id}`}>
                <TableCell wrap>
                  <div className="platform-cell-company">
                    <Link href={`/platform/users/invitations/${r.id}`} className="platform-company-link" dir="auto">
                      {r.name}
                    </Link>
                    <div className="platform-cell-sub">
                      <Ltr>{r.email}</Ltr> · <span className="whitespace-nowrap">
                        <Ltr>{r.reference}</Ltr>
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell wrap>
                  <Link href={`/platform/companies/${r.orgId}`} className="platform-inline-link" dir="auto">
                    {r.companyName}
                  </Link>
                </TableCell>
                <TableCell>{pt(locale, ROLE_KEY[r.role])}</TableCell>
                <TableCell>
                  <PlatformStatusTag locale={locale} domain="invitation" value={r.state} />
                </TableCell>
                <TableCell>{formatPlatformDateTime(r.createdAt, locale)}</TableCell>
                <TableCell>{formatPlatformDateTime(r.revokedAt ?? r.acceptedAt ?? r.expiresAt, locale)}</TableCell>
                {withActions && <TableCell>{r.state !== "accepted" && <UserInvitationRowActions locale={locale} target={targetOf(r)} />}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="platform-record-cards" aria-label={pt(locale, "uinv.title")}>
        {rows.map((r) => (
          <li key={r.id} className="card platform-record-card">
            <div className="platform-record-head">
              <div className="min-w-0">
                <div className="platform-record-title">
                  <Link href={`/platform/users/invitations/${r.id}`} className="platform-company-link" dir="auto">
                    {r.name}
                  </Link>
                </div>
                <div className="platform-cell-sub">
                  <Ltr>{r.reference}</Ltr>
                </div>
              </div>
              <PlatformStatusTag locale={locale} domain="invitation" value={r.state} />
            </div>
            <dl className="platform-record-fields">
              <div className="platform-record-wide">
                <dt>{pt(locale, "uinv.email")}</dt>
                <dd>
                  <Ltr>{r.email}</Ltr>
                </dd>
              </div>
              <div className="platform-record-wide">
                <dt>{pt(locale, "col.company")}</dt>
                <dd dir="auto">{r.companyName}</dd>
              </div>
              <div>
                <dt>{pt(locale, "col.role")}</dt>
                <dd>{pt(locale, ROLE_KEY[r.role])}</dd>
              </div>
              <div>
                <dt>{pt(locale, "hist.endedOrExpires")}</dt>
                <dd>{formatPlatformDateTime(r.revokedAt ?? r.acceptedAt ?? r.expiresAt, locale)}</dd>
              </div>
            </dl>
            {r.state !== "accepted" && (
              <div className="platform-record-actions">
                <UserInvitationRowActions locale={locale} target={targetOf(r)} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

type PageQuery = Promise<SearchParams>;

export default async function PlatformUserInvitationsPage({ searchParams }: { searchParams: PageQuery }) {
  await requirePlatformSession();
  if (!isPlatformUserInvitationsEnabled()) notFound();
  const [locale, params, store, requestHeaders] = await Promise.all([getLocale(), searchParams, cookies(), headers()]);
  const req = { headers: requestHeaders, token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };

  let page: UserInvitationPage | null = null;
  let failure: "FORBIDDEN" | "NOT_INSTALLED" | "INVALID" | null = null;
  try {
    page = await listUserInvitations(req, { state: first(params.state), q: first(params.q), org: first(params.org), after: first(params.after) });
  } catch (err) {
    if (isPlatformError(err, "UNAUTHORIZED") || isPlatformError(err, "SESSION_EXPIRED")) redirect("/platform/session-expired");
    if (isPlatformError(err, "USER_INVITATIONS_DISABLED")) notFound();
    if (isPlatformError(err, "FORBIDDEN")) failure = "FORBIDDEN";
    else if (isPlatformError(err, "USER_INVITATIONS_NOT_INSTALLED")) failure = "NOT_INSTALLED";
    else if (isPlatformError(err, "VALIDATION_FAILED") || isPlatformError(err, "NOT_FOUND")) failure = "INVALID";
    else throw err; // → the console error boundary (generic message + retry)
  }

  const header = {
    locale,
    title: pt(locale, "uinv.title"),
    description: pt(locale, isCustomerUserInviteAcceptanceEnabled() ? "uinv.subtitleOpen" : "uinv.subtitle"),
    actions: page?.company ? <InviteUserControl locale={locale} orgId={page.company.orgId} companyName={page.company.name} /> : undefined,
  };
  if (failure === "FORBIDDEN") {
    return (
      <ConsolePage {...header}>
        <DeniedState locale={locale} />
      </ConsolePage>
    );
  }
  if (failure === "NOT_INSTALLED") {
    return (
      <ConsolePage {...header}>
        <div className="card">
          <EmptyPanel icon={Database} message={pt(locale, "uinv.notInstalledTitle")} hint={pt(locale, "uinv.notInstalledText")} />
        </div>
      </ConsolePage>
    );
  }

  const q = page?.q ?? "";
  const state = page?.state ?? "";
  const org = page?.company?.orgId ?? null;
  const rows = page?.rows ?? [];
  const filtered = !!(page && (page.q || page.state || page.company));
  const rangeNode = page ? <Ltr>{`${formatPlatformCount(page.offset + 1)}–${formatPlatformCount(page.offset + rows.length)}`}</Ltr> : null;
  const totalNode = page ? <Ltr>{formatPlatformCount(page.total)}</Ltr> : null;

  return (
    <ConsolePage {...header}>
      {page?.company && (
        <p className="platform-callout" data-tone="info">
          <Info className="size-4 shrink-0" aria-hidden />
          <span>
            <Interpolated template={pt(locale, "uinv.companyFilter")} values={{ company: <bdi>{page.company.name}</bdi> }} /> <Ltr>{page.company.reference}</Ltr>{" "}
            <Link href={href({ q, state })} className="platform-inline-link">
              {pt(locale, "uinv.allCompanies")}
            </Link>
          </span>
        </p>
      )}
      <form method="get" action="/platform/users/invitations" role="search" key={JSON.stringify([q, state, org])} aria-label={pt(locale, "uinv.title")} className="card platform-filters">
        <div className="platform-filter-field platform-filter-search">
          <label htmlFor="uinv-q">{pt(locale, "cu.searchLabel")}</label>
          <input id="uinv-q" name="q" type="search" className="platform-input" defaultValue={q} maxLength={100} placeholder={pt(locale, "uinv.searchPlaceholder")} dir="auto" />
        </div>
        <div className="platform-filter-field">
          <label htmlFor="uinv-state">{pt(locale, "filter.status")}</label>
          <select id="uinv-state" name="state" className="platform-select" defaultValue={state}>
            <option value="">{pt(locale, "uinv.stateAll")}</option>
            {USER_INVITATION_STATES.map((s) => (
              <option key={s} value={s}>
                {pt(locale, STATE_LABEL[s])}
              </option>
            ))}
          </select>
        </div>
        {org !== null && <input type="hidden" name="org" value={String(org)} />}
        <div className="platform-filter-actions">
          <Button type="submit">{pt(locale, "action.apply")}</Button>
          <Link href={href({ org })} className="platform-inline-link">
            {pt(locale, "action.clear")}
          </Link>
        </div>
      </form>

      {!page ? (
        <div className="platform-callout" data-tone="warning" role="alert">
          <Info className="size-4 shrink-0" aria-hidden />
          <span>
            {pt(locale, "companies.invalidQuery")}{" "}
            <Link href="/platform/users/invitations" className="platform-inline-link">
              {pt(locale, "companies.startOver")}
            </Link>
          </span>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">{filtered ? <EmptyPanel icon={SearchX} message={pt(locale, "uinv.noneMatch")} /> : <EmptyPanel icon={MailPlus} message={pt(locale, "uinv.empty")} />}</div>
      ) : (
        <>
          <InvitationRows locale={locale} rows={rows} />
          <Pager
            locale={locale}
            summary={<Interpolated template={pt(locale, "companies.showing")} values={{ range: rangeNode, total: totalNode }} />}
            firstHref={page.offset > 0 ? href({ q, state, org }) : null}
            prevHref={null}
            nextHref={page.next ? href({ q, state, org, after: page.next }) : null}
          />
        </>
      )}
      <p className="platform-fine-print">{pt(locale, "hist.note")}</p>
    </ConsolePage>
  );
}
