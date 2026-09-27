/**
 * The nine-document PDF matrix, factored out so the real-provider harness and the local suite
 * assert the same things rather than drifting into two implementations of "the PDFs are fine".
 *
 * Its distinguishing check is the one Batch 2 could not make: the branding images are asked for
 * their decoded dimensions IN THE BROWSER, so a broken-image placeholder cannot pass as a logo.
 */
import type { Browser } from "playwright";
import type { Client } from "pg";
import { PDFDocument } from "pdf-lib";
import { inflateSync } from "node:zlib";

export type PdfFinding = { name: string; passed: boolean; detail: string };

const AR_CUST = "شركة الخليج للمعارض";
const AR_DESC = "تصميم وتنفيذ جناح المعرض";

function glyphOps(buf: ArrayBuffer): number {
  const raw = Buffer.from(buf).toString("latin1");
  let n = 0;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const st = m.index + m[0].length;
    const en = raw.indexOf("endstream", st);
    if (en < 0) continue;
    try { n += (inflateSync(Buffer.from(raw.slice(st, en), "latin1")).toString("latin1").match(/\bT[jJ]\b/g) || []).length; } catch { /* not flate */ }
  }
  return n;
}

export async function runPdfMatrix(opts: {
  base: string; cookie: string; orgId: number; db: Client; browser: Browser; seal: string; sig: string;
}): Promise<{ findings: PdfFinding[] }> {
  const { base, cookie, orgId, db, browser, seal, sig } = opts;
  const findings: PdfFinding[] = [];
  const one = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0];

  const uid = Number((await one("select id from users where org_id=$1 order by id limit 1", [orgId])).id);
  const cust = Number((await one("insert into customers (org_id,name) values ($1,$2) returning id", [orgId, AR_CUST])).id);
  const vend = Number((await one("insert into vendors (org_id,name) values ($1,'Batch3 Supply Co') returning id", [orgId])).id);
  const gl = Number((await one("select id from accounts where org_id=$1 and code like '11%' order by code limit 1", [orgId])).id);
  const bank = Number((await one("insert into bank_accounts (org_id,name,bank_name,iban,currency,gl_account_id) values ($1,'Main','Al Rajhi','SA0380000000608010167519','SAR',$2) returning id", [orgId, gl])).id);
  const terms = JSON.stringify([{ text: "Payment within 30 days", groupId: null, groupName: null }]);
  const banks = JSON.stringify([{ id: null, name: "Al Rajhi Operating", iban: "SA0380000000608010167519" }]);
  const S = `B3-${Date.now()}`;

  const quo = await one(`insert into quotations (org_id,quotation_number,title,customer_id,status,issue_date,valid_until,subtotal,discount,tax_total,total,notes,terms,bank_accounts,currency,seal_url,signature_url,created_by_id) values ($1,$2,'Booth',$3,'accepted','2026-01-01','2026-01-15','1000','0','150','1150','N',$4,$5,'SAR',$6,$7,$8) returning id`, [orgId, `QTN-${S}`, cust, terms, banks, seal, sig, uid]);
  await db.query(`insert into quotation_items (quotation_id,description,quantity,unit_price,tax_rate_percent,line_total,unit) values ($1,$2,'2','500','15','1000','pcs')`, [quo.id, AR_DESC]);
  const so = await one(`insert into sales_orders (org_id,so_number,title,customer_id,status,issue_date,expected_date,subtotal,discount,tax_total,total,notes,terms,bank_accounts,currency,seal_url,signature_url,created_by_id) values ($1,$2,'Booth',$3,'confirmed','2026-01-02','2026-01-20','1000','0','150','1150','N',$4,$5,'SAR',$6,$7,$8) returning id`, [orgId, `SO-${S}`, cust, terms, banks, seal, sig, uid]);
  await db.query(`insert into sales_order_items (sales_order_id,description,quantity,unit_price,tax_rate_percent,line_total,unit) values ($1,$2,'2','500','15','1000','pcs')`, [so.id, AR_DESC]);
  const pf = await one(`insert into proforma_invoices (org_id,proforma_number,title,customer_id,status,issue_date,subtotal,discount,tax_total,total,notes,terms,bank_accounts,currency,seal_url,signature_url,created_by_id) values ($1,$2,'Booth',$3,'sent','2026-01-03','1000','0','150','1150','N',$4,$5,'SAR',$6,$7,$8) returning id`, [orgId, `PF-${S}`, cust, terms, banks, seal, sig, uid]);
  await db.query(`insert into proforma_invoice_items (proforma_invoice_id,description,quantity,unit_price,tax_rate_percent,line_total,unit) values ($1,$2,'2','500','15','1000','pcs')`, [pf.id, AR_DESC]);
  const inv = await one(`insert into sales_invoices (org_id,invoice_number,title,customer_id,status,issue_date,due_date,subtotal,discount,tax_total,total,paid_amount,notes,terms,bank_accounts,currency,created_by_id,qr_code_data,invoice_hash,previous_invoice_hash,seal_url,signature_url) values ($1,$2,'Booth',$3,'sent','2026-01-04','2026-02-04','20000','0','3000','23000','0','N',$4,$5,'SAR',$6,'QRDATA','H1','H0',$7,$8) returning id`, [orgId, `INV-${S}`, cust, terms, banks, uid, seal, sig]);
  for (let i = 0; i < 40; i++) await db.query(`insert into sales_invoice_items (invoice_id,description,quantity,unit_price,tax_rate_percent,line_total) values ($1,$2,'1','500','15','500')`, [inv.id, i % 2 ? `${AR_DESC} ${i}` : `Stand build ${i}`]);
  const dc = await one(`insert into delivery_challans (org_id,dc_number,title,customer_id,status,dispatch_date,carrier,vehicle_no,notes,terms,bank_accounts,currency,seal_url,signature_url,created_by_id) values ($1,$2,'Booth',$3,'delivered','2026-01-05','Aramex','ABC-1','N',$4,$5,'SAR',$6,$7,$8) returning id`, [orgId, `DC-${S}`, cust, terms, banks, seal, sig, uid]);
  await db.query(`insert into delivery_challan_items (delivery_challan_id,description,quantity,unit) values ($1,$2,'2','pcs')`, [dc.id, AR_DESC]);
  const cn = await one(`insert into credit_notes (org_id,credit_note_number,title,customer_id,source_invoice_id,reason,status,issue_date,subtotal,discount,tax_total,total,terms,bank_accounts,currency,seal_url,signature_url,created_by_id) values ($1,$2,'Credit',$3,$4,'Returned','issued','2026-01-06','100','0','15','115',$5,$6,'SAR',$7,$8,$9) returning id`, [orgId, `CN-${S}`, cust, inv.id, terms, banks, seal, sig, uid]);
  await db.query(`insert into credit_note_items (credit_note_id,description,quantity,unit_price,tax_rate_percent,line_total,unit) values ($1,$2,'1','100','15','100','pcs')`, [cn.id, AR_DESC]);
  const po = await one(`insert into purchase_orders (org_id,po_number,title,vendor_id,status,order_date,expected_date,subtotal,discount,tax_total,total,paid_amount,notes,terms,bank_accounts,currency,created_by_id,seal_url,signature_url) values ($1,$2,'Steel',$3,'ordered','2026-01-07','2026-01-17','5000','0','750','5750','0','N',$4,$5,'SAR',$6,$7,$8) returning id`, [orgId, `PO-${S}`, vend, terms, banks, uid, seal, sig]);
  await db.query(`insert into purchase_order_items (purchase_order_id,description,quantity,unit_cost,tax_rate_percent,line_total) values ($1,'Steel coil','10','500','15','5000')`, [po.id]);
  const dn = await one(`insert into debit_notes (org_id,debit_note_number,title,vendor_id,source_purchase_order_id,reason,status,issue_date,subtotal,discount,tax_total,total,terms,bank_accounts,currency,seal_url,signature_url,created_by_id) values ($1,$2,'Debit',$3,$4,'Short','issued','2026-01-08','200','0','30','230',$5,$6,'SAR',$7,$8,$9) returning id`, [orgId, `DN-${S}`, vend, po.id, terms, banks, seal, sig, uid]);
  await db.query(`insert into debit_note_items (debit_note_id,description,quantity,unit_cost,tax_rate_percent,line_total,unit) values ($1,'Steel coil','1','200','15','200','pcs')`, [dn.id]);
  const pay = await one(`insert into payments (org_id,direction,bank_account_id,amount,currency,payment_date,method,reference,sales_invoice_id,notes,created_by_id) values ($1,'in',$2,'1150','SAR','2026-01-09','bank_transfer','REF-1',$3,'N',$4) returning id`, [orgId, bank, inv.id, uid]);

  const TARGETS: [string, number, number][] = [
    ["invoice", inv.id, 3], ["quotation", quo.id, 1], ["sales-order", so.id, 1], ["proforma", pf.id, 1],
    ["delivery-challan", dc.id, 1], ["credit-note", cn.id, 1], ["purchase-order", po.id, 1],
    ["debit-note", dn.id, 1], ["payment", pay.id, 1],
  ];

  let allOk = true, allPages = true, allNonBlank = true;
  for (const [type, id, expectPages] of TARGETS) {
    const res = await fetch(`${base}/api/document-pdf/${type}/${id}`, { headers: { cookie } });
    const ab = await res.arrayBuffer();
    if (res.status !== 200) { allOk = false; findings.push({ name: `${type}: PDF generated`, passed: false, detail: `status=${res.status}` }); continue; }
    const doc = await PDFDocument.load(ab, { updateMetadata: false });
    if (doc.getPageCount() !== expectPages) { allPages = false; findings.push({ name: `${type}: page count`, passed: false, detail: `expected ${expectPages}, got ${doc.getPageCount()}` }); }
    if (ab.byteLength < 1000 || glyphOps(ab) === 0) { allNonBlank = false; findings.push({ name: `${type}: not blank`, passed: false, detail: `${ab.byteLength} bytes, ${glyphOps(ab)} glyph ops` }); }
  }
  findings.push({ name: "all 9 document types generate a PDF (no timeout, no launch failure)", passed: allOk, detail: "" });
  findings.push({ name: "page counts unchanged — the 40-line invoice still paginates to 3", passed: allPages, detail: "" });
  findings.push({ name: "no PDF is blank", passed: allNonBlank, detail: "" });

  // The decisive branding check, asked of the browser rather than inferred from the PDF.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setExtraHTTPHeaders({ cookie });
  await page.goto(`${base}/print/invoice/${inv.id}`, { waitUntil: "networkidle" });
  const imgs = await page.evaluate(() => Array.from(document.querySelectorAll("img")).map((i) => ({ src: i.getAttribute("src") || "", w: i.naturalWidth, h: i.naturalHeight })));
  const uploadImgs = imgs.filter((i) => i.src.startsWith("/uploads/"));
  findings.push({ name: "branding is pulled through /uploads/, not a provider URL", passed: uploadImgs.length >= 3, detail: JSON.stringify(imgs.map((i) => i.src)) });
  findings.push({ name: "logo, seal and signature all DECODED (naturalWidth > 0)", passed: uploadImgs.length > 0 && uploadImgs.every((i) => i.w > 0 && i.h > 0), detail: JSON.stringify(uploadImgs) });
  findings.push({ name: "no image points at a blob provider host", passed: imgs.every((i) => !i.src.includes("blob.vercel-storage.com")), detail: "" });
  const txt = await page.locator("body").innerText();
  findings.push({ name: "Arabic party name and line description render (RTL)", passed: txt.includes(AR_CUST) && txt.includes(AR_DESC), detail: "" });
  findings.push({ name: "bank details render", passed: txt.includes("SA0380000000608010167519"), detail: "" });
  const stmt = await fetch(`${base}/finance/statements/export?kind=client&party=${cust}&format=pdf`, { headers: { cookie } });
  findings.push({ name: "the statement PDF (pdf-lib, no Chromium) renders", passed: stmt.status === 200, detail: `status=${stmt.status}` });
  await ctx.close();
  return { findings };
}
