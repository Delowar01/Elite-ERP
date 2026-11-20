import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleAlert, Database, Info, ShieldOff, TriangleAlert } from "lucide-react";
import { Breadcrumbs, DetailPage, FieldGrid, Ltr, PageState, PlatformStatusTag } from "@/components/platform/companies-kit";
import { pt, type PlatformStringKey } from "@/components/platform/i18n";
import { InvitationTimeline, type InvitationEventView } from "@/components/platform/invitations-kit";
import { UserInvitationRowActions } from "@/components/platform/user-invitation-dialogs";
import type { Locale } from "@/lib/i18n/dict";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE } from "@/lib/platform/config";
import { formatPlatformDateTime } from "@/lib/platform/display";
import { isPlatformError } from "@/lib/platform/errors";
import { isCustomerUserInviteAcceptanceEnabled, isPlatformUserInvitationsEnabled } from "@/lib/platform/flags";
import { requirePlatformSession } from "@/lib/platform/guards";
import { getUserInvitationDetail, type UserInvitationDetail } from "@/lib/platform/user-invitations";

// One customer-user invitation (PO-03C, sub-batch C): its allow-listed details and its lifecycle (created, re-issued,
// revoked — from the append-only audit trail), with Re-issue / Revoke while it is not accepted. Loading this page is an
// audited view ("user_invitation.viewed"): if the record cannot be written, nothing is rendered. Unknown or malformed
// ids are a 404, and so is the whole page while PLATFORM_USER_INVITATIONS_ENABLED is not "true". No token, hash or link
// is ever shown here — the link exists only once, in the dialog that created it.

const EVENT_LABEL: Record<string, PlatformStringKey> = {
  "user_invitation.created": "event.uinvCreated",
  "user_invitation.reissued": "event.uinvReissued",
  "user_invitation.revoked": "event.uinvRevoked",
  "user_invitation.revoke.rejected": "event.uinvRevokeRejected",
  "user_invitation.reissue.rejected": "event.uinvReissueRejected",
};
const ROLE_KEY = { admin: "role.admin", staff: "role.staff" } as const;

// The two reasons the console writes itself (a re-issue, an expired slot reused) are shown in the reader's language,
// with the related invitation as a link; an operator's own reason is shown as entered.
const SYSTEM_REASON = /^(Re-issued as|Expired; replaced by) (UIN-[0-9A-F]{8})$/;

function events(locale: Locale, d: UserInvitationDetail): InvitationEventView[] {
  return d.events.map((e, i) => {
    const label = EVENT_LABEL[e.action] ? pt(locale, EVENT_LABEL[e.action]) : e.action;
    const system = e.reason ? SYSTEM_REASON.exec(e.reason) : null;
    const related = system
      ? { text: pt(locale, system[1] === "Re-issued as" ? "event.reissuedAs" : "event.expiredReplacedBy"), reference: system[2] }
      : e.replacedBy
        ? { text: pt(locale, "event.replacedBy"), reference: e.replacedBy }
        : e.replaces
          ? { text: pt(locale, "event.replaces"), reference: e.replaces }
          : null;
    return {
      key: `${e.action}-${e.at.getTime()}-${i}`,
      label: e.stage ? `${label} (${e.stage})` : label,
      at: formatPlatformDateTime(e.at, locale),
      actor: e.actor,
      reason: system ? null : e.reason,
      result: e.result,
      related: related ? { ...related, href: `/platform/users/invitations?q=${related.reference}` } : null,
    };
  });
}

type RouteParams = Promise<{ invitationId: string }>;

