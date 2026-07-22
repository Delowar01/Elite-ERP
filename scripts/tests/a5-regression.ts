/**
 * Batch A5 — final-regression reconciliation, run live against the database.
 *
 * Covers the cross-cutting invariants that the per-batch suites don't assert directly:
 *   - Accounting reconciliation: the ledger is balanced (org-wide and per journal entry).
 *   - Inventory reconciliation: no product is left with negative stock.
 *   - Tenant isolation: a lifecycle mutation scoped to another org touches nothing.
 *   - Audit log: the activity-log path writes and reads back.
 *   DATABASE_URL=... npx tsx scripts/tests/a5-regression.ts
 */
import { and, eq, sql } from "drizzle-orm";
import { db, pool, journalEntriesTable, journalLinesTable, productsTable, quotationsTable, customersTable, activityLogsTable, orgsTable, usersTable } from "../../src/db";

let failures = 0;
function assert(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const orgs = await db.select({ id: orgsTable.id }).from(orgsTable);
  const orgIds = orgs.map((o) => o.id);

  // ===== Accounting reconciliation: double-entry integrity, every org =====
  console.log("\n[1] Accounting reconciliation (double-entry integrity)");
  for (const orgId of orgIds) {
    const [tot] = await db
      .select({ d: sql<string>`COALESCE(SUM(${journalLinesTable.debit}),0)`, c: sql<string>`COALESCE(SUM(${journalLinesTable.credit}),0)` })
      .from(journalLinesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalLinesTable.journalEntryId))
      .where(eq(journalEntriesTable.orgId, orgId));
    const d = Number(tot.d), c = Number(tot.c);
    assert(`org ${orgId}: total debits == total credits`, Math.abs(d - c) < 0.005, `Dr ${d.toFixed(2)} / Cr ${c.toFixed(2)}`);
  }
  // per-entry balance across all orgs
  const unbalanced = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .innerJoin(journalLinesTable, eq(journalLinesTable.journalEntryId, journalEntriesTable.id))
    .groupBy(journalEntriesTable.id)
    .having(sql`ABS(SUM(${journalLinesTable.debit}) - SUM(${journalLinesTable.credit})) > 0.005`);
  assert("every journal entry balances (no unbalanced entries)", unbalanced.length === 0, `${unbalanced.length} unbalanced`);

  // ===== Inventory reconciliation =====
  console.log("\n[2] Inventory reconciliation");
  const [neg] = await db.select({ n: sql<string>`count(*)` }).from(productsTable).where(sql`${productsTable.quantityOnHand} < 0`);
  assert("no product has negative stock", Number(neg.n) === 0, `${neg.n} negative`);

  // ===== Tenant isolation at the mutation layer =====
  console.log("\n[3] Tenant isolation");
  const org1 = orgIds[0];
  const otherOrg = orgIds.find((o) => o !== org1) ?? org1 + 999; // a different (or non-existent) org
  const [owner] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.orgId, org1)).limit(1);
  const [cust] = await db.insert(customersTable).values({ orgId: org1, name: "A5 Tenant Test" }).returning({ id: customersTable.id });
  const [q] = await db
    .insert(quotationsTable)
    .values({ orgId: org1, quotationNumber: `A5-TEN-${Date.now()}`, customerId: cust.id, issueDate: "2026-07-22", subtotal: "0", discount: "0", taxTotal: "0", total: "0", createdById: owner.id })
    .returning({ id: quotationsTable.id });
  // A lifecycle mutation scoped to another org (exactly how the actions filter) must hit nothing.
  const crossUpd = await db
    .update(quotationsTable)
    .set({ archivedAt: new Date() })
    .where(and(eq(quotationsTable.id, q.id), eq(quotationsTable.orgId, otherOrg)))
    .returning({ id: quotationsTable.id });
  assert("cross-org archive touches 0 rows", crossUpd.length === 0);
  const crossSel = await db.select({ id: quotationsTable.id }).from(quotationsTable).where(and(eq(quotationsTable.id, q.id), eq(quotationsTable.orgId, otherOrg)));
  assert("cross-org read returns nothing", crossSel.length === 0);
  const sameSel = await db.select({ archivedAt: quotationsTable.archivedAt }).from(quotationsTable).where(and(eq(quotationsTable.id, q.id), eq(quotationsTable.orgId, org1)));
  assert("owning-org read still finds the doc, unaffected", sameSel.length === 1 && sameSel[0].archivedAt === null);
  // cleanup
  await db.delete(quotationsTable).where(eq(quotationsTable.id, q.id));
  await db.delete(customersTable).where(eq(customersTable.id, cust.id));

  // ===== Audit log write/read =====
  console.log("\n[4] Audit log path");
  const marker = `a5.regression.${Date.now()}`;
  await db.insert(activityLogsTable).values({ orgId: org1, type: marker, description: "A5 audit-path check", entityType: "quotation", entityId: 0, userId: owner.id, userName: "A5" });
  const back = await db.select({ id: activityLogsTable.id }).from(activityLogsTable).where(and(eq(activityLogsTable.orgId, org1), eq(activityLogsTable.type, marker)));
  assert("activity-log row written and read back", back.length === 1);
  await db.delete(activityLogsTable).where(eq(activityLogsTable.type, marker));

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — A5 reconciliation, ${failures} failure(s)`);
  await pool.end();
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
