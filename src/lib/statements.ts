import "server-only";
import { and, eq, inArray, lte, asc } from "drizzle-orm";
import {
  db, accountsTable, journalEntriesTable, journalLinesTable,
  customersTable, vendorsTable,
  salesInvoicesTable, creditNotesTable, purchaseOrdersTable, debitNotesTable,
  paymentsTable, proformaInvoicesTable, advanceApplicationsTable, advanceApplicationReleasesTable,
} from "@/db";
import { moneyEpsilon } from "@/lib/currency/currencies";
import { orgBaseCurrency } from "@/lib/org-currency";

// Client / Vendor statement of account.
//
// The numbers come from the LEDGER, not from document status or anything displayed on a screen:
// every line is a real posting against the organization's Accounts Receivable (clients) or Accounts
// Payable (vendors) control account. A draft invoice has not posted, so it is correctly absent; a
// sent one is present because it moved AR. Opening balance is the same computation over everything
// dated before the period, which is why opening + period movement always equals closing.
//
// Every query is scoped by orgId. Callers pass the session's orgId; nothing here trusts a URL.

export const AR_CODE = "1100"; // Accounts Receivable — debit-normal
export const AP_CODE = "2000"; // Accounts Payable — credit-normal
// Customer Advances — credit-normal. A client statement reads BOTH 1100 and 2300, because a
// customer's position with the business has two sides: what they owe us (AR) and what we hold for
// them (advances). See the sign-convention note in getStatement for how one balance column carries
// both coherently.
export const ADVANCES_CODE = "2300";

export type PartyKind = "client" | "vendor";

/** Document families a statement line can come from. Used by the Document Type filter. */
export type StatementDocType =
  | "sales_invoice" | "credit_note" | "payment_in"
  | "advance_receipt" | "advance_application" | "advance_release" | "advance_refund"
  | "purchase_order" | "debit_note" | "payment_out"
  | "journal";

export const CLIENT_DOC_TYPES: StatementDocType[] = [
  "sales_invoice", "credit_note", "payment_in",
  "advance_receipt", "advance_application", "advance_release", "advance_refund",
  "journal",
];
export const VENDOR_DOC_TYPES: StatementDocType[] = ["purchase_order", "debit_note", "payment_out", "journal"];

export const DOC_TYPE_LABEL: Record<StatementDocType, string> = {
  sales_invoice: "Invoice",
  credit_note: "Credit Note",
  payment_in: "Payment Received",
  advance_receipt: "Advance Received",
  advance_application: "Advance Applied",
  advance_release: "Advance Released",
  advance_refund: "Advance Refunded",
  purchase_order: "Purchase Order",
  debit_note: "Debit Note",
  payment_out: "Payment Made",
  journal: "Journal Entry",
};

/** Where a statement line's number links to. Built from the document id, never exposed on its own. */
const DOC_PATH: Record<StatementDocType, (id: number) => string | null> = {
  sales_invoice: (id) => `/sales/invoices/${id}`,
  credit_note: (id) => `/sales/credit-notes/${id}`,
  purchase_order: (id) => `/purchasing/orders/${id}`,
  debit_note: (id) => `/purchasing/debit-notes/${id}`,
  payment_in: () => "/finance/payments",
  advance_receipt: (id) => `/sales/proforma/${id}`,   // docId = the proforma the advance was received against
  advance_application: (id) => `/sales/invoices/${id}`, // docId = the invoice the advance settled
  advance_release: (id) => `/sales/invoices/${id}`,   // docId = the invoice whose allocation was released
  advance_refund: (id) => `/sales/proforma/${id}`,    // docId = the proforma whose advance was returned
  payment_out: () => "/finance/payments",
  journal: () => "/finance/ledger",
};

export type StatementFilters = {
  from: string;             // ISO date, inclusive
  to: string;               // ISO date, inclusive
  docTypes?: StatementDocType[];
  /** Sales invoices / purchase orders only: filter by how much is still outstanding. */
  paymentStatus?: "all" | "paid" | "unpaid" | "partial";
  currency?: string;        // ISO code; "" / undefined = all
  search?: string;          // document number or reference, case-insensitive substring
};

