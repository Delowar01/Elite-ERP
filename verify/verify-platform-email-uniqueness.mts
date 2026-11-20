/**
 * Platform Owner PO-02D3 — the e-mail uniqueness SECURITY GATE (docs/platform-owner/PO02D3_DEVELOPMENT.md §D).
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   npm run verify:platform-email-uniqueness
 *
 * Question: can invitation acceptance and the existing customer user writers (/register, team members) ever create two
 * customer accounts for one e-mail address, under any interleaving? Real PostgreSQL, deterministic barriers (a statement
 * is observed waiting in pg_stat_activity before the competing transaction is allowed to finish), disposable
 * `*_test_only_*` databases, fictional rows only.
 *
 *   1. what the database guarantees today (users_email_unique, case-SENSITIVE) and what it does not;
 *   2. every application writer of users.email stores the normalized (trim + lower-case) address — statically;
 *   3. races on the real constraint: the second writer of one normalized address always loses with 23505 and its whole
 *      transaction (organization included) rolls back; a non-normalized writer is NOT stopped (the residual gap);
 *   4. the additive proposal users_email_lower_uq (docs/platform-owner/po02d3/proposal/), exercised only here: the
 *      read-only audit, the refusal over duplicates, CONCURRENTLY locking (reads and writes continue), conflicts after
 *      the build, an INVALID leftover and its recovery, and the rollback.
 * The end-to-end races through the acceptance and /register code are in verify:platform-invitation-acceptance.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Client } from "pg";
import { connectDisposable, createPlatformTestDatabase, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { describeError, ok, section, sqlState, summary } from "./platform/harness";
import { pidOf, runOrBlocked, waitsOnLock } from "./platform/lock-probes";

const ROOT = process.cwd();
const PROPOSAL = join(ROOT, "docs/platform-owner/po02d3/proposal/users_email_lower_unique.proposal.sql");
const ROLLBACK = join(ROOT, "docs/platform-owner/po02d3/proposal/users_email_lower_unique_rollback.proposal.sql");
const AUDIT = join(ROOT, "docs/platform-owner/po02d3/sql/users_email_audit_readonly.sql");
const LOWER_DEF = "CREATE UNIQUE INDEX users_email_lower_uq ON public.users USING btree (lower(email))";

/** The file's `-- statement` blocks, in order (psql meta-commands dropped). */
function statements(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/^-- statement$/m)
    .slice(1)
    .map((s) => s.split("\n").filter((l) => !l.startsWith("\\")).join("\n").trim())
    .filter(Boolean);
}
const isGuard = (s: string) => s.includes("$proposal_guard$");

async function runFile(c: Client, file: string, opts: { withGuard?: boolean } = {}): Promise<void> {
  for (const s of statements(file)) {
    if (isGuard(s) && !opts.withGuard) continue;
    await c.query(s);
  }
}

async function auditRows(c: Client): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const s of statements(AUDIT)) {
    const r = await c.query(s);
    const row = (r.rows?.[0] ?? null) as Record<string, unknown> | null;
    if (row && typeof row.check_id === "string") out[row.check_id] = row;
  }
  return out;
}

const indexState = async (c: Client) =>
  (
    await c.query(
      `select pg_get_indexdef(i.oid) as def, ix.indisvalid as valid from pg_class i join pg_index ix on ix.indexrelid = i.oid
       join pg_namespace n on n.oid = i.relnamespace where n.nspname = 'public' and i.relname = 'users_email_lower_uq'`,
    )
  ).rows[0] as { def: string; valid: boolean } | undefined;

let seq = 0;
const email = (tag: string) => `${tag}.${++seq}@uniqueness-fixture.test`;

