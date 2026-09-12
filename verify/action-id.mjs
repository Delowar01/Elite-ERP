/**
 * Resolve a server action's Next-Action id from the build's server-reference-manifest.
 *
 * The manifest is a Next INTERNAL and its shape moved in 16.3: `exportedName` used to sit on each
 * per-route worker (node[id].workers[<route>].exportedName) and now sits on the entry itself
 * (node[id].exportedName, next to a new `filename`), with workers reduced to
 * {moduleId, async, codeHash}. Eight replay suites each carried their own copy of the worker-shaped
 * lookup, so the 16.2.10 -> 16.3.5 upgrade turned all eight into "Server action not found" in one
 * step — the application was fine, every one of its ids was in the manifest, and the harness was
 * looking one level too deep.
 *
 * Reading BOTH shapes from ONE place is the point: a suite that hardcodes a vendor's internal
 * layout is a suite that will break again, and eight copies of it break together while looking like
 * eight independent findings.
 */
import { readFile } from "node:fs/promises";

const DEFAULT_MANIFEST = ".next/server/server-reference-manifest.json";

/**
 * @param {string} [manifestPath]
 * @returns {Promise<(exportedName: string) => string | null>} exported action name -> Next-Action id
 */
export async function loadActionIds(manifestPath = DEFAULT_MANIFEST) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const node = manifest.node ?? {};
  return (name) => {
    for (const [id, entry] of Object.entries(node)) {
      if (entry?.exportedName === name) return id; // Next >= 16.3
      for (const w of Object.values(entry?.workers ?? {})) {
        if (w?.exportedName === name) return id; // Next <= 16.2
      }
    }
    return null;
  };
}
