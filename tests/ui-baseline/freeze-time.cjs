/**
 * DEV-UI-01.0 — server-side clock freeze for the visual-baseline server ONLY.
 *
 * Loaded with `NODE_OPTIONS=--require <this file>` on the `next start` process the baseline
 * harness launches. It is never imported by application code and is not part of the build.
 *
 * Why: pages render "today" on the server (dashboard ranges, default document dates, report
 * periods). A baseline captured on a ticking clock is not reproducible. Freezing `Date` makes every
 * server-rendered date identical across runs.
 *
 * Only argument-less `new Date()` and `Date.now()` are frozen. `new Date(x)` parsing, timers
 * (setTimeout/setInterval are libuv, not Date) and `performance.now()` are untouched.
 */
"use strict";

const iso = process.env.UI_BASELINE_FROZEN_NOW;
if (!iso) throw new Error("freeze-time.cjs: UI_BASELINE_FROZEN_NOW is not set");
const FIXED = Date.parse(iso);
if (!Number.isFinite(FIXED)) throw new Error(`freeze-time.cjs: unparseable UI_BASELINE_FROZEN_NOW ${iso}`);

const RealDate = Date;
// A plain function sharing RealDate.prototype, so instances created natively (fs.Stats, pg) and
// instances created through this constructor are the same kind of object and `instanceof Date`
// holds for both. Reflect.construct keeps `class X extends Date` working.
function FrozenDate(...args) {
  if (!new.target) return new RealDate(FIXED).toString();
  return Reflect.construct(RealDate, args.length === 0 ? [FIXED] : args, new.target);
}
FrozenDate.prototype = RealDate.prototype;
Object.setPrototypeOf(FrozenDate, RealDate);
// Statics must be OWN properties, not inherited: Next.js re-wraps globalThis.Date by copying the
// constructor's own properties, and an inherited Date.parse / Date.UTC silently disappears there
// ("Date.UTC is not a function" — measured during DEV-UI-01.0 as HTTP 500s on report pages).
for (const key of Object.getOwnPropertyNames(RealDate)) {
  if (key === "prototype" || key === "length" || key === "name") continue;
  Object.defineProperty(FrozenDate, key, Object.getOwnPropertyDescriptor(RealDate, key));
}
FrozenDate.now = () => FIXED;
globalThis.Date = FrozenDate;
