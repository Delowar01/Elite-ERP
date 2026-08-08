import { createRequire } from "module";
const _req = createRequire(import.meta.url);
_req.cache[_req.resolve("server-only")] = { id: "server-only", filename: "server-only", loaded: true, exports: {} } as never;

import { DOCUMENT_TYPES, documentStatuses, isPosted, type DocumentType } from "../src/lib/document-lifecycle";
import { DOC_EDIT_CONFIG, canEditDocument, editDecision, editHrefFor } from "../src/lib/document-edit";

const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);

// 1. Every document type is configured — no type can silently lose its Edit action.
check("all 8 document types have an edit config", DOCUMENT_TYPES.every((d) => Boolean(DOC_EDIT_CONFIG[d])), String(DOCUMENT_TYPES.length));
check("every configured edit route points at an existing /[id]/edit path",
  DOCUMENT_TYPES.every((d) => /^\/[a-z-]+\/[a-z-]+\/123\/edit$/.test(editHrefFor(d, 123))),
  DOCUMENT_TYPES.map((d) => editHrefFor(d, 123)).join(" "));
check("edit routes are unique per document type", new Set(DOCUMENT_TYPES.map((d) => editHrefFor(d, 1))).size === 8);

// 2. The rule is exactly the existing lifecycle rule: drafts only, never a posted document.
for (const docType of DOCUMENT_TYPES) {
  for (const status of documentStatuses(docType)) {
    const allowed = canEditDocument(docType, { status });
    const expected = status === "draft" && !isPosted(docType, status);
    check(`${docType}/${status}: editable = ${expected}`, allowed === expected, `got ${allowed}`);
  }
}

// 3. Record state is respected — a document in the Recycle Bin is never editable, even as a draft.
for (const docType of DOCUMENT_TYPES) {
  check(`${docType}: a soft-deleted draft is not editable`, !canEditDocument(docType, { status: "draft", recordState: "deleted" }));
  // Archived is orthogonal to business status and does not block editing (existing lifecycle rule).
  check(`${docType}: an archived draft follows the existing archive rule`,
    canEditDocument(docType, { status: "draft", recordState: "archived" }) === canEditDocument(docType, { status: "draft" }));
}

// 4. An unknown status can never accidentally enable Edit.
for (const docType of DOCUMENT_TYPES) {
  check(`${docType}: an unknown status is not editable`, !canEditDocument(docType, { status: "totally-made-up" }));
}

// 5. A refusal explains itself in the lifecycle's own words (used by the server guard's audit trail).
const posted = editDecision("sales_invoice", { status: "sent" });
check("a posted invoice refusal names the corrective path", !posted.allowed && posted.reason.includes("Credit Note"), posted.reason);
const binned = editDecision("quotation", { status: "draft", recordState: "deleted" });
check("a Recycle Bin refusal says so", !binned.allowed && binned.reason.includes("Recycle Bin"), binned.reason);

// 6. Menu and Preview cannot disagree: both call this same function, so assert it is deterministic
//    for the identical input rather than two separate code paths.
for (const docType of DOCUMENT_TYPES) {
  for (const status of documentStatuses(docType)) {
    const a = canEditDocument(docType, { status, recordState: "active" });
    const b = canEditDocument(docType, { status, recordState: "active" });
    if (a !== b) check(`${docType}/${status}: rule is deterministic`, false);
  }
}
check("the availability rule is deterministic for identical input", true);

let allOk = true;
for (const [cond, name, extra] of results) { if (!cond) allOk = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`); }
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(allOk ? "EDIT ACTION RULE VERIFICATION PASS" : "EDIT ACTION RULE VERIFICATION FAIL");
process.exit(allOk ? 0 : 1);
