/**
 * Platform Owner PO-02D1A — onboarding database foundation (schema only): SQL ≡ Drizzle equivalence, the single
 * tenant change (F1), non-interference with every existing table, and every constraint and trigger of F1–F8.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-onboarding-schema
 *
 * Disposable loopback `*_test_only_*` databases only (local-db-guard); every row written is FICTIONAL — the Trial
 * length, seats, storage, labels and prices below are TEST values, not approved business values (PO-02D1B). Every
 * database created here is dropped at the end (PLATFORM_TEST_KEEP_DATABASES=1 keeps them).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  connectDisposable,
  createDisposableDatabase,
  disposableName,
  dropDisposableDatabase,
  pushSchema,
  pushPreCompanyTenantSchema,
  applyPlatformMigration,
} from "../scripts/platform/disposable-db";
import {
  projectCatalog,
  diffProjection,
  checkPlatformObjects,
  checkCompanyFoundation,
  checkOnboardingFoundation,
  ONBOARDING_TABLES,
  ONBOARDING_TRIGGERS,
  PLATFORM_SQL_PATH,
  PO02A_SQL_PATH,
} from "../scripts/platform/catalog";
import { section, ok, rejects, sqlState, summary, describeError } from "./platform/harness";
import { insertFixtures, tableChecksums, diffChecksums, newTokenHash } from "./platform/po02a-fixtures";
import { PO02D1_CREATED, runPo02d1 } from "./platform/po02d1-fixtures";

const created: string[] = [];
const keep = process.env.PLATFORM_TEST_KEEP_DATABASES === "1";
async function newDb(prefix: string): Promise<{ name: string; url: string }> {
  const name = disposableName(prefix);
  const url = await createDisposableDatabase(name);
  created.push(name);
  return { name, url };
}
const state = (code: string) => (e: unknown) => sqlState(e) === code;
const CHECK = state("23514");
const UNIQUE = state("23505");
const FK = state("23503");
const NOT_NULL = state("23502");
const RESTRICT = state("23001");
const OVERFLOW = state("22003");
const APPEND_ONLY_ON = (table: string) => (e: unknown) => sqlState(e) === "P0001" && String((e as Error).message).startsWith(`Table ${table} is append-only`);
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The 70 reviewed PO-02D1 constraint names (pinned). */
const D1_CONSTRAINTS = [
  "organization_invitation_terms_cycle_chk", "organization_invitation_terms_invitation_fk", "organization_invitation_terms_pkey", "organization_invitation_terms_state_chk", "organization_invitation_terms_version_fk",
  "platform_settings_currency_chk", "platform_settings_grace_days_chk", "platform_settings_locked_chk", "platform_settings_pkey", "platform_settings_singleton_chk", "platform_settings_timezone_chk", "platform_settings_trial_days_chk", "platform_settings_updated_by_fk",
  "subscription_events_actor_chk", "subscription_events_actor_fk", "subscription_events_org_fk", "subscription_events_pkey", "subscription_events_reason_chk", "subscription_events_snapshot_chk", "subscription_events_subscription_fk", "subscription_events_type_chk",
  "subscription_package_versions_attribution_chk", "subscription_package_versions_created_by_fk", "subscription_package_versions_currency_chk", "subscription_package_versions_modules_chk", "subscription_package_versions_number_chk", "subscription_package_versions_number_uq",
  "subscription_package_versions_package_fk", "subscription_package_versions_pkey", "subscription_package_versions_prices_chk", "subscription_package_versions_published_at_chk", "subscription_package_versions_ref_uq", "subscription_package_versions_seats_chk",
  "subscription_package_versions_state_chk", "subscription_package_versions_storage_chk", "subscription_package_versions_trial_terms_chk",
  "subscription_packages_attribution_chk", "subscription_packages_code_chk", "subscription_packages_created_by_fk", "subscription_packages_default_trial_chk", "subscription_packages_description_chk", "subscription_packages_id_trial_uq", "subscription_packages_name_chk",
  "subscription_packages_pkey", "subscription_packages_status_chk", "subscription_packages_timestamps_chk",
  "tenant_primary_owners_assigned_by_fk", "tenant_primary_owners_org_fk", "tenant_primary_owners_pkey", "tenant_primary_owners_user_fk", "tenant_primary_owners_user_uq",
  "tenant_subscriptions_attribution_chk", "tenant_subscriptions_created_by_fk", "tenant_subscriptions_cycle_chk", "tenant_subscriptions_dates_chk", "tenant_subscriptions_id_org_uq", "tenant_subscriptions_lifecycle_chk", "tenant_subscriptions_modules_chk",
  "tenant_subscriptions_note_chk", "tenant_subscriptions_org_fk", "tenant_subscriptions_pkey", "tenant_subscriptions_price_chk", "tenant_subscriptions_seats_chk", "tenant_subscriptions_source_chk", "tenant_subscriptions_storage_chk", "tenant_subscriptions_timestamps_chk",
  "tenant_subscriptions_trial_cycle_chk", "tenant_subscriptions_trialing_chk", "tenant_subscriptions_version_fk", "tenant_subscriptions_version_state_chk",
];
/** The composite keys whose column pairing is load-bearing (pg_get_constraintdef, pinned). */
const D1_COMPOSITE_KEYS: Record<string, string> = {
  tenant_primary_owners_user_fk: "FOREIGN KEY (user_id, org_id) REFERENCES users(id, org_id) ON DELETE RESTRICT",
  subscription_package_versions_package_fk: "FOREIGN KEY (package_id, is_trial) REFERENCES subscription_packages(id, is_trial) ON DELETE RESTRICT",
  subscription_package_versions_ref_uq: "UNIQUE (id, publish_state, is_trial)",
  tenant_subscriptions_version_fk: "FOREIGN KEY (package_version_id, version_state, is_trial) REFERENCES subscription_package_versions(id, publish_state, is_trial) ON DELETE RESTRICT",
  subscription_events_subscription_fk: "FOREIGN KEY (tenant_subscription_id, org_id) REFERENCES tenant_subscriptions(id, org_id) ON DELETE RESTRICT",
  organization_invitation_terms_version_fk:
    "FOREIGN KEY (initial_package_version_id, initial_version_state, initial_is_trial) REFERENCES subscription_package_versions(id, publish_state, is_trial) ON DELETE RESTRICT",
};

