// Run via `npm run verify:<name>`, which supplies --conditions=react-server. That is the same
// module resolution Next.js uses on the server, so `import "server-only"` resolves to the empty
// module the package ships for exactly that condition — the real production code is imported
// with nothing intercepted. A previous createRequire cache stub lived here and never worked:
// ESM hoists imports above statements, so it ran after the guard had already thrown.
import { readFileSync } from "fs";

process.env.DATABASE_URL ||= readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="))!.slice(13).trim();

import { Pool } from "pg";
import { CLIENT_IMPORT_SPEC, autoMap } from "../src/lib/import/spec";
import { parseImportFile, buildTemplateXlsx, buildTemplateCsv, buildErrorCsv } from "../src/lib/import/parse";
import { validateClientImport, commitClientImport, type MappedRow } from "../src/lib/import/client-import";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uniq = () => Math.random().toString(36).slice(2, 8);
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

const spec = CLIENT_IMPORT_SPEC;
const applyMapping = (rows: string[][], mapping: Record<string, number>): MappedRow[] =>
  rows.map((cells) => {
    const o: MappedRow = {};
    for (const f of spec.fields) { const i = mapping[f.key]; o[f.key] = i >= 0 ? (cells[i] ?? "").trim() : ""; }
    return o;
  });
const load = async (name: string, csv: string) => {
  const g = await parseImportFile(name, Buffer.from(csv, "utf8"));
  return { grid: g, mapped: applyMapping(g.rows, autoMap(spec, g.headers)) };
};
const clientsOf = async (orgId: number) =>
  (await pool.query("select id,name,email,phone,vat_number,tax_id,city,country_code,notes,client_type,address,record_state from customers where org_id=$1 order by id", [orgId])).rows;

// ---------- fixtures ----------
const org = (await pool.query("insert into orgs (name) values ($1) returning id", [`CImp ${uniq()}`])).rows[0].id as number;
const org2 = (await pool.query("insert into orgs (name) values ($1) returning id", [`COther ${uniq()}`])).rows[0].id as number;

// ---------- 1. template ----------
const csvTpl = buildTemplateCsv(spec);
check("csv template has every spec column", spec.fields.every((f) => csvTpl.includes(f.header)));
const requiredHeaders = spec.fields.filter((f) => f.required).map((f) => f.header);
check("Client Name is the ONLY mandatory column", JSON.stringify(requiredHeaders) === JSON.stringify(["Client Name"]), requiredHeaders.join(", "));
const xlsxBuf = await buildTemplateXlsx(spec);
check("xlsx template generated (zip magic)", xlsxBuf.length > 2000 && xlsxBuf[0] === 0x50 && xlsxBuf[1] === 0x4b, `${xlsxBuf.length} bytes`);
const tplGrid = await parseImportFile("t.xlsx", xlsxBuf);
check("xlsx template round-trips with >= 3 example clients", tplGrid.headers.length === spec.fields.length && tplGrid.rows.length >= 3, `${tplGrid.headers.length} cols / ${tplGrid.rows.length} rows`);
const ExcelJS = (await import("exceljs")).default;
const tplWb = new ExcelJS.Workbook();
await tplWb.xlsx.load(xlsxBuf as unknown as ArrayBuffer);
const guide = tplWb.getWorksheet("Field Guide");
const guideText = JSON.stringify(guide!.getSheetValues());
check("xlsx has a Field Guide sheet", Boolean(guide));
check("Field Guide marks Client Name REQUIRED and others Optional", guideText.includes("REQUIRED") && guideText.includes("Optional"));
// the required column is highlighted in the header row
const dataWs = tplWb.worksheets[0];
const nameIdx = spec.fields.findIndex((f) => f.key === "name") + 1;
const nameFill = JSON.stringify(dataWs.getRow(1).getCell(nameIdx).fill);
const emailFill = JSON.stringify(dataWs.getRow(1).getCell(spec.fields.findIndex((f) => f.key === "email") + 1).fill);
check("required column header is visually distinct in xlsx", nameFill !== emailFill, nameFill);

