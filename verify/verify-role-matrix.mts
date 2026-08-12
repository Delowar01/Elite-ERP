/**
 * Asserts the Roles & Permissions panel against the guards actually in the code — in BOTH
 * directions, which is the point:
 *
 *   forward   every restriction the matrix declares has a real server-side guard
 *   backward  every role guard in the app is represented in the matrix
 *
 * The backward direction is what makes drift loud. Adding requireRole() to a new action, or
 * removing one, fails this check until the matrix is updated to match.
 *
 * Enforcement uses three idioms and all three count: requireRole(...), an inline
 * `if (session.role === "staff")`, and the document lifecycle rule matrix.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { MODULE_ACCESS, RESTRICTED_ACTIONS } from "../src/lib/role-matrix";
import { evaluate } from "../src/lib/document-lifecycle";

const results: [boolean, string, string?][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

const APP = "src/app";

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const files = await walk(APP);

/** Every place a role is enforced, with the roles it permits. */
type Guard = { file: string; fn: string; roles: string[]; style: "requireRole" | "inline" };
const guards: Guard[] = [];

for (const f of files) {
  const src = await readFile(f, "utf8");
  if (!/require(Role|Session)|session\.role/.test(src)) continue;

  // Split into top-level functions so a guard can be attributed to a capability.
  const fns = [...src.matchAll(/export (?:async )?function (\w+)/g)];
  for (let i = 0; i < fns.length; i++) {
    const start = fns[i].index!;
    const end = i + 1 < fns.length ? fns[i + 1].index! : src.length;
    const body = src.slice(start, end);
    const rr = body.match(/requireRole\(([^)]*)\)/);
    if (rr) {
      guards.push({ file: f, fn: fns[i][1], roles: [...rr[1].matchAll(/"(\w+)"/g)].map((m) => m[1]), style: "requireRole" });
      continue;
    }
    if (/if \(session\.role === "staff"\)\s*return/.test(body)) {
      guards.push({ file: f, fn: fns[i][1], roles: ["owner", "admin"], style: "inline" });
    }
  }
  // Page components are default exports, so catch those separately.
  if (/export default async function/.test(src)) {
    const rr = src.match(/requireRole\(([^)]*)\)/);
    if (rr && !guards.some((g) => g.file === f)) {
      guards.push({ file: f, fn: "<page>", roles: [...rr[1].matchAll(/"(\w+)"/g)].map((m) => m[1]), style: "requireRole" });
    }
  }
}

check("found role guards to compare against", guards.length > 0, `n=${guards.length}`);

// ---------- forward: every declared restriction has a real guard ----------
const owns = (g: Guard, roles: string[]) => g.roles.length === roles.length && roles.every((r) => g.roles.includes(r));

const permDoc = evaluate("quotation", "draft", "permanent_delete", { role: "owner", recordState: "deleted" });
const permDocAdmin = evaluate("quotation", "draft", "permanent_delete", { role: "admin", recordState: "deleted" });
check("declared: permanently delete a document is owner-only — lifecycle agrees",
  permDoc.allowed && !permDocAdmin.allowed, `owner=${permDoc.allowed} admin=${permDocAdmin.allowed}`);

for (const [label, fn] of [["client", "permanentlyDeleteClientAction"], ["vendor", "permanentlyDeleteVendorAction"], ["product", "permanentlyDeleteProductAction"]] as const) {
  const g = guards.find((x) => x.fn === fn);
  check(`declared: permanently delete a ${label} is owner-only — guard agrees`, !!g && owns(g, ["owner"]), g ? g.roles.join("+") : "no guard");
}

const delPay = guards.find((g) => g.fn === "deletePaymentAction");
check("declared: delete a payment is owner+admin — guard agrees", !!delPay && owns(delPay, ["owner", "admin"]), delPay ? delPay.roles.join("+") : "no guard");

const refundAdv = guards.find((g) => g.fn === "refundAdvanceAction");
check("declared: refund a customer advance is owner+admin — guard agrees", !!refundAdv && owns(refundAdv, ["owner", "admin"]), refundAdv ? refundAdv.roles.join("+") : "no guard");