async function newOrg(c: Client, name: string): Promise<number> {
  return Number((await c.query(`insert into orgs (name, country, currency) values ($1, 'Saudi Arabia', 'SAR') returning id`, [name])).rows[0].id);
}
const insertUser = (c: Client, org: number, address: string) =>
  c.query(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, 'x', 'Fixture Owner', 'owner') returning id`, [org, address]);
const countEmail = async (c: Client, address: string, ci = false) =>
  Number((await c.query(ci ? `select count(*)::int as n from users where lower(email) = lower($1)` : `select count(*)::int as n from users where email = $1`, [address])).rows[0].n);

/** Every src/ file (ts/tsx). */
function srcFiles(dir = join(ROOT, "src")): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...srcFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

async function main(): Promise<number> {
  const dbs: string[] = [];
  const clients: Client[] = [];
  const connect = async (url: string) => {
    const c = await connectDisposable(url);
    c.on("error", () => undefined);
    clients.push(c);
    return c;
  };
  try {
    // ---------------------------------------------------------------------------------------------------------------
    section("1. What the database guarantees today");
    const base = await createPlatformTestDatabase("po02d3_email");
    dbs.push(base.name);
    const a = await connect(base.url);
    const b = await connect(base.url);
    const obs = await connect(base.url);
    const uniques = (
      await obs.query(`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.users'::regclass and contype = 'u' order by 1`)
    ).rows as { conname: string; def: string }[];
    ok("users carries the case-SENSITIVE constraint users_email_unique = UNIQUE (email)", uniques.some((u) => u.conname === "users_email_unique" && u.def === "UNIQUE (email)"), JSON.stringify(uniques));
    ok("…and no case-insensitive key exists (no lower(email) index on the branch schema)", !(await indexState(obs)) &&
      Number((await obs.query(`select count(*)::int as n from pg_indexes where schemaname = 'public' and tablename = 'users' and indexdef ilike '%lower(email)%'`)).rows[0].n) === 0);

    // ---------------------------------------------------------------------------------------------------------------
    section("2. Every application writer of users.email stores the normalized address (static)");
    const files = srcFiles();
    const rel = (f: string) => relative(ROOT, f);
    const inserters = files.filter((f) => /\.insert\(usersTable\)/.test(readFileSync(f, "utf8"))).map(rel).sort();
    // PO-03D (sub-batch A): plus the user-invitation acceptance bridge — the invitee's own account, under the SAME e-mail
    // advisory lock and lower(email) check (verify:platform-user-acceptance K6–K8).
    ok("exactly three modules insert users: the shared organization bootstrap, the team-member action and (PO-03D) the user-invitation acceptance bridge",
      JSON.stringify(inserters) === JSON.stringify(["src/app/(app)/settings/team/actions.ts", "src/lib/onboarding/user-invitation-acceptance.ts", "src/lib/org-bootstrap.ts"]), inserters.join(", "));
    const emailUpdates = files.filter((f) => /\.update\(usersTable\)\s*\.set\(\{[^}]*\bemail\b/.test(readFileSync(f, "utf8"))).map(rel);
    ok("no code path changes an existing users.email (no UPDATE … SET email anywhere in src)", emailUpdates.length === 0, emailUpdates.join(", "));
    const rawUserWrites = files.filter((f) => /\b(insert\s+into|update)\s+"?users"?\b/i.test(readFileSync(f, "utf8"))).map(rel);
    ok("no raw SQL in src inserts into or updates users", rawUserWrites.length === 0, rawUserWrites.join(", "));
    const team = readFileSync(join(ROOT, "src/app/(app)/settings/team/actions.ts"), "utf8");
    ok("the team-member action normalizes: String(email).trim().toLowerCase() before its insert",
      /const email = String\(formData\.get\("email"\) \?\? ""\)\.trim\(\)\.toLowerCase\(\);[\s\S]*\.insert\(usersTable\)/.test(team));
    const auth = readFileSync(join(ROOT, "src/app/(auth)/actions.ts"), "utf8");
    ok("/register normalizes: String(email).trim().toLowerCase() before bootstrapOrganization",
      /export async function registerAction[\s\S]*?const email = String\(formData\.get\("email"\) \?\? ""\)\.trim\(\)\.toLowerCase\(\);[\s\S]*?bootstrapOrganization\(tx,/.test(auth));
    const bootstrap = readFileSync(join(ROOT, "src/lib/org-bootstrap.ts"), "utf8");
    ok("the shared bootstrap refuses an owner e-mail that is not already normalized (one choke point for owners)",
      /fields\.ownerEmail !== fields\.ownerEmail\.trim\(\)\.toLowerCase\(\)/.test(bootstrap) && /throw new /.test(bootstrap));
    const acceptance = readFileSync(join(ROOT, "src/lib/onboarding/invitation-acceptance.ts"), "utf8");
    ok("invitation acceptance creates the owner through the shared bootstrap with the invitation's normalized e-mail",
      /bootstrapOrganization\(tx, \{[\s\S]*?ownerEmail: f\.ownerEmail,/.test(acceptance));

    // ---------------------------------------------------------------------------------------------------------------
    section("3. Races on the real constraint (deterministic barriers)");
    const orgA = await newOrg(obs, "Uniqueness Fixture A");
    const orgB = await newOrg(obs, "Uniqueness Fixture B");
    {
      const addr = email("race-commit");
      await a.query("begin isolation level read committed");
      await b.query("begin isolation level read committed");
      await insertUser(a, orgA, addr);
      const bPid = await pidOf(b);
      const bInsert = insertUser(b, orgB, addr).then(() => null, (e) => e);
      ok("3a. the second writer of one normalized address WAITS on the first (observed in pg_stat_activity)", await waitsOnLock(obs, bPid));
      await a.query("commit");
      const err = await bInsert;
      ok("…when the first commits, the second fails with 23505 on users_email_unique", sqlState(err) === "23505" && /users_email_unique/.test(String((err as { constraint?: string })?.constraint ?? describeError(err))), describeError(err));
      await b.query("rollback");
      ok("…and exactly one account holds the address", (await countEmail(obs, addr)) === 1);
    }
    {
      const addr = email("race-abort");
      await a.query("begin isolation level read committed");
      await b.query("begin isolation level read committed");
      await insertUser(a, orgA, addr);
      const bPid = await pidOf(b);
      const bInsert = insertUser(b, orgB, addr).then(() => null, (e) => e);
      ok("3b. the second writer waits again", await waitsOnLock(obs, bPid));
      await a.query("rollback");
      const err = await bInsert;
      await b.query("commit");
      ok("…when the first ROLLS BACK, the second succeeds — still exactly one account", err === null && (await countEmail(obs, addr)) === 1, describeError(err));
    }
    {
      // A /register-shaped transaction (org + owner + one default row) losing the race leaves NOTHING behind.
      const addr = email("race-org");
      const before = Number((await obs.query(`select count(*)::int as n from orgs`)).rows[0].n);
      await a.query("begin isolation level read committed");
      await b.query("begin isolation level read committed");
      const aOrg = await newOrg(a, "Uniqueness Fixture Racer A");
      await insertUser(a, aOrg, addr);
      const bOrg = await newOrg(b, "Uniqueness Fixture Racer B");
      const bPid = await pidOf(b);
      const bInsert = insertUser(b, bOrg, addr).then(() => null, (e) => e);
      ok("3c. two organization-creating transactions for one address: the second waits on the first's owner row", await waitsOnLock(obs, bPid));
      await a.query("commit");
      const err = await bInsert;
      await b.query("rollback");
      const after = Number((await obs.query(`select count(*)::int as n from orgs`)).rows[0].n);
      ok("…the loser fails with 23505 and its whole transaction rolls back: one new organization, one account",
        sqlState(err) === "23505" && after === before + 1 && (await countEmail(obs, addr)) === 1, `orgs ${before}→${after}; ${describeError(err)}`);
    }
    {
      // 3d. A failure between the organization and the user insert (the user insert itself fails) leaves no organization.
      const addr = email("failure");
      await insertUser(obs, orgA, addr);
      const before = Number((await obs.query(`select count(*)::int as n from orgs`)).rows[0].n);
      await a.query("begin isolation level read committed");
      const aOrg = await newOrg(a, "Uniqueness Fixture Failure");
      const err = await insertUser(a, aOrg, addr).then(() => null, (e) => e);
      await a.query("rollback");
      const after = Number((await obs.query(`select count(*)::int as n from orgs`)).rows[0].n);
      ok("3d. a database failure between the organization and the owner insert leaves no organization behind", sqlState(err) === "23505" && after === before, `orgs ${before}→${after}`);
    }
    {
      // 3e. The residual: a writer that does NOT normalize is not stopped by the case-sensitive constraint.
      const lower = email("residual");
      const upper = lower.replace(/^residual/, "Residual").toUpperCase();
      await insertUser(obs, orgA, lower);
      const err = await insertUser(obs, orgB, upper).then(() => null, (e) => e);
      ok("3e. RESIDUAL (documented): a non-normalized writer (manual SQL, import, future code) CAN add a case-variant twin today",
        err === null && (await countEmail(obs, lower, true)) === 2);
      ok("…the acceptance check (lower(email) = normalized) sees that committed twin, so acceptance still refuses the address",
        Number((await obs.query(`select count(*)::int as n from users where lower(email) = $1`, [lower])).rows[0].n) === 2);
      await obs.query(`delete from users where email = $1`, [upper]);
    }

    // ---------------------------------------------------------------------------------------------------------------
    section("4. The additive proposal users_email_lower_uq — disposable databases only");
    {
      const guardErr = await runFile(obs, PROPOSAL, { withGuard: true }).then(() => null, (e) => e);
      ok("4a. the proposal refuses to run as committed (its approval guard raises before any statement)", /not approved for execution/.test(describeError(guardErr)) && !(await indexState(obs)));
      const rbGuard = await runFile(obs, ROLLBACK, { withGuard: true }).then(() => null, (e) => e);
      ok("…and so does its rollback", /not approved for execution/.test(describeError(rbGuard)));
      const proposalText = readFileSync(PROPOSAL, "utf8");
      ok("…the proposal builds CONCURRENTLY, outside a transaction, and lives outside drizzle/ (no migration chain applies it)",
        /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS users_email_lower_uq ON public\.users USING btree \(lower\(email\)\);/.test(proposalText) &&
          !/^\s*(BEGIN|START)(\s+(TRANSACTION|WORK))?\s*;/im.test(proposalText) && !readdirSync(join(ROOT, "drizzle/platform")).some((f) => /email_lower/.test(f)));
    }
    {
      // The read-only audit on an anomalous fixture database, then the refusal over duplicates.
      const anomalous = await createPlatformTestDatabase("po02d3_email_dup");
      dbs.push(anomalous.name);
      const d = await connect(anomalous.url);
      const org = await newOrg(d, "Uniqueness Fixture Legacy");
      await insertUser(d, org, "legacy.owner@uniqueness-fixture.test");
      await insertUser(d, org, "Legacy.Owner@Uniqueness-Fixture.test");
      await insertUser(d, org, " spaced.owner@uniqueness-fixture.test");
      await insertUser(d, org, "\u00fcml\u00e4ut.owner@uniqueness-fixture.test");
      const audit = await auditRows(d);
      ok("4b. the read-only audit reports the legacy duplicate group (E1 = 1, 2 rows), the non-normalized rows (E2 = 2), white space (E3 = 1) and non-ASCII (E4 = 1)",
        Number(audit.E1?.groups) === 1 && Number(audit.E1?.rows_involved) === 2 && Number(audit.E2?.rows) === 2 && Number(audit.E3?.rows) === 1 && Number(audit.E4?.rows) === 1,
        JSON.stringify({ E1: audit.E1, E2: audit.E2?.rows, E3: audit.E3, E4: audit.E4 }));
      ok("…the audit prints ids and counts only — never an address", !JSON.stringify(audit).includes("@"));
      const inTx = (await d.query(`select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'`)).rows[0].n;
      ok("…and it leaves no transaction open (one READ ONLY transaction, rolled back)", Number(inTx) === 0);
      const refused = await runFile(d, PROPOSAL).then(() => null, (e) => e);
      ok("4c. over that duplicate group the proposal REFUSES at step 1 and builds nothing", /duplicate e-mail group/.test(describeError(refused)) && !(await indexState(d)), describeError(refused));
      // An interrupted / failed build: run the build statement directly (bypassing step 1) over the duplicates.
      const failed = await d.query(`create unique index concurrently users_email_lower_uq on public.users using btree (lower(email))`).then(() => null, (e) => e);
      const leftover = await indexState(d);
      ok("4d. a build that fails over duplicates fails with 23505 and leaves an INVALID index behind", sqlState(failed) === "23505" && leftover !== undefined && leftover.valid === false);
      const overInvalid = await runFile(d, PROPOSAL).then(() => null, (e) => e);
      ok("…the proposal refuses to continue over the INVALID leftover and names the recovery", /INVALID/.test(describeError(overInvalid)));
      await runFile(d, ROLLBACK);
      ok("…the rollback drops the leftover (CONCURRENTLY) and keeps users_email_unique", !(await indexState(d)) &&
        Number((await d.query(`select count(*)::int as n from pg_constraint where conrelid = 'public.users'::regclass and conname = 'users_email_unique'`)).rows[0].n) === 1);
      await d.query(`delete from users where email = 'Legacy.Owner@Uniqueness-Fixture.test'`);
      await runFile(d, PROPOSAL);
      const built = await indexState(d);
      ok("…after the owner resolves the duplicate, the same file builds the index: valid, exactly the reviewed definition", built?.valid === true && built.def === LOWER_DEF, JSON.stringify(built));
    }
    {
      // CONCURRENTLY locking on a populated table: reads and writes continue while the build waits for an older transaction.
      const big = await createPlatformTestDatabase("po02d3_email_cic");
      dbs.push(big.name);
      const x = await connect(big.url);
      const y = await connect(big.url);
      const z = await connect(big.url);
      const o = await connect(big.url);
      const org = await newOrg(o, "Uniqueness Fixture Load");
      await o.query(`insert into users (org_id, email, password_hash, name, role)
                     select $1, 'load.' || g || '@uniqueness-fixture.test', 'x', 'Fixture User ' || g, 'staff' from generate_series(1, 20000) g`, [org]);
      await y.query("begin isolation level read committed");
      await insertUser(y, org, email("older-transaction"));
      const xPid = await pidOf(x);
      const build = (async () => {
        for (const s of statements(PROPOSAL).filter((st) => !isGuard(st))) await x.query(s);
      })().then(() => null, (e) => e);
      ok("4e. the CONCURRENTLY build waits for the transaction that was already open (observed waiting)", await waitsOnLock(o, xPid));
      const held = (await o.query(`select l.mode from pg_locks l where l.pid = $1 and l.relation = 'public.users'::regclass and l.granted`, [xPid])).rows.map((r) => r.mode as string);
      ok("…holding only SHARE UPDATE EXCLUSIVE on users (no SHARE, no ACCESS EXCLUSIVE)", held.includes("ShareUpdateExclusiveLock") && !held.some((m) => ["ShareLock", "ShareRowExclusiveLock", "ExclusiveLock", "AccessExclusiveLock"].includes(m)), held.join(", "));
      const zPid = await pidOf(z);
      const steps = [
        await runOrBlocked(o, z, zPid, "read users", `select count(*) from users where org_id = $1`, [org]),
        await runOrBlocked(o, z, zPid, "INSERT users (registration)", `insert into users (org_id, email, password_hash, name, role) values ($1, $2, 'x', 'Fixture Owner', 'owner')`, [org, email("during-build")]),
        await runOrBlocked(o, z, zPid, "UPDATE users (sign-in)", `update users set last_login_at = now() where org_id = $1 and email like 'load.1@%'`, [org]),
      ];
      ok("…while it builds, reads, registrations and sign-in updates on users all complete without waiting", steps.every((s) => s.ok), steps.map((s) => `${s.label}:${s.ok ? "ok" : s.waitingFor ?? s.code}`).join(" · "));
      await y.query("commit");
      const buildErr = await build;
      const built = await indexState(o);
      ok("…once the older transaction ends the build completes: the index is valid and exactly the reviewed definition", buildErr === null && built?.valid === true && built.def === LOWER_DEF, describeError(buildErr));
      // After the build: the database itself refuses a case-variant twin, also under concurrency.
      const lower = email("after-build");
      await insertUser(o, org, lower);
      const twinErr = await insertUser(o, org, lower.toUpperCase()).then(() => null, (e) => e);
      ok("4f. after the build a case-variant twin is refused by the DATABASE (23505 on users_email_lower_uq)", sqlState(twinErr) === "23505" && /users_email_lower_uq/.test(String((twinErr as { constraint?: string })?.constraint)));
      const mixed = email("after-build-race");
      await y.query("begin isolation level read committed");
      await x.query("begin isolation level read committed");
      await insertUser(y, org, mixed.toUpperCase());
      const racer = insertUser(x, org, mixed).then(() => null, (e) => e);
      ok("…and under concurrency: a case-variant insert waits on the uncommitted twin", await waitsOnLock(o, xPid));
      await y.query("commit");
      const raceErr = await racer;
      await x.query("rollback");
      ok("…then fails with 23505 when the twin commits — one account for the address in any letter case", sqlState(raceErr) === "23505" && (await countEmail(o, mixed, true)) === 1);
      await runFile(o, ROLLBACK);
      await runFile(o, ROLLBACK);
      ok("4g. the rollback is idempotent and restores the branch shape (no lower(email) index; users_email_unique intact)", !(await indexState(o)) &&
        Number((await o.query(`select count(*)::int as n from pg_constraint where conrelid = 'public.users'::regclass and conname = 'users_email_unique'`)).rows[0].n) === 1);
    }
    {
      const clean = await auditRows(obs);
      ok("4h. on a database whose rows are all normalized the audit reports E1 = 0 (the precondition for approval)", Number(clean.E1?.groups) === 0, JSON.stringify(clean.E1));
    }
  } catch (e) {
    ok("suite ran to completion", false, describeError(e));
  } finally {
    for (const c of clients) await c.end().catch(() => undefined);
    for (const name of dbs) await dropDisposableDatabase(name).catch(() => undefined);
  }
  return summary("verify:platform-email-uniqueness");
}

process.exit(await main());
