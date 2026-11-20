import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Locale } from "@/lib/i18n/dict";
import { Interpolated, Ltr, PlatformStatusTag } from "./companies-kit";
import { pt, type PlatformStringKey } from "./i18n";

// ---------------------------------------------------------------------------------------------
// Customer-user directory building blocks (PO-03B). Server-compatible (no hooks, no state). They receive FINISHED
// view models — every date and number is already formatted on the server (src/lib/platform/display.ts) and every
// link is a fixed /platform path built there — so nothing here formats, reads a cookie or calls the server. Account
// status and the primary-owner designation are neutral status tags from the ONE Platform Owner state table
// (companies-kit.tsx, rule 29); Latin-only values (e-mails, USR / ORG references, counts) are isolated left-to-right.
// ---------------------------------------------------------------------------------------------

/** PO-03D: `enforced` (the limit applies) and `full` (no seat left) add a limit note under the numbers. */
export type UserSeatsView = { occupied: string; seats: string | null; overBy: string | null; enforced: boolean; full: boolean } | null;
/** PO-03D: who occupies a company's seats, as finished numbers (built on the server: src/lib/platform/display.ts). */
export type SeatBreakdownView = { users: number; usersText: string; pending: number; pendingText: string; occupiedText: string; seats: number | null; seatsText: string | null };
export type SeatLimitState = "enforced" | "subscription_required" | "unavailable" | "not_enforced";
export type UserRowView = {
  userId: number;
  href: string;
  name: string;
  email: string;
  reference: string;
  role: string;
  isActive: boolean;
  mfaEnabled: boolean;
  primaryOwner: "yes" | "no" | "not_installed" | "unavailable";
  company: { name: string; reference: string; href: string };
  seats: UserSeatsView;
  lastSignIn: string | null;
  created: string;
};

const ROLE_LABEL: Record<string, PlatformStringKey> = { owner: "role.owner", admin: "role.admin", staff: "role.staff" };

/** A customer role as a label; an unknown stored value shows its raw text. */
export function RoleText({ locale, role }: { locale: Locale; role: string }) {
  const key = Object.prototype.hasOwnProperty.call(ROLE_LABEL, role) ? ROLE_LABEL[role] : null;
  return key ? <>{pt(locale, key)}</> : <Ltr>{role}</Ltr>;
}

/** Role, plus the Primary owner tag for the company's mapped primary owner. */
export function RoleCell({ locale, role, primaryOwner }: { locale: Locale; role: string; primaryOwner: UserRowView["primaryOwner"] }) {
  return (
    <div className="platform-user-role">
      <span>
        <RoleText locale={locale} role={role} />
      </span>
      {primaryOwner === "yes" && <PlatformStatusTag locale={locale} domain="user_designation" value="primary_owner" />}
    </div>
  );
}

export function AccountStatus({ locale, isActive }: { locale: Locale; isActive: boolean }) {
  return <PlatformStatusTag locale={locale} domain="user_account" value={isActive ? "active" : "disabled"} />;
}

export function MfaText({ locale, enabled }: { locale: Locale; enabled: boolean }) {
  return <>{pt(locale, enabled ? "cu.mfaOn" : "cu.mfaOff")}</>;
}

/** Occupied seats against the company's current allowance (display only). */
export function SeatCell({ locale, seats }: { locale: Locale; seats: UserSeatsView }) {
  if (!seats) return <span className="platform-cell-sub">{pt(locale, "cu.seatsUnknown")}</span>;
  const occupied = <Ltr>{seats.occupied}</Ltr>;
  const allowance = seats.seats === null ? null : <Ltr>{seats.seats}</Ltr>;
  const over = seats.overBy === null ? null : <Ltr>{seats.overBy}</Ltr>;
  return (
    <div>
      <div>
        {allowance ? (
          <Interpolated template={pt(locale, "seats.occupiedOf")} values={{ occupied, seats: allowance }} />
        ) : (
          <Interpolated template={pt(locale, "cu.seatsNoAllowance")} values={{ occupied }} />
        )}
      </div>
      {over && (
        <div className="platform-cell-sub">
          <Interpolated template={pt(locale, seats.enforced ? "cu.seatsOverEnforced" : "cu.seatsOver")} values={{ n: over }} />
        </div>
      )}
      {!over && seats.enforced && seats.full && <div className="platform-cell-sub">{pt(locale, "cu.seatsFull")}</div>}
    </div>
  );
}

/** PO-03D: "2 users + 1 pending invitation = 3 of 3 seats occupied" (counts isolated left-to-right). */
export function SeatBreakdown({ locale, view }: { locale: Locale; view: SeatBreakdownView }) {
  const users = view.users === 1 ? pt(locale, "seats.usersOne") : <Interpolated template={pt(locale, "seats.usersMany")} values={{ n: <Ltr>{view.usersText}</Ltr> }} />;
  const pending = view.pending === 1 ? pt(locale, "seats.pendingOne") : <Interpolated template={pt(locale, "seats.pendingMany")} values={{ n: <Ltr>{view.pendingText}</Ltr> }} />;
  const template = view.seats === null ? pt(locale, "seats.breakdown") : pt(locale, view.seats === 1 ? "seats.breakdownOfOne" : "seats.breakdownOf");
  return <Interpolated template={template} values={{ users, pending, occupied: <Ltr>{view.occupiedText}</Ltr>, seats: view.seatsText === null ? null : <Ltr>{view.seatsText}</Ltr> }} />;
}

