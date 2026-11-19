/**
 * Platform Owner PO-02D1B — the default Trial / platform settings seed (drizzle/platform/PO02D1B_seed_trial_and_settings.sql)
 * and its guarded rollback (PO02D1B_seed_rollback.sql), through the guarded runner (scripts/platform/trial-seed.ts).
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-onboarding-seed
 *
 * Real PostgreSQL only — no mock stands in for a constraint, trigger, lock or transaction. One production-shaped
 * fictional database is built through the reviewed chain (621f156 tenant shape → PO-01A → fictional rows → corrected
 * PO-02A → PO-02D1A); every case runs on a fresh copy of it (CREATE DATABASE … TEMPLATE), so no case sees another's
 * state. Concurrency uses deterministic barriers (a backend is observed waiting on a heavyweight lock in pg_stat_activity
 * before the next step is taken; the blocking backend is read from pg_blocking_pids). The numbered tags (#1 … #20) are
 * the PO-02D1B test categories. Disposable loopback `*_test_only_*` databases only; every database is dropped at the end
 * (PLATFORM_TEST_KEEP_DATABASES=1 keeps them).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import type { Client } from "pg";
import {
  connectDisposable,
  createDisposableDatabase,
  databaseUrlFor,
  disposableName,
  dropDisposableDatabase,
  pushSchema,
  pushPreCompanyTenantSchema,
  applyPlatformMigration,
  withAdmin,
} from "../scripts/platform/disposable-db";
import { projectCatalog, projectionDigest, checkOnboardingFoundation, checkPlatformObjects, PLATFORM_OWNED_TABLES, PLATFORM_SQL_PATH, PO02A_SQL_PATH, PO02D1_SQL_PATH } from "../scripts/platform/catalog";
import { runPreflight } from "../scripts/platform/release-preflight";
import {
  checkTrialSeed,
  runSeed,
  SeedRefusedError,
  TRIAL_MODULE_GROUPS,
  TRIAL_SEED,
  SEED_CREATED,
  SEED_VERIFIED,
  ROLLBACK_REMOVED,
  ROLLBACK_ABSENT,
  PO02D1B_SEED_SQL_PATH,
  PO02D1B_SEED_ROLLBACK_SQL_PATH,
} from "../scripts/platform/trial-seed";
import { section, ok, rejects, sqlState, summary, describeError } from "./platform/harness";
import { insertFixtures, tableChecksums, diffChecksums, newTokenHash, type TenantFixture } from "./platform/po02a-fixtures";
import { pidOf, waitsOnLock, txnSteps, fmtSteps, customerSignInOff, customerSignInOn, platformOwnerSignIn, registration, customerReadsAndWrites } from "./platform/lock-probes";
import { MODULE_ACCESS } from "../src/lib/role-matrix";
import { t } from "../src/lib/i18n/dict";

const ROOT = process.cwd();
const info = (m: string) => console.log(`  INFO  ${m}`);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const names: string[] = [];
const clients: Client[] = [];
const SEED_SQL = readFileSync(PO02D1B_SEED_SQL_PATH, "utf8");
const ROLLBACK_SQL = readFileSync(PO02D1B_SEED_ROLLBACK_SQL_PATH, "utf8");
const held = (sql: string) => sql.replace(/\nCOMMIT;\s*$/, "\n");
const stepsOf = (res: unknown) =>
  (Array.isArray(res) ? res : [res]).flatMap((r) => ((r as { rows?: Record<string, unknown>[] }).rows ?? []).map((x) => x.po02d1b_step)).filter((x): x is string => typeof x === "string");

async function connect(url: string): Promise<Client> {
  const c = await connectDisposable(url);
  c.on("error", () => undefined); // a terminated backend must not crash the suite
  clients.push(c);
  return c;
}
async function run(c: Client, sql: string): Promise<string[]> {
  try {
    return stepsOf(await c.query(sql));
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}
const CATALOG_TABLES = ["platform_settings", "subscription_packages", "subscription_package_versions"];
async function allTables(c: Client): Promise<string[]> {
  return (await c.query(`select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`)).rows.map((r) => r.t as string);
}
async function catalogDigest(c: Client): Promise<string> {
  const p = await projectCatalog(c);
  return `${projectionDigest(p.platform)}:${projectionDigest(p.other)}`;
}
/** Every table's rows except the three catalog tables and the audit trail — "nothing else changed". */
async function otherData(c: Client) {
  return tableChecksums(c, (await allTables(c)).filter((x) => ![...CATALOG_TABLES, "platform_audit_events"].includes(x)));
}
async function counts(c: Client) {
  return (
    await c.query(
      `select (select count(*) from platform_settings)::int as settings, (select count(*) from subscription_packages)::int as packages,
              (select count(*) from subscription_package_versions)::int as versions, (select count(*) from tenant_subscriptions)::int as subscriptions,
              (select count(*) from tenant_primary_owners)::int as owners, (select count(*) from organization_invitation_terms)::int as terms,
              (select count(*) from subscription_events)::int as events,
              (select count(*) from platform_audit_events where action = 'seed.trial_and_settings_created')::int as seed_events,
              (select count(*) from platform_audit_events where action = 'seed.trial_and_settings_removed')::int as rollback_events`,
    )
  ).rows[0] as Record<string, number>;
}
const pick = (o: Record<string, number>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));
async function customerFks(c: Client): Promise<string[]> {
  return (
    await c.query(
      `select cl.relname || '.' || con.conname as k from pg_constraint con join pg_class cl on cl.oid = con.conrelid
       where con.contype = 'f' and cl.relnamespace = 'public'::regnamespace and cl.relname <> all($1) order by 1`,
      [PLATFORM_OWNED_TABLES],
    )
  ).rows.map((r) => r.k as string);
}
async function guardState(c: Client): Promise<string> {
  return (
    await c.query(
      `select string_agg(c.relname || '.' || tg.tgname || '=' || tg.tgenabled::text, ' ' order by c.relname, tg.tgname) as s
       from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
       where c.relnamespace = 'public'::regnamespace and not tg.tgisinternal and c.relname in ('platform_audit_events', 'subscription_package_versions')`,
    )
  ).rows[0].s as string;
}

/** The runner exactly as an operator runs it. */
function cli(script: "platform:db:seed" | "platform:db:seed-rollback" | "platform:db:preflight", url: string, args: string[] = []) {
  const r = spawnSync("npm", ["run", "-s", script, ...(args.length ? ["--", ...args] : [])], { cwd: ROOT, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", timeout: 300_000 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>"), stdout: r.stdout ?? "" };
}
const lines = (out: string) => out.split("\n").map((l) => l.trim());

