import "server-only";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BlobClient, BlobObject, BlobAccess } from "./blob-client";

// ---------------------------------------------------------------------------
// Test-only stand-in for Vercel Blob. Reachable ONLY when STORAGE_DRIVER=fake,
// which nothing outside the verify suites sets.
//
// Disk-backed rather than in-memory on purpose: the behavioural suites drive a
// real `next start` server over HTTP, so an upload in one request has to be
// visible to the read in the next. Each object is two files — the bytes, and a
// sidecar recording contentType and the ACCESS LEVEL IT WAS WRITTEN WITH.
//
// Recording access is what makes the write-path assertions meaningful: a test
// can read back how an upload was actually stored instead of trusting that the
// call passed `private`. `providerRead()` then models the one provider rule
// this batch depends on — a public object is readable without authorization, a
// private one is not.
//
// THAT MODEL IS NOT EVIDENCE ABOUT VERCEL. It proves the application asks for
// private storage and never falls back to an anonymous URL read. Whether a real
// private Vercel object actually refuses an anonymous GET is provider behaviour
// and stays REAL PROVIDER VERIFICATION PENDING.
// ---------------------------------------------------------------------------

type Sidecar = { contentType: string; access: BlobAccess; uploadedAt: string };

function root(): string {
  return process.env.STORAGE_FAKE_DIR || ".storage-fake";
}

const safe = (pathname: string) => pathname.replace(/\.\./g, "__").replace(/^\/+/, "");
const blobFile = (pathname: string) => join(root(), safe(pathname));
const metaFile = (pathname: string) => `${blobFile(pathname)}.__meta.json`;

function readMeta(pathname: string): Sidecar | null {
  const m = metaFile(pathname);
  if (!existsSync(m)) return null;
  try {
    return JSON.parse(readFileSync(m, "utf8")) as Sidecar;
  } catch {
    return null;
  }
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

export function fakeBlobClient(): BlobClient {
  return {
    async put(pathname, bytes, { contentType, access }) {
      const f = blobFile(pathname);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, bytes);
      writeFileSync(metaFile(pathname), JSON.stringify({ contentType, access, uploadedAt: new Date().toISOString() } satisfies Sidecar));
    },

    async get(pathname, { access }) {
      const meta = readMeta(pathname);
      const f = blobFile(pathname);
      if (!meta || !existsSync(f)) return null;
      // An authorized read is allowed for either access level — the token carries the authority.
      // The `access` argument is what the SDK requires the caller to declare, so a mismatch here
      // would be the application lying about its own storage and is surfaced rather than ignored.
      if (meta.access !== access) return null;
      return { bytes: readFileSync(f), contentType: meta.contentType };
    },

    async del(pathname) {
      for (const f of [blobFile(pathname), metaFile(pathname)]) {
        try {
          if (existsSync(f)) rmSync(f);
        } catch {
          // best-effort, matching the real client
        }
      }
    },

    async head(pathname) {
      const meta = readMeta(pathname);
      const f = blobFile(pathname);
      if (!meta || !existsSync(f)) return null;
      return { pathname, size: statSync(f).size, contentType: meta.contentType, uploadedAt: new Date(meta.uploadedAt) };
    },

    async list({ prefix, cursor, limit = 1000 }) {
      const base = root();
      const all = walk(base)
        .map((p) => p.slice(base.length + 1).split(/[\\/]/).join("/"))
        .filter((p) => !prefix || p.startsWith(prefix))
        .sort();
      const start = cursor ? all.indexOf(cursor) + 1 : 0;
      const page = all.slice(start, start + limit);
      const objects: BlobObject[] = page.map((p) => {
        const meta = readMeta(p);
        return { pathname: p, size: statSync(blobFile(p)).size, contentType: meta?.contentType ?? "", uploadedAt: new Date(meta?.uploadedAt ?? 0) };
      });
      const next = start + limit < all.length ? page[page.length - 1] : undefined;
      return { objects, cursor: next };
    },
  };
}

/** Test helper: how an object was actually stored. Undefined when it does not exist. */
export function fakeStoredAccess(pathname: string): BlobAccess | undefined {
  return readMeta(pathname)?.access;
}

/**
 * Test helper modelling an ANONYMOUS request straight at the storage provider, bypassing this
 * application entirely — the "leaked absolute Blob URL" in the threat model. Public objects hand
 * their bytes over; private objects refuse.
 */
export function fakeProviderRead(pathname: string): Buffer | null {
  const meta = readMeta(pathname);
  if (!meta || meta.access !== "public") return null;
  const f = blobFile(pathname);
  return existsSync(f) ? readFileSync(f) : null;
}
