/**
 * READ-ONLY inventory of BOTH Blob stores against the database. Writes nothing, to either store.
 *
 *   npm run blob:inventory -- [--json out.json] [--folder <name>]
 *
 * Access belongs to the STORE in Vercel Blob, so migration is a copy from the legacy PUBLIC SOURCE
 * store into the PRIVATE DESTINATION store at the same pathname. This reports each store on its own
 * terms and then reconciles them, because "how many objects are there" is not one number any more.
 *
 * THE ATTACHMENT ORPHAN RULE. Unreferenced objects under organizations/{orgId}/attachments/ are
 * reported as UNREFERENCED ATTACHMENT — PRESERVE / MANUAL REVIEW and never as garbage. Until the
 * hotfix in d3694a6, persistDocumentAttachments silently dropped every staged attachment: the file
 * reached the store and its DB row never existed. Those objects are the only trace of attachments
 * real users uploaded. Nothing here proposes deleting them, and nothing here deletes anything.
 */
import { Client } from "pg";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { destinationStore, sourceStore, type BlobStore, type BlobObject } from "../src/lib/storage/blob-client";
import { BLOB_FOLDERS } from "../src/lib/storage/blob-storage";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const onlyFolder = arg("folder");
const jsonOut = arg("json");
const withHash = process.argv.includes("--hash");

const REFERENCE_COLUMNS_SQL = `
  select table_name, column_name from information_schema.columns
   where table_schema='public' and data_type in ('text','character varying')
     and (column_name ilike '%url%' or column_name ilike '%photo%' or column_name ilike '%logo%'
       or column_name ilike '%seal%' or column_name ilike '%signature%' or column_name ilike '%image%')
   order by 1,2`;

const folderOf = (p: string) => (p.split("/").length >= 4 ? p.split("/")[2] : "(unknown)");

async function listAll(store: BlobStore): Promise<BlobObject[]> {
  const out: BlobObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list({ prefix: "organizations/", cursor, limit: 1000 });
    for (const o of page.objects) if (!onlyFolder || folderOf(o.pathname) === onlyFolder) out.push(o);
    cursor = page.cursor;
  } while (cursor);
  return out;
}

function summarize(objects: BlobObject[], referenced: Map<string, string[]>) {
  return {
    objects: objects.length,
    bytes: objects.reduce((a, b) => a + b.size, 0),
    referenced: objects.filter((o) => referenced.has(o.pathname)).length,
    unreferenced: objects.filter((o) => !referenced.has(o.pathname)).length,
    byFolder: Object.fromEntries((BLOB_FOLDERS as readonly string[]).map((f) => {
      const inF = objects.filter((o) => folderOf(o.pathname) === f);
      return [f, { objects: inF.length, bytes: inF.reduce((a, b) => a + b.size, 0), referenced: inF.filter((o) => referenced.has(o.pathname)).length, unreferenced: inF.filter((o) => !referenced.has(o.pathname)).length }];
    })),
  };
}

