/**
 * The bank-accounts screen against the ledger — the assertion the defect could survive.
 *
 * The old bank page rendered `Number(ba.openingBalance) + <ledger balance>` for an opening balance
 * that had never been posted anywhere. A value assertion ("the page shows 30,000") would have
 * passed BEFORE and AFTER the fix in any fixture where the column and the ledger agree, which they
 * do whenever the data was created honestly. The number was right for the wrong reason.
 *
 * So the fixture below makes them DISAGREE, deliberately, and requires the page to follow the
 * ledger. Under the old code the card reads 1,029,999; under the fix it reads 30,000. There is no
 * way for the assertion to pass with the addition present.
 *
 * ── On the fixture's unproducible state ──────────────────────────────────────────────────────
 * A bank account whose `opening_balance` column says 999,999 while its ledger says 30,000 is a row
 * the application can no longer create: creation posts the entry from the same figure, and editing
 * the balance afterwards is refused. That normally makes a fixture suspect — the catalogue in
 * verify/README.md names "an impossible generated input" as a way suites lie to themselves.
 *
 * It is justified here, and the reason is the point of the whole check: the LEGACY rows are exactly
 * the ones the application could not produce today, and surviving them is what the code has to do.
 * Every bank account that existed before this repair carries a column the ledger does not agree
 * with, and the backfill's entry is posted from the column at its own date — so a subsequent edit,
 * a partial migration, or a hand-corrected journal leaves precisely this shape in production.
 *
 * DO NOT "fix" this fixture into a consistent state. Making the column agree with the ledger
 * disarms the assertion completely: it would then pass with the double-count restored.
 */
