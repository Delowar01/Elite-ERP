import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { createRequire } from "module";
const _req = createRequire(import.meta.url);
_req.cache[_req.resolve("server-only")] = { id: "server-only", filename: "server-only", loaded: true, exports: {} } as never;

import {
  SENSITIVE_ACTIONS,
  NON_SENSITIVE_ACTIONS,
  buildConfirmContent,
  policyFor,
  requiresConfirmation,
  type SensitiveActionKind,
} from "../src/lib/confirm-policy";
import { t } from "../src/lib/i18n/dict";

/** A string is translated when the Arabic lookup differs from the English source. */
const translated = (en: string) => t("ar", en) !== en;

const ROOT = "src";
const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") || p.endsWith(".ts")) out.push(p);
  }
  return out;
}
const FILES = walk(ROOT);
const read = (p: string) => readFileSync(p, "utf8");

// ---------- 1. one policy, no per-module dialogs ----------
check("every sensitive action kind has a policy entry", SENSITIVE_ACTIONS.every((k) => Boolean(policyFor(k))), String(SENSITIVE_ACTIONS.length));
check("requiresConfirmation accepts only registered kinds",
  SENSITIVE_ACTIONS.every((k) => requiresConfirmation(k)) && !requiresConfirmation("some.random.thing"));
check("ordinary viewing/navigation actions are NOT in the policy",
  NON_SENSITIVE_ACTIONS.every((k) => !requiresConfirmation(k)), NON_SENSITIVE_ACTIONS.join(", "));

