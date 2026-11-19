/**
 * PO-02D3 test helper — run server code that reads `headers()` from next/headers OUTSIDE a Next.js server, by entering
 * the two request stores Next.js itself uses (work + work-unit async storage, type "request"). Only for the
 * verification suites: it lets them drive the real customer acceptance orchestrator (which reads the request's Origin,
 * forwarded IP and user agent, as do the customer audit helpers it calls inside the transaction) on real PostgreSQL.
 *
 * It depends on Next.js internals of the pinned version (next 16.4.3). If those change, `withRequest` throws loudly —
 * it can never make a check pass silently: the suites also assert that `headers()` throws outside the scope.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { join } from "node:path";

// Next.js's server runtime installs AsyncLocalStorage globally before its storages are created; plain Node does not.
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;

const require = createRequire(join(process.cwd(), "package.json"));
const { workAsyncStorage } = require("next/dist/server/app-render/work-async-storage.external") as {
  workAsyncStorage: { run<T>(store: unknown, fn: () => T): T };
};
const { workUnitAsyncStorage } = require("next/dist/server/app-render/work-unit-async-storage.external") as {
  workUnitAsyncStorage: { run<T>(store: unknown, fn: () => T): T };
};

/** Run `fn` as if inside a server action of /register/accept that received exactly these request headers. */
export function withRequest<T>(headers: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const workStore = { route: "/register/accept", forceStatic: false, dynamicShouldError: false, isStaticGeneration: false };
  const requestStore = { type: "request", phase: "action", headers: new Headers(headers) };
  return workAsyncStorage.run(workStore, () => workUnitAsyncStorage.run(requestStore, fn));
}
