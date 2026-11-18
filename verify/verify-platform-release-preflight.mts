/**
 * Platform Owner PO-02D1A.1 — the release preflight (scripts/platform/release-preflight.ts, `npm run
 * platform:db:preflight`) against the dangerous migration orders H-1 / H-2, on disposable databases only.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-release-preflight
 *
 * Proves, by running the real CLI and the real `drizzle-kit push`:
 *   - the supported order (reviewed SQL first, then push) passes, and push then changes nothing reviewed;
 *   - push BEFORE the reviewed SQL is refused before any modifying command runs — on today's production shape with
 *     customer rows (H-1 TRUNCATE prompt + H-2), on the pre-onboarding branch shape with users (H-1 + H-2) and on an
 *     empty-user fixture (H-2) — with a GATED push (`preflight && push`, the proposed db:push change, not applied to
 *     db:push) that never reaches push, and an ungated push showing each hazard is real (no prompt is ever answered);
 *   - a partial push-created schema is recognised (PARTIAL_PUSH_CREATED) and recovers through the reviewed rollback
 *     step 1 and the reviewed SQL;
 *   - every detector fires on its own (PO-01A, PO-02A, F1, PO-02D1A, triggers, ordering, journal, TRUNCATE / DROP /
 *     destructive replacement, target identity), the catalog is restored after each, and the tool fails closed when it
 *     cannot read the catalog (lock contention → exit 1, never a pass);
 *   - it is read-only: its session is READ ONLY and every database's catalog and data are byte-identical after it ran.
 * Fictional rows only; every database is dropped at the end (PLATFORM_TEST_KEEP_DATABASES=1 keeps them).
 */
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import {
  connectDisposable,
  createDisposableDatabase,
  disposableName,
  dropDisposableDatabase,
  pushSchema,
  pushPreCompanyTenantSchema,
  applyPlatformMigration,
} from "../scripts/platform/disposable-db";
import { projectCatalog, projectionDigest, checkOnboardingFoundation, ONBOARDING_TABLES, PLATFORM_OWNED_TABLES, PLATFORM_SQL_PATH, PO02A_SQL_PATH, PO02D1_SQL_PATH } from "../scripts/platform/catalog";
import { classifyPlan, computePushPlan, runPreflight, runPreflightOn, type PreflightResult } from "../scripts/platform/release-preflight";
import { section, ok, rejects, sqlState, summary, describeError } from "./platform/harness";
import { insertFixtures, tableChecksums, diffChecksums } from "./platform/po02a-fixtures";
import { PO02D1_CREATED, runPo02d1, runPo02d1Rollback, po02d1Objects } from "./platform/po02d1-fixtures";

const info = (m: string) => console.log(`  INFO  ${m}`);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const names: string[] = [];
const clients: Client[] = [];
const ADMIN_URL = process.env.PLATFORM_TEST_ADMIN_DATABASE_URL ?? "";

async function newDb(prefix: string): Promise<{ url: string; c: Client }> {
  const name = disposableName(prefix);
  names.push(name);
  const url = await createDisposableDatabase(name);
  const c = await connectDisposable(url);
  clients.push(c);
  return { url, c };
}
/** Today's production shape (621f156) with fictional customer rows and NO platform object (no PO-01A yet). */
async function productionShapeDb(prefix: string) {
  const db = await newDb(prefix);
  const push = await pushPreCompanyTenantSchema(db.url);
  if (!push.ok) throw new Error(`push failed: ${push.output.slice(-400)}`);
  const org = (await db.c.query(`insert into orgs (name, country, currency) values ('Fictional Retail Co', 'Saudi Arabia', 'SAR') returning id`)).rows[0].id;
  await db.c.query(`insert into users (org_id, email, password_hash, name, role) values ($1, 'owner@retail-fixture.test', 'x', 'Fixture Owner', 'owner'), ($1, 'staff@retail-fixture.test', 'x', 'Fixture Staff', 'staff')`, [org]);
  await db.c.query(`insert into customers (org_id, name) values ($1, 'Fixture Customer')`, [org]);
  return db;
}
/** The pre-onboarding branch shape (87efa15): PO-01A and PO-02A applied, F1 and PO-02D1A not; fixtures optional. */
async function preOnboardingDb(prefix: string, fixtures = true) {
  const db = await newDb(prefix);
  const push = await pushPreCompanyTenantSchema(db.url);
  if (!push.ok) throw new Error(`push failed: ${push.output.slice(-400)}`);
  await applyPlatformMigration(db.url, [PLATFORM_SQL_PATH]);
  if (fixtures) await insertFixtures(db.c);
  await applyPlatformMigration(db.url, [PO02A_SQL_PATH]);
  return db;
}
/** Everything reviewed applied in order, with fictional rows (the supported end state). */
async function completeDb(prefix: string) {
  const db = await preOnboardingDb(prefix);
  await applyPlatformMigration(db.url, [PO02D1_SQL_PATH]);
  return db;
}

