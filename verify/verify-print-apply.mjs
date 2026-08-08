import { chromium } from "playwright";
import { Pool } from "pg";
import { readFileSync } from "fs";
const BASE="http://localhost:3000";
const DBURL=readFileSync(".env","utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const pool=new Pool({connectionString:DBURL});
let fail=0; const ok=(n,c)=>{console.log(`${c?"  ✓":"  ✗ FAIL"} ${n}`);if(!c)fail++;};
const uniq=()=>Math.random().toString(36).slice(2,8);
const b=await chromium.launch({executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
const p=await b.newPage({viewport:{width:1360,height:1200}});
const email=`pa_${uniq()}@test.dev`;
await p.goto(`${BASE}/register`,{waitUntil:"networkidle"});
await p.fill("#orgName",`PA ${uniq()}`);await p.fill("#name","PA");await p.fill("#email",email);await p.fill("#password",`Zx9$mQ${uniq()}vK!ray`);
await Promise.all([p.waitForURL(`${BASE}/dashboard`,{timeout:20000}),p.click('button[type="submit"]')]);
const {rows:o}=await pool.query("select org_id from users where email=$1",[email]); const orgId=o[0].org_id;
await pool.query("insert into customers (org_id,name,address) values ($1,$2,$3)",[orgId,"Acme Co","1 King Rd"]);
// set org print layout: minimal + royal theme + per-type override for quotation=modern
await pool.query("update orgs set print_layout='minimal', document_color_theme='royal', document_layout_overrides=$1 where id=$2",[JSON.stringify({quotation:"modern"}),orgId]);
// create a quotation
await p.goto(`${BASE}/sales/quotations/new`,{waitUntil:"networkidle"});await p.waitForTimeout(500);
await p.locator(".party-card-v2").getByRole("button",{name:"To Client"}).click();
await p.getByRole("button",{name:/Acme Co/}).click();
const row=p.locator(".doc-items-table .item-row").first();
await row.getByPlaceholder("Item name").fill("Widget");
const nums=row.locator("input[type=number]");await nums.nth(1).fill("1");await nums.nth(2).fill("50");
await p.keyboard.press("Tab");await p.waitForTimeout(200);
await p.locator(".doc-action-bar").getByRole("button",{name:/^Save as Draft$/}).click();
await p.waitForURL(/\/sales\/quotations\/\d+$/,{timeout:20000});
const id=Number(p.url().match(/\/(\d+)$/)[1]);
// open print page
await p.goto(`${BASE}/print/quotation/${id}`,{waitUntil:"networkidle"});await p.waitForTimeout(600);
const layout = await p.locator(".a4-page").getAttribute("data-layout");
ok("Print applies per-type layout override (quotation → modern)", layout==="modern");
const accent = await p.locator(".a4-page").evaluate(el=>getComputedStyle(el).getPropertyValue("--doc-accent").trim());
ok("Print applies document color theme (royal #1D4ED8)", accent.toLowerCase()==="#1d4ed8");
const badgeBg = await p.locator(".pdf-badge").evaluate(el=>getComputedStyle(el).backgroundColor).catch(()=> "");
ok("Accent recolors the doc badge", badgeBg.includes("29, 78, 216") || badgeBg.includes("rgb(29"));
await b.close();await pool.end();
console.log(`\n${fail===0?"ALL PASSED":fail+" FAILED"}`);process.exit(fail===0?0:1);