/** PO-03D: the "User limit" value — "Enforced" never appears without a subscription, a readable foundation and the switch. */
export function SeatLimitText({ locale, state }: { locale: Locale; state: SeatLimitState }) {
  return <>{pt(locale, state === "enforced" ? "seats.enforced" : state === "subscription_required" ? "seats.subscriptionRequired" : state === "unavailable" ? "seats.enforcementUnavailable" : "seats.notEnforced")}</>;
}

function UserCell({ row }: { row: UserRowView }) {
  return (
    <div className="platform-cell-company">
      <Link href={row.href} className="platform-company-link" dir="auto">
        {row.name}
      </Link>
      <div className="platform-cell-sub platform-email">
        <Ltr>{row.email}</Ltr>
      </div>
    </div>
  );
}

function CompanyCell({ row }: { row: UserRowView }) {
  return (
    <div>
      <Link href={row.company.href} className="platform-inline-link" dir="auto">
        {row.company.name}
      </Link>
      <div className="platform-cell-sub">
        <Ltr>{row.company.reference}</Ltr>
      </div>
    </div>
  );
}

/** Wide screens: the directory as a table (it scrolls inside its own frame when narrower than its columns). */
export function UserTable({ locale, rows, caption }: { locale: Locale; rows: UserRowView[]; caption: string }) {
  return (
    <div className="platform-company-table" data-testid="users-table">
      <Table list>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{pt(locale, "col.user")}</TableHead>
            <TableHead>{pt(locale, "col.company")}</TableHead>
            <TableHead>{pt(locale, "col.role")}</TableHead>
            <TableHead>{pt(locale, "col.status")}</TableHead>
            <TableHead>{pt(locale, "cu.colMfa")}</TableHead>
            <TableHead>{pt(locale, "col.lastSignIn")}</TableHead>
            <TableHead>{pt(locale, "cu.colCreated")}</TableHead>
            <TableHead>{pt(locale, "cu.colSeats")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.userId} data-testid={`user-row-${row.userId}`}>
              <TableCell wrap>
                <UserCell row={row} />
              </TableCell>
              <TableCell wrap>
                <CompanyCell row={row} />
              </TableCell>
              <TableCell>
                <RoleCell locale={locale} role={row.role} primaryOwner={row.primaryOwner} />
              </TableCell>
              <TableCell>
                <AccountStatus locale={locale} isActive={row.isActive} />
              </TableCell>
              <TableCell>
                <MfaText locale={locale} enabled={row.mfaEnabled} />
              </TableCell>
              <TableCell>{row.lastSignIn ?? <span className="platform-cell-sub">{pt(locale, "cu.never")}</span>}</TableCell>
              <TableCell>{row.created}</TableCell>
              <TableCell>
                <SeatCell locale={locale} seats={row.seats} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Narrow screens: one card per user with the same fields. */
export function UserCards({ locale, rows, label }: { locale: Locale; rows: UserRowView[]; label: string }) {
  return (
    <ul className="platform-record-cards" aria-label={label}>
      {rows.map((row) => (
        <li key={row.userId} className="card platform-record-card" data-testid={`user-card-${row.userId}`}>
          <div className="platform-record-head">
            <div className="min-w-0">
              <UserCell row={row} />
            </div>
            <AccountStatus locale={locale} isActive={row.isActive} />
          </div>
          <dl className="platform-record-fields">
            <div className="platform-record-wide">
              <dt>{pt(locale, "col.company")}</dt>
              <dd>
                <CompanyCell row={row} />
              </dd>
            </div>
            <div>
              <dt>{pt(locale, "col.role")}</dt>
              <dd>
                <RoleCell locale={locale} role={row.role} primaryOwner={row.primaryOwner} />
              </dd>
            </div>
            <div>
              <dt>{pt(locale, "cu.colMfa")}</dt>
              <dd>
                <MfaText locale={locale} enabled={row.mfaEnabled} />
              </dd>
            </div>
            <div>
              <dt>{pt(locale, "col.lastSignIn")}</dt>
              <dd>{row.lastSignIn ?? <span className="platform-cell-sub">{pt(locale, "cu.never")}</span>}</dd>
            </div>
            <div>
              <dt>{pt(locale, "cu.colCreated")}</dt>
              <dd>{row.created}</dd>
            </div>
            <div className="platform-record-wide">
              <dt>{pt(locale, "cu.colSeats")}</dt>
              <dd>
                <SeatCell locale={locale} seats={row.seats} />
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
