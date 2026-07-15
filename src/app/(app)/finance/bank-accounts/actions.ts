"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, bankAccountsTable, accountsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";

export type ActionResult = { error?: string };

const PATH = "/finance/bank-accounts";

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
      bankName: String(formData.get("bankName") ?? "").trim() || null,
      accountNumberMasked: String(formData.get("accountNumberMasked") ?? "").trim() || null,
      glAccountId,
      openingBalance,
    })
    .returning({ id: bankAccountsTable.id });

  await logActivity(session, {
    type: "bank_account.created",
    description: `Added bank account "${name}"`,
    entityType: "bank_account",
    entityId: row.id,
  });
  revalidatePath(PATH);
  return {};
}
