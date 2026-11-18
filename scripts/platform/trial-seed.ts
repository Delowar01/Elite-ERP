/**
 * Platform Owner PO-02D1B — the default Trial / platform settings seed: the approved values (mirrored from the reviewed
 * SQL — verify:platform-onboarding-seed proves the two agree), a read-only check of the seeded rows, and the guarded
 * runner behind `npm run platform:db:seed` and `npm run platform:db:seed-rollback`.
 *
 *   DATABASE_URL=postgres://…@127.0.0.1:<port>/<name containing _test_only_> npm run platform:db:seed [-- --json]
 *   DATABASE_URL=… npm run platform:db:seed-rollback [-- --json]
 *
 * Refusal order (fail closed, nothing written before every gate passed):
 *   1. local-db-guard — non-loopback or non-`*_test_only_*` targets are refused before a connection opens (exit 2);
 *   2. the release preflight (read-only) must report PUSH_SAFE and REVIEWED_SQL_COMPLETE — any BLOCK (H-1, H-2, H-3 /
 *      O-06, F1, a missing or disabled trigger, a partial schema, the journal gate…) stops here (exit 3);
 *   3. the reviewed SQL itself — its own target guard, preconditions and value checks; a differing record or a
 *      reference refuses the whole transaction, naming every reason (exit 4);
 *   4. a read-only post-check: the database must hold exactly the seed (or, after a rollback, none of it) (exit 1).
 * It never pushes, never migrates and never prints DATABASE_URL. Development only (decisions D-6 / D-7 are open).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { assertDisposableLocalDatabaseUrl, assertDisposableLocalServer, describeTarget, UnsafeDatabaseTargetError } from "./local-db-guard";
import { runPreflight, type PreflightResult } from "./release-preflight";

export const PO02D1B_SEED_SQL_PATH = join(process.cwd(), "drizzle", "platform", "PO02D1B_seed_trial_and_settings.sql");
export const PO02D1B_SEED_ROLLBACK_SQL_PATH = join(process.cwd(), "drizzle", "platform", "PO02D1B_seed_rollback.sql");

/**
 * The display-only module-group catalog snapshot: the nine navigation groups of src/components/layout/nav-config.ts in
 * declaration order (the unlabelled first group is named by its only item). Dictionary keys — the UI shows Arabic.
 * Nothing reads it to grant, hide or block anything (Stage 2: "configured — not enforced").
 */
export const TRIAL_MODULE_GROUPS = ["Dashboard", "Projects", "Sales", "Purchasing", "Inventory", "Clients", "Finance", "People", "Administration"] as const;

/** The approved seed — the same values as the reviewed SQL's pg_temp.po02d1b_approved(). */
export const TRIAL_SEED = {
  settings: {
    default_trial_days: 14,
    grace_days: 0,
    expiry_alerts_enabled: true,
    manual_billing: true,
    platform_mfa_required: true,
    platform_currency: "SAR",
    platform_timezone: "Asia/Riyadh",
  },
  package: { code: "trial", name: "Trial", description: null, status: "active", is_trial: true, is_default_trial: true, created_by_platform_admin_id: null },
  version: {
    version_number: 1,
    publish_state: "published",
    is_trial: true,
    currency_code: "SAR",
    monthly_price: "0.00",
    annual_price: "0.00",
    included_seats: 3,
    storage_allowance_gb: 5,
    trial_days: 14,
    module_groups: [...TRIAL_MODULE_GROUPS],
    created_by_platform_admin_id: null,
  },
} as const;

export const SEED_CREATED = [
  "S1 platform_settings: created",
  "S2 subscription_packages trial: created",
  "S3 subscription_package_versions trial v1: created",
  "S4 platform_audit_events: recorded",
] as const;
export const SEED_VERIFIED = [
  "S1 platform_settings: verified",
  "S2 subscription_packages trial: verified",
  "S3 subscription_package_versions trial v1: verified",
  "S4 platform_audit_events: none (everything verified; nothing created)",
] as const;
export const ROLLBACK_REMOVED = [
  "R1 subscription_package_versions trial v1: removed",
  "R2 subscription_packages trial: removed",
  "R3 platform_settings: removed",
  "R4 platform_audit_events: recorded",
] as const;
export const ROLLBACK_ABSENT = [
  "R1 subscription_package_versions trial v1: absent",
  "R2 subscription_packages trial: absent",
  "R3 platform_settings: absent",
  "R4 platform_audit_events: none (nothing to remove)",
] as const;

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
export type TrialSeedState = "absent" | "complete" | "partial" | "different";
export type TrialSeedReport = { state: TrialSeedState; findings: string[]; present: { settings: boolean; package: boolean; version: boolean } };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function diffs(label: string, actual: Record<string, unknown>, expected: Record<string, unknown>): string[] {
  return Object.keys(expected)
    .filter((k) => !same(actual[k], expected[k]))
    .map((k) => `${label}.${k}: ${JSON.stringify(actual[k])} (approved ${JSON.stringify(expected[k])})`);
}

