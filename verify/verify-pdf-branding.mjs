/**
 * PDFs still render, and their branding assets now come out of PRIVATE storage.
 *
 * Batch 2's PDF pass could not check this: there was no Blob backing locally, so the logo, seal and
 * signature were broken-image placeholders in both the before and after runs and their absence was
 * reported rather than glossed over. With the storage driver those bytes exist, so this asserts
 * what that run could only note as unverified.
 *
 * The chain under test is the real one: Puppeteer loads /print/<type>/<id> forwarding the session
 * cookie, the page's <img src="/uploads/organizations/..."> requests go back through the app's own
 * upload route, that route authenticates to the store and returns the bytes. Nothing anonymous and
 * no provider URL anywhere in it.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { execFileSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { existsIn, anonymousRead } from "./fake-probe.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `pdfbrand${Date.now()}@example.com`;
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

// This suite drives the test storage driver. Run against the real Vercel Blob client it would
// either fail obscurely (no token here) or, worse, write to a real store. Refuse plainly instead.
if (process.env.STORAGE_DRIVER !== "fake") {
  console.error("STORAGE_DRIVER=fake is required for this suite (set it in .env). Refusing to run against real Vercel Blob.");
  process.exit(1);
}

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "PDF Branding Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 30000 });
const cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const org = (await one("select org_id from users where email=$1", [email])).org_id;
const uid = (await one("select id from users where email=$1", [email])).id;

// Branding objects written by the REAL storeBlob(), then pointed at from the org row.
const stored = JSON.parse(execFileSync("npx", ["tsx", "--env-file-if-exists=.env", "--conditions=react-server", "verify/private-storage-writer.mts", String(org)], { encoding: "utf8" }).trim().split("\n").pop());
const logo = stored.logos, seal = stored.seals, sig = stored.signatures;
for (const [label, p] of [["logo", logo], ["seal", seal], ["signature", sig]]) {
  const pn = p.replace(/^\/uploads\//, "");
  check(`${label} asset lives in the PRIVATE destination store and nowhere public`, existsIn("private", pn) && !existsIn("public", pn), p);
  check(`${label} asset is not anonymously fetchable`, anonymousRead("private", pn) === null, p);
}
await db.query("update orgs set logo_url=$1, seal_url=$2, signature_url=$3 where id=$4", [logo, seal, sig, org]);

const AR_CUST = "شركة الخليج للمعارض", AR_DESC = "تصميم وتنفيذ جناح المعرض";
const cust = (await one("insert into customers (org_id,name) values ($1,$2) returning id", [org, AR_CUST])).id;
const vend = (await one("insert into vendors (org_id,name) values ($1,'Steel Supply Co') returning id", [org])).id;
const gl = (await one("select id from accounts where org_id=$1 and code like '11%' order by code limit 1", [org])).id;
const bank = (await one("insert into bank_accounts (org_id,name,bank_name,iban,currency,gl_account_id) values ($1,'Main','Al Rajhi','SA0380000000608010167519','SAR',$2) returning id", [org, gl])).id;
const terms = JSON.stringify([{ text: "Payment within 30 days", groupId: null, groupName: null }]);
const banks = JSON.stringify([{ id: null, name: "Al Rajhi Operating", iban: "SA0380000000608010167519" }]);

const quo = await one(`insert into quotations (org_id,quotation_number,title,customer_id,status,issue_date,valid_until,subtotal,discount,tax_total,total,notes,terms,bank_accounts,currency,seal_url,signature_url,created_by_id) values ($1,'QTN-B3','Booth',$2,'accepted','2026-01-01','2026-01-15','1000','0','150','1150','N',$3,$4,'SAR',$5,$6,$7) returning id`, [org, cust, terms, banks, seal, sig, uid]);
await db.query(`insert into quotation_items (quotation_id,description,quantity,unit_price,tax_rate_percent,line_total,unit) values ($1,$2,'2','500','15','1000','pcs')`, [quo.id, AR_DESC]);
const so = await one(`insert into sales_orders (org_id,so_number,title,customer_id,status,issue_date,expected_date,subtotal,discount,tax_total,total,notes,terms,bank_accounts,currency,seal_url,signature_url,created_by_id) values ($1,'SO-B3','Booth',$2,'confirmed','2026-01-02','2026-01-20','1000','0','150','1150','N',$3,$4,'SAR',$5,$6,$7) returning id`, [org, cust, terms, banks, seal, sig, uid]);
await db.query(`insert into sales_order_items (sales_order_id,description,quantity,unit_price,tax_rate_percent,line_total,unit) values ($1,$2,'2','500','15','1000','pcs')`, [so.id, AR_DESC]);
const pf = await one(`insert into proforma_invoices (org_id,proforma_number,title,customer_id,status,issue_date,subtotal,discount,tax_total,total,notes,terms,bank_accounts,currency,seal_url,signature_url,created_by_id) values ($1,'PF-B3','Booth',$2,'sent','2026-01-03','1000','0','150','1150','N',$3,$4,'SAR',$5,$6,$7) returning id`, [org, cust, terms, banks, seal, sig, uid]);
await db.query(`insert into proforma_invoice_items (proforma_invoice_id,description,quantity,unit_price,tax_rate_percent,line_total,unit) values ($1,$2,'2','500','15','1000','pcs')`, [pf.id, AR_DESC]);
const inv = await one(`insert into sales_invoices (org_id,invoice_number,title,customer_id,status,issue_date,due_date,subtotal,discount,tax_total,total,paid_amount,notes,terms,bank_accounts,currency,created_by_id,qr_code_data,invoice_hash,previous_invoice_hash,seal_url,signature_url) values ($1,'INV-B3','Booth',$2,'sent','2026-01-04','2026-02-04','20000','0','3000','23000','0','N',$3,$4,'SAR',$5,'QRDATA','H1','H0',$6,$7) returning id`, [org, cust, terms, banks, uid, seal, sig]);
for (let i = 0; i < 40; i++) await db.query(`insert into sales_invoice_items (invoice_id,description,quantity,unit_price,tax_rate_percent,line_total) values ($1,$2,'1','500','15','500')`, [inv.id, i % 2 ? `${AR_DESC} ${i}` : `Stand build ${i}`]);
const dc = await one(`insert into delivery_challans (org_id,dc_number,title,customer_id,status,dispatch_date,carrier,vehicle_no,notes,terms,bank_accounts,currency,seal_url,signature_url,created_by_id) values ($1,'DC-B3','Booth',$2,'delivered','2026-01-05','Aramex','ABC-1','N',$3,$4,'SAR',$5,$6,$7) returning id`, [org, cust, terms, banks, seal, sig, uid]);
await db.query(`insert into delivery_challan_items (delivery_challan_id,description,quantity,unit) values ($1,$2,'2','pcs')`, [dc.id, AR_DESC]);
const cn = await one(`insert into credit_notes (org_id,credit_note_number,title,customer_id,source_invoice_id,reason,status,issue_date,subtotal,discount,tax_total,total,terms,bank_accounts,currency,seal_url,signature_url,created_by_id) values ($1,'CN-B3','Credit',$2,$3,'Returned','issued','2026-01-06','100','0','15','115',$4,$5,'SAR',$6,$7,$8) returning id`, [org, cust, inv.id, terms, banks, seal, sig, uid]);
await db.query(`insert into credit_note_items (credit_note_id,description,quantity,unit_price,tax_rate_percent,line_total,unit) values ($1,$2,'1','100','15','100','pcs')`, [cn.id, AR_DESC]);
const po = await one(`insert into purchase_orders (org_id,po_number,title,vendor_id,status,order_date,expected_date,subtotal,discount,tax_total,total,paid_amount,notes,terms,bank_accounts,currency,created_by_id,seal_url,signature_url) values ($1,'PO-B3','Steel',$2,'ordered','2026-01-07','2026-01-17','5000','0','750','5750','0','N',$3,$4,'SAR',$5,$6,$7) returning id`, [org, vend, terms, banks, uid, seal, sig]);
await db.query(`insert into purchase_order_items (purchase_order_id,description,quantity,unit_cost,tax_rate_percent,line_total) values ($1,'Steel coil','10','500','15','5000')`, [po.id]);
const dn = await one(`insert into debit_notes (org_id,debit_note_number,title,vendor_id,source_purchase_order_id,reason,status,issue_date,subtotal,discount,tax_total,total,terms,bank_accounts,currency,seal_url,signature_url,created_by_id) values ($1,'DN-B3','Debit',$2,$3,'Short','issued','2026-01-08','200','0','30','230',$4,$5,'SAR',$6,$7,$8) returning id`, [org, vend, po.id, terms, banks, seal, sig, uid]);
await db.query(`insert into debit_note_items (debit_note_id,description,quantity,unit_cost,tax_rate_percent,line_total,unit) values ($1,'Steel coil','1','200','15','200','pcs')`, [dn.id]);
const pay = await one(`insert into payments (org_id,direction,bank_account_id,amount,currency,payment_date,method,reference,sales_invoice_id,notes,created_by_id) values ($1,'in',$2,'1150','SAR','2026-01-09','bank_transfer','REF-1',$3,'N',$4) returning id`, [org, bank, inv.id, uid]);

const TARGETS = [["invoice", inv.id, 3], ["quotation", quo.id, 1], ["sales-order", so.id, 1], ["proforma", pf.id, 1], ["delivery-challan", dc.id, 1], ["credit-note", cn.id, 1], ["purchase-order", po.id, 1], ["debit-note", dn.id, 1], ["payment", pay.id, 1]];

function glyphOps(buf) {
  const raw = Buffer.from(buf).toString("latin1");
  let n = 0; const re = /stream\r?\n/g; let m;
  while ((m = re.exec(raw))) {
    const st = m.index + m[0].length, en = raw.indexOf("endstream", st);
    if (en < 0) continue;
    try { n += (inflateSync(Buffer.from(raw.slice(st, en), "latin1")).toString("latin1").match(/\bT[jJ]\b/g) || []).length; } catch { /* not flate */ }
  }
  return n;
}

