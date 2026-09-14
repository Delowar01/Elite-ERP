import "server-only";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { BlobExistsError, type BlobStore, type StoreMode, type StoreRole } from "./blob-client";

// ---------------------------------------------------------------------------
// Test-only stand-in for Vercel Blob. Reachable ONLY under STORAGE_DRIVER=fake.
//
// TWO STORES WITH FIXED MODES, because that is the shape of the real thing: a
// store is created public or private and never changes. Each fake store owns a
// separate directory, so an object in one is simply not in the other and the
// migration has to copy bytes across a boundary that actually exists.
//
// The previous version modelled `access` as a per-object property inside a
// single directory, which made the impossible one-store migration look like it
// worked. This one makes that migration unrepresentable: no method takes an
// access argument, a store's mode is set at construction, and
// assertMode() refuses an operation aimed at the wrong access level — so a test
// that tries to write "private" into the public store fails loudly instead of
// quietly succeeding.
//
// It also models allowOverwrite: writing an existing pathname throws
// BlobExistsError unless the caller opts in, matching the SDK's default.
//
// NOT EVIDENCE ABOUT VERCEL. This proves what the application does. Whether a
// real private object refuses an anonymous GET is provider behaviour:
// REAL PROVIDER VERIFICATION PENDING.
// ---------------------------------------------------------------------------

type Sidecar = { contentType: string; uploadedAt: string };

function rootFor(mode: StoreMode): string {
  const base = process.env.STORAGE_FAKE_DIR || ".storage-fake";
  return join(base, mode); // separate directories: the stores cannot see each other
}

const safe = (p: string) => p.replace(/\.\./g, "__").replace(/^\/+/, "");
const fileOf = (mode: StoreMode, p: string) => join(rootFor(mode), safe(p));
const metaOf = (mode: StoreMode, p: string) => `${fileOf(mode, p)}.__meta.json`;

function readMeta(mode: StoreMode, p: string): Sidecar | null {
  const m = metaOf(mode, p);
  if (!existsSync(m)) return null;
  try { return JSON.parse(readFileSync(m, "utf8")) as Sidecar; } catch { return null; }
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (!p.endsWith(".__meta.json")) out.push(p);
  }
  return out;
}

export function fakeStore(role: StoreRole, mode: StoreMode): BlobStore {
  return {
    role,
    mode,

    async put(pathname, bytes, { contentType, allowOverwrite = false }) {
      const f = fileOf(mode, pathname);
      if (!allowOverwrite && existsSync(f)) throw new BlobExistsError(pathname);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, bytes);
      writeFileSync(metaOf(mode, pathname), JSON.stringify({ contentType, uploadedAt: new Date().toISOString() } satisfies Sidecar));
    },

    async get(pathname) {
      // A configurable fault, so a suite can prove that a READ FAILURE does not masquerade as
      // "absent" and trigger the migration fallback. Without it that distinction is untestable.
      //
      // It is scoped to ONE ROLE (default: destination) and that is load-bearing. Failing both
      // stores made the assertion pass for the wrong reason: the fallback swallowed the destination
      // error, then the SOURCE read threw the same injected error, so something threw either way
      // and a broken fallback looked correct. The fault has to hit the destination alone for the
      // test to distinguish "propagated" from "fell through and happened to throw later".
      const failRole = process.env.STORAGE_FAKE_FAIL_READ_ROLE ?? "destination";
      if (process.env.STORAGE_FAKE_FAIL_READ && role === failRole && pathname.includes(process.env.STORAGE_FAKE_FAIL_READ)) {
        throw new Error(`fake ${mode} store (${role}): injected read failure for ${pathname}`);
      }
      const meta = readMeta(mode, pathname);
      const f = fileOf(mode, pathname);
      if (!meta || !existsSync(f)) return null;
      return { bytes: readFileSync(f), contentType: meta.contentType };
    },

    async del(pathname) {
      // A configurable fault, scoped to one store ROLE, so a suite can prove that a delete which
      // FAILS is reported as a failure rather than swallowed — and that a failure in one store
      // still lets the other store be attempted.
      const failRole = process.env.STORAGE_FAKE_FAIL_DELETE_ROLE ?? "destination";
      if (process.env.STORAGE_FAKE_FAIL_DELETE && role === failRole && pathname.includes(process.env.STORAGE_FAKE_FAIL_DELETE)) {
        throw new Error(`fake ${mode} store (${role}): injected delete failure for ${pathname}`);
      }
      // A missing object is idempotent, exactly as the real client treats BlobNotFoundError.
      for (const f of [fileOf(mode, pathname), metaOf(mode, pathname)]) {
        if (existsSync(f)) rmSync(f);
      }
    },

    async head(pathname) {
      const meta = readMeta(mode, pathname);
      const f = fileOf(mode, pathname);
      if (!meta || !existsSync(f)) return null;
      return { pathname, size: statSync(f).size, contentType: meta.contentType, uploadedAt: new Date(meta.uploadedAt) };
    },

    async list({ prefix, cursor, limit = 1000 }) {
      const base = rootFor(mode);
      const all = walk(base)
        .map((p) => p.slice(base.length + 1).split(/[\\/]/).join("/"))
        .filter((p) => !prefix || p.startsWith(prefix))
        .sort();
      const start = cursor ? all.indexOf(cursor) + 1 : 0;
      const page = all.slice(start, start + limit);
      return {
        objects: page.map((p) => ({ pathname: p, size: statSync(fileOf(mode, p)).size, contentType: readMeta(mode, p)?.contentType ?? "", uploadedAt: new Date(readMeta(mode, p)?.uploadedAt ?? 0) })),
        cursor: start + limit < all.length ? page[page.length - 1] : undefined,
      };
    },

    providerUrl(pathname) {
      return `https://fakestore.${mode}.blob.vercel-storage.com/${pathname}`;
    },

    // The one provider rule this batch turns on: a PUBLIC store serves anyone holding the URL, a
    // PRIVATE store does not. It is the store's mode that decides, never the object's.
    async probeAnonymous(pathname) {
      return mode === "public" && existsSync(fileOf(mode, pathname));
    },
  };
}