async function hashOf(store: BlobStore, pathname: string): Promise<string | null> {
  const r = await store.get(pathname);
  return r ? createHash("sha256").update(r.bytes).digest("hex") : null;
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const cols = (await db.query(REFERENCE_COLUMNS_SQL)).rows as { table_name: string; column_name: string }[];
  const referenced = new Map<string, string[]>();
  for (const { table_name, column_name } of cols) {
    const q = `select distinct "${column_name}" as v from "${table_name}" where "${column_name}" like '/uploads/organizations/%'`;
    for (const r of (await db.query(q)).rows as { v: string }[]) {
      const p = r.v.replace(/^\/uploads\//, "");
      if (!referenced.has(p)) referenced.set(p, []);
      referenced.get(p)!.push(`${table_name}.${column_name}`);
    }
  }

  const dest = destinationStore();
  const src = sourceStore();
  const destObjects = await listAll(dest);
  const srcObjects = src ? await listAll(src) : [];

  const destMap = new Map(destObjects.map((o) => [o.pathname, o]));
  const srcMap = new Map(srcObjects.map((o) => [o.pathname, o]));
  const all = new Set<string>([...destMap.keys(), ...srcMap.keys()]);

  const inBoth: string[] = [], publicOnly: string[] = [], privateOnly: string[] = [], sizeMismatch: { pathname: string; source: number; destination: number }[] = [];
  for (const p of all) {
    const d = destMap.get(p), s = srcMap.get(p);
    if (d && s) { inBoth.push(p); if (d.size !== s.size) sizeMismatch.push({ pathname: p, source: s.size, destination: d.size }); }
    else if (s) publicOnly.push(p);
    else privateOnly.push(p);
  }

  // Hashing reads every object in both stores, so it is opt-in. Where it runs it is the only
  // reconciliation signal that actually proves the bytes match; size agreement does not.
  const hashMismatch: string[] = [];
  if (withHash && src) {
    for (const p of inBoth) {
      const [a, b] = [await hashOf(src, p), await hashOf(dest, p)];
      if (a && b && a !== b) hashMismatch.push(p);
    }
  }

  const dbRefWithNeither = [...referenced.keys()].filter((p) => !all.has(p));
  const attachmentOrphans = [...all].filter((p) => folderOf(p) === "attachments" && !referenced.has(p));

  // Which of the public source objects an anonymous caller can still fetch — the exposure the
  // migration exists to close. Always zero for the private store, which is the point of it.
  // Three outcomes, never two. A probe that could not answer is its own category: folding it into
  // "not publicly readable" would report an unreachable store as a fully private one, which is the
  // most dangerous possible direction for this number to be wrong in.
  const exposure = { publiclyReadable: [] as string[], anonymousDenied: [] as string[], probeFailed: [] as { pathname: string; reason: string }[] };
  const probeStore = async (store: BlobStore, objects: BlobObject[]) => {
    for (const o of objects) {
      try {
        const r = await store.probeAnonymous(o.pathname);
        if (r.state === "readable") exposure.publiclyReadable.push(o.pathname);
        else exposure.anonymousDenied.push(o.pathname);
      } catch (e) {
        exposure.probeFailed.push({ pathname: o.pathname, reason: String(e) });
      }
    }
  };
  if (src) await probeStore(src, srcObjects);
  await probeStore(dest, destObjects);

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    stores: {
      publicSource: src ? { present: true, mode: src.mode, ...summarize(srcObjects, referenced) } : { present: false, note: "no source token configured — the legacy public store is retired or was never set" },
      privateDestination: { present: true, mode: dest.mode, ...summarize(destObjects, referenced) },
    },
    exposure: {
      publiclyReadable: exposure.publiclyReadable.length,
      anonymousDenied: exposure.anonymousDenied.length,
      probeFailed: exposure.probeFailed.length,
      authoritative: exposure.probeFailed.length === 0,
      note: exposure.probeFailed.length
        ? "NOT AUTHORITATIVE for exposure: at least one anonymous probe could not answer, so those objects' public readability is UNKNOWN — not private. Resolve them before relying on these counts."
        : "every object produced an explicit provider answer",
      publiclyReadablePathnames: exposure.publiclyReadable,
      probeFailures: exposure.probeFailed,
    },
    reconciliation: {
      inBoth: inBoth.length,
      publicOnly: publicOnly.length,      // still to migrate
      privateOnly: privateOnly.length,    // uploaded after the cutover, or already migrated + source retired
      sizeMismatch,
      hashMismatch: withHash ? hashMismatch : "not computed (pass --hash)",
      dbReferenceWithNeitherObject: dbRefWithNeither,
      publicOnlyPathnames: publicOnly,
      privateOnlyPathnames: privateOnly,
    },
    attachmentOrphans: {
      classification: "UNREFERENCED ATTACHMENT — PRESERVE / MANUAL REVIEW",
      note: "Possible lost attachments from the pre-d3694a6 persistence defect. Migrate them like anything else; never delete, purge or overwrite.",
      count: attachmentOrphans.length,
      pathnames: attachmentOrphans,
    },
  };

  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(report, null, 2)); console.log(`wrote ${jsonOut}`); }
  console.log(JSON.stringify(report, null, 2));
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
