# Private Blob storage — deploy, migrate, roll back

Covers F-3 / R-2 / D-1: uploads stop depending on possession of a public Vercel Blob URL.

## What changed

**Access belongs to the store, not the object.** A Vercel Blob store is created public or private
and cannot be changed afterwards. The SDK builds
`https://${storeId}.${access}.blob.vercel-storage.com/${pathname}` — the access level is part of the
host, so a private object is a *different address in a different store*, not the same URL with
different permissions. There is no "make this object private" operation.

| | Before | After |
| --- | --- | --- |
| Stores | one PUBLIC store | **PUBLIC SOURCE** (legacy, read-only in practice) + **PRIVATE DESTINATION** |
| New uploads | public store | private destination **only** — no public copy is written |
| Read | `fetch(<public URL>)` | private destination, falling back **server-side** to the public source while unmigrated |
| Delete (user action) | public store | **both** stores |
| Migration | — | **copy** source → destination, same pathname; source never deleted |
| Stored in DB | `/uploads/organizations/{orgId}/{folder}/{file}` | **unchanged — the DB never learns which store holds an object** |

### Configuration

Two stores are addressed with two tokens. `resolveBlobAuth()` prefers an explicit `options.token`
and derives the store id from it (`token.split("_")[3]`), so a distinct token per call is the
supported way to reach a second store from one project.

| Variable | Store | Notes |
| --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | **private destination** | required; the default name deliberately points at the safe store |
| `BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN` | **public source** | optional; **removing it retires the fallback** |

Neither is ever sent to a client.

## Deploy and migrate, in this order

1. **Create the private destination store** and set `BLOB_READ_WRITE_TOKEN` to it. Set
   `BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN` to the existing public store.
2. **Deploy the code.** New uploads go straight to the private store; everything older still loads
   through the source fallback. Nothing breaks at this point and nothing has moved.
3. **Inventory, read-only.** `npm run blob:inventory -- --json inventory.json [--hash]`. Read
   `reconciliation.publicOnly` (still to migrate) and the `attachmentOrphans` block first.
4. **Dry run.** `npm run blob:migrate`. Dry run is the default and creates no state file.
5. **Migrate in slices.** `npm run blob:migrate -- --execute --limit 50`, then by folder. Each object
   is copied to the same pathname in the destination and **verified** — size, sha256, content type,
   and an anonymous fetch of the destination refused. The state file records exactly three states:
   `verified`, `conflict`, `failed`. Only `verified` is settled and skipped on a rerun; `conflict`
   and `failed` are retried, because both are states a human may have fixed in between. If the
   process dies between the copy and the verification, nothing is recorded and the rerun recovers by
   comparison: it finds the destination present, hashes both sides, and records `verified` when they
   match.
6. **Re-inventory.** `publicOnly` should reach 0 and `inBoth` should equal the source count.
7. **Retire the source later, deliberately.** Only once `publicOnly` is 0, the app has run on the
   fallback for a period you are comfortable with, and you accept that rollback past this point is
   no longer possible: unset `BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN`, then delete the public store.
   **Deleting the public store is the point of no return, and nothing in this repo does it.**

## Rollback — six cases, and only one is a plain revert

Keeping the public source intact is what makes most of these survivable. The hazard is **new files**:
anything uploaded after the code deploy exists *only* in the private destination, and old code
cannot read that store at all.

| # | Situation | Rollback |
| --- | --- | --- |
| 1 | Before the Batch 3 production deploy | Nothing to do. |
| 2 | Code deployed, **no new uploads yet**, migration not started | **Plain revert is sufficient.** Every object is still in the public store where old code looks. |
| 3 | Code deployed, **new uploads have happened** | Revert restores old behaviour for historical files but **every file uploaded since the deploy becomes unreadable** — old code only reads the public store. Copy those private-only objects back to the public store first (`reconciliation.privateOnlyPathnames` lists them exactly), or accept the loss knowingly. |
| 4 | Partial migration | Same as 3. Migration itself changes nothing about rollback — it only *copies*, so every migrated object is still in the public store. The private-only new uploads remain the whole problem. |
| 5 | Full migration, source still present | Same as 3. Full migration is not a cliff; retiring the source is. |
| 6 | After the public source is retired/deleted | **No rollback.** Old code cannot read the private store, and the public copies no longer exist. Recovery means restoring the deleted store from Vercel, if that is even possible. Do not take this step until rollback is something you are willing to give up. |