export type StatementLine = {
  date: string;
  docType: StatementDocType;
  docTypeLabel: string;
  number: string;
  description: string;
  reference: string;
  currency: string;
  paymentStatus: "paid" | "unpaid" | "partial" | "";
  debit: number;
  credit: number;
  /** Balance after this line, in the party's natural direction. */
  running: number;
  /** Link to the source document; null when the row has no dedicated page. */
  href: string | null;
};

export type StatementParty = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  vatNumber: string | null;
};

export type Statement = {
  kind: PartyKind;
  party: StatementParty;
  from: string;
  to: string;
  opening: number;
  closing: number;
  totalDebit: number;
  totalCredit: number;
  lines: StatementLine[];
  /** Currencies present on the party's documents, for the currency filter. */
  currencies: string[];
  /**
   * Clients only (0 for vendors): the customer's advance still held at `to` — the 2300 balance of
   * their lines (credits − debits). Available customer credit, shown beside the closing balance so
   * an advance is never mistaken for a negative receivable.
   */
  advancesHeld: number;
};

const n = (v: unknown) => Number(v ?? 0);

/** One ledger movement before it is attributed to a party. */
type RawLine = {
  entryId: number;
  date: string;
  memo: string | null;
  sourceType: string;
  sourceId: number | null;
  /** The control account this line hit — "1100", "2000" or "2300". */
  account: string;
  debit: number;
  credit: number;
};

/** Read every posting against the control account for this org, up to and including `to`. */
async function controlAccountLines(orgId: number, code: string, to: string): Promise<RawLine[]> {
  const [acct] = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.orgId, orgId), eq(accountsTable.code, code)));
  if (!acct) return [];

  const rows = await db
    .select({
      entryId: journalEntriesTable.id,
      date: journalEntriesTable.entryDate,
      memo: journalEntriesTable.memo,
      sourceType: journalEntriesTable.sourceType,
      sourceId: journalEntriesTable.sourceId,
      debit: journalLinesTable.debit,
      credit: journalLinesTable.credit,
    })
    .from(journalLinesTable)
    .innerJoin(journalEntriesTable, eq(journalLinesTable.journalEntryId, journalEntriesTable.id))
    .where(and(
      eq(journalEntriesTable.orgId, orgId),
      eq(journalLinesTable.accountId, acct.id),
      lte(journalEntriesTable.entryDate, to),
    ))
    .orderBy(asc(journalEntriesTable.entryDate), asc(journalEntriesTable.id));

  return rows.map((r) => ({
    entryId: r.entryId,
    date: String(r.date).slice(0, 10),
    memo: r.memo,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    account: code,
    debit: n(r.debit),
    credit: n(r.credit),
  }));
}

/** Everything needed to turn a ledger line into a statement row, loaded in one batch per table. */
type Attribution = {
  partyId: number | null;
  docType: StatementDocType;
  number: string;
  reference: string;
  currency: string;
  paymentStatus: StatementLine["paymentStatus"];
  docId: number | null;
};

// The "close enough to fully paid" threshold is half of the DOCUMENT's minor unit. A fixed 0.005
// marked a Kuwaiti invoice paid while 0.004 KWD — four fils — was still outstanding.
function payStatus(total: number, paid: number, currency: string): StatementLine["paymentStatus"] {
  if (paid <= 0) return "unpaid";
  if (paid + moneyEpsilon(currency) >= total) return "paid";
  return "partial";
}

/**
 * Resolve each ledger line to the party it belongs to. Journal entries carry `sourceType`/`sourceId`
 * rather than a party column, so attribution walks to the source document. A manual journal entry
 * has no document to walk to and therefore cannot be tied to one party — those are left out rather
 * than guessed onto somebody's statement.
 */
