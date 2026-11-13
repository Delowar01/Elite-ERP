/**
 * Shared set-up for the PO-01B browser suite: a disposable database with one or more fictional
 * Platform Owners, and `next start` processes on loopback with TEST-ONLY secrets. Nothing here
 * prints a secret, a token or a connection string; server output is kept in memory and scanned.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

export type Server = { port: number; url: string; proc: ChildProcess; output: () => string; stop: () => Promise<void> };

export function testSecrets() {
  return {
    PLATFORM_AUTH_SECRET: randomBytes(48).toString("base64url"),
    AUTH_SECRET: randomBytes(48).toString("base64url"),
    FIELD_ENCRYPTION_KEYS: `1:${randomBytes(32).toString("base64")}`,
  };
}

/** Start `next start` (the production build in .next) on 127.0.0.1:port; resolves once it serves /login. */
export async function startServer(port: number, env: Record<string, string | undefined>): Promise<Server> {
  const root = process.cwd();
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) if (v !== undefined) childEnv[k] = v;
  const proc = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    env: { ...childEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout?.on("data", (d) => (out += String(d)));
  proc.stderr?.on("data", (d) => (out += String(d)));
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`next start exited early (${proc.exitCode})`);
    try {
      const r = await fetch(`${url}/login`, { redirect: "manual" });
      if (r.status === 200) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error("next start did not become ready in 60 s");
    await new Promise((r) => setTimeout(r, 300));
  }
  return {
    port,
    url,
    proc,
    output: () => out,
    stop: () =>
      new Promise<void>((resolve) => {
        if (proc.exitCode !== null) return resolve();
        proc.once("exit", () => resolve());
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5_000).unref();
      }),
  };
}