// ---------------------------------------------------------------------------------------------------------------------
// Databases: one reviewed-chain base, then a fresh copy per case.
// ---------------------------------------------------------------------------------------------------------------------
let BASE = "";
let FX: TenantFixture;
async function buildBase(): Promise<void> {
  BASE = disposableName("po02d1b_seed_base");
  names.push(BASE);
  const url = await createDisposableDatabase(BASE);
  const push = await pushPreCompanyTenantSchema(url);
  if (!push.ok) throw new Error(`push failed: ${push.output.slice(-400)}`);
  await applyPlatformMigration(url, [PLATFORM_SQL_PATH]);
  const c = await connectDisposable(url);
  FX = await insertFixtures(c);
  await c.end();
  await applyPlatformMigration(url, [PO02A_SQL_PATH, PO02D1_SQL_PATH]);
}
/** A fresh copy of `template` (no other session may be connected to it). */
async function copyOf(template: string, prefix: string): Promise<{ name: string; url: string; c: Client }> {
  const name = disposableName(prefix);
  names.push(name);
  // A just-closed session can linger for a moment; the template must have none (55006 until it is gone).
  for (let attempt = 0; ; attempt++) {
    try {
      await withAdmin((a) => a.query(`create database "${name}" template "${template}"`));
      break;
    } catch (err) {
      if (sqlState(err) !== "55006" || attempt >= 50) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const url = databaseUrlFor(name);
  return { name, url, c: await connect(url) };
}
async function closeAll(c: Client) {
  const i = clients.indexOf(c);
  if (i >= 0) clients.splice(i, 1);
  await c.end().catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------------------------------
// Module groups: derived from the navigation by the TypeScript AST (no React import), reconciled with the role matrix.
// ---------------------------------------------------------------------------------------------------------------------
function navGroupsFromSource(): { label: string; items: { label: string; href: string }[] }[] {
  const file = join(ROOT, "src/components/layout/nav-config.ts");
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let arr: ts.ArrayLiteralExpression | null = null;
  sf.forEachChild((n) => {
    if (ts.isVariableStatement(n))
      for (const d of n.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.name.text === "NAV_GROUPS" && d.initializer && ts.isArrayLiteralExpression(d.initializer)) arr = d.initializer;
  });
  if (!arr) throw new Error("NAV_GROUPS not found in nav-config.ts");
  const prop = (o: ts.ObjectLiteralExpression, k: string) => o.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === k)?.initializer;
  const str = (e: ts.Expression | undefined) => (e && ts.isStringLiteral(e) ? e.text : null);
  return (arr as ts.ArrayLiteralExpression).elements.map((g) => {
    if (!ts.isObjectLiteralExpression(g)) throw new Error("unexpected NAV_GROUPS element");
    const itemsExpr = prop(g, "items");
    const items = itemsExpr && ts.isArrayLiteralExpression(itemsExpr)
      ? itemsExpr.elements.map((it) => {
          if (!ts.isObjectLiteralExpression(it)) throw new Error("unexpected nav item");
          return { label: str(prop(it, "label")) ?? "?", href: str(prop(it, "href")) ?? "?" };
        })
      : [];
    const labelExpr = prop(g, "label");
    const label = str(labelExpr) ?? (labelExpr && labelExpr.kind === ts.SyntaxKind.NullKeyword && items.length === 1 ? items[0].label : "?");
    return { label, items };
  });
}
/** First path segment of every page / route under src/app/(app) → the snapshot group it belongs to, or a documented exclusion. */
const SEGMENT_GROUP: Record<string, string> = { dashboard: "Dashboard", projects: "Projects", sales: "Sales", purchasing: "Purchasing", inventory: "Inventory", clients: "Clients", finance: "Finance", hr: "People", settings: "Administration" };
const EXCLUDED_SEGMENTS: Record<string, string> = {
  "recycle-bin": "the cross-module Recycle Bin (each module's deleted records), a utility — not a module",
  "design-system": "the development-only design specimen (404 in production), not an ERP module",
  documents: "cross-module list export / import endpoints and helpers, not a module",
};
/** The role matrix's access modules → the navigation groups they cover (Vendors live under Purchasing in the navigation). */
const ROLE_MATRIX_GROUPS: Record<string, string[]> = {
  "Sales & Purchasing": ["Sales", "Purchasing"],
  Finance: ["Finance"],
  Inventory: ["Inventory"],
  "Clients & Vendors": ["Clients", "Purchasing"],
  Projects: ["Projects"],
  "Employees & Attendance": ["People"],
  Payroll: ["People"],
  Configuration: ["Administration"],
  "Security Center": ["Administration"],
};
function appRoutes(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/^(page|route)\.tsx?$/.test(n)) out.push(p.slice(join(ROOT, "src/app/(app)").length + 1));
    }
  };
  walk(join(ROOT, "src/app/(app)"));
  return out.sort();
}
function srcFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n)) out.push(p.slice(ROOT.length + 1));
    }
  };
  walk(join(ROOT, "src"));
  return out;
}

