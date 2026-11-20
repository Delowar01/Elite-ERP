import { Info, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { t, type Locale } from "@/lib/i18n/dict";
import { formatDisplayDate } from "@/lib/i18n/format-date";
import type { TeamOwnershipSummary } from "@/lib/team/seat-summary-types";

// PO-03A — the Team tab's read-only "User seats" summary: occupied seats against the current subscription's seats
// snapshot, the remaining seats or the (informational) excess, the package, and the company's primary owner.
// Display only. PO-03D: who occupies the seats ("2 users + 1 pending invitation = 3 of 3 seats occupied"), and — only
// while the limit is ENFORCED (CUSTOMER_SEAT_ENFORCEMENT_ENABLED on AND a current subscription) — a line when it is
// reached and an "enforced" note; otherwise the note says limits are not enforced. Numbers stay left-to-right in Arabic.

const fill = (template: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((text, [k, v]) => text.split(`{${k}}`).join(String(v)), template);
const num = (n: number) => <bdi dir="ltr">{n}</bdi>;

export function TeamSeatSummary({ locale, ownership, primaryOwnerName }: { locale: Locale; ownership: TeamOwnershipSummary; primaryOwnerName: string | null }) {
  const { seats, primaryOwner } = ownership;
  const owner =
    primaryOwner.state === "designated" && primaryOwnerName
      ? splitFill(t(locale, "Primary owner: {name}"), { name: <bdi>{primaryOwnerName}</bdi> })
      : t(locale, primaryOwner.state === "unavailable" ? "Primary owner: unavailable right now" : "Primary owner: not designated");

  return (
    <Card data-testid="team-seat-summary">
      <CardContent className="pt-5 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-surface-subtle text-ink-muted" aria-hidden>
            <Users className="size-[18px]" />
          </div>
          <div className="min-w-0 flex flex-col gap-1">
            <h3 className="text-body-sm font-medium text-ink-muted">{t(locale, "User seats")}</h3>
            {seats.available ? (
              <>
                <p className="text-title-sm font-semibold text-ink" data-testid="team-seat-occupied">
                  {seats.allowance.state === "assigned"
                    ? splitFill(t(locale, "{occupied} of {seats} user seats occupied"), { occupied: num(seats.occupied), seats: num(seats.allowance.seats) })
                    : splitFill(t(locale, "{occupied} user seats occupied"), { occupied: num(seats.occupied) })}
                </p>
                <p className="text-body-sm text-ink" data-testid="team-seat-breakdown">
                  {breakdown(locale, seats)}
                </p>
                {seats.enforced && (seats.overBy > 0 || seats.remaining === 0) && (
                  <p className="text-body-sm font-medium text-ink" data-testid="team-seat-limit">
                    {t(locale, seats.overBy > 0 ? "Above the user limit: existing members keep their access, but no member can be added." : "The user limit is reached: no member can be added until a seat is freed.")}
                  </p>
                )}
                <p className="text-body-sm text-ink-muted" data-testid="team-seat-detail">
                  {seats.allowance.state === "assigned" ? (
                    <>
                      {seats.overBy > 0
                        ? splitFill(t(locale, "Over the seat allowance by {n}"), { n: num(seats.overBy) })
                        : splitFill(t(locale, "Remaining seats: {n}"), { n: num(seats.remaining ?? 0) })}
                      {" · "}
                      {splitFill(t(locale, "{package} · Version {n}"), { package: <bdi>{seats.allowance.packageName}</bdi>, n: num(seats.allowance.versionNumber) })}
                      {" · "}
                      {fill(t(locale, "Until {date}"), { date: formatDisplayDate(seats.allowance.endDate, locale, "date") })}
                    </>
                  ) : (
                    t(locale, "No subscription assigned")
                  )}
                </p>
                <p className="text-caption text-ink-muted">
                  {splitFill(t(locale, "Active users: {n}"), { n: num(seats.users.active) })}
                  {" · "}
                  {splitFill(t(locale, "Disabled users: {n}"), { n: num(seats.users.disabled) })}
                </p>
              </>
            ) : (
              <p className="text-body-sm text-ink" data-testid="team-seat-unavailable">
                {t(locale, "Seat information is unavailable right now.")}
              </p>
            )}
            <p className="text-caption text-ink-muted" data-testid="team-primary-owner">
              {owner}
            </p>
          </div>
        </div>
        <p className="flex items-start gap-2 text-caption text-ink-faint" data-testid="team-seat-note">
          <Info className="size-3.5 shrink-0 mt-0.5" aria-hidden />
          <span>
            {t(
              locale,
              seats.available && seats.enforced
                ? "User limits are enforced. Active and disabled accounts both occupy a seat, and so does each pending invitation until it is revoked or expires."
                : "Seat limits are not enforced yet. Active and disabled accounts both occupy a seat.",
            )}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

type AvailableSeats = Extract<TeamOwnershipSummary["seats"], { available: true }>;

/** PO-03D: "{users} + {pending} = {occupied} of {seats} seats occupied", in the reader's language. */
function breakdown(locale: Locale, seats: AvailableSeats) {
  const users = seats.users.total === 1 ? t(locale, "1 user") : splitFill(t(locale, "{n} users"), { n: num(seats.users.total) });
  const pending = seats.pending === 1 ? t(locale, "1 pending invitation") : splitFill(t(locale, "{n} pending invitations"), { n: num(seats.pending) });
  const template =
    seats.allowance.state === "assigned"
      ? t(locale, seats.allowance.seats === 1 ? "{users} + {pending} = {occupied} of 1 seat occupied" : "{users} + {pending} = {occupied} of {seats} seats occupied")
      : t(locale, "{users} + {pending} = {occupied} occupied");
  return splitFill(template, { users: <>{users}</>, pending: <>{pending}</>, occupied: num(seats.occupied), seats: seats.allowance.state === "assigned" ? num(seats.allowance.seats) : null });
}

/** A translated template with React values in its `{name}` slots (numbers isolated left-to-right, names as <bdi>). */
function splitFill(template: string, vars: Record<string, React.ReactNode>) {
  const parts: React.ReactNode[] = [];
  let rest = template;
  for (;;) {
    const m = /\{(\w+)\}/.exec(rest);
    if (!m) break;
    if (m.index > 0) parts.push(rest.slice(0, m.index));
    parts.push(<span key={parts.length}>{vars[m[1]] ?? m[0]}</span>);
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) parts.push(rest);
  return parts;
}
