// Run via `npm run verify:<name>`. The script supplies two flags this file cannot supply for
// itself, both for the same reason: ESM evaluates a module's dependencies before any of its own
// statements run, so nothing written here happens early enough to affect its own imports.
//
//   --conditions=react-server  makes `import "server-only"` resolve to the empty module the
//     package ships for the server condition, so the real production code is imported with
//     nothing intercepted. A createRequire cache stub used to sit here instead and never ran.
//
//   --env-file-if-exists=.env  loads DATABASE_URL before the first import. A
//     `process.env.DATABASE_URL ||= readFileSync(".env")` line used to sit here and never ran
//     either, so the suite only worked when the variable happened to be exported in the shell.

import { Pool } from "pg";
import { DOCUMENT_IMPORT_SPECS, autoMap, type ImportSpec } from "../src/lib/import/spec";
import { DOC_FIELD_CONFIGS, partyKeyOf } from "../src/lib/import/document-fields";
import { parseImportFile, buildTemplateXlsx, buildTemplateCsv, buildErrorCsv } from "../src/lib/import/parse";
import { validateDocumentImport, commitDocumentImport, type MappedRow } from "../src/lib/import/document-import";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const isoDate = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));

const MODULES = ["sales_order", "proforma_invoice", "sales_invoice", "delivery_challan", "purchase_order", "credit_note", "debit_note"] as const;
type M = (typeof MODULES)[number];

/** Header table, number column, items table and FK for each module — used only to read results back. */
const DB: Record<M, { t: string; n: string; items: string; fk: string; party: string }> = {
  sales_order:      { t: "sales_orders",      n: "so_number",          items: "sales_order_items",      fk: "sales_order_id",      party: "customer_id" },
  proforma_invoice: { t: "proforma_invoices", n: "proforma_number",    items: "proforma_invoice_items", fk: "proforma_invoice_id", party: "customer_id" },
  sales_invoice:    { t: "sales_invoices",    n: "invoice_number",     items: "sales_invoice_items",    fk: "invoice_id",          party: "customer_id" },
  delivery_challan: { t: "delivery_challans", n: "dc_number",          items: "delivery_challan_items", fk: "delivery_challan_id", party: "customer_id" },
  purchase_order:   { t: "purchase_orders",   n: "po_number",          items: "purchase_order_items",   fk: "purchase_order_id",   party: "vendor_id" },
  credit_note:      { t: "credit_notes",      n: "credit_note_number", items: "credit_note_items",      fk: "credit_note_id",      party: "customer_id" },
  debit_note:       { t: "debit_notes",       n: "debit_note_number",  items: "debit_note_items",       fk: "debit_note_id",       party: "vendor_id" },
};

const applyMapping = (spec: ImportSpec, rows: string[][], mapping: Record<string, number>): MappedRow[] =>
  rows.map((cells) => {
    const o: MappedRow = {};
    for (const f of spec.fields) { const i = mapping[f.key]; o[f.key] = i >= 0 ? (cells[i] ?? "").trim() : ""; }
    return o;
  });

async function loadCsv(spec: ImportSpec, csv: string) {
  const g = await parseImportFile("x.csv", Buffer.from(csv, "utf8"));
  return { grid: g, mapped: applyMapping(spec, g.rows, autoMap(spec, g.headers)) };
}

