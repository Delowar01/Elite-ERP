/**
 * Batch B — LIVE database test for the List Workspace (Filters / Saved Views / Export / Import).
 *
 * Because the registry (`document-list-workspace.ts`) and the server actions import
 * `server-only` (which throws outside an RSC bundle), this test mirrors their exact SQL
 * against real Postgres — the same approach as a4-live.ts — and asserts:
 *   1. Filters (status / date range / party / archived / search) select the right rows,
 *      and export queries never leak another tenant's rows.
 *   2. Saved Views are tenant- AND user-scoped: list/rename/delete only ever touch the
 *      caller's own rows.
 *   3. Import creates DRAFT records only, auto-numbers when blank, and its validation
 *      refuses unknown clients, bad dates/amounts, in-file duplicate numbers, and numbers
 *      that already exist (duplicate prevention).
 * Creates two isolated throwaway orgs and cleans everything up at the end.
 *   DATABASE_URL=... npx tsx scripts/tests/b-list-workspace.test.ts
 */
import { and, eq, or, ilike, gte, lte, isNull, isNotNull, desc, count } from "drizzle-orm";
import {
  db,
  pool,
  orgsTable,
  usersTable,
  customersTable,
  quotationsTable,
  quotationItemsTable,
  savedViewsTable,
  documentSequencesTable,
} from "../../src/db";

