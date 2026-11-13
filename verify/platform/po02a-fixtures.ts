/**
 * PO-02A shared fixtures for verify:platform-company-schema and verify:platform-migration-safety.
 * Fictional data only (example/test domains, documentation IP range); nothing secret is printed.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import type { Client } from "pg";
import { PO02A_SQL_PATH } from "../../scripts/platform/catalog";

/** Every object PO02A_company_foundation.sql creates, by kind (the catalog must show exactly these). */
export const PO02A_TABLES = ["organization_invitations", "tenant_access_controls"] as const;
export const PO02A_CONSTRAINTS = [
  "organization_invitations_acceptance_chk",
  "organization_invitations_acceptance_window_chk",
  "organization_invitations_accepted_org_fk",
  "organization_invitations_company_email_chk",
  "organization_invitations_company_name_chk",
  "organization_invitations_country_chk",
  "organization_invitations_currency_chk",
  "organization_invitations_expiry_chk",
  "organization_invitations_industry_chk",
  "organization_invitations_invited_by_fk",
  "organization_invitations_owner_email_chk",
  "organization_invitations_owner_name_chk",
  "organization_invitations_pkey",
  "organization_invitations_revocation_chk",
  "organization_invitations_revocation_time_chk",
  "organization_invitations_revoked_by_fk",
  "organization_invitations_terminal_chk",
  "organization_invitations_token_hash_chk",
  "organization_invitations_updated_chk",
  "tenant_access_controls_change_attribution_chk",
  "tenant_access_controls_change_reason_chk",
  "tenant_access_controls_changed_by_fk",
  "tenant_access_controls_org_fk",
  "tenant_access_controls_pkey",
  "tenant_access_controls_reason_chk",
  "tenant_access_controls_status_chk",
  "tenant_access_controls_suspension_chk",
  "tenant_access_controls_timestamps_chk",
] as const;
export const PO02A_INDEX_DEFS: Record<string, string> = {
  organization_invitations_pkey: "CREATE UNIQUE INDEX organization_invitations_pkey ON public.organization_invitations USING btree (id)",
  organization_invitations_token_hash_uq: "CREATE UNIQUE INDEX organization_invitations_token_hash_uq ON public.organization_invitations USING btree (token_hash)",
  organization_invitations_accepted_org_uq:
    "CREATE UNIQUE INDEX organization_invitations_accepted_org_uq ON public.organization_invitations USING btree (accepted_org_id) WHERE (accepted_org_id IS NOT NULL)",
  organization_invitations_pending_email_uq:
    "CREATE UNIQUE INDEX organization_invitations_pending_email_uq ON public.organization_invitations USING btree (owner_email_normalized) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL))",
  organization_invitations_pending_expiry_idx:
    "CREATE INDEX organization_invitations_pending_expiry_idx ON public.organization_invitations USING btree (expires_at) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL))",
  tenant_access_controls_pkey: "CREATE UNIQUE INDEX tenant_access_controls_pkey ON public.tenant_access_controls USING btree (org_id)",
  sessions_org_active_idx: "CREATE INDEX sessions_org_active_idx ON public.sessions USING btree (org_id) WHERE (revoked_at IS NULL)",
  platform_audit_events_entity_idx:
    "CREATE INDEX platform_audit_events_entity_idx ON public.platform_audit_events USING btree (entity_type, entity_id, created_at DESC NULLS LAST)",
};
/** The M4 line as the catalog projection prints it: the ONLY tenant object PO-02A changes. */
export const M4_PROJECTION_LINE = `sessions | sessions_org_active_idx | ${PO02A_INDEX_DEFS.sessions_org_active_idx}`;

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
export const newTokenHash = () => sha256Hex(randomBytes(32).toString("base64url"));

export type TenantFixture = { orgs: number[]; users: number[]; liveSessions: number[]; admin: string; admin2: string };

