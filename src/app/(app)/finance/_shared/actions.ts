"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, accountsTable } from "@/db";
import { requireSession } from "@/lib/session";
import { logActivity } from "@/lib/activity";

export type ActionResult = { error?: string };

const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
const NORMAL_BALANCE_BY_TYPE: Record<(typeof ACCOUNT_TYPES)[number], "debit" | "credit"> = {
  asset: "debit",
  liability: "credit",
  equity: "credit",
  revenue: "credit",
  expense: "debit",
};

export async function createAccountAction(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const code = String(formData.get("code") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "") as (typeof ACCOUNT_TYPES)[number];

  if (!code || !name) return { error: "Code and name are required." };
  if (!ACCOUNT_TYPES.includes(type)) return { error: "Invalid account type." };

  const [dupe] = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.orgId, session.orgId), eq(accountsTable.code, code)));
  if (dupe) return { error: "An account with this code already exists." };

  const [row] = await db
    .insert(accountsTable)
    .values({
      orgId: session.orgId,
      code,
      name,
      type,
      normalBalance: NORMAL_BALANCE_BY_TYPE[type],
      isSystem: false,
    })
    .returning({ id: accountsTable.id });

  await logActivity(session, {
    type: "account.created",
    description: `Added account "${code} · ${name}"`,
    entityType: "account",
    entityId: row.id,
  });
  revalidatePath("/finance/chart-of-accounts");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/journal");
  return {};
}
