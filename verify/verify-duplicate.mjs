// Task 2 verification — Duplicate.
//
// Runs against the real database through the real server action, driven by Playwright so the
// session/tenant context is genuine (the action is not callable from Node directly).
import { chromium } from "playwright";
import { Client } from "pg";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `dup_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
ctx.setDefaultTimeout(60000);
ctx.setDefaultNavigationTimeout(90000);
page.on("dialog", (d) => d.accept());

// ---- register an org ----
await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Duplicate Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 30000 });

const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;
const uid = (await db.query("select id from users where email=$1", [email])).rows[0].id;
const cust = (await db.query("insert into customers (org_id,name) values ($1,'ABC Trading') returning id", [org])).rows[0].id;
const vend = (await db.query("insert into vendors (org_id,name) values ($1,'Steel Supply Co') returning id", [org])).rows[0].id;

// A source document per duplicable type, deliberately carrying every field that must copy AND
// every field that must NOT. Statuses are non-draft to prove duplicate works from any live state.
const seedTerms = JSON.stringify([{ text: "Payment within 30 days", groupId: null, groupName: null }]);
const seedBank = JSON.stringify([{ id: null, name: "Al Rajhi Operating", iban: "SA0380000000608010167519" }]);

async function seedDoc(sql, params) { return (await db.query(sql, params)).rows[0]; }

const quo = await seedDoc(
  `insert into quotations (org_id,quotation_number,title,customer_id,status,issue_date,valid_until,subtotal,discount,tax_total,total,notes,terms,bank_accounts,currency,seal_url,signature_url,created_by_id,archived_at)
   values ($1,'QTN-SRC','Booth package',$2,'accepted','2026-01-01','2026-01-15','1000','0','150','1150','Note text',$3,$4,'SAR','/uploads/seal.png','/uploads/sig.png',$5, now()) returning *`,
  [org, cust, seedTerms, seedBank, uid]);
await db.query(`insert into quotation_items (quotation_id,description,quantity,unit_price,tax_rate_percent,line_total,unit,custom_fields)
  values ($1,'Stand build','2','500','15','1000','pcs',$2)`, [quo.id, JSON.stringify({ __desc: "<b>Rich</b> description" })]);
await db.query(`insert into document_attachments (org_id,document_type,document_id,file_name,file_url,uploaded_by_id)
  values ($1,'quotation',$2,'signed.pdf','/uploads/attachments/signed.pdf',$3)`, [org, quo.id, uid]);

const inv = await seedDoc(
  `insert into sales_invoices (org_id,invoice_number,title,customer_id,status,issue_date,due_date,subtotal,discount,tax_total,total,paid_amount,notes,terms,bank_accounts,currency,created_by_id,qr_code_data,invoice_hash,previous_invoice_hash)
   values ($1,'INV-SRC','Booth invoice',$2,'partially_paid','2026-01-01','2026-01-31','1000','0','150','1150','400','N',$3,$4,'SAR',$5,'QRDATA','HASH1','HASH0') returning *`,
  [org, cust, seedTerms, seedBank, uid]);
await db.query(`insert into sales_invoice_items (invoice_id,description,quantity,unit_price,tax_rate_percent,line_total)
  values ($1,'Stand build','2','500','15','1000')`, [inv.id]);

const po = await seedDoc(
  `insert into purchase_orders (org_id,po_number,title,vendor_id,status,order_date,expected_date,subtotal,discount,tax_total,total,paid_amount,notes,terms,bank_accounts,currency,created_by_id)
   values ($1,'PO-SRC','Steel',$2,'received','2026-01-01','2026-01-11','5000','0','750','5750','5750','N',$3,$4,'SAR',$5) returning *`,
  [org, vend, seedTerms, seedBank, uid]);
await db.query(`insert into purchase_order_items (purchase_order_id,description,quantity,unit_cost,tax_rate_percent,line_total)
  values ($1,'Steel coil','10','500','15','5000')`, [po.id]);

// A quotation whose validity window runs BACKWARDS — the guard case.
const bad = await seedDoc(
  `insert into quotations (org_id,quotation_number,title,customer_id,status,issue_date,valid_until,subtotal,discount,tax_total,total,created_by_id)
   values ($1,'QTN-BACKWARDS','Broken dates',$2,'expired','2026-03-01','2026-02-01','100','0','0','100',$3) returning *`,
  [org, cust, uid]);
await db.query(`insert into quotation_items (quotation_id,description,quantity,unit_price,tax_rate_percent,line_total)
  values ($1,'x','1','100','0','100')`, [bad.id]);

const today = new Date().toISOString().slice(0, 10);
const addDays = (from, n) => { const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---- drive Duplicate from the row menu ----
async function duplicateViaUi(listPath, sourceNumber) {
  await page.goto(`${BASE}${listPath}?record=all`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator("table").first().waitFor({ timeout: 60000 });
  const row = page.locator("tr", { hasText: sourceNumber }).first();
  await row.locator("button.row-menu-btn, [aria-haspopup='menu']").last().click();
  await page.waitForTimeout(400);
  const item = page.getByRole("menuitem", { name: "Duplicate", exact: true });
  if ((await item.count()) === 0) return { opened: false };
  await item.click();
  await page.waitForTimeout(500);
  const dlg = page.locator('[role="dialog"]').last();
  const body = await dlg.innerText().catch(() => "");
  await dlg.getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.waitForURL(/\/\d+\/edit$/, { timeout: 25000 }).catch(() => {});
  return { opened: true, body, url: page.url() };
}

// --- Quotation ---
const q = await duplicateViaUi("/sales/quotations", "QTN-SRC");
check("Quotation: Duplicate is offered", q.opened === true);
check("popup warns attachments are not copied", /attachment/i.test(q.body ?? ""), (q.body ?? "").slice(0, 90));
check("lands on the new draft's builder, not the list", /\/sales\/quotations\/\d+\/edit$/.test(q.url ?? ""), q.url);

const qCopy = (await db.query(`select * from quotations where org_id=$1 and id<>$2 order by id desc limit 1`, [org, quo.id])).rows[0];
check("copy is a draft", qCopy.status === "draft", qCopy.status);
check("copy has a NEW sequence number, not source+1", qCopy.quotation_number !== "QTN-SRC" && /^QTN-\d+$/.test(qCopy.quotation_number), qCopy.quotation_number);
check("copy is dated today", iso(qCopy.issue_date) === today, iso(qCopy.issue_date));
check("valid-till preserves the source's 14-day window", iso(qCopy.valid_until) === addDays(today, 14), iso(qCopy.valid_until));
check("terms snapshot copied as-is", JSON.stringify(qCopy.terms) === JSON.stringify(quo.terms));
check("bank-account snapshot copied as-is", JSON.stringify(qCopy.bank_accounts) === JSON.stringify(quo.bank_accounts));
check("seal + signature copied", qCopy.seal_url === quo.seal_url && qCopy.signature_url === quo.signature_url);
check("notes, title, currency copied", qCopy.notes === quo.notes && qCopy.title === quo.title && qCopy.currency === quo.currency);
check("archived source produces an ACTIVE copy", qCopy.archived_at === null && qCopy.deleted_at === null);
check("copy is created by the acting user", qCopy.created_by_id === uid);

const qItems = (await db.query(`select * from quotation_items where quotation_id=$1`, [qCopy.id])).rows;
check("line items copied", qItems.length === 1, `n=${qItems.length}`);
check("long-form line description copied", qItems[0]?.custom_fields?.__desc === "<b>Rich</b> description", JSON.stringify(qItems[0]?.custom_fields));
check("line unit + rate + tax copied", qItems[0]?.unit === "pcs" && qItems[0]?.unit_price === "500.00" && qItems[0]?.tax_rate_percent === "15.00",
  `${qItems[0]?.unit}/${qItems[0]?.unit_price}/${qItems[0]?.tax_rate_percent}`);

const qAtt = (await db.query(`select count(*)::int n from document_attachments where document_type='quotation' and document_id=$1`, [qCopy.id])).rows[0].n;
check("attachments deliberately NOT copied", qAtt === 0, `n=${qAtt}`);

// --- Invoice: money + ZATCA must not carry ---
const i = await duplicateViaUi("/sales/invoices", "INV-SRC");
check("Invoice: Duplicate is offered from partially_paid", i.opened === true);
const iCopy = (await db.query(`select * from sales_invoices where org_id=$1 and id<>$2 order by id desc limit 1`, [org, inv.id])).rows[0];
check("invoice copy is a draft", iCopy.status === "draft", iCopy.status);
check("paid amount resets to zero", Number(iCopy.paid_amount) === 0, iCopy.paid_amount);
check("ZATCA qr/hash/previous-hash all cleared", !iCopy.qr_code_data && !iCopy.invoice_hash && !iCopy.previous_invoice_hash,
  `${iCopy.qr_code_data}/${iCopy.invoice_hash}/${iCopy.previous_invoice_hash}`);
check("due date preserves the source's 30-day window", iso(iCopy.due_date) === addDays(today, 30), iso(iCopy.due_date));
check("no payments follow the copy",
  (await db.query(`select count(*)::int n from payments where sales_invoice_id=$1`, [iCopy.id])).rows[0].n === 0);

// --- Purchase Order: unit COST lines + source links ---
const p = await duplicateViaUi("/purchasing/orders", "PO-SRC");
check("Purchase Order: Duplicate is offered from received", p.opened === true);
const pCopy = (await db.query(`select * from purchase_orders where org_id=$1 and id<>$2 order by id desc limit 1`, [org, po.id])).rows[0];
check("PO copy is a draft with paid amount zero", pCopy.status === "draft" && Number(pCopy.paid_amount) === 0);
check("PO conversion/source links all null",
  !pCopy.source_quotation_id && !pCopy.source_sales_order_id && !pCopy.source_proforma_id && !pCopy.source_invoice_id);
const pItems = (await db.query(`select * from purchase_order_items where purchase_order_id=$1`, [pCopy.id])).rows;
check("PO line copied with unit cost", pItems.length === 1 && pItems[0].unit_cost === "500.00", pItems[0]?.unit_cost);

// --- The backwards-window guard ---
const b = await duplicateViaUi("/sales/quotations", "QTN-BACKWARDS");
check("backwards-dated source can still be duplicated", b.opened === true);
const bCopy = (await db.query(`select * from quotations where org_id=$1 and title='Broken dates' and id<>$2 order by id desc limit 1`, [org, bad.id])).rows[0];
const orgDays = (await db.query(`select default_validity_days d from orgs where id=$1`, [org])).rows[0].d;
check("negative window never yields a past date", !bCopy.valid_until || iso(bCopy.valid_until) >= today, iso(bCopy.valid_until));
check("negative window falls back to the org's validity preset", iso(bCopy.valid_until) === addDays(today, orgDays),
  `${iso(bCopy.valid_until)} vs +${orgDays}d`);

// --- Credit / Debit Notes are excluded entirely ---
const cnInv = (await db.query(`select id from sales_invoices where org_id=$1 order by id limit 1`, [org])).rows[0].id;
const cn = await seedDoc(`insert into credit_notes (org_id,credit_note_number,customer_id,source_invoice_id,status,issue_date,subtotal,discount,tax_total,total,created_by_id)
  values ($1,'CN-SRC',$2,$3,'issued','2026-01-05','100','0','15','115',$4) returning *`, [org, cust, cnInv, uid]);
await page.goto(`${BASE}/sales/credit-notes?record=all`, { waitUntil: "domcontentloaded", timeout: 90000 });
const cnRow = page.locator("tr", { hasText: "CN-SRC" }).first();
await cnRow.locator("button.row-menu-btn, [aria-haspopup='menu']").last().click();
await page.waitForTimeout(400);
check("Credit Note: Duplicate is absent from the menu entirely",
  (await page.getByRole("menuitem", { name: "Duplicate", exact: true }).count()) === 0);
await page.keyboard.press("Escape");

const dnPo = (await db.query(`select id from purchase_orders where org_id=$1 order by id limit 1`, [org])).rows[0].id;
await db.query(`insert into debit_notes (org_id,debit_note_number,vendor_id,source_purchase_order_id,status,issue_date,subtotal,discount,tax_total,total,created_by_id)
  values ($1,'DN-SRC',$2,$3,'issued','2026-01-06','100','0','15','115',$4)`, [org, vend, dnPo, uid]);
await page.goto(`${BASE}/purchasing/debit-notes?record=all`, { waitUntil: "domcontentloaded", timeout: 90000 });
const dnRow = page.locator("tr", { hasText: "DN-SRC" }).first();
await dnRow.locator("button.row-menu-btn, [aria-haspopup='menu']").last().click();
await page.waitForTimeout(400);
check("Debit Note: Duplicate is absent from the menu entirely",
  (await page.getByRole("menuitem", { name: "Duplicate", exact: true }).count()) === 0);
await page.keyboard.press("Escape");

// --- Tenant scoping: proven statically (the action is not addressable from the browser) ---
// Every branch must load its source with an explicit orgId filter, so a foreign id simply does not
// resolve and returns "Document not found." rather than leaking or copying another org's document.
{
  const src = await (await import("node:fs/promises")).readFile("src/app/(app)/_shared/duplicate-actions.ts", "utf8");
  const lookups = src.match(/await db\.select\(\)\.from\((\w+)\)\.where\(and\(eq\(\w+\.id, id\), eq\(\w+\.orgId, orgId\)\)\)/g) ?? [];
  check("all 6 source lookups are org-scoped", lookups.length === 6, `n=${lookups.length}`);
  check("no source lookup is scoped by id alone",
    !/await db\.select\(\)\.from\(\w+\)\.where\(eq\(\w+\.id, id\)\)/.test(src));
  check("the lifecycle rule is re-checked server-side", /evaluate\(docType, status, "duplicate"/.test(src));
  check("the type allow-list is enforced server-side", /if \(!isDuplicableType\(docType\)\) return \{ error/.test(src));
  check("credit_note and debit_note are absent from the duplicable list",
    !/"credit_note"|"debit_note"/.test(src.slice(src.indexOf("DUPLICABLE_TYPES"), src.indexOf("] as const"))));
}

// Nothing this run created may have landed outside this org.
{
  const stray = (await db.query(`select count(*)::int n from quotations where created_by_id=$1 and org_id<>$2`, [uid, org])).rows[0].n;
  check("no document was created outside the acting org", stray === 0, `n=${stray}`);
}

// --- Concurrency: two duplicates of one source must land on distinct numbers ---
const seqBefore = (await db.query(`select next_number from document_sequences where org_id=$1 and document_type='quotation'`, [org])).rows[0].next_number;
const p2 = await ctx.newPage();
const both = await Promise.all([
  duplicateViaUi("/sales/quotations", "QTN-SRC"),
  (async () => {
    await p2.goto(`${BASE}/sales/quotations?record=all`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await p2.locator("table").first().waitFor({ timeout: 60000 });
    const row = p2.locator("tr", { hasText: "QTN-SRC" }).first();
    await row.locator("button.row-menu-btn, [aria-haspopup='menu']").last().click();
    await p2.waitForTimeout(400);
    const it = p2.getByRole("menuitem", { name: "Duplicate", exact: true });
    if (!(await it.count())) return null;
    await it.click();
    await p2.waitForTimeout(400);
    await p2.locator('[role="dialog"]').last().getByRole("button", { name: "Duplicate", exact: true }).click();
    await p2.waitForURL(/\/\d+\/edit$/, { timeout: 25000 }).catch(() => {});
    return p2.url();
  })(),
]);
const nums = (await db.query(
  `select quotation_number from quotations where org_id=$1 and title='Booth package' order by id desc limit 2`, [org])).rows.map(r => r.quotation_number);
check("two concurrent duplicates get DISTINCT numbers", nums.length === 2 && nums[0] !== nums[1], nums.join(" / "));
const seqAfter = (await db.query(`select next_number from document_sequences where org_id=$1 and document_type='quotation'`, [org])).rows[0].next_number;
check("each duplicate consumed exactly one sequence number", seqAfter - seqBefore === 2, `${seqBefore}->${seqAfter}`);
console.log(`DIAG  number gaps are inherent to create too: the sequence advances on write, so an abandoned draft leaves a gap (${nums.join(", ")}).`);

await db.end();
await browser.close();

let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter(r => r[0]).length}/${results.length} checks`);
console.log(ok ? "DUPLICATE VERIFICATION PASS" : "DUPLICATE VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
