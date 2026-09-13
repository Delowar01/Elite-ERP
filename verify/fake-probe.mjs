/**
 * Reads the test storage driver's on-disk state directly, from the TEST process.
 *
 * Deliberately an independent reader rather than an import of the application's own fake: if the
 * suite inspected storage through the same code the server writes with, a bug in that code would
 * cancel itself out and the assertions would pass on a shared mistake.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = () => process.env.STORAGE_FAKE_DIR || ".storage-fake";
const meta = (pathname) => {
  const f = join(root(), pathname) + ".__meta.json";
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
};

/** How the object was actually written, or undefined when it does not exist. */
export function fakeStoredAccess(pathname) {
  return meta(pathname)?.access;
}

/**
 * An ANONYMOUS request straight at the storage provider, bypassing the application — the "leaked
 * absolute Blob URL" in the threat model. Public objects give up their bytes; private objects do
 * not. This models the provider rule; it is not evidence about Vercel's real enforcement.
 */
export function fakeProviderRead(pathname) {
  const m = meta(pathname);
  if (!m || m.access !== "public") return null;
  const f = join(root(), pathname);
  return existsSync(f) ? readFileSync(f) : null;
}
