import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeCheck, Building2, Download, Info, MailPlus, SearchX, ShieldOff, UserPlus } from "lucide-react";
import {
  CompanyCards,
  CompanyTable,
  DisabledAction,
  Interpolated,
  InvitationCards,
  InvitationTable,
  Ltr,
  MetricTile,
  Pager,
  ViewSegments,
  type CompanyRowView,
  type InvitationRowView,
} from "@/components/platform/companies-kit";
import { pt } from "@/components/platform/i18n";
import { ConsolePage, DeniedState, EmptyPanel, PreviewAction } from "@/components/platform/page-kit";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/dict";
import { getLocale } from "@/lib/i18n/server";
import {
  COMPANY_PAGE_SIZE_DEFAULT,
  COMPANY_SORTS,
  INVITATION_STATES,
  SEARCH_MAX_LENGTH,
  companyMetrics,
  listCompanies,
  listCompanyCountries,
  listPendingInvitations,
  type CompanyListPage,
  type InvitationListPage,
} from "@/lib/platform/companies";
import { PLATFORM_SESSION_COOKIE } from "@/lib/platform/config";
import { formatPlatformCount, formatPlatformDate, formatPlatformDateTime } from "@/lib/platform/display";
import { isPlatformError } from "@/lib/platform/errors";
import { requirePlatformSession } from "@/lib/platform/guards";

// Companies (PO-02B): the read-only directory of registered organizations and, as a separate
// view, the company invitations that still hold a pending e-mail slot. Server-rendered: search,
// filters and pages are plain GET links and forms (the URL keeps the query), and every value comes
// from the allow-listed read model (src/lib/platform/companies.ts), which re-authorizes each read.
// Invitations, suspension / reactivation, editing and export are later phases: disabled here.

type SearchParams = Record<string, string | string[] | undefined>;
type View = "registered" | "invitations";
type Loaded<T> = { ok: true; value: T } | { ok: false; code: "FORBIDDEN" | "VALIDATION_FAILED" };

const PAGE_SIZES = [10, COMPANY_PAGE_SIZE_DEFAULT, 50];
const SORT_LABEL = { newest: "sort.newest", oldest: "sort.oldest", name: "sort.name" } as const;
const STATE_LABEL = { pending: "inv.statePending", expired: "inv.stateExpired" } as const;

/** Session problems go to the cookie-clearing handler; denial and bad input become page states; anything else → error boundary. */
async function load<T>(read: () => Promise<T>) {
  try {
    const value = await read();
    return { ok: true as const, value };
  } catch (err) {
    if (isPlatformError(err, "UNAUTHORIZED") || isPlatformError(err, "SESSION_EXPIRED")) redirect("/platform/session-expired");
    if (isPlatformError(err, "FORBIDDEN")) return { ok: false as const, code: "FORBIDDEN" as const };
    if (isPlatformError(err, "VALIDATION_FAILED")) return { ok: false as const, code: "VALIDATION_FAILED" as const };
    throw err;
  }
}

/** Directory links: always /platform/companies, with only the given (already validated) parameters. */
function directoryHref(view: View, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  if (view === "invitations") query.set("view", "invitations");
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `/platform/companies?${text}` : "/platform/companies";
}

/** The raw value of a parameter for re-filling the form (the read model validates the real one). */
const raw = (value: string | string[] | undefined, max = SEARCH_MAX_LENGTH) => (typeof value === "string" ? value.slice(0, max) : "");

function summary(locale: Locale, offset: number, shown: number, total: number) {
  const rangeNode = <Ltr>{`${formatPlatformCount(offset + 1)}–${formatPlatformCount(offset + shown)}`}</Ltr>;
  const totalNode = <Ltr>{formatPlatformCount(total)}</Ltr>;
  return <Interpolated template={pt(locale, "companies.showing")} values={{ range: rangeNode, total: totalNode }} />;
}

function companyRows(page: CompanyListPage, locale: Locale): CompanyRowView[] {
  return page.rows.map((row) => ({
    orgId: row.orgId,
    href: `/platform/companies/${row.orgId}`,
    name: row.name,
    reference: row.reference,
    country: row.country,
    currency: row.currency,
    access: { status: row.access.status, source: row.access.source },
    owner: row.primaryOwner,
    moreOwners: Math.max(0, row.users.owners - (row.primaryOwner ? 1 : 0)),
    users: formatPlatformCount(row.users.total),
    activeUsers: formatPlatformCount(row.users.active),
    created: formatPlatformDate(row.createdAt, locale),
    lastSignIn: row.users.lastSignInAt ? formatPlatformDate(row.users.lastSignInAt, locale) : null,
  }));
}