/** Read-only: does the database hold exactly the approved seed, none of it, part of it, or something else? */
export async function checkTrialSeed(client: Queryable): Promise<TrialSeedReport> {
  const findings: string[] = [];
  const s = (
    await client.query(
      `select default_trial_days, grace_days, expiry_alerts_enabled, manual_billing, platform_mfa_required, platform_currency, platform_timezone
       from public.platform_settings where id = 1`,
    )
  ).rows[0];
  const p = (
    await client.query(
      `select id, code, name, description, status, is_trial, is_default_trial, created_by_platform_admin_id
       from public.subscription_packages where code = $1`,
      [TRIAL_SEED.package.code],
    )
  ).rows[0];
  const v = p
    ? (
        await client.query(
          `select version_number, publish_state, is_trial, currency_code, monthly_price::text as monthly_price, annual_price::text as annual_price,
                  included_seats, storage_allowance_gb, trial_days, module_groups, created_by_platform_admin_id, published_at is not null as published
           from public.subscription_package_versions where package_id = $1 and version_number = 1`,
          [p.id],
        )
      ).rows[0]
    : undefined;
  if (s) findings.push(...diffs("platform_settings", s, TRIAL_SEED.settings));
  if (p) {
    const { id: _id, ...pkg } = p;
    void _id;
    findings.push(...diffs("subscription_packages", pkg, TRIAL_SEED.package));
  }
  if (v) {
    const { published, ...ver } = v;
    findings.push(...diffs("subscription_package_versions", ver, TRIAL_SEED.version));
    if (published !== true) findings.push("subscription_package_versions: version 1 has no published_at");
  }
  const defaults = Number((await client.query(`select count(*)::int as n from public.subscription_packages where is_default_trial`)).rows[0].n);
  if (defaults > 1 || (defaults === 1 && !p?.is_default_trial)) findings.push(`${defaults} default Trial package(s), not the seed's alone`);
  const present = { settings: Boolean(s), package: Boolean(p), version: Boolean(v) };
  const count = Object.values(present).filter(Boolean).length;
  const state: TrialSeedState = findings.length > 0 ? "different" : count === 0 ? "absent" : count === 3 ? "complete" : "partial";
  return { state, findings, present };
}

export type SeedOutcome = { mode: "seed" | "rollback"; steps: string[]; check: TrialSeedReport; preflight: Pick<PreflightResult, "verdict" | "state"> };

/** Refusals carry the exit code the CLI reports. */
export class SeedRefusedError extends Error {
  constructor(
    readonly exitCode: 1 | 3 | 4,
    message: string,
    readonly detail: string[] = [],
  ) {
    super(message);
    this.name = "SeedRefusedError";
  }
}

const stepsOf = (res: unknown) =>
  (Array.isArray(res) ? res : [res]).flatMap((r) => ((r as { rows?: Record<string, unknown>[] }).rows ?? []).map((x) => x.po02d1b_step)).filter((x): x is string => typeof x === "string");

/** Guard → preflight (PUSH_SAFE + REVIEWED_SQL_COMPLETE) → the reviewed SQL → read-only post-check. */
export async function runSeed(databaseUrl: string | undefined, opts: { rollback?: boolean } = {}): Promise<SeedOutcome> {
  const mode = opts.rollback ? "rollback" : "seed";
  const target = assertDisposableLocalDatabaseUrl(databaseUrl);
  const preflight = await runPreflight(databaseUrl);
  if (preflight.verdict !== "PUSH_SAFE" || preflight.state !== "REVIEWED_SQL_COMPLETE") {
    throw new SeedRefusedError(
      3,
      `the release preflight did not pass (${preflight.verdict}, ${preflight.state}); nothing was changed`,
      preflight.findings.filter((f) => f.severity === "blocking").map((f) => `${f.code} ${f.message}`),
    );
  }
  const client = new Client({ connectionString: databaseUrl, application_name: `platform-${mode}` });
  await client.connect();
  try {
    await assertDisposableLocalServer(client, target);
    let steps: string[];
    try {
      steps = stepsOf(await client.query(readFileSync(opts.rollback ? PO02D1B_SEED_ROLLBACK_SQL_PATH : PO02D1B_SEED_SQL_PATH, "utf8")));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
      const message = err instanceof Error ? err.message : String(err);
      if (code === "P0001" || code.startsWith("23")) throw new SeedRefusedError(4, message);
      throw err;
    }
    const check = await checkTrialSeed(client);
    const expected: TrialSeedState = opts.rollback ? "absent" : "complete";
    if (check.state !== expected) throw new SeedRefusedError(1, `post-check failed: the database holds ${check.state} seed data, expected ${expected}`, check.findings);
    return { mode, steps, check, preflight: { verdict: preflight.verdict, state: preflight.state } };
  } finally {
    await client.end();
  }
}

async function main() {
  const json = process.argv.includes("--json");
  const rollback = process.argv.includes("--rollback");
  const name = rollback ? "platform:db:seed-rollback" : "platform:db:seed";
  try {
    const target = assertDisposableLocalDatabaseUrl(process.env.DATABASE_URL);
    if (!json) console.log(`${name} → ${describeTarget(target)} (development only)`);
    const r = await runSeed(process.env.DATABASE_URL, { rollback });
    if (json) console.log(JSON.stringify(r));
    else {
      console.log(`  preflight: ${r.preflight.verdict} / ${r.preflight.state}`);
      for (const s of r.steps) console.log(`  ${s}`);
      console.log(`  post-check: ${r.check.state}`);
      console.log(`RESULT: ${rollback ? "ROLLED_BACK" : "SEEDED"}`);
    }
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof UnsafeDatabaseTargetError) {
      console.error(`REFUSED [${err.reasonCode}] ${err.message}`);
      process.exitCode = 2;
      return;
    }
    if (err instanceof SeedRefusedError) {
      console.error(`${name} REFUSED: ${err.message}`);
      for (const d of err.detail) console.error(`  ${d}`);
      process.exitCode = err.exitCode;
      return;
    }
    console.error(`${name} failed (fail closed): ${err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>") : String(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && /trial-seed\.ts$/.test(process.argv[1])) void main();
