import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleAlert, History, ShieldOff } from "lucide-react";
import { Breadcrumbs, DetailPage, FieldGrid, Interpolated, Ltr, PageState, PlatformStatusTag } from "@/components/platform/companies-kit";
import { CustomerUserControls } from "@/components/platform/customer-user-controls";
import { CustomerUserRoleControl } from "@/components/platform/customer-user-role-control";
import { pt } from "@/components/platform/i18n";
import { EmptyPanel } from "@/components/platform/page-kit";
import { AccountStatus, MfaText, RoleText, SeatBreakdown, SeatLimitText } from "@/components/platform/users-kit";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Locale } from "@/lib/i18n/dict";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE } from "@/lib/platform/config";
import { USER_ACTIVITY_LIMIT, getCustomerUserDetail, type CustomerUserDetail } from "@/lib/platform/customer-users";
import { formatPlatformCount, formatPlatformDate, formatPlatformDateTime, seatBreakdownView, seatLimitState } from "@/lib/platform/display";
import { isPlatformError } from "@/lib/platform/errors";
import { requirePlatformSession } from "@/lib/platform/guards";

// One customer user (PO-03B): the account's allow-listed details, its company and seat usage, the account controls
// (disable / enable, sign out everywhere; PO-03C: change role) and the Platform Owner events about it. Loading this page
// is an audited view ("customer_user.viewed"): if the audit record cannot be written, no account data is rendered at
// all. Malformed or unknown ids are a 404. The controls' server actions re-authorize and step up on their own; nothing
// here can sign in as the user, reset a password or define a custom role (the primary-owner transfer is the company's).

type ActivityKey =
  | "event.userViewed"
  | "event.userDisabled"
  | "event.userEnabled"
  | "event.userSessionsRevoked"
  | "event.userDisableRejected"
  | "event.userEnableRejected"
  | "event.userRevokeRejected"
  | "event.userRoleChanged"
  | "event.userRoleRejected";
const ACTION_LABEL: Record<string, ActivityKey> = {
  "customer_user.viewed": "event.userViewed",
  "customer_user.disabled": "event.userDisabled",
  "customer_user.enabled": "event.userEnabled",
  "customer_user.sessions_revoked": "event.userSessionsRevoked",
  "customer_user.disable.rejected": "event.userDisableRejected",
  "customer_user.enable.rejected": "event.userEnableRejected",
  "customer_user.sessions_revoke.rejected": "event.userRevokeRejected",
  "customer_user.role_changed": "event.userRoleChanged",
  "customer_user.role_change.rejected": "event.userRoleRejected",
};

const count = (value: number) => <Ltr>{formatPlatformCount(value)}</Ltr>;

function primaryText(locale: Locale, flag: CustomerUserDetail["primaryOwner"]): string {
  return pt(locale, flag === "yes" ? "cu.primaryYes" : flag === "no" ? "cu.primaryNo" : flag === "not_installed" ? "cu.primaryNotInstalled" : "cu.primaryUnavailable");
}

function AccountPanel({ locale, d }: { locale: Locale; d: CustomerUserDetail }) {
  return (
    <section className="card platform-panel" aria-labelledby="user-account">
      <div className="platform-panel-head">
        <h2 id="user-account">{pt(locale, "cu.account")}</h2>
      </div>
      <div className="platform-panel-body">
        <FieldGrid
          items={[
            { label: pt(locale, "cu.fieldName"), value: <span dir="auto">{d.name}</span> },
            { label: pt(locale, "cu.fieldEmail"), value: <Ltr>{d.email}</Ltr> },
            { label: pt(locale, "cu.fieldReference"), value: <Ltr>{d.reference}</Ltr> },
            {
              label: pt(locale, "cu.fieldCompany"),
              value: (
                <>
                  <Link href={`/platform/companies/${d.company.orgId}`} className="platform-inline-link" dir="auto">
                    {d.company.name}
                  </Link>
                  <span className="platform-cell-sub">
                    <Ltr>{d.company.reference}</Ltr>
                  </span>
                </>
              ),
            },
            { label: pt(locale, "cu.fieldRole"), value: <RoleText locale={locale} role={d.role} /> },
            { label: pt(locale, "cu.fieldStatus"), value: <AccountStatus locale={locale} isActive={d.isActive} /> },
            { label: pt(locale, "cu.fieldPrimary"), value: primaryText(locale, d.primaryOwner) },
            { label: pt(locale, "cu.fieldMfa"), value: <MfaText locale={locale} enabled={d.mfaEnabled} /> },
            { label: pt(locale, "cu.fieldLastSignIn"), value: d.lastSignInAt ? formatPlatformDateTime(d.lastSignInAt, locale) : pt(locale, "cu.never") },
            { label: pt(locale, "cu.fieldCreated"), value: formatPlatformDateTime(d.createdAt, locale) },
            { label: pt(locale, "cu.fieldSessions"), value: count(d.liveSessions) },
          ]}
        />
      </div>
    </section>
  );
}