function invitationRows(page: InvitationListPage, locale: Locale): InvitationRowView[] {
  return page.rows.map((row) => ({
    reference: row.reference,
    companyName: row.companyName,
    ownerEmail: row.ownerEmail,
    country: row.country,
    created: formatPlatformDateTime(row.createdAt, locale),
    expires: formatPlatformDateTime(row.expiresAt, locale),
    state: row.state,
  }));
}

function InvalidQuery({ locale, view }: { locale: Locale; view: View }) {
  return (
    <div className="platform-callout" data-tone="warning" role="alert">
      <Info className="size-4 shrink-0" aria-hidden />
      <span>
        {pt(locale, "companies.invalidQuery")}{" "}
        <Link href={directoryHref(view, {})} className="platform-inline-link">
          {pt(locale, "companies.startOver")}
        </Link>
      </span>
    </div>
  );
}

type PageQuery = Promise<SearchParams>;

export default async function PlatformCompaniesPage({ searchParams }: { searchParams: PageQuery }) {
  await requirePlatformSession();
  const [locale, params, store, requestHeaders] = await Promise.all([getLocale(), searchParams, cookies(), headers()]);
  const req = { headers: requestHeaders, token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };
  const view: View = params.view === "invitations" ? "invitations" : "registered";

  const [metrics, countries, companies, invitations] = await Promise.all([
    load(() => companyMetrics(req)),
    load(() => listCompanyCountries(req)),
    view === "registered" ? load(() => listCompanies(req, params)) : Promise.resolve(null),
    view === "invitations" ? load(() => listPendingInvitations(req, params)) : Promise.resolve(null),
  ]);

  const header = {
    locale,
    title: pt(locale, "nav.companies"),
    description: pt(locale, "companies.desc"),
    actions: (
      <>
        <PreviewAction locale={locale} label={pt(locale, "action.inviteCompany")} icon={UserPlus} phase="PO-02D" />
        <DisabledAction locale={locale} label={pt(locale, "action.export")} icon={Download} />
      </>
    ),
  };
  if (!metrics.ok || !countries.ok) {
    return (
      <ConsolePage {...header}>
        <DeniedState locale={locale} />
      </ConsolePage>
    );
  }

  const m = metrics.value;
  const accessFilter = companies?.ok ? companies.value.query.access : null;
  const slots = m.invitations.pending + m.invitations.expired;

  return (
    <ConsolePage {...header}>
      <div className="platform-stat-grid platform-stat-quad">
        <MetricTile
          label={pt(locale, "metric.registered")}
          value={formatPlatformCount(m.companies.total)}
          icon={Building2}
          href="/platform/companies"
          note={pt(locale, "metric.newNote", { n: formatPlatformCount(m.companies.registeredLast30Days) })}
          current={view === "registered" && !accessFilter}
        />
        <MetricTile
          label={pt(locale, "dash.activeAccess")}
          value={formatPlatformCount(m.companies.active)}
          icon={BadgeCheck}
          href="/platform/companies?access=active"
          note={m.companies.legacyDefault ? pt(locale, "metric.legacyNote", { n: formatPlatformCount(m.companies.legacyDefault) }) : undefined}
          current={accessFilter === "active"}
        />
        <MetricTile
          label={pt(locale, "dash.suspended")}
          value={formatPlatformCount(m.companies.suspended)}
          icon={ShieldOff}
          href="/platform/companies?access=suspended"
          note={pt(locale, "metric.suspendedNote")}
          current={accessFilter === "suspended"}
        />
        <MetricTile
          label={pt(locale, "companies.pending")}
          value={formatPlatformCount(slots)}
          icon={MailPlus}
          href="/platform/companies?view=invitations"
          note={m.invitations.expired ? pt(locale, "metric.expiredNote", { n: formatPlatformCount(m.invitations.expired) }) : undefined}
          current={view === "invitations"}
        />
      </div>

      <ViewSegments
        label={pt(locale, "companies.views")}
        items={[
          { label: pt(locale, "companies.registered"), href: "/platform/companies", current: view === "registered", count: formatPlatformCount(m.companies.total) },
          { label: pt(locale, "companies.pending"), href: "/platform/companies?view=invitations", current: view === "invitations", count: formatPlatformCount(slots) },
        ]}
      />

      {view === "registered" && companies && (
        <RegisteredView locale={locale} result={companies} params={params} countries={countries.value} total={m.companies.total} />
      )}
      {view === "invitations" && invitations && <InvitationsView locale={locale} result={invitations} params={params} total={slots} />}
    </ConsolePage>
  );
}