async function allTables(c: Client): Promise<string[]> {
  return (await c.query(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows.map((r) => r.t as string);
}
/** Catalog (both projections) and every table's rows: what "unchanged" means here. */
async function snapshot(c: Client) {
  const p = await projectCatalog(c);
  return { catalog: `${projectionDigest(p.platform)}:${projectionDigest(p.other)}`, data: await tableChecksums(c, await allTables(c)) };
}
const unchanged = (a: Awaited<ReturnType<typeof snapshot>>, b: Awaited<ReturnType<typeof snapshot>>) => a.catalog === b.catalog && diffChecksums(a.data, b.data).length === 0;
/** Every foreign key on a customer (non-platform) table, as table.name. */
async function customerFks(c: Client): Promise<string[]> {
  return (
    await c.query(
      `select cl.relname || '.' || con.conname as k from pg_constraint con join pg_class cl on cl.oid = con.conrelid
       where con.contype = 'f' and cl.relnamespace = 'public'::regnamespace and cl.relname <> all($1) order by 1`,
      [PLATFORM_OWNED_TABLES],
    )
  ).rows.map((r) => r.k as string);
}

/** The CLI exactly as an operator runs it. */
function cli(url: string | undefined, args: string[] = []) {
  const env = { ...process.env };
  if (url === undefined) delete env.DATABASE_URL;
  else env.DATABASE_URL = url;
  const r = spawnSync("npm", ["run", "-s", "platform:db:preflight", ...(args.length ? ["--", ...args] : [])], { cwd: process.cwd(), env, encoding: "utf8", timeout: 300_000 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>"), stdout: r.stdout ?? "" };
}
const verdictLine = (out: string) => out.split("\n").find((l) => l.startsWith("VERDICT:")) ?? "(no VERDICT line)";
const stateLine = (out: string) => (out.split("\n").find((l) => l.trim().startsWith("STATE:")) ?? "(no STATE line)").trim();
/** The proposed db:push order — `platform:db:preflight && drizzle-kit push` — WITHOUT changing db:push itself. */
function gatedPush(url: string) {
  const gate = cli(url);
  if (gate.status !== 0) return { gate, pushed: false as const, push: null };
  return { gate, pushed: true as const, push: pushSchema(url, "full", { verbose: true }) };
}
const statementsOf = (output: string) => output.split("\n").map((l) => l.trim()).filter((l) => /^(CREATE|ALTER|DROP|TRUNCATE)\s/i.test(l));
const codes = (r: PreflightResult, severity: "blocking" | "info" = "blocking") => [...new Set(r.findings.filter((f) => f.severity === severity).map((f) => f.code))].sort();
const has = (r: PreflightResult, ...want: string[]) => want.every((w) => codes(r).includes(w));
async function readOnlyClient(url: string) {
  const c = new Client({ connectionString: url, options: "-c default_transaction_read_only=on -c lock_timeout=2s -c statement_timeout=60s" });
  await c.connect();
  clients.push(c);
  return c;
}

async function main(): Promise<void> {
  if (!ADMIN_URL) throw new Error("PLATFORM_TEST_ADMIN_DATABASE_URL is required");

  // ------------------------------------------------------------------------------------------------
  section("0. Unsupported targets are refused; the session is read-only; errors never pass");
  {
    const missing = cli(undefined);
    ok("no DATABASE_URL: refused before any connection (exit 2, MISSING_URL)", missing.status === 2 && /REFUSED \[MISSING_URL\]/.test(missing.out), missing.out.slice(0, 200));
    const remote = cli("postgres://fixture@db.example.invalid:5432/elite_erp_test_only_remote");
    ok("a non-loopback host: refused before any connection (exit 2, NON_LOOPBACK_HOST)", remote.status === 2 && /REFUSED \[NON_LOOPBACK_HOST\]/.test(remote.out), remote.out.slice(0, 200));
    const u = new URL(ADMIN_URL);
    u.pathname = "/elite_erp_production_like";
    const named = cli(u.toString());
    ok("a loopback database whose name lacks _test_only_: refused before any connection (exit 2, NOT_DISPOSABLE_NAME)", named.status === 2 && /REFUSED \[NOT_DISPOSABLE_NAME\]/.test(named.out), named.out.slice(0, 200));
    ok("…and no refusal prints a connection string", ![missing, remote, named].some((x) => /postgres(ql)?:\/\//.test(x.out) || /<redacted-url>/.test(x.out)));
    const empty = await newDb("pf_empty");
    const e = cli(empty.url);
    ok("an empty database (not an Elite ERP database): BLOCKED, exit 3, STATE UNSUPPORTED_TARGET (T-02)", e.status === 3 && /STATE: UNSUPPORTED_TARGET/.test(e.out) && /BLOCK T-02/.test(e.out) && /VERDICT: BLOCKED/.test(e.out), e.out.slice(0, 300));
    await rejects("a session that is not read-only is refused before the first catalog query", () => runPreflightOn(empty.c), (x) => /not read-only/.test(String((x as Error).message)));
    const ro = await readOnlyClient(empty.url);
    await rejects("…the preflight's own session options refuse any write (25006 read-only transaction)", () => ro.query("create table preflight_write_probe (id int)"), (x) => sqlState(x) === "25006");
  }

  // ------------------------------------------------------------------------------------------------
  section("1. The supported order: reviewed SQL first, then push — PUSH_SAFE, and push changes nothing reviewed");
  const P = await completeDb("pf_complete");
  const p0 = await snapshot(P.c);
  {
    const run = cli(P.url);
    info(`complete database: exit ${run.status}; ${stateLine(run.out)}`);
    ok("preflight: exit 0, VERDICT: PUSH_SAFE, STATE REVIEWED_SQL_COMPLETE", run.status === 0 && verdictLine(run.out) === "VERDICT: PUSH_SAFE" && /STATE: REVIEWED_SQL_COMPLETE/.test(run.out), run.out.slice(-600));
    ok("…read-only: the catalog and every table's rows are byte-identical after it ran", unchanged(p0, await snapshot(P.c)));
    const json = cli(P.url, ["--json"]);
    let parsed: PreflightResult | null = null;
    try {
      parsed = JSON.parse(json.stdout) as PreflightResult;
    } catch {
      parsed = null;
    }
    ok("--json prints exactly one JSON document (drizzle-kit's progress spinner never reaches stdout)", parsed !== null && json.status === 0, json.stdout.slice(0, 200));
    ok("…every component complete; the plan holds only the 8 known, identical re-creations of long-named customer foreign keys (benign)",
      parsed !== null && same(parsed.components, { po01a: "complete", po02a: "complete", f1: "complete", po02d1a: "complete" }) && parsed.plan.length === 8 && parsed.plan.every((p) => p.verdict === "benign"),
      JSON.stringify(parsed?.plan.map((p) => p.sql.slice(0, 60))));
    ok("…reported, not hidden: C-01 (customer rows), J-01 / J-02 (the journal does not describe this schema), X-02 (the FK re-creations)", parsed !== null && same(codes(parsed, "info"), ["C-01", "J-01", "J-02", "X-02"]), JSON.stringify(parsed && codes(parsed, "info")));
    const migrate = cli(P.url, ["--intent=migrate"]);
    ok("with --intent=migrate the same database is BLOCKED (exit 3): J-01 and J-02 block `drizzle-kit migrate` (D-6 unchanged)", migrate.status === 3 && /BLOCK J-01/.test(migrate.out) && /BLOCK J-02/.test(migrate.out), migrate.out.slice(-400));
    const roP = await readOnlyClient(P.url);
    const apiPlan = await computePushPlan(roP);
    const g = gatedPush(P.url);
    ok("gated push (preflight && push): the gate passes and push runs", g.pushed && g.push !== null && g.push.ok, g.push?.output.slice(-300));
    const cliStatements = g.push ? statementsOf(g.push.output) : [];
    ok("…the statements push executed are exactly the plan the preflight judged (drizzle-kit API = CLI)", same([...cliStatements].sort(), apiPlan.map((s) => s.split("\n")[0]).sort()), JSON.stringify({ cli: cliStatements.length, api: apiPlan.length }));
    const p1 = await snapshot(P.c);
    ok("…and afterwards the catalog projection and every row are unchanged; the onboarding check passes", unchanged(p0, p1) && (await checkOnboardingFoundation(P.c)).ok);
    const again = cli(P.url);
    ok("…a second preflight is PUSH_SAFE again (idempotent)", again.status === 0 && verdictLine(again.out) === "VERDICT: PUSH_SAFE");
  }

  // ------------------------------------------------------------------------------------------------
  section("2. Push BEFORE the reviewed SQL with existing fictional users (H-1 TRUNCATE prompt, H-2) — refused before push runs");
  {
    const H0 = await productionShapeDb("pf_prod_shape");
    const h00 = await snapshot(H0.c);
    const r0 = await runPreflight(H0.url);
    info(`today's production shape (621f156, customer rows, no platform object): ${r0.verdict} ${r0.state}; blocking ${codes(r0).join(" ")}`);
    ok("today's production shape with customers: BLOCKED with H-1 (users rows + new unique key) and H-2 (platform tables outside the reviewed SQL)", r0.verdict === "BLOCKED" && has(r0, "H-1", "H-2", "P1-01", "F1-01"), codes(r0).join(" "));
    ok("…STATE REVIEWED_SQL_NOT_APPLIED (nothing installed yet: a valid prefix of PO-01A → PO-02A → F1 → PO-02D1A)", r0.state === "REVIEWED_SQL_NOT_APPLIED" && same(r0.components, { po01a: "missing", po02a: "missing", f1: "missing", po02d1a: "missing" }));
    const g0 = gatedPush(H0.url);
    ok("…gated push: the gate exits 3 and push is never invoked; catalog and data byte-identical", !g0.pushed && g0.gate.status === 3 && unchanged(h00, await snapshot(H0.c)), g0.gate.out.slice(-300));

    const H = await preOnboardingDb("pf_pre_d1_rows");
    const h0 = await snapshot(H.c);
    const r = await runPreflight(H.url);
    const h1 = r.findings.find((f) => f.code === "H-1");
    info(`pre-onboarding branch shape with users: ${r.verdict} ${r.state}; blocking ${codes(r).join(" ")}`);
    ok("pre-onboarding branch shape with users: BLOCKED with H-1 naming users and its row count, and H-2", r.verdict === "BLOCKED" && has(r, "H-1", "H-2", "F1-01", "D1-00") && /^users holds 6 rows/.test(h1?.message ?? ""), h1?.message);
    ok("…STATE REVIEWED_SQL_NOT_APPLIED (PO-01A and PO-02A complete, F1 and PO-02D1A missing)", r.state === "REVIEWED_SQL_NOT_APPLIED" && same(r.components, { po01a: "complete", po02a: "complete", f1: "missing", po02d1a: "missing" }));
    ok("…the preflight left catalog and data byte-identical", unchanged(h0, await snapshot(H.c)));
    const g = gatedPush(H.url);
    ok("…gated push: the gate exits 3 and push is never invoked; catalog and data byte-identical", !g.pushed && g.gate.status === 3 && unchanged(h0, await snapshot(H.c)));
    // The hazard is real: an ungated push. No input is ever sent — stdin is not a terminal — so no prompt is answered.
    const hp = pushSchema(H.url, "full", { verbose: true });
    const prompt = /You're about to add [\s\S]*?users_org_id_id_uq[\s\S]*? unique constraint to the table, which contains \d+ items[\s\S]*?truncate [\s\S]*?users[\s\S]*? table/.test(hp.output);
    info(`ungated push on that database: ok=${hp.ok}; TRUNCATE prompt shown=${prompt}; ${/Interactive prompts require a TTY/.test(hp.output) ? "no terminal → aborted at the prompt" : "?"}`);
    ok("UNGATED, the hazard is real: push stops at drizzle-kit's prompt offering to TRUNCATE users — never answered, it aborts without a terminal", !hp.ok && prompt && /Interactive prompts require a TTY/.test(hp.output));
    ok("…nothing was truncated or created: catalog and data byte-identical (every fictional user still present)", unchanged(h0, await snapshot(H.c)) && Number((await H.c.query("select count(*)::int as n from users")).rows[0].n) === 6);
  }

  // ------------------------------------------------------------------------------------------------
  section("3. Push BEFORE the reviewed SQL on an empty-user fixture (H-2) — refused before push runs");
  const E = await preOnboardingDb("pf_pre_d1_empty", false);
  const e0 = await snapshot(E.c);
  const eFks0 = await customerFks(E.c);
  {
    const r = await runPreflight(E.url);
    info(`empty-user pre-onboarding shape: ${r.verdict} ${r.state}; blocking ${codes(r).join(" ")}`);
    ok("BLOCKED with H-2 (and no H-1: users is empty, so no TRUNCATE prompt would appear)", r.verdict === "BLOCKED" && has(r, "H-2", "F1-01") && !codes(r).includes("H-1") && r.counts.users === 0);
    ok("…STATE REVIEWED_SQL_NOT_APPLIED; catalog and data byte-identical", r.state === "REVIEWED_SQL_NOT_APPLIED" && unchanged(e0, await snapshot(E.c)));
    const roE = await readOnlyClient(E.url);
    const apiPlan = (await computePushPlan(roE)).map((s) => s.split("\n")[0]);
    const g = gatedPush(E.url);
    ok("…gated push: the gate exits 3 and push is never invoked", !g.pushed && g.gate.status === 3 && unchanged(e0, await snapshot(E.c)));
    const ep = pushSchema(E.url, "full", { verbose: true });
    const o = await po02d1Objects(E.c);
    info(`ungated push: ok=${ep.ok}; 42830=${/no unique constraint matching given keys for referenced table "users"/.test(ep.output)}; left behind ${o.tables.length} tables, ${o.triggers.length} triggers, ${o.functions.length} functions, users key ${o.usersKey}`);
    ok("UNGATED, the hazard is real: push fails half-way (42830, the composite key before the users key) and leaves 7 tables without any trigger, function or users key",
      !ep.ok && /no unique constraint matching given keys for referenced table "users"/.test(ep.output) && o.tables.length === ONBOARDING_TABLES.length && o.triggers.length === 0 && o.functions.length === 0 && !o.usersKey);
    const executed = statementsOf(ep.output);
    ok("…every statement push executed before failing is, in order, the plan the preflight refused", executed.length > 0 && same(executed, apiPlan.slice(0, executed.length)), JSON.stringify({ executed: executed.length, planned: apiPlan.length }));
    const eFksNow = await customerFks(E.c);
    const lost = eFks0.filter((k) => !eFksNow.includes(k));
    info(`customer foreign keys dropped by the failed push and never re-added: ${lost.length} (${lost.join(", ")})`);
    ok("…MEASURED, beyond H-2: before failing, push had already DROPPED the 4 long-named customer foreign keys (it re-adds them only at the end) — 4 customer tables left without referential integrity",
      lost.length === 4 && lost.every((k) => k.split(".")[1].length === 63) && !lost.some((k) => (PLATFORM_OWNED_TABLES as readonly string[]).includes(k.split(".")[0])), lost.join(" "));
  }

  // ------------------------------------------------------------------------------------------------
  section("4. Recovery from the partial push-created schema, and how an operator tells the states apart");
  {
    const r = await runPreflight(E.url);
    info(`after the ungated push: ${r.verdict} ${r.state}; components ${JSON.stringify(r.components)}; blocking ${codes(r).join(" ")}`);
    ok("the half-built schema: BLOCKED, STATE PARTIAL_PUSH_CREATED, with the push signatures O-03 (tables, no trigger or function) and O-04 (no users key)", r.verdict === "BLOCKED" && r.state === "PARTIAL_PUSH_CREATED" && has(r, "O-03", "O-04", "D1-01", "D1-02", "F1-01"));
    const restore = r.plan.filter((p) => p.reason.startsWith("the declared foreign key") && !(PLATFORM_OWNED_TABLES as readonly string[]).some((t) => p.sql.startsWith(`ALTER TABLE "${t}"`))).map((p) => p.sql);
    ok("…and O-06 names the 4 customer foreign keys the push dropped (the statements that restore them are in the report)", has(r, "O-06") && restore.length === 4, r.findings.find((f) => f.code === "O-06")?.message);
    ok("…PO-02D1A reported partial, F1 missing, every missing trigger named (D1-02)", r.components.po02d1a === "partial" && r.components.f1 === "missing" && (r.findings.find((f) => f.code === "D1-02")?.message.match(/missing trigger/g) ?? []).length === 10);
    const P2 = await runPreflight(P.url);
    info("operator's distinction — REVIEWED_SQL_COMPLETE: every component complete, 10/10 triggers, 3/3 functions, F1 a validated UNIQUE (id, org_id) constraint, verdict PUSH_SAFE");
    info("operator's distinction — PARTIAL_PUSH_CREATED: onboarding tables present with 0 triggers and 0 guard functions (O-03), no users key (O-04), verdict BLOCKED");
    ok("…the two states cannot be confused: they differ in state, verdict, components and signatures", P2.state === "REVIEWED_SQL_COMPLETE" && P2.verdict === "PUSH_SAFE" && !has(P2, "O-03") && r.state !== P2.state);
    await runPo02d1Rollback(E.c);
    const afterRollback = await runPreflight(E.url);
    ok("recovery 1 — reviewed rollback step 1 removes the empty half-built tables: STATE REVIEWED_SQL_NOT_APPLIED, but still BLOCKED by O-06 (the dropped customer keys)", afterRollback.state === "REVIEWED_SQL_NOT_APPLIED" && has(afterRollback, "O-06"), codes(afterRollback).join(" "));
    for (const s of restore) await E.c.query(s);
    const restored = await snapshot(E.c);
    const changedTables = diffChecksums(e0.data, restored.data);
    const rollbackAudit = Number((await E.c.query(`select count(*)::int as n from platform_audit_events where action = 'schema.onboarding_foundation_removed'`)).rows[0].n);
    ok("recovery 2 — the 4 customer foreign keys restored with their exact declared definitions: the catalog exactly as before the push, and the data too — but for the one audit record the reviewed rollback writes about itself",
      restored.catalog === e0.catalog && same(await customerFks(E.c), eFks0) && same(changedTables, ["platform_audit_events"]) && rollbackAudit === 1,
      JSON.stringify({ catalog: restored.catalog === e0.catalog, changedTables, rollbackAudit }));
    const steps = await runPo02d1(E.c);
    ok(`recovery 3 — the reviewed SQL then installs everything (created ×${PO02D1_CREATED.length})`, same(steps, PO02D1_CREATED));
    const done = await runPreflight(E.url);
    ok("recovery 4 — the preflight now passes: PUSH_SAFE, REVIEWED_SQL_COMPLETE", done.verdict === "PUSH_SAFE" && done.state === "REVIEWED_SQL_COMPLETE", codes(done).join(" "));
    const before = await snapshot(E.c);
    const g = gatedPush(E.url);
    ok("…and the gated push runs and changes nothing (catalog and data identical; onboarding check passes)", g.pushed && g.push !== null && g.push.ok && unchanged(before, await snapshot(E.c)) && (await checkOnboardingFoundation(E.c)).ok);
  }

  // ------------------------------------------------------------------------------------------------
  section("5. Every detector on its own (each drift injected into a disposable copy, then undone)");
  {
    const X = await completeDb("pf_detectors");
    const x0 = await snapshot(X.c);
    const auditTrigger = (await X.c.query(`select tgname as n from pg_trigger where tgrelid = 'platform_audit_events'::regclass and not tgisinternal order by 1 limit 1`)).rows[0].n as string;
    const d1Trigger = (await X.c.query(`select tgname as n from pg_trigger where tgrelid = 'tenant_subscriptions'::regclass and not tgisinternal order by 1 limit 1`)).rows[0].n as string;
    const cases: [string, string, string, string[], (r: PreflightResult) => boolean][] = [
      ["PO-01A audit protection disabled (an append-only trigger off)", `alter table platform_audit_events disable trigger "${auditTrigger}"`, `alter table platform_audit_events enable trigger "${auditTrigger}"`, ["P1-01"], (r) => r.components.po01a === "invalid"],
      ["a PO-02A foreign key NOT VALID", `alter table tenant_access_controls drop constraint tenant_access_controls_org_fk; alter table tenant_access_controls add constraint tenant_access_controls_org_fk foreign key (org_id) references orgs (id) on delete restrict not valid`,
        `alter table tenant_access_controls drop constraint tenant_access_controls_org_fk; alter table tenant_access_controls add constraint tenant_access_controls_org_fk foreign key (org_id) references orgs (id) on delete restrict`, ["P2-01"], (r) => r.components.po02a === "invalid" && /NOT VALID/.test(r.findings.find((f) => f.code === "P2-01")?.message ?? "")],
      ["a PO-02A foreign key cascading on delete", `alter table organization_invitations drop constraint organization_invitations_accepted_org_fk; alter table organization_invitations add constraint organization_invitations_accepted_org_fk foreign key (accepted_org_id) references orgs (id) on delete cascade`,
        `alter table organization_invitations drop constraint organization_invitations_accepted_org_fk; alter table organization_invitations add constraint organization_invitations_accepted_org_fk foreign key (accepted_org_id) references orgs (id) on delete restrict`, ["P2-01", "X-01"], (r) => /organization_invitations_accepted_org_fk differs/.test(r.findings.find((f) => f.code === "P2-01")?.message ?? "")],
      ["M4 (a PO-02A index) missing — and so PO-02D1A sits on an incomplete PO-02A", `drop index sessions_org_active_idx`, `create index sessions_org_active_idx on sessions using btree (org_id) where revoked_at is null`, ["P2-01", "O-02", "X-01"], (r) => r.components.po02a === "invalid"],
      ["an onboarding table missing (push would re-create it without triggers)", `drop table organization_invitation_terms`, "", ["D1-01", "H-2"], (r) => r.components.po02d1a === "partial"],
      ["an onboarding trigger disabled", `alter table tenant_subscriptions disable trigger "${d1Trigger}"`, `alter table tenant_subscriptions enable trigger "${d1Trigger}"`, ["D1-02"], (r) => /is not enabled/.test(r.findings.find((f) => f.code === "D1-02")?.message ?? "")],
      ["a column push would DROP (extra column in the database)", `alter table customers add column legacy_note text`, `alter table customers drop column legacy_note`, ["X-01"], (r) => r.plan.some((p) => p.verdict === "blocking" && / DROP COLUMN "legacy_note"/.test(p.sql) && p.reason === "a DROP COLUMN")],
      ["a table push would DROP (extra table in the database)", `create table legacy_archive (id integer primary key)`, `drop table legacy_archive`, ["X-01"], (r) => r.plan.some((p) => p.verdict === "blocking" && /^DROP TABLE "legacy_archive"/.test(p.sql))],
      ["a column type push would change (it TRUNCATEs a non-empty table)", `alter table customers alter column name type varchar(200)`, `alter table customers alter column name type text`, ["X-01"], (r) => r.plan.some((p) => p.verdict === "blocking" && / SET DATA TYPE /.test(p.sql) && /would TRUNCATE a non-empty table/.test(p.reason))],
      ["a reviewed-SQL scratch schema left behind", `create schema po02a_reference`, `drop schema po02a_reference`, ["T-03"], () => true],
    ];
    for (const [label, inject, undo, want, extra] of cases) {
      await X.c.query(inject);
      const r = await runPreflight(X.url);
      ok(`${label}: BLOCKED with ${want.join(", ")}`, r.verdict === "BLOCKED" && has(r, ...want) && extra(r), `${r.state} ${codes(r).join(" ")} :: ${r.findings.filter((f) => want.includes(f.code)).map((f) => f.message).join(" | ").slice(0, 400)}`);
      if (undo) await X.c.query(undo);
      else ok("…restored by the reviewed SQL (the missing table and its triggers re-created, everything else verified)", (await runPo02d1(X.c)).filter((s) => / created$/.test(s)).every((s) => /organization_invitation_terms/.test(s)));
    }
    ok("after every injected drift was undone the catalog and data are exactly as before", unchanged(x0, await snapshot(X.c)));
    // F1 as a bare runbook index (the attach step not run) — on the pre-onboarding shape, where F1 is still absent.
    const F = await preOnboardingDb("pf_f1_bare");
    await F.c.query(`create unique index concurrently users_org_id_id_uq on users using btree (id, org_id)`);
    const rf = await runPreflight(F.url);
    ok("F1 present only as a bare index (runbook step 1 without the attach): BLOCKED with F1-02, STATE PARTIAL_OR_DRIFTED", rf.verdict === "BLOCKED" && has(rf, "F1-02") && rf.state === "PARTIAL_OR_DRIFTED", `${rf.state} ${codes(rf).join(" ")}`);
    // Destructive proposals the plan classifier must refuse, judged against the complete database's real catalog.
    const ro = await readOnlyClient(X.url);
    const rows = async (t: string) => Number((await ro.query(`select count(*)::int as n from "${t}"`)).rows[0].n);
    const longFk = (await ro.query(`select conname as n from pg_constraint where conrelid = 'delivery_challan_items'::regclass and contype = 'f' and length(conname) = 63`)).rows[0].n as string;
    const synthetic = await classifyPlan(ro, [
      "truncate table \"users\" cascade;",
      "DROP TABLE \"customers\" CASCADE;",
      "DROP SCHEMA \"public\" CASCADE;",
      "ALTER TABLE \"users\" DROP COLUMN \"email\";",
      "ALTER TABLE \"users\" ALTER COLUMN \"email\" SET DATA TYPE varchar(10);",
      "ALTER TABLE \"orgs\" ADD COLUMN \"tax_number\" text NOT NULL;",
      `ALTER TABLE "delivery_challan_items" DROP CONSTRAINT "${longFk}";`,
      "ALTER TABLE \"delivery_challan_items\" ADD CONSTRAINT \"delivery_challan_items_delivery_challan_id_delivery_challans_id_fk\" FOREIGN KEY (\"delivery_challan_id\") REFERENCES \"public\".\"delivery_challans\"(\"id\") ON DELETE no action ON UPDATE no action;",
      "CREATE INDEX \"customers_name_idx\" ON \"customers\" USING btree (\"name\");",
    ], rows);
    ok("plan classifier: TRUNCATE, DROP TABLE, DROP SCHEMA, DROP COLUMN, a type change and a NOT NULL column on a populated table each block",
      synthetic.slice(0, 6).every((s) => s.verdict === "blocking") && /TRUNCATE/.test(synthetic[0].reason) && /DROP of an existing object/.test(synthetic[1].reason) && /DROP of an existing object/.test(synthetic[2].reason) && /DROP COLUMN/.test(synthetic[3].reason) && /type change/.test(synthetic[4].reason) && /NOT NULL column without a default on orgs/.test(synthetic[5].reason),
      JSON.stringify(synthetic.slice(0, 6).map((s) => s.reason)));
    ok("…a destructive REPLACEMENT (a foreign key dropped and re-added with ON DELETE no action instead of CASCADE) blocks both halves", synthetic[6].verdict === "blocking" && synthetic[7].verdict === "blocking", JSON.stringify(synthetic.slice(6, 8).map((s) => s.reason)));
    ok("…any other pending change (a new index on a customer table) blocks too: nothing unreviewed is ever PUSH_SAFE", synthetic[8].verdict === "blocking" && /fail closed/.test(synthetic[8].reason));
  }

  // ------------------------------------------------------------------------------------------------
  section("6. Fail closed: when the catalog cannot be read the tool errors (exit 1) — it never passes");
  {
    const L = await newDb("pf_locked");
    const push = await pushPreCompanyTenantSchema(L.url);
    if (!push.ok) throw new Error("push failed");
    const holder = await connectDisposable(L.url);
    clients.push(holder);
    await holder.query("begin");
    await holder.query("lock table users in access exclusive mode");
    const t0 = Date.now();
    const run = cli(L.url);
    const ms = Date.now() - t0;
    await holder.query("rollback");
    info(`with users locked ACCESS EXCLUSIVE by a concurrent transaction: exit ${run.status} after ${ms} ms`);
    ok("a concurrent ACCESS EXCLUSIVE lock (a migration in progress): exit 1, 'failed (fail closed)', no VERDICT line — bounded by its 2 s lock timeout", run.status === 1 && /failed \(fail closed\)/.test(run.out) && !/VERDICT:/.test(run.out), run.out.slice(-300));
    const after = cli(L.url);
    ok("…and once the lock is released it judges again (BLOCKED: nothing reviewed is installed)", after.status === 3 && /VERDICT: BLOCKED/.test(after.out));
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-release-preflight");
} catch (e) {
  console.error(`verify:platform-release-preflight aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  for (const c of clients) await c.end().catch(() => undefined);
  if (process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") for (const n of names) await dropDisposableDatabase(n).catch(() => undefined);
}
process.exit(exitCode);
