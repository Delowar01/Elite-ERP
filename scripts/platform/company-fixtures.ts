/**
 * Platform Owner PO-02B — deterministic SYNTHETIC companies for the read-only directory: the
 * verify:platform-companies suites (including the 1,000-organization performance run) and the
 * guarded local preview (platform:preview-companies). Everything is fictional: invented company
 * and person names (English and Arabic), `.test` e-mail domains, a non-hash password placeholder
 * that cannot sign in, random token hashes nobody holds. Callers pass a client that the local
 * database guard has already checked (loopback, `*_test_only_*`).
 *
 * The data deliberately covers the cases the directory must get right: equal creation timestamps
 * (keyset tie-break on id) and microsecond differences, companies without an owner and with up to
 * three, inactive users and users who never signed in, the legacy default (no access row), explicit
 * active rows, suspended rows with a reason and responsible operator, and invitations that are
 * pending, expired (still holding their e-mail slot), accepted and revoked.
 */
import { randomBytes } from "node:crypto";
import type { Client } from "pg";

export type SyntheticOptions = {
  companies: number;
  /** Platform admin recorded as responsible for the synthetic access changes and invitations. */
  adminId: string;
  now: Date;
  invitations?: number;
  seed?: number;
};
export type SyntheticResult = {
  orgIds: number[];
  users: number;
  suspended: number[];
  explicitActive: number[];
  noOwner: number[];
  invitations: { pending: number; expired: number; accepted: number; revoked: number };
};

/** A small deterministic PRNG (mulberry32) so every run produces the same data set. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EN_STEMS = ["Falcon", "Desert Rose", "Gulf Star", "Najd", "Red Sea", "Palm Grove", "Oasis", "Crescent", "Summit", "Harbor", "Cedar", "Atlas", "Pearl", "Horizon", "Dune", "Saffron", "Lantern", "Meridian", "Coral", "Granite"];
const EN_TRADES = ["Trading", "Logistics", "Contracting", "Foods", "Technologies", "Medical Supplies", "Interiors", "Printing", "Consulting", "Retail"];
const EN_FORMS = ["LLC", "Co.", "Est.", "Ltd"];
const AR_STEMS = ["مؤسسة النخيل", "شركة الريان", "مجموعة الواحة", "مؤسسة الأفق", "شركة المرجان", "مؤسسة السنبلة", "شركة الصقر", "مجموعة اللؤلؤ"];
const AR_TRADES = ["للتجارة", "للمقاولات", "للتقنية", "للخدمات اللوجستية", "للأغذية", "للاستشارات"];
const CITIES = ["Riyadh", "Jeddah", "Dammam", "Dubai", "Doha", "Kuwait City", "Manama", "Muscat", "Cairo", "Amman"];
const AR_CITIES = ["الرياض", "جدة", "الدمام", "دبي", "الدوحة", "الكويت", "المنامة", "مسقط", "القاهرة", "عمّان"];
const COUNTRIES: [string, string, number][] = [
  ["Saudi Arabia", "SAR", 55],
  ["United Arab Emirates", "AED", 12],
  ["Kuwait", "KWD", 6],
  ["Qatar", "QAR", 5],
  ["Egypt", "EGP", 5],
  ["Bahrain", "BHD", 4],
  ["Oman", "OMR", 4],
  ["Jordan", "JOD", 4],
  ["United Kingdom", "GBP", 3],
  ["United States", "USD", 2],
];
const INDUSTRIES = ["Retail", "Construction", "Logistics", "Healthcare", "Technology", "Hospitality", "Manufacturing", "Professional services", "Education", null];
const FIRST = ["Sara", "Omar", "Lina", "Faisal", "Noura", "Khalid", "Reem", "Yousef", "Huda", "Tariq", "Maha", "Saad"];
const LAST = ["Haddad", "Qasim", "Nasser", "Saleh", "Rahman", "Kareem", "Mansour", "Farouk"];
const AR_FIRST = ["سارة", "عمر", "لينا", "فيصل", "نورة", "خالد", "ريم", "يوسف"];
const AR_LAST = ["الحداد", "القاسم", "الناصر", "الصالح"];

/** A password-hash-shaped placeholder that matches no password (bcrypt never produces it). */
const NO_PASSWORD = "$2a$04$" + "x".repeat(53);
const DAY = 86_400_000;

