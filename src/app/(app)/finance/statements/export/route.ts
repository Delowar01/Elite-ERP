import { eq } from "drizzle-orm";
import { db, orgsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { exportResponse, type ExportColumn, type ExportMeta } from "@/lib/report-export";
import { getStatement, readFilters, statementFilename, DOC_TYPE_LABEL, type PartyKind } from "@/lib/statements";

// GET /finance/statements/export?kind=client|vendor&party=<id>&from=&to=&types=&pay=&currency=&q=&format=pdf|xlsx|csv
//
// Recomputes the statement server-side with the SAME filters the screen is showing, then renders it
// through the shared export helpers. The org comes from the session, never the query string, so a
// party id from another organization simply resolves to nothing (404) — export cannot be used to
// read across tenants. Read-only: nothing is written and no accounting is affected.

const money = (n: number) => n.toFixed(2);

export async function GET(req: Request) {
  const session = await requireSession();
  const url = new URL(req.url);

  const kind: PartyKind = url.searchParams.get("kind") === "vendor" ? "vendor" : "client";
  const partyId = Number(url.searchParams.get("party"));
  if (!Number.isInteger(partyId) || partyId <= 0) return new Response("Select a client or vendor", { status: 400 });

  const filters = readFilters(url.searchParams, kind);
  const statement = await getStatement(session.orgId, kind, partyId, filters);
  if (!statement) return new Response("Not found", { status: 404 });

  const [org] = await db
    .select({
      name: orgsTable.name, address: orgsTable.address, phone: orgsTable.phone,
      email: orgsTable.email, vatNumber: orgsTable.vatNumber,
    })
    .from(orgsTable)
    .where(eq(orgsTable.id, session.orgId));

  const columns: ExportColumn[] = [
    { key: "date", header: "Date" },
    { key: "type", header: "Document Type" },
    { key: "number", header: "Document Number" },
    { key: "description", header: "Description / Reference" },
    { key: "debit", header: "Debit" },
    { key: "credit", header: "Credit" },
    { key: "balance", header: "Running Balance" },
  ];

  const rows: Record<string, string>[] = [
    { date: "", type: "", number: "", description: "Opening balance", debit: "", credit: "", balance: money(statement.opening) },
    ...statement.lines.map((l) => ({
      date: l.date,
      type: DOC_TYPE_LABEL[l.docType],
      number: l.number,
      description: l.reference || l.description,
      debit: l.debit ? money(l.debit) : "",
      credit: l.credit ? money(l.credit) : "",
      balance: money(l.running),
    })),
    { date: "", type: "", number: "", description: "Closing balance", debit: money(statement.totalDebit), credit: money(statement.totalCredit), balance: money(statement.closing) },
  ];

  // Header block carried into all three formats: organization, party, period and balances.
  const p = statement.party;
  const meta: ExportMeta = [
    { label: "Organization", value: org?.name ?? "" },
    ...(org?.address ? [{ label: "Address", value: org.address }] : []),
    ...(org?.phone ? [{ label: "Phone", value: org.phone }] : []),
    ...(org?.email ? [{ label: "Email", value: org.email }] : []),
    ...(org?.vatNumber ? [{ label: "VAT Number", value: org.vatNumber }] : []),
    { label: kind === "client" ? "Client" : "Vendor", value: p.name },
    ...(p.address ? [{ label: `${kind === "client" ? "Client" : "Vendor"} Address`, value: p.address }] : []),
    ...(p.email ? [{ label: `${kind === "client" ? "Client" : "Vendor"} Email`, value: p.email }] : []),
    ...(p.phone ? [{ label: `${kind === "client" ? "Client" : "Vendor"} Phone`, value: p.phone }] : []),
    ...(p.vatNumber ? [{ label: `${kind === "client" ? "Client" : "Vendor"} VAT Number`, value: p.vatNumber }] : []),
    { label: "Period", value: `${statement.from} to ${statement.to}` },
    { label: "Opening Balance", value: money(statement.opening) },
    { label: "Closing Balance", value: money(statement.closing) },
  ];

  const title = `${kind === "client" ? "Client" : "Vendor"} Statement — ${p.name}`;
  const base = statementFilename(kind, p.name, statement.from, statement.to);
  return exportResponse(url.searchParams.get("format") ?? "csv", title, base, columns, rows, meta);
}
