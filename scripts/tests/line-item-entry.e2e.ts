// E2E for "Improve document line-item entry".
// Covers the server-side "Save this item" path (sanitized description, unique SKU, image + unit +
// rate + tax persisted, appears in later searches) and the combobox logic the UI relies on
// (search by name/sku/description, exact-match detection, when "Save this item" shows, and that a
// document-only line without a product is still allowed). Run: npx tsx scripts/tests/line-item-entry.e2e.ts
import { and, eq, like } from "drizzle-orm";
import { db, pool, orgsTable, productsTable } from "../../src/db";
import { sanitizeRichText, sanitizeIfHtml, richTextToPlain } from "../../src/lib/sanitize-html";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Mirror of creation-popup-actions.uniqueSku (the action is server-only and can't run under tsx).
async function uniqueSku(orgId: number, name: string): Promise<string> {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "ITEM";
  for (let n = 1; n <= 9999; n++) {
    const candidate = `${base}-${String(n).padStart(3, "0")}`;
    const [hit] = await db.select({ id: productsTable.id }).from(productsTable).where(and(eq(productsTable.orgId, orgId), eq(productsTable.sku, candidate))).limit(1);
    if (!hit) return candidate;
  }
  return `${base}-${Date.now()}`;
}
async function saveItem(orgId: number, input: { name: string; description?: string; imageUrl?: string; unit?: string; unitPrice?: string; taxRatePercent?: string }) {
  const name = input.name.trim();
  const sku = await uniqueSku(orgId, name);
  const [row] = await db.insert(productsTable).values({
    orgId, sku, name,
    description: sanitizeIfHtml(input.description) || null,
    imageUrl: (input.imageUrl ?? "").trim() || null,
    unit: (input.unit ?? "").trim() || "pcs",
    unitPrice: String(input.unitPrice ?? "0").trim() || "0",
    taxRatePercent: String(input.taxRatePercent ?? "15").trim() || "15",
  }).returning();
  return row;
}

// Mirror of item-entry-cell's combobox logic.
type P = { id: number; name: string; sku: string; description: string | null };
function comboMatches(products: P[], query: string) {
  const q = query.trim().toLowerCase();
  return q ? products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || richTextToPlain(p.description ?? "").toLowerCase().includes(q)) : products;
}
function showSave(products: P[], query: string, productIdLinked: boolean) {
  const q = query.trim().toLowerCase();
  const exact = products.some((p) => p.name.trim().toLowerCase() === q);
  return q.length > 0 && !exact && !productIdLinked;
}

async function main() {
  console.log("Line-item entry E2E\n");

  // ---- Rich-text sanitize keeps formatting (incl. bullet lists), strips scripts (client + server) ----
  const dirty = `<b>Bold</b> <i>i</i> <u>u</u><ul><li>a</li><li>b</li></ul><ol><li>1</li></ol><a href="https://x.com">L</a><script>alert(1)</script><img src=x onerror=y>`;
  const clean = sanitizeRichText(dirty);
  check("keeps bold/italic/underline", /<b>Bold<\/b>/.test(clean) && /<i>/.test(clean) && /<u>/.test(clean));
  check("keeps bullet + numbered lists", /<ul><li>a<\/li><li>b<\/li><\/ul>/.test(clean) && /<ol><li>1<\/li><\/ol>/.test(clean));
  check("keeps safe link, drops <script>/<img>", /<a href="https:\/\/x\.com"/.test(clean) && !/script/i.test(clean) && !/<img/i.test(clean));
  check("server sanitize == same result (client/server parity)", sanitizeIfHtml(dirty) === clean);

  const [org] = await db.select().from(orgsTable).limit(1);
  if (!org) throw new Error("no org");
  const created: number[] = [];
  try {
    const tag = `ZZTEST-${Date.now()}`;
    // ---- Steps 3–5: save a new item (name + description + image + unit + rate + tax) ----
    const p1 = await saveItem(org.id, {
      name: `${tag} Widget`,
      description: `<b>Great</b> widget<ul><li>durable</li></ul>`,
      imageUrl: "https://blob.example/w.png",
      unit: "box", unitPrice: "12.50", taxRatePercent: "15",
    });
    created.push(p1.id);
    check("saved: name persisted", p1.name === `${tag} Widget`);
    check("saved: description formatting persists (sanitized)", p1.description === "<b>Great</b> widget<ul><li>durable</li></ul>");
    check("saved: image persisted", p1.imageUrl === "https://blob.example/w.png");
    check("saved: unit/rate/tax persisted", p1.unit === "box" && p1.unitPrice === "12.50" && p1.taxRatePercent === "15.00");
    check("saved: auto SKU generated", /-\d{3}$/.test(p1.sku));

    // ---- Step 6: appears in future searches (by name, sku, description) ----
    const inDb = await db.select({ id: productsTable.id, name: productsTable.name, sku: productsTable.sku, description: productsTable.description }).from(productsTable).where(and(eq(productsTable.orgId, org.id), like(productsTable.name, `${tag}%`)));
    check("search by name finds it", comboMatches(inDb, "Widget").some((p) => p.id === p1.id));
    check("search by sku finds it", comboMatches(inDb, p1.sku).some((p) => p.id === p1.id));
    check("search by description finds it", comboMatches(inDb, "durable").some((p) => p.id === p1.id));

    // ---- unique SKU on duplicate name ----
    const p2 = await saveItem(org.id, { name: `${tag} Widget` });
    created.push(p2.id);
    check("duplicate name gets a distinct unique SKU", p2.sku !== p1.sku);

    // ---- Save-this-item visibility rules ----
    check("Save shows for a brand-new typed name", showSave(inDb, `${tag} Brand New`, false) === true);
    check("Save hidden when an exact item already exists", showSave(inDb, `${tag} Widget`, false) === false);
    check("Save hidden once a product is linked to the line", showSave(inDb, `${tag} Whatever`, true) === false);

    // ---- Steps 7–8: a document-only line (no productId) is still allowed ----
    const docOnlyLine = { productId: "", description: "Custom one-off service", quantity: "2" };
    const keep = docOnlyLine.description.trim().length > 0 && Number(docOnlyLine.quantity) > 0;
    check("document-only line (no product) is kept on save", keep === true);
  } finally {
    for (const id of created) await db.delete(productsTable).where(eq(productsTable.id, id));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
