// E2E for the Main Search record search (src/lib/global-search.ts). Confirms it searches every
// required record type (clients, vendors, products, employees, projects, journal entries + sales/
// purchasing documents) across name / number / code / email / phone / VAT number / SKU, returns
// results grouped by type with a detail href, and stays strictly tenant-scoped.
// Run: DATABASE_URL=... npx tsx scripts/tests/global-search.e2e.ts
import "./_shim-server-only";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  orgsTable,
  usersTable,
  customersTable,
  vendorsTable,
  productsTable,
  employeesTable,
  projectsTable,
  journalEntriesTable,
} from "../../src/db";
import { searchRecords } from "../../src/lib/global-search";

let pass = 0,
  fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("Global (Main Search) record search E2E\n");

  const orgs = await db.select({ id: orgsTable.id }).from(orgsTable).orderBy(orgsTable.id).limit(2);
  if (orgs.length < 2) throw new Error("need at least 2 orgs");
  const orgA = orgs[0].id;
  const orgB = orgs[1].id;
  const [userA] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.orgId, orgA)).limit(1);
  const [userB] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.orgId, orgB)).limit(1);
  if (!userA || !userB) throw new Error("each org needs a user");

  const TAG = `ZZSRCH${Date.now()}`;
  const cleanup: Array<() => Promise<unknown>> = [];

  // Seed one of each searchable master/record type in BOTH orgs, all sharing TAG so tenant isolation
  // is actually exercised (same needle, different haystacks).
  async function seed(orgId: number, userId: number) {
    const [c] = await db
      .insert(customersTable)
      .values({ orgId, name: `${TAG} Client`, email: `${TAG}@mail.test`, phone: `+9715${TAG.slice(-6)}`, vatNumber: `VAT${TAG}` })
      .returning();
    cleanup.push(() => db.delete(customersTable).where(eq(customersTable.id, c.id)));
    const [v] = await db
      .insert(vendorsTable)
      .values({ orgId, name: `${TAG} Vendor`, email: `${TAG}v@mail.test`, vatNumber: `VVAT${TAG}` })
      .returning();
    cleanup.push(() => db.delete(vendorsTable).where(eq(vendorsTable.id, v.id)));
    const [p] = await db
      .insert(productsTable)
      .values({ orgId, sku: `SKU-${TAG}`, name: `${TAG} Product` })
      .returning();
    cleanup.push(() => db.delete(productsTable).where(eq(productsTable.id, p.id)));
    const [e] = await db
      .insert(employeesTable)
      .values({ orgId, employeeCode: `EMP-${TAG}`, name: `${TAG} Employee`, email: `${TAG}e@mail.test` })
      .returning();
    cleanup.push(() => db.delete(employeesTable).where(eq(employeesTable.id, e.id)));
    const [pr] = await db
      .insert(projectsTable)
      .values({ orgId, name: `${TAG} Project` })
      .returning();
    cleanup.push(() => db.delete(projectsTable).where(eq(projectsTable.id, pr.id)));
    const [j] = await db
      .insert(journalEntriesTable)
      .values({ orgId, entryDate: "2026-01-15", memo: `${TAG} Journal memo`, sourceType: "manual", createdById: userId })
      .returning();
    cleanup.push(() => db.delete(journalEntriesTable).where(eq(journalEntriesTable.id, j.id)));
    return { c, v, p, e, pr, j };
  }

  try {
    const a = await seed(orgA, userA.id);
    await seed(orgB, userB.id);

    // ---- All required record types are searchable and grouped ----
    const res = await searchRecords(orgA, TAG);
    const types = new Set(res.map((r) => r.type));
    for (const tp of ["Clients", "Vendors", "Products", "Employees", "Projects", "Journal Entries"]) {
      check(`returns ${tp}`, types.has(tp));
    }

    // ---- Detail href per type opens the record's own page ----
    check("client href → /clients/{id}", res.some((r) => r.type === "Clients" && r.href === `/clients/${a.c.id}`));
    check("vendor href → /purchasing/vendors/{id}", res.some((r) => r.type === "Vendors" && r.href === `/purchasing/vendors/${a.v.id}`));
    check("product href → /inventory/products/{id}", res.some((r) => r.type === "Products" && r.href === `/inventory/products/${a.p.id}`));
    check("employee href → /hr/employees/{id}", res.some((r) => r.type === "Employees" && r.href === `/hr/employees/${a.e.id}`));
    check("project href → /projects/{id}", res.some((r) => r.type === "Projects" && r.href === `/projects/${a.pr.id}`));
    check("journal href → /finance/journal#je-{id}", res.some((r) => r.type === "Journal Entries" && r.href === `/finance/journal#je-${a.j.id}`));

    // ---- Field coverage: email / phone / VAT / SKU / code / memo ----
    check("client found by email", (await searchRecords(orgA, `${TAG}@mail.test`)).some((r) => r.type === "Clients"));
    check("client found by VAT number", (await searchRecords(orgA, `VAT${TAG}`)).some((r) => r.type === "Clients"));
    check("client found by phone", (await searchRecords(orgA, TAG.slice(-6))).some((r) => r.type === "Clients"));
    check("product found by SKU", (await searchRecords(orgA, `SKU-${TAG}`)).some((r) => r.type === "Products"));
    check("employee found by code", (await searchRecords(orgA, `EMP-${TAG}`)).some((r) => r.type === "Employees"));
    check("journal found by memo", (await searchRecords(orgA, `${TAG} Journal`)).some((r) => r.type === "Journal Entries"));

    // ---- Tenant isolation: orgA search never returns orgB rows (and vice versa) ----
    const aHrefs = new Set(res.map((r) => r.href));
    const resB = await searchRecords(orgB, TAG);
    check("orgA results do not leak into orgB", !resB.some((r) => aHrefs.has(r.href)));
    check("orgB search still finds its own records", ["Clients", "Vendors", "Products", "Employees", "Projects", "Journal Entries"].every((tp) => resB.some((r) => r.type === tp)));

    // ---- Short queries return nothing ----
    check("empty query returns []", (await searchRecords(orgA, "")).length === 0);
    check("1-char query returns []", (await searchRecords(orgA, "z")).length === 0);
  } finally {
    // Remove exactly the rows we inserted (independent rows, any order).
    for (const del of cleanup.reverse()) await del();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
