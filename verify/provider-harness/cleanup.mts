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
 * THE ORG IS THE ONLY ROW DELETED, and that is load-bearing rather than tidy. An earlier version
 * deleted the user first, on the theory that doing so was harmless and would survive a future
 * schema change weakening users.org_id. It is not harmless: a disposable org's own documents
 * reference its user with ON DELETE NO ACTION —
 *
 *   quotations.created_by_id -> users.id    ON DELETE NO ACTION
 *
 * — so the explicit delete hit that constraint and rolled the whole transaction back, which is
 * exactly what happened on the first live run (org 4 had created no quotation and was removed; org
 * 3 had one and failed). Deleting the ORG lets PostgreSQL discharge the graph in dependency order:
 * quotations go with the org, which frees the user, which users.org_id CASCADE then removes. Adding
 * a manual first step only re-imposes an ordering the database already had right.
 *
 * The result is still VERIFIED afterwards — the org row, the exact recorded user, every org-scoped
 * table and every captured child id — rather than trusting the cascade to have fired.
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

/**
 * The two append-only triggers installed by drizzle/immutable_audit.sql. They reject every UPDATE
 * and DELETE on the audit tables — which is exactly right in production, and exactly what stops a
 * disposable organization from being deleted: audit_logs.org_id and .user_id are ON DELETE SET
 * NULL, so removing the org makes PostgreSQL attempt an UPDATE on an immutable table, and
 * security_events.org_id is ON DELETE CASCADE, which attempts a DELETE on another.
 *
 * Cleanup therefore suspends THESE TWO TRIGGERS ONLY, inside the transaction that removes one
 * manifest-owned organization, and re-enables them before committing. Not DISABLE TRIGGER ALL,
 * not DISABLE TRIGGER USER, not dropping reject_mutation(), and nothing outside the transaction:
 * ALTER TABLE ... DISABLE TRIGGER is transactional in PostgreSQL, so a ROLLBACK restores the
 * previous state even if the process dies mid-way.
 */
const IMMUTABLE_TRIGGERS: { trigger: string; table: string }[] = [
  { trigger: "audit_logs_immutable", table: "audit_logs" },
  { trigger: "security_events_immutable", table: "security_events" },
];

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/**
 * What the database says about the two triggers right now: attached to the expected table, and
 * enabled. 'O' is the normal enabled state; 'D' is disabled. Anything else ('R', 'A' — replica
 * modes) is not the state this cleanup expects and is treated as not-enabled.
 */
async function immutableTriggerState(db: Db): Promise<{ trigger: string; table: string; present: boolean; enabled: boolean; tgenabled?: string }[]> {
  const out = [];
  for (const { trigger, table } of IMMUTABLE_TRIGGERS) {
    const r = await db.query(
      "select t.tgenabled::text as tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = $1 and c.relname = $2 and not t.tgisinternal",
      [trigger, table],
    );
    const tgenabled = r.rows.length ? String(r.rows[0].tgenabled) : undefined;
    out.push({ trigger, table, present: r.rows.length > 0, enabled: tgenabled === "O", tgenabled });
  }
  return out;
}

