// Run via `npm run verify:<name>`, which supplies --conditions=react-server. That is the same
// module resolution Next.js uses on the server, so `import "server-only"` resolves to the empty
// module the package ships for exactly that condition — the real production code is imported
// with nothing intercepted. A previous createRequire cache stub lived here and never worked:
// ESM hoists imports above statements, so it ran after the guard had already thrown.
import { readFileSync } from "fs";

process.env.DATABASE_URL ||= readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="))!.slice(13).trim();

import { Pool } from "pg";
import { QUOTATION_IMPORT_SPEC, autoMap } from "../src/lib/import/spec";
import { parseImportFile, buildTemplateXlsx, buildTemplateCsv, buildErrorCsv } from "../src/lib/import/parse";
import { validateQuotationImport, commitQuotationImport, type MappedRow } from "../src/lib/import/quotation-import";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
/** pg returns DATE columns as Date objects — normalize to YYYY-MM-DD for comparison. */
const isoDate = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

const spec = QUOTATION_IMPORT_SPEC;
const applyMapping = (rows: string[][], mapping: Record<string, number>): MappedRow[] =>
  rows.map((cells) => {
    const o: MappedRow = {};
    for (const f of spec.fields) { const i = mapping[f.key]; o[f.key] = i >= 0 ? (cells[i] ?? "").trim() : ""; }
    return o;
  });

// ---------- fixtures ----------
const org = (await pool.query("insert into orgs (name) values ($1) returning id", [`Imp ${uniq()}`])).rows[0].id as number;
const user = (await pool.query(
  "insert into users (org_id, name, email, password_hash, role) values ($1,'Imp','imp_"+uniq()+"@t.dev','x','owner') returning id",
  [org],
)).rows[0].id as number;
await pool.query("insert into customers (org_id,name) values ($1,'Acme Trading Co.'),($1,'Globex LLC')", [org]);
await pool.query("insert into products (org_id,sku,name) values ($1,'SKU-1','Widget')", [org]);
// document sequence so auto-numbering works
await pool.query(
  "insert into document_sequences (org_id, document_type, prefix, next_number, padding) values ($1,'quotation','QTN-',1,4) on conflict do nothing",
  [org],
).catch(() => {});

// ---------- 1. template generation ----------
const xlsxBuf = await buildTemplateXlsx(spec);
check("xlsx template generated (zip magic)", xlsxBuf.length > 2000 && xlsxBuf[0] === 0x50 && xlsxBuf[1] === 0x4b, `${xlsxBuf.length} bytes`);
const csvTpl = buildTemplateCsv(spec);
check("csv template has every spec column", spec.fields.every((f) => csvTpl.includes(f.header)));
const requiredHeaders = spec.fields.filter((f) => f.required).map((f) => f.header);
check("only genuinely required fields are mandatory", JSON.stringify(requiredHeaders) === JSON.stringify(["Client", "Issue Date"]), requiredHeaders.join(", "));

// round-trip the generated xlsx back through the parser
const tplGrid = await parseImportFile("t.xlsx", xlsxBuf);
check("xlsx template round-trips through parser", tplGrid.headers.length === spec.fields.length && tplGrid.rows.length === spec.exampleRows.length, `${tplGrid.headers.length} cols / ${tplGrid.rows.length} rows`);

// ---------- 2. CSV: grouping + optional blanks + __desc ----------
const N1 = `QTN-${uniq()}`;
const csv = [
  "Quotation Number,Client,Issue Date,Valid Till,Title,Currency,Discount,Notes,Item Name,Item Description,SKU,Quantity,Rate,Unit,Tax Rate %",
  `${N1},Acme Trading Co.,2026-01-15,2026-02-15,Stand build,SAR,100,Hello,Stand 6x3,"Design, build & dismantle",SKU-1,2,1000,pcs,15`,
  `${N1},,,,,,,,Extra lighting,,,1,500,,15`,          // 2nd line of the SAME quotation, optional cols blank
  `,Globex LLC,2026-02-01,,,,,,Single item,,,3,250,,`, // blank number -> its own doc, auto number, no tax
].join("\r\n");
const g1 = await parseImportFile("a.csv", Buffer.from(csv, "utf8"));
const m1 = autoMap(spec, g1.headers);
check("auto-mapping matched all present columns", spec.fields.filter((f) => g1.headers.includes(f.header)).every((f) => m1[f.key] >= 0));
const mapped1 = applyMapping(g1.rows, m1);
const v1 = await validateQuotationImport(org, mapped1);
check("grouping: 3 rows -> 2 documents", v1.result.summary.documents === 2, `docs=${v1.result.summary.documents}`);
check("grouped doc has 2 line items", v1.docs.find((d) => d.number === N1)?.lines.length === 2);
check("all documents valid (optional blanks OK)", v1.result.summary.invalidDocuments === 0, JSON.stringify(v1.result.documents.map((d) => d.errors)));

