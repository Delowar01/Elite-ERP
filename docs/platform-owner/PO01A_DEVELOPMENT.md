# Platform Owner — PO-01A development notes

PO-01A delivers the **backend foundation only**: the four platform identity tables, a reviewed SQL
migration, the server-only authentication library in `src/lib/platform/`, and a local-only bootstrap
CLI. There are no routes, UI or proxy changes yet; those are PO-01B. Nothing here is deployed, and
nothing has been applied to production. Production application of the schema is PO-00 decision **D-6**.

Canonical specifications: PR #11 (draft, unmerged), `docs/platform-owner/stage-2/*` at `357e93e`.
Baseline audit: [`PO00_BASELINE.md`](./PO00_BASELINE.md).

## Environment variables

Names only. Values are never committed; `.env.example` is intentionally unchanged.

| Variable | Used by | Rule |
|---|---|---|
| `PLATFORM_AUTH_SECRET` | platform tokens, throttle-key HMAC | Required. At least 32 bytes, and **must differ** from `AUTH_SECRET`. There is no fallback; anything else fails closed (`CONFIG_ERROR`). |
| `PLATFORM_CONSOLE_ENABLED` | whole console | **Default off.** Only the exact string `true` enables it. |
| `FIELD_ENCRYPTION_KEYS` | TOTP secret encryption (existing) | Required. Platform TOTP secrets are stored only as encryption envelopes. |
| `PLATFORM_TEST_ADMIN_DATABASE_URL` | verification suites only | A loopback `*_test_only_*` database on a loopback-only server, used to create and drop disposable test databases. |
| `PLATFORM_TEST_KEEP_DATABASES` | verification suites only | `1` keeps the disposable databases for inspection. |

The platform scripts deliberately do **not** load `.env` (`--env-file-if-exists` is not used), so a
developer `.env` pointing at a shared database is never picked up by accident.

## Disposable PostgreSQL (loopback only)

~~~bash
# PostgreSQL >= 14 binaries; run as the postgres OS user; nothing listens beyond 127.0.0.1
initdb -D /tmp/po01a_test_only_pg/data --auth=trust -U postgres
pg_ctl -D /tmp/po01a_test_only_pg/data -o "-p 55432 -c listen_addresses=127.0.0.1" -l /tmp/po01a_test_only_pg/server.log start
createdb -h 127.0.0.1 -p 55432 -U postgres po01a_test_only_admin
export PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:55432/po01a_test_only_admin
npm run verify:platform
~~~

## Commands

| Command | What it does |
|---|---|
| `npm run platform:db:apply` | Applies `drizzle/platform/PO01_platform_identity.sql` (idempotent), then verifies the tables and the append-only protection. |
| `npm run platform:db:check` | Read-only check of the tables and the protection, judged by catalog semantics rather than trigger names. |
| `npm run platform:bootstrap` | Interactive one-time creation of the first Platform Owner (fictional data in PO-01A). |
| `npm run verify:platform` | `verify:platform-boundary` (static), `-schema`, `-auth` and `-bootstrap` (disposable DBs). |

### Fail-closed database guard (`scripts/platform/local-db-guard.ts`)

Every platform database operation refuses a target unless **all** of these hold:

- the URL is `postgres://`/`postgresql://` with a single loopback host (`127.0.0.1`, `::1` or `localhost`);
- there is no `host`/`hostaddr`/`options`/`service`/… parameter;
- the database name contains `_test_only_`.

After connecting, it also requires a loopback server address, loopback-only `listen_addresses`, a
matching `current_database()` and PostgreSQL ≥ 14. A refused target is never connected to (URL
checks), or is disconnected before any other statement (server checks). The URL is never printed.

### Bootstrap exit codes

| Code | Meaning |
|---|---|
| 0 | Created. |
| 1 | Error. |
| 2 | Unsafe target. |
| 3 | An active administrator already exists. |
| 4 | Not an interactive terminal. |
| 5 | Not ready (schema, protection or encryption). |
| 6 | Aborted (too many invalid answers). |

Checks 2, 5 and 3 run before any prompt. The uniqueness check is repeated under an advisory lock
inside the insert transaction.

## Migration rules (PO-00 §F.2)

- Do **not** run `drizzle-kit generate` into `drizzle/`. The historical migrations (`0000`–`0004`) are
  incomplete relative to the live schema, and a generated migration would bundle unrelated drift.
  Do not edit them.
- `src/db/schema/platform.ts` is the source of truth for tables, columns, constraints and indexes.
  The SQL file must stay catalog-equivalent to it; `verify:platform-schema` proves it. The SQL file
  alone also creates the append-only triggers, which `drizzle-kit push` cannot create.
- `npm run db:preflight` still reports **INCONSISTENT** for push-shaped databases. That is unchanged
  by PO-01A and is the D-6 decision.

## Provisional policies — owner confirmation required before production

| Policy | PO-01A value | Where |
|---|---|---|
| Session lifetime | 12 h absolute, 30 min idle (D-9). The DB enforces the 12 h ceiling. | `src/lib/platform/config.ts`, `platform_sessions_expiry_chk` |
| Password | ≥ 14 characters, upper/lower/number/symbol, not common, ≤ 72 bytes, must not contain the e-mail name; bcrypt cost 12 | `src/lib/platform/auth.ts` |
| Throttling | Account: 5 failures / 15 min → 15 min block; 20 / 24 h → 24 h. IP: 20 / 15 min → 15 min; 100 / 24 h → 24 h. | `src/lib/platform/throttle.ts` |
| Recovery codes | 10 single-use codes, bcrypt cost 10 (shared generator, 40-bit codes, online attempts throttled) | `src/lib/platform/mfa.ts` |

## Deliberately not in PO-01A (PO-01B)

`/platform/login`, the MFA and recovery screens, `/platform/recover`, the platform shell, sidebar
and seven pages, the security settings UI, the proxy branch, cookie set/clear, and browser, RTL and
responsive acceptance. The guards (`requirePlatformSession`, `requirePlatformPermission`) exist but
are not wired to any route. End-to-end browser authentication has **not** been tested.
