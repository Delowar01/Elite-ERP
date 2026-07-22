/**
 * Batch F — LIVE database test for Presets & Settings completion.
 *
 * Mirrors the server actions' SQL against real Postgres (the action modules import server-only
 * and can't be imported into tsx) and asserts:
 *   1. Terms & Conditions Groups: create/edit/delete + "set default" keeps at most one default
 *      per (org, documentType); tenant-scoped.
 *   2. Document content presets loader: returns note templates / terms groups whose documentType
 *      matches the document OR is null ("any"); never another type; tenant-scoped.
 *   3. Preset bundle rename: scoped update; cannot rename another org's bundle.
 *   4. Favorites: toggle add/remove (idempotent per href), per-user, tenant-scoped, unique.
 * Two throwaway orgs; cleaned up at the end.
 *   DATABASE_URL=... npx tsx scripts/tests/f-presets-settings.test.ts
 */
import { and, eq, or, isNull, sql } from "drizzle-orm";
import {
  db,
  pool,
  orgsTable,
  usersTable,
  productsTable,
  noteTemplatesTable,
  termsConditionsGroupsTable,
  productBundlesTable,
  favoritesTable,
} from "../../src/db";

let failures = 0;
function assert(name: string, cond: boolean) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}`);
  if (!cond) failures++;
}

// Mirror of saveTermsGroupAction's default-clearing transaction.
async function saveTermsGroup(orgId: number, input: { id?: number; name: string; documentType: string | null; content: string; isDefault: boolean }) {
  return db.transaction(async (tx) => {
    if (input.isDefault && input.documentType) {
      await tx.update(termsConditionsGroupsTable).set({ isDefault: false }).where(and(eq(termsConditionsGroupsTable.orgId, orgId), eq(termsConditionsGroupsTable.documentType, input.documentType)));
    }
    if (input.id) {
      await tx.update(termsConditionsGroupsTable).set({ name: input.name, documentType: input.documentType, content: input.content, isDefault: input.isDefault }).where(and(eq(termsConditionsGroupsTable.id, input.id), eq(termsConditionsGroupsTable.orgId, orgId)));
      return input.id;
    }
    const [row] = await tx.insert(termsConditionsGroupsTable).values({ orgId, name: input.name, documentType: input.documentType, content: input.content, isDefault: input.isDefault }).returning({ id: termsConditionsGroupsTable.id });
    return row.id;
  });
}

async function main() {
  const [orgA] = await db.insert(orgsTable).values({ name: "BatchF Org A" }).returning({ id: orgsTable.id });
  const [orgB] = await db.insert(orgsTable).values({ name: "BatchF Org B" }).returning({ id: orgsTable.id });
  const [uA1] = await db.insert(usersTable).values({ orgId: orgA.id, email: `fa1-${orgA.id}@t.test`, passwordHash: "x", name: "FA One", role: "owner" }).returning({ id: usersTable.id });
  const [uA2] = await db.insert(usersTable).values({ orgId: orgA.id, email: `fa2-${orgA.id}@t.test`, passwordHash: "x", name: "FA Two", role: "staff" }).returning({ id: usersTable.id });
  const [uB] = await db.insert(usersTable).values({ orgId: orgB.id, email: `fb-${orgB.id}@t.test`, passwordHash: "x", name: "FB One", role: "owner" }).returning({ id: usersTable.id });

  console.log("\n== 1. Terms & Conditions Groups CRUD + set default ==");
  {
    const g1 = await saveTermsGroup(orgA.id, { name: "Standard Sales", documentType: "quotation", content: "Terms A", isDefault: true });
    const g2 = await saveTermsGroup(orgA.id, { name: "Promo Terms", documentType: "quotation", content: "Terms B", isDefault: true });
    // Setting g2 default must have cleared g1's default.
    const defaults = await db.select({ id: termsConditionsGroupsTable.id }).from(termsConditionsGroupsTable).where(and(eq(termsConditionsGroupsTable.orgId, orgA.id), eq(termsConditionsGroupsTable.documentType, "quotation"), eq(termsConditionsGroupsTable.isDefault, true)));
    assert("create two groups", (await db.select({ n: sql<number>`count(*)::int` }).from(termsConditionsGroupsTable).where(eq(termsConditionsGroupsTable.orgId, orgA.id)))[0].n === 2);
    assert("only one default per (org, documentType)", defaults.length === 1 && defaults[0].id === g2);

    // edit g1 (rename + content)
    await saveTermsGroup(orgA.id, { id: g1, name: "Standard Sales v2", documentType: "quotation", content: "Terms A2", isDefault: false });
    const [edited] = await db.select({ name: termsConditionsGroupsTable.name, content: termsConditionsGroupsTable.content }).from(termsConditionsGroupsTable).where(eq(termsConditionsGroupsTable.id, g1));
    assert("edit updates name + content", edited.name === "Standard Sales v2" && edited.content === "Terms A2");

    // delete g2 (scoped)
    await db.delete(termsConditionsGroupsTable).where(and(eq(termsConditionsGroupsTable.id, g2), eq(termsConditionsGroupsTable.orgId, orgA.id)));
    assert("delete removes the group", (await db.select({ n: sql<number>`count(*)::int` }).from(termsConditionsGroupsTable).where(eq(termsConditionsGroupsTable.orgId, orgA.id)))[0].n === 1);

    // tenant scope: orgB group invisible to orgA
    await saveTermsGroup(orgB.id, { name: "Other Org Terms", documentType: "quotation", content: "X", isDefault: true });
    const orgAGroups = await db.select({ id: termsConditionsGroupsTable.id }).from(termsConditionsGroupsTable).where(eq(termsConditionsGroupsTable.orgId, orgA.id));
    assert("orgA never sees orgB's terms group", orgAGroups.length === 1 && orgAGroups[0].id === g1);
  }

  console.log("\n== 2. Document content presets loader (docType OR any) ==");
  {
    // groups: one for quotation, one "any" (null), one for sales_invoice
    await saveTermsGroup(orgA.id, { name: "Any Terms", documentType: null, content: "Any", isDefault: false });
    await saveTermsGroup(orgA.id, { name: "Invoice Terms", documentType: "sales_invoice", content: "Inv", isDefault: true });
    // note templates: default for quotation + an "any" template
    await db.insert(noteTemplatesTable).values({ orgId: orgA.id, name: "Quote Note", documentType: "quotation", content: "Thanks for your quote", isDefault: true });
    await db.insert(noteTemplatesTable).values({ orgId: orgA.id, name: "Any Note", documentType: null, content: "Generic", isDefault: false });
    await db.insert(noteTemplatesTable).values({ orgId: orgA.id, name: "Invoice Note", documentType: "sales_invoice", content: "Invoice-only", isDefault: false });

    const loadFor = async (docType: string) => {
      const groups = await db.select({ name: termsConditionsGroupsTable.name }).from(termsConditionsGroupsTable).where(and(eq(termsConditionsGroupsTable.orgId, orgA.id), or(eq(termsConditionsGroupsTable.documentType, docType), isNull(termsConditionsGroupsTable.documentType))));
      const notes = await db.select({ name: noteTemplatesTable.name, isDefault: noteTemplatesTable.isDefault }).from(noteTemplatesTable).where(and(eq(noteTemplatesTable.orgId, orgA.id), or(eq(noteTemplatesTable.documentType, docType), isNull(noteTemplatesTable.documentType))));
      return { groups: groups.map((g) => g.name), notes };
    };

    const q = await loadFor("quotation");
    assert("quotation loads its own + any terms groups", q.groups.includes("Standard Sales v2") && q.groups.includes("Any Terms") && !q.groups.includes("Invoice Terms"));
    assert("quotation loads its own + any note templates", q.notes.some((n) => n.name === "Quote Note") && q.notes.some((n) => n.name === "Any Note") && !q.notes.some((n) => n.name === "Invoice Note"));
    assert("default note template resolvable for pre-fill", q.notes.find((n) => n.isDefault)?.name === "Quote Note");

    const inv = await loadFor("sales_invoice");
    assert("invoice loads its own + any, not quotation-only", inv.groups.includes("Invoice Terms") && inv.groups.includes("Any Terms") && !inv.groups.includes("Standard Sales v2"));
  }

  console.log("\n== 3. Preset bundle rename (scoped) ==");
  {
    const [b] = await db.insert(productBundlesTable).values({ orgId: orgA.id, name: "Starter Kit" }).returning({ id: productBundlesTable.id });
    // wrong-org rename affects 0 rows
    const wrong = await db.update(productBundlesTable).set({ name: "Hijacked" }).where(and(eq(productBundlesTable.id, b.id), eq(productBundlesTable.orgId, orgB.id))).returning({ id: productBundlesTable.id });
    assert("cannot rename another org's bundle", wrong.length === 0);
    const right = await db.update(productBundlesTable).set({ name: "Starter Kit Pro" }).where(and(eq(productBundlesTable.id, b.id), eq(productBundlesTable.orgId, orgA.id))).returning({ id: productBundlesTable.id });
    assert("owner can rename its bundle", right.length === 1);
    const [renamed] = await db.select({ name: productBundlesTable.name }).from(productBundlesTable).where(eq(productBundlesTable.id, b.id));
    assert("rename persists", renamed.name === "Starter Kit Pro");
    // silence unused
    void productsTable;
  }

  console.log("\n== 4. Favorites: toggle / per-user / tenant scope ==");
  {
    const toggle = async (orgId: number, userId: number, label: string, href: string) => {
      const [existing] = await db.select({ id: favoritesTable.id }).from(favoritesTable).where(and(eq(favoritesTable.orgId, orgId), eq(favoritesTable.userId, userId), eq(favoritesTable.href, href)));
      if (existing) {
        await db.delete(favoritesTable).where(eq(favoritesTable.id, existing.id));
        return false;
      }
      await db.insert(favoritesTable).values({ orgId, userId, label, href });
      return true;
    };

    const added = await toggle(orgA.id, uA1.id, "Invoices", "/sales/invoices");
    assert("toggle adds a favorite", added === true);
    const listA1 = await db.select().from(favoritesTable).where(and(eq(favoritesTable.orgId, orgA.id), eq(favoritesTable.userId, uA1.id)));
    assert("favorite saved for the user", listA1.length === 1 && listA1[0].href === "/sales/invoices");

    // per-user: uA2 has none
    const listA2 = await db.select().from(favoritesTable).where(and(eq(favoritesTable.orgId, orgA.id), eq(favoritesTable.userId, uA2.id)));
    assert("favorites are per-user (uA2 empty)", listA2.length === 0);

    // toggle again removes
    const removed = await toggle(orgA.id, uA1.id, "Invoices", "/sales/invoices");
    assert("toggle removes the favorite", removed === false && (await db.select({ n: sql<number>`count(*)::int` }).from(favoritesTable).where(and(eq(favoritesTable.orgId, orgA.id), eq(favoritesTable.userId, uA1.id))))[0].n === 0);

    // unique per (org,user,href): inserting twice is prevented by the constraint
    await db.insert(favoritesTable).values({ orgId: orgA.id, userId: uA1.id, label: "Dashboard", href: "/dashboard" });
    let dupBlocked = false;
    try {
      await db.insert(favoritesTable).values({ orgId: orgA.id, userId: uA1.id, label: "Dashboard again", href: "/dashboard" });
    } catch {
      dupBlocked = true;
    }
    assert("duplicate favorite (same href) is prevented", dupBlocked);

    // tenant + user scope: orgB user's favorite invisible to orgA
    await db.insert(favoritesTable).values({ orgId: orgB.id, userId: uB.id, label: "B Dash", href: "/dashboard" });
    const orgAFavs = await db.select().from(favoritesTable).where(eq(favoritesTable.orgId, orgA.id));
    assert("orgA never sees orgB favorites", orgAFavs.every((f) => f.userId === uA1.id));
  }

  // ---------- cleanup ----------
  await db.delete(favoritesTable).where(or(eq(favoritesTable.orgId, orgA.id), eq(favoritesTable.orgId, orgB.id)));
  await db.delete(noteTemplatesTable).where(or(eq(noteTemplatesTable.orgId, orgA.id), eq(noteTemplatesTable.orgId, orgB.id)));
  await db.delete(termsConditionsGroupsTable).where(or(eq(termsConditionsGroupsTable.orgId, orgA.id), eq(termsConditionsGroupsTable.orgId, orgB.id)));
  await db.delete(productBundlesTable).where(or(eq(productBundlesTable.orgId, orgA.id), eq(productBundlesTable.orgId, orgB.id)));
  await db.delete(usersTable).where(or(eq(usersTable.orgId, orgA.id), eq(usersTable.orgId, orgB.id)));
  await db.delete(orgsTable).where(or(eq(orgsTable.id, orgA.id), eq(orgsTable.id, orgB.id)));

  console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILED"}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
