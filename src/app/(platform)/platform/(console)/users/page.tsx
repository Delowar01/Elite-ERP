import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Info, SearchX, ShieldCheck, UserCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { DisabledAction, Interpolated, Ltr, MetricTile, Pager } from "@/components/platform/companies-kit";
import { pt } from "@/components/platform/i18n";
import { ConsolePage, DeniedState, EmptyPanel } from "@/components/platform/page-kit";
import { UserCards, UserTable, type UserRowView } from "@/components/platform/users-kit";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/dict";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE } from "@/lib/platform/config";
import {
  USER_MFA_STATES,
  USER_PAGE_SIZE_DEFAULT,
  USER_ROLES,
  USER_SEARCH_MAX_LENGTH,
  USER_SORTS,
  USER_STATUSES,
  customerUserMetrics,
  listCustomerUsers,
  type CustomerUserListPage,
  type CustomerUserListQuery,
} from "@/lib/platform/customer-users";
import { formatPlatformCount, formatPlatformDate } from "@/lib/platform/display";
import { isPlatformError } from "@/lib/platform/errors";
import { requirePlatformSession } from "@/lib/platform/guards";

// Users (PO-03B): the directory of customer users across every company. Server-rendered: search, filters, sorting
// and pages are plain GET links and forms (the URL keeps the query), and every value comes from the allow-listed
// read model (src/lib/platform/customer-users.ts), which re-authorizes each read with platform.users.read. Only
// account details are shown — never a password hash, two-factor secret, recovery code, session token or customer
// business record. A user's controls (disable / enable, sign out everywhere) live on the user's own page. Inviting
// customer users is a later phase: disabled here.

type SearchParams = Record<string, string | string[] | undefined>;
type Loaded<T> = { ok: true; value: T } | { ok: false; code: "FORBIDDEN" | "VALIDATION_FAILED" };

const PAGE_SIZES = [10, USER_PAGE_SIZE_DEFAULT, 50];
const SORT_LABEL = { newest: "cu.sortNewest", oldest: "cu.sortOldest", name: "cu.sortName", last_sign_in: "cu.sortLastSignIn", company: "cu.sortCompany" } as const;
const ROLE_LABEL = { owner: "role.owner", admin: "role.admin", staff: "role.staff" } as const;
const STATUS_LABEL = { active: "cu.statusActive", disabled: "cu.statusDisabled" } as const;
const MFA_LABEL = { on: "cu.mfaOn", off: "cu.mfaOff" } as const;

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

/** Directory links: always /platform/users, with only the given (already validated) parameters. */
function directoryHref(params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `/platform/users?${text}` : "/platform/users";
}

/** The validated query as link parameters (defaults left out). */
function baseParams(q: CustomerUserListQuery): Record<string, string | null> {
  return {
    q: q.q,
    org: q.org ? String(q.org) : null,
    role: q.role,
    status: q.status,
    mfa: q.mfa,
    sort: q.sort === "newest" ? null : q.sort,
    size: q.size === USER_PAGE_SIZE_DEFAULT ? null : String(q.size),
  };
}

/** The raw value of a parameter for re-filling the form (the read model validates the real one). */
const raw = (value: string | string[] | undefined, max = USER_SEARCH_MAX_LENGTH) => (typeof value === "string" ? value.slice(0, max) : "");

function userRows(page: CustomerUserListPage, locale: Locale): UserRowView[] {
  return page.rows.map((row) => ({
    userId: row.userId,
    href: `/platform/users/${row.userId}`,
    name: row.name,
    email: row.email,
    reference: row.reference,
    role: row.role,
    isActive: row.isActive,
    mfaEnabled: row.mfaEnabled,
    primaryOwner: row.primaryOwner,
    company: { name: row.company.name, reference: row.company.reference, href: `/platform/companies/${row.company.orgId}` },
    seats: row.seats
      ? {
          occupied: formatPlatformCount(row.seats.occupied),
          seats: row.seats.seats === null ? null : formatPlatformCount(row.seats.seats),
          overBy: row.seats.overLimit && row.seats.seats !== null ? formatPlatformCount(row.seats.occupied - row.seats.seats) : null,
        }
      : null,
    lastSignIn: row.lastSignInAt ? formatPlatformDate(row.lastSignInAt, locale) : null,
    created: formatPlatformDate(row.createdAt, locale),
  }));
}

