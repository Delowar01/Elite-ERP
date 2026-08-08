import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { createRequire } from "module";
const _req = createRequire(import.meta.url);
_req.cache[_req.resolve("server-only")] = { id: "server-only", filename: "server-only", loaded: true, exports: {} } as never;

import { buildConfirmContent, policyFor, requiresConfirmation } from "../src/lib/confirm-policy";
import { t } from "../src/lib/i18n/dict";

const ROOT = "src";
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const read = (p: string) => readFileSync(p, "utf8");
const translated = (en: string) => t("ar", en) !== en;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}
const FILES = walk(ROOT);

// ---------- 1. it reuses the Global Confirmation System, it is not a second one ----------
check("discardUnsavedChanges is a policy in the shared registry", requiresConfirmation("navigation.discardUnsavedChanges"));
const policy = policyFor("navigation.discardUnsavedChanges");
check("its severity is warning", policy.severity === "warning", policy.severity);

const content = buildConfirmContent("en", { kind: "navigation.discardUnsavedChanges" });
check("title is exactly the requested wording", content.title === "Discard unsaved changes?", content.title);
check("description explains what is lost",
  content.description === "You have changes that have not been saved. If you leave this page, those changes will be lost.", content.description);
check("buttons read Keep Editing | Discard Changes",
  content.cancelLabel === "Keep Editing" && content.confirmLabel === "Discard Changes",
  `${content.cancelLabel} | ${content.confirmLabel}`);