/** PO-03C: why no role change is possible for this account (the role control applies the same rule; the server too). */
function roleNote(d: CustomerUserDetail): "cu.roleProtectedPrimary" | "cu.roleProtectedLast" | "cu.roleProtectionUnknown" | null {
  if (d.primaryOwner === "unavailable") return "cu.roleProtectionUnknown";
  if (d.role !== "owner") return null;
  if (d.primaryOwner === "yes") return "cu.roleProtectedPrimary";
  return d.isActive && d.lastActiveOwner ? "cu.roleProtectedLast" : null;
}

function ControlsPanel({ locale, d }: { locale: Locale; d: CustomerUserDetail }) {
  const protectedNote = d.isActive ? (d.primaryOwner === "yes" ? "cu.protectedPrimary" : d.lastActiveOwner ? "cu.protectedLast" : d.primaryOwner === "unavailable" ? "cu.protectionUnknown" : null) : null;
  const roleBlocked = roleNote(d);
  return (
    <section className="card platform-panel" aria-labelledby="user-controls" data-testid="user-controls">
      <div className="platform-panel-head">
        <h2 id="user-controls">{pt(locale, "cu.controls")}</h2>
      </div>
      <div className="platform-panel-body platform-detail-actions">
        <CustomerUserControls
          locale={locale}
          userId={d.userId}
          name={d.name}
          isActive={d.isActive}
          version={d.version}
          protection={{ primaryOwner: d.primaryOwner, lastActiveOwner: d.lastActiveOwner }}
          noteId={protectedNote ? "user-protection-note" : undefined}
        />
        <CustomerUserRoleControl
          locale={locale}
          userId={d.userId}
          orgId={d.company.orgId}
          name={d.name}
          role={d.role}
          isActive={d.isActive}
          version={d.version}
          protection={{ primaryOwner: d.primaryOwner, lastActiveOwner: d.lastActiveOwner }}
          noteId={roleBlocked ? "user-role-note" : undefined}
        />
        {protectedNote && (
          <p id="user-protection-note" className="platform-callout" data-tone="neutral" data-testid="user-protection-note">
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            <span>{pt(locale, protectedNote)}</span>
          </p>
        )}
        {roleBlocked && (
          <p id="user-role-note" className="platform-callout" data-tone="neutral" data-testid="user-role-note">
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            <span>{pt(locale, roleBlocked)}</span>
          </p>
        )}
        {d.liveSessions === 0 && <p className="platform-fine-print">{pt(locale, "cu.noSessions")}</p>}
        <p className="platform-fine-print">{pt(locale, "cu.controlsNote")}</p>
        <p className="platform-fine-print">{pt(locale, "cu.dataKeptNote")}</p>
        <p className="platform-fine-print">{pt(locale, "cu.limitsNote")}</p>
      </div>
    </section>
  );
}

