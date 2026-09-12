/**
 * R-22 — the backup must not tell an operator that uploaded files are covered when they are not.
 *
 * The old script defaulted `UPLOADS_DIR` to `./uploads`, a directory that stopped existing when
 * storage moved to Vercel Blob. It found nothing, printed "(skipping)", and EXITED 0 — so every
 * run looked successful while the file half of the backup silently did nothing. The DR document
 * said the same thing in prose: "the database backup **is** the system backup, plus the `uploads/`
 * directory".
 *
 * This suite RUNS THE SCRIPT rather than reading it. That distinction is the whole point: the
 * repository already catalogues "testing the artefact instead of the state", and a check that
 * greps backup.sh for reassuring words would pass against a script that still exits 0 on a silent
 * skip. Exit codes and emitted files are the state; the source text is the artefact.
 *
 * Three behaviours are pinned:
 *   1. no UPLOADS_DIR  -> succeeds, and SAYS uploaded files are not covered
 *   2. UPLOADS_DIR set but missing -> FAILS, rather than omitting what was asked for
 *   3. UPLOADS_DIR set and present -> still archives it, so the legacy self-hosted path works
 *
 * Plus the claims in the DR document, asserted absent — a wording fix can be improved freely, but
 * "uploads/ is the file backup" must not come back.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

const DB = process.env.DATABASE_URL;
if (!DB) { console.error("DATABASE_URL is required"); process.exit(1); }

/** Run backup.sh in an isolated output dir and report what it did. */
function runBackup(env: Record<string, string>): { code: number; out: string; files: string[]; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "erp-backup-"));
  let code = 0, out = "";
  try {
    out = execFileSync("bash", ["scripts/backup.sh"], {
      env: { ...process.env, DATABASE_URL: DB, BACKUP_DIR: dir, ...env },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    code = err.status ?? 1;
    out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  return { code, out, files: readdirSync(dir), dir };
}

// ── 1. The deployed shape: no local uploads directory anywhere ─────────────────────────────────
{
  const r = runBackup({});
  check("no UPLOADS_DIR: the backup succeeds", r.code === 0, `exit ${r.code}`);
  check("no UPLOADS_DIR: a database dump is produced",
    r.files.some((f) => f.startsWith("elite-erp-db-")), r.files.join(", "));
  check("no UPLOADS_DIR: NO uploads archive is produced",
    !r.files.some((f) => f.includes("uploads")), r.files.join(", "));
  check("no UPLOADS_DIR: the run SAYS uploaded files are not backed up",
    /NOT BACKED UP BY THIS SCRIPT/.test(r.out), r.out.split("\n").filter((l) => /uploaded/i.test(l)).join(" | "));
  check("no UPLOADS_DIR: it points at where they actually live",
    /Vercel Blob/.test(r.out) && /backup-dr\.md/.test(r.out));
  check("no UPLOADS_DIR: it does NOT print the old silent-skip line",
    !/\(skipping\)/.test(r.out));
  rmSync(r.dir, { recursive: true, force: true });
}

// ── 2. The operator asked for a local uploads backup and it is not there ───────────────────────
{
  const r = runBackup({ UPLOADS_DIR: join(tmpdir(), `definitely-absent-${Math.random().toString(36).slice(2)}`) });
  check("UPLOADS_DIR set but missing: the backup FAILS instead of skipping", r.code !== 0, `exit ${r.code}`);
  check("UPLOADS_DIR set but missing: it says why", /Refusing to report a successful backup/.test(r.out), r.out.trim().split("\n").pop() ?? "");
  rmSync(r.dir, { recursive: true, force: true });
}

// ── 3. A legacy self-hosted install still works ────────────────────────────────────────────────
{
  const up = mkdtempSync(join(tmpdir(), "erp-uploads-"));
  mkdirSync(join(up, "logos"), { recursive: true });
  writeFileSync(join(up, "logos", "a.png"), "not-really-a-png");
  const r = runBackup({ UPLOADS_DIR: up });
  check("UPLOADS_DIR set and present: the backup succeeds", r.code === 0, `exit ${r.code}`);
  check("UPLOADS_DIR set and present: the uploads archive IS produced",
    r.files.some((f) => f.includes("uploads") && f.endsWith(".tar.gz")), r.files.join(", "));
  rmSync(r.dir, { recursive: true, force: true });
  rmSync(up, { recursive: true, force: true });
}

// ── 4. The document must not re-acquire the claim ──────────────────────────────────────────────
{
  const raw = readFileSync("docs/security/backup-dr.md", "utf8");
  // Prose wraps, and markdown emphasis lands mid-phrase, so assert against a normalised copy
  // rather than against whatever line breaks the file happens to have today. An assertion that
  // fails when a paragraph is re-wrapped teaches people to stop re-wrapping paragraphs.
  const dr = raw.replace(/\*/g, "").replace(/\s+/g, " ");
  check("backup-dr.md no longer calls the database dump the whole system backup",
    !/database backup is the system backup/i.test(dr));
  check("backup-dr.md states uploaded files are NOT covered by the script",
    /not (covered by|backed up by) `scripts\/backup\.sh`/i.test(dr));
  check("backup-dr.md explains that the database keeps a pointer, not the bytes",
    /pointer, not the bytes/i.test(dr));
  // The point of the rewrite was to stop asserting things about the provider that nobody verified.
  // Forbid the ASSERTION forms, and require the page to say verification is still outstanding —
  // an absence check alone would be satisfied most easily by a page that says nothing at all.
  check("backup-dr.md does not assert unverified provider guarantees",
    !/Vercel Blob (is|provides|guarantees) (durable|replicated|backed up)/i.test(dr));
  check("backup-dr.md says the uploaded-file recovery objective is UNKNOWN",
    /recovery objective for uploaded files is unknown/i.test(dr));
  check("backup-dr.md carries the operational checklist rather than an assurance",
    (raw.match(/- \[ \]/g) ?? []).length >= 4, `${(raw.match(/- \[ \]/g) ?? []).length} unchecked items`);
  check("backup-dr.md flags the scheduling assumption as unconfirmed",
    /needs operational confirmation/i.test(dr) && /which offers neither/i.test(dr));
}

// ── 5. The restore procedure must not contradict the backup one ────────────────────────────────
// The document briefly carried TWO "Restoring" sections: a new one saying blob objects cannot be
// restored, and the original whose step 3 still said "Restore uploads/ by untarring into the app
// root". An operator following the second would untar nothing and conclude their files were back.
// A backup that is honest and a restore that is not is worse than neither, because the restore is
// the document someone reads under pressure.
{
  const raw = readFileSync("docs/security/backup-dr.md", "utf8");
  const flat = raw.replace(/\*/g, "").replace(/\s+/g, " ");
  const h2 = (raw.match(/^## Restoring\s*$/gm) ?? []).length;
  check("exactly ONE top-level Restoring section exists", h2 === 1, `${h2} found`);

  // Split the section so each procedure is asserted against its own text, not the page as a whole.
  const restore = raw.slice(raw.indexOf("\n## Restoring"));
  const current = restore.slice(restore.indexOf("### Restoring the CURRENT"), restore.indexOf("### Restoring a LEGACY"));
  const legacy = restore.slice(restore.indexOf("### Restoring a LEGACY"));
  check("the current-deployment and legacy procedures are separate sections",
    current.length > 200 && legacy.length > 100, `current ${current.length}b, legacy ${legacy.length}b`);

  const curFlat = current.replace(/\*/g, "").replace(/\s+/g, " ");
  check("the CURRENT procedure does not instruct an untar as a recovery step",
    !/Restore uploads\/ by untarring/i.test(curFlat) && !/^\s*\d\..*untar/im.test(current));
  check("the CURRENT procedure says so explicitly rather than merely omitting it",
    /Do not untar anything into the app root/i.test(curFlat));
  check("the CURRENT procedure states what a restored system has lost",
    /treat a restored system as having lost every/i.test(curFlat));
  check("the LEGACY procedure is the only place untar instructions appear",
    /untarring it into the app root/i.test(legacy.replace(/\s+/g, " ")));
  check("the LEGACY procedure marks itself as not the current deployment",
    /This is not the current deployment/i.test(legacy.replace(/\*/g, "").replace(/\s+/g, " ")));

  check("the failure-scenario table does not silently omit uploaded files",
    /Uploaded files lost or overwritten/i.test(flat) && /No procedure exists here yet/i.test(flat));

  // Strip the leading "#" of each comment line before collapsing, or a phrase that wraps across
  // two comment lines reads as "no # ability" and no sensible regex matches it.
  const rs = readFileSync("scripts/restore.sh", "utf8")
    .split("\n").map((l) => l.replace(/^\s*#\s?/, "")).join(" ").replace(/\s+/g, " ");
  check("restore.sh's header says it cannot recover blob objects",
    /no\s*ability to recover Vercel Blob objects/i.test(rs));
}

const failed = results.filter(([ok]) => !ok);
for (const [ok, name, extra] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  << ${extra}` : ""}`);
console.log(`\n${results.length - failed.length}/${results.length} checks`);
console.log(failed.length ? "BACKUP CLAIMS VERIFICATION FAIL" : "BACKUP CLAIMS VERIFICATION PASS");
process.exit(failed.length ? 1 : 0);
