/**
 * The cleanup manifest and the evidence report.
 *
 * CLEANUP IS MANIFEST-DRIVEN, NEVER PREFIX-DRIVEN. Deleting "everything under organizations/" would
 * be correct on a disposable store and catastrophic if the harness were ever pointed at a real one
 * — and the whole point of a safety design is that it stays safe when an assumption turns out to be
 * wrong. Only a pathname this run recorded as having CREATED can be deleted by this run.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { redactDeep, say } from "./redact.mjs";

export const RUN_ROOT = ".batch3-provider-verification";

export type StoreRole = "public-source" | "private-destination";

/**
 * An object's lifecycle, and the reason cleanup can be trusted.
 *
 *   planned       recorded before the write was attempted. The run does NOT own this pathname:
 *                 something may already have been there, or the write may never have happened.
 *                 CLEANUP MUST NOT DELETE IT without first proving the bytes are the ones this run
 *                 intended to write.
 *   created       the write returned successfully. The run owns it and cleanup may delete it.
 *   create-failed the write threw. Ownership is UNKNOWN — an ambiguous network failure can still
 *                 have committed on the provider — so cleanup resolves it by comparing sha256
 *                 before deciding, and leaves anything that does not match alone.
 *   verified-gone deleted, and the deletion was confirmed by a follow-up read.
 *   cleanup-failed the deletion did not happen, or could not be confirmed.
 *   skipped-not-owned cleanup declined: the pathname holds bytes this run did not write.
 */
export type ObjectState = "planned" | "created" | "create-failed";
export type CleanupStatus = "pending" | "verified-gone" | "cleanup-failed" | "skipped-not-owned" | "inconclusive";

export type ManifestObject = {
  storeRole: StoreRole;
  /** Empty while a prefix reservation is unresolved — see `prefix`. */
  pathname: string;
  /**
   * Set when the run cannot know the pathname in advance because the APPLICATION generates it
   * (storeBlob() mints `{orgId}-{timestamp}-{random}`). Recording the prefix and the intended
   * sha256 before the call keeps the before-write guarantee: a crash mid-write still leaves a
   * record of everything that could exist, and cleanup resolves it by listing this prefix and
   * matching bytes — so it still deletes only objects proven to be this run's.
   */
  prefix?: string;
  purpose: string;
  /** sha256 of the bytes this run INTENDED to write. Cleanup's ownership test compares against it. */
  sha256: string;
  size: number;
  plannedAt: string;
  createdAt?: string;
  state: ObjectState;
  createError?: string;
  cleanupStatus: CleanupStatus;
  cleanupNote?: string;
};

/**
 * A disposable test organization, recorded BEFORE /register is submitted.
 *
 * The email is known in advance and is unique to this run, so a crash between a successful
 * registration and the manifest write still leaves cleanup an exact locator: it finds that one user
 * by that one address, resolves its org, and removes it. No LIKE pattern, no prefix sweep.
 */
export type ManifestTestOrg = {
  email: string;
  orgId: number | null;
  purpose: string;
  cleanupStatus: CleanupStatus;
  cleanupNote?: string;
};

export type Manifest = {
  runId: string;
  startedAt: string;
  commitSha: string;
  identities: Record<string, string>;
  objects: ManifestObject[];
  testOrgs: ManifestTestOrg[];
};

/** Every classification an assertion may carry. They are never blended in the summary. */
export type Classification =
  | "REAL PROVIDER PROVEN"
  | "REAL PREVIEW APPLICATION PROVEN"
  | "APPLICATION-LEVEL TEST PROVEN"
  | "NOT RUN / NOT PROVEN";

export type Finding = {
  section: string;
  name: string;
  classification: Classification;
  passed: boolean | null; // null = not run
  /**
   * Whether the verdict depends on this check.
   *
   * A handful of fault-injection items cannot be reproduced safely against a live provider — doing
   * so means handing the application a deliberately broken credential. They are recorded, shown
   * prominently as NOT RUN, and excluded from the verdict; without this flag the harness could
   * never return A no matter how completely it passed, which would make the whole gate pointless.
   */
  requiredForVerdict: boolean;
  detail: string;
};

/**
 * A is permitted only when every REQUIRED check ran and passed. An optional check that FAILED still
 * forces C: it was allowed to be skipped, never allowed to contradict the design.
 */
