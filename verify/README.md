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

Two of them are worth calling out because they guard the same rule from opposite sides:

| Suite | Tier | Guards |
|---|---|---|
| `verify:money-precision` | static | That no money path rounds to a hardcoded number of decimals. It asserts **zero** occurrences of the pattern, never a ceiling — a rule that permits "no more than 64" quietly permits a swap: delete one and add another and the count never moves. |
| `verify:money-round-trip` | server | That a three-decimal amount survives compute → store → read → re-total, and that a Kuwaiti journal entry's debits equal its credits **exactly** at the third decimal. The static suite is a claim about the source; this is a claim about the data, and only one of them would catch a `numeric(15,3)` column being written by two-decimal code. |

**Always run these through npm, never `npx tsx` directly.** The scripts carry two flags a suite
cannot supply for itself:

| Flag | Without it |
|---|---|
| `--conditions=react-server` | `import "server-only"` throws on the first import; the suite reports nothing at all. |
| `--env-file-if-exists=.env` | `DATABASE_URL` is unset unless it happens to be exported in the shell; the suite dies before its first query. |

## The failure mode this folder keeps hitting

Four times now, verification machinery has **reported success without having run**. Not wrong
answers — no answers, dressed as answers. It is worth naming as one thing, because the individual
fixes look unrelated and the shape does not:

| # | What happened | How it looked |
|---|---|---|
| 1 | A `createRequire` stub meant to neutralise `server-only` ran after the guard had already thrown. | Five suites executed nothing. Two of their numbers were reported from memory as green. |
| 2 | The same shape again, written after the first was diagnosed. | Same. |
| 3 | `process.env.DATABASE_URL ||= readFileSync(".env")` above the imports. | Never executed once. Looked like a working fallback because the variable happened to be exported in the shell. |
| 4 | A browser suite drove the **previous build**: the rebuilt server had died with `EADDRINUSE` because the old one still held port 3000. | **20/20 PASS**, against code that was not under test. |

The fourth is the most dangerous, and it is worth understanding why. The first three failed loudly
once someone looked — an exception, a missing number. The fourth is silent, repeatable, and emits a
plausible figure. Nothing about the output distinguishes it from a real pass. It was caught only by
noticing that a mutation *should* have failed and did not, and then reading a log.

**The rule that follows: a verification harness may not depend on someone remembering to check
whether it ran.** Every one of these was detectable — by reading a stack trace, a log, a count. That
is not good enough. The check has to be a precondition that refuses to proceed, in the harness
itself:

- `--conditions=react-server` and `--env-file-if-exists=.env` on the npm scripts, so the two things
  a module cannot do for itself are done by the thing that launches it.
- `assertFreshBuild()` at the top of every browser suite, comparing `.next/BUILD_ID` against the
  build the running server actually serves. A stale server, someone else's server, or a rebuild that
  never happened all fail before the browser opens.

When you add a suite, ask what it would print if it silently did not run — and if the answer is
"something plausible", fix the harness, not the suite.