const c1 = await commitQuotationImport(org, user, mapped1);
check("committed 2 documents, 3 line items", c1.imported === 2 && c1.lineItems === 3, `imported=${c1.imported} lines=${c1.lineItems} failed=${c1.failed}`);

const row = (await pool.query("select id,quotation_number,status,total,tax_total,discount,currency,valid_until,title from quotations where org_id=$1 and quotation_number=$2", [org, N1])).rows[0];
check("imported quotation is DRAFT", row?.status === "draft", String(row?.status));
check("header fields imported (title/currency/valid_until)", row?.title === "Stand build" && row?.currency === "SAR" && isoDate(row?.valid_until) === "2026-02-15", `${row?.title}|${row?.currency}|${isoDate(row?.valid_until)}`);
// 2*1000 + 1*500 = 2500 subtotal; discount 100 -> taxable 2400 @15% = 360 -> total 2760
check("totals computed via shared computeTotals", Number(row?.total) === 2760 && Number(row?.tax_total) === 360 && Number(row?.discount) === 100, `total=${row?.total} tax=${row?.tax_total} disc=${row?.discount}`);

const items = (await pool.query("select description, quantity, unit_price, unit, custom_fields, product_id from quotation_items where quotation_id=$1 order by id", [row.id])).rows;
check("line item name -> description column", items[0]?.description === "Stand 6x3", String(items[0]?.description));
check("long description -> customFields.__desc", items[0]?.custom_fields?.__desc === "Design, build & dismantle", JSON.stringify(items[0]?.custom_fields));
check("SKU linked to product", items[0]?.product_id !== null);
check("2nd line has no __desc and no product", (items[1]?.custom_fields?.__desc ?? undefined) === undefined && items[1]?.product_id === null);
const autoDoc = (await pool.query("select quotation_number from quotations where org_id=$1 and quotation_number<>$2", [org, N1])).rows[0];
check("blank number auto-generated", Boolean(autoDoc?.quotation_number) && autoDoc.quotation_number !== N1, String(autoDoc?.quotation_number));

// ---------- 3. duplicate rejection (existing + in-file) ----------
const dupCsv = [
  "Quotation Number,Client,Issue Date,Item Name,Quantity,Rate",
  `${N1},Acme Trading Co.,2026-03-01,Dup doc,1,10`,       // already exists in DB
  `DUPX-${uniq()},Acme Trading Co.,2026-03-01,A,1,10`,
].join("\r\n");
const g2 = await parseImportFile("d.csv", Buffer.from(dupCsv, "utf8"));
const mapped2 = applyMapping(g2.rows, autoMap(spec, g2.headers));
const v2 = await validateQuotationImport(org, mapped2);
const dupDoc = v2.result.documents.find((d) => d.number === N1);
check("existing document number rejected", dupDoc?.ok === false && dupDoc.errors.some((e) => e.includes("already exists")), JSON.stringify(dupDoc?.errors));
check("duplicate number surfaced in summary", v2.result.summary.duplicateNumbers.includes(N1));
const c2 = await commitQuotationImport(org, user, mapped2);
check("duplicate skipped, other doc imported", c2.imported === 1 && c2.skipped === 1, `imp=${c2.imported} skip=${c2.skipped}`);
const stillOne = (await pool.query("select count(*)::int n from quotations where org_id=$1 and quotation_number=$2", [org, N1])).rows[0].n;
check("existing document NOT overwritten/duplicated", stillOne === 1, `count=${stillOne}`);

// ---------- 4. invalid rows blocked + error file ----------
const badCsv = [
  "Quotation Number,Client,Issue Date,Item Name,Quantity,Rate",
  `BAD-${uniq()},Nonexistent Client,2026-01-01,X,1,10`,   // unknown client
  `BAD2-${uniq()},Acme Trading Co.,not-a-date,Y,1,10`,    // bad date
  `BAD3-${uniq()},Acme Trading Co.,2026-01-01,Z,0,10`,    // qty 0
  `BAD4-${uniq()},Acme Trading Co.,2026-01-01,,,`,        // no line item
].join("\r\n");
const g3 = await parseImportFile("b.csv", Buffer.from(badCsv, "utf8"));
const mapped3 = applyMapping(g3.rows, autoMap(spec, g3.headers));
const v3 = await validateQuotationImport(org, mapped3);
check("all 4 invalid documents flagged", v3.result.summary.invalidDocuments === 4 && v3.result.summary.willCreate === 0, `invalid=${v3.result.summary.invalidDocuments}`);
const before = (await pool.query("select count(*)::int n from quotations where org_id=$1", [org])).rows[0].n;
const c3 = await commitQuotationImport(org, user, mapped3);
const after = (await pool.query("select count(*)::int n from quotations where org_id=$1", [org])).rows[0].n;
check("invalid rows never enter the database", c3.imported === 0 && before === after, `imported=${c3.imported} ${before}->${after}`);
const errCsv = buildErrorCsv(g3.headers, g3.rows, new Map(v3.result.rowErrors));
check("error file lists failed rows with messages", errCsv.includes("Errors") && errCsv.includes("not found") && errCsv.split("\r\n").length >= 5);