export function computeVerdict(findings: Finding[]): { verdict: string; reason: string } {
  const failedAny = findings.filter((f) => f.passed === false);
  if (failedAny.length) return { verdict: "C — FAILED", reason: `${failedAny.length} check(s) failed, including ${failedAny.filter((f) => !f.requiredForVerdict).length} optional: a check that was allowed to be skipped is never allowed to contradict the design` };
  const requiredNotRun = findings.filter((f) => f.requiredForVerdict && f.passed === null);
  if (requiredNotRun.length) return { verdict: "B — INCONCLUSIVE", reason: `${requiredNotRun.length} mandatory check(s) did not run: ${requiredNotRun.map((f) => `${f.section} ${f.name}`).slice(0, 4).join("; ")}` };
  const optionalNotRun = findings.filter((f) => !f.requiredForVerdict && f.passed === null);
  return { verdict: "A — REAL PROVIDER VERIFICATION PASSED", reason: optionalNotRun.length ? `every mandatory check passed; ${optionalNotRun.length} approved fault-injection item(s) remain NOT RUN and are reported as such` : "every check passed" };
}

export const sha256 = (b: Buffer | Uint8Array) => createHash("sha256").update(Buffer.from(b)).digest("hex");

export function runDir(runId: string): string {
  return join(RUN_ROOT, runId);
}

export class Run {
  readonly manifest: Manifest;
  readonly findings: Finding[] = [];

  constructor(runId: string, commitSha: string, identities: Record<string, string>) {
    this.manifest = { runId, startedAt: new Date().toISOString(), commitSha, identities, objects: [], testOrgs: [] };
    mkdirSync(runDir(runId), { recursive: true });
    this.saveManifest();
  }

  /**
   * Record an intended write BEFORE attempting it, so a crash in between cannot leave an object
   * nobody knows about. The entry is `planned` and confers NO ownership: cleanup will not delete a
   * planned pathname until it has proven the bytes are the ones this run meant to put there.
   */
  planObject(storeRole: StoreRole, pathname: string, purpose: string, bytes: Buffer): ManifestObject {
    const entry: ManifestObject = { storeRole, pathname, purpose, sha256: sha256(bytes), size: bytes.length, plannedAt: new Date().toISOString(), state: "planned", cleanupStatus: "pending" };
    this.manifest.objects.push(entry);
    this.saveManifest();
    return entry;
  }

  /**
   * Reserve a write whose pathname only the application can choose. Nothing is owned yet: the entry
   * stays `planned` until the call returns a concrete pathname.
   */
  planPrefixWrite(storeRole: StoreRole, prefix: string, purpose: string, bytes: Buffer): ManifestObject {
    const entry: ManifestObject = { storeRole, pathname: "", prefix, purpose, sha256: sha256(bytes), size: bytes.length, plannedAt: new Date().toISOString(), state: "planned", cleanupStatus: "pending" };
    this.manifest.objects.push(entry);
    this.saveManifest();
    return entry;
  }

  /** The application returned a pathname, so the reservation becomes a concrete created object. */
  resolvePlannedPathname(entry: ManifestObject, pathname: string): void {
    entry.pathname = pathname;
    entry.state = "created";
    entry.createdAt = new Date().toISOString();
    this.saveManifest();
  }

  markObjectCreated(entry: ManifestObject): void {
    entry.state = "created";
    entry.createdAt = new Date().toISOString();
    this.saveManifest();
  }

  markObjectCreateFailed(entry: ManifestObject, error: unknown): void {
    entry.state = "create-failed";
    entry.createError = String(error);
    this.saveManifest();
  }

  /** Record the test identity BEFORE registration is submitted; the email is the cleanup locator. */
  planTestOrg(email: string, purpose: string): ManifestTestOrg {
    const entry: ManifestTestOrg = { email, orgId: null, purpose, cleanupStatus: "pending" };
    this.manifest.testOrgs.push(entry);
    this.saveManifest();
    return entry;
  }

  resolveTestOrg(entry: ManifestTestOrg, orgId: number): void {
    entry.orgId = orgId;
    this.saveManifest();
  }

  record(section: string, name: string, classification: Classification, passed: boolean | null, detail = "", requiredForVerdict = true): void {
    this.findings.push({ section, name, classification, passed, requiredForVerdict, detail });
    const mark = passed === null ? (requiredForVerdict ? "NOT RUN*" : "NOT RUN") : passed ? "PASS" : "FAIL";
    say(`  ${mark.padEnd(8)} [${classification}] ${section} — ${name}${detail ? `  :: ${detail}` : ""}`);
  }