function RegisteredView({ locale, result, params, countries, total }: { locale: Locale; result: Loaded<CompanyListPage>; params: SearchParams; countries: string[]; total: number }) {
  if (!result.ok && result.code === "FORBIDDEN") return <DeniedState locale={locale} />;
  const page = result.ok ? result.value : null;
  const q = page ? (page.query.q ?? "") : raw(params.q);
  const access = page ? (page.query.access ?? "") : raw(params.access, 20);
  const country = page ? (page.query.country ?? "") : raw(params.country);
  const sort = page ? page.query.sort : "newest";
  const size = page ? page.query.size : COMPANY_PAGE_SIZE_DEFAULT;
  const base = page ? { q: page.query.q, access: page.query.access, country: page.query.country, sort: page.query.sort === "newest" ? null : page.query.sort, size: page.query.size === COMPANY_PAGE_SIZE_DEFAULT ? null : String(page.query.size) } : {};
  const filtered = !!(page && (page.query.q || page.query.access || page.query.country));
  const rows = page ? companyRows(page, locale) : [];
  const packageNote = pt(locale, "common.phase", { phase: "PO-04" });

  return (
    <>
      {/* Keyed by the query: a client-side navigation (Clear filters, a figure tile) remounts the form, so its
          controls always show the query the results were filtered with. */}
      <form method="get" action="/platform/companies" role="search" key={JSON.stringify([q, access, country, sort, size])} aria-label={pt(locale, "companies.filters")} className="card platform-filters">
        <div className="platform-filter-field platform-filter-search">
          <label htmlFor="companies-q">{pt(locale, "companies.searchLabel")}</label>
          <input id="companies-q" name="q" type="search" className="platform-input" maxLength={SEARCH_MAX_LENGTH} defaultValue={q} placeholder={pt(locale, "companies.searchPlaceholder")} autoComplete="off" dir="auto" />
        </div>
        <div className="platform-filter-field">
          <label htmlFor="companies-access">{pt(locale, "filter.access")}</label>
          <select id="companies-access" name="access" className="platform-select" defaultValue={access}>
            <option value="">{pt(locale, "filter.all")}</option>
            <option value="active">{pt(locale, "access.active")}</option>
            <option value="suspended">{pt(locale, "access.suspended")}</option>
          </select>
        </div>
        <div className="platform-filter-field">
          <label htmlFor="companies-country">{pt(locale, "filter.country")}</label>
          <select id="companies-country" name="country" className="platform-select" defaultValue={country}>
            <option value="">{pt(locale, "filter.allCountries")}</option>
            {countries.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="platform-filter-field">
          <span className="platform-filter-label" id="companies-package-label">
            {pt(locale, "filter.package")}
          </span>
          <select className="platform-select" aria-labelledby="companies-package-label" disabled aria-disabled="true" title={packageNote}>
            <option>{packageNote}</option>
          </select>
        </div>
        <div className="platform-filter-field">
          <label htmlFor="companies-sort">{pt(locale, "filter.sort")}</label>
          <select id="companies-sort" name="sort" className="platform-select" defaultValue={sort}>
            {COMPANY_SORTS.map((value) => (
              <option key={value} value={value}>
                {pt(locale, SORT_LABEL[value])}
              </option>
            ))}
          </select>
        </div>
        <div className="platform-filter-field">
          <label htmlFor="companies-size">{pt(locale, "filter.rows")}</label>
          <select id="companies-size" name="size" className="platform-select" defaultValue={String(size)}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={String(n)}>
                {formatPlatformCount(n)}
              </option>
            ))}
          </select>
        </div>
        <div className="platform-filter-actions">
          <Button type="submit">{pt(locale, "action.apply")}</Button>
          <Link href="/platform/companies" className="platform-inline-link">
            {pt(locale, "action.clear")}
          </Link>
        </div>
      </form>

      {!page ? (
        <InvalidQuery locale={locale} view="registered" />
      ) : rows.length === 0 ? (
        <div className="card">
          {page.invitationReference && (
            <p className="platform-callout platform-callout-inset" data-tone="info">
              <Info className="size-4 shrink-0" aria-hidden />
              <span>
                {pt(locale, "companies.invRefHint")}{" "}
                <Link href={directoryHref("invitations", { q: page.query.q })} className="platform-inline-link">
                  {pt(locale, "companies.searchInvitations")}
                </Link>
              </span>
            </p>
          )}
          {filtered || total > 0 ? (
            <EmptyPanel icon={SearchX} message={pt(locale, "companies.noneMatch")} hint={pt(locale, "companies.noneMatchHint")} />
          ) : (
            <EmptyPanel icon={Building2} message={pt(locale, "companies.emptyLive")} hint={pt(locale, "companies.emptyLiveHint")} />
          )}
        </div>
      ) : (
        <>
          <CompanyTable locale={locale} rows={rows} caption={pt(locale, "metric.registered")} />
          <CompanyCards locale={locale} rows={rows} label={pt(locale, "metric.registered")} />
          <Pager
            locale={locale}
            summary={summary(locale, page.offset, rows.length, page.total)}
            firstHref={page.prev ? directoryHref("registered", base) : null}
            prevHref={page.prev ? directoryHref("registered", { ...base, before: page.prev }) : null}
            nextHref={page.next ? directoryHref("registered", { ...base, after: page.next }) : null}
          />
        </>
      )}
      <p className="platform-fine-print">{pt(locale, "companies.accessNote")}</p>
      <p className="platform-fine-print">{pt(locale, "companies.deferredNote")}</p>
    </>
  );
}

