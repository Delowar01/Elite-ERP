/**
 * Platform Owner PO-06 — fictional fixtures and integrity probes for the staging-preparation rehearsal
 * (verify/verify-po06-rehearsal.mts). Everything is invented: company and person names, `.test` e-mail domains, a
 * placeholder password hash that cannot sign in, fake MFA material. Callers pass clients the local-db-guard has checked
 * (loopback, `*_test_only_*`). Connection strings are never printed.
 *
 * The data deliberately covers what D-6 and D-7 must get right on an EXISTING customer database:
 *   - the PO-00 owner classes A–F, a non-canonical role value, disabled owners, a company above the Trial's 3 seats;
 *   - a case-insensitive e-mail collision across two companies, a mixed-case legacy address, white space, non-ASCII;
 *   - live / expired / revoked sessions, audit and security records, and business rows in 17 customer tables
 *     (customers, products, the chart of accounts, journals, invoices, payments, the long-named foreign keys of H-3);
 *   - canary strings in every free-text and secret-like column, and distinctive ids, so a report that leaked a name,
 *     an address, a hash, an MFA secret or a raw id would be caught.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Client } from "pg";

export const ORG_ID_BASE = 739100;
export const USER_ID_BASE = 748200;

type Q = Pick<Client, "query">;

export type ProductionFixture = {
  orgs: Record<string, number>;
  users: Record<string, number>;
  canaries: string[];
  idStrings: string[];
  expect: {
    companies: number;
    classes: Record<string, number>;
    users: number;
    active: number;
    disabled: number;
    neverSignedIn: number;
    mfaEnabled: number;
    roles: Record<string, number>;
    e1Groups: number;
    e1Spanning: number;
    notNormalized: number;
    whiteSpace: number;
    nonAscii: number;
    above3: number;
    maxUsers: number;
  };
};

/** Insert the fictional production-shaped data set (the 621f156 tenant schema; no Platform Owner object needed). */
export async function insertProductionFixtures(c: Q): Promise<ProductionFixture> {
  const canary = `cnry${randomBytes(4).toString("hex")}`;
  const hash = `$2a$04$${canary}${"Q".repeat(53 - canary.length)}`;
  const mfaSecret = `MFA${canary.toUpperCase()}SECRET`;
  await c.query(`select setval('orgs_id_seq', ${ORG_ID_BASE}, false), setval('users_id_seq', ${USER_ID_BASE}, false)`);
  const org = async (key: string, name: string, country: string, currency: string) =>
    Number(
      (
        await c.query(`insert into orgs (name, country, currency, phone, email, tax_id, address) values ($1, $2, $3, $4, $5, $6, $7) returning id`, [
          name,
          country,
          currency,
          `+966 50 ${canary}`,
          `office.${key}.${canary}@fixture-po06.test`,
          `TAX-${canary}-${key}`,
          `Street ${canary}`,
        ])
      ).rows[0].id,
    );
  const orgs: Record<string, number> = {
    A1: await org("a1", "Fictional Falcon Trading LLC", "Saudi Arabia", "SAR"),
    A2: await org("a2", "Fictional Oasis Logistics Co.", "Saudi Arabia", "SAR"),
    AR: await org("ar", "مؤسسة النخيل التجريبية", "Saudi Arabia", "SAR"),
    S: await org("s", "Fictional Summit Contracting LLC", "United Arab Emirates", "AED"),
    B: await org("b", "Fictional Cedar Interiors Est.", "Saudi Arabia", "SAR"),
    C: await org("c", "Fictional Harbor Foods Ltd", "United Kingdom", "GBP"),
    D: await org("d", "Fictional Pearl Printing LLC", "Saudi Arabia", "SAR"),
    E: await org("e", "Fictional Dune Consulting Co.", "Saudi Arabia", "SAR"),
    F: await org("f", "Fictional Atlas Retail Est.", "Saudi Arabia", "SAR"),
  };
  const users: Record<string, number> = {};
  const user = async (key: string, orgKey: string, email: string, role: string, active: boolean, opts: { login?: boolean; mfa?: boolean } = {}) => {
    users[key] = Number(
      (
        await c.query(
          `insert into users (org_id, email, password_hash, name, role, is_active, last_login_at, mfa_enabled, mfa_secret)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [orgs[orgKey], email, hash, `Fictional ${canary} ${key}`, role, active, opts.login ? new Date("2026-11-01T09:00:00Z") : null, Boolean(opts.mfa), opts.mfa ? mfaSecret : null],
        )
      ).rows[0].id,
    );
  };
  // A — exactly one active owner (A1 also holds an admin and a staff member; S is above the Trial's 3 seats)
  await user("a1owner", "A1", "Owner.Falcon@fixture-po06.test", "owner", true, { login: true, mfa: true });
  await user("a1admin", "A1", "admin.falcon@fixture-po06.test", "admin", true, { login: true });
  await user("a1staff", "A1", "staff.falcon@fixture-po06.test", "staff", true);
  await user("a2owner", "A2", "zoë.oasis@fixture-po06.test", "owner", true, { login: true });
  await user("arowner", "AR", "owner.nakheel@fixture-po06.test", "owner", true, { login: true });
  await user("sowner", "S", "owner.summit@fixture-po06.test", "owner", true, { login: true });
  for (let i = 1; i <= 5; i++) await user(`sstaff${i}`, "S", i === 1 ? " spaced.summit@fixture-po06.test" : `staff${i}.summit@fixture-po06.test`, "staff", i !== 5, { login: i <= 2 });
  // B — one active owner plus a disabled one (and a mixed-case twin of a C user: one collision across companies)
  await user("bowner", "B", "owner.cedar@fixture-po06.test", "owner", true, { login: true });
  await user("bowner2", "B", "former.cedar@fixture-po06.test", "owner", false);
  await user("bdup", "B", "Dup.Case@fixture-po06.test", "staff", true);
  // C — two active owners
  await user("cowner1", "C", "owner1.harbor@fixture-po06.test", "owner", true, { login: true });
  await user("cowner2", "C", "owner2.harbor@fixture-po06.test", "owner", true);
  await user("cdup", "C", "dup.case@fixture-po06.test", "staff", true);
  // D — only a disabled owner
  await user("downer", "D", "owner.pearl@fixture-po06.test", "owner", false);
  await user("dstaff", "D", "staff.pearl@fixture-po06.test", "staff", true, { login: true });
  // E — no user at all; F — no canonical owner (an admin and the non-canonical value "Owner")
  await user("fadmin", "F", "admin.atlas@fixture-po06.test", "admin", true, { login: true });
  await user("fodd", "F", "legacy.atlas@fixture-po06.test", "Owner", true);

  // sessions: live, expired, revoked
  const tok = () => createHash("sha256").update(randomBytes(32)).digest("hex");
  for (const k of ["a1owner", "a2owner", "sowner", "bowner", "cowner1", "dstaff", "fadmin"]) {
    const u = users[k];
    const o = Number((await c.query(`select org_id from users where id = $1`, [u])).rows[0].org_id);
    await c.query(`insert into sessions (org_id, user_id, token_hash, ip_address, expires_at) values ($1, $2, $3, '203.0.113.10', now() + interval '30 days')`, [o, u, tok()]);
    await c.query(`insert into sessions (org_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() - interval '1 day')`, [o, u, tok()]);
    await c.query(`insert into sessions (org_id, user_id, token_hash, expires_at, revoked_at, revoked_reason) values ($1, $2, $3, now() + interval '30 days', now(), 'logout')`, [o, u, tok()]);
  }
  // audit and security records (append-only tables: inserts only)
  for (const [k, o] of Object.entries(orgs)) {
    await c.query(`insert into audit_logs (org_id, action, entity_type, entity_id, new_value) values ($1, 'org.registered', 'org', $2, $3)`, [o, String(o), JSON.stringify({ orgName: `Fictional ${canary} ${k}` })]);
    await c.query(`insert into security_events (org_id, type, severity, detail) values ($1, 'account.created', 'info', $2)`, [o, `fixture ${canary}`]);
    await c.query(`insert into activity_logs (org_id, type, description) values ($1, 'fixture', $2)`, [o, `Fictional ${canary} activity`]);
  }
  // business rows in every company with users
  for (const [k, o] of Object.entries(orgs)) {
    if (k === "E") continue;
    const owner = Number((await c.query(`select id from users where org_id = $1 order by id limit 1`, [o])).rows[0].id);
    const cust = Number((await c.query(`insert into customers (org_id, name, email) values ($1, $2, $3) returning id`, [o, `Fictional Customer ${canary} ${k}`, `buyer.${k}.${canary}@fixture-po06.test`])).rows[0].id);
    await c.query(`insert into customers (org_id, name) values ($1, $2)`, [o, `Fictional Customer ${k} two`]);
    await c.query(`insert into products (org_id, sku, name) values ($1, $2, $3), ($1, $4, $5)`, [o, `SKU-${k}-1`, `Fictional Product ${canary}`, `SKU-${k}-2`, "Fictional Product two"]);
    const acct = Number((await c.query(`insert into accounts (org_id, code, name, type, normal_balance) values ($1, '1010', 'Fictional Bank', 'asset', 'debit') returning id`, [o])).rows[0].id);
    const rev = Number((await c.query(`insert into accounts (org_id, code, name, type, normal_balance) values ($1, '4010', 'Fictional Revenue', 'revenue', 'credit') returning id`, [o])).rows[0].id);
    await c.query(`insert into projects (org_id, name) values ($1, $2)`, [o, `Fictional Project ${k}`]);
    const term = Number((await c.query(`insert into payment_term_presets (org_id, name) values ($1, 'Net 30 (fictional)') returning id`, [o])).rows[0].id);
    const inv = Number(
      (
        await c.query(`insert into sales_invoices (org_id, invoice_number, customer_id, issue_date, created_by_id, payment_term_preset_id) values ($1, $2, $3, '2026-11-02', $4, $5) returning id`, [
          o,
          `INV-${k}-0001`,
          cust,
          owner,
          term,
        ])
      ).rows[0].id,
    );
    await c.query(`insert into sales_invoice_items (invoice_id, quantity, unit_price, line_total) values ($1, 2, 150.25, 300.50)`, [inv]);
    const je = Number((await c.query(`insert into journal_entries (org_id, entry_date, memo, source_type, created_by_id) values ($1, '2026-11-02', $2, 'manual', $3) returning id`, [o, `Fictional entry ${canary}`, owner])).rows[0].id);
    await c.query(`insert into journal_lines (journal_entry_id, account_id, debit) values ($1, $2, 300.50)`, [je, acct]);
    await c.query(`insert into journal_lines (journal_entry_id, account_id, credit) values ($1, $2, 300.50)`, [je, rev]);
    const bank = Number((await c.query(`insert into bank_accounts (org_id, name, gl_account_id) values ($1, 'Fictional Bank Account', $2) returning id`, [o, acct])).rows[0].id);
    await c.query(`insert into payments (org_id, direction, bank_account_id, amount, payment_date, created_by_id) values ($1, 'in', $2, 300.50, '2026-11-03', $3)`, [o, bank, owner]);
    const pf = Number((await c.query(`insert into proforma_invoices (org_id, proforma_number, customer_id, issue_date, created_by_id) values ($1, $2, $3, '2026-11-02', $4) returning id`, [o, `PF-${k}-1`, cust, owner])).rows[0].id);
    await c.query(`insert into proforma_invoice_items (proforma_invoice_id) values ($1)`, [pf]);
    const dc = Number((await c.query(`insert into delivery_challans (org_id, dc_number, customer_id, created_by_id) values ($1, $2, $3, $4) returning id`, [o, `DC-${k}-1`, cust, owner])).rows[0].id);
    await c.query(`insert into delivery_challan_items (delivery_challan_id) values ($1)`, [dc]);
  }
  const idStrings = [...Object.values(orgs), ...Object.values(users)].map(String);
  return {
    orgs,
    users,
    canaries: [canary, canary.toUpperCase(), mfaSecret, hash, "fixture-po06.test", "Fictional", "Falcon", "النخيل"],
    idStrings,
    expect: {
      companies: 9,
      classes: { A_single_active_owner: 4, B_single_active_plus_inactive_owner: 1, C_multiple_active_owners: 1, D_only_inactive_owner: 1, E_no_users: 1, F_no_owner_role: 1 },
      users: 21,
      active: 18,
      disabled: 3,
      neverSignedIn: 10,
      mfaEnabled: 1,
      roles: { Owner: 1, admin: 2, owner: 9, staff: 9 },
      e1Groups: 1,
      e1Spanning: 1,
      notNormalized: 3,
      whiteSpace: 1,
      nonAscii: 1,
      above3: 1,
      maxUsers: 6,
    },
  };
}

/** Every ordinary table in public. */
export async function publicTables(c: Q): Promise<string[]> {
  return (await c.query(`select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows.map((r) => String(r.t));
}

/** Row fingerprints (count + sha256 over the sorted row md5s) of each table: identical fingerprints = identical rows. */
export async function fingerprints(c: Q, tables: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of [...tables].sort()) {
    const r = (await c.query(`select count(*)::bigint as n, encode(sha256(convert_to(coalesce(string_agg(md5(x::text), '' order by md5(x::text)), ''), 'UTF8')), 'hex') as h from public."${t.replace(/"/g, "")}" x`)).rows[0];
    out[t] = `${r.n}:${r.h}`;
  }
  return out;
}

export const changedTables = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();

/** Rows per table (non-empty tables only). */
export async function nonEmpty(c: Q, tables: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const t of tables) if (Number((await c.query(`select count(*)::int as n from public."${t.replace(/"/g, "")}"`)).rows[0].n) > 0) out.push(t);
  return out;
}

/**
 * The relation locks one transaction holds at its end: the file is run with its final COMMIT replaced by a lock query
 * and a ROLLBACK. The same statements in the same transaction — only the end differs, and nothing is committed.
 */
export async function locksHeldAtCommit(c: Q, fileText: string, tables: readonly string[]): Promise<Record<string, string[]>> {
  if (!/\nCOMMIT;\s*$/.test(fileText)) throw new Error("the file does not end with COMMIT");
  const probe = fileText.replace(
    /\nCOMMIT;\s*$/,
    `\nSELECT c.relname AS rel, l.mode FROM pg_locks l JOIN pg_class c ON c.oid = l.relation JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND l.granted AND n.nspname = 'public' AND c.relname = ANY(ARRAY[${tables.map((t) => `'${t}'`).join(",")}]::text[]) ORDER BY 1, 2;\nROLLBACK;\n`,
  );
  const res = await c.query(probe);
  const results = (Array.isArray(res) ? res : [res]) as { rows?: { rel?: string; mode?: string }[] }[];
  const last = [...results].reverse().find((r) => (r.rows ?? []).some((x) => x.rel !== undefined && x.mode !== undefined)) ?? { rows: [] };
  const held: Record<string, string[]> = {};
  for (const r of last.rows ?? []) if (r.rel && r.mode) (held[r.rel] ??= []).push(r.mode);
  return held;
}

export const fmtHeld = (h: Record<string, string[]>) => Object.entries(h).map(([t, m]) => `${t}: ${m.join("+")}`).join("; ") || "none";