const pick = <T>(rand: () => number, list: readonly T[]) => list[Math.floor(rand() * list.length)];
function weighted(rand: () => number) {
  const total = COUNTRIES.reduce((n, [, , w]) => n + w, 0);
  let r = rand() * total;
  for (const c of COUNTRIES) if ((r -= c[2]) < 0) return c;
  return COUNTRIES[0];
}
/** UTC wall-clock text with microseconds, for `timestamp without time zone` columns (exact, no JS rounding). */
function wallClock(ms: number, micros: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace("T", " ")}.${String(Math.floor(ms % 1000) * 1000 + micros).padStart(6, "0")}`;
}

function companyNames(rand: () => number, count: number, taken = new Set<string>()): string[] {
  const out: string[] = [];
  while (out.length < count) {
    const arabic = rand() < 0.22;
    let name = arabic ? `${pick(rand, AR_STEMS)} ${pick(rand, AR_TRADES)}` : `${pick(rand, EN_STEMS)} ${pick(rand, EN_TRADES)} ${pick(rand, EN_FORMS)}`;
    // A duplicate gets a city in its own script (no mixed-direction names), then a branch number.
    if (taken.has(name)) name = arabic ? `${name} - ${pick(rand, AR_CITIES)}` : `${name} (${pick(rand, CITIES)})`;
    const stem = name;
    for (let n = 2; taken.has(name); n++) name = arabic ? `${stem} - فرع ${n}` : `${stem} - Branch ${n}`;
    taken.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Insert `companies` synthetic organizations (+ users, access rows, invitations) in a handful of
 * set-based statements. Refuses a database that already holds organizations.
 */
export async function seedSyntheticCompanies(client: Client, opts: SyntheticOptions): Promise<SyntheticResult> {
  const rand = prng(opts.seed ?? 20261113);
  const existing = await client.query<{ n: number }>("select count(*)::int as n from orgs");
  if (existing.rows[0].n > 0) throw new Error("refusing to seed synthetic companies into a database that already has organizations");

  const nowMs = opts.now.getTime();
  const names = companyNames(rand, opts.companies);
  const orgs = names.map((name, i) => {
    const [country, currency] = weighted(rand);
    return { name, country, currency, industry: pick(rand, INDUSTRIES), logo: rand() < 0.3 ? "/uploads/synthetic/logo.png" : null, ms: nowMs - Math.floor(rand() * 720 * DAY) - 60_000, micros: Math.floor(rand() * 1000), i };
  });
  orgs.sort((a, b) => a.ms - b.ms || a.micros - b.micros);
  // Equal timestamps: every 37th company was created at exactly the same instant as the one before.
  for (let i = 37; i < orgs.length; i += 37) {
    orgs[i].ms = orgs[i - 1].ms;
    orgs[i].micros = orgs[i - 1].micros;
  }
  const createdAt = orgs.map((o) => wallClock(o.ms, o.micros));
  const inserted = await client.query<{ id: number; name: string }>(
    `insert into orgs (name, country, currency, industry, logo_url, created_at, updated_at)
     select n, c, cur, ind, logo, ts, ts from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::timestamp[]) as t(n, c, cur, ind, logo, ts)
     returning id, name`,
    [orgs.map((o) => o.name), orgs.map((o) => o.country), orgs.map((o) => o.currency), orgs.map((o) => o.industry), orgs.map((o) => o.logo), createdAt],
  );
  const idByName = new Map(inserted.rows.map((r) => [r.name, r.id]));
  const orgIds = orgs.map((o) => idByName.get(o.name)!);

  // Users: 1–8 per company; the first is the owner (4 % have none, ~13 % have two or three).
  const u = { org: [] as number[], email: [] as string[], name: [] as string[], role: [] as string[], active: [] as boolean[], login: [] as (string | null)[], created: [] as string[] };
  const noOwner: number[] = [];
  orgs.forEach((o, idx) => {
    const orgId = orgIds[idx];
    const count = 1 + Math.floor(rand() * 8);
    const ownerless = rand() < 0.04;
    if (ownerless) noOwner.push(orgId);
    const owners = ownerless ? 0 : rand() < 0.03 ? 3 : rand() < 0.1 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const arabic = rand() < 0.3;
      const role = k < owners ? "owner" : k === owners ? "admin" : "staff";
      u.org.push(orgId);
      u.email.push(`${role}${k + 1}.org${idx + 1}@synthetic-${(idx % 40) + 1}.test`);
      u.name.push(arabic ? `${pick(rand, AR_FIRST)} ${pick(rand, AR_LAST)}` : `${pick(rand, FIRST)} ${pick(rand, LAST)}`);
      u.role.push(role);
      u.active.push(rand() < 0.86);
      u.login.push(rand() < 0.75 ? wallClock(Math.max(o.ms + 60_000, nowMs - Math.floor(rand() * 90 * DAY)), Math.floor(rand() * 1000)) : null);
      u.created.push(wallClock(o.ms + k * 1000, o.micros));
    }
  });
  await client.query(
    `insert into users (org_id, email, password_hash, name, role, is_active, last_login_at, created_at, updated_at, password_changed_at)
     select o, e, $3, n, r, a, l, c, c, c from unnest($1::int[], $2::text[], $4::text[], $5::text[], $6::boolean[], $7::timestamp[], $8::timestamp[]) as t(o, e, n, r, a, l, c)`,
    [u.org, u.email, NO_PASSWORD, u.name, u.role, u.active, u.login, u.created],
  );

  // Access rows: ~3 % suspended (reason + responsible operator), ~4 % explicitly active (reactivated).
  const suspended: number[] = [];
  const explicitActive: number[] = [];
  orgIds.forEach((id) => {
    const r = rand();
    if (r < 0.03) suspended.push(id);
    else if (r < 0.07) explicitActive.push(id);
  });
  if (!suspended.length && orgIds.length > 1) suspended.push(orgIds[1]);
  const changedAt = new Date(nowMs - 5 * DAY);
  for (const [ids, status, reason] of [
    [suspended, "suspended", "Synthetic fixture: payment review pending"],
    [explicitActive, "active", "Synthetic fixture: review completed"],
  ] as const) {
    if (!ids.length) continue;
    await client.query(
      `insert into tenant_access_controls (org_id, access_status, reason, changed_by_platform_admin_id, changed_at, created_at, updated_at)
       select id, $2, $3, $4::uuid, $5::timestamptz, $5::timestamptz, $5::timestamptz from unnest($1::int[]) as t(id)`,
      [ids, status, reason, opts.adminId, changedAt.toISOString()],
    );
  }

  // Invitations: pending, expired (still holding the e-mail slot), accepted, revoked.
  const total = opts.invitations ?? 36;
  const kinds = { pending: Math.round(total * 0.55), expired: Math.round(total * 0.22), accepted: 0, revoked: 0 };
  kinds.accepted = Math.min(Math.floor((total - kinds.pending - kinds.expired) / 2), orgIds.length);
  kinds.revoked = total - kinds.pending - kinds.expired - kinds.accepted;
  const invNames = companyNames(rand, total, new Set(names));
  const rows: { company: string; country: string; currency: string; owner: string; created: Date; expires: Date; acceptedAt: Date | null; acceptedOrg: number | null; revokedAt: Date | null }[] = [];
  let n = 0;
  const add = (kind: keyof typeof kinds, count: number) => {
    for (let k = 0; k < count; k++, n++) {
      const [country, currency] = weighted(rand);
      const ageMs = kind === "pending" ? Math.floor(rand() * 2.5 * DAY) : kind === "expired" ? (4 + Math.floor(rand() * 20)) * DAY : (5 + Math.floor(rand() * 60)) * DAY;
      const created = new Date(nowMs - ageMs - 60_000);
      const expires = new Date(created.getTime() + 72 * 3_600_000);
      rows.push({
        company: invNames[n],
        country,
        currency,
        owner: `owner.inv${n + 1}@invited-${(n % 12) + 1}.test`,
        created,
        expires,
        acceptedAt: kind === "accepted" ? new Date(created.getTime() + 3_600_000) : null,
        acceptedOrg: kind === "accepted" ? orgIds[orgIds.length - 1 - k] : null,
        revokedAt: kind === "revoked" ? new Date(created.getTime() + 7_200_000) : null,
      });
    }
  };
  add("pending", kinds.pending);
  add("expired", kinds.expired);
  add("accepted", kinds.accepted);
  add("revoked", kinds.revoked);
  if (rows.length) {
    await client.query(
      `insert into organization_invitations (company_name, company_email, country_name, currency_code, owner_name, owner_email_normalized, token_hash, expires_at, accepted_at, accepted_org_id, revoked_at, revoked_by_platform_admin_id, invited_by_platform_admin_id, created_at, updated_at)
       select c, 'hello@' || split_part(o, '@', 2), co, cu, 'Synthetic Owner', o, h, e, a, ao, r, case when r is null then null else $10::uuid end, $10::uuid, cr, coalesce(r, a, cr)
       from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::timestamptz[], $7::timestamptz[], $8::int[], $9::timestamptz[], $11::timestamptz[]) as t(c, co, cu, o, h, e, a, ao, r, cr)`,
      [
        rows.map((r) => r.company),
        rows.map((r) => r.country),
        rows.map((r) => r.currency),
        rows.map((r) => r.owner),
        rows.map(() => randomBytes(32).toString("hex")),
        rows.map((r) => r.expires.toISOString()),
        rows.map((r) => r.acceptedAt?.toISOString() ?? null),
        rows.map((r) => r.acceptedOrg),
        rows.map((r) => r.revokedAt?.toISOString() ?? null),
        opts.adminId,
        rows.map((r) => r.created.toISOString()),
      ],
    );
  }
  return { orgIds, users: u.org.length, suspended, explicitActive, noOwner, invitations: kinds };
}
