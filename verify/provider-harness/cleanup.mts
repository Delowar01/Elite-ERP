/**
 * The cleanup ALGORITHM, separated from the CLI that guards it, so the rules that matter most can be
 * tested directly against the fake stores. The CLI refuses to run under the fake driver, so without
 * this seam "cleanup never deletes what it does not own" would have to be taken on trust.
 *
 * THE OWNERSHIP RULE: match the bytes that are there NOW.
 *
 * A successful write proves the run owned the pathname at that moment. It does not prove the run
 * owns whatever is sitting at that pathname when cleanup runs, possibly hours later — a concurrent
 * actor or a careless overwrite can have replaced it, and deleting the replacement would destroy
 * somebody else's object under cover of a correct-looking record. So every candidate, whatever its
 * recorded state, is read back and hashed against the bytes this run INTENDED to write:
 *
 *   bytes match      -> owned. Delete, then verify it is gone.
 *   bytes differ     -> skipped-not-owned. Left untouched and reported.
 *   nothing there    -> already gone.
 *   cannot be read   -> inconclusive. The question is unanswered, so nothing is deleted.
 *
 * The recorded state (`created`, `planned`, `create-failed`) therefore no longer decides deletion;
 * it only explains why a pathname is in the manifest at all.
 */
import type { BlobStore } from "../../src/lib/storage/blob-client";
import { sha256, type Manifest, type ManifestObject } from "./manifest.mjs";

export type CleanupResult = {
  deleted: number; alreadyGone: number; skippedNotOwned: number; inconclusive: number; failed: number; log: string[];
};

type Ownership = { kind: "owned" | "absent" | "not-ours" | "unknown"; pathname: string };

/** Do the bytes at this pathname, right now, hash to what the run intended to write? */
async function ownsCurrentBytes(store: BlobStore, pathname: string, expectedSha: string): Promise<Ownership> {
  try {
    const got = await store.get(pathname);
    if (!got) return { kind: "absent", pathname };
    return { kind: sha256(got.bytes) === expectedSha ? "owned" : "not-ours", pathname };
  } catch {
    return { kind: "unknown", pathname };
  }
}

/**
 * Does this run own the object currently at the pathname — and which pathname is that?
 *
 * An unresolved PREFIX RESERVATION has no pathname at all: the application was about to mint one
 * and the run never learned it. Ownership is then earned the same way, by bytes: list the reserved
 * prefix, read each candidate, and accept only an exact sha256 match. Objects that were already
 * under that prefix have different bytes and are never touched.
 */
async function ownership(store: BlobStore, entry: ManifestObject): Promise<Ownership> {
  if (entry.pathname === "") {
    if (!entry.prefix) return { kind: "unknown", pathname: "" };
    try {
      const listed = await store.list({ prefix: entry.prefix });
      for (const b of listed.objects) {
        if (b.size !== entry.size) continue;
        const got = await store.get(b.pathname);
        if (got && sha256(got.bytes) === entry.sha256) return { kind: "owned", pathname: b.pathname };
      }
      return { kind: "absent", pathname: "" };
    } catch {
      return { kind: "unknown", pathname: "" };
    }
  }
  // Including `created`: a write that succeeded is history, not a claim on the current bytes.
  return ownsCurrentBytes(store, entry.pathname, entry.sha256);
}

