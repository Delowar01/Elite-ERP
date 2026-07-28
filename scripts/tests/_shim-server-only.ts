// Test-only shim: neutralize the `server-only` guard so server modules can be exercised under tsx.
// ESM evaluates imported modules in source order, so importing this FIRST patches module loading
// before the module under test pulls in `server-only`.
import Module from "node:module";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return orig.call(this, request, parent, isMain);
};