function summary(locale: Locale, page: CustomerUserListPage, shown: number) {
  const rangeNode = <Ltr>{`${formatPlatformCount(page.offset + 1)}–${formatPlatformCount(page.offset + shown)}`}</Ltr>;
  const totalNode = <Ltr>{formatPlatformCount(page.total)}</Ltr>;
  const pageNode = <Ltr>{formatPlatformCount(page.query.page)}</Ltr>;
  const pagesNode = <Ltr>{formatPlatformCount(page.pages)}</Ltr>;
  return (
    <>
      <Interpolated template={pt(locale, "companies.showing")} values={{ range: rangeNode, total: totalNode }} />
      <span aria-hidden="true"> · </span>
      <Interpolated template={pt(locale, "cu.pageOf")} values={{ page: pageNode, pages: pagesNode }} />
    </>
  );
}

type PageQuery = Promise<SearchParams>;

export default async function PlatformUsersPage({ searchParams }: { searchParams: PageQuery }) {
  await requirePlatformSession();
  const [locale, params, store, requestHeaders] = await Promise.all([getLocale(), searchParams, cookies(), headers()]);
  const req = { headers: requestHeaders, token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };
  const [metrics, list] = await Promise.all([load(() => customerUserMetrics(req)), load(() => listCustomerUsers(req, params))]);

  const header = {
    locale,
    title: pt(locale, "nav.users"),
    description: pt(locale, "users.desc"),
    actions: <DisabledAction locale={locale} label={pt(locale, "action.inviteUser")} icon={UserPlus} />,
  };
  if (!metrics.ok || (!list.ok && list.code === "FORBIDDEN")) {
    return (
      <ConsolePage {...header}>
        <DeniedState locale={locale} />
      </ConsolePage>
    );
  }
  const m = metrics.value;
  const page = list.ok ? list.value : null;
  const status = page?.query.status ?? null;

  return (
    <ConsolePage {...header}>
      <div className="platform-stat-grid platform-stat-quad">
        <MetricTile
          label={pt(locale, "cu.metricUsers")}
          value={formatPlatformCount(m.total)}
          icon={Users}
          href="/platform/users"
          note={pt(locale, "cu.metricCompanies", { n: formatPlatformCount(m.companies) })}
          current={!!page && !status && !page.query.mfa}
        />
        <MetricTile label={pt(locale, "cu.metricActive")} value={formatPlatformCount(m.active)} icon={UserCheck} href="/platform/users?status=active" current={status === "active"} />
        <MetricTile label={pt(locale, "cu.metricDisabled")} value={formatPlatformCount(m.disabled)} icon={UserMinus} href="/platform/users?status=disabled" current={status === "disabled"} />
        <MetricTile label={pt(locale, "cu.metricMfa")} value={formatPlatformCount(m.mfaEnabled)} icon={ShieldCheck} href="/platform/users?mfa=on" current={page?.query.mfa === "on" && !status} />
      </div>
      <DirectoryView locale={locale} result={list} params={params} total={m.total} />
      <p className="platform-fine-print">{pt(locale, "cu.privacyNote")}</p>
      <p className="platform-fine-print">{pt(locale, "cu.seatNote")}</p>
    </ConsolePage>
  );
}

