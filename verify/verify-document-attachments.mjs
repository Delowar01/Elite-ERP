/**
 * Document attachments must survive a save.
 *
 * Drives the REAL createInvoiceAction / updateInvoiceAction over the wire with a genuine owner
 * session (Next-Action replay, no page in between) and asserts against the real document_attachments
 * rows. Only the Blob upload itself is synthesised: uploadDocumentAttachmentAction needs a live
 * Vercel Blob store, so the fixture supplies the exact string storeBlob() returns —
 * /uploads/organizations/{orgId}/attachments/{orgId}-{ts}-{16 hex}.{ext} — which is what the client
 * holds in form state and posts back on save.
 */
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { loadActionIds } from "./action-id.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `attach${Date.now()}@example.com`;

const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

const idFor = await loadActionIds();
const createId = idFor("createInvoiceAction");
const updateId = idFor("updateInvoiceAction");
check("found the Next-Action ids for create/update invoice", !!createId && !!updateId, `${createId} / ${updateId}`);

await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Attachment Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 30000 });

const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];

const org = (await one("select org_id from users where email=$1", [email])).org_id;
const cust = (await one("insert into customers (org_id,name) values ($1,'Attachment Client') returning id", [org])).id;

// Exactly what storeBlob() returns for folder "attachments".
const blobPath = (n) => `/uploads/organizations/${org}/attachments/${org}-${Date.now()}${n}-0123456789abcdef.pdf`;
const att = (n, name) => ({ fileName: name, fileUrl: blobPath(n), contentType: "application/pdf", sizeBytes: 2048 });

async function invoke(actionId, args, referer = "/sales/invoices/new") {
  const res = await fetch(`${BASE}${referer}`, {
    method: "POST",
    headers: { "Next-Action": actionId, "Content-Type": "text/plain;charset=UTF-8", cookie, referer: `${BASE}${referer}` },
    body: JSON.stringify(args),
  });
  return res;
}

const baseInput = (title, attachments) => ({
  title, customerId: String(cust), issueDate: "2026-01-10", dueDate: "2026-02-10",
  discount: "0", notes: "", terms: [], items: [{ description: "Stand build", quantity: "1", unitPrice: "1000", taxRatePercent: "15" }],
  attachments, bankAccountIds: [], currency: "SAR",
});

const attCount = async (docId) =>
  Number((await one("select count(*)::int as c from document_attachments where org_id=$1 and document_type='sales_invoice' and document_id=$2", [org, docId])).c);
const latestInvoice = async () => (await one("select id from sales_invoices where org_id=$1 order by id desc limit 1", [org]))?.id ?? null;

// ---- 1. create WITHOUT attachments -> 0 rows (control: the assertion can be satisfied) ----
await invoke(createId, [baseInput("No attachments", [])]);
const inv0 = await latestInvoice();
check("control: an invoice saved with no attachments has 0 attachment rows", (await attCount(inv0)) === 0, String(await attCount(inv0)));

// ---- 2. create WITH one attachment -> must be 1 ----
const a1 = att(1, "contract.pdf");
await invoke(createId, [baseInput("One attachment", [a1])]);
const inv1 = await latestInvoice();
check("an invoice created with 1 attachment persists 1 attachment row", (await attCount(inv1)) === 1, `got ${await attCount(inv1)} for invoice ${inv1}`);

// ---- 3. the stored row round-trips the values the client sent ----
const row = await one("select file_name, file_url, content_type, size_bytes from document_attachments where org_id=$1 and document_id=$2", [org, inv1]);
check("the persisted row keeps the file name the client sent", row?.file_name === "contract.pdf", String(row?.file_name));
check("the persisted row keeps the storeBlob path the client sent", row?.file_url === a1.fileUrl, String(row?.file_url));
check("the persisted row keeps content type and size", row?.content_type === "application/pdf" && Number(row?.size_bytes) === 2048, `${row?.content_type} / ${row?.size_bytes}`);

// ---- 4. create with MULTIPLE attachments -> all persist ----
await invoke(createId, [baseInput("Three attachments", [att(2, "a.pdf"), att(3, "b.pdf"), att(4, "c.pdf")])]);
const inv3 = await latestInvoice();
check("an invoice created with 3 attachments persists all 3", (await attCount(inv3)) === 3, `got ${await attCount(inv3)}`);

// ---- 5. an existing attachment survives an UNRELATED edit (form state starts empty on edit) ----
const before5 = await attCount(inv1);
await invoke(updateId, [inv1, baseInput("One attachment RENAMED", [])], `/sales/invoices/${inv1}/edit`);
const after5 = await attCount(inv1);
const title5 = (await one("select title from sales_invoices where id=$1", [inv1]))?.title;
check("the unrelated edit actually took effect", title5 === "One attachment RENAMED", String(title5));
check("an existing attachment survives an unrelated edit", before5 === 1 && after5 === 1, `${before5} -> ${after5}`);

// ---- 6. adding a new attachment on edit preserves the existing one ----
await invoke(updateId, [inv1, baseInput("One attachment RENAMED", [att(5, "added-later.pdf")])], `/sales/invoices/${inv1}/edit`);
const after6 = await attCount(inv1);
check("adding an attachment on edit preserves the existing one (1 -> 2)", after6 === 2, `got ${after6}`);

// ---- 7. repeated saves do not duplicate ----
await invoke(updateId, [inv1, baseInput("One attachment RENAMED", [])], `/sales/invoices/${inv1}/edit`);
await invoke(updateId, [inv1, baseInput("One attachment RENAMED", [])], `/sales/invoices/${inv1}/edit`);
const after7 = await attCount(inv1);
check("two further saves add nothing (no duplication)", after7 === 2, `got ${after7}`);

// ---- 8. a path pointing at ANOTHER org's attachments folder is refused ----
const foreign = { fileName: "foreign.pdf", fileUrl: `/uploads/organizations/${org + 9999}/attachments/${org + 9999}-1789000000000-0123456789abcdef.pdf`, contentType: "application/pdf", sizeBytes: 10 };
await invoke(createId, [baseInput("Foreign path", [foreign])]);
const invF = await latestInvoice();
check("a path under another organization's folder is refused", (await attCount(invF)) === 0, `got ${await attCount(invF)}`);

// ---- 9. a hand-written filename under the correct prefix is refused ----
const forged = { fileName: "forged.pdf", fileUrl: `/uploads/organizations/${org}/attachments/../../../etc/passwd`, contentType: "application/pdf", sizeBytes: 10 };
const forged2 = { fileName: "forged2.pdf", fileUrl: `/uploads/organizations/${org}/attachments/anything.pdf`, contentType: "application/pdf", sizeBytes: 10 };
await invoke(createId, [baseInput("Forged names", [forged, forged2])]);
const invG = await latestInvoice();
check("hand-written filenames under the right prefix are refused", (await attCount(invG)) === 0, `got ${await attCount(invG)}`);

// ---- 10. tenant column is the acting org ----
const orgs = (await db.query("select distinct org_id from document_attachments")).rows.map((r) => r.org_id);
check("every persisted row carries the acting organization", orgs.length === 1 && Number(orgs[0]) === org, JSON.stringify(orgs));

console.log("");
let pass_ = 0, fail_ = 0;
for (const [ok, name, extra] of results) {
  ok ? pass_++ : fail_++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + extra}`);
}
console.log(`\n${pass_}/${pass_ + fail_} checks`);
await browser.close();
await db.end();
process.exit(fail_ ? 1 : 0);
