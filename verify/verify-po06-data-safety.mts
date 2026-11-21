/**
 * Platform Owner PO-06 — data-safety rehearsals for the isolated staging preparation, on real PostgreSQL:
 *
 *   P. the D-7 production-safe READ-ONLY bundle (docs/platform-owner/po06/sql/d7_readonly_production_audit.sql):
 *      static safety rules, its exact answers on fictional data of both shapes, proof that it changes nothing, takes no
 *      lock an application could notice, waits at most 2 s, refuses an outer transaction and leaks no name, address,
 *      hash, MFA secret or raw id;
 *   Q. the users_email_lower_uq proposal (docs/platform-owner/po02d3/proposal/, unchanged) — the PO-06 additions to the
 *      PO-02D3 tests: the real registration and Team writers under the index, concurrent registrations, a race between
 *      non-normalized writers, a failed build and its recovery, the rollback, and the approval gate;
 *   R. an ENCRYPTED backup / restore rehearsal with scripts/backup.sh and scripts/restore.sh as they are: archive,
 *      manifest and checksum, integrity (decrypt + pg_restore --list, a tampered copy refused), restore into a clean
 *      disposable database, schema and data byte-identical, versions, application checks after the restore (catalog,
 *      preflight, seed, field decryption with the same TEST key and refusal with another, password check, append-only
 *      triggers), retention, and unrelated databases unchanged.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   npx tsx --conditions=react-server verify/verify-po06-data-safety.mts
 *
 * Disposable `*_test_only_*` databases, fictional rows, a TEST-only gpg key and TEST-only encryption key generated in a
 * temporary directory and deleted at the end. Nothing is read from or written to any real database.
 */
import { spawn, spawnSync } from "node:child_process";
import { createDecipheriv, createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import type { Client } from "pg";
import { connectDisposable, databaseUrlFor, disposableName, dropDisposableDatabase, pushPreCompanyTenantSchema, withAdmin } from "../scripts/platform/disposable-db";
import { checkCompanyFoundation, checkOnboardingFoundation, checkPlatformObjects, projectCatalog } from "../scripts/platform/catalog";
import { applyManifest, inspect, loadManifest, STAGED_TABLE_PUSH_PLAN, statusOf } from "../scripts/platform/release-manifest";
import { runPreflight } from "../scripts/platform/release-preflight";
import { checkTrialSeed } from "../scripts/platform/trial-seed";
import { describeError, ok, section, sqlState, summary } from "./platform/harness";
import { changedTables, fingerprints, insertProductionFixtures, publicTables, type ProductionFixture } from "./platform/po06-fixtures";

const ROOT = process.cwd();
const m = loadManifest();
const D7 = join(ROOT, "docs/platform-owner/po06/sql/d7_readonly_production_audit.sql");
const EMAIL_PROPOSAL = join(ROOT, "docs/platform-owner/po02d3/proposal/users_email_lower_unique.proposal.sql");
const EMAIL_ROLLBACK = join(ROOT, "docs/platform-owner/po02d3/proposal/users_email_lower_unique_rollback.proposal.sql");
const EMAIL_AUDIT = join(ROOT, "docs/platform-owner/po02d3/sql/users_email_audit_readonly.sql");
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const created: string[] = [];
async function newDb(prefix: string, template: string | null = null) {
  const name = disposableName(prefix);
  await withAdmin((c) => c.query(template ? `create database "${name}" template "${template}"` : `create database "${name}"`));
  created.push(name);
  return { name, url: databaseUrlFor(name) };
}
async function withDb<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await connectDisposable(url);
  c.on("error", () => undefined);
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => undefined);
  }
}
const caught = async (p: Promise<unknown>) => p.then(() => null, (e) => e);
const pgEnv = (url: string): NodeJS.ProcessEnv => {
  const u = new URL(url);
  const env: NodeJS.ProcessEnv = { ...process.env, PGHOST: u.hostname, PGPORT: u.port, PGUSER: decodeURIComponent(u.username), PGDATABASE: u.pathname.slice(1) };
  delete env.DATABASE_URL;
  return env;
};
/** psql -X -q -v ON_ERROR_STOP=1 -f <file>, expanded unaligned output (one "column|value" line per field). */
function psqlFile(url: string, file: string, extra: string[] = []): { status: number | null; out: string; ms: number } {
  const t0 = Date.now();
  const r = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-A", "-x", "-P", "footer=off", ...extra, "-f", file], { env: pgEnv(url), encoding: "utf8", timeout: 120_000 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, ms: Date.now() - t0 };
}
type Section = { id: string; records: Record<string, string>[]; notes: string[] };
function parseD7(out: string): Map<string, Section> {
  const sections = new Map<string, Section>();
  let cur: Section | null = null;
  let rec: Record<string, string> | null = null;
  const flush = () => {
    if (cur && rec && Object.keys(rec).length) cur.records.push(rec);
    rec = null;
  };
  for (const line of out.split("\n")) {
    const head = /^=== (D7-[0-9A-Z]+)/.exec(line);
    if (head) {
      flush();
      cur = { id: head[1], records: [], notes: [] };
      sections.set(head[1], cur);
      continue;
    }
    if (!cur) continue;
    if (line.trim() === "") {
      flush();
      continue;
    }
    const kv = /^([a-z0-9_]+)\|(.*)$/.exec(line);
    if (kv) {
      rec ??= {};
      if (kv[1] in rec) {
        flush();
        rec = {};
      }
      rec[kv[1]] = kv[2];
    } else {
      flush();
      cur.notes.push(line);
    }
  }
  flush();
  return sections;
}
const rec = (s: Map<string, Section>, id: string, key: string, value?: string) => s.get(id)?.records.find((r) => key in r && (value === undefined || r[key] === value));
const num = (s: Map<string, Section>, id: string, key: string) => Number(rec(s, id, key)?.[key]);

let fixture = undefined as unknown as ProductionFixture;
const t: Record<string, { name: string; url: string }> = {};
const tmpRoot = mkdtempSync(join(tmpdir(), "po06-data-safety-"));

