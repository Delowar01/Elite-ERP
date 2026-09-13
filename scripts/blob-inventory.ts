/**
 * READ-ONLY inventory of the Blob store against the database. Writes nothing, anywhere.
 *
 *   npm run blob:inventory -- [--json out.json] [--folder <name>]
 *
 * Answers the questions the migration has to answer before it can run: how many objects exist, how
 * many the application still references, how they split by folder, which ones nothing points at,
 * which referenced paths have no object behind them, how many are still PUBLICLY readable, which
 * are byte-identical duplicates, and how many bytes the whole thing is.
 *
 * THE ATTACHMENT ORPHAN RULE. Unreferenced objects under organizations/{orgId}/attachments/ are
 * reported as UNREFERENCED ATTACHMENT — PRESERVE / MANUAL REVIEW and never as garbage. Until the
 * hotfix in d3694a6, persistDocumentAttachments silently dropped every staged attachment: the file
 * reached the store and its DB row never existed. Those objects are the only trace of attachments
 * real users uploaded, so nothing here may propose deleting them, and the migration must not purge
 * or overwrite them.
 */
import { Client } from "pg";
import { writeFileSync } from "node:fs";
import { blobClient } from "../src/lib/storage/blob-client";
import { BLOB_FOLDERS } from "../src/lib/storage/blob-storage";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const onlyFolder = arg("folder");
const jsonOut = arg("json");

// Every text column that can hold an upload path, discovered rather than hardcoded so a new column
// cannot quietly make an object look orphaned.
const REFERENCE_COLUMNS_SQL = `
  select table_name, column_name from information_schema.columns
   where table_schema='public' and data_type in ('text','character varying')
     and (column_name ilike '%url%' or column_name ilike '%photo%' or column_name ilike '%logo%'
       or column_name ilike '%seal%' or column_name ilike '%signature%' or column_name ilike '%image%')
   order by 1,2`;

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const cols = (await db.query(REFERENCE_COLUMNS_SQL)).rows as { table_name: string; column_name: string }[];
  const referenced = new Map<string, string[]>(); // pathname -> where it is referenced from
  for (const { table_name, column_name } of cols) {
    const q = `select distinct "${column_name}" as v from "${table_name}" where "${column_name}" like '/uploads/organizations/%'`;
    for (const r of (await db.query(q)).rows as { v: string }[]) {
      const pathname = r.v.replace(/^\/uploads\//, "");
      if (!referenced.has(pathname)) referenced.set(pathname, []);
      referenced.get(pathname)!.push(`${table_name}.${column_name}`);
    }
  }

  const client = blobClient();
  const objects: { pathname: string; size: number; folder: string; orgId: number | null }[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.list({ prefix: "organizations/", cursor, limit: 1000 });
    for (const o of page.objects) {
      const seg = o.pathname.split("/");
      const folder = seg.length >= 4 ? seg[2] : "(unknown)";
      if (onlyFolder && folder !== onlyFolder) continue;
      objects.push({ pathname: o.pathname, size: o.size, folder, orgId: Number(seg[1]) || null });
    }
    cursor = page.cursor;
  } while (cursor);

  // Public probe. `list`/`head` do not report an access level, so the only way to learn whether an
  // object is still anonymously readable is to ask for it anonymously. GET rather than HEAD, because
  // "the bytes come back" is the actual exposure. Read-only by construction.
  let probed = true;
  const publicOnes: string[] = [];
  try {
    for (const o of objects) if (await client.probePublic(o.pathname)) publicOnes.push(o.pathname);
  } catch {
    probed = false;
  }

  const objectPaths = new Set(objects.map((o) => o.pathname));
  const orphans = objects.filter((o) => !referenced.has(o.pathname));
  const missing = [...referenced.keys()].filter((p) => !objectPaths.has(p));

  // Duplicates: identical size within the same folder is the only signal available without reading
  // every object, so this is a CANDIDATE list, not a confirmed one. Never used to delete anything.
  const bySizeFolder = new Map<string, string[]>();
  for (const o of objects) {
    const k = `${o.folder}:${o.size}`;
    if (!bySizeFolder.has(k)) bySizeFolder.set(k, []);
    bySizeFolder.get(k)!.push(o.pathname);
  }
  const duplicateCandidates = [...bySizeFolder.entries()].filter(([, v]) => v.length > 1);

  const byFolder = Object.fromEntries(
    (BLOB_FOLDERS as readonly string[]).map((f) => {
      const inF = objects.filter((o) => o.folder === f);
      return [f, {
        objects: inF.length,
        bytes: inF.reduce((a, b) => a + b.size, 0),
        referenced: inF.filter((o) => referenced.has(o.pathname)).length,
        unreferenced: inF.filter((o) => !referenced.has(o.pathname)).length,
        publiclyReadable: inF.filter((o) => publicOnes.includes(o.pathname)).length,
      }];
    }),
  );

  const attachmentOrphans = orphans.filter((o) => o.folder === "attachments");
  const otherOrphans = orphans.filter((o) => o.folder !== "attachments");

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    totals: {
      objects: objects.length,
      bytes: objects.reduce((a, b) => a + b.size, 0),
      referenced: objects.length - orphans.length,
      unreferenced: orphans.length,
      publiclyReadable: probed ? publicOnes.length : null,
      publicProbe: probed ? "performed" : "SKIPPED — the store could not be probed (no token?)",
      referencedPathsWithNoObject: missing.length,
    },
    byFolder,
    attachmentOrphans: {
      classification: "UNREFERENCED ATTACHMENT — PRESERVE / MANUAL REVIEW",
      note: "Possible lost attachments from the pre-d3694a6 persistence defect. Do not delete, purge or overwrite.",
      count: attachmentOrphans.length,
      pathnames: attachmentOrphans.map((o) => o.pathname),
    },
    otherOrphans: { count: otherOrphans.length, pathnames: otherOrphans.map((o) => o.pathname) },
    referencedPathsWithNoObject: missing,
    publiclyReadable: publicOnes,
    duplicateCandidates: duplicateCandidates.map(([k, v]) => ({ key: k, pathnames: v })),
  };

  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(report, null, 2)); console.log(`wrote ${jsonOut}`); }
  console.log(JSON.stringify({ ...report, publiclyReadable: `${report.publiclyReadable.length} paths`, otherOrphans: { count: otherOrphans.length } }, null, 2));
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