async function main(): Promise<void> {
  // ------------------------------------------------------------------------------------------------
  section("0. The approved values and the module-group snapshot (static, deterministic)");
  {
    const groups = navGroupsFromSource();
    const derived = groups.map((g) => g.label);
    ok("#8 the snapshot is the navigation's nine groups in declaration order (the unlabelled first group named by its only item, Dashboard)", same(derived, [...TRIAL_MODULE_GROUPS]), JSON.stringify(derived));
    ok("#8 …deterministic: a second derivation is identical, and no label is duplicated or empty", same(navGroupsFromSource().map((g) => g.label), derived) && new Set(derived).size === derived.length && derived.every((l) => /^[A-Z][A-Za-z]{1,39}$/.test(l)));
    const arabic = derived.map((l) => [l, t("ar", l)] as const);
    ok("#8 every label is an existing dictionary key with a native Arabic translation (the UI shows Arabic; numbers and dates stay LTR)", arabic.every(([l, ar]) => ar !== l && /[؀-ۿ]/.test(ar)), arabic.map(([l, ar]) => `${l}=${ar}`).join(" "));
    const hrefMismatch = groups.flatMap((g) => g.items.filter((it) => SEGMENT_GROUP[it.href.split("/")[1]] !== g.label).map((it) => `${g.label}:${it.href}`));
    ok("#8 every navigation item lives under its group's route segment (hr → People, settings → Administration, …)", hrefMismatch.length === 0, hrefMismatch.join(" "));
    const routes = appRoutes();
    const uncovered = routes.filter((r) => !(r.split("/")[0] in SEGMENT_GROUP) && !(r.split("/")[0] in EXCLUDED_SEGMENTS));
    info(`${routes.length} page/route files under src/app/(app); excluded segments: ${Object.keys(EXCLUDED_SEGMENTS).join(", ")}`);
    ok("#8 no module silently omitted: every page and route under src/app/(app) belongs to a snapshot group or a documented exclusion (Recycle Bin utility, design specimen, document export endpoints)", uncovered.length === 0, uncovered.join(" "));
    ok("#8 …and every snapshot group has at least one real page", [...TRIAL_MODULE_GROUPS].every((g) => routes.some((r) => SEGMENT_GROUP[r.split("/")[0]] === g)));
    const matrixModules = MODULE_ACCESS.map((m) => m.module);
    ok("#8 reconciled with the server-side role matrix (src/lib/role-matrix.ts): every access module maps onto snapshot groups, and the mapping covers exactly the matrix's nine modules",
      same([...matrixModules].sort(), Object.keys(ROLE_MATRIX_GROUPS).sort()) && Object.values(ROLE_MATRIX_GROUPS).flat().every((g) => (TRIAL_MODULE_GROUPS as readonly string[]).includes(g)), matrixModules.join(", "));
    const uncoveredByMatrix = [...TRIAL_MODULE_GROUPS].filter((g) => !Object.values(ROLE_MATRIX_GROUPS).flat().includes(g));
    ok("#8 …every snapshot group is a role-matrix module except Dashboard, which no role gate restricts (every role sees it)", same(uncoveredByMatrix, ["Dashboard"]), uncoveredByMatrix.join(","));
    // PO-02D3: the acceptance core copies the invitation's version module groups into the new subscription's
    // DISPLAY-ONLY snapshot (and their count into its event) — exactly three references; nothing reads a snapshot back
    // and nothing grants, hides or blocks access by module (still no entitlement code anywhere).
    const ACCEPT_CORE = join("src", "lib", "platform", "invitation-acceptance.ts");
    const readers = srcFiles().filter((f) => f !== join("src", "db", "schema", "platform-onboarding.ts") && /module_groups|moduleGroups|entitlement/i.test(readFileSync(join(ROOT, f), "utf8")));
    const coreText = readFileSync(join(ROOT, ACCEPT_CORE), "utf8");
    const snapshotReaders = srcFiles().filter((f) => f !== join("src", "db", "schema", "platform-onboarding.ts") && /moduleGroupsSnapshot|module_groups_snapshot/.test(readFileSync(join(ROOT, f), "utf8")));
    ok("#8 no entitlement registry exists and nothing in src/ reads module groups (display-only snapshot; no access is granted, hidden or blocked) — but (PO-02D3) the acceptance core, which only copies a version's groups into the new subscription's snapshot",
      JSON.stringify(readers) === JSON.stringify([ACCEPT_CORE]) && !/entitlement/i.test(coreText) && (coreText.match(/module_?groups/gi) ?? []).length === 3 &&
        /modules: versions\.moduleGroups,/.test(coreText) && /moduleGroupsSnapshot: t\.modules,/.test(coreText) && /moduleGroups: t\.modules\.length,/.test(coreText) &&
        JSON.stringify(snapshotReaders) === JSON.stringify([ACCEPT_CORE]),
      `${readers.join(" ")} | ${snapshotReaders.join(" ")}`);
    const block = (sql: string, start: string) => {
      const i = sql.indexOf(start);
      return i < 0 ? "" : sql.slice(i, sql.indexOf("$fn$;", sql.indexOf("$fn$", i) + 4) + 5);
    };
    const seedApproved = block(SEED_SQL, "CREATE FUNCTION pg_temp.po02d1b_approved()");
    ok("the approved values are written ONCE per file and identically in the seed and its rollback (and the difference helper too)",
      seedApproved.length > 500 && seedApproved === block(ROLLBACK_SQL, "CREATE FUNCTION pg_temp.po02d1b_approved()") &&
        block(SEED_SQL, "CREATE FUNCTION pg_temp.po02d1b_diff(") === block(ROLLBACK_SQL, "CREATE FUNCTION pg_temp.po02d1b_diff(") && (SEED_SQL.match(/'module_groups', '/g) ?? []).length === 1);
    const literal = (seedApproved.match(/'module_groups', '(\[[^']*\])'::jsonb/) ?? [])[1];
    ok("…the SQL's module list is exactly the derived snapshot", literal !== undefined && same(JSON.parse(literal), [...TRIAL_MODULE_GROUPS]), literal);
    ok("#1 the approved values are the owner's: 14 days, 3 seats, 5 GB, all modules, grace 0, alerts on, SAR 0.00 (monthly and annual), MFA and manual billing locked, Asia/Riyadh",
      TRIAL_SEED.settings.default_trial_days === 14 && TRIAL_SEED.version.trial_days === 14 && TRIAL_SEED.version.included_seats === 3 && TRIAL_SEED.version.storage_allowance_gb === 5 &&
        TRIAL_SEED.settings.grace_days === 0 && TRIAL_SEED.settings.expiry_alerts_enabled && TRIAL_SEED.version.monthly_price === "0.00" && TRIAL_SEED.version.annual_price === "0.00" &&
        TRIAL_SEED.version.currency_code === "SAR" && TRIAL_SEED.settings.manual_billing && TRIAL_SEED.settings.platform_mfa_required && TRIAL_SEED.settings.platform_timezone === "Asia/Riyadh" &&
        TRIAL_SEED.package.code === "trial" && TRIAL_SEED.package.name === "Trial" && TRIAL_SEED.version.publish_state === "published");
  }

  await buildBase();

  // ------------------------------------------------------------------------------------------------
  section("1. First seed through the guarded runner (preflight PUSH_SAFE / REVIEWED_SQL_COMPLETE first)");
  const A = await copyOf(BASE, "po02d1b_seed_first");
  const a0 = { catalog: await catalogDigest(A.c), other: await otherData(A.c), fks: await customerFks(A.c), counts: await counts(A.c) };
  {
    const pre = cli("platform:db:preflight", A.url);
    ok("#17 before seeding, the release preflight reports PUSH_SAFE / REVIEWED_SQL_COMPLETE (exit 0)", pre.status === 0 && /STATE: REVIEWED_SQL_COMPLETE/.test(pre.out) && /VERDICT: PUSH_SAFE/.test(pre.out), pre.out.slice(-300));
    const r = cli("platform:db:seed", A.url);
    const steps = lines(r.out).filter((l) => /^S[1-4] /.test(l));
    info(`platform:db:seed: exit ${r.status}; ${steps.join(" · ")}`);
    ok("#2 first seed: exit 0, the runner's preflight passed, created ×3 and ONE audit record", r.status === 0 && /preflight: PUSH_SAFE \/ REVIEWED_SQL_COMPLETE/.test(r.out) && same(steps, [...SEED_CREATED]) && /RESULT: SEEDED/.test(r.out), r.out.slice(-500));
    const check = await checkTrialSeed(A.c);
    ok("#1 the database holds exactly the approved seed (settings, Trial package, published Trial version 1)", check.state === "complete", check.findings.join(" | "));
    const s = (await A.c.query(`select * from platform_settings`)).rows;
    ok("#1 settings: one row — default_trial_days 14, grace_days 0, expiry alerts on, manual billing and MFA locked on, SAR, Asia/Riyadh, no operator",
      s.length === 1 && s[0].id === 1 && s[0].default_trial_days === 14 && s[0].grace_days === 0 && s[0].expiry_alerts_enabled === true && s[0].manual_billing === true &&
        s[0].platform_mfa_required === true && s[0].platform_currency === "SAR" && s[0].platform_timezone === "Asia/Riyadh" && s[0].updated_by_platform_admin_id === null,
      JSON.stringify(s));
    const v = (await A.c.query(`select v.*, v.monthly_price::text as m, v.annual_price::text as y, scale(v.monthly_price) as ms, scale(v.annual_price) as ys,
                                       format_type(a.atttypid, a.atttypmod) as price_type
                                from subscription_package_versions v join pg_attribute a on a.attrelid = 'subscription_package_versions'::regclass and a.attname = 'monthly_price'`)).rows;
    ok("#2 Trial version 1: published (published_at set), trial days 14, 3 seats, 5 GB, the nine module groups, no operator",
      v.length === 1 && v[0].version_number === 1 && v[0].publish_state === "published" && v[0].published_at !== null && v[0].is_trial === true && v[0].trial_days === 14 &&
        v[0].included_seats === 3 && v[0].storage_allowance_gb === 5 && same(v[0].module_groups, [...TRIAL_MODULE_GROUPS]) && v[0].created_by_platform_admin_id === null);
    ok("#7 SAR 0.00 precision: monthly and annual prices stored as numeric(14,2) '0.00' (scale 2), currency SAR — the Trial price, in the model's own fields",
      v[0].m === "0.00" && v[0].y === "0.00" && Number(v[0].ms) === 2 && Number(v[0].ys) === 2 && v[0].price_type === "numeric(14,2)" && v[0].currency_code === "SAR", JSON.stringify({ m: v[0].m, y: v[0].y, t: v[0].price_type }));
    const p = (await A.c.query(`select * from subscription_packages`)).rows;
    ok("#5 exactly one package, the default Trial: code trial, name Trial, active, is_trial, no operator", p.length === 1 && p[0].code === "trial" && p[0].name === "Trial" && p[0].status === "active" && p[0].is_trial && p[0].is_default_trial && p[0].created_by_platform_admin_id === null);
    const audit = (await A.c.query(`select actor_platform_admin_id, actor_label, action, entity_type, entity_id, result, after_safe from platform_audit_events where action like 'seed.%'`)).rows;
    ok("#10 one append-only audit record: seed.trial_and_settings_created, actor-less migration, success, with the created ids and the approved values",
      audit.length === 1 && audit[0].actor_platform_admin_id === null && audit[0].actor_label === "migration PO-02D1B seed" && audit[0].entity_type === "seed" && audit[0].entity_id === "PO02D1B" &&
        audit[0].result === "success" && audit[0].after_safe.trial_package_id === p[0].id && audit[0].after_safe.trial_version_id === v[0].id && same(audit[0].after_safe.approved.version.module_groups, [...TRIAL_MODULE_GROUPS]),
      JSON.stringify(audit).slice(0, 300));
    const c1 = await counts(A.c);
    ok("#12 #13 #14 no subscription, no primary-owner mapping, no invitation terms and no subscription event was created", same(pick(c1, ["subscriptions", "owners", "terms", "events"]), { subscriptions: 0, owners: 0, terms: 0, events: 0 }), JSON.stringify(c1));
    ok("#15 no existing company, user, session, customer, access control or invitation changed — every table's rows outside the three catalog tables and the audit trail are byte-identical", diffChecksums(a0.other, await otherData(A.c)).length === 0, diffChecksums(a0.other, await otherData(A.c)).join(" "));
    ok("…the schema is unchanged (data-only seed: the full catalog projection is identical) and every customer foreign key is present", (await catalogDigest(A.c)) === a0.catalog && same(await customerFks(A.c), a0.fks));
    const post = await runPreflight(A.url);
    ok("…after seeding the preflight still reports PUSH_SAFE / REVIEWED_SQL_COMPLETE", post.verdict === "PUSH_SAFE" && post.state === "REVIEWED_SQL_COMPLETE");
  }

  // ------------------------------------------------------------------------------------------------
  section("2. Identical second seed: everything verified, nothing written");
  {
    const before = (await A.c.query(`select (select xmin::text from platform_settings) s, (select xmin::text from subscription_packages) p, (select xmin::text from subscription_package_versions) v,
                                            (select count(*) from platform_audit_events)::int a`)).rows[0];
    const r = cli("platform:db:seed", A.url);
    const steps = lines(r.out).filter((l) => /^S[1-4] /.test(l));
    ok("#3 second seed: exit 0, verified ×3, no audit record", r.status === 0 && same(steps, [...SEED_VERIFIED]), steps.join(" · "));
    const after = (await A.c.query(`select (select xmin::text from platform_settings) s, (select xmin::text from subscription_packages) p, (select xmin::text from subscription_package_versions) v,
                                           (select count(*) from platform_audit_events)::int a`)).rows[0];
    ok("#3 …no row was rewritten (the three rows' xmin unchanged), no duplicate exists, and the audit trail did not grow", same(before, after) && same(pick(await counts(A.c), ["settings", "packages", "versions", "seed_events"]), { settings: 1, packages: 1, versions: 1, seed_events: 1 }), JSON.stringify({ before, after }));
    const j = cli("platform:db:seed", A.url, ["--json"]);
    let parsed: { steps?: string[]; check?: { state?: string } } | null = null;
    try {
      parsed = JSON.parse(j.stdout);
    } catch {
      parsed = null;
    }
    ok("…--json prints one JSON document (steps and post-check)", j.status === 0 && parsed !== null && same(parsed.steps, [...SEED_VERIFIED]) && parsed.check?.state === "complete");
  }

  // ------------------------------------------------------------------------------------------------
  section("3. The published Trial is immutable; one default Trial; settings singleton");
  {
    const v = (await A.c.query(`select id from subscription_package_versions`)).rows[0].id as string;
    for (const [col, val] of [["monthly_price", "1.00"], ["annual_price", "1.00"], ["included_seats", "4"], ["storage_allowance_gb", "6"], ["trial_days", "30"], ["module_groups", `'["Sales"]'::jsonb`], ["publish_state", "'draft'"]] as const) {
      await rejects(`#6 UPDATE of the published Trial's ${col} is refused (23001)`, () => A.c.query(`update subscription_package_versions set ${col} = ${val} where id = $1`, [v]), (e) => sqlState(e) === "23001");
    }
    await rejects("#6 DELETE of the published Trial version is refused (23001)", () => A.c.query(`delete from subscription_package_versions where id = $1`, [v]), (e) => sqlState(e) === "23001");
    await rejects("#6 TRUNCATE of the versions is refused (append-only guard)", () => A.c.query(`truncate subscription_package_versions cascade`), (e) => /append-only/.test(String((e as Error).message)));
    ok("#6 …and the Trial is exactly as seeded afterwards", (await checkTrialSeed(A.c)).state === "complete");
    await rejects("#5 a second default Trial package is refused (unique default-Trial index, 23505)", () => A.c.query(`insert into subscription_packages (code, name, status, is_trial, is_default_trial) values ('trial-two', 'Trial Two', 'active', true, true)`), (e) => sqlState(e) === "23505");
    await rejects("#5 the default Trial cannot be archived (23514)", () => A.c.query(`update subscription_packages set status = 'archived' where code = 'trial'`), (e) => sqlState(e) === "23514");
    await rejects("#9 a second settings row is refused (singleton CHECK id = 1, 23514)", () => A.c.query(`insert into platform_settings (id, default_trial_days) values (2, 14)`), (e) => sqlState(e) === "23514");
    await rejects("#9 a duplicate id 1 is refused (primary key, 23505)", () => A.c.query(`insert into platform_settings (id, default_trial_days) values (1, 14)`), (e) => sqlState(e) === "23505");
    await rejects("#9 settings cannot switch MFA or manual billing off (locked CHECK, 23514)", () => A.c.query(`update platform_settings set platform_mfa_required = false`), (e) => sqlState(e) === "23514");
    ok("…all refused statements left the seed intact", (await checkTrialSeed(A.c)).state === "complete" && same(pick(await counts(A.c), ["settings", "packages", "versions"]), { settings: 1, packages: 1, versions: 1 }));
  }

  // ------------------------------------------------------------------------------------------------
  section("4. Differing existing values are refused, named, and nothing is written");
  {
    const cases: [string, string, RegExp][] = [
      ["settings with 30 trial days", `insert into platform_settings (id, default_trial_days) values (1, 30)`, /platform_settings differs .*default_trial_days: existing 30, approved 14/],
      ["settings with alerts off and 5 grace days", `insert into platform_settings (id, default_trial_days, grace_days, expiry_alerts_enabled) values (1, 14, 5, false)`, /expiry_alerts_enabled: existing false, approved true; grace_days: existing 5, approved 0/],
      ["a 'trial' package with another name", `insert into subscription_packages (code, name, status, is_trial, is_default_trial) values ('trial', 'Free Trial', 'active', true, true)`, /subscription_packages "trial" differs .*name: existing "Free Trial", approved "Trial"/],
      ["another package already the default Trial", `insert into subscription_packages (code, name, status, is_trial, is_default_trial) values ('starter-trial', 'Starter Trial', 'active', true, true)`, /another package is already the default Trial or named Trial \(code starter-trial\)/],
      ["Trial version 1 as a DRAFT with 5 seats", `insert into subscription_packages (code, name, status, is_trial, is_default_trial) values ('trial', 'Trial', 'active', true, true);
        insert into subscription_package_versions (package_id, version_number, publish_state, is_trial, monthly_price, annual_price, included_seats, storage_allowance_gb, module_groups, trial_days)
        select id, 1, 'draft', true, 0, 0, 5, 5, '["Dashboard", "Projects", "Sales", "Purchasing", "Inventory", "Clients", "Finance", "People", "Administration"]', 14 from subscription_packages where code = 'trial'`,
        /version 1 differs .*included_seats: existing 5, approved 3; publish_state: existing "draft", approved "published"/],
    ];
    for (const [label, setup, expected] of cases) {
      const X = await copyOf(BASE, "po02d1b_seed_diff");
      await X.c.query(setup);
      const before = { catalog: await catalogDigest(X.c), data: await tableChecksums(X.c, await allTables(X.c)) };
      let message = "";
      try {
        await runSeed(X.url);
      } catch (e) {
        message = e instanceof SeedRefusedError && e.exitCode === 4 ? e.message : `unexpected: ${describeError(e)}`;
      }
      ok(`#4 ${label}: refused (exit 4), the difference named`, expected.test(message), message.slice(0, 300));
      ok(`#4 …nothing written: catalog and every row identical, no audit record`, (await catalogDigest(X.c)) === before.catalog && diffChecksums(before.data, await tableChecksums(X.c, await allTables(X.c))).length === 0);
      await closeAll(X.c);
    }
    const Y = await copyOf(BASE, "po02d1b_seed_diffcli");
    await Y.c.query(`insert into platform_settings (id, default_trial_days) values (1, 30)`);
    const r = cli("platform:db:seed", Y.url);
    ok("#4 the CLI reports the same refusal with exit 4 and names the difference, nothing else", r.status === 4 && /REFUSED: PO-02D1B seed refused: platform_settings differs/.test(r.out) && (await counts(Y.c)).packages === 0, r.out.slice(-300));
    await closeAll(Y.c);
  }

  // ------------------------------------------------------------------------------------------------
  section("5. Atomicity: an audit failure, a terminated backend — nothing survives; a retry works");
  {
    const X = await copyOf(BASE, "po02d1b_seed_audit_fail");
    const holder = await connect(X.url);
    await holder.query("begin");
    await holder.query("lock table platform_audit_events in share mode"); // reads continue; the seed's audit INSERT must wait
    const s = await connect(X.url);
    const sPid = await pidOf(s);
    let err: unknown = null;
    const seeding = s.query(SEED_SQL).catch((e) => { err = e; });
    const waiting = await waitsOnLock(X.c, sPid);
    const locks = (await X.c.query(`select c.relname, l.mode, l.granted from pg_locks l join pg_class c on c.oid = l.relation where l.pid = $1 and c.relname = any($2) order by 1, 2`, [sPid, [...CATALOG_TABLES, "platform_audit_events"]])).rows;
    const holds = (rel: string, mode: string) => locks.some((x) => x.relname === rel && x.mode === mode && x.granted);
    ok("#10 barrier: the seed has written settings, package and version (row locks held) and is waiting for the audit INSERT",
      waiting && holds("platform_settings", "RowExclusiveLock") && holds("subscription_packages", "RowExclusiveLock") && holds("subscription_package_versions", "RowExclusiveLock") &&
        locks.some((x) => x.relname === "platform_audit_events" && x.mode === "RowExclusiveLock" && !x.granted), JSON.stringify(locks));
    await seeding;
    await s.query("ROLLBACK").catch(() => undefined);
    await holder.query("rollback");
    ok("#10 the audit write fails (55P03 at the seed's 5 s lock timeout)…", sqlState(err) === "55P03", describeError(err));
    ok("#10 …and the whole seed rolled back: no settings, no package, no version, no audit record", same(pick(await counts(X.c), ["settings", "packages", "versions", "seed_events"]), { settings: 0, packages: 0, versions: 0, seed_events: 0 }));
    ok("#11 a retry then seeds everything (created ×3, one audit record)", same(await run(s, SEED_SQL), [...SEED_CREATED]) && (await counts(X.c)).seed_events === 1);
    await closeAll(X.c);

    const Z = await copyOf(BASE, "po02d1b_seed_killed");
    const k = await connect(Z.url);
    const kPid = await pidOf(k);
    await k.query(held(SEED_SQL)); // every statement ran; only COMMIT is withheld
    ok("#11 barrier: a seed transaction is open with all four steps done (other sessions still see nothing)", same(pick(await counts(Z.c), ["settings", "packages", "versions"]), { settings: 0, packages: 0, versions: 0 }));
    await Z.c.query(`select pg_terminate_backend($1)`, [kPid]);
    await new Promise((r) => setTimeout(r, 200));
    const helpers = Number((await Z.c.query(`select count(*)::int as n from pg_proc where proname like 'po02d1b%'`)).rows[0].n);
    ok("#11 pg_terminate_backend before COMMIT: nothing survives (no row, no audit record, no pg_temp helper left)", same(pick(await counts(Z.c), ["settings", "packages", "versions", "seed_events"]), { settings: 0, packages: 0, versions: 0, seed_events: 0 }) && helpers === 0, `helpers ${helpers}`);
    const k2 = await connect(Z.url);
    ok("#11 …a retry on a new connection seeds everything", same(await run(k2, SEED_SQL), [...SEED_CREATED]));
    await closeAll(Z.c);
  }

  // ------------------------------------------------------------------------------------------------
  section("6. Concurrent seed attempts serialize: exactly one set of rows, one audit record");
  {
    const X = await copyOf(BASE, "po02d1b_seed_concurrent");
    const first = await connect(X.url);
    const second = await connect(X.url);
    const firstPid = await pidOf(first);
    const secondPid = await pidOf(second);
    await first.query(held(SEED_SQL));
    let secondSteps: string[] = [];
    const racing = second.query(SEED_SQL).then((r) => { secondSteps = stepsOf(r); });
    const waiting = await waitsOnLock(X.c, secondPid);
    const blockers = ((await X.c.query(`select pg_blocking_pids($1) as b`, [secondPid])).rows[0].b as number[]).map(Number);
    ok("#20 barrier: the second seed waits for the first (blocked by its backend, on the catalog-table lock)", waiting && blockers.includes(firstPid), JSON.stringify(blockers));
    await first.query("COMMIT");
    await racing;
    ok("#20 …the first commits; the second then verifies everything and writes nothing", same(secondSteps, [...SEED_VERIFIED]), secondSteps.join(" · "));
    ok("#20 exactly one settings row, one package, one version and ONE audit record", same(pick(await counts(X.c), ["settings", "packages", "versions", "seed_events"]), { settings: 1, packages: 1, versions: 1, seed_events: 1 }));
    await closeAll(X.c);

    const W = await copyOf(BASE, "po02d1b_seed_concurrent_abort");
    const f2 = await connect(W.url);
    const s2 = await connect(W.url);
    const s2Pid = await pidOf(s2);
    await f2.query(held(SEED_SQL));
    let s2Steps: string[] = [];
    const racing2 = s2.query(SEED_SQL).then((r) => { s2Steps = stepsOf(r); });
    await waitsOnLock(W.c, s2Pid);
    await f2.query("ROLLBACK");
    await racing2;
    ok("#20 if the first seed rolls back instead, the waiting one creates everything (created ×3) — still exactly one of each", same(s2Steps, [...SEED_CREATED]) && same(pick(await counts(W.c), ["settings", "packages", "versions", "seed_events"]), { settings: 1, packages: 1, versions: 1, seed_events: 1 }));
    await closeAll(W.c);
  }

  // ------------------------------------------------------------------------------------------------
  section("7. Legacy customer companies: unaffected during and after the seed");
  {
    const X = await copyOf(BASE, "po02d1b_seed_legacy");
    const mig = await connect(X.url);
    const migPid = await pidOf(mig);
    await mig.query(held(SEED_SQL)); // a seed in flight, COMMIT withheld: its real locks stay held
    const strong = (await X.c.query(`select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation join pg_namespace n on n.oid = c.relnamespace
                                     where l.pid = $1 and n.nspname = 'public' and l.mode in ('ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock') order by 1`, [migPid])).rows.map((r) => `${r.relname}:${r.mode}`);
    ok("#16 a seed in flight holds strong locks on the three catalog tables only — never on a customer or identity table", same(strong.sort(), ["platform_settings:ShareRowExclusiveLock", "subscription_package_versions:ShareRowExclusiveLock", "subscription_packages:ShareRowExclusiveLock"]), strong.join(" "));
    const p = await connect(X.url);
    const flows: [string, [string, string, unknown[]][]][] = [
      ["customer sign-in (enforcement off)", customerSignInOff("owner0@company-fixture.test", FX.users[0], FX.orgs[0])],
      ["customer sign-in (enforcement on)", customerSignInOn("owner0@company-fixture.test", FX.users[0], FX.orgs[0])],
      ["Platform Owner sign-in", platformOwnerSignIn("operator@platform-fixture.test", FX.admin)],
      ["customer registration", registration("seed")],
      ["customer reads and writes", customerReadsAndWrites(FX.orgs[1])],
    ];
    for (const [label, statements] of flows) {
      const r = await txnSteps(X.c, p, statements);
      ok(`#16 while the seed is in flight: ${label} completes (nothing waits on the seed)`, r.blockedAt === null, fmtSteps(r.steps));
    }
    await mig.query("COMMIT");
    const legacy = (await X.c.query(`select o.id, (select count(*) from tenant_subscriptions s where s.org_id = o.id)::int as subs, (select count(*) from tenant_primary_owners t where t.org_id = o.id)::int as owners,
                                            (select count(*) from tenant_access_controls a where a.org_id = o.id)::int as acc from orgs o order by o.id`)).rows;
    ok("#16 after the seed every legacy company still has no subscription, no primary-owner mapping and no access row (access resolves to active as before)", legacy.length === FX.orgs.length && legacy.every((r) => r.subs === 0 && r.owners === 0 && r.acc === 0), JSON.stringify(legacy));
    for (const [label, statements] of flows.slice(0, 2)) {
      const r = await txnSteps(X.c, p, statements);
      ok(`#16 after the seed: ${label} completes`, r.blockedAt === null, fmtSteps(r.steps));
    }
    await closeAll(X.c);
  }

  // ------------------------------------------------------------------------------------------------
  section("8. The runner refuses incomplete or unsafe schemas before writing anything");
  {
    // A pre-onboarding database WITH legacy customers (PO-01A and PO-02A applied; neither F1 nor PO-02D1A): PO-02D1A.1's
    // push-before-SQL state — H-1 (users holds rows and push would add F1's unique key: the TRUNCATE prompt) and H-2
    // (push would create the reviewed onboarding tables outside the reviewed SQL, half-way at 42830).
    const P = disposableName("po02d1b_seed_pre_d1");
    names.push(P);
    const pUrl = await createDisposableDatabase(P);
    await pushPreCompanyTenantSchema(pUrl);
    await applyPlatformMigration(pUrl, [PLATFORM_SQL_PATH]);
    const pf = await connectDisposable(pUrl);
    await insertFixtures(pf);
    await pf.end();
    await applyPlatformMigration(pUrl, [PO02A_SQL_PATH]);
    const pc = await connect(pUrl);
    const preRows = await tableChecksums(pc, await allTables(pc));
    const preCatalog = await catalogDigest(pc);
    const r = cli("platform:db:seed", pUrl);
    const rowDrift = diffChecksums(preRows, await tableChecksums(pc, await allTables(pc)));
    ok("#17 pre-onboarding schema with legacy users (no F1, no PO-02D1A): refused by the preflight (exit 3) naming D1-00 and the push hazards H-1 and H-2; nothing written (every table and the catalog unchanged)",
      r.status === 3 && /preflight did not pass \(BLOCKED, REVIEWED_SQL_NOT_APPLIED\)/.test(r.out) && /\bD1-00\b/.test(r.out) && /\bH-1\b/.test(r.out) && /\bH-2\b/.test(r.out) &&
        rowDrift.length === 0 && (await catalogDigest(pc)) === preCatalog,
      `${rowDrift.join(" ")} ${r.out.slice(-400)}`);
    await rejects("#17 …and the SQL refuses by itself when run directly (precondition: the onboarding tables)", () => run(pc, SEED_SQL), (e) => /precondition failed: table platform_settings/.test(String((e as Error).message)));
    await closeAll(pc);

    const X = await copyOf(BASE, "po02d1b_seed_trigger_off");
    await X.c.query(`alter table tenant_subscriptions disable trigger tenant_subscriptions_guard`);
    const r2 = cli("platform:db:seed", X.url);
    ok("#17 a disabled onboarding trigger: refused by the preflight (exit 3, D1-02), nothing written", r2.status === 3 && /D1-02/.test(r2.out) && (await counts(X.c)).settings === 0, r2.out.slice(-300));
    await rejects("#17 …the SQL itself refuses it too, naming the trigger", () => run(X.c, SEED_SQL), (e) => /trigger tenant_subscriptions\.tenant_subscriptions_guard ENABLED/.test(String((e as Error).message)));
    await X.c.query(`alter table tenant_subscriptions enable trigger tenant_subscriptions_guard`);
    const auditTrigger = (await X.c.query(`select tgname from pg_trigger where tgrelid = 'platform_audit_events'::regclass and not tgisinternal order by 1 limit 1`)).rows[0].tgname as string;
    await X.c.query(`alter table platform_audit_events disable trigger "${auditTrigger}"`);
    const r3 = cli("platform:db:seed", X.url);
    ok("#17 a disabled audit-trail trigger: refused by the preflight (exit 3, P1-01)", r3.status === 3 && /P1-01/.test(r3.out) && (await counts(X.c)).settings === 0, r3.out.slice(-300));
    await rejects("#17 …the SQL itself refuses it: the audit trail must be enabled", () => run(X.c, SEED_SQL), (e) => /precondition failed: .*the audit trail's enabled/.test(String((e as Error).message)));
    await X.c.query(`alter table platform_audit_events enable trigger "${auditTrigger}"`);
    ok("…with both protections re-enabled the same database seeds", same(await run(X.c, SEED_SQL), [...SEED_CREATED]));
    await closeAll(X.c);

    const U = new URL(databaseUrlFor(BASE));
    U.pathname = "/elite_erp_production_like";
    const r4 = cli("platform:db:seed", U.toString());
    ok("an unsafe target (no _test_only_ in the name) is refused before any connection (exit 2)", r4.status === 2 && /REFUSED \[NOT_DISPOSABLE_NAME\]/.test(r4.out), r4.out.slice(-200));
  }

  // ------------------------------------------------------------------------------------------------
  section("9. A missing customer foreign key (H-3 / O-06) stops the seed");
  {
    const X = await copyOf(BASE, "po02d1b_seed_fk");
    const fk = (await X.c.query(`select conname from pg_constraint where conrelid = 'delivery_challan_items'::regclass and contype = 'f' and length(conname) = 63`)).rows[0].conname as string;
    const def = (await X.c.query(`select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'delivery_challan_items'::regclass and conname = $1`, [fk])).rows[0].d as string;
    await X.c.query(`alter table delivery_challan_items drop constraint "${fk}"`);
    const r = cli("platform:db:seed", X.url);
    ok("#18 a dropped long-named customer foreign key: refused by the preflight with O-06 (exit 3), nothing written", r.status === 3 && /O-06/.test(r.out) && (await counts(X.c)).settings === 0, r.out.slice(-400));
    await X.c.query(`alter table delivery_challan_items add constraint "${fk}" ${def}`);
    const r2 = cli("platform:db:seed", X.url);
    ok("#18 …restored with its exact definition, the same database seeds (exit 0)", r2.status === 0 && /RESULT: SEEDED/.test(r2.out), r2.out.slice(-300));
    await closeAll(X.c);
  }

  // ------------------------------------------------------------------------------------------------
  section("10. Rollback: exactly the seed is removed; the foundation, customers and audit evidence stay");
  {
    const X = await copyOf(BASE, "po02d1b_seed_rollback");
    const x0 = { catalog: await catalogDigest(X.c), other: await otherData(X.c), guards: await guardState(X.c) };
    ok("setup: seeded through the runner", cli("platform:db:seed", X.url).status === 0);
    const r = cli("platform:db:seed-rollback", X.url);
    const steps = lines(r.out).filter((l) => /^R[1-4] /.test(l));
    info(`platform:db:seed-rollback: exit ${r.status}; ${steps.join(" · ")}`);
    ok("#19 rollback through the runner: exit 0, removed ×3, one rollback audit record", r.status === 0 && same(steps, [...ROLLBACK_REMOVED]) && /RESULT: ROLLED_BACK/.test(r.out), r.out.slice(-400));
    const c1 = await counts(X.c);
    ok("#19 …the seed is gone; the seed's own audit record is kept and the rollback adds one (append-only evidence)", same(pick(c1, ["settings", "packages", "versions", "seed_events", "rollback_events"]), { settings: 0, packages: 0, versions: 0, seed_events: 1, rollback_events: 1 }), JSON.stringify(c1));
    ok("#19 …no schema object removed (catalog projection identical to before the seed; onboarding and PO-01A checks pass)", (await catalogDigest(X.c)) === x0.catalog && (await checkOnboardingFoundation(X.c)).ok && (await checkPlatformObjects(X.c)).ok);
    ok("#19 …no customer record touched (every other table byte-identical)", diffChecksums(x0.other, await otherData(X.c)).length === 0);
    ok("#19 …the immutability guard and the audit trail's triggers are enabled exactly as before", (await guardState(X.c)) === x0.guards, await guardState(X.c));
    const again = cli("platform:db:seed-rollback", X.url);
    ok("#19 a repeated rollback: absent ×3, nothing recorded", again.status === 0 && same(lines(again.out).filter((l) => /^R[1-4] /.test(l)), [...ROLLBACK_ABSENT]) && (await counts(X.c)).rollback_events === 1);
    const reseed = cli("platform:db:seed", X.url);
    ok("#19 after a rollback the seed applies again (created ×3, a second creation record)", reseed.status === 0 && same(lines(reseed.out).filter((l) => /^S[1-4] /.test(l)), [...SEED_CREATED]) && (await counts(X.c)).seed_events === 2);
    await closeAll(X.c);
  }

  // ------------------------------------------------------------------------------------------------
  section("11. Rollback refusals: references, operator changes, later versions — nothing removed");
  {
    // A seeded template for the refusal cases.
    const T = await copyOf(BASE, "po02d1b_seed_seeded_tpl");
    await run(T.c, SEED_SQL);
    await closeAll(T.c);
    const version = async (c: Client) => (await c.query(`select v.id from subscription_package_versions v join subscription_packages p on p.id = v.package_id where p.code = 'trial' and v.version_number = 1`)).rows[0].id as string;
    const cases: [string, (c: Client) => Promise<void>, RegExp][] = [
      ["Trial version 1 referenced by a (fictional, isolated) Trial subscription", async (c) => {
        const v = await version(c);
        await c.query(
          `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot,
                                              storage_snapshot_gb, module_groups_snapshot, assignment_source, created_by_platform_admin_id)
           values ($1, $2, 'published', true, 'trial', 'trialing', date '2026-11-18', date '2026-11-18' + 13, 0, 3, 5, '["Dashboard"]', 'platform_assignment', $3)`,
          [FX.orgs[0], v, FX.admin],
        );
      }, /1 subscription\(s\) exist; Trial version 1 is referenced by 1 subscription\(s\)/],
      ["Trial version 1 referenced by (fictional, isolated) invitation terms", async (c) => {
        const v = await version(c);
        const inv = (await c.query(
          `insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, invited_by_platform_admin_id)
           values ('Terms Fixture Co', 'hello@terms.fixture.test', 'Saudi Arabia', 'SAR', 'Terms Owner', 'terms.owner@fixture.test', $1, $2) returning id`, [newTokenHash(), FX.admin])).rows[0].id;
        await c.query(`insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_version_state, initial_is_trial, initial_cycle) values ($1, $2, 'published', true, 'trial')`, [inv, v]);
      }, /1 invitation terms row\(s\) exist; Trial version 1 is referenced by 1 invitation terms row\(s\)/],
      ["settings saved by an operator", async (c) => { await c.query(`update platform_settings set updated_by_platform_admin_id = $1, updated_at = now()`, [FX.admin]); }, /platform_settings was saved by an operator \(kept\)/],
      ["settings changed to 21 trial days", async (c) => { await c.query(`update platform_settings set default_trial_days = 21`); }, /platform_settings differs from the seed \(default_trial_days: existing 21, approved 14\)/],
      ["a later (draft) Trial version 2", async (c) => {
        await c.query(`insert into subscription_package_versions (package_id, version_number, publish_state, is_trial, monthly_price, annual_price, included_seats, storage_allowance_gb, trial_days, created_by_platform_admin_id)
                       select id, 2, 'draft', true, 0, 0, 3, 5, 14, $1 from subscription_packages where code = 'trial'`, [FX.admin]);
      }, /the Trial package has 1 other version\(s\)/],
      ["the Trial package renamed", async (c) => { await c.query(`update subscription_packages set name = 'Trial Plan', updated_at = now() where code = 'trial'`); }, /the Trial package differs from the seed \(name: existing "Trial Plan", approved "Trial"\)/],
    ];
    for (const [label, setup, expected] of cases) {
      const X = await copyOf(T.name, "po02d1b_seed_rb_refuse");
      await setup(X.c);
      const before = { catalog: await catalogDigest(X.c), data: await tableChecksums(X.c, await allTables(X.c)), guards: await guardState(X.c) };
      let message = "";
      try {
        await runSeed(X.url, { rollback: true });
      } catch (e) {
        message = e instanceof SeedRefusedError ? `${e.exitCode} ${e.message}` : `unexpected: ${describeError(e)}`;
      }
      const preflightBlocked = /^3 /.test(message);
      ok(`#19 ${label}: the rollback is refused${preflightBlocked ? " (the preflight already blocks)" : " (exit 4), every reason named"}`, preflightBlocked || (/^4 /.test(message) && expected.test(message)), message.slice(0, 400));
      ok(`#19 …nothing removed: catalog, every row and the protection triggers unchanged`, (await catalogDigest(X.c)) === before.catalog && diffChecksums(before.data, await tableChecksums(X.c, await allTables(X.c))).length === 0 && (await guardState(X.c)) === before.guards);
      if (preflightBlocked) {
        await rejects(`#19 …and the rollback SQL itself refuses it, naming the reason`, () => run(X.c, ROLLBACK_SQL), (e) => expected.test(String((e as Error).message)));
      }
      await closeAll(X.c);
    }
  }

  // ------------------------------------------------------------------------------------------------
  section("12. Rollback safety under concurrency and failure: the guard is never off for anyone else");
  {
    const T2 = await copyOf(BASE, "po02d1b_seed_rb_conc_tpl");
    await T2.c.query(`insert into subscription_packages (code, name, status, is_trial, created_by_platform_admin_id) values ('growth', 'Growth', 'active', false, $1)`, [FX.admin]);
    await T2.c.query(`insert into subscription_package_versions (package_id, version_number, publish_state, is_trial, monthly_price, annual_price, included_seats, storage_allowance_gb, published_at, created_by_platform_admin_id)
                      select id, 1, 'published', false, 100.00, 1000.00, 10, 50, now(), $1 from subscription_packages where code = 'growth'`, [FX.admin]);
    await run(T2.c, SEED_SQL);
    await closeAll(T2.c);

    const X = await copyOf(T2.name, "po02d1b_seed_rb_window");
    const rb = await connect(X.url);
    const w = await connect(X.url);
    const wPid = await pidOf(w);
    await rb.query(held(ROLLBACK_SQL)); // R1–R4 done (the guard suspended and re-enabled inside R1); COMMIT withheld
    let wErr: unknown = null;
    const writing = w.query(`update subscription_package_versions set monthly_price = 1.00 where version_number = 1 and package_id = (select id from subscription_packages where code = 'growth')`).catch((e) => { wErr = e; });
    const waiting = await waitsOnLock(X.c, wPid);
    ok("#19 barrier: a concurrent writer of ANOTHER published version waits for the rollback's lock (no session can write versions during it)", waiting);
    await rb.query("COMMIT");
    await writing;
    ok("#19 …after the rollback commits, that writer is refused by the immutability guard (23001): the guard was enabled for it", sqlState(wErr) === "23001", describeError(wErr));
    ok("#19 …the other published version is untouched and the guard is enabled", (await X.c.query(`select monthly_price::text as m from subscription_package_versions where package_id = (select id from subscription_packages where code = 'growth')`)).rows[0].m === "100.00" && /subscription_package_versions_guard=O/.test(await guardState(X.c)));
    await closeAll(X.c);

    const Y = await copyOf(T2.name, "po02d1b_seed_rb_fail");
    const holder = await connect(Y.url);
    await holder.query("begin");
    await holder.query("lock table platform_audit_events in share mode");
    const rb2 = await connect(Y.url);
    let rbErr: unknown = null;
    await rb2.query(ROLLBACK_SQL).catch((e) => { rbErr = e; });
    await rb2.query("ROLLBACK").catch(() => undefined);
    await holder.query("rollback");
    ok("#19 a rollback whose audit write fails (55P03) is undone entirely…", sqlState(rbErr) === "55P03", describeError(rbErr));
    ok("#19 …the Trial and settings are still there, exactly as seeded, and the immutability guard is ENABLED (the suspension was rolled back too)",
      (await checkTrialSeed(Y.c)).state === "complete" && /subscription_package_versions_guard=O/.test(await guardState(Y.c)), await guardState(Y.c));
    await closeAll(Y.c);
  }

  // ------------------------------------------------------------------------------------------------
  section("13. Push compatibility on a separate seeded database: catalog, customer keys and the seed unchanged");
  {
    const X = await copyOf(BASE, "po02d1b_seed_push");
    await run(X.c, SEED_SQL);
    const before = { catalog: await catalogDigest(X.c), fks: await customerFks(X.c), xmin: (await X.c.query(`select string_agg(xmin::text, ',') as x from (select xmin from platform_settings union all select xmin from subscription_packages union all select xmin from subscription_package_versions) q`)).rows[0].x };
    const gate = cli("platform:db:preflight", X.url);
    ok("the preflight on the seeded database: PUSH_SAFE (the gate a push would need)", gate.status === 0 && /VERDICT: PUSH_SAFE/.test(gate.out));
    const push = pushSchema(X.url, "full", { verbose: true });
    ok("a gated push on this separate disposable database runs (only the known benign foreign-key re-creations)", push.ok, push.output.slice(-300));
    ok("…the full catalog projection is identical and EVERY customer foreign key is present afterwards", (await catalogDigest(X.c)) === before.catalog && same(await customerFks(X.c), before.fks));
    const xmin = (await X.c.query(`select string_agg(xmin::text, ',') as x from (select xmin from platform_settings union all select xmin from subscription_packages union all select xmin from subscription_package_versions) q`)).rows[0].x;
    ok("…and the seed rows were not rewritten (xmin unchanged; still exactly the seed)", xmin === before.xmin && (await checkTrialSeed(X.c)).state === "complete");
    await closeAll(X.c);
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-onboarding-seed");
} catch (e) {
  console.error(`verify:platform-onboarding-seed aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  for (const c of clients) await c.end().catch(() => undefined);
  if (process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") for (const n of names.reverse()) await dropDisposableDatabase(n).catch(() => undefined);
}
process.exit(exitCode);
