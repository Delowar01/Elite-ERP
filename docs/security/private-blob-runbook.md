# Private Blob storage — deploy, migrate, roll back

Covers F-3 / R-2 / D-1: uploads stop depending on possession of a public Vercel Blob URL.

## What changed

| | Before | After |
| --- | --- | --- |
| Write | `put(path, bytes, { access: "public" })` | `put(path, bytes, { access: "private" })` |
| Read | `fetch(https://<store>.public.blob.vercel-storage.com/<path>)` | `get(path, { access: "private", token })` |
| Delete | `del(<provider URL>)` | `del(<pathname>)` |
| Stored in DB | `/uploads/organizations/{orgId}/{folder}/{file}` | **unchanged** |

No pathname moves and no database row changes, in either the code change or the migration. That is
deliberate: it keeps the ERP uncoupled from the provider and keeps every step independently
reversible.

## Deploy and migrate, in this order

The order matters, and it is **not** symmetric with the rollback.

1. **Deploy the code first.** New code reads private objects with a token *and* still reads objects
   that happen to be public — `get()` is told which access level to expect, and the migration is
   what changes that. Deploying code before migrating therefore breaks nothing: new uploads land
   private, old objects keep working as they are.
2. **Inventory, read-only.** `npm run blob:inventory -- --json inventory.json`. Writes nothing.
   Read the `publiclyReadable` count — that is the exposure the migration exists to close — and the
   `attachmentOrphans` block before doing anything else.
3. **Dry run.** `npm run blob:migrate`. Dry run is the default; it does not even create the state
   file. Confirm the pending count matches the inventory's `publiclyReadable`.
4. **Migrate, in slices.** `npm run blob:migrate -- --execute --limit 50` first, then by folder, then
   the rest. Each object is re-stored at its own pathname; nothing is deleted at any point.
5. **Re-inventory.** `publiclyReadable` should reach 0. Anything left is listed by pathname.

### Why there is no "delete the old public objects" step

There are no old objects to delete. The migration overwrites each object **in place** at the same
pathname, so there is never a second copy. Nothing in either script deletes anything, ever.

## Rollback is asymmetric — read this before rolling back

```
  new code + public objects   ->  fine (get() reads either)
  new code + private objects  ->  fine
  OLD code + public objects   ->  fine (this is today)
  OLD code + private objects  ->  BROKEN — old code fetches the public URL, which now 404s
```

**Reverting the commit is not sufficient once any object has been migrated.** Old code reads bytes
by fetching the public provider URL; a private object refuses that, so every migrated file — logos,
seals, signatures on documents and PDFs, item images, attachments — stops loading. The application
keeps serving pages; the images just break.

| Situation | Rollback |
| --- | --- |
| Code deployed, migration **not** started | Revert the commit. Genuinely sufficient: every object is still public and old code reads it. |
| Migration partially or fully run | Reverting the code alone is **not** safe. Either roll forward (fix under the new code), or re-run the migration in reverse to make the affected objects public again *before* the code revert reaches production. |

There is no in-place permission change in the Vercel Blob API, so "make it public again" is the same
mechanism in the other direction: read the bytes, `put` them back with `access: "public"`. That
reverse path is **not** scripted here — writing a tool whose purpose is to re-expose files is not
something to leave lying around. If it is ever needed, it is `blob-migrate.ts` with the two access
values swapped, run deliberately.

### Compatibility window

Between the code deploy and the end of the migration, both access levels coexist and both work. That
window can be as long as you like. The risk starts only when a rollback is attempted **after**
migration has begun.

### Emergency read

If a file must be recovered while the pipeline is broken, `blobClient().get(pathname, { access })`
with the project token reads any object regardless of state; `npm run blob:inventory` locates it.
Neither requires the application to be up.

## Attachment orphans — do not delete

Objects under `organizations/{orgId}/attachments/` with no database reference are reported as:

```
UNREFERENCED ATTACHMENT — PRESERVE / MANUAL REVIEW
```

Until `d3694a6`, `persistDocumentAttachments` silently dropped every staged attachment: the file
reached the store and its row never existed. Those objects are the only trace of attachments real
users uploaded, and their document association is **not** deterministically recoverable — the upload
action wrote no row and logged no activity, and the association lived only in browser state. An
orphan's name yields its organization and its upload instant, nothing more.

They must be migrated to private like anything else, and must never be purged, overwritten, or
auto-classified as garbage. Orphans in other folders may be evaluated separately.

## Signed URLs are a capability, not a workflow

`signFileUrl()` has **no callers anywhere in the repository**. Sessionless signed delivery is
verified by the upload route and covered by tests, but nothing in the product mints one today — PDF
generation reaches these files with the session cookie Puppeteer forwards. Preserve the capability;
do not describe it as an active production path.

## What is still unproven

**REAL PROVIDER VERIFICATION PENDING.** Every assertion in `verify-private-storage.mjs` runs against
the test storage driver, because Vercel Blob is unreachable from the build environment — no
`BLOB_READ_WRITE_TOKEN`, and `blob.vercel-storage.com`, `api.vercel.com` and
`*.public.blob.vercel-storage.com` are all refused by the egress policy. Those tests establish that
**this application** stores private and never falls back to an anonymous URL read. They are **not**
evidence that a real private Vercel object refuses an anonymous GET.

That must be settled on a Preview deployment against the project's real Blob store, using disposable
objects only, under an isolated prefix such as `batch3-verification/<unique-id>/`, proving:

1. a real private write succeeds
2. the raw provider URL fails anonymously
3. the authorized `/uploads/...` route returns the exact bytes
4. an unauthenticated route request is denied
5. a cross-tenant request is denied
6. a valid signed URL works, and an expired or tampered one fails
7. logo, seal and signature render inside real generated PDFs

Delete only those disposable objects afterwards. **Do not touch existing production objects**, and
do not run this until the owner approves it.