**So "revert the commit" is sufficient only in case 2.** In cases 3–5 it silently breaks recently
uploaded files; in case 6 it is not a rollback at all.

The reverse copy (private → public) is deliberately **not** scripted: a tool whose purpose is to
re-expose files should not sit in the repo waiting to be run by accident. It is `blob-migrate.ts`
with source and destination exchanged, run deliberately, by someone who has read this table.

### Compatibility window

Between the deploy and the source retirement both stores are in play and everything reads. That
window can be as long as you like, and lengthening it is the cheapest risk reduction available.

### Emergency read

`destinationStore().get(pathname)` and `sourceStore()?.get(pathname)` read either store with its own
token; `npm run blob:inventory` locates any object. Neither needs the application to be up.

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

That must be settled on a Preview deployment. **Everything it touches is disposable — no production
Blob store, no production database, no production object.**

### Disposable setup required

| Preview variable | Value |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | a **disposable PRIVATE** Blob store, created for this test |
| `BLOB_PUBLIC_SOURCE_READ_WRITE_TOKEN` | a **disposable PUBLIC** Blob store, for legacy-source and fallback testing |
| `DATABASE_URL` | a **disposable** Preview database (a Neon branch or equivalent already-approved isolated DB) |

Preview environment only. **Do not replace any Production variable. Do not point the Preview at the
production public store or the production database. Neither credential may reach the browser.**

Keep an **exact manifest** of every disposable pathname created. Cleanup compares against that
manifest; never delete by prefix scan.

**Ownership, not presence.** Recording a pathname is not the same as owning the object at it, so the
manifest tracks a lifecycle and cleanup deletes only what it can prove the run wrote:

Cleanup reads every candidate back and hashes it against the bytes the run intended to write —
**including objects it successfully created**. A completed write proves the run owned that pathname
at that moment, not that it owns whatever is there now; an object replaced since belongs to whoever
replaced it.

| Current bytes | Cleanup |
| --- | --- |
| hash to the recorded sha256 | delete, then verify it is gone |
| differ | `skipped-not-owned` — left untouched and reported |
| nothing there | `verified-gone` |
| cannot be read | `inconclusive` — nothing is deleted |

The recorded state (`planned` / `created` / `create-failed`) explains why a pathname is in the
manifest; it never decides deletion.

Writes go out with **no `allowOverwrite`**. The pathname is checked free first, but the guarantee
that matters is the provider's own refusal, because a check-then-write has a window in which
somebody else's object can appear.

Where the **application** chooses the pathname (`storeBlob()` mints `{orgId}-{timestamp}-{random}`)
the run reserves the *prefix* and the intended sha256 beforehand. Nothing can exist that the
manifest does not describe, and cleanup resolves the reservation by listing that prefix and matching
bytes. **The prefix is never a delete scope** — an object under it whose bytes differ is left alone
and reported.

Disposable **organizations** are recorded by their unique email address *before* `/register` is
submitted, so a crash between registration and the manifest write still leaves an exact locator. The
org is the cleanup root: of the 53 foreign keys referencing `orgs`, 52 are `ON DELETE CASCADE` (the
exception, `audit_logs.org_id`, is `SET NULL` by design), so deleting the org removes its users,
documents and line items in one dependency-correct step — which is then **verified** across every
table the harness writes to rather than assumed. No `LIKE` pattern, ever.

### Arming the harness

`npm run verify:blob-provider` refuses to start unless every one of these is set. All of them are
checked before the first write, and `armOrRefuse()` performs no I/O, so a refusal can never arrive
too late.

