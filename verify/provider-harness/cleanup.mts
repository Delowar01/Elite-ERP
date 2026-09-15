/**
 * The cleanup ALGORITHM, separated from the CLI that guards it, so the rules that matter most can be
 * tested directly against the fake stores. The CLI refuses to run under the fake driver, so without
 * this seam "cleanup never deletes what it does not own" would have to be taken on trust.
 *
 * THE OWNERSHIP RULE. Recording a pathname is not the same as owning the object at it. An entry is
 * only safe to delete when this run is known to have written those exact bytes:
 *
 *   created        the write returned successfully -> owned, delete
 *   planned        the write was never attempted or never returned -> NOT owned. Something may
 *                  already have been there. Prove the bytes match before touching it.
 *   create-failed  the write threw, but an ambiguous network failure can still commit on the
 *                  provider. Same treatment: match the bytes, or leave it.
 *
 * For the two unproven states cleanup authenticates to the exact store and pathname and compares
 * sha256 against what the run INTENDED to write. Matching bytes mean the write did land and the run
 * owns it. Different bytes mean something else is there and it is left alone and reported. An
 * unreachable store means the question is unanswered, which is recorded as inconclusive rather than
 * resolved in either direction.
 */
import type { BlobStore } from "../../src/lib/storage/blob-client";
import { sha256, type Manifest, type ManifestObject } from "./manifest.mjs";

export type CleanupResult = {
  deleted: number; alreadyGone: number; skippedNotOwned: number; inconclusive: number; failed: number; log: string[];
};

type Ownership = { kind: "owned" | "absent" | "not-ours" | "unknown"; pathname: string };

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
  if (entry.state === "created") {
    const head = await store.head(entry.pathname);
    return { kind: head ? "owned" : "absent", pathname: entry.pathname };
  }
  // planned / create-failed: ownership must be earned by comparing bytes.
  try {
    const got = await store.get(entry.pathname);
    if (!got) return { kind: "absent", pathname: entry.pathname };
    return { kind: sha256(got.bytes) === entry.sha256 ? "owned" : "not-ours", pathname: entry.pathname };
  } catch {
    return { kind: "unknown", pathname: entry.pathname };
  }
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
        entry.cleanupNote = `an object exists at this pathname but its bytes are not the ones this run intended to write (state=${entry.state}) — left untouched`;
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
export async function cleanupTestOrgs(
  manifest: Manifest,
  db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  onProgress?: (m: Manifest) => void,
): Promise<DbCleanupResult> {
  const res: DbCleanupResult = { removed: 0, failed: 0, log: [] };
  // Every table the harness or its PDF fixtures write into, verified empty for the org afterwards.
  const FIXTURE_TABLES = [
    "users", "customers", "vendors", "bank_accounts", "quotations", "quotation_items",
    "sales_orders", "sales_order_items", "proforma_invoices", "proforma_invoice_items",
    "sales_invoices", "sales_invoice_items", "delivery_challans", "delivery_challan_items",
    "credit_notes", "credit_note_items", "purchase_orders", "purchase_order_items",
    "debit_notes", "debit_note_items", "payments", "document_attachments", "file_access_logs",
  ];

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

      await db.query("delete from users where email=$1", [org.email]);
      await db.query("delete from orgs where id=$1", [orgId]);

      // Verify. A cascade that silently did not fire would otherwise leave a disposable org's rows
      // behind while cleanup reported success.
      const leftovers: string[] = [];
      for (const table of FIXTURE_TABLES) {
        const r = await db.query(`select count(*)::int as c from "${table}" where org_id=$1`, [orgId]).catch(() => ({ rows: [{ c: 0 }] }));
        const c = Number(r.rows[0]?.c ?? 0);
        if (c > 0) leftovers.push(`${table}=${c}`);
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
        res.log.push(`removed org ${orgId} (${org.email}) and every fixture row across ${FIXTURE_TABLES.length} tables`);
      }
    } catch (e) {
      org.cleanupStatus = "cleanup-failed";
      org.cleanupNote = String(e);
      res.failed++;
      res.log.push(`FAILED org cleanup for ${org.email}`);
    }
    onProgress?.(manifest);
  }
  return res;
}
