import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleAlert, MailPlus, Pencil, Receipt, ShieldOff, UserCheck, UserCog, UserMinus, Users } from "lucide-react";
import { AccessPill, Breadcrumbs, DetailPage, DisabledAction, FieldGrid, Interpolated, Ltr, MetricTile, PageState, PlatformStatusTag } from "@/components/platform/companies-kit";
import { CompanyAccessControl } from "@/components/platform/company-access-dialog";
import { CompanyTabs, type CompanyTabValue } from "@/components/platform/company-tabs";
import { pt } from "@/components/platform/i18n";
import { EmptyPanel, PreviewBadge } from "@/components/platform/page-kit";
import { PrimaryOwnerTransfer } from "@/components/platform/primary-owner-transfer";
import { InviteUserControl, UserInvitationRowActions } from "@/components/platform/user-invitation-dialogs";
import { SeatBreakdown, SeatLimitText } from "@/components/platform/users-kit";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Locale } from "@/lib/i18n/dict";
import { getLocale } from "@/lib/i18n/server";
import { getCompanyDetail, type CompanyDetail } from "@/lib/platform/companies";
import { PLATFORM_SESSION_COOKIE } from "@/lib/platform/config";
import { formatPlatformCount, formatPlatformDate, formatPlatformDateTime, seatBreakdownView, seatLimitState } from "@/lib/platform/display";
import { isPlatformError } from "@/lib/platform/errors";
import { requirePlatformSession } from "@/lib/platform/guards";
import { listCompanyUserInvitations, type CompanyUserInvitations } from "@/lib/platform/user-invitations";

// One company (PO-02B): Overview, Access & controls, Users, Subscription (later phase) and Activity,
// from the allow-listed read model. Loading this page is an audited view ("company.viewed"): if the
// audit record cannot be written, no company data is rendered at all. Malformed or unknown ids are
// a 404. PO-02C: Suspend / Reactivate (header and Access & controls) open the confirmation dialog,
// whose server action re-authorizes and steps up on its own; every other action is still disabled.
// PO-03C: the Users tab's Primary owner panel opens the primary-owner transfer (its own server action,
// re-authorized and stepped up on its own); a company with no designated primary owner is never transferred.
// PO-03C (sub-batch C): the Users tab's User invitations panel — only while PLATFORM_USER_INVITATIONS_ENABLED is "true"
// (otherwise it is absent) — lists the company's open invitations and opens Invite user (its own server action, also
// re-authorized and stepped up on its own). A missing table or an unreadable list is a note, never a broken page.

type SearchParams = Record<string, string | string[] | undefined>;
const TABS: CompanyTabValue[] = ["overview", "access", "users", "subscription", "activity"];
const ACTION_LABEL: Record<
  string,
  "event.companyViewed" | "event.companySuspended" | "event.companyReactivated" | "event.suspendRejected" | "event.reactivateRejected" | "event.ownerTransferred" | "event.ownerTransferRejected"
> = {
  "company.viewed": "event.companyViewed",
  "company.suspended": "event.companySuspended",
  "company.reactivated": "event.companyReactivated",
  "company.suspend.rejected": "event.suspendRejected",
  "company.reactivate.rejected": "event.reactivateRejected",
  "company.primary_owner_transferred": "event.ownerTransferred",
  "company.primary_owner_transfer.rejected": "event.ownerTransferRejected",
};

function sourceText(locale: Locale, source: CompanyDetail["access"]["source"]): string {
  return pt(locale, source === "access_control" ? "source.record" : source === "legacy_default" ? "source.legacy" : "source.invalid");
}