async function attribute(orgId: number, kind: PartyKind, raw: RawLine[]): Promise<Map<string, Attribution>> {
  // A document with no currency of its own IS in the organization's base currency, so that is the
  // fallback its paid/unpaid threshold uses — never a fixed two decimals.
  const base = await orgBaseCurrency(orgId);
  const idsOf = (t: string) => [...new Set(raw.filter((r) => r.sourceType === t && r.sourceId).map((r) => r.sourceId!))];
  const out = new Map<string, Attribution>();

  if (kind === "client") {
    const invIds = idsOf("sales_invoice"), cnIds = idsOf("credit_note");
    // An advance application's sourceId is its ALLOCATION's id — it used to be the payment's, and
    // the partial-allocation work re-keyed those entries. Attributing them through the payment
    // batch silently dropped every applied-advance line from the statement (an unattributed line is
    // filtered out, not shown unattributed), so a client appeared to owe an invoice their advance
    // had already settled AND to still hold that advance. Worse, where an allocation id happened to
    // equal an unrelated payment id, the line landed on that payment's party.
    const appIds = idsOf("advance_application");
    const releaseIds = [...new Set([...idsOf("advance_application_release"), ...idsOf("advance_application_release_reversal")])];
    const payIds = idsOf("payment");
    const [invs, cns, pays] = await Promise.all([
      invIds.length ? db.select({
        id: salesInvoicesTable.id, customerId: salesInvoicesTable.customerId, number: salesInvoicesTable.invoiceNumber,
        title: salesInvoicesTable.title, currency: salesInvoicesTable.currency,
        total: salesInvoicesTable.total, paid: salesInvoicesTable.paidAmount,
      }).from(salesInvoicesTable).where(and(eq(salesInvoicesTable.orgId, orgId), inArray(salesInvoicesTable.id, invIds))) : [],
      cnIds.length ? db.select({
        id: creditNotesTable.id, customerId: creditNotesTable.customerId, number: creditNotesTable.creditNoteNumber,
        reason: creditNotesTable.reason, currency: creditNotesTable.currency,
      }).from(creditNotesTable).where(and(eq(creditNotesTable.orgId, orgId), inArray(creditNotesTable.id, cnIds))) : [],
      payIds.length ? db.select({
        id: paymentsTable.id, reference: paymentsTable.reference, method: paymentsTable.method, kind: paymentsTable.kind,
        salesInvoiceId: paymentsTable.salesInvoiceId, proformaInvoiceId: paymentsTable.proformaInvoiceId,
      }).from(paymentsTable).where(and(eq(paymentsTable.orgId, orgId), inArray(paymentsTable.id, payIds))) : [],
    ]);
    // Applied payments' invoices may not have their own raw line in scope (e.g. filtered dates), so
    // fetch any invoice an application points at that the first batch missed.
    const missingInvIds = [...new Set(pays.map((p) => p.salesInvoiceId).filter((x): x is number => x != null && !invIds.includes(x)))];
    const extraInvs = missingInvIds.length
      ? await db.select({
          id: salesInvoicesTable.id, customerId: salesInvoicesTable.customerId, number: salesInvoicesTable.invoiceNumber,
          title: salesInvoicesTable.title, currency: salesInvoicesTable.currency,
          total: salesInvoicesTable.total, paid: salesInvoicesTable.paidAmount,
        }).from(salesInvoicesTable).where(and(eq(salesInvoicesTable.orgId, orgId), inArray(salesInvoicesTable.id, missingInvIds)))
      : [];

    const invById = new Map([...invs, ...extraInvs].map((i) => [i.id, i]));
    for (const i of invs) {
      out.set(keyOf("sales_invoice", i.id, AR_CODE), {
        partyId: i.customerId, docType: "sales_invoice", number: i.number,
        reference: i.title ?? "", currency: i.currency ?? "",
        paymentStatus: payStatus(n(i.total), n(i.paid), i.currency || base), docId: i.id,
      });
    }
    for (const c of cns) {
      out.set(keyOf("credit_note", c.id, AR_CODE), {
        partyId: c.customerId, docType: "credit_note", number: c.number,
        reference: c.reason ?? "", currency: c.currency ?? "", paymentStatus: "", docId: c.id,
      });
    }
    // A customer payment is attributed through the invoice (or proforma) it was recorded against.
    const proformaIds = [...new Set(pays.map((p) => p.proformaInvoiceId).filter((x): x is number => x != null))];
    const proformas = proformaIds.length
      ? await db.select({ id: proformaInvoicesTable.id, customerId: proformaInvoicesTable.customerId, number: proformaInvoicesTable.proformaNumber, currency: proformaInvoicesTable.currency })
          .from(proformaInvoicesTable).where(and(eq(proformaInvoicesTable.orgId, orgId), inArray(proformaInvoicesTable.id, proformaIds)))
      : [];
    const pfById = new Map(proformas.map((p) => [p.id, p]));
    for (const p of pays) {
      const inv = p.salesInvoiceId ? invById.get(p.salesInvoiceId) : undefined;
      const pf = p.proformaInvoiceId ? pfById.get(p.proformaInvoiceId) : undefined;
      const partyId = inv?.customerId ?? pf?.customerId ?? null;
      if (partyId == null) continue;
      const against = inv?.number ?? pf?.number ?? "";
      // The same payment id can carry lines on BOTH control accounts (its receipt on 2300, its
      // application on 1100 and 2300), so each (account, sourceType) pairing gets its own
      // attribution and a line only ever resolves through the account it actually hit.
      out.set(keyOf("payment", p.id, AR_CODE), {
        // No internal id is ever surfaced — the number column shows the payment reference when one
        // was recorded, and the row still carries its date, method and the document it settled.
        partyId, docType: "payment_in", number: p.reference?.trim() || "",
        reference: against ? `Against ${against}` : (p.method ?? ""),
        currency: inv?.currency ?? pf?.currency ?? "", paymentStatus: "", docId: p.id,
      });
      if (p.kind === "advance_receipt" || p.kind === "advance_refund") {
        out.set(keyOf("payment", p.id, ADVANCES_CODE), {
          partyId, docType: p.kind, number: p.reference?.trim() || "",
          reference: pf ? `Against ${pf.number}` : (p.method ?? ""),
          currency: pf?.currency ?? inv?.currency ?? "", paymentStatus: "", docId: p.proformaInvoiceId,
        });
      }
    }

    // Applications and their releases are attributed through the ALLOCATION, which is what those
    // journal entries are keyed by. An allocation names its own invoice, so this no longer depends
    // on `payments.salesInvoiceId` at all — the field can be cleared for advance receipts without
    // any statement row changing, and a PARTIAL application (which never carried that link) is
    // attributed for the first time.
    // Releases resolve to their allocation first, so one query covers both key spaces.
    const releaseRows = releaseIds.length
      ? await db
          .select({ id: advanceApplicationReleasesTable.id, allocationId: advanceApplicationReleasesTable.allocationId })
          .from(advanceApplicationReleasesTable)
          .where(and(eq(advanceApplicationReleasesTable.orgId, orgId), inArray(advanceApplicationReleasesTable.id, releaseIds)))
      : [];
    const allocIds = [...new Set([...appIds, ...releaseRows.map((r) => r.allocationId)])];
    const allocs = allocIds.length
      ? await db
          .select({
            id: advanceApplicationsTable.id,
            invoiceId: salesInvoicesTable.id,
            invoiceNumber: salesInvoicesTable.invoiceNumber,
            invoiceCurrency: salesInvoicesTable.currency,
            customerId: salesInvoicesTable.customerId,
            proformaNumber: proformaInvoicesTable.proformaNumber,
          })
          .from(advanceApplicationsTable)
          .innerJoin(salesInvoicesTable, eq(salesInvoicesTable.id, advanceApplicationsTable.salesInvoiceId))
          .leftJoin(paymentsTable, eq(paymentsTable.id, advanceApplicationsTable.advancePaymentId))
          .leftJoin(proformaInvoicesTable, eq(proformaInvoicesTable.id, paymentsTable.proformaInvoiceId))
          .where(and(eq(advanceApplicationsTable.orgId, orgId), inArray(advanceApplicationsTable.id, allocIds)))
      : [];
    const allocById = new Map(allocs.map((a) => [a.id, a]));
    const attrFor = (a: (typeof allocs)[number], docType: StatementDocType): Attribution => ({
      partyId: a.customerId, docType, number: a.invoiceNumber,
      reference: a.proformaNumber ? `Advance from ${a.proformaNumber}` : "",
      currency: a.invoiceCurrency ?? "", paymentStatus: "", docId: a.invoiceId,
    });
    for (const id of appIds) {
      const a = allocById.get(id);
      if (!a) continue;
      out.set(keyOf("advance_application", id, AR_CODE), attrFor(a, "advance_application"));
      out.set(keyOf("advance_application", id, ADVANCES_CODE), attrFor(a, "advance_application"));
    }
    {
      for (const r of releaseRows) {
        const a = allocById.get(r.allocationId);
        if (!a) continue;
        // A release reads as an application in reverse: the value goes back from "invoice settled"
        // to "advance held", against the same invoice.
        // A release reads as "Advance Released" (value going back from settled invoice to held
        // advance); its reversal is a re-application, so it reads as one.
        for (const [sourceType, docType] of [
          ["advance_application_release", "advance_release"],
          ["advance_application_release_reversal", "advance_application"],
        ] as const) {
          out.set(keyOf(sourceType, r.id, AR_CODE), attrFor(a, docType));
          out.set(keyOf(sourceType, r.id, ADVANCES_CODE), attrFor(a, docType));
        }
      }
    }
  } else {
    const poIds = idsOf("purchase_order"), dnIds = idsOf("debit_note"), payIds = idsOf("payment");
    const [pos, dns, pays] = await Promise.all([
      poIds.length ? db.select({
        id: purchaseOrdersTable.id, vendorId: purchaseOrdersTable.vendorId, number: purchaseOrdersTable.poNumber,
        title: purchaseOrdersTable.title, currency: purchaseOrdersTable.currency,
        total: purchaseOrdersTable.total, paid: purchaseOrdersTable.paidAmount,
      }).from(purchaseOrdersTable).where(and(eq(purchaseOrdersTable.orgId, orgId), inArray(purchaseOrdersTable.id, poIds))) : [],
      dnIds.length ? db.select({
        id: debitNotesTable.id, vendorId: debitNotesTable.vendorId, number: debitNotesTable.debitNoteNumber,
        reason: debitNotesTable.reason, currency: debitNotesTable.currency,
      }).from(debitNotesTable).where(and(eq(debitNotesTable.orgId, orgId), inArray(debitNotesTable.id, dnIds))) : [],
      payIds.length ? db.select({
        id: paymentsTable.id, reference: paymentsTable.reference, method: paymentsTable.method,
        purchaseOrderId: paymentsTable.purchaseOrderId,
      }).from(paymentsTable).where(and(eq(paymentsTable.orgId, orgId), inArray(paymentsTable.id, payIds))) : [],
    ]);

    const poById = new Map(pos.map((p) => [p.id, p]));
    for (const p of pos) {
      out.set(keyOf("purchase_order", p.id, AP_CODE), {
        partyId: p.vendorId, docType: "purchase_order", number: p.number,
        reference: p.title ?? "", currency: p.currency ?? "",
        paymentStatus: payStatus(n(p.total), n(p.paid), p.currency || base), docId: p.id,
      });
    }
    for (const d of dns) {
      out.set(keyOf("debit_note", d.id, AP_CODE), {
        partyId: d.vendorId, docType: "debit_note", number: d.number,
        reference: d.reason ?? "", currency: d.currency ?? "", paymentStatus: "", docId: d.id,
      });
    }
    for (const p of pays) {
      const po = p.purchaseOrderId ? poById.get(p.purchaseOrderId) : undefined;
      if (!po) continue;
      out.set(keyOf("payment", p.id, AP_CODE), {
        partyId: po.vendorId, docType: "payment_out", number: p.reference?.trim() || "",
        reference: `Against ${po.number}`, currency: po.currency ?? "", paymentStatus: "", docId: p.id,
      });
    }
  }
  return out;
}

