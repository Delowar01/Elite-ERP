/**
 * The role model, as data.
 *
 * The Roles & Permissions panel renders this; `scratchpad/verify-role-matrix.mts` asserts it against
 * the actual guards in the code, in BOTH directions — every restriction declared here must have a
 * real guard, and every role guard in the app must be declared here. That is the point of the file:
 * the panel used to be hand-written prose describing checks that live elsewhere, so it drifted. Add
 * or remove a role gate without updating this, and the check fails loudly.
 *
 * There is no permissions engine. Access is decided by three idioms, all equivalent in effect:
 *   - requireRole(...) in a page or server action (redirects to /dashboard)
 *   - an inline `if (session.role === "staff") return { error }` where redirecting would be wrong
 *   - the document lifecycle rule matrix (document-lifecycle.ts), for permanent delete
 */

export type Access = "full" | "view" | "none";
export type RoleKey = "owner" | "admin" | "staff";

export type ModuleAccess = {
  /** i18n key for the module name. */
  module: string;
  owner: Access;
  admin: Access;
  staff: Access;
  /** i18n key: what "full" actually covers here, when it is worth spelling out. */
  note?: string;
};

/**
 * Module-level access. Where a role has `full`, nothing in that module checks its role — which for
 * Sales and Finance means full genuinely means full, including actions with accounting consequences.
 * See RESTRICTED_ACTIONS for the individual capabilities that are gated more tightly than the
 * module they sit in.
 */
export const MODULE_ACCESS: ModuleAccess[] = [
  {
    module: "Sales & Purchasing",
    owner: "full", admin: "full", staff: "full",
    note: "Includes sending invoices, voiding them, issuing credit and debit notes, and receiving purchase orders — all of which post to the ledger.",
  },
  {
    module: "Finance",
    owner: "full", admin: "full", staff: "full",
    note: "Includes recording payments and posting manual journal entries. Deleting a payment is restricted (below).",
  },
  { module: "Inventory", owner: "full", admin: "full", staff: "full" },
  { module: "Clients & Vendors", owner: "full", admin: "full", staff: "full" },
  { module: "Projects", owner: "full", admin: "full", staff: "full" },
  {
    module: "Employees & Attendance",
    owner: "full", admin: "full", staff: "full",
    note: "Approving or rejecting leave is restricted (below).",
  },
  { module: "Payroll", owner: "full", admin: "full", staff: "none" },
  {
    module: "Configuration",
    owner: "full", admin: "full", staff: "none",
    note: "Preset Management, Business Settings, Team and Compliance Center — including the numbering, validity and business-details popups reachable from a document builder.",
  },
  {
    module: "Security Center",
    owner: "full", admin: "full", staff: "full",
    note: "Self-service only: a member manages their own password, MFA and sessions.",
  },
];

export type RestrictedAction = {
  /** i18n key naming the capability. */
  action: string;
  /** Roles permitted. Everyone else is refused server-side. */
  allowed: RoleKey[];
  /** i18n key: why it is tighter than the module around it. */
  reason: string;
};

/**
 * Capabilities restricted more tightly than their module. These are the cells a module-level grid
 * cannot express, and every one of them is enforced on the server.
 */
export const RESTRICTED_ACTIONS: RestrictedAction[] = [
  {
    action: "Permanently delete a document",
    allowed: ["owner"],
    reason: "Irreversible, and only ever possible for an unposted, unreferenced draft already in the Recycle Bin.",
  },
  {
    action: "Permanently delete a client, vendor or product",
    allowed: ["owner"],
    reason: "Irreversible, and the record may have posted transactions behind it.",
  },
  {
    action: "Delete a payment",
    allowed: ["owner", "admin"],
    reason: "Reverses a posted ledger entry and restores the document's outstanding balance.",
  },
  {
    action: "Reverse a payment",
    allowed: ["owner", "admin"],
    reason:
      "Undoes a posted settlement: the payment is kept and marked reversed, a mirroring entry is posted, and the document's outstanding balance returns to what it was. Same tier as deleting a payment — the safer of the two must not be the more restricted one.",
  },
  {
    action: "Refund a customer advance",
    allowed: ["owner", "admin"],
    reason: "Pays money out of a bank account and releases the customer-advance liability.",
  },
  {
    action: "Approve or reject leave",
    allowed: ["owner", "admin"],
    reason: "Decides another member's time off and feeds attendance.",
  },
];
