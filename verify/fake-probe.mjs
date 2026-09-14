/**
 * Reads the test storage driver's on-disk state directly, from the TEST process.
 *
 * Deliberately an independent reader rather than an import of the application's own fake: if the
 * suite inspected storage through the same code the server writes with, a bug in that code would
 * cancel itself out and the assertions would pass on a shared mistake.
 *
 * The driver models TWO STORES with fixed modes, each in its own directory, because that is how
 * Vercel Blob works — access belongs to the store, not the object.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = (mode) => join(process.env.STORAGE_FAKE_DIR || ".storage-fake", mode);

/** Does this store hold the object? */
export function existsIn(mode, pathname) {
  return existsSync(join(root(mode), pathname));
}

/** Bytes as they sit in that store, or null. */
export function bytesIn(mode, pathname) {
  const f = join(root(mode), pathname);
  return existsSync(f) ? readFileSync(f) : null;
}

/**
 * An ANONYMOUS request straight at the provider, bypassing the application — the leaked-URL case.
 * A PUBLIC store serves anyone holding the URL; a PRIVATE store does not. The STORE decides, which
 * is the whole correction: there is no such thing as a private object in a public store.
 */
export function anonymousRead(mode, pathname) {
  return mode === "public" ? bytesIn(mode, pathname) : null;
}

/** Every pathname a store holds. */
export function listIn(mode) {
  const base = root(mode);
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (!p.endsWith(".__meta.json")) out.push(p.slice(base.length + 1).split(/[\\/]/).join("/"));
    }
  };
  walk(base);
  return out.sort();
}