  saveManifest(): void {
    writeFileSync(join(runDir(this.manifest.runId), "manifest.json"), JSON.stringify(redactDeep(this.manifest), null, 2));
  }

  /** report.json + report.md. Both pass through deep redaction on the way out. */
  writeReport(verdict: string, notes: string[]): void {
    const dir = runDir(this.manifest.runId);
    const byClass = (c: Classification) => this.findings.filter((f) => f.classification === c);
    const counts = {
      realProviderProven: byClass("REAL PROVIDER PROVEN").filter((f) => f.passed).length,
      realPreviewApplicationProven: byClass("REAL PREVIEW APPLICATION PROVEN").filter((f) => f.passed).length,
      applicationLevelTestProven: byClass("APPLICATION-LEVEL TEST PROVEN").filter((f) => f.passed).length,
      mandatoryNotRun: this.findings.filter((f) => f.requiredForVerdict && f.passed === null).length,
      approvedOptionalNotRun: this.findings.filter((f) => !f.requiredForVerdict && f.passed === null).length,
      failed: this.findings.filter((f) => f.passed === false).length,
    };
    const report = {
      runId: this.manifest.runId,
      generatedAt: new Date().toISOString(),
      commitSha: this.manifest.commitSha,
      identities: this.manifest.identities,
      verdict,
      counts,
      notes,
      findings: this.findings,
      manifest: {
        objectsPlanned: this.manifest.objects.length,
        objectsCreated: this.manifest.objects.filter((o) => o.state === "created").length,
        objectsCreateFailed: this.manifest.objects.filter((o) => o.state === "create-failed").length,
        testOrgs: this.manifest.testOrgs.length,
      },
    };
    writeFileSync(join(dir, "report.json"), JSON.stringify(redactDeep(report), null, 2));

    const lines: string[] = [
      `# Batch 3 real-provider verification — ${this.manifest.runId}`,
      "",
      `- generated: ${report.generatedAt}`,
      `- commit: ${this.manifest.commitSha}`,
      ...Object.entries(this.manifest.identities).map(([k, v]) => `- ${k}: ${v}`),
      "",
      `## Verdict: ${verdict}`,
      "",
      "Counts are reported per classification and never summed across them — application-level evidence",
      "is not provider evidence.",
      "",
      `- REAL PROVIDER PROVEN: ${counts.realProviderProven}`,
      `- REAL PREVIEW APPLICATION PROVEN: ${counts.realPreviewApplicationProven}`,
      `- APPLICATION-LEVEL TEST PROVEN: ${counts.applicationLevelTestProven}`,
      `- NOT RUN — MANDATORY (forces B): ${counts.mandatoryNotRun}`,
      `- NOT RUN — approved fault injection (does not affect the verdict): ${counts.approvedOptionalNotRun}`,
      `- FAILED: ${counts.failed}`,
      "",
      ...(notes.length ? ["## Notes", "", ...notes.map((n) => `- ${n}`), ""] : []),
      "## Findings",
      "",
      "| Section | Check | Classification | Required | Result | Detail |",
      "| --- | --- | --- | --- | --- | --- |",
      ...this.findings.map((f) => `| ${f.section} | ${f.name} | ${f.classification} | ${f.requiredForVerdict ? "yes" : "no" } | ${f.passed === null ? "NOT RUN" : f.passed ? "PASS" : "FAIL"} | ${f.detail.replace(/\|/g, "\\|")} |`),
      "",
      "## Cleanup manifest",
      "",
      `${this.manifest.objects.length} blob objects planned, ${this.manifest.objects.filter((o) => o.state === "created").length} confirmed created, ${this.manifest.testOrgs.length} test organizations.`,
      "Cleanup deletes only objects this run is proven to own — never a prefix scan, and never a",
      "merely-planned pathname whose bytes it has not matched.",
      "",
    ];
    writeFileSync(join(dir, "report.md"), redactDeep(lines.join("\n")));
    say(`\nreport written: ${join(dir, "report.json")} and report.md`);
  }
}

export function loadManifest(runId: string): Manifest {
  const p = join(runDir(runId), "manifest.json");
  if (!existsSync(p)) throw new Error(`no manifest at ${p} — refusing to clean up without one`);
  return JSON.parse(readFileSync(p, "utf8")) as Manifest;
}

export function saveManifestFor(m: Manifest): void {
  writeFileSync(join(runDir(m.runId), "manifest.json"), JSON.stringify(redactDeep(m), null, 2));
}