// ---------- fixtures ----------
const org = (await pool.query("insert into orgs (name) values ($1) returning id", [`Docs ${uniq()}`])).rows[0].id as number;
const user = (await pool.query(
  "insert into users (org_id, name, email, password_hash, role) values ($1,'Imp','doc_" + uniq() + "@t.dev','x','owner') returning id", [org],
)).rows[0].id as number;
await pool.query("insert into customers (org_id,name) values ($1,'ABC Company'),($1,'XYZ Company')", [org]);
await pool.query("insert into vendors (org_id,name) values ($1,'Northbound Steel Ltd'),($1,'Kestrel Supply LLC')", [org]);
await pool.query("insert into products (org_id,sku,name) values ($1,'SKU-1','Widget')", [org]);
await pool.query("insert into projects (org_id,name) values ($1,'Riyadh Expo')", [org]);
for (const t of ["quotation", "sales_order", "proforma_invoice", "sales_invoice", "delivery_challan", "credit_note", "purchase_order", "debit_note"]) {
  await pool.query(
    "insert into document_sequences (org_id, document_type, prefix, next_number, padding) values ($1,$2,$3,1,4) on conflict do nothing",
    [org, t, t.slice(0, 3).toUpperCase() + "-"],
  ).catch(() => {});
}
// Source documents that Credit Notes / Debit Notes must point at.
const custId = (await pool.query("select id from customers where org_id=$1 order by id limit 1", [org])).rows[0].id;
const vendId = (await pool.query("select id from vendors where org_id=$1 order by id limit 1", [org])).rows[0].id;
const SRC_INV = `SRCINV-${uniq()}`, SRC_PO = `SRCPO-${uniq()}`;
await pool.query(
  "insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, created_by_id) values ($1,$2,$3,'2026-01-01',$4)",
  [org, SRC_INV, custId, user],
);
await pool.query(
  "insert into purchase_orders (org_id, po_number, vendor_id, order_date, created_by_id) values ($1,$2,$3,'2026-01-01',$4)",
  [org, SRC_PO, vendId, user],
);
const srcFor = (m: M) => (m === "credit_note" ? SRC_INV : m === "debit_note" ? SRC_PO : "");