function InvitationsView({ locale, result, params, total }: { locale: Locale; result: Loaded<InvitationListPage>; params: SearchParams; total: number }) {
  if (!result.ok && result.code === "FORBIDDEN") return <DeniedState locale={locale} />;
  const page = result.ok ? result.value : null;
  const q = page ? (page.query.q ?? "") : raw(params.q);
  const state = page ? (page.query.state ?? "") : raw(params.state, 20);
  const size = page ? page.query.size : COMPANY_PAGE_SIZE_DEFAULT;
  const base = page ? { q: page.query.q, state: page.query.state, size: page.query.size === COMPANY_PAGE_SIZE_DEFAULT ? null : String(page.query.size) } : {};
  const filtered = !!(page && (page.query.q || page.query.state));
  const rows = page ? invitationRows(page, locale) : [];

  return (
    <>
      <p className="platform-callout" data-tone="info">
        <Info className="size-4 shrink-0" aria-hidden />
        <span>{pt(locale, "inv.slotNote")}</span>
      </p>
      <form method="get" action="/platform/companies" role="search" key={JSON.stringify([q, state, size])} aria-label={pt(locale, "companies.filters")} className="card platform-filters">
        <input type="hidden" name="view" value="invitations" />
        <div className="platform-filter-field platform-filter-search">
          <label htmlFor="invitations-q">{pt(locale, "inv.searchLabel")}</label>
          <input id="invitations-q" name="q" type="search" className="platform-input" maxLength={SEARCH_MAX_LENGTH} defaultValue={q} placeholder={pt(locale, "inv.searchPlaceholder")} autoComplete="off" dir="auto" />
        </div>
        <div className="platform-filter-field">
          <label htmlFor="invitations-state">{pt(locale, "filter.status")}</label>
          <select id="invitations-state" name="state" className="platform-select" defaultValue={state}>
            <option value="">{pt(locale, "filter.all")}</option>
            {INVITATION_STATES.map((value) => (
              <option key={value} value={value}>
                {pt(locale, STATE_LABEL[value])}
              </option>
            ))}
          </select>
        </div>
        <div className="platform-filter-field">
          <label htmlFor="invitations-size">{pt(locale, "filter.rows")}</label>
          <select id="invitations-size" name="size" className="platform-select" defaultValue={String(size)}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={String(n)}>
                {formatPlatformCount(n)}
              </option>
            ))}
          </select>
        </div>
        <div className="platform-filter-actions">
          <Button type="submit">{pt(locale, "action.apply")}</Button>
          <Link href="/platform/companies?view=invitations" className="platform-inline-link">
            {pt(locale, "action.clear")}
          </Link>
        </div>
      </form>

      {!page ? (
        <InvalidQuery locale={locale} view="invitations" />
      ) : rows.length === 0 ? (
        <div className="card">
          {filtered || total > 0 ? (
            <EmptyPanel icon={SearchX} message={pt(locale, "inv.noneMatch")} hint={pt(locale, "companies.noneMatchHint")} />
          ) : (
            <EmptyPanel icon={MailPlus} message={pt(locale, "inv.empty")} hint={pt(locale, "inv.emptyHint")} />
          )}
        </div>
      ) : (
        <>
          <InvitationTable locale={locale} rows={rows} caption={pt(locale, "companies.pending")} />
          <InvitationCards locale={locale} rows={rows} label={pt(locale, "companies.pending")} />
          <Pager
            locale={locale}
            summary={summary(locale, page.offset, rows.length, page.total)}
            firstHref={page.prev ? directoryHref("invitations", base) : null}
            prevHref={page.prev ? directoryHref("invitations", { ...base, before: page.prev }) : null}
            nextHref={page.next ? directoryHref("invitations", { ...base, after: page.next }) : null}
          />
        </>
      )}
    </>
  );
}
