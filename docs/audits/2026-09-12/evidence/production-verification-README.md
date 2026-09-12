# Production verification — how to establish what is deployed

**Read-only. Nothing here writes to production, and no credential needs to be shared with anyone.**

The audit could not determine what is running in production: no credentials were
present in the audit environment and none were sought. These checks close that
gap. Run them yourself; paste the output back.

## 1. Which commit is live

Column presence does not establish this, so check it directly, in this order of preference:

1. **Vercel dashboard → the production deployment → "Source"**, which names the commit SHA. This is the authoritative answer.
2. `vercel inspect <deployment-url>` if the CLI is authenticated.
3. Compare against `04457ff29948111bd5d24eff3eaf4e75b90971cf` (the audited commit, still `HEAD` of `main`).

If the live SHA is older than `04457ff`, the four-to-six pending columns and the
code that uses them are both absent, and the deploy runbook in `docs/backlog.md`
applies as written.

## 2. Schema and controls

Run `production-verification.sql` against the production database with a
read-only role:

```
psql "$PROD_READONLY_URL" -f production-verification.sql
```

Six queries, each annotated with what the answer means:

| Query | Establishes |
|---|---|
| **Q1** | whether the six pending columns exist |
| **Q2** | whether the database was built by `db:push` (66 tables / 812 columns) or by the stale committed migrations (59 / 609) — the gap is 204 columns to add and 1 to drop, a net +203 |
| **Q3** | whether the seven tables a migrations-only deploy would lack are present |
| **Q4** | whether the two append-only audit triggers are installed |
| **Q5** | whether any backfill still has work — bank openings, credited amounts, unconverted foreign documents |
| **Q6** | whether the reversal **code** is live, not merely its columns |

## 3. Why column presence is not enough

Four things can be true independently, and Q1 only answers the first:

1. the columns exist;
2. the **code** that reads and writes them is deployed (Q6 gives positive evidence, never negative proof);
3. the **controls** that must accompany the schema are installed — the append-only triggers are installed by `npm run db:harden`, which `npm run db:push` chains, and which a bare `drizzle-kit push` does **not** (verified in the audit: a raw push produced 0 of 2 triggers);
4. any **backfill** has been run (Q5).

A deployment can pass Q1 and still be broken on any of 2, 3 or 4.

## 4. What not to do

- **Do not run `npm run db:migrate`.** The committed migrations stop at `0004` (22 July 2026). The audit measured what that produces: a database short **7 tables and 204 columns**, and carrying **1 column that must be dropped** — a net 203 fewer columns than the current schema. `db:migrate` would report success having applied nothing useful, and the deploy would then fail on missing columns.
- **Do not run any script from `scripts/migrations/` against production** until its matching runbook entry in `docs/backlog.md` has been read — two of them have deliberately **opposite** orderings relative to the code deploy, and the bank-opening backfill is the one that runs *after* it.