// ---------- 5. XLSX ingest ----------
const ExcelJS = (await import("exceljs")).default;
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Q");
const XN = `XL-${uniq()}`;
ws.addRow(["Quotation Number", "Client", "Issue Date", "Item Name", "Quantity", "Rate", "Tax Rate %"]);
ws.addRow([XN, "Acme Trading Co.", new Date(Date.UTC(2026, 4, 20)), "From Excel", 4, 125, 15]); // real Date cell
ws.addRow([XN, "", "", "Second excel line", 1, 75, 15]);
const xbuf = Buffer.from(await wb.xlsx.writeBuffer());
const g4 = await parseImportFile("x.xlsx", xbuf);
const mapped4 = applyMapping(g4.rows, autoMap(spec, g4.headers));
const v4 = await validateQuotationImport(org, mapped4);
check("xlsx: date cell parsed, doc valid", v4.result.summary.invalidDocuments === 0, JSON.stringify(v4.result.documents.map((d) => d.errors)));
const c4 = await commitQuotationImport(org, user, mapped4);
const xrow = (await pool.query("select issue_date, total from quotations where org_id=$1 and quotation_number=$2", [org, XN])).rows[0];
check("xlsx imported 1 doc with 2 lines", c4.imported === 1 && c4.lineItems === 2, `imp=${c4.imported} lines=${c4.lineItems}`);
check("xlsx date cell -> 2026-05-20", isoDate(xrow?.issue_date) === "2026-05-20", isoDate(xrow?.issue_date));

// ---------- 5b. MULTI LINE ITEMS: 3 rows same number -> 1 quotation with 3 lines ----------
const A = `QT-${uniq()}`, B = `QT-${uniq()}`;
const multiCsv = [
  "Quotation Number,Client,Issue Date,Item Name,Item Description,Quantity,Rate,Tax Rate %",
  `${A},ABC Company,2026-08-05,Exhibition Stand,6x4 custom stand,1,15000,15`,
  `${A},ABC Company,2026-08-05,LED Screen,4x2 metre screen,2,2500,15`,
  `${A},ABC Company,2026-08-05,Furniture,Sofa and table set,3,800,15`,
  `${B},XYZ Company,2026-08-05,Branding,Vinyl branding,10,120,15`,
  `,ABC Company,2026-08-06,Standalone one,,1,50,`,   // blank number -> own doc
  `,ABC Company,2026-08-06,Standalone two,,1,60,`,   // blank number -> SEPARATE doc (not grouped)
].join("\r\n");
await pool.query("insert into customers (org_id,name) values ($1,'ABC Company'),($1,'XYZ Company')", [org]);
const gM = await parseImportFile("m.csv", Buffer.from(multiCsv, "utf8"));
const mappedM = applyMapping(gM.rows, autoMap(spec, gM.headers));
const vM = await validateQuotationImport(org, mappedM);
check("multi: 6 rows -> 4 quotations", vM.result.summary.documents === 4, `docs=${vM.result.summary.documents}`);
check("multi: line items detected = 6", vM.result.summary.totalLineItems === 6, `lines=${vM.result.summary.totalLineItems}`);
const docA = vM.result.documents.find((d) => d.number === A);
const docB = vM.result.documents.find((d) => d.number === B);
check("multi: QT-A has 3 line items", docA?.lineCount === 3, `lines=${docA?.lineCount}`);
check("multi: QT-B has 1 line item", docB?.lineCount === 1, `lines=${docB?.lineCount}`);
check("multi: blank numbers stay separate (2 auto docs)", vM.result.documents.filter((d) => d.number === "(auto)").length === 2);
check("multi: all valid", vM.result.summary.invalidDocuments === 0, JSON.stringify(vM.result.documents.map((d) => d.errors)));

