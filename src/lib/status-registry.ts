// Status registry (DEV-UI-01.2) — the ONE place that decides how a status or state is presented.
//
// PURE: no React, no DB, no I/O. Server components, client components and verification suites all
// import it. It changes nothing about business state: every key below is an existing stored value
// (or an existing derived presentation key, marked as such); lifecycle rules stay in
// document-lifecycle.ts, settlement in settlement.ts. verify-status-registry pins the commercial
// domains to `documentStatuses()` so the two can never drift.
//
// Each entry separates four things that callers used to conflate:
//   raw value  — the object key (stored or derived; never changed here)
//   label      — the English display label ("Partially paid", not "partially_paid")
//   i18nKey    — the dictionary key for Arabic, owned explicitly per entry. It is NEVER derived from
//                the raw value: several raw values have no status-sense entry, and several title-case
//                words ("Pending", "Paid", "Received") mean something else elsewhere.
//   tone       — the semantic category, rendered with the DEV-UI-01.1 status tokens
//   pulse      — true only for states genuinely awaiting someone's action
//
// The domain is required because one raw value means different things in different places:
// `issued` (corrective note), `active` (project in progress vs. an active record), `pending`
// (leave awaiting approval vs. an invoice not yet due).

import { t, type Locale } from "@/lib/i18n/dict";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "corrective";

export type StatusDef = {
  readonly tone: StatusTone;
  readonly label: string;
  readonly i18nKey: string;
  readonly pulse?: boolean;
};

type Domain = Readonly<Record<string, StatusDef>>;
const def = (tone: StatusTone, label: string, i18nKey: string, pulse?: boolean): StatusDef =>
  pulse ? { tone, label, i18nKey, pulse } : { tone, label, i18nKey };

// ---- commercial documents: keys must equal documentStatuses(docType) exactly -------------------
const quotation: Domain = {
  draft: def("neutral", "Draft", "draft"),
  sent: def("info", "Sent", "sent"),
  accepted: def("success", "Accepted", "accepted"),
  rejected: def("danger", "Rejected", "rejected"),
  expired: def("warning", "Expired", "expired"),
};
const sales_order: Domain = {
  draft: def("neutral", "Draft", "draft"),
  confirmed: def("info", "Confirmed", "confirmed"),
  fulfilled: def("success", "Fulfilled", "fulfilled"),
  cancelled: def("danger", "Cancelled", "cancelled"),
};
const proforma_invoice: Domain = {
  draft: def("neutral", "Draft", "draft"),
  sent: def("info", "Sent", "sent"),
};
const sales_invoice: Domain = {
  draft: def("neutral", "Draft", "draft"),
  sent: def("info", "Sent", "sent"),
  partially_paid: def("warning", "Partially paid", "partially_paid"),
  paid: def("success", "Paid", "paid"),
  void: def("danger", "Void", "void"),
};
const delivery_challan: Domain = {
  draft: def("neutral", "Draft", "draft"),
  // In transit is normal progress, not an alert (was warning before DEV-UI-01.2).
  dispatched: def("info", "Dispatched", "dispatched"),
  delivered: def("success", "Delivered", "delivered"),
};
// A posted credit/debit note is a correction document; reversed is net-zero and inert.
const credit_note: Domain = {
  draft: def("neutral", "Draft", "draft"),
  issued: def("corrective", "Issued", "issued"),
  reversed: def("neutral", "Reversed", "reversed"),
};
const debit_note: Domain = {
  draft: def("neutral", "Draft", "draft"),
  issued: def("corrective", "Issued", "issued"),
  reversed: def("neutral", "Reversed", "reversed"),
};
const purchase_order: Domain = {
  draft: def("neutral", "Draft", "draft"),
  ordered: def("info", "Ordered", "ordered"),
  received: def("success", "Received", "received"),
  cancelled: def("danger", "Cancelled", "cancelled"),
};

