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

**Always run these through npm, never `npx tsx` directly.** The scripts carry two flags a suite
cannot supply for itself:

| Flag | Without it |
|---|---|
| `--conditions=react-server` | `import "server-only"` throws on the first import; the suite reports nothing at all. |
| `--env-file-if-exists=.env` | `DATABASE_URL` is unset unless it happens to be exported in the shell; the suite dies before its first query. |

## The standing rule behind both flags

**Anything that must happen before a module's dependencies are evaluated cannot live inside that
module — whatever it looks like it is doing.** ES modules evaluate every import before the importing
file's own statements run. A line at the top of the file is not early; it is late.

This has now been got wrong three times in this repo, each time in code that read as if it worked:

1. A `createRequire` cache stub meant to neutralise `server-only`. It ran after the guard had
   already thrown, so five suites silently did not execute — and two of their numbers were reported
   from memory as if they had.
2. The same shape again, after the first was diagnosed.
3. `process.env.DATABASE_URL ||= readFileSync(".env")` at the top of every server suite — written
   as the *portability fix for the second instance*. It never once executed. The suites only ran
   because the variable was exported in the development shell, so the fallback looked like it was
   holding.

The third is the instructive one: a plausible-looking fallback nobody could distinguish from a
working one, sitting inside the fix for the same mistake. The tell in all three cases is identical —
a statement whose whole purpose is to change how a later `import` behaves.

The fix is always to move the work out of the module, into the thing that launches it: a CLI flag, a
`--import` preload, or the npm script. If you find yourself writing setup code above an import and
hoping it lands first, it will not.

## Browser suites

The `.mjs` suites drive a real browser and need a production build running on `localhost:3000`
(`npm run build && npm start`). They are not in `verify:all` because they are slow and need that
server. Run them directly: `node verify/verify-sidebar-scroll.mjs`.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Required. The npm scripts load it from `.env` (relative to the repo root) via `--env-file-if-exists`; an already-exported value wins. No suite reads `.env` itself — see the standing rule above for why that never worked. |
| `CHROMIUM_PATH` | Optional. Overrides the browser binary for the `.mjs` suites; defaults to this sandbox's path. Set it on any other machine. |

## What these are for

Most of these are mutation-proofed: the assertion was checked by breaking the thing it guards and
confirming it fails, naming the damage. Where an assertion could NOT be made to fail, that is said
in the file rather than left implied — see the notes in `verify-sidebar-scroll.mjs` about the clamp
and about `useLayoutEffect`. An assertion that cannot fail reads as coverage while providing none.