const cM = await commitQuotationImport(org, user, mappedM);
check("multi: imported 4 documents, 6 line items", cM.imported === 4 && cM.lineItems === 6, `imp=${cM.imported} lines=${cM.lineItems}`);
const rowA = (await pool.query("select id,total,tax_total from quotations where org_id=$1 and quotation_number=$2", [org, A])).rows[0];
const itemsA = (await pool.query("select description, quantity, unit_price, custom_fields from quotation_items where quotation_id=$1 order by id", [rowA.id])).rows;
check("multi: ONE quotation row for 3 items", itemsA.length === 3, `items=${itemsA.length}`);
check("multi: line names preserved per row", itemsA.map((i) => i.description).join("|") === "Exhibition Stand|LED Screen|Furniture", itemsA.map((i) => i.description).join("|"));
check("multi: line descriptions -> __desc per row", itemsA.map((i) => i.custom_fields?.__desc).join("|") === "6x4 custom stand|4x2 metre screen|Sofa and table set");
// 15000 + 2*2500 + 3*800 = 22400 subtotal; 15% VAT = 3360 -> total 25760
check("multi: totals across all 3 lines", Number(rowA.total) === 25760 && Number(rowA.tax_total) === 3360, `total=${rowA.total} tax=${rowA.tax_total}`);

// ---------- 5c. CONFLICTING document-level values are blocked ----------
const C = `QT-${uniq()}`;
const conflictCsv = [
  "Quotation Number,Client,Issue Date,Item Name,Quantity,Rate",
  `${C},ABC Company,2026-08-05,Item one,1,100`,
  `${C},XYZ Company,2026-08-05,Item two,1,200`,   // different Client -> conflict
].join("\r\n");
const gC = await parseImportFile("c.csv", Buffer.from(conflictCsv, "utf8"));
const mappedC = applyMapping(gC.rows, autoMap(spec, gC.headers));
const vC = await validateQuotationImport(org, mappedC);
const docC = vC.result.documents[0];
check("conflict: quotation blocked", docC?.ok === false && docC.errors.some((e) => e.includes("differs between rows")), JSON.stringify(docC?.errors));
check("conflict: counted in summary", vC.result.summary.conflictingDocuments === 1);
const beforeC = (await pool.query("select count(*)::int n from quotations where org_id=$1", [org])).rows[0].n;
const cC = await commitQuotationImport(org, user, mappedC);
const afterC = (await pool.query("select count(*)::int n from quotations where org_id=$1", [org])).rows[0].n;
check("conflict: nothing imported, no partial header", cC.imported === 0 && beforeC === afterC, `${beforeC}->${afterC}`);

// ---------- 5d. one bad line invalidates the WHOLE quotation (no partial doc) ----------
const D = `QT-${uniq()}`;
const badLineCsv = [
  "Quotation Number,Client,Issue Date,Item Name,Quantity,Rate",
  `${D},ABC Company,2026-08-05,Good line,1,100`,
  `${D},,,Bad line,0,100`,   // quantity 0 -> invalid line
].join("\r\n");
const gD = await parseImportFile("bl.csv", Buffer.from(badLineCsv, "utf8"));
const mappedD = applyMapping(gD.rows, autoMap(spec, gD.headers));
const vD = await validateQuotationImport(org, mappedD);
check("bad line: whole quotation invalid", vD.result.documents[0]?.ok === false && vD.result.summary.willCreate === 0);
const cD = await commitQuotationImport(org, user, mappedD);
const partial = (await pool.query("select count(*)::int n from quotations where org_id=$1 and quotation_number=$2", [org, D])).rows[0].n;
check("bad line: no partial header or line items created", cD.imported === 0 && partial === 0, `headers=${partial}`);

// ---------- 5e. multi-line via XLSX ----------
const wb2 = new (await import("exceljs")).default.Workbook();
const ws2 = wb2.addWorksheet("Q");
const XM = `QX-${uniq()}`;
ws2.addRow(["Quotation Number", "Client", "Issue Date", "Item Name", "Item Description", "Quantity", "Rate", "Tax Rate %"]);
ws2.addRow([XM, "ABC Company", new Date(Date.UTC(2026, 7, 5)), "Stand", "6x4", 1, 15000, 15]);
ws2.addRow([XM, "ABC Company", new Date(Date.UTC(2026, 7, 5)), "Screen", "4x2", 2, 2500, 15]);
ws2.addRow([XM, "ABC Company", new Date(Date.UTC(2026, 7, 5)), "Furniture", "Sofa", 3, 800, 15]);
const gX2 = await parseImportFile("m.xlsx", Buffer.from(await wb2.xlsx.writeBuffer()));
const mappedX2 = applyMapping(gX2.rows, autoMap(spec, gX2.headers));
const vX2 = await validateQuotationImport(org, mappedX2);
check("xlsx multi: 3 rows -> 1 quotation, 3 lines", vX2.result.summary.documents === 1 && vX2.result.documents[0].lineCount === 3, `docs=${vX2.result.summary.documents}`);
const cX2 = await commitQuotationImport(org, user, mappedX2);
const xmRow = (await pool.query("select id,total from quotations where org_id=$1 and quotation_number=$2", [org, XM])).rows[0];
const xmItems = (await pool.query("select count(*)::int n from quotation_items where quotation_id=$1", [xmRow.id])).rows[0].n;
check("xlsx multi: imported 1 doc with 3 items", cX2.imported === 1 && xmItems === 3, `items=${xmItems}`);