// ---------- 2. batch create: multiple clients in one file ----------
const N1 = `Acme ${uniq()}`, N2 = `Globex ${uniq()}`, N3 = `Solo ${uniq()}`;
const V1 = `3000${Math.floor(Math.random() * 1e11)}`;
const batch = [
  "Client Name,Client Type,Email,Phone,VAT Number,Commercial Registration Number,Country,City,Street Address,Postal Code,Notes",
  `${N1},company,ops@acme.test,+966 11 234 5678,${V1},1010123456,SA,Riyadh,King Fahd Road,12214,Key account`,
  `${N2},company,hello@globex.test,+971 4 555 0110,,,United Arab Emirates,Dubai,,,`,
  `${N3},,,,,,,,,,`,   // only a name — every other cell blank
].join("\r\n");
const b = await load("clients.csv", batch);
check("auto-mapping matched all present columns", spec.fields.filter((f) => b.grid.headers.includes(f.header)).every((f) => autoMap(spec, b.grid.headers)[f.key] >= 0));
const vB = await validateClientImport(org, b.mapped);
check("batch: 3 rows all valid", vB.result.summary.totalRows === 3 && vB.result.summary.validRows === 3 && vB.result.summary.invalidRows === 0, JSON.stringify(vB.result.rows.map((r) => r.errors)));
check("batch: all 3 are new clients", vB.result.summary.newClients === 3 && vB.result.summary.willCreate === 3);
check("batch: preview reports row numbers", vB.result.rows.map((r) => r.row).join(",") === "2,3,4", vB.result.rows.map((r) => r.row).join(","));

const cB = await commitClientImport(org, b.mapped);
check("batch: 3 clients created", cB.created === 3 && cB.failed === 0 && cB.total === 3, `created=${cB.created} failed=${cB.failed}`);
let rows = await clientsOf(org);
check("batch: rows are in the database", rows.length === 3, `n=${rows.length}`);
const acme = rows.find((r) => r.name === N1)!;
check("batch: all supplied fields stored", acme.email === "ops@acme.test" && acme.vat_number === V1 && acme.tax_id === "1010123456" && acme.city === "Riyadh" && acme.country_code === "SA" && acme.notes === "Key account", JSON.stringify(acme));
check("batch: address composed from the structured columns", String(acme.address).includes("King Fahd Road") && String(acme.address).includes("Riyadh") && String(acme.address).includes("Saudi Arabia"), String(acme.address));
check("batch: country NAME resolved to a code", rows.find((r) => r.name === N2)!.country_code === "AE");
const solo = rows.find((r) => r.name === N3)!;
check("name-only row imported with every optional field blank", solo.email === null && solo.phone === null && solo.vat_number === null && solo.city === null, JSON.stringify(solo));
check("client_type defaults to individual when blank", solo.client_type === "individual" && acme.client_type === "company");

// ---------- 3. mandatory Client Name ----------
const noName = await load("n.csv", ["Client Name,Email", ",a@b.test"].join("\r\n"));
const vN = await validateClientImport(org, noName.mapped);
check("missing Client Name is invalid", vN.result.summary.invalidRows === 1 && vN.result.rows[0].errors.some((e) => e.includes("Client Name is required")), JSON.stringify(vN.result.rows[0].errors));
const beforeN = (await clientsOf(org)).length;
const cN = await commitClientImport(org, noName.mapped);
check("invalid row never enters the database", cN.created === 0 && cN.failed === 1 && (await clientsOf(org)).length === beforeN);

// ---------- 4. field validation ----------
const badCsv = [
  "Client Name,Email,Phone,Country,Building Number,Postal Code,Client Type",
  `Bad Email ${uniq()},not-an-email,,,,,`,
  `Bad Phone ${uniq()},,abcdefg,,,,`,
  `Bad Country ${uniq()},,,Atlantis,,,`,
  `Bad Building ${uniq()},,,SA,12,,`,
  `Bad Postal ${uniq()},,,,,"way too long a postal code",`,
  `Bad Type ${uniq()},,,,,,partnership`,
].join("\r\n");
const bad = await load("bad.csv", badCsv);
const vBad = await validateClientImport(org, bad.mapped);
check("all 6 rule violations flagged", vBad.result.summary.invalidRows === 6, `invalid=${vBad.result.summary.invalidRows}`);
const msg = (i: number) => vBad.result.rows[i].errors.join(" ");
check("email format validated", msg(0).includes("not a valid email"), msg(0));
check("phone format validated", msg(1).includes("not a valid phone"), msg(1));
check("unknown country rejected", msg(2).includes("not a country"), msg(2));
check("SA building number rule reused from the app", msg(3).includes("4 digits"), msg(3));
check("postal code rule reused from the app", msg(4).includes("postal"), msg(4));
check("client type restricted to individual/company", msg(5).includes("individual"), msg(5));
const errCsv = buildErrorCsv(bad.grid.headers, bad.grid.rows, new Map(vBad.result.rowErrors));
check("invalid rows are downloadable with their messages", errCsv.includes("Errors") && errCsv.includes("not a valid email") && errCsv.split("\r\n").length >= 7);
const beforeBad = (await clientsOf(org)).length;
await commitClientImport(org, bad.mapped);
check("no invalid row was written", (await clientsOf(org)).length === beforeBad);

