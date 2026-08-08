# Verification suites

Every suite here creates its own organization and reads back the ids it needs — there are no
hardcoded org ids, row ids or seeded row counts, so runs do not interfere with each other and a
fresh database is fine.

## Running

```
npm run verify:static    # source-reading suites — no database, no server, seconds
npm run verify:server    # suites that import server-only production code — needs a database
npm run verify:all       # both of the above; the pre-commit gate
```

Individual suites have their own script (`npm run verify:statements`, and so on).

**Always run these through npm, never `npx tsx` directly.** The scripts carry
`--conditions=react-server`, which is what makes `import "server-only"` resolve to the empty module
the package ships for the server condition. Without it those suites throw on their first import and
report nothing at all — which is exactly how five of them went unnoticed for a full work cycle.

## Browser suites

The `.mjs` suites drive a real browser and need a production build running on `localhost:3000`
(`npm run build && npm start`). They are not in `verify:all` because they are slow and need that
server. Run them directly: `node verify/verify-sidebar-scroll.mjs`.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Required. Most suites fall back to reading it from `.env` relative to the repo root. |
| `CHROMIUM_PATH` | Optional. Overrides the browser binary for the `.mjs` suites; defaults to this sandbox's path. Set it on any other machine. |

## What these are for

Most of these are mutation-proofed: the assertion was checked by breaking the thing it guards and
confirming it fails, naming the damage. Where an assertion could NOT be made to fail, that is said
in the file rather than left implied — see the notes in `verify-sidebar-scroll.mjs` about the clamp
and about `useLayoutEffect`. An assertion that cannot fail reads as coverage while providing none.
