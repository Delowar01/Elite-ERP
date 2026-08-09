import { chromium } from "playwright";
import { Pool } from "pg";
import { readFileSync } from "fs";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";
const BASE = "http://localhost:3000";
const DBURL = readFileSync(".env","utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const pool = new Pool({ connectionString: DBURL });
let fail=0; const ok=(n,c)=>{console.log(`${c?"  ✓":"  ✗ FAIL"} ${n}`);if(!c)fail++;};
const uniq=()=>Math.random().toString(36).slice(2,8);
// Refuse to run against a build other than the one on disk — see assert-fresh-build.mjs.
await assertFreshBuild(BASE);

const b=await chromium.launch({executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
const p=await b.newPage({viewport:{width:1360,height:1000}});
const email=`fn_${uniq()}@test.dev`;
await p.goto(`${BASE}/register`,{waitUntil:"networkidle"});
await p.fill("#orgName",`FN Org ${uniq()}`); await p.fill("#name","FN Owner"); await p.fill("#email",email); await p.fill("#password",`Zx9$mQ${uniq()}vK!ray`);
  // Registration requires a country as of FX-1a; the currency follows it.
  await pickCountry(p);
await Promise.all([p.waitForURL(`${BASE}/dashboard`,{timeout:20000}),p.click('button[type="submit"]')]);
const {rows:o}=await pool.query("select org_id from users where email=$1",[email]); const orgId=o[0].org_id;
await pool.query("insert into customers (org_id,name,address) values ($1,$2,$3)",[orgId,"Acme Co","1 King Rd"]);

await p.goto(`${BASE}/sales/quotations/new`,{waitUntil:"networkidle"}); await p.waitForTimeout(500);
// Preview opens the in-page modal
await p.locator(".doc-action-bar").getByRole("button",{name:/Preview/}).click();
await p.waitForTimeout(500);
ok("Preview opens an in-page dialog", (await p.getByRole("dialog").count())>=1);
await p.keyboard.press("Escape"); await p.waitForTimeout(300);

// Fill a minimal quotation and Save as Draft
await p.locator(".party-card-v2").getByRole("button",{name:"To Client"}).click();
await p.getByRole("button",{name:/Acme Co/}).click();
const row=p.locator(".doc-items-table .item-row").first();
await row.getByPlaceholder("Item name").fill("Widget");
const nums=row.locator("input[type=number]");
await nums.nth(1).fill("2"); await nums.nth(2).fill("100");
await p.keyboard.press("Tab"); await p.waitForTimeout(300);
await p.locator(".doc-action-bar").getByRole("button",{name:/^Save as Draft$/}).click();
await p.waitForURL(/\/sales\/quotations\/\d+$/,{timeout:20000});
const id=Number(p.url().match(/\/(\d+)$/)[1]);
const {rows:q}=await pool.query("select status from quotations where id=$1",[id]);
ok("Save as Draft persisted the quotation with status=draft", q[0] && q[0].status==="draft");

await b.close(); await pool.end();
console.log(`\n${fail===0?"ALL PASSED":fail+" FAILED"}`); process.exit(fail===0?0:1);
