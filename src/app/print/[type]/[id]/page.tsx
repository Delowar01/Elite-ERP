import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { richTextToPlain } from "@/lib/sanitize-html";
import {
  db,
  orgsTable,
  bankAccountsTable,
  customersTable,
  vendorsTable,
  quotationsTable,
  quotationItemsTable,
  salesOrdersTable,
  salesOrderItemsTable,
  proformaInvoicesTable,
  proformaInvoiceItemsTable,
  salesInvoicesTable,
  salesInvoiceItemsTable,
  deliveryChallansTable,
  deliveryChallanItemsTable,
  creditNotesTable,
  creditNoteItemsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  debitNotesTable,
  debitNoteItemsTable,
  paymentsTable,
} from "@/db";
import { advanceInvoiceLinks } from "@/lib/advance-payment-links";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/server";
import { buildZatcaTlv, invoiceHashOf, zatcaQrDataUrl } from "@/lib/zatca";
import { amountInWords } from "../../../(app)/sales/_shared/totals";
import { getLineDesc } from "../../../(app)/sales/_shared/line-item-desc";
import { buildMoneyMark, markFormat, roundMoney } from "@/lib/currency/currencies";
import { docMoneyMark } from "../../../(app)/sales/_shared/doc-currency";
import {
  A4Page,
  PdfHeader,
  Party,
  Parties,
  orgPartyLines,
  ItemsTableFull,
  ItemsTableSimple,
  ItemsTableQty,
  TotalsBox,
  Amount,
  AmountWords,
  BankBlock,
  DocBankBlocks,
  NotesBlock,
  PdfTermsBlock,
  ApprovalBlock,
  SealSignature,
  QrPanel,
  ClientComments,
  PdfFooter,
  type PartyLine,
} from "../../_shared/pdf-blocks";
import { PrintToolbar } from "../../_shared/print-toolbar";

// The item NAME for print (plain text, single line). The long-form description is rendered
// separately as a full-width row beneath the item (see ItemsTable* / PdfDescRow), so it keeps its
// paragraphs and bullet/numbered lists instead of being flattened onto the name line.
function itemName(it: { description: string | null }): string {
  return richTextToPlain(it.description) || "—";
}