/** Stable key for the attribution map — source type + source id + the control account hit. */
const keyOf = (type: string, id: number, account: string) => `${type}:${id}:${account}`;

async function loadParty(orgId: number, kind: PartyKind, partyId: number): Promise<StatementParty | null> {
  if (kind === "client") {
    const [c] = await db.select({
      name: customersTable.name, email: customersTable.email, phone: customersTable.phone,
      address: customersTable.address, taxId: customersTable.taxId, vatNumber: customersTable.vatNumber,
    }).from(customersTable).where(and(eq(customersTable.orgId, orgId), eq(customersTable.id, partyId)));
    return c ?? null;
  }
  const [v] = await db.select({
    name: vendorsTable.name, email: vendorsTable.email, phone: vendorsTable.phone,
    address: vendorsTable.address, taxId: vendorsTable.taxId, vatNumber: vendorsTable.vatNumber,
  }).from(vendorsTable).where(and(eq(vendorsTable.orgId, orgId), eq(vendorsTable.id, partyId)));
  return v ?? null;
}

/**
 * Build one party's statement.
 *
 * Opening balance = every attributed posting dated before `from`. Running balance continues from
 * there in transaction-date order, and the closing balance is the final running value — so the three
 * figures are always consistent with each other and with the ledger.
 *
 * Returns null when the party does not belong to `orgId`, which is what stops a URL from another
 * organization resolving to anything.
 */
