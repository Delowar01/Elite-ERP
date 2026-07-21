/*
 * Batch A1 — document lifecycle rules tests. Pure logic; no server/DB required.
 *   Run:  npx tsx scripts/tests/document-lifecycle.test.ts
 */
import {
  DOCUMENT_TYPES,
  LIFECYCLE_ACTIONS,
  documentStatuses,
  isPosted,
  evaluate,
  can,
  allowedActions,
  assertAllowed,
  type DocumentType,
  type LifecycleAction,
} from "../../src/lib/document-lifecycle";

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; }
  else { failed++; console.log(`FAIL  ${name}${extra ? "  -> " + extra : ""}`); }
}
const OWNER = { role: "owner" as const };

// 1) Draft documents can be edited — for every document type.
for (const d of DOCUMENT_TYPES) check(`edit allowed on ${d}/draft`, can(d, "draft", "edit"));

// 2) Non-draft documents cannot be edited.
for (const d of DOCUMENT_TYPES)
  for (const s of documentStatuses(d))
    if (s !== "draft") check(`edit denied on ${d}/${s}`, !can(d, s, "edit"), evaluate(d, s, "edit").reason);

// 3) Posted documents cannot be edited, soft-deleted, or permanently deleted.
for (const d of DOCUMENT_TYPES)
  for (const s of documentStatuses(d))
    if (isPosted(d, s)) {
      check(`posted ${d}/${s}: edit denied`, !can(d, s, "edit"));
      check(`posted ${d}/${s}: soft_delete denied`, !can(d, s, "soft_delete"));
      check(`posted ${d}/${s}: permanent_delete denied`, !can(d, s, "permanent_delete", { ...OWNER, recordState: "deleted" }));
    }

// 4) Permanent delete: owner-only, draft-only, unposted, unreferenced, from the Recycle Bin.
check("perm_delete OK: owner+draft+deleted+unreferenced", can("quotation", "draft", "permanent_delete", { role: "owner", recordState: "deleted", isReferenced: false }));
check("perm_delete denied: not owner", !can("quotation", "draft", "permanent_delete", { role: "admin", recordState: "deleted" }));
check("perm_delete denied: referenced", !can("quotation", "draft", "permanent_delete", { role: "owner", recordState: "deleted", isReferenced: true }));
check("perm_delete denied: not in bin", !can("quotation", "draft", "permanent_delete", { role: "owner", recordState: "active" }));
check("perm_delete denied: non-draft", !can("sales_order", "confirmed", "permanent_delete", { role: "owner", recordState: "deleted" }));
check("perm_delete denied: posted", !can("sales_invoice", "sent", "permanent_delete", { role: "owner", recordState: "deleted" }));

// 5) Corrections protect accounting/inventory (posted docs -> void/reverse only, never edit/delete).
check("invoice sent: void allowed", can("sales_invoice", "sent", "void"));
check("invoice sent: reverse (credit note) allowed", can("sales_invoice", "sent", "reverse"));
check("invoice sent: edit denied", !can("sales_invoice", "sent", "edit"));
check("invoice sent: soft_delete denied", !can("sales_invoice", "sent", "soft_delete"));
check("invoice paid: void denied (has settlement)", !can("sales_invoice", "paid", "void"));
check("invoice paid: reverse allowed", can("sales_invoice", "paid", "reverse"));
check("invoice partially_paid: void denied", !can("sales_invoice", "partially_paid", "void"));
check("PO received: reverse (debit note) allowed", can("purchase_order", "received", "reverse"));
check("PO received: edit denied", !can("purchase_order", "received", "edit"));
check("PO received: cancel denied", !can("purchase_order", "received", "cancel"));
check("PO received: soft_delete denied", !can("purchase_order", "received", "soft_delete"));
check("credit_note issued: reverse allowed", can("credit_note", "issued", "reverse"));
check("credit_note issued: edit denied", !can("credit_note", "issued", "edit"));
check("credit_note issued: soft_delete denied", !can("credit_note", "issued", "soft_delete"));
check("debit_note issued: reverse allowed", can("debit_note", "issued", "reverse"));
check("debit_note issued: edit denied", !can("debit_note", "issued", "edit"));