import { chromium } from "playwright";
import { Pool } from "pg";
import { readFileSync } from "fs";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const DBURL = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim();
const db = new Pool({ connectionString: DBURL });
let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${n}${extra ? `  << ${extra}` : ""}`); if (!c) fail++; };
const uniq = () => Math.random().toString(36).slice(2, 8);
const mils = (v) => Math.round(Number(v) * 1000);
/** Digits out of rendered money — "30,000" / "SAR 30,000.000" → 30000. */
const num = (s) => Number(String(s).replace(/[^\d.-]/g, "")) || 0;

await assertFreshBuild(BASE);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1360, height: 1100 } });
const email = `bo_${uniq()}@test.dev`;
await p.goto(`${BASE}/register`, { waitUntil: "networkidle" });
await p.fill("#orgName", `BO Org ${uniq()}`); await p.fill("#name", "BO"); await p.fill("#email", email);
await p.fill("#password", `Zx9$mQ${uniq()}vK!ray`);
await pickCountry(p);
await Promise.all([p.waitForURL(`${BASE}/dashboard`, { timeout: 40000 }), p.click('button[type="submit"]')]);

const org = (await db.query("select org_id from users where email=$1", [email])).rows[0].org_id;
const acc = new Map((await db.query("select id, code from accounts where org_id=$1", [org])).rows.map((r) => [r.code, r.id]));
const equity = acc.get("3000");
// A bank GL account that is not the seeded 1000 Cash, so the assertions read one account's balance
// rather than the org's whole cash position.
const bankGl = (await db.query(
  "insert into accounts (org_id,code,name,type,normal_balance,is_system) values ($1,'1010','Al Inma Bank','asset','debit',false) returning id",
  [org])).rows[0].id;

console.log("\n== Creating an account with an opening balance POSTS an entry ==");
await p.goto(`${BASE}/finance/bank-accounts`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /new account/i }).first().click();
await p.waitForTimeout(600);
const dlg = p.locator('[role="dialog"]').last();
await dlg.locator("#ba-name").fill("Al Inma — Operating");
// The GL select: pick 1010 by its visible label.
await dlg.locator("#ba-gl-account").click();
await p.waitForTimeout(300);
await p.getByRole("option", { name: /1010/ }).first().click();
await dlg.locator("#ba-opening-balance").fill("30000");
await p.waitForTimeout(700); // the contra options load through a server action

ok("the date and contra fields appear only once the amount is non-zero", await dlg.locator("#ba-opening-date").count() === 1);
const preview = await dlg.locator('[data-testid="opening-entry-preview"]').innerText().catch(() => "");
ok("the dialog PREVIEWS the entry it will post", /Dr 1010/.test(preview) && /Cr 3000/.test(preview), preview.slice(0, 120));
ok("…and says it cannot be edited afterwards", /cannot be edited/i.test(preview));

await dlg.locator("#ba-opening-date").fill("2026-07-30");
await dlg.getByRole("button", { name: /^save$/i }).click();
await p.waitForTimeout(2000);

const created = (await db.query("select id, opening_date::text d, opening_contra_account_id c from bank_accounts where org_id=$1 and name like 'Al Inma%'", [org])).rows[0];
ok("the bank account was created", !!created, JSON.stringify(created));
const entry = (await db.query(
  `select e.id, e.entry_date::text dt, e.source_type st, e.source_id sid,
          json_agg(json_build_object('a', l.account_id, 'd', l.debit::text, 'c', l.credit::text) order by l.debit desc) lines
     from journal_entries e join journal_lines l on l.journal_entry_id = e.id
    where e.org_id=$1 and e.source_type='bank_opening' group by e.id`, [org])).rows[0];
ok("an opening entry was POSTED — the money is in the ledger, not only in a column", !!entry, JSON.stringify(entry?.lines));
ok("…keyed (bank_opening, <bank account id>)", !!entry && entry.sid === created.id, `${entry?.sid} vs ${created?.id}`);
ok("…dated the AS-OF date, not the creation date", entry?.dt === "2026-07-30", entry?.dt);
ok("…Dr the bank's GL account 30,000 / Cr Owner's Equity 30,000",
  !!entry && entry.lines.length === 2 && entry.lines[0].a === bankGl && mils(entry.lines[0].d) === 30_000_000
    && entry.lines[1].a === equity && mils(entry.lines[1].c) === 30_000_000, JSON.stringify(entry?.lines));

console.log("\n== A ZERO opening balance posts nothing ==");
await p.goto(`${BASE}/finance/bank-accounts`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: /new account/i }).first().click();
await p.waitForTimeout(600);
const dlg2 = p.locator('[role="dialog"]').last();
await dlg2.locator("#ba-name").fill("Petty Cash");
await dlg2.getByRole("button", { name: /^save$/i }).click();
await p.waitForTimeout(1800);
const zeroCount = (await db.query("select count(*)::int n from journal_entries where org_id=$1 and source_type='bank_opening'", [org])).rows[0].n;
ok("still exactly ONE opening entry — a zero balance is no event, not a rounded-away one", zeroCount === 1, `n=${zeroCount}`);
ok("…and the zero-balance account carries no opening date or contra",
  (await db.query("select count(*)::int n from bank_accounts where org_id=$1 and name='Petty Cash' and opening_date is null and opening_contra_account_id is null", [org])).rows[0].n === 1);

console.log("\n== THE DOUBLE COUNT: a LYING column against a correct ledger ==");
// See the header. This state is deliberately one the app can no longer produce — it is the LEGACY
// shape, and surviving it is the whole job. Do not make these two figures agree.
await db.query("update bank_accounts set opening_balance = '999999.000' where id = $1", [created.id]);
await p.goto(`${BASE}/finance/bank-accounts`, { waitUntil: "networkidle" });
await p.waitForTimeout(600);
const cardText = await p.locator(".card").filter({ hasText: "Al Inma" }).first().innerText();
const shown = num(cardText.split("\n").filter((l) => /[\d,]{3,}/.test(l)).pop() ?? "");
ok("the card shows the LEDGER figure (30,000), not ledger + column (1,029,999)",
  shown === 30000, `showed ${shown} — 1029999 means the render-time addition is back`);

console.log("\n== The same figure on every surface ==");
const glBalance = Number((await db.query(
  `select coalesce(sum(l.debit) - sum(l.credit), 0)::text v from journal_lines l
     join journal_entries e on e.id = l.journal_entry_id
    where e.org_id=$1 and l.account_id=$2`, [org, bankGl])).rows[0].v);
ok("bank page total == the GL account's own ledger balance", shown === glBalance, `${shown} vs ${glBalance}`);

await p.goto(`${BASE}/finance/reports?report=tb&from=2026-01-01&to=2026-12-31`, { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const tb = await p.locator("main").innerText();
const tbRow = tb.split("\n").find((l) => /1010/.test(l)) ?? "";
ok("Trial Balance carries the same 30,000 for 1010", /30,000|30000/.test(tbRow), tbRow.slice(0, 90));
// The TB's own totals must still agree — an unbalanced opening entry would show up here first.
const tbNums = tb.match(/[\d,]+\.\d{2,3}/g) ?? [];
ok("Trial Balance still balances (its debit and credit totals are equal)",
  tbNums.length >= 2 && tbNums[tbNums.length - 1] === tbNums[tbNums.length - 2],
  tbNums.slice(-2).join(" vs "));

await p.goto(`${BASE}/finance/reports?report=bs&from=2026-01-01&to=2026-12-31`, { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const bs = await p.locator("main").innerText();
ok("the Balance Sheet now CONTAINS the opening balance — the old figure appeared on no statement",
  /30,000|30000/.test(bs), bs.split("\n").filter((l) => /1010|Al Inma/i.test(l)).join(" | ").slice(0, 120));
ok("…and equity carries the other side", /Owner|3000/.test(bs));

console.log("\n== Editing a posted opening balance is REFUSED ==");
// Restore the honest column first: the lying value above was for the render assertion, and leaving
// it would make the refusal assertion read against a state it is not about.
await db.query("update bank_accounts set opening_balance = '30000.000' where id = $1", [created.id]);
await p.goto(`${BASE}/finance/bank-accounts`, { waitUntil: "networkidle" });
await p.waitForTimeout(600);
const card = p.locator(".card").filter({ hasText: "Al Inma" }).first();
await card.getByRole("button", { name: /^edit$/i }).first().click();
await p.waitForTimeout(700);
const edlg = p.locator('[role="dialog"]').last();
ok("the edit dialog offers NO opening-balance input", await edlg.locator("#ba-opening-balance").count() === 0);
ok("…and shows the posted entry read-only, from the LEDGER",
  /30,?000/.test(await edlg.locator('[data-testid="opening-readonly"]').innerText().catch(() => "")),
  await edlg.locator('[data-testid="opening-readonly"]').innerText().catch(() => "(absent)"));
ok("…naming the journal entry as the way to correct it",
  /journal entry/i.test(await edlg.innerText()));

// The server is what holds the line; the dialog not rendering the field is only a UI choice. So
// inject the field into the real form and submit it — a genuine invocation of the real action, with
// the real session and a payload the UI cannot produce. Then require the LEDGER to be unmoved:
// an action that returns an error having already written is the failure worth catching.
const before = (await db.query(
  `select coalesce(sum(l.debit),0)::text v from journal_lines l join journal_entries e on e.id=l.journal_entry_id
    where e.org_id=$1 and e.source_type='bank_opening'`, [org])).rows[0].v;
await p.evaluate(() => {
  const form = document.querySelector('[role="dialog"] form');
  const input = document.createElement("input");
  input.type = "hidden"; input.name = "openingBalance"; input.value = "999999";
  form.appendChild(input);
});
await edlg.getByRole("button", { name: /^save$/i }).click();
await p.waitForTimeout(1800);
const toastText = await p.locator("[data-sonner-toast], [role='status']").allInnerTexts().catch(() => []);
ok("the server REFUSES the edit and says why",
  toastText.join(" ").toLowerCase().includes("cannot be edited"), toastText.join(" | ").slice(0, 120));

const after = (await db.query(
  `select coalesce(sum(l.debit),0)::text v from journal_lines l join journal_entries e on e.id=l.journal_entry_id
    where e.org_id=$1 and e.source_type='bank_opening'`, [org])).rows[0].v;
ok("the posted entry is UNMOVED", mils(before) === mils(after), `${before} → ${after}`);
const col = (await db.query("select opening_balance::text v from bank_accounts where id=$1", [created.id])).rows[0].v;
ok("…and the stored audit copy was not rewritten either", mils(col) === 30_000_000, col);
// The refusal must be about the OPENING BALANCE, not a blanket lock on the record — everything else
// on a bank account stays editable, which is the difference between an immutability rule and a bug.
await p.keyboard.press("Escape");
await p.waitForTimeout(400);
await card.getByRole("button", { name: /^edit$/i }).first().click();
await p.waitForTimeout(700);
const edlg2 = p.locator('[role="dialog"]').last();
await edlg2.locator("#ba-branch").fill("Olaya");
await edlg2.getByRole("button", { name: /^save$/i }).click();
await p.waitForTimeout(1800);
ok("…while the rest of the record stays editable",
  (await db.query("select branch from bank_accounts where id=$1", [created.id])).rows[0].branch === "Olaya");

await db.query("delete from journal_lines where journal_entry_id in (select id from journal_entries where org_id=$1)", [org]);
await db.query("delete from journal_entries where org_id=$1", [org]);
await b.close(); await db.end();
console.log(`\n${fail === 0 ? "ALL PASSED" : fail + " CHECK(S) FAILED"}`);
process.exit(fail === 0 ? 0 : 1);