// ---------- 5f. templates carry the multi-line example ----------
const tplCsv2 = buildTemplateCsv(spec);
const tplLines = tplCsv2.trim().split("\r\n");
check("template: 4 example rows (3 for one quotation + 1 other)", tplLines.length === 5, `lines=${tplLines.length}`);
check("template: QT-1001 repeated 3x, QT-1002 once",
  tplLines.filter((l) => l.startsWith("QT-1001")).length === 3 && tplLines.filter((l) => l.startsWith("QT-1002")).length === 1);
const tplGrid2 = await parseImportFile("t2.xlsx", await buildTemplateXlsx(spec));
check("template xlsx: 4 example rows round-trip", tplGrid2.rows.length === 4, `rows=${tplGrid2.rows.length}`);

// ---------- 5g. MULTIPLE TERMS in one cell (new lines and ||) ----------
const T1 = `QT-${uniq()}`, T2 = `QT-${uniq()}`, T3 = `QT-${uniq()}`;
const termsCsv = [
  "Quotation Number,Client,Issue Date,Terms & Conditions,Item Name,Quantity,Rate",
  // multi-line cell, terms only on the FIRST row of a 3-line quotation
  `${T1},ABC Company,2026-08-05,"1. Payment must be made within 30 days.\n2. Prices are valid for 15 days.\n3. Additional work will be charged separately.",Stand,1,100`,
  `${T1},,,,Screen,2,200`,
  `${T1},,,,Furniture,3,300`,
  // || separator on a single-line quotation
  `${T2},XYZ Company,2026-08-05,Payment within 30 days || Prices valid for 15 days || Extra work charged separately,Branding,1,50`,
  // the SAME terms repeated on every row, written with a different separator on the second row
  `${T3},ABC Company,2026-08-05,"Term one\nTerm two",Line A,1,10`,
  `${T3},ABC Company,2026-08-05,Term one || Term two,Line B,1,20`,
].join("\r\n");
const gT = await parseImportFile("terms.csv", Buffer.from(termsCsv, "utf8"));
const mapT = autoMap(spec, gT.headers);
check("terms: 'Terms & Conditions' header auto-maps", mapT.terms >= 0, `idx=${mapT.terms}`);
const mappedT = applyMapping(gT.rows, mapT);
const vT = await validateQuotationImport(org, mappedT);
check("terms: no conflicts, all 3 quotations valid", vT.result.summary.invalidDocuments === 0, JSON.stringify(vT.result.documents.map((d) => d.errors)));
const pT1 = vT.result.documents.find((d) => d.number === T1);
const pT2 = vT.result.documents.find((d) => d.number === T2);
const pT3 = vT.result.documents.find((d) => d.number === T3);
check("terms: preview counts 3 terms for the newline cell", pT1?.termCount === 3, `n=${pT1?.termCount}`);
check("terms: preview counts 3 terms for the || cell", pT2?.termCount === 3, `n=${pT2?.termCount}`);
check("terms: identical terms with different separators do NOT conflict", pT3?.ok === true && (pT3?.conflicts.length ?? 1) === 0, JSON.stringify(pT3?.conflicts));
check("terms: summary totals every detected term", vT.result.summary.totalTerms === 3 + 3 + 2, `total=${vT.result.summary.totalTerms}`);

const cT = await commitQuotationImport(org, user, mappedT);
check("terms: 3 quotations imported", cT.imported === 3, `imp=${cT.imported} failed=${cT.failed}`);
const rowT1 = (await pool.query("select id,terms,notes from quotations where org_id=$1 and quotation_number=$2", [org, T1])).rows[0];
check("terms: stored as 3 separate document terms", Array.isArray(rowT1?.terms) && rowT1.terms.length === 3, JSON.stringify(rowT1?.terms));
check("terms: order preserved and numbering stripped",
  rowT1?.terms?.map((x: { text: string }) => x.text).join("|") === "Payment must be made within 30 days.|Prices are valid for 15 days.|Additional work will be charged separately.",
  JSON.stringify(rowT1?.terms?.map((x: { text: string }) => x.text)));
check("terms: stored in the document terms shape (no preset group)",
  rowT1?.terms?.every((x: { groupId: unknown; groupName: unknown }) => x.groupId === null && x.groupName === null) === true);