// The browser's own dialog must never be used for a decision.
const nativeConfirm = FILES.filter((f) => /\bwindow\.confirm\s*\(/.test(read(f)));
check("no window.confirm anywhere in the app", nativeConfirm.length === 0, nativeConfirm.join(", "));

// Every confirmation goes through the single provider.
const providerUsers = FILES.filter((f) => /useConfirm\(\)/.test(read(f)));
check("many modules share the one confirmation hook", providerUsers.length >= 15, `${providerUsers.length} call sites`);
const providerFile = read(join(ROOT, "app/(app)/_shared/confirm-provider.tsx"));
check("the provider is mounted once in the app layout",
  /<ConfirmProvider/.test(read(join(ROOT, "app/(app)/layout.tsx"))));

// ---------- 2. content: what, which record, what happens, reversibility ----------
const content = buildConfirmContent("en", { kind: "document.void", entityType: "Invoice", entityNumber: "INV-000123" });
check("title names the action and the record", content.title === "Void Invoice INV-000123?", content.title);
check("an irreversible action says so", content.description.includes("cannot be undone"), content.description);
check("the confirm button is action-specific, never OK", content.confirmLabel === "Void");
check("severity marks a destructive action as danger", content.severity === "danger");

const reversible = buildConfirmContent("en", { kind: "document.delete", entityType: "Quotation", entityNumber: "QTN-1" });
check("a reversible delete does NOT claim to be permanent",
  !reversible.description.includes("cannot be undone") && reversible.description.includes("Recycle Bin"), reversible.description);

const financial = buildConfirmContent("en", { kind: "payment.record" });
check("financial severity is used for money movement", financial.severity === "financial");
check("a nameless record still gets a sensible title", financial.title === "Record Payment this record?", financial.title);

// Every destructive kind must be labelled danger AND state irreversibility.
for (const kind of ["document.void", "document.permanentDelete", "payment.delete", "record.permanentDelete", "team.remove"] as SensitiveActionKind[]) {
  const c = buildConfirmContent("en", { kind });
  check(`${kind}: danger styling + explicit irreversibility`, c.severity === "danger" && c.irreversible && c.description.includes("cannot be undone"), c.severity);
}
// No confirm label may be a vague OK/Yes.
for (const kind of SENSITIVE_ACTIONS) {
  const c = buildConfirmContent("en", { kind });
  if (["OK", "Yes", "Confirm"].includes(c.confirmLabel)) check(`${kind}: confirm label is specific`, false, c.confirmLabel);
}
check("no policy uses a vague OK/Yes/Confirm button", true);

// ---------- 3. bilingual ----------
const missing = SENSITIVE_ACTIONS.flatMap((kind) => {
  const e = policyFor(kind);
  return [e.verb, e.consequence].filter((s) => !translated(s));
});
check("every policy verb and sentence has an Arabic translation", missing.length === 0, missing.join(" | "));
check("the shared dialog's own strings are translated",
  ["Cancel", "Working…", "This cannot be undone.", "Discard unsaved changes?", "Keep Editing", "Discard Changes"].every(translated));
const ar = buildConfirmContent("ar", { kind: "document.void", entityType: "Invoice", entityNumber: "INV-000123" });
check("Arabic titles are composed from Arabic fragments", /[؀-ۿ]/.test(ar.title) && ar.title.includes("INV-000123"), ar.title);
check("Arabic descriptions are Arabic, not English", /[؀-ۿ]/.test(ar.description) && !/[a-z]{4}/.test(ar.description), ar.description);

// ---------- 4. coverage: the actions the brief lists are actually wired ----------
const ALL = FILES.map(read).join("\n");
const WIRED: [string, SensitiveActionKind][] = [
  ["Edit", "document.edit"],
  ["Convert", "document.convert"],
  ["Send / issue / post", "document.submit"],
  ["Receive", "document.receive"],
  ["Void", "document.void"],
  ["Cancel document", "document.cancel"],
  ["Reverse", "document.reverse"],
  ["Status change", "document.statusChange"],
  ["Archive", "document.archive"],
  ["Delete document", "document.delete"],
  ["Permanent delete", "document.permanentDelete"],
  ["Record payment", "payment.record"],
  ["Delete payment", "payment.delete"],
  ["Post journal entry", "journal.post"],
  ["Delete master record", "record.delete"],
  ["Permanently delete master record", "record.permanentDelete"],
  ["Delete preset", "preset.delete"],
  ["Document numbering", "preset.numbering"],
  ["Compliance setting", "settings.compliance"],
  ["Remove/deactivate team member", "team.remove"],
  ["Change role", "team.roleChange"],
  ["Import", "import.commit"],
  ["Delete saved view", "view.delete"],
];
for (const [label, kind] of WIRED) {
  check(`${label} is wired to the shared confirmation (${kind})`, ALL.includes(`"${kind}"`));
}

// ---------- 5. no confirmation on ordinary actions ----------
const pdfButton = read(join(ROOT, "app/(app)/sales/_shared/download-pdf-button.tsx"));
check("Download PDF does not confirm", !pdfButton.includes("useConfirm"));
const toolbar = read(join(ROOT, "app/(app)/documents/_workspace/list-workspace-toolbar.tsx"));
check("search/filter/sort do not confirm", !/set\(\{ search[^)]*\)[^\n]*confirm/.test(toolbar));
check("restore from the Recycle Bin is not gated behind a popup",
  /function restore\([^)]*\) \{\s*startTransition/.test(read(join(ROOT, "app/(app)/recycle-bin/recycle-bin-client.tsx"))));

// ---------- 6. duplicate-execution protection lives in the provider ----------
check("the provider disables both buttons while running", /disabled=\{busy\}/.test(providerFile) && providerFile.split("disabled={busy}").length >= 3);
check("a re-entrant confirm is blocked by a running guard", /running\.current/.test(providerFile));
check("a failed action keeps the dialog open and shows the message",
  /setError\(result\.error\)/.test(providerFile) && /role="alert"/.test(providerFile));
check("success closes the dialog, navigation keeps it working",
  /navigatesOnSuccess/.test(providerFile) && /setRequest\(null\)/.test(providerFile));
check("Escape is ignored while an action is running", /onEscapeKeyDown/.test(providerFile));
check("Cancel is the default focus, not the destructive button",
  providerFile.indexOf("autoFocus") < providerFile.indexOf('variant={destructive'));

// ---------- 7. financial confirmations carry the figures ----------
const payDialog = read(join(ROOT, "app/(app)/finance/_shared/record-payment-dialog.tsx"));
check("recording a payment shows amount, document, party and bank account",
  ['label: "Amount"', 'label: "Document"', 'label: "Bank Account"'].every((s) => payDialog.includes(s)));
const journal = read(join(ROOT, "app/(app)/finance/journal/journal-form.tsx"));
check("posting a journal entry shows the balanced totals",
  journal.includes('label: "Total Debits"') && journal.includes('label: "Total Credits"'));

// ---------- 8. unsaved changes only when actually changed (see verify-dirty-form.mts) ----------
const unsaved = read(join(ROOT, "app/(app)/_shared/dirty-form.tsx"));
check("dirty is derived by comparing against the opening snapshot", /const dirty = baseline !== serialized;/.test(unsaved));
check("the unload prompt does nothing while the form is clean", /if \(!anyDirty\(\)\) return;/.test(unsaved));
const guarded = FILES.filter((f) => /const dirtyForm = useDirtyForm\(\{/.test(read(f)));
const BUILDER_FORMS = ["quotation-form", "order-form", "proforma-form", "invoice-form", "dc-form", "cn-form", "po-form", "dn-form"];
check("all 8 document builders track unsaved changes",
  BUILDER_FORMS.every((name) => guarded.some((f) => f.endsWith(`${name}.tsx`))),
  `${guarded.length} forms in total (builders + other modules)`);
check("unsaved-changes reuses the confirmation policy rather than its own dialog",
  /navigation\.discardUnsavedChanges/.test(unsaved) && !/DialogContent/.test(unsaved));

// ---------- 9. the popup is not authorization ----------
check("the policy module says so in its own contract", /UX protection only/.test(read(join(ROOT, "lib/confirm-policy.ts"))));

let allOk = true;
for (const [cond, name, extra] of results) { if (!cond) allOk = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "CONFIRMATION POLICY VERIFICATION PASS" : "CONFIRMATION POLICY VERIFICATION FAIL");
process.exit(allOk ? 0 : 1);