export async function cleanupManifestObjects(
  manifest: Manifest,
  stores: { destination: BlobStore; source: BlobStore | null },
  onProgress?: (m: Manifest) => void,
): Promise<CleanupResult> {
  const res: CleanupResult = { deleted: 0, alreadyGone: 0, skippedNotOwned: 0, inconclusive: 0, failed: 0, log: [] };
  for (const entry of manifest.objects) {
    const store = entry.storeRole === "private-destination" ? stores.destination : stores.source;
    if (!store) { entry.cleanupStatus = "cleanup-failed"; entry.cleanupNote = "store not configured"; res.failed++; onProgress?.(manifest); continue; }
    try {
      const own = await ownership(store, entry);
      const target = own.pathname;
      if (own.kind === "absent") { entry.cleanupStatus = "verified-gone"; res.alreadyGone++; res.log.push(`already gone: ${entry.storeRole} ${entry.pathname || `${entry.prefix}* (reservation never used)`}`); onProgress?.(manifest); continue; }
      if (own.kind === "not-ours") {
        entry.cleanupStatus = "skipped-not-owned";
        entry.cleanupNote = `an object exists at this pathname but its bytes are not the ones this run intended to write (recorded state=${entry.state}) — it was replaced or was never ours, so it is left untouched`;
        res.skippedNotOwned++;
        res.log.push(`SKIPPED (not ours): ${entry.storeRole} ${own.pathname}`);
        onProgress?.(manifest); continue;
      }
      if (own.kind === "unknown") {
        entry.cleanupStatus = "inconclusive";
        entry.cleanupNote = "the store could not be read, so ownership is unresolved — not deleted";
        res.inconclusive++;
        res.log.push(`INCONCLUSIVE: ${entry.storeRole} ${entry.pathname || entry.prefix + "*"}`);
        onProgress?.(manifest); continue;
      }
      if (entry.pathname === "") { entry.pathname = target; entry.state = "created"; entry.cleanupNote = "pathname resolved from the reserved prefix by matching bytes"; }
      await store.del(target);
      // Verify rather than assume: a delete that reported success and left the object behind is
      // exactly the failure mode this batch has been chasing.
      const after = await store.head(target);
      if (after) { entry.cleanupStatus = "cleanup-failed"; entry.cleanupNote = "still present after delete"; res.failed++; res.log.push(`FAILED: ${target} still present`); }
      else { entry.cleanupStatus = "verified-gone"; res.deleted++; res.log.push(`deleted: ${entry.storeRole} ${target}`); }
    } catch (e) {
      entry.cleanupStatus = "cleanup-failed";
      entry.cleanupNote = String(e);
      res.failed++;
      res.log.push(`FAILED: ${entry.pathname}`);
    }
    onProgress?.(manifest);
  }
  return res;
}

export type DbCleanupResult = { removed: number; failed: number; log: string[] };

/**
 * Remove each disposable test organization, ROOTED AT THE ORG.
 *
 * The schema supports this and it was measured rather than assumed: of the 53 foreign keys that
 * reference orgs, 52 are ON DELETE CASCADE and the one exception is audit_logs.org_id, which is SET
 * NULL by design (the audit tables are append-only and carry an immutability trigger). Deleting the
 * org therefore removes its users, documents, line items and every other fixture the PDF matrix
 * created, in one dependency-correct step — no hand-maintained table list to fall out of date.
 *
 * The user is deleted first anyway, so the ordering is correct even if a future schema change
 * weakens that FK, and the result is VERIFIED afterwards across every table the harness writes to
 * rather than trusting the cascade to have happened.
 */
/**
 * Tables the harness and its PDF fixtures write into that carry their own org_id, so the org alone
 * locates every row.
 */
const ORG_SCOPED_TABLES = [
  "users", "customers", "vendors", "products", "bank_accounts", "quotations", "sales_orders",
  "proforma_invoices", "sales_invoices", "delivery_challans", "credit_notes", "purchase_orders",
  "debit_notes", "payments", "document_attachments", "file_access_logs",
];

/**
 * Tables that carry NO org_id: a line item belongs to its document, and the document belongs to the
 * organization. They were previously queried as if `where org_id = $1` worked, which threw every
 * time — and the error was swallowed into "0 leftovers", so eight tables reported themselves clean
 * without ever being looked at. (The FK column is `invoice_id` on sales_invoice_items, not the
 * `sales_invoice_id` a pattern would predict; that is exactly the kind of mistake the swallow hid.)
 *
 * They are verified in two steps instead: capture the exact ids through the parent BEFORE the
 * delete, then after the cascade query those ids DIRECTLY. A post-delete join would be worthless —
 * with the parent gone, an orphaned child joins to nothing and looks like success.
 */
const CHILD_FIXTURE_TABLES: { table: string; fk: string; parent: string }[] = [
  { table: "quotation_items", fk: "quotation_id", parent: "quotations" },
  { table: "sales_order_items", fk: "sales_order_id", parent: "sales_orders" },
  { table: "proforma_invoice_items", fk: "proforma_invoice_id", parent: "proforma_invoices" },
  { table: "sales_invoice_items", fk: "invoice_id", parent: "sales_invoices" },
  { table: "delivery_challan_items", fk: "delivery_challan_id", parent: "delivery_challans" },
  { table: "credit_note_items", fk: "credit_note_id", parent: "credit_notes" },
  { table: "purchase_order_items", fk: "purchase_order_id", parent: "purchase_orders" },
  { table: "debit_note_items", fk: "debit_note_id", parent: "debit_notes" },
];