check("terms: NOT written into the notes field", (rowT1?.notes ?? "") === "" || !String(rowT1.notes).includes("Payment must be made"), String(rowT1?.notes));
const itemsT1 = (await pool.query("select count(*)::int n from quotation_items where quotation_id=$1", [rowT1.id])).rows[0].n;
check("terms: first-row-only terms apply to the whole 3-line quotation", itemsT1 === 3, `items=${itemsT1}`);
const rowT2 = (await pool.query("select terms from quotations where org_id=$1 and quotation_number=$2", [org, T2])).rows[0];
check("terms: || separator produced 3 terms",
  rowT2?.terms?.map((x: { text: string }) => x.text).join("|") === "Payment within 30 days|Prices valid for 15 days|Extra work charged separately",
  JSON.stringify(rowT2?.terms));
// the shared read model used by detail / edit / preview / print / PDF must accept what import wrote
const { normalizeDocumentTerms } = await import("../src/app/(app)/sales/_shared/document-terms");
check("terms: render model accepts the imported array unchanged", normalizeDocumentTerms(rowT1.terms).length === 3 && normalizeDocumentTerms(rowT2.terms).length === 3);

// conflicting terms block the whole quotation
const TC = `QT-${uniq()}`;
const termConflictCsv = [
  "Quotation Number,Client,Issue Date,Terms & Conditions,Item Name,Quantity,Rate",
  `${TC},ABC Company,2026-08-05,Payment within 30 days,Line A,1,10`,
  `${TC},ABC Company,2026-08-05,Payment within 60 days,Line B,1,20`,
].join("\r\n");
const gTC = await parseImportFile("tc.csv", Buffer.from(termConflictCsv, "utf8"));
const mappedTC = applyMapping(gTC.rows, autoMap(spec, gTC.headers));
const vTC = await validateQuotationImport(org, mappedTC);
check("terms conflict: quotation blocked with a clear error",
  vTC.result.documents[0]?.ok === false && vTC.result.documents[0].errors.some((e) => e.includes("Terms & Conditions") && e.includes("differs between rows")),
  JSON.stringify(vTC.result.documents[0]?.errors));
const cTC = await commitQuotationImport(org, user, mappedTC);
const tcCount = (await pool.query("select count(*)::int n from quotations where org_id=$1 and quotation_number=$2", [org, TC])).rows[0].n;
check("terms conflict: nothing imported", cTC.imported === 0 && tcCount === 0, `rows=${tcCount}`);

// terms through XLSX (multi-line cell)
const wb3 = new (await import("exceljs")).default.Workbook();
const ws3 = wb3.addWorksheet("Q");
const TX = `QT-${uniq()}`;
ws3.addRow(["Quotation Number", "Client", "Issue Date", "Terms & Conditions", "Item Name", "Quantity", "Rate"]);
ws3.addRow([TX, "ABC Company", new Date(Date.UTC(2026, 7, 5)), "Alpha term\nBeta term\nGamma term", "Item", 1, 100]);
ws3.addRow([TX, "", "", "", "Item 2", 1, 200]);
const gTX = await parseImportFile("terms.xlsx", Buffer.from(await wb3.xlsx.writeBuffer()));
const mappedTX = applyMapping(gTX.rows, autoMap(spec, gTX.headers));
const vTX = await validateQuotationImport(org, mappedTX);
check("xlsx terms: valid, 3 terms detected", vTX.result.summary.invalidDocuments === 0 && vTX.result.documents[0].termCount === 3, `n=${vTX.result.documents[0]?.termCount}`);
await commitQuotationImport(org, user, mappedTX);
const rowTX = (await pool.query("select terms from quotations where org_id=$1 and quotation_number=$2", [org, TX])).rows[0];
check("xlsx terms: 3 terms stored in order",
  rowTX?.terms?.map((x: { text: string }) => x.text).join("|") === "Alpha term|Beta term|Gamma term", JSON.stringify(rowTX?.terms));

// ---------- 5h. DATE FORMAT SELECTION ----------
const dateRow = (n: string, d: string, valid = "") =>
  `${n},ABC Company,${d},${valid},Item,1,100`;
const dateHeader = "Quotation Number,Client,Issue Date,Valid Till,Item Name,Quantity,Rate";
async function previewDates(lines: string[], formats?: Record<string, string>) {
  const g = await parseImportFile("d.csv", Buffer.from([dateHeader, ...lines].join("\r\n"), "utf8"));
  const mapped = applyMapping(g.rows, autoMap(spec, g.headers));
  return { mapped, res: await validateQuotationImport(org, mapped, formats as never) };
}