/** Fictional tenant rows (3 orgs, users, live / revoked / expired sessions, customers) + 2 platform operators. */
export async function insertFixtures(c: Client): Promise<TenantFixture> {
  const orgs: number[] = [];
  for (const [name, country, currency] of [
    ["Fictional Trading Co", "Saudi Arabia", "SAR"],
    ["Example Supplies LLC", "United Arab Emirates", "AED"],
    ["Sample Works Ltd", "United Kingdom", "GBP"],
  ]) {
    orgs.push((await c.query(`insert into orgs (name, country, currency) values ($1, $2, $3) returning id`, [name, country, currency])).rows[0].id);
  }
  const users: number[] = [];
  const hash = "$2a$04$" + "x".repeat(53);
  for (const [i, org] of orgs.entries()) {
    users.push((await c.query(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, $4, 'owner') returning id`, [org, `owner${i}@company-fixture.test`, hash, `Owner ${i}`])).rows[0].id);
    users.push((await c.query(`insert into users (org_id, email, password_hash, name, role) values ($1, $2, $3, $4, 'staff') returning id`, [org, `staff${i}@company-fixture.test`, hash, `Staff ${i}`])).rows[0].id);
  }
  const liveSessions: number[] = [];
  for (const [i, org] of orgs.entries()) {
    const u = users[i * 2];
    liveSessions.push((await c.query(`insert into sessions (org_id, user_id, token_hash, ip_address, expires_at) values ($1, $2, $3, '203.0.113.10', now() + interval '30 days') returning id`, [org, u, newTokenHash()])).rows[0].id);
    await c.query(`insert into sessions (org_id, user_id, token_hash, expires_at, revoked_at, revoked_reason) values ($1, $2, $3, now() + interval '30 days', now(), 'logout')`, [org, u, newTokenHash()]);
    await c.query(`insert into sessions (org_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() - interval '1 day')`, [org, u, newTokenHash()]);
    await c.query(`insert into customers (org_id, name) values ($1, $2), ($1, $3)`, [org, `Fixture Customer ${i}A`, `Fixture Customer ${i}B`]);
  }
  const pw = await bcrypt.hash("Fictional-Passw0rd!x", 4);
  const envelope = "v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB==:CCCCCCCC";
  const adminRow = async (email: string) =>
    (
      await c.query(
        `insert into platform_admins (email_normalized, display_name, password_hash, mfa_secret_encrypted, mfa_enrolled_at) values ($1, 'Fictional Operator', $2, $3, now()) returning id`,
        [email, pw, envelope],
      )
    ).rows[0].id as string;
  return { orgs, users, liveSessions, admin: await adminRow("operator@platform-fixture.test"), admin2: await adminRow("operator2@platform-fixture.test") };
}

/** md5 of every row of every listed table (ordered by row text): a data fingerprint per table. */
export async function tableChecksums(c: Client, tables: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of [...tables].sort()) {
    const r = await c.query(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h, count(*)::int as n from "${t.replace(/"/g, "")}" x`);
    out[t] = `${r.rows[0].n}:${r.rows[0].h}`;
  }
  return out;
}

export const diffChecksums = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);

/** Run the reviewed PO-02A migration on an open client; returns the four step lines. Rolls back on error. */
export async function runPo02a(c: Client): Promise<string[]> {
  try {
    const res = await c.query(readFileSync(PO02A_SQL_PATH, "utf8"));
    const results = Array.isArray(res) ? res : [res];
    return results.flatMap((r) => (r.rows ?? []).map((row: Record<string, unknown>) => row.po02a_step)).filter((x): x is string => typeof x === "string");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

/** Execute a file written as "-- statement"-separated autocommit statements (the CIC runbook file). */
export async function runStatements(c: Client, path: string): Promise<void> {
  const chunks = readFileSync(path, "utf8").split(/^-- statement\s*$/m).slice(1);
  for (const chunk of chunks) {
    const body = chunk
      .split("\n")
      .filter((l) => !/^\s*--/.test(l))
      .join("\n")
      .trim();
    if (body) await c.query(body);
  }
}

/** Which PO-02A objects currently exist (tables, indexes by name, the scratch schema). */
export async function po02aObjects(c: Client): Promise<{ tables: string[]; indexes: string[]; scratch: boolean }> {
  const tables = (await c.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relname in ('tenant_access_controls','organization_invitations')`)).rows.map((r) => r.relname as string).sort();
  const indexes = (await c.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'i' and relname in ('sessions_org_active_idx','platform_audit_events_entity_idx')`)).rows.map((r) => r.relname as string).sort();
  const scratch = (await c.query(`select count(*)::int as n from pg_namespace where nspname = 'po02a_reference'`)).rows[0].n > 0;
  return { tables, indexes, scratch };
}
