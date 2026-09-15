import "server-only";

// ---------------------------------------------------------------------------
// The storage seam, modelled on how Vercel Blob actually works: ACCESS BELONGS
// TO THE STORE, not to the object.
//
// A store is created public or private and cannot be changed afterwards, so
// "make this object private" is not an operation that exists. Objects move
// between stores. An earlier version of this file modelled access as a
// per-object property inside one store and produced a migration that read an
// object public and wrote it back private at the same pathname; that cannot
// work, and the SDK itself shows why:
//
//     constructBlobUrl(storeId, pathname, access) =>
//       `https://${storeId}.${access}.blob.vercel-storage.com/${pathname}`
//
// The access level is part of the host. A private object is not the same URL
// with different permissions — it is a different address, in a different store.
//
// So this module exposes STORES, each with a mode fixed at construction, and no
// caller ever passes `access`. A BlobStore cannot be asked to perform an
// operation at the wrong access level, because there is nowhere to say it.
// That is what makes the one-store migration unrepresentable rather than merely
// discouraged.
//
//   destinationStore()  private, required. Every new upload goes here.
//   sourceStore()       public, optional. The legacy store, read-only in
//                       practice, retired once migration completes.
//
// Two stores are addressed with two tokens: resolveBlobAuth() prefers an
// explicit options.token and derives the store id from it
// (parseStoreIdFromReadWriteToken = token.split("_")[3]), so passing a distinct
// token per call is the supported way to reach a second store from one project.
//
// WHAT THE TEST DRIVER CANNOT PROVE. With STORAGE_DRIVER=fake these interfaces
// are backed by two fixed-mode fake stores that enforce the same rules. That
// exercises this application's behaviour. It is NOT evidence that a real
// private Vercel object refuses an anonymous GET, which is provider behaviour
// and stays REAL PROVIDER VERIFICATION PENDING.
// ---------------------------------------------------------------------------

export type StoreMode = "public" | "private";
export type StoreRole = "source" | "destination";

export type BlobObject = { pathname: string; size: number; contentType: string; uploadedAt: Date };

/**
 * What an unauthenticated request to the provider actually produced.
 *
 *   readable   the provider served the bytes — the object IS publicly exposed
 *   denied     the provider explicitly refused (401/403)
 *   not_found  the provider said the object is not there (404)
 *
 * `not_found` is deliberately NOT merged into `denied`. On its own it proves nothing: a typo
 * produces a 404 too. It counts as evidence of privacy only when an AUTHENTICATED read has
 * separately proven that this exact object exists in this exact store — at which point "the object
 * exists and an anonymous caller is told it does not" is a refusal, just a quiet one. Callers must
 * establish existence first; see assertPrivatelyStored().
 */
export type AnonymousProbe =
  | { state: "readable"; status: number }
  | { state: "denied"; status: number }
  | { state: "not_found"; status: number };
export type BlobBytes = { bytes: Buffer; contentType: string };

/** Thrown when a genuine object exists but could not be read. Never confused with "absent". */
export class BlobReadError extends Error {
  constructor(public readonly pathname: string, cause: unknown) {
    super(`blob read failed for ${pathname}: ${String(cause)}`);
  }
}

/** Thrown when a write would replace an existing object and the caller did not allow it. */
export class BlobExistsError extends Error {
  constructor(public readonly pathname: string) {
    super(`blob already exists at ${pathname}`);
  }
}

/**
 * Thrown when an anonymous probe could not produce an answer. Never a synonym for "private".
 */
export class BlobProbeError extends Error {
  constructor(public readonly pathname: string, public readonly reason: string) {
    super(`anonymous probe inconclusive for ${pathname}: ${reason}`);
  }
}

/**
 * Thrown when a delete did not happen. Carries every store that failed, because a partial delete is
 * the dangerous case: if the private copy went and the PUBLIC one did not, the user has been told
 * their file is gone while its bytes are still anonymously downloadable.
 */
export class BlobDeleteError extends Error {
  constructor(public readonly pathname: string, public readonly failures: { role: StoreRole; mode: StoreMode; reason: string }[]) {
    super(`delete failed for ${pathname} in: ${failures.map((f) => `${f.role}(${f.mode}) — ${f.reason}`).join("; ")}`);
  }
}

