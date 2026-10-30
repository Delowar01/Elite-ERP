import "server-only";
import { sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { roundMoney } from "@/lib/currency/currencies";
import { InventoryRefusal, returnFromCustomer, returnableUnits, reverseCustomerReturns } from "@/lib/inventory-costing";

/**
 * ACC-01 — a credit note's goods returned to stock, run inside the caller's transaction.
 *
 * A credit note is financial by default: issuing it reverses revenue, VAT and AR (issueCreditNoteAction,
 * unchanged) and moves no stock — a price adjustment, an allowance, goods the customer kept or scrapped.
 * Goods that physically came back are recorded explicitly, against an ISSUED note, line by line and in
 * as many parts as they arrive: each unit back into stock at the cost the invoice issued it at, and
 * that cost back out of cost of goods sold (Dr 1200 / Cr 5000, `(sales_return, <credit note id>)` —
 * see returnFromCustomer). Reversing the note takes them out again (reverseCustomerReturns).
 *
 * Two caps, both read under row locks and both held against the complete request: a line returns at
 * most the whole units it credits, and a sale gives back at most what it issued, across every credit
 * note against it. A request names each line once.
 *
 * One submission is recorded once. The return dialog sends a key it makes each time it opens; the rows
 * a return writes carry it. A second request under the same key — a double click, a retry — finds them
 * under the note's row lock and is answered from them, writing nothing; a later delivery comes from a
 * new opening of the dialog, with a new key, and is recorded.
 */

export type GoodsReturnRequest = { lineId: number; quantity: number | string };

const refuse = (en: string, ar: string) => new InventoryRefusal(en, ar);

/** A submission key: what the return dialog makes each time it opens (32 hex digits; a UUID passes too). */
const SUBMISSION_KEY = /^[A-Za-z0-9-]{16,64}$/;

type NoteLine = {
  id: number; product_id: number | null; quantity: string; description: string | null;
  item_type: "stock" | "service" | null; product_name: string | null; product_sku: string | null;
};

async function noteLines(tx: Tx, creditNoteId: number): Promise<NoteLine[]> {
  const res = await tx.execute(sql`
    select i.id, i.product_id, i.quantity::text as quantity, i.description, p.item_type, p.name as product_name, p.sku as product_sku
      from credit_note_items i left join products p on p.id = i.product_id
     where i.credit_note_id = ${creditNoteId}
     order by i.id`);
  return res.rows as unknown as NoteLine[];
}

/** A line's label for a message: its description without markup, or its line number. */
const labelOf = (l: NoteLine, i: number) => (l.description ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || `#${i + 1}`;

/**
 * The request as one quantity per line: whole units of zero or more, each line named once. A line named
 * twice is refused even when its parts would fit, so no limit is ever checked against a piece of a
 * line's quantity.
 */
function oneQuantityPerLine(request: GoodsReturnRequest[]): Map<number, number> {
  const asked = new Map<number, number>();
  for (const req of request) {
    const q = Number(req.quantity);
    if (!Number.isInteger(q) || q < 0) {
      throw refuse("Enter whole quantities of zero or more to return.", "أدخل كميات صحيحة تساوي صفرًا أو أكثر للإرجاع.");
    }
    const lineId = Number(req.lineId);
    if (asked.has(lineId)) {
      throw refuse(
        "A line appears more than once in this return. Enter each line's quantity once.",
        "تكرر أحد البنود أكثر من مرة في طلب الإرجاع هذا. أدخل كمية كل بند مرة واحدة.",
      );
    }
    asked.set(lineId, q);
  }
  return asked;
}

/** The return already recorded against this note under `requestKey`, if any: its rows, units and cost. */
async function recordedSubmission(tx: Tx, orgId: number, creditNoteId: number, requestKey: string, baseCurrency: string) {
  const res = await tx.execute(sql`
    select id, source_line_id, quantity, total_cost::text as total_cost from inventory_movements
     where org_id = ${orgId} and source_type = 'credit_note' and source_id = ${creditNoteId}
       and kind = 'sales_return' and request_key = ${requestKey}
     order by id`);
  const rows = res.rows as unknown as { id: number; source_line_id: number; quantity: number; total_cost: string | null }[];
  if (rows.length === 0) return null;
  const lines = new Map<number, number>();
  for (const r of rows) lines.set(Number(r.source_line_id), (lines.get(Number(r.source_line_id)) ?? 0) + Number(r.quantity));
  return {
    lines,
    units: rows.reduce((n, r) => n + Number(r.quantity), 0),
    cost: roundMoney(rows.reduce((c, r) => c + Number(r.total_cost ?? 0), 0), baseCurrency),
    movementIds: rows.map((r) => Number(r.id)),
  };
}

/**
 * Return goods to stock against an issued credit note. `request` names the note's lines, each once, and
 * the whole units that came back on each (zero lines are ignored); `requestKey` is the submission. Locks
 * the note, then its invoice — the order issuing a credit note takes — so a return queues behind an
 * issue, a reversal or another return of the same note, and an invoice void (invoice, then products)
 * cannot interleave with it. A submission already recorded is answered as it was (`replayed`), and the
 * same key with different quantities is refused; either way nothing is written.
 */
export async function returnCreditNoteGoods(
  tx: Tx,
  args: { orgId: number; userId: number; baseCurrency: string; date: string; creditNoteId: number; requestKey: string; request: GoodsReturnRequest[] },
) {
  const { orgId } = args;
  if (typeof args.requestKey !== "string" || !SUBMISSION_KEY.test(args.requestKey)) {
    throw refuse(
      "This return has no valid submission key, so it cannot be recorded safely. Reload the page and try again.",
      "لا يحمل طلب الإرجاع هذا مفتاح إرسال صالحًا، فلا يمكن تسجيله بأمان. أعد تحميل الصفحة وحاول مرة أخرى.",
    );
  }
  const asked = oneQuantityPerLine(args.request);
  const noteRes = await tx.execute(sql`
    select id, credit_note_number, source_invoice_id, status from credit_notes
     where id = ${args.creditNoteId} and org_id = ${orgId} and deleted_at is null for update`);
  const note = (noteRes.rows as unknown as { id: number; credit_note_number: string; source_invoice_id: number; status: string }[])[0];
  if (!note) throw refuse("Credit note not found.", "لم يُعثر على إشعار الدائن.");

  // The same submission again: every return against this note queues on its row lock above, so a key
  // already on its rows is a request that was recorded — answer it from them and write nothing.
  const prior = await recordedSubmission(tx, orgId, note.id, args.requestKey, args.baseCurrency);
  if (prior) {
    const askedLines = [...asked].filter(([, q]) => q > 0);
    if (askedLines.length !== prior.lines.size || askedLines.some(([lineId, q]) => prior.lines.get(lineId) !== q)) {
      throw refuse(
        "This submission was already recorded with different quantities, so nothing more was returned. Reload the page to see what came back.",
        "سُجّل هذا الإرسال من قبل بكميات مختلفة، فلم يُرجَع شيء إضافي. أعد تحميل الصفحة لترى ما أُرجع.",
      );
    }
    return { cost: prior.cost, movementIds: prior.movementIds, creditNoteNumber: note.credit_note_number, units: prior.units, replayed: true };
  }

  if (note.status !== "issued") {
    throw refuse("Goods can only be returned to stock against an issued credit note.", "لا يمكن إرجاع البضاعة إلى المخزون إلا مقابل إشعار دائن صادر.");
  }
  const invRes = await tx.execute(sql`
    select id, invoice_number, status from sales_invoices where id = ${note.source_invoice_id} and org_id = ${orgId} for update`);
  const invoice = (invRes.rows as unknown as { id: number; invoice_number: string; status: string }[])[0];
  if (!invoice || invoice.status === "draft" || invoice.status === "void") {
    throw refuse(
      "The invoice this credit note is against has no stock issue standing (it is a draft or void), so there is nothing to return to stock.",
      "الفاتورة التي صدر مقابلها هذا الإشعار ليس لها صرف مخزون قائم (مسودة أو ملغاة)، فلا يوجد ما يُرجَع إلى المخزون.",
    );
  }

  const lines = await noteLines(tx, note.id);
  const wanted: { productId: number; quantity: number; sourceLineId: number }[] = [];
  // The sale's limit, per product, over the whole request: every line of a product draws on the same issue.
  const perProduct = new Map<number, { units: number; left: number; name: string; sku: string }>();
  for (const [lineId, q] of asked) {
    if (q === 0) continue;
    const i = lines.findIndex((l) => l.id === lineId);
    if (i < 0) throw refuse("A line does not belong to this credit note.", "أحد البنود لا ينتمي إلى إشعار الدائن هذا.");
    const line = lines[i];
    if (line.product_id === null || line.item_type !== "stock") {
      throw refuse(`"${labelOf(line, i)}" is not a stock item, so it has no stock to return.`, `"${labelOf(line, i)}" ليس صنفًا مخزنيًا، فلا مخزون له يُرجَع.`);
    }
    // The note's own cap: whole units it credits, less what this line has already returned (the
    // note's row lock makes this read final).
    const { returnedOnLine, invoiceLeft } = await returnableUnits(tx, orgId, {
      invoiceId: invoice.id, productId: line.product_id, creditNoteId: note.id, lineId: line.id, baseCurrency: args.baseCurrency,
    });
    const credited = Math.floor(Number(line.quantity));
    if (returnedOnLine + q > credited) {
      const more = Math.max(0, credited - returnedOnLine);
      throw refuse(
        `"${labelOf(line, i)}": this credit note credits ${credited}, of which ${returnedOnLine} already came back — at most ${more} more can be returned.`,
        `"${labelOf(line, i)}": يقيّد هذا الإشعار ${credited}، أُرجع منها ${returnedOnLine}، فلا يمكن إرجاع أكثر من ${more}.`,
      );
    }
    const product = perProduct.get(line.product_id) ?? { units: 0, left: invoiceLeft, name: line.product_name ?? "", sku: line.product_sku ?? "" };
    product.units += q;
    perProduct.set(line.product_id, product);
    wanted.push({ productId: line.product_id, quantity: q, sourceLineId: line.id });
  }
  if (wanted.length === 0) {
    throw refuse("Enter the quantity that came back on at least one line.", "أدخل الكمية المرتجعة في بند واحد على الأقل.");
  }
  for (const p of perProduct.values()) {
    if (p.units > p.left) {
      throw refuse(
        `This return asks for ${p.units} of "${p.name}" (${p.sku}) across its lines, but only ${p.left} of the units this invoice issued have not already come back.`,
        `يطلب هذا الإرجاع ${p.units} من "${p.name}" (${p.sku}) في مجموع بنوده، ولم يتبقَّ من الوحدات التي صرفتها هذه الفاتورة سوى ${p.left} لم تُرجَع بعد.`,
      );
    }
  }

  const memo = `Credit note ${note.credit_note_number} — goods returned to stock (invoice ${invoice.invoice_number})`;
  const result = await returnFromCustomer(
    tx,
    { orgId, userId: args.userId, baseCurrency: args.baseCurrency, date: args.date },
    { sourceType: "credit_note", sourceId: note.id, journalEntryId: null, memo, requestKey: args.requestKey },
    { invoiceId: invoice.id, lines: wanted },
  );
  return { ...result, creditNoteNumber: note.credit_note_number, units: wanted.reduce((n, w) => n + w.quantity, 0), replayed: false };
}

/**
 * Take a reversed credit note's returned goods back out of stock (see reverseCustomerReturns). The
 * caller is reversing the note and holds its row lock; a note that returned nothing writes nothing.
 */
export async function reverseCreditNoteReturns(
  tx: Tx,
  args: { orgId: number; userId: number; baseCurrency: string; date: string; creditNote: { id: number; creditNoteNumber: string } },
) {
  return reverseCustomerReturns(
    tx,
    { orgId: args.orgId, userId: args.userId, baseCurrency: args.baseCurrency, date: args.date },
    {
      sourceType: "credit_note",
      sourceId: args.creditNote.id,
      journalEntryId: null,
      memo: `Credit note ${args.creditNote.creditNoteNumber} reversed — returned goods taken back out of stock`,
    },
  );
}

export type ReturnableLine = { lineId: number; label: string; credited: number; returned: number; returnable: number };

/**
 * For the return dialog: each stock line of an issued note — the whole units it credits, what it has
 * already returned, and what can still come back (bounded by the invoice's own remaining issue).
 * Read-only; the posting re-checks everything under its locks.
 */
export async function creditNoteReturnables(orgId: number, baseCurrency: string, note: { id: number; sourceInvoiceId: number; status: string }) {
  if (note.status !== "issued") return [] as ReturnableLine[];
  return db.transaction(async (tx) => {
    const inv = await tx.execute(sql`select status from sales_invoices where id = ${note.sourceInvoiceId} and org_id = ${orgId}`);
    const status = (inv.rows as unknown as { status: string }[])[0]?.status;
    if (!status || status === "draft" || status === "void") return [] as ReturnableLine[];
    const out: ReturnableLine[] = [];
    const lines = await noteLines(tx, note.id);
    for (const [i, line] of lines.entries()) {
      if (line.product_id === null || line.item_type !== "stock") continue;
      const { invoiceLeft, returnedOnLine } = await returnableUnits(tx, orgId, {
        invoiceId: note.sourceInvoiceId, productId: line.product_id, creditNoteId: note.id, lineId: line.id, baseCurrency,
      });
      const credited = Math.floor(Number(line.quantity));
      out.push({
        lineId: line.id, label: labelOf(line, i), credited, returned: returnedOnLine,
        returnable: Math.max(0, Math.min(credited - returnedOnLine, invoiceLeft)),
      });
    }
    return out;
  });
}