// ---------- 5. duplicate detection against existing org data ----------
const dupCsv = [
  "Client Name,Email,VAT Number,City,Notes",
  `Totally Different Name,,${V1},Jeddah,Updated via import`,       // same VAT as Acme -> match
  `${N2},,,Abu Dhabi,`,                                            // same name, no stronger id -> match
  `Brand New ${uniq()},new@x.test,,Dammam,`,                       // genuinely new
].join("\r\n");
const dup = await load("dup.csv", dupCsv);
const vDupSkip = await validateClientImport(org, dup.mapped, "skip");
check("existing clients detected", vDupSkip.result.summary.matchingClients === 2 && vDupSkip.result.summary.newClients === 1, JSON.stringify(vDupSkip.result.summary));
check("VAT is used as the strong identifier", vDupSkip.result.rows[0].matchedOn === "VAT Number" && vDupSkip.result.rows[0].matchName === N1, vDupSkip.result.rows[0].matchedOn);
check("name matches only when nothing stronger is present", vDupSkip.result.rows[1].matchedOn === "Client Name");
check("skip mode: 2 skipped, 1 created", vDupSkip.result.summary.willSkip === 2 && vDupSkip.result.summary.willCreate === 1 && vDupSkip.result.summary.willUpdate === 0);

const beforeSkip = await clientsOf(org);
const cSkip = await commitClientImport(org, dup.mapped, "skip");
const afterSkip = await clientsOf(org);
check("skip mode: only the new client is created", cSkip.created === 1 && cSkip.skipped === 2 && cSkip.duplicates === 2, `created=${cSkip.created} skipped=${cSkip.skipped}`);
check("skip mode: existing clients are untouched",
  JSON.stringify(afterSkip.find((r) => r.name === N1)) === JSON.stringify(beforeSkip.find((r) => r.name === N1)) &&
  JSON.stringify(afterSkip.find((r) => r.name === N2)) === JSON.stringify(beforeSkip.find((r) => r.name === N2)));
check("skip mode never renames an existing client", afterSkip.some((r) => r.name === N1) && !afterSkip.some((r) => r.name === "Totally Different Name"));

// ---------- 6. update mode ----------
// Re-running the same file: the skip pass above already created its third row, so now all 3 match.
const vDupUpd = await validateClientImport(org, dup.mapped, "update");
check("update mode: every matching row is queued for update", vDupUpd.result.summary.willUpdate === 3 && vDupUpd.result.summary.willSkip === 0 && vDupUpd.result.summary.willCreate === 0, JSON.stringify(vDupUpd.result.summary));
const beforeUpd = (await clientsOf(org)).find((r) => r.name === N1)!;
const cUpd = await commitClientImport(org, dup.mapped, "update");
const afterUpd = (await clientsOf(org)).find((r) => r.id === beforeUpd.id)!;
check("update mode: matching clients updated", cUpd.updated === 3 && cUpd.created === 0 && cUpd.duplicates === 3, `updated=${cUpd.updated} created=${cUpd.created}`);
check("update mode: supplied values applied", afterUpd.city === "Jeddah" && afterUpd.notes === "Updated via import", `${afterUpd.city}/${afterUpd.notes}`);
check("update mode: blank cells do NOT erase existing data",
  afterUpd.email === beforeUpd.email && afterUpd.phone === beforeUpd.phone && afterUpd.tax_id === beforeUpd.tax_id,
  `${afterUpd.email}|${afterUpd.phone}|${afterUpd.tax_id}`);
check("update mode: no extra client rows created", (await clientsOf(org)).length === afterSkip.length, `${afterSkip.length}`);

