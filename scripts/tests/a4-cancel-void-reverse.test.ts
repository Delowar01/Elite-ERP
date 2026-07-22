/**
 * Batch A4 — Cancel / Void / Reversal: enforcement-contract test.
 *
 * The cancel/void/reverse server actions all gate on the A1 lifecycle `evaluate()`.
 * This pins: cancel only for non-posted SO/PO; void only for a posted unpaid invoice
 * (never once a payment exists, never a draft, never twice); reverse only for an issued
 * CN/DN (never a reversed one — no double reversal).
 */
import { evaluate, can } from "../../src/lib/document-lifecycle";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}`); }
}

// --- Cancel: non-posted SO / PO only ---
check("SO draft cancel allowed", can("sales_order", "draft", "cancel"));
check("SO confirmed cancel allowed", can("sales_order", "confirmed", "cancel"));
check("SO fulfilled cancel denied", !can("sales_order", "fulfilled", "cancel"));
check("SO cancelled re-cancel denied (dedup)", !can("sales_order", "cancelled", "cancel"));
check("PO draft cancel allowed", can("purchase_order", "draft", "cancel"));
check("PO ordered cancel allowed", can("purchase_order", "ordered", "cancel"));
check("PO received cancel denied (posted)", !can("purchase_order", "received", "cancel"));
check("PO cancelled re-cancel denied (dedup)", !can("purchase_order", "cancelled", "cancel"));

// --- Void: posted, unpaid invoice only ---
check("invoice sent void allowed (unpaid)", can("sales_invoice", "sent", "void", { hasPayments: false }));
check("invoice sent void denied when payment exists", !can("sales_invoice", "sent", "void", { hasPayments: true }));
check("invoice partially_paid void denied", !can("sales_invoice", "partially_paid", "void"));
check("invoice paid void denied", !can("sales_invoice", "paid", "void"));
check("invoice draft void denied (not posted)", !can("sales_invoice", "draft", "void"));
check("invoice void re-void denied (dedup, terminal)", !can("sales_invoice", "void", "void"));

// --- Reverse: issued CN / DN only ---
check("CN issued reverse allowed", can("credit_note", "issued", "reverse"));
check("CN draft reverse denied (not posted)", !can("credit_note", "draft", "reverse"));
check("CN reversed re-reverse denied (dedup)", !can("credit_note", "reversed", "reverse"));
check("DN issued reverse allowed", can("debit_note", "issued", "reverse"));
check("DN draft reverse denied (not posted)", !can("debit_note", "draft", "reverse"));
check("DN reversed re-reverse denied (dedup)", !can("debit_note", "reversed", "reverse"));

// --- Reversed is terminal & non-posted: no edit/delete, archive only ---
check("CN reversed edit denied", !can("credit_note", "reversed", "edit"));
check("CN reversed soft_delete denied", !can("credit_note", "reversed", "soft_delete"));
check("CN reversed archive allowed", can("credit_note", "reversed", "archive"));
check("DN reversed archive allowed", can("debit_note", "reversed", "archive"));

// --- evaluate() gives a reason for each refusal (used for the UI toast) ---
check("void-denied carries a reason", evaluate("sales_invoice", "paid", "void").reason.length > 0);
check("reverse-denied carries a reason", evaluate("credit_note", "reversed", "reverse").reason.length > 0);

console.log(`\n${passed}/${passed + failed} A4 cancel/void/reverse gate checks passed`);
if (failed > 0) process.exit(1);
