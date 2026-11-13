/**
 * Platform Owner PO-01B — a local PREVIEW database for the console, with the same fail-closed rules
 * as every other platform script: the admin connection must be a loopback `*_test_only_*` database
 * on a loopback-only server, and the new database is a `*_test_only_*` one created through it.
 *
 *   PLATFORM_TEST_ADMIN_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/<admin db with _test_only_> \
 *     npm run platform:preview-db
 *
 * Creates the database, pushes the full branch schema (customer tables + the four platform tables,
 * through a throw-away drizzle config — the repository's drizzle.config.ts and .env are never used)
 * and applies the reviewed platform SQL (append-only audit protection), then prints the database
 * NAME — never a connection string. Point DATABASE_URL at it in your own shell, run
 * `npm run platform:bootstrap` to create a fictional Platform Owner, then build and start the app
 * with PLATFORM_CONSOLE_ENABLED=true (docs/platform-owner/PO01B_DEVELOPMENT.md, "Local preview").
 *
 * Exit: 0 created · 1 error. Drop it afterwards with `dropdb` (or keep it for the next preview).
 */
import { createPlatformTestDatabase } from "./disposable-db";

async function main() {
  const { name } = await createPlatformTestDatabase("platform_preview");
  console.log(`platform:preview-db → created ${name} (full branch schema + platform SQL, no data)`);
  console.log("Next: export DATABASE_URL for this database in your shell, then run `npm run platform:bootstrap`.");
}

main().catch((err) => {
  console.error(`platform:preview-db failed: ${err instanceof Error ? err.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted-url>") : String(err)}`);
  process.exitCode = 1;
});