function OverviewPanel({ locale, d }: { locale: Locale; d: CompanyDetail }) {
  return (
    <div className="card platform-detail-card">
      <FieldGrid
        items={[
          { label: pt(locale, "field.name"), value: <span dir="auto">{d.name}</span> },
          { label: pt(locale, "field.orgId"), value: <Ltr>{d.reference}</Ltr> },
          { label: pt(locale, "field.industry"), value: d.industry ? <span dir="auto">{d.industry}</span> : pt(locale, "common.notSet") },
          { label: pt(locale, "col.country"), value: d.country ?? pt(locale, "common.notSet") },
          { label: pt(locale, "field.currency"), value: <Ltr>{d.currency}</Ltr> },
          { label: pt(locale, "field.registered"), value: formatPlatformDateTime(d.createdAt, locale) },
          { label: pt(locale, "field.logo"), value: pt(locale, d.hasLogo ? "logo.yes" : "logo.no") },
          { label: pt(locale, "nav.users"), value: `${formatPlatformCount(d.users.total)} · ${pt(locale, "companies.usersActive", { n: formatPlatformCount(d.users.active) })}` },
          { label: pt(locale, "col.lastUserSignIn"), value: d.users.lastSignInAt ? formatPlatformDateTime(d.users.lastSignInAt, locale) : pt(locale, "companies.noSignIn") },
        ]}
      />
      <p className="platform-fine-print mt-4">{pt(locale, "company.overviewNote")}</p>
    </div>
  );
}

function AccessPanel({ locale, d }: { locale: Locale; d: CompanyDetail }) {
  const active = d.access.status === "active";
  return (
    <div className="platform-settings-stack">
      <div className="card platform-detail-card">
        <FieldGrid
          items={[
            { label: pt(locale, "field.status"), value: <AccessPill locale={locale} access={{ status: d.access.status, source: d.access.source }} /> },
            { label: pt(locale, "field.source"), value: sourceText(locale, d.access.source) },
            { label: pt(locale, "field.lastChange"), value: d.access.changedAt ? formatPlatformDateTime(d.access.changedAt, locale) : pt(locale, "common.none") },
            { label: pt(locale, "field.changedBy"), value: d.access.changedBy ? <span dir="auto">{d.access.changedBy}</span> : pt(locale, "common.none") },
            { label: pt(locale, "field.reason"), value: d.access.reason ? <span dir="auto">{d.access.reason}</span> : pt(locale, "common.none") },
          ]}
        />
        <p className="platform-callout mt-4" data-tone="neutral">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          <span>{pt(locale, active ? "access.explainActive" : d.access.enforced ? "access.explainSuspended" : "access.explainSuspendedOff")}</span>
        </p>
      </div>
      <div className="card platform-detail-card platform-detail-actions">
        <CompanyAccessControl locale={locale} orgId={d.orgId} reference={d.reference} companyName={d.name} status={d.access.status} enforced={d.access.enforced} noteId="company-access-enforcement" />
        <p className="platform-fine-print">{pt(locale, "access.controlsNote")}</p>
        {!d.access.enforced && (
          <p id="company-access-enforcement" className="platform-fine-print">
            {pt(locale, "access.enforcementOff")}
          </p>
        )}
        <p className="platform-fine-print">{pt(locale, "access.independent")}</p>
      </div>
    </div>
  );
}

// PO-03A: read-only Users & seats — the shared seat accounting and the primary-owner mapping. PO-03D: who occupies the
// seats, and whether the user limit is enforced (only while enforcement is on AND the company has a subscription).
const count = (value: number) => <Ltr>{formatPlatformCount(value)}</Ltr>;
const isolated = (value: string) => <bdi>{value}</bdi>;

