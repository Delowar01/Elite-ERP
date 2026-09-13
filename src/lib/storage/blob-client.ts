import "server-only";

// ---------------------------------------------------------------------------
// The storage seam. Deliberately THIN: it exposes exactly the five operations
// this application already performs against Vercel Blob — put, get, del, head,
// list — and nothing speculative. It is not a storage framework and no second
// provider is contemplated.
//
// It exists for one reason: Vercel Blob cannot be reached from the test
// environment, so without a seam the private-storage behaviour (tenant
// isolation, signed access, folder round-trips, PDF branding) could only be
// argued rather than executed. The Vercel implementation is the default and the
// only one production ever selects; the in-memory/disk fake is reachable solely
// when STORAGE_DRIVER=fake, which nothing sets outside tests.
//
// WHAT THE FAKE CANNOT PROVE. It models `access` faithfully enough to exercise
// this application's logic, but it is NOT Vercel. That a real private object's
// provider URL refuses an anonymous GET is PROVIDER behaviour, and no assertion
// against the fake may be read as evidence of it. That claim stays
// REAL PROVIDER VERIFICATION PENDING until it is run against a real store.
// ---------------------------------------------------------------------------

export type BlobAccess = "public" | "private";

export type BlobObject = {
  pathname: string;
  size: number;
  contentType: string;
  uploadedAt: Date;
};

export type BlobBytes = { bytes: Buffer; contentType: string };

export interface BlobClient {
  /** Write bytes at an exact pathname. No random suffix: the caller owns the name. */
  put(pathname: string, bytes: Buffer, opts: { contentType: string; access: BlobAccess }): Promise<void>;
  /** Read an object the store holds at `access`. Returns null when it does not exist. */
  get(pathname: string, opts: { access: BlobAccess }): Promise<BlobBytes | null>;
  /** Remove an object. Never throws for a missing object. */
  del(pathname: string): Promise<void>;
  /** Metadata only. Returns null when the object does not exist. */
  head(pathname: string): Promise<BlobObject | null>;
  /** One page of objects under `prefix`, oldest-first pagination via an opaque cursor. */
  list(opts: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: BlobObject[]; cursor?: string }>;
  /**
   * Is this object readable by an ANONYMOUS caller — the leaked-URL case?
   *
   * Neither `list` nor `head` reports an access level, so the only way to answer is to ask
   * anonymously. The inventory and the migration both need it: one to report exposure, the other to
   * decide what still has to be re-stored and to confirm afterwards that it worked.
   */
  probePublic(pathname: string): Promise<boolean>;
}

/**
 * Base PUBLIC host of this project's blob store, derived from the token
 * (vercel_blob_rw_<store>_<secret>). Internal to this module on purpose: nothing in the request
 * path needs a provider URL any more, and the one remaining use — probing anonymously — lives
 * right here rather than being handed out.
 */
function publicBase(): string {
  const t = token();
  if (!t) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  const storeId = t.split("_")[3];
  if (!storeId) throw new Error("BLOB_READ_WRITE_TOKEN is malformed");
  return `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com`;
}

function token(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

// --- the real implementation -----------------------------------------------

const vercelClient: BlobClient = {
  async put(pathname, bytes, { contentType, access }) {
    const { put } = await import("@vercel/blob");
    await put(pathname, bytes, { access, addRandomSuffix: false, contentType, token: token() });
  },

  async get(pathname, { access }) {
    const { get } = await import("@vercel/blob");
    // `get` takes a pathname and authenticates with the token, so a private object is read without
    // its URL ever existing in this process — which is the whole point of the migration. The public
    // `fetch(blobBaseUrl()/pathname)` this replaced could only ever work while the object was public.
    const res = await get(pathname, { access, token: token() });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const chunks: Uint8Array[] = [];
    // @ts-expect-error — Node's async iteration over a web ReadableStream is available at runtime.
    for await (const chunk of res.stream) chunks.push(chunk as Uint8Array);
    return { bytes: Buffer.concat(chunks), contentType: res.blob.contentType ?? "application/octet-stream" };
  },

  async del(pathname) {
    const { del } = await import("@vercel/blob");
    try {
      await del(pathname, { token: token() });
    } catch {
      // best-effort: a missing object is not an error for cleanup
    }
  },

  async head(pathname) {
    const { head } = await import("@vercel/blob");
    try {
      const h = await head(pathname, { token: token() });
      return { pathname: h.pathname, size: h.size, contentType: h.contentType, uploadedAt: h.uploadedAt };
    } catch {
      return null;
    }
  },

  async list({ prefix, cursor, limit }) {
    const { list } = await import("@vercel/blob");
    const res = await list({ prefix, cursor, limit, token: token() });
    return {
      objects: res.blobs.map((b) => ({ pathname: b.pathname, size: b.size, contentType: "", uploadedAt: b.uploadedAt })),
      cursor: res.cursor,
    };
  },

  async probePublic(pathname) {
    try {
      const res = await fetch(`${publicBase()}/${pathname}`, { cache: "no-store" });
      if (!res.ok) return false;
      await res.arrayBuffer();
      return true;
    } catch {
      return false;
    }
  },
};

// --- selection --------------------------------------------------------------

let override: BlobClient | null = null;

/** Tests only. Replaces the client for the current process. */
export function __setBlobClientForTests(client: BlobClient | null): void {
  override = client;
}

export function blobClient(): BlobClient {
  if (override) return override;
  if (process.env.STORAGE_DRIVER === "fake") {
    // Loaded lazily and only on that explicit opt-in, so the fake is never part of a production
    // module graph. Required synchronously because callers are already async at the call site.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("./blob-client-fake") as { fakeBlobClient: () => BlobClient }).fakeBlobClient();
  }
  return vercelClient;
}