try {
  section("0. The production shape with fictional company data, and the full branch shape");
  t.prod = await newDb("po06d_tprod");
  ok("the 621f156 tenant schema", (await pushPreCompanyTenantSchema(t.prod.url)).ok);
  await withDb(t.prod.url, (c) => c.query(readFileSync(join(ROOT, "drizzle/immutable_audit.sql"), "utf8")));
  t.data = await newDb("po06d_tdata", t.prod.name);
  await withDb(t.data.url, async (c) => {
    fixture = await insertProductionFixtures(c);
  });
  t.full = await newDb("po06d_tfull", t.data.name);
  await applyManifest(t.full.url, m, { includeStaged: true });
  ok("the full branch shape (S00–S09, user_invitations included) on the same company data", (await statusOf(t.full.url, m)).inspection.po03c === "present");

  section("P. The D-7 read-only bundle — static safety rules");
  const d7 = readFileSync(D7, "utf8");
  // code lines only (no comment, no \echo), with string literals blanked: 'CREATE' in has_database_privilege(…) is a privilege name
  const code = d7.split("\n").filter((l) => !/^\s*--/.test(l) && !/^\s*\\echo/.test(l)).join("\n").replace(/'(?:[^']|'')*'/g, "''");
  const codeWithLiterals = d7.split("\n").filter((l) => !/^\s*--/.test(l) && !/^\s*\\echo/.test(l)).join("\n");
  ok("P1 one READ ONLY, REPEATABLE READ transaction that ends in ROLLBACK; statement_timeout 15 s, lock_timeout 2 s, idle_in_transaction_session_timeout 60 s",
    /^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;$/m.test(codeWithLiterals) && /^ROLLBACK;\s*$/m.test(codeWithLiterals) && !/^COMMIT/im.test(codeWithLiterals) &&
      /SET LOCAL statement_timeout = '15s';/.test(codeWithLiterals) && /SET LOCAL lock_timeout = '2s';/.test(codeWithLiterals) && /SET LOCAL idle_in_transaction_session_timeout = '60s';/.test(codeWithLiterals));
  const forbidden = code.match(/\b(INSERT|UPDATE|DELETE|MERGE|COPY|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|LOCK|CALL|DO|VACUUM|ANALYZE|CLUSTER|REINDEX|REFRESH|PREPARE|EXECUTE|LISTEN|NOTIFY|DISCARD|SECURITY)\b/gi) ?? [];
  ok("P2 no statement that could write, lock or create anything: no INSERT/UPDATE/DELETE/MERGE/COPY/CREATE/ALTER/DROP/TRUNCATE/LOCK/DO/CALL/PREPARE…", forbidden.length === 0, forbidden.join(","));
  ok("P3 no row lock (FOR UPDATE / FOR SHARE), no temporary table, no sequence or advisory-lock or backend function, no SET outside SET LOCAL",
    !/FOR\s+(NO\s+KEY\s+)?(UPDATE|SHARE|KEY\s+SHARE)/i.test(code) && !/\bTEMP(ORARY)?\b/i.test(code) && !/\b(nextval|setval|pg_advisory\w*|pg_terminate_backend|pg_cancel_backend|set_config|lo_\w+|dblink\w*)\s*\(/i.test(code) && !/^\s*SET (?!LOCAL)/im.test(code));
  const sensitive = code.match(/\b(password_hash|mfa_secret|mfa_recovery_codes|token_hash|phone|address|tax_id|vat_number|ip_address|user_agent|new_value|previous_value|detail|metadata|description|notes|logo_url|display_name|company_name|manual_note)\b/gi) ?? [];
  ok("P4 never names a secret or business-content column (password_hash, mfa_secret, token_hash, phone, address, tax_id, notes …)", sensitive.length === 0, [...new Set(sensitive)].join(","));
  ok("P5 the read-only proof is checked before the first measurement, and a failed check quits", /\\if :read_only\s*\\else\s*\\echo 'REFUSED[^']*'\s*\\quit/.test(d7) && d7.indexOf("\\if :read_only") < d7.indexOf("=== D7-00"));

  section("P. The D-7 bundle on the production shape with fictional company data");
  const P1 = await newDb("po06d_p1", t.data.name);
  const before = await withDb(P1.url, async (c) => ({ fp: await fingerprints(c, await publicTables(c)), cat: JSON.stringify(await projectCatalog(c)), rels: Number((await c.query(`select count(*)::int as n from pg_class`)).rows[0].n) }));
  const run1 = psqlFile(P1.url, D7);
  const s1 = parseD7(run1.out);
  ok(`P6 exit 0, every section D7-00 … D7-12 and D7-END printed (${run1.ms} ms)`, run1.status === 0 && ["D7-00", "D7-01", "D7-02", "D7-03", "D7-04", "D7-05", "D7-06", "D7-07", "D7-08", "D7-09", "D7-10", "D7-11", "D7-12", "D7-END"].every((k) => s1.has(k)), run1.out.slice(0, 300));
  const e = fixture.expect;
  ok("P7 D7-00: PostgreSQL 16, UTF8, primary, schema public, transaction_read_only on", rec(s1, "D7-00", "server_version_num")?.server_version_num.startsWith("16") === true && rec(s1, "D7-00", "server_encoding")?.server_encoding === "UTF8" && rec(s1, "D7-00", "standby")?.standby === "f" && rec(s1, "D7-00", "transaction_read_only")?.transaction_read_only === "on");
  ok(`P8 D7-01 companies = ${e.companies}`, num(s1, "D7-01", "companies") === e.companies);
  const classes = Object.fromEntries((s1.get("D7-02")?.records ?? []).map((r) => [r.class, Number(r.companies)]));
  ok("P9 D7-02 classes A–F exactly as the fixtures were built: A 4 · B 1 · C 1 · D 1 · E 1 · F 1 (pseudonyms only)", JSON.stringify(classes) === JSON.stringify(e.classes), JSON.stringify(classes));
  const u3 = rec(s1, "D7-03", "users");
  ok(`P10 D7-03 users ${e.users} · active ${e.active} · disabled ${e.disabled} · never signed in ${e.neverSignedIn} · MFA ${e.mfaEnabled}`,
    Number(u3?.users) === e.users && Number(u3?.active_users) === e.active && Number(u3?.disabled_users) === e.disabled && Number(u3?.never_signed_in) === e.neverSignedIn && Number(u3?.mfa_enabled_users) === e.mfaEnabled, JSON.stringify(u3));
  const roles = Object.fromEntries((s1.get("D7-04")?.records ?? []).filter((r) => "role" in r).map((r) => [r.role, Number(r.users)]));
  ok("P11 D7-04 role values, the non-canonical 'Owner' flagged; 3 companies without an active owner, 1 whose only owner is disabled",
    JSON.stringify(roles) === JSON.stringify(e.roles) && rec(s1, "D7-04", "role", "Owner")?.non_canonical === "t" && num(s1, "D7-04", "companies_without_an_active_owner") === 3 && num(s1, "D7-04", "companies_whose_only_owners_are_disabled") === 1, JSON.stringify(roles));
  ok("P12 D7-05 / D7-06 on a database without the Platform Owner tables: every company counts as without a primary owner and without a subscription (noted, not failed)",
    num(s1, "D7-05", "without_primary_owner") === 9 && num(s1, "D7-06", "companies_without_a_current_subscription") === 9 && s1.get("D7-05")!.notes.some((n) => /not installed/.test(n)));
  const seat = rec(s1, "D7-07", "max_users");
  ok(`P13 D7-07 seats: max ${e.maxUsers}, p50 2, p95 6, ${e.above3} company above the Trial's 3 seats; the per-size distribution`,
    Number(seat?.max_users) === e.maxUsers && Number(seat?.p50_users) === 2 && Number(seat?.p95_users) === 6 && Number(seat?.companies_above_3_users) === e.above3 && rec(s1, "D7-07", "users_per_company", "6-10")?.companies === "1", JSON.stringify(seat));
  const e1 = rec(s1, "D7-08", "check_id", "E1");
  const e24 = rec(s1, "D7-08", "check_id", "E2-E4");
  ok(`P14 D7-08 e-mail: E1 ${e.e1Groups} case-insensitive group (2 accounts, spanning 2 companies); not normalized ${e.notNormalized}, white space ${e.whiteSpace}, non-ASCII ${e.nonAscii}; no lower(email) index yet`,
    Number(e1?.case_insensitive_duplicate_groups) === e.e1Groups && Number(e1?.accounts_involved) === 2 && Number(e1?.groups_spanning_companies) === e.e1Spanning &&
      Number(e24?.not_stored_normalized) === e.notNormalized && Number(e24?.surrounding_white_space) === e.whiteSpace && Number(e24?.non_ascii) === e.nonAscii &&
      rec(s1, "D7-08", "check_id", "E8")?.existing_users_email_lower_uq === "0", JSON.stringify({ e1, e24 }));
  const planned = (s1.get("D7-09")?.records ?? []).filter((r) => "planned_object" in r);
  ok("P15 D7-09: none of the 18 planned objects exists yet; no INVALID index; the four long-named customer foreign keys present, validated, without orphans; both immutable-audit triggers; no event trigger",
    planned.length === 18 && planned.every((r) => r.exists_in_public === "0") && num(s1, "D7-09", "invalid_indexes_in_public") === 0 &&
      (s1.get("D7-09")?.records ?? []).filter((r) => "long_named_customer_fk" in r && r.validated === "t").length === 4 &&
      ["orphans_advance_application_releases", "orphans_delivery_challan_items", "orphans_proforma_invoice_items", "orphans_sales_invoices_payment_term"].every((k) => num(s1, "D7-09", k) === 0) &&
      (s1.get("D7-09")?.records ?? []).filter((r) => "immutable_audit_trigger" in r && r.enabled === "O").length === 2 && num(s1, "D7-09", "event_triggers") === 0);
  ok("P16 D7-10 sizing and D7-11 obstacles: sizes reported; no scratch schema, no named function, no prepared transaction; the measuring role's privileges reported",
    Number(rec(s1, "D7-10", "database_bytes")?.database_bytes) > 0 && rec(s1, "D7-10", "table_name", "users") !== undefined &&
      num(s1, "D7-11", "leftover_scratch_schemas") === 0 && num(s1, "D7-11", "existing_named_functions") === 0 && num(s1, "D7-11", "prepared_transactions") === 0 && rec(s1, "D7-11", "role_owns_users") !== undefined);
  const leaks = fixture.canaries.filter((cn) => run1.out.includes(cn));
  const idLeaks = fixture.idStrings.filter((id) => new RegExp(`\\b${id}\\b`).test(run1.out));
  ok("P17 the report contains no canary string (names, addresses, phone, tax id, password hash, MFA secret, e-mail domain), no e-mail address and no raw company or user id",
    leaks.length === 0 && idLeaks.length === 0 && !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(run1.out), `${leaks.join(",")} ${idLeaks.join(",")}`);
  const run1b = psqlFile(P1.url, D7);
  const pseudo = (o: string) => (o.match(/org-[0-9a-f]{10}/g) ?? []).sort().join(",");
  ok("P18 pseudonyms link rows only within one report: a second run gives every company a different pseudonym (per-run salt, never printed)", pseudo(run1.out).length > 0 && pseudo(run1.out) !== pseudo(run1b.out) && run1b.status === 0);
  await withDb(P1.url, async (c) => {
    const fpNow = await fingerprints(c, await publicTables(c));
    ok("P19 after two runs every table is byte-identical, the catalog projection (tables, columns, constraints, indexes, triggers, functions, sequences) is identical and no relation was created",
      changedTables(before.fp, fpNow).length === 0 && JSON.stringify(await projectCatalog(c)) === before.cat && Number((await c.query(`select count(*)::int as n from pg_class`)).rows[0].n) === before.rels);
  });
  // no lock an application could notice: run it while another session holds EXCLUSIVE on every table it reads
  await withDb(P1.url, async (holder) => {
    await holder.query("begin");
    await holder.query(`lock table orgs, users, sessions, audit_logs, security_events, advance_application_releases, advance_applications, delivery_challan_items, delivery_challans, proforma_invoice_items, proforma_invoices, sales_invoices, payment_term_presets in exclusive mode`);
    const r = psqlFile(P1.url, D7);
    ok(`P20 with EXCLUSIVE held on every customer table it reads (which admits only ACCESS SHARE) the bundle still completes (exit 0, ${r.ms} ms): it takes no row lock and writes nothing`, r.status === 0 && r.out.includes("=== D7-END"), r.out.slice(-200));
    await holder.query("rollback");
  });
  await withDb(P1.url, async (holder) => {
    await holder.query("begin");
    await holder.query(`lock table users in access exclusive mode`);
    const r = psqlFile(P1.url, D7);
    ok(`P21 behind an ACCESS EXCLUSIVE lock it gives up after its 2 s lock_timeout (55P03-class 'lock timeout', exit ${r.status}, ${r.ms} ms) instead of waiting`, r.status !== 0 && /lock timeout/i.test(r.out) && r.ms < 10_000, r.out.slice(-200));
    await holder.query("rollback");
  });
  const r1 = psqlFile(P1.url, D7, ["-1"]);
  ok("P22 under psql -1 the file's BEGIN is nested: PostgreSQL warns, still applies READ ONLY and REPEATABLE READ to the enclosing transaction, and the report completes read-only",
    r1.status === 0 && /there is already a transaction in progress/.test(r1.out) && r1.out.includes("=== D7-END"), r1.out.slice(0, 200));
  const r1b = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-1", "-c", "select 1", "-f", D7], { env: pgEnv(P1.url), encoding: "utf8" });
  ok("P22b inside a transaction that has already run a query, the isolation level cannot be set: it stops with an error before measuring anything",
    r1b.status !== 0 && /SET TRANSACTION ISOLATION LEVEL must be called before any query/.test(r1b.stderr ?? "") && !(r1b.stdout ?? "").includes("=== D7-01"), (r1b.stderr ?? "").slice(0, 200));
  await withDb(P1.url, async (c) => ok("P22c …and after both, every table is still byte-identical", changedTables(before.fp, await fingerprints(c, await publicTables(c))).length === 0));

  section("P. The D-7 bundle on the full branch shape, with fictional Platform Owner rows");
  const P2 = await newDb("po06d_p2", t.full.name);
  await withDb(P2.url, async (c) => {
    const pw = await bcrypt.hash("Fictional-Passw0rd!x", 4);
    const admin = String((await c.query(`insert into platform_admins (email_normalized, display_name, password_hash, mfa_secret_encrypted, mfa_enrolled_at) values ('measure@platform-fixture.test', $1, $2, 'v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB==:CCCCCCCC', now()) returning id`, [`Fictional ${fixture.canaries[0]} Operator`, pw])).rows[0].id);
    await c.query(`insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at) values ($1, 'suspended', $2, $3, now())`, [fixture.orgs.D, `Fictional reason ${fixture.canaries[0]}`, admin]);
    await c.query(`insert into tenant_primary_owners (org_id, user_id, assigned_by_platform_admin_id) values ($1, $2, $3)`, [fixture.orgs.A1, fixture.users.a1owner, admin]);
    await c.query(`insert into user_invitations (org_id, name, email_normalized, requested_role, token_hash, invited_by_platform_admin_id) values ($1, $2, 'staff.falcon@fixture-po06.test', 'staff', $3, $4)`, [fixture.orgs.A1, `Fictional ${fixture.canaries[0]} Invitee`, "c".repeat(64), admin]);
  }).catch((err) => ok("P2 fixture rows", false, describeError(err)));
  const run2 = psqlFile(P2.url, D7);
  const s2 = parseD7(run2.out);
  ok("P23 exit 0 on the full shape; D7-05 reads the mapping (8 without a primary owner, 0 mappings that are not an active owner); D7-06 reads the subscriptions table",
    run2.status === 0 && num(s2, "D7-05", "without_primary_owner") === 8 && num(s2, "D7-05", "mapping_not_an_active_owner") === 0 && num(s2, "D7-06", "companies_without_a_current_subscription") === 9, run2.out.slice(0, 400));
  ok("P24 E5b: the pending user invitation whose address already belongs to a customer user is counted; D7-12 counts the operator, the suspension and the invitation",
    rec(s2, "D7-08", "check_id", "E5b")?.open_user_invitations_whose_email_is_a_user === "1" && num(s2, "D7-12", "platform_admins") === 1 && rec(s2, "D7-12", "access_status", "suspended")?.companies === "1" && num(s2, "D7-12", "user_invitations_pending") === 1);
  const planned2 = (s2.get("D7-09")?.records ?? []).filter((r) => "planned_object" in r);
  ok("P25 D7-09 sees every installed object (17 of 18; users_email_lower_uq absent) and M4 and the users key valid", planned2.filter((r) => r.exists_in_public === "1").length === 17 && planned2.find((r) => r.planned_object === "users_email_lower_uq")?.exists_in_public === "0" &&
    (s2.get("D7-09")?.records ?? []).filter((r) => "index_name" in r && r.valid === "t").length === 2);
  ok("P26 …and still no canary, no e-mail address, no raw id", !fixture.canaries.some((cn) => run2.out.includes(cn)) && !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(run2.out) && !fixture.idStrings.some((id) => new RegExp(`\\b${id}\\b`).test(run2.out)));
  writeFileSync(join(tmpRoot, "d7-production-shape.out"), run1.out);

  section("Q. users_email_lower_uq — the PO-06 additions (PO-02D3 4a–4h stay in verify:platform-email-uniqueness)");
  const strip = (path: string) => readFileSync(path, "utf8").split(/^-- statement\s*$/m).slice(1).map((ch) => ch.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").trim()).filter((s) => s && !s.includes("$proposal_guard$"));
  const runFile = async (c: Client, path: string, stripGuard: boolean) => {
    const stmts = stripGuard ? strip(path) : readFileSync(path, "utf8").split(/^-- statement\s*$/m).slice(1).map((ch) => ch.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").trim()).filter(Boolean);
    for (const s of stmts) await c.query(s);
  };
  const indexState = (c: Client) => c.query(`select x.indisvalid and x.indisready as valid from pg_index x join pg_class i on i.oid = x.indexrelid where i.relname = 'users_email_lower_uq'`).then((r) => r.rows[0] as { valid: boolean } | undefined);
  const Q = await newDb("po06d_q", t.full.name);
  await withDb(Q.url, async (c) => {
    await c.query("begin");
    const twin = await caught(c.query(`insert into users (org_id, email, password_hash, name, role) values ($1, 'Mixed.Twin@fixture-po06.test', 'x', 'Fictional', 'staff'), ($1, 'mixed.twin@fixture-po06.test', 'x', 'Fictional', 'staff')`, [fixture.orgs.A1]));
    await c.query("rollback");
    ok("Q1 today (no index): two accounts differing only by letter case are accepted by the database (users_email_unique is case-sensitive)", twin === null);
    const guard = await caught(runFile(c, EMAIL_PROPOSAL, false));
    ok("Q2 the committed proposal refuses as committed (approval guard) and builds nothing; so does the committed rollback", /not approved for execution/.test(describeError(guard)) && !(await indexState(c)) && /not approved for execution/.test(describeError(await caught(runFile(c, EMAIL_ROLLBACK, false)))));
    const dup = await caught(runFile(c, EMAIL_PROPOSAL, true));
    ok("Q3 unlocked on this disposable copy, it REFUSES at step 1 over the fixtures' case-variant group (the D-7 E1 = 1 above) and builds nothing", /duplicate e-mail group/.test(describeError(dup)) && !(await indexState(c)), describeError(dup));
    // the owner's remediation is never automated: here, on fictional rows only, the twin is removed so E1 = 0
    await c.query(`delete from users where id = $1`, [fixture.users.bdup]);
    const audit = psqlFile(Q.url, EMAIL_AUDIT);
    ok("Q4 after removing the fictional twin (disposable data only — real remediation is an owner decision per account), the PO-02D3 audit reports E1 = 0", audit.status === 0 && /check_id\|E1\ngroups\|0/.test(audit.out), audit.out.slice(0, 200));
    // CONCURRENTLY: it waits for an open writer while other writes go on
    await withDb(Q.url, async (blocker) => {
      await blocker.query("begin");
      await blocker.query(`update users set name = name where id = $1`, [fixture.users.a1admin]);
      const build = caught(runFile(c, EMAIL_PROPOSAL, true));
      await withDb(Q.url, async (obs) => {
        const pid = await (async () => {
          for (let i = 0; i < 1500; i++) {
            const r = (await obs.query(`select pid from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike 'CREATE UNIQUE INDEX CONCURRENTLY%'`)).rows[0];
            if (r) return Number(r.pid);
            await new Promise((res) => setTimeout(res, 20));
          }
          return null;
        })();
        const modes = pid ? (await obs.query(`select l.mode from pg_locks l join pg_class c on c.oid = l.relation where l.pid = $1 and c.relname = 'users' and l.granted`, [pid])).rows.map((r) => String(r.mode)) : [];
        ok("Q5 the build waits for the transaction already open, holding only SHARE UPDATE EXCLUSIVE on users", Boolean(pid) && modes.includes("ShareUpdateExclusiveLock") && !modes.some((x) => /^(Share|ShareRowExclusive|Exclusive|AccessExclusive)Lock$/.test(x)), modes.join(","));
        await withDb(Q.url, async (w) => {
          const t0 = Date.now();
          await w.query(`insert into users (org_id, email, password_hash, name, role) values ($1, 'during.build@fixture-po06.test', 'x', 'Fictional', 'staff')`, [fixture.orgs.A2]);
          await w.query(`update users set last_login_at = now() where id = $1`, [fixture.users.a2owner]);
          ok(`Q6 …meanwhile a registration-style INSERT and a sign-in UPDATE on users complete at once (${Date.now() - t0} ms)`, Date.now() - t0 < 2_000);
        });
      });
      await blocker.query("rollback");
      const err = await build;
      ok("Q7 once the open transaction ends, the build completes: the index is valid", err === null && (await indexState(c))?.valid === true, describeError(err));
    });
    // a race between two NON-normalized writers (the residual the index exists for): deterministic barrier
    await withDb(Q.url, async (t1) => {
      await withDb(Q.url, async (t2) => {
        await t1.query("begin");
        await t1.query(`insert into users (org_id, email, password_hash, name, role) values ($1, 'Race.Twin@fixture-po06.test', 'x', 'Fictional', 'staff')`, [fixture.orgs.C]);
        await t2.query("begin");
        const t2pid = Number((await t2.query("select pg_backend_pid() as p")).rows[0].p);
        const p2 = caught(t2.query(`insert into users (org_id, email, password_hash, name, role) values ($1, 'race.twin@fixture-po06.test', 'x', 'Fictional', 'staff')`, [fixture.orgs.B]));
        // barrier: the second insert is observed waiting (on the first writer's transaction) before the first commits
        let waited = false;
        await withDb(Q.url, async (obs) => {
          for (let i = 0; i < 1500 && !waited; i++) {
            waited = (await obs.query(`select wait_event_type = 'Lock' as w from pg_stat_activity where pid = $1`, [t2pid])).rows[0]?.w === true;
            if (!waited) await new Promise((res) => setTimeout(res, 10));
          }
        });
        ok("Q8a the second writer of the case variant is observed waiting on the first writer's uncommitted index entry", waited);
        await t1.query("commit");
        const e2 = await p2;
        await t2.query("rollback").catch(() => undefined);
        ok("Q8 race: the second writer of a case-variant waits on the index entry and, when the first commits, is refused by the DATABASE (23505 on users_email_lower_uq)", sqlState(e2) === "23505" && /users_email_lower_uq/.test(String((e2 as { constraint?: string })?.constraint ?? describeError(e2))), describeError(e2));
      });
    });
  });
  // the real application writers under the index (child processes: the app's db module binds DATABASE_URL at import)
  const child = (url: string, ...args: string[]) => {
    const r = spawnSync(join(ROOT, "node_modules/.bin/tsx"), ["--conditions=react-server", join(ROOT, "verify/platform/po06-email-child.mts"), ...args], { env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", timeout: 120_000 });
    const line = (r.stdout ?? "").trim().split("\n").pop() ?? "";
    try {
      return JSON.parse(line) as Record<string, string>;
    } catch {
      return { outcome: "unparsed", raw: `${(r.stdout ?? "").slice(-200)} ${(r.stderr ?? "").slice(-300)}` };
    }
  };
  const orgCount = (url: string) => withDb(url, async (c) => Number((await c.query(`select count(*)::int as n from orgs`)).rows[0].n));
  const reg1 = child(Q.url, "register", "new.registrant@fixture-po06.test", "Fictional New Registrant Co");
  ok("Q9 registration (the /register database steps with the real bootstrapOrganization) of a new address works under the index", reg1.outcome === "created", JSON.stringify(reg1));
  const orgsBefore = await orgCount(Q.url);
  const reg2 = child(Q.url, "register", "owner.falcon@fixture-po06.test", "Fictional Duplicate Attempt Co");
  ok("Q10 registering the lower-case form of a legacy mixed-case account ('Owner.Falcon@…' exists): the exact-match pre-check misses it, the DATABASE refuses (23505 users_email_lower_uq) and the whole transaction rolls back — no company is created",
    reg2.outcome === "error" && reg2.code === "23505" && /users_email_lower_uq/.test(reg2.constraint ?? "") && (await orgCount(Q.url)) === orgsBefore, JSON.stringify(reg2));
  const Qn = await newDb("po06d_qn", t.full.name);
  const reg3 = child(Qn.url, "register", "owner.falcon@fixture-po06.test", "Fictional Duplicate Attempt Co");
  const twins = await withDb(Qn.url, async (c) => Number((await c.query(`select count(*)::int as n from users where lower(email) = 'owner.falcon@fixture-po06.test'`)).rows[0].n));
  ok("Q11 …the same registration WITHOUT the index creates a second account differing only by case (2 accounts) — the residual the index closes (finding EI-1: /register then shows an unhandled error instead of 'already exists')", reg3.outcome === "created" && twins === 2, JSON.stringify(reg3));
  const team = child(Q.url, "team-add", String(fixture.users.a1owner), "OWNER.FALCON@fixture-po06.test");
  ok("Q12 the Team's Add Member service refuses the same case variant with its own message ('A user with this email already exists.')", team.outcome === "refused" && /already exists/.test(team.message ?? ""), JSON.stringify(team));
  const raceResults = await Promise.all(
    [0, 1].map(
      (i) =>
        new Promise<Record<string, string>>((resolve) => {
          const p = spawn(join(ROOT, "node_modules/.bin/tsx"), ["--conditions=react-server", join(ROOT, "verify/platform/po06-email-child.mts"), "register", i === 0 ? "Concurrent.Owner@fixture-po06.test" : "concurrent.owner@fixture-po06.test", `Fictional Concurrent ${i} Co`], { env: { ...process.env, DATABASE_URL: Q.url } });
          let out = "";
          p.stdout.on("data", (d) => (out += String(d)));
          p.on("close", () => {
            try {
              resolve(JSON.parse(out.trim().split("\n").pop() ?? "{}"));
            } catch {
              resolve({ outcome: "unparsed" });
            }
          });
        }),
    ),
  );
  const accounts = await withDb(Q.url, async (c) => Number((await c.query(`select count(*)::int as n from users where lower(email) = 'concurrent.owner@fixture-po06.test'`)).rows[0].n));
  ok(`Q13 two concurrent registrations of one address in two letter cases: exactly one account and one company; the other is refused (${raceResults.map((r) => r.outcome + (r.constraint ? `:${r.constraint}` : "")).join(" / ")})`,
    accounts === 1 && raceResults.filter((r) => r.outcome === "created").length === 1 && raceResults.filter((r) => r.outcome === "error" || r.outcome === "precheck-refused").length === 1);
  ok("Q14 company and user invitation acceptance map ANY 23505 on a users_email* constraint to the neutral 'unavailable' refusal, so users_email_lower_uq needs no change there (code check)",
    ["src/lib/platform/invitation-acceptance.ts", "src/lib/platform/user-invitation-acceptance.ts", "src/lib/team/member-add.ts"].every((f) => /pg\?\.code === "23505" && \/users_email\/\.test\(pg\.constraint\)/.test(readFileSync(join(ROOT, f), "utf8"))) &&
      !/23505/.test(readFileSync(join(ROOT, "src/app/(auth)/actions.ts"), "utf8")));
  await withDb(Q.url, async (c) => {
    const fpBefore = await fingerprints(c, await publicTables(c));
    await runFile(c, EMAIL_ROLLBACK, true);
    await runFile(c, EMAIL_ROLLBACK, true);
    const uq = (await c.query(`select count(*)::int as n from pg_constraint where conname = 'users_email_unique'`)).rows[0].n;
    ok("Q15 the rollback (DROP INDEX CONCURRENTLY, unlocked here) removes only the index, twice in a row without error; users_email_unique and every row are untouched",
      !(await indexState(c)) && uq === 1 && changedTables(fpBefore, await fingerprints(c, await publicTables(c))).length === 0);
    // a build that fails late leaves an INVALID index: detected, refused, recovered
    await c.query(`insert into users (org_id, email, password_hash, name, role) values ($1, 'Late.Dup@fixture-po06.test', 'x', 'Fictional', 'staff'), ($1, 'late.dup@fixture-po06.test', 'x', 'Fictional', 'staff')`, [fixture.orgs.F]);
    const failed = await caught(c.query(`create unique index concurrently users_email_lower_uq on public.users using btree (lower(email))`));
    const left = await indexState(c);
    const over = await caught(runFile(c, EMAIL_PROPOSAL, true));
    ok("Q16 a build that meets a duplicate fails (23505) and leaves an INVALID index; the proposal then refuses to continue over it and prints DROP INDEX CONCURRENTLY", sqlState(failed) === "23505" && left?.valid === false && /INVALID/.test(describeError(over)), `${describeError(failed)} | ${describeError(over)}`);
    await runFile(c, EMAIL_ROLLBACK, true);
    await c.query(`delete from users where email = 'Late.Dup@fixture-po06.test'`);
    await runFile(c, EMAIL_PROPOSAL, true);
    ok("…recovery: rollback (drops the INVALID index), resolve the duplicate, build again — valid", (await indexState(c))?.valid === true);
  });

  section("R. Encrypted backup and restore (scripts/backup.sh and scripts/restore.sh, unchanged)");
  const gpgHome = mkdtempSync(join(tmpRoot, "gnupg-"));
  const gpg = (home: string, args: string[], input?: string) => spawnSync("gpg", ["--homedir", home, "--batch", ...args], { encoding: "utf8", input });
  const gen = gpg(gpgHome, ["--pinentry-mode", "loopback", "--passphrase", "", "--quick-gen-key", "PO06 Fictional Backup Recipient (TEST ONLY) <backup-recipient@fixture-po06.test>", "default", "default", "1d"]);
  const fpr = (gpg(gpgHome, ["--list-keys", "--with-colons"]).stdout.match(/^fpr:+([0-9A-F]{40}):/m) ?? [])[1];
  ok("R0 a TEST-only gpg key pair in a temporary GNUPGHOME (deleted at the end; never committed)", gen.status === 0 && Boolean(fpr));
  // the source: the full branch shape with company data, one field encrypted with a TEST key and one real password hash
  const R = await newDb("po06d_r_src", t.full.name);
  const neighbor = await newDb("po06d_r_neighbor", t.data.name);
  const testKey = randomBytes(32);
  process.env.FIELD_ENCRYPTION_KEYS = `1:${testKey.toString("base64")}`;
  const { encryptField, decryptField } = await import("../src/lib/crypto/field-encryption");
  const SECRET = "JBSWY3DPEHPK3PXP-FICTIONAL";
  const envelope = encryptField(SECRET) as string;
  await withDb(R.url, async (c) => {
    await c.query(`update users set mfa_secret = $1, password_hash = $2 where id = $3`, [envelope, await bcrypt.hash("Fictional-Restore-Passw0rd!", 4), fixture.users.a1owner]);
    await c.query(`insert into platform_admins (email_normalized, display_name, password_hash, mfa_secret_encrypted, mfa_enrolled_at) values ('restore@platform-fixture.test', 'Fictional Operator', $1, $2, now())`, [await bcrypt.hash("Fictional-Passw0rd!x", 4), envelope]);
  });
  const srcBefore = await withDb(R.url, async (c) => ({ fp: await fingerprints(c, await publicTables(c)), cat: JSON.stringify(await projectCatalog(c)) }));
  const neighborBefore = await withDb(neighbor.url, async (c) => fingerprints(c, await publicTables(c)));
  const backupDir = join(tmpRoot, "backups");
  mkdirSync(backupDir);
  const day = 86_400_000;
  const old = join(backupDir, "elite-erp-db-20261031T000000Z.dump.gpg");
  const recent = join(backupDir, "elite-erp-db-20261119T000000Z.dump.gpg");
  const unrelated = join(backupDir, "notes-unrelated.txt");
  for (const [f, age] of [[old, 20], [recent, 2], [unrelated, 30]] as const) {
    writeFileSync(f, "fictional placeholder\n");
    utimesSync(f, new Date(Date.now() - age * day), new Date(Date.now() - age * day));
  }
  const bk = spawnSync("bash", ["scripts/backup.sh"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: R.url, BACKUP_DIR: backupDir, RETENTION_DAYS: "14", GPG_RECIPIENT: fpr ?? "", GNUPGHOME: gpgHome }, encoding: "utf8", timeout: 300_000 });
  const files = readdirSync(backupDir).sort();
  const archive = files.find((f) => /^elite-erp-db-\d{8}T\d{6}Z\.dump\.gpg$/.test(f) && !f.startsWith("elite-erp-db-20261031") && !f.startsWith("elite-erp-db-20261119"));
  ok("R1 backup.sh exits 0 and reports what it did and did not cover (uploaded files are NOT in this backup)", bk.status === 0 && /\[backup\] done\./.test(bk.stdout) && /NOT BACKED UP BY THIS SCRIPT/.test(bk.stdout), `${bk.stdout.slice(-300)} ${bk.stderr.slice(-300)}`);
  ok("R2 the archive is encrypted (OpenPGP, no PostgreSQL dump signature in the file) and no plaintext dump is left beside it", Boolean(archive) && !readFileSync(join(backupDir, archive!)).includes(Buffer.from("PGDMP")) && gpg(gpgHome, ["--list-packets", join(backupDir, archive!)]).status === 0 && !files.some((f) => f.endsWith(".dump")), files.join(","));
  ok("R3 retention: the 20-day-old archive was pruned; the 2-day-old archive and the unrelated 30-day-old file were kept", !existsSync(old) && existsSync(recent) && existsSync(unrelated), files.join(","));
  const archivePath = join(backupDir, archive ?? "missing");
  const bytes = readFileSync(archivePath);
  const plain = join(tmpRoot, "integrity.dump");
  const dec = spawnSync("bash", ["-c", 'gpg --homedir "$H" --batch --decrypt "$A" > "$O"'], { env: { ...process.env, H: gpgHome, A: archivePath, O: plain }, encoding: "utf8" });
  const toc = spawnSync("pg_restore", ["--list", plain], { encoding: "utf8" });
  const tocText = toc.stdout ?? "";
  const manifest = {
    archive: archive,
    sha256: sha256(bytes),
    bytes: bytes.length,
    created_utc: new Date(statSync(archivePath).mtimeMs).toISOString(),
    source: "disposable *_test_only_* database (fictional data)",
    encryption: { tool: (spawnSync("gpg", ["--version"], { encoding: "utf8" }).stdout.split("\n")[0] ?? "").trim(), recipientFingerprint: fpr },
    format: /Format: (\S+)/.exec(tocText)?.[1],
    dumpedFrom: /Dumped from database version: (\S+)/.exec(tocText)?.[1],
    dumpedBy: /Dumped by pg_dump version: (\S+)/.exec(tocText)?.[1],
    tocEntries: tocText.split("\n").filter((l) => /^\d+;/.test(l)).length,
    tables: Object.keys(srcBefore.fp).length,
    rowFingerprintDigest: sha256(JSON.stringify(srcBefore.fp)),
  };
  writeFileSync(`${archivePath}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  ok(`R4 manifest written beside the archive (sha256 ${manifest.sha256.slice(0, 16)}…, ${manifest.bytes} bytes, ${manifest.tocEntries} TOC entries) and its checksum re-verifies from disk`, sha256(readFileSync(archivePath)) === JSON.parse(readFileSync(`${archivePath}.manifest.json`, "utf8")).sha256);
  ok("R5 integrity: the archive decrypts and pg_restore --list reads a CUSTOM archive from PostgreSQL 16.15 holding the customer tables, the platform tables, their triggers and functions",
    dec.status === 0 && toc.status === 0 && manifest.format === "CUSTOM" && manifest.dumpedFrom === "16.15" && /TABLE DATA public users /.test(tocText) && /TABLE DATA public platform_audit_events /.test(tocText) && /TRIGGER public user_invitations /.test(tocText) && /FUNCTION public platform_reject_mutation\(\)/.test(tocText),
    `${manifest.format} ${manifest.dumpedFrom} ${dec.stderr?.slice(-200)}`);
  rmSync(plain, { force: true });
  const tampered = join(tmpRoot, "tampered.dump.gpg");
  copyFileSync(archivePath, tampered);
  const tb = readFileSync(tampered);
  tb[Math.floor(tb.length / 2)] ^= 0xff;
  writeFileSync(tampered, tb);
  const tdec = spawnSync("bash", ["-c", 'gpg --homedir "$H" --batch --decrypt "$A" > /dev/null'], { env: { ...process.env, H: gpgHome, A: tampered }, encoding: "utf8" });
  ok("R6 a copy with one flipped byte is REFUSED at decryption (integrity protection) — an archive that merely exists is never 'validated'", tdec.status !== 0, tdec.stderr?.slice(-200));
  // RB-4: a backup host that holds only the PUBLIC key, not yet trusted
  const pubHome = mkdtempSync(join(tmpRoot, "gnupg-pub-"));
  const pub = gpg(gpgHome, ["--export", "--armor", fpr ?? ""]).stdout;
  gpg(pubHome, ["--import"], pub);
  const dir2 = join(tmpRoot, "backups-untrusted");
  mkdirSync(dir2);
  const bk2 = spawnSync("bash", ["scripts/backup.sh"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: R.url, BACKUP_DIR: dir2, GPG_RECIPIENT: fpr ?? "", GNUPGHOME: pubHome }, encoding: "utf8", timeout: 300_000 });
  const left2 = readdirSync(dir2);
  ok("R7 finding RB-4: with only an untrusted public key, gpg --batch refuses to encrypt, backup.sh fails — and the PLAINTEXT dump stays in BACKUP_DIR", bk2.status !== 0 && left2.some((f) => /\.dump$/.test(f)), `${bk2.status} ${left2.join(",")}`);
  for (const f of left2) rmSync(join(dir2, f), { force: true });
  gpg(pubHome, ["--import-ownertrust"], `${fpr}:6:\n`);
  const bk3 = spawnSync("bash", ["scripts/backup.sh"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: R.url, BACKUP_DIR: dir2, GPG_RECIPIENT: fpr ?? "", GNUPGHOME: pubHome }, encoding: "utf8", timeout: 300_000 });
  const arch3 = readdirSync(dir2).find((f) => f.endsWith(".dump.gpg"));
  const cannot = arch3 ? spawnSync("bash", ["-c", 'gpg --homedir "$H" --batch --decrypt "$A" > /dev/null'], { env: { ...process.env, H: pubHome, A: join(dir2, arch3) }, encoding: "utf8" }) : null;
  ok("R8 once the recipient key is trusted the same host backs up, and it CANNOT decrypt its own backups (no secret key there): key separation works", bk3.status === 0 && Boolean(arch3) && cannot !== null && cannot.status !== 0);
  // restore into a clean disposable database
  const Rd = await newDb("po06d_r_dst");
  const rs = spawnSync("bash", ["scripts/restore.sh", archivePath], { cwd: ROOT, env: { ...process.env, DATABASE_URL: Rd.url, GNUPGHOME: gpgHome }, encoding: "utf8", timeout: 300_000 });
  ok("R9 restore.sh decrypts, restores and re-applies the immutable-audit triggers, printing '[restore] done.' — and then EXITS 1 (finding RB-7: its EXIT trap returns the status of a cleanup loop over an always-empty list)",
    rs.status === 1 && /\[restore\] done\./.test(rs.stdout) && /CREATE TRIGGER/.test(rs.stdout) && !/ERROR/.test(rs.stderr), `${rs.status} ${rs.stdout.slice(-200)} ${rs.stderr.slice(-300)}`);
  const leftover = archivePath.replace(/\.gpg$/, "");
  ok("R10 finding RB-1: restore.sh leaves the DECRYPTED dump beside the archive (its cleanup list is filled inside a $(…) subshell, so the trap never sees it)", existsSync(leftover), leftover.split("/").pop());
  rmSync(leftover, { force: true });
  const schemaOf = (url: string) => (spawnSync("pg_dump", ["--schema-only", "--no-owner", "--no-privileges"], { env: pgEnv(url), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).stdout ?? "").split("\n").filter((l) => !/^\\(un)?restrict /.test(l) && !/^-- Dumped (from|by)/.test(l)).join("\n");
  const sSrc = schemaOf(R.url);
  const sDst = schemaOf(Rd.url);
  const a = sSrc.split("\n");
  const bLines = sDst.split("\n");
  const differing = a.map((l, i) => [l, bLines[i]] as const).filter(([x, y]) => x !== y);
  const flat = (s: string | undefined) => (s ?? "").replace(/[()\s]/g, "");
  ok(`R11 the restored schema equals the source line for line (pg_dump --schema-only, ${a.length} lines) except ${differing.length} CHECK constraint whose nested AND is re-parsed flat by the restore — identical once parentheses are ignored (finding RB-8: textual only)`,
    a.length === bLines.length && a.length > 1_000 && differing.length <= 2 && differing.every(([x, y]) => /CONSTRAINT \w+ CHECK/.test(x) && flat(x) === flat(y)), differing.map(([x]) => x.trim().slice(0, 80)).join(" | "));
  await withDb(Rd.url, async (c) => {
    const fp = await fingerprints(c, await publicTables(c));
    ok(`R12 every table's rows are byte-identical after the restore (${Object.keys(fp).length} tables, customer and platform)`, changedTables(srcBefore.fp, fp).length === 0 && Object.keys(fp).length === Object.keys(srcBefore.fp).length, changedTables(srcBefore.fp, fp).join(","));
    const v = await c.query(`select current_setting('server_version_num') as v`);
    ok("R13 versions: source and target servers are both 16.15, and pg_dump / pg_restore are 16.15 (restore only into the same or a newer major version)", String(v.rows[0].v) === "160015" && manifest.dumpedBy === "16.15");
    const st = await inspect(c, m);
    const reports = [await checkPlatformObjects(c as never), await checkCompanyFoundation(c as never), await checkOnboardingFoundation(c as never)];
    ok("R14 application checks on the restored database: the manifest's pinned end state (platform, M4, users key, user_invitations, Trial complete), the platform / company / onboarding catalog checks, every trigger enabled",
      st.stage === "S05" && st.m4 === "present" && st.usersKey === "present" && st.po03c === "present" && st.seed === "complete" && st.disabledTriggers.length === 0 && st.immutableTriggers.length === 2 && reports.every((r) => r.ok));
    const row = (await c.query(`select mfa_secret, password_hash from users where id = $1`, [fixture.users.a1owner])).rows[0];
    ok("R15 the field encrypted before the backup decrypts after the restore with the SAME TEST key, and the password check passes", decryptField(row.mfa_secret) === SECRET && (await bcrypt.compare("Fictional-Restore-Passw0rd!", row.password_hash)));
    const [, iv, tag, ct] = String(row.mfa_secret).split(":");
    const wrong = (() => {
      try {
        const d = createDecipheriv("aes-256-gcm", randomBytes(32), Buffer.from(iv, "base64"));
        d.setAuthTag(Buffer.from(tag, "base64"));
        d.update(Buffer.from(ct, "base64"));
        d.final();
        return "decrypted";
      } catch {
        return "refused";
      }
    })();
    ok("R16 …and with ANY other key it cannot be decrypted: FIELD_ENCRYPTION_KEYS must be preserved with the backup (backup-dr.md)", wrong === "refused");
    const upd = await caught(c.query(`update audit_logs set action = action`));
    const upd2 = await caught(c.query(`update platform_audit_events set result = result`));
    ok("R17 the restored audit trails are still append-only (UPDATE refused on audit_logs and platform_audit_events)", upd !== null && upd2 !== null);
  });
  const pf = await runPreflight(Rd.url);
  ok("R18 the release preflight on the restored database gives the same verdict as on the source: BLOCKED only by the two staged-table statements", pf.verdict === "BLOCKED" && pf.findings.filter((f) => f.severity === "blocking").length === STAGED_TABLE_PUSH_PLAN.length);
  const hard = spawnSync(join(ROOT, "node_modules/.bin/tsx"), ["scripts/apply-db-hardening.ts", "--check"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: Rd.url }, encoding: "utf8" });
  ok("R19 the existing hardening check (npm run verify:db-hardening's script) passes on the restored database", hard.status === 0, (hard.stdout + hard.stderr).slice(-200));
  await withDb(R.url, async (c) => ok("R20 the source database is unchanged by the backup (every table, the catalog)", changedTables(srcBefore.fp, await fingerprints(c, await publicTables(c))).length === 0 && JSON.stringify(await projectCatalog(c)) === srcBefore.cat));
  await withDb(neighbor.url, async (c) => ok("R21 an unrelated database on the same server is unchanged by the backup and the restore", changedTables(neighborBefore, await fingerprints(c, await publicTables(c))).length === 0));
  await withDb(Rd.url, async (c) => ok("R22 the restored seed is intact (Trial v1 published, settings row)", (await checkTrialSeed(c as never)).state === "complete"));
  const reverified = await applyManifest(Rd.url, m, { includeStaged: true, reverify: true });
  ok("R23 every reviewed SQL file re-verifies the RESTORED database (S02, S03, S05, S08 'verified'; the seed verified read-only): a restore is indistinguishable from the original to the D-6 tools",
    ["S02", "S03", "S05", "S07", "S08"].every((id) => reverified.find((r) => r.id === id)?.outcome === "verified"), reverified.map((r) => `${r.id}:${r.outcome}`).join(" "));
  writeFileSync(join(tmpRoot, "backup-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n  evidence (scratch, not committed): backup manifest ${JSON.stringify({ ...manifest, encryption: { tool: manifest.encryption.tool, recipientFingerprint: "TEST-ONLY key, deleted" } })}`);
} catch (err) {
  ok("data-safety rehearsal completed without an unexpected error", false, describeError(err));
} finally {
  for (const name of created.reverse()) await dropDisposableDatabase(name).catch(() => undefined);
  rmSync(tmpRoot, { recursive: true, force: true });
}
process.exit(summary("verify-po06-data-safety"));
