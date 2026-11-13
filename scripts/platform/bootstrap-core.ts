/**
 * Platform Owner PO-01A — one-time Platform Owner bootstrap (core logic; I/O injected).
 *
 * PO-01A scope: DISPOSABLE LOCAL DATABASES ONLY, with a FICTIONAL test administrator. The
 * production bootstrap channel is a separate owner decision (PO-00 D-2).
 *
 * Order of checks (all before any prompt, so a refusal never collects a secret):
 *   1. target    — loopback host, `_test_only_` name, loopback-only server   → exit 2
 *   2. readiness — platform tables + append-only audit protection present,
 *                  field encryption configured                               → exit 5
 *   3. uniqueness— no ACTIVE platform administrator exists                    → exit 3
 * Then (CLI only) the terminal must be interactive                            → exit 4.
 * The uniqueness check is repeated inside the insert transaction under an advisory lock, so two
 * concurrent bootstraps cannot both succeed. Nothing is hard-coded: e-mail, name and password are
 * typed by the operator; the TOTP secret and recovery codes are generated and shown exactly once.
 */
import { Client } from "pg";
import { assertDisposableLocalDatabaseUrl, assertDisposableLocalServer, describeTarget, UnsafeDatabaseTargetError } from "./local-db-guard";
import { checkPlatformObjects } from "./catalog";

export const BOOTSTRAP_EXIT = { OK: 0, ERROR: 1, UNSAFE_TARGET: 2, ACTIVE_ADMIN_EXISTS: 3, NOT_INTERACTIVE: 4, NOT_READY: 5, ABORTED: 6 } as const;

export class BootstrapRefusedError extends Error {
  constructor(
    readonly exitCode: number,
    readonly reasonCode: string,
    message: string,
  ) {
    super(message);
    this.name = "BootstrapRefusedError";
  }
}

export type BootstrapIO = {
  ask(prompt: string): Promise<string>;
  askHidden(prompt: string): Promise<string>;
  /** Ordinary progress output. */
  say(line: string): void;
  /** One-time secret output (provisioning URI, manual key, recovery codes). Never logged. */
  saySecret(line: string): void;
};

const MAX_TRIES = 3;

/** Checks 1–3. Opens one guarded connection and closes it. Never prompts. */
export async function preflightBootstrap(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  let target;
  try {
    target = assertDisposableLocalDatabaseUrl(env.DATABASE_URL);
  } catch (err) {
    if (err instanceof UnsafeDatabaseTargetError) throw new BootstrapRefusedError(BOOTSTRAP_EXIT.UNSAFE_TARGET, err.reasonCode, err.message);
    throw err;
  }
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    try {
      await assertDisposableLocalServer(client, target);
    } catch (err) {
      if (err instanceof UnsafeDatabaseTargetError) throw new BootstrapRefusedError(BOOTSTRAP_EXIT.UNSAFE_TARGET, err.reasonCode, err.message);
      throw err;
    }
    const report = await checkPlatformObjects(client);
    if (!report.ok) {
      throw new BootstrapRefusedError(BOOTSTRAP_EXIT.NOT_READY, "SCHEMA_NOT_READY", `Platform schema is not ready (${report.findings.join("; ")}). Run npm run platform:db:apply first.`);
    }
    if (!env.FIELD_ENCRYPTION_KEYS) {
      throw new BootstrapRefusedError(BOOTSTRAP_EXIT.NOT_READY, "ENCRYPTION_NOT_CONFIGURED", "FIELD_ENCRYPTION_KEYS is not set; the TOTP secret must be stored encrypted.");
    }
    const { rows } = await client.query("select count(*)::int as n from platform_admins where is_active");
    if ((rows[0] as { n: number }).n > 0) {
      throw new BootstrapRefusedError(BOOTSTRAP_EXIT.ACTIVE_ADMIN_EXISTS, "ACTIVE_ADMIN_EXISTS", "An active platform administrator already exists. Bootstrap is one-time only.");
    }
  } finally {
    await client.end();
  }
  return describeTarget(target);
}

async function retry<T>(io: BootstrapIO, attempt: () => Promise<T | null>): Promise<T> {
  for (let i = 0; i < MAX_TRIES; i++) {
    const value = await attempt();
    if (value !== null) return value;
  }
  throw new BootstrapRefusedError(BOOTSTRAP_EXIT.ABORTED, "TOO_MANY_INVALID_ANSWERS", "Too many invalid answers; nothing was created.");
}

