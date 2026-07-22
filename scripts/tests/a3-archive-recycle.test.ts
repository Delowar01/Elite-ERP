/**
 * Batch A3 — Archive & Recycle Bin: enforcement-contract test.
 *
 * All six operations are decided by the Batch A1 lifecycle module, which both the
 * generic server actions (`_shared/lifecycle-actions.ts`) and the UI (`document-row-actions`,
 * Recycle Bin page) call. This test pins the rules that matter most:
 *   - soft_delete is refused for every posted status (accounting/inventory never touched)
 *     and for reference-guarded statuses when referenced;
 *   - restore only applies to Recycle-Bin (deleted) records;
 *   - permanent_delete is owner-only, draft-only, unposted, unreferenced, and only from
 *     the Recycle Bin — every other combination is refused.
 */
import { DOCUMENT_TYPES, documentStatuses, isPosted, evaluate, can, type DocumentType } from "../../src/lib/document-lifecycle";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const TYPES: DocumentType[] = [
  "quotation",
  "sales_order",
  "proforma_invoice",
  "sales_invoice",
  "delivery_challan",
  "credit_note",
  "debit_note",
  "purchase_order",
];

for (const docType of TYPES) {
  check(`${docType} known`, DOCUMENT_TYPES.includes(docType));

  for (const status of documentStatuses(docType)) {
    const posted = isPosted(docType, status);

    // --- soft_delete: never for posted statuses (business data stays intact) ---
    if (posted) {
      check(`${docType}/${status} posted → soft_delete refused`, can(docType, status, "soft_delete", { recordState: "active" }) === false);
    }

    // --- restore: only from the Recycle Bin ---
    check(`${docType}/${status} restore needs deleted state`, can(docType, status, "restore", { recordState: "active" }) === false);
    check(`${docType}/${status} restore ok when deleted`, can(docType, status, "restore", { recordState: "deleted" }) === true);

    // --- permanent_delete matrix ---
    const owner = { role: "owner" as const };
    // Not from the bin → always refused, even for an owner on a draft.
    check(`${docType}/${status} perm-delete refused when active`, can(docType, status, "permanent_delete", { ...owner, recordState: "active" }) === false);
    // From the bin: only owner + draft + unposted + unreferenced.
    const fromBin = { recordState: "deleted" as const };
    const eligible = status === "draft" && !posted;
    check(
      `${docType}/${status} owner+bin+unreferenced → ${eligible}`,
      can(docType, status, "permanent_delete", { ...owner, ...fromBin, isReferenced: false }) === eligible,
    );
    // Non-owner never permitted, even when otherwise eligible.
    check(`${docType}/${status} admin perm-delete refused`, can(docType, status, "permanent_delete", { role: "admin", ...fromBin, isReferenced: false }) === false);
    check(`${docType}/${status} staff perm-delete refused`, can(docType, status, "permanent_delete", { role: "staff", ...fromBin, isReferenced: false }) === false);
    // Referenced draft never permanently deletable, even for an owner.
    if (eligible) {
      check(`${docType}/${status} referenced owner perm-delete refused`, can(docType, status, "permanent_delete", { ...owner, ...fromBin, isReferenced: true }) === false);
      check(`${docType}/${status} unreferenced owner perm-delete allowed`, can(docType, status, "permanent_delete", { ...owner, ...fromBin, isReferenced: false }) === true);
    }
  }
}

// Reference-guarded soft_delete: a "sent" quotation referenced downstream cannot be deleted.
check("quotation/sent referenced → soft_delete refused", can("quotation", "sent", "soft_delete", { recordState: "active", isReferenced: true }) === false);
check("quotation/sent unreferenced → soft_delete allowed", can("quotation", "sent", "soft_delete", { recordState: "active", isReferenced: false }) === true);
// A draft is deletable regardless of an (unexpected) reference, matching the A1 matrix.
check("quotation/draft → soft_delete allowed", can("quotation", "draft", "soft_delete", { recordState: "active" }) === true);
// A record already in the Recycle Bin blocks non-restore/non-permanent-delete actions.
check("quotation/draft deleted → archive blocked", evaluate("quotation", "draft", "archive", { recordState: "deleted" }).allowed === false);

console.log(`\n${passed}/${passed + failed} A3 archive/recycle-bin gate checks passed`);
if (failed > 0) process.exit(1);