// ---------- 6b. a shared name with a different strong identifier is NOT a duplicate ----------
const sameName = [
  "Client Name,VAT Number",
  `${N1},3009999999999999`,   // same name as the existing Acme, but a different VAT number
].join("\r\n");
const sn = await load("sn.csv", sameName);
const vSN = await validateClientImport(org, sn.mapped);
check("same name + different VAT is treated as a different client",
  vSN.result.summary.newClients === 1 && vSN.result.summary.matchingClients === 0, JSON.stringify(vSN.result.summary));

// ---------- 7. duplicates inside the uploaded file ----------
const V2 = `3000${Math.floor(Math.random() * 1e11)}`;
const inFile = [
  "Client Name,Email,VAT Number",
  `In File A ${uniq()},dupe@x.test,${V2}`,
  `In File B ${uniq()},other@x.test,${V2}`,   // same VAT as the row above
].join("\r\n");
const f = await load("f.csv", inFile);
const vF = await validateClientImport(org, f.mapped);
check("duplicate inside the file is flagged on the later row",
  vF.result.rows[0].ok && !vF.result.rows[1].ok && vF.result.rows[1].errors.some((e) => e.includes("row 2 of this file")),
  JSON.stringify(vF.result.rows[1].errors));
const cF = await commitClientImport(org, f.mapped);
check("only the first of an in-file duplicate pair is imported", cF.created === 1 && cF.failed === 1, `created=${cF.created} failed=${cF.failed}`);

// ---------- 8. one bad row does not block the good ones ----------
const mixed = [
  "Client Name,Email",
  `Mixed Good1 ${uniq()},g1@x.test`,
  `,broken@x.test`,
  `Mixed Good2 ${uniq()},g2@x.test`,
].join("\r\n");
const m = await load("m.csv", mixed);
const cM = await commitClientImport(org, m.mapped);
check("independent rows: 2 created, 1 failed", cM.created === 2 && cM.failed === 1 && cM.total === 3, `created=${cM.created} failed=${cM.failed}`);

