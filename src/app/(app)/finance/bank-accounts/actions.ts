"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, bankAccountsTable, accountsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { bankGlRefusal } from "@/lib/bank-gl-accounts";

export type ActionResult = { error?: string; id?: number };

const PATH = "/finance/bank-accounts";

// Optional payment-instruction fields shared by create + update. All trimmed; empty → null.
function readDetailFields(formData: FormData) {
  const s = (k: string) => String(formData.get(k) ?? "").trim() || null;
  return {
    bankName: s("bankName"),
    accountNumberMasked: s("accountNumberMasked"),
    accountHolder: s("accountHolder"),
    iban: s("iban"),
    swift: s("swift"),
    currency: s("currency"),
    branch: s("branch"),
  };
}

export async function createBankAccountAction(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const glAccountId = Number(formData.get("glAccountId"));
  const openingBalance = String(formData.get("openingBalance") ?? "0").trim() || "0";

  if (!name) return { error: "Account name is required." };
  if (Number.isNaN(glAccountId)) return { error: "Choose a linked GL account." };

  const [glAccount] = await db
    .select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name, type: accountsTable.type })
    .from(accountsTable)
    .where(and(eq(accountsTable.id, glAccountId), eq(accountsTable.orgId, session.orgId)));
  if (!glAccount) return { error: "GL account not found." };
  // The server decides, not the dropdown: linking a bank account to a control account posts every
  // receipt into that control account instead of a bank balance (see lib/bank-gl-accounts.ts).
  const refusal = bankGlRefusal(glAccount);
  if (refusal) return { error: refusal };

  const [row] = await db
    .insert(bankAccountsTable)
    .values({
      orgId: session.orgId,
      name,
      glAccountId,
      openingBalanceLegacy: openingBalance,
      ...readDetailFields(formData),
    })
    .returning({ id: bankAccountsTable.id });

  await logActivity(session, {
    type: "bank_account.created",
    description: `Added bank account "${name}"`,
    entityType: "bank_account",
    entityId: row.id,
  });
  revalidatePath(PATH);
  return { id: row.id };
}

// Edit an existing bank account. Tenant-scoped. This changes the master record only — saved
// documents keep the snapshot taken when they were saved, so they are unaffected.
export async function updateBankAccountAction(id: number, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (!Number.isInteger(id)) return { error: "Invalid account." };
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Account name is required." };

  const [existing] = await db
    .select({ id: bankAccountsTable.id, glAccountId: bankAccountsTable.glAccountId })
    .from(bankAccountsTable)
    .where(and(eq(bankAccountsTable.id, id), eq(bankAccountsTable.orgId, session.orgId)));
  if (!existing) return { error: "Bank account not found." };

  // GL account + opening balance are optional on edit — keep the existing values when not supplied.
  const set: Record<string, unknown> = { name, ...readDetailFields(formData) };
  const glRaw = formData.get("glAccountId");
  if (glRaw != null && String(glRaw).trim() !== "") {
    const glAccountId = Number(glRaw);
    const [glAccount] = await db
      .select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name, type: accountsTable.type })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, glAccountId), eq(accountsTable.orgId, session.orgId)));
    if (!glAccount) return { error: "GL account not found." };
    // Refuse a CHANGE to an ineligible account, but let an unchanged legacy mapping through so the
    // other fields stay editable — the same rule the base-currency lock follows. Grandfathered bad
    // mappings are surfaced by scripts/audit-bank-gl-mappings.ts rather than by blocking edits.
    if (glAccountId !== existing.glAccountId) {
      const refusal = bankGlRefusal(glAccount);
      if (refusal) return { error: refusal };
    }
    set.glAccountId = glAccountId;
  }
  const openingRaw = formData.get("openingBalance");
  if (openingRaw != null && String(openingRaw).trim() !== "") set.openingBalanceLegacy = String(openingRaw).trim();

  await db.update(bankAccountsTable).set(set).where(and(eq(bankAccountsTable.id, id), eq(bankAccountsTable.orgId, session.orgId)));

  await logActivity(session, {
    type: "bank_account.updated",
    description: `Edited bank account "${name}"`,
    entityType: "bank_account",
    entityId: id,
  });
  revalidatePath(PATH);
  return { id };
}
