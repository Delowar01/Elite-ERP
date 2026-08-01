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
} from "@/db";
import { requireSession } from "@/lib/session";
import { renderPrintPagePdf } from "@/lib/pdf/document-pdf";

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

// GET /print/[type]/[id]/pdf — generate and stream the document PDF as an attachment. Reuses the
// existing print layout via renderPrintPagePdf; enforces auth + tenant isolation (the number lookup
// is org-scoped, and the rendered print page re-checks the session with the forwarded cookie).
export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const session = await requireSession();
  const { type, id: idRaw } = await params;
  const id = Number(idRaw);
  const cfg = DOC_TYPES[type as keyof typeof DOC_TYPES];
  if (!cfg || !Number.isInteger(id)) return new NextResponse("Not found", { status: 404 });

  const [row] = await db
    .select({ number: cfg.number })
    .from(cfg.table)
    .where(and(eq(cfg.table.id, id), eq(cfg.table.orgId, session.orgId)));
  if (!row) return new NextResponse("Not found", { status: 404 });

  const filename = `${safeName(`${cfg.label}-${row.number}`)}.pdf`;
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
    return NextResponse.json({ error: "PDF generation failed." }, { status: 500 });
  }
}