// ---------- 9. XLSX ingest ----------
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Clients");
const XN = `Excel Co ${uniq()}`;
ws.addRow(["Client Name", "Client Type", "Email", "Phone", "VAT Number", "Country", "City"]);
ws.addRow([XN, "company", "x@excel.test", "+966 12 345 6789", `3000${Math.floor(Math.random() * 1e11)}`, "SA", "Jeddah"]);
ws.addRow([`Excel Solo ${uniq()}`, "", "", "", "", "", ""]);
const xg = await parseImportFile("c.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
const xm = applyMapping(xg.rows, autoMap(spec, xg.headers));
const vX = await validateClientImport(org, xm);
check("xlsx: both rows valid", vX.result.summary.validRows === 2 && vX.result.summary.invalidRows === 0, JSON.stringify(vX.result.rows.map((r) => r.errors)));
const cX = await commitClientImport(org, xm);
const xRow = (await clientsOf(org)).find((r) => r.name === XN)!;
check("xlsx: 2 clients created with their fields", cX.created === 2 && xRow.email === "x@excel.test" && xRow.city === "Jeddah", `created=${cX.created}`);

// ---------- 10. manual mapping + ignoring unused source columns ----------
const odd = [
  "Legacy Ref,Full Company Name,Contact Mail",
  `LEG-1,Manual Map ${uniq()},manual@x.test`,
].join("\r\n");
const oddGrid = await parseImportFile("o.csv", Buffer.from(odd, "utf8"));
const autoOdd = autoMap(spec, oddGrid.headers);
check("unrecognized columns are not auto-mapped", autoOdd.name === -1, `name=${autoOdd.name}`);
const manual: Record<string, number> = { ...autoOdd, name: 1, email: 2 }; // "Legacy Ref" (index 0) stays ignored
const vO = await validateClientImport(org, applyMapping(oddGrid.rows, manual));
check("manual mapping makes the file importable", vO.result.summary.validRows === 1 && vO.result.rows[0].name.startsWith("Manual Map"), JSON.stringify(vO.result.rows[0]));
const cO = await commitClientImport(org, applyMapping(oddGrid.rows, manual));
check("manually mapped row imported, ignored column dropped", cO.created === 1);

// ---------- 11. tenant isolation ----------
const isoCsv = ["Client Name,VAT Number", `Cross Org ${uniq()},${V1}`].join("\r\n"); // V1 belongs to `org`
const iso = await load("iso.csv", isoCsv);
const vIso = await validateClientImport(org2, iso.mapped);
check("another org's client is not seen as a duplicate", vIso.result.summary.matchingClients === 0 && vIso.result.summary.newClients === 1, JSON.stringify(vIso.result.summary));
await commitClientImport(org2, iso.mapped);
const org2Rows = await clientsOf(org2);
check("import writes only into the importing org", org2Rows.length === 1);
check("the other org's client list is unchanged", (await clientsOf(org)).every((r) => r.name !== org2Rows[0].name));

// ---------- 12. archived / recycled clients still count as existing ----------
const arch = (await clientsOf(org)).find((r) => r.name === N3)!;
await pool.query("update customers set record_state='deleted' where id=$1", [arch.id]);
const recCsv = ["Client Name,Email", `${N3},recycled@x.test`].join("\r\n");
const rec = await load("rec.csv", recCsv);
const vRec = await validateClientImport(org, rec.mapped);
check("a client in the Recycle Bin is still recognized, not silently recreated", vRec.result.summary.matchingClients === 1, JSON.stringify(vRec.result.summary));

// ---------- 13. imported clients are usable by the document modules ----------
const selectable = (await pool.query(
  "select count(*)::int n from customers where org_id=$1 and record_state='active' and is_active=true and name=$2", [org, XN],
)).rows[0].n;
check("imported client is immediately available for quotation creation", selectable === 1, `n=${selectable}`);

// The quotation importer resolves clients by name against the same table — an imported client must
// work there straight away, which is the whole point of loading clients first.
const { QUOTATION_IMPORT_SPEC } = await import("../src/lib/import/spec");
const { validateQuotationImport } = await import("../src/lib/import/quotation-import");
const qGrid = await parseImportFile("q.csv", Buffer.from(
  ["Quotation Number,Client,Issue Date,Item Name,Quantity,Rate", `QT-${uniq()},${XN},2026-08-05,Stand,1,1000`].join("\r\n"), "utf8"));
const qMap = autoMap(QUOTATION_IMPORT_SPEC, qGrid.headers);
const qMapped = qGrid.rows.map((cells) => {
  const o: Record<string, string> = {};
  for (const f of QUOTATION_IMPORT_SPEC.fields) { const i = qMap[f.key]; o[f.key] = i >= 0 ? (cells[i] ?? "").trim() : ""; }
  return o;
});
const vQ = await validateQuotationImport(org, qMapped);
check("imported client resolves during quotation import", vQ.result.summary.invalidDocuments === 0, JSON.stringify(vQ.result.documents.map((d) => d.errors)));

// ---------- 14. the create/edit form path is unchanged ----------
const { normalizeClientFields } = await import("../src/lib/clients/client-fields");
const formLike = {
  name: "Form Client", clientType: "company", email: "f@x.test", phone: "+966 11 000 0000",
  taxId: "1010000000", vatNumber: "300000000000003", notes: "n",
  countryCode: "SA", stateProvince: "", district: "", city: "Riyadh",
  buildingNumber: "1234", additionalNumber: "", postalCode: "12345", streetAddress: "Main St",
};
const formOut = normalizeClientFields(formLike, { strictCountry: false });
check("form path still produces the same client columns",
  formOut.fields?.name === "Form Client" && formOut.fields?.clientType === "company" &&
  formOut.fields?.city === "Riyadh" && String(formOut.fields?.address).includes("1234 Main St"),
  JSON.stringify(formOut.fields));
const legacyCountry = normalizeClientFields({ ...formLike, countryCode: "ZZ" }, { strictCountry: false });
check("form path still accepts a country the app does not list (unchanged behaviour)",
  legacyCountry.errors.length === 0 && legacyCountry.fields?.countryCode === "ZZ", JSON.stringify(legacyCountry.errors));
const importCountry = normalizeClientFields({ ...formLike, countryCode: "ZZ" });
check("import path rejects that same unknown country", importCountry.errors.some((e) => e.includes("not a country")));
check("form path still requires a name", normalizeClientFields({ name: "" }, { strictCountry: false }).errors.length === 1);

await pool.end();
let ok = true;
for (const [cond, name, extra] of results) { if (!cond) ok = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(ok ? "\nCLIENT IMPORT VERIFICATION PASS" : "\nCLIENT IMPORT VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