One more rule for the assertions themselves: **compare values, not storage representations.** A
suite that pinned a copied amount to the literal string `"500.00"` broke when the column widened to
`numeric(15,3)` and started returning `"500.000"` — the duplication it tested was working, and the
red run read as a product bug until someone traced it to the text form of a numeric. If the claim
is "the value was copied" or "the total is X", assert the number; pin the string only when the
representation itself IS the claim (e.g. roundMoney's output format).

### The mirror image: a failing suite that is also not telling you what it looks like

The same trap runs the other way, and it nearly produced a much worse report than any of the four
above. `verify-proforma-payments` failed with no `payments` row, no journal entry, no `paidAmount`
and no error message. Driving the dialog by hand reproduced it exactly: the form filled, Save was
enabled, the click landed, **no POST was issued at all**, and the database was untouched. A second
probe against a *sales invoice* — a different document type, a different detail page — reproduced
it identically. Two independent probes agreeing, pointing at a silent data-loss path across every
document type that records payments.

That conclusion was wrong. `RecordPaymentDialog`'s submit handler does not call the action; it
calls `confirm({...})`, and the action runs only from `onConfirm`. Clicking Save opens the shared
confirmation dialog, which the suite — written before the confirmation policy existed — never
clicks. The "dialog still open" the probes kept reporting *was* the confirmation, and its buttons
had been misread as the payment form's own.

**A silent no-op and an unconfirmed confirmation are indistinguishable from outside.** Both show a
live form, an enabled button, a click that lands, no network call and no database change. What
separated them was reading the submit handler — five lines of source — instead of adding a third
probe. Reproducing a symptom more times raises confidence without adding evidence: two probes
agreeing on a wrong conclusion is not corroboration, it is the same mistake twice.

When a UI-driven suite says a write did not happen, read the write path before believing it.

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
server. Run the whole tier with **`npm run verify:browser`**, which is the supported way: it checks the
database is reachable, refuses to start if something already holds the port, builds, starts a
server, runs all 23 in series, prints a count per suite, tears the server down and exits non-zero on
any failure. Flags: `--skip-build`, `--no-server` (drive a server you started), `--only=<substring>`.

Run one directly with `node verify/verify-sidebar-scroll.mjs` when iterating — you are then
responsible for the build being current, which `assertFreshBuild` enforces.

### Why the runner checks Postgres before doing anything else

The database check at the top of `run-browser-suites.mjs` is not defensive boilerplate. It is there
because the cluster stopping mid-session **interrupted three separate runs**. Every browser suite
creates its own organization, so a stopped Postgres does not fail one suite — it fails all 23, each
with a different-looking stack trace, none of which says "the database is down". Twenty-three
unrelated-looking failures is a far worse signal than one refusal, and the time goes into reading
tracebacks instead of into the one-line fix (`pg_ctlcluster 16 main start`).

Same rule as the table above: the harness refuses to start rather than emitting output somebody then
has to interpret.

The tier is discovered, not listed: any `.mjs` in this folder that mentions `localhost:3000` is
picked up, so a new suite runs without anyone remembering to register it.

Every one of them calls `assertFreshBuild(BASE)` from `assert-fresh-build.mjs` before opening the
browser, and refuses to run if the server is answering with a build other than the one in
`.next/BUILD_ID`. **Do not remove that line when adding or editing a suite** — see the table above
for the run it exists to prevent. If it fires, the fix is to stop every running server
(`pkill -f next-server`), confirm the port is free, rebuild, start again.

### The rate-provider mock (`RATE_API_BASE`)

The runner starts the tier's server with `RATE_API_BASE=http://127.0.0.1:12750/v6`, pointing the
real exchange-rate provider (`src/lib/rates/open-er-api.ts`) at localhost instead of the live
service. Two reasons:

1. **The happy fetch path is testable end-to-end.** `verify-rate-oneclick.mjs` hosts a mock er-api
   on that port for the duration of its run, so the one-click "Fetch rate & retry" flow exercises
   the production HTTP/parsing/validation code against a controlled response — localhost bypasses
   this sandbox's egress proxy, which blocks every real rate API.
2. **Every other suite fails fast instead of stalling.** When no mock is listening the port is
   simply dark, so any background rate fetch a suite happens to trigger gets an instant
   ECONNREFUSED rather than a 5-second-per-currency timeout against blocked egress. Same degraded
   behaviour the app is designed for, no wasted wall-clock.

`verify-rate-screen.mjs` depends on the endpoint being UNREACHABLE (it asserts the degraded UX), so
do not host anything on 12750 outside the one-click suite's own lifetime.

**The live service is smoked separately**: `npm run smoke:rates` calls the real open.er-api.com
through the real provider code. It is excluded from every tier on purpose — it depends on outbound
network and someone else's uptime, and the sandbox cannot reach it at all — and belongs on the
deployment box, run by hand. That script is the production-side proof the provider was built on
paper here.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Required. The npm scripts load it from `.env` (relative to the repo root) via `--env-file-if-exists`; an already-exported value wins. No suite reads `.env` itself — see the standing rule above for why that never worked. |
| `CHROMIUM_PATH` | Optional. Overrides the browser binary for the `.mjs` suites; defaults to this sandbox's path. Set it on any other machine. |
| `RATE_API_BASE` | Optional. Overrides the exchange-rate provider's endpoint. The browser-tier runner sets it to `http://127.0.0.1:12750/v6` for the server it starts (see "The rate-provider mock" above); leave it unset everywhere else so production talks to the live service. |

## What these are for

Most of these are mutation-proofed: the assertion was checked by breaking the thing it guards and
confirming it fails, naming the damage. Where an assertion could NOT be made to fail, that is said
in the file rather than left implied — see the notes in `verify-sidebar-scroll.mjs` about the clamp
and about `useLayoutEffect`. An assertion that cannot fail reads as coverage while providing none.
