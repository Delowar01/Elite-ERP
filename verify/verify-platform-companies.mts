/**
 * Platform Owner PO-02B — the read-only company read model (src/lib/platform/companies.ts).
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *   [PO02B_EVIDENCE_DIR=<dir for performance figures and query plans>] npm run verify:platform-companies
 *
 * One disposable `_test_only_` database (dropped at the end) with 1,000+ SYNTHETIC organizations
 * (scripts/platform/company-fixtures.ts) plus hand-made edge cases: wildcard characters in names,
 * Arabic names, a Riyadh month boundary, an organization holding every sensitive field the
 * directory must never expose, owners 0…4, legacy / explicit / suspended / drifted access rows and
 * every invitation state. Fictional data only; secrets are generated in memory and never printed.
 *
 * Proves: authorization (flag, live platform session, the narrow permission, customer tokens
 * refused); the field allowlist (output shapes and a deep scan for every sensitive value); the SQL
 * actually sent (tables, columns, parameters); search escaping and injection; filters and the sort
 * allowlist; keyset pagination without duplicates or gaps (ties, concurrent inserts, all sorts,
 * both directions); the PO-02A compatibility rule, fail-closed included; owner and user aggregates;
 * read-only invitations without token material; the audited detail view (record, outage, missing
 * protection, unknown ids, activity paging and isolation); metrics; measured performance at 1,000
 * organizations with query counts and plans; cross-principal and data isolation.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectDisposable, createPlatformTestDatabase, databaseUrlFor, disposableName, dropDisposableDatabase } from "../scripts/platform/disposable-db";
import { section, ok, rejects, summary, describeError } from "./platform/harness";

const testDbName = disposableName("po02b_companies");
process.env.DATABASE_URL = databaseUrlFor(testDbName);
process.env.PLATFORM_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.FIELD_ENCRYPTION_KEYS = `1:${randomBytes(32).toString("base64")}`;
process.env.PLATFORM_CONSOLE_ENABLED = "true";
process.env.PLATFORM_TRUSTED_PROXY_HOPS = "1";
const EVIDENCE = process.env.PO02B_EVIDENCE_DIR || "";
if (EVIDENCE) mkdirSync(EVIDENCE, { recursive: true });

let created = false;
await createPlatformTestDatabase("po02b_companies", testDbName);
created = true;

const { db, pool, platformAdminsTable, platformAuditEventsTable } = await import("../src/db");
const auth = await import("../src/lib/platform/auth");
const mfa = await import("../src/lib/platform/mfa");
const totp = await import("../src/lib/platform/totp");
const { platformClock } = await import("../src/lib/platform/clock");
const { isPlatformError } = await import("../src/lib/platform/errors");
const guards = await import("../src/lib/platform/guards");
const console_ = await import("../src/lib/platform/console");
const audit = await import("../src/lib/platform/audit");
const access = await import("../src/lib/platform/company-access");
const co = await import("../src/lib/platform/companies");
const tenantAuth = await import("../src/lib/auth");
const { seedSyntheticCompanies } = await import("../scripts/platform/company-fixtures");

// ---- deterministic platform clock ---------------------------------------------------------------
let nowMs = Math.floor(Date.now() / 1000) * 1000;
const realClock = platformClock.now;
platformClock.now = () => new Date(nowMs);
const nextStep = () => {
  nowMs = (totp.totpStepAt(new Date(nowMs)) + 1) * 30_000 + 1_000;
};
const DAY = 86_400_000;
const HOST = "companies.erp.test";
const headersFor = (ip = "203.0.113.25") => new Headers({ host: HOST, origin: `https://${HOST}`, "sec-fetch-site": "same-origin", "user-agent": "verify-platform-companies", "x-forwarded-for": ip });
const is = (code: Parameters<typeof isPlatformError>[1]) => (e: unknown) => isPlatformError(e, code);
const q = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];

// ---- SQL capture: every statement the read model (and its guard) sends through the pool ---------
type Captured = { text: string; values: unknown[] };
const captured: Captured[] = [];
let capturing = false;
const originalQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;
(pool as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
  if (capturing) {
    // drizzle's node-postgres driver calls query(config, params); plain callers pass (text, values).
    const first = args[0] as string | { text: string; values?: unknown[] };
    const second = Array.isArray(args[1]) ? (args[1] as unknown[]) : undefined;
    captured.push(typeof first === "string" ? { text: first, values: second ?? [] } : { text: first.text, values: first.values ?? second ?? [] });
  }
  return originalQuery(...args);
};
async function capture<T>(fn: () => Promise<T>): Promise<{ value: T; queries: Captured[] }> {
  captured.length = 0;
  capturing = true;
  try {
    const value = await fn();
    return { value, queries: [...captured] };
  } finally {
    capturing = false;
  }
}
const allCaptured: Captured[] = [];
const relationsOf = (text: string) => [...text.matchAll(/\b(?:from|join|into|update)\s+"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1].toLowerCase()).filter((r) => !["unnest", "lateral", "select"].includes(r));
const READ_RELATIONS = new Set(["orgs", "users", "tenant_access_controls", "organization_invitations", "platform_admins", "platform_audit_events", "platform_sessions"]);
/** The read model's own statements (the session guard's lookups of platform_sessions / platform_admins are not company reads). */
const isCompanyRead = (x: Captured) => relationsOf(x.text).some((r) => ["orgs", "users", "tenant_access_controls", "organization_invitations", "platform_audit_events"].includes(r));
const FORBIDDEN_COLUMNS = /"(password_hash|mfa_secret|mfa_recovery_codes|mfa_secret_encrypted|mfa_recovery_hashes|token_hash|tax_id|vat_number|address|phone|theme_overrides|primary_color|accent_color|seal_url|signature_url|custom_layout_url|default_bank_account_id|zatca_[a-z_]+)"|"orgs"\."email"/;

// ---- fixtures: two fictional operators, 1,000 synthetic companies, hand-made edge cases ---------
const STRONG = "Cedar-Lantern-58!q";
const secretsSeen: string[] = [STRONG];
type Admin = { id: string; email: string; secret: string; displayName: string };
async function createAdmin(email: string, displayName: string): Promise<Admin> {
  const { secret } = mfa.createTotpEnrollment(email);
  const { codes, hashes } = await mfa.createRecoveryCodeSet();
  const at = new Date(nowMs);
  const [row] = await db
    .insert(platformAdminsTable)
    .values({ emailNormalized: email, displayName, passwordHash: await auth.hashPlatformPassword(STRONG), isActive: true, mfaSecretEncrypted: mfa.encryptTotpSecret(secret), mfaRecoveryHashes: hashes, mfaEnrolledAt: at, passwordChangedAt: at, createdAt: at, updatedAt: at })
    .returning({ id: platformAdminsTable.id });
  secretsSeen.push(secret, ...codes);
  return { id: row.id, email, secret, displayName };
}
async function signIn(a: Admin, ip = "203.0.113.25"): Promise<string> {
  nextStep();
  const r = await console_.signInCore({ email: a.email, password: STRONG, totpCode: totp.hotpCode(a.secret, totp.totpStepAt(new Date(nowMs))) }, { headers: headersFor(ip) });
  if (!r.ok) throw new Error(`fixture sign-in failed: ${r.code}`);
  secretsSeen.push(r.token);
  return r.token;
}
const T = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

