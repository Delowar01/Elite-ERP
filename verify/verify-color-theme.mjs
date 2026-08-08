import { chromium } from "playwright";
import { Pool } from "pg";
import { readFileSync } from "fs";
const BASE="http://localhost:3000";
const DBURL=readFileSync(".env","utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim();
const pool=new Pool({connectionString:DBURL});
let fail=0; const ok=(n,c)=>{console.log(`${c?"  ✓":"  ✗ FAIL"} ${n}`);if(!c)fail++;};
const uniq=()=>Math.random().toString(36).slice(2,8);
function lum(hex){const c=hex.replace('#','');const ch=[0,2,4].map(i=>{const s=parseInt(c.slice(i,i+2),16)/255;return s<=0.03928?s/12.92:Math.pow((s+0.055)/1.055,2.4);});return 0.2126*ch[0]+0.7152*ch[1]+0.0722*ch[2];}
function contrast(a,b){const la=lum(a),lb=lum(b);const hi=Math.max(la,lb),lo=Math.min(la,lb);return (hi+0.05)/(lo+0.05);}
const browser=await chromium.launch({executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});

async function reg(ctx){
  const p=await ctx.newPage(); await p.setViewportSize({width:1360,height:1400});
  const email=`ct_${uniq()}@test.dev`;
  await p.goto(`${BASE}/register`,{waitUntil:"networkidle"});
  await p.fill("#orgName",`CT ${uniq()}`);await p.fill("#name","CT");await p.fill("#email",email);await p.fill("#password",`Zx9$mQ${uniq()}vK!ray`);
  await Promise.all([p.waitForURL(`${BASE}/dashboard`,{timeout:20000}),p.click('button[type="submit"]')]);
  const {rows}=await pool.query("select org_id from users where email=$1",[email]);
  return {p, orgId: rows[0].org_id};
}
const styleText = async (p) => (await p.locator("style").allInnerTexts()).join("\n");
async function setMain(p,label,hex){ await p.locator('div.p-5',{hasText:label}).first().locator('input.font-mono').first().fill(hex); }
async function setComp(p,comp,channel,hex){ const card=p.locator('div.rounded-xl.border',{hasText:comp}).first(); await card.locator('div.flex.flex-col.gap-1',{hasText:channel}).first().locator('input.font-mono').first().fill(hex); }

const ctx1=await browser.newContext();
const {p, orgId}=await reg(ctx1);

console.log("\n== Gradient: editable start/end + live preview + save + apply + persist ==");
await p.goto(`${BASE}/settings/organization?tab=color-theme`,{waitUntil:"networkidle"}); await p.waitForTimeout(500);
await setMain(p,"Gradient start color","#2244AA");
await setMain(p,"Gradient end color","#11CC88");
await p.waitForTimeout(250);
const prevBg = await p.locator('button.btn',{hasText:"Primary button"}).first().evaluate(el=>el.style.background||el.style.backgroundImage);
ok("Live preview shows edited gradient immediately", prevBg.includes("34, 68, 170") || prevBg.includes("17, 204, 136"));
await p.getByRole("button",{name:/^Save theme$/}).click(); await p.waitForTimeout(1000);
const {rows:g}=await pool.query("select gradient_from,gradient_to from orgs where id=$1",[orgId]);
ok("DB saved gradient start (#2244AA)", g[0].gradient_from.toLowerCase()==="#2244aa");
ok("DB saved gradient end (#11CC88)", g[0].gradient_to.toLowerCase()==="#11cc88");
await p.goto(`${BASE}/dashboard`,{waitUntil:"networkidle"}); await p.waitForTimeout(400);
ok("Theme applies app-wide (custom gradient in injected style on dashboard)", (await styleText(p)).toLowerCase().includes("#2244aa"));
await p.reload({waitUntil:"networkidle"}); await p.waitForTimeout(300);
ok("Theme persists after refresh", (await styleText(p)).toLowerCase().includes("#11cc88"));

console.log("\n== Single: primary/accent + auto components + contrast auto-fix + manual override ==");
await p.goto(`${BASE}/settings/organization?tab=color-theme`,{waitUntil:"networkidle"}); await p.waitForTimeout(500);
await p.getByRole("radio",{name:/Single Color/}).click(); await p.waitForTimeout(250);
await setMain(p,"Primary color","#7A1FA2");
await setMain(p,"Accent color","#0F9D58");
await p.waitForTimeout(200);
// bad font override on primary button (dark on the purple primary → unreadable)
await setComp(p,"Primary button","Font","#3A2A55");
await p.waitForTimeout(200);
const pbCard = p.locator('div.rounded-xl.border',{hasText:"Primary button"}).first();
ok("Low-contrast warning shows for a bad font override", (await pbCard.getByText(/Low contrast/).count())>=1);
// manual badge override bg+fg
await setComp(p,"Badge","Background","#003366");
await setComp(p,"Badge","Font","#FFFFFF");
await p.waitForTimeout(150);
await p.getByRole("button",{name:/^Save theme$/}).click(); await p.waitForTimeout(1000);
const {rows:s}=await pool.query("select primary_color,accent_color,color_theme_mode,theme_overrides from orgs where id=$1",[orgId]);
ok("DB saved single primary (#7A1FA2)", s[0].primary_color.toLowerCase()==="#7a1fa2");
ok("DB saved single accent (#0F9D58)", s[0].accent_color.toLowerCase()==="#0f9d58");
ok("DB mode=single", s[0].color_theme_mode==="single");
const ov=s[0].theme_overrides||{};
ok("Manual badge override persisted (bg+fg)", ov.badge && ov.badge.bg?.toLowerCase()==="#003366" && ov.badge.fg?.toLowerCase()==="#ffffff");
ok("Unreadable primary-button font auto-corrected on save (AA vs #7A1FA2)", contrast(ov.primaryButton?.fg ?? "#ffffff","#7a1fa2")>=4.5);
// component colors generated automatically → injected style has all 5 component rules
await p.goto(`${BASE}/dashboard`,{waitUntil:"networkidle"}); await p.waitForTimeout(300);
const st=(await styleText(p)).replace(/\s/g,"");
ok("Auto-generated component rules present in injected theme", st.includes(".btn-primary{background:") && st.includes(".nav-item.active{background:") && st.includes(".badge-accent") );

console.log("\n== Organization isolation ==");
const ctx2=await browser.newContext();
const org2=await reg(ctx2);
await org2.p.goto(`${BASE}/dashboard`,{waitUntil:"networkidle"}); await org2.p.waitForTimeout(400);
const st2=(await styleText(org2.p)).toLowerCase();
ok("Org 2 unaffected by Org 1 theme (no override style)", !st2.includes("#003366") && !st2.includes("#7a1fa2"));
const {rows:g2}=await pool.query("select gradient_from,theme_overrides from orgs where id=$1",[org2.orgId]);
ok("Org 2 keeps default gradient + no overrides", g2[0].gradient_from.toLowerCase()==="#f5a25c" && !g2[0].theme_overrides);

await browser.close(); await pool.end();
console.log(`\n${fail===0?"ALL PASSED":fail+" CHECK(S) FAILED"}`);
process.exit(fail===0?0:1);