// ---- derived presentation keys (not stored values) ----------------------------------------------
// Dashboard invoice overview: `partial` is derived from the stored `partially_paid`; `pending` and
// `overdue` are derived from `sent` + due date (dashboard/_shared/queries.ts).
const invoice_settlement: Domain = {
  paid: def("success", "Paid", "paid"),
  partial: def("warning", "Partial", "status.partial"),
  pending: def("info", "Pending", "status.invoice_pending"),
  overdue: def("danger", "Overdue", "status.overdue"),
};

// ---- other stored statuses ----------------------------------------------------------------------
const project: Domain = {
  planned: def("neutral", "Planned", "planned"),
  active: def("info", "Active", "active"),
  on_hold: def("warning", "On hold", "on_hold"),
  completed: def("success", "Completed", "completed"),
  cancelled: def("danger", "Cancelled", "cancelled"),
};
const task: Domain = {
  todo: def("neutral", "To do", "status.todo"),
  in_progress: def("info", "In progress", "status.in_progress"),
  blocked: def("danger", "Blocked", "status.blocked"),
  done: def("success", "Done", "status.done"),
};
const leave: Domain = {
  pending: def("warning", "Pending", "pending", true),
  approved: def("success", "Approved", "approved"),
  rejected: def("danger", "Rejected", "rejected"),
};
const attendance: Domain = {
  present: def("success", "Present", "status.present"),
  late: def("warning", "Late", "status.late"),
  on_leave: def("info", "On leave", "status.on_leave"),
  absent: def("neutral", "Absent", "status.absent"),
};
const employee: Domain = {
  active: def("success", "Active", "active"),
  inactive: def("neutral", "Inactive", "inactive"),
};
// `draft` here is the period before a run exists (no stored row) — the one state awaiting action.
const payroll_period: Domain = {
  draft: def("warning", "Draft", "draft", true),
  processed: def("success", "Processed", "processed"),
};
// Runs are only ever written as `processed` (hr/payroll/actions.ts). No `paid` state is invented.
const payroll_run: Domain = {
  processed: def("success", "Processed", "processed"),
};
const record_state: Domain = {
  archived: def("neutral", "Archived", "status.archived"),
  deleted: def("danger", "Deleted", "status.deleted"),
};
// Clients, vendors, products, bank accounts, team members (`isActive`).
const active_flag: Domain = {
  active: def("success", "Active", "active"),
  inactive: def("neutral", "Inactive", "inactive"),
};
// Derived from quantity on hand vs. reorder level.
const stock: Domain = {
  low_stock: def("warning", "Low stock", "status.low_stock"),
  in_stock: def("success", "In stock", "status.in_stock"),
};
const payment: Domain = {
  // English label must stay exactly "Reversed" (verify-payment-fx asserts it).
  reversed: def("neutral", "Reversed", "Reversed"),
};
// Derived from the project's computed cost health.
const project_health: Domain = {
  profitable: def("success", "Profitable", "Profitable"),
  loss: def("danger", "Loss", "Loss"),
  no_revenue: def("neutral", "No Revenue Yet", "No Revenue Yet"),
};
const consent: Domain = {
  granted: def("success", "Granted", "Granted"),
  withdrawn: def("neutral", "Withdrawn", "Withdrawn"),
};
const zatca_state: Domain = {
  enabled: def("success", "Enabled — Locked", "Enabled — Locked"),
  not_enabled: def("neutral", "Not Enabled", "Not Enabled"),
};
const exchange_rate_state: Domain = {
  stale: def("warning", "Stale", "Stale"),
};
const security_severity: Domain = {
  info: def("neutral", "Info", "status.severity_info"),
  low: def("info", "Low", "status.severity_low"),
  medium: def("warning", "Medium", "status.severity_medium"),
  high: def("danger", "High", "status.severity_high"),
  critical: def("danger", "Critical", "status.severity_critical"),
};

export const STATUS_REGISTRY = {
  quotation,
  sales_order,
  proforma_invoice,
  sales_invoice,
  delivery_challan,
  credit_note,
  debit_note,
  purchase_order,
  invoice_settlement,
  project,
  project_health,
  task,
  leave,
  attendance,
  employee,
  payroll_period,
  payroll_run,
  record_state,
  active_flag,
  stock,
  payment,
  consent,
  zatca_state,
  exchange_rate_state,
  security_severity,
} as const satisfies Record<string, Domain>;

