import { cookies, headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CircleAlert, ShieldOff, TriangleAlert } from "lucide-react";
import { Breadcrumbs, DetailPage, FieldGrid, Ltr, PageState, PlatformStatusTag } from "@/components/platform/companies-kit";
import { pt, type PlatformStringKey } from "@/components/platform/i18n";
import { InvitationRowActions } from "@/components/platform/invitation-dialogs";
import { InvitationTimeline, type InvitationEventView } from "@/components/platform/invitations-kit";
import type { Locale } from "@/lib/i18n/dict";
import { getLocale } from "@/lib/i18n/server";
import { PLATFORM_SESSION_COOKIE } from "@/lib/platform/config";
import { formatPlatformDateTime } from "@/lib/platform/display";
import { isPlatformError } from "@/lib/platform/errors";
import { isPlatformInvitationsEnabled } from "@/lib/platform/flags";
import { requirePlatformSession } from "@/lib/platform/guards";
import { getInvitationHistory, type InvitationDetail } from "@/lib/platform/invitations";

// One company invitation (PO-02D2): its allow-listed details, the terms it offers and its lifecycle
// (created, re-issued, revoked — from the append-only audit trail), with Re-issue / Revoke while it is
// pending or expired. Loading this page is an audited view ("invitation.viewed"): if the record cannot be
// written, nothing is rendered. Unknown or malformed ids are a 404, and so is the whole page while
// PLATFORM_INVITATIONS_ENABLED is not "true". No token, hash or link is ever shown here.

const EVENT_LABEL: Record<string, PlatformStringKey> = {
  "invitation.created": "event.invitationCreated",
  "invitation.reissued": "event.invitationReissued",
  "invitation.revoked": "event.invitationRevoked",
  "invitation.revoke.rejected": "event.invitationRevokeRejected",
  "invitation.reissue.rejected": "event.invitationReissueRejected",
};

// The two reasons the console writes itself (a re-issue, an expired slot reused) are shown in the reader's language,
// with the related invitation as a link; an operator's own reason is shown as entered.
const SYSTEM_REASON = /^(Re-issued as|Expired; replaced by) (INV-[0-9A-F]{8})$/;

function events(locale: Locale, d: InvitationDetail): InvitationEventView[] {
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
      related: related ? { ...related, href: `/platform/companies?view=history&q=${related.reference}` } : null,
    };
  });
}

type RouteParams = Promise<{ invitationId: string }>;

