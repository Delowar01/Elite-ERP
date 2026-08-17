import { pgTable, serial, integer, text, numeric, date, timestamp, index } from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";
import { advanceApplicationsTable } from "./advance-applications";

/**
 * A release of some — or all — of one advance application.
 *
 * Commit 5 could mark an allocation released and be done, because release was all-or-nothing: an
 * invoice was voided, every allocation on it went back. A credit note is not all-or-nothing. A
 * 2,000 note against an invoice settled by an 8,000 advance releases a QUARTER of one allocation,
 * and the remaining three quarters keep settling the invoice. That cannot be expressed by a flag on
 * the allocation row.
 *
 * So consumption is recorded one level down, exactly as §2 records it one level up: the allocation
 * row is immutable — it is what actually posted — and every release against it is its own row. An
 * allocation's EFFECTIVE figures are its stored figures minus its live releases; the advance's
 * availability follows from that with no compensating write anywhere. Nothing is deleted, and
 * `advance_applications.appliedAmount` still means "what this application posted", not "what is
 * left of it", which is the property that lets a release mirror the entry that made it.
 *
 * The row is also the journal's identity: a release entry is keyed `(advance_application_release,
 * release.id)`, so an allocation released twice in two parts has two distinct entries rather than
 * a second one suppressed as a duplicate of the first.
 *
 * `reversedAt` is set when the CAUSE is undone (a reversed credit note), which re-applies the
 * allocation. A reversed release stops counting on both sides — its journal is mirrored back, and
 * the effective allocation returns to what it was.
 */
export const advanceApplicationReleasesTable = pgTable(
  "advance_application_releases",
  {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
      .notNull()
      .references(() => orgsTable.id, { onDelete: "cascade" }),
    allocationId: integer("allocation_id")
      .notNull()
      .references(() => advanceApplicationsTable.id),
    /** Document-currency amount released back to the advance. */
    releasedAmount: numeric("released_amount", { precision: 15, scale: 3 }).notNull(),
    /** Base-currency carried value returned to 2300 — the allocation's own carried base, apportioned. */
    releasedCarried: numeric("released_carried", { precision: 15, scale: 3 }).notNull(),
    /** Base-currency AR restored to 1100, apportioned from the allocation's `arCleared`. */
    releasedArCleared: numeric("released_ar_cleared", { precision: 15, scale: 3 }).notNull(),
    /** Why: an invoice void, or a credit note against the invoice. */
    reason: text("reason").notNull(),
    /**
     * What caused it — `sales_invoice` (a void) or `credit_note`. Together with `causeId` this is
     * the idempotency key: a retried void or a replayed credit-note issue finds its own rows and
     * releases nothing further. It is also how a reversal finds what to undo.
     */
    causeType: text("cause_type").notNull(),
    causeId: integer("cause_id").notNull(),
    releasedDate: date("released_date").notNull(),
    reversedAt: timestamp("reversed_at"),
    createdById: integer("created_by_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("aar_allocation_idx").on(t.orgId, t.allocationId),
    index("aar_cause_idx").on(t.orgId, t.causeType, t.causeId),
  ],
);

export type AdvanceApplicationRelease = typeof advanceApplicationReleasesTable.$inferSelect;