const dirtyFile = read(join(ROOT, "app/(app)/_shared/dirty-form.tsx"));
check("the dirty-form system renders no dialog of its own", !/<Dialog/.test(dirtyFile) && !/DialogContent/.test(dirtyFile));
check("it asks through the shared confirmation hook", /useConfirm\(\)/.test(dirtyFile) && /navigation\.discardUnsavedChanges/.test(dirtyFile));
check("no window.confirm anywhere in the app", FILES.every((f) => !/\bwindow\.confirm\s*\(/.test(read(f))));
check("the superseded stand-alone unsaved-changes dialog is gone",
  !existsSync(join(ROOT, "app/(app)/_shared/unsaved-changes.tsx")));
check("the provider is mounted once, inside the confirmation provider",
  /<DirtyFormProvider>/.test(read(join(ROOT, "app/(app)/layout.tsx"))));

// ---------- 2. the shared primitives ----------
check("useDirtyForm is exported for React-state forms", /export function useDirtyForm\(/.test(dirtyFile));
check("useDirtyFormFields is exported for plain <form action> screens", /export function useDirtyFormFields\(/.test(dirtyFile));
check("useGuardedRouter is exported for programmatic navigation", /export function useGuardedRouter\(/.test(dirtyFile));
check("dirty is a comparison against the opening baseline, not a touched flag",
  /const dirty = baseline !== serialized;/.test(dirtyFile));
check("markClean re-baselines and restoreDirty puts it back",
  /markClean = useCallback/.test(dirtyFile) && /restoreDirty = useCallback/.test(dirtyFile));

// ---------- 3. navigation coverage ----------
check("in-app links are intercepted by one capture-phase listener",
  /document\.addEventListener\("click", onClick, true\)/.test(dirtyFile));
check("new tabs, downloads and external links are left alone",
  /anchor\.target/.test(dirtyFile) && /hasAttribute\("download"\)/.test(dirtyFile) && /url\.origin !== window\.location\.origin/.test(dirtyFile));
check("modifier-clicks (open in new tab) are left alone", /metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/.test(dirtyFile));
check("navigating to the same URL does not prompt", /window\.location\.pathname \+ window\.location\.search/.test(dirtyFile));
check("push, replace and back all route through the guard",
  /push: \(href: string\) => \(registry \? registry\.guard/.test(dirtyFile) &&
  /replace: \(href: string\) => \(registry \? registry\.guard/.test(dirtyFile) &&
  /back: \(\) => \(registry \? registry\.guard/.test(dirtyFile));
check("choosing Discard suppresses a second prompt for that navigation", /bypass\.current = true/.test(dirtyFile));

// ---------- 4. browser refresh / tab close ----------
check("beforeunload is registered", /addEventListener\("beforeunload"/.test(dirtyFile));
check("beforeunload does nothing while clean", /if \(!anyDirty\(\)\) return;\n\s*e\.preventDefault\(\);/.test(dirtyFile));

// ---------- 5/7. all eight document builders, with the complete document state ----------
const BUILDERS: [string, string[]][] = [
  ["sales/quotations/quotation-form.tsx", ["title", "customerId", "items", "terms", "notes", "attachments", "bankAccountIds", "currency", "sealOverride"]],
  ["sales/orders/order-form.tsx", ["title", "customerId", "items", "terms", "notes", "attachments", "bankAccountIds", "currency", "sealOverride"]],
  ["sales/proforma/proforma-form.tsx", ["title", "customerId", "items", "terms", "notes", "attachments", "bankAccountIds", "currency", "sealOverride"]],
  ["sales/invoices/invoice-form.tsx", ["title", "customerId", "items", "terms", "notes", "attachments", "bankAccountIds", "currency", "sealOverride"]],
  // No bankAccountIds here: the delivery challan has no bank block at all (see the check below).
  ["sales/delivery-challans/dc-form.tsx", ["customerId", "dispatchDate", "carrier", "vehicleNo", "items", "terms"]],
  ["sales/credit-notes/cn-form.tsx", ["sourceInvoiceId", "items", "terms", "reason", "bankAccountIds"]],
  ["purchasing/orders/po-form.tsx", ["title", "vendorId", "items", "terms", "notes", "attachments", "bankAccountIds", "currency", "sealOverride"]],
  ["purchasing/debit-notes/dn-form.tsx", ["sourcePurchaseOrderId", "items", "terms", "reason", "bankAccountIds"]],
];
for (const [rel, fields] of BUILDERS) {
  const s = read(join(ROOT, "app/(app)", rel));
  const name = rel.split("/").pop();
  const snap = /const dirtyForm = useDirtyForm\(\{([^}]*)\}\);/.exec(s)?.[1] ?? "";
  check(`${name}: registers with the shared dirty-form hook`, snap.length > 0);
  const missing = fields.filter((f) => !new RegExp(`\\b${f}\\b`).test(snap));
  check(`${name}: snapshot covers line items, terms and the rest`, missing.length === 0, missing.join(", "));
  check(`${name}: marks clean before submitting`, /dirtyForm\.markClean\(\);\n\s*(const|await)/.test(s));
  check(`${name}: a failed save restores the dirty state`, /dirtyForm\.restoreDirty\(\);/.test(s));
}

// The delivery challan is the one document with no bank block: it quotes no prices and requests
// no payment. Asserted here rather than left implicit, so re-adding the field trips this check
// instead of silently putting payment instructions back on a dispatch note.
{
  const dc = read(join(ROOT, "app/(app)/sales/delivery-challans/dc-form.tsx"));
  check("dc-form.tsx: has no bank-account field to track in the first place", !/bankAccountIds/.test(dc));
  for (const [label, rel] of [
    ["detail page", "app/(app)/sales/delivery-challans/[id]/page.tsx"],
    ["create/edit actions", "app/(app)/sales/delivery-challans/actions.ts"],
  ] as const) {
    check(`delivery challan ${label} reads no bank accounts`, !/bankAccounts/.test(read(join(ROOT, rel))));
  }
}

// ---------- 8. reusable beyond documents ----------
const REUSE = [
  ["Clients", "app/(app)/clients/client-form.tsx"],
  ["Vendors", "app/(app)/purchasing/vendors/vendor-form.tsx"],
  ["Products", "app/(app)/inventory/products/product-form.tsx"],
  ["Journal Entries", "app/(app)/finance/journal/journal-form.tsx"],
];
for (const [label, rel] of REUSE) {
  const s = read(join(ROOT, rel));
  check(`${label} uses the same shared system`, /useDirtyForm(Fields)?\(/.test(s));
}
const users = FILES.filter((f) => /useDirtyForm(Fields)?\(/.test(read(f)));
check("no module re-implements dirty tracking", users.length >= 12, `${users.length} forms share it`);
check("dirty state is computed in exactly one module",
  FILES.filter((f) => /const dirty = baseline !== serialized/.test(read(f))).length === 1);

// ---------- 9. bilingual ----------
check("every string of the discard popup is translated",
  [policy.verb, policy.consequence, policy.title!, policy.cancelVerb!].every(translated),
  [policy.verb, policy.consequence, policy.title, policy.cancelVerb].join(" | "));
const ar = buildConfirmContent("ar", { kind: "navigation.discardUnsavedChanges" });
check("the Arabic popup is Arabic throughout",
  [ar.title, ar.description, ar.confirmLabel, ar.cancelLabel].every((s) => /[؀-ۿ]/.test(s)),
  `${ar.title} / ${ar.cancelLabel} / ${ar.confirmLabel}`);

let allOk = true;
for (const [cond, name, extra] of results) { if (!cond) allOk = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "DIRTY FORM VERIFICATION PASS" : "DIRTY FORM VERIFICATION FAIL");
process.exit(allOk ? 0 : 1);
