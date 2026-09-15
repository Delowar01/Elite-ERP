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
export type CleanupStatus = "pending" | "deleted" | "verified-gone" | "failed";

export type ManifestObject = {
  storeRole: StoreRole;
  pathname: string;
  purpose: string;
  sha256: string;
  size: number;
  createdAt: string;
  cleanupStatus: CleanupStatus;
  cleanupNote?: string;
};

export type ManifestDbRow = { table: string; identifier: string; purpose: string; cleanupStatus: CleanupStatus };

export type Manifest = {
  runId: string;
  startedAt: string;
  commitSha: string;
  identities: Record<string, string>;
  objects: ManifestObject[];
  dbRows: ManifestDbRow[];
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
  detail: string;
};

export const sha256 = (b: Buffer | Uint8Array) => createHash("sha256").update(Buffer.from(b)).digest("hex");

export function runDir(runId: string): string {
  return join(RUN_ROOT, runId);
}

export class Run {
  readonly manifest: Manifest;
  readonly findings: Finding[] = [];

  constructor(runId: string, commitSha: string, identities: Record<string, string>) {
    this.manifest = { runId, startedAt: new Date().toISOString(), commitSha, identities, objects: [], dbRows: [] };
    mkdirSync(runDir(runId), { recursive: true });
    this.saveManifest();
  }

  /**
   * Record an object BEFORE it is created, so a crash between the write and the record cannot leave
   * an orphan the cleanup does not know about. Callers write only after this returns.
   */
  willCreate(storeRole: StoreRole, pathname: string, purpose: string, bytes: Buffer): ManifestObject {
    const entry: ManifestObject = { storeRole, pathname, purpose, sha256: sha256(bytes), size: bytes.length, createdAt: new Date().toISOString(), cleanupStatus: "pending" };
    this.manifest.objects.push(entry);
    this.saveManifest();
    return entry;
  }

  willCreateDbRow(table: string, identifier: string, purpose: string): void {
    this.manifest.dbRows.push({ table, identifier, purpose, cleanupStatus: "pending" });
    this.saveManifest();
  }

  record(section: string, name: string, classification: Classification, passed: boolean | null, detail = ""): void {
    this.findings.push({ section, name, classification, passed, detail });
    const mark = passed === null ? "NOT RUN" : passed ? "PASS" : "FAIL";
    say(`  ${mark.padEnd(7)} [${classification}] ${section} — ${name}${detail ? `  :: ${detail}` : ""}`);
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
      notRun: this.findings.filter((f) => f.passed === null).length,
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
      manifest: { objects: this.manifest.objects.length, dbRows: this.manifest.dbRows.length },
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
      `- NOT RUN / NOT PROVEN: ${counts.notRun}`,
      `- FAILED: ${counts.failed}`,
      "",
      ...(notes.length ? ["## Notes", "", ...notes.map((n) => `- ${n}`), ""] : []),
      "## Findings",
      "",
      "| Section | Check | Classification | Result | Detail |",
      "| --- | --- | --- | --- | --- |",
      ...this.findings.map((f) => `| ${f.section} | ${f.name} | ${f.classification} | ${f.passed === null ? "NOT RUN" : f.passed ? "PASS" : "FAIL"} | ${f.detail.replace(/\|/g, "\\|")} |`),
      "",
      "## Cleanup manifest",
      "",
      `${this.manifest.objects.length} blob objects, ${this.manifest.dbRows.length} database rows recorded.`,
      "Cleanup deletes only these pathnames. Never a prefix scan.",
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