const describeTriggers = (state: Awaited<ReturnType<typeof immutableTriggerState>>) =>
  state.map((t) => `${t.trigger}=${!t.present ? "MISSING" : t.enabled ? "enabled" : `tgenabled=${t.tgenabled}`}`).join(", ");

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

      // OWNERSHIP, PROVED AGAINST THE DATABASE. The manifest carries an email and an org id; before
      // anything is deleted they must still agree. If the recorded address does not belong to the
      // recorded organization, something has changed since the run and this cleanup no longer knows
      // what it would be deleting, so it refuses rather than guessing.
      const owner = await db.query("select org_id from users where email=$1", [org.email]);
      if (!owner.rows.length) {
        org.cleanupStatus = "verified-gone";
        res.log.push(`no such test user: ${org.email} (org ${orgId} not deleted — its recorded user is already gone)`);
        onProgress?.(manifest); continue;
      }
      if (Number(owner.rows[0].org_id) !== orgId) {
        org.cleanupStatus = "cleanup-failed";
        org.cleanupNote = `ownership mismatch: ${org.email} belongs to org ${Number(owner.rows[0].org_id)}, not the recorded ${orgId} — refusing to delete either`;
        res.failed++;
        res.log.push(`FAILED org ${orgId} (${org.email}): ${org.cleanupNote}`);
        onProgress?.(manifest); continue;
      }

      // PRECONDITION, BEFORE ANY MUTATION. Both triggers must exist, be attached to the expected
      // table, and be enabled. A database where one is already missing or already disabled is not
      // the hardened disposable database this cleanup was told it was pointed at, and the honest
      // response is to stop rather than to delete rows and leave the hardening however it was.
      const before = await immutableTriggerState(db);
      const badBefore = before.filter((t) => !t.present || !t.enabled);
      if (badBefore.length) {
        org.cleanupStatus = "cleanup-failed";
        org.cleanupNote = `append-only hardening is not in the expected state before cleanup (${describeTriggers(before)}) — refusing to delete anything`;
        res.failed++;
        res.log.push(`FAILED org ${orgId} (${org.email}): ${org.cleanupNote}`);
        onProgress?.(manifest); continue;
      }

      // ONE TRANSACTION, ALL OR NOTHING.
      let committed = false;
      let failure = "";
      await db.query("BEGIN");
      try {
        for (const { trigger, table } of IMMUTABLE_TRIGGERS) {
          await db.query(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
        }

        // ORG-ROOTED, and only the org. See the header: an explicit user delete violates
        // quotations.created_by_id (ON DELETE NO ACTION); the cascade from orgs removes the
        // documents first and the user with them, in an order the database already knows.
        await db.query("delete from orgs where id=$1", [orgId]);

        // Verify INSIDE the transaction, so a cascade that did not fire rolls the deletion back
        // rather than leaving a half-removed organization behind.
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
          failure = `orgGone=${orgGone} userGone=${userGone} leftovers=${leftovers.join(",") || "none"}`;
          throw new Error(failure);
        }

        // Re-enable BEFORE commit, and prove it took. Committing with either trigger still disabled
        // would leave the database permanently unhardened while cleanup reported success.
        for (const { trigger, table } of IMMUTABLE_TRIGGERS) {
          await db.query(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
        }
        const after = await immutableTriggerState(db);
        if (after.some((t) => !t.present || !t.enabled)) {
          failure = `append-only hardening was not restored (${describeTriggers(after)})`;
          throw new Error(failure);
        }

        await db.query("COMMIT");
        committed = true;
      } catch (e) {
        failure = failure || String(e);
        try { await db.query("ROLLBACK"); } catch { /* reported below via the trigger re-check */ }
      }

      if (!committed) {
        // ALTER TABLE ... DISABLE TRIGGER is transactional, so the rollback should have restored
        // both triggers. Re-read rather than assume, and say what was found either way: a cleanup
        // that failed AND left the database unhardened is a different, worse problem.
        let restored = "trigger state unknown after rollback";
        try {
          const state = await immutableTriggerState(db);
          restored = state.every((t) => t.present && t.enabled)
            ? "append-only hardening verified intact after rollback"
            : `APPEND-ONLY HARDENING NOT INTACT AFTER ROLLBACK (${describeTriggers(state)}) — inspect this database before using it again`;
        } catch (e) { restored = `could not re-check hardening after rollback: ${String(e).split("\n")[0]}`; }
        org.cleanupStatus = "cleanup-failed";
        org.cleanupNote = `${failure}; rolled back; ${restored}`;
        res.failed++;
        res.log.push(`FAILED org ${orgId} (${org.email}): ${org.cleanupNote}`);
        onProgress?.(manifest); continue;
      }

      {
        org.cleanupStatus = "verified-gone";
        res.removed++;
        const childCount = Object.values(childIds).reduce((n, ids) => n + ids.length, 0);
        res.log.push(`removed org ${orgId} (${org.email}); verified ${VERIFIED_TABLE_COUNT} tables, including ${childCount} child fixture row(s) checked by id; append-only hardening restored before commit`);
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