/** Full interactive bootstrap. Returns the new administrator's id. */
export async function runBootstrap(io: BootstrapIO): Promise<{ adminId: string }> {
  const where = await preflightBootstrap();
  io.say(`Platform Owner bootstrap — disposable database ${where}. Use FICTIONAL test details only.`);

  // App modules are loaded only after the target passed the guard (they bind a pool to DATABASE_URL).
  const { db, platformAdminsTable } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { hashPlatformPassword, isValidPlatformEmail, normalizePlatformEmail, validatePlatformPassword } = await import("@/lib/platform/auth");
  const { createRecoveryCodeSet, createTotpEnrollment, encryptTotpSecret } = await import("@/lib/platform/mfa");
  const { assertPlatformAuditProtection, recordPlatformAudit } = await import("@/lib/platform/audit");
  const { matchTotpStep } = await import("@/lib/platform/totp");
  const { platformClock } = await import("@/lib/platform/clock");

  await assertPlatformAuditProtection({ force: true });

  const email = await retry(io, async () => {
    const value = normalizePlatformEmail(await io.ask("Platform Owner e-mail: "));
    if (isValidPlatformEmail(value)) return value;
    io.say("  That is not a valid e-mail address.");
    return null;
  });
  const displayName = await retry(io, async () => {
    const value = (await io.ask("Display name: ")).trim();
    if (value.length >= 1 && value.length <= 200) return value;
    io.say("  The display name must be 1–200 characters.");
    return null;
  });
  const password = await retry(io, async () => {
    const first = await io.askHidden("Password (min 14, upper, lower, number, symbol): ");
    const problems = validatePlatformPassword(first, { email });
    if (problems.length) {
      for (const p of problems) io.say(`  ${p}`);
      return null;
    }
    if ((await io.askHidden("Confirm password: ")) !== first) {
      io.say("  The passwords do not match.");
      return null;
    }
    return first;
  });

  const enrollment = createTotpEnrollment(email);
  io.say("Add this account to an authenticator app (shown once):");
  io.saySecret(`  Provisioning URI: ${enrollment.otpauthUri}`);
  io.saySecret(`  Manual key: ${enrollment.secret}`);
  const step = await retry(io, async () => {
    const matched = matchTotpStep(enrollment.secret, await io.ask("Enter the current 6-digit code: "), platformClock.now(), 1);
    if (matched !== null) return matched;
    io.say("  That code does not match. Check the authenticator and the device clock.");
    return null;
  });

  const { codes, hashes } = await createRecoveryCodeSet();
  const passwordHash = await hashPlatformPassword(password);
  const mfaSecretEncrypted = encryptTotpSecret(enrollment.secret);
  const now = platformClock.now();

  const adminId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('elite-erp:platform-bootstrap', 0))`);
    const [{ n }] = (await tx.execute(sql`select count(*)::int as n from platform_admins where is_active`)).rows as { n: number }[];
    if (n > 0) {
      throw new BootstrapRefusedError(BOOTSTRAP_EXIT.ACTIVE_ADMIN_EXISTS, "ACTIVE_ADMIN_EXISTS", "An active platform administrator already exists. Bootstrap is one-time only.");
    }
    const [row] = await tx
      .insert(platformAdminsTable)
      .values({
        emailNormalized: email,
        displayName,
        passwordHash,
        isActive: true,
        mfaSecretEncrypted,
        mfaRecoveryHashes: hashes,
        mfaEnrolledAt: now,
        // The enrollment code's step is recorded, so it cannot also be used to log in.
        mfaLastTotpStep: step,
        passwordChangedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: platformAdminsTable.id });
    await recordPlatformAudit(
      {
        actorAdminId: row.id,
        actorLabel: displayName,
        action: "bootstrap.completed",
        entityType: "platform_admin",
        entityId: row.id,
        after: { channel: "local-cli", mfa: "totp", backupCodesIssued: codes.length },
        result: "success",
      },
      tx,
    );
    return row.id;
  });

  io.say("Recovery codes — each works once. Store them offline now; they are not shown again:");
  for (const code of codes) io.saySecret(`  ${code}`);
  io.say(`Platform Owner created (id ${adminId}). Bootstrap is now closed for this database.`);
  return { adminId };
}