export default async function PlatformUserInvitationPage({ params }: { params: RouteParams }) {
  await requirePlatformSession();
  if (!isPlatformUserInvitationsEnabled()) notFound();
  const [locale, { invitationId }, store, requestHeaders] = await Promise.all([getLocale(), params, cookies(), headers()]);
  const req = { headers: requestHeaders, token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };
  const back = (
    <Link href="/platform/users/invitations" className="platform-inline-link">
      {pt(locale, "uinv.back")}
    </Link>
  );

  let detail: UserInvitationDetail | null = null;
  let failure: "FORBIDDEN" | "AUDIT_UNAVAILABLE" | "NOT_INSTALLED" | null = null;
  try {
    detail = await getUserInvitationDetail(req, invitationId);
  } catch (err) {
    if (isPlatformError(err, "UNAUTHORIZED") || isPlatformError(err, "SESSION_EXPIRED")) redirect("/platform/session-expired");
    if (isPlatformError(err, "NOT_FOUND") || isPlatformError(err, "VALIDATION_FAILED") || isPlatformError(err, "USER_INVITATIONS_DISABLED")) notFound();
    if (isPlatformError(err, "FORBIDDEN")) failure = "FORBIDDEN";
    else if (isPlatformError(err, "AUDIT_UNAVAILABLE")) failure = "AUDIT_UNAVAILABLE";
    else if (isPlatformError(err, "USER_INVITATIONS_NOT_INSTALLED")) failure = "NOT_INSTALLED";
    else throw err; // → the console error boundary (generic message + retry)
  }
  if (failure === "FORBIDDEN") return <PageState icon={ShieldOff} title={pt(locale, "uinv.title")} hint={pt(locale, "state.denied")} action={back} />;
  if (failure === "NOT_INSTALLED") return <PageState icon={Database} title={pt(locale, "uinv.notInstalledTitle")} hint={pt(locale, "uinv.notInstalledText")} action={back} />;
  if (failure === "AUDIT_UNAVAILABLE" || !detail) return <PageState icon={CircleAlert} tone="danger" title={pt(locale, "uinv.unavailable")} hint={pt(locale, "company.auditDownText")} action={back} />;

  const d = detail;
  const none = pt(locale, "common.none");
  const target = { id: d.id, reference: d.reference, email: d.email, state: d.state };

  return (
    <DetailPage
      breadcrumbs={
        <Breadcrumbs
          locale={locale}
          items={[
            { label: pt(locale, "nav.users"), href: "/platform/users" },
            { label: pt(locale, "uinv.title"), href: "/platform/users/invitations" },
            { label: d.reference },
          ]}
        />
      }
      title={d.name}
      description={
        <>
          <span className="whitespace-nowrap">
            <Ltr>{d.reference}</Ltr>
          </span>{" "}
          · {pt(locale, "uinv.createdOn", { date: formatPlatformDateTime(d.createdAt, locale) })}
        </>
      }
      meta={<PlatformStatusTag locale={locale} domain="invitation" value={d.state} />}
      actions={d.state !== "accepted" ? <UserInvitationRowActions locale={locale} target={target} /> : undefined}
    >
      {!isCustomerUserInviteAcceptanceEnabled() ? (
        <p className="platform-callout" data-tone="warning">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          <span>{pt(locale, "uinv.noAcceptance")}</span>
        </p>
      ) : (
        d.state === "pending" && (
          <p className="platform-callout" data-tone="info">
            <Info className="size-4 shrink-0" aria-hidden />
            <span>{pt(locale, "uinv.acceptanceOpen")}</span>
          </p>
        )
      )}
      <section className="card platform-panel" aria-labelledby="user-invitation-details">
        <div className="platform-panel-head">
          <h2 id="user-invitation-details">{pt(locale, "inv.details")}</h2>
        </div>
        <div className="platform-panel-body">
          <FieldGrid
            items={[
              {
                label: pt(locale, "col.company"),
                value: (
                  <>
                    <Link href={`/platform/companies/${d.orgId}`} className="platform-inline-link" dir="auto">
                      {d.companyName}
                    </Link>{" "}
                    · <Ltr>{d.companyReference}</Ltr>
                  </>
                ),
              },
              { label: pt(locale, "uinv.name"), value: <span dir="auto">{d.name}</span> },
              { label: pt(locale, "uinv.email"), value: <Ltr>{d.email}</Ltr> },
              { label: pt(locale, "uinv.role"), value: pt(locale, ROLE_KEY[d.role]) },
              { label: pt(locale, "inv.invitedBy"), value: d.invitedBy ? <span dir="auto">{d.invitedBy}</span> : none },
              { label: pt(locale, "col.expires"), value: formatPlatformDateTime(d.expiresAt, locale) },
              { label: pt(locale, "inv.revokedAt"), value: d.revokedAt ? formatPlatformDateTime(d.revokedAt, locale) : none },
              { label: pt(locale, "inv.revokedBy"), value: d.revokedBy ? <span dir="auto">{d.revokedBy}</span> : none },
              { label: pt(locale, "inv.acceptedAt"), value: d.acceptedAt ? formatPlatformDateTime(d.acceptedAt, locale) : none },
            ]}
          />
        </div>
      </section>
      <section className="card platform-panel" aria-labelledby="user-invitation-history">
        <div className="platform-panel-head">
          <h2 id="user-invitation-history">{pt(locale, "inv.history")}</h2>
        </div>
        <div className="platform-panel-body">
          <InvitationTimeline locale={locale} events={events(locale, d)} />
        </div>
      </section>
      <p className="platform-fine-print">{pt(locale, "uinv.viewAudited")}</p>
    </DetailPage>
  );
}