export async function getStatement(
  orgId: number,
  kind: PartyKind,
  partyId: number,
  filters: StatementFilters,
): Promise<Statement | null> {
  const party = await loadParty(orgId, kind, partyId);
  if (!party) return null;

  // A client statement reads BOTH control accounts the customer's position lives on: 1100 (what
  // they owe us) and 2300 (what we hold for them). Merged in one ledger order so one balance
  // column carries the whole relationship.
  const raw = kind === "client"
    ? [
        ...(await controlAccountLines(orgId, AR_CODE, filters.to)),
        ...(await controlAccountLines(orgId, ADVANCES_CODE, filters.to)),
      ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.entryId - b.entryId))
    : await controlAccountLines(orgId, AP_CODE, filters.to);
  const attr = await attribute(orgId, kind, raw);

  // Sign convention: a vendor statement grows with what we owe them (credit-normal AP). A client
  // statement is the customer's NET POSITION, and the same `debit − credit` rule carries BOTH
  // accounts coherently: an invoice (Dr 1100) raises it, a payment (Cr 1100) lowers it, an advance
  // receipt (Cr 2300) lowers it below zero — we hold their money, honestly shown as credit, never
  // as a negative invoice receivable (the typed line + advancesHeld make the distinction visible) —
  // a refund (Dr 2300) releases that, and an application (Dr 2300 / Cr 1100) nets to ~zero: it
  // moves value from "advance held" to "invoice settled" without changing what the relationship is
  // worth. One meaning throughout: positive = they owe us, negative = we owe them.
  const signed = (debit: number, credit: number) => (kind === "client" ? debit - credit : credit - debit);

  const mine = raw
    .map((r) => ({ r, a: r.sourceId != null ? attr.get(keyOf(r.sourceType, r.sourceId, r.account)) : undefined }))
    .filter((x): x is { r: RawLine; a: Attribution } => !!x.a && x.a.partyId === partyId);

  // Advance still held at `to` — the party's 2300 balance. Point-in-time, never affected by the
  // display filters below.
  let advancesHeld = 0;
  for (const { r } of mine.filter((x) => x.r.account === ADVANCES_CODE)) advancesHeld += r.credit - r.debit;

  const currencies = [...new Set(mine.map((x) => x.a.currency).filter(Boolean))].sort();

  // --- opening: everything before the period, unfiltered (a filter must not change history) ---
  let opening = 0;
  for (const { r } of mine.filter((x) => x.r.date < filters.from)) opening += signed(r.debit, r.credit);

  // --- period rows, then the display filters ---
  const wantTypes = filters.docTypes?.length ? new Set(filters.docTypes) : null;
  const wantCur = (filters.currency ?? "").trim().toUpperCase();
  const q = (filters.search ?? "").trim().toLowerCase();
  const wantPay = filters.paymentStatus && filters.paymentStatus !== "all" ? filters.paymentStatus : null;

  const period = mine.filter((x) => x.r.date >= filters.from && x.r.date <= filters.to);

  const lines: StatementLine[] = [];
  let running = opening, totalDebit = 0, totalCredit = 0;
  for (const { r, a } of period) {
    if (wantTypes && !wantTypes.has(a.docType)) continue;
    if (wantCur && (a.currency || "").toUpperCase() !== wantCur) continue;
    if (wantPay && a.paymentStatus !== wantPay) continue;
    if (q && !`${a.number} ${a.reference} ${r.memo ?? ""}`.toLowerCase().includes(q)) continue;

    running += signed(r.debit, r.credit);
    totalDebit += r.debit;
    totalCredit += r.credit;
    lines.push({
      date: r.date,
      docType: a.docType,
      docTypeLabel: DOC_TYPE_LABEL[a.docType],
      number: a.number,
      description: r.memo ?? DOC_TYPE_LABEL[a.docType],
      reference: a.reference,
      currency: a.currency,
      paymentStatus: a.paymentStatus,
      debit: r.debit,
      credit: r.credit,
      running,
      href: a.docId != null ? DOC_PATH[a.docType](a.docId) : null,
    });
  }

  return {
    kind, party, from: filters.from, to: filters.to,
    opening, closing: running, totalDebit, totalCredit, lines, currencies,
    advancesHeld: kind === "client" ? advancesHeld : 0,
  };
}