// 6) Cancel is for non-posted SO/PO only.
check("SO draft: cancel allowed", can("sales_order", "draft", "cancel"));
check("SO confirmed: cancel allowed", can("sales_order", "confirmed", "cancel"));
check("SO fulfilled: cancel denied", !can("sales_order", "fulfilled", "cancel"));
check("PO draft: cancel allowed", can("purchase_order", "draft", "cancel"));
check("PO ordered: cancel allowed", can("purchase_order", "ordered", "cancel"));
check("PO received: cancel denied", !can("purchase_order", "received", "cancel"));

// 7) Restore only from the Recycle Bin.
check("restore allowed when deleted", can("quotation", "draft", "restore", { recordState: "deleted" }));
check("restore denied when active", !can("quotation", "draft", "restore", { recordState: "active" }));
check("deleted record: edit denied (restore first)", !can("quotation", "draft", "edit", { recordState: "deleted" }));

// 8) Reference-restricted soft delete (sent/accepted/confirmed/fulfilled/dispatched).
check("quotation sent: soft_delete allowed when unreferenced", can("quotation", "sent", "soft_delete", { isReferenced: false }));
check("quotation sent: soft_delete denied when referenced", !can("quotation", "sent", "soft_delete", { isReferenced: true }));
check("SO confirmed: soft_delete denied when referenced", !can("sales_order", "confirmed", "soft_delete", { isReferenced: true }));
check("proforma sent: soft_delete denied when referenced", !can("proforma_invoice", "sent", "soft_delete", { isReferenced: true }));

// 9) Duplicate never allowed for source-bound CN/DN; allowed for quotation/invoice/PO.
check("credit_note draft: duplicate denied (source-bound)", !can("credit_note", "draft", "duplicate"));
check("debit_note draft: duplicate denied (source-bound)", !can("debit_note", "draft", "duplicate"));
check("quotation draft: duplicate allowed", can("quotation", "draft", "duplicate"));
check("invoice paid: duplicate allowed", can("sales_invoice", "paid", "duplicate"));

// 10) Exhaustive sanity: every (docType,status,action) evaluates cleanly; allowedActions is a subset.
for (const d of DOCUMENT_TYPES)
  for (const s of documentStatuses(d)) {
    for (const a of LIFECYCLE_ACTIONS) {
      const res = evaluate(d, s, a as LifecycleAction, { role: "owner", recordState: "active" });
      check(`evaluate returns decision ${d}/${s}/${a}`, typeof res.allowed === "boolean" && typeof res.reason === "string" && res.reason.length > 0);
    }
    const acts = allowedActions(d, s, { role: "owner" });
    check(`allowedActions subset ${d}/${s}`, acts.every((a) => (LIFECYCLE_ACTIONS as readonly string[]).includes(a)));
  }

// 11) Unknown status/type handled without throwing.
check("unknown status denied", !can("quotation", "nonsense", "edit"));
check("assertAllowed throws on denied", (() => { try { assertAllowed("sales_invoice", "paid", "edit"); return false; } catch { return true; } })());
check("assertAllowed passes on allowed", (() => { try { assertAllowed("quotation", "draft", "edit"); return true; } catch { return false; } })());

// ---- Final rule table (default active context, role=owner so perm_delete visibility is realistic) ----
console.log("\n================= FINAL DOCUMENT LIFECYCLE RULE TABLE =================");
console.log("(active record; role=owner; unreferenced, unsettled unless noted)\n");
const header = ["document / status".padEnd(34), ...LIFECYCLE_ACTIONS.map((a) => a.slice(0, 4))].join(" | ");
console.log(header);
console.log("-".repeat(header.length));
for (const d of DOCUMENT_TYPES) {
  for (const s of documentStatuses(d)) {
    const cells = LIFECYCLE_ACTIONS.map((a) => {
      // show permanent_delete/restore against a recycle-bin context so the column is meaningful
      const ctx = a === "permanent_delete" || a === "restore" ? { role: "owner" as const, recordState: "deleted" as const } : { role: "owner" as const };
      return can(d, s, a as LifecycleAction, ctx) ? " ✓ " : " · ";
    });
    console.log([`${d}/${s}${isPosted(d, s) ? " (posted)" : ""}`.padEnd(34), ...cells].join(" | "));
  }
}

console.log(`\n${passed}/${passed + failed} lifecycle checks passed`);
process.exit(failed === 0 ? 0 : 1);
