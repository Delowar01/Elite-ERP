"use server";

import { requireSession } from "@/lib/session";
import {
  getStatement, listStatementParties,
  type PartyKind, type Statement, type StatementFilters, type StatementDocType,
  CLIENT_DOC_TYPES, VENDOR_DOC_TYPES,
} from "@/lib/statements";

// Statement lookup used by the filter bar. Every call re-reads the session, so a statement can only
// ever be produced for the caller's own organization — the party id in the request is checked
// against that org before anything is computed.

export type StatementResponse = { error?: string; statement?: Statement };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Re-validate the client's filters server-side; never trust what the browser sent. */
function clean(kind: PartyKind, f: Partial<StatementFilters>): StatementFilters {
  const allowed = new Set<string>(kind === "client" ? CLIENT_DOC_TYPES : VENDOR_DOC_TYPES);
  const from = typeof f.from === "string" && ISO.test(f.from) ? f.from : "1900-01-01";
  const to = typeof f.to === "string" && ISO.test(f.to) ? f.to : "2999-12-31";
  const ps = f.paymentStatus;
  return {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    docTypes: (Array.isArray(f.docTypes) ? f.docTypes : []).filter((d) => allowed.has(d)) as StatementDocType[],
    paymentStatus: ps === "paid" || ps === "unpaid" || ps === "partial" ? ps : "all",
    currency: String(f.currency ?? "").trim().toUpperCase().slice(0, 3),
    search: String(f.search ?? "").trim().slice(0, 100),
  };
}

export async function getStatementAction(
  kind: PartyKind,
  partyId: number,
  filters: Partial<StatementFilters>,
): Promise<StatementResponse> {
  const session = await requireSession();
  if (kind !== "client" && kind !== "vendor") return { error: "Unknown statement type." };
  if (!Number.isInteger(partyId) || partyId <= 0) return { error: "Select a client or vendor first." };

  try {
    const statement = await getStatement(session.orgId, kind, partyId, clean(kind, filters));
    // Null means the party is not in this organization — same answer as "not found", so a probed id
    // reveals nothing about another organization's data.
    if (!statement) return { error: kind === "client" ? "Client not found." : "Vendor not found." };
    return { statement };
  } catch (err) {
    return { error: `Could not build the statement: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function listPartiesAction(kind: PartyKind) {
  const session = await requireSession();
  if (kind !== "client" && kind !== "vendor") return [];
  return listStatementParties(session.orgId, kind);
}
