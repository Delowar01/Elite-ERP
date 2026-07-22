/**
 * Document lifecycle rules — the single source of truth for which actions are permitted on a
 * commercial document in a given status. Server actions (Batch A2+) will consult this module so
 * the UI and the server never disagree about what is allowed.
 *
 * This module is PURE (no DB, no I/O, no framework imports) so it can be unit-tested directly and
 * imported from anywhere. Batch A1 only DEFINES these rules — it does not change any existing
 * document behavior; no action is wired to it yet.
 *
 * Actions
 *   edit             mutate the document's own fields/line-items (drafts only)
 *   duplicate        create a NEW draft copy (never touches the original or its postings)
 *   archive          hide from default lists; reversible; no data/posting change
 *   soft_delete      move to the Recycle Bin (recordState=deleted); reversible via restore
 *   restore          bring a soft-deleted record back to active
 *   permanent_delete hard delete — owner-only, draft-only, unposted, unreferenced, from the bin
 *   cancel           terminal 'cancelled' transition for a NON-posted document (SO/PO); no posting
 *   void             reverse a POSTED-but-unsettled document (sent-unpaid invoice): reverses its
 *                    journal entry + restores stock in one transaction; status -> void
 *   reverse          correct a POSTED document that cannot be voided, via a corrective document
 *                    (Credit Note vs invoice, Debit Note vs received PO, reversing entry vs an
 *                    issued CN/DN) that transactionally updates the ledger AND linked
 *                    balances/status/stock. A bare reversing journal entry alone is NOT sufficient.
 */