function SeatsPanel({ locale, d }: { locale: Locale; d: CompanyDetail }) {
  const s = d.seats;
  const owner = d.primaryOwner;
  const items: { label: string; value: React.ReactNode }[] = [];
  if (!s) items.push({ label: pt(locale, "seats.occupied"), value: pt(locale, "seats.unavailable") });
  else {
    const a = s.allowance;
    items.push({
      label: pt(locale, "seats.occupied"),
      value: a.state === "assigned" ? <Interpolated template={pt(locale, "seats.occupiedOf")} values={{ occupied: count(s.occupied), seats: count(a.seats) }} /> : count(s.occupied),
    });
    items.push({ label: pt(locale, "seats.breakdownLabel"), value: <SeatBreakdown locale={locale} view={seatBreakdownView(s)} /> });
    items.push({
      label: pt(locale, "seats.allowance"),
      value:
        a.state === "assigned" ? (
          <>
            <Interpolated template={pt(locale, "seats.allowanceFrom")} values={{ seats: count(a.seats), package: isolated(a.packageName), version: count(a.versionNumber) }} />
            <span className="platform-cell-sub">{pt(locale, "seats.until", { date: formatPlatformDate(new Date(`${a.endDate}T12:00:00Z`), locale) })}</span>
          </>
        ) : (
          pt(locale, a.state === "none" ? "seats.noSubscription" : "seats.notInstalled")
        ),
    });
    // Above the allowance, Remaining is 0 and the callout below states the (informational) excess once.
    if (a.state === "assigned") items.push({ label: pt(locale, "seats.remaining"), value: count(s.remaining ?? 0) });
    items.push({ label: pt(locale, "seats.activeUsers"), value: count(s.users.active) });
    items.push({ label: pt(locale, "seats.disabledUsers"), value: count(s.users.disabled) });
  }
  items.push({ label: pt(locale, "seats.enforcementLabel"), value: <SeatLimitText locale={locale} state={seatLimitState(s)} /> });
  items.push({
    label: pt(locale, "seats.primaryOwner"),
    value:
      owner.state === "designated" ? (
        <>
          <span className="platform-owner-name" dir="auto">
            {owner.name}
          </span>
          <span className="platform-cell-sub">
            <Ltr>{owner.email}</Ltr>
          </span>
          {!owner.activeOwner && <span className="platform-cell-sub">{pt(locale, "seats.ownerDrift")}</span>}
        </>
      ) : (
        pt(locale, owner.state === "not_designated" ? "seats.notDesignated" : owner.state === "not_installed" ? "seats.ownerNotInstalled" : "seats.ownerUnavailable")
      ),
  });
  const legacy = owner.state === "not_designated" && s?.allowance.state === "none";
  return (
    <section className="card platform-panel" aria-labelledby="company-seats" data-testid="company-seats">
      <div className="platform-panel-head">
        <h2 id="company-seats">{pt(locale, "seats.title")}</h2>
      </div>
      <div className="platform-panel-body">
        <FieldGrid items={items} />
        {s?.overLimit && (
          <p className="platform-callout mt-4" data-tone="neutral">
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            <span>
              <Interpolated template={pt(locale, s.enforced ? "seats.overByEnforced" : "seats.overBy")} values={{ n: count(s.overBy) }} />
            </span>
          </p>
        )}
        {s && s.enforced && !s.overLimit && s.remaining === 0 && (
          <p className="platform-callout mt-4" data-tone="neutral" data-testid="seats-limit-reached">
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            <span>{pt(locale, "seats.limitReached")}</span>
          </p>
        )}
        {legacy && <p className="platform-fine-print mt-4">{pt(locale, "seats.legacyNote")}</p>}
        <p className="platform-fine-print mt-4">{pt(locale, s?.enforced ? "seats.noteEnforced" : "seats.note")}</p>
      </div>
    </section>
  );
}

/** PO-03C: the primary-owner transfer. The dialog re-reads the company's owners; the server re-checks everything. */
function PrimaryOwnerPanel({ locale, d }: { locale: Locale; d: CompanyDetail }) {
  const owner = d.primaryOwner;
  const blocked = owner.state === "designated" ? null : owner.state === "not_designated" ? "transfer.notDesignated" : owner.state === "not_installed" ? "transfer.notInstalled" : "transfer.unavailable";
  return (
    <section className="card platform-panel" aria-labelledby="company-primary-owner" data-testid="company-primary-owner">
      <div className="platform-panel-head">
        <h2 id="company-primary-owner">{pt(locale, "transfer.panel")}</h2>
      </div>
      <div className="platform-panel-body platform-detail-actions">
        <PrimaryOwnerTransfer
          locale={locale}
          orgId={d.orgId}
          companyName={d.name}
          designation={owner.state}
          primaryEmail={owner.state === "designated" ? owner.email : null}
          noteId={blocked ? "company-transfer-note" : undefined}
        />
        {blocked && (
          <p id="company-transfer-note" className="platform-callout" data-tone="neutral" data-testid="company-transfer-note">
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            <span>{pt(locale, blocked)}</span>
          </p>
        )}
        <p className="platform-fine-print">{pt(locale, "transfer.panelNote")}</p>
      </div>
    </section>
  );
}

// PO-03C: what the User invitations panel shows. "off" (the flag) renders nothing at all.
type UserInvitationsView = { state: "off" } | { state: "not_installed" } | { state: "unavailable" } | { state: "ready"; data: CompanyUserInvitations };
const INVITE_ROLE_KEY = { admin: "role.admin", staff: "role.staff" } as const;

