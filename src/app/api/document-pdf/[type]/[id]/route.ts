import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  db,
  quotationsTable,
  salesOrdersTable,
  proformaInvoicesTable,
  salesInvoicesTable,
  deliveryChallansTable,
  creditNotesTable,
  purchaseOrdersTable,
  debitNotesTable,
  paymentsTable,
} from "@/db";
import { requireSession } from "@/lib/session";
import { renderPrintPagePdf } from "@/lib/pdf/document-pdf";

// Headless Chromium + render can exceed the platform's default (10s on Vercel Hobby) on a cold
// start; raise the ceiling where the platform allows it.
export const maxDuration = 60;

// Each document type → its table, number column, and a filename label (e.g. Invoice-INV-000123.pdf).
const DOC_TYPES = {
  quotation: { table: quotationsTable, number: quotationsTable.quotationNumber, label: "Quotation" },
  "sales-order": { table: salesOrdersTable, number: salesOrdersTable.soNumber, label: "Sales-Order" },
  proforma: { table: proformaInvoicesTable, number: proformaInvoicesTable.proformaNumber, label: "Proforma-Invoice" },
  invoice: { table: salesInvoicesTable, number: salesInvoicesTable.invoiceNumber, label: "Invoice" },
  "delivery-challan": { table: deliveryChallansTable, number: deliveryChallansTable.dcNumber, label: "Delivery-Challan" },
  "credit-note": { table: creditNotesTable, number: creditNotesTable.creditNoteNumber, label: "Credit-Note" },
  "purchase-order": { table: purchaseOrdersTable, number: purchaseOrdersTable.poNumber, label: "Purchase-Order" },
  "debit-note": { table: debitNotesTable, number: debitNotesTable.debitNoteNumber, label: "Debit-Note" },
} as const;

function safeName(s: string): string {
  return s.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// Resolve the org-scoped document and its download filename. Returns null when the type is unknown
// or the document does not belong to this org (tenant isolation). Payments have no number column —
// the receipt number is derived from the id, matching what the print layout shows (RCT-0001).
async function resolveFilename(type: string, id: number, orgId: number): Promise<string | null> {
  if (type === "payment") {
    const [row] = await db
      .select({ id: paymentsTable.id })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.id, id), eq(paymentsTable.orgId, orgId)));
    if (!row) return null;
    return `${safeName(`Payment-Receipt-RCT-${String(id).padStart(4, "0")}`)}.pdf`;
  }
  const cfg = DOC_TYPES[type as keyof typeof DOC_TYPES];
  if (!cfg) return null;
  const [row] = await db
    .select({ number: cfg.number })
    .from(cfg.table)
    .where(and(eq(cfg.table.id, id), eq(cfg.table.orgId, orgId)));
  if (!row) return null;
  return `${safeName(`${cfg.label}-${row.number}`)}.pdf`;
}

// GET /api/document-pdf/[type]/[id] — generate and stream the document PDF as an attachment. Reuses
// the existing print layout via renderPrintPagePdf; enforces auth + tenant isolation (the lookup is
// org-scoped, and the rendered print page re-checks the session with the forwarded cookie).
export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const session = await requireSession();
  const { type, id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid document id." }, { status: 400 });

  const filename = await resolveFilename(type, id, session.orgId);
  if (!filename) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const origin = request.nextUrl.origin;
  const cookie = request.headers.get("cookie") ?? "";

  try {
    const pdf = await renderPrintPagePdf(`${origin}/print/${type}/${id}`, cookie);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("PDF generation failed", err);
    // Surface the real cause in development (or when PDF_DEBUG_ERRORS=1, e.g. to debug on Vercel);
    // production hides internals behind a generic message but still logs the full error above.
    const showDetail = process.env.NODE_ENV !== "production" || process.env.PDF_DEBUG_ERRORS === "1";
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "PDF generation failed.", ...(showDetail ? { detail } : {}) }, { status: 500 });
  }
}