/** Total tables verified after the cascade, named in the log so the claim is checkable. */
export const VERIFIED_TABLE_COUNT = ORG_SCOPED_TABLES.length + CHILD_FIXTURE_TABLES.length + 1;

export async function cleanupTestOrgs(
  manifest: Manifest,
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  onProgress?: (m: Manifest) => void,
): Promise<DbCleanupResult> {
  const res: DbCleanupResult = { removed: 0, failed: 0, log: [] };
  for (const org of manifest.testOrgs) {
    try {
      // The email is the locator recorded before registration, so a crash that lost the orgId still
      // leaves an exact way back to this one organization. Never a LIKE pattern.
      let orgId = org.orgId;
      if (orgId === null) {
        const found = await db.query("select org_id from users where email=$1", [org.email]);
        orgId = found.rows.length ? Number(found.rows[0].org_id) : null;
        if (orgId !== null) { org.orgId = orgId; onProgress?.(manifest); }
      }
      if (orgId === null) { org.cleanupStatus = "verified-gone"; res.log.push(`no such test user: ${org.email}`); onProgress?.(manifest); continue; }

      // Capture the child fixture ids while their parents still exist. Recorded in the manifest and
      // persisted, so a crash between here and the verification does not lose the only handle on
      // rows that no longer have a parent to be found through.
      const childIds: Record<string, number[]> = org.childFixtureIds ?? {};
      for (const { table, fk, parent } of CHILD_FIXTURE_TABLES) {
        const r = await db.query(
          `select c.id from "${table}" c join "${parent}" p on c."${fk}" = p.id where p.org_id=$1`,
          [orgId],
        );
        childIds[table] = r.rows.map((row) => Number(row.id));
      }
      org.childFixtureIds = childIds;
      onProgress?.(manifest);

      await db.query("delete from users where email=$1", [org.email]);
      await db.query("delete from orgs where id=$1", [orgId]);

      // Verify. A cascade that silently did not fire would otherwise leave a disposable org's rows
      // behind while cleanup reported success. NOTHING here is wrapped in a catch that yields zero:
      // a verification query that fails has not verified anything, and the whole org is reported
      // failed so the command exits non-zero.
      const leftovers: string[] = [];
      for (const table of ORG_SCOPED_TABLES) {
        const r = await db.query(`select count(*)::int as c from "${table}" where org_id=$1`, [orgId]);
        const c = Number(r.rows[0]?.c ?? 0);
        if (c > 0) leftovers.push(`${table}=${c}`);
      }
      for (const { table } of CHILD_FIXTURE_TABLES) {
        const ids = childIds[table] ?? [];
        if (!ids.length) continue;
        // By id, with no join: an orphaned child whose parent is gone must still be found.
        const r = await db.query(`select count(*)::int as c from "${table}" where id = any($1::int[])`, [ids]);
        const c = Number(r.rows[0]?.c ?? 0);
        if (c > 0) leftovers.push(`${table}=${c} of ${ids.length} (orphaned by id)`);
      }
      const orgGone = Number((await db.query("select count(*)::int as c from orgs where id=$1", [orgId])).rows[0].c) === 0;
      const userGone = Number((await db.query("select count(*)::int as c from users where email=$1", [org.email])).rows[0].c) === 0;

      if (!orgGone || !userGone || leftovers.length) {
        org.cleanupStatus = "cleanup-failed";
        org.cleanupNote = `orgGone=${orgGone} userGone=${userGone} leftovers=${leftovers.join(",") || "none"}`;
        res.failed++;
        res.log.push(`FAILED org ${orgId} (${org.email}): ${org.cleanupNote}`);
      } else {
        org.cleanupStatus = "verified-gone";
        res.removed++;
        const childCount = Object.values(childIds).reduce((n, ids) => n + ids.length, 0);
        res.log.push(`removed org ${orgId} (${org.email}); verified ${VERIFIED_TABLE_COUNT} tables, including ${childCount} child fixture row(s) checked by id`);
      }
    } catch (e) {
      org.cleanupStatus = "cleanup-failed";
      org.cleanupNote = String(e);
      res.failed++;
      // A verification query that threw proves nothing about the rows it was meant to count.
      res.log.push(`FAILED org cleanup for ${org.email}: ${String(e).split("\n")[0]}`);
    }
    onProgress?.(manifest);
  }
  return res;
}