function SeatsPanel({ locale, d }: { locale: Locale; d: CustomerUserDetail }) {
  const s = d.seats;
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
            <Interpolated template={pt(locale, "seats.allowanceFrom")} values={{ seats: count(a.seats), package: <bdi>{a.packageName}</bdi>, version: count(a.versionNumber) }} />
            <span className="platform-cell-sub">{pt(locale, "seats.until", { date: formatPlatformDate(new Date(`${a.endDate}T12:00:00Z`), locale) })}</span>
          </>
        ) : (
          pt(locale, a.state === "none" ? "seats.noSubscription" : "seats.notInstalled")
        ),
    });
    if (a.state === "assigned") items.push({ label: pt(locale, "seats.remaining"), value: count(s.remaining ?? 0) });
    items.push({ label: pt(locale, "seats.activeUsers"), value: count(s.users.active) });
    items.push({ label: pt(locale, "seats.disabledUsers"), value: count(s.users.disabled) });
  }
  items.push({ label: pt(locale, "seats.enforcementLabel"), value: <SeatLimitText locale={locale} state={seatLimitState(s)} /> });
  return (
    <section className="card platform-panel" aria-labelledby="user-seats" data-testid="user-seats">
      <div className="platform-panel-head">
        <h2 id="user-seats">{pt(locale, "cu.companySeats")}</h2>
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
        <p className="platform-fine-print mt-4">{pt(locale, s?.enforced ? "seats.noteEnforced" : "seats.note")}</p>
      </div>
    </section>
  );
}

function ActivityPanel({ locale, d }: { locale: Locale; d: CustomerUserDetail }) {
  return (
    <section className="card platform-panel" aria-labelledby="user-activity">
      <div className="platform-panel-head">
        <h2 id="user-activity">{pt(locale, "cu.activity")}</h2>
      </div>
      <div className="platform-panel-body platform-settings-stack">
        {d.activity.length ? (
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
              {d.activity.map((event) => {
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
          <EmptyPanel icon={History} message={pt(locale, "cu.activityNone")} />
        )}
        <p className="platform-fine-print">{pt(locale, "cu.activityNote", { n: formatPlatformCount(USER_ACTIVITY_LIMIT) })}</p>
      </div>
    </section>
  );
}

type RouteParams = Promise<{ userId: string }>;

export default async function PlatformCustomerUserPage({ params }: { params: RouteParams }) {
  await requirePlatformSession();
  const [locale, { userId }, store, requestHeaders] = await Promise.all([getLocale(), params, cookies(), headers()]);
  const req = { headers: requestHeaders, token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };
  const back = (
    <Link href="/platform/users" className="platform-inline-link">
      {pt(locale, "cu.back")}
    </Link>
  );

  let detail: CustomerUserDetail | null = null;
  let failure: "FORBIDDEN" | "AUDIT_UNAVAILABLE" | null = null;
  try {
    detail = await getCustomerUserDetail(req, userId);
  } catch (err) {
    if (isPlatformError(err, "UNAUTHORIZED") || isPlatformError(err, "SESSION_EXPIRED")) redirect("/platform/session-expired");
    if (isPlatformError(err, "NOT_FOUND")) notFound();
    if (isPlatformError(err, "FORBIDDEN")) failure = "FORBIDDEN";
    else if (isPlatformError(err, "AUDIT_UNAVAILABLE")) failure = "AUDIT_UNAVAILABLE";
    else throw err; // → the console error boundary (generic message + retry)
  }

  if (failure === "FORBIDDEN") {
    return <PageState icon={ShieldOff} title={pt(locale, "nav.users")} hint={pt(locale, "state.denied")} action={back} />;
  }
  if (failure === "AUDIT_UNAVAILABLE" || !detail) {
    return <PageState icon={CircleAlert} tone="danger" title={pt(locale, "cu.auditDownTitle")} hint={pt(locale, "cu.auditDownText")} action={back} />;
  }

  const d = detail;
  return (
    <DetailPage
      breadcrumbs={<Breadcrumbs locale={locale} items={[{ label: pt(locale, "nav.users"), href: "/platform/users" }, { label: d.name }]} />}
      title={d.name}
      description={
        <>
          <Ltr>{d.reference}</Ltr> · <bdi>{d.company.name}</bdi> · {pt(locale, "cu.createdOn", { date: formatPlatformDate(d.createdAt, locale) })}
        </>
      }
      meta={
        <span className="platform-user-role">
          <AccountStatus locale={locale} isActive={d.isActive} />
          {d.primaryOwner === "yes" && <PlatformStatusTag locale={locale} domain="user_designation" value="primary_owner" />}
        </span>
      }
    >
      <div className="platform-settings-stack">
        <AccountPanel locale={locale} d={d} />
        <ControlsPanel locale={locale} d={d} />
        <SeatsPanel locale={locale} d={d} />
        <ActivityPanel locale={locale} d={d} />
      </div>
      <p className="platform-fine-print">{pt(locale, "cu.viewAudited")}</p>
    </DetailPage>
  );
}