const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[(m ?? 1) - 1]}, ${y}`;
}

function customerLines(c: { address: string | null; vatNumber: string | null }): PartyLine[] {
  const lines: PartyLine[] = [];
  if (c.address) lines.push({ value: c.address });
  if (c.vatNumber) lines.push({ label: "VAT No.", value: c.vatNumber });
  return lines;
}

async function getOrgAndBank(orgId: number) {
  const [org] = await db.select().from(orgsTable).where(eq(orgsTable.id, orgId));
  let bank = null;
  if (org?.defaultBankAccountId) {
    const [b] = await db
      .select({ name: bankAccountsTable.name, bankName: bankAccountsTable.bankName, accountNumberMasked: bankAccountsTable.accountNumberMasked })
      .from(bankAccountsTable)
      .where(and(eq(bankAccountsTable.id, org.defaultBankAccountId), eq(bankAccountsTable.orgId, orgId)));
    bank = b ?? null;
  }
  if (!bank) {
    const [b] = await db
      .select({ name: bankAccountsTable.name, bankName: bankAccountsTable.bankName, accountNumberMasked: bankAccountsTable.accountNumberMasked })
      .from(bankAccountsTable)
      .where(and(eq(bankAccountsTable.orgId, orgId), eq(bankAccountsTable.isActive, true)))
      .limit(1);
    bank = b ?? null;
  }
  return { org, bank };
}

// Each document type mirrors its counterpart in the approved PDF-templates mockup: same
// blocks, same tiering (bank details only where "we" get paid, approval on internal sign-off
// docs, QR only on the tax invoice, no pricing on the delivery challan).
export default async function PrintPage({ params }: { params: Promise<{ type: string; id: string }> }) {
  const session = await requireSession();
  const locale = await getLocale();
  const { type, id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isInteger(id)) notFound();

  const { org, bank } = await getOrgAndBank(session.orgId);
  if (!org) notFound();

  // Org base currency + Number Format: one mark drives the symbol (SAR shows the official asset, a
  // configured custom symbol wins), plus grouping / decimals / rounding for every amount, rate and
  // quantity in the printed document. amountInWords() still uses the currency name.
  // Base mark from the org; each document below overrides currencyCode with its OWN saved currency
  // (Issue #3) so a document billed in another currency prints in that currency. `mark`/`numFmt` are
  // reassigned per document type before its JSX is built; `money` reads the current `mark` at call.
  let mark = buildMoneyMark({
    currencyCode: org.currency,
    customCurrencySymbol: org.customCurrencySymbol,
    digitGrouping: org.numberDigitGrouping,
    decimalPlaces: org.numberDecimalPlaces,
    roundQuantities: org.roundQuantities,
    roundRates: org.roundRates,
  });
  let numFmt = markFormat(mark);
  const money = (v: string | number) => <Amount mark={mark} value={v} />;

  const orgParty = (label: string) => <Party label={label} name={org.name} lines={orgPartyLines(org)} tint />;

  let backHref = "/dashboard";
  let body: React.ReactNode = null;

  if (type === "quotation" || type === "sales-order" || type === "proforma" || type === "invoice") {
    const cfg = {
      quotation: { table: quotationsTable, items: quotationItemsTable, fk: quotationItemsTable.quotationId },
      "sales-order": { table: salesOrdersTable, items: salesOrderItemsTable, fk: salesOrderItemsTable.salesOrderId },
      proforma: { table: proformaInvoicesTable, items: proformaInvoiceItemsTable, fk: proformaInvoiceItemsTable.proformaInvoiceId },
      invoice: { table: salesInvoicesTable, items: salesInvoiceItemsTable, fk: salesInvoiceItemsTable.invoiceId },
    }[type]!;

    const [doc] = await db
      .select()
      .from(cfg.table)
      .where(and(eq(cfg.table.id, id), eq(cfg.table.orgId, session.orgId)));
    if (!doc) notFound();
    mark = docMoneyMark(org, doc.currency);
    numFmt = markFormat(mark);
    const [[customer], items] = await Promise.all([
      db.select().from(customersTable).where(eq(customersTable.id, doc.customerId)),
      db.select().from(cfg.items).where(eq(cfg.fk, id)),
    ]);
    if (!customer) notFound();

    const fullItems = items.map((it) => ({
      name: itemName(it),
      description: getLineDesc(it.customFields),
      vatPercent: it.taxRatePercent,
      quantity: it.quantity,
      rate: it.unitPrice,
    }));

    const baseTotals: [string, React.ReactNode][] = [
      ["Amount", money(doc.subtotal)],
      ["VAT", money(doc.taxTotal)],
      ["Discounts", money(doc.discount)],
    ];

    if (type === "quotation") {
      backHref = `/sales/quotations/${id}`;
      const q = doc as typeof quotationsTable.$inferSelect;
      body = (
        <A4Page org={org} documentType="quotation">
          <PdfHeader docLabel="QUOTATION" numberLabel="Quotation No" numberVal={q.quotationNumber} dateVal={fmtDate(q.issueDate)} extraLabel="Valid Till" extraVal={q.validUntil ? fmtDate(q.validUntil) : null} org={org} />
          <Parties>{orgParty("FROM")}<Party label="TO" name={customer.name} lines={customerLines(customer)} /></Parties>
          <ItemsTableFull items={fullItems} format={numFmt} />
          <div className="pdf-bottom">
            <div>
              <AmountWords words={amountInWords(q.total, "en", mark)} />
              {q.bankAccounts && q.bankAccounts.length ? <DocBankBlocks accounts={q.bankAccounts} /> : <BankBlock account={bank} />}
            </div>
            <TotalsBox rows={baseTotals} grandLabel={`Total (${mark.code})`} grandVal={money(q.total)} />
          </div>
          <PdfTermsBlock terms={q.terms} />
          <NotesBlock notes={richTextToPlain(q.notes) || null} />
          <SealSignature org={org} sealUrl={q.sealUrl} signatureUrl={q.signatureUrl} />
          <PdfFooter org={org} />
        </A4Page>
      );
    } else if (type === "sales-order") {
      backHref = `/sales/orders/${id}`;
      const so = doc as typeof salesOrdersTable.$inferSelect;
      body = (
        <A4Page org={org} documentType="sales_order">
          <PdfHeader docLabel="SALES ORDER" numberLabel="Sales Order No" numberVal={so.soNumber} dateVal={fmtDate(so.issueDate)} org={org} />
          <Parties>{orgParty("FROM")}<Party label="TO" name={customer.name} lines={customerLines(customer)} /></Parties>
          <ItemsTableFull items={fullItems} format={numFmt} />
          <div className="pdf-bottom">
            <div>
              <AmountWords words={amountInWords(so.total, "en", mark)} />
              {so.bankAccounts && so.bankAccounts.length ? <DocBankBlocks accounts={so.bankAccounts} /> : <BankBlock account={bank} />}
            </div>
            <TotalsBox rows={baseTotals} grandLabel={`Total (${mark.code})`} grandVal={money(so.total)} />
          </div>
          <PdfTermsBlock terms={so.terms} />
          <NotesBlock notes={richTextToPlain(so.notes) || null} />
          <ApprovalBlock />
          <SealSignature org={org} sealUrl={so.sealUrl} signatureUrl={so.signatureUrl} />
          <PdfFooter org={org} />
        </A4Page>
      );
    } else if (type === "proforma") {
      backHref = `/sales/proforma/${id}`;
      const pf = doc as typeof proformaInvoicesTable.$inferSelect;
      // Payment summary only (Paid Amount / Balance Due) — no internal accounting fields.
      const pfPaid = Number(pf.paidAmount) > 0;
      const pfDue = roundMoney(Number(pf.total) - Number(pf.paidAmount), mark.code);
      const pfTotalsRows: [string, React.ReactNode][] = pfPaid
        ? [...baseTotals, [`Total (${mark.code})`, money(pf.total)], ["Paid Amount", money(pf.paidAmount)]]
        : baseTotals;
      body = (
        <A4Page org={org} documentType="proforma_invoice">
          <PdfHeader docLabel="PROFORMA INVOICE" numberLabel="P.I. No" numberVal={pf.proformaNumber} dateVal={fmtDate(pf.issueDate)} org={org} />
          <Parties>{orgParty("FROM")}<Party label="TO" name={customer.name} lines={customerLines(customer)} /></Parties>
          <ItemsTableFull items={fullItems} format={numFmt} />
          <div className="pdf-bottom">
            <div>
              <AmountWords words={amountInWords(pf.total, "en", mark)} />
              {pf.bankAccounts && pf.bankAccounts.length ? <DocBankBlocks accounts={pf.bankAccounts} /> : <BankBlock account={bank} />}
            </div>
            <TotalsBox rows={pfTotalsRows} grandLabel={pfPaid ? "Balance Due" : `Total (${mark.code})`} grandVal={money(pfPaid ? pfDue : pf.total)} />
          </div>
          <PdfTermsBlock terms={pf.terms} />
          <NotesBlock notes={"Non-posting — for client reference only. This is not a tax invoice."} />
          <SealSignature org={org} sealUrl={pf.sealUrl} signatureUrl={pf.signatureUrl} />
          <PdfFooter org={org} />
        </A4Page>
      );
    } else {
      backHref = `/sales/invoices/${id}`;
      const inv = doc as typeof salesInvoicesTable.$inferSelect;
      const paid = Number(inv.paidAmount) > 0;
      const totalsRows: [string, React.ReactNode][] = paid
        ? [...baseTotals, [`Total (${mark.code})`, money(inv.total)], ["Amount Paid", money(inv.paidAmount)]]
        : baseTotals;
      const due = roundMoney(Number(inv.total) - Number(inv.paidAmount), mark.code);

      // ZATCA Phase 1 QR on every non-draft tax invoice. Stored payload wins; otherwise it's
      // computed here and persisted so the hash stays stable across reprints.
      let qrDataUrl: string | null = null;
      if (inv.status !== "draft") {
        let tlv = inv.qrCodeData;
        if (!tlv) {
          tlv = buildZatcaTlv({
            sellerName: org.name,
            vatNumber: org.vatNumber ?? "",
            timestamp: `${inv.issueDate}T00:00:00Z`,
            total: roundMoney(inv.total, mark.code),
            vatTotal: roundMoney(inv.taxTotal, mark.code),
          });
          await db
            .update(salesInvoicesTable)
            .set({ qrCodeData: tlv, invoiceHash: invoiceHashOf(tlv) })
            .where(and(eq(salesInvoicesTable.id, inv.id), eq(salesInvoicesTable.orgId, session.orgId)));
        }
        qrDataUrl = await zatcaQrDataUrl(tlv);
      }

      body = (
        <A4Page org={org} documentType="sales_invoice">
          <PdfHeader docLabel="INVOICE" numberLabel="Invoice No" numberVal={inv.invoiceNumber} dateVal={fmtDate(inv.issueDate)} extraLabel="Due Date" extraVal={inv.dueDate ? fmtDate(inv.dueDate) : null} org={org} />
          <Parties>{orgParty("FROM")}<Party label="TO" name={customer.name} lines={customerLines(customer)} /></Parties>
          <ItemsTableFull items={fullItems} format={numFmt} />
          <div className="pdf-bottom">
            <div>
              <AmountWords words={amountInWords(inv.total, "en", mark)} />
              {inv.bankAccounts && inv.bankAccounts.length ? <DocBankBlocks accounts={inv.bankAccounts} /> : <BankBlock account={bank} />}
            </div>
            <TotalsBox rows={totalsRows} grandLabel={paid ? "Due Amount" : `Total (${mark.code})`} grandVal={money(paid ? due : inv.total)} />
          </div>
          <PdfTermsBlock terms={inv.terms} />
          <NotesBlock notes={richTextToPlain(inv.notes) || null} />
          {qrDataUrl && <QrPanel dataUrl={qrDataUrl} />}
          <SealSignature org={org} sealUrl={inv.sealUrl} signatureUrl={inv.signatureUrl} />
          <PdfFooter org={org} />
        </A4Page>
      );
    }
  } else if (type === "purchase-order") {
    backHref = `/purchasing/orders/${id}`;
    const [po] = await db
      .select()
      .from(purchaseOrdersTable)
      .where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.orgId, session.orgId)));
    if (!po) notFound();
    mark = docMoneyMark(org, po.currency);
    numFmt = markFormat(mark);
    const [[vendor], items] = await Promise.all([
      db.select().from(vendorsTable).where(eq(vendorsTable.id, po.vendorId)),
      db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.purchaseOrderId, id)),
    ]);
    if (!vendor) notFound();
    body = (
      <A4Page org={org} documentType="purchase_order">
        <PdfHeader docLabel="PURCHASE ORDER" numberLabel="P.O. No" numberVal={po.poNumber} dateVal={fmtDate(po.orderDate)} extraLabel="Expected" extraVal={po.expectedDate ? fmtDate(po.expectedDate) : null} org={org} />
        <Parties>
          {orgParty("DELIVERY TO")}
          <Party label="SUPPLY FROM" name={vendor.name} lines={customerLines(vendor)} />
        </Parties>
        <ItemsTableFull items={items.map((it) => ({ name: itemName(it), description: getLineDesc(it.customFields), vatPercent: it.taxRatePercent, quantity: it.quantity, rate: it.unitCost }))} format={numFmt} />
        <div className="pdf-bottom">
          <div>
            <AmountWords words={amountInWords(po.total, "en", mark)} />
            <DocBankBlocks accounts={po.bankAccounts} />
          </div>
          <TotalsBox rows={[["Amount", money(po.subtotal)], ["VAT", money(po.taxTotal)], ["Discounts", money(po.discount)]]} grandLabel="Total Payable" grandVal={money(po.total)} />
        </div>
        <PdfTermsBlock terms={po.terms} />
        <NotesBlock notes={richTextToPlain(po.notes) || null} />
        <ApprovalBlock />
        <SealSignature org={org} sealUrl={po.sealUrl} signatureUrl={po.signatureUrl} />
        <PdfFooter org={org} />
      </A4Page>
    );
  } else if (type === "delivery-challan") {
    backHref = `/sales/delivery-challans/${id}`;
    const [dc] = await db
      .select()
      .from(deliveryChallansTable)
      .where(and(eq(deliveryChallansTable.id, id), eq(deliveryChallansTable.orgId, session.orgId)));
    if (!dc) notFound();
    const [[customer], items] = await Promise.all([
      db.select().from(customersTable).where(eq(customersTable.id, dc.customerId)),
      db.select().from(deliveryChallanItemsTable).where(eq(deliveryChallanItemsTable.deliveryChallanId, id)),
    ]);
    if (!customer) notFound();
    const logistics = [dc.carrier ? `Carrier: ${dc.carrier}` : null, dc.vehicleNo ? `Vehicle No: ${dc.vehicleNo}` : null].filter(Boolean).join(" · ");
    body = (
      <A4Page org={org} documentType="delivery_challan">
        <PdfHeader docLabel="DELIVERY CHALLAN" numberLabel="Challan No" numberVal={dc.dcNumber} dateVal={fmtDate(dc.dispatchDate)} org={org} />
        <Parties>
          {orgParty("ISSUED BY")}
          <Party label="DELIVERED TO" name={customer.name} lines={customerLines(customer)} />
        </Parties>
        <ItemsTableQty items={items.map((it) => ({ name: itemName(it), description: getLineDesc(it.customFields), quantity: it.quantity }))} format={numFmt} />
        <PdfTermsBlock terms={dc.terms} />
        <NotesBlock notes={logistics || null} />
        {/* No bank block: a challan quotes no prices and requests no payment, so printing
            payment instructions on it would invite someone to pay against a delivery note. */}
        <ClientComments />
        <ApprovalBlock />
        <SealSignature org={org} showSignature={false} sealUrl={dc.sealUrl} signatureUrl={dc.signatureUrl} />
        <PdfFooter org={org} />
      </A4Page>
    );
  } else if (type === "credit-note" || type === "debit-note") {
    const isCn = type === "credit-note";
    backHref = isCn ? `/sales/credit-notes/${id}` : `/purchasing/debit-notes/${id}`;

    if (isCn) {
      const [cn] = await db
        .select()
        .from(creditNotesTable)
        .where(and(eq(creditNotesTable.id, id), eq(creditNotesTable.orgId, session.orgId)));
      if (!cn) notFound();
      const [[customer], items, [sourceInvoice]] = await Promise.all([
        db.select().from(customersTable).where(eq(customersTable.id, cn.customerId)),
        db.select().from(creditNoteItemsTable).where(eq(creditNoteItemsTable.creditNoteId, id)),
        db.select({ invoiceNumber: salesInvoicesTable.invoiceNumber }).from(salesInvoicesTable).where(eq(salesInvoicesTable.id, cn.sourceInvoiceId)),
      ]);
      if (!customer) notFound();
      body = (
        <A4Page org={org} documentType="credit_note">
          <PdfHeader docLabel="CREDIT NOTE" numberLabel="Credit Note No" numberVal={cn.creditNoteNumber} dateVal={fmtDate(cn.issueDate)} org={org} />
          <Parties>{orgParty("FROM")}<Party label="TO" name={customer.name} lines={customerLines(customer)} /></Parties>
          <div className="notes-block" style={{ marginTop: 0, marginBottom: 16 }}>
            <b>Against:</b> Invoice {sourceInvoice?.invoiceNumber ?? "—"}
            {cn.reason ? (
              <>
                {" "}&nbsp; <b>Reason:</b> {cn.reason}
              </>
            ) : null}
          </div>
          <ItemsTableSimple items={items.map((it) => ({ name: itemName(it), description: getLineDesc(it.customFields), quantity: it.quantity, rate: it.unitPrice }))} format={numFmt} />
          <div className="pdf-bottom">
            <AmountWords words={amountInWords(cn.total, "en", mark)} />
            <TotalsBox rows={[["VAT", money(cn.taxTotal)]]} grandLabel="Credit Total" grandVal={money(cn.total)} />
          </div>
          <DocBankBlocks accounts={cn.bankAccounts} />
          <PdfTermsBlock terms={cn.terms} />
          <SealSignature org={org} showSignature={false} sealUrl={cn.sealUrl} signatureUrl={cn.signatureUrl} />
          <PdfFooter org={org} />
        </A4Page>
      );
    } else {
      const [dn] = await db
        .select()
        .from(debitNotesTable)
        .where(and(eq(debitNotesTable.id, id), eq(debitNotesTable.orgId, session.orgId)));
      if (!dn) notFound();
      const [[vendor], items, [sourcePo]] = await Promise.all([
        db.select().from(vendorsTable).where(eq(vendorsTable.id, dn.vendorId)),
        db.select().from(debitNoteItemsTable).where(eq(debitNoteItemsTable.debitNoteId, id)),
        db.select({ poNumber: purchaseOrdersTable.poNumber }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, dn.sourcePurchaseOrderId)),
      ]);
      if (!vendor) notFound();
      body = (
        <A4Page org={org} documentType="debit_note">
          <PdfHeader docLabel="DEBIT NOTE" numberLabel="Debit Note No" numberVal={dn.debitNoteNumber} dateVal={fmtDate(dn.issueDate)} org={org} />
          <Parties>{orgParty("FROM")}<Party label="SUPPLY FROM" name={vendor.name} lines={customerLines(vendor)} /></Parties>
          <div className="notes-block" style={{ marginTop: 0, marginBottom: 16 }}>
            <b>Against:</b> Purchase Order {sourcePo?.poNumber ?? "—"}
            {dn.reason ? (
              <>
                {" "}&nbsp; <b>Reason:</b> {dn.reason}
              </>
            ) : null}
          </div>
          <ItemsTableSimple items={items.map((it) => ({ name: itemName(it), description: getLineDesc(it.customFields), quantity: it.quantity, rate: it.unitCost }))} format={numFmt} />
          <div className="pdf-bottom">
            <AmountWords words={amountInWords(dn.total, "en", mark)} />
            <TotalsBox rows={[["VAT", money(dn.taxTotal)]]} grandLabel="Debit Total" grandVal={money(dn.total)} />
          </div>
          <DocBankBlocks accounts={dn.bankAccounts} />
          <PdfTermsBlock terms={dn.terms} />
          <SealSignature org={org} showSignature={false} sealUrl={dn.sealUrl} signatureUrl={dn.signatureUrl} />
          <PdfFooter org={org} />
        </A4Page>
      );
    }
  } else if (type === "payment") {
    backHref = "/finance/payments";
    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(and(eq(paymentsTable.id, id), eq(paymentsTable.orgId, session.orgId)));
    if (!payment) notFound();

    const [bankAccount] = await db
      .select({ name: bankAccountsTable.name, bankName: bankAccountsTable.bankName })
      .from(bankAccountsTable)
      .where(eq(bankAccountsTable.id, payment.bankAccountId));

    let partyName = "—";
    let partyLines: PartyLine[] = [];
    let refText = "";
    // An advance receipt names its invoice through its ALLOCATIONS — it may have settled several,
    // and a partial draw never set `salesInvoiceId` at all. Ordinary payments keep the field.
    const advanceLink = payment.kind === "advance_receipt"
      ? (await advanceInvoiceLinks(session.orgId, [payment.id])).get(payment.id)
      : undefined;
    const receiptInvoiceId = advanceLink?.invoiceId ?? payment.salesInvoiceId;
    if (payment.direction === "in" && receiptInvoiceId) {
      const [inv] = await db
        .select({ invoiceNumber: salesInvoicesTable.invoiceNumber, customerId: salesInvoicesTable.customerId })
        .from(salesInvoicesTable)
        .where(eq(salesInvoicesTable.id, receiptInvoiceId));
      if (inv) {
        const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, inv.customerId));
        if (customer) {
          partyName = customer.name;
          partyLines = customerLines(customer);
        }
        refText = advanceLink && advanceLink.invoiceCount > 1
          ? `Advance received, applied to Invoice ${inv.invoiceNumber} and ${advanceLink.invoiceCount - 1} more`
          : `Payment received against Invoice ${inv.invoiceNumber}`;
      }
    } else if (payment.direction === "out" && payment.purchaseOrderId) {
      const [po] = await db
        .select({ poNumber: purchaseOrdersTable.poNumber, vendorId: purchaseOrdersTable.vendorId })
        .from(purchaseOrdersTable)
        .where(eq(purchaseOrdersTable.id, payment.purchaseOrderId));
      if (po) {
        const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, po.vendorId));
        if (vendor) {
          partyName = vendor.name;
          partyLines = customerLines(vendor);
        }
        refText = `Payment made against Purchase Order ${po.poNumber}`;
      }
    }
    const method = payment.method ? payment.method.replace("_", " ") : null;
    const desc = `${refText}${method ? `, via ${method}` : ""}${bankAccount ? ` (${bankAccount.name})` : ""}`;

    body = (
      <A4Page>
        <PdfHeader
          docLabel="PAYMENT RECEIPT"
          numberLabel="Receipt No"
          numberVal={`RCT-${String(payment.id).padStart(4, "0")}`}
          dateVal={fmtDate(payment.paymentDate)}
          org={org}
        />
        <Parties>
          {orgParty(payment.direction === "in" ? "RECEIVED BY" : "PAID BY")}
          <Party label={payment.direction === "in" ? "PAID BY" : "PAID TO"} name={partyName} lines={partyLines} />
        </Parties>
        <div className="pdf-items-wrap">
          <table className="pdf-items">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="item-name">{desc}</td>
                <td className="num" style={{ fontWeight: 800, fontSize: 15, whiteSpace: "nowrap" }}>
                  {money(payment.amount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="pdf-bottom single">
          <AmountWords words={amountInWords(payment.amount, "en", mark)} />
        </div>
        <SealSignature org={org} showSignature={false} />
        <PdfFooter org={org} extraNote="This is a system-generated receipt — no signature required." />
      </A4Page>
    );
  } else {
    notFound();
  }

  return (
    <>
      <PrintToolbar locale={locale} backHref={backHref} />
      {body}
    </>
  );
}
