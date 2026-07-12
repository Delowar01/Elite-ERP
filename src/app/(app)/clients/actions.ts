"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, customersTable } from "@/db";
import { requireSession } from "@/lib/session";

export type ActionState = { error?: string } | undefined;

function readClientFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  return {
    name,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    taxId: String(formData.get("taxId") ?? "").trim() || null,
    vatNumber: String(formData.get("vatNumber") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const fields = readClientFields(formData);
  if (!fields.name) return { error: "Name is required." };

  const [row] = await db
    .insert(customersTable)
    .values({ orgId: session.orgId, ...fields })
    .returning({ id: customersTable.id });

  revalidatePath("/clients");
  redirect(`/clients/${row.id}`);
}

export async function updateClientAction(id: number, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const fields = readClientFields(formData);
  if (!fields.name) return { error: "Name is required." };

  await db
    .update(customersTable)
    .set(fields)
    .where(and(eq(customersTable.id, id), eq(customersTable.orgId, session.orgId)));

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return { error: undefined };
}

export async function toggleClientActiveAction(id: number, isActive: boolean) {
  const session = await requireSession();
  await db
    .update(customersTable)
    .set({ isActive })
    .where(and(eq(customersTable.id, id), eq(customersTable.orgId, session.orgId)));
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}