// Values that must never leave the database through the read model.
const SENSITIVE = {
  taxId: "300999999900003",
  vat: "VAT-SECRET-7781",
  address: "17 Fixture Secret Street, Riyadh",
  phone: "+966-5-0000-4242",
  companyEmail: "secret-contact@sensitive-fixture.test",
  logoUrl: "/uploads/sensitive/secret-logo-7781.png",
  primaryColor: "#123456",
  passwordHash: "$2a$04$SECRETHASHSECRETHASHSECRETHASHSECRETHASHSECRETHASH01",
  mfaSecret: "MFASECRETMARKER7781",
  recoveryCodes: "RECOVERYMARKER7781",
  tokenHash: "deadbeef".repeat(8),
  sessionTokenHash: "cafebabe".repeat(8),
  customerName: "Secret Customer Ledger Entry 7781",
};

type Fx = Record<string, number>;
async function seedEdgeCases(adminId: string): Promise<Fx> {
  const org = async (name: string, extra: Record<string, unknown> = {}, createdMs = nowMs - 2 * DAY) => {
    const row: Record<string, unknown> = { name, country: "Saudi Arabia", currency: "SAR", created_at: T(createdMs), updated_at: T(createdMs), ...extra };
    const cols = Object.keys(row);
    const r = await q<{ id: number }>(`insert into orgs (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(row));
    return r[0].id;
  };
  const user = (orgId: number, email: string, role: string, opts: { active?: boolean; login?: number | null; createdMs?: number; name?: string } = {}) =>
    q(`insert into users (org_id, email, password_hash, name, role, is_active, last_login_at, created_at, updated_at, password_changed_at, mfa_secret, mfa_recovery_codes) values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$8,$9,$10)`, [
      orgId,
      email,
      SENSITIVE.passwordHash,
      opts.name ?? `Fixture ${role} ${email.split("@")[0]}`,
      role,
      opts.active ?? true,
      opts.login === undefined || opts.login === null ? null : T(opts.login),
      T(opts.createdMs ?? nowMs - 2 * DAY),
      SENSITIVE.mfaSecret,
      SENSITIVE.recoveryCodes,
    ]);
  const fx: Fx = {};
  fx.wildcard = await org("Wildcard 100%_Off\\ Traders");
  fx.wildcardLookalikeA = await org("Wildcard 100XYOff Traders");
  fx.wildcardLookalikeB = await org("Wildcard 100 Off Traders");
  fx.arabic = await org("مؤسسة الاختبار الوهمية للتجارة", { country: "Kuwait", currency: "KWD" });
  fx.sensitive = await org("Sensitive Fixture Holdings", { tax_id: SENSITIVE.taxId, vat_number: SENSITIVE.vat, address: SENSITIVE.address, phone: SENSITIVE.phone, email: SENSITIVE.companyEmail, logo_url: SENSITIVE.logoUrl, primary_color: SENSITIVE.primaryColor });
  fx.fourOwners = await org("Four Owners Partnership");
  fx.noUsers = await org("Empty Shell Fixture Co");
  fx.noOwner = await org("Ownerless Fixture Co");
  fx.explicitActive = await org("Reactivated Fixture Co");
  fx.suspended = await org("Suspended Fixture Co");
  fx.drifted = await org("Drifted Status Fixture Co");
  // 21:30 UTC on the last day of a month is already the next month in Riyadh (UTC+3).
  fx.monthEdge = await org("Riyadh Month Edge Co", {}, Date.UTC(new Date(nowMs - 40 * DAY).getUTCFullYear(), new Date(nowMs - 40 * DAY).getUTCMonth() + 1, 0, 21, 30));
  fx.isolatedA = await org("Isolation Alpha Co");
  fx.isolatedB = await org("Isolation Beta Co");

  await user(fx.sensitive, "owner@sensitive-fixture.test", "owner", { login: nowMs - DAY });
  for (let i = 1; i <= 4; i++) await user(fx.fourOwners, `owner${i}@four-owners.test`, "owner", { createdMs: nowMs - (10 - i) * DAY, login: nowMs - i * DAY, active: i !== 2 });
  await user(fx.fourOwners, "staff.only@four-owners.test", "staff", { login: nowMs - 3 * 3_600_000 });
  await user(fx.fourOwners, "admin.one@four-owners.test", "admin", { active: false });
  await user(fx.noOwner, "admin@ownerless.test", "admin");
  await user(fx.noOwner, "staffmember-unique-7781@ownerless.test", "staff");
  await user(fx.wildcard, "owner@wildcard.test", "owner");
  await user(fx.arabic, "owner@arabic-fixture.test", "owner", { name: "مالك الاختبار" });
  for (const id of [fx.explicitActive, fx.suspended, fx.drifted, fx.monthEdge, fx.isolatedA, fx.isolatedB, fx.wildcardLookalikeA, fx.wildcardLookalikeB]) await user(id, `owner@org-${id}.test`, "owner");

  changedAtIso = new Date(nowMs - DAY).toISOString();
  await q(`insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at, created_at, updated_at) values ($1, 'active', 'Fixture: review completed', $3, $4, $4, $4), ($2, 'suspended', 'Fixture: suspended for review', $3, $4, $4, $4)`, [fx.explicitActive, fx.suspended, adminId, changedAtIso]);

  // A customer business table and a customer session that the read model must never read.
  await q(`insert into customers (org_id, name) values ($1, $2)`, [fx.sensitive, SENSITIVE.customerName]);
  const owner = await q<{ id: number }>(`select id from users where email = 'owner@sensitive-fixture.test'`);
  await q(`insert into sessions (org_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '1 day')`, [fx.sensitive, owner[0].id, SENSITIVE.sessionTokenHash]);

  // Invitations: one per state, all fictional; the token hash is a recognisable marker.
  const inv = (name: string, email: string, createdMs: number, extra: { accepted?: number; revoked?: boolean; hash?: string } = {}) =>
    q<{ id: string }>(
      `insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, expires_at, accepted_at, accepted_org_id, revoked_at, revoked_by_platform_admin_id, invited_by_platform_admin_id, created_at, updated_at)
       values ($1, 'hello@inv-fixture.test', 'Saudi Arabia', 'SAR', 'Fixture Invitee', $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) returning id`,
      [name, email, extra.hash ?? randomBytes(32).toString("hex"), new Date(createdMs + 72 * 3_600_000).toISOString(), extra.accepted ? new Date(createdMs + 3_600_000).toISOString() : null, extra.accepted ?? null, extra.revoked ? new Date(createdMs + 3_600_000).toISOString() : null, extra.revoked ? adminId : null, adminId, new Date(createdMs).toISOString()],
    );
  const pending = await inv("Pending Invite Fixture Co", "pending.owner@inv-fixture.test", nowMs - 3_600_000, { hash: SENSITIVE.tokenHash });
  const expired = await inv("Expired Invite Fixture Co", "expired.owner@inv-fixture.test", nowMs - 6 * DAY);
  await inv("Accepted Invite Fixture Co", "accepted.owner@inv-fixture.test", nowMs - 9 * DAY, { accepted: fx.isolatedB });
  await inv("Revoked Invite Fixture Co", "revoked.owner@inv-fixture.test", nowMs - 2 * DAY, { revoked: true });
  invitationIds.pending = pending[0].id;
  invitationIds.expired = expired[0].id;
  return fx;
}
const invitationIds: Record<string, string> = {};
let changedAtIso = "";

// Collects every value the read model returned, for the deep sensitive-value scan.
const outputs: unknown[] = [];
const keep = <T,>(v: T) => {
  outputs.push(v);
  return v;
};
const keysOf = (o: object) => Object.keys(o).sort().join(",");

async function main() {
  const operator = await createAdmin("operator@companies-fixture.test", "Fixture Operator");
  const second = await createAdmin("second@companies-fixture.test", "Second Operator");
  const client = await connectDisposable(process.env.DATABASE_URL!);
  let seeded: Awaited<ReturnType<typeof seedSyntheticCompanies>>;
  try {
    seeded = await seedSyntheticCompanies(client, { companies: 1000, adminId: operator.id, now: new Date(nowMs - 3 * DAY) });
  } finally {
    await client.end();
  }
  const fx = await seedEdgeCases(operator.id);
  const token = await signIn(operator);
  const req = { headers: headersFor(), token };
  const orgCount = Number((await q<{ n: number }>("select count(*)::int n from orgs"))[0].n);
  const checksum = async (table: string) => (await q<{ h: string }>(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) h from ${table} x`))[0].h;
  const before = { orgs: await checksum("orgs"), users: await checksum("users"), sessions: await checksum("sessions"), customers: await checksum("customers"), tac: await checksum("tenant_access_controls"), inv: await checksum("organization_invitations") };
  const viewEvents = async () => Number((await q<{ n: number }>("select count(*)::int n from platform_audit_events where action = 'company.viewed'"))[0].n);

  section("1. Authorization: flag → live platform session → platform.companies.read; customer tokens refused");
  {
    ok("PLATFORM_PERMISSIONS gains exactly platform.companies.read", JSON.stringify(guards.PLATFORM_PERMISSIONS) === JSON.stringify(["platform.access", "platform.sessions.manage", "platform.mfa.manage", "platform.companies.read"]));
    const ctx = await guards.authorizePlatformToken(token, "platform.companies.read");
    ok("a live platform session is granted platform.companies.read", ctx.adminId === operator.id);
    await rejects("a permission outside the allowlist (platform.companies.write) → FORBIDDEN", () => guards.authorizePlatformToken(token, "platform.companies.write" as never), is("FORBIDDEN"));
    const ops: [string, (r: { headers: Headers; token: string | null }) => Promise<unknown>][] = [
      ["listCompanies", (r) => co.listCompanies(r, {})],
      ["listCompanyCountries", (r) => co.listCompanyCountries(r)],
      ["listPendingInvitations", (r) => co.listPendingInvitations(r, {})],
      ["companyMetrics", (r) => co.companyMetrics(r)],
      ["getCompanyDetail", (r) => co.getCompanyDetail(r, String(fx.sensitive))],
    ];
    const views0 = await viewEvents();
    const customerOwner = (await q<{ id: number }>("select id from users where email = 'owner@sensitive-fixture.test'"))[0].id;
    const customerToken = await tenantAuth.signSessionToken({ userId: customerOwner, orgId: fx.sensitive, jti: randomBytes(16).toString("hex") });
    const revoked = await signIn(operator);
    await console_.signOutCore({ headers: headersFor(), token: revoked });
    for (const [name, op] of ops) {
      await rejects(`${name}: no token → UNAUTHORIZED`, () => op({ headers: headersFor(), token: null }), is("UNAUTHORIZED"));
      await rejects(`${name}: forged token → UNAUTHORIZED`, () => op({ headers: headersFor(), token: "eyJhbGciOiJIUzI1NiJ9.e30.forged" }), is("UNAUTHORIZED"));
      await rejects(`${name}: a CUSTOMER session token → UNAUTHORIZED`, () => op({ headers: headersFor(), token: customerToken }), is("UNAUTHORIZED"));
      await rejects(`${name}: a revoked platform session → UNAUTHORIZED`, () => op({ headers: headersFor(), token: revoked }), is("UNAUTHORIZED"));
      process.env.PLATFORM_CONSOLE_ENABLED = "false";
      await rejects(`${name}: feature flag off → CONSOLE_DISABLED`, () => op(req), is("CONSOLE_DISABLED"));
      process.env.PLATFORM_CONSOLE_ENABLED = "true";
    }
    const expiring = await signIn(second);
    const saved = nowMs;
    nowMs += 31 * 60_000;
    await rejects("a platform session idle for more than 30 minutes → SESSION_EXPIRED", () => co.listCompanies({ headers: headersFor(), token: expiring }, {}), is("SESSION_EXPIRED"));
    nowMs = saved;
    ok("no rejected call wrote a company.viewed record", (await viewEvents()) === views0);
  }

  section("2. Field allowlist: exact output shapes, and no sensitive value anywhere in the output");
  {
    const page = keep(await co.listCompanies(req, { q: "Sensitive Fixture" }));
    const row = page.rows[0];
    ok("list page keys: query, rows, total, offset, next, prev, invitationReference", keysOf(page) === "invitationReference,next,offset,prev,query,rows,total");
    ok("list row keys are the allowlist only", !!row && keysOf(row) === "access,country,createdAt,currency,hasLogo,industry,name,orgId,primaryOwner,reference,users", row ? keysOf(row) : "no row");
    ok("…access {status, source}, users {total, active, owners, lastSignInAt}, owner {name, email}", !!row && keysOf(row.access) === "source,status" && keysOf(row.users) === "active,lastSignInAt,owners,total" && !!row.primaryOwner && keysOf(row.primaryOwner) === "email,name");
    ok("logo presence is a boolean: true for the company with a logo, the URL itself absent", row?.hasLogo === true && !JSON.stringify(page).includes("secret-logo"));
    const detail = keep(await co.getCompanyDetail(req, String(fx.sensitive)));
    ok("detail keys are the allowlist only", keysOf(detail) === "access,activity,country,createdAt,currency,hasLogo,industry,name,orgId,owners,reference,users", keysOf(detail));
    ok("…access {status, source, reason, changedAt, changedBy}; owners {name, email}", keysOf(detail.access) === "changedAt,changedBy,reason,source,status" && detail.owners.every((o) => keysOf(o) === "email,name"));
    const invs = keep(await co.listPendingInvitations(req, {}));
    ok("invitation row keys: reference, company, owner e-mail, country, created, expires, state", invs.rows.length > 0 && invs.rows.every((r) => keysOf(r) === "companyName,country,createdAt,expiresAt,ownerEmail,reference,state"));
    const metrics = keep(await co.companyMetrics(req));
    ok("metrics keys: companies, invitations, users, registrations, newest", keysOf(metrics) === "companies,invitations,newest,registrations,users" && metrics.newest.every((n) => keysOf(n) === "createdAt,name,orgId,reference"));
    keep(await co.listCompanyCountries(req));
    keep(await co.listCompanies(req, { size: "50" }));
    keep(await co.listCompanies(req, { q: "owner@sensitive" }));
  }

  section("3. The SQL actually sent: allow-listed tables and columns, values as bound parameters");
  {
    const probes: [string, () => Promise<unknown>][] = [
      ["list (search, filter, sort)", () => co.listCompanies(req, { q: "Trading", access: "active", country: "Saudi Arabia", sort: "name", size: "50" })],
      ["list next page", async () => co.listCompanies(req, { after: (await co.listCompanies(req, {})).next })],
      ["countries", () => co.listCompanyCountries(req)],
      ["invitations", () => co.listPendingInvitations(req, { q: "fixture" })],
      ["metrics", () => co.companyMetrics(req)],
      ["detail", () => co.getCompanyDetail(req, String(fx.sensitive))],
    ];
    for (const [name, probe] of probes) {
      const { queries } = await capture(probe);
      allCaptured.push(...queries);
      const relations = [...new Set(queries.flatMap((x) => relationsOf(x.text)))].sort();
      ok(`${name}: reads only ${relations.join(", ")} (no customer business table, no customer sessions)`, relations.length > 0 && relations.every((r) => READ_RELATIONS.has(r)), relations.join(","));
      const reads = queries.filter(isCompanyRead);
      const bad = reads.filter((x) => FORBIDDEN_COLUMNS.test(x.text));
      ok(`${name}: its ${reads.length} company queries name no secret, contact, tax, branding or settings column`, reads.length > 0 && bad.length === 0, bad.map((x) => x.text.slice(0, 120)).join(" | "));
      ok(`${name}: no "select *"`, queries.every((x) => !/select \*/i.test(x.text)));
    }
    const logoUses = allCaptured.filter((x) => /logo_url/.test(x.text));
    ok("the logo column only ever appears inside the presence test", logoUses.length > 0 && logoUses.every((x) => (x.text.match(/"logo_url"/g) ?? []).length === (x.text.match(/\("orgs"\."logo_url" is not null and "orgs"\."logo_url" <> ''\)/g) ?? []).length * 2));
    const hostile = "Robert'); DROP TABLE orgs; --";
    const { value, queries } = await capture(() => co.listCompanies(req, { q: hostile }));
    ok("a hostile search term travels only as a bound parameter (never in the SQL text)", queries.every((x) => !x.text.includes("DROP TABLE")) && queries.some((x) => x.values.some((v) => typeof v === "string" && v.includes("DROP TABLE"))));
    ok("…matches nothing and changes nothing", value.total === 0 && Number((await q<{ n: number }>("select count(*)::int n from orgs"))[0].n) === orgCount);
  }

  section("4. Search: wildcards escaped, case-insensitive, Arabic, owner e-mails only, ORG / INV references, bounds");
  {
    const names = async (term: string) => (await co.listCompanies(req, { q: term, size: "50" })).rows.map((r) => r.name);
    const literal = async (needle: string) => Number((await q<{ n: number }>("select count(*)::int n from orgs where strpos(lower(name), lower($1)) > 0 or id in (select org_id from users where role = 'owner' and strpos(lower(email), lower($1)) > 0)", [needle]))[0].n);
    for (const term of ["%", "_", "\\", "100%_Off\\", "%_"]) {
      const page = await co.listCompanies(req, { q: term, size: "50" });
      ok(`"${term}" matches only literal occurrences (${page.total} = independent count)`, page.total === (await literal(term)) && page.total <= 3);
    }
    ok("the wildcard company is found by its literal text, and its look-alikes are not", JSON.stringify(await names("100%_Off\\")) === JSON.stringify(["Wildcard 100%_Off\\ Traders"]));
    ok("name search is case-insensitive", (await names("wILDCARD 100%")).includes("Wildcard 100%_Off\\ Traders"));
    ok("Arabic search finds the Arabic-named company", (await names("الاختبار الوهمية")).includes("مؤسسة الاختبار الوهمية للتجارة"));
    ok("an OWNER's e-mail finds its company", (await names("owner3@four-owners")).includes("Four Owners Partnership"));
    ok("a STAFF member's e-mail finds nothing (only owner e-mails are searchable)", (await co.listCompanies(req, { q: "staffmember-unique-7781" })).total === 0);
    const ref = await co.listCompanies(req, { q: `ORG-${String(fx.fourOwners).padStart(6, "0")}` });
    ok("an ORG reference finds exactly that organization", ref.total === 1 && ref.rows[0].orgId === fx.fourOwners);
    ok("…also without padding or dash, any case (org-<id>)", (await co.listCompanies(req, { q: `org${fx.fourOwners}` })).rows.some((r) => r.orgId === fx.fourOwners));
    const invRef = co.invitationReference(invitationIds.pending);
    const inReg = await co.listCompanies(req, { q: invRef });
    ok("an INV reference in the registered view is flagged for the invitations view (never mistaken for an org)", inReg.invitationReference === true && inReg.total === 0);
    const inv = await co.listPendingInvitations(req, { q: invRef.toLowerCase() });
    ok("…and in the invitations view finds exactly that invitation", inv.total === 1 && inv.rows[0].reference === invRef);
    ok("100 characters are accepted", (await co.listCompanies(req, { q: "a".repeat(100) })).total === 0);
    ok("surrounding spaces are trimmed", (await co.listCompanies(req, { q: "   Four Owners Partnership   " })).total === 1);
    for (const [label, bad] of [["101 characters", "a".repeat(101)], ["a NUL byte", "a\u0000b"], ["a control character", "a\u0007b"], ["a repeated parameter", ["a", "b"]]] as const) {
      await rejects(`search with ${label} → VALIDATION_FAILED (never reaches the database)`, () => co.listCompanies(req, { q: bad }), is("VALIDATION_FAILED"));
    }
  }

  section("5. Filters and the sort allowlist");
  {
    const truth = async (where: string, values: unknown[] = []) => Number((await q<{ n: number }>(`select count(*)::int n from orgs o left join tenant_access_controls t on t.org_id = o.id where ${where}`, values))[0].n);
    const effective = `(case when t.org_id is null then 'active' when t.access_status = 'active' then 'active' else 'suspended' end)`;
    ok("access=active total equals the independent count", (await co.listCompanies(req, { access: "active" })).total === (await truth(`${effective} = 'active'`)));
    const susp = await co.listCompanies(req, { access: "suspended", size: "50" });
    ok("access=suspended total equals the independent count and every row is suspended", susp.total === (await truth(`${effective} = 'suspended'`)) && susp.rows.every((r) => r.access.status === "suspended"));
    ok("country filter is exact and matches the independent count", (await co.listCompanies(req, { country: "Kuwait" })).total === (await truth("o.country = 'Kuwait'")));
    ok("an unknown country returns nothing (no error)", (await co.listCompanies(req, { country: "Atlantis" })).total === 0);
    ok("combined filters match the independent count", (await co.listCompanies(req, { access: "active", country: "Saudi Arabia", q: "Trading" })).total === (await truth(`${effective} = 'active' and o.country = 'Saudi Arabia' and (o.name ilike '%Trading%' or o.id in (select org_id from users where role = 'owner' and email ilike '%Trading%'))`)));
    for (const [sort, order] of [
      ["newest", "o.created_at desc, o.id desc"],
      ["oldest", "o.created_at asc, o.id asc"],
      ["name", "lower(o.name) asc, o.id asc"],
    ] as const) {
      const expected = (await q<{ id: number }>(`select o.id from orgs o order by ${order} limit 50`)).map((r) => r.id);
      const got = (await co.listCompanies(req, { sort, size: "50" })).rows.map((r) => r.orgId);
      ok(`sort=${sort} returns the first page in the independent order`, JSON.stringify(got) === JSON.stringify(expected));
    }
    for (const [label, input] of [
      ["an unknown sort", { sort: "created_at; drop table orgs" }],
      ["an unknown access value", { access: "paused" }],
      ["size 51", { size: "51" }],
      ["size 0", { size: "0" }],
      ["a non-numeric size", { size: "ten" }],
    ] as const) {
      await rejects(`${label} → VALIDATION_FAILED`, () => co.listCompanies(req, input as never), is("VALIDATION_FAILED"));
    }
    ok("the default page size is 25 and size 50 returns at most 50", (await co.listCompanies(req, {})).rows.length === 25 && (await co.listCompanies(req, { size: "50" })).rows.length === 50);
  }

  section("6. Keyset pagination: complete, without duplicates, in both directions, ties and inserts included");
  {
    const ties = Number((await q<{ n: number }>("select count(*)::int n from (select created_at from orgs group by created_at having count(*) > 1) x"))[0].n);
    ok(`the data set contains equal creation timestamps (${ties} tied instants) and microsecond precision`, ties >= 20 && Number((await q<{ n: number }>("select count(*)::int n from orgs where extract(microseconds from created_at)::int % 1000 <> 0"))[0].n) > 100);
    const walk = async (input: Record<string, unknown>, direction: "after" | "before" = "after") => {
      const ids: number[] = [];
      const offsets: number[] = [];
      let page = await co.listCompanies(req, input);
      if (direction === "before") {
        while (page.next) page = await co.listCompanies(req, { ...input, after: page.next });
        for (;;) {
          ids.unshift(...page.rows.map((r) => r.orgId));
          offsets.unshift(page.offset);
          if (!page.prev) break;
          page = await co.listCompanies(req, { ...input, before: page.prev });
        }
        return { ids, offsets, total: page.total };
      }
      for (;;) {
        ids.push(...page.rows.map((r) => r.orgId));
        offsets.push(page.offset);
        if (!page.next) break;
        page = await co.listCompanies(req, { ...input, after: page.next });
      }
      return { ids, offsets, total: page.total };
    };
    const orderSql: Record<string, string> = { newest: "o.created_at desc, o.id desc", oldest: "o.created_at asc, o.id asc", name: "lower(o.name) asc, o.id asc" };
    for (const sort of ["newest", "oldest", "name"]) {
      const expected = (await q<{ id: number }>(`select o.id from orgs o order by ${orderSql[sort]}`)).map((r) => r.id);
      const fwd = await walk({ sort, size: "50" });
      ok(`sort=${sort}: walking forward visits all ${expected.length} organizations once, in order`, JSON.stringify(fwd.ids) === JSON.stringify(expected));
      ok(`sort=${sort}: each page's offset is its position`, fwd.offsets.every((o, i) => o === i * 50));
      const back = await walk({ sort, size: "50" }, "before");
      ok(`sort=${sort}: walking backward from the last page yields the same sequence`, JSON.stringify(back.ids) === JSON.stringify(expected));
    }
    const filtered = (await q<{ id: number }>(`select o.id from orgs o left join tenant_access_controls t on t.org_id = o.id where (case when t.org_id is null then 'active' when t.access_status = 'active' then 'active' else 'suspended' end) = 'active' and o.country = 'Saudi Arabia' order by o.created_at desc, o.id desc`)).map((r) => r.id);
    ok("with access + country filters: complete and in order", JSON.stringify((await walk({ access: "active", country: "Saudi Arabia", size: "50" })).ids) === JSON.stringify(filtered));
    const searched = (await q<{ id: number }>(`select o.id from orgs o where o.name ilike '%Trading%' or o.id in (select org_id from users where role = 'owner' and email ilike '%Trading%') order by lower(o.name), o.id`)).map((r) => r.id);
    ok("with a search and name sort: complete and in order", JSON.stringify((await walk({ q: "Trading", sort: "name", size: "25" })).ids) === JSON.stringify(searched));

    const first = await co.listCompanies(req, { size: "25" });
    const firstIds = first.rows.map((r) => r.orgId);
    const inserted = (await q<{ id: number }>(`insert into orgs (name, created_at) values ('Inserted Mid-Walk Co', $1) returning id`, [T(nowMs)]))[0].id;
    const second2 = await co.listCompanies(req, { size: "25", after: first.next });
    const expectedSecond = (await q<{ id: number }>(`select id from orgs where id <> $1 order by created_at desc, id desc offset 25 limit 25`, [inserted])).map((r) => r.id);
    ok("a company created between two page loads neither duplicates nor hides a row of the next page", JSON.stringify(second2.rows.map((r) => r.orgId)) === JSON.stringify(expectedSecond) && !firstIds.includes(inserted) && !second2.rows.some((r) => r.orgId === inserted));
    ok("…and it appears on a fresh first page", (await co.listCompanies(req, { size: "25" })).rows[0].orgId === inserted);
    await q("delete from orgs where id = $1", [inserted]);

    const newestCursor = (await co.listCompanies(req, {})).next!;
    for (const [label, input] of [
      ["a cursor reused with another sort", { sort: "name", after: newestCursor }],
      ["a cursor reused with another search", { q: "Trading", after: newestCursor }],
      ["a cursor reused with another filter", { access: "suspended", after: newestCursor }],
      ["a cursor with a tampered fingerprint", { after: newestCursor.replace(/\.[0-9a-f]{8}$/, ".00000000") }],
      ["a cursor for an organization that does not exist", { after: `2000000000.${newestCursor.split(".")[1]}` }],
      ["after and before together", { after: newestCursor, before: newestCursor }],
      ["a malformed cursor", { after: "1;select" }],
    ] as const) {
      await rejects(`${label} → VALIDATION_FAILED`, () => co.listCompanies(req, input as never), is("VALIDATION_FAILED"));
    }
  }

  section("7. Company access: the PO-02A compatibility rule, fail-closed included");
  {
    const one = async (id: number) => (await co.listCompanies(req, { q: `ORG-${id}` })).rows.find((r) => r.orgId === id)!;
    const legacy = await one(fx.fourOwners);
    ok("no access row → active, marked legacy_default", legacy.access.status === "active" && legacy.access.source === "legacy_default");
    const explicit = await one(fx.explicitActive);
    ok("explicit active row → active from the access record", explicit.access.status === "active" && explicit.access.source === "access_control");
    const susp = await one(fx.suspended);
    ok("suspended row → suspended from the access record", susp.access.status === "suspended" && susp.access.source === "access_control");
    const d = await co.getCompanyDetail(req, String(fx.suspended));
    ok("detail: reason, change time and the responsible operator's label", d.access.reason === "Fixture: suspended for review" && d.access.changedBy === "Fixture Operator" && d.access.changedAt instanceof Date && d.access.changedAt.toISOString() === changedAtIso);
    await q("alter table tenant_access_controls drop constraint tenant_access_controls_status_chk");
    await q("insert into tenant_access_controls (org_id, access_status) values ($1, 'paused')", [fx.drifted]);
    try {
      const drifted = await one(fx.drifted);
      ok("a drifted stored value ('paused') → suspended, invalid_state (fails closed)", drifted.access.status === "suspended" && drifted.access.source === "invalid_state");
      ok("…the suspended filter includes it, the active filter does not", (await co.listCompanies(req, { access: "suspended", q: "Drifted Status" })).total === 1 && (await co.listCompanies(req, { access: "active", q: "Drifted Status" })).total === 0);
      const dd = await co.getCompanyDetail(req, String(fx.drifted));
      ok("…the detail view agrees (getTenantAccess)", dd.access.status === "suspended" && dd.access.source === "invalid_state");
      const all = await q<{ id: number; status: string; row: number | null; stored: string | null }>(`select o.id, ${"(case when t.org_id is null then 'active' when t.access_status = 'active' then 'active' else 'suspended' end)"} status, t.org_id row, t.access_status stored from orgs o left join tenant_access_controls t on t.org_id = o.id`);
      ok(`the SQL rule and the JS rule agree for all ${all.length} organizations`, all.every((r) => access.resolveTenantAccess(r.row === null ? null : { accessStatus: r.stored }).status === r.status));
      const m = await co.companyMetrics(req);
      ok("metrics count the drifted company as suspended", m.companies.suspended === Number((await q<{ n: number }>("select count(*)::int n from tenant_access_controls where access_status <> 'active'"))[0].n));
    } finally {
      await q("delete from tenant_access_controls where org_id = $1", [fx.drifted]);
      await q("alter table tenant_access_controls add constraint tenant_access_controls_status_chk check (access_status in ('active', 'suspended'))");
    }
    ok("the status check constraint is restored", Number((await q<{ n: number }>("select count(*)::int n from pg_constraint where conname = 'tenant_access_controls_status_chk' and convalidated"))[0].n) === 1);
    const src = readFileSync(join(process.cwd(), "src/lib/platform/companies.ts"), "utf8");
    ok("no subscription, package or trial state enters the access decision (none is referenced)", !/subscri|package|trial|billing/i.test(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
  }

  section("8. Owners and user aggregates (independent SQL), never staff or admins as owners");
  {
    const truth = async (id: number) => (await q<{ total: number; active: number; owners: number; last: string | null }>(`select count(*)::int total, (count(*) filter (where is_active))::int active, (count(*) filter (where role = 'owner'))::int owners, to_char(max(last_login_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS') last from users where org_id = $1`, [id]))[0];
    for (const id of [fx.fourOwners, fx.noOwner, fx.noUsers, fx.sensitive, seeded.orgIds[10], seeded.orgIds[500]]) {
      const row = (await co.listCompanies(req, { q: `ORG-${id}` })).rows.find((r) => r.orgId === id)!;
      const t = await truth(id);
      ok(`org ${id}: users ${row.users.total}/${row.users.active} active/${row.users.owners} owners and the last sign-in equal the database`, row.users.total === t.total && row.users.active === t.active && row.users.owners === t.owners && (row.users.lastSignInAt === null ? t.last === null : row.users.lastSignInAt.toISOString().slice(0, 23) === t.last));
    }
    const four = await co.getCompanyDetail(req, String(fx.fourOwners));
    ok("four owners: the detail shows the three oldest (by account age) and counts all four", four.owners.map((o) => o.email).join(",") === "owner1@four-owners.test,owner2@four-owners.test,owner3@four-owners.test" && four.users.owners === 4);
    const fourRow = (await co.listCompanies(req, { q: "Four Owners Partnership" })).rows[0];
    ok("the list shows only the first owner", fourRow.primaryOwner?.email === "owner1@four-owners.test");
    const none = await co.getCompanyDetail(req, String(fx.noOwner));
    ok("no owner: empty owner list although admins and staff exist", none.owners.length === 0 && none.users.total === 2 && (await co.listCompanies(req, { q: "Ownerless Fixture" })).rows[0].primaryOwner === null);
    const empty = await co.getCompanyDetail(req, String(fx.noUsers));
    ok("no users: zero counts and no last sign-in", empty.users.total === 0 && empty.users.lastSignInAt === null && empty.owners.length === 0);
    const owners = (await co.listCompanies(req, { size: "50" })).rows.flatMap((r) => (r.primaryOwner ? [r.primaryOwner.email] : []));
    const roles = await q<{ role: string }>("select distinct role from users where email = any($1)", [owners]);
    ok("every owner shown on a page belongs to an owner-role user", roles.length === 1 && roles[0].role === "owner");
  }

  section("9. Pending invitations: read-only, the PO-02A slot predicate, no token material");
  {
    const all: string[] = [];
    let page = await co.listPendingInvitations(req, { size: "5" });
    for (;;) {
      all.push(...page.rows.map((r) => r.reference));
      if (!page.next) break;
      page = await co.listPendingInvitations(req, { size: "5", after: page.next });
    }
    const slots = await q<{ id: string; pending: boolean }>(`select id, expires_at > $1::timestamptz pending from organization_invitations where accepted_at is null and revoked_at is null order by created_at desc, id desc`, [new Date(nowMs).toISOString()]);
    ok(`exactly the ${slots.length} slot-holding invitations (not accepted, not revoked), newest first, across pages`, JSON.stringify(all) === JSON.stringify(slots.map((s) => co.invitationReference(s.id))));
    const states = keep(await co.listPendingInvitations(req, { size: "50" }));
    const byRef = new Map(slots.map((s) => [co.invitationReference(s.id), s.pending ? "pending" : "expired"]));
    ok("each state (pending / expired) is derived from the expiry time", states.rows.every((r) => byRef.get(r.reference) === r.state) && states.rows.some((r) => r.state === "expired") && states.rows.some((r) => r.state === "pending"));
    ok("state filters: pending + expired = all", (await co.listPendingInvitations(req, { state: "pending" })).total + (await co.listPendingInvitations(req, { state: "expired" })).total === slots.length);
    await rejects("an unknown state → VALIDATION_FAILED", () => co.listPendingInvitations(req, { state: "accepted" }), is("VALIDATION_FAILED"));
    ok("accepted and revoked invitations are never listed", !(await co.listPendingInvitations(req, { q: "Accepted Invite Fixture" })).total && !(await co.listPendingInvitations(req, { q: "Revoked Invite Fixture" })).total);
    ok("references are INV- plus 8 upper-case hex characters (never an org id)", states.rows.every((r) => /^INV-[0-9A-F]{8}$/.test(r.reference)));
    const { queries } = await capture(() => co.listPendingInvitations(req, { q: "fixture" }));
    ok("the invitation queries never name the token hash column", queries.filter(isCompanyRead).length >= 2 && queries.filter(isCompanyRead).every((x) => !/token_hash/.test(x.text)));
    ok("the marker token hash appears in no output", !JSON.stringify(outputs).includes(SENSITIVE.tokenHash));
    let duplicate = "";
    await pool.query("begin");
    try {
      await pool.query(`insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, invited_by_platform_admin_id) values ('Second Try Co', 'a@b.test', 'Saudi Arabia', 'SAR', 'X', 'expired.owner@inv-fixture.test', $1, $2)`, [randomBytes(32).toString("hex"), operator.id]);
    } catch (e) {
      duplicate = String((e as { code?: string }).code ?? "");
    } finally {
      await pool.query("rollback");
    }
    ok("PO-02A's slot rule is intact: an expired, unrevoked invitation still blocks a new one for the same e-mail (23505)", duplicate === "23505" && states.rows.some((r) => r.ownerEmail === "expired.owner@inv-fixture.test" && r.state === "expired"));
  }

  section("10. The company detail view: audited, or not shown at all");
  {
    const n0 = await viewEvents();
    nextStep();
    const d = await co.getCompanyDetail({ headers: headersFor("198.51.100.77"), token }, String(fx.isolatedA));
    const ev = (await q<{ actor_platform_admin_id: string; actor_label: string; entity_type: string; entity_id: string; org_id: number; result: string; ip_address: string; request_id: string; reason: string | null; before_safe: unknown; after_safe: unknown }>(`select * from platform_audit_events where action = 'company.viewed' order by id desc limit 1`))[0];
    ok("a view writes exactly one company.viewed record", (await viewEvents()) === n0 + 1 && d.orgId === fx.isolatedA);
    ok("…on organization/<decimal id>, with the org id, the operator, success, the trusted client IP and a request id", ev.entity_type === "organization" && ev.entity_id === String(fx.isolatedA) && ev.org_id === fx.isolatedA && ev.actor_platform_admin_id === operator.id && ev.actor_label === "Fixture Operator" && ev.result === "success" && ev.ip_address === "198.51.100.77" && /^[0-9a-f-]{36}$/.test(ev.request_id) && ev.before_safe === null && ev.after_safe === null);
    nextStep();
    const again = await co.getCompanyDetail(req, String(fx.isolatedA));
    ok("the next view lists the earlier view in the company's activity (newest first)", again.activity.rows.length >= 1 && again.activity.rows[0].action === "company.viewed" && again.activity.rows[0].actor === "Fixture Operator");
    for (let i = 0; i < 24; i++) {
      nextStep();
      await co.getCompanyDetail(req, String(fx.isolatedA));
    }
    nextStep();
    await co.getCompanyDetail(req, String(fx.isolatedB));
    const paged = await co.getCompanyDetail(req, String(fx.isolatedA));
    const rest = await co.getCompanyDetail(req, String(fx.isolatedA), { activity: paged.activity.next });
    const expectedIds = (await q<{ id: number }>(`select id from platform_audit_events where org_id = $1 order by created_at desc, id desc`, [fx.isolatedA])).map((r) => Number(r.id));
    const seen = [...paged.activity.rows, ...rest.activity.rows].map((r) => r.id);
    // The two newest events are the records these two views wrote themselves (after their reads).
    ok("activity pages: 20 per page, then the older ones, no duplicates (cursor = last event id)", paged.activity.rows.length === 20 && paged.activity.next !== null && rest.activity.rows.length === 6 && new Set(seen).size === seen.length && JSON.stringify(seen) === JSON.stringify(expectedIds.slice(2, 2 + seen.length)));
    ok("activity is restricted to the exact organization (another company's views never appear)", [...paged.activity.rows, ...rest.activity.rows].every((r) => expectedIds.includes(r.id)));
    const otherEvent = (await q<{ id: number }>(`select id from platform_audit_events where org_id = $1 limit 1`, [fx.isolatedB]))[0].id;
    await rejects("an activity cursor from another company → VALIDATION_FAILED", () => co.getCompanyDetail(req, String(fx.isolatedA), { activity: String(otherEvent) }), is("VALIDATION_FAILED"));
    await rejects("a malformed activity cursor → VALIDATION_FAILED", () => co.getCompanyDetail(req, String(fx.isolatedA), { activity: "1 or 1=1" }), is("VALIDATION_FAILED"));

    const n1 = await viewEvents();
    for (const bad of ["0", "-1", "1.5", "abc", "1e3", " 1", "01", "2147483648", "", "999999999"]) {
      await rejects(`id "${bad}" → NOT_FOUND`, () => co.getCompanyDetail(req, bad), is("NOT_FOUND"));
    }
    await rejects("a non-string id → NOT_FOUND", () => co.getCompanyDetail(req, 5 as unknown as string), is("NOT_FOUND"));
    ok("unknown and malformed ids write no audit record", (await viewEvents()) === n1);

    const incidents: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => void incidents.push(args.map(String).join(" "));
    await q(`create or replace function po02b_test_only_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit outage (test only)'; end $$`);
    await q(`create trigger po02b_test_only_fail_audit before insert on platform_audit_events for each row execute function po02b_test_only_fail_audit()`);
    let leaked: unknown = null;
    try {
      nextStep();
      await rejects("audit outage: the detail view fails with AUDIT_UNAVAILABLE", async () => {
        leaked = await co.getCompanyDetail(req, String(fx.sensitive));
      }, is("AUDIT_UNAVAILABLE"));
    } finally {
      await q(`drop trigger if exists po02b_test_only_fail_audit on platform_audit_events`);
      await q(`drop function if exists po02b_test_only_fail_audit()`);
      console.error = origError;
    }
    ok("…returns no company data at all", leaked === null);
    ok("…and logs a security incident (audit_write_failed, company.viewed) without any detail", incidents.some((l) => l.includes("[platform-security-incident]") && l.includes('"type":"audit_write_failed"') && l.includes('"action":"company.viewed"')) && !incidents.join("\n").includes("Sensitive Fixture"));
    ok("…and the outage wrote nothing", (await viewEvents()) === n1);
    await q("alter table platform_audit_events disable trigger platform_audit_events_immutable");
    try {
      await rejects("audit protection missing (append-only trigger disabled) → CONFIG_ERROR, before any read", async () => {
        await audit.assertPlatformAuditProtection({ force: true }).catch(() => undefined);
        await co.getCompanyDetail(req, String(fx.sensitive));
      }, is("CONFIG_ERROR"));
    } finally {
      await q("alter table platform_audit_events enable trigger platform_audit_events_immutable");
      await audit.assertPlatformAuditProtection({ force: true });
    }
    ok("…and no record was written while it was missing", (await viewEvents()) === n1);
    const n2 = await viewEvents();
    await co.listCompanies(req, {});
    await co.listPendingInvitations(req, {});
    await co.companyMetrics(req);
    await co.listCompanyCountries(req);
    ok("list, invitations, metrics and countries write no audit record (only detail views do)", (await viewEvents()) === n2);
  }

  section("11. Metrics against the database");
  {
    const m = keep(await co.companyMetrics(req));
    const t = (await q<Record<string, number>>(`select count(*)::int total, (count(*) filter (where t.org_id is null or t.access_status = 'active'))::int active, (count(*) filter (where t.org_id is not null and t.access_status <> 'active'))::int suspended, (count(*) filter (where t.org_id is null))::int legacy from orgs o left join tenant_access_controls t on t.org_id = o.id`))[0];
    ok("companies: total / active / suspended / legacy default equal the database", m.companies.total === t.total && m.companies.active === t.active && m.companies.suspended === t.suspended && m.companies.legacyDefault === t.legacy);
    const recent = Number((await q<{ n: number }>(`select count(*)::int n from orgs where created_at > ($1::timestamptz - interval '30 days') at time zone 'UTC'`, [new Date(nowMs).toISOString()]))[0].n);
    ok("registered in the last 30 days equals the database", m.companies.registeredLast30Days === recent);
    const inv = (await q<Record<string, number>>(`select (count(*) filter (where expires_at > $1::timestamptz))::int pending, (count(*) filter (where expires_at <= $1::timestamptz))::int expired from organization_invitations where accepted_at is null and revoked_at is null`, [new Date(nowMs).toISOString()]))[0];
    ok("invitations pending / expired equal the slot-holding rows", m.invitations.pending === inv.pending && m.invitations.expired === inv.expired);
    const u = (await q<Record<string, number>>(`select count(*)::int total, (count(*) filter (where is_active))::int active from users`))[0];
    ok("customer users total / active equal the database", m.users.total === u.total && m.users.active === u.active);
    const riyadhKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
    const created = await q<{ iso: string }>(`select to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') iso from orgs`);
    const counts = new Map<string, number>();
    for (const r of created) counts.set(riyadhKey(new Date(r.iso)), (counts.get(riyadhKey(new Date(r.iso))) ?? 0) + 1);
    ok("six Riyadh months, oldest first, ending with the current one", m.registrations.length === 6 && m.registrations[5].month === riyadhKey(new Date(nowMs)));
    ok("each month's count equals an independent Riyadh-time bucketing", m.registrations.every((r) => r.count === (counts.get(r.month) ?? 0)));
    const edge = (await q<{ iso: string }>(`select to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') iso from orgs where id = $1`, [fx.monthEdge]))[0].iso;
    ok(`a company created ${edge.slice(0, 16)} UTC counts in Riyadh's next month (${riyadhKey(new Date(edge))})`, new Date(edge).getUTCMonth() !== Number(riyadhKey(new Date(edge)).slice(5)) - 1);
    const newest = (await q<{ id: number }>(`select id from orgs order by created_at desc, id desc limit 5`)).map((r) => r.id);
    ok("newest companies: the five most recent (created_at, id)", JSON.stringify(m.newest.map((n) => n.orgId)) === JSON.stringify(newest));
  }

  section("12. Performance at 1,000+ organizations: p95, query counts, plans (measured)");
  {
    let page9Cursor: string | null = null;
    {
      let p = await co.listCompanies(req, {});
      for (let i = 1; i < 9; i++) p = await co.listCompanies(req, { after: p.next });
      page9Cursor = p.next;
    }
    const scenarios: [string, () => Promise<unknown>][] = [
      ["list: first page (25)", () => co.listCompanies(req, {})],
      ["list: first page (50)", () => co.listCompanies(req, { size: "50" })],
      ["list: page 10 via cursor", async () => co.listCompanies(req, { after: page9Cursor })],
      ["list: search 'Trading'", () => co.listCompanies(req, { q: "Trading" })],
      ["list: owner e-mail domain", () => co.listCompanies(req, { q: "synthetic-7.test" })],
      ["list: suspended filter", () => co.listCompanies(req, { access: "suspended" })],
      ["list: country + name sort", () => co.listCompanies(req, { country: "Saudi Arabia", sort: "name" })],
      ["invitations", () => co.listPendingInvitations(req, {})],
      ["metrics", () => co.companyMetrics(req)],
      ["countries", () => co.listCompanyCountries(req)],
      ["detail (audited)", () => co.getCompanyDetail(req, String(seeded.orgIds[123]))],
    ];
    const results: { scenario: string; runs: number; p50: number; p95: number; max: number; queries: number }[] = [];
    for (const [name, run] of scenarios) {
      for (let i = 0; i < 5; i++) await run();
      const times: number[] = [];
      for (let i = 0; i < 60; i++) {
        const t0 = performance.now();
        await run();
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      const { queries } = await capture(run);
      results.push({ scenario: name, runs: times.length, p50: +times[29].toFixed(1), p95: +times[56].toFixed(1), max: +times[59].toFixed(1), queries: queries.length });
    }
    console.log("\n  scenario                         runs   p50 ms   p95 ms   max ms   queries");
    for (const r of results) console.log(`  ${r.scenario.padEnd(32)} ${String(r.runs).padStart(4)} ${String(r.p50).padStart(8)} ${String(r.p95).padStart(8)} ${String(r.max).padStart(8)} ${String(r.queries).padStart(9)}`);
    ok(`every scenario's p95 is under the 2.5 s target (worst ${Math.max(...results.map((r) => r.p95))} ms)`, results.every((r) => r.p95 < 2500));
    const q25 = (await capture(() => co.listCompanies(req, {}))).queries.length;
    const q50 = (await capture(() => co.listCompanies(req, { size: "50" }))).queries.length;
    const q10 = (await capture(() => co.listCompanies(req, { size: "10" }))).queries.length;
    ok(`no N+1: a first page costs the same number of queries at 10, 25 and 50 rows (${q10}/${q25}/${q50})`, q10 === q25 && q25 === q50 && q25 <= 6);
    const detailQ = (await capture(() => co.getCompanyDetail(req, String(fx.fourOwners)))).queries.length;
    ok(`the detail view costs a fixed number of queries (${detailQ}), independent of its users and events`, detailQ === (await capture(() => co.getCompanyDetail(req, String(fx.noUsers)))).queries.length);
    const { queries } = await capture(() => co.listCompanies(req, { q: "Trading", size: "50" }));
    const plans: string[] = [];
    for (const x of queries.filter((x) => /"orgs"|"users"/.test(x.text))) {
      const plan = (await q<{ "QUERY PLAN": string }>(`explain (analyze, buffers) ${x.text}`, x.values)).map((r) => r["QUERY PLAN"]);
      plans.push(`-- ${x.text.slice(0, 160)}…\n${plan.join("\n")}`);
      const exec = plan.find((l) => /Execution Time/.test(l)) ?? "";
      console.log(`  plan: ${plan[0].trim().slice(0, 70).padEnd(70)} ${exec.trim()}`);
    }
    ok("query plans were captured for the page, count and aggregate queries", plans.length >= 3);
    if (EVIDENCE) {
      writeFileSync(join(EVIDENCE, "po02b-performance.json"), JSON.stringify({ organizations: orgCount, users: seeded.users, results }, null, 2));
      writeFileSync(join(EVIDENCE, "po02b-plans.txt"), plans.join("\n\n"));
    }
  }

  section("13. Cross-principal and data isolation; the read model changed nothing");
  {
    const a = await co.getCompanyDetail(req, String(fx.isolatedA));
    ok("a company's detail contains only its own owners", a.owners.every((o) => o.email === `owner@org-${fx.isolatedA}.test`));
    const second2 = await signIn(second);
    ok("a second operator reads the same allow-listed data (one-role console, no per-admin scoping)", (await co.listCompanies({ headers: headersFor(), token: second2 }, { q: "Isolation Alpha" })).total === 1);
    const scan = JSON.stringify(outputs);
    const leaked = Object.entries(SENSITIVE).filter(([, v]) => scan.includes(v));
    ok(`no sensitive value appears in any read-model output (${Object.keys(SENSITIVE).length} markers, ${outputs.length} outputs)`, leaked.length === 0, leaked.map(([k]) => k).join(", "));
    const rels = [...new Set(allCaptured.flatMap((x) => relationsOf(x.text)))].sort();
    ok(`over the whole suite the read model touched only: ${rels.join(", ")}`, rels.every((r) => READ_RELATIONS.has(r)) && !rels.includes("customers") && !rels.includes("sessions"));
    ok("orgs, users, customer sessions, customers, access controls and invitations are byte-identical (read-only)", (await checksum("orgs")) === before.orgs && (await checksum("users")) === before.users && (await checksum("sessions")) === before.sessions && (await checksum("customers")) === before.customers && (await checksum("tenant_access_controls")) === before.tac && (await checksum("organization_invitations")) === before.inv);
    const audits = await q<{ action: string; n: number }>("select action, count(*)::int n from platform_audit_events group by action order by action");
    ok("the only rows the read model added are company.viewed audit records", audits.filter((r) => r.action.startsWith("company.")).every((r) => r.action === "company.viewed"));
    ok("no platform secret or token appeared in any output", !secretsSeen.some((s) => s.length >= 8 && scan.includes(s)));
  }
  void realClock;
}

let exitCode = 1;
try {
  await main();
  exitCode = summary("verify:platform-companies");
} catch (e) {
  console.error(`verify:platform-companies aborted: ${describeError(e)}`);
  exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
  if (created && process.env.PLATFORM_TEST_KEEP_DATABASES !== "1") await dropDisposableDatabase(testDbName).catch(() => undefined);
}
void platformAuditEventsTable;
process.exit(exitCode);
