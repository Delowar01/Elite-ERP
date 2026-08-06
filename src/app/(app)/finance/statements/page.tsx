import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { t } from "@/lib/i18n/dict";
import { listStatementParties, getStatement, presetRange, type PartyKind } from "@/lib/statements";
import { StatementView } from "./statement-view";

// Central statement report: pick a client or a vendor, then filter. The party lists are loaded
// tenant-scoped from the session, so the selector can only ever offer this organization's records.

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; party?: string }>;
}) {
  const session = await requireSession();
  const locale = await getLocale();
  const sp = await searchParams;

  const kind: PartyKind = sp.kind === "vendor" ? "vendor" : "client";
  const parties = await listStatementParties(session.orgId, kind);
  // Only accept a pre-selected party that actually belongs to this organization.
  const requested = Number(sp.party);
  const partyId = parties.some((p) => p.id === requested) ? requested : null;

  // First statement is computed here so the page paints with real data; later filter changes go
  // through the server action and swap the table in place.
  const range = presetRange("this_year")!;
  const initial = partyId != null ? await getStatement(session.orgId, kind, partyId, range) : null;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="main-head">
        <h3>{t(locale, "Client & Vendor Statements")}</h3>
      </div>
      <p className="text-[12.5px] text-ink-muted mb-3">
        {t(locale, "Statement of account built from posted ledger entries — opening balance, every transaction in the period, and the closing balance.")}
      </p>

      <div className="tab-row mb-3">
        <a className={`tab ${kind === "client" ? "active" : ""}`} href="/finance/statements?kind=client">{t(locale, "Client")}</a>
        <a className={`tab ${kind === "vendor" ? "active" : ""}`} href="/finance/statements?kind=vendor">{t(locale, "Vendor")}</a>
      </div>

      <StatementView locale={locale} kind={kind} partyId={partyId} parties={parties} initial={initial} />
    </div>
  );
}