async function main(): Promise<void> {
  section("1. Build: the pre-PO-02A tenant shape with fictional tenant data + PO01 + PO02A, then PO02D1; and the supported Drizzle procedure");
  const L = await newDb("po02d1_schema_l");
  ok("L: pre-PO-02A tenant schema (621f156 shape) pushed", (await pushPreCompanyTenantSchema(L.url)).ok);
  await applyPlatformMigration(L.url, [PLATFORM_SQL_PATH]);
  const cL = await connectDisposable(L.url);
  cL.on("error", () => undefined);
  const fx = await insertFixtures(cL);
  await applyPlatformMigration(L.url, [PO02A_SQL_PATH]);
  const P = await newDb("po02d1_schema_p");
  ok("P: full Drizzle schema pushed (the onboarding module and the users key included)", pushSchema(P.url, "full").ok);
  await applyPlatformMigration(P.url);
  const cP = await connectDisposable(P.url);
  cP.on("error", () => undefined);
  try {
    const L0 = await projectCatalog(cL);
    const existingTables = [...L0.other.tables, ...L0.platform.tables];
    const data0 = await tableChecksums(cL, existingTables);
    ok("L before PO-02D1: none of its objects exist", L0.platform.tables.every((t) => !(ONBOARDING_TABLES as readonly string[]).includes(t)) && !L0.other.constraints.some((l) => l.includes("users_org_id_id_uq")));
    const steps = await runPo02d1(cL);
    ok(`first application: created ×${PO02D1_CREATED.length} (F1, three functions, F2–F8, ten triggers) in file order`, JSON.stringify(steps) === JSON.stringify(PO02D1_CREATED), steps.join(" · "));
    const L1 = await projectCatalog(cL);
    const PP = await projectCatalog(cP);

    section("2. Reviewed SQL ≡ Drizzle schema (src/db/schema/platform-onboarding.ts, users.ts F1)");
    const dPlat = diffProjection(PP.platform, L1.platform, "full-drizzle-push+sql", "pre-PO-02A+reviewed-sql");
    ok("platform-owned projection identical (tables, columns, types, nullability, defaults, identity, constraints, indexes, triggers + enabled state, functions, sequences)", dPlat.length === 0, dPlat.slice(0, 6).join("\n        "));
    const dOther = diffProjection(PP.other, L1.other, "full-drizzle-push+sql", "pre-PO-02A+reviewed-sql");
    ok("every tenant object identical too — the F1 key included", dOther.length === 0, dOther.slice(0, 6).join("\n        "));
    const onb = (l: string) => (ONBOARDING_TABLES as readonly string[]).includes(l.split(" | ")[0]);
    const conNames = L1.platform.constraints.filter(onb).map((l) => l.split(" | ")[1]).sort();
    ok(`exactly the ${D1_CONSTRAINTS.length} reviewed PO-02D1 constraints exist (names pinned; FK names ≤ 63 characters)`, JSON.stringify(conNames) === JSON.stringify([...D1_CONSTRAINTS].sort()) && conNames.every((n) => n.length <= 63), conNames.join(","));
    const conDef = Object.fromEntries(L1.platform.constraints.filter(onb).map((l) => l.split(" | ")).map((p) => [p[1], p[3]]));
    const keyBad = Object.entries(D1_COMPOSITE_KEYS).filter(([n, def]) => conDef[n] !== def);
    ok("each composite key pairs its columns as reviewed (table-column order on both sides)", keyBad.length === 0, keyBad.map(([n]) => `${n}: ${conDef[n]}`).join("; "));
    const cols = (t: string) => L1.platform.columns.filter((l) => l.startsWith(`${t} | `));
    ok(
      "column counts: settings 10, packages 10, versions 15, primary owners 4, subscriptions 19, events 11, invitation terms 6 — and no invite_only column",
      cols("platform_settings").length === 10 && cols("subscription_packages").length === 10 && cols("subscription_package_versions").length === 15 &&
        cols("tenant_primary_owners").length === 4 && cols("tenant_subscriptions").length === 19 && cols("subscription_events").length === 11 &&
        cols("organization_invitation_terms").length === 6 && !L1.platform.columns.some((l) => / \| invite_only \| /.test(l)),
    );
    const col = (t: string, name: string) => L1.platform.columns.find((l) => l.startsWith(`${t} | `) && l.split(" | ")[2] === name) ?? "";
    ok("money is numeric(14,2) everywhere (version prices, subscription price snapshot)", ["monthly_price", "annual_price"].every((c) => / \| numeric\(14,2\) \| not null \| /.test(col("subscription_package_versions", c))) && / \| numeric\(14,2\) \| not null \| /.test(col("tenant_subscriptions", "price_snapshot_sar")));
    ok("default_trial_days is NOT NULL with NO default (the seed must state the approved value)", /^platform_settings \| 2 \| default_trial_days \| integer \| not null \| - \|/.test(col("platform_settings", "default_trial_days")), col("platform_settings", "default_trial_days"));
    ok("subscription_events.id is GENERATED ALWAYS AS IDENTITY (an id cannot be supplied)", / \| bigint \| not null \| - \| a \| /.test(col("subscription_events", "id")), col("subscription_events", "id"));
    const pos = (t: string, name: string) => col(t, name).split(" | ")[1];
    ok("column positions that pair the composite keys: tenant_primary_owners user_id 1 · org_id 2; versions publish_state 4 · is_trial 5",
      pos("tenant_primary_owners", "user_id") === "1" && pos("tenant_primary_owners", "org_id") === "2" &&
        pos("subscription_package_versions", "publish_state") === "4" && pos("subscription_package_versions", "is_trial") === "5");
    const trg = L1.platform.triggers.filter(onb);
    ok(`exactly ${ONBOARDING_TRIGGERS.length} onboarding triggers, all ENABLED (tgenabled O)`, trg.length === ONBOARDING_TRIGGERS.length && trg.every((l) => l.endsWith(" | O")), trg.join("\n        "));
    ok("both databases pass the onboarding check (tables, users key, functions, exactly ten enabled triggers); the PO-01A and PO-02A checks still pass",
      (await checkOnboardingFoundation(cL)).ok && (await checkOnboardingFoundation(cP)).ok && (await checkPlatformObjects(cL)).ok && (await checkCompanyFoundation(cL)).ok);
    const funcs = (await cL.query(`select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as cfg from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('subscription_package_version_guard','tenant_primary_owner_guard','tenant_subscription_guard')`)).rows;
    ok("the three guard functions are SECURITY INVOKER with search_path pinned to pg_catalog", funcs.length === 3 && funcs.every((f) => f.prosecdef === false && f.cfg === "search_path=pg_catalog"));

    section("3. The single tenant change (F1), and no data change anywhere");
    const tenantDiff = diffProjection(L0.other, L1.other, "before", "after");
    ok(
      "the ONLY tenant-schema difference is F1: the users_org_id_id_uq UNIQUE (id, org_id) constraint and its index",
      tenantDiff.length === 2 && tenantDiff.includes("constraints: only in after: users | users_org_id_id_uq | u | UNIQUE (id, org_id) | validated | immediate") &&
        tenantDiff.includes("indexes: only in after: users | users_org_id_id_uq | CREATE UNIQUE INDEX users_org_id_id_uq ON public.users USING btree (id, org_id)"),
      tenantDiff.join("\n        "),
    );
    const platDiff = diffProjection(L0.platform, L1.platform, "before", "after");
    ok("PO-01A and PO-02A objects untouched: every platform-side difference is an onboarding object", platDiff.every((l) => /only in after: /.test(l) && ((ONBOARDING_TABLES as readonly string[]).some((t) => l.includes(`${t} |`) || l.includes(` ${t}`)) || /subscription_package_version_guard|tenant_primary_owner_guard|tenant_subscription_guard|subscription_events_id_seq/.test(l))), platDiff.filter((l) => !/only in after/.test(l)).join("\n        "));
    const data1 = await tableChecksums(cL, existingTables);
    ok(`data of all ${existingTables.length} pre-existing tables byte-identical (orgs, users, sessions, customers, platform and company tables; fixtures included)`, diffChecksums(data0, data1).length === 0, diffChecksums(data0, data1).join(","));
    const counts = (await cL.query(`select ${ONBOARDING_TABLES.map((t) => `(select count(*) from ${t})::int as ${t}`).join(", ")}`)).rows[0];
    ok("nothing was seeded: all seven onboarding tables are empty (no settings row, no Trial, no subscription, no primary owner)", Object.values(counts).every((n) => n === 0), JSON.stringify(counts));
    const legacy = (await cL.query(`select (select count(*) from tenant_access_controls)::int as tac, (select count(*) from organization_invitations)::int as inv`)).rows[0];
    ok("no legacy company received an access row or an invitation (still active by the compatibility rule)", legacy.tac === 0 && legacy.inv === 0, JSON.stringify(legacy));

    section("4. F2 platform_settings — singleton, locked Stage 2 values, no default trial length");
    const settings = (o: Record<string, unknown> = {}) => {
      const v = { id: 1, default_trial_days: 7, grace_days: 0, expiry_alerts_enabled: true, manual_billing: true, platform_mfa_required: true, platform_currency: "SAR", platform_timezone: "Asia/Riyadh", ...o };
      return cL.query(`insert into platform_settings (id, default_trial_days, grace_days, expiry_alerts_enabled, manual_billing, platform_mfa_required, platform_currency, platform_timezone) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [v.id, v.default_trial_days, v.grace_days, v.expiry_alerts_enabled, v.manual_billing, v.platform_mfa_required, v.platform_currency, v.platform_timezone]);
    };
    await rejects("a row without default_trial_days is rejected (NOT NULL, no default)", () => cL.query(`insert into platform_settings (id) values (1)`), NOT_NULL);
    await rejects("id 2 rejected (singleton)", () => settings({ id: 2 }), CHECK);
    for (const d of [0, 121]) await rejects(`default_trial_days ${d} rejected (1–120)`, () => settings({ default_trial_days: d }), CHECK);
    await rejects("grace_days 61 rejected (0–60)", () => settings({ grace_days: 61 }), CHECK);
    await rejects("manual_billing false rejected (locked on)", () => settings({ manual_billing: false }), CHECK);
    await rejects("platform MFA off rejected (locked on)", () => settings({ platform_mfa_required: false }), CHECK);
    await rejects("platform currency USD rejected (SAR only)", () => settings({ platform_currency: "USD" }), CHECK);
    await rejects("platform time zone UTC rejected (Asia/Riyadh only)", () => settings({ platform_timezone: "UTC" }), CHECK);
    await cL.query("begin");
    await settings();
    await rejects("a second row is rejected (primary key)", () => settings(), UNIQUE);
    await cL.query("rollback");
    ok("…the fictional settings row existed only inside a rolled-back transaction (table empty)", (await cL.query(`select count(*)::int as n from platform_settings`)).rows[0].n === 0);

    section("5. F3 subscription_packages — identity, default Trial rules, attribution (fictional rows)");
    const pkg = (o: Record<string, unknown> = {}) => {
      const v = { code: "fixture-paid", name: "Fixture Paid (fictional)", description: null, status: "draft", is_trial: false, is_default_trial: false, by: fx.admin, ...o };
      return cL.query(`insert into subscription_packages (code, name, description, status, is_trial, is_default_trial, created_by_platform_admin_id) values ($1, $2, $3, $4, $5, $6, $7) returning id`, [v.code, v.name, v.description, v.status, v.is_trial, v.is_default_trial, v.by]);
    };
    for (const bad of ["Fixture", "1abc", "a", "fixture_paid", "fixture paid"]) await rejects(`code '${bad}' rejected (slug ^[a-z][a-z0-9-]{1,39}$)`, () => pkg({ code: bad }), CHECK);
    await rejects("untrimmed name rejected", () => pkg({ name: " Fixture " }), CHECK);
    await rejects("status 'expired' rejected (draft / active / archived)", () => pkg({ status: "expired" }), CHECK);
    await rejects("an operator-created package without its operator rejected (attribution)", () => pkg({ by: null }), CHECK);
    await rejects("a default Trial that is not a Trial rejected", () => pkg({ code: "fixture-x", is_default_trial: true, by: null }), CHECK);
    await rejects("an archived default Trial rejected", () => pkg({ code: "fixture-x", is_trial: true, is_default_trial: true, status: "archived", by: null }), CHECK);
    const paidPkg = (await pkg()).rows[0].id as string;
    const trialPkg = (await pkg({ code: "fixture-trial", name: "Fixture Trial (fictional)", status: "active", is_trial: true, is_default_trial: true, by: null })).rows[0].id as string;
    ok("a fictional paid package (operator-attributed) and a fictional default Trial (system, unattributed) insert", !!paidPkg && !!trialPkg);
    await rejects("a second default Trial rejected (at most one)", () => pkg({ code: "fixture-trial-2", name: "Fixture Trial 2", is_trial: true, is_default_trial: true, by: null }), UNIQUE);
    await rejects("a duplicate code rejected", () => pkg({ name: "Another name" }), UNIQUE);
    await rejects("a name differing only by case rejected (case-folded unique)", () => pkg({ code: "fixture-paid-2", name: "FIXTURE PAID (FICTIONAL)" }), UNIQUE);
    await rejects("archiving the default Trial rejected", () => cL.query(`update subscription_packages set status = 'archived' where id = $1`, [trialPkg]), CHECK);

    section("6. F4 subscription_package_versions — SAR precision, entitlements, Trial terms, publication and immutability");
    const version = (o: Record<string, unknown> = {}) => {
      const v = { pkg: paidPkg, is_trial: false, n: 1, state: "draft", currency: "SAR", monthly: "10.00", annual: "100.00", seats: 5, storage: 2, modules: '["Fixture Sales"]', trial_days: 0, published_at: null, by: fx.admin, ...o };
      return cL.query(
        `insert into subscription_package_versions (package_id, is_trial, version_number, publish_state, currency_code, monthly_price, annual_price, included_seats, storage_allowance_gb, module_groups, trial_days, published_at, created_by_platform_admin_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13) returning id, monthly_price::text as m`,
        [v.pkg, v.is_trial, v.n, v.state, v.currency, v.monthly, v.annual, v.seats, v.storage, v.modules, v.trial_days, v.published_at, v.by],
      );
    };
    await rejects("a version whose Trial-ness differs from its package rejected (composite foreign key)", () => version({ is_trial: true, trial_days: 7, monthly: "0", annual: "0" }), FK);
    await rejects("currency USD rejected (SAR only)", () => version({ currency: "USD" }), CHECK);
    await rejects("a negative price rejected", () => version({ monthly: "-0.01" }), CHECK);
    await rejects("a price beyond numeric(14,2) rejected (1 000 000 000 000.00)", () => version({ monthly: "1000000000000.00" }), OVERFLOW);
    await rejects("0 included seats rejected", () => version({ seats: 0 }), CHECK);
    await rejects("seats beyond integer range rejected", () => version({ seats: 2147483648 }), OVERFLOW);
    await rejects("0 GB storage rejected", () => version({ storage: 0 }), CHECK);
    for (const [label, m] of [
      ["an object", '{"a":1}'], ["a bare string", '"Sales"'], ["a number in the list", '["Sales", 1]'], ["null in the list", '["Sales", null]'], ["an object in the list", '[{"a":"x"}]'],
      ["a nested list", '[["Sales"]]'], ["a nested empty list", "[[]]"], ["a nested list beside a label", '[["a"], "b"]'],
    ] as const)
      await rejects(`module_groups as ${label} rejected (array of strings only; strict JSON path — lax mode would unwrap a nested list)`, () => version({ modules: m }), CHECK);
    for (const m of ["[]", '["Fixture Sales", "Fixture Purchasing"]']) {
      await cL.query("begin");
      const accepted = await version({ n: 90, modules: m }).then(() => true, () => false);
      await cL.query("rollback");
      ok(`module_groups ${m} accepted (positive control; rolled back)`, accepted);
    }
    await rejects("a paid version with trial days rejected", () => version({ trial_days: 7 }), CHECK);
    await rejects("version number 0 rejected", () => version({ n: 0 }), CHECK);
    await rejects("published without published_at rejected", () => version({ state: "published" }), CHECK);
    await rejects("a draft with published_at rejected", () => version({ published_at: new Date() }), CHECK);
    await rejects("an operator-created paid version without its operator rejected", () => version({ by: null }), CHECK);
    const rounded = (await version({ monthly: "12.345", annual: "99.999" })).rows[0];
    ok("prices keep exactly two decimals (12.345 is stored as 12.35)", rounded.m === "12.35", rounded.m);
    await rejects("a second version 1 of the same package rejected", () => version(), UNIQUE);
    const paidV1 = rounded.id as string;
    await cL.query(`update subscription_package_versions set monthly_price = 10.00, annual_price = 100.00 where id = $1`, [paidV1]);
    ok("a DRAFT can be edited", (await cL.query(`select monthly_price::text as m from subscription_package_versions where id = $1`, [paidV1])).rows[0].m === "10.00");
    await rejects("…but its identity cannot change (version number)", () => cL.query(`update subscription_package_versions set version_number = 9 where id = $1`, [paidV1]), RESTRICT);
    await rejects("…nor its package", () => cL.query(`update subscription_package_versions set package_id = $2 where id = $1`, [paidV1, trialPkg]), RESTRICT);
    await cL.query(`update subscription_package_versions set publish_state = 'published', published_at = now() where id = $1`, [paidV1]);
    ok("a draft can be published", (await cL.query(`select publish_state from subscription_package_versions where id = $1`, [paidV1])).rows[0].publish_state === "published");
    await rejects("a PUBLISHED version's price cannot change", () => cL.query(`update subscription_package_versions set monthly_price = 9.00 where id = $1`, [paidV1]), RESTRICT);
    await rejects("…nor its seats", () => cL.query(`update subscription_package_versions set included_seats = 99 where id = $1`, [paidV1]), RESTRICT);
    await rejects("…nor can it be un-published", () => cL.query(`update subscription_package_versions set publish_state = 'draft', published_at = null where id = $1`, [paidV1]), RESTRICT);
    await rejects("…nor deleted", () => cL.query(`delete from subscription_package_versions where id = $1`, [paidV1]), RESTRICT);
    await rejects("…and the table cannot be truncated: a plain TRUNCATE is refused by PostgreSQL itself (0A000, referenced by foreign keys)", () => cL.query(`truncate subscription_package_versions`), state("0A000"));
    await rejects("…and TRUNCATE … CASCADE is refused by the append-only trigger of THIS table (nothing is emptied)", () => cL.query(`truncate subscription_package_versions cascade`), APPEND_ONLY_ON("subscription_package_versions"));
    const tv = (o: Record<string, unknown>) => version({ pkg: trialPkg, is_trial: true, monthly: "0", annual: "0", seats: 3, storage: 1, modules: '["Fixture Module"]', trial_days: 7, by: null, ...o });
    for (const d of [0, 121]) await rejects(`a Trial version with ${d} trial days rejected (1–120)`, () => tv({ trial_days: d }), CHECK);
    await rejects("a Trial version with a price rejected (always SAR 0.00)", () => tv({ monthly: "1.00" }), CHECK);
    const trialV1 = (await tv({ state: "published", published_at: new Date() })).rows[0].id as string;
    ok("a fictional Trial version (TEST values: 7 days, 3 seats, 1 GB) publishes — a test fixture, not the approved Trial", !!trialV1);
    const draftV2 = (await version({ n: 2 })).rows[0].id as string;
    await cL.query(`delete from subscription_package_versions where id = $1`, [draftV2]);
    ok("a draft version can be deleted", (await cL.query(`select count(*)::int as n from subscription_package_versions where id = $1`, [draftV2])).rows[0].n === 0);
    const draftV3 = (await version({ n: 3 })).rows[0].id as string;
    await rejects("a package with versions cannot be deleted (RESTRICT)", () => cL.query(`delete from subscription_packages where id = $1`, [paidPkg]), FK);

    section("7. F5 tenant_primary_owners — one per company, same-company active owner, never deleted");
    const [ownerA, staffA, ownerB] = [fx.users[0], fx.users[1], fx.users[2]];
    const [orgA, orgB, orgC] = fx.orgs;
    const map = (user: number, org: number) => cL.query(`insert into tenant_primary_owners (user_id, org_id, assigned_by_platform_admin_id) values ($1, $2, $3)`, [user, org, fx.admin]);
    // The guard (BEFORE ROW) runs before the foreign key (checked at statement end): a cross-company or unknown user is
    // refused by the guard first; the composite foreign key is then proven on its own with the guard disabled inside a
    // transaction that is rolled back.
    await rejects("an owner of ANOTHER company rejected (guard: same company)", () => map(ownerB, orgA), CHECK);
    await rejects("an unknown user rejected (guard)", () => map(999_999, orgA), CHECK);
    await cL.query("begin");
    await cL.query(`alter table tenant_primary_owners disable trigger tenant_primary_owners_guard`);
    await rejects("…and with the guard disabled, the COMPOSITE foreign key alone still rejects the other company's owner", () => map(ownerB, orgA), FK);
    await cL.query("rollback");
    ok("…(the guard is enabled again: that change was rolled back)", (await checkOnboardingFoundation(cL)).ok);
    await rejects("a staff user of the same company rejected (guard: role owner)", () => map(staffA, orgA), CHECK);
    await cL.query(`update users set is_active = false where id = $1`, [fx.users[4]]);
    await rejects("an INACTIVE owner rejected (guard)", () => map(fx.users[4], orgC), CHECK);
    await cL.query(`update users set is_active = true where id = $1`, [fx.users[4]]);
    const oddOwner = (await cL.query(`insert into users (org_id, email, password_hash, name, role) values ($1, 'odd.owner@company-fixture.test', 'x', 'Odd Owner', 'Owner') returning id`, [orgC])).rows[0].id;
    await rejects("a non-canonical 'Owner' role rejected (guard: exactly 'owner')", () => map(oddOwner, orgC), CHECK);
    await map(ownerA, orgA);
    ok("the active owner of the same company is accepted", (await cL.query(`select count(*)::int as n from tenant_primary_owners where org_id = $1`, [orgA])).rows[0].n === 1);
    const ownerA2 = (await cL.query(`insert into users (org_id, email, password_hash, name, role) values ($1, 'owner.two@company-fixture.test', 'x', 'Owner Two', 'owner') returning id`, [orgA])).rows[0].id;
    await rejects("a second primary owner for the same company rejected (one per company)", () => map(ownerA2, orgA), UNIQUE);
    await rejects("deleting the mapping rejected (transferred, never deleted)", () => cL.query(`delete from tenant_primary_owners where org_id = $1`, [orgA]), RESTRICT);
    await rejects("truncating the mappings rejected (append-only trigger)", () => cL.query(`truncate tenant_primary_owners`), APPEND_ONLY_ON("tenant_primary_owners"));
    await rejects("a transfer to the staff user rejected (guard on UPDATE)", () => cL.query(`update tenant_primary_owners set user_id = $2 where org_id = $1`, [orgA, staffA]), CHECK);
    await cL.query("begin");
    await cL.query(`update tenant_primary_owners set user_id = $2, assigned_at = now() where org_id = $1`, [orgA, ownerA2]);
    const moved = (await cL.query(`select user_id from tenant_primary_owners where org_id = $1`, [orgA])).rows[0].user_id;
    await cL.query("rollback");
    ok("a transfer to another active owner of the same company is accepted (rolled back here)", moved === ownerA2);
    await rejects("deleting the mapped user rejected (RESTRICT)", () => cL.query(`delete from users where id = $1`, [ownerA]), FK);
    await rejects("deleting the company rejected (RESTRICT — the users cascade stops at the mapping)", () => cL.query(`delete from orgs where id = $1`, [orgA]), FK);
    // Known limitation (decision O-3, PO-03): the existing customer team screen can still demote or disable the mapped
    // owner — a users-side trigger now would turn that screen's action into a 500. The drift check R02 detects it.
    await cL.query("begin");
    await cL.query(`update users set role = 'admin' where id = $1`, [ownerA]);
    const drift = (await cL.query(`select count(*)::int as n from tenant_primary_owners p join users u on u.id = p.user_id where u.role <> 'owner' or not u.is_active`)).rows[0].n;
    await cL.query("rollback");
    ok("KNOWN LIMITATION (O-3): demoting the mapped owner through users is not blocked yet — and the drift query sees it (rolled back here)", drift === 1);

    section("8. F6 tenant_subscriptions — one current, published versions only, Trial rules, immutable snapshots, no automatic suspension");
    const sub = (o: Record<string, unknown> = {}) => {
      const v = { org: orgB, version: trialV1, state: "published", is_trial: true, cycle: "trial", life: "trialing", start: "2026-11-01", end: "2026-11-07", price: "0", seats: 3, storage: 1, modules: '["Fixture Module"]', note: null, source: "invitation_acceptance", by: null, ...o };
      return cL.query(
        `insert into tenant_subscriptions (org_id, package_version_id, version_state, is_trial, cycle, lifecycle_state, start_date, end_date, price_snapshot_sar, seats_snapshot, storage_snapshot_gb, module_groups_snapshot, manual_note, assignment_source, created_by_platform_admin_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15) returning id`,
        [v.org, v.version, v.state, v.is_trial, v.cycle, v.life, v.start, v.end, v.price, v.seats, v.storage, v.modules, v.note, v.source, v.by],
      );
    };
    await rejects("a DRAFT version cannot be assigned (published-only foreign key)", () => sub({ version: draftV3, is_trial: false, cycle: "monthly", life: "active", price: "10", source: "platform_assignment", by: fx.admin }), FK);
    await rejects("version_state other than 'published' rejected", () => sub({ state: "draft" }), CHECK);
    await rejects("a Trial version on a monthly cycle rejected", () => sub({ cycle: "monthly" }), CHECK);
    await rejects("a paid version flagged as Trial rejected (foreign key carries Trial-ness)", () => sub({ version: paidV1 }), FK);
    await rejects("'active' on a Trial rejected (a Trial is trialing)", () => sub({ life: "active" }), CHECK);
    await rejects("'trialing' on a paid cycle rejected", () => sub({ version: paidV1, is_trial: false, cycle: "monthly", life: "trialing", price: "10", source: "platform_assignment", by: fx.admin }), CHECK);
    await rejects("lifecycle 'expired' rejected (expiry is derived from end_date, never stored)", () => sub({ life: "expired" }), CHECK);
    await rejects("end before start rejected", () => sub({ start: "2026-11-07", end: "2026-11-01" }), CHECK);
    await rejects("a Trial with a price rejected", () => sub({ price: "0.01" }), CHECK);
    await rejects("0 seats rejected", () => sub({ seats: 0 }), CHECK);
    await rejects("modules snapshot not an array rejected", () => sub({ modules: '{"x":1}' }), CHECK);
    await rejects("an untrimmed note rejected", () => sub({ note: " note " }), CHECK);
    await rejects("an unknown source rejected", () => sub({ source: "self_signup" }), CHECK);
    await rejects("a platform assignment without its operator rejected (attribution)", () => sub({ source: "platform_assignment" }), CHECK);
    const subB = (await sub()).rows[0].id as string;
    ok("an invitation-acceptance Trial (no operator; fictional dates in the past) inserts", !!subB);
    await rejects("a second CURRENT subscription for the company rejected", () => sub(), UNIQUE);
    const accessAfter = (await cL.query(`select count(*)::int as n from tenant_access_controls where org_id = $1`, [orgB])).rows[0].n;
    const fnTouchesAccess = (await cL.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('subscription_package_version_guard','tenant_primary_owner_guard','tenant_subscription_guard') and p.prosrc ilike '%tenant_access_controls%'`)).rows[0].n;
    ok("an EXPIRED subscription (end_date in the past) suspends nothing: no access row was written, and no onboarding function names the access table", accessAfter === 0 && fnTouchesAccess === 0, `access rows ${accessAfter}, functions ${fnTouchesAccess}`);
    await cL.query(`update tenant_subscriptions set end_date = '2026-11-30', lifecycle_state = 'paused', manual_note = 'Fixture note', updated_at = now() where id = $1`, [subB]);
    ok("end_date, lifecycle state, note and updated_at may change (renew / pause)", (await cL.query(`select end_date::text as e, lifecycle_state as l from tenant_subscriptions where id = $1`, [subB])).rows[0].e === "2026-11-30");
    for (const [label, set] of [["price snapshot", "price_snapshot_sar = 1"], ["seats snapshot", "seats_snapshot = 99"], ["modules snapshot", `module_groups_snapshot = '["Other"]'::jsonb`], ["start date", "start_date = '2026-10-01'"], ["package version", `package_version_id = '${paidV1}'`], ["source", "assignment_source = 'platform_assignment'"]] as const)
      await rejects(`the ${label} is immutable (guard)`, () => cL.query(`update tenant_subscriptions set ${set} where id = $1`, [subB]), RESTRICT);
    await rejects("a subscription cannot be deleted", () => cL.query(`delete from tenant_subscriptions where id = $1`, [subB]), RESTRICT);
    await rejects("…nor the table truncated: a plain TRUNCATE is refused by PostgreSQL (0A000, referenced by subscription_events)", () => cL.query(`truncate tenant_subscriptions`), state("0A000"));
    await rejects("…and TRUNCATE … CASCADE is refused by the append-only trigger of THIS table", () => cL.query(`truncate tenant_subscriptions cascade`), APPEND_ONLY_ON("tenant_subscriptions"));
    await cL.query(`update tenant_subscriptions set superseded_at = now(), updated_at = now() where id = $1`, [subB]);
    const subB2 = (await sub({ start: "2026-12-01", end: "2026-12-07" })).rows[0].id as string;
    ok("superseding the current row lets the next assignment be current (history kept)", !!subB2 && (await cL.query(`select count(*)::int as n from tenant_subscriptions where org_id = $1`, [orgB])).rows[0].n === 2);
    await rejects("a superseded (historical) row is frozen", () => cL.query(`update tenant_subscriptions set manual_note = 'rewrite' where id = $1`, [subB]), RESTRICT);
    await rejects("a version referenced by a subscription cannot be deleted (guard: published)", () => cL.query(`delete from subscription_package_versions where id = $1`, [trialV1]), RESTRICT);

    section("9. F7 subscription_events — append-only, same-company, attributed, idempotent");
    const ev = (o: Record<string, unknown> = {}) => {
      const v = { sub: subB2, org: orgB, type: "assigned", actor: null, label: "invitee", after: '{"cycle":"trial"}', request: null, ...o };
      return cL.query(`insert into subscription_events (tenant_subscription_id, org_id, event_type, actor_platform_admin_id, actor_label, after_safe, request_id) values ($1, $2, $3, $4, $5, $6::jsonb, $7) returning id`, [v.sub, v.org, v.type, v.actor, v.label, v.after, v.request]);
    };
    await rejects("an event on another company's subscription rejected (composite foreign key)", () => ev({ org: orgA }), FK);
    await rejects("an actor-less event other than the invitee's 'assigned' rejected", () => ev({ type: "renewed" }), CHECK);
    await rejects("an actor-less 'assigned' event with another label rejected", () => ev({ label: "system" }), CHECK);
    await rejects("an unknown event type rejected", () => ev({ type: "expired", actor: fx.admin, label: "Fictional Operator" }), CHECK);
    await rejects("a non-object snapshot rejected", () => ev({ after: "[1]" }), CHECK);
    await rejects("supplying an id rejected (GENERATED ALWAYS)", () => cL.query(`insert into subscription_events (id, tenant_subscription_id, org_id, event_type, actor_label) values (1, $1, $2, 'assigned', 'invitee')`, [subB2, orgB]), (e) => sqlState(e) === "428C9");
    const request = "8d6a1a0e-0000-4000-8000-0000000d1a01";
    const evId = (await ev({ request })).rows[0].id;
    ok("the invitee's actor-less 'assigned' event inserts", Number(evId) >= 1);
    await rejects("the same (subscription, request, type) again rejected (idempotent retry)", () => ev({ request }), UNIQUE);
    await ev({ request, type: "renewed", actor: fx.admin, label: "Fictional Operator" });
    ok("the same request id for another event type is allowed", true);
    await rejects("UPDATE rejected (append-only)", () => cL.query(`update subscription_events set reason = 'tamper' where id = $1`, [evId]), APPEND_ONLY_ON("subscription_events"));
    await rejects("DELETE rejected (append-only)", () => cL.query(`delete from subscription_events where id = $1`, [evId]), APPEND_ONLY_ON("subscription_events"));
    await rejects("TRUNCATE rejected (append-only)", () => cL.query(`truncate subscription_events`), APPEND_ONLY_ON("subscription_events"));

    section("10. F8 organization_invitation_terms — published versions only, immutable, 1:1 with the PO-02A invitation");
    const inv = (await cL.query(
      `insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, invited_by_platform_admin_id)
       values ('Fixture Terms Co', 'hello@terms.fixture.test', 'Saudi Arabia', 'SAR', 'Terms Owner', 'terms.owner@fixture.test', $1, $2) returning id`, [newTokenHash(), fx.admin])).rows[0].id as string;
    const terms = (o: Record<string, unknown> = {}) => {
      const v = { inv, version: trialV1, state: "published", trial: true, cycle: "trial", ...o };
      return cL.query(`insert into organization_invitation_terms (invitation_id, initial_package_version_id, initial_version_state, initial_is_trial, initial_cycle) values ($1, $2, $3, $4, $5)`, [v.inv, v.version, v.state, v.trial, v.cycle]);
    };
    await rejects("a DRAFT version rejected (published-only foreign key)", () => terms({ version: draftV3, trial: false, cycle: "monthly" }), FK);
    await rejects("an initial state other than 'published' rejected", () => terms({ state: "draft" }), CHECK);
    await rejects("a Trial version on a monthly cycle rejected", () => terms({ cycle: "monthly" }), CHECK);
    await rejects("an unknown invitation rejected", () => terms({ inv: "00000000-0000-4000-8000-000000000000" }), FK);
    await terms();
    ok("terms for the fictional invitation insert (published fictional Trial, trial cycle)", true);
    await rejects("a second terms row for the same invitation rejected (1:1)", () => terms(), UNIQUE);
    await rejects("UPDATE rejected (immutable)", () => cL.query(`update organization_invitation_terms set initial_cycle = 'trial' where invitation_id = $1`, [inv]), APPEND_ONLY_ON("organization_invitation_terms"));
    await rejects("DELETE rejected (immutable)", () => cL.query(`delete from organization_invitation_terms where invitation_id = $1`, [inv]), APPEND_ONLY_ON("organization_invitation_terms"));
    await rejects("TRUNCATE rejected (immutable)", () => cL.query(`truncate organization_invitation_terms`), APPEND_ONLY_ON("organization_invitation_terms"));
    await rejects("deleting the invitation that has terms rejected (RESTRICT)", () => cL.query(`delete from organization_invitations where id = $1`, [inv]), FK);

    section("11. Missing-trigger detection (platform:db:check / platform:db:apply fail closed)");
    const findings = async () => (await checkOnboardingFoundation(cP)).findings;
    await cP.query(`alter table subscription_events disable trigger subscription_events_immutable`);
    let f = await findings();
    ok("a DISABLED trigger is reported", f.some((x) => /subscription_events_immutable is not enabled/.test(x)), f.join("; "));
    await cP.query(`alter table subscription_events enable trigger subscription_events_immutable`);
    await cP.query(`drop trigger tenant_subscriptions_guard on tenant_subscriptions`);
    f = await findings();
    ok("a MISSING trigger is reported", f.some((x) => /missing trigger tenant_subscriptions\.tenant_subscriptions_guard/.test(x)), f.join("; "));
    await cP.query(`create trigger tenant_subscriptions_guard before update on tenant_subscriptions for each row execute function tenant_subscription_guard()`);
    f = await findings();
    ok("a trigger re-created with fewer events (no DELETE) is reported as different", f.some((x) => /tenant_subscriptions_guard differs/.test(x)), f.join("; "));
    await cP.query(`drop trigger tenant_subscriptions_guard on tenant_subscriptions; create trigger tenant_subscriptions_guard before update or delete on tenant_subscriptions for each row execute function tenant_subscription_guard()`);
    await cP.query(`create function po02d1_test_only_noop() returns trigger language plpgsql as $$ begin return new; end $$; create trigger po02d1_test_only_extra before insert on platform_settings for each row execute function po02d1_test_only_noop()`);
    f = await findings();
    ok("an EXTRA trigger on an onboarding table is reported", f.some((x) => /unexpected trigger platform_settings\.po02d1_test_only_extra/.test(x)), f.join("; "));
    await cP.query(`drop trigger po02d1_test_only_extra on platform_settings; drop function po02d1_test_only_noop()`);
    await cP.query(`alter function tenant_primary_owner_guard() security definer`);
    f = await findings();
    ok("a guard function switched to SECURITY DEFINER is reported", f.some((x) => /tenant_primary_owner_guard\(\) is SECURITY DEFINER/.test(x)), f.join("; "));
    await cP.query(`alter function tenant_primary_owner_guard() security invoker`);
    ok("…restored, the check is clean again", (await checkOnboardingFoundation(cP)).ok);

    section("12. Static: schema only — no feature code, flag, seed or invitation path");
    const ROOT = process.cwd();
    const files: string[] = [];
    const walk = (d: string) => { for (const fl of readdirSync(join(ROOT, d))) { const p = join(d, fl); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p)) files.push(p); } };
    walk("src");
    const src = (fl: string) => readFileSync(join(ROOT, fl), "utf8");
    const refs = files.filter((fl) => /platformSettingsTable|subscriptionPackagesTable|subscriptionPackageVersionsTable|tenantPrimaryOwnersTable|tenantSubscriptionsTable|subscriptionEventsTable|organizationInvitationTermsTable|platform_settings|subscription_packages|subscription_package_versions|tenant_primary_owners|tenant_subscriptions|subscription_events|organization_invitation_terms/.test(src(fl)));
    // PO-02D2: the invitation read model and service read the published default Trial (packages, versions) and write the
    // invitation terms; nothing else reads or writes an onboarding table, and nothing names settings, subscriptions,
    // subscription events or primary owners.
    // PO-02D3: plus the acceptance core (src/lib/platform/invitation-acceptance.ts) — it reads the invitation's terms and the
    // published version they name, and writes ONE primary owner, ONE Trial subscription and ONE subscription event for the
    // new company (verify:platform-boundary rule 45); it never names platform settings.
    ok("no application code reads or writes the onboarding tables — only the schema module declares them, (PO-02D2) the invitation read model and service use the Trial catalog and the invitation terms, and (PO-02D3) the acceptance core assigns the Trial",
      JSON.stringify(refs.sort()) === JSON.stringify(["src/db/schema/platform-onboarding.ts", "src/lib/platform/invitation-acceptance.ts", "src/lib/platform/invitation-actions.ts", "src/lib/platform/invitations.ts"]) &&
        ["src/lib/platform/invitation-actions.ts", "src/lib/platform/invitations.ts"].every((fl) => !/platformSettingsTable|tenantPrimaryOwnersTable|tenantSubscriptionsTable|subscriptionEventsTable|platform_settings|tenant_primary_owners|tenant_subscriptions|subscription_events/.test(stripComments(src(fl)))) &&
        !/platformSettingsTable|platform_settings/.test(stripComments(src("src/lib/platform/invitation-acceptance.ts"))) &&
        ["tenantPrimaryOwnersTable", "tenantSubscriptionsTable", "subscriptionEventsTable"].every((tb) => (stripComments(src("src/lib/platform/invitation-acceptance.ts")).match(new RegExp(`\\.insert\\(${tb}\\)`, "g")) ?? []).length === 1) &&
        !/\.(update|delete)\((tenantPrimaryOwnersTable|tenantSubscriptionsTable|subscriptionEventsTable|subscriptionPackagesTable|subscriptionPackageVersionsTable|organizationInvitationTermsTable)\)/.test(stripComments(src("src/lib/platform/invitation-acceptance.ts"))),
      refs.join(", "));
    // PO-02D2: PLATFORM_INVITATIONS_ENABLED exists — read (comments aside) only in src/lib/platform/flags.ts; the acceptance
    // flag still appears nowhere.
    // PO-02D3: CUSTOMER_INVITE_ACCEPTANCE_ENABLED now exists too — read (comments aside) only in src/lib/platform/flags.ts.
    const acceptanceFlag = files.filter((fl) => /CUSTOMER_INVITE_ACCEPTANCE_ENABLED/.test(stripComments(src(fl))));
    const invitationFlag = files.filter((fl) => /PLATFORM_INVITATIONS_ENABLED/.test(stripComments(src(fl))));
    ok("(PO-02D3) the acceptance flag CUSTOMER_INVITE_ACCEPTANCE_ENABLED is read only in src/lib/platform/flags.ts; (PO-02D2) PLATFORM_INVITATIONS_ENABLED is read only in src/lib/platform/flags.ts", JSON.stringify(acceptanceFlag) === JSON.stringify(["src/lib/platform/flags.ts"]) && JSON.stringify(invitationFlag) === JSON.stringify(["src/lib/platform/flags.ts"]), [...acceptanceFlag, ...invitationFlag].join(", "));
    const inviteOnly = files.filter((fl) => /invite_only|inviteOnly/.test(stripComments(src(fl)))).sort();
    ok(
      "invite-only appears in code only as PO-01B's existing read-only Settings label (no column, no setting, no logic)",
      JSON.stringify(inviteOnly) === JSON.stringify(["src/app/(platform)/platform/(console)/settings/page.tsx", "src/components/platform/i18n.ts"]),
      inviteOnly.join(", "),
    );
    const sqlDir = readdirSync(join(ROOT, "drizzle", "platform")).sort();
    ok("drizzle/platform holds the four PO-02D1 files, none of them a seed (PO-02D1B's two seed files are boundary rules 41 and 43)", JSON.stringify(sqlDir.filter((x) => x.startsWith("PO02D1_"))) === JSON.stringify(["PO02D1_onboarding_foundation.sql", "PO02D1_rollback.sql", "PO02D1_users_org_id_id_concurrently.sql", "PO02D1_users_org_id_id_drop.sql"]), sqlDir.join(","));
    const foundation = readFileSync(join(ROOT, "drizzle/platform/PO02D1_onboarding_foundation.sql"), "utf8");
    ok("the foundation file writes no row (no INSERT, UPDATE or DELETE statement) and contains no psql meta-command", !/^\s*(INSERT|UPDATE|DELETE)\b/im.test(foundation) && !/^\\/m.test(foundation));
    ok("every PO-02D1 SQL file says it is NOT authorized for production execution",
      ["PO02D1_onboarding_foundation.sql", "PO02D1_rollback.sql", "PO02D1_users_org_id_id_concurrently.sql", "PO02D1_users_org_id_id_drop.sql"].every((x) => /NOT AUTHORIZED FOR PRODUCTION EXECUTION/.test(readFileSync(join(ROOT, "drizzle/platform", x), "utf8"))));
  } finally {
    await cL.end().catch(() => undefined);
    await cP.end().catch(() => undefined);
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-onboarding-schema");
} catch (e) {
  console.error(`verify:platform-onboarding-schema aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  if (!keep) for (const name of created) await dropDisposableDatabase(name).catch(() => undefined);
}
process.exit(exitCode);