export interface BlobStore {
  readonly role: StoreRole;
  readonly mode: StoreMode;
  /** Write. Refuses to replace an existing object unless allowOverwrite is set. */
  put(pathname: string, bytes: Buffer, opts: { contentType: string; allowOverwrite?: boolean }): Promise<void>;
  /**
   * Read. Returns null ONLY when the object genuinely does not exist.
   * Any other failure — auth, network, service — throws BlobReadError, so a caller with a
   * fallback cannot mistake "I could not read it" for "it is not here".
   */
  get(pathname: string): Promise<BlobBytes | null>;
  /**
   * Delete. A MISSING object is not an error — delete stays idempotent. Every other failure —
   * auth, authorization, network, service, rate limit, malformed token, unknown — THROWS, because
   * an object that could not be deleted is still there, and on the public store that means its
   * bytes are still anonymously downloadable.
   */
  del(pathname: string): Promise<void>;
  /** Metadata, or null when the object genuinely does not exist. Other failures throw. */
  head(pathname: string): Promise<BlobObject | null>;
  list(opts: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: BlobObject[]; cursor?: string }>;
  /** The real provider URL for this object, in this store's access shape. Never send to a client. */
  providerUrl(pathname: string): string;
  /**
   * Ask the provider, with no credentials, whether it will hand over this object — the leaked-URL
   * question. Returns WHAT THE PROVIDER SAID; throws BlobProbeError when it did not say anything
   * usable.
   *
   * It does not return a boolean, and that is the whole point. A boolean has to fold "the provider
   * refused" together with "I could not reach the provider", and those are opposites: the first is
   * evidence of privacy, the second is the absence of evidence. The previous version returned
   * `false` for both, so a DNS failure, a TLS error, a timeout, a 429, a 5xx or an egress denial all
   * read as "not publicly readable" — in THIS environment, where Vercel is blocked outright, it
   * would have reported every object in the store as private.
   */
  probeAnonymous(pathname: string): Promise<AnonymousProbe>;
}

const DESTINATION_TOKEN_ENV = "BLOB_READ_WRITE_TOKEN";
const SOURCE_TOKEN_ENV = "BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN";

function storeIdOf(token: string): string {
  const id = token.split("_")[3];
  if (!id) throw new Error("blob token is malformed: cannot extract the store id");
  return id;
}

