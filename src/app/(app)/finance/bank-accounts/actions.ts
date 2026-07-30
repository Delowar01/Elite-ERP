"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, bankAccountsTable, accountsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";

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
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.id, glAccountId), eq(accountsTable.orgId, session.orgId)));
  if (!glAccount) return { error: "GL account not found." };

  const [row] = await db
    .insert(bankAccountsTable)
    .values({
      orgId: session.orgId,
      name,
      glAccountId,
      openingBalance,
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
    .select({ id: bankAccountsTable.id })
    .from(bankAccountsTable)
    .where(and(eq(bankAccountsTable.id, id), eq(bankAccountsTable.orgId, session.orgId)));
  if (!existing) return { error: "Bank account not found." };

  // GL account + opening balance are optional on edit — keep the existing values when not supplied.
  const set: Record<string, unknown> = { name, ...readDetailFields(formData) };
  const glRaw = formData.get("glAccountId");
  if (glRaw != null && String(glRaw).trim() !== "") {
    const glAccountId = Number(glRaw);
    const [glAccount] = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(eq(accountsTable.id, glAccountId), eq(accountsTable.orgId, session.orgId)));
    if (!glAccount) return { error: "GL account not found." };
    set.glAccountId = glAccountId;
  }
  const openingRaw = formData.get("openingBalance");
  if (openingRaw != null && String(openingRaw).trim() !== "") set.openingBalance = String(openingRaw).trim();

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