function UserInvitationsPanel({ locale, d, view }: { locale: Locale; d: CompanyDetail; view: UserInvitationsView }) {
  if (view.state === "off") return null;
  return (
    <section className="card platform-panel" aria-labelledby="company-user-invitations" data-testid="company-user-invitations">
      <div className="platform-panel-head">
        <h2 id="company-user-invitations">{pt(locale, "uinv.panel")}</h2>
        {view.state === "ready" && <InviteUserControl locale={locale} orgId={d.orgId} companyName={d.name} />}
      </div>
      <div className="platform-panel-body">
        {view.state === "not_installed" ? (
          <p className="platform-cell-sub">{pt(locale, "uinv.notInstalledText")}</p>
        ) : view.state === "unavailable" ? (
          <p className="platform-cell-sub">{pt(locale, "uinv.unavailable")}</p>
        ) : (
          <>
            <h3 className="platform-subhead">{pt(locale, "uinv.open")}</h3>
            {view.data.rows.length ? (
              <ul className="platform-owner-list" data-testid="company-user-invitations-open">
                {view.data.rows.map((r) => (
                  <li key={r.id} className="platform-owner platform-uinv-item">
                    <div className="platform-uinv-line">
                      <Link href={`/platform/users/invitations/${r.id}`} className="platform-owner-name platform-inline-link" dir="auto">
                        {r.name}
                      </Link>
                      <PlatformStatusTag locale={locale} domain="invitation" value={r.state} />
                    </div>
                    <span className="platform-cell-sub">
                      <Ltr>{r.email}</Ltr> · {pt(locale, INVITE_ROLE_KEY[r.role])} ·{" "}
                      <span className="whitespace-nowrap">
                        <Ltr>{r.reference}</Ltr>
                      </span>
                    </span>
                    <span className="platform-cell-sub">
                      {pt(locale, "col.expires")}: {formatPlatformDateTime(r.expiresAt, locale)}
                    </span>
                    <div className="platform-uinv-actions">
                      <UserInvitationRowActions locale={locale} target={{ id: r.id, reference: r.reference, email: r.email, state: r.state }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="platform-cell-sub">{pt(locale, "uinv.noneOpen")}</p>
            )}
            {view.data.open > view.data.rows.length && (
              <p className="platform-fine-print mt-4">{pt(locale, "users.ownersShown", { shown: formatPlatformCount(view.data.rows.length), total: formatPlatformCount(view.data.open) })}</p>
            )}
            <p className="mt-4">
              <Link href={`/platform/users/invitations?org=${d.orgId}`} className="platform-inline-link">
                <MailPlus className="inline size-4 align-text-bottom" aria-hidden /> {pt(locale, "uinv.allForCompany")} (<Ltr>{formatPlatformCount(view.data.total)}</Ltr>)
              </Link>
            </p>
          </>
        )}
        <p className="platform-fine-print mt-4">{pt(locale, "uinv.panelNote")}</p>
      </div>
    </section>
  );
}

function UsersPanel({ locale, d, invitations }: { locale: Locale; d: CompanyDetail; invitations: UserInvitationsView }) {
  return (
    <div className="platform-settings-stack">
      <div className="platform-stat-grid">
        <MetricTile label={pt(locale, "users.total")} value={formatPlatformCount(d.users.total)} icon={Users} />
        <MetricTile label={pt(locale, "users.active")} value={formatPlatformCount(d.users.active)} icon={UserCheck} />
        <MetricTile label={pt(locale, "users.inactive")} value={formatPlatformCount(d.users.total - d.users.active)} icon={UserMinus} />
        <MetricTile label={pt(locale, "users.owners")} value={formatPlatformCount(d.users.owners)} icon={UserCog} />
      </div>
      <SeatsPanel locale={locale} d={d} />
      <PrimaryOwnerPanel locale={locale} d={d} />
      <UserInvitationsPanel locale={locale} d={d} view={invitations} />
      <section className="card platform-panel" aria-labelledby="company-owners">
        <div className="platform-panel-head">
          <h2 id="company-owners">{pt(locale, "users.owners")}</h2>
          {/* PO-03B: the company's users in the console's user directory (its own controls live on each user's page). */}
          <Button asChild variant="secondary">
            <Link href={`/platform/users?org=${d.orgId}`}>
              <Users aria-hidden />
              {pt(locale, "action.manageUsers")}
            </Link>
          </Button>
        </div>
        <div className="platform-panel-body">
          {d.owners.length ? (
            <ul className="platform-owner-list">
              {d.owners.map((owner) => (
                <li key={owner.email} className="platform-owner">
                  <span className="platform-owner-name" dir="auto">
                    {owner.name}
                  </span>
                  <span className="platform-cell-sub">
                    <Ltr>{owner.email}</Ltr>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="platform-cell-sub">{pt(locale, "companies.noOwner")}</p>
          )}
          {d.users.owners > d.owners.length && (
            <p className="platform-fine-print mt-4">{pt(locale, "users.ownersShown", { shown: formatPlatformCount(d.owners.length), total: formatPlatformCount(d.users.owners) })}</p>
          )}
          <p className="platform-fine-print mt-4">{pt(locale, "users.note")}</p>
        </div>
      </section>
    </div>
  );
}

function SubscriptionPanel({ locale }: { locale: Locale }) {
  return (
    <section className="card platform-panel" aria-labelledby="company-subscription">
      <div className="platform-panel-head">
        <h2 id="company-subscription">{pt(locale, "company.subscription")}</h2>
        <PreviewBadge locale={locale} phase="PO-05" />
      </div>
      <div className="platform-panel-body">
        <EmptyPanel icon={Receipt} message={pt(locale, "sub.empty")} hint={pt(locale, "sub.emptyHint")} />
      </div>
    </section>
  );
}

function ActivityPanel({ locale, d, anchored }: { locale: Locale; d: CompanyDetail; anchored: boolean }) {
  const base = `/platform/companies/${d.orgId}`;
  return (
    <section className="card platform-panel" aria-labelledby="company-activity">
      <div className="platform-panel-head">
        <h2 id="company-activity">{pt(locale, "activity.company")}</h2>
      </div>
      <div className="platform-panel-body platform-settings-stack">
        {d.activity.rows.length ? (
          <Table list density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{pt(locale, "col.time")}</TableHead>
                <TableHead>{pt(locale, "col.actor")}</TableHead>
                <TableHead>{pt(locale, "col.action")}</TableHead>
                <TableHead>{pt(locale, "col.result")}</TableHead>
                <TableHead>{pt(locale, "col.reason")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.activity.rows.map((event) => {
                const label = ACTION_LABEL[event.action];
                return (
                  <TableRow key={event.id}>
                    <TableCell>{formatPlatformDateTime(event.at, locale)}</TableCell>
                    <TableCell>
                      <span dir="auto">{event.actor}</span>
                    </TableCell>
                    <TableCell>{label ? pt(locale, label) : <Ltr>{event.action}</Ltr>}</TableCell>
                    <TableCell>
                      <PlatformStatusTag locale={locale} domain="audit_result" value={event.result} />
                    </TableCell>
                    <TableCell wrap>{event.reason ? <span dir="auto">{event.reason}</span> : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyPanel icon={Receipt} message={pt(locale, "activity.none")} />
        )}
        {(anchored || d.activity.next) && (
          <nav className="platform-pager-links" aria-label={pt(locale, "pager.label")}>
            {anchored && (
              <Link className="platform-pager-link" href={`${base}?tab=activity`}>
                {pt(locale, "activity.latest")}
              </Link>
            )}
            {d.activity.next && (
              <Link className="platform-pager-link" href={`${base}?tab=activity&activity=${d.activity.next}`} rel="next">
                {pt(locale, "activity.older")}
              </Link>
            )}
          </nav>
        )}
        <p className="platform-fine-print">{pt(locale, "activity.companyNote")}</p>
      </div>
    </section>
  );
}

type RouteParams = Promise<{ orgId: string }>;
type PageQuery = Promise<SearchParams>;

export default async function PlatformCompanyPage({ params, searchParams }: { params: RouteParams; searchParams: PageQuery }) {
  await requirePlatformSession();
  const [locale, { orgId }, query, store, requestHeaders] = await Promise.all([getLocale(), params, searchParams, cookies(), headers()]);
  const req = { headers: requestHeaders, token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };
  const back = (
    <Link href="/platform/companies" className="platform-inline-link">
      {pt(locale, "company.back")}
    </Link>
  );

  let detail: CompanyDetail | null = null;
  let failure: "FORBIDDEN" | "AUDIT_UNAVAILABLE" | "VALIDATION_FAILED" | null = null;
  try {
    detail = await getCompanyDetail(req, orgId, { activity: query.activity });
  } catch (err) {
    if (isPlatformError(err, "UNAUTHORIZED") || isPlatformError(err, "SESSION_EXPIRED")) redirect("/platform/session-expired");
    if (isPlatformError(err, "NOT_FOUND")) notFound();
    if (isPlatformError(err, "FORBIDDEN")) failure = "FORBIDDEN";
    else if (isPlatformError(err, "AUDIT_UNAVAILABLE")) failure = "AUDIT_UNAVAILABLE";
    else if (isPlatformError(err, "VALIDATION_FAILED")) failure = "VALIDATION_FAILED";
    else throw err; // → the console error boundary (generic message + retry)
  }

  if (failure === "FORBIDDEN") {
    return <PageState icon={ShieldOff} title={pt(locale, "nav.companies")} hint={pt(locale, "state.denied")} action={back} />;
  }
  if (failure === "AUDIT_UNAVAILABLE") {
    return <PageState icon={CircleAlert} tone="danger" title={pt(locale, "company.auditDownTitle")} hint={pt(locale, "company.auditDownText")} action={back} />;
  }
  if (failure === "VALIDATION_FAILED" || !detail) {
    return <PageState icon={CircleAlert} title={pt(locale, "nav.companies")} hint={pt(locale, "companies.invalidQuery")} action={back} />;
  }

  const d = detail;
  // PO-03C: the company's open user invitations — read only when the flag is on (the read refuses first otherwise).
  let invitations: UserInvitationsView = { state: "off" };
  try {
    invitations = { state: "ready", data: await listCompanyUserInvitations(req, d.orgId) };
  } catch (err) {
    if (isPlatformError(err, "UNAUTHORIZED") || isPlatformError(err, "SESSION_EXPIRED")) redirect("/platform/session-expired");
    if (isPlatformError(err, "USER_INVITATIONS_DISABLED") || isPlatformError(err, "FORBIDDEN")) invitations = { state: "off" };
    else if (isPlatformError(err, "USER_INVITATIONS_NOT_INSTALLED")) invitations = { state: "not_installed" };
    else invitations = { state: "unavailable" };
  }
  const requested = typeof query.tab === "string" && (TABS as string[]).includes(query.tab) ? (query.tab as CompanyTabValue) : null;
  const initial: CompanyTabValue = requested ?? (query.activity ? "activity" : "overview");

  return (
    <DetailPage
      breadcrumbs={<Breadcrumbs locale={locale} items={[{ label: pt(locale, "nav.companies"), href: "/platform/companies" }, { label: d.name }]} />}
      title={d.name}
      description={
        <>
          <Ltr>{d.reference}</Ltr> · {pt(locale, "company.registeredOn", { date: formatPlatformDate(d.createdAt, locale) })}
        </>
      }
      meta={<AccessPill locale={locale} access={{ status: d.access.status, source: d.access.source }} />}
      actions={
        <>
          <CompanyAccessControl locale={locale} orgId={d.orgId} reference={d.reference} companyName={d.name} status={d.access.status} enforced={d.access.enforced} />
          <DisabledAction locale={locale} label={pt(locale, "action.editCompany")} icon={Pencil} />
        </>
      }
    >
      <CompanyTabs
        label={pt(locale, "company.tabs")}
        initial={initial}
        tabs={[
          { value: "overview", label: pt(locale, "company.overview"), content: <OverviewPanel locale={locale} d={d} /> },
          { value: "access", label: pt(locale, "company.access"), content: <AccessPanel locale={locale} d={d} /> },
          { value: "users", label: pt(locale, "nav.users"), content: <UsersPanel locale={locale} d={d} invitations={invitations} /> },
          { value: "subscription", label: pt(locale, "company.subscription"), content: <SubscriptionPanel locale={locale} /> },
          { value: "activity", label: pt(locale, "company.activity"), content: <ActivityPanel locale={locale} d={d} anchored={typeof query.activity === "string" && query.activity !== ""} /> },
        ]}
      />
      <p className="platform-fine-print">{pt(locale, "company.viewAudited")}</p>
    </DetailPage>
  );
}
