/**
 * Batch A2 — Draft-Only Editing: enforcement contract test.
 *
 * Every one of the 8 document types must allow the "edit" action ONLY while the
 * document is a draft, and reject it in every other status (sent / confirmed /
 * posted / issued / cancelled / void / …). This is the single shared rule that
 * both layers of the A2 feature rely on:
 *   - the `[id]/edit` page (Server Component) calls `can(docType, status, "edit")`
 *     and `redirect()`s to the detail page when it returns false, so a direct
 *     visit to a non-draft edit URL is rejected server-side; and
 *   - each `update<Doc>Action` re-checks `can(docType, existing.status, "edit")`
 *     and returns an error before touching the database.
 *
 * Asserting the gate here proves the invariant both layers depend on, independent
 * of a running session or database.
 */
import { DOCUMENT_TYPES, documentStatuses, can, type DocumentType } from "../../src/lib/document-lifecycle";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// All 8 A2 document types must be covered by the lifecycle module.
const A2_TYPES: DocumentType[] = [
  "quotation",
  "sales_order",
  "proforma_invoice",
  "sales_invoice",
  "delivery_challan",
  "credit_note",
  "debit_note",
  "purchase_order",
];

for (const t of A2_TYPES) {
  check(`${t} is a known document type`, DOCUMENT_TYPES.includes(t));
}

for (const docType of A2_TYPES) {
  const statuses = documentStatuses(docType);
  check(`${docType} declares a "draft" status`, statuses.includes("draft"));

  for (const status of statuses) {
    const editable = can(docType, status, "edit");
    if (status === "draft") {
      check(`${docType}/draft → editable`, editable === true);
    } else {
      check(`${docType}/${status} → NOT editable`, editable === false);
    }
  }
}

// A non-existent status must never be editable (defensive: a bad/legacy value
// reaching the edit route or update action must fall through to rejection).
for (const docType of A2_TYPES) {
  check(`${docType}/__bogus__ → NOT editable`, can(docType, "__bogus__", "edit") === false);
}

console.log(`\n${passed}/${passed + failed} A2 draft-edit gate checks passed`);
if (failed > 0) process.exit(1);
