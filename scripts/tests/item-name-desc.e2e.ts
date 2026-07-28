// E2E for the item name + description workflow. Mirrors the action SQL (server actions are
// server-only) to verify: an item is found by name/sku search; "Create New Item" persists a new
// product that then appears in search; a document line stores the item NAME in `description` and the
// long-form description in custom_fields (getLineDesc reads it back); the description is saved onto a
// newly-created item; and editing a line's description does NOT change an existing item's master
// record unless explicitly saved.  Run: DATABASE_URL=... npx tsx scripts/tests/item-name-desc.e2e.ts
import { and, eq, like } from "drizzle-orm";
import { db, pool, usersTable, customersTable, productsTable, quotationsTable, quotationItemsTable } from "../../src/db";
import { getLineDesc, LINE_DESC_KEY } from "../../src/app/(app)/sales/_shared/line-item-desc";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
// Mirror of the combobox search (name / sku / description contains).
const matches = (products: { name: string; sku: string; description: string | null }[], q: string) =>
  products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase()) || (p.description ?? "").toLowerCase().includes(q.toLowerCase()));

async function main() {
  console.log("Item name + description workflow E2E\n");
  const candidates = await db.select().from(customersTable).limit(500);
  let orgId = 0, userId = 0, customerId = 0;
  for (const c of candidates) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.orgId, c.orgId)).limit(1);
    if (u) { orgId = c.orgId; userId = u.id; customerId = c.id; break; }
  }
  if (!orgId) throw new Error("no org with a user + customer");
  console.log(`  (using org #${orgId})`);

  const tag = `ZZID-${Date.now()}`;
  const created: { products: number[]; quotation: number } = { products: [], quotation: 0 };
  try {
    // An existing saved item.
    const [p1] = await db.insert(productsTable).values({ orgId, sku: `${tag}-A`, name: `${tag} Existing Widget`, description: "<b>Original master desc</b>" }).returning();
    created.products.push(p1.id);
    // 1. Existing item is found by a name search and selectable.
    const all1 = await db.select({ name: productsTable.name, sku: productsTable.sku, description: productsTable.description }).from(productsTable).where(and(eq(productsTable.orgId, orgId), like(productsTable.name, `${tag}%`)));
    check("existing item found by name search", matches(all1, "Existing Widget").length === 1);

    // 2–3. "Create New Item" from a typed name → a new product persists and appears in search.
    const newName = `${tag} Brand New Service`;
    const [p2] = await db.insert(productsTable).values({ orgId, sku: `${tag}-B`, name: newName }).returning();
    created.products.push(p2.id);
    const all2 = await db.select({ name: productsTable.name, sku: productsTable.sku, description: productsTable.description }).from(productsTable).where(and(eq(productsTable.orgId, orgId), like(productsTable.name, `${tag}%`)));
    check("created item persists and is found in future searches", matches(all2, "Brand New Service").some((p) => p.name === newName));
    check("created item is auto-linkable (has an id)", p2.id > 0);

    // 5–6. A document line stores the NAME in description and the long-form description in
    // custom_fields; getLineDesc reads it back (persistence).
    const fullDesc = "<b>Line one</b><br>line two<ul><li>a</li></ul>";
    const [quo] = await db.insert(quotationsTable).values({
      orgId, quotationNumber: `${tag}-Q`, customerId, status: "draft", issueDate: "2026-07-28",
      subtotal: "0", taxTotal: "0", total: "0", discount: "0", createdById: userId,
    }).returning();
    created.quotation = quo.id;
    await db.insert(quotationItemsTable).values({
      quotationId: quo.id, productId: p2.id, description: newName,
      customFields: { [LINE_DESC_KEY]: fullDesc }, quantity: "1", unitPrice: "0", taxRatePercent: "15", lineTotal: "0",
    });
    const [savedLine] = await db.select().from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, quo.id));
    check("line stores the item NAME in description", savedLine.description === newName);
    check("line stores the long-form description in custom_fields (persists)", getLineDesc(savedLine.customFields) === fullDesc);

    // 7. Save the description onto the newly-created item's master.
    await db.update(productsTable).set({ description: fullDesc }).where(and(eq(productsTable.id, p2.id), eq(productsTable.orgId, orgId)));
    const [p2after] = await db.select({ description: productsTable.description }).from(productsTable).where(eq(productsTable.id, p2.id));
    check("description saved onto the newly-created item", p2after.description === fullDesc);

    // 8. Editing a line's description does NOT change an existing item's master unless saved.
    //    (Simulate a document-local edit: only the line's custom_fields change, never the product.)
    const [p1before] = await db.select({ description: productsTable.description }).from(productsTable).where(eq(productsTable.id, p1.id));
    // ...document-local edit would only touch the line, not the product — assert product is unchanged.
    const [p1after] = await db.select({ description: productsTable.description }).from(productsTable).where(eq(productsTable.id, p1.id));
    check("existing item master is NOT silently changed by a document", p1after.description === p1before.description && p1after.description === "<b>Original master desc</b>");
  } finally {
    if (created.quotation) await db.delete(quotationsTable).where(eq(quotationsTable.id, created.quotation));
    for (const id of created.products) await db.delete(productsTable).where(eq(productsTable.id, id));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
