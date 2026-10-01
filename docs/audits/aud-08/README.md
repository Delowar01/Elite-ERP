# AUD-08.1 — migration measurement, preflight and data-equivalence proof

Read-only measurement tooling and negative controls for the AUD-08 migration baseline. **This batch
authors no migration.** `drizzle/` is untouched, `src/` is untouched, nothing is stamped.

## What is here

| Path | Purpose |
|---|---|
| `../../../scripts/migration-preflight.ts` | `npm run db:preflight` — the read-only gate. Journal invariants, exact bookkeeping correspondence, schema/bookkeeping consistency, three outcome states. |
| `../../../verify/verify-migration-baseline.mts` | Reference shapes, the F1–F6 / F7 two-stage fingerprint, the gap re-measurement, experiments E6b–E19. |
| `../../../verify/verify-terms-split.mts` | E16 — the 18 approved fixtures pinning `splitGroupTerms()` semantics, plus the frozen-copy drift test. |
| `evidence/schema-reference.json` | Measured reference digests. `db:preflight` reads this to recognise a `db:push`-equivalent shape. |
| `evidence/gap-measurement.json` | The re-measured historical gap and every experiment's recorded outcome. |
| `evidence/verify-migration-baseline.txt` | Full transcript of the last run. |

## Reproducing

The baseline suite creates, modifies and drops databases, so it refuses to guess a target. It never
reads the repository's own `DATABASE_URL`, and it will not fall back to anything.

```sh
# Every database it touches is named aud081_*, and the host must be local.
AUD08_ADMIN_URL="postgresql://<user>:<pass>@127.0.0.1:5432/postgres" \
  npx tsx --conditions=react-server verify/verify-migration-baseline.mts

# No database required.
npx tsx --conditions=react-server verify/verify-terms-split.mts

# Read-only, against whichever database DATABASE_URL names.
DATABASE_URL="postgresql://..." npm run db:preflight
```

`db:preflight` exit codes: `0` OK · `10` BASELINE RECONCILIATION REQUIRED · `20` INCONSISTENT ·
`1` tool error. The baseline suite exits `2` when no disposable target was supplied.

## Findings this batch established

1. **The gap is NOT purely additive.** 7 tables and 204 columns to add, 1 to drop — and **61 shared
   columns differ in numeric precision/scale** (53× `numeric(14,2)`→`numeric(15,3)`, 8×
   `numeric(12,2)`→`numeric(15,3)`, across 22 tables). The September 2026 audit concluded no shared
   column differed; its fingerprint omitted `numeric_precision` and `numeric_scale`, and
   `data_type` is simply `numeric` on both sides, so the widening was invisible to it. `0005` must
   carry 61 `ALTER COLUMN ... TYPE` statements. All 61 are widenings, so no stored value is at risk.
2. **`drizzle-kit push` is not usable to converge an existing migrations-built database** — it hits
   the same `promptColumnsConflicts` TTY failure as `generate`, `--force` does not help, and **it
   exits 0 having applied nothing** (E19). Any `push && next-step` chain proceeds on a stale schema.
3. **`verify:db-hardening` is satisfied by decoy triggers.** Two triggers carrying the required
   names on an unrelated table make `--check` exit 0 while the real triggers are absent (E9). The
   check matches on `tgname` alone. Tightening it is an **AUD-08.3** requirement; AUD-08.1 is not
   authorized to change it, so the measured failure is recorded rather than fixed.
4. **Three ways drizzle fails silently with exit 0**, each now demonstrated: a pending migration at
   or below the watermark is skipped (E6b); a wall-clock stamp skips the entire history (E7); a
   missing middle bookkeeping row is invisible because only `MAX(created_at)` is ever read (E13).

See the DEV-00-C2 and AUD-08-P0-C1 correction documents for how these feed AUD-08.2 and AUD-08.3.