// ---------- per-module suite ----------
for (const m of MODULES) {
  const cfg = DOC_FIELD_CONFIGS[m];
  const spec = DOCUMENT_IMPORT_SPECS[m];
  const P = partyKeyOf(cfg);
  const L = cfg.label;
  const db = DB[m];
  const partyName = cfg.party === "customer" ? "ABC Company" : "Northbound Steel Ltd";
  const otherParty = cfg.party === "customer" ? "XYZ Company" : "Kestrel Supply LLC";
  const dateHeaders = cfg.dates.map((d) => d.header);
  const reqDate = cfg.dates.find((d) => d.required);

  // Build a CSV header + row factory covering the module's real columns.
  const cols = [cfg.numberHeader, cfg.partyHeader,
    ...(cfg.sourceDoc ? [cfg.sourceDoc.header] : []),
    ...dateHeaders, "Terms & Conditions", "Item Name", "Item Description", "Quantity",
    ...(cfg.pricing ? [cfg.priceHeader, "Tax Rate %"] : []), "Unit"];
  const header = cols.join(",");
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  type Row = { num?: string; party?: string; src?: string; dates?: string[]; terms?: string; item?: string; desc?: string; qty?: string; price?: string; tax?: string; unit?: string };
  const row = (r: Row) => [
    r.num ?? "", r.party ?? "",
    ...(cfg.sourceDoc ? [r.src ?? ""] : []),
    ...cfg.dates.map((_, i) => r.dates?.[i] ?? ""),
    r.terms ?? "", r.item ?? "", r.desc ?? "", r.qty ?? "",
    ...(cfg.pricing ? [r.price ?? "", r.tax ?? ""] : []), r.unit ?? "",
  ].map(q).join(",");
  const D = cfg.dates.map((d, i) => (i === 0 ? "2026-08-05" : "2026-09-05"));

  // ---- template ----
  const csvTpl = buildTemplateCsv(spec);
  check(`${L}: csv template has every spec column`, spec.fields.every((f) => csvTpl.includes(f.header)));
  const required = spec.fields.filter((f) => f.required).map((f) => f.header);
  const expectedRequired = [cfg.partyHeader, ...(cfg.sourceDoc ? [cfg.sourceDoc.header] : []), ...(reqDate ? [reqDate.header] : [])];
  check(`${L}: only genuinely required columns are mandatory`,
    JSON.stringify([...required].sort()) === JSON.stringify([...expectedRequired].sort()), required.join(", "));
  const tplGrid = await parseImportFile("t.xlsx", await buildTemplateXlsx(spec));
  check(`${L}: xlsx template round-trips`, tplGrid.headers.length === spec.fields.length && tplGrid.rows.length === 4,
    `${tplGrid.headers.length} cols / ${tplGrid.rows.length} rows`);
  const n1 = `${cfg.examplePrefix}-1001`;
  const tplLines = csvTpl.trim().split("\r\n");
  check(`${L}: template shows one 3-line document + one single-line document`,
    tplLines.filter((l) => l.startsWith(n1)).length === 3 && tplLines.filter((l) => l.startsWith(`${cfg.examplePrefix}-1002`)).length === 1,
    `${tplLines.length - 1} example rows`);
  const tplWb = new (await import("exceljs")).default.Workbook();
  await tplWb.xlsx.load((await buildTemplateXlsx(spec)) as unknown as ArrayBuffer);
  const guideText = JSON.stringify(tplWb.getWorksheet("Field Guide")!.getSheetValues());
  check(`${L}: field guide covers line items, terms and date format`,
    guideText.includes("Use one row per line item") && guideText.includes("|| between each term") && guideText.includes("select the date format"));
  check(`${L}: delivery challan template carries no pricing columns`,
    m !== "delivery_challan" || (!csvTpl.includes("Tax Rate %") && !csvTpl.includes("Rate,") && !csvTpl.includes("Unit Cost")), "");

  // ---- multi-line grouping + single-line document ----
  const A = `${m.slice(0, 2).toUpperCase()}A-${uniq()}`, B = `${m.slice(0, 2).toUpperCase()}B-${uniq()}`;
  const multi = [header,
    row({ num: A, party: partyName, src: srcFor(m), dates: D, terms: "Term one\nTerm two\nTerm three", item: "Exhibition Stand", desc: "6x4 custom stand", qty: "1", price: "15000", tax: "15", unit: "pcs" }),
    row({ num: A, item: "LED Screen", desc: "4x2 metre screen", qty: "2", price: "2500", tax: "15", unit: "pcs" }),
    row({ num: A, item: "Furniture", desc: "Sofa and table set", qty: "3", price: "800", tax: "15", unit: "set" }),
    row({ num: B, party: partyName, src: srcFor(m), dates: D, item: "Branding", qty: "10", price: "120", tax: "15", unit: "m2" }),
    // blank number -> its own auto-numbered document; two blanks never merge
    row({ party: partyName, src: srcFor(m), dates: D, item: "Standalone one", qty: "1", price: "50", tax: "0" }),
    row({ party: partyName, src: srcFor(m), dates: D, item: "Standalone two", qty: "1", price: "60", tax: "0" }),
  ].join("\r\n");
  const mm = await loadCsv(spec, multi);
  check(`${L}: auto-mapping matched every present column`,
    spec.fields.filter((f) => mm.grid.headers.includes(f.header)).every((f) => autoMap(spec, mm.grid.headers)[f.key] >= 0));
  const v = await validateDocumentImport(m, org, mm.mapped);
  check(`${L}: 6 rows -> 4 documents`, v.result.summary.documents === 4, `docs=${v.result.summary.documents}`);
  check(`${L}: line items detected = 6`, v.result.summary.totalLineItems === 6, `n=${v.result.summary.totalLineItems}`);
  check(`${L}: grouped document has 3 line items`, v.result.documents.find((d) => d.number === A)?.lineCount === 3);
  check(`${L}: blank numbers stay separate`, v.result.documents.filter((d) => d.number === "(auto)").length === 2);
  check(`${L}: all documents valid`, v.result.summary.invalidDocuments === 0, JSON.stringify(v.result.documents.map((d) => d.errors)));
  check(`${L}: terms detected on the grouped document`, v.result.documents.find((d) => d.number === A)?.termCount === 3);

  const c = await commitDocumentImport(m, org, user, mm.mapped);
  check(`${L}: imported 4 documents, 6 line items`, c.imported === 4 && c.lineItems === 6 && c.failed === 0,
    `imp=${c.imported} lines=${c.lineItems} failed=${c.failed}`);

  const doc = (await pool.query(`select * from ${db.t} where org_id=$1 and ${db.n}=$2`, [org, A])).rows[0];
  check(`${L}: document row exists and is DRAFT`, doc?.status === "draft", String(doc?.status));
  const items = (await pool.query(`select * from ${db.items} where ${db.fk}=$1 order by id`, [doc.id])).rows;
  check(`${L}: ONE document row holds all 3 line items`, items.length === 3, `items=${items.length}`);
  check(`${L}: item name -> line description`, items.map((i) => i.description).join("|") === "Exhibition Stand|LED Screen|Furniture",
    items.map((i) => i.description).join("|"));
  check(`${L}: long description -> customFields.__desc`, items[0]?.custom_fields?.__desc === "6x4 custom stand", JSON.stringify(items[0]?.custom_fields));
  check(`${L}: terms stored as 3 document terms`, Array.isArray(doc?.terms) && doc.terms.length === 3
    && doc.terms.every((t: { groupId: unknown }) => t.groupId === null), JSON.stringify(doc?.terms));
  if (reqDate) check(`${L}: required date stored`, isoDate(doc[reqDate.key === "orderDate" ? "order_date" : reqDate.key === "dispatchDate" ? "dispatch_date" : "issue_date"]) === "2026-08-05", "");
  if (cfg.pricing) {
    // 15000 + 2*2500 + 3*800 = 22400 subtotal; 15% VAT = 3360 -> total 25760
    check(`${L}: totals computed from all 3 lines`, Number(doc.total) === 25760 && Number(doc.tax_total) === 3360,
      `total=${doc.total} tax=${doc.tax_total}`);
    const priceCol = m === "purchase_order" || m === "debit_note" ? "unit_cost" : "unit_price";
    check(`${L}: per-unit money written to ${priceCol}`, Number(items[0][priceCol]) === 15000, String(items[0][priceCol]));
  } else {
    check(`${L}: quantity-only items carry no price column`, !("unit_price" in items[0]) && !("unit_cost" in items[0]),
      Object.keys(items[0]).join(","));
    check(`${L}: quantity stored`, Number(items[0].quantity) === 1);
  }
  if (m === "credit_note") check(`${L}: linked to the source invoice`, doc.source_invoice_id != null);
  if (m === "debit_note") check(`${L}: linked to the source purchase order`, doc.source_purchase_order_id != null);
  if (m === "purchase_order" || m === "debit_note") {
    const vend = (await pool.query("select id from vendors where org_id=$1 and name='Northbound Steel Ltd'", [org])).rows[0].id;
    check(`${L}: uses vendor data, not client data`, doc.vendor_id === vend, `${doc.vendor_id}`);
  }

  // ---- required-field validation ----
  const missing = await loadCsv(spec, [header, row({ num: `MISS-${uniq()}`, dates: D, item: "X", qty: "1", price: "10" })].join("\r\n"));
  const vMiss = await validateDocumentImport(m, org, missing.mapped);
  check(`${L}: missing ${cfg.partyHeader} is rejected`,
    vMiss.result.documents[0]?.ok === false && vMiss.result.documents[0].errors.some((e) => e.includes(`${cfg.partyHeader} is required`)),
    JSON.stringify(vMiss.result.documents[0]?.errors));
  if (reqDate) {
    const noDate = await loadCsv(spec, [header, row({ num: `ND-${uniq()}`, party: partyName, src: srcFor(m), item: "X", qty: "1", price: "10" })].join("\r\n"));
    const vNoDate = await validateDocumentImport(m, org, noDate.mapped);
    check(`${L}: missing ${reqDate.header} is rejected`,
      vNoDate.result.documents[0].errors.some((e) => e.includes(`${reqDate.header} is required`)), JSON.stringify(vNoDate.result.documents[0].errors));
  } else {
    const noDate = await loadCsv(spec, [header, row({ num: `ND-${uniq()}`, party: partyName, item: "X", qty: "1" })].join("\r\n"));
    const vNoDate = await validateDocumentImport(m, org, noDate.mapped);
    check(`${L}: both dates may be blank (neither is mandatory)`, vNoDate.result.documents[0].ok === true,
      JSON.stringify(vNoDate.result.documents[0].errors));
  }
  if (cfg.sourceDoc) {
    const badSrc = await loadCsv(spec, [header, row({ num: `BS-${uniq()}`, party: partyName, src: "NOPE-999", dates: D, item: "X", qty: "1", price: "10" })].join("\r\n"));
    const vBad = await validateDocumentImport(m, org, badSrc.mapped);
    check(`${L}: unknown ${cfg.sourceDoc.header} is rejected`,
      vBad.result.documents[0].errors.some((e) => e.includes("not found")), JSON.stringify(vBad.result.documents[0].errors));
  }

  // ---- optional fields may stay blank ----
  const bare = `BARE-${uniq()}`;
  const minimal = await loadCsv(spec, [header, row({ num: bare, party: partyName, src: srcFor(m), dates: reqDate ? D : [], item: "Only item", qty: "2", price: "100" })].join("\r\n"));
  const vMin = await validateDocumentImport(m, org, minimal.mapped);
  check(`${L}: optional fields can all stay blank`, vMin.result.documents[0].ok === true, JSON.stringify(vMin.result.documents[0].errors));
  const cMin = await commitDocumentImport(m, org, user, minimal.mapped);
  check(`${L}: single-line document imports`, cMin.imported === 1 && cMin.lineItems === 1, `imp=${cMin.imported}`);

  // ---- duplicate document numbers ----
  const dup = await loadCsv(spec, [header,
    row({ num: A, party: partyName, src: srcFor(m), dates: D, item: "Dup", qty: "1", price: "10" }),
    row({ num: `IN-${uniq()}`, party: partyName, src: srcFor(m), dates: D, item: "Ok", qty: "1", price: "10" }),
  ].join("\r\n"));
  const vDup = await validateDocumentImport(m, org, dup.mapped);
  check(`${L}: existing document number rejected`,
    vDup.result.documents.find((d) => d.number === A)?.errors.some((e) => e.includes("already exists")) === true,
    JSON.stringify(vDup.result.documents[0].errors));
  check(`${L}: duplicate surfaced in the summary`, vDup.result.summary.duplicateNumbers.includes(A));
  const before = (await pool.query(`select count(*)::int n from ${db.t} where org_id=$1 and ${db.n}=$2`, [org, A])).rows[0].n;
  const cDup = await commitDocumentImport(m, org, user, dup.mapped);
  const after = (await pool.query(`select count(*)::int n from ${db.t} where org_id=$1 and ${db.n}=$2`, [org, A])).rows[0].n;
  check(`${L}: duplicate skipped, the other document imported`, cDup.imported === 1 && cDup.skipped === 1 && before === after,
    `imp=${cDup.imported} skip=${cDup.skipped}`);

  // ---- conflicting document-level values block the document ----
  const CF = `CF-${uniq()}`;
  const conflict = await loadCsv(spec, [header,
    row({ num: CF, party: partyName, src: srcFor(m), dates: D, item: "One", qty: "1", price: "10" }),
    row({ num: CF, party: otherParty, item: "Two", qty: "1", price: "20" }),
  ].join("\r\n"));
  const vCf = await validateDocumentImport(m, org, conflict.mapped);
  check(`${L}: conflicting ${cfg.partyHeader} blocks the document`,
    vCf.result.documents[0].ok === false && vCf.result.documents[0].errors.some((e) => e.includes("differs between rows")),
    JSON.stringify(vCf.result.documents[0].errors));
  const cCf = await commitDocumentImport(m, org, user, conflict.mapped);
  const cfRows = (await pool.query(`select count(*)::int n from ${db.t} where org_id=$1 and ${db.n}=$2`, [org, CF])).rows[0].n;
  check(`${L}: conflict leaves no partial document`, cCf.imported === 0 && cfRows === 0, `rows=${cfRows}`);

  // ---- one bad line invalidates the whole document, others still import ----
  const BAD = `BAD-${uniq()}`, GOOD = `GOOD-${uniq()}`;
  const badLine = await loadCsv(spec, [header,
    row({ num: BAD, party: partyName, src: srcFor(m), dates: D, item: "Good line", qty: "1", price: "100" }),
    row({ num: BAD, item: "Bad line", qty: "0", price: "100" }),
    row({ num: GOOD, party: partyName, src: srcFor(m), dates: D, item: "Fine", qty: "1", price: "100" }),
  ].join("\r\n"));
  const vBadLine = await validateDocumentImport(m, org, badLine.mapped);
  check(`${L}: a bad line item invalidates its whole document`,
    vBadLine.result.documents.find((d) => d.number === BAD)?.ok === false
    && vBadLine.result.documents.find((d) => d.number === GOOD)?.ok === true);
  const cBad = await commitDocumentImport(m, org, user, badLine.mapped);
  const badHeaders = (await pool.query(`select count(*)::int n from ${db.t} where org_id=$1 and ${db.n}=$2`, [org, BAD])).rows[0].n;
  const goodHeaders = (await pool.query(`select count(*)::int n from ${db.t} where org_id=$1 and ${db.n}=$2`, [org, GOOD])).rows[0].n;
  check(`${L}: no partial header for the failed document, the valid one imports`,
    cBad.imported === 1 && badHeaders === 0 && goodHeaders === 1, `bad=${badHeaders} good=${goodHeaders}`);
  const errCsv = buildErrorCsv(badLine.grid.headers, badLine.grid.rows, new Map(vBadLine.result.rowErrors));
  check(`${L}: failed rows downloadable with messages`, errCsv.includes("Errors") && errCsv.includes("greater than 0"));

  // ---- date formats ----
  if (reqDate) {
    const dmy = await loadCsv(spec, [header, row({ num: `DT-${uniq()}`, party: partyName, src: srcFor(m), dates: cfg.dates.map(() => "05/08/2026"), item: "X", qty: "1", price: "10" })].join("\r\n"));
    const fmts = Object.fromEntries(cfg.dates.map((d) => [d.key, "dmy"]));
    const vDmy = await validateDocumentImport(m, org, dmy.mapped, fmts as never);
    check(`${L}: DD/MM/YYYY parses to 2026-08-05`, vDmy.result.documents[0].issueDate === "2026-08-05", String(vDmy.result.documents[0].issueDate));
    const fmtsM = Object.fromEntries(cfg.dates.map((d) => [d.key, "mdy"]));
    const vMdy = await validateDocumentImport(m, org, dmy.mapped, fmtsM as never);
    check(`${L}: MM/DD/YYYY parses the same text to 2026-05-08`, vMdy.result.documents[0].issueDate === "2026-05-08", String(vMdy.result.documents[0].issueDate));
    const vAuto = await validateDocumentImport(m, org, dmy.mapped);
    check(`${L}: Auto Detect refuses the ambiguous date`,
      vAuto.result.documents[0].ok === false && vAuto.result.documents[0].errors.some((e) => e.includes("more than one way")),
      JSON.stringify(vAuto.result.documents[0].errors));
    const imp = await loadCsv(spec, [header, row({ num: `DI-${uniq()}`, party: partyName, src: srcFor(m), dates: cfg.dates.map(() => "31/02/2026"), item: "X", qty: "1", price: "10" })].join("\r\n"));
    const vImp = await validateDocumentImport(m, org, imp.mapped, fmts as never);
    check(`${L}: impossible date rejected`, vImp.result.documents[0].errors.some((e) => e.includes("not a real calendar date")));
  }

  // ---- terms: || form, first-row-only, conflicting terms ----
  const T1 = `TM-${uniq()}`, T2 = `TC-${uniq()}`;
  const terms = await loadCsv(spec, [header,
    row({ num: T1, party: partyName, src: srcFor(m), dates: D, terms: "Alpha || Beta", item: "One", qty: "1", price: "10" }),
    row({ num: T1, item: "Two", qty: "1", price: "20" }),
    row({ num: T2, party: partyName, src: srcFor(m), dates: D, terms: "Alpha", item: "One", qty: "1", price: "10" }),
    row({ num: T2, terms: "Different", item: "Two", qty: "1", price: "20" }),
  ].join("\r\n"));
  const vT = await validateDocumentImport(m, org, terms.mapped);
  check(`${L}: || terms split into 2, first-row-only applies to the group`,
    vT.result.documents.find((d) => d.number === T1)?.termCount === 2 && vT.result.documents.find((d) => d.number === T1)?.ok === true,
    JSON.stringify(vT.result.documents.find((d) => d.number === T1)?.errors));
  check(`${L}: conflicting terms block the document`,
    vT.result.documents.find((d) => d.number === T2)?.errors.some((e) => e.includes("Terms & Conditions") && e.includes("differs between rows")) === true,
    JSON.stringify(vT.result.documents.find((d) => d.number === T2)?.errors));
  await commitDocumentImport(m, org, user, terms.mapped);
  const t1row = (await pool.query(`select terms from ${db.t} where org_id=$1 and ${db.n}=$2`, [org, T1])).rows[0];
  check(`${L}: || terms stored in order`, t1row?.terms?.map((t: { text: string }) => t.text).join("|") === "Alpha|Beta", JSON.stringify(t1row?.terms));

  // ---- XLSX ingest (real Date cells) ----
  const wb = new (await import("exceljs")).default.Workbook();
  const ws = wb.addWorksheet("D");
  const XN = `XL-${uniq()}`;
  ws.addRow(cols);
  const xrow = (num: string, first: boolean, item: string, qty: number, price: number) => {
    const r: (string | number | Date)[] = [num, first ? partyName : ""];
    if (cfg.sourceDoc) r.push(first ? srcFor(m) : "");
    for (let i = 0; i < cfg.dates.length; i++) r.push(first ? new Date(Date.UTC(2026, 7, 5)) : "");
    r.push(first ? "XT one\nXT two" : "", item, "", qty);
    if (cfg.pricing) { r.push(price, 15); }
    r.push("pcs");
    return r;
  };
  ws.addRow(xrow(XN, true, "First", 1, 1000));
  ws.addRow(xrow(XN, false, "Second", 2, 500));
  const xg = await parseImportFile("d.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
  const xm = applyMapping(spec, xg.rows, autoMap(spec, xg.headers));
  const vX = await validateDocumentImport(m, org, xm);
  check(`${L}: xlsx valid, 2 rows -> 1 document with 2 lines`,
    vX.result.summary.invalidDocuments === 0 && vX.result.summary.documents === 1 && vX.result.documents[0].lineCount === 2,
    JSON.stringify(vX.result.documents.map((d) => d.errors)));
  const cX = await commitDocumentImport(m, org, user, xm);
  const xdoc = (await pool.query(`select * from ${db.t} where org_id=$1 and ${db.n}=$2`, [org, XN])).rows[0];
  const xitems = (await pool.query(`select count(*)::int n from ${db.items} where ${db.fk}=$1`, [xdoc.id])).rows[0].n;
  check(`${L}: xlsx imported 1 document with 2 items`, cX.imported === 1 && xitems === 2, `items=${xitems}`);
  check(`${L}: xlsx Excel date cell read correctly`,
    !reqDate || isoDate(xdoc[reqDate.key === "orderDate" ? "order_date" : "issue_date"]) === "2026-08-05", "");
  check(`${L}: xlsx terms imported`, Array.isArray(xdoc?.terms) && xdoc.terms.length === 2, JSON.stringify(xdoc?.terms));

  // ---- everything stays a draft; nothing posted ----
  const allDrafts = (await pool.query(`select count(*)::int n from ${db.t} where org_id=$1 and status <> 'draft'`, [org])).rows[0].n;
  check(`${L}: every imported document is Draft`, allDrafts === 0, `non-draft=${allDrafts}`);

  // ---- visible on the module's list, and editable (lists hide archived/deleted; edit needs draft) ----
  const listed = (await pool.query(
    `select status from ${db.t} where org_id=$1 and ${db.n}=$2 and archived_at is null and deleted_at is null`, [org, A],
  )).rows;
  check(`${L}: imported document appears in the module list and is editable`,
    listed.length === 1 && listed[0].status === "draft", JSON.stringify(listed));

  // ---- tenant isolation ----
  const org2 = (await pool.query("insert into orgs (name) values ($1) returning id", [`Other ${uniq()}`])).rows[0].id as number;
  const vIso = await validateDocumentImport(m, org2, mm.mapped);
  check(`${L}: another org cannot resolve this org's ${cfg.partyHeader}`,
    vIso.result.documents.every((d) => d.errors.some((e) => e.includes("not found"))), JSON.stringify(vIso.result.documents[0].errors));
}

// ---------- no ledger / stock side effects anywhere ----------
const je = (await pool.query("select count(*)::int n from journal_entries where org_id=$1", [org])).rows[0].n;
check("import posted no journal entries at all", je === 0, `entries=${je}`);
const stock = (await pool.query("select quantity_on_hand from products where org_id=$1", [org])).rows[0];
check("import moved no stock", Number(stock.quantity_on_hand) === 0, String(stock.quantity_on_hand));

await pool.end();
let ok = true;
for (const [cond, name, extra] of results) { if (!cond) ok = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "DOCUMENT IMPORT VERIFICATION PASS" : "DOCUMENT IMPORT VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
