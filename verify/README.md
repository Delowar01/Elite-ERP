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

### A generated input must be a state the system can actually produce

The same trap has a generator-shaped form, and it is subtler because the suite genuinely runs and
genuinely asserts. `verify-advance-allocations` sweeps hundreds of ways of splitting an advance and
asserts the carried base its consumers take sums to the original exactly. The first version of that
sweep reported a drift — and the drift was not real. **The generator was feeding it amounts the
system cannot store.**

Two different minor units are in play, and they are not the same one:

- a payment's **document amount** and every split of it are stored at the **advance currency's**
  unit, because `recordPaymentAction` rounds them there — so a USD draw can never be `333.333`;
- the **carried base** is stored at the **base currency's** unit, because `capturePaymentBase`
  rounds it there — so a SAR carried base can never be `4,709.995`.

Rounding both at one unit produced inputs `recordPaymentAction` would have rejected, so part of the
sweep was proving a property about data that cannot exist, and its "failure" sent someone chasing a
bug that cannot occur. The label hid it: the case printed as `SAR 999.999`, which reads as an
impossible 3-decimal SAR amount but actually meant *base currency SAR, document currency USD*.
Ambiguous labelling is what let an impossible input look like a real one.

The fix is not to narrow the sweep but to generate honestly: round each figure at the unit for its
own role, and cross a 2-decimal document currency with a 3-decimal one against a 2-decimal and a
3-decimal base. The proof that this mattered is that the mutation it guards is still caught
afterwards, now by a case a customer can actually produce — a USD 10,000 advance in a SAR org split
seven ways strands 0.03 SAR without the residual rule.

**When a sweep or fuzzer reports a failure, check that the input is reachable before treating it as
a bug — and when it reports success, check the same thing before treating it as evidence.** Put
every currency (or unit, or scale) in the case label; the ambiguity is what makes this hide.

### A suite asserts on its own fixtures, never on a whole-database total

Migration scripts sweep every organization, because that is what a migration is for. A suite that
pins the script's printed total is therefore asserting about **the database**, not about the thing
it set up — and on a shared development database, other suites' leftovers decide whether it passes.

This has now been got wrong twice in three commits, both times the same way:

1. `verify-advances-audit` pinned `Totals: A=2 B=2` and read `A=17` — sixteen of them other orgs'
   pre-fix fixtures.
2. `verify-advance-backfill` pinned `migrated=2` and read `migrated=120`.

Neither was a product bug, and neither failure told the truth about what it had tested. The reverse
is the dangerous half: had the totals happened to match, the suite would have reported a pass it had
not earned, because the number it checked was mostly other people's rows.

**Scope every assertion to the fixture's own org** — count that org's rows, or match the script's
per-row log lines for the ids the suite created. Where the global figure genuinely matters (a
migration reporting zero on production, say), assert what it *means* rather than what it equals: the
script printing "nothing to migrate" is a claim; `candidates=0` alone is a number that a script
which never ran would also produce.

### An assertion that observes the right outcome for the WRONG CAUSE

The instances above are assertions that could not fail. This one could, and did observe a real
effect — it was simply the wrong effect, three times running.

The proof: hold an advance's row in a second transaction, then assert an allocation BLOCKS on it,
which shows the availability read is taking the row lock. It passed with the lock deliberately
removed, three times, for three different reasons:

1. **The fixture consumed the advance in full.** Such a conversion also updates that payment's
   `salesInvoiceId`, and *that* statement blocks on the held row all by itself. Fixed by drawing
   only PART of the advance, so the availability read is the only statement touching the row.
2. **The conversion was driven through the UI**, which spends ~3s on scripted waits before the
   action is even issued — inside a 4s observation window. Any conversion would have looked
   blocked. Fixed by replaying the server action directly, so the request is in flight at once.
3. **Inserting the allocation takes an FK lock on the referenced payment.** A conversion with no
   explicit lock blocks too — just LATER, after it has already read availability, which is exactly
   the read two concurrent allocators must not both perform.

**Both states block; blocking alone cannot distinguish them.** That is the whole lesson. The
symptom was identical in the healthy and the broken build, so observing the symptom proved nothing
however carefully it was measured.

The fix is to assert on the MECHANISM rather than the symptom: the suite now reads
`pg_stat_activity` and requires that the statement waiting on the lock is the availability
`SELECT … FOR UPDATE` against `payments` — and under the mutation it fails naming the real waiter,
`Lock: insert into "advance_applications" …`.

**When an assertion depends on a cause rather than an outcome — a lock, a cache hit, a specific
query path, an index being used — assert the cause.** "It was slow", "it blocked", "it errored" are
all satisfiable by mechanisms other than the one under test. And state plainly what the proof does
NOT establish: this one shows the read takes the lock, not that the lock is necessary, because a
conversion serialises on its proforma row anyway. That proof needs two invoices drawing on one
advance concurrently, and belongs where that is possible.

### A query that silently answers a different question than it asks

Not an assertion flaw — the flaw the assertions caught, and it is worth writing down because the
code reviewed as correct and the query ran without error.

Drizzle interpolates a column reference inside a raw `sql` template as a BARE name. This:

```ts
.select({ released: sql`coalesce((select sum(r.released_amount) from advance_application_releases r
                          where r.allocation_id = ${advanceApplicationsTable.id}), 0)::text` })
.from(advanceApplicationsTable)
```

renders as `where r.allocation_id = "id"` — and inside that subquery, `"id"` resolves to the
RELEASE table's own `id`, because `r` is the only table in scope there. The correlated reference
points at the wrong table. Postgres does not complain: the predicate is well-typed, matches nothing,
and the query returns a confident `0`.

Nothing about the failure looked like a SQL bug. Releases posted, the ledger balanced, 2300 landed
on the right figure — only the *effective* allocation figures were wrong, so the visible symptoms
were "an allocation that should have been marked fully released was not" and one FX residual
landing a fils out. Three named assertions failed; the fourth, an exactness sum, passed by
coincidence of rounding.

**You cannot judge an instance by reading the TypeScript.** A codebase-wide audit rendered every
raw fragment that interpolates a column, and the same column object renders differently depending
on where it sits:

| context | renders as | safe? |
|---|---|---|
| single-table `.from()`, in the select list | `"id"` | **no** — rebinds inside a subquery |
| joined query (two or more tables), select list | `"payments"."id"` | yes |
| single-table `.from()`, in `.orderBy()` | `"orgs"."id"` | yes |

**Safety is a property of the QUERY, not of the fragment.** Two subqueries in
`listAvailableAdvancesForInvoice` are correct only because that query happens to join
`proforma_invoices`; removing the join — an entirely plausible refactor — would silently break both,
with no type error and no SQL error. Nobody will remember that a join three lines away is load-bearing
for a fragment's correctness.

**So: write the qualified name (`advance_applications.id`) in raw SQL rather than interpolating a
column, even where the current query renders it safely.** And if a raw fragment computes a figure
the app depends on, assert that figure against an independently written query. The suite here
computes availability twice, once through the shipped helper and once through hand-written SQL in
the fixture; the mismatch is what exposed it. A single source of truth in a test is only a test of
itself.

The audit's reassuring half is structural rather than lucky: reports, aging, statements and project
costing interpolate columns only into FLAT aggregates (`sum(${journalLinesTable.debit})`), which
have no nested scope for a bare name to rebind into.

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