export default async function PlatformInvitationPage({ params }: { params: RouteParams }) {
  await requirePlatformSession();
  if (!isPlatformInvitationsEnabled()) notFound();
  const [locale, { invitationId }, store, requestHeaders] = await Promise.all([getLocale(), params, cookies(), headers()]);
  const req = { headers: requestHeaders, token: store.get(PLATFORM_SESSION_COOKIE)?.value ?? null };
  const back = (
    <Link href="/platform/companies?view=invitations" className="platform-inline-link">
      {pt(locale, "inv.back")}
    </Link>
  );

  let detail: InvitationDetail | null = null;
  let failure: "FORBIDDEN" | "AUDIT_UNAVAILABLE" | null = null;
  try {
    detail = await getInvitationHistory(req, invitationId);
  } catch (err) {
    if (isPlatformError(err, "UNAUTHORIZED") || isPlatformError(err, "SESSION_EXPIRED")) redirect("/platform/session-expired");
    if (isPlatformError(err, "NOT_FOUND") || isPlatformError(err, "VALIDATION_FAILED") || isPlatformError(err, "INVITATIONS_DISABLED")) notFound();
    if (isPlatformError(err, "FORBIDDEN")) failure = "FORBIDDEN";
    else if (isPlatformError(err, "AUDIT_UNAVAILABLE")) failure = "AUDIT_UNAVAILABLE";
    else throw err; // → the console error boundary (generic message + retry)
  }
  if (failure === "FORBIDDEN") return <PageState icon={ShieldOff} title={pt(locale, "nav.companies")} hint={pt(locale, "state.denied")} action={back} />;
  if (failure === "AUDIT_UNAVAILABLE" || !detail) return <PageState icon={CircleAlert} tone="danger" title={pt(locale, "company.auditDownTitle")} hint={pt(locale, "company.auditDownText")} action={back} />;

  const d = detail;
  const none = pt(locale, "common.none");
  const actionable = d.state === "pending" || d.state === "expired";
  const target = { id: d.id, reference: d.reference, companyName: d.companyName, ownerEmail: d.ownerEmail, state: d.state };

  return (
    <DetailPage
      breadcrumbs={
        <Breadcrumbs
          locale={locale}
          items={[
            { label: pt(locale, "nav.companies"), href: "/platform/companies" },
            { label: pt(locale, "companies.pending"), href: "/platform/companies?view=invitations" },
            { label: d.reference },
          ]}
        />
      }
      title={d.companyName}
      description={
        <>
          <Ltr>{d.reference}</Ltr> · {pt(locale, "inv.createdOn", { date: formatPlatformDateTime(d.createdAt, locale) })}
        </>
      }
      meta={<PlatformStatusTag locale={locale} domain="invitation" value={d.state} />}
      actions={actionable ? <InvitationRowActions locale={locale} target={target} /> : undefined}
    >
      <p className="platform-callout" data-tone="warning">
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <span>{pt(locale, "inv.noAcceptance")}</span>
      </p>
      <div className="platform-panel-grid">
        <section className="card platform-panel" aria-labelledby="invitation-details">
          <div className="platform-panel-head">
            <h2 id="invitation-details">{pt(locale, "inv.details")}</h2>
          </div>
          <div className="platform-panel-body">
            <FieldGrid
              items={[
                { label: pt(locale, "invite.companyName"), value: <span dir="auto">{d.companyName}</span> },
                { label: pt(locale, "invite.industry"), value: d.industry ? <span dir="auto">{d.industry}</span> : pt(locale, "common.notSet") },
                { label: pt(locale, "invite.companyEmail"), value: <Ltr>{d.companyEmail}</Ltr> },
                { label: pt(locale, "invite.country"), value: d.country },
                { label: pt(locale, "invite.currency"), value: <Ltr>{d.currency}</Ltr> },
                { label: pt(locale, "invite.ownerName"), value: <span dir="auto">{d.ownerName}</span> },
                { label: pt(locale, "invite.ownerEmail"), value: <Ltr>{d.ownerEmail}</Ltr> },
                { label: pt(locale, "inv.invitedBy"), value: d.invitedBy ? <span dir="auto">{d.invitedBy}</span> : none },
                { label: pt(locale, "col.expires"), value: formatPlatformDateTime(d.expiresAt, locale) },
                { label: pt(locale, "inv.revokedAt"), value: d.revokedAt ? formatPlatformDateTime(d.revokedAt, locale) : none },
                { label: pt(locale, "inv.revokedBy"), value: d.revokedBy ? <span dir="auto">{d.revokedBy}</span> : none },
                { label: pt(locale, "inv.acceptedAt"), value: d.acceptedAt ? formatPlatformDateTime(d.acceptedAt, locale) : none },
              ]}
            />
          </div>
        </section>
        <section className="card platform-panel" aria-labelledby="invitation-terms">
          <div className="platform-panel-head">
            <h2 id="invitation-terms">{pt(locale, "terms.title")}</h2>
          </div>
          <div className="platform-panel-body">
            {d.terms ? (
              <FieldGrid
                items={[
                  { label: pt(locale, "terms.package"), value: `${pt(locale, "terms.packageTrial")} · ${pt(locale, "terms.version", { n: d.terms.versionNumber })}` },
                  { label: pt(locale, "terms.length"), value: pt(locale, "terms.days", { n: d.terms.trialDays }) },
                  { label: pt(locale, "terms.users"), value: <Ltr>{String(d.terms.includedSeats)}</Ltr> },
                  { label: pt(locale, "terms.storage"), value: pt(locale, "terms.gb", { n: d.terms.storageGb }) },
                  { label: pt(locale, "terms.cycle"), value: d.terms.cycle === "trial" ? pt(locale, "terms.cycleTrial") : <Ltr>{d.terms.cycle}</Ltr> },
                ]}
              />
            ) : (
              <p className="platform-cell-sub">{pt(locale, "terms.none")}</p>
            )}
            <p className="platform-fine-print mt-4">{pt(locale, "terms.note")}</p>
          </div>
        </section>
      </div>
      <section className="card platform-panel" aria-labelledby="invitation-history">
        <div className="platform-panel-head">
          <h2 id="invitation-history">{pt(locale, "inv.history")}</h2>
        </div>
        <div className="platform-panel-body">
          <InvitationTimeline locale={locale} events={events(locale, d)} />
        </div>
      </section>
      <p className="platform-fine-print">{pt(locale, "inv.viewAudited")}</p>
    </DetailPage>
  );
}