function vercelStore(role: StoreRole, mode: StoreMode, token: string): BlobStore {
  const storeId = storeIdOf(token);

  return {
    role,
    mode,

    async put(pathname, bytes, { contentType, allowOverwrite = false }) {
      const { put } = await import("@vercel/blob");
      try {
        await put(pathname, bytes, { access: mode, addRandomSuffix: false, allowOverwrite, contentType, token });
      } catch (e) {
        // The SDK refuses to replace an existing pathname unless allowOverwrite is set. Surface
        // that as its own type: a migration must treat it as a conflict to investigate, not as a
        // transport error to retry.
        if (!allowOverwrite && e instanceof Error && /exists|already/i.test(e.message)) throw new BlobExistsError(pathname);
        throw e;
      }
    },

    async get(pathname) {
      const { get, BlobNotFoundError } = await import("@vercel/blob");
      let res;
      try {
        res = await get(pathname, { access: mode, token });
      } catch (e) {
        // Only the provider's own "it does not exist" is absence. Everything else is a failure and
        // must reach the caller, because readBlob() falls back to the public store on absence and a
        // swallowed auth error would turn every read into a silent public serve.
        if (e instanceof BlobNotFoundError) return null;
        throw new BlobReadError(pathname, e);
      }
      if (!res) return null;
      if (res.statusCode !== 200 || !res.stream) throw new BlobReadError(pathname, `unexpected status ${res.statusCode}`);
      const chunks: Uint8Array[] = [];
      // @ts-expect-error — Node iterates a web ReadableStream at runtime.
      for await (const chunk of res.stream) chunks.push(chunk as Uint8Array);
      return { bytes: Buffer.concat(chunks), contentType: res.blob.contentType ?? "application/octet-stream" };
    },

    async del(pathname) {
      const { del, BlobNotFoundError } = await import("@vercel/blob");
      try {
        await del(pathname, { token });
      } catch (e) {
        // A MISSING object is not an error — delete stays idempotent. Anything else is: an auth
        // failure, a suspended store, a rate limit or a network fault means the object is STILL
        // THERE, and on the public source that means its bytes are still anonymously downloadable.
        // The previous `catch {}` reported that as a successful deletion.
        if (e instanceof BlobNotFoundError) return;
        throw e;
      }
    },

    async head(pathname) {
      const { head, BlobNotFoundError } = await import("@vercel/blob");
      try {
        const h = await head(pathname, { token });
        return { pathname: h.pathname, size: h.size, contentType: h.contentType, uploadedAt: h.uploadedAt };
      } catch (e) {
        // Same rule as get and del: null means absent, never "could not tell". The inventory counts
        // objects with this, and a broad catch would quietly under-report a store it cannot reach.
        if (e instanceof BlobNotFoundError) return null;
        throw e;
      }
    },

    async list({ prefix, cursor, limit }) {
      const { list } = await import("@vercel/blob");
      const res = await list({ prefix, cursor, limit, token });
      return {
        objects: res.blobs.map((b) => ({ pathname: b.pathname, size: b.size, contentType: "", uploadedAt: b.uploadedAt })),
        cursor: res.cursor,
      };
    },

    // Mirrors the SDK's own constructBlobUrl: the access level is part of the HOST, which is why a
    // private object's URL is not the public one with different permissions.
    providerUrl(pathname) {
      return `https://${storeId}.${mode}.blob.vercel-storage.com/${pathname}`;
    },

    async probeAnonymous(pathname) {
      let res: Response;
      try {
        res = await fetch(this.providerUrl(pathname), { cache: "no-store", redirect: "manual" });
      } catch (e) {
        // DNS, TLS, timeout, connection reset, egress denial. The provider never answered, so
        // nothing is known about this object's exposure.
        throw new BlobProbeError(pathname, `transport failure: ${String(e)}`);
      }
      if (res.ok) {
        await res.arrayBuffer();
        return { state: "readable", status: res.status };
      }
      // Only an explicit refusal counts as one.
      if (res.status === 401 || res.status === 403) return { state: "denied", status: res.status };
      if (res.status === 404) return { state: "not_found", status: res.status };
      // 429 and 5xx are the provider failing to answer, not refusing. Everything else is unknown,
      // and an unknown non-2xx must never be read as proof of privacy.
      throw new BlobProbeError(pathname, `provider returned ${res.status}, which is neither an answer nor a refusal`);
    },
  };
}

/**
 * Positive evidence that an object is stored privately, for migration verification and for the
 * Preview acceptance proof.
 *
 * Existence is established through AUTHENTICATED access FIRST, and only then is the anonymous probe
 * consulted. That ordering is what lets a 404 count: on its own it is indistinguishable from a
 * wrong pathname, but once the authenticated read has proven this exact object is in this exact
 * store, an anonymous caller being told it does not exist is a refusal.
 *
 * Throws if the probe is inconclusive. There is no outcome where "I could not tell" resolves to
 * verified.
 */
export async function assertPrivatelyStored(store: BlobStore, pathname: string): Promise<AnonymousProbe> {
  const authenticated = await store.head(pathname);
  if (!authenticated) throw new BlobProbeError(pathname, "no authenticated evidence the object exists in this store");
  const probe = await store.probeAnonymous(pathname); // throws when inconclusive
  if (probe.state === "readable") throw new BlobProbeError(pathname, `object is ANONYMOUSLY READABLE (status ${probe.status})`);
  return probe;
}

function fakeDriverSelected(): boolean {
  return process.env.STORAGE_DRIVER === "fake";
}

/** The PRIVATE store every new upload is written to. Required. */
export function destinationStore(): BlobStore {
  if (fakeDriverSelected()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("./blob-client-fake") as typeof import("./blob-client-fake")).fakeStore("destination", "private");
  }
  const token = process.env[DESTINATION_TOKEN_ENV];
  if (!token) throw new Error(`${DESTINATION_TOKEN_ENV} is not set — it addresses the PRIVATE destination store`);
  return vercelStore("destination", "private", token);
}

/**
 * The legacy PUBLIC store. Null once it is retired and its token removed, which is the signal that
 * the read fallback should no longer happen.
 */
export function sourceStore(): BlobStore | null {
  if (fakeDriverSelected()) {
    if (process.env.STORAGE_FAKE_SOURCE !== "1") return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("./blob-client-fake") as typeof import("./blob-client-fake")).fakeStore("source", "public");
  }
  const token = process.env[SOURCE_TOKEN_ENV];
  return token ? vercelStore("source", "public", token) : null;
}
