/**
 * Platform Owner PO-01A — one-time bootstrap CLI (interactive, local disposable databases only).
 *
 *   DATABASE_URL=postgres://…@127.0.0.1:<port>/<name containing _test_only_> \
 *   FIELD_ENCRYPTION_KEYS=… npm run platform:bootstrap
 *
 * Exit codes: 0 created · 1 error · 2 unsafe target · 3 active admin exists · 4 not interactive ·
 * 5 not ready (schema/protection/encryption) · 6 aborted (too many invalid answers).
 * See scripts/platform/bootstrap-core.ts for the full contract. The connection string, password
 * and secrets are never logged; secrets are printed once, to the operator's own terminal.
 */
import { createInterface } from "node:readline";
import { BOOTSTRAP_EXIT, BootstrapRefusedError, preflightBootstrap, runBootstrap, type BootstrapIO } from "./bootstrap-core";

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) =>
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

/** Raw-mode prompt that echoes nothing (no characters, no asterisks). Ctrl-C aborts. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    function onData(chunk: string) {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          reject(new BootstrapRefusedError(BOOTSTRAP_EXIT.ABORTED, "ABORTED", "Aborted by the operator; nothing was created."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    }
    stdin.on("data", onData);
  });
}

const terminalIO: BootstrapIO = {
  ask,
  askHidden,
  say: (line) => console.log(line),
  saySecret: (line) => console.log(line),
};

// True only once every refusal check passed and the app modules (and their pool) may be loaded.
let appModulesLoaded = false;

async function main(): Promise<number> {
  try {
    await preflightBootstrap();
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new BootstrapRefusedError(BOOTSTRAP_EXIT.NOT_INTERACTIVE, "NOT_INTERACTIVE", "Bootstrap must be run in an interactive terminal; nothing was created.");
    }
    appModulesLoaded = true;
    await runBootstrap(terminalIO);
    return BOOTSTRAP_EXIT.OK;
  } catch (err) {
    if (err instanceof BootstrapRefusedError) {
      console.error(`REFUSED [${err.reasonCode}] ${err.message}`);
      return err.exitCode;
    }
    console.error(`platform:bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
    return BOOTSTRAP_EXIT.ERROR;
  }
}

main().then(async (code) => {
  // Close the app pool only if it was ever created (never for a refused target), then exit.
  if (appModulesLoaded) {
    const { pool } = await import("@/db");
    await pool.end().catch(() => undefined);
  }
  process.exit(code);
});