| Variable | Why it is required |
| --- | --- |
| `BATCH3_PROVIDER_TEST` | exact arming phrase — not a default, not inferable from a typo |
| `BATCH3_PREVIEW_BASE_URL` | the disposable Preview; must be `https://` and parse to a hostname |
| `BATCH3_KNOWN_PRODUCTION_HOST` | every production hostname, comma- or semicolon-separated. **Mandatory.** The disposable tokens and `DATABASE_URL` govern only what this process touches; `/register` and every browser action run inside the deployment at the Preview URL using *its* environment, so a Preview URL that is really Production writes to the production database regardless. Compared as a normalized hostname, never as a substring |
| `BATCH3_EXPECT_PRIVATE_STORE_ID` / `BATCH3_EXPECT_PUBLIC_STORE_ID` | the store ids are derived from the tokens themselves and must match what was declared, so a token pasted into the wrong variable is caught rather than used. Two tokens addressing the same store also refuse |
| `BATCH3_EXPECT_DB_HOST` / `BATCH3_EXPECT_DB_NAME` | checked from the URL's non-secret parts |
| `BATCH3_EXPECT_COMMIT_SHA` + `BATCH3_PREVIEW_SHA_VERIFIED_EXTERNALLY=YES` | nothing in the application exposes its git sha and the harness will not add an endpoint that does; the operator attests and the report records it as an attestation |
| `BATCH3_SIGNING_SECRET_MATCHES_PREVIEW=YES` | signatures are minted locally and verified remotely; a mismatch would fail the signed-access section for a configuration reason and read as an application defect |

`VERCEL_ENV=production` and `STORAGE_DRIVER=fake` both refuse outright.

### Exit codes

| Verdict | Exit |
| --- | --- |
| A — REAL PROVIDER VERIFICATION PASSED | 0 |
| C — FAILED | 1 |
| B — INCONCLUSIVE | 2 |

B is deliberately non-zero. A gate that exits 0 when a mandatory check never ran is, to anything
reading the exit status, indistinguishable from one that passed.

### What it must prove

**Provider level** — disposable provider-only objects, an isolated prefix is fine here:

1. a public-store object IS anonymously readable
2. a private-store object is NOT anonymously readable, using the **URL the SDK actually returned**
   from `put`/`head` — not a hand-built `.private.` string, which would prove only that a guessed
   URL 404s

**Application path** — a disposable Preview organization and real generated paths under
`organizations/{testOrgId}/{realFolder}/`, because `/uploads/[...path]` rejects anything else at its
shape check:

3. a private destination write succeeds
4. a new upload exists **only** in the private destination
5. the authorized route serves the exact bytes
6. an unauthenticated request is denied
7. a cross-tenant request is denied
8. the private object wins when both stores hold the pathname
9. a genuinely absent destination falls back to the public source
10. a destination auth/read failure does **not** fall back
11. a signed branding URL succeeds; expired and tampered ones fail
12. a signed response's cache lifetime never exceeds the signature's remaining lifetime
13. logo, seal and signature render inside generated PDFs

**Real cross-store migration** — using only disposable source objects:

14. source public object present, destination absent
15. copy source → destination at the same pathname
16. the source is left untouched
17. destination bytes, sha256 and content type match
18. the destination's raw URL denies an anonymous read
19. the application route now serves the destination copy
20. a rerun is idempotent
21. a differing destination produces `conflict` and is not overwritten

**Do not run the migration tool against the production public store to test it.**

### Cleanup

Delete only the objects in the recorded manifest, and only after proving ownership as above. Cleanup
is a **separate command** (`npm run verify:blob-provider:cleanup -- --run-id <id>`) so evidence is
preserved before anything is removed; it is resumable, persists the manifest after each operation,
and exits non-zero if any blob or database deletion failed or was left inconclusive. Retire the
disposable stores if they were created for this test, and drop the disposable Preview
database/branch if it was. Never clean up by prefix scan without comparing against the manifest.