export type PartyOption = { id: number; name: string };

/** Selectable parties for the statement page, tenant-scoped. */
export async function listStatementParties(orgId: number, kind: PartyKind): Promise<PartyOption[]> {
  if (kind === "client") {
    return db.select({ id: customersTable.id, name: customersTable.name })
      .from(customersTable).where(eq(customersTable.orgId, orgId)).orderBy(asc(customersTable.name));
  }
  return db.select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorsTable).where(eq(vendorsTable.orgId, orgId)).orderBy(asc(vendorsTable.name));
}

// --- date presets -----------------------------------------------------------------------------

export type PresetKey = "this_month" | "last_month" | "this_quarter" | "this_year" | "custom";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Resolve a preset to a concrete range. `custom` keeps whatever the caller already has. */
export function presetRange(preset: PresetKey, ref = new Date()): { from: string; to: string } | null {
  const y = ref.getUTCFullYear(), m = ref.getUTCMonth();
  switch (preset) {
    case "this_month": return { from: ymd(new Date(Date.UTC(y, m, 1))), to: ymd(new Date(Date.UTC(y, m + 1, 0))) };
    case "last_month": return { from: ymd(new Date(Date.UTC(y, m - 1, 1))), to: ymd(new Date(Date.UTC(y, m, 0))) };
    case "this_quarter": {
      const q = Math.floor(m / 3);
      return { from: ymd(new Date(Date.UTC(y, q * 3, 1))), to: ymd(new Date(Date.UTC(y, q * 3 + 3, 0))) };
    }
    case "this_year": return { from: ymd(new Date(Date.UTC(y, 0, 1))), to: ymd(new Date(Date.UTC(y, 12, 0))) };
    default: return null;
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Sanitize the filters coming from a URL — never trust the query string. */
export function readFilters(sp: URLSearchParams, kind: PartyKind): StatementFilters {
  const preset = (sp.get("preset") ?? "this_year") as PresetKey;
  const fromRaw = sp.get("from"), toRaw = sp.get("to");
  const fallback = presetRange(preset) ?? presetRange("this_year")!;
  const from = fromRaw && ISO.test(fromRaw) ? fromRaw : fallback.from;
  const to = toRaw && ISO.test(toRaw) ? toRaw : fallback.to;

  const allowed = new Set<string>(kind === "client" ? CLIENT_DOC_TYPES : VENDOR_DOC_TYPES);
  const docTypes = (sp.get("types") ?? "").split(",").map((s) => s.trim()).filter((s) => allowed.has(s)) as StatementDocType[];

  const ps = sp.get("pay");
  const paymentStatus = ps === "paid" || ps === "unpaid" || ps === "partial" ? ps : "all";

  return {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    docTypes,
    paymentStatus,
    currency: (sp.get("currency") ?? "").trim().toUpperCase().slice(0, 3),
    search: (sp.get("q") ?? "").trim().slice(0, 100),
  };
}

/** `Client-Statement-ABC-Trading-2026-01-01-to-2026-01-31` (extension added by the caller). */
export function statementFilename(kind: PartyKind, partyName: string, from: string, to: string): string {
  const slug = partyName.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "Party";
  return `${kind === "client" ? "Client" : "Vendor"}-Statement-${slug}-${from}-to-${to}`;
}