const D1 = `QD-${uniq()}`;
const dDmy = await previewDates([dateRow(D1, "05/08/2026", "20/09/2026")], { issueDate: "dmy", validUntil: "dmy" });
check("date DD/MM/YYYY: 05/08/2026 -> 2026-08-05", dDmy.res.result.documents[0]?.issueDate === "2026-08-05", String(dDmy.res.result.documents[0]?.issueDate));
check("date DD/MM/YYYY: Valid Till parsed", dDmy.res.result.documents[0]?.validUntil === "2026-09-20", String(dDmy.res.result.documents[0]?.validUntil));

const dMdy = await previewDates([dateRow(`QD-${uniq()}`, "05/08/2026")], { issueDate: "mdy" });
check("date MM/DD/YYYY: same text -> 2026-05-08", dMdy.res.result.documents[0]?.issueDate === "2026-05-08", String(dMdy.res.result.documents[0]?.issueDate));

const dIso = await previewDates([dateRow(`QD-${uniq()}`, "2026-08-05")], { issueDate: "iso" });
check("date YYYY-MM-DD parses", dIso.res.result.documents[0]?.issueDate === "2026-08-05");

const dDmyDash = await previewDates([dateRow(`QD-${uniq()}`, "05-08-2026")], { issueDate: "dmy_dash" });
check("date DD-MM-YYYY: 05-08-2026 -> 2026-08-05", dDmyDash.res.result.documents[0]?.issueDate === "2026-08-05", String(dDmyDash.res.result.documents[0]?.issueDate));

const dMdyDash = await previewDates([dateRow(`QD-${uniq()}`, "05-08-2026")], { issueDate: "mdy_dash" });
check("date MM-DD-YYYY: 05-08-2026 -> 2026-05-08", dMdyDash.res.result.documents[0]?.issueDate === "2026-05-08", String(dMdyDash.res.result.documents[0]?.issueDate));

const dAmb = await previewDates([dateRow(`QD-${uniq()}`, "05/08/2026")]); // Auto Detect
check("date Auto Detect: ambiguous 05/08/2026 is rejected, not guessed",
  dAmb.res.result.documents[0]?.ok === false && dAmb.res.result.documents[0].errors.some((e) => e.includes("more than one way") && e.includes("Select the date format")),
  JSON.stringify(dAmb.res.result.documents[0]?.errors));

const dAutoOk = await previewDates([dateRow(`QD-${uniq()}`, "31/12/2026")]); // unambiguous under auto
check("date Auto Detect: unambiguous 31/12/2026 -> 2026-12-31", dAutoOk.res.result.documents[0]?.issueDate === "2026-12-31", String(dAutoOk.res.result.documents[0]?.issueDate));

const dImposs = await previewDates([dateRow(`QD-${uniq()}`, "31/02/2026")], { issueDate: "dmy" });
check("date: impossible 31/02/2026 rejected",
  dImposs.res.result.documents[0]?.ok === false && dImposs.res.result.documents[0].errors.some((e) => e.includes("not a real calendar date")),
  JSON.stringify(dImposs.res.result.documents[0]?.errors));

const dSerial = await previewDates([dateRow(`QD-${uniq()}`, "46239")], { issueDate: "excel" }); // 2026-08-05
check("date Excel Date: serial 46239 -> 2026-08-05", dSerial.res.result.documents[0]?.issueDate === "2026-08-05", String(dSerial.res.result.documents[0]?.issueDate));
const dSerialAuto = await previewDates([dateRow(`QD-${uniq()}`, "46239")]);
check("date Auto Detect: a bare number is not silently treated as a date", dSerialAuto.res.result.documents[0]?.ok === false);

const dBlank = await previewDates([dateRow(`QD-${uniq()}`, "05/08/2026", "")], { issueDate: "dmy", validUntil: "dmy" });
check("date: blank optional Valid Till is accepted", dBlank.res.result.documents[0]?.ok === true && dBlank.res.result.documents[0].validUntil === "", JSON.stringify(dBlank.res.result.documents[0]?.errors));

const dMissing = await previewDates([dateRow(`QD-${uniq()}`, "")], { issueDate: "dmy" });
check("date: Issue Date remains mandatory", dMissing.res.result.documents[0]?.ok === false && dMissing.res.result.documents[0].errors.some((e) => e.includes("Issue Date is required")));