export const DOCUMENT_TYPES = [
  "quotation",
  "sales_order",
  "proforma_invoice",
  "sales_invoice",
  "delivery_challan",
  "credit_note",
  "debit_note",
  "purchase_order",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const LIFECYCLE_ACTIONS = [
  "edit",
  "duplicate",
  "archive",
  "soft_delete",
  "restore",
  "permanent_delete",
  "cancel",
  "void",
  "reverse",
] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export type LifecycleRole = "owner" | "admin" | "staff";
export type RecordState = "active" | "archived" | "deleted";

/** Runtime facts the rules may depend on beyond the business status. */
export type LifecycleContext = {
  /** Actor's role. Required for permanent_delete (owner-only). Default: treated as staff. */
  role?: LifecycleRole;
  /** Soft-delete lifecycle state, orthogonal to business status. Default: "active". */
  recordState?: RecordState;
  /** True if a downstream document references this one (e.g. an SO created from this quotation). */
  isReferenced?: boolean;
  /** True if the document has recorded settlements (payments). Guards void vs reverse. */
  hasPayments?: boolean;
};

export type LifecycleDecision = { allowed: boolean; reason: string };

type StatusRule = {
  /** Has this status posted to the ledger and/or affected stock? */
  posted: boolean;
  /** No further business transitions from this status. */
  terminal: boolean;
  /** Statically-permitted actions in this status (before context guards). */
  allow: LifecycleAction[];
  /** When true, soft_delete additionally requires the document to be unreferenced. */
  softDeleteNeedsUnreferenced?: boolean;
};

// ---- The matrix (Phase 1B §5, refined). One row per (document type, business status). ----
const RULES: Record<DocumentType, Record<string, StatusRule>> = {
  quotation: {
    draft: { posted: false, terminal: false, allow: ["edit", "duplicate", "archive", "soft_delete", "permanent_delete"] },
    sent: { posted: false, terminal: false, allow: ["duplicate", "archive", "soft_delete"], softDeleteNeedsUnreferenced: true },
    accepted: { posted: false, terminal: false, allow: ["duplicate", "archive", "soft_delete"], softDeleteNeedsUnreferenced: true },
    rejected: { posted: false, terminal: true, allow: ["duplicate", "archive", "soft_delete"] },
    expired: { posted: false, terminal: true, allow: ["duplicate", "archive", "soft_delete"] },
  },
  sales_order: {
    draft: { posted: false, terminal: false, allow: ["edit", "duplicate", "archive", "soft_delete", "cancel", "permanent_delete"] },
    confirmed: { posted: false, terminal: false, allow: ["duplicate", "archive", "soft_delete", "cancel"], softDeleteNeedsUnreferenced: true },
    fulfilled: { posted: false, terminal: false, allow: ["duplicate", "archive", "soft_delete"], softDeleteNeedsUnreferenced: true },
    cancelled: { posted: false, terminal: true, allow: ["duplicate", "archive", "soft_delete"] },
  },
  proforma_invoice: {
    // Explicitly non-posting: never affects revenue or stock.
    draft: { posted: false, terminal: false, allow: ["edit", "duplicate", "archive", "soft_delete", "permanent_delete"] },
    sent: { posted: false, terminal: false, allow: ["duplicate", "archive", "soft_delete"], softDeleteNeedsUnreferenced: true },
  },
  sales_invoice: {
    draft: { posted: false, terminal: false, allow: ["edit", "duplicate", "archive", "soft_delete", "permanent_delete"] },
    // Posted + unpaid: may be voided (reverse JE + restore stock) OR corrected via a Credit Note.
    sent: { posted: true, terminal: false, allow: ["duplicate", "archive", "void", "reverse"] },
    // Posted + settled: cannot be voided (payments exist); correct only via a Credit Note.
    partially_paid: { posted: true, terminal: false, allow: ["duplicate", "reverse"] },
    paid: { posted: true, terminal: false, allow: ["duplicate", "reverse"] },
    void: { posted: false, terminal: true, allow: ["duplicate", "archive"] },
  },
  delivery_challan: {
    // Logistics-only: no stock/accounting posting, so soft_delete stays available when unreferenced.
    draft: { posted: false, terminal: false, allow: ["edit", "duplicate", "archive", "soft_delete", "permanent_delete"] },
    dispatched: { posted: false, terminal: false, allow: ["duplicate", "archive", "soft_delete"], softDeleteNeedsUnreferenced: true },
    delivered: { posted: false, terminal: true, allow: ["duplicate", "archive", "soft_delete"] },
  },
  credit_note: {
    // Bound to a source invoice -> no free-standing duplicate.
    draft: { posted: false, terminal: false, allow: ["edit", "archive", "soft_delete", "permanent_delete"] },
    // Posted (reversing entry against the source invoice). Correct only via a further reversing entry.
    issued: { posted: true, terminal: true, allow: ["archive", "reverse"] },
    // Reversed: the issue entry has been backed out and the invoice balance restored. Net-zero, terminal.
    reversed: { posted: false, terminal: true, allow: ["archive"] },
  },
  debit_note: {
    draft: { posted: false, terminal: false, allow: ["edit", "archive", "soft_delete", "permanent_delete"] },
    issued: { posted: true, terminal: true, allow: ["archive", "reverse"] },
    reversed: { posted: false, terminal: true, allow: ["archive"] },
  },
  purchase_order: {
    draft: { posted: false, terminal: false, allow: ["edit", "duplicate", "archive", "soft_delete", "cancel", "permanent_delete"] },
    // Sent to vendor, not yet posted: may be cancelled; not soft-deleted (it is out with the vendor).
    ordered: { posted: false, terminal: false, allow: ["duplicate", "archive", "cancel"] },
    // Received -> inventory + AP posted. Correct only via a Debit Note (return).
    received: { posted: true, terminal: false, allow: ["duplicate", "reverse"] },
    cancelled: { posted: false, terminal: true, allow: ["duplicate", "archive", "soft_delete"] },
  },
};

export function documentStatuses(docType: DocumentType): string[] {
  return Object.keys(RULES[docType]);
}

export function isKnownStatus(docType: DocumentType, status: string): boolean {
  return Boolean(RULES[docType] && RULES[docType][status]);
}

/** True if the document has posted to the ledger and/or affected stock in this status. */
export function isPosted(docType: DocumentType, status: string): boolean {
  const rule = RULES[docType]?.[status];
  return Boolean(rule?.posted);
}

/**
 * The corrective path for a posted document — used to explain why edit/delete are refused and to
 * point the caller (and audit log) at the safe alternative.
 */
export function correctionPath(docType: DocumentType): string {
  switch (docType) {
    case "sales_invoice":
      return "void an unpaid invoice, or issue a Credit Note against a settled one";
    case "purchase_order":
      return "issue a Debit Note against the received purchase order";
    case "credit_note":
    case "debit_note":
      return "post a reversing entry (updates the ledger and the linked document together)";
    default:
      return "create a corrective document";
  }
}

/**
 * Decide whether `action` is permitted on a document of `docType` currently in `status`,
 * given the runtime `ctx`. Returns a decision plus a human/audit-readable reason.
 */
export function evaluate(
  docType: DocumentType,
  status: string,
  action: LifecycleAction,
  ctx: LifecycleContext = {},
): LifecycleDecision {
  const rule = RULES[docType]?.[status];
  if (!rule) return { allowed: false, reason: `Unknown status "${status}" for ${docType}.` };

  const recordState: RecordState = ctx.recordState ?? "active";
  const deny = (reason: string): LifecycleDecision => ({ allowed: false, reason });
  const allow = (reason: string): LifecycleDecision => ({ allowed: true, reason });

  // ---- recordState-scoped actions (orthogonal to business status) ----
  if (action === "restore") {
    return recordState === "deleted"
      ? allow("Restore a soft-deleted record from the Recycle Bin.")
      : deny("Only soft-deleted records (in the Recycle Bin) can be restored.");
  }
  if (action === "permanent_delete") {
    // Owner-only, draft-only, unposted, unreferenced, and only from the Recycle Bin.
    if (recordState !== "deleted") return deny("Permanent delete is only allowed from the Recycle Bin (soft-delete first).");
    if (ctx.role !== "owner") return deny("Permanent delete is owner-only.");
    if (status !== "draft" || rule.posted) return deny("Permanent delete is draft-only; posted/finalized documents can never be permanently deleted.");
    if (ctx.isReferenced) return deny("Cannot permanently delete a document referenced by another document.");
    return allow("Owner permanently deleting an unreferenced draft from the Recycle Bin (audit record + document-number tombstone retained).");
  }
  // A record sitting in the Recycle Bin only supports restore / permanent_delete (handled above).
  if (recordState === "deleted") {
    return deny("Record is in the Recycle Bin; restore it before any other action.");
  }

  const permitted = rule.allow.includes(action);

  // ---- edit: drafts only, always ----
  if (action === "edit") {
    if (status !== "draft" || rule.posted) {
      return deny(`Only draft documents can be edited. A ${status} ${docType} must be corrected — ${correctionPath(docType)}.`);
    }
    return permitted ? allow("Edit a draft document.") : deny(`Edit is not available for a ${status} ${docType}.`);
  }

  // ---- soft_delete: never for posted; reference-guarded where required ----
  if (action === "soft_delete") {
    if (!permitted) return deny(rule.posted ? `A posted ${docType} (${status}) cannot be deleted; ${correctionPath(docType)}.` : `Soft delete is not available for a ${status} ${docType} (archive it instead).`);
    if (rule.softDeleteNeedsUnreferenced && ctx.isReferenced) return deny(`This ${status} ${docType} is referenced downstream; archive or version it instead of deleting.`);
    return allow(`Move the ${status} ${docType} to the Recycle Bin.`);
  }

  // ---- void: posted, unpaid only. The settlement guard must run even when the status
  // otherwise permits void — a "sent" invoice can carry payments or a credit note against
  // it (paidAmount > 0) while still being "sent", and those must not be voided. ----
  if (action === "void") {
    if (!permitted) return deny(rule.posted ? `A ${status} ${docType} cannot be voided; ${correctionPath(docType)}.` : `Nothing to void: a ${status} ${docType} has not posted.`);
    if (ctx.hasPayments) return deny("A settled invoice cannot be voided; issue a Credit Note instead.");
    return allow(`Void the ${status} ${docType}: reverse its journal entry and restore stock in one transaction.`);
  }

  // ---- everything else: base allow-list + a reason ----
  if (!permitted) {
    if (action === "reverse" && !rule.posted) return deny(`Nothing to ${action}: a ${status} ${docType} has not posted.`);
    return deny(`${action} is not available for a ${status} ${docType}.`);
  }
  switch (action) {
    case "duplicate":
      return allow(`Create a new draft copy of the ${docType} (original untouched).`);
    case "archive":
      return allow(`Archive the ${status} ${docType} (hidden from lists, reversible).`);
    case "cancel":
      return allow(`Cancel the ${status} ${docType} (terminal, no ledger/stock effect).`);
    case "reverse":
      return allow(`Correct the posted ${docType} via ${correctionPath(docType)} — transactional, updating the ledger and linked balances/stock together.`);
    default:
      return allow(`${action} permitted.`);
  }
}

export function can(docType: DocumentType, status: string, action: LifecycleAction, ctx: LifecycleContext = {}): boolean {
  return evaluate(docType, status, action, ctx).allowed;
}

/** All actions currently permitted for this document, given the context. */
export function allowedActions(docType: DocumentType, status: string, ctx: LifecycleContext = {}): LifecycleAction[] {
  return LIFECYCLE_ACTIONS.filter((a) => evaluate(docType, status, a, ctx).allowed);
}

/** Throwing guard for server actions (Batch A2+): use at the top of every mutating action. */
export function assertAllowed(docType: DocumentType, status: string, action: LifecycleAction, ctx: LifecycleContext = {}): void {
  const d = evaluate(docType, status, action, ctx);
  if (!d.allowed) throw new Error(`Lifecycle: ${action} not allowed on ${docType}/${status} — ${d.reason}`);
}
