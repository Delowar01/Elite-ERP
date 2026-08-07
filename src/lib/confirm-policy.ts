import { t, type Locale } from "./i18n/dict";

/**
 * The confirmation policy — one place that decides WHICH actions need a confirmation popup, how
 * serious each one is, and what the popup says.
 *
 * Two rules this file exists to keep honest:
 *
 *  1. Confirmation is for consequences, not for clicks. Only actions that are destructive, hard to
 *     reverse, financially significant, or that change finalized/organization-wide data are listed
 *     here. Opening, viewing, previewing, downloading, searching, filtering, sorting, paginating and
 *     opening an ordinary draft form are deliberately absent — adding them would be confirmation
 *     fatigue, which makes the real warnings invisible.
 *  2. Every module reads its copy and severity from this registry rather than hand-writing a dialog,
 *     so the same kind of action never gets two different warnings in two different screens.
 *
 * The popup is UX protection only. Every action listed here is still authenticated, tenant-scoped,
 * permission-checked and status-checked on the server; nothing in this file is authorization.
 */

export type ConfirmSeverity = "standard" | "warning" | "danger" | "financial";

export const SENSITIVE_ACTIONS = [
  // --- commercial documents -------------------------------------------------------------------
  "document.edit",
  "document.convert",
  "document.submit", // send / issue / post — creates accounting postings and/or moves stock
  "document.receive",
  "document.void",
  "document.cancel",
  "document.reverse",
  "document.statusChange",
  "document.archive",
  "document.delete",
  "document.permanentDelete",
  // --- money ----------------------------------------------------------------------------------
  "payment.record",
  "payment.delete",
  "journal.post",
  // --- master data ----------------------------------------------------------------------------
  "record.delete",
  "record.permanentDelete",
  // --- configuration that changes future documents or compliance posture ----------------------
  "preset.delete",
  "preset.numbering",
  "settings.compliance",
  "settings.reset",
  "team.remove",
  "team.roleChange",
  // --- data in bulk ---------------------------------------------------------------------------
  "import.commit",
  "view.delete",
] as const;

export type SensitiveActionKind = (typeof SENSITIVE_ACTIONS)[number];

type PolicyEntry = {
  severity: ConfirmSeverity;
  /** i18n key for the verb: used both in the title and on the confirm button. Never "OK". */
  verb: string;
  /** i18n key for the sentence explaining what happens after confirming. */
  consequence: string;
  /** True when the action cannot be undone — the dialog says so explicitly. */
  irreversible?: boolean;
};

const POLICY: Record<SensitiveActionKind, PolicyEntry> = {
  "document.edit": {
    severity: "standard",
    verb: "Continue to Edit",
    consequence: "You are about to edit this document. Saved changes will update the document details.",
  },
  "document.convert": {
    severity: "standard",
    verb: "Convert",
    consequence: "A new document will be created from this one. The original stays as it is.",
  },
  "document.submit": {
    severity: "financial",
    verb: "Continue",
    consequence: "This will finalize the document and post the resulting accounting entries.",
  },
  "document.receive": {
    severity: "financial",
    verb: "Receive",
    consequence: "Receiving posts to inventory and accounts payable, and increases stock on hand.",
  },
  "document.void": {
    severity: "danger",
    verb: "Void",
    consequence: "The posted entry will be reversed and any stock movement restored.",
    irreversible: true,
  },
  "document.cancel": {
    severity: "warning",
    verb: "Cancel Document",
    consequence: "The document will be cancelled and can no longer move forward in its workflow.",
    irreversible: true,
  },
  "document.reverse": {
    severity: "financial",
    verb: "Reverse",
    consequence: "A reversing entry will be posted and the linked document's balance restored.",
    irreversible: true,
  },
  "document.statusChange": {
    severity: "warning",
    verb: "Change Status",
    consequence: "Changing the status moves this document forward in its workflow.",
  },
  "document.archive": {
    severity: "standard",
    verb: "Archive",
    consequence: "The document will be hidden from the default list. You can unarchive it later.",
  },
  "document.delete": {
    severity: "warning",
    verb: "Delete",
    consequence: "The document will be moved to the Recycle Bin, where it can still be restored.",
  },
  "document.permanentDelete": {
    severity: "danger",
    verb: "Delete Permanently",
    consequence: "The document and its line items will be erased from the Recycle Bin.",
    irreversible: true,
  },

  "payment.record": {
    severity: "financial",
    verb: "Record Payment",
    consequence: "The payment will be posted to the ledger and the document's balance updated.",
  },
  "payment.delete": {
    severity: "danger",
    verb: "Delete Payment",
    consequence: "The payment will be removed and its ledger posting reversed.",
    irreversible: true,
  },
  "journal.post": {
    severity: "financial",
    verb: "Post Entry",
    consequence: "The entry will be posted to the ledger and will affect account balances.",
  },

  "record.delete": {
    severity: "warning",
    verb: "Delete",
    consequence: "The record will be moved to the Recycle Bin, where it can still be restored.",
  },
  "record.permanentDelete": {
    severity: "danger",
    verb: "Delete Permanently",
    consequence: "The record will be erased from the Recycle Bin.",
    irreversible: true,
  },

  "preset.delete": {
    severity: "warning",
    verb: "Delete",
    consequence: "This preset will be removed. Documents already saved with it are not changed.",
    irreversible: true,
  },
  "preset.numbering": {
    severity: "warning",
    verb: "Save Numbering",
    consequence: "This changes the numbers given to documents created from now on.",
  },
  "settings.compliance": {
    severity: "warning",
    verb: "Continue",
    consequence: "This changes a compliance setting for the whole organization.",
  },
  "settings.reset": {
    severity: "warning",
    verb: "Reset",
    consequence: "The saved values will be replaced with the defaults for the whole organization.",
    irreversible: true,
  },
  "team.remove": {
    severity: "danger",
    verb: "Remove",
    consequence: "This person will lose access to the organization immediately.",
    irreversible: true,
  },
  "team.roleChange": {
    severity: "warning",
    verb: "Change Role",
    consequence: "This changes what this person is allowed to do across the whole organization.",
  },

  "import.commit": {
    severity: "warning",
    verb: "Import",
    consequence: "Records will be created or updated in bulk from the imported file.",
  },
  "view.delete": {
    severity: "standard",
    verb: "Delete",
    consequence: "This saved view will be removed. No documents are affected.",
    irreversible: true,
  },
};