for (const fn of ["approveLeaveAction", "rejectLeaveAction"]) {
  const g = guards.find((x) => x.fn === fn);
  check(`declared: ${fn} is owner+admin — guard agrees`, !!g && owns(g, ["owner", "admin"]), g ? g.roles.join("+") : "no guard");
}

// Modules the matrix marks "none" for staff must actually deny staff.
const noneForStaff = MODULE_ACCESS.filter((m) => m.staff === "none").map((m) => m.module);
check("matrix denies staff exactly Payroll and Configuration", noneForStaff.join(", ") === "Payroll, Configuration", noneForStaff.join(", "));
check("Payroll is guarded", guards.some((g) => g.file.includes("hr/payroll") && owns(g, ["owner", "admin"])));
for (const area of ["settings/presets", "settings/organization", "settings/team", "settings/compliance"]) {
  check(`Configuration guarded: ${area}`, guards.some((g) => g.file.includes(area) && owns(g, ["owner", "admin"])), "");
}

// The three config popups reachable from a document builder must all refuse staff.
for (const fn of ["updateOrgContactAction", "saveDocumentSequenceAction", "updateValidityDaysAction"]) {
  const g = guards.find((x) => x.fn === fn);
  check(`config popup refuses staff: ${fn}`, !!g && g.style === "inline", g ? g.style : "NO GUARD");
}

// ---------- backward: every guard in the app is represented ----------
// Anything the matrix does not account for is drift and must be declared before this passes.
const DECLARED_FNS = new Set([
  "permanentlyDeleteClientAction", "permanentlyDeleteVendorAction", "permanentlyDeleteProductAction",
  "deletePaymentAction", "refundAdvanceAction", "approveLeaveAction", "rejectLeaveAction",
  "updateOrgContactAction", "saveDocumentSequenceAction", "updateValidityDaysAction",
  // Dismissing the one-time base-currency notice writes an org-level column, and only owners and
  // admins can change the currency it concerns — so the notice is shown to nobody else, and this
  // guard is what makes that a rule rather than a display choice. Same tier as the other
  // org-settings writes above.
  "confirmBaseCurrencyAction",
]);
const DECLARED_AREAS = ["settings/presets", "settings/organization", "settings/team", "settings/compliance", "hr/payroll"];

const undeclared = guards.filter(
  (g) => !DECLARED_FNS.has(g.fn) && !DECLARED_AREAS.some((a) => g.file.includes(a)),
);
check(
  "no role guard exists that the matrix does not account for",
  undeclared.length === 0,
  undeclared.map((g) => `${g.file.replace("src/app/(app)/", "")}:${g.fn}(${g.roles.join("+")})`).join(" | "),
);

// ---------- the panel must render the matrix, not its own copy ----------
const panel = await readFile("src/app/(app)/settings/organization/reference-panels.tsx", "utf8");
check("the panel renders MODULE_ACCESS", /MODULE_ACCESS\.map/.test(panel));
check("the panel renders RESTRICTED_ACTIONS", /RESTRICTED_ACTIONS\.map/.test(panel));
check("the panel keeps no hardcoded role table of its own", !/const ROWS\s*[:=]/.test(panel));
check("the false 'Owner and Admin are identical' claim is gone", !/identical access/i.test(panel));
check("the panel states plainly that staff can void and post to the ledger",
  /void invoices/i.test(panel) && /journal entries/i.test(panel));

// Every module in the matrix is a real module; all four previously-omitted areas are present.
for (const m of ["Inventory", "Clients & Vendors", "Projects", "Employees & Attendance"]) {
  check(`previously-omitted module now declared: ${m}`, MODULE_ACCESS.some((x) => x.module === m));
}
check("no module is left undeclared for any role",
  MODULE_ACCESS.every((m) => m.owner && m.admin && m.staff));
check("every restricted action names the roles allowed",
  RESTRICTED_ACTIONS.every((r) => r.allowed.length > 0 && !!r.reason));

let ok = true;
for (const [c, n, x] of results) { if (!c) ok = false; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  << " + x : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "ROLE MATRIX VERIFICATION PASS" : "ROLE MATRIX VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
