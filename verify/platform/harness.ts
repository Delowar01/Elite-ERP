/**
 * Minimal assertion harness for the Platform Owner verification suites (same style as the other
 * verify/*.mts scripts: PASS/FAIL lines, non-zero exit on any failure). Never prints secrets,
 * tokens, connection strings or captured CLI output.
 */
let pass = 0;
let fail = 0;
const failures: string[] = [];

export function section(title: string): void {
  console.log(`\n== ${title}`);
}

export function ok(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Run fn; PASS when it throws and `match` accepts the error. */
export async function rejects(name: string, fn: () => Promise<unknown>, match: (e: unknown) => boolean): Promise<void> {
  try {
    await fn();
    ok(name, false, "did not throw");
  } catch (e) {
    ok(name, match(e), `unexpected error: ${describeError(e)}`);
  }
}

export function sqlState(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

export function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}${sqlState(e) ? ` [${sqlState(e)}]` : ""}: ${e.message}`.slice(0, 300);
  return String(e).slice(0, 300);
}

export function summary(suite: string): number {
  console.log(`\n${suite}: ${pass}/${pass + fail} checks passed`);
  if (fail) console.log(`FAILED: ${failures.join("; ")}`);
  return fail ? 1 : 0;
}
