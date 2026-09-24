/**
 * Run one of this repository's own TypeScript scripts, on any platform.
 *
 * WHY THIS EXISTS. The harness invoked its helpers as execFileSync("npx", ["tsx", ...]). On
 * Windows there is no executable called `npx` — there is `npx.cmd` — and execFile does not go
 * through a shell, so the call fails at SPAWN time with ENOENT. The three sections that shell out
 * (§18 migration, §19 conflict, §21 inventory) therefore failed together while every direct Blob
 * operation around them kept working: the migration "selected 0 objects", the inventory report was
 * "null", and nothing said that no process had ever started.
 *
 * That masking is the worse half of the bug. A launch failure and a script that ran and found
 * nothing are completely different facts, and the old catch (`return String(e.stdout ?? e)`) threw
 * away the distinction along with stderr.
 *
 * HOW IT RUNS NOW. `process.execPath` — the Node binary already executing — with tsx's CLI resolved
 * from the local node_modules by path. No `npx`, no shell, no PATH lookup, no `.cmd` shim, and no
 * possibility of npx deciding to INSTALL something: node is given a file that either exists or does
 * not. Arguments stay in an array, so nothing is quoted, joined or interpreted.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export type ScriptRun = {
  /** Did a process actually start? False means nothing ran — never "it ran and found nothing". */
  launched: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Safe classification when the process could not start. Never a raw error object. */
  launchError?: "tsx-not-found" | "spawn-failed";
  /** stdout + stderr, for assertions that only care what was printed. */
  output: string;
};

/**
 * Locate tsx's CLI entry inside THIS repository. Resolution is by module path, so it is the same
 * file on every platform — no bin shim, no `.cmd`, no PATH.
 */
export function resolveTsxCli(root = process.cwd()): string | null {
  const candidates = [join(root, "node_modules", "tsx", "dist", "cli.mjs")];
  try {
    // Preferred: ask Node where the installed package actually is, which survives hoisting.
    const require = createRequire(join(root, "package.json"));
    const pkg = require.resolve("tsx/package.json");
    candidates.unshift(join(pkg, "..", "dist", "cli.mjs"));
  } catch { /* fall through to the conventional path */ }
  return candidates.find((c) => existsSync(c)) ?? null;
}

export function runRepoScript(scriptPath: string, args: string[] = [], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): ScriptRun {
  const cwd = opts.cwd ?? process.cwd();
  const cli = resolveTsxCli(cwd);
  if (!cli) {
    return { launched: false, exitCode: null, stdout: "", stderr: "", launchError: "tsx-not-found", output: "" };
  }
  // --conditions=react-server is preserved: the scripts import server-only modules.
  const res = spawnSync(process.execPath, [cli, "--conditions=react-server", scriptPath, ...args], {
    cwd,
    env: opts.env ?? process.env,
    encoding: "utf8",
    shell: false,
  });
  if (res.error) {
    return { launched: false, exitCode: null, stdout: res.stdout ?? "", stderr: res.stderr ?? "", launchError: "spawn-failed", output: `${res.stdout ?? ""}${res.stderr ?? ""}` };
  }
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  return { launched: true, exitCode: res.status, stdout, stderr, output: `${stdout}${stderr}` };
}