// the selected format is honoured at COMMIT time, not just in the preview
const DC = `QD-${uniq()}`;
const dCommit = await previewDates([dateRow(DC, "05/08/2026", "09/20/2026")], { issueDate: "mdy", validUntil: "mdy" });
check("date: preview accepts the MM/DD file before commit", dCommit.res.result.documents[0]?.ok === true, JSON.stringify(dCommit.res.result.documents[0]?.errors));
const cDate = await commitQuotationImport(org, user, dCommit.mapped, { issueDate: "mdy", validUntil: "mdy" } as never);
const dcRow = (await pool.query("select issue_date, valid_until from quotations where org_id=$1 and quotation_number=$2", [org, DC])).rows[0];
check("date: selected format used when writing to the database",
  cDate.imported === 1 && isoDate(dcRow?.issue_date) === "2026-05-08" && isoDate(dcRow?.valid_until) === "2026-09-20",
  `${isoDate(dcRow?.issue_date)} / ${isoDate(dcRow?.valid_until)} imported=${cDate.imported}`);

// a real Excel date cell still parses under every selection
const wb4 = new (await import("exceljs")).default.Workbook();
const ws4 = wb4.addWorksheet("Q");
const DX = `QD-${uniq()}`;
ws4.addRow(["Quotation Number", "Client", "Issue Date", "Item Name", "Quantity", "Rate"]);
ws4.addRow([DX, "ABC Company", new Date(Date.UTC(2026, 7, 5)), "Item", 1, 100]);
const gDX = await parseImportFile("dx.xlsx", Buffer.from(await wb4.xlsx.writeBuffer()));
const mappedDX = applyMapping(gDX.rows, autoMap(spec, gDX.headers));
const vDX = await validateQuotationImport(org, mappedDX, { issueDate: "mdy" } as never);
check("date: a real Excel date cell is read correctly regardless of the picked format",
  vDX.result.documents[0]?.issueDate === "2026-08-05", String(vDX.result.documents[0]?.issueDate));

// mixed file: one bad date must not stop the other quotations
const OK1 = `QD-${uniq()}`;
const dMixed = await previewDates([dateRow(OK1, "05/08/2026"), dateRow(`QD-${uniq()}`, "31/02/2026")], { issueDate: "dmy" });
check("date: one invalid-date quotation does not block the valid ones",
  dMixed.res.result.summary.willCreate === 1 && dMixed.res.result.summary.invalidDocuments === 1,
  `create=${dMixed.res.result.summary.willCreate} invalid=${dMixed.res.result.summary.invalidDocuments}`);

// ---------- 5i. templates carry the terms + date guidance ----------
const tplCsv3 = buildTemplateCsv(spec);
check("template: Terms & Conditions column present", tplCsv3.includes("Terms & Conditions"));
check("template: multi-term example on the first row only",
  tplCsv3.includes("Payment must be made within 30 days.") && tplCsv3.includes("||"), "");
const tplGrid3 = await parseImportFile("t3.xlsx", await buildTemplateXlsx(spec));
const tIdx = tplGrid3.headers.indexOf("Terms & Conditions");
check("template xlsx: terms cell holds 3 terms on row 1, blank on rows 2-3",
  tplGrid3.rows[0][tIdx].split("\n").length === 3 && tplGrid3.rows[1][tIdx] === "" && tplGrid3.rows[2][tIdx] === "",
  JSON.stringify([tplGrid3.rows[0][tIdx], tplGrid3.rows[1][tIdx]]));
const tplWb = new (await import("exceljs")).default.Workbook();
await tplWb.xlsx.load((await buildTemplateXlsx(spec)) as unknown as ArrayBuffer);
const guideText = JSON.stringify(tplWb.getWorksheet("Field Guide")!.getSheetValues());
check("template guide: one row per line item note", guideText.includes("Use one row per line item. Repeat the quotation number for all items belonging to the same quotation."));
check("template guide: multiple terms note", guideText.includes("Enter multiple Terms & Conditions in one cell using a new line or || between each term."));
check("template guide: date format note", guideText.includes("During column mapping, select the date format used in your uploaded file."));

// ---------- 6. tenant isolation ----------
const org2 = (await pool.query("insert into orgs (name) values ($1) returning id", [`Other ${uniq()}`])).rows[0].id as number;
const isoCsv = ["Quotation Number,Client,Issue Date,Item Name,Quantity,Rate", `ISO-${uniq()},Acme Trading Co.,2026-01-01,X,1,10`].join("\r\n");
const g5 = await parseImportFile("i.csv", Buffer.from(isoCsv, "utf8"));
const mapped5 = applyMapping(g5.rows, autoMap(spec, g5.headers));
const v5 = await validateQuotationImport(org2, mapped5);
check("client from another org is not visible", v5.result.summary.invalidDocuments === 1 && v5.result.documents[0].errors.some((e) => e.includes("not found")), JSON.stringify(v5.result.documents[0].errors));

await pool.end();
let ok = true;
for (const [cond, name, extra] of results) { if (!cond) ok = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(ok ? "\nQUOTATION IMPORT VERIFICATION PASS" : "\nQUOTATION IMPORT VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
