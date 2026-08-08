import { chromium } from "playwright";
import { Pool } from "pg";
import { readFileSync } from "fs";
const BASE = "http://localhost:3000";
const DBURL = readFileSync(".env","utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const pool = new Pool({ connectionString: DBURL });
let fail=0; const ok=(n,c)=>{console.log(`${c?"  ✓":"  ✗ FAIL"} ${n}`);if(!c)fail++;};
const uniq=()=>Math.random().toString(36).slice(2,8);
const b=await chromium.launch({executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
const p=await b.newPage({viewport:{width:1360,height:1000}});
const email=`pz_${uniq()}@test.dev`;
await p.goto(`${BASE}/register`,{waitUntil:"networkidle"});
await p.fill("#orgName",`PZ Org ${uniq()}`); await p.fill("#name","PZ"); await p.fill("#email",email); await p.fill("#password",`Zx9$mQ${uniq()}vK!ray`);
await Promise.all([p.waitForURL(`${BASE}/dashboard`,{timeout:20000}),p.click('button[type="submit"]')]);
const {rows:o}=await pool.query("select org_id from users where email=$1",[email]); const orgId=o[0].org_id;
await pool.query("update orgs set country='Saudi Arabia' where id=$1",[orgId]);
await pool.query("insert into customers (org_id,name,address) values ($1,$2,$3)",[orgId,"Acme Co","1 King Rd"]);

console.log("\n== Part 4: Business Settings no longer has moved items ==");
await p.goto(`${BASE}/settings/organization`,{waitUntil:"networkidle"}); await p.waitForTimeout(400);
const navText = await p.locator(".settings-nav, aside, nav").first().innerText().catch(()=> "") ;
const body1 = await p.locator("body").innerText();
ok("Business Settings has NO 'Print Layout'", !body1.includes("Print Layout"));
ok("Business Settings has NO 'Seal & Signature'", !body1.includes("Seal & Signature"));
ok("Business Settings has NO 'Default Terms & Conditions'", !body1.includes("Default Terms & Conditions"));

console.log("\n== Part 1: ZATCA Phase 1 enable + lock ==");
await p.goto(`${BASE}/settings/organization?tab=zatca`,{waitUntil:"networkidle"}); await p.waitForTimeout(500);
ok("ZATCA tab shows Enable button", (await p.getByRole("button",{name:/^Enable ZATCA Phase 1$/}).count())>=1);
ok("No org-facing disable control", (await p.getByRole("button",{name:/Disable/i}).count())===0);
await p.getByRole("button",{name:/^Enable ZATCA Phase 1$/}).first().click();
await p.waitForTimeout(300);
// confirm dialog
ok("Confirmation dialog appears", (await p.getByRole("dialog").count())>=1);
await p.getByRole("dialog").getByRole("button",{name:/^Enable ZATCA Phase 1$/}).click();
await p.waitForTimeout(1200);
const {rows:z}=await pool.query("select zatca_phase1_enabled from orgs where id=$1",[orgId]);
ok("DB: zatca_phase1_enabled = true", z[0].zatca_phase1_enabled === true);
const {rows:al}=await pool.query("select count(*)::int c from audit_logs where org_id=$1 and action='zatca.phase1_enabled'",[orgId]);
ok("Audit log records enabling", al[0].c >= 1);
await p.reload({waitUntil:"networkidle"}); await p.waitForTimeout(500);
const zbody = await p.locator("body").innerText();
ok("Locked state shown after enabling", zbody.includes("Locked"));
ok("No Enable button once enabled", (await p.getByRole("button",{name:/^Enable ZATCA Phase 1$/}).count())===0);
ok("No disable control once enabled", (await p.getByRole("button",{name:/Disable/i}).count())===0);

console.log("\n== Part 2/3: Presets has Print Layout + Seal & Signature ==");
await p.goto(`${BASE}/settings/presets`,{waitUntil:"networkidle"}); await p.waitForTimeout(500);
ok("Presets has 'Print Layout' tab", (await p.getByRole("tab",{name:/Print Layout/}).count())>=1);
ok("Presets has 'Seal & Signature' tab", (await p.getByRole("tab",{name:/Seal & Signature/}).count())>=1);
ok("Presets has 'Terms & Conditions Groups' tab (terms stay here)", (await p.getByRole("tab",{name:/Terms & Conditions Groups/}).count())>=1);

// Print Layout: choose theme + layout + save
await p.getByRole("tab",{name:/Print Layout/}).click(); await p.waitForTimeout(400);
await p.getByRole("button",{name:/^Emerald$/}).click().catch(()=>{});
await p.getByRole("button",{name:/^Save layout$/}).click();
await p.waitForTimeout(900);
const {rows:pl}=await pool.query("select document_color_theme from orgs where id=$1",[orgId]);
ok("Print Layout saved color theme (emerald)", pl[0].document_color_theme==="emerald");

console.log("\n== Part 3: seal snapshot + per-type default + override + unchanged existing ==");
// seed a seal asset + per-doc-type default for quotation
const {rows:a}=await pool.query("insert into seal_signature_assets (org_id,kind,name,url) values ($1,'seal','Main Seal','/uploads/seal-A.png') returning id",[orgId]);
const sealAId=a[0].id;
await pool.query("update orgs set seal_defaults=$1 where id=$2",[JSON.stringify({quotation:{sealAssetId:sealAId,signatureAssetId:null}}),orgId]);

async function makeQuote(overrideNone){
  await p.goto(`${BASE}/sales/quotations/new`,{waitUntil:"networkidle"}); await p.waitForTimeout(500);
  await p.locator(".party-card-v2").getByRole("button",{name:"To Client"}).click();
  await p.getByRole("button",{name:/Acme Co/}).click();
  const row=p.locator(".doc-items-table .item-row").first();
  await row.getByPlaceholder("Item name").fill("Widget");
  const nums=row.locator("input[type=number]"); await nums.nth(1).fill("1"); await nums.nth(2).fill("50");
  await p.keyboard.press("Tab"); await p.waitForTimeout(200);
  if(overrideNone){
    // set the seal picker (first select in seal-sig-grid) to "No seal"
    const sealBox = p.locator(".seal-sig-grid .seal-sig-box").first();
    await sealBox.getByRole("combobox").click().catch(async()=>{ await sealBox.locator("button").first().click(); });
    await p.getByRole("option",{name:/^No seal$/}).click().catch(()=>{});
    await p.waitForTimeout(200);
  }
  await p.locator(".doc-action-bar").getByRole("button",{name:/^Save as Draft$/}).click();
  await p.waitForURL(/\/sales\/quotations\/\d+$/,{timeout:20000});
  return Number(p.url().match(/\/(\d+)$/)[1]);
}
const q1=await makeQuote(false);
const {rows:q1r}=await pool.query("select seal_url from quotations where id=$1",[q1]);
ok("New quotation snapshots per-type default seal (#6)", q1r[0].seal_url==="/uploads/seal-A.png");

// change the preset default → existing quotation must be unchanged (#9)
await pool.query("update seal_signature_assets set url='/uploads/seal-CHANGED.png' where id=$1",[sealAId]);
const {rows:q1r2}=await pool.query("select seal_url from quotations where id=$1",[q1]);
ok("Existing saved quotation keeps its seal snapshot after preset change (#9)", q1r2[0].seal_url==="/uploads/seal-A.png");

const q2=await makeQuote(true);
const {rows:q2r}=await pool.query("select seal_url from quotations where id=$1",[q2]);
ok("Per-document override 'No seal' applies (#7)", q2r[0].seal_url===null);

await b.close(); await pool.end();
console.log(`\n${fail===0?"ALL PASSED":fail+" CHECK(S) FAILED"}`);
process.exit(fail===0?0:1);
