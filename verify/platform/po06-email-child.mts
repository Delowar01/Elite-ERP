/**
 * PO-06 test child — drives the REAL customer writers against one disposable database, for the users_email_lower_uq
 * compatibility checks of verify/verify-po06-data-safety.mts. A separate process because the application's database
 * module binds DATABASE_URL at import. Prints one JSON line; never prints the URL, an e-mail address or a password.
 *
 *   DATABASE_URL=<loopback *_test_only_* database> tsx --conditions=react-server verify/platform/po06-email-child.mts \
 *     register <email> <company name>          the /register action's database steps, in its order: the exact-match
 *                                              pre-check, then ONE transaction running bootstrapOrganization (the shared
 *                                              helper /register and invitation acceptance both use)
 *     team-add <actor user id> <email>         addTeamMember (the Team's Add Member service) inside a request scope
 */
// request-scope must load before any Next.js module: it installs the AsyncLocalStorage that Next's request stores need
import { withRequest } from "./request-scope";
import { assertDisposableLocalDatabaseUrl } from "../../scripts/platform/local-db-guard";

assertDisposableLocalDatabaseUrl(process.env.DATABASE_URL);
const [mode, a, b] = process.argv.slice(2);
const { db, pool, usersTable } = await import("../../src/db");
const { eq } = await import("drizzle-orm");

const pgError = (err: unknown) => {
  for (let e: unknown = err, d = 0; e && d < 5; e = (e as { cause?: unknown }).cause, d++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return { code, constraint: String((e as { constraint?: unknown }).constraint ?? "") };
  }
  return null;
};

let result: Record<string, unknown>;
try {
  if (mode === "register") {
    const { bootstrapOrganization } = await import("../../src/lib/org-bootstrap");
    const email = a.trim().toLowerCase();
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) result = { outcome: "precheck-refused" };
    else {
      try {
        const r = await db.transaction(async (tx) =>
          bootstrapOrganization(tx, { orgName: b, country: "Saudi Arabia", currency: "SAR", ownerName: "Fictional Registrant", ownerEmail: email, passwordHash: `$2a$04$${"R".repeat(53)}` }),
        );
        result = { outcome: "created", orgId: r.orgId };
      } catch (err) {
        // the real /register action has no handler here: this error would reach the user as a failed server action
        result = { outcome: "error", ...(pgError(err) ?? { code: "n/a", constraint: "" }) };
      }
    }
  } else if (mode === "team-add") {
    const memberAdd = await import("../../src/lib/team/member-add");
    const [actor] = await db.select().from(usersTable).where(eq(usersTable.id, Number(a)));
    const session = { userId: actor.id, orgId: actor.orgId, name: actor.name, email: actor.email, role: actor.role, isActive: true } as unknown as Parameters<typeof memberAdd.addTeamMember>[0];
    const headers = { host: "customer.erp.test", origin: "https://customer.erp.test", "sec-fetch-site": "same-origin", "user-agent": "verify-po06-email-child" };
    const r = await withRequest(headers, () => memberAdd.addTeamMember(session, { name: "Fictional Member", email: b, password: "Fictional-Passw0rd!x", role: "staff" }, "en"));
    result = { outcome: "error" in r && r.error ? "refused" : "created", message: "error" in r ? r.error : null };
  } else result = { outcome: "usage" };
} catch (err) {
  const message = (err instanceof Error ? err.message : String(err)).replace(/postgres(ql)?:\/\/\S+/g, "<url>").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>").slice(0, 240);
  result = { outcome: "crash", ...(pgError(err) ?? {}), name: err instanceof Error ? err.name : "unknown", message };
}
console.log(JSON.stringify(result));
await pool.end();