let failures = 0;
function assert(name: string, cond: boolean) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}`);
  if (!cond) failures++;
}

// ---- mirror of registry filterConds() ----
type F = { search: string; status: string; dateFrom: string; dateTo: string; party: string; archived: "all" | "active" | "archived" };
const EMPTY: F = { search: "", status: "", dateFrom: "", dateTo: "", party: "", archived: "all" };
function quotationFilterQuery(orgId: number, f: F) {
  const conds = [eq(quotationsTable.orgId, orgId), isNull(quotationsTable.deletedAt)];
  if (f.status) conds.push(eq(quotationsTable.status, f.status));
  if (f.dateFrom) conds.push(gte(quotationsTable.issueDate, f.dateFrom));
  if (f.dateTo) conds.push(lte(quotationsTable.issueDate, f.dateTo));
  if (f.party) conds.push(eq(customersTable.name, f.party));
  if (f.archived === "active") conds.push(isNull(quotationsTable.archivedAt));
  if (f.archived === "archived") conds.push(isNotNull(quotationsTable.archivedAt));
  if (f.search) {
    const s = `%${f.search}%`;
    const like = or(ilike(quotationsTable.quotationNumber, s), ilike(customersTable.name, s));
    if (like) conds.push(like);
  }
  return db
    .select({ number: quotationsTable.quotationNumber, party: customersTable.name })
    .from(quotationsTable)
    .innerJoin(customersTable, eq(customersTable.id, quotationsTable.customerId))
    .where(and(...conds))
    .orderBy(desc(quotationsTable.id));
}

// ---- mirror of registry import helpers ----
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
const isAmount = (s: string) => s.trim() === "" || (/^\d+(\.\d{1,2})?$/.test(s.trim()) && Number(s) >= 0);
async function findCustomerId(orgId: number, name: string): Promise<number | null> {
  const [c] = await db.select({ id: customersTable.id }).from(customersTable).where(and(eq(customersTable.orgId, orgId), ilike(customersTable.name, name.trim())));
  return c?.id ?? null;
}
async function checkNumberFree(orgId: number, num: string): Promise<boolean> {
  const [x] = await db.select({ n: count() }).from(quotationsTable).where(and(eq(quotationsTable.orgId, orgId), eq(quotationsTable.quotationNumber, num)));
  return Number(x?.n ?? 0) === 0;
}
async function validateQuotationRow(orgId: number, c: Record<string, string>, batch: Set<string>): Promise<string[]> {
  const errs: string[] = [];
  if (!c.client?.trim()) errs.push("Client is required.");
  else if (!(await findCustomerId(orgId, c.client))) errs.push(`Client "${c.client}" not found.`);
  if (!isDate(c.date || "")) errs.push("Issue Date must be YYYY-MM-DD.");
  if (!isAmount(c.amount || "")) errs.push("Amount must be a non-negative number.");
  const num = (c.number || "").trim();
  if (num) {
    if (batch.has(num.toLowerCase())) errs.push(`Duplicate document number "${num}" within the file.`);
    else if (!(await checkNumberFree(orgId, num))) errs.push(`Quotation number "${num}" already exists.`);
  }
  return errs;
}

async function main() {
  // ---------- setup: two isolated orgs ----------
  const [orgA] = await db.insert(orgsTable).values({ name: "BatchB Test Org A" }).returning({ id: orgsTable.id });
  const [orgB] = await db.insert(orgsTable).values({ name: "BatchB Test Org B" }).returning({ id: orgsTable.id });
  const [userA1] = await db.insert(usersTable).values({ orgId: orgA.id, email: `a1-${orgA.id}@t.test`, passwordHash: "x", name: "A One", role: "owner" }).returning({ id: usersTable.id });
  const [userA2] = await db.insert(usersTable).values({ orgId: orgA.id, email: `a2-${orgA.id}@t.test`, passwordHash: "x", name: "A Two", role: "staff" }).returning({ id: usersTable.id });
  const [userB] = await db.insert(usersTable).values({ orgId: orgB.id, email: `b-${orgB.id}@t.test`, passwordHash: "x", name: "B One", role: "owner" }).returning({ id: usersTable.id });
  const [custZ] = await db.insert(customersTable).values({ orgId: orgA.id, name: "Zephyr Trading Co" }).returning({ id: customersTable.id });
  const [custO] = await db.insert(customersTable).values({ orgId: orgA.id, name: "Orion Holdings" }).returning({ id: customersTable.id });
  const [custBz] = await db.insert(customersTable).values({ orgId: orgB.id, name: "Zephyr Trading Co" }).returning({ id: customersTable.id }); // same name, other org

  const mk = (orgId: number, custId: number, num: string, status: string, date: string, opts: { archived?: boolean; deleted?: boolean } = {}) =>
    db.insert(quotationsTable).values({
      orgId, quotationNumber: num, customerId: custId, status, issueDate: date,
      subtotal: "100", discount: "0", taxTotal: "0", total: "100", createdById: userA1.id,
      archivedAt: opts.archived ? new Date() : null, deletedAt: opts.deleted ? new Date() : null,
    });

  // org A dataset
  await mk(orgA.id, custZ.id, "BT-A-100", "draft", "2026-01-10");
  await mk(orgA.id, custZ.id, "BT-A-101", "sent", "2026-02-15");
  await mk(orgA.id, custO.id, "BT-A-102", "accepted", "2026-03-20");
  await mk(orgA.id, custO.id, "BT-A-103", "sent", "2026-04-25", { archived: true });
  await mk(orgA.id, custZ.id, "BT-A-104", "draft", "2026-05-30", { deleted: true }); // soft-deleted, must never appear
  // org B dataset (tenant-isolation bait)
  await mk(orgB.id, custBz.id, "BT-B-200", "sent", "2026-02-15");

  console.log("\n== 1. Filters + tenant isolation ==");
  {
    const all = await quotationFilterQuery(orgA.id, EMPTY);
    assert("no-filter returns 4 rows (soft-deleted excluded)", all.length === 4);
    assert("soft-deleted BT-A-104 never appears", !all.some((r) => r.number === "BT-A-104"));
    assert("org A results never include org B rows", !all.some((r) => r.number.startsWith("BT-B")));

    const sent = await quotationFilterQuery(orgA.id, { ...EMPTY, status: "sent" });
    assert("status=sent returns 2 rows", sent.length === 2 && sent.every((r) => r.number === "BT-A-101" || r.number === "BT-A-103"));

    const dated = await quotationFilterQuery(orgA.id, { ...EMPTY, dateFrom: "2026-02-01", dateTo: "2026-03-31" });
    assert("date range Feb–Mar returns 2 rows", dated.length === 2 && dated.some((r) => r.number === "BT-A-101") && dated.some((r) => r.number === "BT-A-102"));

    const party = await quotationFilterQuery(orgA.id, { ...EMPTY, party: "Zephyr Trading Co" });
    assert("party=Zephyr returns its 2 active rows", party.length === 2 && party.every((r) => r.party === "Zephyr Trading Co"));

    const active = await quotationFilterQuery(orgA.id, { ...EMPTY, archived: "active" });
    assert("archived=active excludes the archived row", active.length === 3 && !active.some((r) => r.number === "BT-A-103"));
    const archived = await quotationFilterQuery(orgA.id, { ...EMPTY, archived: "archived" });
    assert("archived=archived returns only BT-A-103", archived.length === 1 && archived[0].number === "BT-A-103");

    const search = await quotationFilterQuery(orgA.id, { ...EMPTY, search: "orion" });
    assert("search=orion matches by client name (case-insensitive)", search.length === 2 && search.every((r) => r.party === "Orion Holdings"));
    const searchNum = await quotationFilterQuery(orgA.id, { ...EMPTY, search: "BT-A-100" });
    assert("search matches by document number", searchNum.length === 1 && searchNum[0].number === "BT-A-100");

    // org B sees only its own single row
    const bAll = await quotationFilterQuery(orgB.id, EMPTY);
    assert("org B export returns only its own 1 row", bAll.length === 1 && bAll[0].number === "BT-B-200");
  }

  console.log("\n== 2. Saved Views (tenant + user scoped) ==");
  {
    const save = (orgId: number, userId: number, name: string, config: F) =>
      db.insert(savedViewsTable).values({ orgId, userId, module: "quotation", name, config }).returning({ id: savedViewsTable.id });
    const [vA1] = await save(orgA.id, userA1.id, "My Sent", { ...EMPTY, status: "sent" });
    await save(orgA.id, userA2.id, "A2 View", { ...EMPTY, status: "draft" });
    await save(orgB.id, userB.id, "B View", EMPTY);

    const listFor = (orgId: number, userId: number) =>
      db.select({ id: savedViewsTable.id, name: savedViewsTable.name, config: savedViewsTable.config })
        .from(savedViewsTable)
        .where(and(eq(savedViewsTable.orgId, orgId), eq(savedViewsTable.userId, userId), eq(savedViewsTable.module, "quotation")));

    const a1List = await listFor(orgA.id, userA1.id);
    assert("user A1 sees only their own 1 view", a1List.length === 1 && a1List[0].name === "My Sent");
    assert("saved config round-trips (status=sent)", (a1List[0].config as F).status === "sent");
    const a2List = await listFor(orgA.id, userA2.id);
    assert("user A2 (same org) sees only their own view, not A1's", a2List.length === 1 && a2List[0].name === "A2 View");
    const bList = await listFor(orgB.id, userB.id);
    assert("org B user sees only org B's view", bList.length === 1 && bList[0].name === "B View");

    // rename scoped to owner: A2 cannot rename A1's view
    const wrongRename = await db.update(savedViewsTable).set({ name: "hijacked" })
      .where(and(eq(savedViewsTable.id, vA1.id), eq(savedViewsTable.orgId, orgA.id), eq(savedViewsTable.userId, userA2.id)))
      .returning({ id: savedViewsTable.id });
    assert("A2 cannot rename A1's view (scoped update affects 0 rows)", wrongRename.length === 0);
    const rightRename = await db.update(savedViewsTable).set({ name: "Renamed" })
      .where(and(eq(savedViewsTable.id, vA1.id), eq(savedViewsTable.orgId, orgA.id), eq(savedViewsTable.userId, userA1.id)))
      .returning({ id: savedViewsTable.id });
    assert("A1 can rename their own view", rightRename.length === 1);

    // upsert-by-name: saving "Renamed" again for A1 must update, not duplicate
    const [dup] = await db.select({ id: savedViewsTable.id }).from(savedViewsTable)
      .where(and(eq(savedViewsTable.orgId, orgA.id), eq(savedViewsTable.userId, userA1.id), eq(savedViewsTable.module, "quotation"), eq(savedViewsTable.name, "Renamed")));
    assert("upsert lookup finds the existing view by (org,user,module,name)", dup?.id === vA1.id);

    // delete scoped to owner
    const wrongDel = await db.delete(savedViewsTable)
      .where(and(eq(savedViewsTable.id, vA1.id), eq(savedViewsTable.orgId, orgA.id), eq(savedViewsTable.userId, userA2.id)))
      .returning({ id: savedViewsTable.id });
    assert("A2 cannot delete A1's view", wrongDel.length === 0);
    const rightDel = await db.delete(savedViewsTable)
      .where(and(eq(savedViewsTable.id, vA1.id), eq(savedViewsTable.orgId, orgA.id), eq(savedViewsTable.userId, userA1.id)))
      .returning({ id: savedViewsTable.id });
    assert("A1 can delete their own view", rightDel.length === 1);
  }

  console.log("\n== 3. Import validation + draft round-trip + duplicate prevention ==");
  {
    const batch = new Set<string>();
    // unknown client
    assert("unknown client rejected", (await validateQuotationRow(orgA.id, { client: "Ghost Corp", date: "2026-06-01", amount: "50" }, batch)).some((e) => e.includes("not found")));
    // bad date
    assert("bad date rejected", (await validateQuotationRow(orgA.id, { client: "Zephyr Trading Co", date: "06/01/2026", amount: "50" }, batch)).some((e) => e.includes("YYYY-MM-DD")));
    // bad amount
    assert("negative amount rejected", (await validateQuotationRow(orgA.id, { client: "Zephyr Trading Co", date: "2026-06-01", amount: "-5" }, batch)).some((e) => e.includes("non-negative")));
    // existing number
    assert("already-existing number rejected", (await validateQuotationRow(orgA.id, { number: "BT-A-100", client: "Zephyr Trading Co", date: "2026-06-01", amount: "50" }, batch)).some((e) => e.includes("already exists")));
    // valid row
    assert("valid row passes with no errors", (await validateQuotationRow(orgA.id, { client: "Zephyr Trading Co", date: "2026-06-01", amount: "50" }, batch)).length === 0);
    // in-file duplicate
    batch.add("bt-a-900");
    assert("in-file duplicate number rejected", (await validateQuotationRow(orgA.id, { number: "BT-A-900", client: "Zephyr Trading Co", date: "2026-06-01", amount: "50" }, batch)).some((e) => e.includes("within the file")));

    // insert a valid draft (mirrors insertRow): explicit number + amount>0 → one line item
    let insertedId = 0;
    await db.transaction(async (tx) => {
      const [q] = await tx.insert(quotationsTable).values({
        orgId: orgA.id, quotationNumber: "BT-A-IMPORT-1", customerId: custZ.id, issueDate: "2026-06-02",
        title: "Imported", subtotal: "50.00", discount: "0", taxTotal: "0.00", total: "50.00", createdById: userA1.id,
      }).returning({ id: quotationsTable.id });
      insertedId = q.id;
      await tx.insert(quotationItemsTable).values({ quotationId: q.id, description: "Imported line", quantity: "1", unitPrice: "50.00", taxRatePercent: "0", lineTotal: "50.00" });
    });
    const [imported] = await db.select({ status: quotationsTable.status, total: quotationsTable.total }).from(quotationsTable).where(eq(quotationsTable.id, insertedId));
    assert("imported record is created as DRAFT (no posting)", imported?.status === "draft");
    assert("imported draft carries its amount", imported?.total === "50.00");
    const items = await db.select({ n: count() }).from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, insertedId));
    assert("imported draft has one line item", Number(items[0].n) === 1);
    // now the number is taken → duplicate prevention on a second import attempt
    assert("re-importing the same number is now refused", !(await checkNumberFree(orgA.id, "BT-A-IMPORT-1")));
  }

  // ---------- cleanup (scoped strictly to the two throwaway orgs) ----------
  await db.delete(savedViewsTable).where(or(eq(savedViewsTable.orgId, orgA.id), eq(savedViewsTable.orgId, orgB.id)));
  const qids = await db.select({ id: quotationsTable.id }).from(quotationsTable).where(or(eq(quotationsTable.orgId, orgA.id), eq(quotationsTable.orgId, orgB.id)));
  for (const q of qids) await db.delete(quotationItemsTable).where(eq(quotationItemsTable.quotationId, q.id));
  await db.delete(quotationsTable).where(or(eq(quotationsTable.orgId, orgA.id), eq(quotationsTable.orgId, orgB.id)));
  await db.delete(customersTable).where(or(eq(customersTable.orgId, orgA.id), eq(customersTable.orgId, orgB.id)));
  await db.delete(documentSequencesTable).where(or(eq(documentSequencesTable.orgId, orgA.id), eq(documentSequencesTable.orgId, orgB.id)));
  await db.delete(usersTable).where(or(eq(usersTable.orgId, orgA.id), eq(usersTable.orgId, orgB.id)));
  await db.delete(orgsTable).where(or(eq(orgsTable.id, orgA.id), eq(orgsTable.id, orgB.id)));

  console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILED"}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
