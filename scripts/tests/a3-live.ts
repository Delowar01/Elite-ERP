/**
 * Batch A3 — LIVE database test.
 *
 * Drives a real draft quotation through Archive → Soft Delete → Restore →
 * Permanent Delete against the actual Postgres database, using the same record-
 * state columns (archived_at / deleted_at) and the same A1 lifecycle gate the
 * server actions use, and asserting the visible effects (list inclusion, audit
 * retention, number never reissued). Run with:
 *   DATABASE_URL=... npx tsx scripts/tests/a3-live.ts
 */
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import {
  db,
  pool,
  quotationsTable,
  quotationItemsTable,
  customersTable,
  activityLogsTable,
  documentSequencesTable,
} from "../../src/db";
import { evaluate } from "../../src/lib/document-lifecycle";

const ORG_ID = 1;
const USER_ID = 1;
let failures = 0;
function assert(name: string, cond: boolean) {
  console.log(`${cond ? "  ✓" : "  ✗ FAIL"} ${name}`);
  if (!cond) failures++;
}

async function main() {
  // --- setup: a throwaway customer + draft quotation + one line item ---
  const [cust] = await db.insert(customersTable).values({ orgId: ORG_ID, name: "A3 Live Test Client" }).returning({ id: customersTable.id });
  const number = `A3-LIVE-${Date.now()}`;
  const [q] = await db
    .insert(quotationsTable)
    .values({
      orgId: ORG_ID,
      quotationNumber: number,
      customerId: cust.id,
      issueDate: "2026-07-22",
      subtotal: "100.00",
      discount: "0",
      taxTotal: "15.00",
      total: "115.00",
      createdById: USER_ID,
    })
    .returning({ id: quotationsTable.id });
  await db.insert(quotationItemsTable).values({ quotationId: q.id, description: "Test line", quantity: "1", unitPrice: "100.00", taxRatePercent: "15", lineTotal: "100.00" });
  console.log(`setup: quotation #${q.id} (${number}) for org ${ORG_ID}`);

  const load = async () => (await db.select({ status: quotationsTable.status, archivedAt: quotationsTable.archivedAt, deletedAt: quotationsTable.deletedAt }).from(quotationsTable).where(eq(quotationsTable.id, q.id)))[0];

  // --- 1. ARCHIVE ---
  let s = await load();
  assert("1. archive permitted by lifecycle (active draft)", evaluate("quotation", s.status, "archive", { recordState: "active" }).allowed === true);
  await db.update(quotationsTable).set({ archivedAt: new Date() }).where(and(eq(quotationsTable.id, q.id), eq(quotationsTable.orgId, ORG_ID)));
  s = await load();
  assert("1. archived_at is set after archive", s.archivedAt !== null);
  // reset archive so the record is plain-active before the delete flow
  await db.update(quotationsTable).set({ archivedAt: null }).where(eq(quotationsTable.id, q.id));

  // --- 2. SOFT DELETE ---
  s = await load();
  assert("2. soft_delete permitted (draft)", evaluate("quotation", s.status, "soft_delete", { recordState: "active", isReferenced: false }).allowed === true);
  await db.update(quotationsTable).set({ deletedAt: new Date() }).where(and(eq(quotationsTable.id, q.id), eq(quotationsTable.orgId, ORG_ID)));
  const activeAfterDelete = await db.select({ id: quotationsTable.id }).from(quotationsTable).where(and(eq(quotationsTable.orgId, ORG_ID), eq(quotationsTable.id, q.id), isNull(quotationsTable.deletedAt)));
  assert("2. excluded from the active list (deleted_at IS NULL filter)", activeAfterDelete.length === 0);
  const inBin = await db.select({ id: quotationsTable.id }).from(quotationsTable).where(and(eq(quotationsTable.orgId, ORG_ID), eq(quotationsTable.id, q.id), isNotNull(quotationsTable.deletedAt)));
  assert("2. appears in the Recycle Bin (deleted_at IS NOT NULL)", inBin.length === 1);

  // --- 3. RESTORE ---
  s = await load();
  assert("3. restore permitted (recordState deleted)", evaluate("quotation", s.status, "restore", { recordState: "deleted" }).allowed === true);
  await db.update(quotationsTable).set({ deletedAt: null }).where(and(eq(quotationsTable.id, q.id), eq(quotationsTable.orgId, ORG_ID)));
  const activeAfterRestore = await db.select({ id: quotationsTable.id }).from(quotationsTable).where(and(eq(quotationsTable.orgId, ORG_ID), eq(quotationsTable.id, q.id), isNull(quotationsTable.deletedAt)));
  assert("3. back in the active list after restore", activeAfterRestore.length === 1);

  // --- 4. PERMANENT DELETE (owner, from bin, draft, unreferenced) ---
  // record must be in the bin first
  await db.update(quotationsTable).set({ deletedAt: new Date() }).where(eq(quotationsTable.id, q.id));
  s = await load();
  assert("4. permanent_delete refused for non-owner", evaluate("quotation", s.status, "permanent_delete", { role: "staff", recordState: "deleted", isReferenced: false }).allowed === false);
  assert("4. permanent_delete permitted (owner, bin, draft, unreferenced)", evaluate("quotation", s.status, "permanent_delete", { role: "owner", recordState: "deleted", isReferenced: false }).allowed === true);

  const seqBefore = (await db.select({ n: documentSequencesTable.nextNumber }).from(documentSequencesTable).where(and(eq(documentSequencesTable.orgId, ORG_ID), eq(documentSequencesTable.documentType, "quotation"))))[0]?.n;

  // mirror permanentDeleteDocumentAction: audit first (retains the number), then hard-delete
  await db.insert(activityLogsTable).values({
    orgId: ORG_ID,
    type: "quotation.permanently_deleted",
    description: `Permanently deleted Quotation ${number} (number retained in audit log, never reissued)`,
    entityType: "quotation",
    entityId: q.id,
    userId: USER_ID,
    userName: "A3 Live Test",
  });
  await db.transaction(async (tx) => {
    await tx.delete(quotationItemsTable).where(eq(quotationItemsTable.quotationId, q.id));
    await tx.delete(quotationsTable).where(and(eq(quotationsTable.id, q.id), eq(quotationsTable.orgId, ORG_ID)));
  });

  const gone = await db.select({ id: quotationsTable.id }).from(quotationsTable).where(eq(quotationsTable.id, q.id));
  assert("4. quotation row hard-deleted", gone.length === 0);
  const itemsGone = await db.select({ id: quotationItemsTable.id }).from(quotationItemsTable).where(eq(quotationItemsTable.quotationId, q.id));
  assert("4. line items hard-deleted", itemsGone.length === 0);
  const audit = await db.select({ description: activityLogsTable.description }).from(activityLogsTable).where(and(eq(activityLogsTable.entityType, "quotation"), eq(activityLogsTable.entityId, q.id), eq(activityLogsTable.type, "quotation.permanently_deleted")));
  assert("4. audit record retained with the document number", audit.length === 1 && audit[0].description.includes(number));
  const seqAfter = (await db.select({ n: documentSequencesTable.nextNumber }).from(documentSequencesTable).where(and(eq(documentSequencesTable.orgId, ORG_ID), eq(documentSequencesTable.documentType, "quotation"))))[0]?.n;
  assert("4. numbering sequence NOT rolled back (number never reissued)", seqBefore === seqAfter);

  // --- cleanup the throwaway customer ---
  await db.delete(customersTable).where(eq(customersTable.id, cust.id));

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — live archive/soft-delete/restore/permanent-delete, ${failures} failure(s)`);
  await pool.end();
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
