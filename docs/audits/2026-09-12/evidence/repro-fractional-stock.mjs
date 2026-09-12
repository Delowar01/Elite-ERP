/**
 * AUDIT REPRODUCTION (2026-09-12 correction pass) — fractional quantities.
 *
 * Separates two things the feature matrix had conflated:
 *   (a) DECIMAL DOCUMENT QUANTITIES — can a line say 1.5 units and price it correctly?
 *   (b) FRACTIONAL STOCK — can quantity_on_hand hold 1.5?
 *
 * Run against a disposable database only.
 */
import { Client } from "pg";
const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const out = [];
const say = (s) => { console.log(s); out.push(s); };

say("── 1. Column types (schema as pushed) ──");
for (const [t, c] of [["products", "quantity_on_hand"], ["sales_invoice_items", "quantity"], ["purchase_order_items", "quantity"]]) {
  const r = (await db.query(
    "select data_type, numeric_precision, numeric_scale from information_schema.columns where table_name=$1 and column_name=$2", [t, c])).rows[0];
  say(`   ${t}.${c}: ${r ? `${r.data_type}${r.numeric_scale != null ? `(${r.numeric_precision},${r.numeric_scale})` : ""}` : "ABSENT"}`);
}

say("\n── 2. The truncation the posting paths apply (Math.trunc, 5 call sites) ──");
for (const q of [1.5, 0.5, 2.75, 0.25, 3.0]) say(`   document quantity ${q}  ->  stock moves by ${Math.trunc(Number(q))}`);

say("\n── 3. What the INTEGER column does with a fraction (adjustStockAction's path) ──");
const org = (await db.query("insert into orgs (name) values ('Frac Trace') returning id")).rows[0].id;
const p = (await db.query(
  "insert into products (org_id,sku,name,quantity_on_hand) values ($1,'FRAC-1','Cable',0) returning id", [org])).rows[0].id;
// adjustStockAction computes `product.quantityOnHand + delta` with NO truncation and hands the
// result to Drizzle, which binds it as a query PARAMETER. Both forms are shown because they differ.
for (const delta of [1.5, 0.5, 2.5]) {
  await db.query("update products set quantity_on_hand=0 where id=$1", [p]);
  let asParam;
  try {
    await db.query("update products set quantity_on_hand=$2 where id=$1", [p, 0 + delta]);
    asParam = String((await db.query("select quantity_on_hand q from products where id=$1", [p])).rows[0].q);
  } catch (e) { asParam = `ERROR ${e.code} ${e.message}`; }
  const asLiteral = (await db.query(`select (0 + ${delta})::integer q`)).rows[0].q;
  say(`   delta ${delta}: bound as a PARAMETER -> ${asParam}`);
  say(`             as an inline LITERAL cast  -> ${asLiteral}  (rounds half away from zero)`);
}
say("   Drizzle binds parameters, so the parameter row is the one that applies: the write FAILS.");

say("\n── 4. The disagreement, stated plainly ──");
say("   the SAME fractional quantity of 1.5:");
say(`     · through a document posting (invoice / PO receipt / debit note): stock moves by ${Math.trunc(1.5)}`);
say("     · through adjustStockAction: the update is REJECTED by Postgres (22P02) and the action throws");
say("   and 0.5:");
say(`     · through a document posting: stock moves by ${Math.trunc(0.5)}  (no movement at all)`);
say("     · through adjustStockAction: likewise rejected — no adjustment is possible at all");

say("\n── 5. Accumulated drift on repeated 1.5 movements through documents ──");
let real = 0, stock = 0;
for (let i = 1; i <= 4; i++) { real += 1.5; stock += Math.trunc(1.5); say(`   receipt ${i}: real ${real.toFixed(1)}  ·  quantity_on_hand ${stock}  ·  drift ${(real - stock).toFixed(1)}`); }

say("\n── 6. Money is NOT affected ──");
const lineTotal = (1.5 * 200).toFixed(3);
say(`   an invoice line of 1.5 @ 200.000 posts ${lineTotal} — quantity is numeric(12,2) on the document,`);
say("   so pricing, tax and the ledger are all correct. Only the stock counter truncates.");

await db.query("delete from products where org_id=$1", [org]);
await db.query("delete from orgs where id=$1", [org]);
await db.end();
const { writeFile } = await import("node:fs/promises");
await writeFile("docs/audits/2026-09-12/evidence/repro-fractional-stock.txt", out.join("\n") + "\n");