/**
 * Actions that must NEVER trigger a confirmation. Listed explicitly so the intent is testable and a
 * future change cannot quietly start prompting on ordinary navigation.
 */
export const NON_SENSITIVE_ACTIONS = [
  "open", "view", "preview", "download", "print", "search", "filter", "sort", "paginate",
  "expand", "collapse", "openSettings", "openDraftForm", "closeDialog", "toggleTheme",
  "switchLanguage", "restore", "unarchive", "copyLink", "addToFavorites",
] as const;

export function requiresConfirmation(kind: string): kind is SensitiveActionKind {
  return kind in POLICY;
}

export function policyFor(kind: SensitiveActionKind): PolicyEntry {
  return POLICY[kind];
}

export type ConfirmDetail = { label: string; value: string };

export type ConfirmContentInput = {
  kind: SensitiveActionKind;
  /** i18n key for the record's type, e.g. "Sales Invoice" / "Client". */
  entityType?: string;
  /** The record's human identifier — a document number or a name. Never a database id. */
  entityNumber?: string;
  /** Overrides the registry's default sentence when a call site genuinely needs a specific one. */
  consequence?: string;
  /** Overrides the registry's verb (e.g. "Send Invoice" rather than the generic "Continue"). */
  verb?: string;
};

export type ConfirmContent = {
  title: string;
  description: string;
  confirmLabel: string;
  severity: ConfirmSeverity;
  irreversible: boolean;
};

/**
 * Build the popup's words from the policy. Composed from translated fragments (verb + record type +
 * number) rather than one baked sentence per module, so English and Arabic both read naturally and
 * no module can invent its own wording for an action that already has a policy.
 */
export function buildConfirmContent(locale: Locale, input: ConfirmContentInput): ConfirmContent {
  const entry = POLICY[input.kind];
  const verb = t(locale, input.verb ?? entry.verb);
  const subject = [input.entityType ? t(locale, input.entityType) : "", input.entityNumber ?? ""]
    .filter(Boolean)
    .join(" ")
    .trim();

  // "Void Sales Invoice INV-000123?" — or "Void this document?" when there is nothing to name.
  const title = subject ? `${verb} ${subject}?` : `${verb} ${t(locale, "this record")}?`;

  const consequence = t(locale, input.consequence ?? entry.consequence);
  const description = entry.irreversible
    ? `${consequence} ${t(locale, "This cannot be undone.")}`
    : consequence;

  return {
    title,
    description,
    confirmLabel: verb,
    severity: entry.severity,
    irreversible: Boolean(entry.irreversible),
  };
}