let allOk = true, allPages = true, allNonBlank = true;
for (const [type, id, expectPages] of TARGETS) {
  const res = await fetch(`${BASE}/api/document-pdf/${type}/${id}`, { headers: { cookie: cookieHeader } });
  const ab = await res.arrayBuffer();
  if (res.status !== 200) { allOk = false; check(`${type}: PDF generated`, false, `status=${res.status} ${Buffer.from(ab).toString("utf8").slice(0, 200)}`); continue; }
  const doc = await PDFDocument.load(ab, { updateMetadata: false });
  if (doc.getPageCount() !== expectPages) { allPages = false; check(`${type}: page count`, false, `expected ${expectPages}, got ${doc.getPageCount()}`); }
  if (ab.byteLength < 1000 || glyphOps(ab) === 0) { allNonBlank = false; check(`${type}: not blank`, false, `${ab.byteLength} bytes, ${glyphOps(ab)} glyph ops`); }
}
check("all 9 document types generate a PDF (200, no timeout, no launch failure)", allOk);
check("page counts are unchanged — the 40-line invoice still paginates to 3", allPages);
check("no PDF is blank", allNonBlank);

// The decisive branding check: load the print page the PDF is made from and ask the BROWSER whether
// each image actually decoded. A broken <img> has naturalWidth 0 — which is exactly what Batch 2
// could not rule out.
await page.goto(`${BASE}/print/invoice/${inv.id}`, { waitUntil: "networkidle" });
const imgs = await page.evaluate(() => Array.from(document.querySelectorAll("img")).map((i) => ({ src: i.getAttribute("src") || "", w: i.naturalWidth, h: i.naturalHeight })));
const uploadImgs = imgs.filter((i) => i.src.startsWith("/uploads/"));
check("the print page pulls its branding through /uploads/ (not a provider URL)", uploadImgs.length >= 3, JSON.stringify(imgs.map((i) => i.src)));
check("every branding image decoded — naturalWidth > 0, so none is a broken placeholder", uploadImgs.length > 0 && uploadImgs.every((i) => i.w > 0 && i.h > 0), JSON.stringify(uploadImgs));
check("no image on the print page points at a blob provider host", imgs.every((i) => !i.src.includes("blob.vercel-storage.com")), JSON.stringify(imgs.map((i) => i.src)));
const txt = await page.locator("body").innerText();
check("Arabic party name renders on the print page", txt.includes(AR_CUST));
check("Arabic line description renders on the print page", txt.includes(AR_DESC));

// Statement PDF: pdf-lib, never Chromium — included because the brief asks whether it references
// uploaded branding at all.
const stmt = await fetch(`${BASE}/finance/statements/export?kind=client&party=${cust}&format=pdf`, { headers: { cookie: cookieHeader } });
check("the statement PDF (pdf-lib, no Chromium) still renders", stmt.status === 200, `status=${stmt.status}`);

console.log("");
let pass_ = 0, fail_ = 0;
for (const [ok, name, extra] of results) { ok ? pass_++ : fail_++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + extra}`); }
console.log(`\n${pass_}/${pass_ + fail_} checks`);
await browser.close();
await db.end();
process.exit(fail_ ? 1 : 0);