export type StatusDomain = keyof typeof STATUS_REGISTRY;

export const STATUS_DOMAINS = Object.keys(STATUS_REGISTRY) as StatusDomain[];

export function isStatusDomain(v: string): v is StatusDomain {
  return Object.prototype.hasOwnProperty.call(STATUS_REGISTRY, v);
}

/** "partially_paid" → "Partially paid". Only used for values the registry does not know. */
export function humanizeStatus(raw: string): string {
  const words = raw.replace(/[_-]+/g, " ").trim();
  if (!words) return "Unknown";
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export type ResolvedStatus = StatusDef & { readonly known: boolean; readonly raw: string; readonly domain: StatusDomain };

/**
 * The presentation of `raw` in `domain`. Never throws: an unknown value is neutral, labelled with a
 * readable version of itself, and flagged `known: false`.
 */
export function resolveStatus(domain: StatusDomain, raw: string | null | undefined): ResolvedStatus {
  const value = (raw ?? "").trim();
  const found = (STATUS_REGISTRY[domain] as Domain)[value];
  if (found) return { ...found, known: true, raw: value, domain };
  const label = humanizeStatus(value);
  return { tone: "neutral", label, i18nKey: label, known: false, raw: value, domain };
}

/**
 * English → the registry label. Arabic → the entry's own dictionary key; if that translation is
 * missing, the readable English label (never a raw snake_case value).
 */
export function statusLabel(locale: Locale, domain: StatusDomain, raw: string | null | undefined): string {
  const s = resolveStatus(domain, raw);
  if (locale === "en") return s.label;
  const ar = t(locale, s.i18nKey);
  return ar === s.i18nKey ? s.label : ar;
}

/** Token pair per tone — the approved DEV-UI-01.1 status tokens; no new colour values. */
export const STATUS_TONE_TOKENS: Readonly<Record<StatusTone, { fg: string; bg: string }>> = {
  neutral: { fg: "var(--neutral)", bg: "var(--neutral-bg)" },
  info: { fg: "var(--info)", bg: "var(--info-bg)" },
  success: { fg: "var(--success)", bg: "var(--success-bg)" },
  warning: { fg: "var(--warning)", bg: "var(--warning-bg)" },
  danger: { fg: "var(--danger)", bg: "var(--danger-bg)" },
  corrective: { fg: "var(--corrective)", bg: "var(--corrective-bg)" },
};

/**
 * Text colour per tone, for a status-toned count or label that is not a tag (list KPI stat rows,
 * dashboard snapshot rows). Static class names only — Tailwind must see them literally; never build
 * a class from a tone string. This is the only tone → text-class mapping in the app.
 */
export const STATUS_TONE_TEXT_CLASS: Readonly<Record<StatusTone, string>> = {
  neutral: "text-neutral",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  corrective: "text-corrective",
};

/** The text class for `raw` in `domain` — the registry's tone, through STATUS_TONE_TEXT_CLASS. */
export function statusTextClass(domain: StatusDomain, raw: string | null | undefined): string {
  return STATUS_TONE_TEXT_CLASS[resolveStatus(domain, raw).tone];
}

export type StatusStat = {
  readonly label: string;
  readonly value: string;
  readonly colorClass: string;
  readonly tone: StatusTone;
  readonly status: string;
  readonly statusDomain: StatusDomain;
};

/** A KPI stat for the count of one status: label and tone both from the registry. */
export function statusStat(locale: Locale, domain: StatusDomain, raw: string, count: number | null | undefined): StatusStat {
  const s = resolveStatus(domain, raw);
  return {
    label: statusLabel(locale, domain, raw),
    value: String(count ?? 0),
    colorClass: STATUS_TONE_TEXT_CLASS[s.tone],
    tone: s.tone,
    status: s.raw,
    statusDomain: domain,
  };
}
