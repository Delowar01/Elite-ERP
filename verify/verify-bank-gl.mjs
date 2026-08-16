/**
 * Bank-account GL mapping: a bank account may not be linked to a control account.
 *
 * The production defect: a bank account was configured with `1100 · Accounts Receivable`, so every
 * receipt debited the AR control account instead of a bank asset — AR Aging read 0 while 1100
 * carried SAR 2,531.25, and the cash-flow report counted AR as cash (it treats whatever account a
 * bank account points at as cash). Production was corrected by hand; this suite covers the code
 * that allowed it.
 *
 * What is asserted, in the order that matters:
 *  - the GL selector OFFERS only eligible accounts (1000 Cash, a user-created 1010 bank asset) and
 *    never a control account (1100/1200/2300/4000) or a non-asset;
 *  - the REFUSAL IS THE SERVER'S — captured real action requests are replayed with a genuine owner
 *    cookie and no page in between, with the glAccountId swapped to a control account. A disabled
 *    dropdown proves nothing; this proves the boundary. The CONTROL is the same captured request
 *    replayed unchanged, which must succeed;
 *  - an UNCHANGED legacy bad mapping still saves (other fields stay editable — the base-currency
 *    lock's rule), while CHANGING to a control account is refused;
 *  - the guarded code list cannot drift: every `byCode.get("NNNN")` in src/ must be accounted for;
 *  - the read-only audit reports a seeded bad mapping and modifies nothing.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const uniq = () => Math.random().toString(36).slice(2, 8);
const results = [];
const check = (name, cond, extra = "") => results.push([cond, name, extra]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
ctx.setDefaultTimeout(45000);
ctx.setDefaultNavigationTimeout(60000);
const page = await ctx.newPage();

// Capture every POST the app makes to the bank-accounts page — these are the real server-action
// requests, replayed verbatim below with one field swapped.
let lastPost = null;
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/finance/bank-accounts")) {
    lastPost = { url: req.url(), headers: { ...req.headers() }, body: req.postData() };
  }
});

const email = `bgl_${uniq()}@t.dev`;
await page.goto(`${BASE}/register`);
await page.fill('input[name="orgName"]', "Bank GL Co");
await page.fill('input[name="name"]', "Owner");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', pass);
const cf = page.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await pickCountry(page);
await page.getByRole("button", { name: /register|create|sign up/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });
const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;

const acct = async (code) => (await db.query("select id from accounts where org_id=$1 and code=$2", [org, code])).rows[0]?.id;
const CASH = await acct("1000"), AR = await acct("1100"), ADV = await acct("2300");
// What production ended up creating by hand — a proper bank asset outside the seeded chart.
const BANKASSET = (await db.query(
  "insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,'1010','Al Inma Bank','asset','debit',false) returning id", [org])).rows[0].id;
// A user-created LIABILITY, to prove the type rule refuses more than just the known control codes.
const LOAN = (await db.query(
  "insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,'2400','Bank Loan','liability','credit',false) returning id", [org])).rows[0].id;

// ================= 1. the selector offers only eligible accounts =================
await page.goto(`${BASE}/finance/bank-accounts`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^New Account$/ }).click();
await page.waitForTimeout(400);
await page.locator("#ba-gl-account").click();
await page.waitForTimeout(300);
const options = (await page.getByRole("option").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
check("the GL selector offers 1000 Cash and the user-created 1010 bank asset",
  options.some((o) => o.startsWith("1000 ")) && options.some((o) => o.startsWith("1010 ")), options.join(" | "));
check("…and NEVER a control account — no 1100 AR, 1200 Inventory, 2300 Advances or 4000 Revenue",
  !options.some((o) => /^(1100|1200|2000|2100|2200|2300|4000|4900|5200) /.test(o)), options.join(" | "));
check("…nor any non-asset account (the user-created 2400 liability is absent too)",
  !options.some((o) => o.startsWith("2400 ")), options.join(" | "));
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// ================= 2. creating with an eligible account works (the rule does not over-refuse) ====
await page.locator("#ba-name").fill("Al Inma — Operating");
await page.locator("#ba-gl-account").click();
await page.waitForTimeout(250);
await page.getByRole("option", { name: /^1010 / }).first().click();
await page.getByRole("button", { name: /^Save$/ }).click();
await page.waitForTimeout(1800);
const created = (await db.query(
  "select id, gl_account_id from bank_accounts where org_id=$1 and name='Al Inma — Operating'", [org])).rows[0];
check("a bank account linked to the user-created 1010 asset saves normally", !!created && created.gl_account_id === BANKASSET,
  JSON.stringify(created ?? null));
const createPost = lastPost;
check("captured the real create request for replay", !!createPost && !!createPost.body);

// ================= 3. the refusal is the SERVER'S — captured requests replayed raw =================
const cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
// Swap the glAccountId field's value inside the captured multipart body. Everything else — action
// id, encoding, every other field — is exactly what the app itself sent. React prefixes a
// client-invoked action's FormData fields with its argument index (`_1_glAccountId`), so the field
// name is matched with that prefix allowed rather than assumed away.
const swapGl = (body, id) => {
  const swapped = body.replace(/(name="(?:[^"]*_)?glAccountId"\r?\n\r?\n)([^\r\n]*)/, (_m, head) => `${head}${id}`);
  if (swapped === body) throw new Error("swapGl matched nothing — the action encoding changed; the replay would be meaningless");
  return swapped;
};
const replay = async (captured, body) => {
  const headers = { ...captured.headers, cookie: cookieHeader };
  delete headers["content-length"]; // recomputed by fetch; a stale one truncates the body
  delete headers.host;
  const res = await fetch(captured.url, { method: "POST", headers, body, redirect: "manual" });
  return { status: res.status, body: (await res.text()).replace(/<!-- -->/g, "").replace(/\s+/g, " ") };
};
const bankCount = async () => (await db.query("select count(*)::int n from bank_accounts where org_id=$1", [org])).rows[0].n;

const beforeCreateReplay = await bankCount();
const rAr = await replay(createPost, swapGl(createPost.body, AR));
check("REPLAY: creating a bank account against 1100 Accounts Receivable is REFUSED by the server — no row created",
  (await bankCount()) === beforeCreateReplay
    && (await db.query("select count(*)::int n from bank_accounts where org_id=$1 and gl_account_id=$2", [org, AR])).rows[0].n === 0,
  `HTTP ${rAr.status}`);
check("…and the server's error NAMES the control account",
  /1100 Accounts Receivable is a control account the system posts to automatically/.test(rAr.body),
  rAr.body.match(/1100 Accounts Receivable[^"<]{0,90}/)?.[0] ?? "(message not found in response)");
const rAdv = await replay(createPost, swapGl(createPost.body, ADV));
check("REPLAY: 2300 Customer Advances is refused the same way",
  (await db.query("select count(*)::int n from bank_accounts where org_id=$1 and gl_account_id=$2", [org, ADV])).rows[0].n === 0
    && /2300 Customer Advances is a control account/.test(rAdv.body),
  rAdv.body.match(/2300 Customer Advances[^"<]{0,60}/)?.[0] ?? "(message not found)");
const rLoan = await replay(createPost, swapGl(createPost.body, LOAN));
check("REPLAY: a non-asset account is refused by the type rule, naming what it is",
  (await db.query("select count(*)::int n from bank_accounts where org_id=$1 and gl_account_id=$2", [org, LOAN])).rows[0].n === 0
    && /2400 Bank Loan is a liability account/.test(rLoan.body),
  rLoan.body.match(/2400 Bank Loan[^"<]{0,60}/)?.[0] ?? "(message not found)");
// CONTROL: the SAME captured request, same cookie, same protocol, eligible account — must succeed,
// or the refusals above would prove nothing but a broken replay.
const rOk = await replay(createPost, swapGl(createPost.body, CASH));
check("CONTROL: the same replayed request with an ELIGIBLE account (1000 Cash) creates the row",
  (await db.query("select count(*)::int n from bank_accounts where org_id=$1 and gl_account_id=$2", [org, CASH])).rows[0].n >= 1,
  `HTTP ${rOk.status}`);

// ================= 4. update: changing TO a control account is refused =================
await page.goto(`${BASE}/finance/bank-accounts`, { waitUntil: "networkidle" });
const inmaCard = page.locator(".card").filter({ hasText: "Al Inma — Operating" }).first();
await inmaCard.waitFor();
await inmaCard.getByLabel("Edit").first().click();
await page.waitForTimeout(500);
await page.locator("#ba-name").fill("Al Inma — Renamed");
await page.getByRole("button", { name: /^Save$/ }).click();
await page.waitForTimeout(1800);
const updatePost = lastPost;
check("captured the real update request for replay", !!updatePost && !!updatePost.body && updatePost.body !== createPost.body);
// The row is taken from the captured request itself — updateBankAccountAction(id, formData) puts
// its first argument in the multipart "0" field (`[<id>,"$K1"]`), so this asserts on exactly the
// account the replay targets rather than on whichever row a name query happens to return.
const targetId = Number(JSON.parse(updatePost.body.match(/name="0"\r?\n\r?\n(\[[^\r\n]*\])/)[1])[0]);
const beforeUpd = (await db.query("select gl_account_id, name from bank_accounts where id=$1", [targetId])).rows[0];
check("the captured update request names a real bank account, currently mapped to the 1010 asset",
  !!beforeUpd && beforeUpd.gl_account_id === BANKASSET, `id=${targetId} ${JSON.stringify(beforeUpd ?? null)}`);
const rUpdAr = await replay(updatePost, swapGl(updatePost.body, AR));
const afterUpd = (await db.query("select gl_account_id, name from bank_accounts where id=$1", [targetId])).rows[0];
check("REPLAY: re-pointing an existing bank account to 1100 is REFUSED — the mapping is untouched",
  afterUpd.gl_account_id === BANKASSET, `gl=${afterUpd.gl_account_id} (AR=${AR}, expected 1010=${BANKASSET})`);
check("…and that refusal names the control account too",
  /1100 Accounts Receivable is a control account/.test(rUpdAr.body),
  rUpdAr.body.match(/1100 Accounts Receivable[^"<]{0,60}/)?.[0] ?? "(message not found)");

// ================= 5. an UNCHANGED legacy bad mapping does not block other edits =================
// Force the shape production had (the app can no longer produce it), then rename through the real
// UI while leaving the mapping alone — that must save, exactly as the base-currency lock lets
// every other field through.
const legacy = (await db.query(
  "insert into bank_accounts (org_id,name,gl_account_id) values ($1,'Legacy Bad Mapping',$2) returning id", [org, AR])).rows[0].id;
await page.goto(`${BASE}/finance/bank-accounts`, { waitUntil: "networkidle" });
const legacyCard = page.locator(".card").filter({ hasText: "Legacy Bad Mapping" }).first();
await legacyCard.waitFor();
await legacyCard.getByLabel("Edit").first().click();
await page.waitForTimeout(500);
const legacySelect = await page.locator("#ba-gl-account").innerText();
check("editing a legacy bad-mapped account still SHOWS its current mapping (1100), not a silent swap",
  /1100/.test(legacySelect), legacySelect.replace(/\s+/g, " "));
await page.locator("#ba-name").fill("Legacy Bad Mapping (renamed)");
await page.getByRole("button", { name: /^Save$/ }).click();
await page.waitForTimeout(1800);
const legacyAfter = (await db.query("select name, gl_account_id from bank_accounts where id=$1", [legacy])).rows[0];
check("…and renaming it SAVES with the mapping unchanged — a legacy row is not frozen out of edits",
  legacyAfter.name === "Legacy Bad Mapping (renamed)" && legacyAfter.gl_account_id === AR, JSON.stringify(legacyAfter));

// ================= 6. the guarded list cannot drift =================
const guardSrc = readFileSync("src/lib/bank-gl-accounts.ts", "utf8");
const guarded = new Set([...guardSrc.matchAll(/^\s*"(\d{4})",/gm)].map((m) => m[1]));
const posted = new Set();
const srcFiles = execSync(`grep -rl 'byCode.get("' src/ --include=*.ts --include=*.tsx`, { encoding: "utf8" }).trim().split("\n");
for (const f of srcFiles) {
  for (const m of readFileSync(f, "utf8").matchAll(/byCode\.get\("(\d{4})"\)/g)) posted.add(m[1]);
}
const undeclared = [...posted].filter((c) => !guarded.has(c));
check(`every structurally-posted code is guarded (found ${[...posted].sort().join(",")})`,
  undeclared.length === 0, undeclared.join(",") || "none");
check("1000 Cash is deliberately NOT guarded — it is the intended bank mapping target",
  !guarded.has("1000") && !posted.has("1000"));

// ================= 7. the read-only audit reports the seeded bad mapping and changes nothing ====
const beforeAudit = JSON.stringify((await db.query(
  "select id, gl_account_id, name from bank_accounts where org_id=$1 order by id", [org])).rows);
const audit = execSync("npx tsx --env-file-if-exists=.env scripts/audit-bank-gl-mappings.ts", { encoding: "utf8" });
check("the audit announces itself read-only and reports the legacy row with its reason",
  /READ-ONLY — nothing is modified/.test(audit)
    && new RegExp(`org ${org}[\\s\\S]*?Legacy Bad Mapping \\(renamed\\)"?\\s*->\\s*1100 Accounts Receivable`).test(audit),
  audit.match(new RegExp(`.*org ${org}.*`))?.[0] ?? "(row not reported)");
check("…and names the blast radius (payments recorded through it + that account's ledger balance)",
  /blast radius: \d+ payment\(s\) recorded through it; that GL account's ledger balance is/.test(audit),
  audit.match(/blast radius:.*/)?.[0] ?? "(no blast radius line)");
const afterAudit = JSON.stringify((await db.query(
  "select id, gl_account_id, name from bank_accounts where org_id=$1 order by id", [org])).rows);
check("…and modified NOTHING — the mappings are byte-identical after the run", beforeAudit === afterAudit);

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "BANK GL PASS" : "BANK GL FAIL");
process.exit(ok ? 0 : 1);
