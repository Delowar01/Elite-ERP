/**
 * Platform Owner PO-02A — company database foundation: schema equivalence, the single tenant change,
 * constraints (M2 tenant_access_controls, M3 organization_invitations), the compatibility rule and
 * platform-audit integrity.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run verify:platform-company-schema
 *
 * Disposable loopback `*_test_only_*` databases only (local-db-guard); fictional data; every
 * database created here is dropped at the end (PLATFORM_TEST_KEEP_DATABASES=1 keeps them).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import {
  connectDisposable,
  createDisposableDatabase,
  disposableName,
  dropDisposableDatabase,
  pushSchema,
  pushPreCompanyTenantSchema,
  applyPlatformMigration,
  databaseUrlFor,
} from "../scripts/platform/disposable-db";
import { projectCatalog, diffProjection, checkPlatformObjects, checkCompanyFoundation, PLATFORM_SQL_PATH, PO02A_SQL_PATH } from "../scripts/platform/catalog";
import { section, ok, rejects, sqlState, summary, describeError } from "./platform/harness";
import {
  PO02A_CONSTRAINTS,
  PO02A_INDEX_DEFS,
  PO02A_TABLES,
  M4_PROJECTION_LINE,
  insertFixtures,
  tableChecksums,
  diffChecksums,
  runPo02a,
  newTokenHash,
} from "./platform/po02a-fixtures";

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
const APPEND_ONLY = (e: unknown) => sqlState(e) === "P0001" && /append-only/.test(String((e as Error).message));

async function main(): Promise<void> {
  section("1. Build: the pre-PO-02A shape with tenant data, then the reviewed PO-02A SQL; and a full Drizzle push");
  const L = await newDb("po02a_schema_l");
  ok("L: pre-PO-02A tenant schema (621f156 shape) pushed", (await pushPreCompanyTenantSchema(L.url)).ok);
  await applyPlatformMigration(L.url, [PLATFORM_SQL_PATH]);
  const cL = await connectDisposable(L.url);
  cL.on("error", () => undefined);
  const P = await newDb("po02a_schema_p");
  ok("P: full Drizzle schema pushed", pushSchema(P.url, "full").ok);
  await applyPlatformMigration(P.url);
  const cP = await connectDisposable(P.url);
  cP.on("error", () => undefined);
  try {
    const fx = await insertFixtures(cL);
    const L0 = await projectCatalog(cL);
    const tenantTables = L0.other.tables;
    const data0 = await tableChecksums(cL, [...tenantTables, ...L0.platform.tables]);
    ok("L before PO-02A: none of its objects exist", L0.platform.tables.every((t) => !(PO02A_TABLES as readonly string[]).includes(t)) && !L0.other.indexes.some((l) => l.includes("sessions_org_active_idx")) && !L0.platform.indexes.some((l) => l.includes("platform_audit_events_entity_idx")));
    const steps = await runPo02a(cL);
    ok("first application creates M2, M3, M4 and the audit index", JSON.stringify(steps) === JSON.stringify(["M2 tenant_access_controls: created", "M3 organization_invitations: created", "M4 sessions_org_active_idx: created", "audit platform_audit_events_entity_idx: created"]), steps.join(" · "));
    const L1 = await projectCatalog(cL);
    const PP = await projectCatalog(cP);

    section("2. Reviewed SQL ≡ Drizzle schema (src/db/schema/platform-companies.ts, security.ts M4, platform.ts audit index)");
    const dPlat = diffProjection(PP.platform, L1.platform, "full-drizzle-push+sql", "pre-PO-02A+reviewed-sql");
    ok("platform-owned projection identical (tables, columns, defaults, constraints, indexes, triggers, functions, sequences)", dPlat.length === 0, dPlat.slice(0, 6).join("\n        "));
    const dOther = diffProjection(PP.other, L1.other, "full-drizzle-push+sql", "pre-PO-02A+reviewed-sql");
    ok("every tenant object identical too — the M4 index included", dOther.length === 0, dOther.slice(0, 6).join("\n        "));
    const conNames = L1.platform.constraints.map((l) => l.split(" | ")).filter((p) => (PO02A_TABLES as readonly string[]).includes(p[0])).map((p) => p[1]).sort();
    ok(`exactly the ${PO02A_CONSTRAINTS.length} reviewed PO-02A constraints exist (names pinned)`, JSON.stringify(conNames) === JSON.stringify([...PO02A_CONSTRAINTS].sort()), conNames.join(","));
    const idxDefs = Object.fromEntries([...L1.platform.indexes, ...L1.other.indexes].map((l) => l.split(" | ")).map((p) => [p[1], p[2]]));
    const idxBad = Object.entries(PO02A_INDEX_DEFS).filter(([n, def]) => idxDefs[n] !== def);
    ok(`all ${Object.keys(PO02A_INDEX_DEFS).length} PO-02A indexes exist with exactly the reviewed definitions`, idxBad.length === 0, idxBad.map(([n]) => `${n}: ${idxDefs[n]}`).join("; "));
    const cols = L1.platform.columns.filter((l) => (PO02A_TABLES as readonly string[]).includes(l.split(" | ")[0])).map((l) => l.split(" | ").slice(0, 3).join("."));
    ok(
      "columns: tenant_access_controls 7, organization_invitations 17 — no plaintext token, link or URL column",
      cols.filter((c) => c.startsWith("tenant_access_controls")).length === 7 && cols.filter((c) => c.startsWith("organization_invitations")).length === 17 && !cols.some((c) => /\.(token|link|url|invite_url|raw_token)$/.test(c)),
      cols.join(","),
    );
    ok("timestamps are timestamptz; expires_at defaults to now() + 72 h", L1.platform.columns.some((l) => /^organization_invitations \| 10 \| expires_at \| timestamp with time zone \| not null \| \(now\(\) \+ '72:00:00'::interval\)/.test(l)));
    ok("both platform checks report the PO-02A objects present and valid", (await checkPlatformObjects(cL)).ok && (await checkCompanyFoundation(cL)).ok);

    section("3. The single tenant change, and no data change anywhere");
    const tenantDiff = diffProjection(L0.other, L1.other, "before", "after");
    ok("the ONLY tenant-schema difference is the additive M4 index on sessions", tenantDiff.length === 1 && tenantDiff[0] === `indexes: only in after: ${M4_PROJECTION_LINE}`, tenantDiff.join("\n        "));
    const platDiff = diffProjection(L0.platform, L1.platform, "before", "after");
    ok(
      "PO-01A objects untouched: every platform-side difference is a PO-02A table, its column/constraint/index, or the audit entity index",
      platDiff.every((l) => /only in after: /.test(l) && (/(tenant_access_controls|organization_invitations)/.test(l) || l.includes("platform_audit_events_entity_idx"))),
      platDiff.filter((l) => !/(tenant_access_controls|organization_invitations|platform_audit_events_entity_idx)/.test(l)).join("\n        "),
    );
    const data1 = await tableChecksums(cL, [...tenantTables, ...L0.platform.tables]);
    ok(`data of all ${tenantTables.length} tenant tables and the PO-01A tables byte-identical (fixtures included)`, diffChecksums(data0, data1).length === 0, diffChecksums(data0, data1).join(","));
    const counts = (await cL.query(`select (select count(*) from tenant_access_controls)::int as a, (select count(*) from organization_invitations)::int as i`)).rows[0];
    ok("no company was backfilled, suspended or invited: both new tables are empty", counts.a === 0 && counts.i === 0, JSON.stringify(counts));

    section("4. The platform audit trail is still append-only");
    const audit = (await cL.query(`insert into platform_audit_events (actor_platform_admin_id, actor_label, action, entity_type, entity_id, result) values ($1, 'Fictional Operator', 'company.viewed', 'organization', $2, 'success') returning id`, [fx.admin, String(fx.orgs[0])])).rows[0].id;
    await rejects("UPDATE rejected", () => cL.query(`update platform_audit_events set reason = 'tamper' where id = $1`, [audit]), APPEND_ONLY);
    await rejects("DELETE rejected", () => cL.query(`delete from platform_audit_events where id = $1`, [audit]), APPEND_ONLY);
    await rejects("TRUNCATE rejected", () => cL.query(`truncate platform_audit_events`), APPEND_ONLY);
    await cL.query("set enable_seqscan = off");
    const plan2 = JSON.stringify((await cL.query(`explain (format json) select id from platform_audit_events where entity_type = 'organization' and entity_id = '1' order by created_at desc`)).rows[0]["QUERY PLAN"]);
    const plan3 = JSON.stringify((await cL.query(`explain (format json) update sessions set revoked_at = now() where org_id = ${Number(fx.orgs[0])} and revoked_at is null`)).rows[0]["QUERY PLAN"]);
    await cL.query("reset enable_seqscan");
    ok("an audit lookup by entity can use platform_audit_events_entity_idx (planner, seq scans disabled)", plan2.includes("platform_audit_events_entity_idx"), plan2.slice(0, 200));
    ok("M4: an org-wide revocation of live sessions can use sessions_org_active_idx", plan3.includes("sessions_org_active_idx"), plan3.slice(0, 200));

    section("5. M2 tenant_access_controls — FK, one row per company, status, attribution, reason, timestamps");
    const tac = (org: number, o: { status?: string | null; reason?: string | null; by?: string | null; at?: string | null; created?: string; updated?: string } = {}) =>
      cL.query(
        `insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at, created_at, updated_at)
         values ($1, coalesce($2, 'active'), $3, $4, $5::timestamptz, coalesce($6::timestamptz, now()), coalesce($7::timestamptz, now()))`,
        [org, o.status === undefined ? null : o.status, o.reason ?? null, o.by ?? null, o.at ?? null, o.created ?? null, o.updated ?? null],
      );
    // Fixed past timestamps for every attributed row: CHECKs compare values from one clock, so a test
    // must not mix the client's clock (changed_at) with the server's now() (created_at).
    const T0 = "2026-11-01T00:00:00Z";
    const attributed = { by: fx.admin, at: T0, created: T0, updated: T0 };
    await rejects("unknown organization rejected (FK)", () => tac(999_999), FK);
    await cL.query(`insert into tenant_access_controls (org_id) values ($1)`, [fx.orgs[0]]);
    const dflt = (await cL.query(`select access_status, reason, changed_by_platform_admin_id, changed_at from tenant_access_controls where org_id = $1`, [fx.orgs[0]])).rows[0];
    ok("a bare row defaults to active, unattributed", dflt.access_status === "active" && dflt.reason === null && dflt.changed_by_platform_admin_id === null && dflt.changed_at === null, JSON.stringify(dflt));
    await rejects("a second row for the same company rejected (one row per organization)", () => tac(fx.orgs[0]), UNIQUE);
    for (const bad of ["paused", "Active", "SUSPENDED", "", " active", "expired", "deleted"]) await rejects(`status '${bad}' rejected`, () => tac(fx.orgs[1], { status: bad, ...attributed, reason: "Fixture reason" }), CHECK);
    await rejects("status NULL rejected", () => cL.query(`insert into tenant_access_controls (org_id, access_status) values ($1, null)`, [fx.orgs[1]]), NOT_NULL);
    await rejects("suspension without a responsible platform administrator rejected (no automated suspension)", () => tac(fx.orgs[1], { status: "suspended", reason: "Expired subscription", created: T0, updated: T0 }), CHECK);
    await rejects("attribution without a time rejected", () => tac(fx.orgs[1], { status: "suspended", by: fx.admin, reason: "Fixture reason", created: T0, updated: T0 }), CHECK);
    await rejects("a time without attribution rejected", () => tac(fx.orgs[1], { status: "active", at: T0, reason: "Fixture reason", created: T0, updated: T0 }), CHECK);
    await rejects("an attributed change without a reason rejected (suspension)", () => tac(fx.orgs[1], { status: "suspended", ...attributed }), CHECK);
    await rejects("an attributed change without a reason rejected (reactivation)", () => tac(fx.orgs[1], { status: "active", ...attributed }), CHECK);
    for (const bad of ["", " padded reason", "padded reason ", "x".repeat(1001)]) await rejects(`reason ${JSON.stringify(bad.slice(0, 16))}${bad.length > 16 ? "…" : ""} rejected`, () => tac(fx.orgs[1], { status: "suspended", ...attributed, reason: bad }), CHECK);
    await rejects("unknown administrator rejected (FK)", () => tac(fx.orgs[1], { status: "suspended", ...attributed, by: "00000000-0000-4000-8000-000000000000", reason: "Fixture reason" }), FK);
    await rejects("updated_at before created_at rejected", () => tac(fx.orgs[1], { created: "2026-11-10T10:00:00Z", updated: "2026-11-10T09:59:59Z" }), CHECK);
    await rejects("changed_at before created_at rejected", () => tac(fx.orgs[1], { status: "suspended", by: fx.admin, reason: "Fixture reason", created: "2026-11-10T10:00:00Z", updated: "2026-11-10T10:00:00Z", at: "2026-11-10T09:00:00Z" }), CHECK);
    const suspended = await tac(fx.orgs[1], { status: "suspended", by: fx.admin, at: "2026-11-10T10:00:00Z", reason: "Fixture: unpaid invoice dispute", created: "2026-11-10T10:00:00Z", updated: "2026-11-10T10:00:00Z" });
    ok("a fully attributed suspension inserts (fixture only — PO-02C implements the action)", suspended.rowCount === 1);
    await cL.query(`update tenant_access_controls set access_status = 'active', reason = 'Fixture: dispute resolved', changed_by_platform_admin_id = $2, changed_at = '2026-11-10T11:00:00Z', updated_at = '2026-11-10T11:00:00Z' where org_id = $1`, [fx.orgs[1], fx.admin2]);
    ok("an attributed reactivation with its reason updates", (await cL.query(`select access_status from tenant_access_controls where org_id = $1`, [fx.orgs[1]])).rows[0].access_status === "active");
    await rejects("deleting a company that has an access row is restricted", () => cL.query(`delete from orgs where id = $1`, [fx.orgs[1]]), FK);
    await rejects("deleting a referenced platform administrator is restricted", () => cL.query(`delete from platform_admins where id = $1`, [fx.admin2]), FK);

    section("6. M3 organization_invitations — hashed tokens, normalization, uniqueness, lifecycle, FKs");
    type Inv = Partial<Record<"company" | "industry" | "companyEmail" | "country" | "currency" | "owner" | "ownerEmail" | "token" | "expires" | "acceptedAt" | "acceptedOrg" | "revokedAt" | "revokedBy" | "by" | "created", unknown>>;
    const inv = (o: Inv = {}) =>
      cL.query(
        `insert into organization_invitations (company_name, industry, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash,
           expires_at, accepted_at, accepted_org_id, revoked_at, revoked_by_platform_admin_id, invited_by_platform_admin_id, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::timestamptz, coalesce($15::timestamptz, now()) + interval '72 hours'), $10::timestamptz, $11, $12::timestamptz, $13, $14,
           coalesce($15::timestamptz, now()), coalesce($15::timestamptz, now())) returning id`,
        [
          o.company ?? "Invited Fixture Co", o.industry === undefined ? "Trading" : o.industry, o.companyEmail ?? "accounts@invited-fixture.test", o.country ?? "Saudi Arabia",
          o.currency ?? "SAR", o.owner ?? "Invited Owner", o.ownerEmail ?? "new-owner@invited-fixture.test", o.token ?? newTokenHash(), o.expires ?? null, o.acceptedAt ?? null,
          o.acceptedOrg ?? null, o.revokedAt ?? null, o.revokedBy ?? null, o.by === undefined ? fx.admin : o.by, o.created ?? null,
        ],
      );
    const first = (await inv()).rows[0].id as string;
    ok("a valid pending invitation inserts (UUID id)", /^[0-9a-f-]{36}$/.test(first));
    const d72 = (await cL.query(`insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, invited_by_platform_admin_id)
      values ('Default Expiry Co', 'ops@default-expiry.test', 'Saudi Arabia', 'SAR', 'Default Owner', 'default-owner@default-expiry.test', $1, $2) returning expires_at - created_at as ttl`, [newTokenHash(), fx.admin])).rows[0].ttl;
    ok("expires_at defaults to exactly 72 hours after creation", JSON.stringify(d72) === JSON.stringify({ days: 3 }) || JSON.stringify(d72) === JSON.stringify({ hours: 72 }), JSON.stringify(d72));
    await rejects("plaintext token (not a SHA-256 hex digest) rejected", () => inv({ token: "Kx9fJ2-plain-invitation-token-value", ownerEmail: "p1@invited-fixture.test" }), CHECK);
    await rejects("uppercase hex digest rejected (one canonical form)", () => inv({ token: newTokenHash().toUpperCase(), ownerEmail: "p2@invited-fixture.test" }), CHECK);
    await rejects("a full invitation link rejected", () => inv({ token: "https://erp.example.test/invite/abc", ownerEmail: "p3@invited-fixture.test" }), CHECK);
    const dupToken = newTokenHash();
    await inv({ token: dupToken, ownerEmail: "p4@invited-fixture.test" });
    await rejects("duplicate token hash rejected", () => inv({ token: dupToken, ownerEmail: "p5@invited-fixture.test" }), UNIQUE);
    for (const bad of ["New-Owner@Invited-Fixture.test", " new2@invited-fixture.test", "new3@invited-fixture.test ", "no-at-sign.invited-fixture.test", "a@b", "two@@invited-fixture.test", "sp ace@invited-fixture.test"]) {
      await rejects(`owner e-mail ${JSON.stringify(bad)} rejected (normalized lowercase/trim + shape)`, () => inv({ ownerEmail: bad }), CHECK);
    }
    await rejects("non-normalized company e-mail rejected", () => inv({ companyEmail: "Accounts@Invited-Fixture.test", ownerEmail: "p6@invited-fixture.test" }), CHECK);
    await rejects(`owner e-mail over 320 characters rejected`, () => inv({ ownerEmail: `${"a".repeat(310)}@invited-fixture.test` }), CHECK);
    for (const [label, o] of [
      ["currency 'sar'", { currency: "sar" }], ["currency 'SA'", { currency: "SA" }], ["currency 'SARX'", { currency: "SARX" }],
      ["empty country", { country: "" }], ["padded country", { country: " Saudi Arabia" }], ["one-letter country", { country: "S" }],
      ["empty company name", { company: "" }], ["padded company name", { company: "Co " }], ["201-char company name", { company: "c".repeat(201) }],
      ["empty owner name", { owner: "" }], ["empty industry (use NULL)", { industry: "" }],
    ] as [string, Inv][]) {
      await rejects(`${label} rejected`, () => inv({ ...o, ownerEmail: `${label.replace(/[^a-z0-9]/gi, "").toLowerCase()}@invited-fixture.test` }), CHECK);
    }
    ok("industry is optional (NULL accepted)", (await inv({ industry: null, ownerEmail: "no-industry@invited-fixture.test" })).rowCount === 1);
    await rejects("a second PENDING invitation for the same owner e-mail rejected", () => inv(), UNIQUE);
    await rejects("…even when the first is past its expiry: re-issue must revoke it first", async () => {
      await inv({ ownerEmail: "expired-owner@invited-fixture.test", created: "2026-10-01T00:00:00Z", expires: "2026-10-04T00:00:00Z" });
      await inv({ ownerEmail: "expired-owner@invited-fixture.test" });
    }, UNIQUE);
    await cL.query(`update organization_invitations set revoked_at = now(), revoked_by_platform_admin_id = $1, updated_at = now() where owner_email_normalized = 'expired-owner@invited-fixture.test'`, [fx.admin]);
    ok("after revoking it, a new invitation for that e-mail inserts (re-issue = revoke + insert)", (await inv({ ownerEmail: "expired-owner@invited-fixture.test" })).rowCount === 1);
    await rejects("revocation without the responsible administrator rejected", () => cL.query(`update organization_invitations set revoked_at = now() where id = $1`, [first]), CHECK);
    await rejects("revocation by an unknown administrator rejected (FK)", () => cL.query(`update organization_invitations set revoked_at = now(), revoked_by_platform_admin_id = '00000000-0000-4000-8000-000000000000' where id = $1`, [first]), FK);
    await rejects("acceptance without the created organization rejected", () => cL.query(`update organization_invitations set accepted_at = now() where id = $1`, [first]), CHECK);
    await rejects("an organization without acceptance time rejected", () => cL.query(`update organization_invitations set accepted_org_id = $2 where id = $1`, [first, fx.orgs[2]]), CHECK);
    await rejects("accepting into an unknown organization rejected (FK)", () => cL.query(`update organization_invitations set accepted_at = now(), accepted_org_id = 999999 where id = $1`, [first]), FK);
    const accepted = await cL.query(`update organization_invitations set accepted_at = now(), accepted_org_id = $2, updated_at = now() where id = $1`, [first, fx.orgs[2]]);
    ok("acceptance with its organization records (fixture only — PO-02D implements acceptance)", accepted.rowCount === 1);
    await rejects("accepted AND revoked rejected (exclusive terminal states)", () => cL.query(`update organization_invitations set revoked_at = now(), revoked_by_platform_admin_id = $2 where id = $1`, [first, fx.admin]), CHECK);
    await rejects("a second invitation accepted into the same organization rejected", () => inv({ ownerEmail: "second-accept@invited-fixture.test", created: "2026-11-01T00:00:00Z", expires: "2026-11-04T00:00:00Z", acceptedAt: "2026-11-02T00:00:00Z", acceptedOrg: fx.orgs[2] }), UNIQUE);
    ok("after acceptance, a new pending invitation for that owner e-mail is allowed", (await inv()).rowCount === 1);
    await rejects("accepting after expiry rejected (single use within validity)", () => inv({ ownerEmail: "late@invited-fixture.test", created: "2026-11-01T00:00:00Z", expires: "2026-11-04T00:00:00Z", acceptedAt: "2026-11-04T00:00:01Z", acceptedOrg: fx.orgs[0] }), CHECK);
    await rejects("accepting before creation rejected", () => inv({ ownerEmail: "early@invited-fixture.test", created: "2026-11-01T00:00:00Z", expires: "2026-11-04T00:00:00Z", acceptedAt: "2026-10-31T23:59:59Z", acceptedOrg: fx.orgs[0] }), CHECK);
    await rejects("revoked before creation rejected", () => inv({ ownerEmail: "rev-early@invited-fixture.test", created: "2026-11-01T00:00:00Z", expires: "2026-11-04T00:00:00Z", revokedAt: "2026-10-31T00:00:00Z", revokedBy: fx.admin }), CHECK);
    await rejects("expiry not after creation rejected", () => inv({ ownerEmail: "exp0@invited-fixture.test", created: "2026-11-01T00:00:00Z", expires: "2026-11-01T00:00:00Z" }), CHECK);
    await rejects("expiry beyond the 30-day ceiling rejected", () => inv({ ownerEmail: "exp31@invited-fixture.test", created: "2026-11-01T00:00:00Z", expires: "2026-12-01T00:00:01Z" }), CHECK);
    await rejects("unknown inviting administrator rejected (FK)", () => inv({ ownerEmail: "fk@invited-fixture.test", by: "00000000-0000-4000-8000-000000000000" }), FK);
    await rejects("missing inviting administrator rejected", () => inv({ ownerEmail: "nn@invited-fixture.test", by: null }), NOT_NULL);
    await rejects("deleting a company created from an invitation is restricted", () => cL.query(`delete from orgs where id = $1`, [fx.orgs[2]]), FK);
    ok("no orgs or users row was created by any invitation (orgs unchanged: 3)", (await cL.query(`select count(*)::int as n from orgs`)).rows[0].n === 3);

    section("7. Compatibility rule — src/lib/platform/company-access.ts (missing legacy row ⇒ active; fails closed)");
    process.env.DATABASE_URL = L.url;
    const ca = await import("../src/lib/platform/company-access");
    const { db, pool } = await import("../src/db");
    try {
      const legacy = await ca.getTenantAccess(fx.orgs[2]);
      ok("an organization WITHOUT a row is active (legacy_default)", legacy?.status === "active" && legacy.source === "legacy_default", JSON.stringify(legacy));
      const withActive = await ca.getTenantAccess(fx.orgs[0]);
      ok("an organization with an 'active' row is active (access_control)", withActive?.status === "active" && withActive.source === "access_control", JSON.stringify(withActive));
      await cL.query(`update tenant_access_controls set access_status = 'suspended', reason = 'Fixture: compliance hold', changed_by_platform_admin_id = $2, changed_at = now(), updated_at = now() where org_id = $1`, [fx.orgs[1], fx.admin]);
      const sus = await ca.getTenantAccess(fx.orgs[1]);
      ok("an organization with a 'suspended' row is suspended", sus?.status === "suspended" && sus.source === "access_control", JSON.stringify(sus));
      const unknown = await Promise.all([999_999, 0, -1, Number.NaN, 1.5].map((n) => ca.getTenantAccess(n)));
      ok("an unknown or malformed organization id resolves to null (never to active)", unknown.every((u) => u === null), JSON.stringify(unknown));
      const pure = [ca.resolveTenantAccess(null), ca.resolveTenantAccess(undefined), ca.resolveTenantAccess({ accessStatus: "paused" }), ca.resolveTenantAccess({ accessStatus: "" }), ca.resolveTenantAccess({ accessStatus: null }), ca.resolveTenantAccess({ accessStatus: "ACTIVE" })];
      ok("pure rule: no row → active; any unknown value → suspended (invalid_state)", pure[0].status === "active" && pure[1].status === "active" && pure.slice(2).every((p) => p.status === "suspended" && p.source === "invalid_state"), JSON.stringify(pure));
      const viaSql = (await db.execute(sql`select o.id, ${ca.effectiveTenantAccessSql} as s from orgs o left join tenant_access_controls on tenant_access_controls.org_id = o.id order by o.id`)).rows as { id: number; s: string }[];
      const viaTs = await Promise.all(viaSql.map((r) => ca.getTenantAccess(r.id)));
      ok("the SQL expression and the function agree for every organization", viaSql.length === 3 && viaSql.every((r, i) => r.s === viaTs[i]?.status), JSON.stringify(viaSql));
      // An impossible stored value (CHECK removed inside a rolled-back transaction) fails closed in both forms.
      let drifted: unknown = null;
      let driftedSql: unknown = null;
      await db
        .transaction(async (tx) => {
          await tx.execute(sql`alter table tenant_access_controls drop constraint tenant_access_controls_status_chk`);
          await tx.execute(sql`update tenant_access_controls set access_status = 'paused' where org_id = ${fx.orgs[0]}`);
          drifted = await ca.getTenantAccess(fx.orgs[0], tx);
          driftedSql = (await tx.execute(sql`select ${ca.effectiveTenantAccessSql} as s from orgs o left join tenant_access_controls on tenant_access_controls.org_id = o.id where o.id = ${fx.orgs[0]}`)).rows[0];
          throw new Error("rollback");
        })
        .catch((e) => {
          if ((e as Error).message !== "rollback") throw e;
        });
      ok("a drifted, unknown stored status fails CLOSED (suspended, invalid_state; SQL 'suspended')", (drifted as { status?: string; source?: string } | null)?.status === "suspended" && (drifted as { source?: string }).source === "invalid_state" && (driftedSql as { s?: string }).s === "suspended", JSON.stringify([drifted, driftedSql]));
      ok("…and the constraint is back (that change was rolled back)", (await cL.query(`select count(*)::int as n from pg_constraint where conname = 'tenant_access_controls_status_chk'`)).rows[0].n === 1);
    } finally {
      await pool.end().catch(() => undefined);
    }
    const fnRefs = (await cL.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ilike '%tenant_access_controls%'`)).rows[0].n;
    const trg = (await cL.query(`select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('tenant_access_controls','organization_invitations') and not t.tgisinternal`)).rows[0].n;
    ok("no database function or trigger can change company access on its own (subscription expiry included)", fnRefs === 0 && trg === 0, `functions ${fnRefs}, triggers ${trg}`);

    // PO-02B: the read-only company read model (src/lib/platform/companies.ts) now reads both tables and
    // reuses the compatibility rule; customer auth / session code still references neither (PO-02C).
    section("8. Static: only the schema, the rule and the PO-02B read model touch the new objects; no customer auth/session code does");
    const ROOT = process.cwd();
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(join(ROOT, d))) { const p = join(d, f); if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p)) files.push(p); } };
    walk("src");
    const refs = (re: RegExp) => files.filter((f) => re.test(readFileSync(join(ROOT, f), "utf8")));
    const tableRefs = refs(/tenantAccessControlsTable|organizationInvitationsTable|tenant_access_controls|organization_invitations/);
    ok("only the schema module, the compatibility module and the PO-02B read model reference the new tables", JSON.stringify(tableRefs.sort()) === JSON.stringify(["src/db/schema/platform-companies.ts", "src/lib/platform/companies.ts", "src/lib/platform/company-access.ts"]), tableRefs.join(", "));
    const ruleRefs = refs(/(from\s+|import\(\s*)["'][^"']*platform\/company-access["']/);
    ok("only the PO-02B read model imports the compatibility module — no customer auth/session code (PO-02C wires that, separately approved)", JSON.stringify(ruleRefs) === JSON.stringify(["src/lib/platform/companies.ts"]), ruleRefs.join(", "));
  } finally {
    await cL.end().catch(() => undefined);
    await cP.end().catch(() => undefined);
  }
  void databaseUrlFor;
  void PO02A_SQL_PATH;
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-company-schema");
} catch (e) {
  console.error(`verify:platform-company-schema aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  if (!keep) for (const name of created) await dropDisposableDatabase(name).catch(() => undefined);
}
process.exit(exitCode);