function DirectoryView({ locale, result, params, total }: { locale: Locale; result: Loaded<CustomerUserListPage>; params: SearchParams; total: number }) {
  const page = result.ok ? result.value : null;
  const q = page ? (page.query.q ?? "") : raw(params.q);
  const role = page ? (page.query.role ?? "") : raw(params.role, 20);
  const status = page ? (page.query.status ?? "") : raw(params.status, 20);
  const mfa = page ? (page.query.mfa ?? "") : raw(params.mfa, 20);
  const sort = page ? page.query.sort : "newest";
  const size = page ? page.query.size : USER_PAGE_SIZE_DEFAULT;
  const org = page?.query.org ?? null;
  const base = page ? baseParams(page.query) : {};
  const filtered = !!(page && (page.query.q || page.query.org || page.query.role || page.query.status || page.query.mfa));
  const rows = page ? userRows(page, locale) : [];

  return (
    <>
      {page?.company && (
        <p className="platform-callout" data-tone="info">
          <Info className="size-4 shrink-0" aria-hidden />
          <span>
            <Interpolated template={pt(locale, "cu.companyFilter")} values={{ company: <bdi>{page.company.name}</bdi> }} /> <Ltr>{page.company.reference}</Ltr>{" "}
            <Link href={directoryHref({ ...base, org: null })} className="platform-inline-link">
              {pt(locale, "cu.allCompanies")}
            </Link>
          </span>
        </p>
      )}
      {/* Keyed by the query: a client-side navigation (Clear filters, a figure tile) remounts the form, so its
          controls always show the query the results were filtered with. */}
      <form method="get" action="/platform/users" role="search" key={JSON.stringify([q, org, role, status, mfa, sort, size])} aria-label={pt(locale, "cu.filters")} className="card platform-filters">
        {org && <input type="hidden" name="org" value={String(org)} />}
        <div className="platform-filter-field platform-filter-search">
          <label htmlFor="users-q">{pt(locale, "cu.searchLabel")}</label>
          <input id="users-q" name="q" type="search" className="platform-input" maxLength={USER_SEARCH_MAX_LENGTH} defaultValue={q} placeholder={pt(locale, "cu.searchPlaceholder")} autoComplete="off" dir="auto" />
        </div>
        <div className="platform-filter-field">
          <label htmlFor="users-role">{pt(locale, "filter.role")}</label>
          <select id="users-role" name="role" className="platform-select" defaultValue={role}>
            <option value="">{pt(locale, "filter.all")}</option>
            {USER_ROLES.map((value) => (
              <option key={value} value={value}>
                {pt(locale, ROLE_LABEL[value])}
              </option>
            ))}
          </select>
        </div>
        <div className="platform-filter-field">
          <label htmlFor="users-status">{pt(locale, "filter.status")}</label>
          <select id="users-status" name="status" className="platform-select" defaultValue={status}>
            <option value="">{pt(locale, "filter.all")}</option>
            {USER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {pt(locale, STATUS_LABEL[value])}
              </option>
            ))}
          </select>
        </div>
        <div className="platform-filter-field">
          <label htmlFor="users-mfa">{pt(locale, "filter.mfa")}</label>
          <select id="users-mfa" name="mfa" className="platform-select" defaultValue={mfa}>
            <option value="">{pt(locale, "filter.all")}</option>
            {USER_MFA_STATES.map((value) => (
              <option key={value} value={value}>
                {pt(locale, MFA_LABEL[value])}
              </option>
            ))}
          </select>
        </div>
        <div className="platform-filter-field">
          <label htmlFor="users-sort">{pt(locale, "filter.sort")}</label>
          <select id="users-sort" name="sort" className="platform-select" defaultValue={sort}>
            {USER_SORTS.map((value) => (
              <option key={value} value={value}>
                {pt(locale, SORT_LABEL[value])}
              </option>
            ))}
          </select>
        </div>
        <div className="platform-filter-field">
          <label htmlFor="users-size">{pt(locale, "filter.rows")}</label>
          <select id="users-size" name="size" className="platform-select" defaultValue={String(size)}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={String(n)}>
                {formatPlatformCount(n)}
              </option>
            ))}
          </select>
        </div>
        <div className="platform-filter-actions">
          <Button type="submit">{pt(locale, "action.apply")}</Button>
          <Link href="/platform/users" className="platform-inline-link">
            {pt(locale, "action.clear")}
          </Link>
        </div>
      </form>

      {!page ? (
        <div className="platform-callout" data-tone="warning" role="alert">
          <Info className="size-4 shrink-0" aria-hidden />
          <span>
            {pt(locale, "companies.invalidQuery")}{" "}
            <Link href="/platform/users" className="platform-inline-link">
              {pt(locale, "companies.startOver")}
            </Link>
          </span>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          {filtered || total > 0 ? (
            <EmptyPanel icon={SearchX} message={pt(locale, "cu.noneMatch")} hint={pt(locale, "companies.noneMatchHint")} />
          ) : (
            <EmptyPanel icon={Users} message={pt(locale, "cu.empty")} hint={pt(locale, "cu.emptyHint")} />
          )}
        </div>
      ) : (
        <>
          <UserTable locale={locale} rows={rows} caption={pt(locale, "nav.users")} />
          <UserCards locale={locale} rows={rows} label={pt(locale, "nav.users")} />
          <Pager
            locale={locale}
            summary={summary(locale, page, rows.length)}
            firstHref={page.query.page > 1 ? directoryHref(base) : null}
            prevHref={page.query.page > 1 ? directoryHref({ ...base, page: page.query.page > 2 ? String(page.query.page - 1) : null }) : null}
            nextHref={page.query.page < page.pages ? directoryHref({ ...base, page: String(page.query.page + 1) }) : null}
          />
        </>
      )}
    </>
  );
}
