import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleAlert, Pencil, Receipt, ShieldOff, UserCheck, UserCog, UserMinus, Users } from "lucide-react";
import { AccessPill, Breadcrumbs, DetailPage, DisabledAction, FieldGrid, Interpolated, Ltr, MetricTile, PageState, PlatformStatusTag } from "@/components/platform/companies-kit";
import { CompanyAccessControl } from "@/components/platform/company-access-dialog";
import { CompanyTabs, type CompanyTabValue } from "@/components/platform/company-tabs";
import { pt } from "@/components/platform/i18n";
import { EmptyPanel, PreviewBadge } from "@/components/platform/page-kit";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Locale } from "@/lib/i18n/dict";
import { getLocale } from "@/lib/i18n/server";
import { getCompanyDetail, type CompanyDetail } from "@/lib/platform/companies";
import { PLATFORM_SESSION_COOKIE } from "@/lib/platform/config";
import { formatPlatformCount, formatPlatformDate, formatPlatformDateTime } from "@/lib/platform/display";
import { isPlatformError } from "@/lib/platform/errors";
import { requirePlatformSession } from "@/lib/platform/guards";

// One company (PO-02B): Overview, Access & controls, Users, Subscription (later phase) and Activity,
// from the allow-listed read model. Loading this page is an audited view ("company.viewed"): if the
// audit record cannot be written, no company data is rendered at all. Malformed or unknown ids are
// a 404. PO-02C: Suspend / Reactivate (header and Access & controls) open the confirmation dialog,
// whose server action re-authorizes and steps up on its own; every other action is still disabled.

type SearchParams = Record<string, string | string[] | undefined>;
const TABS: CompanyTabValue[] = ["overview", "access", "users", "subscription", "activity"];
const ACTION_LABEL: Record<string, "event.companyViewed" | "event.companySuspended" | "event.companyReactivated" | "event.suspendRejected" | "event.reactivateRejected"> = {
  "company.viewed": "event.companyViewed",
  "company.suspended": "event.companySuspended",
  "company.reactivated": "event.companyReactivated",
  "company.suspend.rejected": "event.suspendRejected",
  "company.reactivate.rejected": "event.reactivateRejected",
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

// PO-03A: read-only Users & seats — the shared seat accounting and the primary-owner mapping. Nothing is enforced.
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
              <Interpolated template={pt(locale, "seats.overBy")} values={{ n: count(s.overBy) }} />
            </span>
          </p>
        )}
        {legacy && <p className="platform-fine-print mt-4">{pt(locale, "seats.legacyNote")}</p>}
        <p className="platform-fine-print mt-4">{pt(locale, "seats.note")}</p>
      </div>
    </section>
  );
}

function UsersPanel({ locale, d }: { locale: Locale; d: CompanyDetail }) {
  return (
    <div className="platform-settings-stack">
      <div className="platform-stat-grid">
        <MetricTile label={pt(locale, "users.total")} value={formatPlatformCount(d.users.total)} icon={Users} />
        <MetricTile label={pt(locale, "users.active")} value={formatPlatformCount(d.users.active)} icon={UserCheck} />
        <MetricTile label={pt(locale, "users.inactive")} value={formatPlatformCount(d.users.total - d.users.active)} icon={UserMinus} />
        <MetricTile label={pt(locale, "users.owners")} value={formatPlatformCount(d.users.owners)} icon={UserCog} />
      </div>
      <SeatsPanel locale={locale} d={d} />
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
          { value: "users", label: pt(locale, "nav.users"), content: <UsersPanel locale={locale} d={d} /> },
          { value: "subscription", label: pt(locale, "company.subscription"), content: <SubscriptionPanel locale={locale} /> },
          { value: "activity", label: pt(locale, "company.activity"), content: <ActivityPanel locale={locale} d={d} anchored={typeof query.activity === "string" && query.activity !== ""} /> },
        ]}
      />
      <p className="platform-fine-print">{pt(locale, "company.viewAudited")}</p>
    </DetailPage>
  );
}
